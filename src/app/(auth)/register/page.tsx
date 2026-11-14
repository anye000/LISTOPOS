"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/ui/card";
import { Input } from "@/ui/input";
import { Label } from "@/ui/label";

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    companyName: "",
    slug: "",
    rif: "",
    userName: "",
    email: "",
    password: "",
    initialUsdRate: "",
    initialEurRate: "",
  });
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function update(field: keyof typeof form, value: string) {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      if (field === "companyName" && !slugTouched) {
        next.slug = slugify(value);
      }
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: form.companyName,
          slug: slugify(form.slug || form.companyName),
          rif: form.rif || undefined,
          userName: form.userName,
          email: form.email,
          password: form.password,
          initialUsdRate: form.initialUsdRate || undefined,
          initialEurRate: form.initialEurRate || undefined,
        }),
      });
      if (res.redirected) {
        router.replace(res.url);
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => null)) as {
        error?: string;
        issues?: Record<string, string[]>;
      } | null;
      const issueText = body?.issues
        ? Object.values(body.issues).flat().join(". ")
        : null;
      setError(body?.error ?? issueText ?? "No se pudo crear la cuenta");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b from-brand-50 via-white to-white px-4 py-10">
      <Link href="/" className="mb-8">
        <Image src="/logo.svg" alt="ListoPOS" width={160} height={38} priority />
      </Link>
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Crear cuenta gratis</CardTitle>
          <CardDescription>
            Configuramos tu empresa, tu almacén y la tasa BCV inicial al
            instante.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="companyName">Nombre de la empresa</Label>
                <Input
                  id="companyName"
                  required
                  value={form.companyName}
                  onChange={(e) => update("companyName", e.target.value)}
                  placeholder="Pollería Doña Ana"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rif">RIF (opcional)</Label>
                <Input
                  id="rif"
                  value={form.rif}
                  onChange={(e) => update("rif", e.target.value)}
                  placeholder="J-12345678-9"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="slug">Dirección de tu panel</Label>
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-pizarra-500">listopos.app/</span>
                <Input
                  id="slug"
                  required
                  value={form.slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    update("slug", slugify(e.target.value));
                  }}
                  placeholder="pollería-dona-ana"
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="userName">Tu nombre</Label>
                <Input
                  id="userName"
                  required
                  value={form.userName}
                  onChange={(e) => update("userName", e.target.value)}
                  placeholder="Ana Pérez"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Correo electrónico</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => update("email", e.target.value)}
                  placeholder="ana@tuempresa.com"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Contraseña (mínimo 8 caracteres)</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={8}
                value={form.password}
                onChange={(e) => update("password", e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="initialUsdRate">Tasa BCV USD inicial (Bs)</Label>
                <Input
                  id="initialUsdRate"
                  inputMode="decimal"
                  value={form.initialUsdRate}
                  onChange={(e) => update("initialUsdRate", e.target.value)}
                  placeholder="36.50"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="initialEurRate">Tasa BCV EUR inicial (Bs)</Label>
                <Input
                  id="initialEurRate"
                  inputMode="decimal"
                  value={form.initialEurRate}
                  onChange={(e) => update("initialEurRate", e.target.value)}
                  placeholder="40.15"
                />
              </div>
            </div>
            {error && (
              <p className="rounded-lg bg-error-50 px-3 py-2 text-sm text-error-700">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Creando tu empresa…" : "Crear cuenta gratis"}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-pizarra-600">
            ¿Ya tienes cuenta?{" "}
            <Link href="/login" className="font-semibold text-brand-700 hover:underline">
              Iniciar sesión
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
