import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
  Package,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  User,
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

export const Route = createFileRoute("/assembly/production")({
  beforeLoad: () => requireRole(["ASSEMBLY_MANAGER", "ASSEMBLY", "ADMIN", "SUPERUSER"]),
  head: () => ({ meta: [{ title: "Production · KaizenX" }] }),
  component: AssemblyProductionPage,
});

function getStatusBadge(status: string) {
  const s = (status || "").toUpperCase();
  if (s === "IN_PRODUCTION" || s === "IN-PROGRESS" || s === "RUNNING") {
    return (
      <Badge className="bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300 animate-pulse">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block mr-1.5"></span>
        IN PRODUCTION
      </Badge>
    );
  }
  if (s === "MATERIAL_READY") {
    return (
      <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block mr-1.5"></span>
        READY TO START
      </Badge>
    );
  }
  if (s === "QC_PENDING") {
    return (
      <Badge className="bg-blue-500/15 text-blue-700 border-blue-500/30 dark:text-blue-300">
        <ShieldCheck className="w-3 h-3 inline-block mr-1" />
        QC PENDING
      </Badge>
    );
  }
  if (s === "COMPLETED" || s === "CLOSED") {
    return (
      <Badge className="bg-teal-500/15 text-teal-700 border-teal-500/30 dark:text-teal-300">
        <CheckCircle2 className="w-3 h-3 inline-block mr-1" />
        COMPLETED
      </Badge>
    );
  }
  if (s === "MATERIAL_ISSUED") {
    return (
      <Badge className="bg-indigo-500/15 text-indigo-700 border-indigo-500/30 dark:text-indigo-300">
        WH ISSUED (RECEIPT REQ.)
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      {status || "AWAITING MATERIALS"}
    </Badge>
  );
}

function AssemblyProductionPage() {
  const [orders, setOrders] = useState<AssemblyProductionOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  // Complete Production Modal State
  const [completeOrder, setCompleteOrder] = useState<AssemblyProductionOrder | null>(null);
  const [producedQuantity, setProducedQuantity] = useState<number>(0);
  const [productionNotes, setProductionNotes] = useState<string>("");
  const [completing, setCompleting] = useState(false);

  // Start Production Confirmation State
  const [startingOrderId, setStartingOrderId] = useState<string | null>(null);

  const fetchOrders = async () => {
    try {
      setLoading(true);
      const res = await api.getAssemblyProductionOrders({
        search: search || undefined,
        status: statusFilter !== "ALL" ? statusFilter : undefined,
      });
      setOrders(res || []);
    } catch (err: any) {
      toast.error("Failed to load production orders: " + (err.message || "Unknown error"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, [statusFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchOrders();
  };

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

  return (
    <AppShell
      title="Production"
      subtitle="Assembly work center operations, step execution, and production recording"
    >
      <div className="space-y-6">
        {/* Stat Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Total Orders</span>
              <Factory className="h-4 w-4 text-primary" />
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">{totalOrders}</div>
            <p className="mt-1 text-xs text-muted-foreground">Tracked in Assembly</p>
          </div>

          <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Ready to Start</span>
              <Boxes className="h-4 w-4 text-emerald-500" />
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
              {readyToStart}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Materials confirmed received</p>
          </div>

          <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">In Production</span>
              <Clock className="h-4 w-4 text-amber-500" />
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
              {inProduction}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Currently being assembled</p>
          </div>

          <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">QC Pending</span>
              <ShieldCheck className="h-4 w-4 text-blue-500" />
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-blue-600 dark:text-blue-400">
              {qcPending}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Awaiting final inspection</p>
          </div>
        </div>

        {/* Filter Controls & Search */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto p-1 bg-muted/50 rounded-lg border border-border/40">
            {[
              { id: "ALL", label: "All Orders" },
              { id: "READY", label: "Ready to Start" },
              { id: "IN_PRODUCTION", label: "In Production" },
              { id: "COMPLETED", label: "QC / Completed" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all whitespace-nowrap ${
                  statusFilter === tab.id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <form onSubmit={handleSearchSubmit} className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search order or product..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9 text-xs"
              />
            </div>
            <Button type="submit" variant="outline" size="sm" className="h-9 px-3">
              Search
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                setStatusFilter("ALL");
                fetchOrders();
              }}
              className="h-9 px-2"
              title="Refresh"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </form>
        </div>

        {/* Orders Table */}
        <div className="rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/40 text-muted-foreground font-medium border-b border-border/60">
                <tr>
                  <th className="py-3 px-4">Order Number</th>
                  <th className="py-3 px-4">Product Details</th>
                  <th className="py-3 px-4">Target Qty</th>
                  <th className="py-3 px-4">Produced Qty</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Line & Operator</th>
                  <th className="py-3 px-4 text-right">Production Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-muted-foreground">
                      <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-primary" />
                      Loading production orders...
                    </td>
                  </tr>
                ) : orders.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-muted-foreground">
                      <Factory className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
                      <p className="font-medium text-foreground">No production orders found.</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Create a Material Request and confirm receipt to start production.
                      </p>
                    </td>
                  </tr>
                ) : (
                  orders.map((order) => {
                    const percent =
                      order.target_quantity > 0
                        ? Math.min(100, Math.round((order.produced_quantity / order.target_quantity) * 100))
                        : 0;

                    return (
                      <tr key={order.id} className="hover:bg-muted/30 transition-colors">
                        {/* Order Number & Date */}
                        <td className="py-3.5 px-4 font-mono font-semibold text-foreground">
                          <div className="flex flex-col">
                            <span>{order.order_number}</span>
                            <span className="text-[10px] text-muted-foreground font-sans mt-0.5">
                              Req: {order.material_request_number || "—"}
                            </span>
                          </div>
                        </td>

                        {/* Product Code & Name */}
                        <td className="py-3.5 px-4">
                          <div className="flex flex-col">
                            <span className="font-semibold text-foreground">{order.product_name}</span>
                            <span className="font-mono text-[11px] text-muted-foreground mt-0.5">
                              {order.product_code}
                            </span>
                          </div>
                        </td>

                        {/* Target Qty */}
                        <td className="py-3.5 px-4">
                          <span className="font-medium text-foreground">
                            {order.target_quantity} {order.uom}
                          </span>
                        </td>

                        {/* Produced Qty & Progress */}
                        <td className="py-3.5 px-4">
                          <div className="flex flex-col gap-1 w-28">
                            <div className="flex justify-between text-[11px] font-medium">
                              <span className={order.produced_quantity > 0 ? "text-emerald-600 font-bold" : "text-muted-foreground"}>
                                {order.produced_quantity} {order.uom}
                              </span>
                              <span className="text-muted-foreground">{percent}%</span>
                            </div>
                            <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                              <div
                                className="bg-emerald-500 h-1.5 rounded-full transition-all"
                                style={{ width: `${percent}%` }}
                              />
                            </div>
                          </div>
                        </td>

                        {/* Status */}
                        <td className="py-3.5 px-4">
                          {getStatusBadge(order.status)}
                        </td>

                        {/* Line & Operator */}
                        <td className="py-3.5 px-4 text-muted-foreground">
                          <div className="flex flex-col text-[11px]">
                            <span className="font-medium text-foreground">{order.assigned_line || "Line 1"}</span>
                            <span>{order.assigned_operator || "Unassigned"}</span>
                          </div>
                        </td>

                        {/* Actions */}
                        <td className="py-3.5 px-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {/* Action: Start Production */}
                            {order.can_start && (
                              <Button
                                size="sm"
                                onClick={() => handleStartProduction(order)}
                                disabled={startingOrderId === order.id}
                                className="h-8 gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
                              >
                                <Play className="h-3.5 w-3.5 fill-current" />
                                {startingOrderId === order.id ? "Starting..." : "Start Production"}
                              </Button>
                            )}

                            {/* Action: Complete Production */}
                            {order.can_complete && (
                              <Button
                                size="sm"
                                onClick={() => handleOpenCompleteModal(order)}
                                className="h-8 gap-1.5 bg-amber-600 hover:bg-amber-700 text-white shadow-sm"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Complete Production
                              </Button>
                            )}

                            {/* Completed / QC Pending Badge info */}
                            {order.status === "QC_PENDING" && (
                              <span className="text-xs text-blue-600 dark:text-blue-400 font-medium inline-flex items-center gap-1">
                                <ShieldCheck className="h-3.5 w-3.5" />
                                Ready for QC
                              </span>
                            )}

                            {order.status === "COMPLETED" && (
                              <span className="text-xs text-teal-600 dark:text-teal-400 font-medium inline-flex items-center gap-1">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Completed
                              </span>
                            )}

                            {/* Material Pending fallback notice */}
                            {!order.can_start && !order.can_complete && order.status !== "QC_PENDING" && order.status !== "COMPLETED" && (
                              <span className="text-[11px] text-muted-foreground italic">
                                Awaiting material receipt
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Complete Production Modal */}
        <Dialog open={!!completeOrder} onOpenChange={(open) => !open && setCompleteOrder(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-foreground">
                <Factory className="h-5 w-5 text-amber-500" />
                Complete Production & Record Output
              </DialogTitle>
              <DialogDescription>
                Record the actual assembled quantity for order{" "}
                <span className="font-mono font-semibold text-foreground">
                  {completeOrder?.order_number}
                </span>
                . The order will be routed to Quality Check (QC).
              </DialogDescription>
            </DialogHeader>

            {completeOrder && (
              <div className="space-y-4 py-2">
                <div className="rounded-lg bg-muted/50 p-3 text-xs space-y-1.5 border border-border/40">
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
                    <span className="text-foreground">{completeOrder.assigned_line || "Line 1"}</span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">
                    Actual Produced Quantity ({completeOrder.uom}) <span className="text-red-500">*</span>
                  </label>
                  <Input
                    type="number"
                    min={1}
                    max={completeOrder.target_quantity * 2}
                    value={producedQuantity}
                    onChange={(e) => setProducedQuantity(Number(e.target.value))}
                    className="h-9 text-sm font-mono font-semibold"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Pre-filled with target quantity. Adjust if any units were rejected on the bench.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">
                    Production Notes / Serial Range (Optional)
                  </label>
                  <Textarea
                    placeholder="e.g. Assembled according to SOP Rev 2. Serial batch SN-2026-081 through 100."
                    value={productionNotes}
                    onChange={(e) => setProductionNotes(e.target.value)}
                    rows={3}
                    className="text-xs"
                  />
                </div>
              </div>
            )}

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCompleteOrder(null)}
                disabled={completing}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleCompleteSubmit}
                disabled={completing || producedQuantity <= 0}
                className="bg-amber-600 hover:bg-amber-700 text-white gap-1.5"
              >
                <CheckCircle2 className="h-4 w-4" />
                {completing ? "Completing..." : "Complete & Route to QC"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
