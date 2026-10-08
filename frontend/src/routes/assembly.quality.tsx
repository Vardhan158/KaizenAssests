import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/wms/app-shell";
import { requireRole } from "@/lib/auth-utils";
import {
  api,
  type AssemblyQualityInspectionItem,
} from "@/lib/api-client";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  Clock,
  ExternalLink,
  Factory,
  Filter,
  Package,
  QrCode,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  User,
  X,
  Wrench,
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

export const Route = createFileRoute("/assembly/quality")({
  beforeLoad: () => requireRole(["ASSEMBLY_MANAGER", "ASSEMBLY", "ADMIN", "SUPERUSER", "QUALITY", "QC"]),
  head: () => ({ meta: [{ title: "Quality Inspection · KaizenX" }] }),
  component: AssemblyQualityPage,
});

function getQcStatusBadge(status: string) {
  const s = (status || "").toUpperCase();
  if (s === "PASSED") {
    return (
      <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300">
        <CheckCircle2 className="w-3 h-3 inline-block mr-1" />
        QC PASSED
      </Badge>
    );
  }
  if (s === "REWORK") {
    return (
      <Badge className="bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300">
        <Wrench className="w-3 h-3 inline-block mr-1" />
        REWORK REQUIRED
      </Badge>
    );
  }
  if (s === "FAILED") {
    return (
      <Badge className="bg-red-500/15 text-red-700 border-red-500/30 dark:text-red-300">
        <ShieldX className="w-3 h-3 inline-block mr-1" />
        QC FAILED
      </Badge>
    );
  }
  return (
    <Badge className="bg-blue-500/15 text-blue-700 border-blue-500/30 dark:text-blue-300 animate-pulse">
      <Clock className="w-3 h-3 inline-block mr-1" />
      AWAITING QC
    </Badge>
  );
}

function AssemblyQualityPage() {
  const [inspections, setInspections] = useState<AssemblyQualityInspectionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  // Inspection Modal State
  const [inspectItem, setInspectItem] = useState<AssemblyQualityInspectionItem | null>(null);
  const [passedQty, setPassedQty] = useState<number>(0);
  const [failedQty, setFailedQty] = useState<number>(0);
  const [reworkQty, setReworkQty] = useState<number>(0);
  const [notes, setNotes] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const fetchInspections = async () => {
    try {
      setLoading(true);
      const res = await api.getAssemblyQualityInspections({
        search: search || undefined,
        status: statusFilter !== "ALL" ? statusFilter : undefined,
      });
      setInspections(res || []);
    } catch (err: any) {
      toast.error("Failed to load quality inspections: " + (err.message || "Unknown error"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInspections();
  }, [statusFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchInspections();
  };

  const handleOpenInspectModal = (item: AssemblyQualityInspectionItem) => {
    setInspectItem(item);
    setPassedQty(item.produced_quantity);
    setFailedQty(0);
    setReworkQty(0);
    setNotes("Physical dimensions verified. Functional testing completed with no defects.");
  };

  const totalInspected = Number(passedQty) + Number(failedQty) + Number(reworkQty);
  const expectedProduced = inspectItem ? inspectItem.produced_quantity : 0;
  const isQuantityValid = totalInspected === expectedProduced;

  const handleInspectSubmit = async () => {
    if (!inspectItem) return;

    if (!isQuantityValid) {
      toast.error(
        `Total inspected quantity (${totalInspected}) must match produced quantity (${expectedProduced}).`
      );
      return;
    }

    try {
      setSubmitting(true);
      const res = await api.performAssemblyQualityInspection({
        order_id: inspectItem.order_id,
        passed_quantity: Number(passedQty),
        failed_quantity: Number(failedQty),
        rework_quantity: Number(reworkQty),
        notes: notes.trim() || undefined,
      });

      toast.success(res.message || `Quality inspection completed for ${inspectItem.order_number}`);
      setInspectItem(null);
      await fetchInspections();
    } catch (err: any) {
      toast.error(err.message || "Failed to submit quality inspection");
    } finally {
      setSubmitting(false);
    }
  };

  // Quick stats
  const totalOrders = inspections.length;
  const awaitingQc = inspections.filter((i) => i.qc_status === "PENDING_INSPECTION").length;
  const passedQc = inspections.filter((i) => i.qc_status === "PASSED").length;
  const reworkQc = inspections.filter((i) => i.qc_status === "REWORK").length;

  return (
    <AppShell
      title="Quality Inspection"
      subtitle="Final QC inspection, pass certification, rework routing, and finished goods generation"
    >
      <div className="space-y-6">
        {/* Stat Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Total In QC Scope</span>
              <ShieldCheck className="h-4 w-4 text-primary" />
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">{totalOrders}</div>
            <p className="mt-1 text-xs text-muted-foreground">Orders produced</p>
          </div>

          <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Awaiting Inspection</span>
              <Clock className="h-4 w-4 text-blue-500" />
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-blue-600 dark:text-blue-400">
              {awaitingQc}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Ready for final check</p>
          </div>

          <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">QC Passed (FG)</span>
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
              {passedQc}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Finished Goods generated</p>
          </div>

          <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Rework Required</span>
              <Wrench className="h-4 w-4 text-amber-500" />
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
              {reworkQc}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Flagged for touchup</p>
          </div>
        </div>

        {/* Filter Controls & Search */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto p-1 bg-muted/50 rounded-lg border border-border/40">
            {[
              { id: "ALL", label: "All Inspections" },
              { id: "PENDING", label: "Awaiting QC" },
              { id: "PASSED", label: "QC Passed" },
              { id: "REWORK", label: "Rework" },
              { id: "FAILED", label: "Failed" },
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
                fetchInspections();
              }}
              className="h-9 px-2"
              title="Refresh"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </form>
        </div>

        {/* Inspections Table */}
        <div className="rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/40 text-muted-foreground font-medium border-b border-border/60">
                <tr>
                  <th className="py-3 px-4">Order Number</th>
                  <th className="py-3 px-4">Product Details</th>
                  <th className="py-3 px-4">Produced Qty</th>
                  <th className="py-3 px-4">QC Breakdown</th>
                  <th className="py-3 px-4">QC Status</th>
                  <th className="py-3 px-4">Inspector & Date</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-muted-foreground">
                      <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-primary" />
                      Loading quality inspection records...
                    </td>
                  </tr>
                ) : inspections.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-muted-foreground">
                      <ShieldCheck className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
                      <p className="font-medium text-foreground">No orders currently awaiting quality inspection.</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Completed production batches automatically appear here for final QC approval.
                      </p>
                    </td>
                  </tr>
                ) : (
                  inspections.map((item) => (
                    <tr key={item.order_id} className="hover:bg-muted/30 transition-colors">
                      {/* Order Number */}
                      <td className="py-3.5 px-4 font-mono font-semibold text-foreground">
                        {item.order_number}
                      </td>

                      {/* Product */}
                      <td className="py-3.5 px-4">
                        <div className="flex flex-col">
                          <span className="font-semibold text-foreground">{item.product_name}</span>
                          <span className="font-mono text-[11px] text-muted-foreground mt-0.5">
                            {item.product_code}
                          </span>
                        </div>
                      </td>

                      {/* Produced Quantity */}
                      <td className="py-3.5 px-4 font-mono font-medium text-foreground">
                        {item.produced_quantity} {item.uom}
                      </td>

                      {/* Breakdown */}
                      <td className="py-3.5 px-4">
                        {item.qc_status !== "PENDING_INSPECTION" ? (
                          <div className="flex items-center gap-2 text-[11px] font-mono">
                            <span className="text-emerald-600 font-bold" title="Passed">
                              P: {item.passed_quantity}
                            </span>
                            {item.rework_quantity > 0 && (
                              <span className="text-amber-600 font-bold" title="Rework">
                                R: {item.rework_quantity}
                              </span>
                            )}
                            {item.failed_quantity > 0 && (
                              <span className="text-red-600 font-bold" title="Failed">
                                F: {item.failed_quantity}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-[11px] text-muted-foreground italic">Pending check</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4">
                        {getQcStatusBadge(item.qc_status)}
                      </td>

                      {/* Inspector */}
                      <td className="py-3.5 px-4 text-muted-foreground text-[11px]">
                        {item.inspected_by ? (
                          <div className="flex flex-col">
                            <span className="font-medium text-foreground">{item.inspected_by}</span>
                            <span>{item.inspected_at ? new Date(item.inspected_at).toLocaleDateString() : ""}</span>
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right">
                        {item.can_inspect ? (
                          <Button
                            size="sm"
                            onClick={() => handleOpenInspectModal(item)}
                            className="h-8 gap-1.5 bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
                          >
                            <ShieldCheck className="h-3.5 w-3.5" />
                            Perform QC
                          </Button>
                        ) : item.qc_status === "PASSED" ? (
                          <Link
                            to="/assembly/finished-goods"
                            className="inline-flex items-center gap-1 text-xs text-emerald-600 hover:text-emerald-700 font-medium"
                          >
                            <QrCode className="h-3.5 w-3.5" />
                            View FG Label
                            <ArrowRight className="h-3 w-3" />
                          </Link>
                        ) : (
                          <span className="text-xs text-muted-foreground">Completed</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Quality Inspection Modal */}
        <Dialog open={!!inspectItem} onOpenChange={(open) => !open && setInspectItem(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-foreground">
                <ShieldCheck className="h-5 w-5 text-blue-500" />
                Final Quality Inspection (QC)
              </DialogTitle>
              <DialogDescription>
                Certify finished units for order{" "}
                <span className="font-mono font-semibold text-foreground">{inspectItem?.order_number}</span>.
                Passed units will automatically become Finished Goods with unique QR labels.
              </DialogDescription>
            </DialogHeader>

            {inspectItem && (
              <div className="space-y-4 py-2">
                <div className="rounded-lg bg-muted/50 p-3 text-xs space-y-1.5 border border-border/40">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Product:</span>
                    <span className="font-semibold text-foreground">{inspectItem.product_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Produced Batch Output:</span>
                    <span className="font-semibold font-mono text-foreground">
                      {inspectItem.produced_quantity} {inspectItem.uom}
                    </span>
                  </div>
                </div>

                {/* Quantities breakdown */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                      Passed (FG) <span className="text-red-500">*</span>
                    </label>
                    <Input
                      type="number"
                      min={0}
                      max={inspectItem.produced_quantity}
                      value={passedQty}
                      onChange={(e) => setPassedQty(Number(e.target.value))}
                      className="h-9 text-sm font-mono font-bold border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
                    />
                    <span className="text-[10px] text-muted-foreground">Generates FG QR</span>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                      Rework Qty
                    </label>
                    <Input
                      type="number"
                      min={0}
                      max={inspectItem.produced_quantity}
                      value={reworkQty}
                      onChange={(e) => setReworkQty(Number(e.target.value))}
                      className="h-9 text-sm font-mono font-bold border-amber-500/40 text-amber-700 dark:text-amber-300"
                    />
                    <span className="text-[10px] text-muted-foreground">Back to line</span>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-red-600 dark:text-red-400">
                      Failed / Scrap
                    </label>
                    <Input
                      type="number"
                      min={0}
                      max={inspectItem.produced_quantity}
                      value={failedQty}
                      onChange={(e) => setFailedQty(Number(e.target.value))}
                      className="h-9 text-sm font-mono font-bold border-red-500/40 text-red-700 dark:text-red-300"
                    />
                    <span className="text-[10px] text-muted-foreground">Scrapped</span>
                  </div>
                </div>

                {/* Validation badge */}
                <div
                  className={`rounded-lg p-2.5 text-xs flex items-center justify-between border ${
                    isQuantityValid
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
                      : "bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300"
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    {isQuantityValid ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-red-600" />
                    )}
                    Total Inspected: <strong className="font-mono">{totalInspected}</strong> /{" "}
                    <strong className="font-mono">{expectedProduced}</strong> {inspectItem.uom}
                  </span>
                  {!isQuantityValid && (
                    <span className="font-medium text-[11px]">
                      {totalInspected < expectedProduced
                        ? `Short by ${expectedProduced - totalInspected}`
                        : `Over by ${totalInspected - expectedProduced}`}
                    </span>
                  )}
                </div>

                {/* Inspection Notes */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">
                    Inspector Notes / Checklist Verification
                  </label>
                  <Textarea
                    placeholder="Enter inspection findings, visual checks, test bench results..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
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
                onClick={() => setInspectItem(null)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleInspectSubmit}
                disabled={submitting || !isQuantityValid}
                className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5 shadow-sm"
              >
                <ShieldCheck className="h-4 w-4" />
                {submitting ? "Certifying..." : "Submit Quality Certification"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
