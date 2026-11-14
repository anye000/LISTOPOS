"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Plus } from "lucide-react";

import type { products, warehouses } from "@/core/db-cloud/schema";
import { transferAction } from "@/modules/inventory/actions";
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

type Product = typeof products.$inferSelect;
type Warehouse = typeof warehouses.$inferSelect;

interface MovementRow {
  id: string;
  productName: string;
  warehouseName: string;
  type: string;
  quantity: string;
  referenceId: string | null;
  createdAt: Date;
}

interface Line {
  productId: string;
  quantity: string;
}

export default function TransfersClient({
  movements,
  products,
  warehouses,
}: {
  movements: MovementRow[];
  products: Product[];
  warehouses: Warehouse[];
}) {
  const { slug } = useOrg();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([{ productId: "", quantity: "1" }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const valid = lines.filter((l) => l.productId);
    if (!fromId || !toId) {
      setError("Selecciona el almacén de origen y destino");
      return;
    }
    if (valid.length === 0) {
      setError("Añade al menos un producto");
      return;
    }
    setBusy(true);
    const result = await transferAction(slug, {
      fromWarehouseId: fromId,
      toWarehouseId: toId,
      note: note || undefined,
      lines: valid,
    });
    if (!result.ok) {
      setError(result.error ?? "No se pudo realizar el traslado");
      setBusy(false);
      return;
    }
    setOpen(false);
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-pizarra-900">Traslados</h1>
          <p className="mt-1 text-sm text-pizarra-600">
            Mueve mercancía entre sucursales y almacenes con registro de kardex
            en ambos extremos.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="size-4" />
          Nuevo traslado
        </Button>
      </div>

      <div className="rounded-2xl border border-pizarra-200 bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Producto</TableHead>
              <TableHead>Movimiento</TableHead>
              <TableHead className="text-right">Cantidad</TableHead>
              <TableHead>Referencia</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {movements.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-pizarra-500">
                  Aún no hay traslados registrados.
                </TableCell>
              </TableRow>
            )}
            {movements.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="text-sm text-pizarra-600">
                  {new Date(m.createdAt).toLocaleString("es-VE")}
                </TableCell>
                <TableCell className="font-semibold text-pizarra-900">
                  {m.productName}
                </TableCell>
                <TableCell>
                  {m.type === "transfer_out" ? (
                    <Badge variant="warning">
                      <ArrowLeftRight className="size-3" /> Sale de {m.warehouseName}
                    </Badge>
                  ) : (
                    <Badge variant="success">
                      <ArrowLeftRight className="size-3" /> Entra a {m.warehouseName}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{m.quantity}</TableCell>
                <TableCell className="text-sm text-pizarra-500">
                  {m.referenceId ? m.referenceId.slice(0, 8) : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <form onSubmit={handleSave}>
            <DialogHeader>
              <DialogTitle>Nuevo traslado</DialogTitle>
              <DialogDescription>
                Valida existencias en el origen antes de mover la mercancía.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Almacén de origen</Label>
                  <Select value={fromId || undefined} onValueChange={setFromId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Origen…" />
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
                <div className="space-y-2">
                  <Label>Almacén de destino</Label>
                  <Select value={toId || undefined} onValueChange={setToId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Destino…" />
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
              <div className="space-y-2">
                <Label htmlFor="t-note">Nota (opcional)</Label>
                <Input
                  id="t-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Surtir sucursal"
                />
              </div>
              <div className="space-y-2">
                <Label>Productos a trasladar</Label>
                {lines.map((line, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Select
                      value={line.productId || undefined}
                      onValueChange={(v) =>
                        setLines((prev) =>
                          prev.map((l, j) => (j === i ? { ...l, productId: v } : l)),
                        )
                      }
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Producto…" />
                      </SelectTrigger>
                      <SelectContent>
                        {products.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      inputMode="decimal"
                      className="w-28"
                      placeholder="Cant."
                      value={line.quantity}
                      onChange={(e) =>
                        setLines((prev) =>
                          prev.map((l, j) => (j === i ? { ...l, quantity: e.target.value } : l)),
                        )
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
                    >
                      ✕
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setLines((prev) => [...prev, { productId: "", quantity: "1" }])
                  }
                >
                  + Añadir producto
                </Button>
              </div>
            </div>
            {error && (
              <p className="mt-3 rounded-lg bg-error-50 px-3 py-2 text-sm text-error-700">
                {error}
              </p>
            )}
            <DialogFooter className="mt-5">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Trasladando…" : "Realizar traslado"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
