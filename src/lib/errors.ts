/** Extrae el código SQLSTATE de un error de PostgreSQL, directo o envuelto. */
export function pgErrorCode(err: unknown): string | undefined {
  const e = err as {
    code?: unknown;
    cause?: { code?: unknown };
  } | null;
  if (typeof e?.code === "string") return e.code;
  if (typeof e?.cause?.code === "string") return e.cause.code;
  return undefined;
}
