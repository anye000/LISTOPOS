import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  Boxes,
  Coins,
  FileSpreadsheet,
  ReceiptText,
  ShieldCheck,
  WifiOff,
  Zap,
} from "lucide-react";

const features = [
  {
    icon: WifiOff,
    title: "POS que no se detiene",
    description:
      "Vende sin internet: la caja escribe en IndexedDB y sincroniza con la nube cuando vuelve la conexión. Cero pérdidas de ventas.",
  },
  {
    icon: Coins,
    title: "Multimoneda exacto",
    description:
      "USD, EUR y Bolívares con tasa BCV del día. Cálculos con decimal.js: precisión centavo a centavo, nunca flotantes.",
  },
  {
    icon: ReceiptText,
    title: "IGTF e IVA automáticos",
    description:
      "El 3% de IGTF se calcula solo sobre lo pagado en divisas. Facturas con desglose fiscal y tasa inalterable en el tiempo.",
  },
  {
    icon: Boxes,
    title: "Inventario y recetas",
    description:
      "Productos, combos y platos con insumos que se descuentan solos. Kardex auditado y multi-almacén por sucursal.",
  },
  {
    icon: FileSpreadsheet,
    title: "Libros SENIAT listos",
    description:
      "Exporta libros de compra y venta mensuales a Excel con todas las columnas fiscales exigidas. Tu contador lo agradece.",
  },
  {
    icon: ShieldCheck,
    title: "Multi-empresa seguro",
    description:
      "Varias empresas en una sola cuenta, con roles (dueño, admin, cajero, contador) y aislamiento total de datos.",
  },
];

const steps = [
  {
    n: "1",
    title: "Crea tu empresa",
    description:
      "Regístrate, registra tu RIF y ListoPOS configura tu almacén, tasa BCV inicial y caja.",
  },
  {
    n: "2",
    title: "Carga tu catálogo",
    description:
      "Productos con costo en USD y margen: ListoPOS calcula precios al detal y al mayor en Bs al instante.",
  },
  {
    n: "3",
    title: "Vende y factura",
    description:
      "Cobra mixto (Bs, USD, Zelle, Pago Móvil), imprime tickets o comparte facturas PDF por WhatsApp.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-white">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-pizarra-200/70 bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2.5">
            <Image src="/logo.svg" alt="ListoPOS" width={135} height={32} priority />
          </Link>
          <nav className="hidden items-center gap-6 text-sm font-medium text-pizarra-600 md:flex">
            <a href="#funciones" className="hover:text-brand-700">
              Funciones
            </a>
            <a href="#como-funciona" className="hover:text-brand-700">
              Cómo funciona
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="rounded-lg px-3 py-2 text-sm font-semibold text-pizarra-700 hover:bg-pizarra-100"
            >
              Iniciar sesión
            </Link>
            <Link
              href="/register"
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700"
            >
              Crear cuenta gratis
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-brand-50 via-white to-white" />
        <div className="relative mx-auto max-w-6xl px-4 pb-20 pt-16 text-center sm:pt-24">
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-4 py-1.5 text-sm font-semibold text-brand-800">
            <Zap className="size-4" />
            Beta abierta — gratis para los primeros negocios
          </span>
          <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-extrabold tracking-tight text-pizarra-900 sm:text-6xl">
            El ERP y Punto de Venta que{" "}
            <span className="text-gradient-brand">funciona sin internet</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-pizarra-600">
            ListoPOS es tu caja, inventario, contabilidad y facturación en una sola
            app. Multimoneda con tasa BCV, IGTF automático y libros SENIAT —
            diseñado para el comercio venezolano.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/register"
              className="inline-flex h-12 items-center gap-2 rounded-xl bg-brand-600 px-8 text-base font-semibold text-white shadow-lg shadow-brand-600/25 hover:bg-brand-700"
            >
              Crear cuenta gratis
              <ArrowRight className="size-4" />
            </Link>
            <a
              href="#funciones"
              className="inline-flex h-12 items-center rounded-xl border border-pizarra-300 bg-white px-8 text-base font-semibold text-pizarra-800 hover:bg-pizarra-50"
            >
              Ver funciones
            </a>
          </div>
          <p className="mt-4 text-sm text-pizarra-500">
            Sin tarjeta de crédito · Instalable en tu teléfono o tablet como app
          </p>
        </div>
      </section>

      {/* Funciones */}
      <section id="funciones" className="mx-auto max-w-6xl px-4 py-16">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight text-pizarra-900">
            Todo lo que tu negocio necesita
          </h2>
          <p className="mt-3 text-pizarra-600">
            Cinco módulos integrados: POS, Inventario, Finanzas, Fiscal y CRM.
          </p>
        </div>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="group rounded-2xl border border-pizarra-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="flex size-11 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm shadow-brand-600/30">
                <f.icon className="size-5" />
              </div>
              <h3 className="mt-4 text-lg font-bold text-pizarra-900">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-pizarra-600">
                {f.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Cómo funciona */}
      <section id="como-funciona" className="bg-pizarra-50 py-16">
        <div className="mx-auto max-w-6xl px-4">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight text-pizarra-900">
              En marcha en 3 pasos
            </h2>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {steps.map((s) => (
              <div key={s.n} className="relative rounded-2xl bg-white p-6 shadow-sm">
                <div className="flex size-10 items-center justify-center rounded-full bg-brand-gradient text-lg font-bold text-white">
                  {s.n}
                </div>
                <h3 className="mt-4 text-lg font-bold text-pizarra-900">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-pizarra-600">
                  {s.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA final */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <div className="relative overflow-hidden rounded-3xl bg-brand-gradient px-8 py-14 text-center text-white">
          <h2 className="text-3xl font-bold tracking-tight">
            Tu negocio no puede parar por falta de señal
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-brand-100">
            Empieza hoy con ListoPOS Beta: crea tu empresa, carga tus productos y
            haz tu primera venta en minutos.
          </p>
          <Link
            href="/register"
            className="mt-8 inline-flex h-12 items-center gap-2 rounded-xl bg-white px-8 text-base font-bold text-brand-700 shadow-lg hover:bg-brand-50"
          >
            Crear cuenta gratis
            <ArrowRight className="size-4" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-pizarra-200 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 sm:flex-row">
          <Image src="/logo.svg" alt="ListoPOS" width={135} height={32} />
          <p className="text-sm text-pizarra-500">
            © {new Date().getFullYear()} ListoPOS · Hecho con 💙 en Venezuela ·
            Versión Beta
          </p>
        </div>
      </footer>
    </div>
  );
}
