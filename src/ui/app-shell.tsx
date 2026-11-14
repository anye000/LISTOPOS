"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Boxes,
  Building2,
  ChevronsUpDown,
  FileSpreadsheet,
  LayoutDashboard,
  LogOut,
  Settings,
  ShoppingCart,
  Store,
  Users,
  Wallet,
  WifiOff,
} from "lucide-react";

import { authClient } from "@/core/auth/auth-client";
import { cn } from "@/lib/cn";

interface OrgOption {
  slug: string;
  name: string;
}

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: string[];
}

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["owner", "admin", "cashier", "accountant"] },
  { href: "/pos", label: "Punto de Venta", icon: ShoppingCart, roles: ["owner", "admin", "cashier", "accountant"] },
  { href: "/inventory", label: "Inventario", icon: Boxes, roles: ["owner", "admin", "accountant"] },
  { href: "/finance", label: "Finanzas", icon: Wallet, roles: ["owner", "admin", "accountant"] },
  { href: "/crm", label: "CRM", icon: Users, roles: ["owner", "admin", "cashier", "accountant"] },
  { href: "/fiscal", label: "Fiscal", icon: FileSpreadsheet, roles: ["owner", "admin", "accountant"] },
  { href: "/settings", label: "Ajustes", icon: Settings, roles: ["owner", "admin"] },
];

function OrgSwitcher({
  orgs,
  currentSlug,
}: {
  orgs: OrgOption[];
  currentSlug: string;
}) {
  const router = useRouter();
  const current = orgs.find((o) => o.slug === currentSlug);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="flex items-center gap-2 rounded-lg border border-pizarra-200 bg-white px-3 py-2 text-sm font-medium text-pizarra-800 shadow-sm hover:bg-pizarra-50">
          <Building2 className="size-4 text-brand-600" />
          <span className="max-w-40 truncate">{current?.name ?? "Empresa"}</span>
          <ChevronsUpDown className="size-3.5 text-pizarra-400" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-[240px] rounded-xl border border-pizarra-200 bg-white p-1.5 shadow-lg"
        >
          <p className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-pizarra-400">
            Mis empresas
          </p>
          {orgs.map((o) => (
            <DropdownMenu.Item
              key={o.slug}
              onSelect={() => router.push(`/${o.slug}/dashboard`)}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none",
                o.slug === currentSlug
                  ? "bg-brand-50 font-semibold text-brand-800"
                  : "text-pizarra-700 hover:bg-pizarra-50",
              )}
            >
              <Store className="size-4" />
              {o.name}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function AppShell({
  orgs,
  currentSlug,
  role,
  orgName,
  children,
}: {
  orgs: OrgOption[];
  currentSlug: string;
  role: string;
  orgName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const base = `/${currentSlug}`;
  const items = NAV.filter((i) => i.roles.includes(role));

  async function logout() {
    await authClient.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <div className="min-h-dvh bg-pizarra-50">
      {/* Sidebar escritorio/tablet */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-pizarra-200 bg-white md:flex">
        <div className="flex h-16 items-center border-b border-pizarra-200 px-4">
          <Image src="/logo.svg" alt="ListoPOS" width={120} height={28} priority />
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {items.map((item) => {
            const href = `${base}${item.href}`;
            const active =
              pathname === href ||
              pathname.startsWith(`${href}/`) ||
              (item.href === "/dashboard" && pathname === base);
            return (
              <Link
                key={item.href}
                href={href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-brand-50 text-brand-800"
                    : "text-pizarra-600 hover:bg-pizarra-100 hover:text-pizarra-900",
                )}
              >
                <item.icon className="size-5 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-pizarra-200 p-3">
          <div className="mb-2 flex items-center gap-2 rounded-lg bg-pizarra-50 px-3 py-2 text-xs font-medium text-pizarra-500">
            <WifiOff className="size-4" />
            Offline-First activo
          </div>
          <button
            onClick={logout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-pizarra-600 hover:bg-error-50 hover:text-error-700"
          >
            <LogOut className="size-5" />
            Cerrar sesión
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col md:pl-60">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-pizarra-200 bg-white/90 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-2">
            <span className="md:hidden">
              <Image src="/icon.svg" alt="ListoPOS" width={28} height={28} />
            </span>
            <span className="hidden max-w-56 truncate text-sm font-semibold text-pizarra-900 md:block">
              {orgName}
            </span>
          </div>
          <OrgSwitcher orgs={orgs} currentSlug={currentSlug} />
        </header>

        {/* Nav móvil */}
        <nav className="flex gap-1 overflow-x-auto border-b border-pizarra-200 bg-white px-2 py-2 md:hidden">
          {items.map((item) => {
            const href = `${base}${item.href}`;
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={item.href}
                href={href}
                className={cn(
                  "flex shrink-0 flex-col items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-medium",
                  active ? "bg-brand-50 text-brand-800" : "text-pizarra-600",
                )}
              >
                <item.icon className="size-4" />
                {item.label.split(" ")[0]}
              </Link>
            );
          })}
        </nav>

        <main className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
