import { desc, eq } from "drizzle-orm";

import { db } from "@/core/db-cloud/client";
import {
  cashRegisters,
  contacts,
  exchangeRates,
  inventoryStocks,
  products,
  warehouses,
} from "@/core/db-cloud/schema";
import { requireOrgContext } from "@/lib/tenant";
import PosClient from "./pos-client";

export const dynamic = "force-dynamic";

export default async function PosPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  if (!ctx) return null;

  const [productRows, stockRows, contactRows, rateRows, warehouseRows, openRegisters] =
    await Promise.all([
      db
        .select()
        .from(products)
        .where(eq(products.organizationId, ctx.org.id)),
      db
        .select()
        .from(inventoryStocks)
        .where(eq(inventoryStocks.organizationId, ctx.org.id)),
      db
        .select()
        .from(contacts)
        .where(eq(contacts.organizationId, ctx.org.id)),
      db
        .select()
        .from(exchangeRates)
        .where(eq(exchangeRates.organizationId, ctx.org.id))
        .orderBy(desc(exchangeRates.date)),
      db
        .select()
        .from(warehouses)
        .where(eq(warehouses.organizationId, ctx.org.id)),
      db
        .select()
        .from(cashRegisters)
        .where(eq(cashRegisters.organizationId, ctx.org.id)),
    ]);

  return (
    <PosClient
      initialProducts={productRows}
      initialStocks={stockRows}
      initialContacts={contactRows}
      initialRates={rateRows}
      warehouses={warehouseRows}
      openRegisters={openRegisters.filter((r) => r.status === "open")}
    />
  );
}
