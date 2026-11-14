import { Construction } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/ui/card";

export default function ModulePlaceholder({
  module,
  phase,
}: {
  module: string;
  phase: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Construction className="size-5 text-brand-600" />
          {module}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-pizarra-600">
          Este módulo se está construyendo y se entrega en la {phase} del plan
          maestro. Mientras tanto, la base de datos, la sincronización offline
          y la seguridad multi-empresa ya están activas.
        </p>
      </CardContent>
    </Card>
  );
}
