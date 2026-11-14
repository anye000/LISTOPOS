"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Warehouse } from "lucide-react";

import type { warehouses } from "@/core/db-cloud/schema";
import { createWarehouse } from "@/modules/inventory/actions";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/table";

type WarehouseRow = typeof warehouses.$inferSelect;

export default function WarehousesClient({
  warehouses: rows,
}: {
  warehouses: WarehouseRow[];
}) {
  const { slug } = useOrg();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const result = await createWarehouse(slug, { name, address: address || undefined });
    if (!result.ok) {
      setError(result.error ?? "No se pudo crear el almacén");
      setBusy(false);
      return;
    }
    setOpen(false);
    setName("");
    setAddress("");
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-pizarra-900">Almacenes</h1>
          <p className="mt-1 text-sm text-pizarra-600">
            Sucursales y depósitos entre los que puedes trasladar mercancía.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="size-4" />
          Nuevo almacén
        </Button>
      </div>

      <div className="rounded-2xl border border-pizarra-200 bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Dirección</TableHead>
              <TableHead>Tipo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="py-10 text-center text-pizarra-500">
                  Aún no hay almacenes.
                </TableCell>
              </TableRow>
            )}
            {rows.map((w) => (
              <TableRow key={w.id}>
                <TableCell className="flex items-center gap-2 font-semibold text-pizarra-900">
                  <Warehouse className="size-4 text-brand-600" />
                  {w.name}
                </TableCell>
                <TableCell className="text-sm text-pizarra-600">
                  {w.address ?? "—"}
                </TableCell>
                <TableCell>
                  {w.isMain ? (
                    <Badge>Principal</Badge>
                  ) : (
                    <Badge variant="secondary">Sucursal</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={handleSave}>
            <DialogHeader>
              <DialogTitle>Nuevo almacén</DialogTitle>
              <DialogDescription>
                Crea una sucursal o depósito adicional.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="w-name">Nombre</Label>
                <Input
                  id="w-name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Sucursal Centro"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="w-address">Dirección (opcional)</Label>
                <Input
                  id="w-address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Av. Bolívar, C.C. X"
                />
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
                {busy ? "Creando…" : "Crear almacén"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
