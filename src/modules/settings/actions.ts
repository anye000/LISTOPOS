"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";

import { db } from "@/core/db-cloud/client";
import * as s from "@/core/db-cloud/schema";
import { pgErrorCode } from "@/lib/errors";
import { requireOrgContext } from "@/lib/tenant";
import { orgSettingsSchema } from "@/modules/fiscal/validators";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** Actualiza datos de la empresa (nombre, RIF, dirección, tasa IGTF). */
export async function updateOrgSettings(
  slug: string,
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireOrgContext(slug);
  if (!ctx) return { ok: false, error: "Sin acceso" };
  if (ctx.role !== "owner" && ctx.role !== "admin") {
    return { ok: false, error: "Solo el dueño o un admin pueden cambiar estos datos" };
  }
  const parsed = orgSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }
  await db
    .update(s.organizations)
    .set({
      name: parsed.data.name,
      rif: parsed.data.rif ?? null,
      address: parsed.data.address ?? null,
      igtfRate: parsed.data.igtfRate,
      updatedAt: new Date(),
    })
    .where(eq(s.organizations.id, ctx.org.id));
  revalidatePath(`/${slug}`, "layout");
  return { ok: true };
}

/** Invita a un usuario existente a la empresa con un rol. */
export async function inviteMember(
  slug: string,
  input: { email: string; role: "admin" | "cashier" | "accountant" },
): Promise<ActionResult> {
  const ctx = await requireOrgContext(slug);
  if (!ctx) return { ok: false, error: "Sin acceso" };
  if (ctx.role !== "owner" && ctx.role !== "admin") {
    return { ok: false, error: "Solo el dueño o un admin pueden invitar" };
  }
  const email = input.email.trim().toLowerCase();
  const [invitee] = await db
    .select({ id: s.user.id })
    .from(s.user)
    .where(eq(s.user.email, email))
    .limit(1);
  if (!invitee) {
    return {
      ok: false,
      error:
        "Ese correo aún no tiene cuenta en ListoPOS. Pídele que cree su cuenta gratis primero.",
    };
  }
  try {
    await db.insert(s.members).values({
      organizationId: ctx.org.id,
      userId: invitee.id,
      role: input.role,
    });
  } catch (err) {
    if (pgErrorCode(err) === "23505") {
      return { ok: false, error: "Ese usuario ya es miembro de esta empresa" };
    }
    throw err;
  }
  revalidatePath(`/${slug}/settings`, "layout");
  return { ok: true };
}

/** Cambia el rol de un miembro (no se puede degradar al owner). */
export async function updateMemberRole(
  slug: string,
  memberId: string,
  role: "admin" | "cashier" | "accountant",
): Promise<ActionResult> {
  const ctx = await requireOrgContext(slug);
  if (!ctx) return { ok: false, error: "Sin acceso" };
  if (ctx.role !== "owner" && ctx.role !== "admin") {
    return { ok: false, error: "Solo el dueño o un admin pueden cambiar roles" };
  }
  const [member] = await db
    .select()
    .from(s.members)
    .where(
      and(
        eq(s.members.id, memberId),
        eq(s.members.organizationId, ctx.org.id),
      ),
    )
    .limit(1);
  if (!member) return { ok: false, error: "Miembro no encontrado" };
  if (member.role === "owner") {
    return { ok: false, error: "No se puede cambiar el rol del dueño" };
  }
  await db
    .update(s.members)
    .set({ role })
    .where(eq(s.members.id, memberId));
  revalidatePath(`/${slug}/settings`, "layout");
  return { ok: true };
}
