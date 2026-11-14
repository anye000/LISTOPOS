/**
 * Lógica de sincronización en el SERVIDOR (Fase 2 — Outbox pattern).
 *
 * Recibe entradas de la cola offline (db-local) y las aplica a PostgreSQL de
 * forma IDEMPOTENTE por UUID:
 *  - La factura se recalcula SIEMPRE en el servidor con el motor fiscal
 *    (nunca se confía en los totales del cliente), usando el
 *    `exchangeRateSnapshot` capturado al momento de la venta (inmutabilidad).
 *  - El descuento de stock solo ocurre cuando la factura se inserta por
 *    primera vez (rowCount del onConflictDoNothing).
 */
import { createHash } from "node:crypto";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";

import { d, money } from "@/core/currency/calculator";
import type { AnyListoPOSDb } from "@/core/db-cloud/db-types";
import * as s from "@/core/db-cloud/schema";
import { pgErrorCode } from "@/lib/errors";
import {
  calcIgtf,
  calcInvoiceTotals,
  paymentsCoverage,
  type PaymentLike,
} from "@/modules/fiscal/taxes";
import {
  invoiceSyncPayloadSchema,
  syncEnvelopeSchema,
} from "@/modules/fiscal/validators";

export interface PushEnvelope {
  id: string;
  organizationId: string;
  entity: string;
  operation: "create" | "update";
  payload: unknown;
}

export interface PushResult {
  ok: boolean;
  duplicate?: boolean;
  error?: string;
}

/** UUID determinista (mismos 32 hex → mismo UUID) para movimientos idempotentes. */
export function uuidFromHash(input: string): string {
  const hex = createHash("sha256").update(input).digest("hex").slice(0, 32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/* ------------------------------------------------------------------ */
/* Push                                                               */
/* ------------------------------------------------------------------ */

export async function pushEntry(
  db: AnyListoPOSDb,
  orgId: string,
  envelope: PushEnvelope,
): Promise<PushResult> {
  const env = syncEnvelopeSchema.safeParse(envelope);
  if (!env.success) return { ok: false, error: "invalid_envelope" };
  if (envelope.organizationId !== orgId) {
    return { ok: false, error: "tenant_mismatch" };
  }

  switch (envelope.entity) {
    case "invoice":
      return pushInvoice(db, orgId, envelope);
    case "contact":
      return pushContact(db, orgId, envelope);
    case "product":
      return pushProduct(db, orgId, envelope);
    case "stock":
      return pushStock(db, orgId, envelope);
    case "cashMovement":
      return pushCashMovement(db, orgId, envelope);
    default:
      return { ok: false, error: "unsupported_entity" };
  }
}

async function pushInvoice(
  db: AnyListoPOSDb,
  orgId: string,
  envelope: PushEnvelope,
): Promise<PushResult> {
  const parsed = invoiceSyncPayloadSchema.safeParse(envelope.payload);
  if (!parsed.success) {
    return { ok: false, error: `invalid_payload: ${parsed.error.issues[0]?.message ?? "desconocido"}` };
  }
  const inv = parsed.data;
  const snap = inv.exchangeRateSnapshot;

  // Recalcula todo en el servidor con el motor fiscal (decimal.js).
  const totals = calcInvoiceTotals(
    inv.items.map((it) => ({
      quantity: it.quantity,
      unitPriceUsd: it.unitPriceUsd,
      exemptVat: it.exemptVat,
    })),
    {
      usdToVes: snap.usdToVes,
      eurToVes: snap.eurToVes,
      discountUsd: inv.discountUsd,
    },
  );
  const payments: PaymentLike[] = inv.payments.map((p) => ({
    currency: p.currency,
    amount: p.amount,
  }));
  const igtf = calcIgtf(payments, {
    igtfRatePercent: snap.igtfRate,
    usdToVes: snap.usdToVes,
    eurToVes: snap.eurToVes,
  });

  const grandUsd = money(totals.totalUsd).plus(money(igtf.igtfUsd));
  const grandVes = money(totals.totalVes).plus(money(igtf.igtfVes));

  const isQuote = inv.type === "quote";
  const coverage = paymentsCoverage(payments, grandUsd.toString(), {
    usdToVes: snap.usdToVes,
    eurToVes: snap.eurToVes,
  });
  let status: typeof s.invoiceStatus.enumValues[number];
  if (isQuote) status = "issued";
  else if (payments.length === 0) status = "issued";
  else status = coverage.covered ? "paid" : "credit";

  const warehouseId = inv.warehouseId ?? null;

  // Inserta con numeración auto-incremental: si otro dispositivo ya usó el
  // número offline, se asigna el siguiente libre (idempotente por UUID).
  let number = inv.number ?? null;
  let inserted: { id: string }[] = [];
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      inserted = await db
        .insert(s.invoices)
        .values({
          id: envelope.id,
          organizationId: orgId,
          warehouseId,
          cashRegisterId: inv.cashRegisterId ?? null,
          contactId: inv.contactId ?? null,
          sourceInvoiceId: inv.sourceInvoiceId ?? null,
          type: inv.type,
          status,
          number,
          date: inv.date ? new Date(inv.date) : new Date(),
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
          notes: inv.notes ?? null,
        })
        .onConflictDoNothing({ target: s.invoices.id })
        .returning();
      break;
    } catch (err) {
      if (pgErrorCode(err) === "23505" && number) {
        const n = parseInt(number, 10);
        number = String(isNaN(n) ? 1 : n + 1).padStart(8, "0");
        continue;
      }
      throw err;
    }
  }

  if (inserted.length === 0) {
    return { ok: true, duplicate: true }; // retry idempotente
  }

  // Presupuesto → factura: marca el presupuesto origen como convertido.
  if (inv.sourceInvoiceId) {
    await db
      .update(s.invoices)
      .set({ status: "converted", updatedAt: new Date() })
      .where(
        and(
          eq(s.invoices.id, inv.sourceInvoiceId),
          eq(s.invoices.organizationId, orgId),
        ),
      );
  }

  // Fidelización: 1 punto por USD vendido a clientes registrados
  // (los presupuestos no acumulan; el retry idempotente no duplica).
  if (!isQuote && inv.contactId) {
    const earned = Math.floor(Number(grandUsd));
    if (earned > 0) {
      await db
        .update(s.contacts)
        .set({
          points: sql`${s.contacts.points} + ${earned}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(s.contacts.id, inv.contactId),
            eq(s.contacts.organizationId, orgId),
          ),
        );
    }
  }

  await db.insert(s.invoiceItems).values(
    totals.lines.map((line, i) => ({
      invoiceId: envelope.id,
      organizationId: orgId,
      productId: inv.items[i]?.productId ?? null,
      name: inv.items[i]!.name,
      quantity: line.quantity,
      unit: inv.items[i]!.unit,
      unitPriceUsd: line.unitPriceUsd,
      exemptVat: line.exemptVat,
      totalUsd: line.totalUsd,
      totalVes: line.totalVes,
    })),
  );

  if (payments.length > 0) {
    await db.insert(s.payments).values(
      inv.payments.map((p) => ({
        invoiceId: envelope.id,
        organizationId: orgId,
        method: p.method,
        currency: p.currency,
        amount: p.amount,
        reference: p.reference ?? null,
        bankAccountId: p.bankAccountId ?? null,
      })),
    );
    // Movimientos bancarios por pagos con cuenta asociada (idempotentes).
    for (const p of inv.payments) {
      if (p.bankAccountId) {
        await db
          .insert(s.bankMovements)
          .values({
            id: uuidFromHash(`bank:${envelope.id}:${p.method}:${p.amount}`),
            organizationId: orgId,
            bankAccountId: p.bankAccountId,
            direction: "in",
            currency: p.currency,
            amount: p.amount,
            description: inv.number ? `Pago factura ${inv.number}` : "Pago factura",
          })
          .onConflictDoNothing({ target: s.bankMovements.id });
      }
    }
  }

  // Descuento de stock + movimiento de kardex (solo facturas/notas de entrega).
  if (!isQuote) {
    const mainWarehouse = warehouseId
      ? null
      : (
          await db
            .select()
            .from(s.warehouses)
            .where(
              and(
                eq(s.warehouses.organizationId, orgId),
                eq(s.warehouses.isMain, true),
              ),
            )
            .limit(1)
        )[0];
    const targetWarehouse = warehouseId ?? mainWarehouse?.id;

    if (targetWarehouse) {
      for (let i = 0; i < inv.items.length; i++) {
        const it = inv.items[i]!;
        if (!it.productId) continue;

        const [product] = await db
          .select({ isComposite: s.products.isComposite })
          .from(s.products)
          .where(
            and(
              eq(s.products.id, it.productId),
              eq(s.products.organizationId, orgId),
            ),
          )
          .limit(1);

        if (product?.isComposite) {
          // Producto compuesto: descuenta los INSUMOS de la receta.
          const recipe = await db
            .select()
            .from(s.productRecipes)
            .where(
              and(
                eq(s.productRecipes.organizationId, orgId),
                eq(s.productRecipes.productId, it.productId),
              ),
            );
          for (const comp of recipe) {
            const used = d(comp.quantity).mul(d(it.quantity));
            await db
              .update(s.inventoryStocks)
              .set({
                quantity: sql`${s.inventoryStocks.quantity} - ${used.toFixed(4)}`,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(s.inventoryStocks.organizationId, orgId),
                  eq(s.inventoryStocks.productId, comp.componentId),
                  eq(s.inventoryStocks.warehouseId, targetWarehouse),
                ),
              );
            await db
              .insert(s.inventoryMovements)
              .values({
                id: uuidFromHash(`${envelope.id}:${i}:${comp.componentId}:recipe`),
                organizationId: orgId,
                productId: comp.componentId,
                warehouseId: targetWarehouse,
                type: "recipe_out",
                quantity: used.neg().toFixed(4),
                referenceId: envelope.id,
                note: inv.number ? `Insumo venta ${inv.number}` : "Insumo venta",
              })
              .onConflictDoNothing({ target: s.inventoryMovements.id });
          }
        } else {
          await db
            .update(s.inventoryStocks)
            .set({
              quantity: sql`${s.inventoryStocks.quantity} - ${it.quantity}`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(s.inventoryStocks.organizationId, orgId),
                eq(s.inventoryStocks.productId, it.productId),
                eq(s.inventoryStocks.warehouseId, targetWarehouse),
              ),
            );
          await db
            .insert(s.inventoryMovements)
            .values({
              id: uuidFromHash(`${envelope.id}:${i}:sale`),
              organizationId: orgId,
              productId: it.productId,
              warehouseId: targetWarehouse,
              type: "sale",
              quantity: `-${it.quantity}`,
              referenceId: envelope.id,
              note: inv.number ? `Venta ${inv.number}` : "Venta",
            })
            .onConflictDoNothing({ target: s.inventoryMovements.id });
        }
      }
    }
  }

  return { ok: true, duplicate: false };
}

async function pushContact(
  db: AnyListoPOSDb,
  orgId: string,
  envelope: PushEnvelope,
): Promise<PushResult> {
  const p = envelope.payload as Record<string, unknown>;
  const inserted = await db
    .insert(s.contacts)
    .values({
      id: envelope.id,
      organizationId: orgId,
      type: (p.type as "customer" | "supplier") ?? "customer",
      name: String(p.name ?? ""),
      document: (p.document as string) ?? null,
      phone: (p.phone as string) ?? null,
      email: (p.email as string) ?? null,
      creditLimitUsd: String(p.creditLimitUsd ?? "0"),
    })
    .onConflictDoNothing({ target: s.contacts.id })
    .returning();
  return inserted.length === 0
    ? { ok: true, duplicate: true }
    : { ok: true, duplicate: false };
}

async function pushProduct(
  db: AnyListoPOSDb,
  orgId: string,
  envelope: PushEnvelope,
): Promise<PushResult> {
  const p = envelope.payload as Record<string, unknown>;
  const inserted = await db
    .insert(s.products)
    .values({
      id: envelope.id,
      organizationId: orgId,
      name: String(p.name ?? ""),
      sku: (p.sku as string) ?? null,
      barcode: (p.barcode as string) ?? null,
      category: (p.category as string) ?? null,
      unit: String(p.unit ?? "und"),
      costUsd: String(p.costUsd ?? "0"),
      marginPercent: String(p.marginPercent ?? "0"),
      priceRetailUsd: String(p.priceRetailUsd ?? "0"),
      priceWholesaleUsd:
        p.priceWholesaleUsd !== undefined
          ? String(p.priceWholesaleUsd)
          : null,
      exemptVat: Boolean(p.exemptVat),
      minStock: String(p.minStock ?? "0"),
      isComposite: Boolean(p.isComposite),
    })
    .onConflictDoNothing({ target: s.products.id })
    .returning();
  return inserted.length === 0
    ? { ok: true, duplicate: true }
    : { ok: true, duplicate: false };
}

async function pushStock(
  db: AnyListoPOSDb,
  orgId: string,
  envelope: PushEnvelope,
): Promise<PushResult> {
  const p = envelope.payload as Record<string, unknown>;
  await db
    .insert(s.inventoryStocks)
    .values({
      id: envelope.id,
      organizationId: orgId,
      productId: String(p.productId ?? ""),
      warehouseId: String(p.warehouseId ?? ""),
      quantity: String(p.quantity ?? "0"),
      avgCostUsd: String(p.avgCostUsd ?? "0"),
    })
    .onConflictDoUpdate({
      target: [s.inventoryStocks.productId, s.inventoryStocks.warehouseId],
      set: {
        quantity: String(p.quantity ?? "0"),
        avgCostUsd: String(p.avgCostUsd ?? "0"),
        updatedAt: new Date(),
      },
    });
  return { ok: true, duplicate: false };
}

async function pushCashMovement(
  db: AnyListoPOSDb,
  orgId: string,
  envelope: PushEnvelope,
): Promise<PushResult> {
  const p = envelope.payload as Record<string, unknown>;
  const inserted = await db
    .insert(s.cashMovements)
    .values({
      id: envelope.id,
      organizationId: orgId,
      cashRegisterId: String(p.cashRegisterId ?? ""),
      type: String(p.type ?? "income"),
      method: (p.method as typeof s.paymentMethod.enumValues[number]) ?? "cash_ves",
      currency: String(p.currency ?? "ves"),
      amount: String(p.amount ?? "0"),
      reason: (p.reason as string) ?? null,
    })
    .onConflictDoNothing({ target: s.cashMovements.id })
    .returning();
  return inserted.length === 0
    ? { ok: true, duplicate: true }
    : { ok: true, duplicate: false };
}

/* ------------------------------------------------------------------ */
/* Pull                                                               */
/* ------------------------------------------------------------------ */

export interface PullPayload {
  products: (typeof s.products.$inferSelect)[];
  inventoryStocks: (typeof s.inventoryStocks.$inferSelect)[];
  contacts: (typeof s.contacts.$inferSelect)[];
  exchangeRates: (typeof s.exchangeRates.$inferSelect)[];
  cashRegisters: (typeof s.cashRegisters.$inferSelect)[];
  productRecipes: (typeof s.productRecipes.$inferSelect)[];
  nextNumber: string;
}

/** Catálogo completo de la organización para la caché offline (Dexie). */
export async function pullPayload(
  db: AnyListoPOSDb,
  orgId: string,
): Promise<PullPayload> {
  const [
    products,
    inventoryStocks,
    contacts,
    exchangeRates,
    cashRegisters,
    productRecipes,
    maxNumber,
  ] = await Promise.all([
    db
      .select()
      .from(s.products)
      .where(
        and(eq(s.products.organizationId, orgId), eq(s.products.active, true)),
      ),
    db
      .select()
      .from(s.inventoryStocks)
      .where(eq(s.inventoryStocks.organizationId, orgId)),
    db
      .select()
      .from(s.contacts)
      .where(eq(s.contacts.organizationId, orgId)),
    db
      .select()
      .from(s.exchangeRates)
      .where(eq(s.exchangeRates.organizationId, orgId)),
    db
      .select()
      .from(s.cashRegisters)
      .where(
        and(
          eq(s.cashRegisters.organizationId, orgId),
          eq(s.cashRegisters.status, "open"),
        ),
      ),
    db
      .select()
      .from(s.productRecipes)
      .where(eq(s.productRecipes.organizationId, orgId)),
    db
      .select({ number: s.invoices.number })
      .from(s.invoices)
      .where(
        and(
          eq(s.invoices.organizationId, orgId),
          isNotNull(s.invoices.number),
        ),
      )
      .orderBy(desc(s.invoices.number))
      .limit(1),
  ]);

  return {
    products,
    inventoryStocks,
    contacts,
    exchangeRates,
    cashRegisters,
    productRecipes,
    nextNumber: maxNumber[0]?.number ?? "00000000",
  };
}
