"use client";

import type { LocalInvoice } from "@/core/db-local/dexie";
import { buildInvoicePdf, type ReceiptData } from "./receipt";

/** Descarga la factura digital en PDF (pdfmake cargado bajo demanda). */
export async function downloadInvoicePdf(data: ReceiptData): Promise<void> {
  const pdfMake = (await import("pdfmake/build/pdfmake")).default as {
    vfs?: Record<string, string>;
    createPdf: (doc: unknown) => { download: (name: string) => void };
  };
  const pdfFonts = (await import("pdfmake/build/vfs_fonts")).default as {
    vfs?: Record<string, string>;
    pdfMake?: { vfs?: Record<string, string> };
  };
  pdfMake.vfs = pdfFonts.pdfMake?.vfs ?? pdfFonts.vfs;
  const doc = await buildInvoicePdf(data);
  pdfMake.createPdf(doc).download(
    `factura-${data.invoice.number ?? "documento"}.pdf`,
  );
}

/** Datos de recibo listos para PDF/ticket desde la organización activa. */
export function receiptData(
  invoice: LocalInvoice,
  org: { name: string; rif: string | null; address: string | null },
): ReceiptData {
  return { invoice, org };
}
