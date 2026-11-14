/**
 * Autenticación con Better Auth + Drizzle (PostgreSQL).
 *
 * Los usuarios son GLOBALES (una cuenta, varias empresas). La membresía y los
 * roles por empresa viven en la tabla `members` (ver core/db-cloud/schema.ts)
 * y se verifican en cada layout/server action con src/lib/tenant.ts.
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { db } from "@/core/db-cloud/client";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 72,
  },
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL,
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 días
    updateAge: 60 * 60 * 24, // refresca la sesión una vez al día
  },
});

export type ListoPOSSession = typeof auth.$Infer.Session;
