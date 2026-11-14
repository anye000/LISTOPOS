import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { auth } from "@/core/auth/auth";
import { db } from "@/core/db-cloud/client";
import { members } from "@/core/db-cloud/schema";
import { pushEntry, type PushEnvelope } from "@/core/sync/server-service";

export const dynamic = "force-dynamic";

/** Recibe entradas de la cola offline y las aplica de forma idempotente. */
export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ error: "no_session" }, { status: 401 });
  }

  let envelope: PushEnvelope;
  try {
    envelope = (await req.json()) as PushEnvelope;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const member = await db
    .select({ id: members.id })
    .from(members)
    .where(
      and(
        eq(members.organizationId, envelope.organizationId),
        eq(members.userId, session.user.id),
      ),
    )
    .limit(1);
  if (member.length === 0) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const result = await pushEntry(db, envelope.organizationId, envelope);
  if (!result.ok) {
    const status =
      result.error === "tenant_mismatch" || result.error === "forbidden"
        ? 403
        : 400;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json(result);
}
