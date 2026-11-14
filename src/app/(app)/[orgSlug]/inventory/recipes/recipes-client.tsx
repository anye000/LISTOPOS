"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import type { products } from "@/core/db-cloud/schema";
import { saveRecipe } from "@/modules/inventory/actions";
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

interface RecipeRow {
  id: string;
  productId: string;
  componentId: string;
  quantity: string;
  unit: string;
  productName: string;
}

interface ComponentLine {
  componentId: string;
  quantity: string;
}

export default function RecipesClient({
  products: productRows,
  recipes,
}: {
  products: Product[];
  recipes: RecipeRow[];
}) {
  const { slug } = useOrg();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState("");
  const [isComposite, setIsComposite] = useState(true);
  const [lines, setLines] = useState<ComponentLine[]>([
    { componentId: "", quantity: "1" },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const composites = useMemo(
    () => productRows.filter((p) => p.isComposite),
    [productRows],
  );

  const componentsFor = (productId: string) =>
    recipes.filter((r) => r.productId === productId);

  function openDialog(product?: Product) {
    if (product) {
      setProductId(product.id);
      setIsComposite(product.isComposite);
      const existing = componentsFor(product.id);
      setLines(
        existing.length > 0
          ? existing.map((r) => ({ componentId: r.componentId, quantity: r.quantity }))
          : [{ componentId: "", quantity: "1" }],
      );
    } else {
      setProductId("");
      setIsComposite(true);
      setLines([{ componentId: "", quantity: "1" }]);
    }
    setError(null);
    setOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const components = lines.filter((l) => l.componentId);
    if (!productId) {
      setError("Selecciona un producto");
      return;
    }
    if (components.length === 0) {
      setError("Añade al menos un insumo");
      return;
    }
    setBusy(true);
    const result = await saveRecipe(slug, {
      productId,
      isComposite,
      components: components.map((l) => ({
        componentId: l.componentId,
        quantity: l.quantity,
      })),
    });
    if (!result.ok) {
      setError(result.error ?? "No se pudo guardar la receta");
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
          <h1 className="text-2xl font-bold text-pizarra-900">Recetas y combos</h1>
          <p className="mt-1 text-sm text-pizarra-600">
            Al vender un producto compuesto, el sistema descuenta sus insumos
            automáticamente del inventario.
          </p>
        </div>
        <Button onClick={() => openDialog()}>
          <Plus className="size-4" />
          Configurar receta
        </Button>
      </div>

      <div className="rounded-2xl border border-pizarra-200 bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Producto compuesto</TableHead>
              <TableHead>Insumos</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {composites.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="py-10 text-center text-pizarra-500">
                  Marca un producto como “Compuesto” en Productos y configura
                  su receta aquí.
                </TableCell>
              </TableRow>
            )}
            {composites.map((p) => {
              const comps = componentsFor(p.id);
              return (
                <TableRow key={p.id}>
                  <TableCell className="font-semibold text-pizarra-900">
                    {p.name}
                  </TableCell>
                  <TableCell>
                    {comps.length === 0 ? (
                      <Badge variant="warning">Sin insumos configurados</Badge>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {comps.map((c) => (
                          <Badge key={c.id} variant="secondary">
                            {c.productName}: {c.quantity} {c.unit}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => openDialog(p)}>
                      Editar receta
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={handleSave}>
            <DialogHeader>
              <DialogTitle>Receta del producto</DialogTitle>
              <DialogDescription>
                Elige el plato/combo y sus insumos con las cantidades exactas
                que se descuentan por cada unidad vendida.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 space-y-4">
              <div className="space-y-2">
                <Label>Producto</Label>
                <Select value={productId || undefined} onValueChange={setProductId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona un producto…" />
                  </SelectTrigger>
                  <SelectContent>
                    {productRows.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Insumos (cantidad por 1 unidad vendida)</Label>
                {lines.map((line, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Select
                      value={line.componentId || undefined}
                      onValueChange={(v) =>
                        setLines((prev) =>
                          prev.map((l, j) => (j === i ? { ...l, componentId: v } : l)),
                        )
                      }
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Insumo…" />
                      </SelectTrigger>
                      <SelectContent>
                        {productRows
                          .filter((p) => p.id !== productId)
                          .map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <Input
                      inputMode="decimal"
                      className="w-28"
                      value={line.quantity}
                      onChange={(e) =>
                        setLines((prev) =>
                          prev.map((l, j) => (j === i ? { ...l, quantity: e.target.value } : l)),
                        )
                      }
                      placeholder="Cant."
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setLines((prev) => prev.filter((_, j) => j !== i))
                      }
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
                    setLines((prev) => [...prev, { componentId: "", quantity: "1" }])
                  }
                >
                  + Añadir insumo
                </Button>
              </div>

              <label className="flex items-center gap-2 text-sm text-pizarra-700">
                <input
                  type="checkbox"
                  checked={isComposite}
                  onChange={(e) => setIsComposite(e.target.checked)}
                  className="size-4 accent-brand-600"
                />
                Es compuesto / plato / combo
              </label>
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
                {busy ? "Guardando…" : "Guardar receta"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
