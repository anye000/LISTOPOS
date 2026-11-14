/**
 * Configuración de conexión PostgreSQL multi-proveedor: la app debe poder
 * apuntar a Supabase (recomendado: pooler 6543 en runtime, directo 5432 para
 * migraciones), Neon o un PostgreSQL local, solo cambiando variables de
 * entorno.
 */
import { describe, expect, it } from "vitest";

import {
  normalizeDbUrl,
  requiresSsl,
  resolveDbConfig,
  resolveMigrationDbConfig,
  resolveRuntimeDbConfig,
} from "@/core/db-cloud/config";

const SUPABASE_POOLER =
  "postgresql://postgres.abcdef:pwd123@aws-0-us-east-1.pooler.supabase.com:6543/postgres";
const SUPABASE_DIRECT =
  "postgresql://postgres:pwd123@db.abcdef.supabase.co:5432/postgres";
const NEON_URL =
  "postgresql://user:pwd@ep-cool-name-123456.us-east-2.aws.neon.tech/neondb";
const LOCAL_URL = "postgresql://postgres:postgres@localhost:5432/listopos";

describe("db-config — resolución de proveedor", () => {
  it("sin variables de entorno usa PGlite local", () => {
    const cfg = resolveRuntimeDbConfig({});
    expect(cfg.mode).toBe("pglite");
    expect(cfg.connectionString).toBeUndefined();
  });

  it("detecta Supabase (pooler de runtime) y activa SSL", () => {
    const cfg = resolveRuntimeDbConfig({ DATABASE_URL: SUPABASE_POOLER });
    expect(cfg.mode).toBe("postgres");
    expect(cfg.source).toBe("DATABASE_URL");
    expect(cfg.ssl).toBeDefined();
    expect(cfg.connectionString).toContain("sslmode=require");
  });

  it("acepta SUPABASE_DB_URL como respaldo", () => {
    const cfg = resolveRuntimeDbConfig({ SUPABASE_DB_URL: SUPABASE_DIRECT });
    expect(cfg.mode).toBe("postgres");
    expect(cfg.source).toBe("SUPABASE_DB_URL");
    expect(cfg.ssl).toBeDefined();
  });

  it("acepta POSTGRES_URL que inyecta la integración de Vercel", () => {
    const cfg = resolveRuntimeDbConfig({ POSTGRES_URL: NEON_URL });
    expect(cfg.mode).toBe("postgres");
    expect(cfg.source).toBe("POSTGRES_URL");
    expect(cfg.ssl).toBeDefined();
  });

  it("DATABASE_URL tiene prioridad sobre las demás variables", () => {
    const cfg = resolveRuntimeDbConfig({
      DATABASE_URL: SUPABASE_POOLER,
      POSTGRES_URL: NEON_URL,
      SUPABASE_DB_URL: SUPABASE_DIRECT,
    });
    expect(cfg.source).toBe("DATABASE_URL");
  });

  it("para migraciones prefiere POSTGRES_URL_NON_POOLING (conexión directa)", () => {
    const cfg = resolveMigrationDbConfig({
      POSTGRES_URL: SUPABASE_POOLER,
      POSTGRES_URL_NON_POOLING: SUPABASE_DIRECT,
    });
    expect(cfg.source).toBe("POSTGRES_URL_NON_POOLING");
    expect(cfg.connectionString).toContain("db.abcdef.supabase.co");
  });

  it("un PostgreSQL local sin TLS mantiene la URL intacta y sin SSL", () => {
    const cfg = resolveRuntimeDbConfig({ DATABASE_URL: LOCAL_URL });
    expect(cfg.connectionString).toBe(LOCAL_URL);
    expect(cfg.ssl).toBeUndefined();
    expect(cfg.mode).toBe("postgres");
  });

  it("respeta un sslmode explícito existente sin duplicarlo", () => {
    const withParam = `${SUPABASE_DIRECT}?sslmode=verify-full&pgbouncer=true`;
    const cfg = resolveRuntimeDbConfig({ DATABASE_URL: withParam });
    expect(cfg.connectionString).toBe(withParam);
    expect(cfg.connectionString!.match(/sslmode=/g)).toHaveLength(1);
    expect(cfg.ssl).toBeDefined();
  });
});

describe("db-config — utilidades de URL", () => {
  it("normaliza hosts de Supabase/Neon agregando sslmode=require", () => {
    expect(normalizeDbUrl(SUPABASE_DIRECT)).toContain("sslmode=require");
    expect(normalizeDbUrl(NEON_URL)).toContain("sslmode=require");
    expect(normalizeDbUrl(LOCAL_URL)).toBe(LOCAL_URL);
  });

  it("conserva el query string al agregar sslmode", () => {
    const url = `${SUPABASE_POOLER}?pgbouncer=true`;
    const normalized = normalizeDbUrl(url);
    expect(normalized).toContain("pgbouncer=true");
    expect(normalized).toContain("sslmode=require");
  });

  it("requiresSsl distingue hosts conocidos y sslmode explícito", () => {
    expect(requiresSsl(SUPABASE_DIRECT)).toBe(true);
    expect(requiresSsl(NEON_URL)).toBe(true);
    expect(requiresSsl(`${LOCAL_URL}?sslmode=require`)).toBe(true);
    expect(requiresSsl(LOCAL_URL)).toBe(false);
  });

  it("respeta un arreglo de variables personalizado", () => {
    const cfg = resolveDbConfig(
      { MY_DB: SUPABASE_DIRECT },
      ["MY_DB"],
    );
    expect(cfg.mode).toBe("postgres");
    expect(cfg.source).toBe("MY_DB");
  });
});
