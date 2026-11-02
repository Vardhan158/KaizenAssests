import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AssemblyWorkflowHelp } from "@/components/wms/assembly-toolbox";
import { AppShell } from "@/components/wms/app-shell";
import { requireRole } from "@/lib/auth-utils";
import {
  api,
  type AssemblyDashboardResponse,
  type AssemblyOrder,
  type AssemblyAttentionItem,
  type AssemblyActivityItem,
  type AssemblyMaterialRequest,
} from "@/lib/api-client";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  Calendar,
  CheckCircle2,
  Clock,
  Factory,
  Layers,
  PackageCheck,
  Plus,
  PlusCircle,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
import { StatCard } from "@/components/wms/primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/assembly-dashboard")({
  beforeLoad: () => requireRole(["ASSEMBLY_MANAGER", "ASSEMBLY", "ADMIN", "SUPERUSER"]),
  head: () => ({ meta: [{ title: "Assembly Dashboard · KaizenAssests" }] }),
  component: AssemblyDashboard,
});

function formatStatus(status: string) {
  const map: Record<string, string> = {
    REJECTED: "Request Rejected",
    MATERIAL_PENDING: "Material Pending",
    MATERIAL_ISSUED: "Awaiting Receipt",
    MATERIAL_READY: "Ready for Production",
    IN_PRODUCTION: "In Production",
    QC_PENDING: "QC Pending",
    COMPLETED: "Completed",
    PLANNED: "Planned",
    REWORK: "Rework Required",
    REWORK_REQUIRED: "Rework Required",
    QC_FAILED: "QC Failed",
    READY_FOR_DISPATCH: "Ready for Dispatch",
  };
  return map[status.toUpperCase()] || status.replace(/_/g, " ");
}

function getStatusBadge(status: string) {
  const s = (status || "").toUpperCase();
  const label = formatStatus(status);

  if (s === "COMPLETED" || s === "READY_FOR_DISPATCH" || s === "PACKED") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25">
        <span className="size-1.5 rounded-full bg-emerald-500" />
        {label}
      </span>
    );
  }
  if (s === "IN_PRODUCTION" || s === "IN-PROGRESS") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-700 dark:text-blue-300 border border-blue-500/25">
        <span className="size-1.5 rounded-full bg-blue-500 animate-pulse" />
        {label}
      </span>
    );
  }
  if (s === "QC_PENDING") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-500/10 text-purple-700 dark:text-purple-300 border border-purple-500/25">
        <span className="size-1.5 rounded-full bg-purple-500" />
        {label}
      </span>
    );
  }
  if (s === "MATERIAL_PENDING" || s === "PLANNED") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/25">
        <span className="size-1.5 rounded-full bg-amber-500" />
        {label}
      </span>
    );
  }
  if (s === "REJECTED" || s === "REWORK" || s === "REWORK_REQUIRED" || s === "QC_FAILED") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/25">
        <span className="size-1.5 rounded-full bg-rose-500" />
        {label}
      </span>
    );
  }
  return (
    <Badge variant="outline" className="text-xs font-medium">
      {label}
    </Badge>
  );
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return dateStr;
  }
}

function formatRelativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

function AssemblyDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState<AssemblyDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [productionPage, setProductionPage] = useState(1);
  const [showMoreActivity, setShowMoreActivity] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [alertsOnlyShortages, setAlertsOnlyShortages] = useState(false);

  const [materialRequestCount, setMaterialRequestCount] = useState<number | null>(null);
  const [fgAvailable, setFgAvailable] = useState<number | null>(null);
  const [materialRequests, setMaterialRequests] = useState<AssemblyMaterialRequest[]>([]);
  const [fgChart, setFgChart] = useState<{ label: string; value: number }[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadDashboard = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    const [dashboard, requests, inventory] = await Promise.allSettled([
      api.getAssemblyDashboard(),
      api.getAssemblyMaterialRequests(),
      api.getAssemblyFinishedGoodsInventorySummary(),
    ]);
    const failed: string[] = [];
    if (dashboard.status === "fulfilled") {
      setData(dashboard.value);
    } else failed.push("production status, activity and attention items");
    if (requests.status === "fulfilled") {
      setMaterialRequestCount(requests.value.length);
      setMaterialRequests(requests.value);
    }
    else {
      setMaterialRequestCount(null);
      failed.push("material request count");
    }
    if (inventory.status === "fulfilled") {
      setFgAvailable(inventory.value.available);
      setFgChart([
        { label: "Available", value: inventory.value.available },
        { label: "Reserved", value: inventory.value.reserved },
        { label: "Packed", value: inventory.value.packed },
        { label: "Dispatched", value: inventory.value.dispatched },
      ]);
    }
    else {
      setFgAvailable(null);
      failed.push("finished goods availability");
    }
    const message = failed.length ? `Unable to refresh ${failed.join("; ")}. Please retry.` : null;
    setLoadError(message);
    if (message) toast.error(message);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);
  const kpis = data?.kpis;
  const kpiCharts = useMemo(() => {
    const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date();
      date.setDate(date.getDate() - 6 + index);
      return { key: dayKey(date), label: date.toLocaleDateString(undefined, { month: "short", day: "numeric" }) };
    });
    const countByDay = (dates: (string | null)[]) => days.map(day => ({
      label: day.label,
      value: dates.filter(value => value && dayKey(new Date(value)) === day.key).length,
    }));
    const orders = data?.active_orders || [];
    return {
      requests: countByDay(materialRequests.map(request => request.created_at)),
      production: countByDay(orders.filter(order => ["IN_PRODUCTION", "IN-PROGRESS", "RUNNING"].includes(order.status.toUpperCase())).map(order => order.started_at || order.created_at)),
      quality: countByDay(orders.filter(order => order.status.toUpperCase() === "QC_PENDING").map(order => order.updated_at || order.created_at)),
    };
  }, [data, materialRequests]);
  const metricValue = (value: number | null | undefined) =>
    loading ? "..." : value == null ? "Unavailable" : value.toLocaleString();

  const filteredOrders = useMemo(() => {
    if (!data?.active_orders) return [];
    return data.active_orders.filter((ord) => {
      // Status filter
      const status = ord.status.toUpperCase();
      const statusGroups: Record<string, string[]> = {
        MATERIAL_PENDING: ["PLANNED", "MATERIAL_PENDING", "MATERIAL_REQUESTED"],
        IN_PRODUCTION: ["IN_PRODUCTION", "IN-PROGRESS", "RUNNING"],
      };
      if (
        statusFilter !== "ALL" &&
        !(statusGroups[statusFilter] || [statusFilter]).includes(status)
      ) {
        return false;
      }
      // Text search
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesNumber = ord.order_number?.toLowerCase().includes(query);
        const matchesProduct = ord.product_name?.toLowerCase().includes(query);
        const matchesCode = ord.product_code?.toLowerCase().includes(query);
        const matchesLine = ord.assembly_line?.toLowerCase().includes(query);
        return matchesNumber || matchesProduct || matchesCode || matchesLine;
      }
      return true;
    });
  }, [data?.active_orders, statusFilter, searchQuery]);

  const productionPages = Math.max(1, Math.ceil(filteredOrders.length / 3));
  const currentProductionPage = Math.min(productionPage, productionPages);
  const productionStart = (currentProductionPage - 1) * 3;
  const pagedOrders = filteredOrders.slice(productionStart, productionStart + 3);
  useEffect(() => {
    setProductionPage(1);
  }, [searchQuery, statusFilter]);

  const filteredAlerts = useMemo(() => {
    if (!data?.needs_attention) return [];
    if (!alertsOnlyShortages) return data.needs_attention;
    return data.needs_attention.filter((item) => item.type.toLowerCase().includes("shortage"));
  }, [data?.needs_attention, alertsOnlyShortages]);

  return (
    <AppShell
      title="Assembly Dashboard"
      subtitle="Operational monitoring, production tracking & quality status"
      actions={
        <div className="flex flex-wrap items-center gap-2.5">
          <AssemblyWorkflowHelp />
          <Button
            size="sm"
            onClick={() => navigate({ to: "/assembly/material-requests" })}
            className="rounded-xl text-xs gap-1.5 font-semibold shadow-soft"
          >
            <Plus className="size-3.5" />
            New Material Request
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {loadError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-xs text-destructive"
          >
            <AlertTriangle className="size-4 shrink-0" />
            <p>
              {loadError}
              {data
                ? " Production information shows the last successful update."
                : " Production information is unavailable."}
            </p>
          </div>
        )}
        <div
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
          aria-busy={loading || refreshing}
        >
          <StatCard
            label="Material Requests"
            sparkline={kpiCharts.requests}
            value={metricValue(materialRequestCount)}
            delta="Total assembly requisitions"
            icon={Boxes}
            tone="warning"
            to="/assembly/material-requests"
            showArrow
          />
          <StatCard
            label="In Production"
            sparkline={kpiCharts.production}
            value={metricValue(kpis?.in_production)}
            delta="Runs currently on assembly lines"
            icon={Factory}
            tone="primary"
            to="/assembly/production"
            showArrow
          />
          <StatCard
            label="QC Pending"
            sparkline={kpiCharts.quality}
            value={metricValue(kpis?.qc_pending)}
            delta="Runs awaiting quality inspection"
            icon={ShieldCheck}
            tone="teal"
            to="/assembly/quality"
            showArrow
          />
          <StatCard
            label="FG Available"
            sparkline={fgChart}
            value={metricValue(fgAvailable)}
            delta="Available quantity after reservations"
            icon={PackageCheck}
            tone="success"
            to="/assembly/finished-goods"
            showArrow
            infoTooltip="Available quantity reported by Assembly inventory after reservations. Open Finished Goods for product and unit details."
          />
        </div>
        {(loading || data) && (
          <>
            {/* Main Grid: Active Orders & Right Sidebars */}
            <div className="grid grid-cols-1 gap-5">
              {/* Active Work Orders (2 Cols) */}
              <div className="min-w-0 space-y-4">
                <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-soft">
                  {/* Header & Controls */}
                  <div className="space-y-4 pb-4 border-b border-border/60">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                          <Layers className="size-4 text-primary" />
                          Production Status
                        </h2>
                        <p className="text-xs text-muted-foreground">
                          Track material readiness and progress across assembly runs
                        </p>
                      </div>
                      <Link
                        to="/assembly/production"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline self-start sm:self-auto"
                      >
                        View Production <ArrowRight className="size-3.5" />
                      </Link>
                    </div>

                    {/* Search & Filter Toolbar */}
                    <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 pt-1">
                      {/* Status Filter Tabs */}
                      <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-muted/60 border border-border/60">
                        {[
                          { key: "ALL", label: `All (${data?.active_orders?.length || 0})` },
                          {
                            key: "MATERIAL_PENDING",
                            label: `Material Pending (${kpis?.material_pending ?? "-"})`,
                          },
                          {
                            key: "IN_PRODUCTION",
                            label: `In Production (${kpis?.in_production ?? "-"})`,
                          },
                          { key: "COMPLETED", label: `Completed` },
                        ].map((tab) => (
                          <button
                            key={tab.key}
                            aria-pressed={statusFilter === tab.key}
                            onClick={() => setStatusFilter(tab.key)}
                            className={cn(
                              "px-2.5 py-1 text-xs font-semibold rounded-lg transition-all",
                              statusFilter === tab.key
                                ? "bg-card text-foreground shadow-xs border border-border/50"
                                : "text-muted-foreground hover:text-foreground hover:bg-muted",
                            )}
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>

                      {/* Search input */}
                      <div className="relative w-full lg:w-64 lg:shrink-0">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                        <input
                          type="text"
                          aria-label="Search production runs"
                          placeholder="Search order, product..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="h-8 w-full rounded-lg border border-border bg-card pl-8 pr-7 text-xs outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary/40"
                        />
                        {searchQuery && (
                          <button
                            aria-label="Clear production search"
                            onClick={() => setSearchQuery("")}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          >
                            <X className="size-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Table Content */}
                  {loading ? (
                    <div className="py-16 text-center space-y-3">
                      <RefreshCw className="size-6 animate-spin text-primary mx-auto opacity-70" />
                      <p className="text-xs text-muted-foreground">
                        Loading active orders from database...
                      </p>
                    </div>
                  ) : filteredOrders.length === 0 ? (
                    <div className="py-14 text-center">
                      <div className="grid size-12 place-items-center rounded-2xl bg-muted mx-auto mb-3 text-muted-foreground">
                        <Layers className="size-6 opacity-60" />
                      </div>
                      <p className="text-sm font-semibold text-foreground">
                        {searchQuery || statusFilter !== "ALL"
                          ? "No work orders matching filter"
                          : "No active assembly orders yet"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                        {searchQuery || statusFilter !== "ALL"
                          ? "Try clearing your search query or switching to 'All' status filter."
                          : "Create a material request to begin production tracking and material allocation."}
                      </p>
                      <div className="mt-4 flex items-center justify-center gap-2">
                        {searchQuery || statusFilter !== "ALL" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="rounded-xl text-xs gap-1.5"
                            onClick={() => {
                              setSearchQuery("");
                              setStatusFilter("ALL");
                            }}
                          >
                            Reset Filters
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            className="rounded-xl text-xs gap-1.5"
                            onClick={() => navigate({ to: "/assembly/material-requests" })}
                          >
                            <PlusCircle className="size-3.5" />
                            New Material Request
                          </Button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="mt-1 w-full min-w-[720px] table-fixed text-left text-sm">
                        <caption className="sr-only">Assembly production runs</caption>
                        <thead>
                          <tr className="border-b border-border/60 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                            <th scope="col" className="w-[25%] py-3 pr-4">
                              Order / Required date
                            </th>
                            <th scope="col" className="w-[27%] px-3 py-3">
                              Product
                            </th>
                            <th scope="col" className="w-[20%] px-3 py-3">
                              Production progress
                            </th>
                            <th scope="col" className="w-[17%] px-3 py-3">
                              Status
                            </th>
                            <th scope="col" className="w-[11%] py-3 pl-3 text-right">
                              Action
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/40">
                          {pagedOrders.map((ord: AssemblyOrder) => {
                            const progressVal = Math.min(100, Math.max(0, ord.progress || 0));
                            return (
                              <tr
                                key={ord.id}
                                className="align-top transition-colors hover:bg-muted/30"
                              >
                                <td className="py-4 pr-4">
                                  <div className="whitespace-nowrap font-mono text-xs font-semibold">
                                    {ord.order_number}
                                  </div>
                                  <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                                    <Calendar className="size-3 shrink-0" />
                                    {formatDate(ord.required_date)}
                                  </div>
                                  <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                                    <span className="rounded-md bg-muted px-2 py-0.5">
                                      {ord.assembly_line || "Unassigned"}
                                    </span>
                                    {ord.priority && ord.priority !== "NORMAL" && (
                                      <span className="rounded-md bg-rose-500/10 px-2 py-0.5 font-medium text-rose-600">
                                        {ord.priority}
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="px-3 py-4">
                                  <div
                                    className="truncate text-xs font-semibold"
                                    title={ord.product_name}
                                  >
                                    {ord.product_name}
                                  </div>
                                  <div
                                    className="mt-1 truncate font-mono text-[11px] text-muted-foreground"
                                    title={ord.product_code}
                                  >
                                    {ord.product_code}
                                  </div>
                                  {ord.bom_number && (
                                    <div
                                      className="mt-1 truncate font-mono text-[10px] text-muted-foreground"
                                      title={ord.bom_number}
                                    >
                                      {ord.bom_number}
                                    </div>
                                  )}
                                </td>
                                <td className="px-3 py-4">
                                  <div className="flex flex-wrap items-center justify-between gap-1 text-xs">
                                    <span className="font-semibold tabular-nums">
                                      {progressVal}%
                                    </span>
                                    <span className="text-[11px] tabular-nums text-muted-foreground">
                                      {ord.completed_quantity || 0} / {ord.target_quantity}{" "}
                                      {ord.uom}
                                    </span>
                                  </div>
                                  <div
                                    role="progressbar"
                                    aria-label={`Production progress for ${ord.order_number}`}
                                    aria-valuemin={0}
                                    aria-valuemax={100}
                                    aria-valuenow={progressVal}
                                    className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
                                  >
                                    <div
                                      className={cn(
                                        "h-full rounded-full",
                                        progressVal >= 100 ? "bg-emerald-500" : "bg-primary",
                                      )}
                                      style={{ width: `${progressVal}%` }}
                                    />
                                  </div>
                                </td>
                                <td className="px-3 py-4">{getStatusBadge(ord.status)}</td>
                                <td className="py-4 pl-3 text-right">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 rounded-lg px-2.5 text-xs"
                                    aria-label={`View production for ${ord.order_number}`}
                                    onClick={() => navigate({ to: "/assembly/production" })}
                                  >
                                    View
                                    <ArrowRight className="ml-1 size-3" />
                                  </Button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {!loading && filteredOrders.length > 0 && (
                    <nav
                      aria-label="Production Status pagination"
                      className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4 text-xs text-muted-foreground"
                    >
                      <span>
                        Showing {productionStart + 1}-
                        {Math.min(productionStart + 3, filteredOrders.length)} of{" "}
                        {filteredOrders.length} orders
                      </span>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-xl text-xs"
                          disabled={currentProductionPage === 1}
                          onClick={() => setProductionPage(currentProductionPage - 1)}
                        >
                          Previous
                        </Button>
                        <span aria-live="polite">
                          Page {currentProductionPage} of {productionPages}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-xl text-xs"
                          disabled={currentProductionPage === productionPages}
                          onClick={() => setProductionPage(currentProductionPage + 1)}
                        >
                          Next
                        </Button>
                      </div>
                    </nav>
                  )}
                </div>
              </div>

              {/* Attention and activity remain secondary to the production queue. */}
              <div className="grid min-w-0 grid-cols-1 items-start gap-5 lg:grid-cols-2">
                {/* Needs Attention Card */}
                <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-soft">
                  <div className="flex items-center justify-between pb-3 border-b border-border/60">
                    <div className="flex items-center gap-2">
                      <div className="grid size-7 place-items-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
                        <ShieldAlert className="size-4" />
                      </div>
                      <div>
                        <h2 className="text-sm font-bold text-foreground">Needs Attention</h2>
                        <p className="text-[11px] text-muted-foreground">
                          Actionable bottlenecks & shortages
                        </p>
                      </div>
                    </div>
                    {data?.needs_attention && data.needs_attention.length > 0 && (
                      <Badge
                        variant="outline"
                        className="text-xs font-bold border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10"
                      >
                        {data.needs_attention.length} Alert
                        {data.needs_attention.length > 1 ? "s" : ""}
                      </Badge>
                    )}
                  </div>

                  {/* Filter toggle if alerts exist */}
                  {data?.needs_attention && data.needs_attention.length > 0 && (
                    <div className="mt-3 flex items-center justify-between text-xs">
                      <span className="text-muted-foreground font-medium">Production alerts</span>
                      <button
                        aria-pressed={alertsOnlyShortages}
                        onClick={() => setAlertsOnlyShortages(!alertsOnlyShortages)}
                        className={cn(
                          "text-[11px] font-semibold px-2 py-0.5 rounded-md border transition-colors",
                          alertsOnlyShortages
                            ? "bg-rose-500/15 text-rose-600 border-rose-500/30"
                            : "bg-muted text-muted-foreground border-border/60 hover:text-foreground",
                        )}
                      >
                        {alertsOnlyShortages ? "Showing Shortages" : "Show Shortages Only"}
                      </button>
                    </div>
                  )}

                  {/* Alert Items List with Scroll */}
                  <div className="mt-3.5 space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
                    {loading ? (
                      <div className="py-8 text-center text-xs text-muted-foreground">
                        Checking conditions...
                      </div>
                    ) : filteredAlerts.length === 0 ? (
                      <div className="py-8 text-center">
                        <div className="grid size-10 place-items-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 mx-auto mb-2">
                          <CheckCircle2 className="size-5" />
                        </div>
                        <p className="text-xs font-bold text-foreground">
                          {alertsOnlyShortages ? "No shortage alerts" : "No attention items"}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {alertsOnlyShortages
                            ? "No shortages in the latest response. Other alerts may still need attention."
                            : "No alerts in the latest dashboard response."}
                        </p>
                      </div>
                    ) : (
                      filteredAlerts.map((item: AssemblyAttentionItem) => {
                        const isShortage = item.type.toLowerCase().includes("shortage");

                        return (
                          <div
                            key={item.id}
                            className={cn(
                              "rounded-xl border p-3.5 space-y-2 text-xs transition-all",
                              isShortage
                                ? "border-rose-500/30 bg-rose-500/5 hover:border-rose-500/50"
                                : "border-amber-500/30 bg-amber-500/5 hover:border-amber-500/50",
                            )}
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-foreground font-mono text-[11px]">
                                {item.order_number}
                              </span>
                              <span
                                className={cn(
                                  "text-[10px] font-bold px-2 py-0.5 rounded-full border",
                                  isShortage
                                    ? "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30"
                                    : "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
                                )}
                              >
                                {item.type}
                              </span>
                            </div>

                            {item.item_name && (
                              <div className="font-semibold text-foreground text-xs">
                                {item.item_name}
                              </div>
                            )}

                            {item.required !== undefined &&
                            item.available !== undefined &&
                            item.shortage !== undefined ? (
                              <div className="grid grid-cols-3 gap-1 pt-1.5 pb-0.5 text-[11px] border-t border-border/40">
                                <div>
                                  <span className="text-muted-foreground">Req:</span>{" "}
                                  <span className="font-bold text-foreground">
                                    {item.required} {item.uom}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Avail:</span>{" "}
                                  <span className="font-bold text-foreground">
                                    {item.available} {item.uom}
                                  </span>
                                </div>
                                <div className="text-rose-600 dark:text-rose-400 font-bold">
                                  Short: {item.shortage} {item.uom}
                                </div>
                              </div>
                            ) : (
                              <p className="text-[11px] text-muted-foreground leading-relaxed">
                                {item.message}
                              </p>
                            )}

                            {/* Quick Action Button right on the alert card */}
                            <div className="pt-1 flex items-center justify-end">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-[11px] font-semibold text-primary hover:text-primary gap-1"
                                onClick={() => navigate({ to: "/assembly/material-requests" })}
                              >
                                {isShortage ? "Request Material" : "View Requisitions"}
                                <ArrowRight className="size-3" />
                              </Button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Recent Activity Feed */}
                <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-soft">
                  <div className="flex items-center justify-between pb-3 border-b border-border/60">
                    <div className="flex items-center gap-2">
                      <div className="grid size-7 place-items-center rounded-lg bg-primary/15 text-primary">
                        <Clock className="size-4" />
                      </div>
                      <div>
                        <h2 className="text-sm font-bold text-foreground">
                          Recent Assembly Activity
                        </h2>
                        <p className="text-[11px] text-muted-foreground">
                          Chronological audit & assembly log
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 space-y-3">
                    {loading ? (
                      <div className="py-6 text-center text-xs text-muted-foreground">
                        Loading activity log...
                      </div>
                    ) : !data?.recent_activity || data.recent_activity.length === 0 ? (
                      <div className="py-6 text-center text-xs text-muted-foreground">
                        No recent activity recorded yet.
                      </div>
                    ) : (
                      <div
                        id="recent-assembly-activity-list"
                        className="relative pl-4 border-l-2 border-border/60 space-y-4 ml-2"
                      >
                        {data.recent_activity
                          .slice(0, showMoreActivity ? undefined : 3)
                          .map((act: AssemblyActivityItem) => (
                            <div key={act.id} className="relative group text-xs">
                              {/* Node circle */}
                              <div className="absolute -left-[21px] top-1 size-2.5 rounded-full bg-primary border-2 border-card" />
                              <div className="space-y-0.5">
                                <div className="flex items-center justify-between gap-1">
                                  <span className="font-semibold text-foreground text-xs">
                                    {act.action}
                                  </span>
                                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                                    {formatRelativeTime(act.timestamp)}
                                  </span>
                                </div>
                                <p className="text-[11px] text-muted-foreground leading-relaxed">
                                  {act.description}
                                </p>
                                <div className="text-[10px] text-muted-foreground/75 font-mono">
                                  By {act.user} • {ordNumOnly(act.order_number)}
                                </div>
                              </div>
                            </div>
                          ))}
                      </div>
                    )}
                    {!loading && (data?.recent_activity?.length || 0) > 3 && (
                      <div className="border-t border-border/60 pt-3 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-xl text-xs"
                          aria-expanded={showMoreActivity}
                          aria-controls="recent-assembly-activity-list"
                          onClick={() => setShowMoreActivity((value) => !value)}
                        >
                          {showMoreActivity
                            ? "Show Less"
                            : "More"}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

function ordNumOnly(str: string | null | undefined): string {
  if (!str) return "";
  return str.trim();
}
