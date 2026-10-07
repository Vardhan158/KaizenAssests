import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  Truck,
  Package,
  CheckCircle2,
  Clock,
  AlertTriangle,
  RefreshCw,
  Loader2,
  Search,
  Navigation,
  ShieldCheck,
  ClipboardList,
  MapPin,
  FileText,
  Boxes,
  Eye,
  X,
  Calendar,
  Building2,
  UserCheck,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell, StatusBadge } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api-client";
import { requireRole } from "@/lib/auth-utils";

export const Route = createFileRoute("/warehouse/dispatch-tracking")({
  beforeLoad: () =>
    requireRole(["WAREHOUSE", "WAREHOUSE_MANAGER", "STORE_MANAGER", "STORE_KEEPER", "ADMIN", "SUPERUSER"]),
  component: WarehouseDispatchTrackingPage,
});

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  const date = new Date(String(dateStr));
  if (Number.isNaN(date.getTime())) return String(dateStr).split("T")[0] || "-";
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  const date = new Date(String(dateStr));
  if (Number.isNaN(date.getTime())) return String(dateStr);
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getStepIndex(status: string): number {
  const s = (status || "").toLowerCase().replace(/[\s_-]+/g, "");
  if (s.includes("delivered") || s.includes("closed")) return 6;
  if (s.includes("intransit") || s.includes("dispatched") || s.includes("gateexit") || s.includes("gateout")) return 5;
  if (s.includes("readyforgateexit") || s.includes("dispatchready")) return 4;
  if (s.includes("loaded") || s.includes("loading")) return 3;
  if (s.includes("packed") || s.includes("packing") || s.includes("picked") || s.includes("picking")) return 2;
  if (s.includes("reserved") || s.includes("stockreserved")) return 1;
  return 0;
}

const LIFECYCLE_STEPS = [
  { label: "Created / Planned", description: "Order Registered" },
  { label: "Stock Reserved", description: "FG Allocated" },
  { label: "Picking & Packing", description: "Warehouse Staging" },
  { label: "Loading Verified", description: "Vehicle Loaded" },
  { label: "Ready for Exit", description: "Docs & QC Ready" },
  { label: "Gate Exit / In Transit", description: "Outbound Departure" },
  { label: "Delivered", description: "POD Confirmed" },
];

function WarehouseDispatchTrackingPage() {
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
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [selectedDispatch, setSelectedDispatch] = useState<any | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [dispatchRes, readyRes, kpiRes] = await Promise.all([
        api.getDispatches(),
        api.getDispatchesReadyForGateExit().catch(() => []),
        api.getDispatchKpis().catch(() => null),
      ]);
      setDispatches(dispatchRes?.items || []);
      setReadyForGateExit(readyRes || []);
      if (kpiRes) {
        setKpis(kpiRes);
      }
    } catch (e) {
      toast.error("Failed to load dispatch tracking data", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleOpenDetails = (dispatch: any) => {
    setSelectedDispatch(dispatch);
    setIsDetailsOpen(true);
  };

  const filteredDispatches = dispatches.filter((d) => {
    const q = searchQuery.toLowerCase().trim();
    const dNum = String(d.dispatch_number || "").toLowerCase();
    const oNum = String(d.order_number || "").toLowerCase();
    const cust = String(d.customer_name || "").toLowerCase();
    const dest = String(d.destination || "").toLowerCase();
    const itemsMatch = (d.items || []).some((it: any) =>
      String(it.material_code || "").toLowerCase().includes(q) ||
      String(it.material_name || "").toLowerCase().includes(q)
    );

    const matchesSearch =
      !q ||
      dNum.includes(q) ||
      oNum.includes(q) ||
      cust.includes(q) ||
      dest.includes(q) ||
      itemsMatch;

    if (!matchesSearch) return false;

    if (statusFilter === "ALL") return true;
    const s = String(d.status || "").toUpperCase();
    if (statusFilter === "PENDING") {
      return ["DRAFT", "PLANNED", "STOCK RESERVED", "STOCK_RESERVED"].includes(s);
    }
    if (statusFilter === "PICKING_PACKING") {
      return ["PICKING", "PICKED", "PACKING", "PACKED"].includes(s);
    }
    if (statusFilter === "LOADING") {
      return ["LOADING", "LOADED", "DRIVER ASSIGNED", "VEHICLE ASSIGNED"].includes(s);
    }
    if (statusFilter === "READY_FOR_EXIT") {
      return ["READY FOR GATE EXIT", "READY_FOR_GATE_EXIT", "DISPATCH READY", "DISPATCH_READY"].includes(s);
    }
    if (statusFilter === "IN_TRANSIT") {
      return ["DISPATCHED", "IN TRANSIT", "IN_TRANSIT", "GATE_EXITED", "EXITED"].includes(s);
    }
    if (statusFilter === "DELIVERED") {
      return ["DELIVERED", "CLOSED"].includes(s);
    }
    if (statusFilter === "EXCEPTIONS") {
      return ["CANCELLED", "ON HOLD", "DELAYED", "RETURNED"].includes(s);
    }
    return true;
  });

  return (
    <AppShell
      title="Finished Goods Dispatch Tracking"
      subtitle="Warehouse visibility for outbound finished goods dispatches, stage progress, and gate exit status"
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" className="rounded-xl gap-2" onClick={() => void loadData()}>
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Link to="/warehouse/finished-goods-store" className="rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-muted">Finished Goods Store</Link>
          <Link to="/inventory" className="rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-muted">Inventory</Link>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Metric Summary Cards */}
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
          <Card className="rounded-2xl border-border/70 p-4 shadow-soft">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
                <Truck className="size-5" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Total Outbound</p>
                <p className="text-xl font-bold tracking-tight text-foreground">{dispatches.length}</p>
              </div>
            </div>
          </Card>

          <Card className="rounded-2xl border-border/70 p-4 shadow-soft">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <Boxes className="size-5" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pick & Pack</p>
                <p className="text-xl font-bold tracking-tight text-foreground">
                  {(kpis.picking || 0) + (kpis.packing || 0)}
                </p>
              </div>
            </div>
          </Card>

          <Card className="rounded-2xl border-border/70 p-4 shadow-soft">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400">
                <Navigation className="size-5" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Loading</p>
                <p className="text-xl font-bold tracking-tight text-foreground">{kpis.loading || 0}</p>
              </div>
            </div>
          </Card>

          <Card className="rounded-2xl border-border/70 p-4 shadow-soft">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <ShieldCheck className="size-5" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ready for Exit</p>
                <p className="text-xl font-bold tracking-tight text-foreground">
                  {readyForGateExit.length || kpis.ready_for_gate_exit || kpis.dispatch_ready || 0}
                </p>
              </div>
            </div>
          </Card>

          <Card className="rounded-2xl border-border/70 p-4 shadow-soft">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-400">
                <MapPin className="size-5" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">In Transit</p>
                <p className="text-xl font-bold tracking-tight text-foreground">{kpis.in_transit || kpis.dispatched || 0}</p>
              </div>
            </div>
          </Card>

          <Card className="rounded-2xl border-border/70 p-4 shadow-soft">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-600/10 text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="size-5" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Delivered</p>
                <p className="text-xl font-bold tracking-tight text-foreground">{kpis.delivered || 0}</p>
              </div>
            </div>
          </Card>
        </div>

        {/* Filter Controls & Search */}
        <Card className="rounded-2xl border-border/80 p-5 shadow-soft">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by Dispatch #, Sales Order, Customer, or Product..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 rounded-xl"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>

            {/* Status Tabs Filter */}
            <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto pb-1 text-xs">
              {[
                { id: "ALL", label: "All Dispatches" },
                { id: "PENDING", label: "Pending & Reserved" },
                { id: "PICKING_PACKING", label: "Pick / Pack" },
                { id: "LOADING", label: "Loading" },
                { id: "READY_FOR_EXIT", label: "Ready for Exit" },
                { id: "IN_TRANSIT", label: "In Transit" },
                { id: "DELIVERED", label: "Delivered" },
                { id: "EXCEPTIONS", label: "Exceptions" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setStatusFilter(tab.id)}
                  className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                    statusFilter === tab.id
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </Card>

        {/* Dispatch Orders Table */}
        <Card className="rounded-2xl border-border/80 shadow-soft overflow-hidden">
          {loading ? (
            <div className="flex h-64 flex-col items-center justify-center gap-3">
              <Loader2 className="size-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Loading dispatch tracking records...</p>
            </div>
          ) : filteredDispatches.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center gap-2 p-8 text-center">
              <Truck className="size-10 text-muted-foreground/50" />
              <h3 className="font-semibold text-foreground">No dispatch orders found</h3>
              <p className="text-xs text-muted-foreground max-w-sm">
                {searchQuery || statusFilter !== "ALL"
                  ? "Try clearing filters or search query to see other dispatch records."
                  : "No finished goods dispatch orders have been initiated yet."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead className="font-semibold">Dispatch Order</TableHead>
                    <TableHead className="font-semibold">Customer & Destination</TableHead>
                    <TableHead className="font-semibold">Finished Goods</TableHead>
                    <TableHead className="font-semibold text-center">Quantity</TableHead>
                    <TableHead className="font-semibold text-center">Pick & Pack</TableHead>
                    <TableHead className="font-semibold text-center">Loading Status</TableHead>
                    <TableHead className="font-semibold text-center">Gate Exit Status</TableHead>
                    <TableHead className="font-semibold text-center">Dispatch Status</TableHead>
                    <TableHead className="text-right font-semibold">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDispatches.map((d) => {
                    const items = d.items || [];
                    const totOrdered = items.reduce((acc: number, it: any) => acc + Number(it.quantity_ordered || 0), 0);
                    const totPicked = items.reduce((acc: number, it: any) => acc + Number(it.quantity_picked || 0), 0);
                    const totPacked = items.reduce((acc: number, it: any) => acc + Number(it.quantity_packed || 0), 0);
                    const totLoaded = items.reduce((acc: number, it: any) => acc + Number(it.quantity_loaded || 0), 0);
                    const statusStr = String(d.status || "").toUpperCase();

                    const isReadyExit =
                      statusStr.includes("READY FOR GATE EXIT") ||
                      statusStr.includes("READY_FOR_GATE_EXIT") ||
                      statusStr.includes("DISPATCH READY") ||
                      readyForGateExit.some((r) => r.id === d.id || r.dispatch_number === d.dispatch_number);

                    const isExited =
                      statusStr.includes("DISPATCHED") ||
                      statusStr.includes("IN TRANSIT") ||
                      statusStr.includes("IN_TRANSIT") ||
                      statusStr.includes("GATE_EXITED") ||
                      statusStr.includes("DELIVERED") ||
                      statusStr.includes("CLOSED");

                    return (
                      <TableRow key={d.id || d.dispatch_number} className="hover:bg-muted/30 transition-colors">
                        {/* Dispatch Order */}
                        <TableCell>
                          <div className="space-y-0.5">
                            <span className="font-mono font-bold text-foreground text-sm">
                              {d.dispatch_number || "-"}
                            </span>
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <span>Ref: {d.order_number || "-"}</span>
                              {d.priority && (
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] px-1 py-0 ${
                                    String(d.priority).toUpperCase() === "URGENT" || String(d.priority).toUpperCase() === "HIGH"
                                      ? "border-rose-300 text-rose-600 bg-rose-50 dark:bg-rose-950/40"
                                      : "border-slate-200 text-muted-foreground"
                                  }`}
                                >
                                  {d.priority}
                                </Badge>
                              )}
                            </div>
                            <div className="text-[11px] text-muted-foreground/80">
                              {formatDate(d.scheduled_date || d.created_at)}
                            </div>
                          </div>
                        </TableCell>

                        {/* Customer & Destination */}
                        <TableCell>
                          <div className="space-y-0.5 max-w-[200px]">
                            <p className="font-medium text-foreground text-sm truncate">{d.customer_name || "-"}</p>
                            <p className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                              <MapPin className="size-3 shrink-0 text-muted-foreground" />
                              {d.destination || d.delivery_address || "-"}
                            </p>
                          </div>
                        </TableCell>

                        {/* Finished Goods */}
                        <TableCell>
                          <div className="space-y-1 max-w-[220px]">
                            {items.slice(0, 2).map((it: any, idx: number) => (
                              <div key={idx} className="text-xs flex items-center justify-between gap-2">
                                <span className="font-mono text-muted-foreground shrink-0">{it.material_code}</span>
                                <span className="truncate text-foreground font-medium">{it.material_name}</span>
                              </div>
                            ))}
                            {items.length > 2 && (
                              <p className="text-[11px] text-muted-foreground italic">
                                + {items.length - 2} more item(s)
                              </p>
                            )}
                            {items.length === 0 && <span className="text-xs text-muted-foreground italic">-</span>}
                          </div>
                        </TableCell>

                        {/* Quantity */}
                        <TableCell className="text-center font-mono">
                          <span className="font-semibold text-foreground">{totOrdered}</span>
                          <span className="text-xs text-muted-foreground ml-1">
                            {items[0]?.uom || "-"}
                          </span>
                        </TableCell>

                        {/* Pick & Pack Progress */}
                        <TableCell className="text-center">
                          <div className="inline-flex flex-col items-center gap-1">
                            <span
                              className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                                totPacked >= totOrdered && totOrdered > 0
                                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                                  : totPicked > 0 || totPacked > 0
                                  ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                                  : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                              }`}
                            >
                              {totPacked >= totOrdered && totOrdered > 0
                                ? "PACKED"
                                : totPicked > 0
                                ? `PICK: ${totPicked}/${totOrdered}`
                                : "PENDING"}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {totPicked > 0 ? `Packed: ${totPacked}/${totOrdered}` : "Awaiting Pick"}
                            </span>
                          </div>
                        </TableCell>

                        {/* Loading Status */}
                        <TableCell className="text-center">
                          <span
                            className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                              totLoaded >= totOrdered && totOrdered > 0
                                ? "bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300"
                                : totLoaded > 0
                                ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                                : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                            }`}
                          >
                            {totLoaded >= totOrdered && totOrdered > 0
                              ? "LOADED"
                              : totLoaded > 0
                              ? `LOADING (${totLoaded}/${totOrdered})`
                              : "PENDING"}
                          </span>
                        </TableCell>

                        {/* Gate Exit Status */}
                        <TableCell className="text-center">
                          {isExited ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                              <CheckCircle2 className="size-3" /> Gate Exited
                            </span>
                          ) : isReadyExit ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                              <ShieldCheck className="size-3" /> Ready for Exit
                            </span>
                          ) : (
                            <span className="text-[11px] text-muted-foreground bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
                              Pending Loading
                            </span>
                          )}
                        </TableCell>

                        {/* Dispatch Status */}
                        <TableCell className="text-center">
                          <StatusBadge status={d.status || "-"} />
                        </TableCell>

                        {/* Action */}
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            className="rounded-xl text-xs gap-1.5 hover:bg-primary hover:text-primary-foreground transition-all"
                            onClick={() => handleOpenDetails(d)}
                          >
                            <Eye className="size-3.5" /> View Tracking
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      </div>

      {/* Read-Only Dispatch Tracking Details Dialog */}
      <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto p-0 rounded-2xl">
          {selectedDispatch && (
            <div className="space-y-6 p-6">
              {/* Modal Header */}
              <div className="flex items-start justify-between border-b border-border/70 pb-4">
                <div>
                  <div className="flex items-center gap-2.5">
                    <h2 className="text-xl font-bold tracking-tight text-foreground font-mono">
                      {selectedDispatch.dispatch_number}
                    </h2>
                    <StatusBadge status={selectedDispatch.status} />
                    {selectedDispatch.priority && (
                      <Badge variant="outline" className="text-xs uppercase font-semibold">
                        {selectedDispatch.priority}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Sales Order: <span className="font-semibold text-foreground">{selectedDispatch.order_number || "-"}</span> · Created: {formatDateTime(selectedDispatch.created_at)}
                  </p>
                </div>
              </div>

              {/* Notice Banner */}
              <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-3.5 text-xs text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-200 flex items-center gap-3">
                <FileText className="size-5 text-blue-600 dark:text-blue-400 shrink-0" />
                <div>
                  <p className="font-semibold">Warehouse Read-Only Tracking View</p>
                  <p className="text-[11px] text-blue-800/80 dark:text-blue-300/80">
                    This view displays live outbound status, picking/packing staging, and gate exit status. Operational actions (picking, packing, loading verification, gate exit pass generation) are managed through the Dispatch and Security operations.
                  </p>
                </div>
              </div>

              {/* Progress Stepper */}
              <div className="rounded-xl border border-border/80 p-4 bg-muted/20">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-4">
                  Outbound Lifecycle Tracking
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
                  {LIFECYCLE_STEPS.map((step, idx) => {
                    const currentIdx = getStepIndex(selectedDispatch.status);
                    const isCompleted = idx <= currentIdx;
                    const isCurrent = idx === currentIdx;

                    return (
                      <div
                        key={idx}
                        className={`flex flex-col p-2.5 rounded-lg border text-center transition-all ${
                          isCurrent
                            ? "border-primary bg-primary/10 text-foreground font-semibold shadow-sm"
                            : isCompleted
                            ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/50 dark:bg-emerald-950/30 text-foreground"
                            : "border-border/50 bg-muted/30 text-muted-foreground opacity-60"
                        }`}
                      >
                        <div className="flex items-center justify-center mb-1">
                          {isCompleted ? (
                            <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
                          ) : (
                            <span className="size-4 flex items-center justify-center text-[10px] font-bold rounded-full bg-muted text-muted-foreground">
                              {idx + 1}
                            </span>
                          )}
                        </div>
                        <span className="text-xs font-medium truncate">{step.label}</span>
                        <span className="text-[10px] text-muted-foreground truncate">{step.description}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Customer & Transport Details Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card className="p-4 rounded-xl border-border/80">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
                    <Building2 className="size-3.5" /> Customer & Destination
                  </h4>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Customer:</span>
                      <span className="font-semibold text-foreground">{selectedDispatch.customer_name || "-"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Destination:</span>
                      <span className="font-semibold text-foreground">{selectedDispatch.destination || "-"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Delivery Address:</span>
                      <span className="font-medium text-foreground text-right max-w-[200px] truncate">
                        {selectedDispatch.delivery_address || "-"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Warehouse:</span>
                      <span className="font-medium text-foreground">{selectedDispatch.warehouse_id || "-"}</span>
                    </div>
                  </div>
                </Card>

                <Card className="p-4 rounded-xl border-border/80">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
                    <Truck className="size-3.5" /> Logistics & Transport
                  </h4>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Route Code:</span>
                      <span className="font-mono font-medium text-foreground">{selectedDispatch.route_code || "-"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Scheduled Date:</span>
                      <span className="font-medium text-foreground">{formatDate(selectedDispatch.scheduled_date)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Expected Delivery:</span>
                      <span className="font-medium text-foreground">{formatDate(selectedDispatch.expected_delivery_date)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Special Instructions:</span>
                      <span className="text-foreground italic max-w-[200px] truncate">
                        {selectedDispatch.notes || "-"}
                      </span>
                    </div>
                  </div>
                </Card>
              </div>

              {/* Line Items Breakdown Table */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Finished Goods Manifest
                </h4>
                <div className="rounded-xl border border-border/80 overflow-hidden">
                  <Table>
                    <TableHeader className="bg-muted/40">
                      <TableRow>
                        <TableHead className="text-xs font-semibold">Material Code</TableHead>
                        <TableHead className="text-xs font-semibold">Finished Product</TableHead>
                        <TableHead className="text-xs font-semibold text-center">Ordered</TableHead>
                        <TableHead className="text-xs font-semibold text-center">Reserved</TableHead>
                        <TableHead className="text-xs font-semibold text-center">Picked</TableHead>
                        <TableHead className="text-xs font-semibold text-center">Packed</TableHead>
                        <TableHead className="text-xs font-semibold text-center">Loaded</TableHead>
                        <TableHead className="text-xs font-semibold text-center">UOM</TableHead>
                        <TableHead className="text-xs font-semibold text-right">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(selectedDispatch.items || []).map((it: any, idx: number) => (
                        <TableRow key={idx}>
                          <TableCell className="font-mono text-xs font-medium text-foreground">{it.material_code}</TableCell>
                          <TableCell className="text-xs font-medium text-foreground">{it.material_name}</TableCell>
                          <TableCell className="text-xs text-center font-mono font-semibold">{it.quantity_ordered}</TableCell>
                          <TableCell className="text-xs text-center font-mono text-muted-foreground">{it.quantity_reserved ?? "-"}</TableCell>
                          <TableCell className="text-xs text-center font-mono text-muted-foreground">{it.quantity_picked ?? "-"}</TableCell>
                          <TableCell className="text-xs text-center font-mono text-muted-foreground">{it.quantity_packed ?? "-"}</TableCell>
                          <TableCell className="text-xs text-center font-mono text-muted-foreground">{it.quantity_loaded ?? "-"}</TableCell>
                          <TableCell className="text-xs text-center text-muted-foreground">{it.uom || "-"}</TableCell>
                          <TableCell className="text-xs text-right">
                            <StatusBadge status={it.status || selectedDispatch.status} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Close Button */}
              <div className="flex justify-end pt-2">
                <Button variant="outline" className="rounded-xl text-xs" onClick={() => setIsDetailsOpen(false)}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
