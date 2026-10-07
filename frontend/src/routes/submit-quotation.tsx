import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  FileText,
  Calendar,
  Building,
  Package,
  CheckCircle,
  AlertTriangle,
  Loader2,
  Truck,
  ShieldCheck,
  FileCheck,
  Percent,
  Upload,
  Lock,
  ArrowLeft,
  X,
  Eye,
  ArrowRight,
  Clock,
} from "lucide-react";
import { AppShell } from "@/components/wms/app-shell";
import { SectionCard } from "@/components/wms/primitives";
import { Button } from "@/components/ui/button";
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
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { getUserInfo, storeAuthSession, requireRole } from "@/lib/auth-utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/submit-quotation")({
  beforeLoad: () => {},
  component: SubmitQuotation,
});

const getItemKey = (item: any, idx: number) =>
  item.variantCode ||
  item.variant_code ||
  item.materialVariantId ||
  item.material_variant_id ||
  item.materialCode ||
  item.material_code ||
  String(idx);

function SubmitQuotation() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as any;
  const rfqId = search.rfqId || "";
  const token = search.token || search.q || search.t || "";

  const [loading, setLoading] = useState(true);
  const [tokenExpired, setTokenExpired] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [rfq, setRfq] = useState<any | null>(null);
  const [existingQuote, setExistingQuote] = useState<any | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [showItemDetailsModal, setShowItemDetailsModal] = useState(false);
  const [showFinalConfirmModal, setShowFinalConfirmModal] = useState(false);
  const [supplierName, setSupplierName] = useState("");

  // Supplier user state
  const [supplierId, setSupplierId] = useState("");
  const [username, setUsername] = useState("");

  // Bid form state
  const [itemsData, setItemsData] = useState<
    Record<string, { unitPrice: string; availableQty: string }>
  >({});
  const [metaData, setMetaData] = useState({
    discount: "0",
    tax: "18",
    freightCharges: "0",
    deliveryTime: "",
    expectedDeliveryDate: "",
    paymentTerms: "Net 30",
    modeOfPayment: "Bank Transfer",
    remarks: "",
  });

  // Document Upload state
  const [uploadedDocs, setUploadedDocs] = useState<
    Array<{ document_type: string; file_name: string; file_url: string }>
  >([]);

  useEffect(() => {
    const initializePortal = async () => {
      let userInfo = getUserInfo();
      let effectiveRfqId = rfqId;

      // If a magic token/short code is provided in the URL, verify and auto-authenticate with 24h expiration check
      if (token) {
        try {
          const authData = await api.magicLogin(token);
          userInfo = authData;
          if (!effectiveRfqId && authData?.rfq_id) {
            effectiveRfqId = authData.rfq_id;
          }
          toast.success("Quotation access link verified!");
        } catch (tokenErr: any) {
          console.error("Magic token error:", tokenErr);
          const raw = tokenErr?.message || tokenErr?.detail || "";
          const isExp = raw.toLowerCase().includes("expired") || tokenErr?.status === 410;
          setTokenExpired(true);
          setTokenError(
            isExp
              ? "This quotation invitation link has expired after 24 hours. For security, please contact procurement for a new access link."
              : (raw || "Invalid quotation access link.")
          );
          setLoading(false);
          return;
        }
      }

      if (!userInfo) {
        userInfo = {
          token: "mock-jwt-supplier-token",
          username: "supplier_partner",
          roles: ["SUPPLIER"],
          supplierId: "sup-00001",
        };
        try {
          storeAuthSession(userInfo, true);
        } catch {}
      }

      setSupplierId(userInfo.supplierId || "sup-00001");
      setUsername(userInfo.username || "supplier_partner");
      setSupplierName(userInfo.username || "Supplier Partner");

      if (!effectiveRfqId) {
        setLoading(false);
        return;
      }

      try {
        const sid = userInfo.supplierId || "";
        const [rfqData, quotesList] = await Promise.all([
          api.getRfq(effectiveRfqId),
          api.getQuotations(effectiveRfqId, sid),
        ]);

        setRfq(rfqData);

        // Check if there is an existing quotation (Draft or Submitted)
        const existing = quotesList.find((q: any) => q.rfqId === rfqId && q.supplierId === sid);
        if (existing) {
          setExistingQuote(existing);
          const normalizedStatus = String(existing.status || "").toUpperCase();
          setIsLocked(normalizedStatus === "SUBMITTED" || normalizedStatus === "SELECTED");
          if (normalizedStatus === "REJECTED") {
            const rejectionLines = String(existing.remarks || "")
              .split("\n")
              .filter((line: string) => line.startsWith("Rejected by "));
            const rejectionNote = rejectionLines[rejectionLines.length - 1];
            setRejectionReason(rejectionNote || "The procurement team rejected this quotation.");
          } else {
            setRejectionReason("");
          }
          const mappedItems: any = {};
          rfqData.items?.forEach((rfqItem: any, idx: number) => {
            const key = getItemKey(rfqItem, idx);
            const matchingLine =
              existing.lines?.find((line: any) => {
                const lineCode =
                  line.itemCode || line.item_code || line.variantCode || line.variant_code;
                const rfqVariantCode = rfqItem.variantCode || rfqItem.variant_code;
                const rfqMatCode = rfqItem.materialCode || rfqItem.material_code;
                const rfqVarId = rfqItem.materialVariantId || rfqItem.material_variant_id;
                const lineVarId = line.materialVariantId || line.material_variant_id;

                if (rfqVarId && lineVarId && rfqVarId === lineVarId) return true;
                if (rfqVariantCode && lineCode === rfqVariantCode) return true;
                if (lineCode === rfqMatCode) return true;
                return false;
              }) || existing.lines?.[idx];

            if (matchingLine) {
              const price = parseFloat(matchingLine.unitPrice || matchingLine.unit_price || "0");
              const qty = parseFloat(matchingLine.quantity || "0");
              mappedItems[key] = {
                unitPrice: price > 0 ? String(Math.floor(price)) : "",
                availableQty: String(Math.floor(qty || rfqItem.quantity)),
              };
            } else {
              mappedItems[key] = {
                unitPrice: "",
                availableQty: String(Math.floor(rfqItem.quantity)),
              };
            }
          });
          setItemsData(mappedItems);

          // Map the stored INR discount back to a percentage for the workspace.
          const existingSubtotal = (existing.lines || []).reduce((total: number, line: any) => {
            const quantity = Number(line.quantity || 0);
            const unitPrice = Number(line.unitPrice || line.unit_price || 0);
            return total + quantity * unitPrice;
          }, 0);
          const existingDiscount = Number(existing.discount || 0);

          // Map meta data
          setMetaData({
            discount:
              existingSubtotal > 0
                ? String(Number(((existingDiscount / existingSubtotal) * 100).toFixed(2)))
                : "0",
            tax: String(Math.floor(parseFloat(existing.tax || "0"))),
            freightCharges: String(
              Math.floor(parseFloat(existing.freightCharges || existing.freight_charges || "0")),
            ),
            deliveryTime: existing.deliveryTime || existing.delivery_time || "",
            expectedDeliveryDate:
              existing.expectedDeliveryDate || existing.expected_delivery_date || "",
            paymentTerms: existing.paymentTerms || existing.payment_terms || "Net 30",
            modeOfPayment: existing.modeOfPayment || existing.mode_of_payment || "Bank Transfer",
            remarks: existing.remarks || "",
          });

          // Map documents
          setUploadedDocs(existing.documents || []);
        } else {
          // Initialize empty
          const initialItems: any = {};
          rfqData.items?.forEach((item: any, idx: number) => {
            const key = getItemKey(item, idx);
            initialItems[key] = {
              unitPrice: "",
              availableQty: String(Math.floor(item.quantity)),
            };
          });
          setItemsData(initialItems);
        }
      } catch (error: any) {
        toast.error("Failed to load workspace: " + error.message);
      } finally {
        setLoading(false);
      }
    };

    void initializePortal();
  }, [rfqId, token]);

  const handleItemChange = (key: string, field: "unitPrice" | "availableQty", value: string) => {
    if (isLocked) return;

    let finalValue = value;

    // Enforce that Quoted Quantity (availableQty) does not exceed Requested Qty
    if (field === "availableQty" && rfq) {
      const item = rfq.items?.find((it: any, idx: number) => getItemKey(it, idx) === key);
      if (item) {
        const requestedQty = Math.floor(item.quantity);
        const enteredQty = parseInt(value, 10);

        // If the user tries to enter a value greater than requested, cap it at requested
        if (!isNaN(enteredQty) && enteredQty > requestedQty) {
          finalValue = String(requestedQty);
        }
      }
    }

    setItemsData((prev) => ({
      ...prev,
      [key]: {
        unitPrice: prev[key]?.unitPrice ?? "",
        availableQty: prev[key]?.availableQty ?? "",
        [field]: finalValue,
      },
    }));
  };

  const handleMetaChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (isLocked) return;
    const { name, value } = e.target;

    setMetaData((prev) => {
      const newState = { ...prev, [name]: value };

      // Auto-select Expected Delivery Date based on Delivery Time (days)
      if (name === "deliveryTime") {
        const daysMatch = value.match(/\d+/);
        if (daysMatch) {
          const days = parseInt(daysMatch[0], 10);
          if (!isNaN(days)) {
            const date = new Date();
            date.setDate(date.getDate() + days);
            newState.expectedDeliveryDate = date.toISOString().split("T")[0] || "";
          }
        }
      }

      return newState;
    });
  };

  // Real-time document upload to backend
  const handleFileUpload = async (documentType: string, e: React.ChangeEvent<HTMLInputElement>) => {
    if (isLocked) return;
    const file = e.target.files?.[0];
    if (!file) return;

    const toastId = toast.loading(`Uploading ${file.name} to server...`);
    try {
      const response = await api.uploadQuotationDocument(file);

      setUploadedDocs((prev) => [
        ...prev.filter((d) => d.document_type !== documentType),
        {
          document_type: documentType,
          file_name: response.file_name,
          file_url: response.file_url,
        },
      ]);
      toast.success(`${file.name} uploaded successfully!`, { id: toastId });
    } catch (error: any) {
      toast.error(`Upload failed: ${error.message}`, { id: toastId });
      console.error("Quotation file upload error:", error);
    }
  };

  // Auto-save logic
  useEffect(() => {
    if (!rfq || !supplierId || isLocked || loading || submitting) return;

    // Don't auto-save if form is empty/initial
    if (Object.keys(itemsData).length === 0) return;

    const timer = setTimeout(() => {
      autoSaveDraft();
    }, 2000); // 2 second debounce

    return () => clearTimeout(timer);
  }, [itemsData, metaData, uploadedDocs]);

  const autoSaveDraft = async () => {
    try {
      const payload = {
        rfq_id: rfq.id,
        supplier_id: supplierId,
        status: "DRAFT",
        lines: rfq.items.map((item: any, idx: number) => {
          const key = getItemKey(item, idx);
          return {
            material_id: item.materialId || item.material_id || null,
            material_variant_id: item.materialVariantId || item.material_variant_id || null,
            item_code:
              item.variantCode || item.variant_code || item.materialCode || item.material_code,
            variant_code: item.variantCode || item.variant_code || null,
            quantity: parseFloat(itemsData[key]?.availableQty || "0") || item.quantity,
            unit_price: parseFloat(itemsData[key]?.unitPrice || "0") || 0,
          };
        }),
        discount: parseFloat(metaData.discount) || 0,
        tax: parseFloat(metaData.tax) || 0,
        freight_charges: parseFloat(metaData.freightCharges) || 0,
        delivery_time: metaData.deliveryTime,
        expected_delivery_date: metaData.expectedDeliveryDate || null,
        payment_terms: metaData.paymentTerms,
        mode_of_payment: metaData.modeOfPayment,
        remarks: metaData.remarks,
        documents: uploadedDocs,
      };

      if (existingQuote) {
        const updated = await api.updateQuotation(existingQuote.id, payload);
        setExistingQuote(updated);
      } else {
        const result = await api.submitQuotation(payload);
        setExistingQuote(result);
      }
    } catch (error) {
      console.debug("Draft auto-save skipped:", error);
    }
  };

  const handleSave = async (status: "SUBMITTED") => {
    if (!rfq || isLocked) return;
    const activeSupplierId = supplierId || "sup-00001";

    // Validation for submission
    const lineCodes = Object.keys(itemsData);
    if (
      lineCodes.some(
        (code) => !itemsData[code].unitPrice || parseFloat(itemsData[code].unitPrice) <= 0,
      )
    ) {
      toast.error("Please enter a valid unit price for all items before submitting");
      setShowSummaryModal(false);
      return;
    }
    const gstRate = parseFloat(metaData.tax) || 0;
    if (gstRate < 0 || gstRate > 100) {
      toast.error("GST percentage must be between 0 and 100");
      return;
    }
    for (let idx = 0; idx < rfq.items.length; idx++) {
      const item = rfq.items[idx];
      const key = getItemKey(item, idx);
      const quoted = parseFloat(itemsData[key]?.availableQty || "0") || 0;
      const requested = Math.floor(item.quantity);
      if (quoted < requested) {
        toast.error(
          `Quoted quantity for ${item.materialName || item.material_name} cannot be less than the requested quantity (${requested})`,
        );
        setShowSummaryModal(false);
        return;
      }
    }

    setSubmitting(true);
    try {
      const payload = {
        rfq_id: rfq.id,
        supplier_id: activeSupplierId,
        status: status,
        lines: rfq.items.map((item: any, idx: number) => {
          const key = getItemKey(item, idx);
          return {
            material_id: item.materialId || item.material_id || null,
            material_variant_id: item.materialVariantId || item.material_variant_id || null,
            item_code:
              item.variantCode || item.variant_code || item.materialCode || item.material_code,
            variant_code: item.variantCode || item.variant_code || null,
            quantity: parseFloat(itemsData[key]?.availableQty || "0") || item.quantity,
            unit_price: parseFloat(itemsData[key]?.unitPrice || "0") || 0,
          };
        }),
        discount: parseFloat(metaData.discount) || 0,
        tax: parseFloat(metaData.tax) || 0,
        freight_charges: parseFloat(metaData.freightCharges) || 0,
        additional_charges: parseFloat((metaData as any).otherCharges || "0") || 0,
        delivery_time: metaData.deliveryTime,
        expected_delivery_date: metaData.expectedDeliveryDate || null,
        payment_terms: metaData.paymentTerms,
        mode_of_payment: metaData.modeOfPayment,
        warranty: (metaData as any).warranty || "12 Months Warranty",
        remarks: metaData.remarks,
        documents: uploadedDocs,
      };

      if (existingQuote) {
        await api.updateQuotation(existingQuote.id, payload);
      } else {
        await api.submitQuotation(payload);
      }

      toast.success("Quotation submitted and locked!");
      setIsLocked(true);
      setShowSummaryModal(false);
      navigate({ to: "/supplier-dashboard" });
    } catch (error: any) {
      toast.error("Operation failed: " + error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const calculateSubtotal = () =>
    (rfq?.items || []).reduce((total: number, item: any, idx: number) => {
      const key = getItemKey(item, idx);
      const itemData = itemsData[key] || {};
      return total + (Number(itemData.availableQty) || 0) * (Number(itemData.unitPrice) || 0);
    }, 0);

  const calculateDiscountAmount = () => {
    const percentage = Math.min(Math.max(Number(metaData.discount) || 0, 0), 100);
    return calculateSubtotal() * (percentage / 100);
  };

  const quotationSummary = (() => {
    const subtotal = calculateSubtotal();
    const discountPercentage = Math.min(Math.max(Number(metaData.discount) || 0, 0), 100);
    const discount = calculateDiscountAmount();
    const taxRate = Number(metaData.tax) || 0;
    const freight = Number(metaData.freightCharges) || 0;
    const otherCharges = Number((metaData as any).otherCharges) || 0;
    const taxableAmount = Math.max(0, subtotal - discount);
    const taxAmount = taxableAmount * (taxRate / 100);

    return {
      quotedItems: (rfq?.items || []).filter(
        (item: any, idx: number) => Number(itemsData[getItemKey(item, idx)]?.unitPrice) > 0,
      ).length,
      subtotal,
      discountPercentage,
      discount,
      taxRate,
      taxAmount,
      freight,
      otherCharges,
      total: subtotal - discount + taxAmount + freight + otherCharges,
    };
  })();

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 2,
    }).format(value);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center gap-3">
        <Loader2 className="size-8 animate-spin text-primary" />
        <span className="text-sm text-muted-foreground">Loading bidding portal...</span>
      </div>
    );
  }

  if (tokenExpired) {
    return (
      <AppShell title="Quotation Workspace" subtitle="Access Link Expired">
        <div className="mx-auto mt-12 max-w-lg rounded-2xl border border-destructive/20 bg-card p-8 text-center shadow-soft">
          <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-destructive/10 text-destructive">
            <Clock className="size-7" />
          </div>
          <h2 className="text-xl font-bold text-foreground">Quotation Link Expired</h2>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
            {tokenError || "This quotation invitation link was valid for 24 hours and has now expired."}
          </p>
          <div className="mt-4 rounded-xl border border-border bg-muted/40 p-4 text-xs text-muted-foreground text-left">
            <p className="font-semibold text-foreground mb-1">Why did this happen?</p>
            For commercial confidentiality and security, quotation access links expire automatically after 24 hours. Please contact the procurement team to request a fresh quotation invitation link.
          </div>
          <div className="mt-6 flex justify-center gap-3">
            <Button onClick={() => navigate({ to: "/login" })}>Go to Login</Button>
          </div>
        </div>
      </AppShell>
    );
  }

  if (!rfqId || !rfq) {
    return (
      <AppShell title="Quotation Workspace" subtitle="Submit bids for pending requests">
        <div className="mx-auto max-w-md rounded-2xl border border-destructive/20 bg-destructive-soft/10 p-6 text-center shadow-soft">
          <AlertTriangle className="mx-auto size-10 text-destructive" />
          <h2 className="mt-4 text-lg font-bold">Invalid RFQ Reference</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            No valid RFQ identifier was found in your request link. Please check the URL sent in
            your email invitation.
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="RFQ Response Workspace"
      subtitle={`RFQ Number: ${rfq.rfqNumber || rfq.rfq_number}`}
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate({ to: "/supplier-dashboard" })}
          className="rounded-xl"
        >
          <ArrowLeft className="mr-2 size-4" /> Back to Dashboard
        </Button>
      }
    >
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Lock Banner */}
        {isLocked && (
          <div className="flex items-center gap-3 rounded-2xl border border-success/35 bg-success-soft/10 p-4 text-sm text-success font-bold">
            <Lock className="size-5" />
            This quotation has been officially submitted and is locked from further modifications.
          </div>
        )}

        {/* Rejection Banner */}
        {rejectionReason && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            <p className="font-bold flex items-center gap-2">
              <AlertTriangle className="size-4" /> Previous Submission Rejected
            </p>
            <p className="text-xs text-muted-foreground mt-1">{rejectionReason}</p>
          </div>
        )}

        {/* RFQ Details Summary (Read-Only) */}
        <SectionCard
          title="RFQ Information (Read-Only)"
          description="Reference details for this request"
          icon={FileText}
        >
          <div className="grid gap-6 sm:grid-cols-3 lg:grid-cols-5">
            <div>
              <Label className="text-muted-foreground text-xs uppercase tracking-wider block">
                RFQ Number
              </Label>
              <span className="font-bold text-sm block mt-1">{rfq.rfqNumber || rfq.rfq_number}</span>
            </div>
            <div>
              <Label className="text-muted-foreground text-xs uppercase tracking-wider block">
                Request Date
              </Label>
              <span className="font-bold text-sm block mt-1">{rfq.rfqDate || rfq.rfq_date || "—"}</span>
            </div>
            <div>
              <Label className="text-muted-foreground text-xs uppercase tracking-wider block">
                Required Delivery Date
              </Label>
              <span className="font-bold text-sm block mt-1">
                {rfq.requiredDeliveryDate || rfq.required_delivery_date || "—"}
              </span>
            </div>
            <div>
              <Label className="text-muted-foreground text-xs uppercase tracking-wider block">
                Warehouse Location
              </Label>
              <span className="font-bold text-sm block mt-1">{rfq.warehouse}</span>
            </div>
            <div>
              <Label className="text-muted-foreground text-xs uppercase tracking-wider block">
                Procurement Officer
              </Label>
              <span className="font-bold text-sm block mt-1 uppercase tracking-wider text-primary">
                {rfq.procurementOfficer || rfq.procurement_officer}
              </span>
            </div>
          </div>
          {rfq.remarks && (
            <div className="mt-4 pt-4 border-t border-border/50">
              <Label className="text-muted-foreground text-xs uppercase tracking-wider">
                Remarks / Instructions
              </Label>
              <p className="text-xs text-foreground/80 mt-1.5 leading-relaxed bg-muted/20 p-3 rounded-lg border border-border/40">
                {rfq.remarks}
              </p>
            </div>
          )}
        </SectionCard>

        {/* Required Materials Bidding Form */}
        <SectionCard
          title="Material Response"
          description="Enter pricing and available quantity for each material requirement"
          icon={Package}
        >
          <div className="space-y-6">
            {rfq.items?.map((item: any, idx: number) => {
              const itemKey = getItemKey(item, idx);
              return (
                <div key={itemKey} className="rounded-2xl border border-border/80 bg-muted/10 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h4 className="text-base font-semibold tracking-tight text-foreground">
                        {item.materialName || item.material_name}
                      </h4>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-md border border-primary/20 bg-primary-soft/15 px-2 py-1 text-[10px] font-medium text-muted-foreground">
                          Material{" "}
                          <strong className="ml-1 font-mono text-primary">
                            {item.materialCode || item.material_code}
                          </strong>
                        </span>
                        {(item.variantCode || item.variant_code) && (
                          <span className="rounded-md border border-teal-500/20 bg-teal-soft/15 px-2 py-1 text-[10px] font-medium text-muted-foreground">
                            Variant{" "}
                            <strong className="ml-1 font-mono text-teal-600">
                              {item.variantCode || item.variant_code}
                            </strong>
                          </span>
                        )}
                        {item.category && (
                          <span className="rounded-md border border-border/70 bg-background px-2 py-1 text-[10px] font-medium text-muted-foreground">
                            Category <strong className="ml-1 text-foreground">{item.category}</strong>
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="rounded-full bg-primary-soft/20 px-2.5 py-0.5 text-xs font-bold text-primary">
                      Requested: {Math.floor(item.quantity)} {item.uom}
                    </span>
                  </div>

                  <div className="mt-5 grid gap-4 sm:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Unit Price (INR)*</Label>
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        placeholder="0"
                        className="rounded-xl h-10 font-mono"
                        disabled={isLocked}
                        value={itemsData[itemKey]?.unitPrice || ""}
                        onChange={(e) => handleItemChange(itemKey, "unitPrice", e.target.value)}
                        required
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">Requested Qty</Label>
                      <Input
                        type="number"
                        min="0"
                        className="rounded-xl h-10 font-mono bg-muted/50"
                        disabled
                        value={Math.floor(item.quantity)}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">Quoted Quantity*</Label>
                      <Input
                        type="number"
                        min="0"
                        max={Math.floor(item.quantity)}
                        step="1"
                        placeholder="Enter quantity"
                        className="rounded-xl h-10 font-mono"
                        disabled={isLocked}
                        value={itemsData[itemKey]?.availableQty || ""}
                        onChange={(e) =>
                          handleItemChange(itemKey, "availableQty", e.target.value)
                        }
                        required
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>

        {/* Commercial & Logistical Details */}
        <SectionCard
          title="Logistics & Commercials"
          description="Bidding parameters, terms, and conditions"
          icon={Truck}
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Discount (%)</Label>
              <div className="relative">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  name="discount"
                  step="1"
                  className="rounded-xl h-10 font-mono"
                  disabled={isLocked}
                  value={metaData.discount}
                  onChange={handleMetaChange}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Tax (GST %)</Label>
              <div className="relative">
                <Percent className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  type="number"
                  min="0"
                  name="tax"
                  step="1"
                  className="pl-9 rounded-xl h-10 font-mono"
                  disabled={isLocked}
                  value={metaData.tax}
                  onChange={handleMetaChange}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Freight Charges (INR)</Label>
              <div className="relative">
                <Input
                  type="number"
                  min="0"
                  name="freightCharges"
                  step="1"
                  className="rounded-xl h-10 font-mono"
                  disabled={isLocked}
                  value={metaData.freightCharges}
                  onChange={handleMetaChange}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Delivery Time (e.g. 7 days)</Label>
              <Input
                name="deliveryTime"
                placeholder="e.g. 7 days"
                className="rounded-xl h-10"
                disabled={isLocked}
                value={metaData.deliveryTime}
                onChange={handleMetaChange}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Expected Delivery Date</Label>
              <Input
                type="date"
                min={new Date().toISOString().split("T")[0]}
                name="expectedDeliveryDate"
                className="rounded-xl h-10 font-mono"
                disabled={isLocked}
                value={metaData.expectedDeliveryDate}
                onChange={handleMetaChange}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Payment Terms</Label>
              <Select
                disabled={isLocked}
                value={metaData.paymentTerms}
                onValueChange={(val) => setMetaData((prev) => ({ ...prev, paymentTerms: val }))}
              >
                <SelectTrigger className="rounded-xl h-10">
                  <SelectValue placeholder="Select payment terms" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Net 30">Net 30</SelectItem>
                  <SelectItem value="Net 60">Net 60</SelectItem>
                  <SelectItem value="Immediate">Immediate</SelectItem>
                  <SelectItem value="COD">Cash on Delivery (COD)</SelectItem>
                  <SelectItem value="Advance">Advance Payment</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Mode of Payment</Label>
              <Select
                disabled={isLocked}
                value={metaData.modeOfPayment}
                onValueChange={(val) => setMetaData((prev) => ({ ...prev, modeOfPayment: val }))}
              >
                <SelectTrigger className="rounded-xl h-10">
                  <SelectValue placeholder="Select mode of payment" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
                  <SelectItem value="Wire Transfer">Wire Transfer</SelectItem>
                  <SelectItem value="Letter of Credit">Letter of Credit (LC)</SelectItem>
                  <SelectItem value="Cheque">Cheque</SelectItem>
                  <SelectItem value="UPI / Net Banking">UPI / Net Banking</SelectItem>
                  <SelectItem value="Cash">Cash</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="mt-4 space-y-1.5">
            <Label className="text-xs">Remarks / Terms Details</Label>
            <Textarea
              name="remarks"
              placeholder="Enter details on commercial conditions or exclusions..."
              className="min-h-[80px] rounded-xl"
              disabled={isLocked}
              value={metaData.remarks}
              onChange={handleMetaChange}
            />
          </div>
        </SectionCard>

        {/* Document Uploads section */}
        <SectionCard
          title="Quotation Supporting Documents"
          description="Upload PDF or compliance certification"
          icon={Upload}
        >
          <div className="grid gap-4 sm:grid-cols-1">
            {(() => {
              const docType = { label: "Upload Document", key: "QUOTATION_DOC" };
              const uploaded = uploadedDocs.find((d) => d.document_type === docType.key);
              return (
                <div className="flex flex-col gap-2 rounded-2xl border border-border p-4 bg-muted/5">
                  <span className="text-xs font-bold">{docType.label}</span>
                  {uploaded ? (
                    <div className="flex items-center justify-between gap-2 rounded-xl border border-success/35 bg-success-soft/35 px-3 py-2 text-xs text-foreground">
                      <div className="flex items-center gap-2">
                        <FileCheck className="size-4 text-success" />
                        <span className="truncate max-w-[300px] font-mono">
                          {uploaded.file_name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase text-success">Uploaded</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 rounded-full hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => setUploadedDocs([])}
                          disabled={isLocked}
                        >
                          <X className="size-3" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="relative">
                      <input
                        type="file"
                        id={`file-${docType.key}`}
                        className="hidden"
                        disabled={isLocked}
                        accept=".pdf,.jpg,.jpeg"
                        onChange={(e) => handleFileUpload(docType.key, e)}
                      />
                      <Label
                        htmlFor={`file-${docType.key}`}
                        className={cn(
                          "flex items-center justify-center gap-2 rounded-xl border border-dashed border-border/80 hover:border-primary/80 py-6 text-sm font-medium cursor-pointer transition-colors",
                          isLocked && "opacity-50 cursor-not-allowed hover:border-border/80",
                        )}
                      >
                        <Upload className="size-5 text-muted-foreground" />
                        <span>Click to browse or drag and drop your quotation file</span>
                        <span className="text-xs text-muted-foreground font-normal">
                          (PDF, JPG, PNG up to 10MB)
                        </span>
                      </Label>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </SectionCard>

        {/* Quotation summary follows the supporting documents */}
        <SectionCard
          title="Quotation Summary"
          description="Review the values entered above before submitting"
          icon={FileCheck}
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-xl border border-border/60 bg-muted/10 p-3">
              <p className="text-xs text-muted-foreground">Subtotal</p>
              <p className="mt-1 font-bold tabular-nums">{formatCurrency(quotationSummary.subtotal)}</p>
            </div>
            <div className="rounded-xl border border-border/60 bg-muted/10 p-3">
              <p className="text-xs text-muted-foreground">Discount ({quotationSummary.discountPercentage}%)</p>
              <p className="mt-1 font-bold tabular-nums">− {formatCurrency(quotationSummary.discount)}</p>
            </div>
            <div className="rounded-xl border border-border/60 bg-muted/10 p-3">
              <p className="text-xs text-muted-foreground">GST / Tax ({quotationSummary.taxRate}%)</p>
              <p className="mt-1 font-bold tabular-nums">{formatCurrency(quotationSummary.taxAmount)}</p>
            </div>
            <div className="rounded-xl border border-border/60 bg-muted/10 p-3">
              <p className="text-xs text-muted-foreground">Freight & other charges</p>
              <p className="mt-1 font-bold tabular-nums">
                {formatCurrency(quotationSummary.freight + quotationSummary.otherCharges)}
              </p>
            </div>
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 sm:col-span-2 lg:col-span-2">
              <p className="text-xs font-semibold text-primary">Grand Total</p>
              <p className="mt-1 text-lg font-extrabold tabular-nums text-primary">
                {formatCurrency(quotationSummary.total)}
              </p>
            </div>
          </div>
        </SectionCard>

        {/* Action Panel */}
        {!isLocked && (
          <div className="flex items-center justify-between rounded-2xl border border-border/60 bg-card/60 p-6 shadow-soft">
            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
              <ShieldCheck className="size-4 text-success" /> Click Submit to finalize and lock this
              bid proposal.
            </div>
            <div className="flex items-center gap-3">
              <Button
                size="lg"
                className="rounded-xl h-12 text-xs bg-success text-success-foreground hover:bg-success/90 shadow-glow"
                disabled={submitting}
                onClick={() => setShowSummaryModal(true)}
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" /> Processing...
                  </>
                ) : (
                  <>
                    <FileCheck className="mr-2 size-4" /> Submit Quotation
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Quotation Summary Modal */}
        <Dialog open={showSummaryModal} onOpenChange={setShowSummaryModal}>
          <DialogContent className="max-w-2xl gap-0 overflow-hidden rounded-2xl border-none p-0 shadow-2xl [&>button]:right-4 [&>button]:top-4 [&>button]:text-white/75 [&>button]:hover:text-white">
            <div className="bg-blue-600 px-6 py-4 text-white">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2.5 text-xl font-semibold tracking-tight">
                  <span className="grid size-8 place-items-center rounded-lg bg-white/15">
                    <ShieldCheck className="size-5" />
                  </span>
                  Quotation Final Review
                </DialogTitle>
                <DialogDescription className="mt-0.5 max-w-xl text-sm font-normal leading-snug text-white/85">
                  RFQ: <span className="font-mono font-bold">{rfq.rfqNumber || rfq.rfq_number}</span> | Supplier: <span className="font-bold">{supplierName || "Supplier Partner"}</span>
                </DialogDescription>
              </DialogHeader>
            </div>

            <div className="space-y-4 p-5 max-h-[70vh] overflow-y-auto">
              {/* Financial Breakdown with Taxable Values */}
              <div className="rounded-xl border border-border/70 bg-muted/10 p-4">
                <div className="space-y-2.5">
                  <div className="grid grid-cols-[1fr_auto] items-center gap-6 text-sm">
                    <span className="font-medium text-muted-foreground">Subtotal (Gross Items)</span>
                    <span className="text-right font-semibold tabular-nums">{formatCurrency(quotationSummary.subtotal)}</span>
                  </div>
                  <div className="grid grid-cols-[1fr_auto] items-center gap-6 text-sm">
                    <span className="text-muted-foreground font-medium">
                      Discount ({quotationSummary.discountPercentage}%)
                    </span>
                    <span className="text-right font-semibold text-success tabular-nums">
                      − {formatCurrency(quotationSummary.discount)}
                    </span>
                  </div>
                  <div className="grid grid-cols-[1fr_auto] items-center gap-6 text-sm border-t border-border/60 pt-2">
                    <span className="font-semibold text-foreground">Net Taxable Amount</span>
                    <span className="text-right font-semibold tabular-nums">{formatCurrency(Math.max(0, quotationSummary.subtotal - quotationSummary.discount))}</span>
                  </div>
                  <div className="grid grid-cols-[1fr_auto] items-center gap-6 text-sm">
                    <span className="text-muted-foreground font-medium">
                      GST / Tax ({quotationSummary.taxRate}%)
                    </span>
                    <span className="text-right font-semibold tabular-nums">{formatCurrency(quotationSummary.taxAmount)}</span>
                  </div>
                  <div className="grid grid-cols-[1fr_auto] items-center gap-6 text-sm">
                    <div>
                      <span className="text-muted-foreground font-medium block">Freight Charges</span>
                      <span className="text-[10px] text-muted-foreground italic">(*Non-taxable / exclusive of item GST)</span>
                    </div>
                    <span className="text-right font-semibold tabular-nums">{formatCurrency(quotationSummary.freight)}</span>
                  </div>
                  {quotationSummary.otherCharges > 0 && (
                    <div className="grid grid-cols-[1fr_auto] items-center gap-6 text-sm">
                      <span className="text-muted-foreground font-medium">Additional Charges</span>
                      <span className="text-right font-semibold tabular-nums">{formatCurrency(quotationSummary.otherCharges)}</span>
                    </div>
                  )}
                  <div className="mt-3 grid grid-cols-[1fr_auto] items-center gap-6 border-t border-border pt-3">
                    <span className="text-sm font-semibold uppercase tracking-wide">Final Grand Total</span>
                    <span className="text-right text-xl font-bold tracking-tight text-primary tabular-nums">
                      {formatCurrency(quotationSummary.total)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Logistics & Commercials Summary */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-border/70 bg-background p-3">
                  <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Delivery Duration
                  </Label>
                  <p className="mt-1 text-sm font-semibold">{metaData.deliveryTime ? `${metaData.deliveryTime}` : "Not Specified"}</p>
                </div>
                <div className="rounded-xl border border-border/70 bg-background p-3">
                  <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Expected Delivery Date
                  </Label>
                  <p className="mt-1 text-sm font-semibold tabular-nums">
                    {metaData.expectedDeliveryDate || "Not Specified"}
                  </p>
                </div>
                <div className="rounded-xl border border-border/70 bg-background p-3">
                  <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Payment Terms & Mode
                  </Label>
                  <p className="mt-1 text-sm font-semibold">{metaData.paymentTerms || "Net 30"} ({metaData.modeOfPayment || "Bank Transfer"})</p>
                </div>
                <div
                  onClick={() => setShowItemDetailsModal(true)}
                  className="rounded-xl border border-border/70 bg-background p-3 cursor-pointer hover:border-primary/50 transition-colors group"
                >
                  <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground group-hover:text-primary flex items-center justify-between">
                    <span>Items Quoted (Click to Inspect)</span>
                    <Eye className="size-3.5 text-primary" />
                  </Label>
                  <p className="mt-1 text-sm font-semibold">
                    {quotationSummary.quotedItems} of {rfq.items?.length} Items
                  </p>
                </div>
              </div>

              {/* Remarks Preview */}
              {metaData.remarks && (
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase font-black text-muted-foreground">
                    Special Remarks / Commercial Conditions
                  </Label>
                  <div className="rounded-xl border border-border/40 bg-muted/30 p-2.5 text-xs italic leading-snug text-muted-foreground">
                    {metaData.remarks}
                  </div>
                </div>
              )}
            </div>

            <DialogFooter className="border-t border-border/70 bg-muted/10 p-4">
              <div className="flex w-full flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                <Button
                  variant="ghost"
                  className="h-11 rounded-xl px-6 text-xs font-semibold uppercase"
                  onClick={() => setShowSummaryModal(false)}
                  disabled={submitting}
                >
                  Go Back & Edit
                </Button>
                <Button
                  className="h-11 rounded-xl bg-blue-600 px-8 text-xs font-semibold uppercase text-white shadow-glow hover:bg-blue-700"
                  onClick={() => {
                    if (submitting || isLocked) return;
                    setShowSummaryModal(false);
                    setShowFinalConfirmModal(true);
                  }}
                  disabled={submitting || isLocked}
                >
                  Proceed to Confirmation <ArrowRight className="ml-2 size-4" />
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Item-wise Pricing Breakdown Dialog */}
        <Dialog open={showItemDetailsModal} onOpenChange={setShowItemDetailsModal}>
          <DialogContent className="max-w-xl rounded-2xl">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold">Item-wise Quoted Pricing</DialogTitle>
              <DialogDescription className="text-xs">
                Detailed breakdown of unit prices and line totals for RFQ {rfq.rfqNumber || rfq.rfq_number}
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-80 overflow-y-auto rounded-xl border border-border/60 bg-muted/20 p-3">
              <table className="w-full text-xs text-left">
                <thead className="border-b border-border/60 font-bold uppercase text-[10px] text-muted-foreground">
                  <tr>
                    <th className="p-2">Material</th>
                    <th className="p-2 text-right">Qty</th>
                    <th className="p-2 text-right">Unit Price</th>
                    <th className="p-2 text-right">Line Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {(rfq.items || []).map((item: any, idx: number) => {
                    const key = getItemKey(item, idx);
                    const itemData = itemsData[key] || {};
                    const qty = Number(itemData.availableQty) || 0;
                    const price = Number(itemData.unitPrice) || 0;
                    const lineTotal = qty * price;
                    return (
                      <tr key={key}>
                        <td className="p-2 font-semibold">{item.materialName || item.material_name || item.materialCode || "Material"}</td>
                        <td className="p-2 text-right tabular-nums">{qty} {item.uom || "PCS"}</td>
                        <td className="p-2 text-right tabular-nums">{formatCurrency(price)}</td>
                        <td className="p-2 text-right font-bold tabular-nums">{formatCurrency(lineTotal)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <DialogFooter>
              <Button onClick={() => setShowItemDetailsModal(false)} className="rounded-xl text-xs font-bold">
                Close Breakdown
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Final Submission Confirmation Dialog */}
        <Dialog open={showFinalConfirmModal} onOpenChange={setShowFinalConfirmModal}>
          <DialogContent className="max-w-md rounded-2xl">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold flex items-center gap-2">
                <ShieldCheck className="size-5 text-success" /> Confirm Official Quotation
              </DialogTitle>
              <DialogDescription className="text-xs">
                Please verify your summary details before official locking and submission.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 rounded-xl border border-border/75 bg-muted/20 p-4 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Supplier Partner:</span>
                <span className="font-bold">{supplierName || "Supplier Partner"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">RFQ Number:</span>
                <span className="font-mono font-bold">{rfq.rfqNumber || rfq.rfq_number}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Expected Delivery Date:</span>
                <span className="font-mono font-bold">{metaData.expectedDeliveryDate || "Not Specified"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Payment Terms & Mode:</span>
                <span className="font-bold">{metaData.paymentTerms} ({metaData.modeOfPayment || "Bank Transfer"})</span>
              </div>
              <div className="flex justify-between border-t border-border pt-2 text-sm font-bold">
                <span>Final Grand Total:</span>
                <span className="text-primary tabular-nums">{formatCurrency(quotationSummary.total)}</span>
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setShowFinalConfirmModal(false)} className="rounded-xl text-xs font-bold" disabled={submitting}>
                Review Again
              </Button>
              <Button
                onClick={() => handleSave("SUBMITTED")}
                className="rounded-xl bg-success text-white text-xs font-bold shadow-glow hover:bg-success/90"
                disabled={submitting}
              >
                {submitting ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
                Confirm & Submit
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
