"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";

import { db } from "@/core/db-cloud/client";
import * as s from "@/core/db-cloud/schema";
import { requireOrgContext } from "@/lib/tenant";
import { contactInputSchema } from "@/modules/fiscal/validators";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export async function createContact(
  slug: string,
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireOrgContext(slug);
  if (!ctx) return { ok: false, error: "Sin acceso" };
  const parsed = contactInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }
  await db.insert(s.contacts).values({
    organizationId: ctx.org.id,
    type: parsed.data.type,
    name: parsed.data.name,
    document: parsed.data.document ?? null,
    phone: parsed.data.phone ?? null,
    email: parsed.data.email || null,
    address: parsed.data.address ?? null,
    creditLimitUsd: parsed.data.creditLimitUsd,
    notes: parsed.data.notes ?? null,
  });
  revalidatePath(`/${slug}/crm`, "layout");
  return { ok: true };
}

export async function updateContact(
  slug: string,
  contactId: string,
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireOrgContext(slug);
  if (!ctx) return { ok: false, error: "Sin acceso" };
  const parsed = contactInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }
  await db
    .update(s.contacts)
    .set({
      type: parsed.data.type,
      name: parsed.data.name,
      document: parsed.data.document ?? null,
      phone: parsed.data.phone ?? null,
      email: parsed.data.email || null,
      address: parsed.data.address ?? null,
      creditLimitUsd: parsed.data.creditLimitUsd,
      notes: parsed.data.notes ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(eq(s.contacts.id, contactId), eq(s.contacts.organizationId, ctx.org.id)),
    );
  revalidatePath(`/${slug}/crm`, "layout");
  return { ok: true };
}
