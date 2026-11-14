/**
 * Aplica las migraciones SQL generadas (carpeta `drizzle/`) a la base de
 * datos objetivo:
 *
 *  - Con URL de PostgreSQL en el entorno → Supabase, Neon o cualquier
 *    PostgreSQL. Para Supabase se recomienda la conexión DIRECTA o el
 *    session pooler (puerto 5432); el transaction pooler (6543) puede fallar
 *    con DDL. Se soporta:
 *      DATABASE_URL → POSTGRES_URL_NON_POOLING → POSTGRES_URL → SUPABASE_DB_URL
 *  - Sin URL → PGlite local persistente en `.data/listopos-db`.
 *
 * JavaScript plano a propósito: corre con `node` directo sin esbuild/tsx.
 */
import fs from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle as pgliteDrizzle } from "drizzle-orm/pglite";
import { migrate as pgliteMigrate } from "drizzle-orm/pglite/migrator";
import pg from "pg";
import { drizzle as pgDrizzle } from "drizzle-orm/node-postgres";
import { migrate as pgMigrate } from "drizzle-orm/node-postgres/migrator";

const MIGRATIONS_FOLDER = path.resolve(process.cwd(), "drizzle");

const URL_VARS = [
  "DATABASE_URL",
  "POSTGRES_URL_NON_POOLING",
  "POSTGRES_URL",
  "SUPABASE_DB_URL",
];

function resolveRemoteUrl() {
  const name = URL_VARS.find(
    (key) => process.env[key] && process.env[key].trim().length > 0,
  );
  if (!name) return null;
  let url = process.env[name].trim();
  const needsSsl = /(pooler\.supabase\.com|\.supabase\.(co|com)|\.neon\.tech)/i.test(url);
  if (needsSsl && !/[?&]sslmode=/i.test(url)) {
    url += (url.includes("?") ? "&" : "?") + "sslmode=require";
  }
  const ssl =
    needsSsl || /[?&]sslmode=(require|verify-ca|verify-full)/i.test(url)
      ? { rejectUnauthorized: false }
      : undefined;
  let host = "";
  try {
    host = new URL(url).host;
  } catch {
    host = "(host desconocido)";
  }
  return { name, url, ssl, host };
}

async function main() {
  const remote = resolveRemoteUrl();

  if (remote) {
    const pool = new pg.Pool({
      connectionString: remote.url,
      ssl: remote.ssl,
      max: 5,
      connectionTimeoutMillis: 15_000,
    });
    await pgMigrate(pgDrizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
    await pool.end();
    console.log(
      `✔ Migraciones aplicadas a PostgreSQL (${remote.name} → ${remote.host}).`,
    );
    console.log(
      "  Supabase: si usaste el transaction pooler (6543) para runtime, mantén",
    );
    console.log(
      "  POSTGRES_URL_NON_POOLING con la conexión directa (5432) para migrar.",
    );
  } else {
    const dataDir = path.resolve(process.cwd(), ".data", "listopos-db");
    fs.mkdirSync(dataDir, { recursive: true });
    const client = new PGlite(dataDir);
    await pgliteMigrate(pgliteDrizzle(client), {
      migrationsFolder: MIGRATIONS_FOLDER,
    });
    await client.close();
    console.log(`✔ Migraciones aplicadas a la base local PGlite (${dataDir}).`);
  }
}

main().catch((err) => {
  console.error("✘ Error aplicando migraciones:", err);
  process.exit(1);
});
