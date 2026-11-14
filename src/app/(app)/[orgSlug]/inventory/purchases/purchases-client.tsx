"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import type { contacts, products, warehouses } from "@/core/db-cloud/schema";
import { registerPurchaseAction } from "@/modules/inventory/actions";
import { formatMoney } from "@/core/currency/format";
import { useOrg } from "@/ui/org-provider";
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
type Contact = typeof contacts.$inferSelect;

interface MovementRow {
  id: string;
  productName: string;
  warehouseName: string;
  quantity: string;
  unitCostUsd: string;
  referenceId: string | null;
  createdAt: Date;
}

interface Line {
  productId: string;
  quantity: string;
  unitCostUsd: string;
}

export default function PurchasesClient({
  movements,
  products,
  warehouses,
  suppliers,
}: {
  movements: MovementRow[];
  products: Product[];
  warehouses: Warehouse[];
  suppliers: Contact[];
}) {
  const { slug } = useOrg();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [warehouseId, setWarehouseId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [lines, setLines] = useState<Line[]>([
    { productId: "", quantity: "1", unitCostUsd: "0" },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const totalUsd = lines.reduce(
    (acc, l) => acc + (Number(l.quantity) || 0) * (Number(l.unitCostUsd) || 0),
    0,
  );

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const valid = lines.filter((l) => l.productId);
    if (!warehouseId) {
      setError("Selecciona el almacén de destino");
      return;
    }
    if (valid.length === 0) {
      setError("Añade al menos un producto");
      return;
    }
    setBusy(true);
    const result = await registerPurchaseAction(slug, {
      warehouseId,
      supplierContactId: supplierId || undefined,
      invoiceNumber: invoiceNumber || undefined,
      lines: valid,
    });
    if (!result.ok) {
      setError(result.error ?? "No se pudo registrar la compra");
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
          <h1 className="text-2xl font-bold text-pizarra-900">Compras</h1>
          <p className="mt-1 text-sm text-pizarra-600">
            Registra facturas de proveedores: suma stock y recalcula el costo
            promedio ponderado.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="size-4" />
          Registrar compra
        </Button>
      </div>

      <div className="rounded-2xl border border-pizarra-200 bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Producto</TableHead>
              <TableHead>Almacén</TableHead>
              <TableHead className="text-right">Cantidad</TableHead>
              <TableHead className="text-right">Costo unit. USD</TableHead>
              <TableHead className="text-right">Total USD</TableHead>
              <TableHead>Factura</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {movements.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-pizarra-500">
                  Aún no hay compras registradas.
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
                <TableCell className="text-sm text-pizarra-600">
                  {m.warehouseName}
                </TableCell>
                <TableCell className="text-right tabular-nums">{m.quantity}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(m.unitCostUsd, "usd")}
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {formatMoney(
                    (Number(m.quantity) * Number(m.unitCostUsd)).toFixed(2),
                    "usd",
                  )}
                </TableCell>
                <TableCell className="text-sm text-pizarra-600">
                  {m.referenceId ?? "—"}
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
              <DialogTitle>Registrar compra</DialogTitle>
              <DialogDescription>
                El stock se suma y el costo promedio ponderado se recalcula
                automáticamente con precisión decimal.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label>Almacén destino</Label>
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
                <div className="space-y-2">
                  <Label>Proveedor</Label>
                  <Select value={supplierId || undefined} onValueChange={setSupplierId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Proveedor…" />
                    </SelectTrigger>
                    <SelectContent>
                      {suppliers.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>N° factura</Label>
                  <Input
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    placeholder="F-000123"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Productos comprados</Label>
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
                      className="w-24"
                      placeholder="Cant."
                      value={line.quantity}
                      onChange={(e) =>
                        setLines((prev) =>
                          prev.map((l, j) => (j === i ? { ...l, quantity: e.target.value } : l)),
                        )
                      }
                    />
                    <Input
                      inputMode="decimal"
                      className="w-28"
                      placeholder="Costo USD"
                      value={line.unitCostUsd}
                      onChange={(e) =>
                        setLines((prev) =>
                          prev.map((l, j) => (j === i ? { ...l, unitCostUsd: e.target.value } : l)),
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
                    setLines((prev) => [
                      ...prev,
                      { productId: "", quantity: "1", unitCostUsd: "0" },
                    ])
                  }
                >
                  + Añadir producto
                </Button>
              </div>

              <p className="rounded-xl bg-brand-50 px-4 py-3 text-sm font-semibold text-brand-900">
                Total compra: {formatMoney(totalUsd.toFixed(2), "usd")}
                {supplierId && " · se crea la cuenta por pagar al proveedor"}
              </p>
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
                {busy ? "Guardando…" : "Registrar compra"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
