import Link from "next/link";
import {
  ArrowLeftRight,
  Boxes,
  ChefHat,
  ClipboardList,
  History,
  TriangleAlert,
  Warehouse,
} from "lucide-react";

import { db } from "@/core/db-cloud/client";
import { lowStockList } from "@/modules/inventory/service";
import { requireOrgContext } from "@/lib/tenant";
import { Badge } from "@/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/card";

export const dynamic = "force-dynamic";

export default async function InventoryHubPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  if (!ctx) return null;

  const lowStock = await lowStockList(db, ctx.org.id);

  const sections = [
    {
      href: "/inventory/products",
      title: "Productos",
      description: "Catálogo con costo en USD, margen y precios en Bs al instante.",
      icon: Boxes,
      badge: null,
    },
    {
      href: "/inventory/recipes",
      title: "Recetas y combos",
      description: "Platos y combos que descuentan sus insumos automáticamente.",
      icon: ChefHat,
      badge: null,
    },
    {
      href: "/inventory/purchases",
      title: "Compras",
      description: "Facturas de proveedores con costo promedio ponderado.",
      icon: ClipboardList,
      badge: null,
    },
    {
      href: "/inventory/transfers",
      title: "Traslados",
      description: "Mueve mercancía entre sucursales y almacenes.",
      icon: ArrowLeftRight,
      badge: null,
    },
    {
      href: "/inventory/kardex",
      title: "Kardex",
      description: "Historial auditado de cada entrada, salida y ajuste.",
      icon: History,
      badge: null,
    },
    {
      href: "/inventory/warehouses",
      title: "Almacenes",
      description: "Sucursales y depósitos de tu empresa.",
      icon: Warehouse,
      badge: null,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-pizarra-900">Inventario</h1>
        <p className="mt-1 text-sm text-pizarra-600">
          Gestiona productos, recetas, compras y almacenes. Todo movimiento
          queda auditado en el kardex.
        </p>
      </div>

      {lowStock.length > 0 && (
        <Card className="border-alerta-200 bg-alerta-50/60">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <TriangleAlert className="size-5 text-alerta-600" />
              {lowStock.length} producto{lowStock.length > 1 ? "s" : ""} con
              stock bajo o agotado
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-wrap gap-2">
              {lowStock.map((row) => {
                const total = row.stocks.reduce(
                  (acc, st) => acc + Number(st.quantity),
                  0,
                );
                return (
                  <li key={row.product.id}>
                    <Badge variant={total <= 0 ? "danger" : "warning"}>
                      {row.product.name}: {total}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((sec) => (
          <Link
            key={sec.href}
            href={`/${orgSlug}${sec.href}`}
            className="group rounded-2xl border border-pizarra-200 bg-white p-6 shadow-sm transition-all hover:border-brand-300 hover:shadow-md"
          >
            <div className="flex size-11 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm shadow-brand-600/30">
              <sec.icon className="size-5" />
            </div>
            <div className="mt-4 flex items-center gap-2">
              <h3 className="text-lg font-bold text-pizarra-900">{sec.title}</h3>
              {sec.badge}
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-pizarra-600">
              {sec.description}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
