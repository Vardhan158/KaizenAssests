import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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
  Layers,
  LayoutDashboard,
  Package,
  PackageCheck,
  QrCode,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  User,
  Wrench,
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

export const Route = createFileRoute("/assembly/quality")({
  beforeLoad: () => requireRole(["ASSEMBLY_MANAGER", "ASSEMBLY", "ADMIN", "SUPERUSER", "QUALITY", "QC"]),
  head: () => ({ meta: [{ title: "Quality Inspection · KaizenX" }] }),
  component: AssemblyQualityPage,
});

function getQcStatusBadge(status: string) {
  const s = (status || "").toUpperCase();
  if (s === "PASSED") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25">
        <span className="size-1.5 rounded-full bg-emerald-500" />
        QC Passed
      </span>
    );
  }
  if (s === "REWORK") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/25">
        <span className="size-1.5 rounded-full bg-amber-500" />
        Rework Required
      </span>
    );
  }
  if (s === "FAILED") {
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
  const [failedQty, setFailedQty] = useState<number>(0);
  const [reworkQty, setReworkQty] = useState<number>(0);
  const [notes, setNotes] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const fetchInspections = async (isManual = false) => {
    if (isManual) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await api.getAssemblyQualityInspections({
        search: search || undefined,
        status: statusFilter !== "ALL" ? statusFilter : undefined,
      });
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
  }, [statusFilter]);

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
  const failedQc = inspections.filter((i) => i.qc_status === "FAILED").length;

  const passRate =
    totalOrders > 0 && totalOrders !== awaitingQc
      ? Math.round((passedQc / (totalOrders - awaitingQc)) * 100)
      : 100;

  // Filtered list
  const filteredInspections = useMemo(() => {
    if (!search.trim()) return inspections;
    const q = search.toLowerCase().trim();
    return inspections.filter(
      (i) =>
        i.order_number?.toLowerCase().includes(q) ||
        i.product_name?.toLowerCase().includes(q) ||
        i.product_code?.toLowerCase().includes(q) ||
        i.inspected_by?.toLowerCase().includes(q)
    );
  }, [inspections, search]);

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
      title: "Production Lines",
      subtitle: "Bench assembly & work execution",
      icon: Factory,
      to: "/assembly/production",
      tone: "amber",
    },
    {
      title: "Material Requests",
      subtitle: "Warehouse component staging",
      icon: Boxes,
      to: "/assembly/material-requests",
      tone: "cyan",
    },
    {
      title: "Finished Goods Store",
      subtitle: "Inspected inventory & QR labels",
      icon: PackageCheck,
      to: "/assembly/finished-goods",
      tone: "emerald",
    },
  ];

  return (
    <AppShell
      title="Quality Inspection"
      subtitle="Final QC inspection, pass certification, rework routing, and finished goods generation"
      actions={
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-card border border-border/80 shadow-2xs text-xs font-medium text-muted-foreground">
            <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
            QC Station Active
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
            onClick={() => navigate({ to: "/assembly/finished-goods" as any })}
            className="rounded-xl text-xs gap-1.5 shadow-2xs hover:bg-muted/80 font-medium"
          >
            <PackageCheck className="size-3.5 text-emerald-500" />
            Finished Goods
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchInspections(true)}
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
          {/* Card 1: Total In Scope */}
          <div className="group relative overflow-hidden rounded-2xl border border-blue-500/20 bg-gradient-to-br from-blue-500/10 via-card to-card p-4 shadow-2xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-soft hover:border-blue-500/35 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                In QC Scope
              </span>
              <div className="grid size-9 place-items-center rounded-xl bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/20 shadow-2xs">
                <ShieldCheck className="size-4" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-3xl font-black tracking-tight text-foreground tabular-nums">
                {loading ? "..." : totalOrders}
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>Total produced batches</span>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-blue-500/10 text-blue-700 dark:text-blue-300">
                  Total
                </span>
              </div>
            </div>
          </div>

          {/* Card 2: Awaiting Inspection */}
          <div className="group relative overflow-hidden rounded-2xl border border-purple-500/20 bg-gradient-to-br from-purple-500/10 via-card to-card p-4 shadow-2xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-soft hover:border-purple-500/35 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Awaiting QC
              </span>
              <div className="grid size-9 place-items-center rounded-xl bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/20 shadow-2xs">
                <Clock className="size-4" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-3xl font-black tracking-tight text-purple-600 dark:text-purple-400 tabular-nums">
                {loading ? "..." : awaitingQc}
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>Ready for inspection</span>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-purple-500/10 text-purple-700 dark:text-purple-300">
                  Audit
                </span>
              </div>
            </div>
          </div>

          {/* Card 3: QC Passed */}
          <div className="group relative overflow-hidden rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 via-card to-card p-4 shadow-2xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-soft hover:border-emerald-500/35 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                QC Passed (FG)
              </span>
              <div className="grid size-9 place-items-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shadow-2xs">
                <CheckCircle2 className="size-4" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-3xl font-black tracking-tight text-emerald-600 dark:text-emerald-400 tabular-nums">
                {loading ? "..." : passedQc}
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>Stored in FG warehouse</span>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                  Certified
                </span>
              </div>
            </div>
          </div>

          {/* Card 4: Rework Required */}
          <div className="group relative overflow-hidden rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/10 via-card to-card p-4 shadow-2xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-soft hover:border-amber-500/35 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Rework Flagged
              </span>
              <div className="grid size-9 place-items-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20 shadow-2xs">
                <Wrench className="size-4" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-3xl font-black tracking-tight text-amber-600 dark:text-amber-400 tabular-nums">
                {loading ? "..." : reworkQc}
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>Flagged for touchup</span>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-300">
                  Touchup
                </span>
              </div>
            </div>
          </div>

          {/* Card 5: Pass Rate */}
          <div className="group relative overflow-hidden rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/10 via-card to-card p-4 shadow-2xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-soft hover:border-cyan-500/35 flex flex-col justify-between col-span-2 md:col-span-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                First-Pass Yield
              </span>
              <div className="grid size-9 place-items-center rounded-xl bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20 shadow-2xs">
                <PackageCheck className="size-4" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-3xl font-black tracking-tight text-cyan-600 dark:text-cyan-400 tabular-nums">
                {loading ? "..." : `${passRate}%`}
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>Inspection quality yield</span>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
                  Yield
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
                      sc.tone === "emerald" && "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
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
                  <ShieldCheck className="size-4 text-primary" />
                  Quality Assurance Work Center
                </h2>
                <p className="text-xs text-muted-foreground">
                  Audit assembled batches, record inspection breakdown, and approve for Finished Goods storage
                </p>
              </div>
              <div className="text-xs text-muted-foreground self-start sm:self-auto font-medium">
                Showing <strong className="text-foreground">{filteredInspections.length}</strong> of{" "}
                <strong className="text-foreground">{inspections.length}</strong> inspection runs
              </div>
            </div>

            {/* Filter & Search Toolbar */}
            <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 pt-1">
              {/* Status Filter Tabs */}
              <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-muted/60 border border-border/60">
                {[
                  { key: "ALL", label: `All Inspections (${totalOrders})` },
                  { key: "PENDING", label: `Awaiting QC (${awaitingQc})` },
                  { key: "PASSED", label: `QC Passed (${passedQc})` },
                  { key: "REWORK", label: `Rework (${reworkQc})` },
                  { key: "FAILED", label: `Failed (${failedQc})` },
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
                  placeholder="Search order, product or inspector..."
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
              <table className="w-full text-left text-sm mt-1">
                <thead>
                  <tr className="border-b border-border/60 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    <th className="py-3 px-3">Order Number</th>
                    <th className="py-3 px-3">Product Details</th>
                    <th className="py-3 px-3">Produced Qty</th>
                    <th className="py-3 px-3">QC Breakdown</th>
                    <th className="py-3 px-3">QC Status</th>
                    <th className="py-3 px-3">Inspector & Date</th>
                    <th className="py-3 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {filteredInspections.map((item) => (
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
                        <div className="font-semibold text-foreground text-xs">{item.product_name}</div>
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
                          <span className="text-xs text-muted-foreground italic">Pending inspection</span>
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
                      <td className="py-3.5 px-3 whitespace-nowrap">{getQcStatusBadge(item.qc_status)}</td>

                      {/* Inspector & Date */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        {item.inspected_by ? (
                          <div className="flex flex-col text-[11px]">
                            <span className="font-semibold text-foreground flex items-center gap-1">
                              <User className="size-3 text-muted-foreground/60" />
                              {item.inspected_by}
                            </span>
                            <span className="text-muted-foreground text-[10px] mt-0.5">
                              {item.inspected_at ? new Date(item.inspected_at).toLocaleDateString() : ""}
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
                          ) : item.qc_status === "PASSED" ? (
                            <Link
                              to="/assembly/finished-goods"
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 hover:bg-emerald-500/20 transition-all shadow-2xs"
                            >
                              <QrCode className="size-3.5 text-emerald-600" />
                              View FG Label
                              <ArrowRight className="size-3 ml-0.5" />
                            </Link>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2.5 text-xs font-medium rounded-lg"
                              onClick={() => handleOpenInspectModal(item)}
                            >
                              Re-inspect
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
                . Passed items generate certified Finished Goods stock ready for warehouse pickup.
              </DialogDescription>
            </DialogHeader>

            {inspectItem && (
              <div className="space-y-4 pt-3">
                <div className="rounded-xl bg-muted/40 p-3.5 text-xs space-y-2 border border-border/60">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Product to Inspect:</span>
                    <span className="font-semibold text-foreground">{inspectItem.product_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Produced Batch:</span>
                    <span className="font-semibold text-foreground font-mono">
                      {inspectItem.produced_quantity} {inspectItem.uom}
                    </span>
                  </div>
                </div>

                {/* Quantities breakdown */}
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-3">
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

                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1">
                        <Wrench className="size-3" /> Rework Qty
                      </label>
                      <Input
                        type="number"
                        min={0}
                        max={inspectItem.produced_quantity}
                        value={reworkQty}
                        onChange={(e) => setReworkQty(Number(e.target.value))}
                        className="h-9 text-sm font-mono font-bold rounded-xl border-amber-500/30 focus:border-amber-500"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-1">
                        <ShieldX className="size-3" /> Failed / Scrap
                      </label>
                      <Input
                        type="number"
                        min={0}
                        max={inspectItem.produced_quantity}
                        value={failedQty}
                        onChange={(e) => setFailedQty(Number(e.target.value))}
                        className="h-9 text-sm font-mono font-bold rounded-xl border-rose-500/30 focus:border-rose-500"
                      />
                    </div>
                  </div>

                  {/* Validation balance warning */}
                  <div
                    className={cn(
                      "p-2.5 rounded-xl text-xs flex items-center justify-between font-medium border",
                      isQuantityValid
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25"
                        : "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/25"
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

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    Inspection Remarks & QC Findings
                  </label>
                  <Textarea
                    placeholder="Enter dimensional check results, electrical test parameters, or rework reasons..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
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
                onClick={() => setInspectItem(null)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleInspectSubmit}
                disabled={submitting || !isQuantityValid}
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
