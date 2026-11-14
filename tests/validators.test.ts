import { describe, expect, it } from "vitest";

import {
  exchangeRateInputSchema,
  invoiceInputSchema,
  productInputSchema,
  registerOrganizationInputSchema,
} from "@/modules/fiscal/validators";

const item = { name: "Café", quantity: "2", unitPriceUsd: "1.50" };

describe("Validadores — facturas y pagos", () => {
  it("acepta una factura válida con pagos mixtos", () => {
    const r = invoiceInputSchema.safeParse({
      items: [item],
      payments: [{ method: "cash_usd", currency: "usd", amount: "3.00" }],
    });
    expect(r.success).toBe(true);
  });

  it("aplica valores por defecto (descuento, tipo factura)", () => {
    const r = invoiceInputSchema.safeParse({ items: [item] });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.type).toBe("invoice");
      expect(r.data.discountUsd).toBe("0");
      expect(r.data.payments).toEqual([]);
    }
  });

  it("rechaza pagos dentro de un presupuesto", () => {
    const r = invoiceInputSchema.safeParse({
      type: "quote",
      items: [item],
      payments: [{ method: "cash_usd", currency: "usd", amount: "3.00" }],
    });
    expect(r.success).toBe(false);
  });

  it("rechaza montos con más de 4 decimales o negativos", () => {
    expect(
      invoiceInputSchema.safeParse({
        items: [{ name: "X", quantity: "12.34567", unitPriceUsd: "1" }],
      }).success,
    ).toBe(false);
    expect(
      invoiceInputSchema.safeParse({
        items: [{ name: "X", quantity: "-1", unitPriceUsd: "1" }],
      }).success,
    ).toBe(false);
  });

  it("exige al menos una línea", () => {
    expect(invoiceInputSchema.safeParse({ items: [] }).success).toBe(false);
  });
});

describe("Validadores — organización y tasas", () => {
  it("valida el slug (minúsculas, números y guiones)", () => {
    const base = {
      companyName: "Mi Empresa",
      userName: "Ana",
      email: "ana@listopos.com",
      password: "secreto123",
    };
    expect(
      registerOrganizationInputSchema.safeParse({ ...base, slug: "mi-empresa" })
        .success,
    ).toBe(true);
    expect(
      registerOrganizationInputSchema.safeParse({ ...base, slug: "Mi Empresa" })
        .success,
    ).toBe(false);
  });

  it("valida el formato ISO de la fecha de la tasa BCV", () => {
    const base = { currency: "usd", rateToVes: "36.5" };
    expect(
      exchangeRateInputSchema.safeParse({ ...base, date: "2026-11-14" }).success,
    ).toBe(true);
    expect(
      exchangeRateInputSchema.safeParse({ ...base, date: "14/11/2026" }).success,
    ).toBe(false);
  });

  it("rechaza tasas con más de 6 decimales", () => {
    expect(
      exchangeRateInputSchema.safeParse({
        currency: "usd",
        rateToVes: "36.1234567",
        date: "2026-11-14",
      }).success,
    ).toBe(false);
  });

  it("valida un producto con costo y margen", () => {
    const r = productInputSchema.safeParse({
      name: "Arepa Reina Pepiada",
      costUsd: "1.50",
      marginPercent: "60",
    });
    expect(r.success).toBe(true);
  });
});
