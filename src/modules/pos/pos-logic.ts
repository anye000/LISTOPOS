/**
 * Lógica del Punto de Venta OFFLINE (Fase 4).
 *
 * La venta se escribe PRIMERO en Dexie (db-local) dentro de una transacción
 * atómica: factura + descuento de stock (con recetas) + cola Outbox. El motor
 * de sincronización la sube luego a PostgreSQL de forma idempotente.
 *
 * Todos los cálculos usan decimal.js (prohibido `number`).
 */
import Dexie from "dexie";
import Decimal from "decimal.js";

import { d, money } from "@/core/currency/calculator";
import type {
  ListoPOSLocalDb,
  LocalInvoice,
  LocalPayment,
} from "@/core/db-local/dexie";
import { enqueue } from "@/core/sync/engine";
import {
  calcIgtf,
  calcInvoiceTotals,
  paymentsCoverage,
} from "@/modules/fiscal/taxes";

export interface CartLineInput {
  productId: string;
  name: string;
  quantity: string;
  unit: string;
  unitPriceUsd: string;
  exemptVat: boolean;
  isComposite?: boolean;
}

export interface SaleDraft {
  type: "invoice" | "delivery_note" | "quote";
  organizationId: string;
  warehouseId?: string;
  cashRegisterId?: string;
  contactId?: string;
  contactName?: string;
  sourceInvoiceId?: string;
  items: CartLineInput[];
  payments: LocalPayment[];
  discountUsd: string;
  notes?: string;
  igtfRatePercent: string;
}

export interface RatesSnapshot {
  usdToVes: string;
  eurToVes: string;
  igtfRate: string;
  capturedAt: string;
}

/** Tasa activa desde la caché offline (la más reciente por fecha). */
export async function getRatesSnapshot(
  db: ListoPOSLocalDb,
  orgId: string,
  igtfRatePercent: string,
): Promise<RatesSnapshot> {
  const usd = await db.exchangeRates
    .where("[organizationId+currency+date]")
    .between([orgId, "usd", Dexie.minKey], [orgId, "usd", Dexie.maxKey])
    .last();
  if (!usd) {
    throw new Error("No hay tasa USD configurada para operar offline");
  }
  const eur = await db.exchangeRates
    .where("[organizationId+currency+date]")
    .between([orgId, "eur", Dexie.minKey], [orgId, "eur", Dexie.maxKey])
    .last();
  return {
    usdToVes: usd.rateToVes,
    eurToVes: eur?.rateToVes ?? usd.rateToVes,
    igtfRate: igtfRatePercent,
    capturedAt: new Date().toISOString(),
  };
}

/** Siguiente número de factura local (secuencia por organización). */
export async function nextInvoiceNumber(
  db: ListoPOSLocalDb,
  orgId: string,
): Promise<string> {
  const key = `org:${orgId}:nextNumber`;
  const meta = await db.meta.get(key);
  const next = String(Number(meta?.value ?? "0") + 1).padStart(8, "0");
  await db.meta.put({ key, value: next });
  return next;
}

export interface SaleResult {
  invoiceId: string;
  invoice: LocalInvoice;
}

/**
 * Emite la venta en local (Offline-First) y la encola para sincronizar.
 * Presupuestos: no descuentan stock, no llevan número ni pagos.
 */
export async function issueLocalSale(
  db: ListoPOSLocalDb,
  draft: SaleDraft,
): Promise<SaleResult> {
  const snap = await getRatesSnapshot(db, draft.organizationId, draft.igtfRatePercent);
  const totals = calcInvoiceTotals(
    draft.items.map((i) => ({
      quantity: i.quantity,
      unitPriceUsd: i.unitPriceUsd,
      exemptVat: i.exemptVat,
    })),
    {
      usdToVes: snap.usdToVes,
      eurToVes: snap.eurToVes,
      discountUsd: draft.discountUsd,
    },
  );
  const igtf = calcIgtf(draft.payments, {
    igtfRatePercent: snap.igtfRate,
    usdToVes: snap.usdToVes,
    eurToVes: snap.eurToVes,
  });
  const grandUsd = money(totals.totalUsd).plus(money(igtf.igtfUsd));
  const grandVes = money(totals.totalVes).plus(money(igtf.igtfVes));
  const isQuote = draft.type === "quote";

  const coverage = paymentsCoverage(draft.payments, grandUsd.toString(), {
    usdToVes: snap.usdToVes,
    eurToVes: snap.eurToVes,
  });
  const status = isQuote
    ? "issued"
    : draft.payments.length === 0
      ? "issued"
      : coverage.covered
        ? "paid"
        : "credit";

  const invoiceId = crypto.randomUUID();
  const date = new Date().toISOString();

  let number: string | undefined;

  await db.transaction(
    "rw",
    db.invoices,
    db.inventoryStocks,
    db.productRecipes,
    db.meta,
    db.syncQueue,
    async () => {
      if (!isQuote) {
        number = await nextInvoiceNumber(db, draft.organizationId);
      }

      await db.invoices.add({
        id: invoiceId,
        organizationId: draft.organizationId,
        warehouseId: draft.warehouseId,
        cashRegisterId: draft.cashRegisterId,
        contactId: draft.contactId,
        contactName: draft.contactName,
        sourceInvoiceId: draft.sourceInvoiceId,
        type: draft.type,
        status,
        number,
        date,
        subtotalUsd: totals.subtotalUsd,
        discountUsd: totals.discountUsd,
        vatUsd: totals.vatUsd,
        igtfUsd: igtf.igtfUsd,
        totalUsd: grandUsd.toFixed(2),
        subtotalVes: totals.subtotalVes,
        discountVes: totals.discountVes,
        vatVes: totals.vatVes,
        igtfVes: igtf.igtfVes,
        totalVes: grandVes.toFixed(2),
        exchangeRateSnapshot: snap,
        items: totals.lines.map((line, i) => ({
          productId: draft.items[i]!.productId,
          name: draft.items[i]!.name,
          quantity: line.quantity,
          unit: draft.items[i]!.unit,
          unitPriceUsd: line.unitPriceUsd,
          exemptVat: line.exemptVat ? 1 : 0,
          totalUsd: line.totalUsd,
          totalVes: line.totalVes,
        })),
        payments: isQuote ? [] : draft.payments,
        notes: draft.notes,
        synced: 0,
        createdAt: date,
      });

      // Descuento de stock local (recetas: insumos en vez del compuesto).
      if (!isQuote && draft.warehouseId) {
        for (const item of draft.items) {
          if (item.isComposite) {
            const recipe = await db.productRecipes
              .where("productId")
              .equals(item.productId)
              .toArray();
            for (const comp of recipe) {
              const used = d(comp.quantity).mul(d(item.quantity));
              await db.inventoryStocks
                .where("[productId+warehouseId]")
                .equals([comp.componentId, draft.warehouseId])
                .modify((st) => {
                  st.quantity = new Decimal(st.quantity).minus(used).toFixed(4);
                });
            }
          } else {
            await db.inventoryStocks
              .where("[productId+warehouseId]")
              .equals([item.productId, draft.warehouseId])
              .modify((st) => {
                st.quantity = new Decimal(st.quantity)
                  .minus(d(item.quantity))
                  .toFixed(4);
              });
          }
        }
      }

      await enqueue(db, {
        id: invoiceId,
        organizationId: draft.organizationId,
        entity: "invoice",
        operation: "create",
        payload: {
          id: invoiceId,
          number,
          type: draft.type,
          warehouseId: draft.warehouseId,
          cashRegisterId: draft.cashRegisterId,
          contactId: draft.contactId,
          sourceInvoiceId: draft.sourceInvoiceId,
          items: draft.items.map((i) => ({
            productId: i.productId,
            name: i.name,
            quantity: i.quantity,
            unit: i.unit,
            unitPriceUsd: i.unitPriceUsd,
            exemptVat: i.exemptVat,
          })),
          payments: isQuote ? [] : draft.payments,
          discountUsd: draft.discountUsd,
          notes: draft.notes,
          exchangeRateSnapshot: snap,
          date,
        },
      });
    },
  );

  const stored = await db.invoices.get(invoiceId);
  if (!stored) throw new Error("No se pudo guardar la venta local");

  return { invoiceId, invoice: stored };
}

/** Totales en vivo del carrito (para la interfaz del POS). */
export function liveTotals(
  items: CartLineInput[],
  rates: { usdToVes: string; eurToVes: string },
  discountUsd = "0",
) {
  if (items.length === 0) {
    return {
      lines: [],
      subtotalUsd: "0.00",
      discountUsd: "0.00",
      vatUsd: "0.00",
      totalUsd: "0.00",
      subtotalVes: "0.00",
      vatVes: "0.00",
      totalVes: "0.00",
    };
  }
  return calcInvoiceTotals(
    items.map((i) => ({
      quantity: i.quantity,
      unitPriceUsd: i.unitPriceUsd,
      exemptVat: i.exemptVat,
    })),
    { ...rates, discountUsd },
  );
}
