import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/wms/app-shell";
import { requireRole } from "@/lib/auth-utils";
import {
  api,
  type AssemblyProductionOrder,
} from "@/lib/api-client";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  Calendar,
  CheckCircle2,
  Clock,
  Factory,
  Filter,
  Layers,
  LayoutDashboard,
  Package,
  PackageCheck,
  Play,
  PlusCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  User,
  Warehouse,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/assembly/production")({
  beforeLoad: () => requireRole(["ASSEMBLY_MANAGER", "ASSEMBLY", "ADMIN", "SUPERUSER"]),
  head: () => ({ meta: [{ title: "Production · KaizenX" }] }),
  component: AssemblyProductionPage,
});

function getStatusBadge(status: string) {
  const s = (status || "").toUpperCase();
  if (s === "IN_PRODUCTION" || s === "IN-PROGRESS" || s === "RUNNING") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/25">
        <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
        In Production
      </span>
    );
  }
  if (s === "MATERIAL_READY" || s === "READY_TO_START") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25">
        <span className="size-1.5 rounded-full bg-emerald-500" />
        Ready to Start
      </span>
    );
  }
  if (s === "QC_PENDING") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-500/10 text-purple-700 dark:text-purple-300 border border-purple-500/25">
        <span className="size-1.5 rounded-full bg-purple-500" />
        QC Pending
      </span>
    );
  }
  if (s === "COMPLETED" || s === "CLOSED") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-teal-500/10 text-teal-700 dark:text-teal-300 border border-teal-500/25">
        <span className="size-1.5 rounded-full bg-teal-500" />
        Completed
      </span>
    );
  }
  if (s === "MATERIAL_PENDING" || s === "PLANNED") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/25">
        <span className="size-1.5 rounded-full bg-amber-500" />
        Material Pending
      </span>
    );
  }
  return (
    <Badge variant="outline" className="text-xs font-medium">
      {status ? status.replace(/_/g, " ") : "Pending"}
    </Badge>
  );
}

function AssemblyProductionPage() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<AssemblyProductionOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  // Complete Production Modal State
  const [completeOrder, setCompleteOrder] = useState<AssemblyProductionOrder | null>(null);
  const [producedQuantity, setProducedQuantity] = useState<number>(0);
  const [productionNotes, setProductionNotes] = useState<string>("");
  const [completing, setCompleting] = useState(false);

  // Start Production Confirmation State
  const [startingOrderId, setStartingOrderId] = useState<string | null>(null);

  const fetchOrders = async (isManual = false) => {
    if (isManual) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await api.getAssemblyProductionOrders({
        search: search || undefined,
        status: statusFilter !== "ALL" ? statusFilter : undefined,
      });
      setOrders(res || []);
    } catch (err: any) {
      toast.error("Failed to load production orders: " + (err.message || "Unknown error"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, [statusFilter]);

  const handleStartProduction = async (order: AssemblyProductionOrder) => {
    if (!order.can_start) {
      toast.error("Materials must be received before starting production.");
      return;
    }
    try {
      setStartingOrderId(order.id);
      const res = await api.startAssemblyProduction(order.id);
      toast.success(res.message || `Production started for ${order.order_number}`);
      await fetchOrders();
    } catch (err: any) {
      toast.error(err.message || "Failed to start production");
    } finally {
      setStartingOrderId(null);
    }
  };

  const handleOpenCompleteModal = (order: AssemblyProductionOrder) => {
    setCompleteOrder(order);
    setProducedQuantity(order.target_quantity);
    setProductionNotes("");
  };

  const handleCompleteSubmit = async () => {
    if (!completeOrder) return;
    if (producedQuantity <= 0) {
      toast.error("Produced quantity must be greater than 0");
      return;
    }

    try {
      setCompleting(true);
      const res = await api.completeAssemblyProduction(completeOrder.id, {
        produced_quantity: Number(producedQuantity),
        notes: productionNotes.trim() || undefined,
      });
      toast.success(res.message || `Production completed for ${completeOrder.order_number}`);
      setCompleteOrder(null);
      await fetchOrders();
    } catch (err: any) {
      toast.error(err.message || "Failed to complete production");
    } finally {
      setCompleting(false);
    }
  };

  // Quick stats
  const totalOrders = orders.length;
  const readyToStart = orders.filter((o) => o.can_start).length;
  const inProduction = orders.filter((o) => o.can_complete).length;
  const qcPending = orders.filter((o) => o.status === "QC_PENDING").length;
  const completedCount = orders.filter((o) => o.status === "COMPLETED" || o.status === "CLOSED").length;

  // Local text search
  const filteredOrders = useMemo(() => {
    if (!search.trim()) return orders;
    const q = search.toLowerCase().trim();
    return orders.filter(
      (o) =>
        o.order_number?.toLowerCase().includes(q) ||
        o.product_name?.toLowerCase().includes(q) ||
        o.product_code?.toLowerCase().includes(q) ||
        o.material_request_number?.toLowerCase().includes(q)
    );
  }, [orders, search]);

  // Workflow Quick Link Cards
  const workflowShortcuts = [
    {
      title: "Assembly Dashboard",
      subtitle: "Floor monitoring & KPI metrics",
      icon: LayoutDashboard,
      to: "/assembly-dashboard",
      tone: "blue",
    },
    {
      title: "Work Orders",
      subtitle: "Manufacturing orders & BOM lines",
      icon: Layers,
      to: "/assembly/orders",
      tone: "amber",
    },
    {
      title: "Material Requests",
      subtitle: "Warehouse component requisition",
      icon: Boxes,
      to: "/assembly/material-requests",
      tone: "cyan",
    },
    {
      title: "Quality Inspections",
      subtitle: "Batch testing & QC pass signs",
      icon: ShieldCheck,
      to: "/assembly/quality",
      tone: "purple",
    },
  ];

  return (
    <AppShell
      title="Production"
      subtitle="Assembly work center operations, step execution, and production recording"
      actions={
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-card border border-border/80 shadow-2xs text-xs font-medium text-muted-foreground">
            <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
            Lines Active & Synced
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate({ to: "/assembly-dashboard" as any })}
            className="rounded-xl text-xs gap-1.5 shadow-2xs hover:bg-muted/80 font-medium"
          >
            <LayoutDashboard className="size-3.5 text-primary" />
            Dashboard
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate({ to: "/assembly/material-requests" as any })}
            className="rounded-xl text-xs gap-1.5 shadow-2xs hover:bg-muted/80 font-medium"
          >
            <Boxes className="size-3.5 text-amber-500" />
            Material Requests
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchOrders(true)}
            disabled={refreshing}
            className="rounded-xl text-xs gap-1.5 shadow-2xs hover:bg-muted/80"
          >
            <RefreshCw className={cn("size-3.5", refreshing && "animate-spin text-primary")} />
            Refresh
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* 5 Top KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3.5">
          {/* Card 1: Total Orders */}
          <div className="group relative overflow-hidden rounded-2xl border border-blue-500/20 bg-gradient-to-br from-blue-500/10 via-card to-card p-4 shadow-2xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-soft hover:border-blue-500/35 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Total Orders
              </span>
              <div className="grid size-9 place-items-center rounded-xl bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/20 shadow-2xs">
                <Factory className="size-4" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-3xl font-black tracking-tight text-foreground tabular-nums">
                {loading ? "..." : totalOrders}
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>Tracked in Assembly</span>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-blue-500/10 text-blue-700 dark:text-blue-300">
                  Total
                </span>
              </div>
            </div>
          </div>

          {/* Card 2: Ready to Start */}
          <div className="group relative overflow-hidden rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 via-card to-card p-4 shadow-2xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-soft hover:border-emerald-500/35 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Ready to Start
              </span>
              <div className="grid size-9 place-items-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shadow-2xs">
                <Play className="size-4" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-3xl font-black tracking-tight text-emerald-600 dark:text-emerald-400 tabular-nums">
                {loading ? "..." : readyToStart}
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>Materials confirmed</span>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                  Ready
                </span>
              </div>
            </div>
          </div>

          {/* Card 3: In Production */}
          <div className="group relative overflow-hidden rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/10 via-card to-card p-4 shadow-2xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-soft hover:border-amber-500/35 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                In Production
              </span>
              <div className="grid size-9 place-items-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20 shadow-2xs">
                <Clock className="size-4" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-3xl font-black tracking-tight text-amber-600 dark:text-amber-400 tabular-nums">
                {loading ? "..." : inProduction}
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>Active bench runs</span>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-300">
                  Active
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
              <div className="text-3xl font-black tracking-tight text-purple-600 dark:text-purple-400 tabular-nums">
                {loading ? "..." : qcPending}
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>Awaiting inspection</span>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-purple-500/10 text-purple-700 dark:text-purple-300">
                  Audit
                </span>
              </div>
            </div>
          </div>

          {/* Card 5: Completed */}
          <div className="group relative overflow-hidden rounded-2xl border border-teal-500/20 bg-gradient-to-br from-teal-500/10 via-card to-card p-4 shadow-2xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-soft hover:border-teal-500/35 flex flex-col justify-between col-span-2 md:col-span-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Completed
              </span>
              <div className="grid size-9 place-items-center rounded-xl bg-teal-500/15 text-teal-600 dark:text-teal-400 border border-teal-500/20 shadow-2xs">
                <CheckCircle2 className="size-4" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-3xl font-black tracking-tight text-teal-600 dark:text-teal-400 tabular-nums">
                {loading ? "..." : completedCount}
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>Finished & ready</span>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-teal-500/10 text-teal-700 dark:text-teal-300">
                  Done
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Workflow Quick Links */}
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
                      sc.tone === "cyan" && "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-cyan-500/20",
                      sc.tone === "purple" && "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/20"
                    )}
                  >
                    <Icon className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-foreground group-hover:text-primary transition-colors">
                      {sc.title}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">{sc.subtitle}</div>
                  </div>
                </div>
                <ArrowRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary shrink-0 pl-1" />
              </Link>
            );
          })}
        </div>

        {/* Main Work Center Table Card */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-4">
          {/* Header & Controls */}
          <div className="space-y-4 pb-4 border-b border-border/60">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                  <Factory className="size-4 text-primary" />
                  Active Line Execution Center
                </h2>
                <p className="text-xs text-muted-foreground">
                  Control bench operations, execute manufacturing steps, and record finished batch outputs
                </p>
              </div>
              <div className="text-xs text-muted-foreground self-start sm:self-auto font-medium">
                Showing <strong className="text-foreground">{filteredOrders.length}</strong> of{" "}
                <strong className="text-foreground">{orders.length}</strong> line runs
              </div>
            </div>

            {/* Filter & Search Toolbar */}
            <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 pt-1">
              {/* Status Filter Tabs */}
              <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-muted/60 border border-border/60">
                {[
                  { key: "ALL", label: `All Orders (${totalOrders})` },
                  { key: "READY", label: `Ready to Start (${readyToStart})` },
                  { key: "IN_PRODUCTION", label: `In Production (${inProduction})` },
                  { key: "COMPLETED", label: `QC / Completed (${qcPending + completedCount})` },
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
              <div className="relative min-w-[240px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search order or product..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 w-full rounded-lg border border-border bg-card pl-8 pr-7 text-xs outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary/40"
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
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
              <p className="text-xs text-muted-foreground">Loading production runs from database...</p>
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="py-14 text-center">
              <div className="grid size-12 place-items-center rounded-2xl bg-muted mx-auto mb-3 text-muted-foreground">
                <Factory className="size-6 opacity-60" />
              </div>
              <p className="text-sm font-semibold text-foreground">
                {search || statusFilter !== "ALL"
                  ? "No production runs match the selected filter"
                  : "No production orders currently in execution"}
              </p>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                {search || statusFilter !== "ALL"
                  ? "Try resetting your search query or switching to 'All Orders' status filter."
                  : "Staged orders with confirmed raw materials appear here ready for bench assembly."}
              </p>
              <div className="mt-4 flex items-center justify-center gap-2">
                {search || statusFilter !== "ALL" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-xl text-xs gap-1.5"
                    onClick={() => {
                      setSearch("");
                      setStatusFilter("ALL");
                    }}
                  >
                    Reset Filters
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="rounded-xl text-xs gap-1.5 font-semibold"
                    onClick={() => navigate({ to: "/assembly/material-requests" as any })}
                  >
                    <Boxes className="size-3.5" />
                    View Material Requests
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto -mx-5 px-5">
              <table className="w-full text-left text-sm mt-1">
                <thead>
                  <tr className="border-b border-border/60 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    <th className="py-3 px-3">Order Number</th>
                    <th className="py-3 px-3">Product Details</th>
                    <th className="py-3 px-3">Target Qty</th>
                    <th className="py-3 px-3 min-w-[140px]">Progress</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3">Line & Operator</th>
                    <th className="py-3 px-3 text-right">Production Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {filteredOrders.map((order) => {
                    const percent =
                      order.target_quantity > 0
                        ? Math.min(100, Math.round((order.produced_quantity / order.target_quantity) * 100))
                        : 0;
                    const isDone = percent >= 100 || order.status === "COMPLETED";

                    return (
                      <tr key={order.id} className="group hover:bg-muted/40 transition-colors">
                        {/* Order Number */}
                        <td className="py-3.5 px-3">
                          <div className="font-bold text-foreground text-xs font-mono group-hover:text-primary transition-colors">
                            {order.order_number}
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            {order.material_request_number ? (
                              <Link
                                to="/assembly/material-requests"
                                className="hover:underline hover:text-primary font-mono inline-flex items-center gap-1"
                              >
                                Req: {order.material_request_number}
                              </Link>
                            ) : (
                              "Direct Work Run"
                            )}
                          </div>
                        </td>

                        {/* Product Details */}
                        <td className="py-3.5 px-3">
                          <div className="font-semibold text-foreground text-xs">{order.product_name}</div>
                          <div className="text-[11px] text-muted-foreground font-mono mt-0.5">
                            {order.product_code}
                          </div>
                        </td>

                        {/* Target Qty */}
                        <td className="py-3.5 px-3 whitespace-nowrap">
                          <span className="font-bold text-foreground text-xs tabular-nums">
                            {order.target_quantity}
                          </span>{" "}
                          <span className="text-[11px] text-muted-foreground font-medium">
                            {order.uom}
                          </span>
                        </td>

                        {/* Produced Qty & Progress */}
                        <td className="py-3.5 px-3">
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="font-semibold text-foreground tabular-nums">
                                {order.produced_quantity} {order.uom}
                              </span>
                              <span
                                className={cn(
                                  "text-[10px] font-semibold tabular-nums",
                                  isDone
                                    ? "text-emerald-600 dark:text-emerald-400"
                                    : percent > 0
                                    ? "text-amber-600 dark:text-amber-400"
                                    : "text-muted-foreground"
                                )}
                              >
                                {percent}%
                              </span>
                            </div>
                            <div className="w-full bg-muted/80 rounded-full h-2 overflow-hidden border border-border/30">
                              <div
                                className={cn(
                                  "h-full rounded-full transition-all duration-300",
                                  isDone
                                    ? "bg-emerald-500"
                                    : percent > 0
                                    ? "bg-amber-500"
                                    : "bg-muted-foreground/30"
                                )}
                                style={{ width: `${percent}%` }}
                              />
                            </div>
                          </div>
                        </td>

                        {/* Status */}
                        <td className="py-3.5 px-3 whitespace-nowrap">{getStatusBadge(order.status)}</td>

                        {/* Line & Operator */}
                        <td className="py-3.5 px-3 whitespace-nowrap">
                          <div className="flex flex-col text-[11px]">
                            <span className="font-semibold text-foreground">
                              {order.assigned_line || "LINE-01"}
                            </span>
                            <span className="text-muted-foreground flex items-center gap-1 mt-0.5">
                              <User className="size-3 text-muted-foreground/60" />
                              {order.assigned_operator || "Unassigned"}
                            </span>
                          </div>
                        </td>

                        {/* Production Actions */}
                        <td className="py-3.5 px-3 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-2">
                            {/* Action: Start Production */}
                            {order.can_start && (
                              <Button
                                size="sm"
                                onClick={() => handleStartProduction(order)}
                                disabled={startingOrderId === order.id}
                                className="h-7 px-3 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 rounded-lg shadow-sm"
                              >
                                <Play className="size-3 fill-current" />
                                {startingOrderId === order.id ? "Starting..." : "Start Production"}
                              </Button>
                            )}

                            {/* Action: Complete Production */}
                            {order.can_complete && (
                              <Button
                                size="sm"
                                onClick={() => handleOpenCompleteModal(order)}
                                className="h-7 px-3 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white gap-1.5 rounded-lg shadow-sm"
                              >
                                <CheckCircle2 className="size-3.5" />
                                Complete Production
                              </Button>
                            )}

                            {/* QC Pending Action */}
                            {order.status === "QC_PENDING" && (
                              <Link
                                to="/assembly/quality"
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-purple-700 bg-purple-500/10 border border-purple-500/25 hover:bg-purple-500/20 transition-colors"
                              >
                                <ShieldCheck className="size-3.5 text-purple-600" />
                                Ready for QC
                                <ArrowRight className="size-3 ml-0.5" />
                              </Link>
                            )}

                            {/* Completed Status */}
                            {order.status === "COMPLETED" && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-teal-700 dark:text-teal-300 bg-teal-500/10 border border-teal-500/25">
                                <CheckCircle2 className="size-3.5" />
                                Completed
                              </span>
                            )}

                            {/* Material Pending fallback action */}
                            {!order.can_start &&
                              !order.can_complete &&
                              order.status !== "QC_PENDING" &&
                              order.status !== "COMPLETED" && (
                                <Link
                                  to="/assembly/material-requests"
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/25 hover:bg-amber-500/20 transition-colors"
                                  title="View or request required raw materials from warehouse"
                                >
                                  <Boxes className="size-3.5 text-amber-600" />
                                  Awaiting Materials
                                  <ArrowRight className="size-3 ml-0.5" />
                                </Link>
                              )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ========================================================================= */}
        {/* COMPLETE PRODUCTION MODAL */}
        {/* ========================================================================= */}
        <Dialog open={!!completeOrder} onOpenChange={(open) => !open && setCompleteOrder(null)}>
          <DialogContent className="max-w-md p-6 rounded-2xl">
            <DialogHeader className="border-b border-border/60 pb-3">
              <DialogTitle className="flex items-center gap-2 text-foreground text-lg font-bold">
                <Factory className="size-5 text-amber-500" />
                Complete Production & Record Output
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-1">
                Record actual assembled quantity for order{" "}
                <span className="font-mono font-semibold text-foreground">
                  {completeOrder?.order_number}
                </span>
                . The completed batch will be routed to Quality Check (QC).
              </DialogDescription>
            </DialogHeader>

            {completeOrder && (
              <div className="space-y-4 pt-3">
                <div className="rounded-xl bg-muted/40 p-3.5 text-xs space-y-2 border border-border/60">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Product:</span>
                    <span className="font-semibold text-foreground">{completeOrder.product_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Target Quantity:</span>
                    <span className="font-semibold text-foreground font-mono">
                      {completeOrder.target_quantity} {completeOrder.uom}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Assigned Line:</span>
                    <span className="text-foreground font-medium">
                      {completeOrder.assigned_line || "Line 1"}
                    </span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    Actual Produced Quantity ({completeOrder.uom}) *
                  </label>
                  <Input
                    type="number"
                    min={1}
                    max={completeOrder.target_quantity * 2}
                    value={producedQuantity}
                    onChange={(e) => setProducedQuantity(Number(e.target.value))}
                    className="h-9 text-sm font-mono font-bold rounded-xl"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Pre-filled with target quantity. Adjust if any units were rejected or scrapped during bench work.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    Production Notes / Serial Range (Optional)
                  </label>
                  <Textarea
                    placeholder="e.g. Assembled per SOP-04 Rev 2. Serial batch SN-2026-001 through 010 verified."
                    value={productionNotes}
                    onChange={(e) => setProductionNotes(e.target.value)}
                    rows={3}
                    className="text-xs resize-none rounded-xl"
                  />
                </div>
              </div>
            )}

            <DialogFooter className="pt-2">
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl"
                onClick={() => setCompleteOrder(null)}
                disabled={completing}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleCompleteSubmit}
                disabled={completing || producedQuantity <= 0}
                className="rounded-xl bg-amber-600 hover:bg-amber-700 text-white gap-1.5 font-semibold shadow-soft"
              >
                {completing ? (
                  <RefreshCw className="size-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="size-3.5" />
                )}
                Complete & Route to QC
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
