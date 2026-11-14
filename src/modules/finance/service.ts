/**
 * Módulo de Finanzas — lógica de negocio (Fase 5).
 *
 *  - Apertura y cierre Z de caja con cuadre esperado vs contado.
 *  - Ingresos/egresos manuales de caja.
 *  - Cuentas por cobrar/pagar con abonos parciales multimoneda.
 *  - Cuentas bancarias con saldo calculado desde movimientos.
 */
import { and, desc, eq } from "drizzle-orm";
import Decimal from "decimal.js";

import { convert, d, money } from "@/core/currency/calculator";
import type { AnyListoPOSDb } from "@/core/db-cloud/db-types";
import * as s from "@/core/db-cloud/schema";
import type { PaymentLike } from "@/modules/fiscal/taxes";

/* ------------------------------------------------------------------ */
/* Caja: apertura y cierre Z                                          */
/* ------------------------------------------------------------------ */

export interface OpenRegisterInput {
  warehouseId?: string;
  openingBalanceUsd: Decimal.Value;
  openingBalanceVes: Decimal.Value;
  userId?: string;
}

export async function openRegister(
  db: AnyListoPOSDb,
  orgId: string,
  input: OpenRegisterInput,
) {
  const [existing] = await db
    .select()
    .from(s.cashRegisters)
    .where(
      and(
        eq(s.cashRegisters.organizationId, orgId),
        eq(s.cashRegisters.status, "open"),
      ),
    )
    .limit(1);
  if (existing) {
    throw new Error("Ya hay un turno de caja abierto. Ciérralo primero.");
  }
  const [register] = await db
    .insert(s.cashRegisters)
    .values({
      organizationId: orgId,
      warehouseId: input.warehouseId ?? null,
      openedByUserId: input.userId ?? null,
      openingBalanceUsd: money(input.openingBalanceUsd).toFixed(2),
      openingBalanceVes: money(input.openingBalanceVes).toFixed(2),
      status: "open",
    })
    .returning();
  return register;
}

export interface CloseRegisterInput {
  countedUsd: Decimal.Value;
  countedVes: Decimal.Value;
  userId?: string;
  notes?: string;
}

export interface CloseRegisterResult {
  registerId: string;
  expectedUsd: string;
  expectedVes: string;
  countedUsd: string;
  countedVes: string;
  diffUsd: string;
  diffVes: string;
}

/**
 * Cierre Z: compara lo esperado (apertura + ventas + movimientos manuales)
 * contra lo contado físicamente por el cajero.
 */
export async function closeRegister(
  db: AnyListoPOSDb,
  orgId: string,
  registerId: string,
  input: CloseRegisterInput,
): Promise<CloseRegisterResult> {
  const [register] = await db
    .select()
    .from(s.cashRegisters)
    .where(
      and(
        eq(s.cashRegisters.id, registerId),
        eq(s.cashRegisters.organizationId, orgId),
      ),
    )
    .limit(1);
  if (!register) throw new Error("Turno no encontrado");
  if (register.status !== "open") throw new Error("El turno ya está cerrado");

  // Ventas del turno por moneda (desde los pagos asociados a facturas del turno).
  const salesPayments = await db
    .select({
      currency: s.payments.currency,
      amount: s.payments.amount,
    })
    .from(s.payments)
    .innerJoin(s.invoices, eq(s.payments.invoiceId, s.invoices.id))
    .where(
      and(
        eq(s.payments.organizationId, orgId),
        eq(s.invoices.cashRegisterId, registerId),
      ),
    );

  // Movimientos manuales del turno.
  const manual = await db
    .select()
    .from(s.cashMovements)
    .where(eq(s.cashMovements.cashRegisterId, registerId));

  const sumByCurrency = (
    rows: { currency: string; amount: string }[],
    currency: string,
  ) =>
    money(
      rows
        .filter((r) => r.currency === currency)
        .reduce((acc, r) => acc.plus(d(r.amount)), new Decimal(0)),
    );

  const salesUsd = sumByCurrency(salesPayments, "usd");
  const salesVes = sumByCurrency(salesPayments, "ves");
  const manualUsd = manual
    .filter((m) => m.currency === "usd")
    .reduce(
      (acc, m) =>
        acc.plus(m.type === "income" ? d(m.amount) : d(m.amount).neg()),
      new Decimal(0),
    );
  const manualVes = manual
    .filter((m) => m.currency === "ves")
    .reduce(
      (acc, m) =>
        acc.plus(m.type === "income" ? d(m.amount) : d(m.amount).neg()),
      new Decimal(0),
    );

  const expectedUsd = money(
    d(register.openingBalanceUsd).plus(salesUsd).plus(manualUsd),
  );
  const expectedVes = money(
    d(register.openingBalanceVes).plus(salesVes).plus(manualVes),
  );
  const countedUsd = money(input.countedUsd);
  const countedVes = money(input.countedVes);

  await db
    .update(s.cashRegisters)
    .set({
      status: "closed",
      closedAt: new Date(),
      countedUsd: countedUsd.toFixed(2),
      countedVes: countedVes.toFixed(2),
      closedByUserId: input.userId ?? null,
      notes: input.notes ?? null,
    })
    .where(eq(s.cashRegisters.id, registerId));

  return {
    registerId,
    expectedUsd: expectedUsd.toFixed(2),
    expectedVes: expectedVes.toFixed(2),
    countedUsd: countedUsd.toFixed(2),
    countedVes: countedVes.toFixed(2),
    diffUsd: countedUsd.minus(expectedUsd).toFixed(2),
    diffVes: countedVes.minus(expectedVes).toFixed(2),
  };
}

export interface CashMovementInput {
  cashRegisterId: string;
  type: "income" | "expense";
  method: typeof s.paymentMethod.enumValues[number];
  currency: "usd" | "ves";
  amount: Decimal.Value;
  reason?: string;
  userId?: string;
}

export async function registerCashMovement(
  db: AnyListoPOSDb,
  orgId: string,
  input: CashMovementInput,
) {
  const [register] = await db
    .select()
    .from(s.cashRegisters)
    .where(
      and(
        eq(s.cashRegisters.id, input.cashRegisterId),
        eq(s.cashRegisters.organizationId, orgId),
      ),
    )
    .limit(1);
  if (!register) throw new Error("Turno no encontrado");
  if (register.status !== "open") {
    throw new Error("El turno está cerrado: no se pueden registrar movimientos");
  }
  const [movement] = await db
    .insert(s.cashMovements)
    .values({
      organizationId: orgId,
      cashRegisterId: input.cashRegisterId,
      type: input.type,
      method: input.method,
      currency: input.currency,
      amount: money(input.amount).toFixed(2),
      reason: input.reason ?? null,
      createdByUserId: input.userId ?? null,
    })
    .returning();
  return movement;
}

/* ------------------------------------------------------------------ */
/* Cuentas por cobrar / pagar                                         */
/* ------------------------------------------------------------------ */

export async function ledgerList(
  db: AnyListoPOSDb,
  orgId: string,
  type: "receivable" | "payable",
) {
  return db
    .select({
      id: s.accountsLedger.id,
      contactId: s.accountsLedger.contactId,
      contactName: s.contacts.name,
      invoiceId: s.accountsLedger.invoiceId,
      amountUsd: s.accountsLedger.amountUsd,
      amountVes: s.accountsLedger.amountVes,
      paidUsd: s.accountsLedger.paidUsd,
      paidVes: s.accountsLedger.paidVes,
      dueDate: s.accountsLedger.dueDate,
      status: s.accountsLedger.status,
      notes: s.accountsLedger.notes,
      createdAt: s.accountsLedger.createdAt,
    })
    .from(s.accountsLedger)
    .leftJoin(s.contacts, eq(s.accountsLedger.contactId, s.contacts.id))
    .where(
      and(
        eq(s.accountsLedger.organizationId, orgId),
        eq(s.accountsLedger.type, type),
      ),
    )
    .orderBy(desc(s.accountsLedger.createdAt));
}

export interface AbonoInput {
  ledgerId: string;
  method: typeof s.paymentMethod.enumValues[number];
  currency: PaymentLike["currency"];
  amount: Decimal.Value;
  reference?: string;
  note?: string;
}

/** Registra un abono parcial multimoneda y actualiza el estado de la cuenta. */
export async function registerAbono(
  db: AnyListoPOSDb,
  orgId: string,
  input: AbonoInput,
) {
  const [entry] = await db
    .select()
    .from(s.accountsLedger)
    .where(
      and(
        eq(s.accountsLedger.id, input.ledgerId),
        eq(s.accountsLedger.organizationId, orgId),
      ),
    )
    .limit(1);
  if (!entry) throw new Error("Cuenta no encontrada");
  if (entry.status === "paid") throw new Error("La cuenta ya está saldada");

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
  if (!usdRate) throw new Error("No hay tasa USD activa para registrar abonos");

  const amountUsd = convert(input.amount, input.currency, "usd", {
    usdToVes: usdRate.rateToVes,
    eurToVes: usdRate.rateToVes,
  });
  const amountVes = convert(input.amount, input.currency, "ves", {
    usdToVes: usdRate.rateToVes,
    eurToVes: usdRate.rateToVes,
  });

  const newPaidUsd = d(entry.paidUsd).plus(amountUsd);
  const newPaidVes = d(entry.paidVes).plus(amountVes);
  const status: typeof s.ledgerEntryStatus.enumValues[number] =
    newPaidUsd.gte(entry.amountUsd) ? "paid" : "partial";

  await db.insert(s.ledgerPayments).values({
    organizationId: orgId,
    ledgerId: input.ledgerId,
    method: input.method,
    currency: input.currency,
    amountUsd: amountUsd.toFixed(2),
    amountVes: amountVes.toFixed(2),
    reference: input.reference ?? null,
    note: input.note ?? null,
  });

  await db
    .update(s.accountsLedger)
    .set({
      paidUsd: newPaidUsd.toFixed(2),
      paidVes: newPaidVes.toFixed(2),
      status,
      updatedAt: new Date(),
    })
    .where(eq(s.accountsLedger.id, entry.id));

  return { ok: true, status };
}

/* ------------------------------------------------------------------ */
/* Bancos y billeteras                                                */
/* ------------------------------------------------------------------ */

export interface BankAccountInput {
  name: string;
  type: "bank" | "zelle" | "pago_movil" | "cash";
  currency: "usd" | "ves";
  bankName?: string;
  accountNumber?: string;
  phone?: string;
  initialBalanceUsd?: Decimal.Value;
  initialBalanceVes?: Decimal.Value;
}

export async function createBankAccount(
  db: AnyListoPOSDb,
  orgId: string,
  input: BankAccountInput,
) {
  const [account] = await db
    .insert(s.bankAccounts)
    .values({
      organizationId: orgId,
      name: input.name,
      type: input.type,
      currency: input.currency,
      bankName: input.bankName ?? null,
      accountNumber: input.accountNumber ?? null,
      phone: input.phone ?? null,
      initialBalanceUsd: money(input.initialBalanceUsd ?? 0).toFixed(2),
      initialBalanceVes: money(input.initialBalanceVes ?? 0).toFixed(2),
    })
    .returning();
  return account;
}

/** Lista bancos con saldo calculado: inicial + entradas - salidas. */
export async function bankList(db: AnyListoPOSDb, orgId: string) {
  const accounts = await db
    .select()
    .from(s.bankAccounts)
    .where(eq(s.bankAccounts.organizationId, orgId));
  const movements = await db
    .select()
    .from(s.bankMovements)
    .where(eq(s.bankMovements.organizationId, orgId));

  return accounts.map((account) => {
    const balanceUsd = account.currency === "usd"
      ? movements
          .filter((m) => m.bankAccountId === account.id && m.currency === "usd")
          .reduce(
            (acc, m) =>
              acc.plus(m.direction === "in" ? d(m.amount) : d(m.amount).neg()),
            d(account.initialBalanceUsd),
          )
      : d(account.initialBalanceUsd);
    const balanceVes = account.currency === "ves"
      ? movements
          .filter((m) => m.bankAccountId === account.id && m.currency === "ves")
          .reduce(
            (acc, m) =>
              acc.plus(m.direction === "in" ? d(m.amount) : d(m.amount).neg()),
            d(account.initialBalanceVes),
          )
      : d(account.initialBalanceVes);
    return {
      ...account,
      balanceUsd: money(balanceUsd).toFixed(2),
      balanceVes: money(balanceVes).toFixed(2),
      movementCount: movements.filter((m) => m.bankAccountId === account.id).length,
    };
  });
}
