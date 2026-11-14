/**
 * Generación de factura digital (PDF con pdfmake + QR) y ticket térmico
 * (58mm/80mm ESC/POS) — funciona 100% offline en el navegador.
 */
import QRCode from "qrcode";

import type { LocalInvoice } from "@/core/db-local/dexie";

export interface ReceiptOrg {
  name: string;
  rif: string | null;
  address: string | null;
}

export interface ReceiptData {
  invoice: LocalInvoice;
  org: ReceiptOrg;
}

const WIDTH = 32; // columnas del ticket térmico (58mm)

function center(text: string): string {
  const pad = Math.max(0, Math.floor((WIDTH - text.length) / 2));
  return " ".repeat(pad) + text;
}

function hr(char = "-"): string {
  return char.repeat(WIDTH);
}

function line(left: string, right: string): string {
  const gap = Math.max(1, WIDTH - left.length - right.length);
  return left + " ".repeat(gap) + right;
}

function moneyUsd(v: string): string {
  return "$" + Number(v).toFixed(2);
}

function moneyVes(v: string): string {
  return "Bs " + Number(v).toLocaleString("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Ticket térmico en texto ESC/POS (listo para WebUSB o impresora). */
export function buildThermalTicket(data: ReceiptData): string {
  const { invoice, org } = data;
  const type =
    invoice.type === "quote"
      ? "PRESUPUESTO"
      : invoice.type === "delivery_note"
        ? "NOTA DE ENTREGA"
        : "FACTURA";
  const lines: string[] = [];
  lines.push(center(org.name.toUpperCase()));
  if (org.rif) lines.push(center(`RIF: ${org.rif}`));
  if (org.address) lines.push(center(org.address));
  lines.push(hr("="));
  lines.push(center(type));
  if (invoice.number) lines.push(center(`N° ${invoice.number}`));
  lines.push(center(new Date(invoice.date).toLocaleString("es-VE")));
  if (invoice.contactName) lines.push(center(`Cliente: ${invoice.contactName}`));
  lines.push(hr("="));

  for (const it of invoice.items) {
    lines.push(`${it.name.slice(0, 24)}`);
    lines.push(
      line(
        `  ${it.quantity} x ${moneyUsd(it.unitPriceUsd)}`,
        moneyUsd(it.totalUsd),
      ),
    );
  }
  lines.push(hr("="));
  lines.push(line("SUBTOTAL", moneyUsd(invoice.subtotalUsd)));
  if (Number(invoice.discountUsd) > 0) {
    lines.push(line("DESCUENTO", "-" + moneyUsd(invoice.discountUsd)));
  }
  lines.push(line("IVA", moneyUsd(invoice.vatUsd)));
  if (Number(invoice.igtfUsd) > 0) {
    lines.push(line("IGTF 3%", moneyUsd(invoice.igtfUsd)));
  }
  lines.push(hr("-"));
  lines.push(line("TOTAL", moneyUsd(invoice.totalUsd)));
  lines.push(line("TOTAL Bs", moneyVes(invoice.totalVes)));
  lines.push(line(
    "TASA BCV",
    `Bs ${Number(invoice.exchangeRateSnapshot.usdToVes).toFixed(2)}`,
  ));
  lines.push(hr("="));
  if (invoice.payments.length > 0) {
    lines.push(center("PAGOS"));
    for (const p of invoice.payments) {
      const label =
        p.currency === "ves"
          ? moneyVes(p.amount)
          : p.currency === "eur"
            ? `€${p.amount}`
            : moneyUsd(p.amount);
      lines.push(line(`  ${p.method}`, label));
    }
    lines.push(hr("-"));
  }
  lines.push(center("¡Gracias por su compra!"));
  lines.push(center("ListoPOS · listopos.app"));
  lines.push("");
  lines.push("");
  lines.push("");
  lines.push("");

  // ESC/POS: corte de papel al final
  return lines.join("\n") + "\x1d\x56\x42\x00";
}

/** Texto resumen para compartir por WhatsApp. */
export function whatsappShareText(data: ReceiptData): string {
  const { invoice, org } = data;
  const rows = [
    `*${org.name}* ${invoice.number ?? ""}`,
    `Fecha: ${new Date(invoice.date).toLocaleString("es-VE")}`,
    "",
  ];
  for (const it of invoice.items) {
    rows.push(`• ${it.quantity} x ${it.name}: ${moneyUsd(it.totalUsd)}`);
  }
  rows.push("");
  rows.push(`Subtotal: ${moneyUsd(invoice.subtotalUsd)}`);
  rows.push(`IVA: ${moneyUsd(invoice.vatUsd)}`);
  if (Number(invoice.igtfUsd) > 0) {
    rows.push(`IGTF (3%): ${moneyUsd(invoice.igtfUsd)}`);
  }
  rows.push(`*TOTAL: ${moneyUsd(invoice.totalUsd)}* (${moneyVes(invoice.totalVes)})`);
  rows.push(`Tasa BCV: Bs ${Number(invoice.exchangeRateSnapshot.usdToVes).toFixed(2)}`);
  rows.push("");
  rows.push("Emitido con ListoPOS 💙");
  return rows.join("\n");
}

export async function whatsappShareUrl(data: ReceiptData): Promise<string> {
  const text = whatsappShareText(data);
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** Definición pdfmake de la factura digital con código QR. */
export async function buildInvoicePdf(
  data: ReceiptData,
): Promise<import("pdfmake/interfaces").TDocumentDefinitions> {
  const { invoice, org } = data;
  const qrText = [
    `ListoPOS|${org.rif ?? org.name}`,
    `Factura:${invoice.number ?? invoice.id.slice(0, 8)}`,
    `Total:${invoice.totalUsd} USD`,
    `Fecha:${invoice.date}`,
  ].join("|");
  const qrDataUrl = await QRCode.toDataURL(qrText, { width: 160, margin: 1 });

  type Cell = import("pdfmake/interfaces").TableCell;
  type Content = import("pdfmake/interfaces").Content;

  const cell = (
    text: string,
    opts: Partial<Cell> = {},
  ): Cell => ({ text, fontSize: 9, margin: [0, 3], ...opts }) as Cell;

  const head = (text: string): Cell =>
    cell(text, {
      bold: true,
      color: "#0037b0",
      style: "head",
    });

  const body: Cell[][] = invoice.items.map((it) => [
    cell(it.name),
    cell(it.quantity, { alignment: "right" }),
    cell(moneyUsd(it.unitPriceUsd), { alignment: "right" }),
    cell(moneyUsd(it.totalUsd), { alignment: "right" }),
  ]);

  const orgStack: Content[] = [
    { text: org.name, bold: true, fontSize: 16, color: "#0037b0" },
  ];
  if (org.rif) orgStack.push({ text: `RIF: ${org.rif}`, fontSize: 9 });
  if (org.address) orgStack.push({ text: org.address, fontSize: 9 });

  const docStack: Content[] = [
    {
      text:
        invoice.type === "quote"
          ? "PRESUPUESTO"
          : invoice.type === "delivery_note"
            ? "NOTA DE ENTREGA"
            : "FACTURA",
      bold: true,
      alignment: "right",
      fontSize: 16,
      color: "#0b1c30",
    },
  ];
  if (invoice.number)
    docStack.push({ text: `N° ${invoice.number}`, alignment: "right", fontSize: 11 });
  docStack.push({
    text: new Date(invoice.date).toLocaleString("es-VE"),
    alignment: "right",
    fontSize: 9,
  });
  if (invoice.contactName)
    docStack.push({
      text: `Cliente: ${invoice.contactName}`,
      alignment: "right",
      fontSize: 9,
    });

  const totalsBody: Cell[][] = [
    [cell("Subtotal"), cell(moneyUsd(invoice.subtotalUsd), { alignment: "right" })],
  ];
  if (Number(invoice.discountUsd) > 0) {
    totalsBody.push([
      cell("Descuento"),
      cell("-" + moneyUsd(invoice.discountUsd), { alignment: "right" }),
    ]);
  }
  totalsBody.push([cell("IVA"), cell(moneyUsd(invoice.vatUsd), { alignment: "right" })]);
  if (Number(invoice.igtfUsd) > 0) {
    totalsBody.push([
      cell("IGTF 3%"),
      cell(moneyUsd(invoice.igtfUsd), { alignment: "right" }),
    ]);
  }
  totalsBody.push([
    cell("TOTAL USD", { bold: true }),
    cell(moneyUsd(invoice.totalUsd), { alignment: "right", bold: true }),
  ]);
  totalsBody.push([
    cell("TOTAL Bs", { bold: true }),
    cell(moneyVes(invoice.totalVes), { alignment: "right", bold: true }),
  ]);

  const content: Content[] = [
    {
      margin: [0, 20, 0, 8],
      table: {
        headerRows: 1,
        widths: ["*", 50, 70, 70],
        body: [
          [
            head("Descripción"),
            cell("Cant.", { alignment: "right", bold: true, color: "#0037b0" }),
            cell("Precio", { alignment: "right", bold: true, color: "#0037b0" }),
            cell("Total", { alignment: "right", bold: true, color: "#0037b0" }),
          ],
          ...body,
        ],
      },
      layout: {
        hLineColor: () => "#e4e4e7",
        vLineColor: () => "#ffffff",
        fillColor: (rowIndex: number) => (rowIndex === 0 ? "#eef2ff" : null),
      },
    },
    {
      margin: [0, 10, 0, 0],
      columns: [
        { width: "*", text: "" },
        {
          width: 250,
          table: {
            widths: ["*", 90],
            body: totalsBody,
          },
          layout: {
            hLineColor: () => "#e4e4e7",
            vLineColor: () => "#ffffff",
          },
        },
      ],
    },
    {
      margin: [0, 12, 0, 0],
      text: `Tasa BCV aplicada: Bs ${Number(invoice.exchangeRateSnapshot.usdToVes).toFixed(2)} · Inmutable en el tiempo`,
      fontSize: 8,
      color: "#505f76",
    },
  ];

  if (invoice.payments.length > 0) {
    content.push({
      margin: [0, 10, 0, 0],
      text:
        "Detalle de pagos: " +
        invoice.payments
          .map((p) => `${p.method} ${p.amount} ${p.currency.toUpperCase()}`)
          .join(" · "),
      fontSize: 9,
      color: "#434655",
    });
  }

  content.push({
    margin: [0, 14, 0, 0],
    columns: [
      { width: "*", text: "" },
      {
        width: 160,
        image: "qr",
        fit: [160, 160],
      },
    ],
  });

  return {
    pageSize: "LETTER",
    pageMargins: [40, 50, 40, 60],
    info: { title: `Factura ${invoice.number ?? ""} - ${org.name}` },
    header: {
      margin: [40, 20, 40, 0],
      columns: [{ stack: orgStack }, { stack: docStack }],
    },
    content,
    footer: () => ({
      margin: [40, 20, 40, 20],
      columns: [
        { text: "Emitido con ListoPOS · listopos.app", fontSize: 8, color: "#8e94a8" },
        { text: "", fontSize: 8 },
      ],
    }),
    images: { qr: qrDataUrl },
    styles: {
      head: { bold: true, fontSize: 9, color: "#0037b0", margin: [0, 3] },
      cell: { fontSize: 9, margin: [0, 3] },
    },
  };
}

/** Imprime el ticket: WebUSB (ESC/POS) si hay dispositivo, o ventana de impresión. */
export async function printThermalTicket(data: ReceiptData): Promise<void> {
  const text = buildThermalTicket(data);
  // Intento WebUSB con impresoras ESC/POS compatibles.
  try {
    const usb = (navigator as unknown as {
      usb?: {
        requestDevice: (opts: unknown) => Promise<{
          open: () => Promise<void>;
          selectConfiguration: (n: number) => Promise<void>;
          claimInterface: (n: number) => Promise<void>;
          transferOut: (ep: number, data: Uint8Array) => Promise<void>;
          close: () => Promise<void>;
        }>;
      };
    }).usb;
    if (usb) {
      const device = await usb.requestDevice({ filters: [] });
      await device.open();
      await device.selectConfiguration(1);
      await device.claimInterface(0);
      await device.transferOut(1, new TextEncoder().encode(text));
      await device.close();
      return;
    }
  } catch {
    // sin dispositivo o permiso denegado → ventana de impresión
  }
  const w = window.open("", "_blank", "width=320,height=480");
  if (!w) return;
  w.document.write(
    `<pre style="font-family:'Courier New',monospace;font-size:11px;line-height:1.15;white-space:pre-wrap;">${text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")}</pre><script>window.onload=()=>{window.print();}<\/script>`,
  );
  w.document.close();
}
