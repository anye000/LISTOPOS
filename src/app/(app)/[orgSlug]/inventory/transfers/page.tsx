import { desc, eq, inArray } from "drizzle-orm";

import { db } from "@/core/db-cloud/client";
import { inventoryMovements, products, warehouses } from "@/core/db-cloud/schema";
import { requireOrgContext } from "@/lib/tenant";
import TransfersClient from "./transfers-client";

export const dynamic = "force-dynamic";

export default async function TransfersPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  if (!ctx) return null;

  const [movements, productRows, warehouseRows] = await Promise.all([
    db
      .select({
        id: inventoryMovements.id,
        productId: inventoryMovements.productId,
        productName: products.name,
        warehouseId: inventoryMovements.warehouseId,
        warehouseName: warehouses.name,
        type: inventoryMovements.type,
        quantity: inventoryMovements.quantity,
        referenceId: inventoryMovements.referenceId,
        createdAt: inventoryMovements.createdAt,
      })
      .from(inventoryMovements)
      .innerJoin(products, eq(inventoryMovements.productId, products.id))
      .innerJoin(warehouses, eq(inventoryMovements.warehouseId, warehouses.id))
      .where(
        inArray(inventoryMovements.type, ["transfer_in", "transfer_out"]),
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
  ]);

  const orgMovements = movements.filter(
    (m) => warehouseRows.some((w) => w.id === m.warehouseId),
  );

  return (
    <TransfersClient
      movements={orgMovements}
      products={productRows}
      warehouses={warehouseRows}
    />
  );
}
