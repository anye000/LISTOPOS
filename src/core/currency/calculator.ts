/**
 * Conversor de moneda exacto — Bs / USD / EUR.
 *
 * REGLA (ARCHITECTURE.md): PROHIBIDO usar `number` nativo de JS para
 * operaciones financieras. Todo cálculo pasa por decimal.js y los montos se
 * redondean con ROUND_HALF_UP a 2 decimales; las tasas a 6 decimales.
 */
import Decimal from "decimal.js";

export type CurrencyCode = "usd" | "ves" | "eur";

export const MONEY_DECIMALS = 2;
export const QUANTITY_DECIMALS = 4;
export const RATE_DECIMALS = 6;

/** Valida que un valor decimal sea finito (sin redondear). */
export function d(value: Decimal.Value): Decimal {
  const dec = new Decimal(value);
  if (!dec.isFinite()) {
    throw new Error(`Valor monetario inválido: ${String(value)}`);
  }
  return dec;
}

/** Redondea a centavos (ROUND_HALF_UP). */
export function money(value: Decimal.Value): Decimal {
  return d(value).toDecimalPlaces(MONEY_DECIMALS, Decimal.ROUND_HALF_UP);
}

/** Redondea cantidades de inventario (4 decimales por defecto). */
export function quantity(
  value: Decimal.Value,
  decimals: number = QUANTITY_DECIMALS,
): Decimal {
  return d(value).toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP);
}

/** Valida y normaliza una tasa de cambio (positiva, 6 decimales). */
export function rate(value: Decimal.Value): Decimal {
  const dec = d(value);
  if (dec.lte(0)) {
    throw new Error(`Tasa de cambio inválida: ${String(value)}`);
  }
  return dec.toDecimalPlaces(RATE_DECIMALS, Decimal.ROUND_HALF_UP);
}

export interface RateTable {
  /** Bolívares por 1 USD. */
  usdToVes: Decimal.Value;
  /** Bolívares por 1 EUR. */
  eurToVes: Decimal.Value;
}

/** Unidades de cada moneda equivalentes a 1 USD (para conversión genérica). */
function unitsPerUsd(rates: RateTable): Record<CurrencyCode, Decimal> {
  const usd = rate(rates.usdToVes);
  const eur = rate(rates.eurToVes);
  return {
    usd: new Decimal(1),
    ves: usd,
    eur: usd.div(eur),
  };
}

/** Conversión exacta entre cualquier par de monedas (vía USD). */
export function convert(
  amount: Decimal.Value,
  from: CurrencyCode,
  to: CurrencyCode,
  rates: RateTable,
): Decimal {
  if (from === to) return money(amount);
  const table = unitsPerUsd(rates);
  const usdValue = d(amount).div(table[from]);
  return money(usdValue.mul(table[to]));
}

export function usdToVes(
  amountUsd: Decimal.Value,
  usdToVesRate: Decimal.Value,
): Decimal {
  return money(d(amountUsd).mul(rate(usdToVesRate)));
}

export function vesToUsd(
  amountVes: Decimal.Value,
  usdToVesRate: Decimal.Value,
): Decimal {
  return money(d(amountVes).div(rate(usdToVesRate)));
}

export function eurToVes(
  amountEur: Decimal.Value,
  eurToVesRate: Decimal.Value,
): Decimal {
  return money(d(amountEur).mul(rate(eurToVesRate)));
}

export function vesToEur(
  amountVes: Decimal.Value,
  eurToVesRate: Decimal.Value,
): Decimal {
  return money(d(amountVes).div(rate(eurToVesRate)));
}

/** EUR → USD usando la tasa cruzada BCV (EUR→VES→USD). */
export function eurToUsd(amountEur: Decimal.Value, rates: RateTable): Decimal {
  return convert(amountEur, "eur", "usd", rates);
}

export function usdToEur(amountUsd: Decimal.Value, rates: RateTable): Decimal {
  return convert(amountUsd, "usd", "eur", rates);
}

/** Suma exacta de montos, redondeada a centavos. */
export function sum(values: Decimal.Value[]): Decimal {
  return money(
    values.reduce<Decimal>((acc, v) => acc.plus(d(v)), new Decimal(0)),
  );
}

/** Porcentaje exacto de un monto (ej. IVA 16%). */
export function percentOf(
  amount: Decimal.Value,
  percentValue: Decimal.Value,
): Decimal {
  return money(d(amount).mul(d(percentValue)).div(100));
}
