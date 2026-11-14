import { redirect } from "next/navigation";

/** Ajustes: el panel de Equipo concentra permisos y datos de la empresa. */
export default async function SettingsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  redirect(`/${orgSlug}/settings/team`);
}
