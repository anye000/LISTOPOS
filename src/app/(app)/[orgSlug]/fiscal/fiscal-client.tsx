"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, Plus } from "lucide-react";

import type { exchangeRates } from "@/core/db-cloud/schema";
import { addExchangeRate } from "@/modules/fiscal/actions";
import { formatRate } from "@/core/currency/format";
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

type Rate = typeof exchangeRates.$inferSelect;

export default function FiscalClient({ rates }: { rates: Rate[] }) {
  const org = useOrg();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [currency, setCurrency] = useState<"usd" | "eur">("usd");
  const [rateToVes, setRateToVes] = useState("");
  const [date, setDate] = useState(
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Caracas" }).format(
      new Date(),
    ),
  );
  const [month, setMonth] = useState(
    new Date().toISOString().slice(0, 7),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const result = await addExchangeRate(org.slug, {
      currency,
      rateToVes,
      date,
      source: "custom",
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "No se pudo guardar la tasa");
      return;
    }
    setOpen(false);
    setError(null);
    router.refresh();
  }

  function exportBook() {
    const url = `/api/fiscal/export?org=${encodeURIComponent(org.id)}&month=${month}`;
    window.open(url, "_blank");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-pizarra-900">Fiscal</h1>
          <p className="mt-1 text-sm text-pizarra-600">
            Tasas BCV y Libros SENIAT listos para tu contador.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="size-4" />
          Registrar tasa
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-pizarra-200 bg-white shadow-sm">
          <div className="border-b border-pizarra-200 px-5 py-4">
            <h2 className="font-bold text-pizarra-900">Historial de tasas BCV</h2>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Moneda</TableHead>
                <TableHead className="text-right">Tasa (Bs)</TableHead>
                <TableHead>Origen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rates.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-pizarra-500">
                    Aún no hay tasas registradas.
                  </TableCell>
                </TableRow>
              )}
              {rates.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-sm">{r.date}</TableCell>
                  <TableCell>
                    <Badge variant={r.currency === "usd" ? "default" : "secondary"}>
                      {r.currency.toUpperCase()}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {formatRate(r.rateToVes)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {r.source === "bcv" ? "BCV" : "Personalizada"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="rounded-2xl border border-pizarra-200 bg-white p-5 shadow-sm">
          <h2 className="font-bold text-pizarra-900">Libros SENIAT (Excel)</h2>
          <p className="mt-1 text-sm text-pizarra-600">
            Exporta los libros de compra y venta del mes con todas las columnas
            fiscales: fecha, RIF, número, base imponible, IVA, IGTF y total.
          </p>
          <div className="mt-4 space-y-3">
            <div className="space-y-2">
              <Label>Mes a exportar</Label>
              <Input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => exportBook()}>
                <FileSpreadsheet className="size-4" />
                Libro de ventas
              </Button>
              <Button variant="outline" onClick={() => exportBook()}>
                <FileSpreadsheet className="size-4" />
                Libro de compras
              </Button>
            </div>
            <p className="text-xs text-pizarra-400">
              El archivo incluye ambos libros (hojas “LIBRO VENTAS” y “LIBRO
              COMPRAS”).
            </p>
          </div>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={handleSave}>
            <DialogHeader>
              <DialogTitle>Registrar tasa de cambio</DialogTitle>
              <DialogDescription>
                La tasa queda asociada a la fecha y se usa en facturas emitidas
                ese día (inmutable en el tiempo).
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Moneda</Label>
                  <Select
                    value={currency}
                    onValueChange={(v: "usd" | "eur") => setCurrency(v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="usd">USD</SelectItem>
                      <SelectItem value="eur">EUR</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Fecha</Label>
                  <Input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Bs por 1 {currency.toUpperCase()}</Label>
                <Input
                  inputMode="decimal"
                  required
                  value={rateToVes}
                  onChange={(e) => setRateToVes(e.target.value)}
                  placeholder="36.50"
                />
              </div>
            </div>
            {error && (
              <p className="mt-3 rounded-lg bg-error-50 px-3 py-2 text-sm text-error-700">
                {error}
              </p>
            )}
            <DialogFooter className="mt-5">
              <Button variant="outline" type="button" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={busy}>
                Guardar tasa
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
