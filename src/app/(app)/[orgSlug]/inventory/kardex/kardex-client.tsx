"use client";

import { useState } from "react";
import { History } from "lucide-react";

import type { products } from "@/core/db-cloud/schema";
import { getKardexAction } from "@/modules/inventory/actions";
import { formatMoney } from "@/core/currency/format";
import { useOrg } from "@/ui/org-provider";
import { Badge } from "@/ui/badge";
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

interface KardexRow {
  id: string;
  warehouseName: string;
  type: string;
  quantity: string;
  unitCostUsd: string;
  referenceId: string | null;
  note: string | null;
  createdAt: Date;
}

const TYPE_LABELS: Record<string, string> = {
  purchase: "Compra",
  sale: "Venta",
  transfer_in: "Traslado (entrada)",
  transfer_out: "Traslado (salida)",
  adjustment_in: "Ajuste (entrada)",
  adjustment_out: "Ajuste (salida)",
  recipe_out: "Consumo receta",
};

export default function KardexClient({ products }: { products: Product[] }) {
  const { slug } = useOrg();
  const [productId, setProductId] = useState("");
  const [rows, setRows] = useState<KardexRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function load(productId: string) {
    setProductId(productId);
    if (!productId) {
      setRows(null);
      return;
    }
    setLoading(true);
    const result = await getKardexAction(slug, productId);
    setRows(result);
    setLoading(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-pizarra-900">Kardex</h1>
          <p className="mt-1 text-sm text-pizarra-600">
            Historial auditado de cada entrada, salida y ajuste con usuario y
            fecha.
          </p>
        </div>
        <div className="w-72">
          <Select value={productId || undefined} onValueChange={load}>
            <SelectTrigger>
              <SelectValue placeholder="Selecciona un producto…" />
            </SelectTrigger>
            <SelectContent>
              {products.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="rounded-2xl border border-pizarra-200 bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Movimiento</TableHead>
              <TableHead>Almacén</TableHead>
              <TableHead className="text-right">Cantidad</TableHead>
              <TableHead className="text-right">Costo unit. USD</TableHead>
              <TableHead>Referencia</TableHead>
              <TableHead>Nota</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!productId && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-pizarra-500">
                  <History className="mx-auto mb-2 size-6 text-pizarra-300" />
                  Selecciona un producto para ver su historial completo.
                </TableCell>
              </TableRow>
            )}
            {loading && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-pizarra-500">
                  Cargando historial…
                </TableCell>
              </TableRow>
            )}
            {rows && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-pizarra-500">
                  Este producto aún no tiene movimientos.
                </TableCell>
              </TableRow>
            )}
            {rows?.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="text-sm text-pizarra-600">
                  {new Date(r.createdAt).toLocaleString("es-VE")}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      r.quantity.startsWith("-") ? "warning" : "success"
                    }
                  >
                    {TYPE_LABELS[r.type] ?? r.type}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-pizarra-600">
                  {r.warehouseName}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.quantity}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(r.unitCostUsd, "usd")}
                </TableCell>
                <TableCell className="text-sm text-pizarra-500">
                  {r.referenceId ?? "—"}
                </TableCell>
                <TableCell className="text-sm text-pizarra-500">
                  {r.note ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
