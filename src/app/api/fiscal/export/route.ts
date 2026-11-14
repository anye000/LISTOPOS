import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { auth } from "@/core/auth/auth";
import { db } from "@/core/db-cloud/client";
import { members } from "@/core/db-cloud/schema";
import {
  buildBooksXlsx,
  getPurchasesBook,
  getSalesBook,
} from "@/modules/fiscal/service";

export const dynamic = "force-dynamic";

/**
 * Exporta los Libros SENIAT (compra y venta) del mes en xlsx.
 * GET /api/fiscal/export?month=YYYY-MM
 */
export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ error: "no_session" }, { status: 401 });
  }
  const orgId = req.nextUrl.searchParams.get("org");
  const month = req.nextUrl.searchParams.get("month");
  if (!orgId || !month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "Parámetros inválidos" }, { status: 400 });
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

  try {
    const [sales, purchases] = await Promise.all([
      getSalesBook(db, orgId, month),
      getPurchasesBook(db, orgId, month),
    ]);
    const buffer = buildBooksXlsx(sales, purchases);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="libros-seniat-${month}.xlsx"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "error_export" },
      { status: 400 },
    );
  }
}
