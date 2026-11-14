import { eq } from "drizzle-orm";

import { db } from "@/core/db-cloud/client";
import { warehouses } from "@/core/db-cloud/schema";
import { requireOrgContext } from "@/lib/tenant";
import WarehousesClient from "./warehouses-client";

export const dynamic = "force-dynamic";

export default async function WarehousesPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  if (!ctx) return null;

  const rows = await db
    .select()
    .from(warehouses)
    .where(eq(warehouses.organizationId, ctx.org.id));

  return <WarehousesClient warehouses={rows} />;
}
