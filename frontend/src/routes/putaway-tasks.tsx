import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { AppShell } from "@/components/wms/app-shell";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/putaway-tasks")({
  head: () => ({
    meta: [
      { title: "Putaway Tasks · KaizenX" },
      { name: "description", content: "Putaway tasks queue." },
    ],
  }),
  component: PutawayTasksPage,
});

function PutawayTasksPage() {
  const navigate = useNavigate();

  useEffect(() => {
    navigate({ to: "/inventory" });
  }, [navigate]);

  return (
    <AppShell title="Putaway Tasks Redirect">
      <div className="flex h-96 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Redirecting to Putaway Queue in Inventory Hub...</p>
        </div>
      </div>
    </AppShell>
  );
}
