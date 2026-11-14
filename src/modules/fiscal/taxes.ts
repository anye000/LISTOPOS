/**
 * Motor fiscal venezolano — IVA, IGTF y vueltos multimoneda.
 *
 * Reglas implementadas:
 *  - IVA 16% (o exento por línea) sobre la base imponible con descuento.
 *  - IGTF 3% SOLO sobre la porción pagada en divisas (USD/EUR), nunca en Bs.
 *  - Vueltos mixtos exactos: cambio en USD, en Bs o combinado.
 *  - Todo con decimal.js (precisión centavo a centavo).
 */
import Decimal from "decimal.js";

import {
  convert,
  d,
  money,
  percentOf,
  rate,
  sum,
  type CurrencyCode,
  type RateTable,
} from "@/core/currency/calculator";

export const VAT_RATE_PERCENT = "16";
export const IGTF_RATE_PERCENT = "3";

/* ------------------------------------------------------------------ */
/* Cálculo de factura (subtotal, descuento, IVA)                      */
/* ------------------------------------------------------------------ */

export interface InvoiceLineInput {
  quantity: Decimal.Value;
  unitPriceUsd: Decimal.Value;
  exemptVat?: boolean;
}

export interface InvoiceLineResult {
  quantity: string;
  unitPriceUsd: string;
  exemptVat: boolean;
  totalUsd: string;
  totalVes: string;
}

export interface InvoiceTotals {
  lines: InvoiceLineResult[];
  subtotalUsd: string;
  discountUsd: string;
  taxableBaseUsd: string;
  vatUsd: string;
  totalUsd: string;
  subtotalVes: string;
  discountVes: string;
  taxableBaseVes: string;
  vatVes: string;
  totalVes: string;
}

export function calcInvoiceTotals(
  lines: InvoiceLineInput[],
  opts: {
    usdToVes: Decimal.Value;
    eurToVes: Decimal.Value;
    vatRatePercent?: Decimal.Value;
    discountUsd?: Decimal.Value;
  },
): InvoiceTotals {
  if (lines.length === 0) {
    throw new Error("La factura debe tener al menos una línea");
  }
  const usdRate = rate(opts.usdToVes);
  const vatRate = opts.vatRatePercent ?? VAT_RATE_PERCENT;

  const computed: InvoiceLineResult[] = lines.map((l) => {
    const totalUsd = money(d(l.quantity).mul(d(l.unitPriceUsd)));
    return {
      quantity: d(l.quantity).toString(),
      unitPriceUsd: money(l.unitPriceUsd).toFixed(2),
      exemptVat: l.exemptVat ?? false,
      totalUsd: totalUsd.toFixed(2),
      totalVes: money(totalUsd.mul(usdRate)).toFixed(2),
    };
  });

  const subtotalUsd = sum(computed.map((l) => l.totalUsd));
  const discountUsd = money(opts.discountUsd ?? 0);
  if (discountUsd.gt(subtotalUsd)) {
    throw new Error("El descuento no puede superar el subtotal");
  }

  const taxableUsd = sum(
    computed.filter((l) => !l.exemptVat).map((l) => l.totalUsd),
  );
  const taxableBaseUsd = Decimal.max(0, taxableUsd.minus(discountUsd));
  const vatUsd = percentOf(taxableBaseUsd, vatRate);
  const totalUsd = money(subtotalUsd.minus(discountUsd).plus(vatUsd));

  const subtotalVes = sum(computed.map((l) => l.totalVes));
  const discountVes = money(discountUsd.mul(usdRate));
  const taxableBaseVes = money(taxableBaseUsd.mul(usdRate));
  const vatVes = money(vatUsd.mul(usdRate));
  const totalVes = money(subtotalVes.minus(discountVes).plus(vatVes));

  return {
    lines: computed,
    subtotalUsd: subtotalUsd.toFixed(2),
    discountUsd: discountUsd.toFixed(2),
    taxableBaseUsd: taxableBaseUsd.toFixed(2),
    vatUsd: vatUsd.toFixed(2),
    totalUsd: totalUsd.toFixed(2),
    subtotalVes: subtotalVes.toFixed(2),
    discountVes: discountVes.toFixed(2),
    taxableBaseVes: taxableBaseVes.toFixed(2),
    vatVes: vatVes.toFixed(2),
    totalVes: totalVes.toFixed(2),
  };
}

/* ------------------------------------------------------------------ */
/* IGTF 3% — solo sobre pagos en divisas                              */
/* ------------------------------------------------------------------ */

export interface PaymentLike {
  currency: CurrencyCode;
  amount: Decimal.Value;
  method?: string;
}

export interface IgtfResult {
  baseUsd: string;
  igtfUsd: string;
  igtfVes: string;
}

export function calcIgtf(
  payments: PaymentLike[],
  opts: {
    igtfRatePercent?: Decimal.Value;
    usdToVes: Decimal.Value;
    eurToVes: Decimal.Value;
  },
): IgtfResult {
  const rates: RateTable = {
    usdToVes: opts.usdToVes,
    eurToVes: opts.eurToVes,
  };
  // IGTF grava solo pagos en divisas; las ventas a crédito no son pagos.
  const foreign = payments.filter(
    (p) => p.currency !== "ves" && p.method !== "credit",
  );
  const baseUsd = sum(
    foreign.map((p) => convert(p.amount, p.currency, "usd", rates)),
  );
  const igtfUsd = percentOf(baseUsd, opts.igtfRatePercent ?? IGTF_RATE_PERCENT);
  const igtfVes = money(igtfUsd.mul(rate(opts.usdToVes)));
  return {
    baseUsd: baseUsd.toFixed(2),
    igtfUsd: igtfUsd.toFixed(2),
    igtfVes: igtfVes.toFixed(2),
  };
}

/* ------------------------------------------------------------------ */
/* Cobertura de pago y vueltos mixtos                                 */
/* ------------------------------------------------------------------ */

export class InsufficientPaymentError extends Error {
  constructor(public missingUsd: string) {
    super(`Pago insuficiente: faltan ${missingUsd} USD`);
    this.name = "InsufficientPaymentError";
  }
}

export interface CoverageResult {
  receivedUsdEquivalent: string;
  covered: boolean;
  missingUsd: string;
}

/** Convierte todos los pagos a su equivalente en USD y verifica cobertura. */
export function paymentsCoverage(
  payments: PaymentLike[],
  totalUsd: Decimal.Value,
  rates: RateTable,
): CoverageResult {
  // Las ventas a crédito no cubren el total: dejan la factura "a crédito".
  const received = sum(
    payments
      .filter((p) => p.method !== "credit")
      .map((p) => convert(p.amount, p.currency, "usd", rates)),
  );
  const total = money(totalUsd);
  const missing = Decimal.max(0, total.minus(received));
  return {
    receivedUsdEquivalent: received.toFixed(2),
    covered: received.gte(total),
    missingUsd: missing.toFixed(2),
  };
}

export interface ChangeResult {
  pendingUsd: string;
  changeUsd: string;
  changeVes: string;
}

/**
 * Calcula el vuelto exacto de un pago mixto.
 *
 * - `changeIn: "usd"` → todo el vuelto en dólares.
 * - `changeIn: "ves"` → todo el vuelto en bolívares.
 * - `changeIn: "auto"` (defecto) → vuelto en USD hasta lo recibido en USD y el
 *   resto en bolívares (comportamiento natural del POS venezolano).
 * - `maxChangeUsd` limita el vuelto en USD; el excedente va a bolívares.
 */
export function splitChange(opts: {
  totalUsd: Decimal.Value;
  receivedUsd: Decimal.Value;
  receivedVes: Decimal.Value;
  rates: RateTable;
  changeIn?: "usd" | "ves" | "auto";
  maxChangeUsd?: Decimal.Value;
}): ChangeResult {
  const total = money(opts.totalUsd);
  const receivedUsd = money(opts.receivedUsd);
  const receivedVesUsd = convert(opts.receivedVes, "ves", "usd", opts.rates);
  const pending = money(receivedUsd.plus(receivedVesUsd).minus(total));
  if (pending.lt(0)) {
    throw new InsufficientPaymentError(pending.abs().toFixed(2));
  }

  let changeUsd: Decimal;
  switch (opts.changeIn ?? "auto") {
    case "usd":
      changeUsd = pending;
      break;
    case "ves":
      changeUsd = new Decimal(0);
      break;
    case "auto":
      changeUsd = Decimal.min(pending, receivedUsd);
      break;
  }
  if (opts.maxChangeUsd !== undefined) {
    changeUsd = Decimal.min(changeUsd, money(opts.maxChangeUsd));
  }
  const changeVes = convert(pending.minus(changeUsd), "usd", "ves", opts.rates);

  return {
    pendingUsd: pending.toFixed(2),
    changeUsd: changeUsd.toFixed(2),
    changeVes: changeVes.toFixed(2),
  };
}
