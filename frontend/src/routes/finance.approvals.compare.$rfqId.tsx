import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  Loader2,
  Table as TableIcon,
  Eye,
  CheckCircle,
  X,
  XCircle,
  ShieldCheck,
  CreditCard,
  TrendingDown,
  Clock,
  Wallet,
  Truck,
  AlertCircle,
  Trophy,
} from "lucide-react";
import { AppShell, StatusBadge } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { requireRole } from "@/lib/auth-utils";

export const Route = createFileRoute("/finance/approvals/compare/$rfqId")({
  beforeLoad: () => {
    requireRole("FINANCE");
  },
  component: FinanceComparison,
});

function FinanceComparison() {
  const navigate = useNavigate();
  const { rfqId } = Route.useParams();
  const [approvals, setApprovals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Rejection Modal state
  const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);
  const [targetPoId, setTargetPoId] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");

  const fetchData = async () => {
    try {
      setLoading(true);
      const allApprovals = await api.getFinanceApprovals();
      const rfqApprovals = allApprovals.filter((po: any) => po.rfqId === rfqId);
      setApprovals(rfqApprovals);
    } catch (error) {
      console.error("Failed to fetch approvals:", error);
      toast.error("Failed to load comparison data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [rfqId]);

  const handleApprove = async (poId: string) => {
    try {
      setSubmitting(true);
      await api.approvePurchaseOrder(poId);
      toast.success("Purchase order approved successfully!");
      navigate({ to: "/finance/approvals" });
    } catch (error: any) {
      toast.error("Approval failed: " + error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenRejectModal = (poId: string) => {
    setTargetPoId(poId);
    setIsRejectModalOpen(true);
  };

  const handleConfirmReject = async () => {
    if (!rejectionReason) {
      toast.error("Please provide a reason for rejection");
      return;
    }
    try {
      setSubmitting(true);
      await api.rejectPurchaseOrder(targetPoId, rejectionReason);
      toast.success("Purchase order rejected");
      setIsRejectModalOpen(false);
      setRejectionReason("");
      fetchData();
    } catch (error: any) {
      toast.error("Rejection failed: " + error.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Group items for comparison
  const uniqueItemCodes = Array.from(
    new Set(
      approvals.flatMap((po) => po.items?.map((l: any) => l.materialCode || l.item_code) || []),
    ),
  ).filter(Boolean);

  const bestProposalId = approvals.length > 0
    ? approvals.reduce((prev, curr) =>
        (parseFloat(curr.totalAmount) < parseFloat(prev.totalAmount) ? curr : prev), approvals[0]
      )?.id
    : null;

  return (
    <AppShell
      title="Finance Comparison Matrix"
      subtitle={`Comparing PO proposals for RFQ: ${approvals[0]?.rfqNumber || rfqId}`}
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
      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : approvals.length === 0 ? (
        <Card className="flex h-64 flex-col items-center justify-center p-6 text-center border-dashed border-border/50 bg-muted/20">
          <ShieldCheck className="size-12 text-muted-foreground/30 mb-4" />
          <h3 className="text-lg font-semibold text-muted-foreground">No proposals found</h3>
          <p className="text-sm text-muted-foreground/70">
            There are no pending proposals for this RFQ.
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
                    Quotation Comparison Matrix
                  </h2>
                  <p className="text-sm text-muted-foreground font-medium">
                    Side-by-side analysis of supplier proposals for procurement authorization
                  </p>
                </div>
              </div>
              <div className="hidden sm:flex items-center gap-2 px-4 py-2 bg-success/10 rounded-xl border border-success/20">
                <Trophy className="size-4 text-success" />
                <span className="text-[10px] font-black uppercase text-success tracking-wider">
                  Best Value Highlighted
                </span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[800px]">
                <thead>
                  <tr>
                    <th className="p-6 bg-muted/20 w-[240px] border-r border-border/40 sticky left-0 z-10 backdrop-blur-md">
                      <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">
                        Parameter Details
                      </span>
                    </th>
                    {approvals.map((po) => (
                      <th
                        key={po.id}
                        className={cn(
                          "p-6 min-w-[280px] border-r border-border/40 relative group",
                          bestProposalId === po.id && "bg-primary/[0.02]",
                        )}
                      >
                        {bestProposalId === po.id && (
                          <div className="absolute top-0 left-0 right-0 h-1 bg-primary" />
                        )}
                        <div className="flex flex-col gap-3">
                          <div className="flex items-center justify-between">
                            <StatusBadge status={po.status} />
                            {bestProposalId === po.id && (
                              <span className="flex items-center gap-1 text-[9px] font-black text-primary uppercase bg-primary-soft/20 px-2 py-0.5 rounded-md">
                                <Trophy className="size-3" /> Recommended
                              </span>
                            )}
                          </div>
                          <div>
                            <h3 className="font-black text-base text-foreground leading-none">
                              {po.supplierName}
                            </h3>
                            <p className="text-[10px] font-mono text-muted-foreground mt-1 uppercase tracking-widest font-bold">
                              {po.poNumber}
                            </p>
                          </div>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {/* Category Header: Materials */}
                  <tr className="bg-muted/30">
                    <td className="p-3 px-6 border-r border-border/40 sticky left-0 z-10 bg-muted/30 backdrop-blur-md">
                      <div className="flex items-center gap-2 text-primary">
                        <Package className="size-3.5" />
                        <span className="text-[10px] font-black uppercase tracking-widest">
                          Material Rates & Quantities
                        </span>
                      </div>
                    </td>
                    {approvals.map((po) => (
                      <td
                        key={`cat-m-${po.id}`}
                        className={cn(
                          "p-3 border-r border-border/40",
                          bestProposalId === po.id && "bg-primary/[0.02]",
                        )}
                      ></td>
                    ))}
                  </tr>

                  {uniqueItemCodes.map((code) => (
                    <tr key={code} className="hover:bg-muted/5 transition-colors group">
                      <td className="p-4 px-6 border-r border-border/40 sticky left-0 z-10 bg-card group-hover:bg-muted/5 transition-colors">
                        <div className="space-y-1">
                          <p className="text-xs font-bold text-foreground">
                            {approvals.flatMap(p => p.items).find(i => i.materialCode === code || i.item_code === code)?.materialName || "Unknown Material"}
                          </p>
                          <code className="text-[9px] text-primary font-black bg-primary-soft/30 px-1.5 py-0.5 rounded uppercase">
                            {code}
                          </code>
                        </div>
                      </td>
                      {approvals.map((po) => {
                        const item = po.items?.find(
                          (i: any) => i.materialCode === code || i.item_code === code,
                        );
                        return (
                          <td
                            key={`${po.id}-${code}`}
                            className={cn(
                              "p-4 border-r border-border/40",
                              bestProposalId === po.id && "bg-primary/[0.02]",
                            )}
                          >
                            {item ? (
                              <div className="flex flex-col gap-1.5">
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] text-muted-foreground font-black uppercase">Rate</span>
                                  <span className="text-sm font-black text-foreground tabular-nums">
                                    ₹{parseFloat(item.unitPrice).toLocaleString()}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] text-muted-foreground font-black uppercase">Qty</span>
                                  <span className="text-xs font-bold text-muted-foreground">
                                    {Math.floor(item.quantity)} Units
                                  </span>
                                </div>
                              </div>
                            ) : (
                              <div className="h-full flex items-center justify-center text-muted-foreground text-[10px] italic">
                                Not Quoted
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}

                  {/* Category Header: Financials */}
                  <tr className="bg-muted/30">
                    <td className="p-3 px-6 border-r border-border/40 sticky left-0 z-10 bg-muted/30 backdrop-blur-md">
                      <div className="flex items-center gap-2 text-primary">
                        <Wallet className="size-3.5" />
                        <span className="text-[10px] font-black uppercase tracking-widest">
                          Financial Adjustments
                        </span>
                      </div>
                    </td>
                    {approvals.map((po) => (
                      <td
                        key={`cat-f-${po.id}`}
                        className={cn(
                          "p-3 border-r border-border/40",
                          bestProposalId === po.id && "bg-primary/[0.02]",
                        )}
                      ></td>
                    ))}
                  </tr>

                  <tr className="hover:bg-muted/5">
                    <td className="p-4 px-6 border-r border-border/40 sticky left-0 z-10 bg-card hover:bg-muted/5">
                      <div className="flex items-center gap-2">
                        <TrendingDown className="size-3.5 text-success" />
                        <span className="text-xs font-bold">Total Discount</span>
                      </div>
                    </td>
                    {approvals.map((po) => (
                      <td
                        key={`${po.id}-discount`}
                        className={cn(
                          "p-4 border-r border-border/40 font-black text-sm text-success tabular-nums",
                          bestProposalId === po.id && "bg-primary/[0.02]",
                        )}
                      >
                        - ₹{parseFloat(po.discountAmount || 0).toLocaleString()}
                      </td>
                    ))}
                  </tr>

                  <tr className="hover:bg-muted/5">
                    <td className="p-4 px-6 border-r border-border/40 sticky left-0 z-10 bg-card hover:bg-muted/5">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="size-3.5 text-muted-foreground" />
                        <span className="text-xs font-bold">Tax & Charges (GST)</span>
                      </div>
                    </td>
                    {approvals.map((po) => (
                      <td
                        key={`${po.id}-tax`}
                        className={cn(
                          "p-4 border-r border-border/40 font-bold text-sm tabular-nums",
                          bestProposalId === po.id && "bg-primary/[0.02]",
                        )}
                      >
                        ₹{parseFloat(po.taxAmount || 0).toLocaleString()}
                      </td>
                    ))}
                  </tr>

                  <tr className="hover:bg-muted/5">
                    <td className="p-4 px-6 border-r border-border/40 sticky left-0 z-10 bg-card hover:bg-muted/5">
                      <div className="flex items-center gap-2">
                        <Truck className="size-3.5 text-muted-foreground" />
                        <span className="text-xs font-bold">Freight Charges</span>
                      </div>
                    </td>
                    {approvals.map((po) => (
                      <td
                        key={`${po.id}-freight`}
                        className={cn(
                          "p-4 border-r border-border/40 font-bold text-sm tabular-nums",
                          bestProposalId === po.id && "bg-primary/[0.02]",
                        )}
                      >
                        ₹{parseFloat(po.freightCharges || 0).toLocaleString()}
                      </td>
                    ))}
                  </tr>

                  {/* Category Header: Logistics */}
                  <tr className="bg-muted/30">
                    <td className="p-3 px-6 border-r border-border/40 sticky left-0 z-10 bg-muted/30 backdrop-blur-md">
                      <div className="flex items-center gap-2 text-primary">
                        <Clock className="size-3.5" />
                        <span className="text-[10px] font-black uppercase tracking-widest">
                          Logistics & Timeline
                        </span>
                      </div>
                    </td>
                    {approvals.map((po) => (
                      <td
                        key={`cat-l-${po.id}`}
                        className={cn(
                          "p-3 border-r border-border/40",
                          bestProposalId === po.id && "bg-primary/[0.02]",
                        )}
                      ></td>
                    ))}
                  </tr>

                  <tr className="hover:bg-muted/5">
                    <td className="p-4 px-6 border-r border-border/40 sticky left-0 z-10 bg-card hover:bg-muted/5">
                      <span className="text-xs font-bold">Expected Delivery</span>
                    </td>
                    {approvals.map((po) => (
                      <td
                        key={`${po.id}-del`}
                        className={cn(
                          "p-4 border-r border-border/40 text-xs font-black text-foreground tabular-nums",
                          bestProposalId === po.id && "bg-primary/[0.02]",
                        )}
                      >
                        {po.expectedDeliveryDate || "Not Specified"}
                      </td>
                    ))}
                  </tr>

                  <tr className="hover:bg-muted/5">
                    <td className="p-4 px-6 border-r border-border/40 sticky left-0 z-10 bg-card hover:bg-muted/5">
                      <span className="text-xs font-bold">Payment Terms</span>
                    </td>
                    {approvals.map((po) => (
                      <td
                        key={`${po.id}-pay`}
                        className={cn(
                          "p-4 border-r border-border/40 text-[11px] font-medium leading-relaxed italic text-muted-foreground",
                          bestProposalId === po.id && "bg-primary/[0.02]",
                        )}
                      >
                        {po.paymentTerms || "Standard Terms"}
                      </td>
                    ))}
                  </tr>

                  {/* Category Header: Selection */}
                  <tr className="bg-primary-soft/10">
                    <td className="p-3 px-6 border-r border-border/40 sticky left-0 z-10 bg-primary-soft/10 backdrop-blur-md">
                      <div className="flex items-center gap-2 text-primary">
                        <ShieldCheck className="size-3.5" />
                        <span className="text-[10px] font-black uppercase tracking-widest">
                          Procurement Rationale
                        </span>
                      </div>
                    </td>
                    {approvals.map((po) => (
                      <td
                        key={`cat-s-${po.id}`}
                        className={cn(
                          "p-3 border-r border-border/40",
                          bestProposalId === po.id && "bg-primary/[0.02]",
                        )}
                      ></td>
                    ))}
                  </tr>

                  <tr className="hover:bg-muted/5 bg-primary-soft/5">
                    <td className="p-4 px-6 border-r border-border/40 sticky left-0 z-10 bg-primary-soft/5 hover:bg-muted/5">
                      <span className="text-xs font-black uppercase tracking-wider text-primary">Selection Reason</span>
                    </td>
                    {approvals.map((po) => (
                      <td
                        key={`${po.id}-reason`}
                        className={cn(
                          "p-4 border-r border-border/40 text-xs font-black text-primary tracking-tight",
                          bestProposalId === po.id && "bg-primary/[0.02]",
                        )}
                      >
                        {po.selectionReason || "—"}
                      </td>
                    ))}
                  </tr>

                  {/* Grand Total */}
                  <tr className="bg-primary text-white border-t-2 border-primary">
                    <td className="p-6 px-6 border-r border-white/20 sticky left-0 z-10 bg-primary shadow-2xl">
                      <div className="flex items-center gap-3">
                        <CreditCard className="size-5" />
                        <span className="text-sm font-black uppercase tracking-[0.2em]">Final Quote Total</span>
                      </div>
                    </td>
                    {approvals.map((po) => (
                      <td
                        key={`${po.id}-total`}
                        className={cn(
                          "p-6 border-r border-white/20 font-black text-2xl tabular-nums tracking-tighter",
                          bestProposalId === po.id && "bg-primary-hover",
                        )}
                      >
                        ₹{parseFloat(po.totalAmount).toLocaleString()}
                      </td>
                    ))}
                  </tr>

                  {/* Actions */}
                  <tr className="bg-card">
                    <td className="p-6 px-6 border-r border-border/40 sticky left-0 z-10 bg-card">
                      <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Authorize Decision</span>
                    </td>
                    {approvals.map((po) => (
                      <td
                        key={`${po.id}-actions`}
                        className={cn(
                          "p-6 border-r border-border/40",
                          bestProposalId === po.id && "bg-primary/[0.02]",
                        )}
                      >
                        {po.status === "PENDING_FINANCE" ? (
                          <div className="space-y-3">
                            <Button
                              className="w-full h-12 rounded-2xl bg-success hover:bg-success/90 text-white font-black uppercase tracking-widest text-[10px] shadow-glow border-none"
                              onClick={() => handleApprove(po.id)}
                              disabled={submitting}
                            >
                              <CheckCircle className="size-4 mr-2" /> Approve Proposal
                            </Button>
                            <Button
                              variant="ghost"
                              className="w-full h-10 rounded-2xl text-destructive hover:bg-destructive/10 font-black uppercase tracking-widest text-[10px]"
                              onClick={() => handleOpenRejectModal(po.id)}
                              disabled={submitting}
                            >
                              <XCircle className="size-4 mr-2" /> Reject Quote
                            </Button>
                          </div>
                        ) : (
                          <div className="bg-muted/20 border border-dashed border-border rounded-2xl p-4 text-center">
                            <span className="text-[10px] font-black uppercase text-muted-foreground tracking-widest">
                              Authorized
                            </span>
                          </div>
                        )}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Rejection Modal */}
      {isRejectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <Card className="w-full max-w-md border-border/40 bg-card p-6 shadow-glow relative animate-in zoom-in-95 duration-200">
            <button
              onClick={() => setIsRejectModalOpen(false)}
              className="absolute right-4 top-4 text-muted-foreground hover:text-foreground"
            >
              <X className="size-5" />
            </button>
            <CardHeader className="p-0 mb-4">
              <div className="flex items-center gap-2 text-destructive">
                <XCircle className="size-5" />
                <CardTitle className="text-base font-bold">Reject Proposal</CardTitle>
              </div>
              <CardDescription className="text-xs">
                Provide a reason for rejecting this PO proposal.
              </CardDescription>
            </CardHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Rejection Reason*</Label>
                <Textarea
                  placeholder="Why is this proposal being rejected?"
                  className="min-h-[100px] rounded-xl text-sm"
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setIsRejectModalOpen(false)}
                  className="rounded-xl"
                >
                  Cancel
                </Button>
                <Button
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-xl shadow-glow min-w-[140px] font-bold"
                  onClick={handleConfirmReject}
                  disabled={submitting}
                >
                  {submitting ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
                  Confirm Rejection
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </AppShell>
  );
}
