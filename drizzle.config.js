// drizzle.config.js — en JavaScript plano (CJS) para que drizzle-kit no
// necesite lanzar un proceso hijo (evita EPERM en entornos confinados).
//
// Base de datos: Supabase, Neon o cualquier PostgreSQL. Orden de variables:
//   DATABASE_URL → POSTGRES_URL_NON_POOLING → POSTGRES_URL → SUPABASE_DB_URL
// Para Supabase usa la conexión DIRECTA o session pooler (5432), no el
// transaction pooler (6543), y deja que la URL incluya `?sslmode=require`.
const candidates = [
  process.env.DATABASE_URL,
  process.env.POSTGRES_URL_NON_POOLING,
  process.env.POSTGRES_URL,
  process.env.SUPABASE_DB_URL,
];
const url =
  candidates.find((v) => v && v.trim().length > 0)?.trim() ||
  "postgresql://postgres:postgres@localhost:5433/listopos";

module.exports = {
  schema: "./src/core/db-cloud/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
  verbose: true,
};
