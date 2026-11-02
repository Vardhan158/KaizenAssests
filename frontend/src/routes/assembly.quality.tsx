import { InformationTooltip } from "@/components/ui/information-tooltip";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/wms/app-shell";
import { requireRole } from "@/lib/auth-utils";
import { api, type AssemblyQualityInspectionItem } from "@/lib/api-client";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Factory,
  Filter,
  Layers,
  LayoutDashboard,
  Package,
  PackageCheck,
  QrCode,
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
import { isValidInspectorName, parseNonNegativeNumber } from "@/lib/input-validation";

export const Route = createFileRoute("/assembly/quality")({
  beforeLoad: () =>
    requireRole(["ASSEMBLY_MANAGER", "ASSEMBLY", "ADMIN", "SUPERUSER", "QUALITY", "QC"]),
  head: () => ({ meta: [{ title: "Quality Inspection · KaizenAssests" }] }),
  component: AssemblyQualityPage,
});

function qualityGroup(item: AssemblyQualityInspectionItem): string {
  const status = item.qc_status.toUpperCase();
  if (status === "PARTIALLY_APPROVED")
    return item.rework_quantity > 0 ? "REWORK" : item.held_quantity > 0 ? "HELD" : status;
  return (
    (
      {
        QC_APPROVED: "PASSED",
        REJECTED: "FAILED",
        PENDING: "PENDING_INSPECTION",
        REWORK_REQUIRED: "REWORK",
      } as Record<string, string>
    )[status] || status
  );
}

function getQcStatusBadge(status: string) {
  const s = (status || "").toUpperCase();
  if (s === "PASSED" || s === "QC_APPROVED") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25">
        <span className="size-1.5 rounded-full bg-emerald-500" />
        QC Passed
      </span>
    );
  }
  if (["REWORK", "PARTIALLY_APPROVED", "HELD"].includes(s)) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/25">
        <span className="size-1.5 rounded-full bg-amber-500" />
        {s === "REWORK" ? "Rework Required" : s === "HELD" ? "QC Held" : "Partially Approved"}
      </span>
    );
  }
  if (s === "FAILED" || s === "REJECTED") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/25">
        <span className="size-1.5 rounded-full bg-rose-500" />
        QC Failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-500/10 text-purple-700 dark:text-purple-300 border border-purple-500/25">
      <span className="size-1.5 rounded-full bg-purple-500 animate-pulse" />
      Awaiting QC
    </span>
  );
}

function AssemblyQualityPage() {
  const navigate = useNavigate();
  const [inspections, setInspections] = useState<AssemblyQualityInspectionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  // Inspection Modal State
  const [inspectItem, setInspectItem] = useState<AssemblyQualityInspectionItem | null>(null);
  const [passedQty, setPassedQty] = useState<number>(0);
  const [authorizedPersonConfirmed, setAuthorizedPersonConfirmed] = useState(false);
  const [inspectorName, setInspectorName] = useState("");
  const [inspectorTouched, setInspectorTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const fetchInspections = async (isManual = false) => {
    if (isManual) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await api.getAssemblyQualityInspections();
      setInspections(res || []);
    } catch (err: any) {
      toast.error("Failed to load quality inspections: " + (err.message || "Unknown error"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchInspections();
  }, []);

  const handleOpenInspectModal = (item: AssemblyQualityInspectionItem) => {
    setInspectItem(item);
    setAuthorizedPersonConfirmed(false);
    setInspectorName("");
    setInspectorTouched(false);
    setPassedQty(item.produced_quantity);
  };

  const parsedPassedQty = parseNonNegativeNumber(passedQty);
  const totalInspected = parsedPassedQty ?? Number.NaN;
  const expectedProduced = inspectItem ? inspectItem.produced_quantity : 0;
  const isQuantityValid =
    parsedPassedQty !== null &&
    totalInspected === expectedProduced;

  const handleInspectSubmit = async () => {
    if (!inspectItem) return;
    setInspectorTouched(true);
    if (!authorizedPersonConfirmed || !isValidInspectorName(inspectorName)) return;

    if (!isQuantityValid) {
      toast.error(
        `Total inspected quantity (${totalInspected}) must match produced quantity (${expectedProduced}).`,
      );
      return;
    }

    try {
      setSubmitting(true);
      const res = await api.performAssemblyQualityInspection({
        order_id: inspectItem.order_id,
        authorized_person_confirmed: authorizedPersonConfirmed,
        inspector_name: inspectorName.trim(),
        passed_quantity: parsedPassedQty,
        failed_quantity: 0,
        rework_quantity: 0,
        held_quantity: 0,
      } as any);

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
  const awaitingQc = inspections.filter((i) => qualityGroup(i) === "PENDING_INSPECTION").length;
  const passedQc = inspections.filter((i) => qualityGroup(i) === "PASSED").length;
  const reworkQc = inspections.filter((i) => qualityGroup(i) === "REWORK").length;
  const failedQc = inspections.filter((i) => qualityGroup(i) === "FAILED").length;
  // Filtered list
  const filteredInspections = useMemo(() => {
    const q = search.toLowerCase().trim();
    return inspections.filter(
      (i) =>
        (statusFilter === "ALL" ||
          qualityGroup(i) === (statusFilter === "PENDING" ? "PENDING_INSPECTION" : statusFilter)) &&
        (!q ||
          [i.order_number, i.product_name, i.product_code, i.inspected_by].some((value) =>
            value?.toLowerCase().includes(q),
          )),
    );
  }, [inspections, search, statusFilter]);
  const [listPage, setListPage] = useState(1);
  const listPageCount = Math.max(1, Math.ceil(filteredInspections.length / 10));
  const currentListPage = Math.min(listPage, listPageCount);
  const listStart = (currentListPage - 1) * 10;
  const pagedRows = filteredInspections.slice(listStart, listStart + 10);
  useEffect(() => { setListPage(1); }, [search, statusFilter]);
  useEffect(() => { setListPage(page => Math.min(page, listPageCount)); }, [listPageCount]);


  return (
    <AppShell
      title="Quality Inspection"
      subtitle="Final QC inspection, pass certification, rework routing, and finished goods generation"
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
            onClick={() => navigate({ to: "/assembly/finished-goods" as any })}
            className="rounded-xl text-xs gap-1.5 shadow-2xs hover:bg-muted/80 font-medium"
          >
            <PackageCheck className="size-3.5 text-emerald-500" />
            Finished Goods
          </Button>
          <Button data-refresh-control="true" aria-label="Refresh" title="Refresh"
            variant="outline"
            size="sm"
            onClick={() => fetchInspections(true)}
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
                  <ShieldCheck className="size-4 text-primary" />
                  Quality Assurance Work Center
                </h2>
                <p className="text-xs text-muted-foreground">
                  Audit assembled batches, record inspection breakdown, and approve for Finished
                  Goods storage
                </p>
              </div>
              <div className="text-xs text-muted-foreground self-start sm:self-auto font-medium">
                Showing <strong className="text-foreground">{filteredInspections.length}</strong> of{" "}
                <strong className="text-foreground">{inspections.length}</strong> inspection runs
              </div>
            </div>

            {/* Filter & Search Toolbar */}
            <div className="flex flex-col items-stretch gap-4 pt-1">
              {/* Status Filter Tabs */}
              <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-muted/60 border border-border/60">
                {[
                  { key: "ALL", label: `All Inspections (${totalOrders})` },
                  { key: "PENDING", label: `Awaiting QC (${awaitingQc})` },
                  { key: "PASSED", label: `QC Passed (${passedQc})` },
                  { key: "REWORK", label: `Rework (${reworkQc})` },
                  { key: "FAILED", label: `Failed (${failedQc})` },
                  {
                    key: "PARTIALLY_APPROVED",
                    label: `Partial (${inspections.filter((i) => qualityGroup(i) === "PARTIALLY_APPROVED").length})`,
                  },
                  {
                    key: "HELD",
                    label: `Held (${inspections.filter((i) => qualityGroup(i) === "HELD").length})`,
                  },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    aria-pressed={statusFilter === tab.key}
                    onClick={() => setStatusFilter(tab.key)}
                    className={cn(
                      "min-h-10 px-3 py-2 text-sm font-medium rounded-lg transition-all",
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
              <div className="relative w-full min-w-0">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                <input
                  type="text"
                  aria-label="Search this queue"
                  placeholder="Search order, product or quality engineer..."
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
              <p className="text-xs text-muted-foreground">Loading quality audit records...</p>
            </div>
          ) : filteredInspections.length === 0 ? (
            <div className="py-14 text-center">
              <div className="grid size-12 place-items-center rounded-2xl bg-muted mx-auto mb-3 text-muted-foreground">
                <ShieldCheck className="size-6 opacity-60" />
              </div>
              <p className="text-sm font-semibold text-foreground">
                {search || statusFilter !== "ALL"
                  ? "No quality records match the selected filter"
                  : "No batches awaiting quality inspection"}
              </p>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                {search || statusFilter !== "ALL"
                  ? "Try resetting your search query or switching to 'All Inspections' status filter."
                  : "When line operators complete production on active assembly orders, they appear here for quality certification."}
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
                    onClick={() => navigate({ to: "/assembly/production" as any })}
                  >
                    <Factory className="size-3.5" />
                    Go to Production Lines
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto -mx-5 px-5">
              <table className="w-full min-w-[1000px] table-fixed text-left text-sm [&_th]:align-middle [&_td]:align-middle">
                <thead>
                  <tr className="border-b border-border/60 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    <th className="py-3 px-3">Order Number</th>
                    <th className="py-3 px-3">Product Details</th>
                    <th className="py-3 px-3">Produced Qty</th>
                    <th className="py-3 px-3">QC Breakdown<InformationTooltip help="qc" /></th>
                    <th className="py-3 px-3">QC Status<InformationTooltip help="workflowStatus" /></th>
                    <th className="py-3 px-3">Quality Engineer & Date</th>
                    <th className="py-3 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {pagedRows.map((item) => (
                    <tr key={item.order_id} className="group hover:bg-muted/40 transition-colors">
                      {/* Order Number */}
                      <td className="py-3.5 px-3">
                        <div className="font-bold text-foreground text-xs font-mono group-hover:text-primary transition-colors">
                          {item.order_number}
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          Status: {item.order_status}
                        </div>
                      </td>

                      {/* Product Details */}
                      <td className="py-3.5 px-3">
                        <div className="font-semibold text-foreground text-xs">
                          {item.product_name}
                        </div>
                        <div className="text-[11px] text-muted-foreground font-mono mt-0.5">
                          {item.product_code}
                        </div>
                      </td>

                      {/* Produced Qty */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <span className="font-bold text-foreground text-xs tabular-nums">
                          {item.produced_quantity}
                        </span>{" "}
                        <span className="text-[11px] text-muted-foreground font-medium">
                          {item.uom}
                        </span>
                      </td>

                      {/* QC Breakdown */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        {item.qc_status === "PENDING_INSPECTION" ? (
                          <span className="text-xs text-muted-foreground italic">
                            Pending inspection
                          </span>
                        ) : (
                          <div className="flex flex-wrap items-center gap-1.5 text-xs font-mono">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-500/15 border border-emerald-500/25">
                              ✓ {item.passed_quantity} Pass
                            </span>
                            {item.rework_quantity > 0 && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-bold text-amber-700 dark:text-amber-300 bg-amber-500/15 border border-amber-500/25">
                                ↺ {item.rework_quantity} Rework
                              </span>
                            )}
                            {item.failed_quantity > 0 && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-bold text-rose-700 dark:text-rose-300 bg-rose-500/15 border border-rose-500/25">
                                ✗ {item.failed_quantity} Scrap
                              </span>
                            )}
                          </div>
                        )}
                      </td>

                      {/* QC Status */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        {getQcStatusBadge(qualityGroup(item))}
                      </td>

                      {/* Quality Engineer & Date */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        {item.inspected_by ? (
                          <div className="flex flex-col text-[11px]">
                            <span className="font-semibold text-foreground flex items-center gap-1">
                              <User className="size-3 text-muted-foreground/60" />
                              {item.inspected_by}
                            </span>
                            <span className="text-muted-foreground text-[10px] mt-0.5">
                              {item.inspected_at
                                ? new Date(item.inspected_at).toLocaleDateString()
                                : ""}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>

                      {/* Action */}
                      <td className="py-3.5 px-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          {item.can_inspect ? (
                            <Button
                              size="sm"
                              className="h-7 px-3 text-xs font-semibold bg-purple-600 hover:bg-purple-700 text-white gap-1.5 rounded-lg shadow-sm"
                              onClick={() => handleOpenInspectModal(item)}
                            >
                              <ShieldCheck className="size-3.5" />
                              Perform QC
                            </Button>
                          ) : qualityGroup(item) === "PASSED" || item.passed_quantity > 0 ? (
                            <Link
                              to="/assembly/finished-goods"
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 hover:bg-emerald-500/20 transition-all shadow-2xs"
                            >
                              <QrCode className="size-3.5 text-emerald-600" />
                              View FG Label
                              <ArrowRight className="size-3 ml-0.5" />
                            </Link>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {qualityGroup(item) === "PENDING_INSPECTION"
                                ? "Not available"
                                : "Inspection recorded"}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!loading && filteredInspections.length > 0 && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-sm">
            <p className="text-muted-foreground">Showing {listStart + 1} to {Math.min(listStart + 10, filteredInspections.length)} of {filteredInspections.length} inspections</p>
            <nav aria-label="Inspections pagination" className="flex items-center gap-3">
              <Button size="sm" variant="outline" disabled={currentListPage === 1} onClick={() => setListPage(currentListPage - 1)}>Previous</Button>
              <span>{currentListPage} / {listPageCount}</span>
              <Button size="sm" variant="outline" disabled={currentListPage === listPageCount} onClick={() => setListPage(currentListPage + 1)}>Next</Button>
            </nav>
          </div>}
        </div>

        {/* ========================================================================= */}
        {/* PERFORM QC INSPECTION MODAL */}
        {/* ========================================================================= */}
        <Dialog open={!!inspectItem} onOpenChange={(open) => !open && setInspectItem(null)}>
          <DialogContent className="max-w-lg p-6 rounded-2xl">
            <DialogHeader className="border-b border-border/60 pb-3">
              <DialogTitle className="flex items-center gap-2 text-foreground text-lg font-bold">
                <ShieldCheck className="size-5 text-purple-600" />
                Perform Quality Inspection
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-1">
                Audit manufactured units for order{" "}
                <span className="font-mono font-semibold text-foreground">
                  {inspectItem?.order_number}
                </span>
                . Passed items generate certified Finished Goods stock stored in the Assembly FG
                Area, ready for customer dispatch.
              </DialogDescription>
            </DialogHeader>

            {inspectItem && (
              <div className="space-y-4 pt-3">
                <div className="rounded-xl bg-muted/40 p-3.5 text-xs space-y-2 border border-border/60">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Product to Inspect:</span>
                    <span className="font-semibold text-foreground">
                      {inspectItem.product_name}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Produced Batch:</span>
                    <span className="font-semibold text-foreground font-mono">
                      {inspectItem.produced_quantity} {inspectItem.uom}
                    </span>
                  </div>
                </div>

                <div className="space-y-3 rounded-xl border border-border/60 p-3.5">
                  <label className="flex items-start gap-2 text-xs font-semibold text-foreground">
                    <input
                      type="checkbox"
                      required
                      checked={authorizedPersonConfirmed}
                      onChange={(e) => setAuthorizedPersonConfirmed(e.target.checked)}
                      className="mt-0.5 size-4 accent-primary"
                    />
                    Quality check performed by authorized person
                  </label>
                  <div className="space-y-1.5">
                    <label
                      htmlFor="qc-quality-engineer-name"
                      className="text-xs font-semibold text-foreground"
                    >
                      Quality Engineer Name *
                    </label>
                    <Input
                      id="qc-quality-engineer-name"
                      value={inspectorName}
                      onChange={(e) => setInspectorName(e.target.value)}
                      onBlur={() => setInspectorTouched(true)}
                      required
                      maxLength={128}
                      aria-invalid={inspectorTouched && !isValidInspectorName(inspectorName)}
                      aria-describedby="qc-quality-engineer-name-help"
                      placeholder="Enter quality engineer name"
                      className="h-9 text-sm rounded-xl"
                    />
                    <p
                      id="qc-quality-engineer-name-help"
                      className={cn(
                        "text-xs",
                        inspectorTouched && !isValidInspectorName(inspectorName)
                          ? "text-destructive"
                          : "text-muted-foreground",
                      )}
                    >
                      {inspectorTouched && !isValidInspectorName(inspectorName)
                        ? "Enter a valid quality engineer name (2-128 characters, at least two letters)."
                        : "Required. Use letters, spaces, periods, apostrophes or hyphens."}
                    </p>
                  </div>
                </div>

                {/* Quantities breakdown */}
                <div className="space-y-3">
                  <div className="grid grid-cols-1 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="size-3" /> Passed Qty *
                      </label>
                      <Input
                        type="number"
                        min={0}
                        max={inspectItem.produced_quantity}
                        value={passedQty}
                        onChange={(e) => setPassedQty(Number(e.target.value))}
                        className="h-9 text-sm font-mono font-bold rounded-xl border-emerald-500/30 focus:border-emerald-500"
                      />
                    </div>

                  </div>

                  {/* Validation balance warning */}
                  <div
                    className={cn(
                      "p-2.5 rounded-xl text-xs flex items-center justify-between font-medium border",
                      isQuantityValid
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25"
                        : "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/25",
                    )}
                  >
                    <span>
                      Total account: {totalInspected} / {expectedProduced} {inspectItem.uom}
                    </span>
                    <span>
                      {isQuantityValid ? "✓ Quantities balanced" : "⚠ Must equal produced quantity"}
                    </span>
                  </div>
                </div>
              </div>
            )}

            <DialogFooter className="pt-2">
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl"
                onClick={() => setInspectItem(null)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleInspectSubmit}
                disabled={
                  submitting ||
                  !isQuantityValid ||
                  !authorizedPersonConfirmed ||
                  !isValidInspectorName(inspectorName)
                }
                className="rounded-xl bg-purple-600 hover:bg-purple-700 text-white gap-1.5 font-semibold shadow-soft"
              >
                {submitting ? (
                  <RefreshCw className="size-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="size-3.5" />
                )}
                Submit QC Certification
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
