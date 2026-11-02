import { InformationTooltip } from "@/components/ui/information-tooltip";
import { useSearch, createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/wms/app-shell";
import { requireRole } from "@/lib/auth-utils";
import { api, type AssemblyProductionOrder } from "@/lib/api-client";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  Factory,
  Filter,
  LayoutDashboard,
  Package,
  Play,
  PlusCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  User,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { parsePositiveNumber } from "@/lib/input-validation";
import { FgQrInput } from "@/components/wms/fg-qr-input";
import type { AssemblyMaterialConsumptionSummary, AssemblyMaterialQrVerification } from "@/lib/api-client";

export const Route = createFileRoute("/assembly/production")({
  beforeLoad: () => requireRole(["ASSEMBLY_MANAGER", "ASSEMBLY", "ADMIN", "SUPERUSER"]),
  head: () => ({ meta: [{ title: "Production · KaizenAssests" }] }),
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
  if (s === "REJECTED") {
    return <Badge variant="outline" className="border-rose-300 bg-rose-50 text-rose-700">Request Rejected</Badge>;
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
  const moduleSearchParams = useSearch({ strict: false }) as { search?: string };
  useEffect(() => { if (typeof moduleSearchParams.search === "string") setSearch(moduleSearchParams.search); }, [moduleSearchParams.search]);
  const [statusFilter, setStatusFilter] = useState("ALL");

  // Complete Production Modal State
  const [completeOrder, setCompleteOrder] = useState<AssemblyProductionOrder | null>(null);
  const [producedQuantity, setProducedQuantity] = useState<number>(0);
  const [completing, setCompleting] = useState(false);

  // Start Production Confirmation State
  const [startingOrderId, setStartingOrderId] = useState<string | null>(null);
  const [consumptionOrder, setConsumptionOrder] = useState<AssemblyProductionOrder | null>(null);
  const [consumptionSummary, setConsumptionSummary] = useState<AssemblyMaterialConsumptionSummary | null>(null);
  const [scannedQr, setScannedQr] = useState("");
  const [verifiedMaterial, setVerifiedMaterial] = useState<AssemblyMaterialQrVerification | null>(null);
  const [consumptionQty, setConsumptionQty] = useState("");
  const [verifyingQr, setVerifyingQr] = useState(false);
  const [savingConsumption, setSavingConsumption] = useState(false);
  const [consumptionError, setConsumptionError] = useState("");
  const [pendingConsumptionKey, setPendingConsumptionKey] = useState<{ fingerprint: string; key: string } | null>(null);

  const loadConsumptionSummary = async (orderId: string) => {
    const summary = await api.getAssemblyMaterialConsumption(orderId);
    setConsumptionSummary(summary);
    return summary;
  };

  const handleOpenConsumption = async (order: AssemblyProductionOrder) => {
    setConsumptionOrder(order);
    setScannedQr(""); setVerifiedMaterial(null); setConsumptionQty(""); setConsumptionError("");
    setConsumptionSummary(null);
    try { await loadConsumptionSummary(order.id); }
    catch (error: any) { setConsumptionError(error.message || "Could not load consumption history"); }
  };

  const handleVerifyMaterialQr = async () => {
    if (!consumptionOrder || !scannedQr.trim()) return;
    setVerifyingQr(true); setConsumptionError(""); setVerifiedMaterial(null); setConsumptionQty("");
    try {
      const verified = await api.verifyAssemblyMaterialQr(consumptionOrder.id, scannedQr.trim());
      setVerifiedMaterial(verified);
    } catch (error: any) { setConsumptionError(error.message || "Material QR could not be verified"); }
    finally { setVerifyingQr(false); }
  };

  const handleSaveConsumption = async () => {
    if (!consumptionOrder || !verifiedMaterial) return;
    const quantity = parsePositiveNumber(consumptionQty);
    if (quantity === null) { setConsumptionError("Enter a valid quantity greater than zero."); return; }
    if (quantity > verifiedMaterial.remaining_quantity) {
      setConsumptionError(`Quantity exceeds the verified remaining ${verifiedMaterial.remaining_quantity} ${verifiedMaterial.uom}.`); return;
    }
    const fingerprint = `${consumptionOrder.id}:${verifiedMaterial.material_qr}:${quantity}`;
    const idempotencyKey = pendingConsumptionKey?.fingerprint === fingerprint
      ? pendingConsumptionKey.key : crypto.randomUUID();
    setPendingConsumptionKey({ fingerprint, key: idempotencyKey });
    setSavingConsumption(true); setConsumptionError("");
    try {
      const result = await api.recordAssemblyMaterialConsumption(consumptionOrder.id, {
        material_code: verifiedMaterial.material_code, grn_batch_id: verifiedMaterial.grn_batch_id,
        material_qr: verifiedMaterial.material_qr, actual_consumed: quantity, uom: verifiedMaterial.uom,
        idempotency_key: idempotencyKey,
      });
      toast.success(`Recorded ${result.consumed_quantity} ${result.uom} from batch ${verifiedMaterial.batch_number}`);
      setScannedQr(""); setVerifiedMaterial(null); setConsumptionQty("");
      setPendingConsumptionKey(null);
      await loadConsumptionSummary(consumptionOrder.id);
      await fetchOrders();
    } catch (error: any) {
      setConsumptionError(error.message || "Consumption could not be recorded. Retry the same quantity to safely replay the request.");
    }
    finally { setSavingConsumption(false); }
  };

  const fetchOrders = async (isManual = false) => {
    if (isManual) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await api.getAssemblyProductionOrders();
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
  }, []);

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

  const handleOpenCompleteModal = async (order: AssemblyProductionOrder) => {
    if (order.traceability_required) {
      try {
        const summary = await api.getAssemblyMaterialConsumption(order.id);
        if (!summary.can_complete) {
          toast.error(`Record verified consumption for: ${summary.missing_material_codes.join(", ")}`);
          return;
        }
      } catch (error: any) { toast.error(error.message || "Could not verify material consumption"); return; }
    }
    setCompleteOrder(order);
    setProducedQuantity(order.target_quantity);
  };

  const handleCompleteSubmit = async () => {
    if (!completeOrder) return;
    const validProducedQuantity = parsePositiveNumber(producedQuantity);
    if (validProducedQuantity === null) {
      toast.error("Produced quantity must be greater than 0");
      return;
    }
    if (validProducedQuantity > completeOrder.target_quantity) {
      toast.error("Produced quantity cannot exceed the target quantity");
      return;
    }

    try {
      setCompleting(true);
      const res = await api.completeAssemblyProduction(completeOrder.id, {
        produced_quantity: validProducedQuantity,
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
  const completedCount = orders.filter(
    (o) => o.status === "COMPLETED" || o.status === "CLOSED",
  ).length;

  // Local text search
  const filteredOrders = useMemo(() => {
    const q = search.toLowerCase().trim();
    return orders.filter(
      (o) =>
        (statusFilter === "ALL" ||
          (statusFilter === "READY"
            ? o.can_start
            : statusFilter === "IN_PRODUCTION"
              ? o.can_complete
              : ["QC_PENDING", "COMPLETED", "CLOSED"].includes(o.status))) &&
        (!q ||
          [o.order_number, o.product_name, o.product_code, o.material_request_number].some(
            (value) => value?.toLowerCase().includes(q),
          )),
    );
  }, [orders, search, statusFilter]);
  const [productionPage, setProductionPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(filteredOrders.length / 10));
  const currentPage = Math.min(productionPage, pageCount);
  const pageStart = (currentPage - 1) * 10;
  const pagedOrders = filteredOrders.slice(pageStart, pageStart + 10);
  useEffect(() => { setProductionPage(1); }, [search, statusFilter]);
  useEffect(() => { setProductionPage(page => Math.min(page, pageCount)); }, [pageCount]);


  return (
    <AppShell
      title="Production"
      subtitle="Assembly work center operations, step execution, and production recording"
      actions={
        <div className="flex flex-wrap items-center gap-2.5">
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
          <Button data-refresh-control="true" aria-label="Refresh" title="Refresh"
            variant="outline"
            size="sm"
            onClick={() => fetchOrders(true)}
            disabled={refreshing}
            className="rounded-xl text-xs gap-1.5 shadow-2xs hover:bg-muted/80"
          >
            <RefreshCw className={cn("size-3.5", refreshing && "animate-spin text-primary")} /></Button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Main Work Center Table Card */}
        <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-soft space-y-4">
          {/* Header & Controls */}
          <div className="space-y-4 pb-4 border-b border-border/60">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                  <Factory className="size-4 text-primary" />
                  Active Line Execution Center
                </h2>
                <p className="text-xs text-muted-foreground">
                  Control bench operations, execute manufacturing steps, and record finished batch
                  outputs
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
                    aria-pressed={statusFilter === tab.key}
                    onClick={() => setStatusFilter(tab.key)}
                    className={cn(
                      "min-h-9 px-3 py-2 text-sm font-medium rounded-lg transition-all",
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
              <div className="relative w-full min-w-0 lg:w-80">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                <input
                  type="text"
                  aria-label="Search this queue"
                  placeholder="Search order or product..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-11 w-full rounded-xl border border-border bg-card pl-9 pr-8 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary/40"
                />
                {search && (
                  <button
                    aria-label="Clear search"
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
              <p className="text-xs text-muted-foreground">
                Loading production runs from database...
              </p>
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
              <table className="w-full min-w-[960px] table-fixed text-left text-sm [&_th]:align-middle [&_td]:align-middle">
                <thead>
                  <tr className="border-b border-border/60 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    <th className="py-3 px-3">Order Number</th>
                    <th className="py-3 px-3">Product Details</th>
                    <th className="py-3 px-3">Target Qty</th>
                    <th className="py-3 px-3 min-w-[140px]">Progress<InformationTooltip help="production" /></th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3">Line & Operator</th>
                    <th className="py-3 px-3 text-right">Production Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {pagedOrders.map((order) => {
                    const percent =
                      order.target_quantity > 0
                        ? Math.min(
                            100,
                            Math.round((order.produced_quantity / order.target_quantity) * 100),
                          )
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
                          <div className="font-semibold text-foreground text-xs">
                            {order.product_name}
                          </div>
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
                                      : "text-muted-foreground",
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
                                      : "bg-muted-foreground/30",
                                )}
                                style={{ width: `${percent}%` }}
                              />
                            </div>
                          </div>
                        </td>

                        {/* Status */}
                        <td className="py-3.5 px-3 whitespace-nowrap">
                          {getStatusBadge(order.status)}
                        </td>

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
                            {order.can_complete && order.traceability_required && (
                              <Button size="sm" variant="outline" onClick={() => void handleOpenConsumption(order)}
                                className="h-7 px-3 text-xs font-semibold gap-1.5 rounded-lg">
                                <Package className="size-3.5" /> Record Material Consumption
                              </Button>
                            )}
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

                            {order.status === "REJECTED" && (
                              <Link to="/assembly/material-requests" className="text-xs font-semibold text-rose-700">View Rejected Request</Link>
                            )}
                            {/* Material Pending fallback action */}
                            {!order.can_start &&
                              !order.can_complete &&
                              order.status !== "REJECTED" &&
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
          {!loading && filteredOrders.length > 0 && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-sm">
            <p className="text-muted-foreground">Showing {pageStart + 1} to {Math.min(pageStart + 10, filteredOrders.length)} of {filteredOrders.length} orders</p>
            <nav aria-label="Production pagination" className="flex items-center gap-3">
              <Button size="sm" variant="outline" disabled={currentPage === 1} onClick={() => setProductionPage(currentPage - 1)}>Previous</Button>
              <span>{currentPage} / {pageCount}</span>
              <Button size="sm" variant="outline" disabled={currentPage === pageCount} onClick={() => setProductionPage(currentPage + 1)}>Next</Button>
            </nav>
          </div>}
        </div>

        <Dialog open={!!consumptionOrder} onOpenChange={(open) => !open && !savingConsumption && setConsumptionOrder(null)}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-6 rounded-2xl">
            <DialogHeader className="border-b border-border/60 pb-3">
              <DialogTitle className="flex items-center gap-2 text-lg font-bold"><Package className="size-5 text-primary" />Record Material Consumption</DialogTitle>
              <DialogDescription>
                {consumptionOrder?.order_number} · {consumptionOrder?.product_name} · {consumptionOrder?.status?.replaceAll("_", " ")}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 pt-3">
              <FgQrInput value={scannedQr} onChange={(value) => { setScannedQr(value); setVerifiedMaterial(null); }}
                disabled={verifyingQr || savingConsumption} label="Scan Material QR" inputId="assembly-material-qr" />
              <Button size="sm" onClick={() => void handleVerifyMaterialQr()} disabled={!scannedQr.trim() || verifyingQr || savingConsumption}>
                {verifyingQr ? "Verifying…" : "Verify Material"}
              </Button>
              {consumptionError && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{consumptionError}</div>}
              {verifiedMaterial && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800"><CheckCircle2 className="size-4" />Original material QR verified</div>
                  <div className="grid grid-cols-2 gap-x-5 gap-y-2 text-xs sm:grid-cols-3">
                    <div><span className="text-muted-foreground">Material</span><div className="font-semibold">{verifiedMaterial.material_name} ({verifiedMaterial.material_code})</div></div>
                    <div><span className="text-muted-foreground">GRN Batch</span><div className="font-semibold">{verifiedMaterial.batch_number}</div></div>
                    <div><span className="text-muted-foreground">Original QR identity</span><div className="font-mono font-semibold break-all">{verifiedMaterial.material_qr}</div></div>
                    <div><span className="text-muted-foreground">Quantity issued</span><div className="font-semibold">{verifiedMaterial.quantity_issued} {verifiedMaterial.uom}</div></div>
                    <div><span className="text-muted-foreground">Quantity received</span><div className="font-semibold">{verifiedMaterial.quantity_received} {verifiedMaterial.uom}</div></div>
                    <div><span className="text-muted-foreground">Already consumed</span><div className="font-semibold">{verifiedMaterial.quantity_already_consumed} {verifiedMaterial.uom}</div></div>
                    <div><span className="text-muted-foreground">Remaining consumable</span><div className="font-bold text-primary">{verifiedMaterial.remaining_quantity} {verifiedMaterial.uom}</div></div>
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="actual-material-consumption" className="text-xs font-semibold">Actual Quantity Consumed ({verifiedMaterial.uom}) *</label>
                    <Input id="actual-material-consumption" type="number" min="0.0001" max={verifiedMaterial.remaining_quantity}
                      step="0.0001" value={consumptionQty} onChange={(event) => setConsumptionQty(event.target.value)}
                      disabled={savingConsumption} className="h-9 font-mono" />
                  </div>
                  <Button size="sm" onClick={() => void handleSaveConsumption()} disabled={savingConsumption || !consumptionQty || Number(consumptionQty) <= 0 || Number(consumptionQty) > verifiedMaterial.remaining_quantity}>
                    {savingConsumption ? "Saving…" : "Confirm Consumption"}
                  </Button>
                </div>
              )}
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Consumption History</h3>
                {consumptionSummary?.events.length ? (
                  <div className="overflow-x-auto rounded-lg border"><table className="w-full text-left text-xs">
                    <thead className="bg-muted/50 text-muted-foreground"><tr>{["Material", "Original QR / Batch", "Quantity", "UOM", "Consumption Time", "Recorded By", "Status"].map((heading) => <th key={heading} className="px-2 py-2 font-semibold">{heading}</th>)}</tr></thead>
                    <tbody className="divide-y">{consumptionSummary.events.map((event) => <tr key={event.consumption_event_id}>
                      <td className="px-2 py-2">{event.material_code}</td><td className="px-2 py-2"><span className="font-mono">{event.material_qr}</span><div>{event.batch_number || event.grn_batch_id}</div></td>
                      <td className="px-2 py-2">{event.consumed_quantity}</td><td className="px-2 py-2">{event.uom}</td><td className="px-2 py-2">{new Date(event.consumed_at).toLocaleString()}</td><td className="px-2 py-2">{event.recorded_by}</td><td className="px-2 py-2 text-emerald-700">{event.status}</td>
                    </tr>)}</tbody>
                  </table></div>
                ) : <p className="text-xs text-muted-foreground">No verified consumption events recorded for this order.</p>}
                {consumptionSummary?.traceability_required && !consumptionSummary.can_complete && (
                  <p className="text-xs font-medium text-amber-700">Missing verified consumption: {consumptionSummary.missing_material_codes.join(", ")}</p>
                )}
              </section>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setConsumptionOrder(null)} disabled={savingConsumption}>Close</Button></DialogFooter>
          </DialogContent>
        </Dialog>

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
                    <span className="font-semibold text-foreground">
                      {completeOrder.product_name}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Target Quantity:</span>
                    <span className="font-semibold text-foreground font-mono">
                      {completeOrder.target_quantity} {completeOrder.uom}
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
                    Pre-filled with target quantity. Adjust if any units were rejected or scrapped
                    during bench work.
                  </p>
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
