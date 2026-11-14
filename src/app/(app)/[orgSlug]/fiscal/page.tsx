import { desc, eq } from "drizzle-orm";

import { db } from "@/core/db-cloud/client";
import { exchangeRates } from "@/core/db-cloud/schema";
import { requireOrgContext } from "@/lib/tenant";
import FiscalClient from "./fiscal-client";

export const dynamic = "force-dynamic";

export default async function FiscalPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  if (!ctx) return null;

  const rates = await db
    .select()
    .from(exchangeRates)
    .where(eq(exchangeRates.organizationId, ctx.org.id))
    .orderBy(desc(exchangeRates.date));

  return <FiscalClient rates={rates} />;
}
