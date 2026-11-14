import { eq } from "drizzle-orm";

import { db } from "@/core/db-cloud/client";
import { members, user } from "@/core/db-cloud/schema";
import { requireOrgContext } from "@/lib/tenant";
import TeamClient from "./team-client";

export const dynamic = "force-dynamic";

export default async function TeamPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  if (!ctx) return null;

  const rows = await db
    .select({
      memberId: members.id,
      role: members.role,
      userId: user.id,
      name: user.name,
      email: user.email,
    })
    .from(members)
    .innerJoin(user, eq(members.userId, user.id))
    .where(eq(members.organizationId, ctx.org.id));

  return (
    <TeamClient
      members={rows}
      org={{
        id: ctx.org.id,
        name: ctx.org.name,
        slug: ctx.org.slug,
        rif: ctx.org.rif,
        address: ctx.org.address,
        igtfRate: ctx.org.igtfRate,
      }}
      myRole={ctx.role}
    />
  );
}
