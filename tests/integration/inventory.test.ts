/**
 * Integración del módulo de Inventario (Fase 3) contra PostgreSQL real
 * (PGlite en memoria): costo promedio ponderado, traslados, ajustes, kardex
 * y alertas de stock bajo.
 */
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it } from "vitest";

import type { AnyListoPOSDb } from "@/core/db-cloud/db-types";
import * as s from "@/core/db-cloud/schema";
import {
  adjustStock,
  kardexFor,
  lowStockList,
  registerPurchase,
  transferStock,
} from "@/modules/inventory/service";

const MIGRATIONS = path.resolve(process.cwd(), "drizzle");

async function makeDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema: s.schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return { client, db };
}

async function seed(db: AnyListoPOSDb, slug: string) {
  const [org] = await db
    .insert(s.organizations)
    .values({ name: slug, slug })
    .returning();
  const [wh] = await db
    .insert(s.warehouses)
    .values({ organizationId: org.id, name: "Principal", isMain: true })
    .returning();
  const [wh2] = await db
    .insert(s.warehouses)
    .values({ organizationId: org.id, name: "Sucursal" })
    .returning();
  return { org, wh, wh2 };
}

async function seedProduct(
  db: AnyListoPOSDb,
  orgId: string,
  name: string,
  barcode?: string,
) {
  const [product] = await db
    .insert(s.products)
    .values({ organizationId: orgId, name, barcode, priceRetailUsd: "1.00" })
    .returning();
  return product;
}

describe("Inventario — compras con costo promedio ponderado", () => {
  it("recalcula el costo promedio y registra el kardex y la cuenta por pagar", async () => {
    const { db } = await makeDb();
    const { org, wh } = await seed(db, "inv-compra");
    const product = await seedProduct(db, org.id, "Harina PAN");
    const [supplier] = await db
      .insert(s.contacts)
      .values({ organizationId: org.id, type: "supplier", name: "Distribuidora X" })
      .returning();

    await registerPurchase(db, org.id, {
      warehouseId: wh.id,
      invoiceNumber: "C-001",
      lines: [{ productId: product.id, quantity: "10", unitCostUsd: "1.00" }],
    });
    const r2 = await registerPurchase(db, org.id, {
      warehouseId: wh.id,
      supplierContactId: supplier.id,
      invoiceNumber: "C-002",
      lines: [{ productId: product.id, quantity: "10", unitCostUsd: "2.00" }],
    });

    const [stock] = await db
      .select()
      .from(s.inventoryStocks)
      .where(eq(s.inventoryStocks.productId, product.id));
    expect(stock.quantity).toBe("20.0000");
    expect(stock.avgCostUsd).toBe("1.500000"); // (10*1 + 10*2)/20

    const [updated] = await db
      .select()
      .from(s.products)
      .where(eq(s.products.id, product.id));
    expect(updated.costUsd).toBe("2.0000"); // costo de reposición

    const movements = await db
      .select()
      .from(s.inventoryMovements)
      .where(eq(s.inventoryMovements.productId, product.id));
    expect(movements).toHaveLength(2);
    expect(movements.every((m) => m.type === "purchase")).toBe(true);

    // Cuenta por pagar creada por 20.00 USD (10 × 2.00)
    expect(r2.payableLedgerId).toBeDefined();
    const [ledger] = await db
      .select()
      .from(s.accountsLedger)
      .where(eq(s.accountsLedger.id, r2.payableLedgerId!));
    expect(ledger.type).toBe("payable");
    expect(ledger.amountUsd).toBe("20.0000");
    expect(ledger.contactId).toBe(supplier.id);
  });
});

describe("Inventario — traslados entre almacenes", () => {
  it("mueve mercancía y registra salida + entrada con la misma referencia", async () => {
    const { db } = await makeDb();
    const { org, wh, wh2 } = await seed(db, "inv-traslado");
    const product = await seedProduct(db, org.id, "Queso");
    await registerPurchase(db, org.id, {
      warehouseId: wh.id,
      lines: [{ productId: product.id, quantity: "10", unitCostUsd: "3.00" }],
    });

    await transferStock(db, org.id, {
      fromWarehouseId: wh.id,
      toWarehouseId: wh2.id,
      note: "Surtir sucursal",
      lines: [{ productId: product.id, quantity: "4" }],
    });

    const source = await db
      .select()
      .from(s.inventoryStocks)
      .where(eq(s.inventoryStocks.warehouseId, wh.id));
    const target = await db
      .select()
      .from(s.inventoryStocks)
      .where(eq(s.inventoryStocks.warehouseId, wh2.id));
    expect(source[0].quantity).toBe("6.0000");
    expect(target[0].quantity).toBe("4.0000");
    expect(target[0].avgCostUsd).toBe("3.000000");

    const movements = await db
      .select()
      .from(s.inventoryMovements)
      .where(eq(s.inventoryMovements.productId, product.id))
      .orderBy(desc(s.inventoryMovements.createdAt))
      .limit(2);
    expect(movements).toHaveLength(2);
    expect(movements[0].type).toBe("transfer_in");
    expect(movements[1].type).toBe("transfer_out");
    expect(movements[0].referenceId).toBe(movements[1].referenceId);
  });

  it("rechaza traslados sin stock suficiente", async () => {
    const { db } = await makeDb();
    const { org, wh, wh2 } = await seed(db, "inv-sin-stock");
    const product = await seedProduct(db, org.id, "Jugo");
    await registerPurchase(db, org.id, {
      warehouseId: wh.id,
      lines: [{ productId: product.id, quantity: "2", unitCostUsd: "1.00" }],
    });

    await expect(
      transferStock(db, org.id, {
        fromWarehouseId: wh.id,
        toWarehouseId: wh2.id,
        lines: [{ productId: product.id, quantity: "5" }],
      }),
    ).rejects.toThrow(/Stock insuficiente/);
  });
});

describe("Inventario — ajustes y kardex", () => {
  it("aplica ajustes manuales positivos y negativos con su movimiento", async () => {
    const { db } = await makeDb();
    const { org, wh } = await seed(db, "inv-ajuste");
    const product = await seedProduct(db, org.id, "Empanada");
    await registerPurchase(db, org.id, {
      warehouseId: wh.id,
      lines: [{ productId: product.id, quantity: "10", unitCostUsd: "1.00" }],
    });

    await adjustStock(db, org.id, {
      warehouseId: wh.id,
      productId: product.id,
      delta: "5",
      note: "Conteo físico",
    });
    await adjustStock(db, org.id, {
      warehouseId: wh.id,
      productId: product.id,
      delta: "-3",
      note: "Merma",
    });

    const [stock] = await db
      .select()
      .from(s.inventoryStocks)
      .where(eq(s.inventoryStocks.productId, product.id));
    expect(stock.quantity).toBe("12.0000");

    const kardex = await kardexFor(db, org.id, product.id);
    expect(kardex).toHaveLength(3);
    expect(kardex[0].type).toBe("adjustment_out"); // más reciente primero
    expect(kardex[0].quantity).toBe("-3.0000");
    expect(kardex[0].warehouseName).toBe("Principal");
  });

  it("rechaza ajustes que dejan stock negativo", async () => {
    const { db } = await makeDb();
    const { org, wh } = await seed(db, "inv-negativo");
    const product = await seedProduct(db, org.id, "Tequeño");

    await expect(
      adjustStock(db, org.id, {
        warehouseId: wh.id,
        productId: product.id,
        delta: "-5",
      }),
    ).rejects.toThrow(/stock negativo/);
  });
});

describe("Inventario — alertas de stock bajo", () => {
  it("lista solo los productos bajo su mínimo", async () => {
    const { db } = await makeDb();
    const { org, wh } = await seed(db, "inv-bajo");

    const [low] = await db
      .insert(s.products)
      .values({
        organizationId: org.id,
        name: "Stock bajo",
        minStock: "5",
        priceRetailUsd: "1.00",
      })
      .returning();
    const [fine] = await db
      .insert(s.products)
      .values({
        organizationId: org.id,
        name: "Stock ok",
        minStock: "5",
        priceRetailUsd: "1.00",
      })
      .returning();
    await db.insert(s.inventoryStocks).values({
      organizationId: org.id,
      productId: low.id,
      warehouseId: wh.id,
      quantity: "2",
    });
    await db.insert(s.inventoryStocks).values({
      organizationId: org.id,
      productId: fine.id,
      warehouseId: wh.id,
      quantity: "9",
    });

    const rows = await lowStockList(db, org.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].product.name).toBe("Stock bajo");
  });
});
