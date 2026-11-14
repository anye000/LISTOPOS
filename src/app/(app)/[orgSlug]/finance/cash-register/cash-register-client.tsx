"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LockOpen, Plus } from "lucide-react";

import type { cashMovements, cashRegisters, warehouses } from "@/core/db-cloud/schema";
import {
  addCashMovementAction,
  closeRegisterAction,
  openRegisterAction,
  type ActionResult,
} from "@/modules/finance/actions";
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

type Register = typeof cashRegisters.$inferSelect;
type Movement = typeof cashMovements.$inferSelect;
type Warehouse = typeof warehouses.$inferSelect;

interface CloseResult {
  expectedUsd: string;
  expectedVes: string;
  countedUsd: string;
  countedVes: string;
  diffUsd: string;
  diffVes: string;
}

export default function CashRegisterClient({
  registers,
  warehouses,
  movements,
  openRegister: open,
}: {
  registers: Register[];
  warehouses: Warehouse[];
  movements: Movement[];
  openRegister: Register | null;
}) {
  const { slug } = useOrg();
  const router = useRouter();
  const [openDialog, setOpenDialog] = useState(false);
  const [moveDialog, setMoveDialog] = useState(false);
  const [closeDialog, setCloseDialog] = useState(false);
  const [closeResult, setCloseResult] = useState<CloseResult | null>(null);
  const [warehouseId, setWarehouseId] = useState("");
  const [openingUsd, setOpeningUsd] = useState("0");
  const [openingVes, setOpeningVes] = useState("0");
  const [moveType, setMoveType] = useState<"income" | "expense">("expense");
  const [moveMethod, setMoveMethod] = useState("cash_ves");
  const [moveCurrency, setMoveCurrency] = useState<"usd" | "ves">("ves");
  const [moveAmount, setMoveAmount] = useState("");
  const [moveReason, setMoveReason] = useState("");
  const [countedUsd, setCountedUsd] = useState("0");
  const [countedVes, setCountedVes] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleOpen(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await openRegisterAction(slug, {
      warehouseId: warehouseId || undefined,
      openingBalanceUsd: openingUsd,
      openingBalanceVes: openingVes,
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? "Error");
      return;
    }
    setOpenDialog(false);
    setError(null);
    router.refresh();
  }

  async function handleMovement(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await addCashMovementAction(slug, {
      cashRegisterId: open!.id,
      type: moveType,
      method: moveMethod,
      currency: moveCurrency,
      amount: moveAmount,
      reason: moveReason || undefined,
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? "Error");
      return;
    }
    setMoveDialog(false);
    setError(null);
    router.refresh();
  }

  async function handleClose(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r: ActionResult = await closeRegisterAction(slug, open!.id, {
      countedUsd,
      countedVes,
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? "Error");
      return;
    }
    setCloseResult(r.result as CloseResult);
    setCloseDialog(false);
    setError(null);
    router.refresh();
  }

  const labelFor = (m: string) =>
    ({
      cash_usd: "Efectivo USD",
      cash_ves: "Efectivo Bs",
      pos: "Punto de venta",
      pago_movil: "Pago Móvil",
      zelle: "Zelle",
      other: "Otro",
    })[m] ?? m;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-pizarra-900">Control de caja</h1>
          <p className="mt-1 text-sm text-pizarra-600">
            {open
              ? `Turno abierto desde ${new Date(open.openedAt).toLocaleString("es-VE")}`
              : "No hay turno abierto. Ábrelo para empezar a facturar."}
          </p>
        </div>
        {!open ? (
          <Button onClick={() => setOpenDialog(true)}>
            <LockOpen className="size-4" />
            Abrir turno
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setMoveDialog(true)}>
              <Plus className="size-4" />
              Ingreso / gasto
            </Button>
            <Button onClick={() => setCloseDialog(true)}>Cierre Z</Button>
          </div>
        )}
      </div>

      {open && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-pizarra-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-medium text-pizarra-500">Apertura en USD</p>
            <p className="text-2xl font-bold text-pizarra-900">
              {formatMoney(open.openingBalanceUsd, "usd")}
            </p>
          </div>
          <div className="rounded-2xl border border-pizarra-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-medium text-pizarra-500">Apertura en Bs</p>
            <p className="text-2xl font-bold text-pizarra-900">
              {formatMoney(open.openingBalanceVes, "ves")}
            </p>
          </div>
        </div>
      )}

      {closeResult && (
        <div className="rounded-2xl border border-eco-200 bg-eco-50 p-5">
          <h2 className="font-bold text-eco-900">Cierre Z completado</h2>
          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
            <div>
              <p className="text-eco-800">Esperado USD: {formatMoney(closeResult.expectedUsd, "usd")}</p>
              <p className="text-eco-800">Contado USD: {formatMoney(closeResult.countedUsd, "usd")}</p>
              <p className="font-bold text-eco-900">
                {Number(closeResult.diffUsd) >= 0 ? "Sobrante" : "Faltante"}:{" "}
                {formatMoney(closeResult.diffUsd, "usd")}
              </p>
            </div>
            <div>
              <p className="text-eco-800">Esperado Bs: {formatMoney(closeResult.expectedVes, "ves")}</p>
              <p className="text-eco-800">Contado Bs: {formatMoney(closeResult.countedVes, "ves")}</p>
              <p className="font-bold text-eco-900">
                {Number(closeResult.diffVes) >= 0 ? "Sobrante" : "Faltante"}:{" "}
                {formatMoney(closeResult.diffVes, "ves")}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-pizarra-200 bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Apertura</TableHead>
              <TableHead>Cierre</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Apertura USD</TableHead>
              <TableHead className="text-right">Apertura Bs</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {registers.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="text-sm">
                  {new Date(r.openedAt).toLocaleString("es-VE")}
                </TableCell>
                <TableCell className="text-sm">
                  {r.closedAt ? new Date(r.closedAt).toLocaleString("es-VE") : "—"}
                </TableCell>
                <TableCell>
                  {r.status === "open" ? (
                    <Badge variant="success">Abierto</Badge>
                  ) : (
                    <Badge variant="secondary">Cerrado</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(r.openingBalanceUsd, "usd")}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(r.openingBalanceVes, "ves")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {movements.length > 0 && (
        <div className="rounded-2xl border border-pizarra-200 bg-white shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Método</TableHead>
                <TableHead className="text-right">Monto</TableHead>
                <TableHead>Motivo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movements.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="text-sm">
                    {new Date(m.createdAt).toLocaleString("es-VE")}
                  </TableCell>
                  <TableCell>
                    {m.type === "income" ? (
                      <Badge variant="success">Ingreso</Badge>
                    ) : (
                      <Badge variant="warning">Egreso</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{labelFor(m.method)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {m.currency === "usd"
                      ? formatMoney(m.amount, "usd")
                      : formatMoney(m.amount, "ves")}
                  </TableCell>
                  <TableCell className="text-sm text-pizarra-600">
                    {m.reason ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Abrir turno */}
      <Dialog open={openDialog} onOpenChange={setOpenDialog}>
        <DialogContent>
          <form onSubmit={handleOpen}>
            <DialogHeader>
              <DialogTitle>Abrir turno de caja</DialogTitle>
              <DialogDescription>
                Registra el monto inicial en cada moneda que el cajero recibe.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 space-y-4">
              <div className="space-y-2">
                <Label>Almacén / sucursal</Label>
                <Select value={warehouseId || undefined} onValueChange={setWarehouseId}>
                  <SelectTrigger>
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
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Fondo inicial USD</Label>
                  <Input
                    inputMode="decimal"
                    value={openingUsd}
                    onChange={(e) => setOpeningUsd(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Fondo inicial Bs</Label>
                  <Input
                    inputMode="decimal"
                    value={openingVes}
                    onChange={(e) => setOpeningVes(e.target.value)}
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
              <Button variant="outline" type="button" onClick={() => setOpenDialog(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={busy}>
                Abrir turno
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Ingreso/gasto */}
      <Dialog open={moveDialog} onOpenChange={setMoveDialog}>
        <DialogContent>
          <form onSubmit={handleMovement}>
            <DialogHeader>
              <DialogTitle>Ingreso o egreso manual</DialogTitle>
              <DialogDescription>
                Gastos menores, retiros o ingresos extraordinarios del turno.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Tipo</Label>
                  <Select
                    value={moveType}
                    onValueChange={(v: "income" | "expense") => setMoveType(v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="income">Ingreso</SelectItem>
                      <SelectItem value="expense">Egreso / gasto</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Método</Label>
                  <Select value={moveMethod} onValueChange={setMoveMethod}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash_usd">Efectivo USD</SelectItem>
                      <SelectItem value="cash_ves">Efectivo Bs</SelectItem>
                      <SelectItem value="pago_movil">Pago Móvil</SelectItem>
                      <SelectItem value="zelle">Zelle</SelectItem>
                      <SelectItem value="pos">Punto de venta</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Moneda</Label>
                  <Select
                    value={moveCurrency}
                    onValueChange={(v: "usd" | "ves") => setMoveCurrency(v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="usd">USD</SelectItem>
                      <SelectItem value="ves">Bs</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Monto</Label>
                  <Input
                    inputMode="decimal"
                    value={moveAmount}
                    onChange={(e) => setMoveAmount(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Motivo</Label>
                <Input
                  value={moveReason}
                  onChange={(e) => setMoveReason(e.target.value)}
                  placeholder="Gasolina, almuerzo…"
                />
              </div>
            </div>
            {error && (
              <p className="mt-3 rounded-lg bg-error-50 px-3 py-2 text-sm text-error-700">
                {error}
              </p>
            )}
            <DialogFooter className="mt-5">
              <Button variant="outline" type="button" onClick={() => setMoveDialog(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={busy}>
                Registrar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Cierre Z */}
      <Dialog open={closeDialog} onOpenChange={setCloseDialog}>
        <DialogContent>
          <form onSubmit={handleClose}>
            <DialogHeader>
              <DialogTitle>Cierre Z del turno</DialogTitle>
              <DialogDescription>
                Cuenta físicamente el efectivo y registra los montos. ListoPOS
                compara con lo esperado y marca sobrantes o faltantes.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Contado en USD</Label>
                <Input
                  inputMode="decimal"
                  value={countedUsd}
                  onChange={(e) => setCountedUsd(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Contado en Bs</Label>
                <Input
                  inputMode="decimal"
                  value={countedVes}
                  onChange={(e) => setCountedVes(e.target.value)}
                />
              </div>
            </div>
            {error && (
              <p className="mt-3 rounded-lg bg-error-50 px-3 py-2 text-sm text-error-700">
                {error}
              </p>
            )}
            <DialogFooter className="mt-5">
              <Button variant="outline" type="button" onClick={() => setCloseDialog(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={busy}>
                Cerrar turno (Z)
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
