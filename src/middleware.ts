import { NextResponse, type NextRequest } from "next/server";

/**
 * Middleware de seguridad multi-tenant (edge-safe, sin dependencias):
 *
 *  - Deja pasar las rutas públicas (/, /login, /register, /api, estáticos).
 *  - Para /[orgSlug]/... exige la cookie de sesión de Better Auth.
 *
 *  NOTA: aquí solo se comprueba la PRESENCIA de la cookie para no verificar
 *  JWEs en el Edge Runtime (jose/CompressionStream no está disponible allí).
 *  La verificación real de sesión + membresía al orgSlug ocurre SIEMPRE en el
 *  layout de servidor (src/app/(app)/[orgSlug]/layout.tsx) con Node.js y
 *  PostgreSQL: el middleware es un gate de UX, la autorización es del layout.
 */
const PUBLIC_PATHS = new Set(["/", "/login", "/register"]);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();
  if (
    pathname.startsWith("/api") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/icons") ||
    pathname.startsWith("/fonts") ||
    pathname === "/icon.svg" ||
    pathname === "/logo.svg" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/sw.js"
  ) {
    return NextResponse.next();
  }

  const hasSession = request.cookies.has("better-auth.session_token");
  if (!hasSession) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|webp|gif|ico|css|map)$).*)",
  ],
};
