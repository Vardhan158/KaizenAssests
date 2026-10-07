import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import {
  Boxes,
  PackageCheck,
  Building2,
  ShieldAlert,
  ClipboardCheck,
  AlertTriangle,
  RefreshCw,
  Warehouse,
  CheckCircle2,
  ArrowRight,
  Activity,
  Plus,
  Database,
  Store,
  ClipboardList,
  ListOrdered,
  LogOut,
  BarChart3,
  LayoutDashboard,
  Truck,
} from "lucide-react";
import { AppShell, StatusBadge } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/warehouse-dashboard")({
  head: () => ({
    meta: [
      { title: "Warehouse Control Center · KaizenX" },
      {
        name: "description",
        content:
          "Authoritative operational warehouse dashboard: real-time putaway tasks, store pickups, live stock distribution, storage capacity, and quarantine exceptions.",
      },
    ],
  }),
  component: WarehouseDashboard,
});

function WarehouseDashboard() {
  const [data, setData] = useState<any>(null);
  const [materialCount, setMaterialCount] = useState<number | null>(null);
  const [dispatchTrackingCount, setDispatchTrackingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboardData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const [res, mats, dispatches] = await Promise.all([
        api.getWarehouseDashboardMetrics(),
        api.getMaterials().catch(() => []),
        api.getDispatches().catch(() => ({ items: [] })),
      ]);
      setData(res);
      if (Array.isArray(mats)) {
        setMaterialCount(mats.length);
      }
      setDispatchTrackingCount(Array.isArray(dispatches) ? dispatches.length : (dispatches?.total || dispatches?.items?.length || 0));
    } catch (err: any) {
      console.error("Failed to load warehouse dashboard metrics", err);
      setError(err.message || "Failed to load warehouse dashboard data");
      if (!quiet) {
        toast.error("Unable to refresh warehouse dashboard data");
      }
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchDashboardData();
    const interval = window.setInterval(() => {
      void fetchDashboardData(true);
    }, 15000);
    return () => window.clearInterval(interval);
  }, [fetchDashboardData]);

  const actionReq = data?.action_required || {
    pending_putaway_count: 0,
    pending_putaways: [],
    pending_pickup_count: 0,
    pending_pickups: [],
    pending_requisition_count: 0,
    pending_material_request_count: 0,
    active_quarantine_count: 0,
    active_quarantine_qty: 0,
    quarantine_records: [],
    low_stock_count: 0,
    low_stock_items: [],
    out_of_stock_count: 0,
    unassigned_locations_count: 0,
  };

  const inventory = data?.inventory_snapshot || {
    total_skus: 0,
    total_on_hand: 0,
    total_available: 0,
    total_allocated: 0,
    total_quarantined: 0,
    low_stock_count: 0,
    out_of_stock_count: 0,
  };

  const putaway = data?.putaway_summary || {
    pending_count: 0,
    in_progress_count: 0,
    completed_count: 0,
    recent_tasks: [],
  };

  const storage = data?.storage_overview || {
    total_stores: 0,
    total_zones: 0,
    total_bins: 0,
    occupied_bins: 0,
    available_bins: 0,
  };

  const activity = data?.recent_activity || [];

  const totalActionsCount =
    actionReq.pending_putaway_count +
    actionReq.pending_pickup_count +
    actionReq.pending_requisition_count +
    actionReq.pending_material_request_count +
    actionReq.active_quarantine_count +
    actionReq.low_stock_count +
    actionReq.out_of_stock_count +
    actionReq.unassigned_locations_count;

  // Compute physical stock distribution percentages
  const onHandTotal =
    inventory.total_on_hand ||
    inventory.total_available + inventory.total_allocated + inventory.total_quarantined ||
    1;
  const availPct = Math.round(((inventory.total_available || 0) / onHandTotal) * 100);
  const allocPct = Math.round(((inventory.total_allocated || 0) / onHandTotal) * 100);
  const quarPct = Math.round(((inventory.total_quarantined || 0) / onHandTotal) * 100);

  const binOccupancyPct =
    storage.total_bins > 0 ? Math.round((storage.occupied_bins / storage.total_bins) * 100) : 0;
  const totalBinCapacity =
    storage.occupied_bins + storage.available_bins || storage.total_bins || 1;
  const occupiedBinPct = Math.round(((storage.occupied_bins || 0) / totalBinCapacity) * 100);
  const availableBinPct = Math.max(0, 100 - occupiedBinPct);

  const openDashboardTarget = (target: string) => {
    window.location.href = target;
  };

  const warehouseShortcutCards = [
    {
      label: "Material Master",
      to: "/warehouse/materials",
      icon: Database,
      value: loading ? "..." : (materialCount !== null ? materialCount : (inventory.total_skus || 0)),
      detail: `${inventory.total_skus || 0} SKUs in stock`,
      tone: "primary",
    },
    {
      label: "Stores Master",
      to: "/warehouse/stores",
      icon: Building2,
      value: loading ? "..." : storage.total_stores,
      detail: `${storage.total_zones} Zones · ${storage.total_bins} Bins`,
      tone: "teal",
    },
    {
      label: "Inventory",
      to: "/inventory",
      icon: Boxes,
      value: loading ? "..." : Number(inventory.total_on_hand || 0).toLocaleString(),
      detail: `${Number(inventory.total_available || 0).toLocaleString()} available units`,
      tone: "emerald",
    },
    {
      label: "Putaway Tasks",
      to: "/putaway-tasks",
      icon: PackageCheck,
      value: loading ? "..." : actionReq.pending_putaway_count,
      detail: `${putaway.in_progress_count || 0} in progress`,
      tone: "emerald",
    },
    {
      label: "Material Requests",
      to: "/warehouse/material-requests",
      icon: ClipboardList,
      value: loading ? "..." : actionReq.pending_material_request_count,
      detail: "Warehouse demand reviews",
      tone: "amber",
    },
    {
      label: "Assembly Requisitions",
      to: "/warehouse/assembly-requisitions",
      icon: ClipboardList,
      value: loading ? "..." : actionReq.pending_requisition_count,
      detail: "Assembly store pickups",
      tone: "amber",
    },
    {
      label: "Dock Management",
      to: "/dock-management",
      icon: Warehouse,
      value: loading
        ? "..."
        : `${data?.dock_overview?.occupied_docks ?? 0} / ${data?.dock_overview?.total_docks ?? 0}`,
      detail: `${data?.dock_overview?.available_docks ?? 0} available docks`,
      tone: "primary",
    },
    {
      label: "Damage & Quarantine",
      to: "/warehouse/quarantine",
      icon: ShieldAlert,
      value: loading ? "..." : actionReq.active_quarantine_count,
      detail: `${Number(actionReq.active_quarantine_qty || 0).toLocaleString()} units segregated`,
      tone: "rose",
    },
    {
      label: "Finished Goods Dispatch Tracking",
      to: "/warehouse/finished-goods-requests",
      icon: Truck,
      value: loading ? "..." : dispatchTrackingCount,
      detail: "Dispatch status and tracking",
      tone: "purple",
    },
    {
      label: "Finished Goods Store",
      to: "/warehouse/finished-goods-store",
      icon: PackageCheck,
      value: null,
      detail: "Assembly putaway & dispatch operations",
      tone: "primary",
    },
    {
      label: "Reports",
      to: "/reports",
      icon: BarChart3,
      value: null,
      detail: "Warehouse analytics & KPIs",
      tone: "amber",
    },
  ];

  return (
    <AppShell
      title="Warehouse Control Center"
      subtitle="Authoritative operational metrics: putaways, pickups, inventory balances, and storage hierarchy"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchDashboardData()}
            disabled={loading}
            className="rounded-xl text-xs"
          >
            <RefreshCw className={cn("size-3.5 mr-1.5", loading && "animate-spin")} />
            Refresh
          </Button>
          <Button variant="outline" size="sm" className="rounded-xl text-xs" asChild>
            <Link to="/inventory">
              <Boxes className="size-3.5 mr-1.5 text-emerald-600" /> Inventory Matrix
            </Link>
          </Button>
          <Button size="sm" className="rounded-xl shadow-glow text-xs font-semibold" asChild>
            <Link to="/warehouse/material-requests">
              <Plus className="size-3.5 mr-1.5" /> Raise MR
            </Link>
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        <div>
          <div className="grid auto-rows-fr items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {warehouseShortcutCards.map((item) => {
              const Icon = item.icon;
              const toneClass =
                item.tone === "teal"
                  ? "border-teal-500/20 bg-gradient-to-br from-teal-500/10 via-card to-card hover:border-teal-500/40 focus-visible:ring-teal-500/20"
                  : item.tone === "emerald"
                    ? "border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 via-card to-card hover:border-emerald-500/40 focus-visible:ring-emerald-500/20"
                    : item.tone === "amber"
                      ? "border-amber-500/20 bg-gradient-to-br from-amber-500/10 via-card to-card hover:border-amber-500/40 focus-visible:ring-amber-500/20"
                      : item.tone === "rose"
                        ? "border-rose-500/20 bg-gradient-to-br from-rose-500/10 via-card to-card hover:border-rose-500/40 focus-visible:ring-rose-500/20"
                        : "border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card hover:border-primary/40 focus-visible:ring-primary/20";
              const iconClass =
                item.tone === "teal"
                  ? "bg-teal-500/15 text-teal-600 dark:text-teal-400 border-teal-500/20"
                  : item.tone === "emerald"
                    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                    : item.tone === "amber"
                      ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20"
                      : item.tone === "rose"
                        ? "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/20"
                        : "bg-primary/15 text-primary border-primary/20";
              return (
                <Link key={item.to + item.label} to={item.to} className="group">
                  <div
                    className={cn(
                      "relative h-full min-h-[158px] overflow-hidden rounded-2xl border p-5 shadow-2xs transition-all duration-300 hover:shadow-soft focus-visible:outline-none focus-visible:ring-2 flex flex-col justify-between",
                      toneClass,
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground truncate">
                        {item.label}
                      </p>
                      <span
                        className={cn(
                          "grid size-9 shrink-0 place-items-center rounded-xl border shadow-2xs",
                          iconClass,
                        )}
                      >
                        <Icon className="size-4" />
                      </span>
                    </div>
                    <div className="mt-4 flex items-end justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        {item.value !== null ? (
                          <p className="text-3xl font-black tracking-tight tabular-nums text-foreground truncate">
                            {item.value}
                          </p>
                        ) : (
                          <div className="flex items-center gap-1.5 py-1">
                            <span className="inline-flex items-center rounded-md bg-amber-500/10 px-2 py-0.5 text-xs font-bold text-amber-700 dark:text-amber-300 border border-amber-500/20">
                              Analytics & KPIs
                            </span>
                          </div>
                        )}
                        <p className="mt-1 text-[11px] font-medium text-muted-foreground line-clamp-2">
                          {item.detail}
                        </p>
                      </div>
                      <span className="mb-1 inline-flex items-center gap-1 rounded-md bg-background/50 px-2 py-0.5 text-[10px] font-bold text-muted-foreground border border-border/40 shrink-0">
                        Open
                        <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>

        {/* ============================================================ */}
        {/* SECTION 1: ACTION REQUIRED (OPERATIONAL COMMAND CENTER)     */}
        {/* ============================================================ */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "size-2 rounded-full",
                  totalActionsCount > 0 ? "bg-amber-500 animate-pulse" : "bg-emerald-500",
                )}
              />
              <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
                Action Required
              </h2>
              {totalActionsCount > 0 ? (
                <Badge
                  variant="secondary"
                  className="rounded-full text-[10px] font-bold px-2 py-0.5 bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                >
                  {totalActionsCount} Critical {totalActionsCount === 1 ? "Item" : "Items"}
                </Badge>
              ) : (
                <Badge
                  variant="secondary"
                  className="rounded-full text-[10px] font-bold px-2 py-0.5 bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                >
                  All Clear
                </Badge>
              )}
            </div>
            <span className="text-[11px] text-muted-foreground">
              Live operational exceptions & pending tasks
            </span>
          </div>

          {error && (
            <Card className="p-4 rounded-2xl border-destructive/40 bg-destructive/10 mb-4">
              <div className="flex items-center justify-between text-xs text-destructive">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="size-4 shrink-0" />
                  <span>{error}</span>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void fetchDashboardData()}
                  className="h-7 text-xs"
                >
                  Retry
                </Button>
              </div>
            </Card>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {/* Card 1: Pending Putaway */}
            <Card
              role="button"
              tabIndex={0}
              className={cn(
                "rounded-2xl border transition-all hover:shadow-subtle p-4 flex flex-col justify-between cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
                actionReq.pending_putaway_count > 0
                  ? "bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/60"
                  : "bg-card/60 border-border/60",
              )}
              onClick={() => openDashboardTarget("/putaway-tasks?status=PENDING")}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  openDashboardTarget("/putaway-tasks?status=PENDING");
                }
              }}
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Pending Putaway
                  </span>
                  <div className="size-8 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center">
                    <PackageCheck className="size-4" />
                  </div>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-black text-foreground">
                    {loading ? "..." : actionReq.pending_putaway_count}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    tasks awaiting bin placement
                  </span>
                </div>
                {actionReq.unassigned_locations_count > 0 && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-400 font-medium mt-1">
                    ⚠️ {actionReq.unassigned_locations_count} unassigned storage bins
                  </p>
                )}
              </div>
              <div className="mt-4 pt-3 border-t border-border/40">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full rounded-xl text-xs font-semibold justify-between bg-background/80 hover:bg-background"
                  onClick={(event) => event.stopPropagation()}
                  asChild
                >
                  <Link to="/putaway-tasks?status=PENDING">
                    Track Putaways <ArrowRight className="size-3.5" />
                  </Link>
                </Button>
              </div>
            </Card>

            {/* Card 2: Store Pickups */}
            <Card
              role="button"
              tabIndex={0}
              className={cn(
                "rounded-2xl border transition-all hover:shadow-subtle p-4 flex flex-col justify-between cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
                actionReq.pending_pickup_count > 0
                  ? "bg-purple-50/50 dark:bg-purple-950/20 border-purple-200 dark:border-purple-800/60"
                  : "bg-card/60 border-border/60",
              )}
              onClick={() => openDashboardTarget("/warehouse/assembly-requisitions")}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  openDashboardTarget("/warehouse/assembly-requisitions");
                }
              }}
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Store Pickups
                  </span>
                  <div className="size-8 rounded-xl bg-purple-500/10 text-purple-600 flex items-center justify-center">
                    <ClipboardCheck className="size-4" />
                  </div>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-black text-foreground">
                    {loading ? "..." : actionReq.pending_pickup_count}
                  </span>
                  <span className="text-xs text-muted-foreground">active picking tasks</span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Assembly requisitions dispatched to Stores
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-border/40">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full rounded-xl text-xs font-semibold justify-between bg-background/80 hover:bg-background"
                  onClick={(event) => event.stopPropagation()}
                  asChild
                >
                  <Link to="/warehouse/assembly-requisitions">
                    Process Pickups <ArrowRight className="size-3.5" />
                  </Link>
                </Button>
              </div>
            </Card>

            {/* Card 3: Active Quarantine */}
            <Card
              role="button"
              tabIndex={0}
              className={cn(
                "rounded-2xl border transition-all hover:shadow-subtle p-4 flex flex-col justify-between cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
                actionReq.active_quarantine_count > 0
                  ? "bg-rose-50/50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-800/60"
                  : "bg-card/60 border-border/60",
              )}
              onClick={() => openDashboardTarget("/warehouse/quarantine")}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  openDashboardTarget("/warehouse/quarantine");
                }
              }}
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Quarantine Stock
                  </span>
                  <div className="size-8 rounded-xl bg-rose-500/10 text-rose-600 flex items-center justify-center">
                    <ShieldAlert className="size-4" />
                  </div>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-black text-foreground">
                    {loading ? "..." : actionReq.active_quarantine_count}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    records ({Number(actionReq.active_quarantine_qty).toLocaleString()} units)
                  </span>
                </div>
                <p className="text-[11px] text-rose-700 dark:text-rose-400 font-medium mt-1">
                  Damaged / segregated stock pending review
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-border/40">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full rounded-xl text-xs font-semibold justify-between bg-background/80 hover:bg-background"
                  onClick={(event) => event.stopPropagation()}
                  asChild
                >
                  <Link to="/warehouse/quarantine">
                    Review Quarantine <ArrowRight className="size-3.5" />
                  </Link>
                </Button>
              </div>
            </Card>

            {/* Card 4: Low Stock Alerts */}
            <Card
              role="button"
              tabIndex={0}
              className={cn(
                "rounded-2xl border transition-all hover:shadow-subtle p-4 flex flex-col justify-between cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
                actionReq.low_stock_count > 0
                  ? "bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/60"
                  : "bg-card/60 border-border/60",
              )}
              onClick={() => openDashboardTarget("/inventory")}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  openDashboardTarget("/inventory");
                }
              }}
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Low Stock Alerts
                  </span>
                  <div className="size-8 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center">
                    <AlertTriangle className="size-4" />
                  </div>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-black text-foreground">
                    {loading ? "..." : actionReq.low_stock_count}
                  </span>
                  <span className="text-xs text-muted-foreground">SKUs below reorder point</span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  {actionReq.out_of_stock_count > 0
                    ? `⚠️ ${actionReq.out_of_stock_count} SKUs currently out of stock`
                    : "No stockouts detected"}
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-border/40">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full rounded-xl text-xs font-semibold justify-between bg-background/80 hover:bg-background"
                  onClick={(event) => event.stopPropagation()}
                  asChild
                >
                  <Link to="/inventory">
                    Inspect Stock <ArrowRight className="size-3.5" />
                  </Link>
                </Button>
              </div>
            </Card>
          </div>
        </div>

        {/* ============================================================ */}
        {/* SECTION 2: INVENTORY SNAPSHOT & STOCK DISTRIBUTION          */}
        {/* ============================================================ */}
        <Card className="rounded-2xl border border-border/60 bg-card/60 shadow-subtle p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-foreground flex items-center gap-2">
                <Boxes className="size-4 text-primary" /> Authoritative Inventory Snapshot
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Physical inventory state: Total On Hand = Available + Allocated + Quarantined
              </p>
            </div>
            <Badge
              variant="outline"
              className="text-[11px] font-mono self-start sm:self-auto py-1 px-2.5"
            >
              Total Tracked SKUs:{" "}
              <span className="font-bold text-foreground ml-1">{inventory.total_skus}</span>
            </Badge>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <div
              role="button"
              tabIndex={0}
              onClick={() => openDashboardTarget("/inventory")}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") openDashboardTarget("/inventory");
              }}
              className="rounded-xl border border-border/40 bg-muted/20 p-3 cursor-pointer transition-all hover:shadow-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
            >
              <p className="text-[11px] font-medium text-muted-foreground uppercase">
                Total On Hand
              </p>
              <p className="text-xl font-black mt-1 text-foreground">
                {Number(inventory.total_on_hand).toLocaleString()}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Physical warehouse units</p>
            </div>

            <div
              role="button"
              tabIndex={0}
              onClick={() => openDashboardTarget("/inventory")}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") openDashboardTarget("/inventory");
              }}
              className="rounded-xl border border-emerald-200/60 dark:border-emerald-800/40 bg-emerald-50/40 dark:bg-emerald-950/20 p-3 cursor-pointer transition-all hover:shadow-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/20"
            >
              <p className="text-[11px] font-medium text-emerald-800 dark:text-emerald-300 uppercase">
                Available Stock
              </p>
              <p className="text-xl font-black mt-1 text-emerald-700 dark:text-emerald-400">
                {Number(inventory.total_available).toLocaleString()}
              </p>
              <p className="text-[10px] text-emerald-600 dark:text-emerald-500 mt-0.5">
                Ready for picking ({availPct}%)
              </p>
            </div>

            <div
              role="button"
              tabIndex={0}
              onClick={() => openDashboardTarget("/inventory")}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") openDashboardTarget("/inventory");
              }}
              className="rounded-xl border border-blue-200/60 dark:border-blue-800/40 bg-blue-50/40 dark:bg-blue-950/20 p-3 cursor-pointer transition-all hover:shadow-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/20"
            >
              <p className="text-[11px] font-medium text-blue-800 dark:text-blue-300 uppercase">
                Allocated Stock
              </p>
              <p className="text-xl font-black mt-1 text-blue-700 dark:text-blue-400">
                {Number(inventory.total_allocated).toLocaleString()}
              </p>
              <p className="text-[10px] text-blue-600 dark:text-blue-500 mt-0.5">
                Reserved for requisitions ({allocPct}%)
              </p>
            </div>

            <div
              role="button"
              tabIndex={0}
              onClick={() => openDashboardTarget("/warehouse/quarantine")}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  openDashboardTarget("/warehouse/quarantine");
                }
              }}
              className="rounded-xl border border-rose-200/60 dark:border-rose-800/40 bg-rose-50/40 dark:bg-rose-950/20 p-3 cursor-pointer transition-all hover:shadow-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/20"
            >
              <p className="text-[11px] font-medium text-rose-800 dark:text-rose-300 uppercase">
                Quarantined Stock
              </p>
              <p className="text-xl font-black mt-1 text-rose-700 dark:text-rose-400">
                {Number(inventory.total_quarantined).toLocaleString()}
              </p>
              <p className="text-[10px] text-rose-600 dark:text-rose-500 mt-0.5">
                Isolated damaged units ({quarPct}%)
              </p>
            </div>
          </div>

          {/* Distribution Bar */}
          <div className="space-y-1.5 pt-2 border-t border-border/40">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Physical Balance Distribution</span>
              <span className="font-mono font-medium">
                {availPct}% Available · {allocPct}% Allocated · {quarPct}% Quarantined
              </span>
            </div>
            <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden flex">
              <div
                style={{ width: `${availPct}%` }}
                className="bg-emerald-500 transition-all"
                title={`Available: ${inventory.total_available}`}
              />
              <div
                style={{ width: `${allocPct}%` }}
                className="bg-blue-500 transition-all"
                title={`Allocated: ${inventory.total_allocated}`}
              />
              <div
                style={{ width: `${quarPct}%` }}
                className="bg-rose-500 transition-all"
                title={`Quarantined: ${inventory.total_quarantined}`}
              />
            </div>
          </div>
        </Card>

        {/* ============================================================ */}
        {/* SECTION 3: PUTAWAY PIPELINE & STORAGE CAPACITY               */}
        {/* ============================================================ */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Left: Putaway Operations Pipeline */}
          <Card className="rounded-2xl border border-border/60 bg-card/60 shadow-subtle p-5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-foreground flex items-center gap-2">
                    <PackageCheck className="size-4 text-primary" /> Putaway Execution Pipeline
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Handling units moving from receiving dock to designated storage bins
                  </p>
                </div>
                <Button variant="ghost" size="sm" className="h-7 text-xs text-primary" asChild>
                  <Link to="/my-store">
                    View in Store Portal <ArrowRight className="size-3.5 ml-1" />
                  </Link>
                </Button>
              </div>

              {/* Status breakdown pills */}
              <div className="grid grid-cols-3 gap-2 mb-4">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => openDashboardTarget("/putaway-tasks?status=PENDING")}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      openDashboardTarget("/putaway-tasks?status=PENDING");
                    }
                  }}
                  className="rounded-xl border border-amber-200 dark:border-amber-800/40 bg-amber-50/40 dark:bg-amber-950/20 p-2.5 text-center cursor-pointer transition-all hover:shadow-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/20"
                >
                  <p className="text-[10px] font-bold uppercase text-amber-800 dark:text-amber-300">
                    Pending
                  </p>
                  <p className="text-lg font-black text-amber-700 dark:text-amber-400 mt-0.5">
                    {putaway.pending_count}
                  </p>
                </div>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => openDashboardTarget("/putaway-tasks?status=IN_PROGRESS")}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      openDashboardTarget("/putaway-tasks?status=IN_PROGRESS");
                    }
                  }}
                  className="rounded-xl border border-blue-200 dark:border-blue-800/40 bg-blue-50/40 dark:bg-blue-950/20 p-2.5 text-center cursor-pointer transition-all hover:shadow-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/20"
                >
                  <p className="text-[10px] font-bold uppercase text-blue-800 dark:text-blue-300">
                    In Progress
                  </p>
                  <p className="text-lg font-black text-blue-700 dark:text-blue-400 mt-0.5">
                    {putaway.in_progress_count}
                  </p>
                </div>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => openDashboardTarget("/putaway-tasks?status=COMPLETED")}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      openDashboardTarget("/putaway-tasks?status=COMPLETED");
                    }
                  }}
                  className="rounded-xl border border-emerald-200 dark:border-emerald-800/40 bg-emerald-50/40 dark:bg-emerald-950/20 p-2.5 text-center cursor-pointer transition-all hover:shadow-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/20"
                >
                  <p className="text-[10px] font-bold uppercase text-emerald-800 dark:text-emerald-300">
                    Completed
                  </p>
                  <p className="text-lg font-black text-emerald-700 dark:text-emerald-400 mt-0.5">
                    {putaway.completed_count}
                  </p>
                </div>
              </div>

              {/* Recent Tasks List */}
              <div className="space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Active & Recent Putaways
                </p>
                {putaway.recent_tasks.length === 0 ? (
                  <div className="py-8 text-center border border-dashed rounded-xl border-border/60 bg-muted/10">
                    <CheckCircle2 className="size-6 text-emerald-500 mx-auto opacity-70 mb-1" />
                    <p className="text-xs text-muted-foreground font-medium">
                      No active putaway tasks
                    </p>
                  </div>
                ) : (
                  putaway.recent_tasks.slice(0, 4).map((t: any) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between p-2.5 rounded-xl border border-border/40 bg-background/50 hover:bg-muted/20 transition-colors"
                    >
                      <div className="min-w-0 flex-1 pr-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-foreground">
                            {t.task_number}
                          </span>
                          <StatusBadge status={t.status} />
                        </div>
                        <p className="text-xs text-foreground font-medium truncate mt-0.5">
                          {t.material_name} ({t.item_code})
                        </p>
                        <p className="text-[10px] text-muted-foreground font-mono">
                          GRN: {t.grn_number} · Dest:{" "}
                          {t.destination_bin_code || t.destination_zone || "Unassigned"}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="font-mono text-xs font-bold text-foreground">
                          {Number(t.quantity).toLocaleString()} {t.uom}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </Card>

          {/* Right: Storage Hierarchy & Capacity */}
          <Card className="rounded-2xl border border-border/60 bg-card/60 shadow-subtle p-5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-foreground flex items-center gap-2">
                    <Building2 className="size-4 text-primary" /> Storage Location Hierarchy
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Physical hierarchy: Warehouse → Store → Zone → Bin
                  </p>
                </div>
                <Button variant="ghost" size="sm" className="h-7 text-xs text-primary" asChild>
                  <Link to="/warehouse/stores">
                    Manage Stores <ArrowRight className="size-3 ml-1" />
                  </Link>
                </Button>
              </div>

              {/* Hierarchy Metrics */}
              <div className="grid grid-cols-3 gap-2 mb-4">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => openDashboardTarget("/warehouse/stores")}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      openDashboardTarget("/warehouse/stores");
                    }
                  }}
                  className="rounded-xl border border-border/40 bg-muted/20 p-2.5 text-center cursor-pointer transition-all hover:shadow-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                >
                  <p className="text-[10px] font-bold uppercase text-muted-foreground">Stores</p>
                  <p className="text-lg font-black text-foreground mt-0.5">
                    {storage.total_stores}
                  </p>
                </div>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => openDashboardTarget("/warehouse/stores")}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      openDashboardTarget("/warehouse/stores");
                    }
                  }}
                  className="rounded-xl border border-border/40 bg-muted/20 p-2.5 text-center cursor-pointer transition-all hover:shadow-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                >
                  <p className="text-[10px] font-bold uppercase text-muted-foreground">Zones</p>
                  <p className="text-lg font-black text-foreground mt-0.5">{storage.total_zones}</p>
                </div>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => openDashboardTarget("/warehouse/stores")}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      openDashboardTarget("/warehouse/stores");
                    }
                  }}
                  className="rounded-xl border border-border/40 bg-muted/20 p-2.5 text-center cursor-pointer transition-all hover:shadow-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                >
                  <p className="text-[10px] font-bold uppercase text-muted-foreground">
                    Total Bins
                  </p>
                  <p className="text-lg font-black text-foreground mt-0.5">{storage.total_bins}</p>
                </div>
              </div>

              {/* Bin Occupancy Progress */}
              <div className="p-3.5 rounded-xl border border-border/40 bg-muted/10 mb-4 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-foreground">Bin Capacity Utilization</span>
                  <span className="font-mono font-bold text-primary">
                    {binOccupancyPct}% Occupied
                  </span>
                </div>
                <Progress value={binOccupancyPct} className="h-2 rounded-full" />
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden flex">
                  <div
                    style={{ width: `${occupiedBinPct}%` }}
                    className="bg-primary transition-all"
                    title={`Occupied bins: ${storage.occupied_bins}`}
                  />
                  <div
                    style={{ width: `${availableBinPct}%` }}
                    className="bg-emerald-500 transition-all"
                    title={`Available bins: ${storage.available_bins}`}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1">
                  <span>
                    Occupied: <strong className="text-foreground">{storage.occupied_bins}</strong>
                  </span>
                  <span>
                    Available:{" "}
                    <strong className="text-emerald-600 dark:text-emerald-400">
                      {storage.available_bins}
                    </strong>
                  </span>
                </div>
              </div>

              {/* Storage Quick Links */}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-xl text-xs justify-start h-9"
                  asChild
                >
                  <Link to="/warehouse/stores">
                    <Building2 className="size-3.5 mr-2 text-primary" /> Store & Bin Master
                  </Link>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-xl text-xs justify-start h-9"
                  asChild
                >
                  <Link to="/dock-management">
                    <Warehouse className="size-3.5 mr-2 text-blue-600" /> Dock Management
                  </Link>
                </Button>
              </div>
            </div>
          </Card>
        </div>

        {/* ============================================================ */}
        {/* SECTION 3: ASSEMBLY PICKUP QUEUE                            */}
        {/* ============================================================ */}
        <Card className="rounded-2xl border border-purple-500/20 bg-purple-500/5 shadow-subtle p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-foreground flex items-center gap-2">
                <ClipboardCheck className="size-4 text-purple-600" /> Assembly Pickup Requests
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Store pickup tasks created from assembly material requisitions
              </p>
            </div>
            <Button variant="outline" size="sm" className="rounded-xl text-xs" asChild>
              <Link to="/warehouse/assembly-requisitions">
                Open requisitions <ArrowRight className="size-3.5 ml-1.5" />
              </Link>
            </Button>
          </div>
          {actionReq.pending_pickups?.length ? (
            <div className="grid gap-2 lg:grid-cols-2">
              {actionReq.pending_pickups.map((task: any) => (
                <div key={task.id} className="rounded-xl border bg-background/70 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-xs font-bold text-primary">
                        {task.requisition_number || task.task_number}
                      </p>
                      <p className="truncate text-sm font-semibold">
                        {task.material_name || task.material_code}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {task.requested_quantity ?? task.quantity} {task.uom} · {task.store_name || "Store pending"}
                      </p>
                    </div>
                    <Badge className="shrink-0 bg-purple-500/15 text-purple-700 dark:text-purple-300">
                      {(task.status || "PENDING").replaceAll("_", " ")}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">
              No active assembly pickup requests.
            </div>
          )}
        </Card>

        {/* ============================================================ */}
        {/* SECTION 4: LIVE WAREHOUSE ACTIVITY FEED                     */}
        {/* ============================================================ */}
        <Card className="rounded-2xl border border-border/60 bg-card/60 shadow-subtle p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-foreground flex items-center gap-2">
                <Activity className="size-4 text-primary" /> Live Warehouse Activity & Movements
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Real-time stream of putaway completions, material issues, quarantine events, and
                stock movements
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px] font-mono py-0.5 px-2">
                Authoritative Stock Ledger
              </Badge>
              <Button variant="ghost" size="sm" className="h-7 text-xs text-primary" asChild>
                <Link to="/reports">
                  View All <ArrowRight className="size-3.5 ml-1" />
                </Link>
              </Button>
            </div>
          </div>

          {activity.length === 0 ? (
            <div className="py-10 text-center border border-dashed rounded-xl border-border/60 bg-muted/10">
              <Activity className="size-7 text-muted-foreground mx-auto opacity-40 mb-1" />
              <p className="text-xs text-muted-foreground font-semibold">
                No recent warehouse transactions
              </p>
              <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                Completed putaways, store issues, and quarantine movements will appear here
                automatically.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/40">
              {activity.map((act: any) => (
                <div
                  key={act.id}
                  className="py-3 flex items-start justify-between gap-3 first:pt-0 last:pb-0"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div
                      className={cn(
                        "size-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5",
                        act.tone === "success" &&
                        "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
                        act.tone === "warning" &&
                        "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
                        act.tone === "purple" &&
                        "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300",
                        act.tone === "danger" &&
                        "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
                        (!act.tone || act.tone === "primary") && "bg-primary/10 text-primary",
                      )}
                    >
                      {act.type === "PUTAWAY" ? (
                        <PackageCheck className="size-3.5" />
                      ) : act.type === "PICKUP" ? (
                        <ClipboardCheck className="size-3.5" />
                      ) : act.type === "QUARANTINE" ? (
                        <ShieldAlert className="size-3.5" />
                      ) : (
                        <Activity className="size-3.5" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-foreground leading-tight">{act.title}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                        {act.detail}
                      </p>
                    </div>
                  </div>
                  <span className="font-mono text-[10px] text-muted-foreground shrink-0 mt-0.5 whitespace-nowrap">
                    {new Date(act.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
