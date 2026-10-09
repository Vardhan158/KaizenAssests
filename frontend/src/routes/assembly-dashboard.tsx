import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  Eye,
  Factory,
  Filter,
  Layers,
  PackageCheck,
  Plus,
  PlusCircle,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/assembly-dashboard")({
  beforeLoad: () => requireRole(["ASSEMBLY_MANAGER", "ASSEMBLY", "ADMIN", "SUPERUSER"]),
  head: () => ({ meta: [{ title: "Assembly Dashboard · KaizenX" }] }),
  component: AssemblyDashboard,
});

function formatStatus(status: string) {
  const map: Record<string, string> = {
    MATERIAL_PENDING: "Material Pending",
    IN_PRODUCTION: "In Production",
    QC_PENDING: "QC Pending",
    COMPLETED: "Completed",
    PLANNED: "Planned",
    REWORK: "Rework Required",
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
  if (s === "REWORK" || s === "QC_FAILED") {
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
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [alertsOnlyShortages, setAlertsOnlyShortages] = useState(false);

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
    void loadDashboard();
  }, []);

  const kpis = data?.kpis || {
    open_orders: 0,
    material_pending: 0,
    in_production: 0,
    qc_pending: 0,
    completed_today: 0,
  };

  const filteredOrders = useMemo(() => {
    if (!data?.active_orders) return [];
    return data.active_orders.filter((ord) => {
      // Status filter
      if (statusFilter !== "ALL" && ord.status.toUpperCase() !== statusFilter) {
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

  const filteredAlerts = useMemo(() => {
    if (!data?.needs_attention) return [];
    if (!alertsOnlyShortages) return data.needs_attention;
    return data.needs_attention.filter((item) => item.type.toLowerCase().includes("shortage"));
  }, [data?.needs_attention, alertsOnlyShortages]);

  // Workflow Quick Link Cards
  const workflowShortcuts = [
    {
      title: "Production Lines",
      subtitle: "Active line execution & build stages",
      icon: Factory,
      badge: `${kpis.in_production} In Production`,
      to: "/assembly/production",
      tone: "blue",
    },
    {
      title: "Material Requests",
      subtitle: "Warehouse part staging & reserves",
      icon: Boxes,
      badge: `${kpis.material_pending} Pending Issue`,
      to: "/assembly/material-requests",
      tone: "amber",
    },
    {
      title: "Quality Inspections",
      subtitle: "Incoming line checks & batch approvals",
      icon: ShieldCheck,
      badge: `${kpis.qc_pending} Pending QC`,
      to: "/assembly/quality",
      tone: "purple",
    },
    {
      title: "Finished Goods Store",
      subtitle: "Completed batch transfer to warehouse",
      icon: PackageCheck,
      badge: `${kpis.completed_today} Completed`,
      to: "/assembly/finished-goods",
      tone: "emerald",
    },
  ];

  return (
    <AppShell
      title="Assembly Dashboard"
      subtitle="Operational monitoring, production tracking & quality status"
      actions={
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-card border border-border/80 shadow-2xs text-xs font-medium text-muted-foreground">
            <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
            Live Floor Sync
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadDashboard(true)}
            disabled={refreshing}
            className="rounded-xl text-xs gap-1.5 shadow-2xs hover:bg-muted/80"
          >
            <RefreshCw className={cn("size-3.5", refreshing && "animate-spin text-primary")} />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate({ to: "/assembly/orders" as any })}
            className="rounded-xl text-xs gap-1.5 font-semibold"
          >
            <Layers className="size-3.5 text-primary" />
            Manage Orders
          </Button>
          <Button
            size="sm"
            onClick={() => navigate({ to: "/assembly/material-requests" as any })}
            className="rounded-xl text-xs gap-1.5 font-semibold shadow-soft"
          >
            <Plus className="size-3.5" />
            New Material Request
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* 5 Top KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3.5">
          {/* Card 1: Open Orders */}
          <div className="group relative overflow-hidden rounded-2xl border border-blue-500/20 bg-gradient-to-br from-blue-500/10 via-card to-card p-4 shadow-2xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-soft hover:border-blue-500/35 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Open Orders
              </span>
              <div className="grid size-9 place-items-center rounded-xl bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/20 shadow-2xs">
                <Layers className="size-4" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-3xl font-black tracking-tight text-foreground tabular-nums">
                {loading ? "..." : kpis.open_orders}
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>Active in pipeline</span>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-blue-500/10 text-blue-700 dark:text-blue-300">
                  Total
                </span>
              </div>
            </div>
          </div>

          {/* Card 2: Material Pending */}
          <div className="group relative overflow-hidden rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/10 via-card to-card p-4 shadow-2xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-soft hover:border-amber-500/35 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Material Pending
              </span>
              <div className="grid size-9 place-items-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20 shadow-2xs">
                <Boxes className="size-4" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-3xl font-black tracking-tight text-amber-600 dark:text-amber-400 tabular-nums">
                {loading ? "..." : kpis.material_pending}
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>Awaiting warehouse issue</span>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-300">
                  Action
                </span>
              </div>
            </div>
          </div>

          {/* Card 3: In Production */}
          <div className="group relative overflow-hidden rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/10 via-card to-card p-4 shadow-2xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-soft hover:border-cyan-500/35 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                In Production
              </span>
              <div className="grid size-9 place-items-center rounded-xl bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20 shadow-2xs">
                <Factory className="size-4" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-3xl font-black tracking-tight text-foreground tabular-nums">
                {loading ? "..." : kpis.in_production}
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>On assembly lines</span>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
                  Lines
                </span>
              </div>
            </div>
          </div>

          {/* Card 4: QC Pending */}
          <div className="group relative overflow-hidden rounded-2xl border border-purple-500/20 bg-gradient-to-br from-purple-500/10 via-card to-card p-4 shadow-2xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-soft hover:border-purple-500/35 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                QC Pending
              </span>
              <div className="grid size-9 place-items-center rounded-xl bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/20 shadow-2xs">
                <ShieldCheck className="size-4" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-3xl font-black tracking-tight text-foreground tabular-nums">
                {loading ? "..." : kpis.qc_pending}
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>Waiting inspection</span>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-purple-500/10 text-purple-700 dark:text-purple-300">
                  Audit
                </span>
              </div>
            </div>
          </div>

          {/* Card 5: Completed Today */}
          <div className="group relative overflow-hidden rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 via-card to-card p-4 shadow-2xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-soft hover:border-emerald-500/35 flex flex-col justify-between col-span-2 md:col-span-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Completed Today
              </span>
              <div className="grid size-9 place-items-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shadow-2xs">
                <CheckCircle2 className="size-4" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-3xl font-black tracking-tight text-emerald-600 dark:text-emerald-400 tabular-nums">
                {loading ? "..." : kpis.completed_today}
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>Manufactured today</span>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                  Ready
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Workflow Quick Jump Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {workflowShortcuts.map((sc) => {
            const Icon = sc.icon;
            return (
              <Link
                key={sc.to}
                to={sc.to as any}
                className="group relative flex items-center justify-between p-3.5 rounded-xl border border-border/80 bg-card hover:border-primary/40 hover:bg-muted/40 transition-all duration-200 shadow-2xs"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={cn(
                      "grid size-9 shrink-0 place-items-center rounded-lg border",
                      sc.tone === "blue" && "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/20",
                      sc.tone === "amber" && "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20",
                      sc.tone === "purple" && "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/20",
                      sc.tone === "emerald" && "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
                    )}
                  >
                    <Icon className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-foreground group-hover:text-primary transition-colors flex items-center gap-1.5">
                      {sc.title}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">{sc.subtitle}</div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0 pl-2">
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border/60">
                    {sc.badge}
                  </span>
                  <ArrowRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                </div>
              </Link>
            );
          })}
        </div>

        {/* Main Grid: Active Orders & Right Sidebars */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Active Work Orders (2 Cols) */}
          <div className="lg:col-span-2 space-y-4">
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              {/* Header & Controls */}
              <div className="space-y-4 pb-4 border-b border-border/60">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                      <Layers className="size-4 text-primary" />
                      Active Work Orders
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      Manufacturing runs currently scheduled & progressing on assembly lines
                    </p>
                  </div>
                  <Link
                    to="/assembly/orders"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline self-start sm:self-auto"
                  >
                    View All Orders <ArrowRight className="size-3.5" />
                  </Link>
                </div>

                {/* Search & Filter Toolbar */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
                  {/* Status Filter Tabs */}
                  <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-muted/60 border border-border/60">
                    {[
                      { key: "ALL", label: `All (${data?.active_orders?.length || 0})` },
                      { key: "MATERIAL_PENDING", label: `Material Pending (${kpis.material_pending})` },
                      { key: "IN_PRODUCTION", label: `In Production (${kpis.in_production})` },
                      { key: "COMPLETED", label: `Completed` },
                    ].map((tab) => (
                      <button
                        key={tab.key}
                        onClick={() => setStatusFilter(tab.key)}
                        className={cn(
                          "px-2.5 py-1 text-xs font-semibold rounded-lg transition-all",
                          statusFilter === tab.key
                            ? "bg-card text-foreground shadow-xs border border-border/50"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted"
                        )}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {/* Search input */}
                  <div className="relative min-w-[200px]">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Search order, product..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-8 w-full rounded-lg border border-border bg-card pl-8 pr-7 text-xs outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary/40"
                    />
                    {searchQuery && (
                      <button
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
                  <p className="text-xs text-muted-foreground">Loading active orders from database...</p>
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
                      : "Create a new assembly order to begin work order tracking and material allocation."}
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
                        onClick={() => navigate({ to: "/assembly/orders" as any })}
                      >
                        <PlusCircle className="size-3.5" />
                        Create Assembly Order
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto -mx-5 px-5">
                  <table className="w-full text-left text-sm mt-1">
                    <thead>
                      <tr className="border-b border-border/60 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                        <th className="py-3 px-3">Order No.</th>
                        <th className="py-3 px-3">Product & BOM</th>
                        <th className="py-3 px-3">Target Qty</th>
                        <th className="py-3 px-3 min-w-[140px]">Progress</th>
                        <th className="py-3 px-3">Required Date</th>
                        <th className="py-3 px-3">Status</th>
                        <th className="py-3 px-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {filteredOrders.map((ord: AssemblyOrder) => {
                        const progressVal = Math.min(100, Math.max(0, ord.progress || 0));
                        const isDone = progressVal >= 100 || ord.status === "COMPLETED";

                        return (
                          <tr
                            key={ord.id}
                            className="group hover:bg-muted/40 transition-colors cursor-pointer"
                            onClick={() => navigate({ to: "/assembly/orders" as any })}
                          >
                            {/* Order Number */}
                            <td className="py-3.5 px-3">
                              <div className="font-bold text-foreground text-xs font-mono group-hover:text-primary transition-colors">
                                {ord.order_number}
                              </div>
                              <div className="mt-1 flex items-center gap-1.5">
                                <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.2 rounded bg-muted text-muted-foreground border border-border/50">
                                  {ord.assembly_line || "LINE-01"}
                                </span>
                                {ord.priority && ord.priority !== "NORMAL" && (
                                  <span className="text-[10px] font-bold text-rose-600 dark:text-rose-400 bg-rose-500/10 px-1 rounded">
                                    {ord.priority}
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* Product & BOM */}
                            <td className="py-3.5 px-3">
                              <div className="font-semibold text-foreground text-xs">
                                {ord.product_name}
                              </div>
                              <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
                                <span>{ord.product_code}</span>
                                {ord.bom_number && (
                                  <>
                                    <span>•</span>
                                    <span className="font-mono text-[10px] opacity-80">{ord.bom_number}</span>
                                  </>
                                )}
                              </div>
                            </td>

                            {/* Target Qty */}
                            <td className="py-3.5 px-3 whitespace-nowrap">
                              <span className="font-bold text-foreground text-xs tabular-nums">
                                {ord.target_quantity}
                              </span>{" "}
                              <span className="text-[11px] text-muted-foreground font-medium">
                                {ord.uom}
                              </span>
                            </td>

                            {/* Progress Bar */}
                            <td className="py-3.5 px-3">
                              <div className="space-y-1">
                                <div className="flex items-center justify-between text-[11px]">
                                  <span className="font-semibold text-foreground tabular-nums">
                                    {progressVal}%
                                  </span>
                                  {isDone ? (
                                    <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                                      Done
                                    </span>
                                  ) : (
                                    <span className="text-[10px] text-muted-foreground">
                                      {ord.completed_quantity || 0}/{ord.target_quantity} {ord.uom}
                                    </span>
                                  )}
                                </div>
                                <div className="w-full bg-muted/80 rounded-full h-2 overflow-hidden border border-border/30">
                                  <div
                                    className={cn(
                                      "h-full rounded-full transition-all duration-300",
                                      isDone
                                        ? "bg-emerald-500"
                                        : progressVal > 0
                                        ? "bg-blue-500"
                                        : "bg-amber-500/70"
                                    )}
                                    style={{ width: `${progressVal}%` }}
                                  />
                                </div>
                              </div>
                            </td>

                            {/* Required Date */}
                            <td className="py-3.5 px-3 whitespace-nowrap">
                              <div className="flex items-center gap-1.5 text-xs text-foreground font-medium">
                                <Calendar className="size-3 text-muted-foreground" />
                                {formatDate(ord.required_date)}
                              </div>
                            </td>

                            {/* Status */}
                            <td className="py-3.5 px-3 whitespace-nowrap">
                              {getStatusBadge(ord.status)}
                            </td>

                            {/* Action */}
                            <td className="py-3.5 px-3 text-right whitespace-nowrap">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 px-2.5 text-xs font-semibold gap-1 rounded-lg group-hover:bg-primary group-hover:text-primary-foreground group-hover:border-primary transition-all"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate({ to: "/assembly/orders" as any });
                                }}
                              >
                                Details
                                <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Needs Attention & Recent Activity */}
          <div className="space-y-6">
            {/* Needs Attention Card */}
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-center justify-between pb-3 border-b border-border/60">
                <div className="flex items-center gap-2">
                  <div className="grid size-7 place-items-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
                    <ShieldAlert className="size-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-foreground">Needs Attention</h2>
                    <p className="text-[11px] text-muted-foreground">Actionable bottlenecks & shortages</p>
                  </div>
                </div>
                {data?.needs_attention && data.needs_attention.length > 0 && (
                  <Badge
                    variant="outline"
                    className="text-xs font-bold border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10"
                  >
                    {data.needs_attention.length} Alert{data.needs_attention.length > 1 ? "s" : ""}
                  </Badge>
                )}
              </div>

              {/* Filter toggle if alerts exist */}
              {data?.needs_attention && data.needs_attention.length > 0 && (
                <div className="mt-3 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground font-medium">Critical items first</span>
                  <button
                    onClick={() => setAlertsOnlyShortages(!alertsOnlyShortages)}
                    className={cn(
                      "text-[11px] font-semibold px-2 py-0.5 rounded-md border transition-colors",
                      alertsOnlyShortages
                        ? "bg-rose-500/15 text-rose-600 border-rose-500/30"
                        : "bg-muted text-muted-foreground border-border/60 hover:text-foreground"
                    )}
                  >
                    {alertsOnlyShortages ? "Showing Shortages" : "Show Shortages Only"}
                  </button>
                </div>
              )}

              {/* Alert Items List with Scroll */}
              <div className="mt-3.5 space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
                {loading ? (
                  <div className="py-8 text-center text-xs text-muted-foreground">Checking conditions...</div>
                ) : filteredAlerts.length === 0 ? (
                  <div className="py-8 text-center">
                    <div className="grid size-10 place-items-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 mx-auto mb-2">
                      <CheckCircle2 className="size-5" />
                    </div>
                    <p className="text-xs font-bold text-foreground">All Conditions Clear</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      No material shortages or critical production blocks detected.
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
                            : "border-amber-500/30 bg-amber-500/5 hover:border-amber-500/50"
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
                                : "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30"
                            )}
                          >
                            {item.type}
                          </span>
                        </div>

                        {item.item_name && (
                          <div className="font-semibold text-foreground text-xs">{item.item_name}</div>
                        )}

                        {item.required !== undefined && item.available !== undefined && item.shortage !== undefined ? (
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
                          <p className="text-[11px] text-muted-foreground leading-relaxed">{item.message}</p>
                        )}

                        {/* Quick Action Button right on the alert card */}
                        <div className="pt-1 flex items-center justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[11px] font-semibold text-primary hover:text-primary gap-1"
                            onClick={() => navigate({ to: "/assembly/material-requests" as any })}
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
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-center justify-between pb-3 border-b border-border/60">
                <div className="flex items-center gap-2">
                  <div className="grid size-7 place-items-center rounded-lg bg-primary/15 text-primary">
                    <Clock className="size-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-foreground">Recent Activity</h2>
                    <p className="text-[11px] text-muted-foreground">Chronological audit & assembly log</p>
                  </div>
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
                  <div className="relative pl-4 border-l-2 border-border/60 space-y-4 ml-2">
                    {data.recent_activity.map((act: AssemblyActivityItem) => (
                      <div key={act.id} className="relative group text-xs">
                        {/* Node circle */}
                        <div className="absolute -left-[21px] top-1 size-2.5 rounded-full bg-primary border-2 border-card" />
                        <div className="space-y-0.5">
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-semibold text-foreground text-xs">{act.action}</span>
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
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function ordNumOnly(str: string | null | undefined): string {
  if (!str) return "";
  return str.trim();
}
