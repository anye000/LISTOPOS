import Link from "next/link";

import { getActiveRates, listUserOrganizations, requireOrgContext } from "@/lib/tenant";
import { AppShell } from "@/ui/app-shell";
import { OrgProvider } from "@/ui/org-provider";
import { Button } from "@/ui/button";

/** El layout hace verificaciones de DB → nunca prerenderizar. */
export const dynamic = "force-dynamic";

function AccessDenied() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-pizarra-50 px-4 text-center">
      <h1 className="text-2xl font-bold text-pizarra-900">
        No tienes acceso a esta empresa
      </h1>
      <p className="max-w-md text-pizarra-600">
        Tu usuario no es miembro de esta organización. Pide al dueño que te
        invite desde Ajustes → Equipo.
      </p>
      <Button asChild variant="outline">
        <Link href="/">Volver al inicio</Link>
      </Button>
    </div>
  );
}

export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  if (!ctx) return <AccessDenied />;

  const rates = await getActiveRates(ctx.org.id);
  const usd = rates.find((r) => r.currency === "usd");
  const eur = rates.find((r) => r.currency === "eur");
  const orgs = await listUserOrganizations(ctx.userId);

  return (
    <OrgProvider
      value={{
        id: ctx.org.id,
        name: ctx.org.name,
        slug: ctx.org.slug,
        rif: ctx.org.rif,
        address: ctx.org.address,
        baseCurrency: ctx.org.baseCurrency,
        igtfRate: ctx.org.igtfRate,
        role: ctx.role,
        rates: {
          usdToVes: usd?.rateToVes ?? null,
          eurToVes: eur?.rateToVes ?? null,
        },
      }}
    >
      <AppShell
        orgs={orgs.map((o) => ({ slug: o.org.slug, name: o.org.name }))}
        currentSlug={orgSlug}
        role={ctx.role}
        orgName={ctx.org.name}
      >
        {children}
      </AppShell>
    </OrgProvider>
  );
}
