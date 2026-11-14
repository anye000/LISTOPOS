/**
 * Motor de sincronización en el CLIENTE (Fase 2 — Offline-First).
 *
 *  - Escribe primero en Dexie (db-local) y encola en `syncQueue` (Outbox).
 *  - `pullCatalog`: descarga catálogo, clientes y tasas BCV a IndexedDB.
 *  - `pushPending`: sube la cola en lote de forma idempotente (UUIDs).
 *  - `SyncEngine`: reacciona a los eventos online/offline del navegador.
 */
import {
  localDb,
  type ListoPOSLocalDb,
  type SyncQueueEntry,
} from "@/core/db-local/dexie";

/** Guarda una entrada en la cola Outbox (idempotente por id). */
export async function enqueue(
  db: ListoPOSLocalDb,
  entry: Omit<SyncQueueEntry, "localId" | "attempts" | "createdAt">,
): Promise<string> {
  const existing = await db.syncQueue.get({ id: entry.id });
  if (existing) return existing.id;
  await db.syncQueue.add({
    ...entry,
    attempts: 0,
    createdAt: new Date().toISOString(),
  });
  return entry.id;
}

export interface PushStats {
  pushed: number;
  failed: number;
  remaining: number;
}

/** Sube la cola pendiente de una organización a la nube. */
export async function pushPending(
  db: ListoPOSLocalDb,
  orgId: string,
  fetcher: typeof fetch = fetch,
): Promise<PushStats> {
  const pending = await db.syncQueue
    .where("organizationId")
    .equals(orgId)
    .sortBy("localId");

  let pushed = 0;
  let failed = 0;
  for (const entry of pending) {
    try {
      const res = await fetcher("/api/sync/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry),
      });
      if (res.ok) {
        await db.syncQueue.delete(entry.localId!);
        pushed++;
      } else {
        failed++;
        await db.syncQueue.update(entry.localId!, {
          attempts: entry.attempts + 1,
          lastError: `HTTP ${res.status}`,
        });
      }
    } catch (err) {
      failed++;
      await db.syncQueue.update(entry.localId!, {
        attempts: entry.attempts + 1,
        lastError: err instanceof Error ? err.message : "network",
      });
    }
  }

  const remaining = await db.syncQueue
    .where("organizationId")
    .equals(orgId)
    .count();

  return { pushed, failed, remaining };
}

/**
 * Transacción Dexie con más tablas que los overloads tipados (Dexie soporta
 * N tablas en runtime; esto solo relaja el límite de tipos).
 */
function tx(
  db: ListoPOSLocalDb,
  fn: () => Promise<void>,
): Promise<unknown> {
  const transaction = db.transaction.bind(db) as unknown as (
    mode: string,
    ...tablesAndCallback: unknown[]
  ) => Promise<unknown>;
  return transaction(
    "rw",
    db.products,
    db.inventoryStocks,
    db.contacts,
    db.exchangeRates,
    db.cashRegisters,
    db.productRecipes,
    db.meta,
    fn,
  );
}

/** Descarga el catálogo de la organización y actualiza la caché offline. */
export async function pullCatalog(
  db: ListoPOSLocalDb,
  orgId: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const res = await fetcher(`/api/sync/pull?org=${encodeURIComponent(orgId)}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`pull_catalog_failed: HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    products: Parameters<ListoPOSLocalDb["products"]["bulkPut"]>[0];
    inventoryStocks: Parameters<ListoPOSLocalDb["inventoryStocks"]["bulkPut"]>[0];
    contacts: Parameters<ListoPOSLocalDb["contacts"]["bulkPut"]>[0];
    exchangeRates: Parameters<ListoPOSLocalDb["exchangeRates"]["bulkPut"]>[0];
    cashRegisters: Parameters<ListoPOSLocalDb["cashRegisters"]["bulkPut"]>[0];
    productRecipes: Parameters<ListoPOSLocalDb["productRecipes"]["bulkPut"]>[0];
    nextNumber?: string;
  };
  await tx(db, async () => {
    if (Array.isArray(data.products)) await db.products.bulkPut(data.products);
    if (Array.isArray(data.inventoryStocks))
      await db.inventoryStocks.bulkPut(data.inventoryStocks);
    if (Array.isArray(data.contacts)) await db.contacts.bulkPut(data.contacts);
    if (Array.isArray(data.exchangeRates))
      await db.exchangeRates.bulkPut(data.exchangeRates);
    if (Array.isArray(data.cashRegisters))
      await db.cashRegisters.bulkPut(data.cashRegisters);
    if (Array.isArray(data.productRecipes))
      await db.productRecipes.bulkPut(data.productRecipes);
    if (data.nextNumber) {
      // Conserva el máximo entre la secuencia local y la del servidor.
      const key = `org:${orgId}:nextNumber`;
      const existing = await db.meta.get(key);
      const max = Math.max(
        Number(existing?.value ?? 0),
        Number(data.nextNumber),
      );
      await db.meta.put({ key, value: String(max).padStart(8, "0") });
    }
  });
}

export interface SyncStatus {
  online: boolean;
  pending: number;
  lastError?: string;
}

export type SyncStatusListener = (status: SyncStatus) => void;

/**
 * Motor que vive en el navegador: escucha online/offline y sincroniza en
 * segundo plano. Usable desde el POS y cualquier página del panel.
 */
export class SyncEngine {
  private listeners = new Set<SyncStatusListener>();
  private lastStatus: SyncStatus;
  private running = false;

  constructor(
    private db: ListoPOSLocalDb,
    private orgId: string,
  ) {
    this.lastStatus = { online: this.isOnline(), pending: 0 };
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => void this.sync());
      window.addEventListener("offline", () => {
        this.lastStatus = { ...this.lastStatus, online: false };
        this.emit();
      });
    }
  }

  private isOnline(): boolean {
    return typeof navigator === "undefined" ? true : navigator.onLine;
  }

  async pendingCount(): Promise<number> {
    return this.db.syncQueue.where("organizationId").equals(this.orgId).count();
  }

  private async emit() {
    this.lastStatus.pending = await this.pendingCount();
    for (const l of this.listeners) l({ ...this.lastStatus });
  }

  subscribe(listener: SyncStatusListener): () => void {
    this.listeners.add(listener);
    void this.emit();
    return () => this.listeners.delete(listener);
  }

  async sync(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.pull();
      await this.push();
      this.lastStatus = {
        online: this.isOnline(),
        pending: await this.pendingCount(),
      };
    } catch (err) {
      this.lastStatus = {
        online: this.isOnline(),
        pending: await this.pendingCount(),
        lastError: err instanceof Error ? err.message : "sync_error",
      };
    } finally {
      this.running = false;
      this.emit();
    }
  }

  pull(): Promise<void> {
    return pullCatalog(this.db, this.orgId);
  }

  push(): Promise<PushStats> {
    return pushPending(this.db, this.orgId);
  }
}

/** Instancia compartida para una organización (singleton por org). */
const engines = new Map<string, SyncEngine>();

export function engineFor(orgId: string): SyncEngine {
  let engine = engines.get(orgId);
  if (!engine) {
    engine = new SyncEngine(localDb, orgId);
    engines.set(orgId, engine);
  }
  return engine;
}
