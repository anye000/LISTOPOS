import { db } from "@/core/db-cloud/client";
import { ledgerList } from "@/modules/finance/service";
import { requireOrgContext } from "@/lib/tenant";
import LedgerClient from "./ledger-client";

export const dynamic = "force-dynamic";

export default async function LedgerPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  if (!ctx) return null;

  const [receivables, payables] = await Promise.all([
    ledgerList(db, ctx.org.id, "receivable"),
    ledgerList(db, ctx.org.id, "payable"),
  ]);

  return <LedgerClient receivables={receivables} payables={payables} />;
}
