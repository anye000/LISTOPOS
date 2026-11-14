/**
 * Validación con zod de TODAS las entradas antes de tocar la base de datos
 * (ARCHITECTURE.md §4.4). Los montos se validan como strings decimales
 * positivos para preservar la precisión de decimal.js.
 */
import { z } from "zod";

export const moneyString = z
  .string()
  .regex(/^\d{1,15}(\.\d{1,4})?$/, "Monto inválido: use hasta 4 decimales");

export const rateString = z
  .string()
  .regex(/^\d{1,10}(\.\d{1,6})?$/, "Tasa inválida: use hasta 6 decimales");

export const currencyCode = z.enum(["usd", "ves", "eur"]);

export const isoDateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const paymentMethodCode = z.enum([
  "cash_usd",
  "cash_ves",
  "pos",
  "pago_movil",
  "zelle",
  "credit",
  "other",
]);

/* ------------------------------------------------------------------ */

export const invoiceItemInputSchema = z.object({
  productId: z.string().uuid().optional(),
  name: z.string().min(1).max(160),
  quantity: moneyString,
  unit: z.string().min(1).max(20).default("und"),
  unitPriceUsd: moneyString,
  exemptVat: z.boolean().default(false),
});

export const paymentInputSchema = z.object({
  method: paymentMethodCode,
  currency: currencyCode,
  amount: moneyString,
  reference: z.string().max(80).optional(),
  bankAccountId: z.string().uuid().optional(),
});

export const invoiceInputBaseSchema = z.object({
  type: z.enum(["invoice", "delivery_note", "quote"]).default("invoice"),
  contactId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  cashRegisterId: z.string().uuid().optional(),
  sourceInvoiceId: z.string().uuid().optional(),
  items: z.array(invoiceItemInputSchema).min(1),
  payments: z.array(paymentInputSchema).default([]),
  discountUsd: moneyString.default("0"),
  notes: z.string().max(500).optional(),
});

export const invoiceInputSchema = invoiceInputBaseSchema.superRefine(
  (val, ctx) => {
    if (val.type === "quote" && val.payments.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payments"],
        message: "Un presupuesto no puede llevar pagos",
      });
    }
  },
);

export const productInputSchema = z.object({
  name: z.string().min(1).max(120),
  sku: z.string().max(40).optional(),
  barcode: z.string().max(64).optional(),
  category: z.string().max(60).optional(),
  unit: z.string().min(1).max(20).default("und"),
  costUsd: moneyString.default("0"),
  marginPercent: z
    .string()
    .regex(/^\d{1,5}(\.\d{1,4})?$/)
    .default("0"),
  exemptVat: z.boolean().default(false),
  minStock: moneyString.default("0"),
  isComposite: z.boolean().default(false),
});

export const exchangeRateInputSchema = z.object({
  currency: z.enum(["usd", "eur"]),
  rateToVes: rateString,
  date: isoDateString,
  source: z.enum(["bcv", "custom"]).default("bcv"),
});

export const registerOrganizationInputSchema = z.object({
  companyName: z.string().min(2).max(120),
  slug: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug inválido: minúsculas, números y guiones"),
  rif: z.string().max(20).optional(),
  userName: z.string().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(8).max(72),
  initialUsdRate: rateString.optional(),
  initialEurRate: rateString.optional(),
});

export const cashRegisterInputSchema = z.object({
  warehouseId: z.string().uuid().optional(),
  openingBalanceUsd: moneyString.default("0"),
  openingBalanceVes: moneyString.default("0"),
});

export const closeRegisterInputSchema = z.object({
  countedUsd: moneyString.default("0"),
  countedVes: moneyString.default("0"),
  notes: z.string().max(300).optional(),
});

export const cashMovementInputSchema = z.object({
  cashRegisterId: z.string().uuid(),
  type: z.enum(["income", "expense"]),
  method: paymentMethodCode,
  currency: z.enum(["usd", "ves"]),
  amount: moneyString,
  reason: z.string().max(200).optional(),
});

/* ------------------------------------------------------------------ */
/* Sincronización offline (Outbox pattern)                            */
/* ------------------------------------------------------------------ */

export const exchangeRateSnapshotSchema = z.object({
  usdToVes: rateString,
  eurToVes: rateString,
  igtfRate: rateString,
  capturedAt: z.string(),
});

/** Payload de factura creada offline (el servidor recalcula los totales). */
export const invoiceSyncPayloadSchema = invoiceInputBaseSchema.extend({
  id: z.string().uuid(),
  number: z.string().max(20).optional(),
  date: z.string().datetime().optional(),
  exchangeRateSnapshot: exchangeRateSnapshotSchema,
});

export const syncEntityCode = z.enum([
  "invoice",
  "contact",
  "product",
  "stock",
  "cashMovement",
]);

export const syncEnvelopeSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  entity: syncEntityCode,
  operation: z.enum(["create", "update"]),
  payload: z.unknown(),
});

/* ------------------------------------------------------------------ */
/* Inventario (Fase 3)                                                */
/* ------------------------------------------------------------------ */

/** Cantidad con signo (para ajustes: positivo entra, negativo sale). */
export const signedQuantityString = z
  .string()
  .regex(/^-?\d{1,15}(\.\d{1,4})?$/, "Cantidad inválida: use hasta 4 decimales");

export const purchaseInputSchema = z.object({
  warehouseId: z.string().uuid(),
  supplierContactId: z.string().uuid().optional(),
  invoiceNumber: z.string().max(30).optional(),
  note: z.string().max(300).optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: moneyString,
        unitCostUsd: moneyString,
      }),
    )
    .min(1, "La compra debe tener al menos una línea"),
});

export const transferInputSchema = z.object({
  fromWarehouseId: z.string().uuid(),
  toWarehouseId: z.string().uuid(),
  note: z.string().max(300).optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: moneyString,
      }),
    )
    .min(1, "El traslado debe tener al menos una línea"),
});

export const adjustStockInputSchema = z.object({
  warehouseId: z.string().uuid(),
  productId: z.string().uuid(),
  delta: signedQuantityString,
  note: z.string().max(300).optional(),
});

export const recipeComponentSchema = z.object({
  componentId: z.string().uuid(),
  quantity: moneyString,
  unit: z.string().min(1).max(20).default("und"),
});

export const recipeInputSchema = z.object({
  productId: z.string().uuid(),
  isComposite: z.boolean().default(true),
  components: z
    .array(recipeComponentSchema)
    .min(1, "La receta debe tener al menos un insumo"),
});

export const warehouseInputSchema = z.object({
  name: z.string().min(2).max(80),
  address: z.string().max(200).optional(),
});

/* ------------------------------------------------------------------ */
/* CRM, finanzas y ajustes (Fase 5)                                   */
/* ------------------------------------------------------------------ */

export const contactInputSchema = z.object({
  type: z.enum(["customer", "supplier"]).default("customer"),
  name: z.string().min(2).max(120),
  document: z.string().max(20).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().optional().or(z.literal("")),
  address: z.string().max(200).optional(),
  creditLimitUsd: moneyString.default("0"),
  notes: z.string().max(300).optional(),
});

export const abonoInputSchema = z.object({
  ledgerId: z.string().uuid(),
  method: paymentMethodCode,
  currency: currencyCode,
  amount: moneyString,
  reference: z.string().max(80).optional(),
  note: z.string().max(200).optional(),
});

export const bankAccountInputSchema = z.object({
  name: z.string().min(2).max(80),
  type: z.enum(["bank", "zelle", "pago_movil", "cash"]).default("bank"),
  currency: z.enum(["usd", "ves"]).default("usd"),
  bankName: z.string().max(60).optional(),
  accountNumber: z.string().max(30).optional(),
  phone: z.string().max(30).optional(),
  initialBalanceUsd: moneyString.default("0"),
  initialBalanceVes: moneyString.default("0"),
});

export const orgSettingsSchema = z.object({
  name: z.string().min(2).max(120),
  rif: z.string().max(20).optional(),
  address: z.string().max(200).optional(),
  igtfRate: rateString,
});
