"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import Decimal from "decimal.js";

import { db } from "@/core/db-cloud/client";
import { d, money } from "@/core/currency/calculator";
import * as s from "@/core/db-cloud/schema";
import { pgErrorCode } from "@/lib/errors";
import { requireOrgContext } from "@/lib/tenant";
import {
  adjustStockInputSchema,
  productInputSchema,
  purchaseInputSchema,
  recipeInputSchema,
  transferInputSchema,
  warehouseInputSchema,
} from "@/modules/fiscal/validators";
import {
  adjustStock,
  kardexFor,
  registerPurchase,
  transferStock,
} from "./service";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function firstIssue(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Datos inválidos";
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

async function requireOrg(slug: string) {
  const ctx = await requireOrgContext(slug);
  if (!ctx) throw new Error("Sin acceso a esta empresa");
  return ctx;
}

function refresh(slug: string) {
  revalidatePath(`/${slug}/inventory`, "layout");
}

/* ------------------------------------------------------------------ */
/* Productos                                                          */
/* ------------------------------------------------------------------ */

function retailFrom(costUsd: string, marginPercent: string): string {
  return money(d(costUsd).mul(new Decimal(1).plus(d(marginPercent).div(100)))).toFixed(2);
}

export async function createProduct(
  slug: string,
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireOrg(slug);
  const parsed = productInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const p = parsed.data;
  try {
    await db.insert(s.products).values({
      organizationId: ctx.org.id,
      name: p.name,
      sku: p.sku ?? null,
      barcode: p.barcode ?? null,
      category: p.category ?? null,
      unit: p.unit,
      costUsd: p.costUsd,
      marginPercent: p.marginPercent,
      priceRetailUsd: retailFrom(p.costUsd, p.marginPercent),
      exemptVat: p.exemptVat,
      minStock: p.minStock,
      isComposite: p.isComposite,
    });
    refresh(slug);
    return { ok: true };
  } catch (err) {
    if (pgErrorCode(err) === "23505") return { ok: false, error: "Ese código de barras ya existe" };
    return { ok: false, error: errorMessage(err, "No se pudo crear el producto") };
  }
}

export async function updateProduct(
  slug: string,
  productId: string,
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireOrg(slug);
  const parsed = productInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const p = parsed.data;
  try {
    await db
      .update(s.products)
      .set({
        name: p.name,
        sku: p.sku ?? null,
        barcode: p.barcode ?? null,
        category: p.category ?? null,
        unit: p.unit,
        costUsd: p.costUsd,
        marginPercent: p.marginPercent,
        priceRetailUsd: retailFrom(p.costUsd, p.marginPercent),
        exemptVat: p.exemptVat,
        minStock: p.minStock,
        isComposite: p.isComposite,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(s.products.id, productId),
          eq(s.products.organizationId, ctx.org.id),
        ),
      );
    refresh(slug);
    return { ok: true };
  } catch (err) {
    if (pgErrorCode(err) === "23505") return { ok: false, error: "Ese código de barras ya existe" };
    return { ok: false, error: errorMessage(err, "No se pudo actualizar el producto") };
  }
}

export async function toggleProduct(
  slug: string,
  productId: string,
  active: boolean,
): Promise<ActionResult> {
  const ctx = await requireOrg(slug);
  await db
    .update(s.products)
    .set({ active, updatedAt: new Date() })
    .where(
      and(eq(s.products.id, productId), eq(s.products.organizationId, ctx.org.id)),
    );
  refresh(slug);
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Recetas y combos                                                   */
/* ------------------------------------------------------------------ */

export async function saveRecipe(
  slug: string,
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireOrg(slug);
  const parsed = recipeInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const r = parsed.data;

  if (r.components.some((c) => c.componentId === r.productId)) {
    return { ok: false, error: "Un producto no puede ser insumo de sí mismo" };
  }

  await db
    .update(s.products)
    .set({ isComposite: r.isComposite, updatedAt: new Date() })
    .where(
      and(eq(s.products.id, r.productId), eq(s.products.organizationId, ctx.org.id)),
    );
  await db
    .delete(s.productRecipes)
    .where(
      and(
        eq(s.productRecipes.organizationId, ctx.org.id),
        eq(s.productRecipes.productId, r.productId),
      ),
    );
  await db.insert(s.productRecipes).values(
    r.components.map((c) => ({
      organizationId: ctx.org.id,
      productId: r.productId,
      componentId: c.componentId,
      quantity: c.quantity,
      unit: c.unit,
    })),
  );
  refresh(slug);
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Compras, traslados, ajustes                                        */
/* ------------------------------------------------------------------ */

export async function registerPurchaseAction(
  slug: string,
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireOrg(slug);
  const parsed = purchaseInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  try {
    await registerPurchase(db, ctx.org.id, { ...parsed.data, userId: ctx.userId });
    refresh(slug);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err, "No se pudo registrar la compra") };
  }
}

export async function transferAction(
  slug: string,
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireOrg(slug);
  const parsed = transferInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  try {
    await transferStock(db, ctx.org.id, { ...parsed.data, userId: ctx.userId });
    refresh(slug);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err, "No se pudo realizar el traslado") };
  }
}

export async function adjustAction(
  slug: string,
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireOrg(slug);
  const parsed = adjustStockInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  try {
    await adjustStock(db, ctx.org.id, { ...parsed.data, userId: ctx.userId });
    refresh(slug);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err, "No se pudo aplicar el ajuste") };
  }
}

/* ------------------------------------------------------------------ */
/* Almacenes                                                          */
/* ------------------------------------------------------------------ */

export async function createWarehouse(
  slug: string,
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireOrg(slug);
  const parsed = warehouseInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  await db.insert(s.warehouses).values({
    organizationId: ctx.org.id,
    name: parsed.data.name,
    address: parsed.data.address ?? null,
    isMain: false,
  });
  refresh(slug);
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Consultas para el cliente (kardex)                                 */
/* ------------------------------------------------------------------ */

export async function getKardexAction(slug: string, productId: string) {
  const ctx = await requireOrg(slug);
  return kardexFor(db, ctx.org.id, productId);
}
