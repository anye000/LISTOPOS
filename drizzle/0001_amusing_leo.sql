CREATE TABLE "ledger_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"ledger_id" uuid NOT NULL,
	"method" "payment_method" NOT NULL,
	"currency" text NOT NULL,
	"amount_usd" numeric(20, 4) NOT NULL,
	"amount_ves" numeric(20, 4) NOT NULL,
	"reference" text,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "initial_balance_usd" numeric(20, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "initial_balance_ves" numeric(20, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_payments" ADD CONSTRAINT "ledger_payments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_payments" ADD CONSTRAINT "ledger_payments_ledger_id_accounts_ledger_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."accounts_ledger"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_payments_ledger_idx" ON "ledger_payments" USING btree ("ledger_id");