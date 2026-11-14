import fs from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle as pgliteDrizzle } from "drizzle-orm/pglite";
import { drizzle as pgDrizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { resolveRuntimeDbConfig } from "./config";
import { schema } from "./schema";

/**
 * Cliente único de base de datos.
 *
 *  - Con URL de PostgreSQL en el entorno → conecta por el protocolo wire con
 *    `pg`. Funciona con SUPABASE, NEON o cualquier PostgreSQL:
 *      DATABASE_URL → POSTGRES_URL → SUPABASE_DB_URL
 *    (SSL automático para hosts de Supabase/Neon).
 *  - Sin URL (desarrollo local) → PGlite en el MISMO proceso, persistido en
 *    `.data/listopos-db`. Antes de `npm run dev`, ejecuta `npm run db:apply`.
 *
 * La instancia vive en `globalThis` para sobrevivir al hot-reload de Next.
 */
export type ListoPOSDb = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as {
  listoposDb?: ListoPOSDb;
  listoposPool?: Pool;
  listoposPglite?: PGlite;
};

function createPgliteDb(): ListoPOSDb {
  const dataDir = path.resolve(process.cwd(), ".data", "listopos-db");
  fs.mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  const pgliteDb = pgliteDrizzle(client, { schema });
  globalForDb.listoposPglite = client;
  // Ambos drivers implementan la misma interfaz de sesión Pg; el cast es
  // solo de tipos: en runtime todo pasa por el driver PGlite.
  return pgliteDb as unknown as ListoPOSDb;
}

function getDb(): ListoPOSDb {
  if (globalForDb.listoposDb) return globalForDb.listoposDb;

  const config = resolveRuntimeDbConfig();

  if (config.mode === "postgres") {
    const pool = new Pool({
      connectionString: config.connectionString,
      ssl: config.ssl,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    globalForDb.listoposPool = pool;
    globalForDb.listoposDb = pgDrizzle(pool, { schema });
    console.info(
      `[db] Conectando a PostgreSQL remoto (${config.source})${config.ssl ? " con TLS" : ""}.`,
    );
  } else {
    globalForDb.listoposDb = createPgliteDb();
  }
  return globalForDb.listoposDb;
}

export const db: ListoPOSDb = getDb();
export { schema };
