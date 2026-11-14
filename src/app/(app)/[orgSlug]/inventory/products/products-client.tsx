"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Search } from "lucide-react";

import type { inventoryStocks, products } from "@/core/db-cloud/schema";
import {
  createProduct,
  toggleProduct,
  updateProduct,
} from "@/modules/inventory/actions";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/table";

type Product = typeof products.$inferSelect;
type Stock = typeof inventoryStocks.$inferSelect;

interface ProductFormState {
  id?: string;
  name: string;
  sku: string;
  barcode: string;
  category: string;
  unit: string;
  costUsd: string;
  marginPercent: string;
  exemptVat: boolean;
  minStock: string;
  isComposite: boolean;
}

const emptyForm: ProductFormState = {
  name: "",
  sku: "",
  barcode: "",
  category: "",
  unit: "und",
  costUsd: "0",
  marginPercent: "0",
  exemptVat: false,
  minStock: "0",
  isComposite: false,
};

function previewPrice(costUsd: string, marginPercent: string): number {
  const cost = Number(costUsd) || 0;
  const margin = Number(marginPercent) || 0;
  return cost * (1 + margin / 100);
}

export default function ProductsClient({
  products: productRows,
  stocks,
}: {
  products: Product[];
  stocks: Stock[];
}) {
  const { slug, rates } = useOrg();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<ProductFormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const stockByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const st of stocks) {
      map.set(st.productId, (map.get(st.productId) ?? 0) + Number(st.quantity));
    }
    return map;
  }, [stocks]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return productRows;
    return productRows.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.barcode ?? "").toLowerCase().includes(q) ||
        (p.sku ?? "").toLowerCase().includes(q),
    );
  }, [productRows, query]);

  const usdToVes = rates.usdToVes ? Number(rates.usdToVes) : 0;

  function openCreate() {
    setForm(emptyForm);
    setError(null);
    setDialogOpen(true);
  }

  function openEdit(p: Product) {
    setForm({
      id: p.id,
      name: p.name,
      sku: p.sku ?? "",
      barcode: p.barcode ?? "",
      category: p.category ?? "",
      unit: p.unit,
      costUsd: p.costUsd,
      marginPercent: p.marginPercent,
      exemptVat: p.exemptVat,
      minStock: p.minStock,
      isComposite: p.isComposite,
    });
    setError(null);
    setDialogOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const input = {
      name: form.name,
      sku: form.sku || undefined,
      barcode: form.barcode || undefined,
      category: form.category || undefined,
      unit: form.unit,
      costUsd: form.costUsd,
      marginPercent: form.marginPercent,
      exemptVat: form.exemptVat,
      minStock: form.minStock,
      isComposite: form.isComposite,
    };
    const result = form.id
      ? await updateProduct(slug, form.id, input)
      : await createProduct(slug, input);
    if (!result.ok) {
      setError(result.error ?? "Error al guardar");
      setBusy(false);
      return;
    }
    setDialogOpen(false);
    setBusy(false);
    router.refresh();
  }

  async function handleToggle(p: Product) {
    await toggleProduct(slug, p.id, !p.active);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-pizarra-900">Productos</h1>
          <p className="mt-1 text-sm text-pizarra-600">
            {productRows.length} productos · Los precios en Bs se calculan con
            la tasa BCV activa ({usdToVes > 0 ? `Bs ${usdToVes}` : "sin tasa"}).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-pizarra-400" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nombre o código…"
              className="w-64 pl-9"
            />
          </div>
          <Button onClick={openCreate}>
            <Plus className="size-4" />
            Nuevo producto
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-pizarra-200 bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Producto</TableHead>
              <TableHead>Código</TableHead>
              <TableHead className="text-right">Costo USD</TableHead>
              <TableHead className="text-right">Margen</TableHead>
              <TableHead className="text-right">Detal USD</TableHead>
              <TableHead className="text-right">Detal Bs</TableHead>
              <TableHead className="text-right">Stock</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="py-10 text-center text-pizarra-500">
                  No hay productos. Crea el primero con “Nuevo producto”.
                </TableCell>
              </TableRow>
            )}
            {filtered.map((p) => {
              const total = stockByProduct.get(p.id) ?? 0;
              const low = total <= Number(p.minStock);
              const retailVes = Number(p.priceRetailUsd) * usdToVes;
              return (
                <TableRow key={p.id}>
                  <TableCell>
                    <div className="font-semibold text-pizarra-900">{p.name}</div>
                    <div className="text-xs text-pizarra-500">
                      {p.category ?? "Sin categoría"} · {p.unit}
                      {p.isComposite && " · Compuesto"}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-pizarra-600">
                    {p.barcode ?? p.sku ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(p.costUsd, "usd")}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-pizarra-600">
                    {p.marginPercent}%
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {formatMoney(p.priceRetailUsd, "usd")}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-pizarra-700">
                    {usdToVes > 0
                      ? formatMoney(retailVes.toFixed(2), "ves")
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge
                      variant={low ? (total <= 0 ? "danger" : "warning") : "secondary"}
                      className="tabular-nums"
                    >
                      {total}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {p.active ? (
                      <Badge variant="success">Activo</Badge>
                    ) : (
                      <Badge variant="secondary">Inactivo</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(p)}>
                        <Pencil className="size-3.5" />
                        Editar
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggle(p)}
                      >
                        {p.active ? "Desactivar" : "Activar"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <form onSubmit={handleSave}>
            <DialogHeader>
              <DialogTitle>
                {form.id ? "Editar producto" : "Nuevo producto"}
              </DialogTitle>
              <DialogDescription>
                El precio al detal se calcula: costo × (1 + margen%). El
                equivalente en Bs se actualiza con la tasa BCV.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="p-name">Nombre</Label>
                <Input
                  id="p-name"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Arepa Reina Pepiada"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-barcode">Código de barras</Label>
                <Input
                  id="p-barcode"
                  value={form.barcode}
                  onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                  placeholder="7591000001"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-sku">SKU interno</Label>
                <Input
                  id="p-sku"
                  value={form.sku}
                  onChange={(e) => setForm({ ...form, sku: e.target.value })}
                  placeholder="ARP-001"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-category">Categoría</Label>
                <Input
                  id="p-category"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  placeholder="Comidas"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-unit">Unidad</Label>
                <Input
                  id="p-unit"
                  value={form.unit}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}
                  placeholder="und"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-cost">Costo (USD)</Label>
                <Input
                  id="p-cost"
                  inputMode="decimal"
                  required
                  value={form.costUsd}
                  onChange={(e) => setForm({ ...form, costUsd: e.target.value })}
                  placeholder="1.50"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-margin">Margen de ganancia (%)</Label>
                <Input
                  id="p-margin"
                  inputMode="decimal"
                  required
                  value={form.marginPercent}
                  onChange={(e) => setForm({ ...form, marginPercent: e.target.value })}
                  placeholder="60"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-min">Stock mínimo</Label>
                <Input
                  id="p-min"
                  inputMode="decimal"
                  value={form.minStock}
                  onChange={(e) => setForm({ ...form, minStock: e.target.value })}
                  placeholder="5"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <label className="flex items-center gap-2 text-sm text-pizarra-700">
                  <input
                    type="checkbox"
                    checked={form.exemptVat}
                    onChange={(e) =>
                      setForm({ ...form, exemptVat: e.target.checked })
                    }
                    className="size-4 accent-brand-600"
                  />
                  Exento de IVA
                </label>
                <label className="flex items-center gap-2 text-sm text-pizarra-700">
                  <input
                    type="checkbox"
                    checked={form.isComposite}
                    onChange={(e) =>
                      setForm({ ...form, isComposite: e.target.checked })
                    }
                    className="size-4 accent-brand-600"
                  />
                  Es compuesto / plato / combo (usa receta)
                </label>
              </div>
              <div className="rounded-xl bg-brand-50 p-4 sm:col-span-2">
                <p className="text-sm font-semibold text-brand-900">
                  Vista previa: detal{" "}
                  {formatMoney(
                    previewPrice(form.costUsd, form.marginPercent).toFixed(2),
                    "usd",
                  )}
                  {usdToVes > 0 &&
                    ` · ${formatMoney(
                      (
                        previewPrice(form.costUsd, form.marginPercent) * usdToVes
                      ).toFixed(2),
                      "ves",
                    )}`}
                </p>
              </div>
            </div>
            {error && (
              <p className="mt-3 rounded-lg bg-error-50 px-3 py-2 text-sm text-error-700">
                {error}
              </p>
            )}
            <DialogFooter className="mt-5">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Guardando…" : "Guardar producto"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
