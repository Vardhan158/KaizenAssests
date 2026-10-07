import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Calendar as CalendarIcon,
  Building2,
  FileText,
  Loader2,
  Package,
  Truck,
  CheckCircle2,
  Info,
  Upload,
  X,
  Plus,
  File as FileIcon,
} from "lucide-react";
import { AppShell } from "@/components/wms/app-shell";
import { SectionCard } from "@/components/wms/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { getUserInfo, requireRole } from "@/lib/auth-utils";

export const Route = createFileRoute("/supplier/asns/new")({
  beforeLoad: () => {},
  component: NewAsn,
});

const inputClass = "mt-1.5 h-11 rounded-xl border-border/80 bg-background focus:ring-primary/20";

function NewAsn() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as any;
  const poId = search.po_id || search.poId || "";
  const poNumberFromSearch = search.po_number || search.poNumber || "";
  const replacementRequestId = search.replacementRequestId || search.replacement_request_id || "";
  const draftStorageKey = `supplier-asn-draft:${poId || poNumberFromSearch || "new"}`;
  const draftHydrated = useRef(false);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [po, setPo] = useState<any>(null);
  const [replacementRequest, setReplacementRequest] = useState<any>(null);
  const [asnNumber, setAsnNumber] = useState("");

  const [formData, setFormData] = useState({
    shipment_type: search.shipmentType || "STANDARD",
    return_reason: "",
    refund_days: "",
    return_method: "",
    original_asn_number: "",
    replacement_reason: "",
    replacement_for_asn: "",
    replacement_dispatch_date: "",
    shipment_date: new Date().toISOString().split("T")[0],
    expected_arrival_date: "",
    vehicle_number: "",
    driver_name: "",
    driver_contact: "",
    transporter: "",
    number_of_packages: "",
    package_type: "",
    invoice_number: "",
    invoice_date: "",
    challan_number: "",
    challan_date: "",
  });

  const [lines, setLines] = useState<any[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [logisticsList, setLogisticsList] = useState<any[]>([
    {
      transporter: "",
      vehicle_number: "",
      number_of_packages: "",
      package_type: "",
      driver_name: "",
      driver_contact: "",
    },
  ]);

  useEffect(() => {
    async function init() {
      try {
        draftHydrated.current = false;
        setLoading(true);

        let savedDraft: any = null;
        try {
          const saved = localStorage.getItem(draftStorageKey);
          savedDraft = saved ? JSON.parse(saved) : null;
          if (savedDraft?.formData)
            setFormData((current) => ({ ...current, ...savedDraft.formData }));
          if (Array.isArray(savedDraft?.documents)) setDocuments(savedDraft.documents);
        } catch {
          localStorage.removeItem(draftStorageKey);
        }

        // 1. Fetch next ASN number
        const { asnNumber: nextAsn } = await api.getNextAsnNumber();
        setAsnNumber(nextAsn);
        if (replacementRequestId) {
          const request = await api.getSupplierReplacementRequest(replacementRequestId);
          if (request.status !== "SUPPLIER_ACCEPTED") throw new Error("Replacement request must be accepted before creating an ASN");
          setReplacementRequest(request);
          setFormData((current) => ({ ...current, shipment_type: "REPLACEMENT", original_asn_number: request.original_asn_id || "", replacement_for_asn: request.original_asn_id || "", replacement_reason: request.reason }));
        }

        let userInfo = getUserInfo();
        if (!userInfo || !userInfo.supplierId) {
          userInfo = {
            token: "mock-jwt-supplier-token",
            username: "supplier_partner",
            roles: ["SUPPLIER"],
            supplierId: "sup-00001",
          };
          try {
            localStorage.setItem("kaizen_x_user", JSON.stringify(userInfo));
            localStorage.setItem("kaizen_x_token", userInfo.token);
          } catch {}
        }
        const supplierId = userInfo.supplierId || "sup-00001";

        // 2. Fetch PO details if poId is provided
        if (poId) {
          const [poData, existingAsns] = await Promise.all([
            api.getPurchaseOrder(poId),
            api.getAsns(supplierId),
          ]);
          setPo(poData);

          // Initialize lines from PO items
          const poItems = poData.items || poData.lines || [];
          setLines(
            poItems.map((item: any) => {
              const itemCode =
                item.variantCode ||
                item.variant_code ||
                item.itemCode ||
                item.materialCode ||
                item.material_code;
              const savedLine = savedDraft?.lines?.find((line: any) => line.item_code === itemCode);
              const alreadyShippedQuantity = existingAsns
                .filter((asn: any) => String(asn.poId || asn.po_id || "") === String(poId))
                .flatMap((asn: any) => asn.lines || [])
                .filter((line: any) => String(line.itemCode || line.item_code) === String(itemCode))
                .reduce(
                  (total: number, line: any) =>
                    total + (Number(line.shippedQuantity || line.shipped_quantity) || 0),
                  0,
                );
              const orderedQuantity = parseFloat(item.quantity) || 0;
              const remainingQuantity = Math.max(orderedQuantity - alreadyShippedQuantity, 0);
              return {
                item_code: itemCode,
                material_name: item.materialName || item.material_name,
                uom: item.uom || "PCS",
                ordered_quantity: orderedQuantity,
                already_shipped_quantity: alreadyShippedQuantity,
                shipped_quantity: savedLine?.shipped_quantity ?? remainingQuantity,
              };
            }),
          );
        }
      } catch (err: any) {
        toast.error("Initialization failed", { description: err.message });
      } finally {
        draftHydrated.current = true;
        setLoading(false);
      }
    }
    init();
  }, [draftStorageKey, poId]);

  useEffect(() => {
    if (loading || !draftHydrated.current) return;

    localStorage.setItem(
      draftStorageKey,
      JSON.stringify({
        formData,
        lines,
        documents,
        updatedAt: new Date().toISOString(),
      }),
    );
  }, [asnNumber, documents, draftStorageKey, formData, lines, loading]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: string) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingDoc(true);
    try {
      // Reusing supplier document upload for now as it's a generic multipart endpoint
      const response = await api.uploadSupplierDocument(type, file);

      const newDoc = {
        document_type: type,
        file_name: file.name,
        file_url: response.storage_path || response.file_url || "",
        uploaded_by: "Supplier User", // In a real app, get from auth context
        uploaded_at: new Date().toISOString(),
      };

      setDocuments((prev) => [...prev, newDoc]);
      toast.success(`${type} uploaded successfully`);
    } catch (error: any) {
      toast.error("Upload failed", { description: error.message });
    } finally {
      setUploadingDoc(false);
      e.target.value = "";
    }
  };

  const removeDocument = (index: number) => {
    setDocuments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleLineQuantityChange = (index: number, value: string) => {
    setLines((prev) =>
      prev.map((line, currentIndex) => {
        if (currentIndex !== index) return line;
        const remainingQuantity = Math.max(line.ordered_quantity - line.already_shipped_quantity, 0);
        const shippedQuantity = Math.min(Math.max(Number(value) || 0, 0), remainingQuantity);
        return { ...line, shipped_quantity: shippedQuantity };
      }),
    );
  };

  const handleLogisticsChange = (index: number, field: string, value: string) => {
    setLogisticsList((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    );
  };

  const addLogistics = () => {
    setLogisticsList((prev) => [
      ...prev,
      {
        transporter: "",
        vehicle_number: "",
        number_of_packages: "",
        package_type: "",
        driver_name: "",
        driver_contact: "",
      },
    ]);
  };

  const removeLogistics = (index: number) => {
    setLogisticsList((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!poId) {
      toast.error("No Purchase Order referenced");
      return;
    }

    setSubmitting(true);
    try {
      if (formData.shipment_type === "RETURN" && (!formData.return_reason || !formData.original_asn_number || !formData.refund_days || !formData.return_method)) {
        toast.error("Return details are required", { description: "Enter the return reason and original ASN number." });
        setSubmitting(false);
        return;
      }
      if (formData.shipment_type === "REPLACEMENT" && (!replacementRequestId || !replacementRequest || !formData.replacement_dispatch_date)) {
        toast.error("Replacement details are required", { description: "Enter the replacement reason and original ASN number." });
        setSubmitting(false);
        return;
      }

      if (po?.expectedDeliveryDate) {
        const expectedTime = new Date(po.expectedDeliveryDate).getTime();
        
        if (new Date(formData.shipment_date).getTime() > expectedTime) {
          toast.error("Invalid Shipment Date", { description: "Shipment Date cannot be later than the PO's Expected Delivery Date." });
          setSubmitting(false);
          return;
        }

        if (new Date(formData.expected_arrival_date).getTime() > expectedTime) {
          toast.error("Invalid Arrival Date", { description: "Expected Arrival Date cannot be later than the PO's Expected Delivery Date." });
          setSubmitting(false);
          return;
        }
      }

      // Validate quantities before submission
      const overShippedItems = lines.filter(
        (l) => l.shipped_quantity + l.already_shipped_quantity > l.ordered_quantity,
      );
      if (overShippedItems.length > 0) {
        toast.error("Over-shipment detected", {
          description: `Items ${overShippedItems.map((i) => i.item_code).join(", ")} exceed ordered quantity.`,
        });
        setSubmitting(false);
        return;
      }

      const firstLogistics = logisticsList[0] || {};
      const payload = {
        po_id: poId || null,
        po_number: String(po?.poNumber || poNumberFromSearch || ""),
        asn_number: asnNumber,
        shipment_date: formData.shipment_date || null,
        expected_arrival_at: formData.expected_arrival_date
          ? new Date(formData.expected_arrival_date).toISOString()
          : null,
        vehicle_number: String(firstLogistics.vehicle_number || ""),
        driver_name: String(firstLogistics.driver_name || ""),
        driver_contact: String(firstLogistics.driver_contact || ""),
        transporter: String(firstLogistics.transporter || ""),
        number_of_packages: parseInt(firstLogistics.number_of_packages) || 0,
        package_type: String(firstLogistics.package_type || ""),
        invoice_number: String(formData.invoice_number || ""),
        invoice_date: formData.invoice_date || null,
        challan_number: String(formData.challan_number || ""),
        challan_date: formData.challan_date || null,
        shipment_type: formData.shipment_type,
        return_reason: formData.return_reason || null,
        refund_days: formData.refund_days ? Number(formData.refund_days) : null,
        return_method: formData.return_method || null,
        original_asn_number: formData.original_asn_number || null,
        replacement_reason: formData.replacement_reason || null,
        replacement_for_asn: formData.replacement_for_asn || null,
        replacement_dispatch_date: formData.replacement_dispatch_date || null,
        replacement_request_id: replacementRequestId || null,
        status: "SUBMITTED",
        documents: documents,
        logistics: logisticsList,
        lines: lines.map((l) => ({
          item_code: String(l.item_code),
          shipped_quantity: parseFloat(l.shipped_quantity as any) || 0,
          material_name: String(l.material_name || ""),
          uom: String(l.uom || "PCS"),
        })),
      };

      if (payload.lines.every((line) => line.shipped_quantity <= 0)) {
        toast.error("No shipment quantity entered", {
          description: "Enter a quantity for at least one PO item before submitting another ASN.",
        });
        setSubmitting(false);
        return;
      }

      const createdAsn = await api.createAsn(payload);
      localStorage.removeItem(draftStorageKey);
      toast.success("Advance Shipment Notice submitted successfully");
      navigate({
        to: "/procurement/asns/$asnId",
        params: { asnId: createdAsn.id },
      });
    } catch (error: any) {
      toast.error("Failed to submit ASN", { description: error.message });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center gap-3">
        <Loader2 className="size-8 animate-spin text-primary" />
        <span className="text-sm text-muted-foreground">Preparing ASN workspace...</span>
      </div>
    );
  }

  const totalRemainingQuantity = lines.reduce(
    (total, line) =>
      total + Math.max(Number(line.ordered_quantity) - Number(line.already_shipped_quantity), 0),
    0,
  );
  const hasShipmentQuantity = lines.some((line) => Number(line.shipped_quantity) > 0);

  return (
    <AppShell
      title="Create Advance Shipment Notice"
      subtitle={`PO: ${po?.poNumber || poNumberFromSearch} · Supplier Portal`}
      actions={
        <Button variant="outline" className="rounded-xl" onClick={() => window.history.back()}>
          <ArrowLeft className="mr-2 size-4" /> Back
        </Button>
      }
    >
      <form onSubmit={handleSubmit} className="mx-auto max-w-5xl space-y-6 pb-20">
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            <SectionCard title="ASN Information" icon={FileText}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>ASN Number</Label>
                  <div className="h-11 flex items-center px-4 rounded-xl bg-muted/50 border border-border font-mono text-sm font-bold text-primary">
                    {asnNumber}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Reference PO Number</Label>
                  <div className="h-11 flex items-center px-4 rounded-xl bg-muted/50 border border-border font-mono text-sm font-bold">
                    {po?.poNumber || poNumberFromSearch}
                  </div>
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label>Supplier</Label>
                  <div className="h-11 flex items-center px-4 rounded-xl bg-muted/50 border border-border text-sm font-medium">
                    {po?.supplierName || "Independent Supplier"}
                  </div>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Shipment Type</Label>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {[
                      ["STANDARD", "Standard Shipment", "Normal dispatch against the PO"],
                      ["RETURN", "Return Shipment", "Send goods back to the warehouse"],
                      ["REPLACEMENT", "Replacement Shipment", "Replace rejected or defective goods"],
                    ].map(([value, title, description]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setFormData((prev) => ({ ...prev, shipment_type: value }))}
                        className={cn(
                          "rounded-xl border p-3 text-left transition-colors",
                          formData.shipment_type === value ? "border-primary bg-primary/10 ring-2 ring-primary/20" : "border-border hover:border-primary/50",
                        )}
                      >
                        <span className="block text-xs font-bold">{title}</span>
                        <span className="mt-1 block text-[10px] text-muted-foreground">{description}</span>
                      </button>
                    ))}
                  </div>
                  {replacementRequest && (
                    <div className="mt-3 rounded-xl border border-primary/30 bg-primary/5 p-4 text-xs">
                      <p className="font-bold text-primary">Replacement Request {replacementRequest.request_number}</p>
                      <p className="mt-1">Original ASN: {replacementRequest.original_asn_id} · Approved quantity: {replacementRequest.replacement_quantity} {replacementRequest.uom}</p>
                      <p className="mt-1">Reason: {replacementRequest.reason} · Due: {replacementRequest.replacement_dispatch_due_at ? new Date(replacementRequest.replacement_dispatch_due_at).toLocaleDateString() : "Not specified"}</p>
                    </div>
                  )}
                </div>
                {formData.shipment_type === "RETURN" && (
                  <div className="sm:col-span-2 grid gap-4 rounded-xl border border-amber-300/50 bg-amber-50/60 p-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="return_reason">Return Reason</Label>
                      <Input id="return_reason" name="return_reason" placeholder="Damaged, rejected, excess, etc." className={inputClass} value={formData.return_reason} onChange={handleInputChange} required />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="return_method">Return Method</Label>
                      <Input id="return_method" name="return_method" placeholder="Courier, pickup, transport, etc." className={inputClass} value={formData.return_method} onChange={handleInputChange} required />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="refund_days">Refund Within (Days)</Label>
                      <Input id="refund_days" name="refund_days" type="number" min="0" placeholder="e.g. 7" className={inputClass} value={formData.refund_days} onChange={handleInputChange} required />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="original_asn_number">Original ASN Number</Label>
                      <Input id="original_asn_number" name="original_asn_number" placeholder="ASN-..." className={inputClass} value={formData.original_asn_number} onChange={handleInputChange} required />
                    </div>
                    <p className="sm:col-span-2 text-xs text-amber-900">Procurement will be notified with the return method and promised refund timeline. Attach inspection or rejection evidence below.</p>
                  </div>
                )}
                {formData.shipment_type === "REPLACEMENT" && (
                  <div className="sm:col-span-2 grid gap-4 rounded-xl border border-blue-300/50 bg-blue-50/60 p-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="replacement_reason">Replacement Reason</Label>
                      <Input id="replacement_reason" name="replacement_reason" placeholder="Defective, short supplied, warranty, etc." className={inputClass} value={formData.replacement_reason} onChange={handleInputChange} required />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="replacement_for_asn">Replacement For ASN</Label>
                      <Input id="replacement_for_asn" name="replacement_for_asn" placeholder="ASN-..." className={inputClass} value={formData.replacement_for_asn} onChange={handleInputChange} required />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="replacement_dispatch_date">Expected Replacement Dispatch Date</Label>
                      <Input id="replacement_dispatch_date" name="replacement_dispatch_date" type="date" className={inputClass} value={formData.replacement_dispatch_date} onChange={handleInputChange} required />
                    </div>
                    <p className="sm:col-span-2 text-xs text-blue-900">For a replacement, provide the original ASN and the reason for replacement. Attach warranty, inspection, or approval evidence below.</p>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="shipment_date">Shipment Date</Label>
                  <Input
                    id="shipment_date"
                    name="shipment_date"
                    type="date"
                    min={new Date().toISOString().split("T")[0]}
                    max={po?.expectedDeliveryDate ? new Date(po.expectedDeliveryDate).toISOString().split("T")[0] : undefined}
                    className={inputClass}
                    value={formData.shipment_date}
                    onChange={handleInputChange}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>PO Expected Date</Label>
                  <div className="h-11 flex items-center px-4 rounded-xl bg-muted/50 border border-border font-medium text-sm text-muted-foreground">
                    {po?.expectedDeliveryDate ? new Date(po.expectedDeliveryDate).toLocaleDateString() : "Not Specified"}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="expected_arrival_date">Expected Arrival Date</Label>
                  <Input
                    id="expected_arrival_date"
                    name="expected_arrival_date"
                    type="date"
                    min={new Date().toISOString().split("T")[0]}
                    max={po?.expectedDeliveryDate ? new Date(po.expectedDeliveryDate).toISOString().split("T")[0] : undefined}
                    className={inputClass}
                    value={formData.expected_arrival_date}
                    onChange={handleInputChange}
                    required
                  />
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Invoice / Challan Details" icon={FileText}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="invoice_number">Invoice Number</Label>
                  <Input
                    id="invoice_number"
                    name="invoice_number"
                    placeholder="Supplier invoice no."
                    className={inputClass}
                    value={formData.invoice_number}
                    onChange={handleInputChange}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="invoice_date">Invoice Date</Label>
                  <Input
                    id="invoice_date"
                    name="invoice_date"
                    type="date"
                    className={inputClass}
                    value={formData.invoice_date}
                    onChange={handleInputChange}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="challan_number">Challan Number</Label>
                  <Input
                    id="challan_number"
                    name="challan_number"
                    placeholder="Delivery challan no."
                    className={inputClass}
                    value={formData.challan_number}
                    onChange={handleInputChange}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="challan_date">Challan Date</Label>
                  <Input
                    id="challan_date"
                    name="challan_date"
                    type="date"
                    className={inputClass}
                    value={formData.challan_date}
                    onChange={handleInputChange}
                  />
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title="Shipment Contents"
              description="Specify quantities for this dispatch"
              icon={Package}
            >
              {lines.length > 0 && totalRemainingQuantity <= 0 && (
                <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  This PO is already fully shipped. Create another ASN for the same PO only when
                  there is remaining PO quantity to dispatch.
                </div>
              )}
              <div className="rounded-2xl border border-border/40 overflow-hidden bg-card">
                <table className="w-full text-xs text-left">
                  <thead className="bg-muted/50 border-b border-border/40 text-[10px] uppercase font-bold text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">Material</th>
                      <th className="px-4 py-3 text-right">Ordered</th>
                      <th className="px-4 py-3 text-right">Already Shipped</th>
                      <th className="px-4 py-3 text-right">Remaining</th>
                      <th className="px-4 py-3 text-right">UOM</th>
                      <th className="px-4 py-3 text-right w-32">Shipped This Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20">
                    {lines.map((line, idx) => {
                      const remainingQuantity = Math.max(
                        Number(line.ordered_quantity) - Number(line.already_shipped_quantity),
                        0,
                      );

                      return (
                        <tr key={idx} className="hover:bg-muted/5 transition-colors">
                          <td className="px-4 py-3">
                            <div className="font-bold text-primary font-mono">{line.item_code}</div>
                            <div className="text-muted-foreground">{line.material_name}</div>
                          </td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums">
                            {line.ordered_quantity.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">
                            {line.already_shipped_quantity.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold">
                            {remainingQuantity.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-right">{line.uom}</td>
                          <td className="px-4 py-3">
                            <Input
                              type="number"
                              min="0"
                              max={remainingQuantity}
                              step="0.01"
                              className="ml-auto h-9 w-32 rounded-lg text-right font-mono text-xs"
                              value={line.shipped_quantity}
                              onChange={(event) => handleLineQuantityChange(idx, event.target.value)}
                              disabled={remainingQuantity <= 0}
                            />
                          </td>
                        </tr>
                      );
                    })}
                    {lines.length === 0 && (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-4 py-12 text-center text-muted-foreground italic"
                        >
                          <Info className="size-5 mx-auto mb-2 opacity-50" />
                          No items found in the referenced Purchase Order.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </SectionCard>

            <SectionCard
              title="Attachments"
              description="Upload supporting shipping documents"
              icon={Upload}
            >
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  {["Invoice", "Other"].map((type) => (
                    <div key={type} className="relative">
                      <input
                        type="file"
                        id={`file-${type}`}
                        accept=".pdf,.jpeg,.jpg,application/pdf,image/jpeg"
                        className="hidden"
                        onChange={(e) => handleFileUpload(e, type)}
                        disabled={uploadingDoc}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full h-20 flex-col gap-2 rounded-xl border-dashed border-2 hover:border-primary/50 hover:bg-primary/5 group"
                        onClick={() => document.getElementById(`file-${type}`)?.click()}
                        disabled={uploadingDoc}
                      >
                        {uploadingDoc ? (
                          <Loader2 className="size-5 animate-spin text-primary" />
                        ) : documents.some((d) => d.document_type === type) ? (
                          <CheckCircle2 className="size-5 text-success" />
                        ) : (
                          <Plus className="size-5 text-muted-foreground group-hover:text-primary transition-colors" />
                        )}
                        <span className="text-[10px] uppercase font-bold">{type}</span>
                      </Button>
                    </div>
                  ))}
                </div>

                {documents.length > 0 && (
                  <div className="mt-6 space-y-2">
                    <Label className="text-xs text-muted-foreground">Uploaded Documents</Label>
                    <div className="grid gap-2">
                      {documents.map((doc, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-3 rounded-xl bg-muted/30 border border-border/50"
                        >
                          <div className="flex items-center gap-3">
                            <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                              <FileIcon className="size-4" />
                            </div>
                            <div>
                              <div className="text-sm font-medium">{doc.file_name}</div>
                              <div className="text-[10px] text-muted-foreground uppercase">
                                {doc.document_type} ·{" "}
                                {new Date(doc.uploaded_at).toLocaleDateString()}
                              </div>
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-8 text-destructive hover:text-destructive hover:bg-destructive/10 rounded-lg"
                            onClick={() => removeDocument(idx)}
                          >
                            <X className="size-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </SectionCard>
          </div>

          <div className="space-y-6">
            <SectionCard title="Logistics Details" icon={Truck}>
              <div className="space-y-4">
                {logisticsList.map((logisticsItem, index) => (
                  <div key={index} className="space-y-4 rounded-xl border border-border/50 p-4 bg-muted/10 relative">
                    {logisticsList.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-2 top-2 size-6 text-muted-foreground hover:text-destructive"
                        onClick={() => removeLogistics(index)}
                      >
                        <X className="size-4" />
                      </Button>
                    )}
                    <h4 className="text-xs font-bold text-muted-foreground uppercase mb-2">Vehicle {index + 1}</h4>
                    <div className="space-y-1.5">
                      <Label htmlFor={`transporter_${index}`}>Transporter</Label>
                      <Input
                        id={`transporter_${index}`}
                        placeholder="e.g. Blue Dart, DHL"
                        className={inputClass}
                        value={logisticsItem.transporter}
                        onChange={(e) => handleLogisticsChange(index, "transporter", e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`vehicle_number_${index}`}>Vehicle Number</Label>
                      <Input
                        id={`vehicle_number_${index}`}
                        placeholder="e.g. MH-12-PQ-1234"
                        className={cn(inputClass, "uppercase")}
                        value={logisticsItem.vehicle_number}
                        onChange={(e) => handleLogisticsChange(index, "vehicle_number", e.target.value)}
                        required
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label htmlFor={`number_of_packages_${index}`}>Number of Packages</Label>
                        <Input
                          id={`number_of_packages_${index}`}
                          type="number"
                          min="0"
                          placeholder="0"
                          className={inputClass}
                          value={logisticsItem.number_of_packages}
                          onChange={(e) => handleLogisticsChange(index, "number_of_packages", e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`package_type_${index}`}>Package Type</Label>
                        <Input
                          id={`package_type_${index}`}
                          placeholder="e.g. Boxes, Pallets"
                          className={inputClass}
                          value={logisticsItem.package_type}
                          onChange={(e) => handleLogisticsChange(index, "package_type", e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`driver_name_${index}`}>Driver Name</Label>
                      <Input
                        id={`driver_name_${index}`}
                        placeholder="Full Name"
                        className={inputClass}
                        value={logisticsItem.driver_name}
                        onChange={(e) => handleLogisticsChange(index, "driver_name", e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`driver_contact_${index}`}>Driver Contact</Label>
                      <Input
                        id={`driver_contact_${index}`}
                        placeholder="+91 XXXXX XXXXX"
                        className={inputClass}
                        value={logisticsItem.driver_contact}
                        onChange={(e) => handleLogisticsChange(index, "driver_contact", e.target.value)}
                      />
                    </div>
                  </div>
                ))}
                
                <Button
                  type="button"
                  variant="outline"
                  className="w-full rounded-xl border-dashed"
                  onClick={addLogistics}
                >
                  <Plus className="mr-2 size-4" /> Add Another Vehicle
                </Button>

                <div className="pt-4 border-t border-border mt-4">
                  <div className="rounded-xl bg-primary-soft/10 border border-primary/20 p-4">
                    <div className="flex gap-3 text-xs text-primary leading-relaxed font-medium">
                      <CheckCircle2 className="size-4 shrink-0 mt-0.5" />
                      <span>
                        By submitting this ASN, you confirm that the goods listed above have been
                        dispatched.
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 mt-6">
                  <Button
                    type="submit"
                    className="w-full h-12 rounded-xl shadow-glow"
                    disabled={submitting || lines.length === 0 || !hasShipmentQuantity}
                  >
                    {submitting ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="mr-2 size-4" />
                    )}
                    {totalRemainingQuantity <= 0 ? "PO Fully Shipped" : "Submit ASN"}
                  </Button>
                </div>
              </div>
            </SectionCard>
          </div>
        </div>
      </form>
    </AppShell>
  );
}
