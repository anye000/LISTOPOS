import { desc, eq } from "drizzle-orm";

import { db } from "@/core/db-cloud/client";
import { accountsLedger, contacts, invoices } from "@/core/db-cloud/schema";
import { requireOrgContext } from "@/lib/tenant";
import CrmClient from "./crm-client";

export const dynamic = "force-dynamic";

export default async function CrmPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  if (!ctx) return null;

  const [contactRows, ledgerRows, invoiceRows] = await Promise.all([
    db
      .select()
      .from(contacts)
      .where(eq(contacts.organizationId, ctx.org.id))
      .orderBy(desc(contacts.updatedAt)),
    db
      .select()
      .from(accountsLedger)
      .where(eq(accountsLedger.organizationId, ctx.org.id)),
    db
      .select({
        id: invoices.id,
        contactId: invoices.contactId,
        number: invoices.number,
        totalUsd: invoices.totalUsd,
        date: invoices.date,
        status: invoices.status,
      })
      .from(invoices)
      .where(eq(invoices.organizationId, ctx.org.id))
      .orderBy(desc(invoices.date))
      .limit(500),
  ]);

  return (
    <CrmClient contacts={contactRows} ledger={ledgerRows} invoices={invoiceRows} />
  );
}
