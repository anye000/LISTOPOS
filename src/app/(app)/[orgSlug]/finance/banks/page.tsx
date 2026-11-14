import { db } from "@/core/db-cloud/client";
import { bankList } from "@/modules/finance/service";
import { requireOrgContext } from "@/lib/tenant";
import BanksClient from "./banks-client";

export const dynamic = "force-dynamic";

export default async function BanksPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  if (!ctx) return null;

  const accounts = await bankList(db, ctx.org.id);
  return <BanksClient accounts={accounts} />;
}
