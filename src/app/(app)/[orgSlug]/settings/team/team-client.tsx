"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";

import {
  inviteMember,
  updateMemberRole,
  updateOrgSettings,
} from "@/modules/settings/actions";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/table";

interface MemberRow {
  memberId: string;
  role: "owner" | "admin" | "cashier" | "accountant";
  userId: string;
  name: string;
  email: string;
}

const ROLE_LABELS: Record<string, string> = {
  owner: "Dueño",
  admin: "Admin",
  cashier: "Cajero",
  accountant: "Contador",
};

export default function TeamClient({
  members,
  org,
  myRole,
}: {
  members: MemberRow[];
  org: {
    id: string;
    name: string;
    slug: string;
    rif: string | null;
    address: string | null;
    igtfRate: string;
  };
  myRole: string;
}) {
  const { slug } = useOrg();
  const router = useRouter();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("cashier");
  const [settings, setSettings] = useState({
    name: org.name,
    rif: org.rif ?? "",
    address: org.address ?? "",
    igtfRate: org.igtfRate,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const canManage = myRole === "owner" || myRole === "admin";

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const result = await inviteMember(slug, {
      email: inviteEmail,
      role: inviteRole as "admin" | "cashier" | "accountant",
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "No se pudo invitar");
      return;
    }
    setInviteOpen(false);
    setInviteEmail("");
    setError(null);
    router.refresh();
  }

  async function handleRole(memberId: string, role: string) {
    const result = await updateMemberRole(
      slug,
      memberId,
      role as "admin" | "cashier" | "accountant",
    );
    if (!result.ok) {
      setError(result.error ?? "No se pudo cambiar el rol");
      return;
    }
    setError(null);
    router.refresh();
  }

  async function handleSettings(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const result = await updateOrgSettings(slug, {
      name: settings.name,
      rif: settings.rif || undefined,
      address: settings.address || undefined,
      igtfRate: settings.igtfRate,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "No se pudo guardar");
      return;
    }
    setError(null);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    router.refresh();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Equipo */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold text-pizarra-900">Equipo</h1>
            <p className="mt-1 text-sm text-pizarra-600">
              Invita empleados y restringe permisos por rol.
            </p>
          </div>
          {canManage && (
            <Button onClick={() => setInviteOpen(true)}>
              <UserPlus className="size-4" />
              Invitar
            </Button>
          )}
        </div>

        <div className="rounded-2xl border border-pizarra-200 bg-white shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Miembro</TableHead>
                <TableHead>Rol</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.memberId}>
                  <TableCell>
                    <p className="font-semibold text-pizarra-900">{m.name}</p>
                    <p className="text-xs text-pizarra-500">{m.email}</p>
                  </TableCell>
                  <TableCell>
                    {m.role === "owner" || !canManage ? (
                      <Badge variant={m.role === "owner" ? "default" : "secondary"}>
                        {ROLE_LABELS[m.role]}
                      </Badge>
                    ) : (
                      <Select
                        value={m.role}
                        onValueChange={(v) => handleRole(m.memberId, v)}
                      >
                        <SelectTrigger className="h-8 w-36 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="cashier">Cajero</SelectItem>
                          <SelectItem value="accountant">Contador</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {error && (
          <p className="rounded-lg bg-error-50 px-3 py-2 text-sm text-error-700">
            {error}
          </p>
        )}
      </div>

      {/* Datos de la empresa */}
      <div className="space-y-4">
        <div>
          <h2 className="text-2xl font-bold text-pizarra-900">Datos de la empresa</h2>
          <p className="mt-1 text-sm text-pizarra-600">
            Nombre fiscal, RIF y tasa de IGTF aplicada en tus facturas.
          </p>
        </div>
        <form
          onSubmit={handleSettings}
          className="space-y-4 rounded-2xl border border-pizarra-200 bg-white p-5 shadow-sm"
        >
          <div className="space-y-2">
            <Label>Nombre de la empresa</Label>
            <Input
              required
              value={settings.name}
              onChange={(e) => setSettings({ ...settings, name: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>RIF</Label>
              <Input
                value={settings.rif}
                onChange={(e) => setSettings({ ...settings, rif: e.target.value })}
                placeholder="J-12345678-9"
              />
            </div>
            <div className="space-y-2">
              <Label>Tasa IGTF (%)</Label>
              <Input
                inputMode="decimal"
                value={settings.igtfRate}
                onChange={(e) => setSettings({ ...settings, igtfRate: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Dirección fiscal</Label>
            <Input
              value={settings.address}
              onChange={(e) => setSettings({ ...settings, address: e.target.value })}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={busy || !canManage}>
              Guardar cambios
            </Button>
            {saved && (
              <span className="text-sm font-semibold text-eco-600">
                Guardado ✓
              </span>
            )}
          </div>
        </form>
      </div>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <form onSubmit={handleInvite}>
            <DialogHeader>
              <DialogTitle>Invitar miembro</DialogTitle>
              <DialogDescription>
                El correo debe pertenecer a una cuenta de ListoPOS ya registrada.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 space-y-4">
              <div className="space-y-2">
                <Label>Correo del empleado</Label>
                <Input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="empleado@tuempresa.com"
                />
              </div>
              <div className="space-y-2">
                <Label>Rol</Label>
                <Select value={inviteRole} onValueChange={setInviteRole}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="cashier">Cajero</SelectItem>
                    <SelectItem value="accountant">Contador</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter className="mt-5">
              <Button variant="outline" type="button" onClick={() => setInviteOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={busy}>
                Enviar invitación
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
