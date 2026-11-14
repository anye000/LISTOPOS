import { eq } from "drizzle-orm";

import { db } from "@/core/db-cloud/client";
import { productRecipes, products } from "@/core/db-cloud/schema";
import { requireOrgContext } from "@/lib/tenant";
import RecipesClient from "./recipes-client";

export const dynamic = "force-dynamic";

export default async function RecipesPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  if (!ctx) return null;

  const [productRows, recipeRows] = await Promise.all([
    db
      .select()
      .from(products)
      .where(eq(products.organizationId, ctx.org.id)),
    db
      .select({
        id: productRecipes.id,
        productId: productRecipes.productId,
        componentId: productRecipes.componentId,
        quantity: productRecipes.quantity,
        unit: productRecipes.unit,
        productName: products.name,
      })
      .from(productRecipes)
      .innerJoin(products, eq(productRecipes.componentId, products.id))
      .where(eq(productRecipes.organizationId, ctx.org.id)),
  ]);

  return <RecipesClient products={productRows} recipes={recipeRows} />;
}
