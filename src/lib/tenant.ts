/**
 * Helpers de servidor para el aislamiento multi-tenant
 * (ARCHITECTURE.md §4.1): TODA consulta de negocio debe filtrar por
 * `organizationId`; estos helpers verifican sesión + membresía del orgSlug.
 */
import { cache } from "react";
import { headers } from "next/headers";
import { and, desc, eq } from "drizzle-orm";

import { auth } from "@/core/auth/auth";
import { db } from "@/core/db-cloud/client";
import {
  exchangeRates,
  members,
  organizations,
  type MemberRole,
} from "@/core/db-cloud/schema";

export interface OrgContext {
  org: typeof organizations.$inferSelect;
  role: MemberRole;
  userId: string;
}

/** Sesión activa (null si no hay sesión). */
export async function getSessionUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user ?? null;
}

export const getOrganizationBySlug = cache(async (slug: string) => {
  const rows = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);
  return rows[0] ?? null;
});

/**
 * Verifica sesión + membresía para el orgSlug de la URL.
 * Devuelve null si el usuario no tiene acceso (redirigir a /login o 403).
 */
export async function requireOrgContext(
  slug: string,
): Promise<OrgContext | null> {
  const user = await getSessionUser();
  if (!user) return null;
  const org = await getOrganizationBySlug(slug);
  if (!org) return null;
  const member = (
    await db
      .select()
      .from(members)
      .where(
        and(
          eq(members.organizationId, org.id),
          eq(members.userId, user.id),
        ),
      )
      .limit(1)
  )[0];
  if (!member) return null;
  return { org, role: member.role, userId: user.id };
}

/** Organizaciones a las que pertenece el usuario (para el selector). */
export async function listUserOrganizations(userId: string) {
  const rows = await db
    .select({
      org: organizations,
      role: members.role,
    })
    .from(members)
    .innerJoin(organizations, eq(members.organizationId, organizations.id))
    .where(eq(members.userId, userId));
  return rows;
}

/** Obtiene las tasas de la organización ordenadas por fecha (más reciente primero). */
export async function getActiveRates(organizationId: string) {
  const rows = await db
    .select()
    .from(exchangeRates)
    .where(eq(exchangeRates.organizationId, organizationId))
    .orderBy(desc(exchangeRates.date));
  return rows;
}
