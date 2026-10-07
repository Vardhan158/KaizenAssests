import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Loader2,
  FileText,
  Building2,
  Warehouse,
  User,
  Calendar,
  CreditCard,
  Info,
  Download,
  MessageSquare,
  History,
  Clock,
} from "lucide-react";
import { AppShell, StatusBadge } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/finance/approvals/$approvalId")({
  component: ApprovalDetail,
});

function ApprovalDetail() {
  const { approvalId } = Route.useParams();
  const navigate = useNavigate();
  const [po, setPo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [isRejecting, setIsRejecting] = useState(false);

  const fetchPo = async () => {
    try {
      setLoading(true);
      const data = await api.getPurchaseOrder(approvalId);
      setPo(data);

    } catch (error) {
      console.error("Failed to fetch PO:", error);
      toast.error("Failed to load purchase order details");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPo();
  }, [approvalId]);

  const handleApprove = async () => {
    try {
      setProcessing(true);
      await api.approvePurchaseOrder(approvalId);
      toast.success("Purchase order approved successfully!");
      navigate({ to: "/finance/approvals" });
    } catch (error: any) {
      toast.error("Approval failed: " + error.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleReject = async () => {
    if (!rejectionReason) {
      toast.error("Please provide a reason for rejection");
      return;
    }
    try {
      setProcessing(true);
      await api.rejectPurchaseOrder(approvalId, rejectionReason);
      toast.success("Purchase order rejected");
      navigate({ to: "/finance/approvals" });
    } catch (error: any) {
      toast.error("Rejection failed: " + error.message);
    } finally {
      setProcessing(false);
      setIsRejecting(false);
    }
  };

  if (loading) {
    return (
      <AppShell title="Loading Proposal..." subtitle="Please wait">
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      </AppShell>
    );
  }

  if (!po) return null;

  const quotation = po.quotation || {};
  const subtotal = Number(po.subtotal ?? quotation.lines?.reduce((sum: number, line: any) => sum + Number(line.quantity || 0) * Number(line.unitPrice || line.unit_price || 0), 0)) || 0;
  const quotationDiscountRate = Number(quotation.discount) || 0;
  const discountAmount = subtotal * quotationDiscountRate / 100;
  const taxableAmount = Math.max(subtotal - discountAmount, 0);
  const taxRate = Number(quotation.tax ?? po.taxPercentage ?? po.tax_percentage) || 0;
  const taxAmount = taxableAmount * taxRate / 100;
  const freightAmount = Number(quotation.freightCharges ?? quotation.freight_charges ?? po.freightCharges) || 0;
  const additionalCharges = Number(quotation.additionalCharges ?? quotation.additional_charges) || 0;
  const grandTotal = Number(quotation.totalAmount ?? quotation.total_amount ?? po.totalAmount) || 0;
  const discountPercentage = quotationDiscountRate || (subtotal > 0 ? (discountAmount / subtotal) * 100 : 0);
  const taxPercentage = taxRate || (taxableAmount > 0 ? (taxAmount / taxableAmount) * 100 : 0);

  return (
    <AppShell
      title={`Review PO Proposal: ${po.poNumber}`}
      subtitle={`Submitted on ${new Date(po.createdAt).toLocaleString()}`}
      actions={
        <Button
          variant="outline"
          className="rounded-xl"
          onClick={() => navigate({ to: "/finance/approvals" })}
        >
          <ArrowLeft className="mr-2 size-4" /> Back to Queue
        </Button>
      }
    >
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column: PO Info & Material Details */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="border-border/40 shadow-soft">
            <CardHeader className="bg-muted/10 border-b border-border/60">
              <div className="flex items-center gap-2">
                <Info className="size-4 text-primary" />
                <CardTitle className="text-sm font-bold uppercase tracking-wider">
                  PO Information
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid gap-6 sm:grid-cols-2">
                <InfoField label="PO Number" value={po.poNumber} mono />
                <InfoField label="PO Date" value={new Date(po.createdAt).toLocaleDateString()} />
                <InfoField label="Supplier" value={po.supplierName} icon={Building2} />
                <InfoField label="Warehouse" value={po.warehouseId} icon={Warehouse} />
                <InfoField label="Procurement Officer" value={po.procurementOfficer} icon={User} />
                <InfoField
                  label="Expected Delivery"
                  value={po.expectedDeliveryDate || "Not Specified"}
                  icon={Calendar}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/40 shadow-soft overflow-hidden">
            <CardHeader className="bg-muted/10 border-b border-border/60">
              <div className="flex items-center gap-2">
                <FileText className="size-4 text-primary" />
                <CardTitle className="text-sm font-bold uppercase tracking-wider">
                  Material Details
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="bg-muted/40 border-b border-border/60 text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                    <th className="p-4">Material</th>
                    <th className="p-4 text-right">Quantity</th>
                    <th className="p-4">UOM</th>
                    <th className="p-4 text-right">Unit Price</th>
                    <th className="p-4 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {po.items?.map((item: any, idx: number) => (
                    <tr key={idx} className="hover:bg-muted/5 transition-colors">
                      <td className="p-4">
                        <p className="font-semibold text-foreground">{item.materialName}</p>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {item.materialCode}
                        </span>
                      </td>
                      <td className="p-4 text-right font-mono font-bold">
                        {Math.floor(item.quantity)}
                      </td>
                      <td className="p-4 font-semibold text-muted-foreground">{item.uom}</td>
                      <td className="p-4 text-right font-mono">
                        ₹ {parseFloat(item.unitPrice).toLocaleString()}
                      </td>
                      <td className="p-4 text-right font-mono font-bold">
                        ₹{" "}
                        {(Math.floor(item.quantity) * parseFloat(item.unitPrice)).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {po.quotation && (
            <Card className="border-border/40 shadow-soft overflow-hidden">
              <CardHeader className="bg-muted/10 border-b border-border/60">
                <div className="flex items-center gap-2">
                  <FileText className="size-4 text-primary" />
                  <CardTitle className="text-sm font-bold uppercase tracking-wider">
                    Supplier Quotation
                  </CardTitle>
                </div>
                <CardDescription className="text-xs">
                  Same supplier quotation selected by Procurement for this finance proposal.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <InfoField label="Quotation ID" value={po.quotation?.id || po.quotationId || po.quotation_id} mono />
                  <InfoField label="Status" value={po.quotation.status || "Submitted"} />
                  <InfoField
                    label="Validity"
                    value={po.quotation.quotationValidity || po.quotation.quotation_validity || "Not specified"}
                  />
                </div>

                <div className="overflow-x-auto rounded-xl border border-border/50">
                  <table className="w-full min-w-[620px] text-left text-xs">
                    <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">Item</th>
                        <th className="px-3 py-2 text-right">Qty</th>
                        <th className="px-3 py-2">UOM</th>
                        <th className="px-3 py-2 text-right">Quoted Rate</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {po.quotation.lines?.map((line: any, idx: number) => (
                        <tr key={line.id || `${line.itemCode || line.item_code}-${idx}`}>
                          <td className="px-3 py-2">
                            <p className="font-semibold text-foreground">
                              {line.materialName || line.material_name || line.itemCode || line.item_code}
                            </p>
                            <span className="font-mono text-[10px] text-muted-foreground">
                              {line.itemCode || line.item_code}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-bold">
                            {Math.floor(Number(line.quantity || 0))}
                          </td>
                          <td className="px-3 py-2 font-semibold text-muted-foreground">
                            {line.uom || "PCS"}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-bold">
                            ₹ {Number(line.unitPrice || line.unit_price || 0).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <InfoField label="Delivery Time" value={po.quotation.deliveryTime || po.quotation.delivery_time || "Not specified"} />
                  <InfoField label="Payment Terms" value={po.quotation.paymentTerms || po.quotation.payment_terms || po.paymentTerms || "Not specified"} />
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="border-border/40 shadow-soft">
            <CardHeader className="bg-muted/10 border-b border-border/60">
              <div className="flex items-center gap-2">
                <MessageSquare className="size-4 text-primary" />
                <CardTitle className="text-sm font-bold uppercase tracking-wider">
                  Supporting Information
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                  Procurement Selection Reason
                </Label>
                <p className="mt-1 text-sm font-medium text-foreground bg-primary-soft/10 p-3 rounded-xl border border-primary/10">
                  {po.selectionReason || "No reason provided"}
                </p>
              </div>
              {po.procurementComments && (
                <div>
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                    Procurement Comments
                  </Label>
                  <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                    {po.procurementComments}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* PO Approval History & Audit Trail */}
          <Card className="border-border/40 shadow-soft overflow-hidden">
            <CardHeader className="bg-muted/10 border-b border-border/60">
              <div className="flex items-center gap-2">
                <History className="size-4 text-primary" />
                <CardTitle className="text-sm font-bold uppercase tracking-wider">
                  PO Approval History &amp; Audit Trail
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-6">
              {!po.history || po.history.length === 0 ? (
                <div className="p-4 rounded-xl bg-muted/20 border border-border/40 text-center text-xs text-muted-foreground italic">
                  No approval history events recorded yet.
                </div>
              ) : (
                <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-border/60">
                  {po.history.map((h: any, idx: number) => {
                    const status = String(h.status || "").toUpperCase();
                    const isApproved = status.includes("APPROV") || status.includes("APPROVED");
                    const isRejected = status.includes("REJECT");

                    return (
                      <div key={h.id || idx} className="relative flex items-start gap-4">
                        <div
                          className={cn(
                            "absolute -left-6 top-1 size-5 rounded-full border-2 bg-background flex items-center justify-center",
                            isApproved
                              ? "border-emerald-600 text-emerald-600"
                              : isRejected
                                ? "border-rose-600 text-rose-600"
                                : "border-amber-500 text-amber-500",
                          )}
                        >
                          {isApproved ? (
                            <CheckCircle2 className="size-3" />
                          ) : isRejected ? (
                            <XCircle className="size-3" />
                          ) : (
                            <Clock className="size-3" />
                          )}
                        </div>

                        <div className="min-w-0 flex-1 bg-muted/20 border border-border/40 rounded-xl p-3.5 space-y-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span
                              className={cn(
                                "text-[10px] font-black uppercase px-2 py-0.5 rounded-md",
                                isApproved
                                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                  : isRejected
                                    ? "bg-rose-50 text-rose-700 border border-rose-200"
                                    : "bg-amber-50 text-amber-700 border border-amber-200",
                              )}
                            >
                              {h.status}
                            </span>
                            <span className="text-[10px] font-mono text-muted-foreground">
                              {h.createdAt || h.created_at
                                ? new Date(h.createdAt || h.created_at).toLocaleString()
                                : "—"}
                            </span>
                          </div>

                          <p className="text-xs font-bold text-foreground">
                            Action by:{" "}
                            <span className="text-primary font-mono">
                              {h.actorName || h.actor_name || "System / Officer"}
                            </span>
                          </p>

                          {h.comments && (
                            <p className="text-xs text-muted-foreground leading-relaxed italic bg-background/60 p-2.5 rounded-lg border border-border/30 mt-1">
                              "{h.comments}"
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Financial Summary & Actions */}
        <div className="space-y-6">
          <Card className="border-border/40 shadow-soft overflow-hidden sticky top-24">
            <CardHeader className="bg-primary text-primary-foreground">
              <div className="flex items-center gap-2">
                <CreditCard className="size-4" />
                <CardTitle className="text-sm font-bold uppercase tracking-wider">
                  Financial Summary
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              <p className="text-xs text-muted-foreground">
                Selected supplier quotation totals
              </p>
              <SummaryRow label="Subtotal" value={po.subtotal} />
              <SummaryRow
                label={`Discount (${discountPercentage.toFixed(2)}%)`}
                value={po.discountAmount}
                isNegative
              />
              <SummaryRow label={`Tax (GST ${taxPercentage.toFixed(2)}%)`} value={po.taxAmount} />
              <SummaryRow label="Freight" value={freightAmount} />
              {additionalCharges > 0 && <SummaryRow label="Additional Charges" value={additionalCharges} />}

              <div className="pt-4 border-t border-border mt-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-foreground uppercase tracking-tight">
                    Grand Total
                  </span>
                  <span className="text-xl font-black text-primary">
                    ₹ {grandTotal.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

              {po.paymentTerms && (
                <div className="mt-4 p-3 rounded-xl bg-muted/30 border border-border/60">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                    Payment Terms
                  </p>
                  <p className="text-sm font-semibold">{po.paymentTerms}</p>
                </div>
              )}

              <div className="space-y-3 pt-6">
                {po.status !== "PENDING_FINANCE" ? (
                  <div className="p-4 rounded-xl bg-muted/30 border border-border/40 text-center space-y-1">
                    <p className="text-sm font-bold text-foreground">Read-Only Mode</p>
                    <p className="text-xs text-muted-foreground">This purchase order is {po.status} and cannot be modified.</p>
                  </div>
                ) : !isRejecting ? (
                  <>
                    <Button
                      className="w-full h-12 rounded-xl bg-success hover:bg-success/90 shadow-glow font-bold"
                      onClick={handleApprove}
                      disabled={processing}
                    >
                      {processing ? (
                        <Loader2 className="size-4 animate-spin mr-2" />
                      ) : (
                        <CheckCircle2 className="size-4 mr-2" />
                      )}
                      Approve PO Proposal
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full h-12 rounded-xl border-destructive/30 text-destructive hover:bg-destructive-soft font-bold"
                      onClick={() => setIsRejecting(true)}
                      disabled={processing}
                    >
                      <XCircle className="size-4 mr-2" />
                      Reject Proposal
                    </Button>
                  </>
                ) : (
                  <div className="space-y-4 animate-in slide-in-from-right-4">
                    <div className="space-y-2">
                      <Label className="text-xs font-bold text-destructive">
                        Rejection Reason*
                      </Label>
                      <Textarea
                        placeholder="Please specify why this PO is being rejected..."
                        className="rounded-xl min-h-[100px] border-destructive/20 focus-visible:ring-destructive/20"
                        value={rejectionReason}
                        onChange={(e) => setRejectionReason(e.target.value)}
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        className="flex-1 rounded-xl text-xs"
                        onClick={() => setIsRejecting(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        className="flex-[2] rounded-xl bg-destructive hover:bg-destructive/90 font-bold text-xs"
                        onClick={handleReject}
                        disabled={processing}
                      >
                        Confirm Rejection
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

function InfoField({ label, value, icon: Icon, mono = false }: any) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold flex items-center gap-1.5">
        {Icon && <Icon className="size-3" />} {label}
      </p>
      <p className={cn("text-sm font-semibold text-foreground", mono && "font-mono")}>
        {value || "—"}
      </p>
    </div>
  );
}

function SummaryRow({ label, value, isNegative = false }: any) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground font-medium">{label}</span>
      <span className={cn("font-mono font-bold", isNegative && "text-destructive")}>
        {isNegative ? "- " : ""}₹ {parseFloat(value || 0).toLocaleString()}
      </span>
    </div>
  );
}

