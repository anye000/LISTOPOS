/**
 * Contrato del esquema cloud — verifica estáticamente las reglas
 * inquebrantables del ARCHITECTURE.md §4 sin necesidad de una conexión:
 *
 *  1. Toda tabla de negocio incluye `organizationId`.
 *  2. Las facturas guardan `exchangeRateSnapshot` (inmutabilidad histórica)
 *     y totales en USD y VES.
 */
import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

import * as s from "@/core/db-cloud/schema";

const TABLES_WITHOUT_ORG_ID = new Set([
  "user",
  "session",
  "account",
  "verification",
  "organizations", // es la raíz del tenant: su id ES el organizationId
]);

describe("Contrato del esquema cloud (ARCHITECTURE.md §4)", () => {
  it("toda tabla de negocio incluye organizationId", () => {
    const business = Object.entries(s.schema).filter(
      ([name]) => !TABLES_WITHOUT_ORG_ID.has(name),
    );
    expect(business.length).toBeGreaterThanOrEqual(15);
    for (const [name, table] of business) {
      const cols = getTableColumns(table as unknown as PgTable);
      expect(cols.organizationId, `tabla «${name}» sin organizationId`).toBeDefined();
    }
  });

  it("las tablas globales de usuarios NO llevan organizationId", () => {
    for (const name of TABLES_WITHOUT_ORG_ID) {
      const table = (s.schema as Record<string, unknown>)[name] as PgTable;
      const cols = getTableColumns(table);
      expect(cols.organizationId, `tabla «${name}» no debe tener organizationId`).toBeUndefined();
    }
  });

  it("las facturas guardan exchangeRateSnapshot y totales en USD y VES", () => {
    const cols = getTableColumns(s.invoices) as unknown as Record<
      string,
      unknown
    >;
    expect(cols.exchangeRateSnapshot).toBeDefined();
    for (const c of [
      "subtotalUsd",
      "vatUsd",
      "igtfUsd",
      "totalUsd",
      "subtotalVes",
      "vatVes",
      "igtfVes",
      "totalVes",
    ]) {
      expect(cols[c], `invoices.${c}`).toBeDefined();
    }
  });

  it("la tabla de pagos permite métodos mixtos y monedas múltiples", () => {
    const cols = getTableColumns(s.payments);
    expect(cols.method).toBeDefined();
    expect(cols.currency).toBeDefined();
    expect(cols.amount).toBeDefined();
  });

  it("existen las entidades centrales de cada módulo", () => {
    const names = Object.keys(s.schema);
    for (const required of [
      "organizations",
      "members",
      "exchangeRates",
      "warehouses",
      "products",
      "inventoryStocks",
      "productRecipes",
      "inventoryMovements",
      "contacts",
      "cashRegisters",
      "invoices",
      "invoiceItems",
      "payments",
      "accountsLedger",
      "bankAccounts",
    ]) {
      expect(names, `falta tabla ${required}`).toContain(required);
    }
  });
});
