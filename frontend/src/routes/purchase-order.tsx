import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  Building2,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Download,
  Loader2,
  History,
  XCircle,
  Truck,
  Mail,
  User,
  Warehouse,
  CreditCard,
  Send,
  ClipboardCheck,
  Paperclip,
} from "lucide-react";
import { AppShell, StatusBadge } from "@/components/wms/app-shell";
import { Field, SectionCard } from "@/components/wms/primitives";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { api, BUSINESS_API_URL } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type POSearch = {
  poId?: string;
  code?: string;
  token?: string;
};

export const Route = createFileRoute("/purchase-order")({
  head: () => ({
    meta: [
      { title: "Purchase Order Details · KaizenX" },
      {
        name: "description",
        content: "Comprehensive Purchase Order details and supplier communication.",
      },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): POSearch => {
    return {
      poId: (search.poId as string) || undefined,
      code: (search.code as string) || undefined,
      token: (search.token as string) || undefined,
    };
  },
  component: PurchaseOrder,
});

function PurchaseOrder() {
  const { poId, code, token } = Route.useSearch();
  const [resolvedPoId, setResolvedPoId] = useState<string | undefined>(poId);
  const effectivePoId = poId || resolvedPoId;
  const [poData, setPoData] = useState<any>(null);
  const [damagedGoodsData, setDamagedGoodsData] = useState<any>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [enlargedPhoto, setEnlargedPhoto] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!(poId || code || token));
  const [sending, setSending] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const magicCode = code || token;
    if (magicCode) {
      api
        .magicLogin(magicCode)
        .then((authData) => {
          if (authData?.po_id) {
            setResolvedPoId(authData.po_id);
          }
        })
        .catch((err) => {
          console.error("Magic login failed in PO route:", err);
        });
    }
  }, [code, token]);

  useEffect(() => {
    if (poId) {
      setResolvedPoId(poId);
    }
  }, [poId]);

  const fetchPo = async (targetId?: string) => {
    const idToFetch = targetId || effectivePoId;
    if (!idToFetch) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const data = await api.getPurchaseOrder(idToFetch);
      setPoData(data);
      if (data?.poNumber || idToFetch) {
        try {
          const dmg = await api.getPoDamagedGoods(data?.poNumber || idToFetch);
          setDamagedGoodsData(dmg);
        } catch {
          setDamagedGoodsData(null);
        }
      }
    } catch (err) {
      console.error("Failed to fetch PO details:", err);
      toast.error("Could not load PO details");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (effectivePoId) {
      fetchPo(effectivePoId);
    }
  }, [effectivePoId]);

  const handleSendToSupplier = async () => {
    try {
      setSending(true);
      const result = await api.sendPoToSupplier((effectivePoId || poData?.id) as string);
      toast.success(
        result.message ||
          (result.resent ? "Purchase Order resent successfully." : "Purchase Order sent successfully."),
      );
      fetchPo();
    } catch (e: any) {
      toast.error("Failed to send PO: " + e.message);
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <AppShell title="Loading PO..." subtitle="Please wait">
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      </AppShell>
    );
  }

  if (!poData) {
    return (
      <AppShell title="Not Found" subtitle="PO details not found">
        <div className="flex flex-col items-center justify-center p-12 text-center">
          <AlertTriangle className="size-12 text-destructive mb-4" />
          <p>The requested Purchase Order could not be located.</p>
        </div>
      </AppShell>
    );
  }

  const toNumber = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const selectedQuotation = poData.quotation || null;
  const quotedLines = Array.isArray(selectedQuotation?.lines) ? selectedQuotation.lines : [];
  const quotationSubtotal = quotedLines.reduce((sum: number, line: any) => {
    return sum + toNumber(line.quantity) * toNumber(line.unitPrice);
  }, 0);
  const subtotal = quotationSubtotal || toNumber(poData.subtotal);
  const discountAmount = toNumber(selectedQuotation?.discount ?? poData.discountAmount);
  const freightCharges = toNumber(selectedQuotation?.freightCharges ?? poData.freightCharges);
  const quotationTaxPercentage = toNumber(selectedQuotation?.tax);
  const taxableAmount = subtotal - discountAmount;
  const taxAmount = selectedQuotation
    ? Math.max(taxableAmount, 0) * quotationTaxPercentage / 100
    : toNumber(poData.taxAmount);
  const discountPercentage = subtotal > 0 ? (discountAmount / subtotal) * 100 : 0;
  const taxPercentage = selectedQuotation
    ? quotationTaxPercentage
    : taxableAmount > 0 ? (taxAmount / taxableAmount) * 100 : 0;
  const quotationTotal =
    toNumber(selectedQuotation?.totalAmount) ||
    toNumber(poData.totalAmount) ||
    Math.max(taxableAmount, 0) + taxAmount + freightCharges;
  const itemsQuoted = quotedLines.length || poData.items?.length || 0;
  const expectedDelivery =
    selectedQuotation?.expectedDeliveryDate || poData.expectedDeliveryDate || "Not specified";
  const paymentTerms = selectedQuotation?.paymentTerms || poData.paymentTerms || "Not specified";
  const deliveryTerms = poData.deliveryTerms || selectedQuotation?.deliveryTime || "Not specified";
  const warranty = poData.warranty || selectedQuotation?.warranty || "Not specified";
  const attachments = Array.isArray(poData.attachments) ? poData.attachments : selectedQuotation?.documents || [];
  const lifecycleSteps = [
    "DRAFT",
    "PENDING_FINANCE",
    "APPROVED",
    "SENT",
    "ACKNOWLEDGED",
    "PARTIALLY_RECEIVED",
    "FULLY_RECEIVED",
    "CLOSED",
  ];
  const currentLifecycleIndex = Math.max(0, lifecycleSteps.indexOf(String(poData.status || "").toUpperCase()));
  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 2,
    }).format(value);

  return (
    <AppShell
      title={`Purchase Order: ${poData.poNumber}`}
      subtitle={`${poData.supplierName} · ₹ ${parseFloat(poData.totalAmount).toLocaleString()}`}
      actions={
        <>
          {poData.status === "APPROVED" && (
            <Button
              className="rounded-xl shadow-glow bg-primary hover:bg-primary/90"
              onClick={handleSendToSupplier}
              disabled={sending}
            >
              {sending ? (
                <Loader2 className="size-4 animate-spin mr-2" />
              ) : (
                <Send className="size-4 mr-2" />
              )}
              Send to Supplier
            </Button>
          )}
          {poData.status === "SENT" && (
            <Button
              variant="outline"
              className="rounded-xl border-success/30 text-success bg-success-soft/10"
              onClick={handleSendToSupplier}
              disabled={sending}
            >
              {sending ? (
                <Loader2 className="size-4 animate-spin mr-2" />
              ) : (
                <Send className="size-4 mr-2" />
              )}
              Resend to Supplier
            </Button>
          )}
          <Button
            variant="outline"
            className="rounded-xl"
            disabled={downloading}
            onClick={async () => {
              try {
                setDownloading(true);
                await api.downloadPoPdf(poData.id, poData.poNumber);
                toast.success("Purchase Order PDF generated and downloaded");
              } catch (e: any) {
                toast.error("Failed to generate PDF: " + e.message);
              } finally {
                setDownloading(false);
              }
            }}
          >
            {downloading ? (
              <Loader2 className="size-4 animate-spin mr-2" />
            ) : (
              <Download className="size-4 mr-2" />
            )}
            Download PDF
          </Button>
        </>
      }
    >
      <div className="grid gap-6 xl:grid-cols-3">
        {/* PO Header & Supplier Info */}
        <div className="space-y-6">
          <SectionCard title="PO Information" icon={FileText}>
            <div className="grid gap-3">
              <Field label="PO Number" value={poData.poNumber} mono />
              <Field label="Revision" value={`Version ${poData.revisionNumber || poData.revision_number || 1}`} />
              <Field label="PO Date" value={new Date(poData.createdAt).toLocaleDateString()} />
              <Field label="Status" value={<StatusBadge status={poData.status} />} />
              <Field label="Procurement Officer" value={poData.procurementOfficer} />
              <Field label="Department" value={poData.department || "Procurement"} />
            </div>
          </SectionCard>

          <SectionCard title="PO Lifecycle" icon={ClipboardCheck}>
            <div className="space-y-2">
              {lifecycleSteps.map((step, index) => (
                <div
                  key={step}
                  className={cn(
                    "flex items-center justify-between rounded-xl border px-3 py-2 text-xs font-bold",
                    index <= currentLifecycleIndex
                      ? "border-primary/25 bg-primary-soft/20 text-primary"
                      : "border-border/60 bg-muted/20 text-muted-foreground",
                  )}
                >
                  <span>{step.replace("PENDING_FINANCE", "Pending Approval").replaceAll("_", " ")}</span>
                  {index <= currentLifecycleIndex && <CheckCircle2 className="size-3.5" />}
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Supplier Information" icon={Building2}>
            <div className="grid gap-3">
              <Field label="Supplier Code" value={poData.supplierCode} mono />
              <Field label="Company Name" value={poData.supplierName} />
              <Field label="Contact Person" value={poData.supplierContactPerson} />
              <Field label="Phone" value={poData.supplierPhone} />
              <Field label="Email" value={poData.supplierEmail} />
              <Field label="GSTIN" value={poData.supplierGstin} mono />
              <Field label="Address" value={poData.supplierAddress} />
              <Field label="Billing Address" value={poData.billingAddress || poData.supplierAddress} />
            </div>
          </SectionCard>

          {damagedGoodsData?.has_damaged_goods && (
            <SectionCard
              title="Damaged Goods"
              icon={AlertTriangle}
              className="border-rose-300/80 bg-rose-50/20 dark:bg-rose-950/20"
            >
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rose-200/60 pb-3">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-wider text-rose-600">Traceability Record</span>
                    <h4 className="text-sm font-bold text-foreground">Damaged Goods Reported</h4>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-rose-100 text-rose-800 border border-rose-300">
                    {damagedGoodsData.status || "Damage Reported"}
                  </span>
                </div>

                <div className="grid gap-3 text-xs sm:grid-cols-2">
                  <Field label="PO Number" value={damagedGoodsData.po_number} mono />
                  <Field label="GRN Number" value={damagedGoodsData.grn_number} mono />
                  <Field label="Supplier Name" value={damagedGoodsData.supplier_name} />
                  <Field label="Warehouse Name" value={damagedGoodsData.warehouse_name} />
                  <Field label="Reported Date/Time" value={damagedGoodsData.damage_reported_at} />
                  <Field
                    label="Damaged Materials"
                    value={
                      <span className="font-bold text-rose-600">
                        {damagedGoodsData.damaged_materials_count} damaged materials ({damagedGoodsData.total_damaged_quantity} units)
                      </span>
                    }
                  />
                  <Field
                    label="Supplier Email"
                    value={
                      <span className="font-bold text-emerald-600 flex items-center gap-1">
                        <CheckCircle2 className="size-3.5" /> Sent ({damagedGoodsData.supplier_notification_status})
                      </span>
                    }
                  />
                  <Field
                    label="Procurement Email"
                    value={
                      <span className="font-bold text-emerald-600 flex items-center gap-1">
                        <CheckCircle2 className="size-3.5" /> Sent ({damagedGoodsData.procurement_notification_status})
                      </span>
                    }
                  />
                </div>

                <div className="flex flex-wrap gap-2 pt-3 border-t border-rose-200/60">
                  <Button
                    onClick={() => setShowDetailsModal(true)}
                    className="rounded-xl font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-sm text-xs flex-1"
                  >
                    <FileText className="mr-1.5 size-3.5" /> View Damage Details
                  </Button>
                  <Button
                    onClick={() => setShowHistoryModal(true)}
                    variant="outline"
                    className="rounded-xl font-bold border-rose-300 text-rose-800 hover:bg-rose-50 text-xs flex-1"
                  >
                    <History className="mr-1.5 size-3.5" /> Notification History
                  </Button>
                </div>
              </div>
            </SectionCard>
          )}
        </div>

        {/* Item Details */}
        <div className="xl:col-span-2 space-y-6">
          <SectionCard title="Order Items" icon={Truck}>
            <div className="mt-2 -mx-5 overflow-x-auto px-5">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                    <th className="pb-3">Material</th>
                    <th className="pb-3 text-right">Quantity</th>
                    <th className="pb-3">UoM</th>
                    <th className="pb-3 text-right">Unit Price</th>
                    <th className="pb-3 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40 font-medium">
                  {poData.items?.map((l: any, idx: number) => (
                    <tr key={idx} className="group hover:bg-muted/5 transition-colors">
                      <td className="py-4">
                        <p className="font-bold text-foreground">{l.materialName}</p>
                        <p className="font-mono text-[10px] text-muted-foreground">
                          {l.materialCode}
                        </p>
                      </td>
                      <td className="py-4 text-right tabular-nums">{Math.floor(l.quantity)}</td>
                      <td className="py-4 text-muted-foreground">{l.uom}</td>
                      <td className="py-4 text-right tabular-nums">
                        ₹ {parseFloat(l.unitPrice).toLocaleString()}
                      </td>
                      <td className="py-4 text-right tabular-nums font-bold text-foreground">
                        ₹{" "}
                        {(
                          Math.floor(parseFloat(l.quantity)) * parseFloat(l.unitPrice)
                        ).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="hidden" aria-hidden="true">
              <div className="ml-auto max-w-xs space-y-3">
                <SummaryRow label="Subtotal" value={poData.subtotal} />
                <SummaryRow label="Discount" value={poData.discountAmount} isNegative />
                <SummaryRow label="Tax (GST)" value={poData.taxAmount} />
                <SummaryRow label="Additional Charges" value={poData.additionalCharges} />
                <div className="pt-3 border-t border-primary/20 flex items-center justify-between">
                  <span className="text-sm font-black text-foreground uppercase">Grand Total</span>
                  <span className="text-xl font-black text-primary">
                    ₹ {parseFloat(poData.totalAmount).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard
            title="RFQ Response Summary"
            description="Selected supplier quotation totals and commercial terms"
            icon={CheckCircle2}
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <SummaryMetric label="Items quoted" value={`${itemsQuoted}`} />
              <SummaryMetric label="Subtotal" value={formatCurrency(subtotal)} />
              <SummaryMetric
                label={`Discount (${discountPercentage.toFixed(2)}%)`}
                value={`− ${formatCurrency(discountAmount)}`}
                valueClassName="text-destructive"
              />
              <SummaryMetric
                label={`GST (${taxPercentage.toFixed(2)}%)`}
                value={formatCurrency(taxAmount)}
              />
              <SummaryMetric label="Freight charges" value={formatCurrency(freightCharges)} />
              <SummaryMetric
                label="Quotation total"
                value={formatCurrency(quotationTotal)}
                valueClassName="text-primary"
                emphasis
              />
            </div>
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
              <span>Expected delivery: {expectedDelivery}</span>
              <span>Payment: {paymentTerms}</span>
              <span>Delivery terms: {deliveryTerms}</span>
              <span>Warranty: {warranty}</span>
            </div>
          </SectionCard>

          <div className="grid gap-6 sm:grid-cols-2">
            <SectionCard title="Delivery Details" icon={Warehouse}>
              <div className="grid gap-3">
                <Field label="Delivery Warehouse" value={poData.deliveryWarehouseName} />
                <Field
                  label="Expected Delivery"
                  value={poData.expectedDeliveryDate || "As per schedule"}
                />
                <Field label="Delivery Terms" value={deliveryTerms} />
                <Field label="Delivery Address" value={poData.deliveryAddress} />
              </div>
            </SectionCard>

            <SectionCard title="Selection Summary" icon={CheckCircle2}>
              <div className="grid gap-3">
                <Field label="Selected By" value={poData.selectedBy} />
                <Field label="Selection Reason" value={poData.selectionReason} />
                <Field label="Payment Terms" value={poData.paymentTerms} />
                <Field label="Warranty" value={warranty} />
                <Field label="Notes" value={poData.notes || poData.procurementComments} />
              </div>
            </SectionCard>
          </div>

          <SectionCard title="Attachments" icon={Paperclip}>
          {attachments.length > 0 ? (
              <div className="grid gap-2">
                {attachments.map((attachment: any, index: number) => (
                  <a
                    key={`${attachment.file_url || attachment.fileUrl || index}`}
                    href={attachment.file_url || attachment.fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between rounded-xl border border-border/60 bg-muted/20 px-3 py-2 text-xs font-bold text-primary hover:bg-primary-soft/20"
                  >
                    <span>{attachment.file_name || attachment.fileName || `Attachment ${index + 1}`}</span>
                    <Download className="size-3.5" />
                  </a>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No attachments recorded for this PO.</p>
            )}
          </SectionCard>

          <SectionCard title="Revision History" icon={History}>
            {poData.revisions?.length ? (
              <div className="space-y-3">
                {poData.revisions.map((revision: any, index: number) => (
                  <div key={`${revision.revisionNumber || revision.revision_number}-${revision.changedField || revision.changed_field}-${index}`} className="rounded-xl border border-border/60 bg-muted/20 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-black uppercase text-primary">
                        Version {revision.revisionNumber || revision.revision_number} · {revision.changedField || revision.changed_field}
                      </p>
                      <p className="text-[10px] font-mono text-muted-foreground">
                        {new Date(revision.changedAt || revision.changed_at).toLocaleString()}
                      </p>
                    </div>
                    <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                      <Field label="Old Value" value={revision.oldValue ?? revision.old_value ?? "-"} />
                      <Field label="New Value" value={revision.newValue ?? revision.new_value ?? "-"} />
                      <Field label="Changed By" value={revision.changedBy || revision.changed_by} />
                      <Field label="Reason" value={revision.reason} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No PO revisions recorded.</p>
            )}
          </SectionCard>
        </div>
      </div>

      {poData.status === "REJECTED" && (
        <Card className="mt-6 border-destructive/30 bg-destructive/5 overflow-hidden">
          <CardHeader className="bg-destructive/10 border-b border-destructive/20 py-3">
            <div className="flex items-center gap-2 text-destructive">
              <XCircle className="size-4" />
              <CardTitle className="text-xs font-black uppercase">Rejection Notice</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-6">
            <p className="text-sm font-bold text-destructive italic text-center">
              "{poData.rejectionReason}"
            </p>
            <div className="mt-4 p-3 bg-white/50 rounded-lg border border-destructive/10">
              <p className="text-xs text-destructive font-bold uppercase tracking-tighter">
                Status: Permanent Rejection
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">
                This Purchase Order has been rejected by Finance and is permanently closed. It
                cannot be modified or resubmitted.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {poData.history && poData.history.length > 0 && (
        <div className="mt-6">
          <SectionCard title="Approval Lifecycle" icon={History}>
            <div className="space-y-4">
              {poData.history.map((h: any, idx: number) => (
                <div key={idx} className="flex gap-4 items-start relative pb-4 last:pb-0">
                  {idx < poData.history.length - 1 && (
                    <div className="absolute left-[15px] top-7 bottom-0 w-0.5 bg-border/40" />
                  )}
                  <div
                    className={cn(
                      "grid size-8 shrink-0 place-items-center rounded-full border text-[10px] font-bold",
                      h.status === "APPROVED" || h.status === "Approved"
                        ? "bg-success-soft text-success border-success/30"
                        : h.status === "REJECTED" ||
                            h.status === "Rejected" ||
                            h.status === "FINANCE_REJECTED"
                          ? "bg-danger-soft text-destructive border-destructive/30"
                          : h.status === "SHIPPED" ||
                              h.status === "Shipped" ||
                              h.status === "IN_TRANSIT" ||
                              h.status === "ASN_SUBMITTED"
                            ? "bg-teal-soft text-teal border-teal/30"
                            : "bg-muted text-muted-foreground",
                    )}
                  >
                    {idx + 1}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold">{h.status}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">
                        {new Date(h.created_at).toLocaleString()}
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground font-medium italic">
                      By {h.actor_name}
                    </p>
                    {h.comments && (
                      <p className="mt-1 text-xs text-foreground/70 bg-muted/30 p-2 rounded-lg">
                        {h.comments}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      )}

      {/* 📋 VIEW DAMAGE DETAILS MODAL */}
      {showDetailsModal && damagedGoodsData && (
        <Dialog open={showDetailsModal} onOpenChange={() => setShowDetailsModal(false)}>
          <DialogContent className="sm:max-w-2xl rounded-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold flex items-center gap-2 text-rose-700">
                <AlertTriangle className="size-5 text-rose-600" /> Damaged Goods Report
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Line-level material breakdown and photo proof recorded during receiving inspection.
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-muted/20 border text-xs font-mono">
              <div><b>GRN Number:</b> {damagedGoodsData.grn_number}</div>
              <div><b>PO Number:</b> {damagedGoodsData.po_number}</div>
              <div><b>Supplier:</b> {damagedGoodsData.supplier_name}</div>
              <div><b>Warehouse:</b> {damagedGoodsData.warehouse_name}</div>
              <div className="col-span-2"><b>Reported Date/Time:</b> {damagedGoodsData.damage_reported_at}</div>
            </div>

            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Damaged Materials Breakdown</h4>
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full text-xs text-left">
                  <thead className="bg-muted/60 uppercase font-mono border-b text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2.5">Material Code & Name</th>
                      <th className="px-3 py-2.5 text-right">Damaged Qty</th>
                      <th className="px-3 py-2.5">Damage Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y font-medium">
                    {damagedGoodsData.materials?.map((m: any, idx: number) => (
                      <tr key={idx} className="hover:bg-muted/10">
                        <td className="px-3 py-2.5">
                          <span className="font-bold text-foreground block">{m.material_name}</span>
                          <span className="font-mono text-[10px] text-primary">{m.item_code}</span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-bold text-rose-600 tabular-nums">
                          {m.damaged_quantity} {m.uom}
                        </td>
                        <td className="px-3 py-2.5 text-foreground">{m.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {damagedGoodsData.materials?.some((m: any) => m.photos && m.photos.length > 0) && (
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Attached Damage Evidence Photos</h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {damagedGoodsData.materials.flatMap((m: any) =>
                    (m.photos || []).map((p: any) => {
                      const fullUrl = p.url?.startsWith("http") || p.url?.startsWith("data:")
                        ? p.url
                        : `${BUSINESS_API_URL}${p.url?.startsWith("/") ? "" : "/"}${p.url}`;
                      return (
                        <div
                          key={p.id}
                          className="group relative rounded-xl overflow-hidden border bg-black/5 cursor-pointer shadow-xs hover:border-rose-400 hover:shadow-md transition-all"
                          onClick={() => setEnlargedPhoto(fullUrl)}
                        >
                          <img
                            src={fullUrl}
                            alt={p.file_name}
                            className="h-28 w-full object-cover group-hover:scale-105 transition-transform"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement;
                              target.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 24 24' fill='none' stroke='%23e11d48' stroke-width='2'%3E%3Crect width='18' height='18' x='3' y='3' rx='2' ry='2'/%3E%3Ccircle cx='9' cy='9' r='2'/%3E%3Cpath d='m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21'/%3E%3C/svg%3E";
                            }}
                          />
                          <div className="absolute bottom-0 inset-x-0 bg-black/70 text-white text-[10px] px-2 py-1 truncate font-mono">
                            {m.item_code}: {p.file_name}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            <div className="flex justify-end pt-3 border-t">
              <Button variant="outline" className="rounded-xl text-xs font-bold" onClick={() => setShowDetailsModal(false)}>
                Close
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* 📜 NOTIFICATION HISTORY MODAL */}
      {showHistoryModal && damagedGoodsData && (
        <Dialog open={showHistoryModal} onOpenChange={() => setShowHistoryModal(false)}>
          <DialogContent className="sm:max-w-md rounded-2xl p-6 space-y-4">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold flex items-center gap-2 text-rose-700">
                <History className="size-5 text-rose-600" /> Notification Delivery History
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Dispatched damage report notifications for PO {damagedGoodsData.po_number}.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              {damagedGoodsData.notification_history?.map((h: any, idx: number) => (
                <div key={idx} className="p-3 rounded-xl border bg-muted/20 flex items-center justify-between text-xs font-mono">
                  <div>
                    <span className="font-bold text-foreground block">{h.recipient_type} Notification</span>
                    <span className="text-[10px] text-muted-foreground">{h.recipient}</span>
                  </div>
                  <div className="text-right">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 block mb-1">
                      {h.status}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{h.sent_at}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end pt-3 border-t">
              <Button variant="outline" className="rounded-xl text-xs font-bold" onClick={() => setShowHistoryModal(false)}>
                Close
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* 🖼️ PHOTO LIGHTBOX MODAL */}
      {enlargedPhoto && (
        <Dialog open={!!enlargedPhoto} onOpenChange={() => setEnlargedPhoto(null)}>
          <DialogContent className="sm:max-w-lg rounded-2xl p-4 space-y-3">
            <img src={enlargedPhoto} alt="Damage Evidence Photo" className="w-full rounded-xl object-contain max-h-[70vh]" />
            <Button variant="outline" className="w-full rounded-xl text-xs font-bold" onClick={() => setEnlargedPhoto(null)}>
              Close Image
            </Button>
          </DialogContent>
        </Dialog>
      )}
    </AppShell>
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

function SummaryMetric({ label, value, valueClassName, emphasis = false }: any) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border/60 bg-muted/20 p-4",
        emphasis && "border-primary/30 bg-primary-soft/15",
      )}
    >
      <p className={cn("text-xs font-medium text-muted-foreground", emphasis && "font-bold text-primary")}>
        {label}
      </p>
      <p className={cn("mt-1 text-lg font-bold", valueClassName)}>{value}</p>
    </div>
  );
}
