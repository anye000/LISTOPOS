import Link from "next/link";
import { Banknote, Landmark, Wallet } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function FinanceHubPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const sections = [
    {
      href: `/${orgSlug}/finance/cash-register`,
      title: "Control de caja",
      description:
        "Apertura de turno, gastos menores y Cierre Z con cuadre de sobrantes y faltantes.",
      icon: Wallet,
    },
    {
      href: `/${orgSlug}/finance/ledger`,
      title: "Cuentas por cobrar y pagar",
      description:
        "Facturas a crédito y deudas con proveedores, con abonos parciales multimoneda.",
      icon: Banknote,
    },
    {
      href: `/${orgSlug}/finance/banks`,
      title: "Bancos y billeteras",
      description:
        "Bancos nacionales, Zelle y Pago Móvil con saldo actualizado por cada pago.",
      icon: Landmark,
    },
  ];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-pizarra-900">Finanzas</h1>
        <p className="mt-1 text-sm text-pizarra-600">
          Caja, cuentas por cobrar/pagar y billeteras, todo en un solo lugar.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {sections.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="group rounded-2xl border border-pizarra-200 bg-white p-6 shadow-sm transition-all hover:border-brand-300 hover:shadow-md"
          >
            <div className="flex size-11 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm shadow-brand-600/30">
              <s.icon className="size-5" />
            </div>
            <h3 className="mt-4 text-lg font-bold text-pizarra-900">{s.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-pizarra-600">
              {s.description}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
