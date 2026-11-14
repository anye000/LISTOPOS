import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { auth } from "@/core/auth/auth";
import { db } from "@/core/db-cloud/client";
import { members } from "@/core/db-cloud/schema";
import { pullPayload } from "@/core/sync/server-service";

export const dynamic = "force-dynamic";

/** Descarga del catálogo, clientes y tasas BCV para la caché offline. */
export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ error: "no_session" }, { status: 401 });
  }
  const orgId = req.nextUrl.searchParams.get("org");
  if (!orgId) {
    return NextResponse.json({ error: "missing_org" }, { status: 400 });
  }
  const member = await db
    .select({ id: members.id })
    .from(members)
    .where(
      and(
        eq(members.organizationId, orgId),
        eq(members.userId, session.user.id),
      ),
    )
    .limit(1);
  if (member.length === 0) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const payload = await pullPayload(db, orgId);
  return NextResponse.json({ ...payload, syncedAt: new Date().toISOString() });
}
