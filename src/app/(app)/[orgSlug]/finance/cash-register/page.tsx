import { desc, eq } from "drizzle-orm";

import { db } from "@/core/db-cloud/client";
import { cashMovements, cashRegisters, warehouses } from "@/core/db-cloud/schema";
import { requireOrgContext } from "@/lib/tenant";
import CashRegisterClient from "./cash-register-client";

export const dynamic = "force-dynamic";

export default async function CashRegisterPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  if (!ctx) return null;

  const [registers, warehouseRows, movements] = await Promise.all([
    db
      .select()
      .from(cashRegisters)
      .where(eq(cashRegisters.organizationId, ctx.org.id))
      .orderBy(desc(cashRegisters.openedAt))
      .limit(10),
    db
      .select()
      .from(warehouses)
      .where(eq(warehouses.organizationId, ctx.org.id)),
    db
      .select()
      .from(cashMovements)
      .where(eq(cashMovements.organizationId, ctx.org.id))
      .orderBy(desc(cashMovements.createdAt))
      .limit(100),
  ]);

  const open = registers.find((r) => r.status === "open");

  return (
    <CashRegisterClient
      registers={registers}
      warehouses={warehouseRows}
      movements={movements.filter((m) =>
        open ? m.cashRegisterId === open.id : true,
      )}
      openRegister={open ?? null}
    />
  );
}
