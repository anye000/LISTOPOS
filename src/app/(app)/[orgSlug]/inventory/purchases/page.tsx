import { and, desc, eq } from "drizzle-orm";

import { db } from "@/core/db-cloud/client";
import { contacts, inventoryMovements, products, warehouses } from "@/core/db-cloud/schema";
import { requireOrgContext } from "@/lib/tenant";
import PurchasesClient from "./purchases-client";

export const dynamic = "force-dynamic";

export default async function PurchasesPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  if (!ctx) return null;

  const [movements, productRows, warehouseRows, supplierRows] =
    await Promise.all([
      db
        .select({
          id: inventoryMovements.id,
          productId: inventoryMovements.productId,
          productName: products.name,
          warehouseId: inventoryMovements.warehouseId,
          warehouseName: warehouses.name,
          quantity: inventoryMovements.quantity,
          unitCostUsd: inventoryMovements.unitCostUsd,
          referenceId: inventoryMovements.referenceId,
          note: inventoryMovements.note,
          createdAt: inventoryMovements.createdAt,
        })
        .from(inventoryMovements)
        .innerJoin(products, eq(inventoryMovements.productId, products.id))
        .innerJoin(warehouses, eq(inventoryMovements.warehouseId, warehouses.id))
        .where(
          and(
            eq(inventoryMovements.organizationId, ctx.org.id),
            eq(inventoryMovements.type, "purchase"),
          ),
        )
        .orderBy(desc(inventoryMovements.createdAt))
        .limit(100),
      db
        .select()
        .from(products)
        .where(eq(products.organizationId, ctx.org.id)),
      db
        .select()
        .from(warehouses)
        .where(eq(warehouses.organizationId, ctx.org.id)),
      db
        .select()
        .from(contacts)
        .where(eq(contacts.organizationId, ctx.org.id)),
    ]);

  return (
    <PurchasesClient
      movements={movements}
      products={productRows}
      warehouses={warehouseRows}
      suppliers={supplierRows.filter((c) => c.type === "supplier")}
    />
  );
}
