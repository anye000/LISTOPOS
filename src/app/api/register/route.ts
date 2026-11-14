/**
 * Registro SaaS multi-empresa (Fase 2):
 * crea la cuenta del usuario, su empresa, el almacén principal, la membresía
 * con rol `owner` y las tasas BCV iniciales — todo en una sola petición.
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { auth } from "@/core/auth/auth";
import { db } from "@/core/db-cloud/client";
import {
  exchangeRates,
  members,
  organizations,
  warehouses,
} from "@/core/db-cloud/schema";
import { pgErrorCode } from "@/lib/errors";
import { registerOrganizationInputSchema } from "@/modules/fiscal/validators";

/** Fecha de hoy en zona horaria de Venezuela (YYYY-MM-DD). */
function caracasToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Caracas",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = registerOrganizationInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Datos inválidos",
        issues: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }
  const data = parsed.data;

  const taken = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, data.slug))
    .limit(1);
  if (taken.length > 0) {
    return NextResponse.json(
      { error: "Ese nombre de empresa ya está en uso" },
      { status: 409 },
    );
  }

  const signUpRes = await auth.api.signUpEmail({
    body: { name: data.userName, email: data.email, password: data.password },
    asResponse: true,
  });
  if (!signUpRes.ok) {
    const errBody = (await signUpRes.json().catch(() => null)) as {
      message?: string;
    } | null;
    return NextResponse.json(
      { error: errBody?.message ?? "No se pudo crear la cuenta" },
      { status: signUpRes.status },
    );
  }
  const signUpBody = (await signUpRes.json()) as { user?: { id: string } };
  const userId = signUpBody.user?.id;
  if (!userId) {
    return NextResponse.json(
      { error: "Cuenta creada sin identificador de usuario" },
      { status: 500 },
    );
  }

  let org;
  try {
    [org] = await db
      .insert(organizations)
      .values({
        name: data.companyName,
        slug: data.slug,
        rif: data.rif ?? null,
        baseCurrency: "usd",
        igtfRate: "3.0000",
        plan: "beta",
      })
      .returning();
  } catch (err) {
    if (pgErrorCode(err) === "23505") {
      return NextResponse.json(
        { error: "Ese nombre de empresa ya está en uso" },
        { status: 409 },
      );
    }
    throw err;
  }

  await db.insert(warehouses).values({
    organizationId: org.id,
    name: "Almacén Principal",
    isMain: true,
  });

  await db.insert(members).values({
    organizationId: org.id,
    userId,
    role: "owner",
  });

  const today = caracasToday();
  const initialRates: (typeof exchangeRates.$inferInsert)[] = [];
  if (data.initialUsdRate) {
    initialRates.push({
      organizationId: org.id,
      currency: "usd",
      rateToVes: data.initialUsdRate,
      date: today,
      source: "bcv",
    });
  }
  if (data.initialEurRate) {
    initialRates.push({
      organizationId: org.id,
      currency: "eur",
      rateToVes: data.initialEurRate,
      date: today,
      source: "bcv",
    });
  }
  if (initialRates.length > 0) {
    await db.insert(exchangeRates).values(initialRates);
  }

  const redirect = NextResponse.redirect(
    new URL(`/${org.slug}/dashboard`, req.nextUrl.origin),
    303,
  );
  for (const cookie of signUpRes.headers.getSetCookie()) {
    redirect.headers.append("set-cookie", cookie);
  }
  return redirect;
}
