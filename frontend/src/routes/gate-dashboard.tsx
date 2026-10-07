import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ClipboardCheck, Clock3, Loader2, LogOut, Plus, ShieldCheck, Truck, Warehouse } from "lucide-react";
import { AppShell, StatusBadge } from "@/components/wms/app-shell";
import { StatCard } from "@/components/wms/primitives";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api-client";
import { requireRole } from "@/lib/auth-utils";

export const Route = createFileRoute("/gate-dashboard")({
  beforeLoad: () => requireRole("GATE_SECURITY"),
  head: () => ({ meta: [{ title: "Gate Security Dashboard · KaizenX" }] }),
  component: GateDashboard,
});

function GateDashboard() {
  const [loading, setLoading] = useState(true);
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [exitingId, setExitingId] = useState<string | null>(null);

  const loadDashboard = async () => {
    try {
      setDashboardData(await api.getDashboardStats());
    } catch (error) {
      console.error("Failed to load gate dashboard", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDashboard();
    const timer = window.setInterval(loadDashboard, 5_000);
    const handleRefresh = () => { void loadDashboard(); };

    window.addEventListener("focus", handleRefresh);
    window.addEventListener("storage", handleRefresh);
    window.addEventListener("gate-entries:refresh", handleRefresh);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", handleRefresh);
      window.removeEventListener("storage", handleRefresh);
      window.removeEventListener("gate-entries:refresh", handleRefresh);
    };
  }, []);

  const isEligibleForInboundExit = (statusStr: string) => {
    const upper = (statusStr || "").toUpperCase().trim();
    return [
      "RECEIVING_COMPLETED",
      "COMPLETED",
      "RELEASED",
      "DOCK_RELEASED",
      "GRN_POSTED",
      "QUALITY_PASSED",
      "UNLOADED",
    ].includes(upper);
  };

  const handleMarkVehicleExited = async (entry: any) => {
    const vehName = entry.vehicle_number || "this vehicle";
    if (!confirm(`Confirm gate exit approval for ${vehName}? Confirm that vehicle has completed unloading/receiving and is cleared to leave facility.`)) return;
    setExitingId(entry.id);
    try {
      const updated = await api.markInboundVehicleExited(entry.id);
      toast.success(`Gate exit approved for ${vehName}`, {
        description: `Status updated to VEHICLE_EXITED by ${updated.exited_by || "Security"}.`,
      });
      await loadDashboard();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("gate-entries:refresh"));
      }
    } catch (error: any) {
      toast.error("Gate exit approval failed", {
        description: error?.message || "Ensure receiving/unloading is complete before approving vehicle exit.",
      });
    } finally {
      setExitingId(null);
    }
  };

  const stats = dashboardData?.stats || {};
  const entries = dashboardData?.gateEntries || [];

  return (
    <AppShell
      title="Gate Security Dashboard"
      subtitle="Live vehicle arrivals, PO verification and gate operations"
      actions={
        <Button asChild className="rounded-xl shadow-glow">
          <Link to="/gate-entry">
            <Plus className="size-4" /> New Gate Entry
          </Link>
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Total arrivals"
          value={loading ? "..." : String(stats.totalArrivals || 0)}
          delta="Vehicles recorded today"
          icon={Truck}
          tone="primary"
          to="/gate-entry"
        />
        <StatCard
          label="Verified POs"
          value={loading ? "..." : String(stats.verifiedArrivals || 0)}
          delta="PO matched at the gate"
          icon={ShieldCheck}
          tone="success"
          to="/gate-entry"
        />
        <StatCard
          label="Unscheduled"
          value={loading ? "..." : String(stats.unscheduledArrivals || 0)}
          delta="Requires manual review"
          icon={ClipboardCheck}
          tone="warning"
          to="/unscheduled-arrivals"
        />
        <StatCard
          label="Awaiting Dock"
          value={loading ? "..." : String(stats.awaitingDock ?? stats.awaiting_dock ?? 0)}
          delta="Needs dock allocation"
          icon={Clock3}
          tone={Number(stats.awaitingDock ?? stats.awaiting_dock ?? 0) > 0 ? "warning" : "primary"}
          to="/dock-management"
        />
        <StatCard
          label="Vehicles Exited"
          value={loading ? "..." : String(stats.vehiclesExited ?? stats.vehicles_exited ?? 0)}
          delta="Cleared & exited facility"
          icon={LogOut}
          tone="success"
          to="/gate-entry"
        />
        <StatCard
          label="Pending clearance"
          value={loading ? "..." : String(stats.vehiclesWaiting || 0)}
          delta="Not yet in dock queue"
          icon={Clock3}
          tone="teal"
          to="/gate-entry"
        />
      </div>

      <Card className="mt-4 border-border/50 shadow-soft">
        <CardHeader>
          <CardTitle className="text-base">Recent gate activity</CardTitle>
          <CardDescription>Latest vehicle entries and verification results</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex h-36 items-center justify-center">
              <Loader2 className="size-6 animate-spin text-primary" />
            </div>
          ) : entries.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No gate entries recorded yet.
            </p>
          ) : (
            <div className="divide-y divide-border/60">
              {entries.slice(0, 10).map((entry: any, index: number) => {
                const rawDock = entry.dock_name || entry.dock_number || entry.assigned_dock_id;
                const assignedDock =
                  rawDock && rawDock !== "—" && rawDock.toUpperCase() !== "UNASSIGNED"
                    ? rawDock.includes("Dock")
                      ? rawDock
                      : `Dock ${rawDock}`
                    : null;
                const statusUpper = (entry.status || "").toUpperCase();
                const isExited = statusUpper === "VEHICLE_EXITED" || !!entry.exited_at;

                return (
                  <div
                    key={entry.id || index}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div className="space-y-0.5">
                      <p className="text-sm font-semibold">
                        {entry.vehicle_number || "Vehicle pending"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {entry.gate_entry_no || "Gate entry pending"} · {entry.vendor || entry.supplier_name || "Supplier pending"} · {entry.po_number || "No PO"}
                      </p>
                      {isExited && (
                        <p className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1 mt-1">
                          <ShieldCheck className="size-3.5" /> Approved Exit at {entry.exited_at ? new Date(entry.exited_at).toLocaleString() : "Recently"} {entry.exited_by ? `by ${entry.exited_by}` : ""}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {assignedDock && (
                        <span className="inline-flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                          <Warehouse className="size-3.5 text-primary" />
                          {assignedDock}
                        </span>
                      )}
                      <StatusBadge status={entry.status || "Waiting"} />

                      {!isExited && isEligibleForInboundExit(entry.status) && (
                        <Button
                          size="sm"
                          className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-sm gap-1.5 text-xs h-8 px-3"
                          disabled={exitingId === entry.id}
                          onClick={() => void handleMarkVehicleExited(entry)}
                        >
                          {exitingId === entry.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <ShieldCheck className="size-3.5" />
                          )}
                          Approve Gate Exit
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
