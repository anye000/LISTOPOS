import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgliteDatabase } from "drizzle-orm/pglite";

import type { Schema } from "./schema";

/** Base de datos drizzle compatible: node-postgres (Neon) o PGlite (dev/tests). */
export type AnyListoPOSDb = PgliteDatabase<Schema> | NodePgDatabase<Schema>;
