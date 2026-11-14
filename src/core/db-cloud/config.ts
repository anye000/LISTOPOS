/**
 * Resolución de la conexión PostgreSQL — Supabase, Neon o cualquier PostgreSQL.
 *
 * Supabase y Neon son PostgreSQL estándar: la app conecta por el protocolo
 * wire con `pg`, así que solo cambia la URL de conexión. Puntos prácticos:
 *
 *  - AMBOS exigen TLS: se activa SSL automáticamente para sus hosts
 *    (`*.supabase.co`, `*.pooler.supabase.com`, `*.neon.tech`) o cuando la URL
 *    incluye `sslmode=require`.
 *  - Supabase ofrece un pooler (Supavisor): puerto 6543 = transaction mode
 *    (ideal para serverless/Vercel) y 5432 = session/directo (migraciones).
 *  - La integración de Supabase/Postgres de Vercel inyecta `POSTGRES_URL` y
 *    `POSTGRES_URL_NON_POOLING` → se soportan como respaldo.
 *
 * Orden de variables en RUNTIME (conexión agrupada):
 *   DATABASE_URL → POSTGRES_URL → SUPABASE_DB_URL
 * Orden para MIGRACIONES (conexión directa recomendada):
 *   DATABASE_URL → POSTGRES_URL_NON_POOLING → POSTGRES_URL → SUPABASE_DB_URL
 */
import type { PoolConfig } from "pg";

export type DbMode = "postgres" | "pglite";

/** Entorno por variables (compatible con process.env y objetos simples en tests). */
export type DbEnv = Record<string, string | undefined>;

export interface DbConfig {
  mode: DbMode;
  connectionString?: string;
  ssl?: PoolConfig["ssl"];
  /** Variable de entorno de la que salió la URL (para logs). */
  source?: string;
}

export const RUNTIME_URL_VARS = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "SUPABASE_DB_URL",
] as const;

export const MIGRATION_URL_VARS = [
  "DATABASE_URL",
  "POSTGRES_URL_NON_POOLING",
  "POSTGRES_URL",
  "SUPABASE_DB_URL",
] as const;

const SSL_HOST_RE = /(pooler\.supabase\.com|\.supabase\.(co|com)|\.neon\.tech)/i;
const SSL_PARAM_RE = /[?&]sslmode=(require|verify-ca|verify-full)/i;
const HAS_SSL_PARAM_RE = /[?&]sslmode=/i;

/** Agrega `sslmode=require` a hosts que exigen TLS y no lo traen explícito. */
export function normalizeDbUrl(raw: string): string {
  const url = raw.trim();
  if (!SSL_HOST_RE.test(url)) return url;
  if (HAS_SSL_PARAM_RE.test(url)) return url;
  return url + (url.includes("?") ? "&" : "?") + "sslmode=require";
}

/** True si la URL requiere TLS (host conocido o sslmode explícito). */
export function requiresSsl(url: string): boolean {
  return SSL_HOST_RE.test(url) || SSL_PARAM_RE.test(url);
}

export function resolveDbConfig(
  env: DbEnv = process.env,
  vars: readonly string[] = RUNTIME_URL_VARS,
): DbConfig {
  const source = vars.find((name) => env[name]?.trim());
  if (!source) return { mode: "pglite" };

  const connectionString = normalizeDbUrl(env[source]!);
  return {
    mode: "postgres",
    connectionString,
    ssl: requiresSsl(connectionString)
      ? { rejectUnauthorized: false }
      : undefined,
    source,
  };
}

/** Configuración para la app (pooler de Supabase / Neon). */
export function resolveRuntimeDbConfig(env: DbEnv = process.env): DbConfig {
  return resolveDbConfig(env, RUNTIME_URL_VARS);
}

/** Configuración para migraciones (prefiere conexión directa/no agrupada). */
export function resolveMigrationDbConfig(env: DbEnv = process.env): DbConfig {
  return resolveDbConfig(env, MIGRATION_URL_VARS);
}
