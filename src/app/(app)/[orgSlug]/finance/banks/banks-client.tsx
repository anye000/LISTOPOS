"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Landmark, Plus, Smartphone } from "lucide-react";

import { createBankAction } from "@/modules/finance/actions";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/select";

interface BankRow {
  id: string;
  name: string;
  type: string;
  currency: string;
  bankName: string | null;
  accountNumber: string | null;
  phone: string | null;
  balanceUsd: string;
  balanceVes: string;
  movementCount: number;
}

const TYPE_LABELS: Record<string, string> = {
  bank: "Banco",
  zelle: "Zelle",
  pago_movil: "Pago Móvil",
  cash: "Efectivo",
};

export default function BanksClient({ accounts }: { accounts: BankRow[] }) {
  const { slug } = useOrg();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    type: "bank",
    currency: "usd",
    bankName: "",
    accountNumber: "",
    phone: "",
    initialBalanceUsd: "0",
    initialBalanceVes: "0",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const result = await createBankAction(slug, {
      ...form,
      bankName: form.bankName || undefined,
      accountNumber: form.accountNumber || undefined,
      phone: form.phone || undefined,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "No se pudo crear la cuenta");
      return;
    }
    setOpen(false);
    setError(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-pizarra-900">Bancos y billeteras</h1>
          <p className="mt-1 text-sm text-pizarra-600">
            El saldo se actualiza automáticamente con cada pago recibido o
            gasto registrado.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="size-4" />
          Nueva cuenta
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {accounts.length === 0 && (
          <p className="col-span-full rounded-2xl border border-dashed border-pizarra-300 p-10 text-center text-sm text-pizarra-500">
            Crea tu primera cuenta bancaria o billetera.
          </p>
        )}
        {accounts.map((a) => (
          <div
            key={a.id}
            className="rounded-2xl border border-pizarra-200 bg-white p-5 shadow-sm"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {a.type === "bank" ? (
                  <Landmark className="size-5 text-brand-600" />
                ) : (
                  <Smartphone className="size-5 text-brand-600" />
                )}
                <h3 className="font-bold text-pizarra-900">{a.name}</h3>
              </div>
              <Badge variant="secondary">{TYPE_LABELS[a.type] ?? a.type}</Badge>
            </div>
            <p className="mt-1 text-xs text-pizarra-500">
              {a.bankName ?? ""} {a.accountNumber ?? ""} {a.phone ?? ""}
            </p>
            <p className="mt-4 text-2xl font-bold text-pizarra-900">
              {a.currency === "usd"
                ? formatMoney(a.balanceUsd, "usd")
                : formatMoney(a.balanceVes, "ves")}
            </p>
            <p className="text-xs text-pizarra-500">
              {a.movementCount} movimiento{a.movementCount !== 1 ? "s" : ""}
            </p>
          </div>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={handleSave}>
            <DialogHeader>
              <DialogTitle>Nueva cuenta / billetera</DialogTitle>
              <DialogDescription>
                Banco nacional, Zelle, Pago Móvil o caja de efectivo.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 space-y-4">
              <div className="space-y-2">
                <Label>Nombre</Label>
                <Input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Banco de Venezuela"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Tipo</Label>
                  <Select
                    value={form.type}
                    onValueChange={(v) => setForm({ ...form, type: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bank">Banco</SelectItem>
                      <SelectItem value="zelle">Zelle</SelectItem>
                      <SelectItem value="pago_movil">Pago Móvil</SelectItem>
                      <SelectItem value="cash">Efectivo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Moneda</Label>
                  <Select
                    value={form.currency}
                    onValueChange={(v) => setForm({ ...form, currency: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="usd">USD</SelectItem>
                      <SelectItem value="ves">Bs</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Banco</Label>
                  <Input
                    value={form.bankName}
                    onChange={(e) => setForm({ ...form, bankName: e.target.value })}
                    placeholder="0102"
                  />
                </div>
                <div className="space-y-2">
                  <Label>N° de cuenta / teléfono</Label>
                  <Input
                    value={form.accountNumber || form.phone}
                    onChange={(e) =>
                      setForm(
                        form.type === "bank"
                          ? { ...form, accountNumber: e.target.value }
                          : { ...form, phone: e.target.value },
                      )
                    }
                    placeholder={form.type === "bank" ? "0102-0000-00" : "0414-0000000"}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Saldo inicial USD</Label>
                  <Input
                    inputMode="decimal"
                    value={form.initialBalanceUsd}
                    onChange={(e) =>
                      setForm({ ...form, initialBalanceUsd: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Saldo inicial Bs</Label>
                  <Input
                    inputMode="decimal"
                    value={form.initialBalanceVes}
                    onChange={(e) =>
                      setForm({ ...form, initialBalanceVes: e.target.value })
                    }
                  />
                </div>
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
                Crear cuenta
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
