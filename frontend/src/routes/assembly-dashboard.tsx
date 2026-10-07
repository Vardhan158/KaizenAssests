import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Boxes,
  CheckCircle2,
  CirclePause,
  ClipboardList,
  Factory,
  Gauge,
  GitFork,
  Loader2,
  PackageCheck,
  PackageSearch,
  Play,
  RefreshCw,
  ShieldCheck,
  TimerReset,
  Trash2,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";

import { AppShell } from "@/components/wms/app-shell";
import { SectionCard, StatCard } from "@/components/wms/primitives";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api-client";
import { requireRole } from "@/lib/auth-utils";

export const Route = createFileRoute("/assembly-dashboard")({
  beforeLoad: () => requireRole(["ASSEMBLY_MANAGER", "ASSEMBLY", "ADMIN", "SUPERUSER"]),
  head: () => ({ meta: [{ title: "Assembly Dashboard · KaizenX" }] }),
  component: AssemblyDashboard,
});

const COLORS = ["#f59e0b", "#2563eb", "#8b5cf6", "#ef4444", "#14b8a6", "#22c55e"];
const statusTone: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  RELEASED: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
  MATERIAL_CHECK: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  READY: "bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300",
  IN_PROGRESS: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  CLOSED: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  ON_HOLD: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  MATERIAL_SHORTAGE: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  QUALITY_CHECK: "bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300",
  COMPLETED: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
};

function AssemblyDashboard() {
  const [data, setData] = useState<any>();
  const [reports, setReports] = useState<any>();
  const [requisitions, setRequisitions] = useState<any[]>([]);
  const [finishedGoods, setFinishedGoods] = useState<any[]>([]);
  const [materialIssues, setMaterialIssues] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>();

  const load = useCallback(async () => {
    try {
      const [dashboard, reportData, reqs, fgList, issuesData] = await Promise.all([
        api.getAssemblyDashboard().catch(() => null),
        api.getAssemblyReports().catch(() => null),
        api.getAssemblyRequisitions("Assembly").catch(() => []),
        api.getFinishedGoods().catch(() => []),
        api.getAssemblyModuleOverview("material-issues").catch(() => null),
      ]);
      setData(dashboard);
      setReports(reportData);
      setRequisitions(reqs || []);
      setFinishedGoods(fgList || []);
      setMaterialIssues(issuesData?.rows || []);
    } catch (error) {
      toast.error("Unable to load assembly dashboard", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function changeStatus(id: string, status: string) {
    setBusy(id);
    try {
      await api.updateAssemblyOrder(id, { status });
      toast.success(`Assembly order moved to ${status.replaceAll("_", " ").toLowerCase()}`);
      await load();
    } catch (error) {
      toast.error("Unable to update assembly order", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setBusy(undefined);
    }
  }

  const stats = data?.stats ?? {};
  const statusChart = data?.status_chart ?? [];
  const outputChart = data?.output_chart ?? [];
  const consumptionChart = data?.consumption_chart ?? [];
  const quality = data?.quality ?? { defect_rate: 0, completed: 0, rejected: 0 };
  const orders = data?.orders ?? [];

  const pendingReqCount = requisitions.filter(
    (r) => r.status === "PENDING" || r.status === "SUBMITTED" || r.status === "STORE_ASSIGNED",
  ).length;

  const awaitingPickupCount = requisitions.filter(
    (r) =>
      r.status === "STORE_ASSIGNED" ||
      r.status === "PICKING" ||
      r.status === "PICKED" ||
      r.status === "PARTIALLY_PICKED",
  ).length;

  const cards = [
    {
      label: "Pending Assembly Orders",
      value: String(stats.pending ?? 0),
      delta: "Awaiting start",
      icon: TimerReset,
      tone: "warning" as const,
      to: "/assembly-orders",
    },
    {
      label: "Material Requests",
      value: String(requisitions.length || 0),
      delta: `${pendingReqCount} pending store review`,
      icon: ClipboardList,
      tone: "primary" as const,
      to: "/assembly/requests",
    },
    {
      label: "Materials Awaiting Pickup",
      value: String(awaitingPickupCount || materialIssues.length || 0),
      delta: "Warehouse handoff & issues",
      icon: PackageCheck,
      tone: "amber" as const,
      to: "/assembly-material-issues",
    },
    {
      label: "Active Production",
      value: String(stats.in_progress ?? 0),
      delta: "Active on assembly floor",
      icon: Play,
      tone: "primary" as const,
      to: "/assembly-progress",
    },
    {
      label: "Completed Production",
      value: String(stats.completed ?? 0),
      delta: "Finished work orders",
      icon: CheckCircle2,
      tone: "success" as const,
      to: "/assembly-progress",
    },
    {
      label: "Finished Goods",
      value: String(finishedGoods.length || 0),
      delta: "Transferred to FG Store",
      icon: Boxes,
      tone: "purple" as const,
      to: "/assembly-finished-goods",
    },
    {
      label: "FG Putaway Pending",
      value: String(stats.putaway_pending ?? 0),
      delta: `${stats.putaway_completed ?? 0} orders fully put away`,
      icon: PackageCheck,
      tone: "amber" as const,
      to: "/assembly-finished-goods",
    },
    {
      label: "Genealogies & Serials",
      value: String(finishedGoods.filter((f) => f.serial_number || f.qr_code).length || finishedGoods.length || 0),
      delta: "End-to-end component traceability",
      icon: GitFork,
      tone: "indigo" as const,
      to: "/assembly-genealogy",
    },
    {
      label: "Today's Output",
      value: String(stats.today_output ?? 0),
      delta: "Completed units today",
      icon: Gauge,
      tone: "success" as const,
      to: "/assembly-orders",
    },
  ];

  return (
    <AppShell
      title="Assembly Dashboard"
      subtitle="Live assembly work orders, production output, component requisitions, and finished good traceability"
      actions={
        <Button variant="outline" className="rounded-xl text-xs" onClick={() => void load()}>
          <RefreshCw className="size-4 mr-1.5" /> Refresh
        </Button>
      }
    >
      {loading ? (
        <div className="grid h-72 place-items-center">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : (
        <>
          {/* Main 8 Stat Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {cards.map((c) => (
              <StatCard
                key={c.label}
                label={c.label}
                value={c.value}
                delta={c.delta}
                icon={c.icon}
                tone={c.tone as any}
                to={c.to}
              />
            ))}
          </div>

          {/* Assembly Notifications */}
          <SectionCard
            title="Assembly notifications"
            description="Shortages, delays, quality, rework, and inventory events"
            icon={Bell}
            className="mt-4"
          >
            {data?.notifications?.length ? (
              <div className="grid gap-2 lg:grid-cols-2">
                {data.notifications.map((notice: any) => (
                  <a
                    key={notice.id}
                    href={notice.link || "/assembly-dashboard"}
                    className={`rounded-xl border p-3 transition-colors hover:bg-muted/50 ${
                      notice.is_read ? "bg-background" : "border-primary/30 bg-primary/5"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <Bell className="mt-0.5 size-4 shrink-0 text-primary" />
                      <div>
                        <p className="text-sm font-bold">{notice.title}</p>
                        <p className="text-xs text-muted-foreground">{notice.message}</p>
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          {new Date(notice.created_at).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No assembly notifications.
              </div>
            )}
          </SectionCard>

          {/* Assembly material pickup requests */}
          <SectionCard
            title="Material pickup requests"
            description="Track warehouse-to-store handoff for your assembly requisitions"
            icon={PackageCheck}
            className="mt-4"
          >
            {requisitions.length ? (
              <div className="grid gap-3 lg:grid-cols-2">
                {requisitions.slice(0, 6).map((req: any) => {
                  const status = String(req.status || "PENDING").toUpperCase();
                  const isPickupState = [
                    "STORE_ASSIGNED",
                    "PICKING",
                    "PICKED",
                    "PARTIALLY_PICKED",
                  ].includes(status);
                  return (
                    <div key={req.id} className="rounded-xl border bg-background p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-mono text-sm font-bold text-primary">
                            {req.requisitionNumber || req.requisition_number || req.request_number}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {(req.items || []).length} material item(s)
                            {req.assignedStoreName || req.assigned_store_name
                              ? ` · ${req.assignedStoreName || req.assigned_store_name}`
                              : " · Store not assigned"}
                          </p>
                        </div>
                        <Badge className={isPickupState ? "bg-purple-500/15 text-purple-700 dark:text-purple-300" : "bg-muted text-muted-foreground"}>
                          {status.replaceAll("_", " ")}
                        </Badge>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3 border-t pt-3">
                        <span className="text-xs text-muted-foreground">
                          {isPickupState ? "Pickup task is active" : "Awaiting warehouse assignment"}
                        </span>
                        <Button size="sm" variant="outline" className="rounded-xl text-xs" asChild>
                          <Link to="/assembly/requests">View request</Link>
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No assembly material pickup requests.
              </div>
            )}
          </SectionCard>

          {/* Operational Reports & Summaries */}
          {reports && (
            <SectionCard
              title="Assembly Operational Summary"
              description={`Report generated ${new Date(reports.generated_at).toLocaleString()}`}
              icon={BarChart3}
              className="mt-4"
            >
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <ReportMetric
                  label="Total orders"
                  value={reports.production?.total_orders ?? 0}
                  detail={`${reports.production?.completed_orders ?? 0} completed · ${reports.production?.pending_orders ?? 0} pending`}
                />
                <ReportMetric
                  label="Delayed orders"
                  value={reports.production?.delayed_orders ?? 0}
                  detail="Past required date"
                  danger={(reports.production?.delayed_orders ?? 0) > 0}
                />
                <ReportMetric
                  label="Consumption variance"
                  value={reports.consumption?.variance ?? 0}
                  detail={`${reports.consumption?.planned ?? 0} planned · ${reports.consumption?.actual ?? 0} actual`}
                  danger={(reports.consumption?.variance ?? 0) > 0}
                />
                <ReportMetric
                  label="Wastage"
                  value={`${reports.wastage?.wastage_percentage ?? 0}%`}
                  detail={`${reports.wastage?.scrap_quantity ?? 0} scrap quantity`}
                  danger={(reports.wastage?.scrap_quantity ?? 0) > 0}
                />
                <ReportMetric
                  label="Quality passed"
                  value={reports.quality?.passed ?? 0}
                  detail={`${reports.quality?.failed ?? 0} failed · ${reports.quality?.rework ?? 0} rework`}
                />
                <ReportMetric
                  label="Rejection rate"
                  value={`${reports.quality?.rejection_rate ?? 0}%`}
                  detail="Failed / inspected"
                  danger={(reports.quality?.rejection_rate ?? 0) > 0}
                />
              </div>

              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                <ReportTable
                  title="Material consumption"
                  icon={PackageSearch}
                  headers={["Material", "Planned", "Actual", "Variance"]}
                  rows={(reports.consumption?.lines || [])
                    .slice(0, 8)
                    .map((row: any) => [row.material_code, row.planned, row.actual, row.variance])}
                />
                <ReportTable
                  title="Wastage report"
                  icon={Trash2}
                  headers={["Material", "Scrap", "Wastage %"]}
                  rows={(reports.wastage?.lines || [])
                    .slice(0, 8)
                    .map((row: any) => [row.material_code, row.scrap_quantity, `${row.wastage_percent}%`])}
                />
              </div>
            </SectionCard>
          )}

          {/* Charts Row */}
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <SectionCard
              title="Assembly orders by status"
              description="Current work-order distribution"
              icon={Factory}
            >
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statusChart}
                      dataKey="count"
                      nameKey="status"
                      innerRadius={58}
                      outerRadius={88}
                      paddingAngle={3}
                    >
                      {statusChart.map((_: any, index: number) => (
                        <Cell key={index} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap justify-center gap-3 text-xs text-muted-foreground">
                {statusChart.map((entry: any, index: number) => (
                  <span key={entry.status} className="flex items-center gap-1.5">
                    <i className="size-2 rounded-full" style={{ background: COLORS[index % COLORS.length] }} />
                    {entry.status}: {entry.count}
                  </span>
                ))}
              </div>
            </SectionCard>

            <SectionCard
              title="Daily assembly output"
              description="Completed and rejected quantity · Last 7 days"
              icon={Gauge}
            >
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={outputChart} margin={{ left: -22, right: 8, top: 8 }}>
                    <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="var(--color-border)" />
                    <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={11} />
                    <YAxis tickLine={false} axisLine={false} fontSize={11} />
                    <Tooltip />
                    <Area
                      type="monotone"
                      dataKey="completed"
                      stroke="#2563eb"
                      fill="#2563eb"
                      fillOpacity={0.18}
                      strokeWidth={2}
                    />
                    <Area
                      type="monotone"
                      dataKey="rejected"
                      stroke="#ef4444"
                      fill="#ef4444"
                      fillOpacity={0.12}
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </SectionCard>

            <SectionCard
              title="Material consumption"
              description="Materials issued against assembly orders"
              icon={PackageSearch}
            >
              <div className="h-[280px]">
                {consumptionChart.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={consumptionChart} layout="vertical" margin={{ left: 24, right: 16 }}>
                      <CartesianGrid strokeDasharray="4 4" horizontal={false} stroke="var(--color-border)" />
                      <XAxis type="number" tickLine={false} axisLine={false} fontSize={11} />
                      <YAxis
                        dataKey="material"
                        type="category"
                        tickLine={false}
                        axisLine={false}
                        width={105}
                        fontSize={11}
                      />
                      <Tooltip />
                      <Bar dataKey="quantity" fill="#2563eb" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="grid h-full place-items-center text-sm text-muted-foreground">
                    No material issued yet.
                  </div>
                )}
              </div>
            </SectionCard>

            <SectionCard
              title="Rejection and defect rate"
              description="Final assembly quality performance"
              icon={ShieldCheck}
            >
              <div className="grid h-[280px] place-items-center">
                <div className="text-center">
                  <div className="mx-auto grid size-36 place-items-center rounded-full border-[14px] border-primary-soft">
                    <div>
                      <p className="text-4xl font-bold text-primary">{quality.defect_rate}%</p>
                      <p className="text-xs text-muted-foreground">Defect rate</p>
                    </div>
                  </div>
                  <div className="mt-6 flex gap-8 text-sm">
                    <span>
                      <b>{quality.completed}</b> completed
                    </span>
                    <span className="text-destructive">
                      <b>{quality.rejected}</b> rejected
                    </span>
                  </div>
                </div>
              </div>
            </SectionCard>
          </div>

          {/* Assembly Orders List */}
          <SectionCard
            title="Assembly orders"
            description="Orders are created automatically when warehouse material is issued"
            icon={ClipboardList}
            className="mt-4"
          >
            {orders.length === 0 ? (
              <div className="grid h-44 place-items-center text-center text-muted-foreground">
                <div>
                  <Factory className="mx-auto mb-2 size-8 opacity-40" />
                  <p>No assembly orders yet.</p>
                  <p className="text-xs">Issue a completed warehouse pick task to create the first order.</p>
                </div>
              </div>
            ) : (
              <div className="grid gap-3 xl:grid-cols-2">
                {orders.map((order: any) => (
                  <Card key={order.id} className="gap-3 rounded-xl p-4 shadow-none">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-mono text-sm font-bold text-primary">{order.order_number}</p>
                        <p className="text-sm font-semibold">{order.product_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {order.request_number} · {order.department}
                        </p>
                      </div>
                      <Badge className={statusTone[order.status] || "bg-slate-100 text-slate-700"}>
                        {order.status.replaceAll("_", " ")}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      {order.items.map((item: any) => (
                        <span key={item.material_code} className="rounded-lg bg-muted px-2 py-1">
                          {item.material_name || item.material_code}: {item.quantity} {item.uom}
                        </span>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-2 border-t pt-3">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => (window.location.href = `/assembly-orders?q=${order.order_number}`)}
                      >
                        <ClipboardList className="size-3.5 mr-1" /> Requirements
                      </Button>
                      {order.status === "READY" && (
                        <Button
                          size="sm"
                          disabled={busy === order.id}
                          onClick={() => void changeStatus(order.id, "IN_PROGRESS")}
                        >
                          <Play className="size-3.5 mr-1" /> Start assembly
                        </Button>
                      )}
                      {order.status === "IN_PROGRESS" && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy === order.id}
                            onClick={() => void changeStatus(order.id, "ON_HOLD")}
                          >
                            <CirclePause className="size-3.5 mr-1" /> Hold
                          </Button>
                          <Button
                            size="sm"
                            disabled={busy === order.id}
                            onClick={() => void changeStatus(order.id, "COMPLETED")}
                          >
                            <CheckCircle2 className="size-3.5 mr-1" /> Complete
                          </Button>
                        </>
                      )}
                      {order.status === "ON_HOLD" && (
                        <Button
                          size="sm"
                          disabled={busy === order.id}
                          onClick={() => void changeStatus(order.id, "IN_PROGRESS")}
                        >
                          <Play className="size-3.5 mr-1" /> Resume
                        </Button>
                      )}
                      {order.status === "COMPLETED" && (
                        <Button
                          size="sm"
                          disabled={busy === order.id}
                          onClick={() => void changeStatus(order.id, "QUALITY_CHECK")}
                        >
                          <ShieldCheck className="size-3.5 mr-1" /> Send to quality
                        </Button>
                      )}
                      {order.status === "QUALITY_CHECK" && (
                        <Button
                          size="sm"
                          disabled={busy === order.id}
                          onClick={() => void changeStatus(order.id, "CLOSED")}
                        >
                          <CheckCircle2 className="size-3.5 mr-1" /> Close order
                        </Button>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </SectionCard>
        </>
      )}
    </AppShell>
  );
}

function ReportMetric({
  label,
  value,
  detail,
  danger = false,
}: {
  label: string;
  value: any;
  detail: string;
  danger?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        danger ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300" : "bg-muted/20"
      }`}
    >
      <p className="text-xs font-bold uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-black">{value}</p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function ReportTable({
  title,
  icon: Icon,
  headers,
  rows,
}: {
  title: string;
  icon: any;
  headers: string[];
  rows: any[][];
}) {
  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="flex items-center gap-2 bg-muted/40 px-3 py-3 text-sm font-bold">
        <Icon className="size-4 text-primary" />
        {title}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr>
              {headers.map((header) => (
                <th
                  key={header}
                  className="border-t px-3 py-2 text-[10px] uppercase text-muted-foreground"
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row, index) => (
                <tr key={index} className="border-t">
                  {row.map((value, cell) => (
                    <td key={cell} className="px-3 py-2 tabular-nums">
                      {value}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={headers.length} className="border-t px-3 py-6 text-center text-muted-foreground">
                  No data recorded.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
