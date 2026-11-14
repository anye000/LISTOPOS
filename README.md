# ListoPOS 💙 — ERP & POS SaaS multi-empresa para Venezuela

ListoPOS es un sistema administrativo y Punto de Venta (POS) SaaS multi-empresa optimizado
para Venezuela. Funciona como una **PWA Offline-First** con soporte multimoneda exacto
(USD, EUR, VES/Bs con tasa BCV), cumplimiento fiscal (IVA, IGTF 3%, libros SENIAT) y
sincronización nube-local.

La arquitectura completa está documentada en [ARCHITECTURE.md](./ARCHITECTURE.md).

## Stack
- **Framework:** Next.js (App Router) + TypeScript `strict`
- **UI:** Tailwind CSS v4 + componentes estilo shadcn/ui
- **Marca:** logo recibo + check · paleta ListoPOS en [docs/paleta-listopos.html](./docs/paleta-listopos.html)
- **Nube:** PostgreSQL (Supabase o Neon) + Drizzle ORM
- **Local/Offline:** Dexie.js (IndexedDB) + Serwist (PWA)
- **Auth:** Better Auth (email/contraseña) + membresías multi-empresa
- **Precisión:** `decimal.js` para TODO cálculo monetario (prohibido `number`)
- **Docs:** `pdfmake` (facturas/tickets) y `xlsx` (libros SENIAT)
- **Tests:** Vitest (unitarios + integración)

## Arranque rápido

```bash
npm install
cp .env.example .env        # ajusta BETTER_AUTH_SECRET
npm run db:apply            # aplica migraciones a la base local (.data/listopos-db)
npm run dev                 # http://localhost:3000 (PGlite embebido, sin Docker)
```

Con `DATABASE_URL` apuntando a la nube, `npm run db:apply` aplica las migraciones al PostgreSQL remoto.

## Base de datos en la nube: Supabase o Neon

ListoPOS habla PostgreSQL por el protocolo wire (`pg`), así que **solo cambia la URL de conexión**.
El SSL se activa automáticamente para hosts de Supabase (`*.supabase.co`, `*.pooler.supabase.com`)
y Neon (`*.neon.tech`), o con `?sslmode=require`.

### Supabase (recomendado)

1. Crea el proyecto en [supabase.com](https://supabase.com) y copia la URL en
   **Project Settings → Database → Connection string**.
2. Define las variables (el SSL se detecta automáticamente):

   ```bash
   # Runtime / Vercel: Supavisor TRANSACTION pooler (puerto 6543)
   DATABASE_URL=postgresql://postgres.PROJECT:PASSWORD@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require

   # Migraciones: conexión directa o session pooler (puerto 5432)
   POSTGRES_URL_NON_POOLING=postgresql://postgres:PASSWORD@db.PROJECT.supabase.co:5432/postgres
   ```

3. Aplica el esquema: `npm run db:apply` (usa `POSTGRES_URL_NON_POOLING` si existe, porque
   el transaction pooler puede fallar con DDL). También sirve `npx drizzle-kit push`.
4. En Vercel define esas mismas variables en *Environment Variables* (la integración oficial de
   Supabase también inyecta `POSTGRES_URL` y `POSTGRES_URL_NON_POOLING`, que se soportan).

> El aislamiento multi-empresa se garantiza en la capa de aplicación con `organizationId`
> (ver ARCHITECTURE.md §4.1); no se depende de RLS de Supabase para que la app funcione,
> pero puedes añadir políticas RLS encima sin cambiar el código.

### Neon

```bash
DATABASE_URL=postgresql://user:password@ep-xxxx.us-east-2.aws.neon.tech/neondb?sslmode=require
npm run db:apply
```

### Orden de resolución de variables

| Uso | Orden |
| --- | --- |
| Runtime (pooled) | `DATABASE_URL` → `POSTGRES_URL` → `SUPABASE_DB_URL` |
| Migraciones (directo) | `DATABASE_URL` → `POSTGRES_URL_NON_POOLING` → `POSTGRES_URL` → `SUPABASE_DB_URL` |

Sin ninguna de ellas, el desarrollo local usa PGlite embebido (`.data/listopos-db`).

## Scripts
| Script | Descripción |
| --- | --- |
| `npm run dev` | Servidor de desarrollo (Turbopack + PGlite embebido) |
| `npm run build` / `start` | Build y arranque de producción (requiere `DATABASE_URL`) |
| `npm test` | Vitest (unitarios + integración) |
| `npm run db:generate` | Genera SQL de migraciones Drizzle |
| `npm run db:apply` | Aplica migraciones (Supabase/Neon vía `pg`, o PGlite local) |
| `npm run icons` | Regenera los iconos PWA del logo ListoPOS |

## Estructura
```
src/
├── app/          # Rutas Next.js (landing, auth, dashboard /[orgSlug]/...)
├── modules/      # pos, inventory, finance, fiscal, crm
├── core/         # db-local, db-cloud, sync, currency, auth
└── ui/           # Componentes visuales reutilizables
tests/            # Vitest (unitarios + integración)
drizzle/          # Migraciones SQL generadas
```

## Estado del plan maestro
- [x] Fase 0 — Marca ListoPOS (logo recibo+check, paleta azul/esmeralda/pizarra) y andamiaje
- [x] Fase 1 — Esquemas Drizzle/Dexie + motor financiero/fiscal + tests (`decimal.js`, IVA, IGTF, vueltos)
- [x] Fase 2 — Auth multi-empresa, middleware tenant, sincronización offline (Outbox) y PWA
- [x] Fase 3 — Inventario, recetas, compras con costo promedio, kardex y multi-almacén
- [x] Fase 4 — POS offline, pagos mixtos + IGTF 3%, factura PDF con QR y ticket térmico
- [x] Fase 5 — Cierres Z, ledger con abonos multimoneda, bancos, CRM con puntos, dashboard gerencial y libros SENIAT en xlsx

**QA:** 86 tests (unitarios + integración con PostgreSQL real y Dexie), typecheck estricto y build de producción verificado.
