/**
 * Integración cloud — motor de sincronización (Outbox) contra PostgreSQL real
 * (PGlite en memoria + migraciones Drizzle).
 *
 * Valida: idempotencia por UUID, descuento de stock una sola vez, aislamiento
 * multi-tenant y recálculo de totales en el servidor con decimal.js.
 */
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { count, eq } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it } from "vitest";

import type { AnyListoPOSDb } from "@/core/db-cloud/db-types";
import * as s from "@/core/db-cloud/schema";
import {
  pullPayload,
  pushEntry,
  type PushEnvelope,
} from "@/core/sync/server-service";

const MIGRATIONS = path.resolve(process.cwd(), "drizzle");

async function makeDb(): Promise<{
  client: PGlite;
  db: PgliteDatabase<typeof s.schema>;
}> {
  const client = new PGlite(); // en memoria
  const db = drizzle(client, { schema: s.schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return { client, db };
}

async function seedOrg(db: AnyListoPOSDb, slug: string) {
  const [org] = await db
    .insert(s.organizations)
    .values({ name: slug, slug, igtfRate: "3.0000" })
    .returning();
  const [wh] = await db
    .insert(s.warehouses)
    .values({ organizationId: org.id, name: "Principal", isMain: true })
    .returning();
  return { org, wh };
}

function invoiceEnvelope(
  orgId: string,
  warehouseId: string,
  overrides: Record<string, unknown> = {},
): PushEnvelope {
  const id = crypto.randomUUID();
  return {
    id,
    organizationId: orgId,
    entity: "invoice",
    operation: "create",
    payload: {
      id,
      number: "00000001",
      type: "invoice",
      warehouseId,
      items: [
        { name: "Café", quantity: "2", unitPriceUsd: "2.00", exemptVat: false },
      ],
      payments: [{ method: "cash_usd", currency: "usd", amount: "4.78" }],
      discountUsd: "0",
      exchangeRateSnapshot: {
        usdToVes: "36.5",
        eurToVes: "40.15",
        igtfRate: "3",
        capturedAt: new Date().toISOString(),
      },
      ...overrides,
    },
  };
}

describe("Integración cloud — push de facturas offline", () => {
  it("aplica una factura, recalcula totales con IGTF y descuenta stock una sola vez", async () => {
    const { db } = await makeDb();
    const { org, wh } = await seedOrg(db, "test-cafe");

    const [product] = await db
      .insert(s.products)
      .values({
        organizationId: org.id,
        name: "Café",
        priceRetailUsd: "2.00",
        barcode: "0001",
      })
      .returning();
    await db.insert(s.inventoryStocks).values({
      organizationId: org.id,
      productId: product.id,
      warehouseId: wh.id,
      quantity: "10",
    });

    const envelope = invoiceEnvelope(org.id, wh.id, {
      items: [
        {
          productId: product.id,
          name: "Café",
          quantity: "2",
          unitPriceUsd: "2.00",
          exemptVat: false,
        },
      ],
    });

    const first = await pushEntry(db, org.id, envelope);
    expect(first).toEqual({ ok: true, duplicate: false });

    // Retry idempotente (mismo UUID): no debe duplicar ni volver a descontar.
    const second = await pushEntry(db, org.id, envelope);
    expect(second).toEqual({ ok: true, duplicate: true });

    const [invoice] = await db
      .select()
      .from(s.invoices)
      .where(eq(s.invoices.id, envelope.id));
    expect(invoice).toBeDefined();
    expect(invoice.subtotalUsd).toBe("4.0000");
    expect(invoice.vatUsd).toBe("0.6400"); // 4.00 × 16%
    expect(invoice.igtfUsd).toBe("0.1400"); // 4.78 pagado en USD × 3%
    expect(invoice.totalUsd).toBe("4.7800");
    expect(invoice.totalVes).toBe("174.4700"); // 4.78 × 36.5
    expect(invoice.status).toBe("paid");
    expect(invoice.exchangeRateSnapshot.usdToVes).toBe("36.5");

    const [stock] = await db
      .select()
      .from(s.inventoryStocks)
      .where(eq(s.inventoryStocks.productId, product.id));
    expect(stock.quantity).toBe("8.0000"); // descontado UNA sola vez

    const items = await db
      .select()
      .from(s.invoiceItems)
      .where(eq(s.invoiceItems.invoiceId, envelope.id));
    expect(items).toHaveLength(1);
    expect(items[0].organizationId).toBe(org.id);

    const payments = await db
      .select()
      .from(s.payments)
      .where(eq(s.payments.invoiceId, envelope.id));
    expect(payments).toHaveLength(1);

    const movements = await db
      .select()
      .from(s.inventoryMovements)
      .where(eq(s.inventoryMovements.referenceId, envelope.id));
    expect(movements).toHaveLength(1);
    expect(movements[0].quantity).toBe("-2.0000");
  });

  it("marca como crédito cuando el pago no cubre el total", async () => {
    const { db } = await makeDb();
    const { org, wh } = await seedOrg(db, "test-credito");

    const envelope = invoiceEnvelope(org.id, wh.id, {
      payments: [{ method: "cash_usd", currency: "usd", amount: "2.00" }],
    });
    await pushEntry(db, org.id, envelope);

    const [invoice] = await db
      .select()
      .from(s.invoices)
      .where(eq(s.invoices.id, envelope.id));
    expect(invoice.status).toBe("credit");
  });

  it("un presupuesto no descuenta stock ni guarda pagos", async () => {
    const { db } = await makeDb();
    const { org, wh } = await seedOrg(db, "test-quote");

    const [product] = await db
      .insert(s.products)
      .values({
        organizationId: org.id,
        name: "Arepa",
        priceRetailUsd: "3.00",
      })
      .returning();
    await db.insert(s.inventoryStocks).values({
      organizationId: org.id,
      productId: product.id,
      warehouseId: wh.id,
      quantity: "5",
    });

    const envelope = invoiceEnvelope(org.id, wh.id, {
      type: "quote",
      payments: [],
      items: [
        {
          productId: product.id,
          name: "Arepa",
          quantity: "1",
          unitPriceUsd: "3.00",
          exemptVat: false,
        },
      ],
    });
    const result = await pushEntry(db, org.id, envelope);
    expect(result.ok).toBe(true);

    const [stock] = await db
      .select()
      .from(s.inventoryStocks)
      .where(eq(s.inventoryStocks.productId, product.id));
    expect(stock.quantity).toBe("5.0000");

    const [invoice] = await db
      .select()
      .from(s.invoices)
      .where(eq(s.invoices.id, envelope.id));
    expect(invoice.status).toBe("issued");
  });
});

describe("Integración cloud — aislamiento multi-tenant", () => {
  it("rechaza entradas cuyo organizationId no coincide con el tenant activo", async () => {
    const { db } = await makeDb();
    const a = await seedOrg(db, "empresa-a");
    const b = await seedOrg(db, "empresa-b");

    const envelope = invoiceEnvelope(b.org.id, b.wh.id);
    const result = await pushEntry(db, a.org.id, envelope);
    expect(result).toEqual({ ok: false, error: "tenant_mismatch" });

    const rows = await db
      .select({ n: count() })
      .from(s.invoices)
      .where(eq(s.invoices.organizationId, b.org.id));
    expect(rows[0].n).toBe(0);
  });
});

describe("Integración cloud — recetas, presupuestos y numeración", () => {
  it("al vender un compuesto descuenta los insumos de la receta", async () => {
    const { db } = await makeDb();
    const { org, wh } = await seedOrg(db, "test-receta");

    const [combo] = await db
      .insert(s.products)
      .values({
        organizationId: org.id,
        name: "Combo Desayuno",
        priceRetailUsd: "5.00",
        isComposite: true,
      })
      .returning();
    const [bread] = await db
      .insert(s.products)
      .values({
        organizationId: org.id,
        name: "Pan",
        priceRetailUsd: "0.50",
      })
      .returning();
    await db.insert(s.inventoryStocks).values({
      organizationId: org.id,
      productId: combo.id,
      warehouseId: wh.id,
      quantity: "5",
    });
    await db.insert(s.inventoryStocks).values({
      organizationId: org.id,
      productId: bread.id,
      warehouseId: wh.id,
      quantity: "20",
    });
    await db.insert(s.productRecipes).values({
      organizationId: org.id,
      productId: combo.id,
      componentId: bread.id,
      quantity: "2",
    });

    const envelope = invoiceEnvelope(org.id, wh.id, {
      items: [
        {
          productId: combo.id,
          name: "Combo Desayuno",
          quantity: "2",
          unitPriceUsd: "5.00",
          exemptVat: false,
        },
      ],
      payments: [{ method: "cash_ves", currency: "ves", amount: "423.40" }],
    });
    await pushEntry(db, org.id, envelope);

    const [comboStock] = await db
      .select()
      .from(s.inventoryStocks)
      .where(eq(s.inventoryStocks.productId, combo.id));
    expect(comboStock.quantity).toBe("5.0000"); // el compuesto no se descuenta

    const [breadStock] = await db
      .select()
      .from(s.inventoryStocks)
      .where(eq(s.inventoryStocks.productId, bread.id));
    expect(breadStock.quantity).toBe("16.0000"); // 20 - (2 × 2)

    const movements = await db
      .select()
      .from(s.inventoryMovements)
      .where(eq(s.inventoryMovements.referenceId, envelope.id));
    expect(movements).toHaveLength(1);
    expect(movements[0].type).toBe("recipe_out");
    expect(movements[0].productId).toBe(bread.id);
    expect(movements[0].quantity).toBe("-4.0000");
  });

  it("marca el presupuesto origen como converted al facturarlo", async () => {
    const { db } = await makeDb();
    const { org, wh } = await seedOrg(db, "test-conversion");

    const quote = invoiceEnvelope(org.id, wh.id, {
      type: "quote",
      payments: [],
      items: [
        { name: "Servicio", quantity: "1", unitPriceUsd: "50.00", exemptVat: false },
      ],
    });
    await pushEntry(db, org.id, quote);
    const [quoteRow] = await db
      .select()
      .from(s.invoices)
      .where(eq(s.invoices.id, quote.id));
    expect(quoteRow.status).toBe("issued");

    const invoice = invoiceEnvelope(org.id, wh.id, {
      sourceInvoiceId: quote.id,
      payments: [{ method: "cash_usd", currency: "usd", amount: "59.74" }],
    });
    await pushEntry(db, org.id, invoice);

    const [converted] = await db
      .select()
      .from(s.invoices)
      .where(eq(s.invoices.id, quote.id));
    expect(converted.status).toBe("converted");
  });

  it("reasigna el número automáticamente si otro dispositivo ya lo usó", async () => {
    const { db } = await makeDb();
    const { org, wh } = await seedOrg(db, "test-numeracion");

    // Otra factura ya ocupa el 00000001 (colisión offline entre dispositivos).
    const existing = invoiceEnvelope(org.id, wh.id, {
      number: "00000001",
      items: [
        { name: "A", quantity: "1", unitPriceUsd: "1.00", exemptVat: false },
      ],
      payments: [{ method: "cash_usd", currency: "usd", amount: "1.16" }],
    });
    await pushEntry(db, org.id, existing);

    const incoming = invoiceEnvelope(org.id, wh.id, {
      number: "00000001",
      items: [
        { name: "B", quantity: "1", unitPriceUsd: "2.00", exemptVat: false },
      ],
      payments: [{ method: "cash_usd", currency: "usd", amount: "2.32" }],
    });
    const result = await pushEntry(db, org.id, incoming);
    expect(result.ok).toBe(true);

    const [row] = await db
      .select()
      .from(s.invoices)
      .where(eq(s.invoices.id, incoming.id));
    expect(row.number).toBe("00000002");
  });
});

describe("Integración cloud — fidelización", () => {
  it("acumula puntos por USD vendido a clientes registrados (sin duplicar en retry)", async () => {
    const { db } = await makeDb();
    const { org, wh } = await seedOrg(db, "test-puntos");
    const [customer] = await db
      .insert(s.contacts)
      .values({
        organizationId: org.id,
        type: "customer",
        name: "Cliente Fiel",
        document: "V-12345678",
      })
      .returning();

    // Factura de 4.78 USD (2 × 2.00 + IVA 0.64 + IGTF 0.14) → 4 puntos.
    const envelope = invoiceEnvelope(org.id, wh.id, {
      contactId: customer.id,
    });
    const first = await pushEntry(db, org.id, envelope);
    expect(first).toEqual({ ok: true, duplicate: false });

    const [afterFirst] = await db
      .select()
      .from(s.contacts)
      .where(eq(s.contacts.id, customer.id));
    expect(afterFirst.points).toBe(4);

    // Reintento del mismo UUID: idempotente, no suma puntos otra vez.
    const retry = await pushEntry(db, org.id, envelope);
    expect(retry).toEqual({ ok: true, duplicate: true });
    const [afterRetry] = await db
      .select()
      .from(s.contacts)
      .where(eq(s.contacts.id, customer.id));
    expect(afterRetry.points).toBe(4);
  });

  it("los presupuestos no acumulan puntos", async () => {
    const { db } = await makeDb();
    const { org, wh } = await seedOrg(db, "test-puntos-quote");
    const [customer] = await db
      .insert(s.contacts)
      .values({ organizationId: org.id, type: "customer", name: "Cliente 2" })
      .returning();

    const envelope = invoiceEnvelope(org.id, wh.id, {
      type: "quote",
      payments: [],
      contactId: customer.id,
    });
    await pushEntry(db, org.id, envelope);

    const [contact] = await db
      .select()
      .from(s.contacts)
      .where(eq(s.contacts.id, customer.id));
    expect(contact.points).toBe(0);
  });
});

describe("Integración cloud — pull del catálogo", () => {
  it("devuelve solo los datos de la organización solicitada", async () => {
    const { db } = await makeDb();
    const a = await seedOrg(db, "cat-a");
    const b = await seedOrg(db, "cat-b");

    await db.insert(s.products).values({
      organizationId: a.org.id,
      name: "Producto A",
      priceRetailUsd: "1.00",
    });
    await db.insert(s.products).values({
      organizationId: b.org.id,
      name: "Producto B",
      priceRetailUsd: "9.00",
    });
    await db.insert(s.exchangeRates).values({
      organizationId: a.org.id,
      currency: "usd",
      rateToVes: "36.5",
      date: "2026-11-14",
    });

    const payloadA = await pullPayload(db, a.org.id);
    expect(payloadA.products).toHaveLength(1);
    expect(payloadA.products[0].name).toBe("Producto A");
    expect(payloadA.exchangeRates).toHaveLength(1);

    const payloadB = await pullPayload(db, b.org.id);
    expect(payloadB.products).toHaveLength(1);
    expect(payloadB.products[0].name).toBe("Producto B");
    expect(payloadB.exchangeRates).toHaveLength(0);
  });
});
