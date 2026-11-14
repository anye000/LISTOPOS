# ARCHITECTURE.md - ListoPOS ERP & POS (SaaS Multi-Empresa)

## 1. Visión General
ListoPOS es un sistema administrativo y Punto de Venta (POS) SaaS multi-empresa optimizado para Venezuela. Funciona como una PWA Offline-First con soporte multimoneda exacto (USD, EUR, VES/Bs con tasa BCV), cumplimiento fiscal (IVA, IGTF 3%, libros SENIAT) y sincronización nube-local.

## 2. Stack Tecnológico Obligatorio
- **Framework:** Next.js (App Router) con TypeScript en modo `strict: true` (o SvelteKit según configuración inicial).
- **Estilos y UI:** Tailwind CSS + Shadcn/UI.
- **Base de Datos en la Nube:** PostgreSQL Serverless (Supabase o Neon) + Drizzle ORM. La app conecta por el protocolo wire con `pg`: solo cambia la URL (`DATABASE_URL`/`POSTGRES_URL`/`SUPABASE_DB_URL`), con SSL automático para ambos proveedores.
- **Base de Datos Local (Offline):** Dexie.js (IndexedDB) + Service Worker (Serwist) para modo PWA.
- **Autenticación y Multi-Tenant:** Better-Auth con plugin de Organizations y roles (`owner`, `admin`, `cashier`, `accountant`).
- **Precisión Matemática:** `decimal.js` obligatorio para cualquier cálculo monetario, tasas de cambio, impuestos o inventario. PROHIBIDO usar `number` nativo de JS para operaciones financieras.
- **Documentos y Exportación:** `pdfmake` (facturas/tickets offline) y `xlsx` (libros contables SENIAT).
- **Testing:** Vitest para pruebas unitarias de lógica financiera y fiscal.

## 3. Estructura de Carpetas Estricta
Todo código nuevo debe ubicarse estrictamente dentro de esta estructura modular:

```
listopos/
├── src/
│   ├── app/                  # Rutas de Next.js (Landing, Auth, Dashboard /[orgSlug]/...)
│   ├── modules/              # Lógica de negocio aislada por dominio
│   │   ├── pos/              # Caja, carrito, pagos mixtos, impresión térmica/PDF
│   │   ├── inventory/        # Productos, kardex, recetas/combos, multi-almacén
│   │   ├── finance/          # Cierres de caja, cuentas por cobrar/pagar, bancos
│   │   ├── fiscal/           # Tasa BCV, libros SENIAT, retenciones, IGTF
│   │   └── crm/              # Clientes, proveedores, créditos, fidelización
│   ├── core/                 # Infraestructura transversal
│   │   ├── db-local/         # Esquema Dexie.js (IndexedDB) para operación Offline
│   │   ├── db-cloud/         # Esquema Drizzle ORM + PostgreSQL + RLS
│   │   ├── sync/             # Cola de sincronización bidireccional (Outbox pattern)
│   │   └── currency/         # Conversor exacto Bs / USD / EUR con historial de tasas
│   └── ui/                   # Componentes visuales reutilizables (Shadcn + layouts)
```

## 4. Reglas Inquebrantables de Desarrollo
1. **Aislamiento Multi-Tenant:** TODAS las tablas en `db-cloud` y `db-local` (excepto usuarios globales) deben incluir `organizationId`. Ninguna consulta SQL puede ejecutarse sin filtrar por `organizationId`.
2. **Inmutabilidad Histórica:** Las facturas (`invoices`) deben guardar el monto en moneda base (USD), el monto en Bolívares (`VES`) y la tasa exacta (`exchangeRateSnapshot`) usada al momento de emitirla. Nunca recalcular facturas pasadas con tasas nuevas.
3. **Offline-First Real:** El POS debe escribir primero en `db-local` (Dexie.js) y encolar la operación en `core/sync` para subirla a `db-cloud` cuando haya conexión.
4. **Control de Errores:** Validar todas las entradas con `zod` antes de guardar en base de datos.
