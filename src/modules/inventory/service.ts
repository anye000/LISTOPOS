/**
 * Módulo de Inventario — lógica de negocio en el servidor (Fase 3).
 *
 *  - Compras a proveedores con COSTO PROMEDIO PONDERADO exacto (decimal.js).
 *  - Traslados entre almacenes con validación de existencias.
 *  - Ajustes manuales (entrada/salida) y Kardex auditado por usuario.
 *  - Alertas de stock bajo.
 */
import { and, desc, eq } from "drizzle-orm";
import Decimal from "decimal.js";

import { d, money, quantity, sum } from "@/core/currency/calculator";
import type { AnyListoPOSDb } from "@/core/db-cloud/db-types";
import * as s from "@/core/db-cloud/schema";

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

async function getOrgWarehouse(
  db: AnyListoPOSDb,
  orgId: string,
  warehouseId: string,
): Promise<typeof s.warehouses.$inferSelect> {
  const [wh] = await db
    .select()
    .from(s.warehouses)
    .where(
      and(
        eq(s.warehouses.id, warehouseId),
        eq(s.warehouses.organizationId, orgId),
      ),
    )
    .limit(1);
  if (!wh) throw new Error("Almacén no encontrado en esta empresa");
  return wh;
}

async function getOrgProduct(
  db: AnyListoPOSDb,
  orgId: string,
  productId: string,
): Promise<typeof s.products.$inferSelect> {
  const [p] = await db
    .select()
    .from(s.products)
    .where(
      and(eq(s.products.id, productId), eq(s.products.organizationId, orgId)),
    )
    .limit(1);
  if (!p) throw new Error(`Producto no encontrado: ${productId}`);
  return p;
}

async function getStock(
  db: AnyListoPOSDb,
  productId: string,
  warehouseId: string,
): Promise<typeof s.inventoryStocks.$inferSelect | undefined> {
  const [stock] = await db
    .select()
    .from(s.inventoryStocks)
    .where(
      and(
        eq(s.inventoryStocks.productId, productId),
        eq(s.inventoryStocks.warehouseId, warehouseId),
      ),
    )
    .limit(1);
  return stock;
}

/* ------------------------------------------------------------------ */
/* Compras con costo promedio ponderado                               */
/* ------------------------------------------------------------------ */

export interface PurchaseLine {
  productId: string;
  quantity: Decimal.Value;
  unitCostUsd: Decimal.Value;
}

export interface PurchaseInput {
  warehouseId: string;
  supplierContactId?: string;
  invoiceNumber?: string;
  note?: string;
  userId?: string;
  lines: PurchaseLine[];
}

export async function registerPurchase(
  db: AnyListoPOSDb,
  orgId: string,
  input: PurchaseInput,
): Promise<{ ok: true; payableLedgerId?: string }> {
  if (input.lines.length === 0) {
    throw new Error("La compra debe tener al menos una línea");
  }
  await getOrgWarehouse(db, orgId, input.warehouseId);

  for (const line of input.lines) {
    await getOrgProduct(db, orgId, line.productId);
    const qty = quantity(line.quantity);
    const cost = d(line.unitCostUsd);
    if (qty.lte(0)) throw new Error("La cantidad comprada debe ser positiva");

    const stock = await getStock(db, line.productId, input.warehouseId);
    if (stock) {
      const oldQty = new Decimal(stock.quantity);
      const oldCost = new Decimal(stock.avgCostUsd);
      const newQty = oldQty.plus(qty);
      // Costo promedio ponderado: (q0*c0 + q1*c1) / (q0+q1)
      const newAvg = oldQty.eq(0)
        ? cost
        : oldQty.mul(oldCost).plus(qty.mul(cost)).div(newQty);
      await db
        .update(s.inventoryStocks)
        .set({
          quantity: newQty.toFixed(4),
          avgCostUsd: newAvg.toFixed(6),
          updatedAt: new Date(),
        })
        .where(eq(s.inventoryStocks.id, stock.id));
    } else {
      await db.insert(s.inventoryStocks).values({
        organizationId: orgId,
        productId: line.productId,
        warehouseId: input.warehouseId,
        quantity: qty.toFixed(4),
        avgCostUsd: cost.toFixed(6),
      });
    }

    await db.insert(s.inventoryMovements).values({
      id: crypto.randomUUID(),
      organizationId: orgId,
      productId: line.productId,
      warehouseId: input.warehouseId,
      type: "purchase",
      quantity: qty.toFixed(4),
      unitCostUsd: cost.toFixed(6),
      referenceId: input.invoiceNumber ?? null,
      note: input.note ?? null,
      createdByUserId: input.userId ?? null,
    });

    // Actualiza el costo de reposición del producto (última compra).
    await db
      .update(s.products)
      .set({ costUsd: cost.toFixed(4), updatedAt: new Date() })
      .where(eq(s.products.id, line.productId));
  }

  // Cuenta por pagar al proveedor (se cobra/abona en Fase 5 — Finanzas).
  let payableLedgerId: string | undefined;
  if (input.supplierContactId) {
    const totalUsd = money(
      sum(input.lines.map((l) => d(l.quantity).mul(d(l.unitCostUsd)))),
    );
    const [usdRate] = await db
      .select()
      .from(s.exchangeRates)
      .where(
        and(
          eq(s.exchangeRates.organizationId, orgId),
          eq(s.exchangeRates.currency, "usd"),
        ),
      )
      .orderBy(desc(s.exchangeRates.date))
      .limit(1);
    const totalVes = usdRate
      ? money(totalUsd.mul(usdRate.rateToVes))
      : new Decimal(0);

    const [entry] = await db
      .insert(s.accountsLedger)
      .values({
        organizationId: orgId,
        contactId: input.supplierContactId,
        type: "payable",
        amountUsd: totalUsd.toFixed(2),
        amountVes: totalVes.toFixed(2),
        status: "pending",
        notes: input.invoiceNumber ? `Compra ${input.invoiceNumber}` : "Compra",
      })
      .returning();
    payableLedgerId = entry.id;
  }

  return { ok: true, payableLedgerId };
}

/* ------------------------------------------------------------------ */
/* Traslados entre almacenes                                          */
/* ------------------------------------------------------------------ */

export interface TransferLine {
  productId: string;
  quantity: Decimal.Value;
}

export interface TransferInput {
  fromWarehouseId: string;
  toWarehouseId: string;
  note?: string;
  userId?: string;
  lines: TransferLine[];
}

export async function transferStock(
  db: AnyListoPOSDb,
  orgId: string,
  input: TransferInput,
): Promise<{ ok: true }> {
  if (input.fromWarehouseId === input.toWarehouseId) {
    throw new Error("El origen y el destino deben ser almacenes distintos");
  }
  if (input.lines.length === 0) {
    throw new Error("El traslado debe tener al menos una línea");
  }
  await getOrgWarehouse(db, orgId, input.fromWarehouseId);
  await getOrgWarehouse(db, orgId, input.toWarehouseId);

  const reference = crypto.randomUUID();

  for (const line of input.lines) {
    await getOrgProduct(db, orgId, line.productId);
    const qty = quantity(line.quantity);
    if (qty.lte(0)) throw new Error("La cantidad debe ser positiva");

    const source = await getStock(db, line.productId, input.fromWarehouseId);
    if (!source || new Decimal(source.quantity).lt(qty)) {
      throw new Error("Stock insuficiente en el almacén de origen");
    }

    // Salida del origen
    await db
      .update(s.inventoryStocks)
      .set({
        quantity: new Decimal(source.quantity).minus(qty).toFixed(4),
        updatedAt: new Date(),
      })
      .where(eq(s.inventoryStocks.id, source.id));
    await db.insert(s.inventoryMovements).values({
      id: crypto.randomUUID(),
      organizationId: orgId,
      productId: line.productId,
      warehouseId: input.fromWarehouseId,
      type: "transfer_out",
      quantity: qty.neg().toFixed(4),
      unitCostUsd: source.avgCostUsd,
      referenceId: reference,
      note: input.note ?? null,
      createdByUserId: input.userId ?? null,
    });

    // Entrada al destino (mantiene el costo promedio de origen)
    const target = await getStock(db, line.productId, input.toWarehouseId);
    if (target) {
      const oldQty = new Decimal(target.quantity);
      const newQty = oldQty.plus(qty);
      const newAvg = oldQty.eq(0)
        ? new Decimal(source.avgCostUsd)
        : oldQty
            .mul(target.avgCostUsd)
            .plus(qty.mul(source.avgCostUsd))
            .div(newQty);
      await db
        .update(s.inventoryStocks)
        .set({
          quantity: newQty.toFixed(4),
          avgCostUsd: newAvg.toFixed(6),
          updatedAt: new Date(),
        })
        .where(eq(s.inventoryStocks.id, target.id));
    } else {
      await db.insert(s.inventoryStocks).values({
        organizationId: orgId,
        productId: line.productId,
        warehouseId: input.toWarehouseId,
        quantity: qty.toFixed(4),
        avgCostUsd: source.avgCostUsd,
      });
    }
    await db.insert(s.inventoryMovements).values({
      id: crypto.randomUUID(),
      organizationId: orgId,
      productId: line.productId,
      warehouseId: input.toWarehouseId,
      type: "transfer_in",
      quantity: qty.toFixed(4),
      unitCostUsd: source.avgCostUsd,
      referenceId: reference,
      note: input.note ?? null,
      createdByUserId: input.userId ?? null,
    });
  }

  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Ajustes manuales                                                   */
/* ------------------------------------------------------------------ */

export interface AdjustInput {
  warehouseId: string;
  productId: string;
  delta: Decimal.Value; // positivo = entrada, negativo = salida
  note?: string;
  userId?: string;
}

export async function adjustStock(
  db: AnyListoPOSDb,
  orgId: string,
  input: AdjustInput,
): Promise<{ ok: true }> {
  await getOrgWarehouse(db, orgId, input.warehouseId);
  await getOrgProduct(db, orgId, input.productId);
  const delta = quantity(input.delta);
  if (delta.eq(0)) throw new Error("El ajuste no puede ser cero");

  const stock = await getStock(db, input.productId, input.warehouseId);
  const current = stock ? new Decimal(stock.quantity) : new Decimal(0);
  const next = current.plus(delta);
  if (next.lt(0)) {
    throw new Error("El ajuste dejaría stock negativo");
  }

  const avgCost = stock ? stock.avgCostUsd : "0";
  if (stock) {
    await db
      .update(s.inventoryStocks)
      .set({ quantity: next.toFixed(4), updatedAt: new Date() })
      .where(eq(s.inventoryStocks.id, stock.id));
  } else {
    await db.insert(s.inventoryStocks).values({
      organizationId: orgId,
      productId: input.productId,
      warehouseId: input.warehouseId,
      quantity: next.toFixed(4),
      avgCostUsd: "0",
    });
  }

  await db.insert(s.inventoryMovements).values({
    id: crypto.randomUUID(),
    organizationId: orgId,
    productId: input.productId,
    warehouseId: input.warehouseId,
    type: delta.gt(0) ? "adjustment_in" : "adjustment_out",
    quantity: delta.toFixed(4),
    unitCostUsd: avgCost,
    note: input.note ?? null,
    createdByUserId: input.userId ?? null,
  });

  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Consultas                                                          */
/* ------------------------------------------------------------------ */

/** Kardex: historial auditado de movimientos de un producto. */
export async function kardexFor(
  db: AnyListoPOSDb,
  orgId: string,
  productId: string,
) {
  return db
    .select({
      id: s.inventoryMovements.id,
      warehouseId: s.inventoryMovements.warehouseId,
      warehouseName: s.warehouses.name,
      type: s.inventoryMovements.type,
      quantity: s.inventoryMovements.quantity,
      unitCostUsd: s.inventoryMovements.unitCostUsd,
      referenceId: s.inventoryMovements.referenceId,
      note: s.inventoryMovements.note,
      createdAt: s.inventoryMovements.createdAt,
    })
    .from(s.inventoryMovements)
    .innerJoin(
      s.warehouses,
      eq(s.inventoryMovements.warehouseId, s.warehouses.id),
    )
    .where(
      and(
        eq(s.inventoryMovements.organizationId, orgId),
        eq(s.inventoryMovements.productId, productId),
      ),
    )
    .orderBy(desc(s.inventoryMovements.createdAt))
    .limit(200);
}

export interface LowStockRow {
  product: typeof s.products.$inferSelect;
  stocks: (typeof s.inventoryStocks.$inferSelect)[];
}

/** Productos con stock bajo o agotado (comparado contra su mínimo). */
export async function lowStockList(
  db: AnyListoPOSDb,
  orgId: string,
): Promise<LowStockRow[]> {
  const products = await db
    .select()
    .from(s.products)
    .where(and(eq(s.products.organizationId, orgId), eq(s.products.active, true)));
  if (products.length === 0) return [];
  const stocks = await db
    .select()
    .from(s.inventoryStocks)
    .where(eq(s.inventoryStocks.organizationId, orgId));

  const byProduct = new Map<string, typeof stocks>();
  for (const st of stocks) {
    const list = byProduct.get(st.productId) ?? [];
    list.push(st);
    byProduct.set(st.productId, list);
  }

  return products
    .map((product) => {
      const rows = byProduct.get(product.id) ?? [];
      const total = rows.reduce(
        (acc, st) => acc.plus(st.quantity),
        new Decimal(0),
      );
      return { product, stocks: rows, total };
    })
    .filter((row) => row.total.lte(row.product.minStock))
    .map(({ product, stocks }) => ({ product, stocks }));
}
