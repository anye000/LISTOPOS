import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/core/auth/auth";
import { listUserOrganizations } from "@/lib/tenant";

/** Devuelve el slug de la primera empresa del usuario (post-login). */
export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ slug: null }, { status: 401 });
  }
  const orgs = await listUserOrganizations(session.user.id);
  return NextResponse.json({ slug: orgs[0]?.org.slug ?? null });
}
