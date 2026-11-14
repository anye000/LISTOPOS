"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Decimal from "decimal.js";
import { Pencil, Plus } from "lucide-react";

import type { accountsLedger, contacts } from "@/core/db-cloud/schema";
import { createContact, updateContact } from "@/modules/crm/actions";
import { formatMoney } from "@/core/currency/format";
import { useOrg } from "@/ui/org-provider";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { Input } from "@/ui/input";
import { Label } from "@/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/table";

type Contact = typeof contacts.$inferSelect;
type Ledger = typeof accountsLedger.$inferSelect;
type InvoiceRow = {
  id: string;
  contactId: string | null;
  number: string | null;
  totalUsd: string;
  date: Date;
  status: string;
};

interface FormState {
  id?: string;
  type: "customer" | "supplier";
  name: string;
  document: string;
  phone: string;
  email: string;
  address: string;
  creditLimitUsd: string;
  notes: string;
}

const emptyForm: FormState = {
  type: "customer",
  name: "",
  document: "",
  phone: "",
  email: "",
  address: "",
  creditLimitUsd: "0",
  notes: "",
};

export default function CrmClient({
  contacts,
  ledger,
  invoices,
}: {
  contacts: Contact[];
  ledger: Ledger[];
  invoices: InvoiceRow[];
}) {
  const { slug } = useOrg();
  const router = useRouter();
  const [tab, setTab] = useState<"customer" | "supplier">("customer");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(
    () => contacts.filter((c) => c.type === tab),
    [contacts, tab],
  );

  const balanceFor = (contactId: string) =>
    ledger
      .filter((l) => l.contactId === contactId)
      .reduce(
        (acc, l) =>
          acc.plus(new Decimal(l.amountUsd).minus(l.paidUsd)),
        new Decimal(0),
      );

  const purchasesFor = (contactId: string) =>
    invoices.filter((i) => i.contactId === contactId).length;

  function openCreate() {
    setForm({ ...emptyForm, type: tab });
    setError(null);
    setOpen(true);
  }

  function openEdit(c: Contact) {
    setForm({
      id: c.id,
      type: c.type,
      name: c.name,
      document: c.document ?? "",
      phone: c.phone ?? "",
      email: c.email ?? "",
      address: c.address ?? "",
      creditLimitUsd: c.creditLimitUsd,
      notes: c.notes ?? "",
    });
    setError(null);
    setOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const input = {
      type: form.type,
      name: form.name,
      document: form.document || undefined,
      phone: form.phone || undefined,
      email: form.email || undefined,
      address: form.address || undefined,
      creditLimitUsd: form.creditLimitUsd,
      notes: form.notes || undefined,
    };
    const result = form.id
      ? await updateContact(slug, form.id, input)
      : await createContact(slug, input);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Error al guardar");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-pizarra-900">CRM</h1>
          <p className="mt-1 text-sm text-pizarra-600">
            Clientes y proveedores con historial, saldo pendiente y límite de
            crédito.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-xl bg-pizarra-100 p-1">
            <button
              onClick={() => setTab("customer")}
              className={`rounded-lg px-4 py-2 text-sm font-semibold ${
                tab === "customer" ? "bg-white text-brand-700 shadow-sm" : "text-pizarra-600"
              }`}
            >
              Clientes
            </button>
            <button
              onClick={() => setTab("supplier")}
              className={`rounded-lg px-4 py-2 text-sm font-semibold ${
                tab === "supplier" ? "bg-white text-brand-700 shadow-sm" : "text-pizarra-600"
              }`}
            >
              Proveedores
            </button>
          </div>
          <Button onClick={openCreate}>
            <Plus className="size-4" />
            Nuevo {tab === "customer" ? "cliente" : "proveedor"}
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-pizarra-200 bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>RIF / Cédula</TableHead>
              <TableHead>Teléfono</TableHead>
              <TableHead className="text-right">Límite crédito</TableHead>
              <TableHead className="text-right">Saldo pendiente</TableHead>
              <TableHead className="text-right">Compras</TableHead>
              <TableHead className="text-right">Puntos</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-pizarra-500">
                  No hay {tab === "customer" ? "clientes" : "proveedores"} registrados.
                </TableCell>
              </TableRow>
            )}
            {rows.map((c) => {
              const balance = balanceFor(c.id);
              return (
                <TableRow key={c.id}>
                  <TableCell>
                    <p className="font-semibold text-pizarra-900">{c.name}</p>
                    {c.email && <p className="text-xs text-pizarra-500">{c.email}</p>}
                  </TableCell>
                  <TableCell className="text-sm">{c.document ?? "—"}</TableCell>
                  <TableCell className="text-sm">{c.phone ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(c.creditLimitUsd, "usd")}
                  </TableCell>
                  <TableCell className="text-right">
                    {balance.gt(0) ? (
                      <Badge variant="warning" className="tabular-nums">
                        {formatMoney(balance.toFixed(2), "usd")}
                      </Badge>
                    ) : (
                      <span className="text-sm text-pizarra-400">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {purchasesFor(c.id)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {c.points}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(c)}>
                      <Pencil className="size-3.5" />
                      Editar
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={handleSave}>
            <DialogHeader>
              <DialogTitle>
                {form.id ? "Editar" : "Nuevo"}{" "}
                {form.type === "customer" ? "cliente" : "proveedor"}
              </DialogTitle>
              <DialogDescription>
                RIF, teléfono y límite de crédito para facturar a crédito.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label>Nombre / razón social</Label>
                <Input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>RIF / cédula</Label>
                <Input
                  value={form.document}
                  onChange={(e) => setForm({ ...form, document: e.target.value })}
                  placeholder="J-12345678-9"
                />
              </div>
              <div className="space-y-2">
                <Label>Teléfono</Label>
                <Input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="0414-0000000"
                />
              </div>
              <div className="space-y-2">
                <Label>Correo</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Límite de crédito (USD)</Label>
                <Input
                  inputMode="decimal"
                  value={form.creditLimitUsd}
                  onChange={(e) => setForm({ ...form, creditLimitUsd: e.target.value })}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Dirección</Label>
                <Input
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                />
              </div>
            </div>
            {error && (
              <p className="mt-3 rounded-lg bg-error-50 px-3 py-2 text-sm text-error-700">
                {error}
              </p>
            )}
            <DialogFooter className="mt-5">
              <Button variant="outline" type="button" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={busy}>
                Guardar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
