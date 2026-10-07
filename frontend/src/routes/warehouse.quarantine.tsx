import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import {
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  Search,
  Filter,
  Eye,
  FileCheck,
  Undo2,
  Trash2,
  Wrench,
  Boxes,
  FileText,
  Clock,
  ArrowRight,
  ShieldCheck,
  Building2,
  Tag,
} from "lucide-react";
import { AppShell, StatusBadge } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api-client";
import { getUserInfo } from "@/lib/auth-utils";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/warehouse/quarantine")({
  head: () => ({
    meta: [
      { title: "Quarantine Management · KaizenX" },
      {
        name: "description",
        content: "Warehouse Quarantine and Damaged Goods Disposition Review Console.",
      },
    ],
  }),
  component: WarehouseQuarantinePage,
});

interface QuarantineRecord {
  id: string;
  quarantine_number: string;
  grn_id?: string | null;
  grn_number?: string | null;
  grn_line_id?: string | null;
  receiving_line_id?: string | null;
  item_code: string;
  material_name: string;
  variant_code?: string | null;
  damaged_quantity: number;
  uom: string;
  batch_number?: string | null;
  material_tag?: string | null;
  supplier_name?: string | null;
  po_number?: string | null;
  asn_number?: string | null;
  warehouse_id: string;
  reason: string;
  receiving_notes?: string | null;
  status: string;
  disposition?: string | null;
  review_remarks?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  audits?: {
    id: string;
    previous_status: string;
    new_status: string;
    disposition: string;
    remarks?: string | null;
    performed_by: string;
    performed_at: string;
  }[];
}

function WarehouseQuarantinePage() {
  const [records, setRecords] = useState<QuarantineRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  // Review / Inspection Dialog
  const [selectedRecord, setSelectedRecord] = useState<QuarantineRecord | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [disposition, setDisposition] = useState<string>("ACCEPTED_WITH_DEVIATION");
  const [remarks, setRemarks] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);

  // Confirm Scrap / RTV confirmation
  const [confirmScrapOpen, setConfirmScrapOpen] = useState(false);

  const user = getUserInfo();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const fetchRecords = async () => {
    try {
      setLoading(true);
      const data = await api.getQuarantineRecords({
        status: statusFilter !== "ALL" ? statusFilter : undefined,
        search: search.trim() || undefined,
      });
      setRecords(data || []);
    } catch (err: any) {
      toast.error(err.message || "Failed to load quarantine records");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecords();
  }, [statusFilter]);

  const handleOpenDetail = async (rec: QuarantineRecord) => {
    setSelectedRecord(rec);
    setDisposition("ACCEPTED_WITH_DEVIATION");
    setRemarks("");
    setDetailModalOpen(true);
    try {
      setLoadingDetail(true);
      const full = await api.getQuarantineRecord(rec.id);
      setSelectedRecord(full);
    } catch (err: any) {
      toast.error("Could not fetch full quarantine details");
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleSubmitReview = async () => {
    if (!selectedRecord) return;
    if (disposition === "SCRAPPED" && !confirmScrapOpen) {
      setConfirmScrapOpen(true);
      return;
    }

    setSubmittingReview(true);
    try {
      const res = await api.reviewQuarantineRecord(selectedRecord.id, {
        disposition,
        remarks: remarks.trim() || undefined,
      });
      toast.success(res.message || `Quarantine record marked as ${disposition}`);
      setDetailModalOpen(false);
      setConfirmScrapOpen(false);
      fetchRecords();
    } catch (err: any) {
      toast.error(err.message || "Failed to submit quarantine review");
    } finally {
      setSubmittingReview(false);
    }
  };

  // Metrics
  const metrics = useMemo(() => {
    const total = records.length;
    const pending = records.filter((r) => r.status === "PENDING_REVIEW").length;
    const deviation = records.filter((r) => r.status === "ACCEPTED_WITH_DEVIATION").length;
    const rtv = records.filter((r) => r.status === "RETURN_TO_VENDOR").length;
    const scrapped = records.filter((r) => r.status === "SCRAPPED").length;
    const rework = records.filter((r) => r.status === "REWORK").length;
    return { total, pending, deviation, rtv, scrapped, rework };
  }, [records]);

  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return (
        r.quarantine_number.toLowerCase().includes(q) ||
        r.item_code.toLowerCase().includes(q) ||
        r.material_name.toLowerCase().includes(q) ||
        (r.grn_number && r.grn_number.toLowerCase().includes(q)) ||
        (r.supplier_name && r.supplier_name.toLowerCase().includes(q)) ||
        (r.po_number && r.po_number.toLowerCase().includes(q))
      );
    });
  }, [records, search]);

  return (
    <AppShell
      title="Warehouse Quarantine & Damaged Material"
      subtitle={`Warehouse Review & Disposition Console · Authenticated as ${mounted ? (user?.username || "Warehouse") : "Warehouse"}`}
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={fetchRecords}
          disabled={loading}
          className="rounded-xl border-border/40"
        >
          <RefreshCw className={cn("size-3.5 mr-1.5", loading && "animate-spin")} /> Refresh
        </Button>
      }
    >
      <div className="space-y-6">
        {/* Quarantine Metrics Header */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <Card className="rounded-2xl border bg-card p-4 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Total Quarantined
            </p>
            <p className="mt-1 text-2xl font-black text-foreground">{metrics.total}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Isolated from inventory</p>
          </Card>
          <Card className="rounded-2xl border bg-amber-500/10 border-amber-500/20 p-4 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
              Pending Review
            </p>
            <p className="mt-1 text-2xl font-black text-amber-600 dark:text-amber-400">
              {metrics.pending}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Awaiting disposition</p>
          </Card>
          <Card className="rounded-2xl border bg-emerald-500/10 border-emerald-500/20 p-4 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
              Accepted w/ Dev
            </p>
            <p className="mt-1 text-2xl font-black text-emerald-600 dark:text-emerald-400">
              {metrics.deviation}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Routed to Putaway</p>
          </Card>
          <Card className="rounded-2xl border bg-blue-500/10 border-blue-500/20 p-4 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
              Return to Vendor
            </p>
            <p className="mt-1 text-2xl font-black text-blue-600 dark:text-blue-400">
              {metrics.rtv}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Supplier RMA flagged</p>
          </Card>
          <Card className="rounded-2xl border bg-rose-500/10 border-rose-500/20 p-4 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">
              Scrapped
            </p>
            <p className="mt-1 text-2xl font-black text-rose-600 dark:text-rose-400">
              {metrics.scrapped}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Permanently written off</p>
          </Card>
          <Card className="rounded-2xl border bg-purple-500/10 border-purple-500/20 p-4 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400">
              Rework
            </p>
            <p className="mt-1 text-2xl font-black text-purple-600 dark:text-purple-400">
              {metrics.rework}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Internal refurbishing</p>
          </Card>
        </div>

        {/* Filter & Search Bar */}
        <Card className="rounded-2xl border shadow-sm">
          <CardHeader className="p-4 pb-3 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ShieldAlert className="size-5 text-amber-500" />
              <div>
                <CardTitle className="text-base font-bold">
                  Quarantined Material Inventory
                </CardTitle>
                <CardDescription className="text-xs">
                  Damaged goods segregated at receiving. Damaged quantities do NOT enter available
                  stock.
                </CardDescription>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <div className="relative w-64">
                <Search className="size-3.5 absolute left-3 top-2.5 text-muted-foreground" />
                <Input
                  placeholder="Search item, GRN, supplier..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 h-8 text-xs rounded-xl bg-background/50 border-border/40"
                />
              </div>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-44 h-8 text-xs rounded-xl border-border/40">
                  <SelectValue placeholder="Status Filter" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Statuses</SelectItem>
                  <SelectItem value="PENDING_REVIEW">Pending Review</SelectItem>
                  <SelectItem value="ACCEPTED_WITH_DEVIATION">Accepted w/ Deviation</SelectItem>
                  <SelectItem value="RETURN_TO_VENDOR">Return to Vendor</SelectItem>
                  <SelectItem value="SCRAPPED">Scrapped</SelectItem>
                  <SelectItem value="REWORK">Rework</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                <Loader2 className="size-6 animate-spin text-primary" />
                <p className="text-xs">Loading quarantine records...</p>
              </div>
            ) : filteredRecords.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2 text-center p-6">
                <ShieldCheck className="size-10 text-emerald-500/40" />
                <p className="font-semibold text-sm text-foreground">No Quarantined Goods</p>
                <p className="text-xs text-muted-foreground max-w-md">
                  {search || statusFilter !== "ALL"
                    ? "No records match your search filter."
                    : "No damaged goods are currently in quarantine. Damaged materials identified at receiving will automatically appear here."}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/30 text-xs font-semibold uppercase text-muted-foreground border-b border-border/40">
                    <tr>
                      <th className="py-3 px-4">Quarantine #</th>
                      <th className="py-3 px-4">Material Details</th>
                      <th className="py-3 px-4">Source GRN & PO</th>
                      <th className="py-3 px-4 text-right">Damaged Quantity</th>
                      <th className="py-3 px-4">Reason & Notes</th>
                      <th className="py-3 px-4 text-center">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20">
                    {filteredRecords.map((rec) => (
                      <tr key={rec.id} className="hover:bg-muted/10 transition-colors">
                        <td className="py-3 px-4 font-mono font-bold text-xs text-primary">
                          <span className="inline-flex items-center gap-1.5 bg-primary/10 px-2 py-0.5 rounded-md border border-primary/20">
                            <ShieldAlert className="size-3" /> {rec.quarantine_number}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <p className="font-bold text-xs text-foreground">{rec.material_name}</p>
                          <p className="font-mono text-[11px] text-muted-foreground">
                            {rec.item_code}
                          </p>
                        </td>
                        <td className="py-3 px-4 text-xs">
                          <p className="font-mono font-semibold text-foreground">
                            {rec.grn_number || "—"}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            PO: {rec.po_number || "—"}
                          </p>
                        </td>
                        <td className="py-3 px-4 text-right font-black text-xs text-rose-600 dark:text-rose-400">
                          {rec.damaged_quantity.toLocaleString()}{" "}
                          <span className="font-normal text-muted-foreground">{rec.uom}</span>
                        </td>
                        <td className="py-3 px-4 text-xs max-w-xs">
                          <p className="text-foreground truncate">{rec.reason}</p>
                          {rec.receiving_notes && (
                            <p className="text-[11px] text-muted-foreground truncate">
                              {rec.receiving_notes}
                            </p>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <StatusBadge status={rec.status} />
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenDetail(rec)}
                            className="h-7 px-2.5 rounded-lg text-xs font-semibold gap-1 hover:bg-primary/10 hover:text-primary"
                          >
                            <Eye className="size-3" />{" "}
                            {rec.status === "PENDING_REVIEW" ? "Review" : "View"}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* DETAIL & REVIEW DIALOG */}
        <Dialog open={detailModalOpen} onOpenChange={setDetailModalOpen}>
          <DialogContent className="sm:max-w-xl rounded-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ShieldAlert className="size-5 text-amber-500" />
                Quarantine Inspection & Disposition
              </DialogTitle>
              <DialogDescription className="text-xs">
                Review damaged material details and assign warehouse disposition.
              </DialogDescription>
            </DialogHeader>

            {selectedRecord && (
              <div className="space-y-4 pt-2">
                {/* Header Summary Banner */}
                <div className="rounded-xl border bg-muted/20 p-3.5 text-xs">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-mono font-bold text-primary">
                        {selectedRecord.quarantine_number}
                      </p>
                      <p className="font-bold text-foreground text-sm mt-0.5">
                        {selectedRecord.material_name}
                      </p>
                      <p className="font-mono text-muted-foreground">{selectedRecord.item_code}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-black text-lg text-rose-600 dark:text-rose-400">
                        {selectedRecord.damaged_quantity.toLocaleString()} {selectedRecord.uom}
                      </p>
                      <StatusBadge status={selectedRecord.status} />
                    </div>
                  </div>
                </div>

                {/* Receiving & GRN Context Grid */}
                <div className="grid grid-cols-2 gap-2.5 text-xs">
                  <div className="rounded-xl border p-2.5 bg-card">
                    <p className="text-[10px] font-bold uppercase text-muted-foreground">
                      Source GRN
                    </p>
                    <p className="font-mono font-bold text-foreground mt-0.5">
                      {selectedRecord.grn_number || "—"}
                    </p>
                  </div>
                  <div className="rounded-xl border p-2.5 bg-card">
                    <p className="text-[10px] font-bold uppercase text-muted-foreground">
                      Purchase Order
                    </p>
                    <p className="font-mono font-bold text-foreground mt-0.5">
                      {selectedRecord.po_number || "—"}
                    </p>
                  </div>
                  <div className="rounded-xl border p-2.5 bg-card">
                    <p className="text-[10px] font-bold uppercase text-muted-foreground">
                      Supplier
                    </p>
                    <p className="font-bold text-foreground mt-0.5 truncate">
                      {selectedRecord.supplier_name || "—"}
                    </p>
                  </div>
                  <div className="rounded-xl border p-2.5 bg-card">
                    <p className="text-[10px] font-bold uppercase text-muted-foreground">
                      Quarantined On
                    </p>
                    <p className="text-foreground mt-0.5">
                      {new Date(selectedRecord.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>

                {/* Notes / Reason */}
                <div className="rounded-xl border p-3 bg-muted/10 text-xs space-y-1">
                  <p className="font-bold text-foreground">Damage Notes / Reason:</p>
                  <p className="text-muted-foreground leading-relaxed">{selectedRecord.reason}</p>
                  {selectedRecord.receiving_notes && (
                    <p className="text-muted-foreground italic border-t pt-1 mt-1">
                      Inspector Notes: {selectedRecord.receiving_notes}
                    </p>
                  )}
                </div>

                {/* Disposition Form for PENDING_REVIEW records */}
                {selectedRecord.status === "PENDING_REVIEW" ? (
                  <div className="space-y-3 pt-1">
                    <Label className="text-xs font-bold text-foreground">
                      Select Warehouse Disposition <span className="text-destructive">*</span>
                    </Label>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        variant={disposition === "ACCEPTED_WITH_DEVIATION" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setDisposition("ACCEPTED_WITH_DEVIATION")}
                        className="rounded-xl text-xs justify-start h-auto py-2.5 gap-2"
                      >
                        <FileCheck className="size-4 shrink-0 text-emerald-500" />
                        <div className="text-left">
                          <p className="font-bold leading-none">Accept w/ Deviation</p>
                          <p className="text-[10px] opacity-75 mt-0.5">Route to Store Putaway</p>
                        </div>
                      </Button>

                      <Button
                        type="button"
                        variant={disposition === "RETURN_TO_VENDOR" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setDisposition("RETURN_TO_VENDOR")}
                        className="rounded-xl text-xs justify-start h-auto py-2.5 gap-2"
                      >
                        <Undo2 className="size-4 shrink-0 text-blue-500" />
                        <div className="text-left">
                          <p className="font-bold leading-none">Return to Vendor</p>
                          <p className="text-[10px] opacity-75 mt-0.5">Supplier RMA return</p>
                        </div>
                      </Button>

                      <Button
                        type="button"
                        variant={disposition === "SCRAPPED" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setDisposition("SCRAPPED")}
                        className="rounded-xl text-xs justify-start h-auto py-2.5 gap-2"
                      >
                        <Trash2 className="size-4 shrink-0 text-rose-500" />
                        <div className="text-left">
                          <p className="font-bold leading-none">Scrap Material</p>
                          <p className="text-[10px] opacity-75 mt-0.5">Permanent write-off</p>
                        </div>
                      </Button>

                      <Button
                        type="button"
                        variant={disposition === "REWORK" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setDisposition("REWORK")}
                        className="rounded-xl text-xs justify-start h-auto py-2.5 gap-2"
                      >
                        <Wrench className="size-4 shrink-0 text-purple-500" />
                        <div className="text-left">
                          <p className="font-bold leading-none">Rework / Refurbish</p>
                          <p className="text-[10px] opacity-75 mt-0.5">Internal maintenance</p>
                        </div>
                      </Button>
                    </div>

                    <div className="space-y-1.5 pt-1">
                      <Label className="text-xs font-bold text-foreground">
                        Review Remarks / Justification
                      </Label>
                      <Textarea
                        placeholder="Enter justification for the selected disposition decision..."
                        value={remarks}
                        onChange={(e) => setRemarks(e.target.value)}
                        className="text-xs resize-none"
                        rows={3}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs space-y-1">
                    <p className="font-bold text-foreground flex items-center gap-1.5">
                      <CheckCircle2 className="size-4 text-emerald-500" /> Reviewed as{" "}
                      {selectedRecord.disposition}
                    </p>
                    <p className="text-muted-foreground">
                      Reviewed by {selectedRecord.reviewed_by} on{" "}
                      {selectedRecord.reviewed_at
                        ? new Date(selectedRecord.reviewed_at).toLocaleString()
                        : "—"}
                    </p>
                    {selectedRecord.review_remarks && (
                      <p className="text-foreground pt-1 border-t mt-1">
                        {selectedRecord.review_remarks}
                      </p>
                    )}
                  </div>
                )}

                {/* Audit History */}
                {selectedRecord.audits && selectedRecord.audits.length > 0 && (
                  <div className="space-y-2 pt-2 border-t text-xs">
                    <p className="font-bold text-foreground">
                      Audit Log ({selectedRecord.audits.length})
                    </p>
                    <div className="space-y-1.5">
                      {selectedRecord.audits.map((a) => (
                        <div
                          key={a.id}
                          className="rounded-lg bg-muted/20 p-2 text-[11px] flex justify-between items-center"
                        >
                          <div>
                            <span className="font-bold text-primary">{a.disposition}</span> ·{" "}
                            {a.remarks || "No remarks"}
                            <p className="text-muted-foreground text-[10px]">by {a.performed_by}</p>
                          </div>
                          <span className="text-muted-foreground text-[10px]">
                            {new Date(a.performed_at).toLocaleDateString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <DialogFooter className="pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setDetailModalOpen(false)}
                    className="rounded-xl text-xs"
                  >
                    Close
                  </Button>
                  {selectedRecord.status === "PENDING_REVIEW" && (
                    <Button
                      type="button"
                      size="sm"
                      disabled={submittingReview}
                      onClick={handleSubmitReview}
                      className="rounded-xl text-xs font-semibold shadow-glow"
                    >
                      {submittingReview ? (
                        <Loader2 className="size-3.5 animate-spin mr-1.5" />
                      ) : null}
                      Submit Disposition
                    </Button>
                  )}
                </DialogFooter>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* CONFIRM SCRAP / PERMANENT DISPOSITION DIALOG */}
        <Dialog open={confirmScrapOpen} onOpenChange={setConfirmScrapOpen}>
          <DialogContent className="sm:max-w-md rounded-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="size-5" /> Confirm Material Scrap
              </DialogTitle>
              <DialogDescription className="text-xs">
                This will permanently write off {selectedRecord?.damaged_quantity}{" "}
                {selectedRecord?.uom} of {selectedRecord?.material_name}. It will not enter
                warehouse inventory.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmScrapOpen(false)}
                className="rounded-xl text-xs"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={submittingReview}
                onClick={handleSubmitReview}
                className="rounded-xl text-xs font-semibold"
              >
                {submittingReview ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : null}
                Confirm Scrap Write-off
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
