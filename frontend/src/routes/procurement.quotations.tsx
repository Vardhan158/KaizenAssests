import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  FileBadge,
  ArrowLeft,
  CheckCircle2,
  Download,
  Trophy,
  Loader2,
  Table as TableIcon,
  MessageSquare,
  Sparkles,
  Eye,
  CheckCircle,
  X,
  XCircle,
  ArrowRight,
  FileCheck2,
  Package,
  Wallet,
  Clock,
  ShieldCheck,
  TrendingDown,
  AlertCircle,
  Truck,
  Info,
} from "lucide-react";
import { AppShell, StatusBadge } from "@/components/wms/app-shell";
import { requireRole } from "@/lib/auth-utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type QuotationsSearch = {
  rfqId?: string;
};

const OTHER_SELECTION_REASON = "Other - Requires Justification";

const selectionReasons = [
  { value: "L1 Cost Effective Bid", detail: "Lowest evaluated commercial cost" },
  { value: "Best Overall Value", detail: "Best combination of cost, quality, delivery, and terms" },
  { value: "Technical Compliance", detail: "Meets all required technical specifications" },
  { value: "Quality Performance", detail: "Strong quality and low rejection history" },
  { value: "Delivery Performance", detail: "Best delivery lead time or on-time performance" },
  { value: "Commercial Terms", detail: "Better payment, warranty, freight, or other commercial terms" },
  { value: "Total Cost Advantage", detail: "Lower overall cost including logistics and service" },
  { value: "Approved Preferred Supplier", detail: "Existing preferred or strategic supplier" },
  { value: "Supplier Performance History", detail: "Strong previous procurement performance" },
  { value: "Capacity & Availability", detail: "Supplier can meet the required quantity or capacity" },
  { value: "Urgent Requirement", detail: "Supplier can meet the required timeline" },
  { value: "Compliance & Certification", detail: "Meets required compliance or certification requirements" },
  { value: "Single / Limited Source", detail: "Limited qualified suppliers are available" },
  { value: "Contract / Rate Agreement", detail: "Supplier is covered by an existing agreement" },
  { value: "After-Sales / Support Advantage", detail: "Better service, warranty, or support" },
  { value: "Negotiated Best Offer", detail: "Supplier provided the best result after negotiation" },
  { value: "Multi-Criteria Evaluation Winner", detail: "Highest weighted evaluation score" },
  { value: OTHER_SELECTION_REASON, detail: "A written business justification is required" },
] as const;

const rejectionReasons = [
  "Price Exceeds Approved Budget",
  "Higher Than Other Qualified Bids",
  "Technical Non-Compliance",
  "Quality Requirements Not Met",
  "Delivery Timeline Not Acceptable",
  "Insufficient Supplier Capacity",
  "Compliance / Certification Issue",
  "Commercial Terms Not Acceptable",
  "Payment Terms Not Acceptable",
  "Supplier Performance Concerns",
  "Incomplete Quotation",
  "Quotation Expired",
  "Supplier Disqualified",
  "Duplicate / Invalid Quotation",
  "Requirement Cancelled",
  "Budget Not Available",
  OTHER_SELECTION_REASON,
] as const;

export const Route = createFileRoute("/procurement/quotations")({
  beforeLoad: () => requireRole(["PROCUREMENT", "MANAGER", "ADMIN", "SUPERUSER"]),
  component: Quotations,
  validateSearch: (search: Record<string, unknown>): QuotationsSearch => {
    return {
      rfqId: (search.rfqId as string) || undefined,
    };
  },
});

function Quotations() {
  const navigate = useNavigate();
  const { rfqId } = Route.useSearch();
  const [quotations, setQuotations] = useState<any[]>([]);
  const [rfq, setRfq] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [showOlderQuotations, setShowOlderQuotations] = useState(false);
  const [inspectQuotation, setInspectQuotation] = useState<any | null>(null);

  // Selection Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"SELECT" | "REJECT">("SELECT");
  const [submitting, setSubmitting] = useState(false);
  const [targetQuotationId, setTargetQuotationId] = useState("");
  const [targetSupplierId, setTargetSupplierId] = useState("");
  const [reason, setReason] = useState("");
  const [procurementComments, setProcurementComments] = useState("");
  const [rejectionJustification, setRejectionJustification] = useState("");

  const fetchData = async () => {
    try {
      setLoading(true);
      const [quotesData, rfqData] = await Promise.all([
        api.getQuotations(rfqId),
        rfqId ? api.getRfq(rfqId) : Promise.resolve(null),
      ]);

      setQuotations(quotesData);
      setRfq(rfqData);

    } catch (error) {
      console.error("Failed to fetch data:", error);
      toast.error("Failed to load quotations");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [rfqId]);

  const selectionFinalized = quotations.some((quotation) => quotation.status === "Selected");
  const latestQuotationIds = new Set<string>();
  const latestQuotationsBySupplier = new Map<string, any>();

  quotations.forEach((quotation) => {
    const supplierKey =
      quotation.supplierId ||
      quotation.supplier_id ||
      quotation.supplierInfo?.supplierName ||
      quotation.supplierName ||
      quotation.id;
    const existingQuotation = latestQuotationsBySupplier.get(supplierKey);
    const quotationDate = new Date(quotation.createdAt || quotation.created_at || 0).getTime() || 0;
    const existingDate = existingQuotation
      ? new Date(existingQuotation.createdAt || existingQuotation.created_at || 0).getTime() || 0
      : -1;

    if (!existingQuotation || quotationDate >= existingDate) {
      latestQuotationsBySupplier.set(supplierKey, quotation);
    }
  });

  latestQuotationsBySupplier.forEach((quotation) => latestQuotationIds.add(quotation.id));
  const olderQuotationCount = quotations.length - latestQuotationIds.size;
  const comparisonQuotations = quotations.filter(
    (quotation) => showOlderQuotations || latestQuotationIds.has(quotation.id),
  );
  const selectedReasonDetail = selectionReasons.find((selectionReason) => selectionReason.value === reason)?.detail;

  const handleOpenModal = (quotationId: string, supplierId: string, mode: "SELECT" | "REJECT") => {
    setTargetQuotationId(quotationId);
    setTargetSupplierId(supplierId);
    setModalMode(mode);
    setReason(mode === "SELECT" ? "Best Overall Value" : "");
    setProcurementComments("");
    setRejectionJustification("");
    setIsModalOpen(true);
  };

  const handleAction = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    const effectiveRfqId = rfqId || quotations.find((q) => q.id === targetQuotationId)?.rfqId;

    if (!targetQuotationId) {
      toast.error("Required selection IDs are missing.");
      return;
    }

    if (!reason.trim()) {
      toast.error(`Please select a ${modalMode === "SELECT" ? "selection" : "rejection"} reason.`);
      return;
    }

    if (modalMode === "SELECT" && reason === OTHER_SELECTION_REASON && !procurementComments.trim()) {
      toast.error("Please provide a justification for the other selection reason.");
      return;
    }

    if (modalMode === "REJECT" && reason === OTHER_SELECTION_REASON && !rejectionJustification.trim()) {
      toast.error("Please provide a justification for the other rejection reason.");
      return;
    }

    try {
      setSubmitting(true);

      if (modalMode === "SELECT") {
        if (!effectiveRfqId || !targetSupplierId) {
          toast.error("Missing RFQ or Supplier ID for selection");
          return;
        }

        const result = await api.selectSupplier(effectiveRfqId, {
          supplier_id: targetSupplierId,
          quotation_id: targetQuotationId,
          selection_reason: reason,
          selection_comments: procurementComments,
        });
        toast.success(
          result.status === "already_saved"
            ? `Selection already saved as ${result.po_number}`
            : "Supplier selected and PO proposal generated",
        );
      } else {
        await api.rejectQuotation(
          targetQuotationId,
          reason === OTHER_SELECTION_REASON
            ? `${reason}: ${rejectionJustification.trim()}`
            : reason,
        );
        toast.success("Quotation rejected");
      }

      setIsModalOpen(false);
      fetchData(); // Refresh to show updated statuses

      // Reset form
      setReason("");
      setProcurementComments("");
      setRejectionJustification("");
    } catch (error: any) {
      toast.error(`Action failed: ${error.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  // Group line items by code to compare pricing
  const uniqueItemCodes = Array.from(
    new Set(
      comparisonQuotations.flatMap((q) =>
        q.lines?.map((l: any) => l.itemCode || l.item_code) || [],
      ),
    ),
  ).filter(Boolean);

  const calculateTotal = (q: any) => {
    let total = parseFloat(q.totalAmount || q.total_amount || 0);
    if (total === 0 && q.lines && q.lines.length > 0) {
      const lineTotal = q.lines.reduce(
        (sum: number, l: any) =>
          sum +
          parseFloat(l.quantity) * parseFloat(l.unitPrice || l.unit_price || 0),
        0,
      );
      const disc = parseFloat(q.discount || 0);
      const tx = parseFloat(q.tax || 0);
      const fr = parseFloat(q.freightCharges || q.freight_charges || 0);
      const base = lineTotal - disc;
      total = base + base * (tx / 100) + fr;
    }
    return total;
  };

  const formatMoney = (value: number) =>
    `INR ${Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "0"}`;

  const calculateLowestUnitRate = (q: any) => {
    const rates = (q.lines || [])
      .map((line: any) => parseFloat(line.unitPrice || line.unit_price || 0))
      .filter((rate: number) => Number.isFinite(rate) && rate > 0);
    return rates.length > 0 ? Math.min(...rates) : 0;
  };

  const bestQuotationId = comparisonQuotations.length > 0
    ? comparisonQuotations.reduce((prev, curr) =>
        (calculateTotal(curr) < calculateTotal(prev) ? curr : prev), comparisonQuotations[0]
      )?.id
    : null;

  return (
    <AppShell
      title={
        <div className="flex items-center gap-2">
          <span>Quotations</span>
          <TooltipProvider>
            <Tooltip delayDuration={200}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Quotations Info"
                  className="inline-flex items-center text-muted-foreground hover:text-foreground transition-colors cursor-help"
                >
                  <Info className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-xs text-xs">
                <p className="font-semibold">Quotations</p>
                <p className="mt-0.5">Supplier price and commercial offers received in response to an RFQ. Use this section to compare supplier quotations before proceeding with purchase order creation.</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      }
      subtitle={
        rfqId
          ? `Comparing bids for RFQ: ${rfq?.rfqNumber || rfqId}`
          : "Select an RFQ to view side-by-side supplier comparisons"
      }
      actions={
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            className="rounded-xl"
            onClick={() => navigate({ to: "/procurement/rfqs" })}
          >
            <ArrowLeft className="mr-2 size-4" /> Back to RFQs
          </Button>
        </div>
      }
    >
      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : quotations.length === 0 ? (
        <Card className="flex h-64 flex-col items-center justify-center p-6 text-center border-dashed border-border/50 bg-muted/20">
          <FileBadge className="size-12 text-muted-foreground/30 mb-4" />
          <h3 className="text-lg font-semibold text-muted-foreground">No quotations found</h3>
          <p className="text-sm text-muted-foreground/70">
            There are currently no quotations received for this request.
          </p>
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="rounded-3xl border border-border/40 bg-card shadow-soft overflow-hidden">
            <div className="bg-primary/5 p-6 border-b border-border/40 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-2xl bg-primary/10 text-primary">
                  <TableIcon className="size-6" />
                </div>
                <div>
                  <h2 className="text-lg font-black tracking-tight text-foreground uppercase">
                    Bidding Comparison Matrix
                  </h2>
                  <p className="text-sm text-muted-foreground font-medium">
                    Side-by-side analysis of price, delivery, terms, warranty, and total value
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {olderQuotationCount > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-9 rounded-xl text-[10px] font-black uppercase tracking-widest text-primary hover:bg-primary-soft/30 px-4 border border-primary/20"
                    onClick={() => setShowOlderQuotations((current) => !current)}
                  >
                    {showOlderQuotations
                      ? "Hide Archive"
                      : `History (${olderQuotationCount})`}
                  </Button>
                )}
                <div className="hidden sm:flex items-center gap-2 px-4 py-2 bg-success/10 rounded-xl border border-success/20">
                  <Trophy className="size-4 text-success" />
                  <span className="text-[10px] font-black uppercase text-success tracking-wider">
                    Lowest Total Flagged
                  </span>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[800px]">
                <thead>
                  <tr>
                    <th className="p-6 bg-muted/20 w-[240px] border-r border-border/40 sticky left-0 z-10 backdrop-blur-md">
                      <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">
                        Bidding Factors
                      </span>
                    </th>
                    {comparisonQuotations.map((q, idx) => {
                      const isL1 = bestQuotationId === q.id;
                      const isSelected = q.status === "Selected";
                      return (
                        <th
                          key={q.id || `q-head-${idx}`}
                          className={cn(
                            "p-6 min-w-[280px] border-r border-border/40 relative group transition-colors",
                            (isL1 || isSelected) && "bg-primary/[0.02]",
                          )}
                        >
                          {isSelected ? (
                            <div className="absolute top-0 left-0 right-0 h-1 bg-success shadow-[0_2px_10px_rgba(34,197,94,0.4)]" />
                          ) : isL1 ? (
                            <div className="absolute top-0 left-0 right-0 h-1 bg-primary" />
                          ) : null}
                          <div className="flex flex-col gap-3">
                            <div className="flex items-center justify-between">
                              <StatusBadge status={q.status} />
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setInspectQuotation(q)}
                                className="rounded-lg text-[10px] h-7 font-bold gap-1 bg-muted/30 hover:bg-muted/55 text-foreground"
                              >
                                <Eye className="size-3 text-primary" /> Final Review
                              </Button>
                            </div>
                            <div className="flex items-center justify-between">
                              {isSelected ? (
                                <span className="flex items-center gap-1 text-[9px] font-black text-success uppercase bg-success-soft/30 px-2 py-0.5 rounded-md">
                                  <Sparkles className="size-3" /> Selected
                                </span>
                              ) : isL1 ? (
                                <span className="flex items-center gap-1 text-[9px] font-black text-primary uppercase bg-primary-soft/20 px-2 py-0.5 rounded-md">
                                  <Trophy className="size-3" /> Lowest Total
                                </span>
                              ) : null}
                            </div>
                            <div>
                              <h3 className="font-black text-base text-foreground leading-none">
                                {q.supplierInfo?.supplierName || q.supplierName || `Supplier ${idx + 1}`}
                              </h3>
                              <p className="text-[10px] font-mono text-muted-foreground mt-1 uppercase tracking-widest font-bold">
                                {q.supplierInfo?.supplierCode || q.id.substring(0, 8)}
                              </p>
                            </div>
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40 text-xs">
                  <tr className="bg-gradient-to-r from-primary/15 via-primary/5 to-transparent border-y border-primary/20">
                    <td className="p-3.5 px-6 border-r border-border/40 sticky left-0 z-10 bg-card/95 backdrop-blur-md">
                      <div className="flex items-center gap-2 text-primary">
                        <TableIcon className="size-4" />
                        <span className="text-[11px] font-black uppercase tracking-widest">
                          Decision Criteria
                        </span>
                      </div>
                    </td>
                    {comparisonQuotations.map((q) => (
                      <td key={`cat-criteria-${q.id}`} className={cn("p-3.5 border-r border-border/40", (bestQuotationId === q.id || q.status === "Selected") && "bg-primary/[0.04]")}></td>
                    ))}
                  </tr>

                  <tr className="hover:bg-muted/5">
                    <td className="p-4 px-6 border-r border-border/40 sticky left-0 z-10 bg-card hover:bg-muted/5">
                      <span className="text-xs font-bold">Unit Price</span>
                    </td>
                    {comparisonQuotations.map((q) => (
                      <td
                        key={`${q.id}-criteria-unit-price`}
                        className={cn(
                          "p-4 border-r border-border/40 text-sm font-black tabular-nums",
                          (bestQuotationId === q.id || q.status === "Selected") && "bg-primary/[0.02]",
                        )}
                      >
                        {formatMoney(calculateLowestUnitRate(q))}
                      </td>
                    ))}
                  </tr>

                  <tr className="hover:bg-muted/5">
                    <td className="p-4 px-6 border-r border-border/40 sticky left-0 z-10 bg-card hover:bg-muted/5">
                      <span className="text-xs font-bold">Delivery</span>
                    </td>
                    {comparisonQuotations.map((q) => (
                      <td
                        key={`${q.id}-criteria-delivery`}
                        className={cn(
                          "p-4 border-r border-border/40 text-xs font-black text-foreground",
                          (bestQuotationId === q.id || q.status === "Selected") && "bg-primary/[0.02]",
                        )}
                      >
                        {q.deliveryTime || q.delivery_time || q.expectedDeliveryDate || q.expected_delivery_date || "-"}
                      </td>
                    ))}
                  </tr>

                  <tr className="hover:bg-muted/5">
                    <td className="p-4 px-6 border-r border-border/40 sticky left-0 z-10 bg-card hover:bg-muted/5">
                      <span className="text-xs font-bold">Payment</span>
                    </td>
                    {comparisonQuotations.map((q) => (
                      <td
                        key={`${q.id}-criteria-payment`}
                        className={cn(
                          "p-4 border-r border-border/40 text-xs font-medium leading-relaxed text-muted-foreground",
                          (bestQuotationId === q.id || q.status === "Selected") && "bg-primary/[0.02]",
                        )}
                      >
                        {q.paymentTerms || q.payment_terms || "-"}
                      </td>
                    ))}
                  </tr>

                  <tr className="hover:bg-muted/5">
                    <td className="p-4 px-6 border-r border-border/40 sticky left-0 z-10 bg-card hover:bg-muted/5">
                      <div className="flex items-center gap-2">
                        <ShieldCheck className="size-3.5 text-muted-foreground" />
                        <span className="text-xs font-bold">Warranty</span>
                      </div>
                    </td>
                    {comparisonQuotations.map((q) => (
                      <td
                        key={`${q.id}-criteria-warranty`}
                        className={cn(
                          "p-4 border-r border-border/40 text-xs font-black text-foreground",
                          (bestQuotationId === q.id || q.status === "Selected") && "bg-primary/[0.02]",
                        )}
                      >
                        {q.warranty || "-"}
                      </td>
                    ))}
                  </tr>

                  <tr className="hover:bg-muted/5">
                    <td className="p-4 px-6 border-r border-border/40 sticky left-0 z-10 bg-card hover:bg-muted/5">
                      <span className="text-xs font-bold">Total</span>
                    </td>
                    {comparisonQuotations.map((q) => (
                      <td
                        key={`${q.id}-criteria-total`}
                        className={cn(
                          "p-4 border-r border-border/40 text-base font-black tabular-nums",
                          (bestQuotationId === q.id || q.status === "Selected") && "bg-primary/[0.02]",
                        )}
                      >
                        {formatMoney(calculateTotal(q))}
                      </td>
                    ))}
                  </tr>

                  {/* Category: Materials */}
                  <tr className="bg-gradient-to-r from-primary/15 via-primary/5 to-transparent border-y border-primary/20">
                    <td className="p-3.5 px-6 border-r border-border/40 sticky left-0 z-10 bg-card/95 backdrop-blur-md">
                      <div className="flex items-center gap-2 text-primary">
                        <Package className="size-4" />
                        <span className="text-[11px] font-black uppercase tracking-widest">
                          Item Rates & Quantities
                        </span>
                      </div>
                    </td>
                    {comparisonQuotations.map((q) => (
                      <td key={`cat-m-${q.id}`} className={cn("p-3.5 border-r border-border/40", (bestQuotationId === q.id || q.status === "Selected") && "bg-primary/[0.04]")}></td>
                    ))}
                  </tr>

                  {uniqueItemCodes.map((code) => (
                    <tr key={`row-item-${code}`} className="hover:bg-muted/5 transition-colors group">
                      <td className="p-4 px-6 border-r border-border/40 sticky left-0 z-10 bg-card group-hover:bg-muted/5 transition-colors">
                        <div className="space-y-1">
                          <p className="text-xs font-bold text-foreground">
                            {comparisonQuotations.flatMap(q => q.lines || []).find(l => l.itemCode === code || l.item_code === code)?.material_name || "Material Unit"}
                          </p>
                          <code className="text-[9px] text-primary font-black bg-primary-soft/30 px-1.5 py-0.5 rounded uppercase font-mono">
                            {code}
                          </code>
                        </div>
                      </td>
                      {comparisonQuotations.map((q) => {
                        const line = q.lines?.find((l: any) => l.itemCode === code || l.item_code === code);
                        return (
                          <td
                            key={`${q.id}-${code}`}
                            className={cn(
                              "p-4 border-r border-border/40",
                              (bestQuotationId === q.id || q.status === "Selected") && "bg-primary/[0.02]",
                            )}
                          >
                            {line ? (
                              <div className="flex flex-col gap-1.5">
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] text-muted-foreground font-black uppercase">Rate</span>
                                  <span className="text-sm font-black text-foreground tabular-nums">
                                    {formatMoney(parseFloat(line.unitPrice || line.unit_price))}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] text-muted-foreground font-black uppercase">Qty</span>
                                  <span className="text-xs font-bold text-muted-foreground">
                                    {Math.floor(parseFloat(line.quantity))} Units
                                  </span>
                                </div>
                              </div>
                            ) : (
                              <div className="text-center italic text-muted-foreground text-[10px]">No Quote</div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}

                  {/* Category: Financials */}
                  <tr className="bg-gradient-to-r from-primary/15 via-primary/5 to-transparent border-y border-primary/20">
                    <td className="p-3.5 px-6 border-r border-border/40 sticky left-0 z-10 bg-card/95 backdrop-blur-md">
                      <div className="flex items-center gap-2 text-primary">
                        <Wallet className="size-4" />
                        <span className="text-[11px] font-black uppercase tracking-widest">
                          Commercial Adjustments
                        </span>
                      </div>
                    </td>
                    {comparisonQuotations.map((q) => (
                      <td key={`cat-f-${q.id}`} className={cn("p-3.5 border-r border-border/40", (bestQuotationId === q.id || q.status === "Selected") && "bg-primary/[0.04]")}></td>
                    ))}
                  </tr>

                  <tr className="hover:bg-muted/5">
                    <td className="p-4 px-6 border-r border-border/40 sticky left-0 z-10 bg-card hover:bg-muted/5">
                      <div className="flex items-center gap-2">
                        <TrendingDown className="size-3.5 text-success" />
                        <span className="text-xs font-bold">Discount Offered</span>
                      </div>
                    </td>
                    {comparisonQuotations.map((q) => (
                      <td
                        key={`${q.id}-discount`}
                        className={cn(
                          "p-4 border-r border-border/40 font-black text-sm text-success tabular-nums",
                          (bestQuotationId === q.id || q.status === "Selected") && "bg-primary/[0.02]",
                        )}
                      >
                        {formatMoney(parseFloat(q.discount || 0))}
                      </td>
                    ))}
                  </tr>

                  <tr className="hover:bg-muted/5">
                    <td className="p-4 px-6 border-r border-border/40 sticky left-0 z-10 bg-card hover:bg-muted/5">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="size-3.5 text-muted-foreground" />
                        <span className="text-xs font-bold">Tax (GST %)</span>
                      </div>
                    </td>
                    {comparisonQuotations.map((q) => {
                      const baseTotal = (q.lines || []).reduce(
                        (sum: number, l: any) =>
                          sum +
                          parseFloat(l.quantity || 1) *
                            parseFloat(l.unitPrice || l.unit_price || 0),
                        0,
                      );
                      const disc = parseFloat(q.discount || 0);
                      const afterDisc = Math.max(0, baseTotal - disc);
                      const taxRate = parseFloat(q.tax || 0);
                      const taxMoney = afterDisc * (taxRate / 100);

                      return (
                        <td
                          key={`${q.id}-tax`}
                          className={cn(
                            "p-4 border-r border-border/40 font-bold text-sm tabular-nums",
                            (bestQuotationId === q.id || q.status === "Selected") && "bg-primary/[0.02]",
                          )}
                        >
                          {formatMoney(taxMoney)}
                          <span className="text-xs font-medium text-muted-foreground ml-1">
                            ({taxRate}%)
                          </span>
                        </td>
                      );
                    })}
                  </tr>

                  <tr className="hover:bg-muted/5">
                    <td className="p-4 px-6 border-r border-border/40 sticky left-0 z-10 bg-card hover:bg-muted/5">
                      <div className="flex items-center gap-2">
                        <Truck className="size-3.5 text-muted-foreground" />
                        <span className="text-xs font-bold">Freight Charges</span>
                      </div>
                    </td>
                    {comparisonQuotations.map((q) => (
                      <td
                        key={`${q.id}-freight`}
                        className={cn(
                          "p-4 border-r border-border/40 font-bold text-sm tabular-nums",
                          (bestQuotationId === q.id || q.status === "Selected") && "bg-primary/[0.02]",
                        )}
                      >
                        {formatMoney(parseFloat(q.freightCharges || q.freight_charges || 0))}
                      </td>
                    ))}
                  </tr>

                  {/* Category: Logistics */}
                  <tr className="bg-gradient-to-r from-primary/15 via-primary/5 to-transparent border-y border-primary/20">
                    <td className="p-3.5 px-6 border-r border-border/40 sticky left-0 z-10 bg-card/95 backdrop-blur-md">
                      <div className="flex items-center gap-2 text-primary">
                        <Clock className="size-4" />
                        <span className="text-[11px] font-black uppercase tracking-widest">
                          Logistics & Timeline
                        </span>
                      </div>
                    </td>
                    {comparisonQuotations.map((q) => (
                      <td key={`cat-l-${q.id}`} className={cn("p-3.5 border-r border-border/40", (bestQuotationId === q.id || q.status === "Selected") && "bg-primary/[0.04]")}></td>
                    ))}
                  </tr>

                  <tr className="hover:bg-muted/5">
                    <td className="p-4 px-6 border-r border-border/40 sticky left-0 z-10 bg-card hover:bg-muted/5">
                      <span className="text-xs font-bold">Delivery Time</span>
                    </td>
                    {comparisonQuotations.map((q) => (
                      <td
                        key={`${q.id}-del-time`}
                        className={cn(
                          "p-4 border-r border-border/40 text-xs font-black text-foreground tabular-nums",
                          (bestQuotationId === q.id || q.status === "Selected") && "bg-primary/[0.02]",
                        )}
                      >
                        {q.deliveryTime || q.delivery_time || "-"}
                      </td>
                    ))}
                  </tr>

                  <tr className="hover:bg-muted/5">
                    <td className="p-4 px-6 border-r border-border/40 sticky left-0 z-10 bg-card hover:bg-muted/5">
                      <span className="text-xs font-bold">Expected Delivery</span>
                    </td>
                    {comparisonQuotations.map((q) => (
                      <td
                        key={`${q.id}-del-date`}
                        className={cn(
                          "p-4 border-r border-border/40 text-xs font-black text-foreground tabular-nums",
                          (bestQuotationId === q.id || q.status === "Selected") && "bg-primary/[0.02]",
                        )}
                      >
                        {q.expectedDeliveryDate || q.expected_delivery_date || "-"}
                      </td>
                    ))}
                  </tr>

                  <tr className="hover:bg-muted/5">
                    <td className="p-4 px-6 border-r border-border/40 sticky left-0 z-10 bg-card hover:bg-muted/5">
                      <span className="text-xs font-bold">Payment Terms</span>
                    </td>
                    {comparisonQuotations.map((q) => (
                      <td
                        key={`${q.id}-pay`}
                        className={cn(
                          "p-4 border-r border-border/40 text-[11px] font-medium leading-relaxed italic text-muted-foreground",
                          (bestQuotationId === q.id || q.status === "Selected") && "bg-primary/[0.02]",
                        )}
                      >
                        {q.paymentTerms || q.payment_terms || "-"}
                      </td>
                    ))}
                  </tr>

                  <tr className="hover:bg-muted/5">
                    <td className="p-4 px-6 border-r border-border/40 sticky left-0 z-10 bg-card hover:bg-muted/5">
                      <span className="text-xs font-bold">Mode of Payment</span>
                    </td>
                    {comparisonQuotations.map((q) => (
                      <td
                        key={`${q.id}-mode`}
                        className={cn(
                          "p-4 border-r border-border/40 text-xs font-semibold text-foreground",
                          (bestQuotationId === q.id || q.status === "Selected") && "bg-primary/[0.02]",
                        )}
                      >
                        {q.modeOfPayment || q.mode_of_payment || "-"}
                      </td>
                    ))}
                  </tr>

                  {/* Documents & Comments */}
                  <tr className="bg-gradient-to-r from-primary/15 via-primary/5 to-transparent border-y border-primary/20">
                    <td className="p-3.5 px-6 border-r border-border/40 sticky left-0 z-10 bg-card/95 backdrop-blur-md">
                      <div className="flex items-center gap-2 text-primary">
                        <MessageSquare className="size-4" />
                        <span className="text-[11px] font-black uppercase tracking-widest">
                          Attachments & Evaluation
                        </span>
                      </div>
                    </td>
                    {comparisonQuotations.map((q) => (
                      <td key={`cat-c-${q.id}`} className={cn("p-3.5 border-r border-border/40", (bestQuotationId === q.id || q.status === "Selected") && "bg-primary/[0.04]")}></td>
                    ))}
                  </tr>

                  <tr className="hover:bg-muted/5">
                    <td className="p-4 px-6 border-r border-border/40 sticky left-0 z-10 bg-card hover:bg-muted/5">
                      <span className="text-xs font-bold">Supporting Docs</span>
                    </td>
                    {comparisonQuotations.map((q) => (
                      <td
                        key={`${q.id}-docs`}
                        className={cn(
                          "p-4 border-r border-border/40 space-y-1.5",
                          (bestQuotationId === q.id || q.status === "Selected") && "bg-primary/[0.02]",
                        )}
                      >
                        {q.documents && q.documents.length > 0 ? (
                          q.documents.map((d: any, dIdx: number) => (
                            <a
                              key={`${q.id}-doc-${dIdx}`}
                              href={d.file_url}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-1.5 text-[10px] text-primary font-black uppercase tracking-tighter hover:underline"
                            >
                              <Download className="size-3" /> PDF
                            </a>
                          ))
                        ) : (
                          <span className="text-muted-foreground text-[10px] italic">No Attachments</span>
                        )}
                      </td>
                    ))}
                  </tr>

                  <tr className="hover:bg-muted/5">
                    <td className="p-4 px-6 border-r border-border/40 sticky left-0 z-10 bg-card hover:bg-muted/5">
                      <span className="text-xs font-bold">Supplier Comments</span>
                    </td>
                    {comparisonQuotations.map((q) => (
                      <td
                        key={`${q.id}-comm`}
                        className={cn(
                          "p-4 border-r border-border/40 text-[10px] text-muted-foreground leading-relaxed italic line-clamp-3",
                          (bestQuotationId === q.id || q.status === "Selected") && "bg-primary/[0.02]",
                        )}
                      >
                        {q.remarks || "No evaluation notes recorded"}
                      </td>
                    ))}
                  </tr>

                  {/* Grand Total */}
                  <tr className="bg-primary text-white border-t-2 border-primary">
                    <td className="p-6 px-6 border-r border-white/20 sticky left-0 z-10 bg-primary shadow-2xl">
                      <div className="flex items-center gap-3">
                        <Wallet className="size-5" />
                        <span className="text-sm font-black uppercase tracking-[0.2em]">Net Quotation Total</span>
                      </div>
                    </td>
                    {comparisonQuotations.map((q) => {
                      const total = calculateTotal(q);
                      const isSelected = q.status === "Selected";
                      return (
                        <td
                          key={`${q.id}-total`}
                          className={cn(
                            "p-6 border-r border-white/20 font-black text-2xl tabular-nums tracking-tighter transition-all",
                            (isSelected || bestQuotationId === q.id) && "bg-primary-hover brightness-110",
                          )}
                        >
                          {formatMoney(total)}
                        </td>
                      );
                    })}
                  </tr>

                  {/* Authorize Decision Actions */}
                  <tr className="bg-card">
                    <td className="p-6 px-6 border-r border-border/40 sticky left-0 z-10 bg-card">
                      <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Authorize Decision</span>
                    </td>
                    {comparisonQuotations.map((q) => {
                      const isSelected = q.status === "Selected";
                      const isRejected = q.status === "Rejected";
                      return (
                        <td
                          key={`${q.id}-actions`}
                          className={cn(
                            "p-6 border-r border-border/40",
                            (bestQuotationId === q.id || isSelected) && "bg-primary/[0.02]",
                          )}
                        >
                          {isSelected ? (
                            <div className="bg-success/10 border border-success/30 rounded-2xl p-4 text-center">
                              <span className="flex items-center justify-center gap-2 text-[10px] font-black uppercase text-success tracking-widest">
                                <CheckCircle2 className="size-4" /> Selected
                              </span>
                            </div>
                          ) : isRejected ? (
                            <div className="space-y-3">
                              <div className="bg-destructive/10 border border-destructive/30 rounded-2xl p-4 text-center">
                                <span className="flex items-center justify-center gap-2 text-[10px] font-black uppercase text-destructive tracking-widest">
                                  <XCircle className="size-4" /> Rejected
                                </span>
                              </div>
                              {!selectionFinalized && (
                                <Button
                                  variant="ghost"
                                  className="w-full text-primary hover:bg-primary-soft/30 font-black uppercase tracking-widest text-[9px] rounded-xl"
                                  onClick={() => handleOpenModal(q.id, q.supplierId || q.supplier_id, "SELECT")}
                                >
                                  Re-evaluate Selection
                                </Button>
                              )}
                            </div>
                          ) : (
                            <div className="space-y-3">
                              <Button
                                className="w-full h-12 rounded-2xl bg-primary hover:bg-primary/90 text-white font-black uppercase tracking-widest text-[10px] shadow-glow border-none"
                                onClick={() => handleOpenModal(q.id, q.supplierId || q.supplier_id, "SELECT")}
                                disabled={submitting}
                              >
                                <CheckCircle className="size-4 mr-2" /> Select Vendor
                              </Button>
                              <Button
                                variant="ghost"
                                className="w-full h-10 rounded-2xl text-destructive hover:bg-destructive/10 font-black uppercase tracking-widest text-[10px]"
                                onClick={() => handleOpenModal(q.id, q.supplierId || q.supplier_id, "REJECT")}
                                disabled={submitting}
                              >
                                <XCircle className="size-4 mr-2" /> Reject Quote
                              </Button>
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {quotations.some((q) => q.status === "Selected") && (
            <div className="flex justify-end pt-4">
              <Button
                size="lg"
                className="h-14 rounded-2xl shadow-glow bg-success hover:bg-success/90 text-white font-black uppercase tracking-[0.1em] px-10"
                onClick={() => navigate({ to: "/procurement/purchase-orders" })}
              >
                Proceed to PO Queue <ArrowRight className="ml-3 size-5" />
              </Button>
            </div>
          )}
        </div>
      )}

      <Dialog open={isModalOpen} onOpenChange={(open) => !submitting && setIsModalOpen(open)}>
        <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] max-w-xl overflow-hidden rounded-2xl border-border/60 p-0 shadow-2xl">
          <DialogHeader className="border-b border-border/60 bg-muted/20 px-6 py-5 pr-12 text-left">
            <div className="flex items-center gap-3">
              <div className={cn(
                "grid size-10 shrink-0 place-items-center rounded-xl",
                modalMode === "SELECT" ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive",
              )}>
                {modalMode === "SELECT" ? <FileCheck2 className="size-5" /> : <XCircle className="size-5" />}
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-lg font-bold">
                  {modalMode === "SELECT" ? "Select Supplier & Generate PO" : "Reject Quotation"}
                </DialogTitle>
                <DialogDescription className="mt-1 text-xs leading-5">
                  {modalMode === "SELECT"
                    ? "Confirm the winning supplier and record the evaluation before generating the PO proposal."
                    : "Provide a reason for rejecting this quotation."}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={handleAction} className="flex min-h-0 flex-col">
            <div className="max-h-[60vh] space-y-5 overflow-y-auto px-6 py-5">
              {(() => {
                const quotation = quotations.find((entry) => entry.id === targetQuotationId);
                if (!quotation) return null;
                const quotationReference = `QTN-${String(
                  quotations.findIndex((entry) => entry.id === targetQuotationId) + 1,
                ).padStart(4, "0")}`;
                return (
                  <div className="grid gap-3 rounded-xl border border-border/60 bg-muted/20 p-4 sm:grid-cols-2">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Selected supplier</p>
                      <p className="mt-1 truncate text-sm font-semibold">
                        {quotation.supplierInfo?.supplierName || quotation.supplierName || "Supplier"}
                        {quotation.supplierInfo?.supplierCode && (
                          <span className="ml-2 text-[10px] font-mono text-muted-foreground">({quotation.supplierInfo.supplierCode})</span>
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Quotation</p>
                      <p className="mt-1 font-mono text-sm font-semibold">
                        {quotation.quotationNumber || quotationReference}
                      </p>
                    </div>
                  </div>
                );
              })()}

              <div className="space-y-2">
                <Label htmlFor="selection-reason" className="text-xs font-semibold">
                  {modalMode === "SELECT" ? "Selection reason" : "Rejection reason"}
                  <span className="ml-1 text-destructive">*</span>
                </Label>
                {modalMode === "SELECT" ? (
                  <Select value={reason} onValueChange={(value) => setReason(value)}>
                    <SelectTrigger
                      id="selection-reason"
                      className="h-11 rounded-xl bg-background text-sm"
                    >
                      <span className="truncate">{reason || "Choose a selection reason"}</span>
                    </SelectTrigger>
                    <SelectContent className="z-[60] max-h-80 rounded-xl">
                      {selectionReasons.map((selectionReason) => (
                        <SelectItem
                          key={selectionReason.value}
                          value={selectionReason.value}
                          textValue={selectionReason.value}
                          className="whitespace-nowrap py-2 text-xs"
                        >
                          <span className="font-medium">{selectionReason.value}</span>
                          <span className="text-muted-foreground"> - {selectionReason.detail}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Select value={reason} onValueChange={(value) => setReason(value)}>
                    <SelectTrigger
                      id="selection-reason"
                      className="h-11 rounded-xl bg-background text-sm"
                    >
                      <span className="truncate">{reason || "Choose a rejection reason"}</span>
                    </SelectTrigger>
                    <SelectContent className="z-[60] max-h-80 rounded-xl">
                      {rejectionReasons.map((rejectionReason) => (
                        <SelectItem key={rejectionReason} value={rejectionReason}>
                          {rejectionReason}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {modalMode === "SELECT" && selectedReasonDetail && (
                  <p className="text-[11px] text-muted-foreground">{selectedReasonDetail}</p>
                )}
              </div>

              {modalMode === "SELECT" && reason === OTHER_SELECTION_REASON && (
                <div className="space-y-2">
                  <Label htmlFor="evaluation-comments" className="text-xs font-semibold">
                    Procurement evaluation comments <span className="text-destructive">*</span>
                  </Label>
                  <Textarea
                    id="evaluation-comments"
                    placeholder="Explain why this supplier was selected..."
                    className="min-h-28 resize-y rounded-xl text-sm"
                    value={procurementComments}
                    onChange={(e) => setProcurementComments(e.target.value)}
                    required
                  />
                  <p className="text-[11px] text-muted-foreground">This justification will be included in the finance approval record.</p>
                </div>
              )}

              {modalMode === "REJECT" && reason === OTHER_SELECTION_REASON && (
                <div className="space-y-2">
                  <Label htmlFor="rejection-justification" className="text-xs font-semibold">
                    Rejection justification <span className="text-destructive">*</span>
                  </Label>
                  <Textarea
                    id="rejection-justification"
                    placeholder="Explain why this quotation was rejected..."
                    className="min-h-24 resize-y rounded-xl text-sm"
                    value={rejectionJustification}
                    onChange={(e) => setRejectionJustification(e.target.value)}
                    required
                  />
                </div>
              )}
            </div>

            <DialogFooter className="border-t border-border/60 bg-muted/10 px-6 py-4 sm:justify-end">
              <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)} className="rounded-xl" disabled={submitting}>Cancel</Button>
              <Button
                type="submit"
                className={cn(
                  "min-w-44 rounded-xl font-bold shadow-glow",
                  modalMode === "REJECT" && "bg-destructive text-destructive-foreground hover:bg-destructive/90",
                )}
                disabled={submitting}
              >
                {submitting ? <><Loader2 className="mr-2 size-4 animate-spin" /> Processing...</> : modalMode === "SELECT" ? <><FileCheck2 className="mr-2 size-4" /> Generate PO Proposal</> : "Confirm Rejection"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Supplier Quotation Final Review Inspection Dialog */}
      <Dialog open={Boolean(inspectQuotation)} onOpenChange={(open) => !open && setInspectQuotation(null)}>
        <DialogContent className="max-w-2xl gap-0 overflow-hidden rounded-2xl border-none p-0 shadow-2xl [&>button]:right-4 [&>button]:top-4 [&>button]:text-white/75 [&>button]:hover:text-white">
          {inspectQuotation && (() => {
            const baseTotal = (inspectQuotation.lines || []).reduce(
              (sum: number, l: any) =>
                sum + parseFloat(l.quantity || 1) * parseFloat(l.unitPrice || l.unit_price || 0),
              0,
            );
            const disc = parseFloat(inspectQuotation.discount || 0);
            const netTaxable = Math.max(0, baseTotal - disc);
            const taxRate = parseFloat(inspectQuotation.tax || 0);
            const taxAmount = netTaxable * (taxRate / 100);
            const freight = parseFloat(inspectQuotation.freightCharges || inspectQuotation.freight_charges || 0);
            const other = parseFloat(inspectQuotation.additional_charges || inspectQuotation.additionalCharges || 0);
            const grandTotal = parseFloat(inspectQuotation.totalAmount || inspectQuotation.total_amount || 0) || (netTaxable + taxAmount + freight + other);
            const quotedItemsCount = (inspectQuotation.lines || []).filter((l: any) => parseFloat(l.unitPrice || l.unit_price || 0) > 0).length;

            return (
              <>
                <div className="bg-blue-600 px-6 py-4 text-white">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2.5 text-xl font-semibold tracking-tight">
                      <span className="grid size-8 place-items-center rounded-lg bg-white/15">
                        <ShieldCheck className="size-5" />
                      </span>
                      Quotation Final Review
                    </DialogTitle>
                    <DialogDescription className="mt-0.5 text-sm font-normal text-white/85">
                      RFQ: <span className="font-mono font-bold">{rfq?.rfqNumber || rfq?.rfq_number || "RFQ"}</span> | Supplier: <span className="font-bold">{inspectQuotation.supplierInfo?.supplierName || inspectQuotation.supplierName || "Supplier Partner"}</span>
                    </DialogDescription>
                  </DialogHeader>
                </div>

                <div className="space-y-4 p-5 max-h-[70vh] overflow-y-auto">
                  {/* Taxable-Value Breakdown */}
                  <div className="rounded-xl border border-border/70 bg-muted/10 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Taxable-Value Breakdown
                      </h4>
                      <span className="text-[10px] font-bold text-success uppercase">Backend Calculation Synced</span>
                    </div>
                    <div className="space-y-2.5 text-sm">
                      <div className="grid grid-cols-[1fr_auto] items-center gap-6">
                        <span className="text-muted-foreground font-medium">Subtotal (Gross Items)</span>
                        <span className="font-semibold tabular-nums">{formatMoney(baseTotal)}</span>
                      </div>
                      <div className="grid grid-cols-[1fr_auto] items-center gap-6">
                        <span className="text-muted-foreground font-medium">Discount ({inspectQuotation.discount || 0}%)</span>
                        <span className="font-semibold text-success tabular-nums">− {formatMoney(disc)}</span>
                      </div>
                      <div className="grid grid-cols-[1fr_auto] items-center gap-6 border-t border-border/60 pt-2">
                        <span className="font-semibold text-foreground">Net Taxable Amount</span>
                        <span className="font-semibold tabular-nums">{formatMoney(netTaxable)}</span>
                      </div>
                      <div className="grid grid-cols-[1fr_auto] items-center gap-6">
                        <span className="text-muted-foreground font-medium">GST / Tax ({taxRate}%)</span>
                        <span className="font-semibold tabular-nums">{formatMoney(taxAmount)}</span>
                      </div>
                      <div className="grid grid-cols-[1fr_auto] items-center gap-6">
                        <div>
                          <span className="text-muted-foreground font-medium block">Freight Charges</span>
                          <span className="text-[10px] text-muted-foreground italic">(*Non-taxable / exclusive of item GST)</span>
                        </div>
                        <span className="font-semibold tabular-nums">{formatMoney(freight)}</span>
                      </div>
                      {other > 0 && (
                        <div className="grid grid-cols-[1fr_auto] items-center gap-6">
                          <span className="text-muted-foreground font-medium">Additional Charges</span>
                          <span className="font-semibold tabular-nums">{formatMoney(other)}</span>
                        </div>
                      )}
                      <div className="mt-3 grid grid-cols-[1fr_auto] items-center gap-6 border-t border-border pt-3">
                        <span className="text-sm font-semibold uppercase tracking-wide">Final Grand Total</span>
                        <span className="text-xl font-bold tracking-tight text-primary tabular-nums">
                          {formatMoney(grandTotal)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Logistics & Commercials Grid */}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-border/70 bg-background p-3">
                      <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Delivery Duration
                      </Label>
                      <p className="mt-1 text-sm font-semibold">{inspectQuotation.deliveryTime || inspectQuotation.delivery_time || "Not Specified"}</p>
                    </div>
                    <div className="rounded-xl border border-border/70 bg-background p-3">
                      <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Expected Delivery Date
                      </Label>
                      <p className="mt-1 text-sm font-semibold tabular-nums">
                        {inspectQuotation.expectedDeliveryDate || inspectQuotation.expected_delivery_date || "Not Specified"}
                      </p>
                    </div>
                    <div className="rounded-xl border border-border/70 bg-background p-3">
                      <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Payment Terms & Mode
                      </Label>
                      <p className="mt-1 text-sm font-semibold">
                        {inspectQuotation.paymentTerms || inspectQuotation.payment_terms || "Net 30"} ({inspectQuotation.modeOfPayment || inspectQuotation.mode_of_payment || "Bank Transfer"})
                      </p>
                    </div>
                    <div className="rounded-xl border border-border/70 bg-background p-3">
                      <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Items Quoted
                      </Label>
                      <p className="mt-1 text-sm font-semibold">
                        {quotedItemsCount} of {(inspectQuotation.lines || []).length} Items Quoted
                      </p>
                    </div>
                  </div>

                  {/* Remarks */}
                  {inspectQuotation.remarks && (
                    <div className="space-y-1.5">
                      <Label className="text-[10px] uppercase font-black text-muted-foreground">
                        Special Remarks / Commercial Conditions
                      </Label>
                      <div className="rounded-xl border border-border/40 bg-muted/30 p-2.5 text-xs italic leading-snug text-muted-foreground">
                        {inspectQuotation.remarks}
                      </div>
                    </div>
                  )}
                </div>

                <DialogFooter className="border-t border-border/70 bg-muted/10 p-4">
                  <Button
                    onClick={() => setInspectQuotation(null)}
                    className="h-11 rounded-xl bg-blue-600 px-8 text-xs font-semibold uppercase text-white shadow-glow hover:bg-blue-700 w-full"
                  >
                    Close Review
                  </Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

