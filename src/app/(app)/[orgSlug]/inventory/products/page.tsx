import { desc, eq } from "drizzle-orm";

import { db } from "@/core/db-cloud/client";
import { inventoryStocks, products } from "@/core/db-cloud/schema";
import { requireOrgContext } from "@/lib/tenant";
import ProductsClient from "./products-client";

export const dynamic = "force-dynamic";

export default async function ProductsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  if (!ctx) return null;

  const [productRows, stockRows] = await Promise.all([
    db
      .select()
      .from(products)
      .where(eq(products.organizationId, ctx.org.id))
      .orderBy(desc(products.updatedAt)),
    db
      .select()
      .from(inventoryStocks)
      .where(eq(inventoryStocks.organizationId, ctx.org.id)),
  ]);

  return <ProductsClient products={productRows} stocks={stockRows} />;
}
