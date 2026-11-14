/**
 * Integración local del POS offline (Fase 4): emisión de ventas con pagos
 * mixtos e IGTF, descuento de insumos de recetas, presupuestos sin stock y
 * secuencia de numeración — todo contra Dexie + cola Outbox.
 */
import { afterEach, describe, expect, it } from "vitest";

import type { ListoPOSLocalDb, LocalProduct } from "@/core/db-local/dexie";
import { createLocalDb } from "@/core/db-local/dexie";
import { issueLocalSale, nextInvoiceNumber } from "@/modules/pos/pos-logic";

const openDbs: ListoPOSLocalDb[] = [];

async function freshDb(): Promise<ListoPOSLocalDb> {
  const db = createLocalDb(`listopos-pos-${crypto.randomUUID()}`);
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

function productRow(
  id: string,
  name: string,
  price: string,
  isComposite = 0,
): LocalProduct {
  return {
    id,
    organizationId: orgId,
    name,
    unit: "und",
    costUsd: "1.00",
    marginPercent: "0",
    priceRetailUsd: price,
    exemptVat: 0,
    minStock: "0",
    isComposite: isComposite as 0 | 1,
    active: 1,
    updatedAt: new Date().toISOString(),
  };
}

async function seed(db: ListoPOSLocalDb) {
  const wh = crypto.randomUUID();
  const coffee = productRow(crypto.randomUUID(), "Café", "2.00");
  const combo = productRow(crypto.randomUUID(), "Combo Desayuno", "5.00", 1);
  const bread = productRow(crypto.randomUUID(), "Pan", "0.50");
  await db.products.bulkAdd([coffee, combo, bread]);
  await db.inventoryStocks.bulkAdd([
    { id: crypto.randomUUID(), organizationId: orgId, productId: coffee.id, warehouseId: wh, quantity: "10.0000", avgCostUsd: "1.0000", updatedAt: new Date().toISOString() },
    { id: crypto.randomUUID(), organizationId: orgId, productId: combo.id, warehouseId: wh, quantity: "5.0000", avgCostUsd: "2.0000", updatedAt: new Date().toISOString() },
    { id: crypto.randomUUID(), organizationId: orgId, productId: bread.id, warehouseId: wh, quantity: "20.0000", avgCostUsd: "0.3000", updatedAt: new Date().toISOString() },
  ]);
  await db.exchangeRates.add({
    id: crypto.randomUUID(),
    organizationId: orgId,
    currency: "usd",
    rateToVes: "36.5",
    date: "2026-11-14",
    source: "bcv",
  });
  // Receta: 1 combo = 2 panes
  await db.productRecipes.add({
    id: crypto.randomUUID(),
    organizationId: orgId,
    productId: combo.id,
    componentId: bread.id,
    quantity: "2",
    unit: "und",
  });
  return { wh, coffee, combo, bread };
}

function stockQty(db: ListoPOSLocalDb, productId: string, warehouseId: string) {
  return db.inventoryStocks
    .where("[productId+warehouseId]")
    .equals([productId, warehouseId])
    .first();
}

describe("POS offline — emisión de ventas (Outbox)", () => {
  it("emite una factura con pago mixto, IGTF 3% y numeración secuencial", async () => {
    const db = await freshDb();
    const { wh, coffee } = await seed(db);

    const sale1 = await issueLocalSale(db, {
      type: "invoice",
      organizationId: orgId,
      warehouseId: wh,
      contactId: undefined,
      contactName: "Consumidor Final",
      items: [
        {
          productId: coffee.id,
          name: coffee.name,
          quantity: "2",
          unit: "und",
          unitPriceUsd: "2.00",
          exemptVat: false,
        },
      ],
      payments: [{ method: "cash_usd", currency: "usd", amount: "4.78" }],
      discountUsd: "0",
      igtfRatePercent: "3",
    });

    expect(sale1.invoice.number).toBe("00000001");
    expect(sale1.invoice.status).toBe("paid");
    expect(sale1.invoice.subtotalUsd).toBe("4.00");
    expect(sale1.invoice.vatUsd).toBe("0.64");
    expect(sale1.invoice.igtfUsd).toBe("0.14");
    expect(sale1.invoice.totalUsd).toBe("4.78");
    expect(sale1.invoice.totalVes).toBe("174.47");
    expect(sale1.invoice.synced).toBe(0);

    const st = await stockQty(db, coffee.id, wh);
    expect(st?.quantity).toBe("8.0000");
    expect(await db.syncQueue.count()).toBe(1);

    const sale2 = await issueLocalSale(db, {
      type: "invoice",
      organizationId: orgId,
      warehouseId: wh,
      items: [
        {
          productId: coffee.id,
          name: coffee.name,
          quantity: "1",
          unit: "und",
          unitPriceUsd: "2.00",
          exemptVat: false,
        },
      ],
      payments: [{ method: "cash_ves", currency: "ves", amount: "84.68" }], // 2.32 * 36.5
      discountUsd: "0",
      igtfRatePercent: "3",
    });
    expect(sale2.invoice.number).toBe("00000002");
    expect(sale2.invoice.igtfUsd).toBe("0.00"); // todo en Bs → sin IGTF
    expect(await db.syncQueue.count()).toBe(2);
  });

  it("descuenta los insumos de la receta al vender un combo", async () => {
    const db = await freshDb();
    const { wh, combo, bread } = await seed(db);

    const sale = await issueLocalSale(db, {
      type: "invoice",
      organizationId: orgId,
      warehouseId: wh,
      items: [
        {
          productId: combo.id,
          name: combo.name,
          quantity: "1",
          unit: "und",
          unitPriceUsd: "5.00",
          exemptVat: false,
          isComposite: true,
        },
      ],
      payments: [{ method: "cash_ves", currency: "ves", amount: "211.70" }],
      discountUsd: "0",
      igtfRatePercent: "3",
    });

    expect(sale.invoice.totalUsd).toBe("5.80"); // 5.00 + IVA 0.80
    expect(sale.invoice.igtfUsd).toBe("0.00");

    const comboStock = await stockQty(db, combo.id, wh);
    expect(comboStock?.quantity).toBe("5.0000"); // el compuesto NO se descuenta
    const breadStock = await stockQty(db, bread.id, wh);
    expect(breadStock?.quantity).toBe("18.0000"); // 20 - 2 panes

    const queue = await db.syncQueue.toArray();
    expect(queue).toHaveLength(1);
    const payload = queue[0].payload as { items: { productId: string }[] };
    expect(payload.items[0].productId).toBe(combo.id);
  });

  it("un presupuesto no descuenta stock, no lleva número ni pagos", async () => {
    const db = await freshDb();
    const { wh, coffee } = await seed(db);

    const sale = await issueLocalSale(db, {
      type: "quote",
      organizationId: orgId,
      warehouseId: wh,
      items: [
        {
          productId: coffee.id,
          name: coffee.name,
          quantity: "3",
          unit: "und",
          unitPriceUsd: "2.00",
          exemptVat: false,
        },
      ],
      payments: [],
      discountUsd: "0",
      igtfRatePercent: "3",
    });

    expect(sale.invoice.status).toBe("issued");
    expect(sale.invoice.number).toBeUndefined();
    const st = await stockQty(db, coffee.id, wh);
    expect(st?.quantity).toBe("10.0000");

    const queue = await db.syncQueue.toArray();
    const payload = queue[0].payload as { type: string; payments: unknown[]; number?: string };
    expect(payload.type).toBe("quote");
    expect(payload.payments).toEqual([]);
    expect(payload.number).toBeUndefined();
  });

  it("exige tasa USD para operar offline", async () => {
    const db = await freshDb();
    const wh = crypto.randomUUID();
    await expect(
      issueLocalSale(db, {
        type: "invoice",
        organizationId: orgId,
        warehouseId: wh,
        items: [
          {
            productId: crypto.randomUUID(),
            name: "X",
            quantity: "1",
            unit: "und",
            unitPriceUsd: "1.00",
            exemptVat: false,
          },
        ],
        payments: [],
        discountUsd: "0",
        igtfRatePercent: "3",
      }),
    ).rejects.toThrow(/tasa USD/);
  });

  it("nextInvoiceNumber incrementa y rellena con ceros", async () => {
    const db = await freshDb();
    expect(await nextInvoiceNumber(db, orgId)).toBe("00000001");
    expect(await nextInvoiceNumber(db, orgId)).toBe("00000002");
    await db.meta.put({ key: `org:${orgId}:nextNumber`, value: "00000099" });
    expect(await nextInvoiceNumber(db, orgId)).toBe("00000100");
  });
});
