import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { BarChart3, RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api-client";

export const Route = createFileRoute("/dispatch-reports")({
  component: DispatchReportsPage,
});

function DispatchReportsPage() {
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState<any>({});

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getDispatchKpis();
      setKpis(res || {});
    } catch (e) {
      toast.error("Failed to load dispatch performance analytics", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  const cards = [
    ["Outbound Performance", [["Today's Dispatches", kpis.todays_dispatches || 0], ["Pending Dispatches", kpis.pending_dispatches || 0], ["Dispatched", kpis.dispatched || 0], ["Delivered", kpis.delivered || 0]]],
    ["Workflow Stages", [["Stock Reserved", kpis.stock_reserved || 0], ["Picking", kpis.picking || 0], ["Packing", kpis.packing || 0], ["Loading", kpis.loading || 0]]],
    ["Gate & Transit", [["Ready for Gate Exit", kpis.ready_for_gate_exit || 0], ["In Transit", kpis.in_transit || 0], ["Delayed", kpis.delayed || 0], ["Cancelled", kpis.cancelled || 0]]],
    ["Fleet Utilization", [["Total Drivers", kpis.driver_kpis?.total || 0], ["Available Drivers", kpis.driver_kpis?.available || 0], ["Total Vehicles", kpis.vehicle_kpis?.total || 0], ["Available Vehicles", kpis.vehicle_kpis?.available || 0]]],
  ];

  return (
    <AppShell
      title="Dispatch Reports & Analytics"
      subtitle="Comprehensive performance analytics, KPI metrics, fleet utilization, and outbound logistics reporting"
      actions={
        <Button variant="outline" className="rounded-xl" onClick={() => void loadData()}>
          <RefreshCw className="size-4" /> Refresh
        </Button>
      }
    >
      {loading ? (
        <div className="grid h-64 place-items-center"><Loader2 className="size-8 animate-spin text-primary" /></div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {cards.map(([title, metrics]: any) => (
            <Card key={title} className="rounded-2xl p-5">
              <div className="mb-4 flex items-center gap-2">
                <BarChart3 className="size-5 text-primary" />
                <h2 className="font-bold">{title}</h2>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {metrics.map(([label, value]: any) => (
                  <div key={label} className="rounded-xl border bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-2xl font-black">{value}</p>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}
