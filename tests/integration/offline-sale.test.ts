/**
 * Integración local — flujo de venta OFFLINE completo (Offline-First).
 *
 * Simula el POS sin internet: escribe la factura en Dexie, descuenta el stock
 * local y encola la operación en `syncQueue`; luego el motor de sincronización
 * la sube a la nube de forma idempotente.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createLocalDb,
  type ListoPOSLocalDb,
  type LocalProduct,
} from "@/core/db-local/dexie";
import { enqueue, pullCatalog, pushPending } from "@/core/sync/engine";

const openDbs: ListoPOSLocalDb[] = [];

async function freshDb(): Promise<ListoPOSLocalDb> {
  const db = createLocalDb(`listopos-integration-${crypto.randomUUID()}`);
  openDbs.push(db);
  return db;
}

afterEach(async () => {
  for (const db of openDbs.splice(0)) {
    db.close();
    await db.delete();
  }
});

const orgId = crypto.randomUUID();
const warehouseId = crypto.randomUUID();
const productId = crypto.randomUUID();

const product: LocalProduct = {
  id: productId,
  organizationId: orgId,
  barcode: "7591000001",
  name: "Café con leche",
  unit: "und",
  costUsd: "1.20",
  marginPercent: "60",
  priceRetailUsd: "2.00",
  exemptVat: 0,
  minStock: "5",
  isComposite: 0,
  active: 1,
  updatedAt: new Date().toISOString(),
};

describe("Integración local — venta offline (Outbox pattern)", () => {
  it("guarda la venta en Dexie, descuenta stock local y encola en syncQueue", async () => {
    const db = await freshDb();
    await db.products.add(product);
    await db.inventoryStocks.add({
      id: crypto.randomUUID(),
      organizationId: orgId,
      productId,
      warehouseId,
      quantity: "10.0000",
      avgCostUsd: "1.2000",
      updatedAt: new Date().toISOString(),
    });

    const invoiceId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const payload = {
      id: invoiceId,
      number: "00000002",
      type: "invoice" as const,
      warehouseId,
      items: [
        {
          productId,
          name: "Café con leche",
          quantity: "2",
          unitPriceUsd: "2.00",
          exemptVat: false,
        },
      ],
      payments: [{ method: "cash_usd" as const, currency: "usd" as const, amount: "4.78" }],
      discountUsd: "0",
      exchangeRateSnapshot: {
        usdToVes: "36.5",
        eurToVes: "40.15",
        igtfRate: "3",
        capturedAt: createdAt,
      },
    };

    // Transacción atómica del POS: factura + stock + cola (todo o nada).
    await db.transaction(
      "rw",
      db.invoices,
      db.inventoryStocks,
      db.syncQueue,
      async () => {
        await db.invoices.add({
          id: invoiceId,
          organizationId: orgId,
          warehouseId,
          type: "invoice",
          status: "issued",
          number: "00000002",
          date: createdAt,
          subtotalUsd: "4.00",
          discountUsd: "0.00",
          vatUsd: "0.64",
          igtfUsd: "0.14",
          totalUsd: "4.78",
          subtotalVes: "146.00",
          discountVes: "0.00",
          vatVes: "23.36",
          igtfVes: "5.11",
          totalVes: "174.47",
          exchangeRateSnapshot: payload.exchangeRateSnapshot,
          items: [
            {
              productId,
              name: "Café con leche",
              quantity: "2",
              unit: "und",
              unitPriceUsd: "2.00",
              exemptVat: 0,
              totalUsd: "4.00",
              totalVes: "146.00",
            },
          ],
          payments: payload.payments,
          synced: 0,
          createdAt,
        });
        await db.inventoryStocks
          .where("[productId+warehouseId]")
          .equals([productId, warehouseId])
          .modify((st) => {
            st.quantity = (Number(st.quantity) - 2).toFixed(4);
          });
        await enqueue(db, {
          id: invoiceId,
          organizationId: orgId,
          entity: "invoice",
          operation: "create",
          payload,
        });
      },
    );

    // La venta quedó guardada localmente, sin internet.
    const local = await db.invoices.get(invoiceId);
    expect(local?.synced).toBe(0);
    const stock = await db.inventoryStocks
      .where("[productId+warehouseId]")
      .equals([productId, warehouseId])
      .first();
    expect(stock?.quantity).toBe("8.0000");
    expect(await db.syncQueue.count()).toBe(1);

    // enqueue es idempotente: no duplica la entrada.
    await enqueue(db, {
      id: invoiceId,
      organizationId: orgId,
      entity: "invoice",
      operation: "create",
      payload,
    });
    expect(await db.syncQueue.count()).toBe(1);
  });

  it("sube la cola a la nube y elimina entradas confirmadas", async () => {
    const db = await freshDb();
    await enqueue(db, {
      id: crypto.randomUUID(),
      organizationId: orgId,
      entity: "invoice",
      operation: "create",
      payload: { test: true },
    });

    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const stats = await pushPending(db, orgId, fetcher as unknown as typeof fetch);
    expect(stats).toEqual({ pushed: 1, failed: 0, remaining: 0 });
    expect(await db.syncQueue.count()).toBe(0);
  });

  it("mantiene la entrada y cuenta reintentos cuando el servidor falla", async () => {
    const db = await freshDb();
    await enqueue(db, {
      id: crypto.randomUUID(),
      organizationId: orgId,
      entity: "invoice",
      operation: "create",
      payload: { test: true },
    });

    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ error: "server_down" }), { status: 500 }),
    );

    const stats = await pushPending(db, orgId, fetcher as unknown as typeof fetch);
    expect(stats).toEqual({ pushed: 0, failed: 1, remaining: 1 });

    const entries = await db.syncQueue.toArray();
    expect(entries).toHaveLength(1);
    expect(entries[0].attempts).toBe(1);
    expect(entries[0].lastError).toBe("HTTP 500");
  });

  it("descarga el catálogo a IndexedDB (pull)", async () => {
    const db = await freshDb();
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          products: [product],
          inventoryStocks: [],
          contacts: [],
          exchangeRates: [],
          cashRegisters: [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await pullCatalog(db, orgId, fetcher as unknown as typeof fetch);
    const cached = await db.products.get(productId);
    expect(cached?.name).toBe("Café con leche");
    expect(cached?.priceRetailUsd).toBe("2.00");
  });
});
