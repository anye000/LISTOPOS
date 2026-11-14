"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Decimal from "decimal.js";

import { registerAbonoAction } from "@/modules/finance/actions";
import { formatMoney } from "@/core/currency/format";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/table";

interface LedgerRow {
  id: string;
  contactId: string | null;
  contactName: string | null;
  invoiceId: string | null;
  amountUsd: string;
  amountVes: string;
  paidUsd: string;
  paidVes: string;
  dueDate: Date | null;
  status: "pending" | "partial" | "paid";
  notes: string | null;
  createdAt: Date;
}

export default function LedgerClient({
  receivables,
  payables,
}: {
  receivables: LedgerRow[];
  payables: LedgerRow[];
}) {
  const { slug } = useOrg();
  const router = useRouter();
  const [tab, setTab] = useState<"receivable" | "payable">("receivable");
  const [abonoFor, setAbonoFor] = useState<LedgerRow | null>(null);
  const [method, setMethod] = useState("zelle");
  const [currency, setCurrency] = useState<"usd" | "ves" | "eur">("usd");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rows = tab === "receivable" ? receivables : payables;

  const overdue = useMemo(
    () =>
      rows.filter(
        (r) =>
          r.status !== "paid" &&
          r.dueDate &&
          new Date(r.dueDate) < new Date(),
      ).length,
    [rows],
  );

  function balance(r: LedgerRow): Decimal {
    return new Decimal(r.amountUsd).minus(r.paidUsd);
  }

  async function handleAbono(e: React.FormEvent) {
    e.preventDefault();
    if (!abonoFor) return;
    setBusy(true);
    const result = await registerAbonoAction(slug, {
      ledgerId: abonoFor.id,
      method,
      currency,
      amount,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "No se pudo registrar el abono");
      return;
    }
    setAbonoFor(null);
    setError(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-pizarra-900">
            Cuentas por {tab === "receivable" ? "cobrar" : "pagar"}
          </h1>
          <p className="mt-1 text-sm text-pizarra-600">
            {rows.length} cuenta{rows.length !== 1 ? "s" : ""} ·{" "}
            {overdue > 0 && (
              <span className="font-semibold text-alerta-700">
                {overdue} vencida{overdue > 1 ? "s" : ""}
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-1 rounded-xl bg-pizarra-100 p-1">
          <button
            onClick={() => setTab("receivable")}
            className={`rounded-lg px-4 py-2 text-sm font-semibold ${
              tab === "receivable"
                ? "bg-white text-brand-700 shadow-sm"
                : "text-pizarra-600"
            }`}
          >
            Por cobrar
          </button>
          <button
            onClick={() => setTab("payable")}
            className={`rounded-lg px-4 py-2 text-sm font-semibold ${
              tab === "payable"
                ? "bg-white text-brand-700 shadow-sm"
                : "text-pizarra-600"
            }`}
          >
            Por pagar
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-pizarra-200 bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tab === "receivable" ? "Cliente" : "Proveedor"}</TableHead>
              <TableHead>Concepto</TableHead>
              <TableHead className="text-right">Monto USD</TableHead>
              <TableHead className="text-right">Abonado</TableHead>
              <TableHead className="text-right">Saldo</TableHead>
              <TableHead>Vence</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-pizarra-500">
                  No hay cuentas por {tab === "receivable" ? "cobrar" : "pagar"}.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => {
              const saldo = balance(r);
              const vencida =
                r.status !== "paid" && r.dueDate && new Date(r.dueDate) < new Date();
              return (
                <TableRow key={r.id}>
                  <TableCell className="font-semibold text-pizarra-900">
                    {r.contactName ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm text-pizarra-600">
                    {r.notes ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(r.amountUsd, "usd")}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-pizarra-600">
                    {formatMoney(r.paidUsd, "usd")}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {formatMoney(saldo.toFixed(2), "usd")}
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.dueDate
                      ? new Date(r.dueDate).toLocaleDateString("es-VE")
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {r.status === "paid" ? (
                      <Badge variant="success">Saldada</Badge>
                    ) : r.status === "partial" ? (
                      <Badge variant="warning">Parcial</Badge>
                    ) : vencida ? (
                      <Badge variant="danger">Vencida</Badge>
                    ) : (
                      <Badge variant="secondary">Pendiente</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {r.status !== "paid" && (
                      <Button variant="outline" size="sm" onClick={() => setAbonoFor(r)}>
                        Registrar abono
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!abonoFor} onOpenChange={(o) => !o && setAbonoFor(null)}>
        <DialogContent>
          <form onSubmit={handleAbono}>
            <DialogHeader>
              <DialogTitle>Registrar abono</DialogTitle>
              <DialogDescription>
                {abonoFor?.contactName ?? ""} · Saldo pendiente:{" "}
                {abonoFor ? formatMoney(balance(abonoFor).toFixed(2), "usd") : ""}
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label>Método</Label>
                  <Select value={method} onValueChange={setMethod}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash_usd">Efectivo USD</SelectItem>
                      <SelectItem value="cash_ves">Efectivo Bs</SelectItem>
                      <SelectItem value="zelle">Zelle</SelectItem>
                      <SelectItem value="pago_movil">Pago Móvil</SelectItem>
                      <SelectItem value="pos">Punto de venta</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Moneda</Label>
                  <Select
                    value={currency}
                    onValueChange={(v: "usd" | "ves" | "eur") => setCurrency(v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="usd">USD</SelectItem>
                      <SelectItem value="ves">Bs</SelectItem>
                      <SelectItem value="eur">EUR</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Monto</Label>
                  <Input
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
              </div>
            </div>
            {error && (
              <p className="mt-3 rounded-lg bg-error-50 px-3 py-2 text-sm text-error-700">
                {error}
              </p>
            )}
            <DialogFooter className="mt-5">
              <Button variant="outline" type="button" onClick={() => setAbonoFor(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={busy}>
                Guardar abono
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
