import Decimal from "decimal.js";

import type { CurrencyCode } from "./calculator";

export const CURRENCY_SYMBOLS: Record<CurrencyCode, string> = {
  usd: "$",
  ves: "Bs",
  eur: "€",
};

const usdFmt = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const vesFmt = new Intl.NumberFormat("es-VE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const eurFmt = new Intl.NumberFormat("es-VE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Formatea un monto para mostrar: `$1,234.56`, `Bs 1.234,56`, `€1.234,56`. */
export function formatMoney(value: Decimal.Value, currency: CurrencyCode): string {
  const n = new Decimal(value).toNumber();
  switch (currency) {
    case "usd":
      return `$${usdFmt.format(n)}`;
    case "eur":
      return `€${eurFmt.format(n)}`;
    case "ves":
      return `Bs ${vesFmt.format(n)}`;
  }
}

/** Formatea una tasa BCV (4 decimales máx., estilo es-VE). */
export function formatRate(value: Decimal.Value): string {
  return new Decimal(value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toString();
}
