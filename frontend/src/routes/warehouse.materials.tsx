import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { AppShell } from "@/components/wms/app-shell";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/warehouse/materials")({
  component: WarehouseMaterialsPage,
});

function WarehouseMaterialsPage() {
  const navigate = useNavigate();

  useEffect(() => {
    navigate({ to: "/inventory" });
  }, [navigate]);

  return (
    <AppShell title="Materials Redirect">
      <div className="flex h-96 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Redirecting to Inventory Hub...</p>
        </div>
      </div>
    </AppShell>
  );
}
