import { eq } from "drizzle-orm";

import { db } from "@/core/db-cloud/client";
import { products } from "@/core/db-cloud/schema";
import { requireOrgContext } from "@/lib/tenant";
import KardexClient from "./kardex-client";

export const dynamic = "force-dynamic";

export default async function KardexPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  if (!ctx) return null;

  const productRows = await db
    .select()
    .from(products)
    .where(eq(products.organizationId, ctx.org.id));

  return <KardexClient products={productRows} />;
}
