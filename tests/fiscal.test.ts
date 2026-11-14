import { describe, expect, it } from "vitest";

import {
  calcIgtf,
  calcInvoiceTotals,
  InsufficientPaymentError,
  paymentsCoverage,
  splitChange,
} from "@/modules/fiscal/taxes";

const RATES = { usdToVes: "36.500000", eurToVes: "40.150000" };

describe("Motor fiscal — IVA 16%", () => {
  it("calcula IVA solo sobre líneas no exentas", () => {
    const t = calcInvoiceTotals(
      [
        { quantity: "2", unitPriceUsd: "10.00", exemptVat: true },
        { quantity: "1", unitPriceUsd: "8.50" },
      ],
      RATES,
    );
    expect(t.subtotalUsd).toBe("28.50");
    expect(t.taxableBaseUsd).toBe("8.50");
    expect(t.vatUsd).toBe("1.36");
    expect(t.totalUsd).toBe("29.86");
    expect(t.totalVes).toBe("1089.89");
  });

  it("aplica el descuento antes de calcular el IVA", () => {
    const t = calcInvoiceTotals(
      [
        { quantity: "2", unitPriceUsd: "10.00", exemptVat: true },
        { quantity: "1", unitPriceUsd: "8.50" },
      ],
      { ...RATES, discountUsd: "2.00" },
    );
    expect(t.taxableBaseUsd).toBe("6.50");
    expect(t.vatUsd).toBe("1.04");
    expect(t.totalUsd).toBe("27.54");
    expect(t.totalVes).toBe("1005.21");
  });

  it("rechaza descuentos mayores al subtotal", () => {
    expect(() =>
      calcInvoiceTotals(
        [{ quantity: "1", unitPriceUsd: "10.00" }],
        { ...RATES, discountUsd: "20.00" },
      ),
    ).toThrow(/descuento/);
  });

  it("rechaza facturas sin líneas", () => {
    expect(() => calcInvoiceTotals([], RATES)).toThrow(/línea/);
  });
});

describe("Motor fiscal — IGTF 3% solo en divisas", () => {
  it("grava únicamente la porción pagada en USD", () => {
    const r = calcIgtf(
      [
        { currency: "usd", amount: "10.00" },
        { currency: "ves", amount: "182.50" }, // 5 USD al BCV
      ],
      RATES,
    );
    expect(r.baseUsd).toBe("10.00");
    expect(r.igtfUsd).toBe("0.30");
    expect(r.igtfVes).toBe("10.95");
  });

  it("convierte pagos en EUR a USD para la base imponible", () => {
    const r = calcIgtf([{ currency: "eur", amount: "4.015" }], RATES);
    expect(r.baseUsd).toBe("4.42");
    expect(r.igtfUsd).toBe("0.13");
    expect(r.igtfVes).toBe("4.75");
  });

  it("no cobra IGTF cuando todo se paga en bolívares", () => {
    const r = calcIgtf([{ currency: "ves", amount: "500.00" }], RATES);
    expect(r.baseUsd).toBe("0.00");
    expect(r.igtfUsd).toBe("0.00");
    expect(r.igtfVes).toBe("0.00");
  });

  it("respeta una tasa de IGTF personalizada", () => {
    const r = calcIgtf(
      [{ currency: "usd", amount: "100.00" }],
      { ...RATES, igtfRatePercent: "5" },
    );
    expect(r.igtfUsd).toBe("5.00");
  });

  it("una venta a crédito no genera IGTF ni cubre el total", () => {
    const r = calcIgtf(
      [{ currency: "usd", amount: "100.00", method: "credit" }],
      RATES,
    );
    expect(r.igtfUsd).toBe("0.00");

    const c = paymentsCoverage(
      [{ currency: "usd", amount: "100.00", method: "credit" }],
      "100.00",
      RATES,
    );
    expect(c.covered).toBe(false);
    expect(c.missingUsd).toBe("100.00");
  });
});

describe("Vueltos mixtos", () => {
  it("devuelve el cambio en USD cuando se pagó en USD", () => {
    const r = splitChange({
      totalUsd: "12.34",
      receivedUsd: "20.00",
      receivedVes: "0",
      rates: RATES,
    });
    expect(r.pendingUsd).toBe("7.66");
    expect(r.changeUsd).toBe("7.66");
    expect(r.changeVes).toBe("0.00");
  });

  it("devuelve todo el cambio en bolívares si se solicita", () => {
    const r = splitChange({
      totalUsd: "12.34",
      receivedUsd: "20.00",
      receivedVes: "0",
      rates: RATES,
      changeIn: "ves",
    });
    expect(r.changeUsd).toBe("0.00");
    expect(r.changeVes).toBe("279.59");
  });

  it("mezcla el cambio: USD limitado y el resto en bolívares", () => {
    const r = splitChange({
      totalUsd: "12.34",
      receivedUsd: "20.00",
      receivedVes: "0",
      rates: RATES,
      maxChangeUsd: "5.00",
    });
    expect(r.changeUsd).toBe("5.00");
    expect(r.changeVes).toBe("97.09");
  });

  it("si el cliente pagó solo en Bs, el vuelto sale en Bs", () => {
    const r = splitChange({
      totalUsd: "10.00",
      receivedUsd: "0",
      receivedVes: "730.00",
      rates: RATES,
    });
    expect(r.pendingUsd).toBe("10.00");
    expect(r.changeUsd).toBe("0.00");
    expect(r.changeVes).toBe("365.00");
  });

  it("lanza error cuando el pago es insuficiente", () => {
    expect(() =>
      splitChange({
        totalUsd: "100.00",
        receivedUsd: "50.00",
        receivedVes: "0",
        rates: RATES,
      }),
    ).toThrow(InsufficientPaymentError);
  });
});

describe("Cobertura de pagos", () => {
  it("suma los equivalentes en USD de todos los métodos", () => {
    const c = paymentsCoverage(
      [
        { currency: "usd", amount: "5.00" },
        { currency: "ves", amount: "182.50" },
      ],
      "10.00",
      RATES,
    );
    expect(c.receivedUsdEquivalent).toBe("10.00");
    expect(c.covered).toBe(true);
    expect(c.missingUsd).toBe("0.00");
  });

  it("reporta el faltante cuando no cubre el total", () => {
    const c = paymentsCoverage(
      [{ currency: "usd", amount: "4.00" }],
      "10.00",
      RATES,
    );
    expect(c.covered).toBe(false);
    expect(c.missingUsd).toBe("6.00");
  });
});

describe("Inmutabilidad histórica (ARCHITECTURE.md §4.2)", () => {
  it("una factura guarda la tasa usada: recalcular con otra tasa cambia los totales", () => {
    const vieja = calcInvoiceTotals(
      [{ quantity: "1", unitPriceUsd: "100.00" }],
      { usdToVes: "36.500000", eurToVes: "40.150000" },
    );
    const nueva = calcInvoiceTotals(
      [{ quantity: "1", unitPriceUsd: "100.00" }],
      { usdToVes: "38.900000", eurToVes: "42.000000" },
    );
    expect(vieja.totalVes).toBe("4234.00"); // 3650 + IVA 584
    expect(nueva.totalVes).toBe("4512.40"); // 3890 + IVA 622.40
    expect(vieja.totalVes).not.toBe(nueva.totalVes);
    // Recalcular con la tasa del snapshot original devuelve el mismo total:
    const recalculo = calcInvoiceTotals(
      [{ quantity: "1", unitPriceUsd: "100.00" }],
      { usdToVes: "36.500000", eurToVes: "40.150000" },
    );
    expect(recalculo.totalVes).toBe(vieja.totalVes);
  });
});
