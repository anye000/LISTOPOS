"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/core/db-cloud/client";
import { requireOrgContext } from "@/lib/tenant";
import {
  abonoInputSchema,
  bankAccountInputSchema,
  cashMovementInputSchema,
  cashRegisterInputSchema,
  closeRegisterInputSchema,
} from "@/modules/fiscal/validators";
import {
  bankList,
  closeRegister,
  createBankAccount,
  ledgerList,
  openRegister,
  registerAbono,
  registerCashMovement,
  type CloseRegisterResult,
} from "./service";

export interface ActionResult {
  ok: boolean;
  error?: string;
  result?: unknown;
}

export async function openRegisterAction(
  slug: string,
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireOrgContext(slug);
  if (!ctx) return { ok: false, error: "Sin acceso" };
  const parsed = cashRegisterInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos" };
  try {
    await openRegister(db, ctx.org.id, {
      ...parsed.data,
      userId: ctx.userId,
    });
    revalidatePath(`/${slug}/finance`, "layout");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "No se pudo abrir la caja",
    };
  }
}

export async function closeRegisterAction(
  slug: string,
  registerId: string,
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireOrgContext(slug);
  if (!ctx) return { ok: false, error: "Sin acceso" };
  const parsed = closeRegisterInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos" };
  try {
    const result: CloseRegisterResult = await closeRegister(
      db,
      ctx.org.id,
      registerId,
      { ...parsed.data, userId: ctx.userId },
    );
    revalidatePath(`/${slug}/finance`, "layout");
    return { ok: true, result };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "No se pudo cerrar la caja",
    };
  }
}

export async function addCashMovementAction(
  slug: string,
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireOrgContext(slug);
  if (!ctx) return { ok: false, error: "Sin acceso" };
  const parsed = cashMovementInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }
  try {
    await registerCashMovement(db, ctx.org.id, {
      ...parsed.data,
      userId: ctx.userId,
    });
    revalidatePath(`/${slug}/finance`, "layout");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "No se pudo registrar el movimiento",
    };
  }
}

export async function createBankAction(
  slug: string,
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireOrgContext(slug);
  if (!ctx) return { ok: false, error: "Sin acceso" };
  const parsed = bankAccountInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }
  try {
    await createBankAccount(db, ctx.org.id, parsed.data);
    revalidatePath(`/${slug}/finance`, "layout");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "No se pudo crear la cuenta",
    };
  }
}

export async function registerAbonoAction(
  slug: string,
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireOrgContext(slug);
  if (!ctx) return { ok: false, error: "Sin acceso" };
  const parsed = abonoInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }
  try {
    const result = await registerAbono(db, ctx.org.id, parsed.data);
    revalidatePath(`/${slug}/finance`, "layout");
    return { ok: true, result };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "No se pudo registrar el abono",
    };
  }
}

export async function getLedgerAction(
  slug: string,
  type: "receivable" | "payable",
) {
  const ctx = await requireOrgContext(slug);
  if (!ctx) return [];
  return ledgerList(db, ctx.org.id, type);
}

export async function getBanksAction(slug: string) {
  const ctx = await requireOrgContext(slug);
  if (!ctx) return [];
  return bankList(db, ctx.org.id);
}
