import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/wms/app-shell";
import { requireRole } from "@/lib/auth-utils";
import {
  api,
  type AssemblyDashboardResponse,
  type AssemblyOrder,
  type AssemblyAttentionItem,
  type AssemblyActivityItem,
} from "@/lib/api-client";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  Clock,
  Factory,
  Layers,
  PlusCircle,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/assembly-dashboard")({
  beforeLoad: () => requireRole(["ASSEMBLY_MANAGER", "ASSEMBLY", "ADMIN", "SUPERUSER"]),
  head: () => ({ meta: [{ title: "Assembly Dashboard · KaizenX" }] }),
  component: AssemblyDashboard,
});

function getStatusBadge(status: string) {
  const s = (status || "").toUpperCase();
  if (s === "COMPLETED" || s === "READY_FOR_DISPATCH" || s === "PACKED") {
    return <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300">{status}</Badge>;
  }
  if (s === "IN_PRODUCTION" || s === "IN-PROGRESS") {
    return <Badge className="bg-blue-500/15 text-blue-700 border-blue-500/30 dark:text-blue-300">{status}</Badge>;
  }
  if (s === "QC_PENDING") {
    return <Badge className="bg-purple-500/15 text-purple-700 border-purple-500/30 dark:text-purple-300">{status}</Badge>;
  }
  if (s === "MATERIAL_PENDING" || s === "PLANNED") {
    return <Badge className="bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300">{status}</Badge>;
  }
  if (s === "REWORK" || s === "QC_FAILED") {
    return <Badge className="bg-rose-500/15 text-rose-700 border-rose-500/30 dark:text-rose-300">{status}</Badge>;
  }
  return <Badge variant="outline">{status || "UNKNOWN"}</Badge>;
}

function AssemblyDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState<AssemblyDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadDashboard = async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const res = await api.getAssemblyDashboard();
      setData(res);
    } catch (err: any) {
      toast.error(err?.message || "Failed to load assembly dashboard.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  const kpis = data?.kpis || {
    open_orders: 0,
    material_pending: 0,
    in_production: 0,
    qc_pending: 0,
    completed_today: 0,
  };

  return (
    <AppShell
      title="Assembly Dashboard"
      subtitle="Operational monitoring, production tracking & quality status"
    >
      <div className="space-y-6">
        {/* Top Actions Bar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-2">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Production Operations</h1>
            <p className="text-sm text-muted-foreground">Real-time status of orders, raw material staging, and quality checks.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadDashboard(true)}
              disabled={refreshing}
              className="gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              size="sm"
              onClick={() => navigate({ to: "/assembly/material-requests" as any })}
              className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <PlusCircle className="h-4 w-4" />
              New Material Request
            </Button>
          </div>
        </div>

        {/* 5 Top KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-semibold uppercase tracking-wider">Open Orders</span>
              <Layers className="h-4 w-4 text-primary" />
            </div>
            <div className="mt-3 text-2xl font-bold text-foreground">
              {loading ? "..." : kpis.open_orders}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Active in pipeline</p>
          </div>

          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-semibold uppercase tracking-wider">Material Pending</span>
              <Boxes className="h-4 w-4 text-amber-500" />
            </div>
            <div className="mt-3 text-2xl font-bold text-foreground">
              {loading ? "..." : kpis.material_pending}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Awaiting warehouse issue</p>
          </div>

          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-semibold uppercase tracking-wider">In Production</span>
              <Factory className="h-4 w-4 text-blue-500" />
            </div>
            <div className="mt-3 text-2xl font-bold text-foreground">
              {loading ? "..." : kpis.in_production}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">On active assembly lines</p>
          </div>

          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-semibold uppercase tracking-wider">QC Pending</span>
              <ShieldCheck className="h-4 w-4 text-purple-500" />
            </div>
            <div className="mt-3 text-2xl font-bold text-foreground">
              {loading ? "..." : kpis.qc_pending}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Waiting inspection</p>
          </div>

          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-semibold uppercase tracking-wider">Completed Today</span>
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            </div>
            <div className="mt-3 text-2xl font-bold text-foreground">
              {loading ? "..." : kpis.completed_today}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Manufactured today</p>
          </div>
        </div>

        {/* Main Grid: Active Orders & Sidebar Alerts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Active Orders Table (2 Cols) */}
          <div className="lg:col-span-2 space-y-4">
            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-center justify-between pb-4 border-b border-border/60">
                <div>
                  <h2 className="text-base font-semibold text-foreground">Active Orders</h2>
                  <p className="text-xs text-muted-foreground">Manufacturing runs currently underway in assembly</p>
                </div>
                <Link
                  to="/assembly/production"
                  className="text-xs font-medium text-primary hover:underline flex items-center gap-1"
                >
                  View All Orders <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>

              {loading ? (
                <div className="py-12 text-center text-sm text-muted-foreground">Loading active orders from database...</div>
              ) : !data?.active_orders || data.active_orders.length === 0 ? (
                <div className="py-12 text-center">
                  <p className="text-sm font-medium text-foreground">No Assembly Orders yet.</p>
                  <p className="text-xs text-muted-foreground mt-1">Create an order to initiate the production workflow.</p>
                  <Button
                    size="sm"
                    className="mt-4 gap-2"
                    onClick={() => navigate({ to: "/assembly/material-requests" as any })}
                  >
                    <PlusCircle className="h-4 w-4" />
                    Create First Order
                  </Button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm mt-2">
                    <thead>
                      <tr className="border-b border-border/60 text-xs font-medium text-muted-foreground">
                        <th className="py-2.5 px-3">Order No.</th>
                        <th className="py-2.5 px-3">Product</th>
                        <th className="py-2.5 px-3">Target Qty</th>
                        <th className="py-2.5 px-3">Progress</th>
                        <th className="py-2.5 px-3">Required Date</th>
                        <th className="py-2.5 px-3">Status</th>
                        <th className="py-2.5 px-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {data.active_orders.map((ord: AssemblyOrder) => (
                        <tr key={ord.id} className="hover:bg-muted/40 transition-colors">
                          <td className="py-3 px-3 font-semibold text-foreground">
                            {ord.order_number}
                          </td>
                          <td className="py-3 px-3">
                            <div className="font-medium text-foreground">{ord.product_name}</div>
                            {ord.product_code && (
                              <div className="text-xs text-muted-foreground">{ord.product_code}</div>
                            )}
                          </td>
                          <td className="py-3 px-3 font-medium text-foreground whitespace-nowrap">
                            {ord.target_quantity} {ord.uom}
                          </td>
                          <td className="py-3 px-3 min-w-[120px]">
                            <div className="flex items-center gap-2">
                              <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                                <div
                                  className="bg-primary h-2 rounded-full transition-all duration-300"
                                  style={{ width: `${Math.min(100, Math.max(0, ord.progress))}%` }}
                                />
                              </div>
                              <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
                                {ord.progress}%
                              </span>
                            </div>
                          </td>
                          <td className="py-3 px-3 text-xs text-muted-foreground whitespace-nowrap">
                            {ord.required_date ? new Date(ord.required_date).toLocaleDateString() : "—"}
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            {getStatusBadge(ord.status)}
                          </td>
                          <td className="py-3 px-3 text-right whitespace-nowrap">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 text-xs font-medium text-primary hover:text-primary"
                              onClick={() => navigate({ to: "/assembly/production" as any })}
                            >
                              Details
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Needs Attention & Recent Activity */}
          <div className="space-y-6">
            {/* Needs Attention Card */}
            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-center justify-between pb-3 border-b border-border/60">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-amber-500" />
                  <h2 className="text-base font-semibold text-foreground">Needs Attention</h2>
                </div>
                {data?.needs_attention && data.needs_attention.length > 0 && (
                  <Badge variant="outline" className="text-xs border-amber-500/40 text-amber-600 dark:text-amber-400">
                    {data.needs_attention.length} Alert{data.needs_attention.length > 1 ? "s" : ""}
                  </Badge>
                )}
              </div>

              <div className="mt-4 space-y-3">
                {loading ? (
                  <div className="py-6 text-center text-xs text-muted-foreground">Checking conditions...</div>
                ) : !data?.needs_attention || data.needs_attention.length === 0 ? (
                  <div className="py-6 text-center">
                    <CheckCircle2 className="h-8 w-8 text-emerald-500/80 mx-auto mb-2" />
                    <p className="text-xs font-medium text-foreground">All Clear</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">No material shortages or critical blocks detected.</p>
                  </div>
                ) : (
                  data.needs_attention.map((item: AssemblyAttentionItem) => (
                    <div
                      key={item.id}
                      className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3.5 space-y-2 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-foreground">{item.order_number}</span>
                        <Badge
                          variant="outline"
                          className={
                            item.severity === "CRITICAL"
                              ? "bg-rose-500/10 text-rose-600 border-rose-500/30 text-[10px]"
                              : "bg-amber-500/10 text-amber-600 border-amber-500/30 text-[10px]"
                          }
                        >
                          {item.type}
                        </Badge>
                      </div>

                      {item.item_name && (
                        <div className="font-medium text-foreground">{item.item_name}</div>
                      )}

                      {item.required !== undefined && item.available !== undefined && item.shortage !== undefined ? (
                        <div className="grid grid-cols-3 gap-1 pt-1 text-[11px] text-muted-foreground border-t border-border/40">
                          <div>Req: <span className="font-semibold text-foreground">{item.required} {item.uom}</span></div>
                          <div>Avail: <span className="font-semibold text-foreground">{item.available} {item.uom}</span></div>
                          <div className="text-rose-600 dark:text-rose-400 font-semibold">
                            Short: {item.shortage} {item.uom}
                          </div>
                        </div>
                      ) : (
                        <p className="text-[11px] text-muted-foreground">{item.message}</p>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Recent Activity Feed */}
            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-center justify-between pb-3 border-b border-border/60">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-primary" />
                  <h2 className="text-base font-semibold text-foreground">Recent Activity</h2>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {loading ? (
                  <div className="py-6 text-center text-xs text-muted-foreground">Loading activity log...</div>
                ) : !data?.recent_activity || data.recent_activity.length === 0 ? (
                  <div className="py-6 text-center text-xs text-muted-foreground">
                    No recent activity recorded yet.
                  </div>
                ) : (
                  data.recent_activity.map((act: AssemblyActivityItem) => (
                    <div key={act.id} className="flex items-start gap-2.5 pb-2.5 border-b border-border/30 last:border-b-0 text-xs">
                      <div className="h-2 w-2 rounded-full bg-primary mt-1.5 shrink-0" />
                      <div className="flex-1 space-y-0.5">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-foreground">{act.action}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(act.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground">{act.description}</p>
                        <div className="text-[10px] text-muted-foreground/80">By {act.user}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
