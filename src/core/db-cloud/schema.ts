/**
 * Esquema de la base de datos en la nube (PostgreSQL + Drizzle ORM).
 *
 * Reglas inquebrantables (ARCHITECTURE.md §4):
 *  1. Toda tabla de negocio incluye `organizationId` (aislamiento multi-tenant).
 *  2. Las facturas guardan `exchangeRateSnapshot` (inmutabilidad histórica).
 *  3. Los valores monetarios se guardan como decimal de precisión exacta y se
 *     manipulan SIEMPRE con decimal.js (nunca `number`).
 */
import {
  boolean,
  decimal,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ */
/* Enums                                                              */
/* ------------------------------------------------------------------ */

export const memberRole = pgEnum("member_role", [
  "owner",
  "admin",
  "cashier",
  "accountant",
]);

export type MemberRole = (typeof memberRole.enumValues)[number];

export const invoiceType = pgEnum("invoice_type", [
  "invoice",
  "delivery_note",
  "quote",
]);

export const invoiceStatus = pgEnum("invoice_status", [
  "draft",
  "issued",
  "paid",
  "credit",
  "converted",
  "cancelled",
]);

export const contactType = pgEnum("contact_type", ["customer", "supplier"]);

export const paymentMethod = pgEnum("payment_method", [
  "cash_usd",
  "cash_ves",
  "pos",
  "pago_movil",
  "zelle",
  "credit",
  "other",
]);

export const cashRegisterStatus = pgEnum("cash_register_status", [
  "open",
  "closed",
]);

export const ledgerEntryType = pgEnum("ledger_entry_type", [
  "receivable",
  "payable",
]);

export const ledgerEntryStatus = pgEnum("ledger_entry_status", [
  "pending",
  "partial",
  "paid",
]);

export const movementType = pgEnum("movement_type", [
  "purchase",
  "sale",
  "transfer_in",
  "transfer_out",
  "adjustment_in",
  "adjustment_out",
  "recipe_out",
]);

/** Snapshot de tasas usado al emitir una factura (nunca se recalcula). */
export interface ExchangeRatesSnapshot {
  usdToVes: string; // Bs por 1 USD
  eurToVes: string; // Bs por 1 EUR
  igtfRate: string; // porcentaje IGTF aplicado
  capturedAt: string; // ISO timestamp
}

/* ------------------------------------------------------------------ */
/* Tablas globales de Better Auth (usuarios NO llevan organizationId) */
/*  Nota: los nombres de columna usan camelCase porque es el formato   */
/*  canónico que espera el adaptador Drizzle de Better Auth.           */
/* ------------------------------------------------------------------ */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").notNull(),
  image: text("image"),
  createdAt: timestamp("createdAt").notNull(),
  updatedAt: timestamp("updatedAt").notNull(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expiresAt").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("createdAt").notNull(),
  updatedAt: timestamp("updatedAt").notNull(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: timestamp("accessTokenExpiresAt"),
  refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("createdAt").notNull(),
  updatedAt: timestamp("updatedAt").notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt"),
  updatedAt: timestamp("updatedAt"),
});

/* ------------------------------------------------------------------ */
/* Organizaciones y miembros                                          */
/* ------------------------------------------------------------------ */

export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  rif: text("rif"),
  address: text("address"),
  baseCurrency: text("base_currency").notNull().default("usd"), // usd | ves
  igtfRate: decimal("igtf_rate", { precision: 8, scale: 4 })
    .notNull()
    .default("3.0000"),
  plan: text("plan").notNull().default("beta"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const members = pgTable(
  "members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: memberRole("role").notNull().default("cashier"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("members_org_user_idx").on(t.organizationId, t.userId)],
);

/* ------------------------------------------------------------------ */
/* Tasas de cambio (BCV / personalizadas)                             */
/* ------------------------------------------------------------------ */

export const exchangeRates = pgTable(
  "exchange_rates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    currency: text("currency").notNull(), // usd | eur
    rateToVes: decimal("rate_to_ves", { precision: 20, scale: 6 }).notNull(),
    date: text("date").notNull(), // YYYY-MM-DD
    source: text("source").notNull().default("bcv"), // bcv | custom
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("exchange_rates_org_curr_date_idx").on(
      t.organizationId,
      t.currency,
      t.date,
    ),
  ],
);

/* ------------------------------------------------------------------ */
/* Inventario: almacenes, productos, stock, recetas, movimientos      */
/* ------------------------------------------------------------------ */

export const warehouses = pgTable("warehouses", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  address: text("address"),
  isMain: boolean("is_main").notNull().default(false),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const products = pgTable(
  "products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sku: text("sku"),
    barcode: text("barcode"),
    name: text("name").notNull(),
    category: text("category"),
    unit: text("unit").notNull().default("und"),
    costUsd: decimal("cost_usd", { precision: 20, scale: 4 })
      .notNull()
      .default("0"),
    marginPercent: decimal("margin_percent", { precision: 10, scale: 4 })
      .notNull()
      .default("0"),
    priceRetailUsd: decimal("price_retail_usd", { precision: 20, scale: 4 })
      .notNull()
      .default("0"),
    priceWholesaleUsd: decimal("price_wholesale_usd", {
      precision: 20,
      scale: 4,
    }),
    exemptVat: boolean("exempt_vat").notNull().default(false),
    minStock: decimal("min_stock", { precision: 20, scale: 4 })
      .notNull()
      .default("0"),
    isComposite: boolean("is_composite").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("products_org_idx").on(t.organizationId),
    uniqueIndex("products_org_barcode_idx").on(t.organizationId, t.barcode),
  ],
);

export const inventoryStocks = pgTable(
  "inventory_stocks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "cascade" }),
    quantity: decimal("quantity", { precision: 20, scale: 4 })
      .notNull()
      .default("0"),
    avgCostUsd: decimal("avg_cost_usd", { precision: 20, scale: 6 })
      .notNull()
      .default("0"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("stocks_product_warehouse_idx").on(t.productId, t.warehouseId),
    index("stocks_org_idx").on(t.organizationId),
  ],
);

export const productRecipes = pgTable(
  "product_recipes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    componentId: uuid("component_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    quantity: decimal("quantity", { precision: 20, scale: 4 }).notNull(),
    unit: text("unit").notNull().default("und"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("recipes_product_component_idx").on(t.productId, t.componentId),
    index("recipes_org_idx").on(t.organizationId),
  ],
);

/** Kardex: historial auditado de cada entrada/salida/ajuste de inventario. */
export const inventoryMovements = pgTable(
  "inventory_movements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "cascade" }),
    type: movementType("type").notNull(),
    quantity: decimal("quantity", { precision: 20, scale: 4 }).notNull(), // + entrada, - salida
    unitCostUsd: decimal("unit_cost_usd", { precision: 20, scale: 6 })
      .notNull()
      .default("0"),
    referenceId: text("reference_id"),
    note: text("note"),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("movements_org_product_idx").on(t.organizationId, t.productId),
    index("movements_org_created_idx").on(t.organizationId, t.createdAt),
  ],
);

/* ------------------------------------------------------------------ */
/* CRM: clientes y proveedores                                        */
/* ------------------------------------------------------------------ */

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    type: contactType("type").notNull().default("customer"),
    name: text("name").notNull(),
    document: text("document"), // RIF / cédula
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    creditLimitUsd: decimal("credit_limit_usd", { precision: 20, scale: 4 })
      .notNull()
      .default("0"),
    points: integer("points").notNull().default(0),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("contacts_org_type_idx").on(t.organizationId, t.type)],
);

/* ------------------------------------------------------------------ */
/* Caja: turnos y movimientos manuales                                */
/* ------------------------------------------------------------------ */

export const cashRegisters = pgTable(
  "cash_registers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    warehouseId: uuid("warehouse_id").references(() => warehouses.id, {
      onDelete: "set null",
    }),
    openedByUserId: text("opened_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    openedAt: timestamp("opened_at").notNull().defaultNow(),
    closedAt: timestamp("closed_at"),
    openingBalanceUsd: decimal("opening_balance_usd", {
      precision: 20,
      scale: 4,
    })
      .notNull()
      .default("0"),
    openingBalanceVes: decimal("opening_balance_ves", {
      precision: 20,
      scale: 4,
    })
      .notNull()
      .default("0"),
    countedUsd: decimal("counted_usd", { precision: 20, scale: 4 }),
    countedVes: decimal("counted_ves", { precision: 20, scale: 4 }),
    status: cashRegisterStatus("status").notNull().default("open"),
    closedByUserId: text("closed_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
  },
  (t) => [index("cash_registers_org_idx").on(t.organizationId)],
);

export const cashMovements = pgTable(
  "cash_movements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    cashRegisterId: uuid("cash_register_id")
      .notNull()
      .references(() => cashRegisters.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // income | expense
    method: paymentMethod("method").notNull(),
    currency: text("currency").notNull(), // usd | ves
    amount: decimal("amount", { precision: 20, scale: 4 }).notNull(),
    reason: text("reason"),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("cash_movements_register_idx").on(t.cashRegisterId)],
);

/* ------------------------------------------------------------------ */
/* Facturación: facturas, items y pagos mixtos                        */
/* ------------------------------------------------------------------ */

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    warehouseId: uuid("warehouse_id").references(() => warehouses.id, {
      onDelete: "set null",
    }),
    cashRegisterId: uuid("cash_register_id").references(
      () => cashRegisters.id,
      { onDelete: "set null" },
    ),
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    sourceInvoiceId: uuid("source_invoice_id"),
    type: invoiceType("type").notNull().default("invoice"),
    status: invoiceStatus("status").notNull().default("draft"),
    number: text("number"),
    date: timestamp("date").notNull().defaultNow(),
    dueDate: timestamp("due_date"),
    subtotalUsd: decimal("subtotal_usd", { precision: 20, scale: 4 })
      .notNull()
      .default("0"),
    discountUsd: decimal("discount_usd", { precision: 20, scale: 4 })
      .notNull()
      .default("0"),
    vatUsd: decimal("vat_usd", { precision: 20, scale: 4 }).notNull().default("0"),
    igtfUsd: decimal("igtf_usd", { precision: 20, scale: 4 })
      .notNull()
      .default("0"),
    totalUsd: decimal("total_usd", { precision: 20, scale: 4 }).notNull(),
    subtotalVes: decimal("subtotal_ves", { precision: 20, scale: 4 })
      .notNull()
      .default("0"),
    discountVes: decimal("discount_ves", { precision: 20, scale: 4 })
      .notNull()
      .default("0"),
    vatVes: decimal("vat_ves", { precision: 20, scale: 4 }).notNull().default("0"),
    igtfVes: decimal("igtf_ves", { precision: 20, scale: 4 }).notNull().default("0"),
    totalVes: decimal("total_ves", { precision: 20, scale: 4 }).notNull(),
    exchangeRateSnapshot: jsonb("exchange_rate_snapshot")
      .$type<ExchangeRatesSnapshot>()
      .notNull(),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("invoices_org_date_idx").on(t.organizationId, t.date),
    uniqueIndex("invoices_org_number_idx").on(t.organizationId, t.number),
  ],
);

export const invoiceItems = pgTable(
  "invoice_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(), // snapshot del nombre al facturar
    quantity: decimal("quantity", { precision: 20, scale: 4 }).notNull(),
    unit: text("unit").notNull().default("und"),
    unitPriceUsd: decimal("unit_price_usd", { precision: 20, scale: 4 }).notNull(),
    exemptVat: boolean("exempt_vat").notNull().default(false),
    totalUsd: decimal("total_usd", { precision: 20, scale: 4 }).notNull(),
    totalVes: decimal("total_ves", { precision: 20, scale: 4 }).notNull(),
  },
  (t) => [index("invoice_items_invoice_idx").on(t.invoiceId)],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    method: paymentMethod("method").notNull(),
    currency: text("currency").notNull(), // usd | ves | eur
    amount: decimal("amount", { precision: 20, scale: 4 }).notNull(),
    reference: text("reference"),
    bankAccountId: uuid("bank_account_id").references(() => bankAccounts.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("payments_invoice_idx").on(t.invoiceId)],
);

/* ------------------------------------------------------------------ */
/* Finanzas: cuentas por cobrar/pagar, bancos                         */
/* ------------------------------------------------------------------ */

export const accountsLedger = pgTable(
  "accounts_ledger",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    invoiceId: uuid("invoice_id").references(() => invoices.id, {
      onDelete: "set null",
    }),
    type: ledgerEntryType("type").notNull(),
    amountUsd: decimal("amount_usd", { precision: 20, scale: 4 }).notNull(),
    amountVes: decimal("amount_ves", { precision: 20, scale: 4 }).notNull(),
    paidUsd: decimal("paid_usd", { precision: 20, scale: 4 }).notNull().default("0"),
    paidVes: decimal("paid_ves", { precision: 20, scale: 4 }).notNull().default("0"),
    dueDate: timestamp("due_date"),
    status: ledgerEntryStatus("status").notNull().default("pending"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("ledger_org_type_idx").on(t.organizationId, t.type),
    index("ledger_contact_idx").on(t.contactId),
  ],
);

export const bankAccounts = pgTable(
  "bank_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").notNull().default("bank"), // bank | zelle | pago_movil | cash
    currency: text("currency").notNull().default("usd"),
    bankName: text("bank_name"),
    accountNumber: text("account_number"),
    phone: text("phone"),
    initialBalanceUsd: decimal("initial_balance_usd", {
      precision: 20,
      scale: 4,
    })
      .notNull()
      .default("0"),
    initialBalanceVes: decimal("initial_balance_ves", {
      precision: 20,
      scale: 4,
    })
      .notNull()
      .default("0"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("bank_accounts_org_idx").on(t.organizationId)],
);

/** Historial de abonos a cuentas por cobrar/pagar (multimoneda). */
export const ledgerPayments = pgTable(
  "ledger_payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    ledgerId: uuid("ledger_id")
      .notNull()
      .references(() => accountsLedger.id, { onDelete: "cascade" }),
    method: paymentMethod("method").notNull(),
    currency: text("currency").notNull(), // usd | ves | eur
    amountUsd: decimal("amount_usd", { precision: 20, scale: 4 }).notNull(),
    amountVes: decimal("amount_ves", { precision: 20, scale: 4 }).notNull(),
    reference: text("reference"),
    note: text("note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("ledger_payments_ledger_idx").on(t.ledgerId)],
);

export const bankMovements = pgTable(
  "bank_movements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    bankAccountId: uuid("bank_account_id")
      .notNull()
      .references(() => bankAccounts.id, { onDelete: "cascade" }),
    direction: text("direction").notNull(), // in | out
    currency: text("currency").notNull(),
    amount: decimal("amount", { precision: 20, scale: 4 }).notNull(),
    description: text("description"),
    paymentId: uuid("payment_id").references(() => payments.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("bank_movements_account_idx").on(t.bankAccountId)],
);

/* ------------------------------------------------------------------ */
/* Objeto de esquema para el cliente Drizzle                          */
/* ------------------------------------------------------------------ */

export const schema = {
  user,
  session,
  account,
  verification,
  organizations,
  members,
  exchangeRates,
  warehouses,
  products,
  inventoryStocks,
  productRecipes,
  inventoryMovements,
  contacts,
  cashRegisters,
  cashMovements,
  invoices,
  invoiceItems,
  payments,
  accountsLedger,
  bankAccounts,
  bankMovements,
  ledgerPayments,
};

export type Schema = typeof schema;
