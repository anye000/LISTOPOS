/**
 * Integración del módulo Fiscal (Fase 5): libros SENIAT de compra y venta
 * mensuales y generación del archivo xlsx para el contador.
 */
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import type { AnyListoPOSDb } from "@/core/db-cloud/db-types";
import * as s from "@/core/db-cloud/schema";
import {
  buildBooksXlsx,
  getPurchasesBook,
  getSalesBook,
  upsertExchangeRate,
} from "@/modules/fiscal/service";

const MIGRATIONS = path.resolve(process.cwd(), "drizzle");

async function makeDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema: s.schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return { client, db };
}

async function seed(db: AnyListoPOSDb) {
  const [org] = await db
    .insert(s.organizations)
    .values({ name: "Fiscal CA", slug: "fiscal-ca" })
    .returning();
  const [wh] = await db
    .insert(s.warehouses)
    .values({ organizationId: org.id, name: "Principal", isMain: true })
    .returning();
  await upsertExchangeRate(db, org.id, {
    currency: "usd",
    rateToVes: "36.5",
    date: "2026-11-14",
    source: "bcv",
  });
  const [customer] = await db
    .insert(s.contacts)
    .values({
      organizationId: org.id,
      type: "customer",
      name: "Cliente Uno",
      document: "J-12345678-9",
    })
    .returning();
  const [supplier] = await db
    .insert(s.contacts)
    .values({
      organizationId: org.id,
      type: "supplier",
      name: "Proveedor Dos",
      document: "J-98765432-1",
    })
    .returning();

  const mkInvoice = (number: string, date: Date, totals: Record<string, string>) =>
    db.insert(s.invoices).values({
      organizationId: org.id,
      warehouseId: wh.id,
      contactId: customer.id,
      type: "invoice",
      status: "paid",
      number,
      date,
      subtotalUsd: totals.subtotalUsd,
      discountUsd: "0",
      vatUsd: totals.vatUsd,
      igtfUsd: totals.igtfUsd,
      totalUsd: totals.totalUsd,
      subtotalVes: totals.subtotalVes,
      discountVes: "0",
      vatVes: totals.vatVes,
      igtfVes: totals.igtfVes,
      totalVes: totals.totalVes,
      exchangeRateSnapshot: {
        usdToVes: "36.5",
        eurToVes: "40.15",
        igtfRate: "3",
        capturedAt: date.toISOString(),
      },
    });

  // Factura de noviembre: 100 + IVA 16 + IGTF 3.48 (116*3%) = 119.48
  await mkInvoice("00000001", new Date("2026-11-10T15:00:00Z"), {
    subtotalUsd: "100.00",
    vatUsd: "16.00",
    igtfUsd: "3.48",
    totalUsd: "119.48",
    subtotalVes: "3650.00",
    vatVes: "584.00",
    igtfVes: "127.02",
    totalVes: "4361.02",
  });
  // Otra factura de noviembre pagada en Bs (sin IGTF)
  await mkInvoice("00000002", new Date("2026-11-20T15:00:00Z"), {
    subtotalUsd: "50.00",
    vatUsd: "8.00",
    igtfUsd: "0.00",
    totalUsd: "58.00",
    subtotalVes: "1825.00",
    vatVes: "292.00",
    igtfVes: "0.00",
    totalVes: "2117.00",
  });
  // Factura de OCTUBRE: no debe aparecer en el libro de noviembre
  await mkInvoice("00000003", new Date("2026-10-05T15:00:00Z"), {
    subtotalUsd: "10.00",
    vatUsd: "1.60",
    igtfUsd: "0.00",
    totalUsd: "11.60",
    subtotalVes: "365.00",
    vatVes: "58.40",
    igtfVes: "0.00",
    totalVes: "423.40",
  });

  // Compra a proveedor en noviembre: total 2320 Bs (base 2000 + IVA 320)
  await db.insert(s.accountsLedger).values({
    organizationId: org.id,
    contactId: supplier.id,
    type: "payable",
    amountUsd: "63.56",
    amountVes: "2320.00",
    status: "pending",
    notes: "Compra C-00099",
  });

  return { org, customer, supplier };
}

describe("Fiscal — libros SENIAT", () => {
  it("genera el libro de ventas del mes con las columnas fiscales", async () => {
    const { db } = await makeDb();
    const { org } = await seed(db);

    const sales = await getSalesBook(db, org.id, "2026-11");
    expect(sales).toHaveLength(2);
    expect(sales[0].numero).toBe("00000001");
    expect(sales[0].rif).toBe("J-12345678-9");
    expect(sales[0].baseImponible).toBe("3650.0000");
    expect(sales[0].iva).toBe("584.0000");
    expect(sales[0].igtf).toBe("127.0200");
    expect(sales[0].total).toBe("4361.0200");
    expect(sales[1].igtf).toBe("0.0000");
  });

  it("genera el libro de compras estimando base imponible e IVA", async () => {
    const { db } = await makeDb();
    const { org } = await seed(db);

    const purchases = await getPurchasesBook(db, org.id, "2026-11");
    expect(purchases).toHaveLength(1);
    expect(purchases[0].rif).toBe("J-98765432-1");
    expect(purchases[0].numero).toBe("C-00099");
    expect(purchases[0].baseImponible).toBe("2000.00"); // 2320 / 1.16
    expect(purchases[0].iva).toBe("320.00");
    expect(purchases[0].total).toBe("2320.0000");
  });

  it("exporta un xlsx válido con los dos libros", async () => {
    const { db } = await makeDb();
    const { org } = await seed(db);

    const sales = await getSalesBook(db, org.id, "2026-11");
    const purchases = await getPurchasesBook(db, org.id, "2026-11");
    const buffer = buildBooksXlsx(sales, purchases);
    expect(buffer.length).toBeGreaterThan(500);

    const wb = XLSX.read(buffer, { type: "buffer" });
    expect(wb.SheetNames).toEqual(["LIBRO VENTAS", "LIBRO COMPRAS"]);
    const sheet = wb.Sheets["LIBRO VENTAS"];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
    expect(rows).toHaveLength(2);
    expect(rows[0]["RIF"]).toBe("J-12345678-9");
    expect(rows[0]["N° Factura"]).toBe("00000001");
    expect(rows[0]["IGTF (Bs)"]).toBe(127.02);
  });

  it("actualiza una tasa existente (upsert por org+moneda+fecha)", async () => {
    const { db } = await makeDb();
    const { org } = await seed(db);

    await upsertExchangeRate(db, org.id, {
      currency: "usd",
      rateToVes: "38.5",
      date: "2026-11-14",
      source: "bcv",
    });
    const rows = await db.select().from(s.exchangeRates);
    expect(rows).toHaveLength(1);
    expect(rows[0].rateToVes).toBe("38.500000");
  });
});
