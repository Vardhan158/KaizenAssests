import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  Truck,
  Package,
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  Plus,
  RefreshCw,
  Loader2,
  Search,
  UserCheck,
  Navigation,
  ShieldCheck,
  ClipboardList,
  BarChart3,
  MapPin,
  FileText,
  Boxes,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell, StatusBadge } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api-client";

export const Route = createFileRoute("/dispatch")({
  component: DispatchOverviewPage,
});

function DispatchOverviewPage() {
  const [loading, setLoading] = useState(true);
  const [dispatches, setDispatches] = useState<any[]>([]);
  const [readyForGateExit, setReadyForGateExit] = useState<any[]>([]);
  const [kpis, setKpis] = useState<any>({
    todays_dispatches: 0,
    pending_dispatches: 0,
    stock_reserved: 0,
    picking: 0,
    packing: 0,
    dispatch_ready: 0,
    loading: 0,
    ready_for_gate_exit: 0,
    dispatched: 0,
    in_transit: 0,
    delivered: 0,
    delayed: 0,
    cancelled: 0,
    driver_kpis: { total: 0, available: 0, assigned: 0 },
    vehicle_kpis: { total: 0, available: 0, assigned: 0 },
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [dispatchRes, readyRes, kpiRes] = await Promise.all([
        api.getDispatches(),
        api.getDispatchesReadyForGateExit(),
        api.getDispatchKpis(),
      ]);
      setDispatches(dispatchRes.items || []);
      setReadyForGateExit(readyRes || []);
      if (kpiRes) {
        setKpis(kpiRes);
      }
    } catch (e) {
      toast.error("Failed to load dispatch dashboard", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  return (
    <AppShell
      title="Finished Goods Dispatch Dashboard"
      subtitle="Real-time outbound dispatch metrics, fleet status, and active dispatch queue"
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" className="rounded-xl" onClick={() => void loadData()}>
            <RefreshCw className="size-4" /> Refresh
          </Button>
          <Link to="/dispatch-orders">
            <Button className="rounded-xl shadow-glow">
              <Plus className="size-4 mr-2" /> Create Dispatch
            </Button>
          </Link>
        </div>
      }
    >
      {loading ? (
        <div className="grid h-64 place-items-center">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* KPI Summary Cards */}
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
            <KpiCard
              title="Total Dispatch"
              value={kpis.todays_dispatches}
              icon={Truck}
              color="text-blue-500 bg-blue-500/10"
            />
            <KpiCard
              title="Pending"
              value={kpis.pending_dispatches}
              icon={Clock}
              color="text-amber-500 bg-amber-500/10"
            />
            <KpiCard
              title="Ready"
              value={kpis.dispatch_ready || kpis.ready_for_gate_exit}
              icon={ShieldCheck}
              color="text-emerald-500 bg-emerald-500/10"
            />
            <KpiCard
              title="Loading"
              value={kpis.loading}
              icon={Navigation}
              color="text-purple-500 bg-purple-500/10"
            />
            <KpiCard
              title="In Transit"
              value={kpis.in_transit}
              icon={MapPin}
              color="text-blue-600 bg-blue-600/10"
            />
            <KpiCard
              title="Delayed"
              value={kpis.delayed}
              icon={AlertTriangle}
              color="text-rose-500 bg-rose-500/10"
            />
          </div>

          {/* Dispatch Queue Table */}
          <Card className="rounded-2xl p-6 shadow-soft border-border/80">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold tracking-tight uppercase text-foreground">Dispatch Queue</h3>
              <Link to="/dispatch-orders">
                <Button size="sm" variant="outline" className="rounded-xl text-xs">View All Orders</Button>
              </Link>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="font-bold">Dispatch</TableHead>
                  <TableHead className="font-bold">Order No</TableHead>
                  <TableHead className="font-bold">Customer</TableHead>
                  <TableHead className="font-bold">Qty</TableHead>
                  <TableHead className="font-bold">Driver</TableHead>
                  <TableHead className="font-bold">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dispatches.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      No active dispatches found. Click "Create Dispatch" to start a new outbound shipment.
                    </TableCell>
                  </TableRow>
                ) : (
                  dispatches.map((d) => {
                    const qty = d.total_qty || d.items?.reduce((acc: number, i: any) => acc + (i.quantity_ordered || i.quantity || 0), 0) || 0;
                    const driver = d.driver_name || d.driver_id || "Unassigned";
                    return (
                      <TableRow key={d.id || d.dispatch_number}>
                        <TableCell className="font-mono font-bold text-primary">{d.dispatch_number}</TableCell>
                        <TableCell className="font-mono">{d.order_number}</TableCell>
                        <TableCell className="font-semibold">{d.customer_name}</TableCell>
                        <TableCell className="font-mono">{qty}</TableCell>
                        <TableCell>{driver}</TableCell>
                        <TableCell><StatusBadge status={d.status} /></TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}
    </AppShell>
  );
}

function KpiCard({ title, value, icon: Icon, color }: { title: string; value: number; icon: any; color: string }) {
  return (
    <Card className="rounded-2xl p-5 shadow-sm border-border/70 bg-card">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{title}</p>
          <h4 className="text-2xl font-black mt-1 text-foreground">{value ?? 0}</h4>
        </div>
        <div className={`grid size-11 place-items-center rounded-2xl ${color}`}>
          <Icon className="size-5" />
        </div>
      </div>
    </Card>
  );
}
