import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";

import {
  convert,
  d,
  eurToUsd,
  money,
  percentOf,
  rate,
  sum,
  usdToVes,
  vesToUsd,
} from "@/core/currency/calculator";
import { formatMoney } from "@/core/currency/format";

const RATES = { usdToVes: "36.500000", eurToVes: "40.150000" };

describe("currency/calculator — conversión exacta", () => {
  it("convierte USD a Bs y de vuelta sin pérdida", () => {
    expect(usdToVes("10", "36.5").toFixed(2)).toBe("365.00");
    expect(vesToUsd("365", "36.5").toFixed(2)).toBe("10.00");
  });

  it("convierte EUR a USD por tasa cruzada BCV (1 EUR = 1.1 USD)", () => {
    expect(eurToUsd("100", RATES).toFixed(2)).toBe("110.00");
  });

  it("convierte Bs a EUR", () => {
    expect(convert("4015", "ves", "eur", RATES).toFixed(2)).toBe("100.00");
  });

  it("devuelve el mismo monto al convertir a la misma moneda", () => {
    expect(convert("12.34", "usd", "usd", RATES).toFixed(2)).toBe("12.34");
  });

  it("redondea half-up a centavos", () => {
    expect(usdToVes("123.456", "36.5").toFixed(2)).toBe("4506.14");
    expect(money("36.685").toFixed(2)).toBe("36.69");
    expect(money("36.684").toFixed(2)).toBe("36.68");
  });

  it("no acumula errores de punto flotante", () => {
    expect(sum(["0.1", "0.2"]).toFixed(2)).toBe("0.30");
    expect(new Decimal("0.1").plus("0.2").toNumber()).toBe(0.3);
  });

  it("calcula porcentajes exactos", () => {
    expect(percentOf("200", "3").toFixed(2)).toBe("6.00");
  });
});

describe("currency/calculator — validaciones", () => {
  it("rechaza tasas cero o negativas", () => {
    expect(() => rate("0")).toThrow();
    expect(() => rate("-5")).toThrow();
  });

  it("rechaza valores no finitos", () => {
    expect(() => d("abc")).toThrow();
    expect(() => d(Infinity)).toThrow();
  });
});

describe("currency/format — formato para pantalla", () => {
  it("formatea las tres monedas", () => {
    expect(formatMoney("1234.5", "usd")).toBe("$1,234.50");
    expect(formatMoney("1234.5", "ves")).toBe("Bs 1.234,50");
    expect(formatMoney("1234.5", "eur")).toBe("€1.234,50");
  });
});
