/**
 * Módulo Fiscal — tasas BCV y Libros SENIAT (Fase 5).
 *
 * Los libros de compra y venta se generan con xlsx (SheetJS) con las
 * columnas exigidas: fecha, RIF, nombre, número de factura, base imponible,
 * IVA, IGTF percibido y total, listos para el contador.
 */
import { and, asc, eq, gte, inArray, isNotNull, lt } from "drizzle-orm";
import * as XLSX from "xlsx";

import type { AnyListoPOSDb } from "@/core/db-cloud/db-types";
import * as s from "@/core/db-cloud/schema";

/* ------------------------------------------------------------------ */
/* Tasas de cambio                                                    */
/* ------------------------------------------------------------------ */

export interface ExchangeRateInput {
  currency: "usd" | "eur";
  rateToVes: string;
  date: string; // YYYY-MM-DD
  source: "bcv" | "custom";
}

export async function upsertExchangeRate(
  db: AnyListoPOSDb,
  orgId: string,
  input: ExchangeRateInput,
) {
  await db
    .insert(s.exchangeRates)
    .values({
      organizationId: orgId,
      currency: input.currency,
      rateToVes: input.rateToVes,
      date: input.date,
      source: input.source,
    })
    .onConflictDoUpdate({
      target: [
        s.exchangeRates.organizationId,
        s.exchangeRates.currency,
        s.exchangeRates.date,
      ],
      set: { rateToVes: input.rateToVes, source: input.source },
    });
}

/* ------------------------------------------------------------------ */
/* Libros SENIAT                                                      */
/* ------------------------------------------------------------------ */

export interface BookRow {
  fecha: string;
  rif: string;
  nombre: string;
  numero: string;
  baseImponible: string;
  iva: string;
  igtf: string;
  total: string;
  tasa: string;
}

function monthRange(month: string): { start: Date; end: Date } {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) throw new Error("Mes inválido (use YYYY-MM)");
  return {
    start: new Date(Date.UTC(y, m - 1, 1)),
    end: new Date(Date.UTC(y, m, 1)),
  };
}

/** Libro de ventas del mes (facturas y notas de entrega numeradas). */
export async function getSalesBook(
  db: AnyListoPOSDb,
  orgId: string,
  month: string,
): Promise<BookRow[]> {
  const { start, end } = monthRange(month);
  const rows = await db
    .select({
      invoice: s.invoices,
      contactDocument: s.contacts.document,
      contactName: s.contacts.name,
    })
    .from(s.invoices)
    .leftJoin(s.contacts, eq(s.invoices.contactId, s.contacts.id))
    .where(
      and(
        eq(s.invoices.organizationId, orgId),
        isNotNull(s.invoices.number),
        inArray(s.invoices.type, ["invoice", "delivery_note"]),
        inArray(s.invoices.status, ["issued", "paid", "credit"]),
        gte(s.invoices.date, start),
        lt(s.invoices.date, end),
      ),
    )
    .orderBy(asc(s.invoices.number));

  return rows.map((r) => ({
    fecha: r.invoice.date.toISOString().slice(0, 10),
    rif: r.contactDocument ?? "",
    nombre: r.contactName ?? "Consumidor Final",
    numero: r.invoice.number!,
    baseImponible: r.invoice.subtotalVes,
    iva: r.invoice.vatVes,
    igtf: r.invoice.igtfVes,
    total: r.invoice.totalVes,
    tasa: r.invoice.exchangeRateSnapshot.usdToVes,
  }));
}

/**
 * Libro de compras del mes desde las cuentas por pagar a proveedores.
 * La base imponible se estima como total / 1.16 (IVA 16% incluido).
 */
export async function getPurchasesBook(
  db: AnyListoPOSDb,
  orgId: string,
  month: string,
): Promise<BookRow[]> {
  const { start, end } = monthRange(month);
  const rows = await db
    .select({
      ledger: s.accountsLedger,
      contactDocument: s.contacts.document,
      contactName: s.contacts.name,
    })
    .from(s.accountsLedger)
    .leftJoin(s.contacts, eq(s.accountsLedger.contactId, s.contacts.id))
    .where(
      and(
        eq(s.accountsLedger.organizationId, orgId),
        eq(s.accountsLedger.type, "payable"),
        gte(s.accountsLedger.createdAt, start),
        lt(s.accountsLedger.createdAt, end),
      ),
    )
    .orderBy(asc(s.accountsLedger.createdAt));

  return rows.map((r) => {
    const total = r.ledger.amountVes;
    const base = (Number(total) / 1.16).toFixed(2);
    const iva = (Number(total) - Number(base)).toFixed(2);
    const numero =
      r.ledger.notes?.match(/Compra\s+(\S+)/)?.[1] ?? r.ledger.id.slice(0, 8);
    return {
      fecha: r.ledger.createdAt.toISOString().slice(0, 10),
      rif: r.contactDocument ?? "",
      nombre: r.contactName ?? "Proveedor",
      numero,
      baseImponible: base,
      iva,
      igtf: "0.00",
      total,
      tasa: "—",
    };
  });
}

const BOOK_HEADERS = [
  "Fecha",
  "RIF",
  "Nombre / Razón Social",
  "N° Factura",
  "Base Imponible (Bs)",
  "IVA (Bs)",
  "IGTF (Bs)",
  "Total (Bs)",
  "Tasa BCV",
];

/** Genera el archivo xlsx con los dos libros del mes. */
export function buildBooksXlsx(
  sales: BookRow[],
  purchases: BookRow[],
): Buffer {
  const toRow = (r: BookRow) => [
    r.fecha,
    r.rif,
    r.nombre,
    r.numero,
    Number(r.baseImponible),
    Number(r.iva),
    Number(r.igtf),
    Number(r.total),
    r.tasa,
  ];

  const wb = XLSX.utils.book_new();
  const ventas = XLSX.utils.aoa_to_sheet([
    BOOK_HEADERS,
    ...sales.map(toRow),
  ]);
  const compras = XLSX.utils.aoa_to_sheet([
    BOOK_HEADERS,
    ...purchases.map(toRow),
  ]);
  ventas["!cols"] = [{ wch: 11 }, { wch: 14 }, { wch: 28 }, { wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 10 }];
  compras["!cols"] = ventas["!cols"];
  XLSX.utils.book_append_sheet(wb, ventas, "LIBRO VENTAS");
  XLSX.utils.book_append_sheet(wb, compras, "LIBRO COMPRAS");

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
}
