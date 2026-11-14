"use client";

import { useEffect, useMemo, useState } from "react";
import Decimal from "decimal.js";
import {
  FileText,
  Minus,
  Plus,
  Printer,
  Search,
  Share2,
  ShoppingCart,
  Trash2,
  WifiOff,
} from "lucide-react";

import type {
  cashRegisters,
  contacts,
  exchangeRates,
  inventoryStocks,
  products,
  warehouses,
} from "@/core/db-cloud/schema";
import { localDb, type LocalInvoice } from "@/core/db-local/dexie";
import { convert } from "@/core/currency/calculator";
import { formatMoney } from "@/core/currency/format";
import { engineFor } from "@/core/sync/engine";
import { calcIgtf, paymentsCoverage, splitChange } from "@/modules/fiscal/taxes";
import {
  issueLocalSale,
  liveTotals,
  type CartLineInput,
} from "@/modules/pos/pos-logic";
import {
  printThermalTicket,
  whatsappShareUrl,
  type ReceiptData,
} from "@/modules/pos/receipt";
import { downloadInvoicePdf } from "@/modules/pos/pdf";
import { useOrg } from "@/ui/org-provider";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { Input } from "@/ui/input";
import { Label } from "@/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/select";

type Product = typeof products.$inferSelect;
type Stock = typeof inventoryStocks.$inferSelect;
type Contact = typeof contacts.$inferSelect;
type Rate = typeof exchangeRates.$inferSelect;
type Warehouse = typeof warehouses.$inferSelect;
type Register = typeof cashRegisters.$inferSelect;

type DocType = "invoice" | "delivery_note" | "quote";

interface PaymentRow {
  method: string;
  currency: "usd" | "ves" | "eur";
  amount: string;
}

const METHOD_LABELS: Record<string, string> = {
  cash_usd: "Efectivo USD",
  cash_ves: "Efectivo Bs",
  pos: "Punto de venta",
  pago_movil: "Pago Móvil",
  zelle: "Zelle",
  credit: "Crédito",
  other: "Otro",
};

const DOC_TYPES: { value: DocType; label: string }[] = [
  { value: "invoice", label: "Factura" },
  { value: "delivery_note", label: "Nota de entrega" },
  { value: "quote", label: "Presupuesto" },
];

function rateTable(org: { rates: { usdToVes: string | null; eurToVes: string | null } }) {
  return {
    usdToVes: org.rates.usdToVes ?? "0",
    eurToVes: org.rates.eurToVes ?? org.rates.usdToVes ?? "0",
  };
}

export default function PosClient({
  initialProducts,
  initialStocks,
  initialContacts,
  initialRates,
  warehouses,
  openRegisters,
}: {
  initialProducts: Product[];
  initialStocks: Stock[];
  initialContacts: Contact[];
  initialRates: Rate[];
  warehouses: Warehouse[];
  openRegisters: Register[];
}) {
  const org = useOrg();
  const [cart, setCart] = useState<CartLineInput[]>([]);
  const [query, setQuery] = useState("");
  const [docType, setDocType] = useState<DocType>("invoice");
  const [contactId, setContactId] = useState("");
  const [warehouseId, setWarehouseId] = useState(
    warehouses.find((w) => w.isMain)?.id ?? warehouses[0]?.id ?? "",
  );
  const [discount, setDiscount] = useState("0");
  const [sync, setSync] = useState({ online: true, pending: 0 });
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [quotePickerOpen, setQuotePickerOpen] = useState(false);
  const [quotes, setQuotes] = useState<LocalInvoice[]>([]);
  const [sourceQuoteId, setSourceQuoteId] = useState<string | undefined>();
  const [receipt, setReceipt] = useState<LocalInvoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rates = rateTable(org);
  const hasRate = Boolean(org.rates.usdToVes);

  /* ---------- Hidratación Dexie + motor de sincronización ---------- */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await localDb.products.bulkPut(
        initialProducts.map((p) => ({
          id: p.id,
          organizationId: p.organizationId,
          sku: p.sku ?? undefined,
          barcode: p.barcode ?? undefined,
          name: p.name,
          category: p.category ?? undefined,
          unit: p.unit,
          costUsd: p.costUsd,
          marginPercent: p.marginPercent,
          priceRetailUsd: p.priceRetailUsd,
          priceWholesaleUsd: p.priceWholesaleUsd ?? undefined,
          exemptVat: (p.exemptVat ? 1 : 0) as 0 | 1,
          minStock: p.minStock,
          isComposite: (p.isComposite ? 1 : 0) as 0 | 1,
          active: (p.active ? 1 : 0) as 0 | 1,
          updatedAt: p.updatedAt.toISOString(),
        })),
      );
      await localDb.inventoryStocks.bulkPut(
        initialStocks.map((st) => ({ ...st, updatedAt: st.updatedAt.toISOString() })),
      );
      await localDb.contacts.bulkPut(
        initialContacts.map((c) => ({
          id: c.id,
          organizationId: c.organizationId,
          type: c.type,
          name: c.name,
          document: c.document ?? undefined,
          phone: c.phone ?? undefined,
          email: c.email ?? undefined,
          creditLimitUsd: c.creditLimitUsd,
          points: c.points,
          updatedAt: c.updatedAt.toISOString(),
        })),
      );
      await localDb.exchangeRates.bulkPut(
        initialRates.map((r) => ({
          id: r.id,
          organizationId: r.organizationId,
          currency: r.currency as "usd" | "eur",
          rateToVes: r.rateToVes,
          date: r.date,
          source: r.source,
        })),
      );
      const engine = engineFor(org.id);
      const unsub = engine.subscribe((s) => {
        if (!cancelled) setSync({ online: s.online, pending: s.pending });
      });
      if (navigator.onLine) {
        engine.sync().catch(() => undefined);
      }
      return () => {
        unsub();
        cancelled = true;
      };
    })();
  }, [org.id, initialProducts, initialStocks, initialContacts, initialRates]);

  const stockByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const st of initialStocks) {
      map.set(st.productId, (map.get(st.productId) ?? 0) + Number(st.quantity));
    }
    return map;
  }, [initialStocks]);

  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    const active = initialProducts.filter((p) => p.active);
    if (!q) return active;
    return active.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.barcode ?? "").toLowerCase().includes(q) ||
        (p.sku ?? "").toLowerCase().includes(q),
    );
  }, [initialProducts, query]);

  const totals = useMemo(
    () => liveTotals(cart, rates, discount),
    [cart, rates, discount],
  );

  function addToCart(p: Product) {
    setCart((prev) => {
      const existing = prev.find((l) => l.productId === p.id);
      if (existing) {
        return prev.map((l) =>
          l.productId === p.id
            ? { ...l, quantity: new Decimal(l.quantity).plus(1).toString() }
            : l,
        );
      }
      return [
        ...prev,
        {
          productId: p.id,
          name: p.name,
          quantity: "1",
          unit: p.unit,
          unitPriceUsd: p.priceRetailUsd,
          exemptVat: p.exemptVat,
          isComposite: p.isComposite,
        },
      ];
    });
  }

  function changeQty(productId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((l) =>
          l.productId === productId
            ? {
                ...l,
                quantity: new Decimal(l.quantity).plus(delta).toString(),
              }
            : l,
        )
        .filter((l) => new Decimal(l.quantity).gt(0)),
    );
  }

  function removeLine(productId: string) {
    setCart((prev) => prev.filter((l) => l.productId !== productId));
  }

  /* ---------- Presupuestos: convertir en 1 clic ---------- */
  async function openQuotePicker() {
    const rows = await localDb.invoices
      .where("organizationId")
      .equals(org.id)
      .filter((i) => i.type === "quote" && i.status === "issued")
      .reverse()
      .sortBy("createdAt");
    setQuotes(rows.slice(0, 20));
    setQuotePickerOpen(true);
  }

  function convertQuote(q: LocalInvoice) {
    setSourceQuoteId(q.id);
    setDocType("invoice");
    setContactId(q.contactId ?? "");
    setCart(
      q.items.map((it) => ({
        productId: it.productId ?? "",
        name: it.name,
        quantity: it.quantity,
        unit: it.unit,
        unitPriceUsd: it.unitPriceUsd,
        exemptVat: it.exemptVat === 1,
        isComposite: initialProducts.find((p) => p.id === it.productId)
          ?.isComposite,
      })),
    );
    setQuotePickerOpen(false);
  }

  /* ---------- Emisión de la venta (pagos se pasan desde el modal) ---------- */
  async function confirmSale(payments: PaymentRow[], creditMode: boolean) {
    setBusy(true);
    setError(null);
    try {
      const grandUsd = new Decimal(totals.totalUsd);
      const finalPayments = creditMode
        ? [{ method: "credit", currency: "usd" as const, amount: grandUsd.toFixed(2) }]
        : payments;
      const result = await issueLocalSale(localDb, {
        type: docType,
        organizationId: org.id,
        warehouseId: warehouseId || undefined,
        cashRegisterId: openRegisters[0]?.id,
        contactId: contactId || undefined,
        contactName: contactId
          ? (initialContacts.find((c) => c.id === contactId)?.name ??
            "Cliente")
          : "Consumidor Final",
        sourceInvoiceId: sourceQuoteId,
        items: cart,
        payments: finalPayments,
        discountUsd: discount,
        igtfRatePercent: org.igtfRate,
      });
      setReceipt(result.invoice);
      setCart([]);
      setDiscount("0");
      setSourceQuoteId(undefined);
      setCheckoutOpen(false);
      if (navigator.onLine) {
        engineFor(org.id).push().catch(() => undefined);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo emitir la venta");
    } finally {
      setBusy(false);
    }
  }

  const receiptOrg = { name: org.name, rif: org.rif, address: org.address };
  const receiptData: ReceiptData | null = receipt
    ? { invoice: receipt, org: receiptOrg }
    : null;

  return (
    <div className="flex h-[calc(100dvh-8rem)] min-h-[520px] flex-col gap-4 lg:flex-row">
      {/* Catálogo */}
      <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-pizarra-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-pizarra-200 p-3">
          <div className="relative min-w-56 flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-pizarra-400" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar producto o escanear código…"
              className="pl-9"
            />
          </div>
          {!sync.online && (
            <Badge variant="warning" className="gap-1">
              <WifiOff className="size-3" /> Sin conexión — vendiendo offline
            </Badge>
          )}
          {sync.online && sync.pending > 0 && (
            <Badge variant="secondary">
              Sincronizando… {sync.pending} pendiente{sync.pending > 1 ? "s" : ""}
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={openQuotePicker}>
            <FileText className="size-4" />
            Facturar presupuesto
          </Button>
        </div>
        <div className="grid flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto p-3 sm:grid-cols-3 xl:grid-cols-4">
          {filteredProducts.map((p) => {
            const stock = stockByProduct.get(p.id) ?? 0;
            return (
              <button
                key={p.id}
                onClick={() => addToCart(p)}
                className="group flex flex-col items-start rounded-xl border border-pizarra-200 bg-white p-3 text-left shadow-sm transition-all hover:border-brand-400 hover:shadow-md active:scale-[0.98]"
              >
                <span className="line-clamp-2 text-sm font-semibold text-pizarra-900">
                  {p.name}
                </span>
                <span className="mt-1 text-lg font-bold text-brand-700">
                  {formatMoney(p.priceRetailUsd, "usd")}
                </span>
                <span className="text-xs text-pizarra-500">
                  {hasRate
                    ? formatMoney(
                        (Number(p.priceRetailUsd) * Number(org.rates.usdToVes)).toFixed(2),
                        "ves",
                      )
                    : "Sin tasa BCV"}
                </span>
                <span className="mt-1">
                  {stock <= 0 ? (
                    <Badge variant="danger">Agotado</Badge>
                  ) : stock <= Number(p.minStock) ? (
                    <Badge variant="warning">Quedan {stock}</Badge>
                  ) : (
                    <span className="text-xs text-pizarra-400">Stock: {stock}</span>
                  )}
                </span>
              </button>
            );
          })}
          {filteredProducts.length === 0 && (
            <p className="col-span-full py-10 text-center text-sm text-pizarra-500">
              No hay productos que coincidan. Cárgalos en{" "}
              <a href={`/${org.slug}/inventory/products`} className="text-brand-700 hover:underline">
                Inventario
              </a>
              .
            </p>
          )}
        </div>
      </div>

      {/* Carrito */}
      <aside className="flex w-full flex-col rounded-2xl border border-pizarra-200 bg-white shadow-sm lg:w-96">
        <div className="flex items-center justify-between border-b border-pizarra-200 p-3">
          <h2 className="flex items-center gap-2 font-bold text-pizarra-900">
            <ShoppingCart className="size-5 text-brand-600" />
            Carrito ({cart.length})
          </h2>
          <div className="flex gap-1">
            {DOC_TYPES.map((t) => (
              <button
                key={t.value}
                onClick={() => setDocType(t.value)}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                  docType === t.value
                    ? "bg-brand-600 text-white"
                    : "bg-pizarra-100 text-pizarra-600 hover:bg-pizarra-200"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {cart.length === 0 && (
            <p className="py-10 text-center text-sm text-pizarra-500">
              Toca un producto para añadirlo al carrito.
            </p>
          )}
          <ul className="space-y-2">
            {cart.map((l) => (
              <li
                key={l.productId}
                className="flex items-center justify-between gap-2 rounded-xl border border-pizarra-100 bg-pizarra-50/60 p-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-pizarra-900">
                    {l.name}
                  </p>
                  <p className="text-xs text-pizarra-500">
                    {formatMoney(l.unitPriceUsd, "usd")} c/u ·{" "}
                    {formatMoney(
                      (Number(l.unitPriceUsd) * Number(l.quantity)).toFixed(2),
                      "usd",
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => changeQty(l.productId, -1)}
                  >
                    <Minus className="size-3.5" />
                  </Button>
                  <span className="w-10 text-center text-sm font-bold tabular-nums">
                    {l.quantity}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => changeQty(l.productId, 1)}
                  >
                    <Plus className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-error-500 hover:text-error-700"
                    onClick={() => removeLine(l.productId)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-3 border-t border-pizarra-200 p-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Cliente</Label>
              <Select
                value={contactId || "__final"}
                onValueChange={(v) => setContactId(v === "__final" ? "" : v)}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Consumidor Final" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__final">Consumidor Final</SelectItem>
                  {initialContacts
                    .filter((c) => c.type === "customer")
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Almacén</Label>
              <Select value={warehouseId || undefined} onValueChange={setWarehouseId}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Almacén…" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs">Descuento (USD)</Label>
            <Input
              inputMode="decimal"
              className="h-9 w-24 text-sm"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
            />
          </div>
          <div className="space-y-1 rounded-xl bg-pizarra-50 p-3 text-sm">
            <div className="flex justify-between text-pizarra-600">
              <span>Subtotal</span>
              <span className="tabular-nums">{formatMoney(totals.subtotalUsd, "usd")}</span>
            </div>
            <div className="flex justify-between text-pizarra-600">
              <span>IVA</span>
              <span className="tabular-nums">{formatMoney(totals.vatUsd, "usd")}</span>
            </div>
            <div className="flex justify-between text-base font-bold text-pizarra-900">
              <span>Total</span>
              <span className="tabular-nums">{formatMoney(totals.totalUsd, "usd")}</span>
            </div>
            {hasRate && (
              <div className="flex justify-between font-semibold text-brand-700">
                <span>Total Bs</span>
                <span className="tabular-nums">{formatMoney(totals.totalVes, "ves")}</span>
              </div>
            )}
          </div>
          <Button
            className="h-12 w-full text-base"
            disabled={cart.length === 0 || !hasRate || busy}
            onClick={() => setCheckoutOpen(true)}
          >
            {docType === "quote" ? "Emitir presupuesto" : "Cobrar"}
          </Button>
          {!hasRate && (
            <p className="text-center text-xs text-alerta-700">
              Configura la tasa BCV en Fiscal para poder cobrar.
            </p>
          )}
        </div>
      </aside>

      <PaymentDialog
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        totals={totals}
        rates={rates}
        igtfRate={org.igtfRate}
        isQuote={docType === "quote"}
        busy={busy}
        error={error}
        onConfirm={confirmSale}
      />

      <QuotePickerDialog
        open={quotePickerOpen}
        onOpenChange={setQuotePickerOpen}
        quotes={quotes}
        onSelect={convertQuote}
      />

      <ReceiptDialog receipt={receiptData} onClose={() => setReceipt(null)} />
    </div>
  );
}

/* ================================================================== */
/* Modal de pago mixto + IGTF + vueltos                               */
/* ================================================================== */

function PaymentDialog({
  open,
  onOpenChange,
  totals,
  rates,
  igtfRate,
  isQuote,
  busy,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  totals: ReturnType<typeof liveTotals>;
  rates: { usdToVes: string; eurToVes: string };
  igtfRate: string;
  isQuote: boolean;
  busy: boolean;
  error: string | null;
  onConfirm: (payments: PaymentRow[], creditMode: boolean) => Promise<void>;
}) {
  const [rows, setRows] = useState<PaymentRow[]>([
    { method: "cash_usd", currency: "usd", amount: "" },
  ]);
  const [creditMode, setCreditMode] = useState(false);
  const [changeIn, setChangeIn] = useState<"auto" | "usd" | "ves">("auto");
  const [maxChangeUsd, setMaxChangeUsd] = useState("");

  // reset cuando se abre
  useEffect(() => {
    if (open) {
      setRows([{ method: "cash_usd", currency: "usd", amount: "" }]);
      setCreditMode(false);
      setChangeIn("auto");
      setMaxChangeUsd("");
    }
  }, [open]);

  const effectivePayments = creditMode
    ? [{ method: "credit", currency: "usd" as const, amount: totals.totalUsd }]
    : rows.filter((r) => r.amount);

  const igtf = calcIgtf(effectivePayments, {
    igtfRatePercent: igtfRate,
    usdToVes: rates.usdToVes,
    eurToVes: rates.eurToVes,
  });
  const grandUsd = new Decimal(totals.totalUsd).plus(igtf.igtfUsd).toFixed(2);
  const grandVes = new Decimal(totals.totalVes).plus(igtf.igtfVes).toFixed(2);

  const receivedUsd = effectivePayments
    .filter((p) => p.currency === "usd")
    .reduce((acc, p) => acc.plus(p.amount), new Decimal(0));
  const receivedVes = effectivePayments
    .filter((p) => p.currency === "ves")
    .reduce((acc, p) => acc.plus(p.amount), new Decimal(0));
  const receivedEur = effectivePayments
    .filter((p) => p.currency === "eur")
    .reduce((acc, p) => acc.plus(p.amount), new Decimal(0));
  const receivedUsdTotal = receivedUsd.plus(
    receivedEur.gt(0) ? convert(receivedEur.toString(), "eur", "usd", rates) : 0,
  );

  const coverage = paymentsCoverage(effectivePayments, grandUsd, rates);

  let change: { changeUsd: string; changeVes: string } | null = null;
  if (!creditMode && effectivePayments.length > 0 && coverage.covered) {
    try {
      change = splitChange({
        totalUsd: grandUsd,
        receivedUsd: receivedUsdTotal.toString(),
        receivedVes: receivedVes.toString(),
        rates,
        changeIn,
        maxChangeUsd: maxChangeUsd || undefined,
      });
    } catch {
      change = null;
    }
  }

  const canConfirm =
    isQuote || creditMode || (effectivePayments.length > 0 && coverage.covered);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{isQuote ? "Emitir presupuesto" : "Cobro"}</DialogTitle>
          <DialogDescription>
            {isQuote
              ? "El presupuesto no descuenta inventario y podrás convertirlo en factura con un clic."
              : "Divide el cobro en varios métodos. El IGTF 3% se aplica solo a la porción pagada en divisas."}
          </DialogDescription>
        </DialogHeader>

        {!isQuote ? (
          <div className="mt-4 space-y-3">
            <label className="flex items-center gap-2 text-sm font-medium text-pizarra-700">
              <input
                type="checkbox"
                checked={creditMode}
                onChange={(e) => setCreditMode(e.target.checked)}
                className="size-4 accent-brand-600"
              />
              Venta a crédito (queda registrada en cuentas por cobrar)
            </label>

            {!creditMode && (
              <>
                <div className="space-y-2">
                  <Label>Pagos</Label>
                  {rows.map((row, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Select
                        value={row.method}
                        onValueChange={(v) =>
                          setRows((prev) =>
                            prev.map((r, j) => (j === i ? { ...r, method: v } : r)),
                          )
                        }
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(METHOD_LABELS)
                            .filter(([k]) => k !== "credit")
                            .map(([k, label]) => (
                              <SelectItem key={k} value={k}>
                                {label}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={row.currency}
                        onValueChange={(v: "usd" | "ves" | "eur") =>
                          setRows((prev) =>
                            prev.map((r, j) => (j === i ? { ...r, currency: v } : r)),
                          )
                        }
                      >
                        <SelectTrigger className="w-24">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="usd">USD</SelectItem>
                          <SelectItem value="ves">Bs</SelectItem>
                          <SelectItem value="eur">EUR</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        inputMode="decimal"
                        className="w-28"
                        placeholder="Monto"
                        value={row.amount}
                        onChange={(e) =>
                          setRows((prev) =>
                            prev.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r)),
                          )
                        }
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 shrink-0"
                        onClick={() =>
                          setRows((prev) => prev.filter((_, j) => j !== i))
                        }
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setRows((prev) => [
                        ...prev,
                        { method: "cash_ves", currency: "ves", amount: "" },
                      ])
                    }
                  >
                    + Añadir método
                  </Button>
                </div>

                <div className="rounded-xl bg-pizarra-50 p-3 text-sm">
                  <div className="flex justify-between text-pizarra-600">
                    <span>Total</span>
                    <span className="tabular-nums">{formatMoney(totals.totalUsd, "usd")}</span>
                  </div>
                  <div className="flex justify-between text-pizarra-600">
                    <span>IGTF 3% (divisas)</span>
                    <span className="tabular-nums">{formatMoney(igtf.igtfUsd, "usd")}</span>
                  </div>
                  <div className="flex justify-between text-base font-bold text-pizarra-900">
                    <span>A cobrar</span>
                    <span className="tabular-nums">
                      {formatMoney(grandUsd, "usd")} · {formatMoney(grandVes, "ves")}
                    </span>
                  </div>
                  <div className="mt-1 flex justify-between text-pizarra-600">
                    <span>Recibido</span>
                    <span className="tabular-nums">
                      {formatMoney(coverage.receivedUsdEquivalent, "usd")}
                    </span>
                  </div>
                  {!coverage.covered && (
                    <p className="mt-1 text-xs font-semibold text-alerta-700">
                      Falta {formatMoney(coverage.missingUsd, "usd")}
                    </p>
                  )}
                </div>

                {coverage.covered && change && (
                  <div className="rounded-xl bg-eco-50 p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-eco-800">
                        Vuelto: {formatMoney(change.changeUsd, "usd")} ·{" "}
                        {formatMoney(change.changeVes, "ves")}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <Select
                        value={changeIn}
                        onValueChange={(v: "auto" | "usd" | "ves") => setChangeIn(v)}
                      >
                        <SelectTrigger className="h-8 w-40 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="auto">Cambio automático</SelectItem>
                          <SelectItem value="usd">Todo en USD</SelectItem>
                          <SelectItem value="ves">Todo en Bs</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        inputMode="decimal"
                        className="h-8 w-28 text-xs"
                        placeholder="Máx. cambio USD"
                        value={maxChangeUsd}
                        onChange={(e) => setMaxChangeUsd(e.target.value)}
                      />
                    </div>
                  </div>
                )}
              </>
            )}

            {creditMode && (
              <p className="rounded-xl bg-alerta-50 px-4 py-3 text-sm text-alerta-800">
                Se registrará la venta a crédito por{" "}
                <b>{formatMoney(grandUsd, "usd")}</b> ({formatMoney(grandVes, "ves")}) y
                quedará en cuentas por cobrar.
              </p>
            )}
          </div>
        ) : (
          <p className="mt-4 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-900">
            Total del presupuesto: {formatMoney(totals.totalUsd, "usd")} ·{" "}
            {formatMoney(totals.totalVes, "ves")}
          </p>
        )}

        {error && (
          <p className="mt-3 rounded-lg bg-error-50 px-3 py-2 text-sm text-error-700">
            {error}
          </p>
        )}

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={!canConfirm || busy}
            onClick={() => onConfirm(effectivePayments, creditMode)}
          >
            {busy
              ? "Emitiendo…"
              : isQuote
                ? "Emitir presupuesto"
                : creditMode
                  ? "Registrar venta a crédito"
                  : "Confirmar cobro"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ================================================================== */
/* Selector de presupuesto a facturar                                 */
/* ================================================================== */

function QuotePickerDialog({
  open,
  onOpenChange,
  quotes,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quotes: LocalInvoice[];
  onSelect: (quote: LocalInvoice) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Facturar presupuesto</DialogTitle>
          <DialogDescription>
            Elige un presupuesto emitido para convertirlo en factura con un
            clic.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 max-h-80 space-y-2 overflow-y-auto">
          {quotes.length === 0 && (
            <p className="py-8 text-center text-sm text-pizarra-500">
              No hay presupuestos emitidos aún.
            </p>
          )}
          {quotes.map((q) => (
            <button
              key={q.id}
              onClick={() => onSelect(q)}
              className="flex w-full items-center justify-between rounded-xl border border-pizarra-200 p-3 text-left transition-colors hover:border-brand-300 hover:bg-brand-50/50"
            >
              <div>
                <p className="text-sm font-semibold text-pizarra-900">
                  {q.contactName ?? "Consumidor Final"}
                </p>
                <p className="text-xs text-pizarra-500">
                  {new Date(q.createdAt).toLocaleString("es-VE")} ·{" "}
                  {q.items.length} línea{q.items.length > 1 ? "s" : ""}
                </p>
              </div>
              <span className="font-bold text-brand-700">
                {formatMoney(q.totalUsd, "usd")}
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ================================================================== */
/* Recibo emitido: PDF / ticket / WhatsApp                            */
/* ================================================================== */

function ReceiptDialog({
  receipt,
  onClose,
}: {
  receipt: ReceiptData | null;
  onClose: () => void;
}) {
  const [waUrl, setWaUrl] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (receipt) {
      setWaUrl(null);
      whatsappShareUrl(receipt)
        .then(setWaUrl)
        .catch(() => setWaUrl(null));
    }
  }, [receipt]);

  if (!receipt) return null;
  const { invoice } = receipt;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {invoice.type === "quote"
              ? "Presupuesto emitido"
              : invoice.type === "delivery_note"
                ? "Nota de entrega emitida"
                : "Venta registrada"}
            {invoice.number ? ` N° ${invoice.number}` : ""}
          </DialogTitle>
          <DialogDescription>
            Total: {formatMoney(invoice.totalUsd, "usd")} ·{" "}
            {formatMoney(invoice.totalVes, "ves")} · IGTF{" "}
            {formatMoney(invoice.igtfUsd, "usd")}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-3">
          <div className="max-h-48 overflow-y-auto rounded-xl border border-pizarra-200">
            <ul className="divide-y divide-pizarra-100 text-sm">
              {invoice.items.map((it, i) => (
                <li key={i} className="flex justify-between px-3 py-2">
                  <span className="text-pizarra-700">
                    {it.quantity} × {it.name}
                  </span>
                  <span className="font-semibold tabular-nums">
                    {formatMoney(it.totalUsd, "usd")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {invoice.payments.length > 0 && (
            <p className="text-xs text-pizarra-500">
              Pagos:{" "}
              {invoice.payments
                .map((p) => `${METHOD_LABELS[p.method] ?? p.method} ${p.amount}`)
                .join(" · ")}
            </p>
          )}

          <div className="grid grid-cols-3 gap-2">
            <Button
              onClick={() => {
                setDownloading(true);
                downloadInvoicePdf(receipt)
                  .catch(() => setDownloading(false))
                  .finally(() => setDownloading(false));
              }}
              disabled={downloading}
            >
              <FileText className="size-4" />
              {downloading ? "Generando…" : "Factura PDF"}
            </Button>
            <Button variant="outline" onClick={() => printThermalTicket(receipt)}>
              <Printer className="size-4" />
              Ticket
            </Button>
            <Button
              variant="outline"
              disabled={!waUrl}
              onClick={() => waUrl && window.open(waUrl, "_blank")}
            >
              <Share2 className="size-4" />
              WhatsApp
            </Button>
          </div>
          <Button className="w-full" onClick={onClose}>
            Nueva venta
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
