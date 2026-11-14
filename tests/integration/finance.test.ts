/**
 * Integración del módulo de Finanzas (Fase 5): cierre Z con cuadre,
 * movimientos manuales, abonos parciales multimoneda y bancos.
 */
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it } from "vitest";

import type { AnyListoPOSDb } from "@/core/db-cloud/db-types";
import * as s from "@/core/db-cloud/schema";
import {
  bankList,
  closeRegister,
  createBankAccount,
  ledgerList,
  openRegister,
  registerAbono,
  registerCashMovement,
} from "@/modules/finance/service";
import { pushEntry, type PushEnvelope } from "@/core/sync/server-service";

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
  return { org, wh };
}

describe("Finanzas — cierre Z de caja", () => {
  it("cuadra lo esperado (apertura + ventas + manuales) contra lo contado", async () => {
    const { db } = await makeDb();
    const { org, wh } = await seed(db, "fin-caja");

    const register = await openRegister(db, org.id, {
      warehouseId: wh.id,
      openingBalanceUsd: "100",
      openingBalanceVes: "500",
    });

    // Venta del turno: factura con pago en efectivo USD.
    const [invoice] = await db
      .insert(s.invoices)
      .values({
        organizationId: org.id,
        warehouseId: wh.id,
        cashRegisterId: register.id,
        type: "invoice",
        status: "paid",
        number: "00000001",
        subtotalUsd: "50.00",
        vatUsd: "0",
        igtfUsd: "0",
        totalUsd: "50.00",
        subtotalVes: "1825.00",
        vatVes: "0",
        igtfVes: "0",
        totalVes: "1825.00",
        exchangeRateSnapshot: {
          usdToVes: "36.5",
          eurToVes: "40.15",
          igtfRate: "3",
          capturedAt: new Date().toISOString(),
        },
      })
      .returning();
    await db.insert(s.payments).values({
      organizationId: org.id,
      invoiceId: invoice.id,
      method: "cash_usd",
      currency: "usd",
      amount: "50.00",
    });

    // Gasto menor en bolívares.
    await registerCashMovement(db, org.id, {
      cashRegisterId: register.id,
      type: "expense",
      method: "cash_ves",
      currency: "ves",
      amount: "200",
      reason: "Gasolina",
    });

    const result = await closeRegister(db, org.id, register.id, {
      countedUsd: "155", // sobrante de 5 USD
      countedVes: "300", // 500 - 200 = 300 ✓
    });

    expect(result.expectedUsd).toBe("150.00"); // 100 + 50
    expect(result.expectedVes).toBe("300.00"); // 500 - 200
    expect(result.diffUsd).toBe("5.00");
    expect(result.diffVes).toBe("0.00");

    const [closed] = await db
      .select()
      .from(s.cashRegisters)
      .where(eq(s.cashRegisters.id, register.id));
    expect(closed.status).toBe("closed");
  });

  it("no permite abrir dos turnos ni cerrar uno ya cerrado", async () => {
    const { db } = await makeDb();
    const { org, wh } = await seed(db, "fin-turno");

    await openRegister(db, org.id, {
      warehouseId: wh.id,
      openingBalanceUsd: "0",
      openingBalanceVes: "0",
    });
    await expect(
      openRegister(db, org.id, {
        warehouseId: wh.id,
        openingBalanceUsd: "0",
        openingBalanceVes: "0",
      }),
    ).rejects.toThrow(/abierto/);
  });
});

describe("Finanzas — cuentas por cobrar/pagar con abonos", () => {
  it("registra abonos parciales multimoneda hasta saldar la cuenta", async () => {
    const { db } = await makeDb();
    const { org } = await seed(db, "fin-ledger");

    await db.insert(s.exchangeRates).values({
      organizationId: org.id,
      currency: "usd",
      rateToVes: "36.5",
      date: "2026-11-14",
    });
    const [supplier] = await db
      .insert(s.contacts)
      .values({ organizationId: org.id, type: "supplier", name: "Proveedor" })
      .returning();
    const [entry] = await db
      .insert(s.accountsLedger)
      .values({
        organizationId: org.id,
        contactId: supplier.id,
        type: "payable",
        amountUsd: "20.00",
        amountVes: "730.00",
        status: "pending",
        notes: "Compra C-001",
      })
      .returning();

    // Abono 1: 10 USD.
    const r1 = await registerAbono(db, org.id, {
      ledgerId: entry.id,
      method: "zelle",
      currency: "usd",
      amount: "10",
    });
    expect(r1.status).toBe("partial");

    // Abono 2: 365 Bs = 10 USD al BCV.
    const r2 = await registerAbono(db, org.id, {
      ledgerId: entry.id,
      method: "pago_movil",
      currency: "ves",
      amount: "365",
    });
    expect(r2.status).toBe("paid");

    const [updated] = await db
      .select()
      .from(s.accountsLedger)
      .where(eq(s.accountsLedger.id, entry.id));
    expect(updated.paidUsd).toBe("20.0000");
    expect(updated.paidVes).toBe("730.0000");
    expect(updated.status).toBe("paid");

    const rows = await ledgerList(db, org.id, "payable");
    expect(rows).toHaveLength(1);
    expect(rows[0].contactName).toBe("Proveedor");

    await expect(
      registerAbono(db, org.id, {
        ledgerId: entry.id,
        method: "zelle",
        currency: "usd",
        amount: "1",
      }),
    ).rejects.toThrow(/saldada/);
  });
});

describe("Finanzas — bancos y billeteras", () => {
  it("calcula el saldo desde movimientos y pagos sincronizados", async () => {
    const { db } = await makeDb();
    const { org, wh } = await seed(db, "fin-bancos");

    const account = await createBankAccount(db, org.id, {
      name: "Banco Nacional",
      type: "bank",
      currency: "usd",
      initialBalanceUsd: "100",
    });

    // Pago de una factura offline con cuenta bancaria asociada.
    const envelope: PushEnvelope = {
      id: crypto.randomUUID(),
      organizationId: org.id,
      entity: "invoice",
      operation: "create",
      payload: {
        id: crypto.randomUUID(),
        number: "00000010",
        type: "invoice",
        warehouseId: wh.id,
        items: [{ name: "X", quantity: "1", unitPriceUsd: "10.00", exemptVat: false }],
        payments: [
          {
            method: "zelle",
            currency: "usd",
            amount: "11.60",
            bankAccountId: account.id,
          },
        ],
        discountUsd: "0",
        exchangeRateSnapshot: {
          usdToVes: "36.5",
          eurToVes: "40.15",
          igtfRate: "3",
          capturedAt: new Date().toISOString(),
        },
      },
    };
    const pushed = await pushEntry(db, org.id, envelope);
    expect(pushed.ok).toBe(true);

    const list = await bankList(db, org.id);
    expect(list).toHaveLength(1);
    expect(list[0].balanceUsd).toBe("111.60"); // 100 + 11.60
    expect(list[0].movementCount).toBe(1);
  });
});
