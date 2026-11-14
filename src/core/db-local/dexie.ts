/**
 * Base de datos local (IndexedDB) con Dexie.js.
 *
 * Regla Offline-First (ARCHITECTURE.md §4.3): el POS escribe primero aquí y
 * encola la operación en `syncQueue` (Outbox pattern) para subirla a la nube
 * cuando haya conexión. Todos los montos se guardan como STRING de
 * decimal.js para precisión exacta.
 */
import Dexie, { type EntityTable } from "dexie";

/* ------------------------------------------------------------------ */
/* Entidades locales (réplica del esquema cloud, strings para dinero) */
/* ------------------------------------------------------------------ */

export interface LocalProduct {
  id: string;
  organizationId: string;
  sku?: string;
  barcode?: string;
  name: string;
  category?: string;
  unit: string;
  costUsd: string;
  marginPercent: string;
  priceRetailUsd: string;
  priceWholesaleUsd?: string;
  exemptVat: 0 | 1;
  minStock: string;
  isComposite: 0 | 1;
  active: 0 | 1;
  updatedAt: string;
}

export interface LocalStock {
  id: string;
  organizationId: string;
  productId: string;
  warehouseId: string;
  quantity: string;
  avgCostUsd: string;
  updatedAt: string;
}

export interface LocalContact {
  id: string;
  organizationId: string;
  type: "customer" | "supplier";
  name: string;
  document?: string;
  phone?: string;
  email?: string;
  address?: string;
  creditLimitUsd: string;
  points: number;
  updatedAt: string;
}

export interface LocalExchangeRate {
  id: string;
  organizationId: string;
  currency: "usd" | "eur";
  rateToVes: string;
  date: string; // YYYY-MM-DD
  source: string;
}

export interface LocalCashRegister {
  id: string;
  organizationId: string;
  warehouseId?: string;
  openedByUserId?: string;
  openedAt: string;
  closedAt?: string;
  openingBalanceUsd: string;
  openingBalanceVes: string;
  status: "open" | "closed";
}

export interface LocalInvoiceItem {
  productId?: string;
  name: string;
  quantity: string;
  unit: string;
  unitPriceUsd: string;
  exemptVat: 0 | 1;
  totalUsd: string;
  totalVes: string;
}

export interface LocalPayment {
  method: string;
  currency: "usd" | "ves" | "eur";
  amount: string;
  reference?: string;
}

export interface LocalInvoice {
  id: string;
  organizationId: string;
  warehouseId?: string;
  cashRegisterId?: string;
  contactId?: string;
  contactName?: string;
  sourceInvoiceId?: string;
  type: "invoice" | "delivery_note" | "quote";
  status: "draft" | "issued" | "paid" | "credit" | "converted" | "cancelled";
  number?: string;
  date: string;
  dueDate?: string;
  subtotalUsd: string;
  discountUsd: string;
  vatUsd: string;
  igtfUsd: string;
  totalUsd: string;
  subtotalVes: string;
  discountVes: string;
  vatVes: string;
  igtfVes: string;
  totalVes: string;
  exchangeRateSnapshot: {
    usdToVes: string;
    eurToVes: string;
    igtfRate: string;
    capturedAt: string;
  };
  items: LocalInvoiceItem[];
  payments: LocalPayment[];
  notes?: string;
  createdByUserId?: string;
  synced: 0 | 1;
  createdAt: string;
}

export interface LocalRecipe {
  id: string;
  organizationId: string;
  productId: string;
  componentId: string;
  quantity: string;
  unit: string;
}

export interface LocalMeta {
  key: string;
  value: string;
}

export type SyncEntity =
  | "invoice"
  | "payment"
  | "stock"
  | "cashMovement"
  | "contact"
  | "product"
  | "cashRegister";

export interface SyncQueueEntry {
  localId?: number;
  id: string; // UUID idempotente
  organizationId: string;
  entity: SyncEntity;
  operation: "create" | "update";
  payload: unknown;
  attempts: number;
  lastError?: string;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Base de datos                                                      */
/* ------------------------------------------------------------------ */

export class ListoPOSLocalDb extends Dexie {
  products!: EntityTable<LocalProduct, "id">;
  inventoryStocks!: EntityTable<LocalStock, "id">;
  contacts!: EntityTable<LocalContact, "id">;
  exchangeRates!: EntityTable<LocalExchangeRate, "id">;
  cashRegisters!: EntityTable<LocalCashRegister, "id">;
  invoices!: EntityTable<LocalInvoice, "id">;
  productRecipes!: EntityTable<LocalRecipe, "id">;
  meta!: EntityTable<LocalMeta, "key">;
  syncQueue!: EntityTable<SyncQueueEntry, "localId">;

  constructor(name = "listopos-local") {
    super(name);
    this.version(1).stores({
      products:
        "id, organizationId, barcode, name, updatedAt, [organizationId+barcode]",
      inventoryStocks:
        "id, organizationId, productId, warehouseId, [productId+warehouseId]",
      contacts: "id, organizationId, type, name",
      exchangeRates: "id, organizationId, currency, date, [organizationId+currency+date]",
      cashRegisters: "id, organizationId, status",
      invoices: "id, organizationId, status, synced, createdAt",
      syncQueue: "++localId, id, organizationId, createdAt",
    });
    this.version(2).stores({
      productRecipes: "id, organizationId, productId, [productId+componentId]",
      meta: "key",
    });
  }
}

/** Instancia compartida (singleton) para el navegador. */
export const localDb = new ListoPOSLocalDb();

/** Crea una instancia aislada (tests). */
export function createLocalDb(name: string): ListoPOSLocalDb {
  return new ListoPOSLocalDb(name);
}
