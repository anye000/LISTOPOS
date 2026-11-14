"use server";

import { revalidatePath } from "next/cache";
import { desc, eq } from "drizzle-orm";

import { db } from "@/core/db-cloud/client";
import * as s from "@/core/db-cloud/schema";
import { requireOrgContext } from "@/lib/tenant";
import { exchangeRateInputSchema } from "@/modules/fiscal/validators";
import { upsertExchangeRate } from "./service";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export async function addExchangeRate(
  slug: string,
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireOrgContext(slug);
  if (!ctx) return { ok: false, error: "Sin acceso a esta empresa" };
  const parsed = exchangeRateInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }
  try {
    await upsertExchangeRate(db, ctx.org.id, parsed.data);
    revalidatePath(`/${slug}/fiscal`, "layout");
    revalidatePath(`/${slug}`, "layout");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "No se pudo guardar la tasa",
    };
  }
}

/** Lista las tasas de la organización (para el panel Fiscal). */
export async function listRatesAction(slug: string) {
  const ctx = await requireOrgContext(slug);
  if (!ctx) return [];
  return db
    .select()
    .from(s.exchangeRates)
    .where(eq(s.exchangeRates.organizationId, ctx.org.id))
    .orderBy(desc(s.exchangeRates.date));
}
