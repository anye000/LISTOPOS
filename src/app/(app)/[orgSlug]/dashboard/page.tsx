import Link from "next/link";
import Decimal from "decimal.js";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  ArrowRight,
  Boxes,
  Coins,
  ReceiptText,
  TrendingUp,
  TriangleAlert,
  Wallet,
} from "lucide-react";

import { db } from "@/core/db-cloud/client";
import {
  invoiceItems,
  invoices,
  payments,
  products,
} from "@/core/db-cloud/schema";
import { formatMoney, formatRate } from "@/core/currency/format";
import { getActiveRates, requireOrgContext } from "@/lib/tenant";
import { lowStockList } from "@/modules/inventory/service";
import { Badge } from "@/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/table";

export const dynamic = "force-dynamic";

/** Venezuela usa UTC-4 fijo: inicio del día/mes en hora de Caracas. */
function caracasStart(kind: "day" | "month"): Date {
  const offsetMs = 4 * 60 * 60 * 1000;
  const local = new Date(Date.now() - offsetMs);
  if (kind === "day") {
    return new Date(
      Date.UTC(
        local.getUTCFullYear(),
        local.getUTCMonth(),
        local.getUTCDate(),
      ) + offsetMs,
    );
  }
  return new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) + offsetMs,
  );
}

function sumMoney(values: (string | null | undefined)[]): Decimal {
  return values.reduce(
    (acc, v) => (v ? acc.plus(v) : acc),
    new Decimal(0),
  );
}

const METHOD_LABELS: Record<string, string> = {
  cash_usd: "Efectivo USD",
  cash_ves: "Efectivo Bs",
  pos: "Punto de venta",
  pago_movil: "Pago Móvil",
  zelle: "Zelle",
  credit: "Crédito",
  other: "Otro",
};

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  if (!ctx) return null;
  const { org } = ctx;

  const dayStart = caracasStart("day");
  const monthStart = caracasStart("month");

  const baseDocs = and(
    eq(invoices.organizationId, org.id),
    inArray(invoices.type, ["invoice", "delivery_note"]),
    inArray(invoices.status, ["issued", "paid", "credit"]),
  );

  const [
    monthDocs,
    todayDocs,
    topProducts,
    paymentRows,
    profitRows,
    lowStock,
    latestInvoices,
    rates,
  ] = await Promise.all([
    db
      .select()
      .from(invoices)
      .where(and(baseDocs, gte(invoices.date, monthStart))),
    db
      .select()
      .from(invoices)
      .where(and(baseDocs, gte(invoices.date, dayStart))),
    db
      .select({
        name: invoiceItems.name,
        qty: sql<string>`sum(${invoiceItems.quantity})`,
        totalUsd: sql<string>`sum(${invoiceItems.totalUsd})`,
      })
      .from(invoiceItems)
      .innerJoin(invoices, eq(invoiceItems.invoiceId, invoices.id))
      .where(
        and(
          eq(invoiceItems.organizationId, org.id),
          gte(invoices.date, monthStart),
          inArray(invoices.type, ["invoice", "delivery_note"]),
          inArray(invoices.status, ["issued", "paid", "credit"]),
        ),
      )
      .groupBy(invoiceItems.name)
      .orderBy(desc(sql`sum(${invoiceItems.quantity})`))
      .limit(5),
    db
      .select({
        method: payments.method,
        currency: payments.currency,
        amount: payments.amount,
        snapshot: invoices.exchangeRateSnapshot,
      })
      .from(payments)
      .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
      .where(
        and(
          eq(payments.organizationId, org.id),
          gte(invoices.date, monthStart),
        ),
      ),
    db
      .select({
        qty: invoiceItems.quantity,
        lineUsd: invoiceItems.totalUsd,
        costUsd: products.costUsd,
      })
      .from(invoiceItems)
      .innerJoin(invoices, eq(invoiceItems.invoiceId, invoices.id))
      .leftJoin(products, eq(invoiceItems.productId, products.id))
      .where(
        and(
          eq(invoiceItems.organizationId, org.id),
          gte(invoices.date, monthStart),
          inArray(invoices.type, ["invoice", "delivery_note"]),
          inArray(invoices.status, ["issued", "paid", "credit"]),
        ),
      ),
    lowStockList(db, org.id),
    db
      .select()
      .from(invoices)
      .where(eq(invoices.organizationId, org.id))
      .orderBy(desc(invoices.createdAt))
      .limit(5),
    getActiveRates(org.id),
  ]);

  // --- KPIs ---
  const todayUsd = sumMoney(todayDocs.map((d) => d.totalUsd));
  const todayVes = sumMoney(todayDocs.map((d) => d.totalVes));
  const monthUsd = sumMoney(monthDocs.map((d) => d.totalUsd));
  const monthVes = sumMoney(monthDocs.map((d) => d.totalVes));
  const monthIgtf = sumMoney(monthDocs.map((d) => d.igtfUsd));

  // --- Utilidad estimada del mes (precio de línea − costo actual) ---
  const revenue = sumMoney(profitRows.map((r) => r.lineUsd));
  const estimatedProfit = profitRows.reduce((acc, r) => {
    const cost = r.costUsd ? new Decimal(r.costUsd) : new Decimal(0);
    const line = new Decimal(r.qty).mul(cost);
    return acc.plus(r.lineUsd ?? "0").minus(line);
  }, new Decimal(0));
  const marginPercent = revenue.gt(0)
    ? estimatedProfit.div(revenue).mul(100).toFixed(1)
    : "0.0";

  // --- Flujo de caja del mes por método (equivalente USD con tasa de cada factura) ---
  const flow = new Map<string, Decimal>();
  for (const p of paymentRows) {
    const snap = p.snapshot;
    const usdRate = new Decimal(snap?.usdToVes || "1");
    const eurRate = new Decimal(snap?.eurToVes || snap?.usdToVes || "1");
    const amount = new Decimal(p.amount);
    let usd: Decimal;
    if (p.currency === "usd") usd = amount;
    else if (p.currency === "ves") usd = amount.div(usdRate);
    else usd = amount.mul(eurRate).div(usdRate);
    flow.set(p.method, (flow.get(p.method) ?? new Decimal(0)).plus(usd));
  }
  const flowRows = [...flow.entries()]
    .map(([method, total]) => ({ method, total }))
    .sort((a, b) => b.total.comparedTo(a.total));
  const flowTotal = flowRows.reduce(
    (acc, r) => acc.plus(r.total),
    new Decimal(0),
  );

  const maxTopQty = topProducts.reduce(
    (acc, p) => Math.max(acc, Number(p.qty ?? 0)),
    0,
  );

  const usdRate = rates.find((r) => r.currency === "usd")?.rateToVes;

  const kpis = [
    {
      label: "Ventas de hoy",
      icon: ReceiptText,
      main: formatMoney(todayUsd.toFixed(2), "usd"),
      sub: formatMoney(todayVes.toFixed(2), "ves"),
      extra: `${todayDocs.length} documento${todayDocs.length === 1 ? "" : "s"}`,
    },
    {
      label: "Ventas del mes",
      icon: TrendingUp,
      main: formatMoney(monthUsd.toFixed(2), "usd"),
      sub: formatMoney(monthVes.toFixed(2), "ves"),
      extra: `IGTF cobrado: ${formatMoney(monthIgtf.toFixed(2), "usd")}`,
    },
    {
      label: "Utilidad estimada (mes)",
      icon: Coins,
      main: formatMoney(estimatedProfit.toFixed(2), "usd"),
      sub: `Margen ${marginPercent}%`,
      extra: "Precio de venta − costo actual",
    },
    {
      label: "Flujo de caja (mes)",
      icon: Wallet,
      main: formatMoney(flowTotal.toFixed(2), "usd"),
      sub: formatMoney(todayVes.toFixed(2), "ves"),
      extra: `${flowRows.length} métodos de cobro`,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-pizarra-900">
            ¡Hola! 👋 Bienvenido a {org.name}
          </h1>
          <p className="mt-1 text-sm text-pizarra-600">
            Resumen gerencial de tu negocio. Todo lo vendido offline se suma
            aquí al sincronizar.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="gap-1.5">
            <Coins className="size-3.5" />
            Tasa USD: {usdRate ? formatRate(usdRate) : "por definir"}
          </Badge>
          <Badge variant="secondary">IGTF {org.igtfRate}%</Badge>
          <Badge variant="default">BETA</Badge>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-pizarra-600">
                {k.label}
              </CardTitle>
              <k.icon className="size-5 text-brand-600" />
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-2xl font-bold text-pizarra-900">{k.main}</p>
              <p className="mt-0.5 text-sm font-semibold text-eco-700">{k.sub}</p>
              <p className="mt-1 text-xs text-pizarra-500">{k.extra}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Top productos */}
        <Card>
          <CardHeader>
            <CardTitle>Productos más vendidos (mes)</CardTitle>
            <CardDescription>
              Ranking por unidades vendidas del mes en curso.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {topProducts.length === 0 && (
              <p className="py-6 text-center text-sm text-pizarra-500">
                Aún no hay ventas este mes. Abre el{" "}
                <Link
                  href={`/${orgSlug}/pos`}
                  className="font-semibold text-brand-700 hover:underline"
                >
                  Punto de Venta
                </Link>{" "}
                para empezar.
              </p>
            )}
            {topProducts.map((p, i) => {
              const qty = Number(p.qty ?? 0);
              const width = maxTopQty > 0 ? Math.max(6, (qty / maxTopQty) * 100) : 0;
              return (
                <div key={p.name}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-pizarra-800">
                      {i + 1}. {p.name}
                    </span>
                    <span className="tabular-nums text-pizarra-600">
                      {qty} und · {formatMoney(p.totalUsd ?? "0", "usd")}
                    </span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-pizarra-100">
                    <div
                      className="h-2 rounded-full bg-brand-500"
                      style={{ width: `${width}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Flujo de caja */}
        <Card>
          <CardHeader>
            <CardTitle>Flujo de caja del mes</CardTitle>
            <CardDescription>
              Cobros recibidos por método, convertidos a USD con la tasa de
              cada factura.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {flowRows.length === 0 ? (
              <p className="py-6 text-center text-sm text-pizarra-500">
                Sin cobros registrados este mes.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Método</TableHead>
                    <TableHead className="text-right">Equivalente USD</TableHead>
                    <TableHead className="text-right">%</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {flowRows.map((r) => (
                    <TableRow key={r.method}>
                      <TableCell className="text-sm">
                        {METHOD_LABELS[r.method] ?? r.method}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(r.total.toFixed(2), "usd")}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-pizarra-500">
                        {flowTotal.gt(0)
                          ? `${r.total.div(flowTotal).mul(100).toFixed(0)}%`
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell className="font-bold">Total</TableCell>
                    <TableCell className="text-right font-bold tabular-nums">
                      {formatMoney(flowTotal.toFixed(2), "usd")}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Stock bajo */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="flex items-center gap-2">
              {lowStock.length > 0 ? (
                <TriangleAlert className="size-5 text-alerta-600" />
              ) : (
                <Boxes className="size-5 text-brand-600" />
              )}
              Alertas de inventario
            </CardTitle>
            <Link
              href={`/${orgSlug}/inventory/products`}
              className="text-xs font-semibold text-brand-700 hover:underline"
            >
              Ver productos
            </Link>
          </CardHeader>
          <CardContent>
            {lowStock.length === 0 ? (
              <p className="text-sm text-pizarra-500">
                Todo el inventario está por encima del mínimo. 💪
              </p>
            ) : (
              <ul className="space-y-2">
                {lowStock.slice(0, 6).map((row) => {
                  const total = row.stocks.reduce(
                    (acc, st) => acc.plus(st.quantity),
                    new Decimal(0),
                  );
                  return (
                    <li
                      key={row.product.id}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="text-pizarra-800">{row.product.name}</span>
                      <Badge
                        variant={total.lte(0) ? "danger" : "warning"}
                        className="tabular-nums"
                      >
                        {total.lte(0) ? "Agotado" : `Quedan ${total.toString()}`}
                      </Badge>
                    </li>
                  );
                })}
                {lowStock.length > 6 && (
                  <li className="text-xs text-pizarra-500">
                    +{lowStock.length - 6} productos más…
                  </li>
                )}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Últimos documentos */}
        <Card>
          <CardHeader>
            <CardTitle>Últimos documentos</CardTitle>
            <CardDescription>
              Tus facturas y presupuestos más recientes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {latestInvoices.length === 0 ? (
              <p className="text-sm text-pizarra-500">
                Aún no hay ventas. Abre el{" "}
                <Link
                  href={`/${orgSlug}/pos`}
                  className="font-semibold text-brand-700 hover:underline"
                >
                  Punto de Venta
                </Link>{" "}
                para registrar la primera.
              </p>
            ) : (
              <ul className="divide-y divide-pizarra-100">
                {latestInvoices.map((inv) => (
                  <li
                    key={inv.id}
                    className="flex items-center justify-between py-2.5"
                  >
                    <div>
                      <p className="text-sm font-semibold text-pizarra-900">
                        {inv.number ?? "Borrador"}
                      </p>
                      <p className="text-xs text-pizarra-500">
                        {new Date(inv.date).toLocaleString("es-VE")} ·{" "}
                        {inv.type === "invoice"
                          ? "Factura"
                          : inv.type === "quote"
                            ? "Presupuesto"
                            : "Nota de entrega"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-pizarra-900">
                        {formatMoney(inv.totalUsd, "usd")}
                      </p>
                      <Badge
                        variant={
                          inv.status === "paid"
                            ? "success"
                            : inv.status === "credit"
                              ? "warning"
                              : "secondary"
                        }
                      >
                        {inv.status}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Accesos rápidos */}
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          {
            title: "Registrar venta",
            description: "Abre el POS offline y cobra en Bs, USD o mixto.",
            href: "/pos",
          },
          {
            title: "Cierre de caja",
            description: "Cuadra el turno del día con Cierre Z.",
            href: "/finance/cash-register",
          },
          {
            title: "Libros SENIAT",
            description: "Exporta ventas y compras del mes a Excel.",
            href: "/fiscal",
          },
        ].map((a) => (
          <Link
            key={a.href}
            href={`/${orgSlug}${a.href}`}
            className="group flex items-center justify-between rounded-xl border border-pizarra-200 bg-white p-4 shadow-sm transition-colors hover:border-brand-300 hover:bg-brand-50/40"
          >
            <div>
              <p className="text-sm font-semibold text-pizarra-900">{a.title}</p>
              <p className="mt-0.5 text-xs text-pizarra-500">{a.description}</p>
            </div>
            <ArrowRight className="size-4 text-pizarra-400 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-600" />
          </Link>
        ))}
      </div>
    </div>
  );
}
