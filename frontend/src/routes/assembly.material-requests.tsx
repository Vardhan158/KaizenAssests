import { useSearch, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/wms/app-shell";
import { requireRole } from "@/lib/auth-utils";
import { completionDateError, localDateInput, parsePositiveNumber } from "@/lib/input-validation";
import {
  api,
  type AssemblyMaterialRequest,
  type AssemblyMaterialRequestItem,
  type AssemblyProductOption,
  type AssemblyProductBOMResponse,
} from "@/lib/api-client";
import {
  AlertTriangle,
  Boxes,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Eye,
  Layers,
  LayoutDashboard,
  Package,
  PackageCheck,
  Plus,
  PlusCircle,
  RefreshCw,
  Search,
  Sparkles,
  Warehouse,
  X,
} from "lucide-react";
import { StatCard } from "@/components/wms/primitives";
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
import { cn, generateProductSKU } from "@/lib/utils";

export const Route = createFileRoute("/assembly/material-requests")({
  beforeLoad: () => requireRole(["ASSEMBLY_MANAGER", "ASSEMBLY", "ADMIN", "SUPERUSER"]),
  head: () => ({ meta: [{ title: "Material Requests · KaizenAssests" }] }),
  component: AssemblyMaterialRequestsPage,
});

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return dateStr;
  }
}

function getStatusBadge(status: string) {
  const s = (status || "").toUpperCase();
  if (s === "RECEIVED" || s === "COMPLETED" || s === "MATERIAL_READY") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25">
        <span className="size-1.5 rounded-full bg-emerald-500" />
        Received in Assembly
      </span>
    );
  }
  if (s === "ISSUED") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-700 dark:text-blue-300 border border-blue-500/25">
        <span className="size-1.5 rounded-full bg-blue-500 animate-pulse" />
        Issued by WH
      </span>
    );
  }
  if (s === "APPROVED")
    return (
      <Badge
        variant="outline"
        className="border-teal-500/25 bg-teal-500/10 text-teal-700 dark:text-teal-300"
      >
        Approved
      </Badge>
    );
  if (s === "PICKING" || s === "IN_PROGRESS") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-500/10 text-purple-700 dark:text-purple-300 border border-purple-500/25">
        <span className="size-1.5 rounded-full bg-purple-500 animate-pulse" />
        Warehouse Picking
      </span>
    );
  }
  if (s === "PENDING" || s === "SUBMITTED" || s === "PENDING_WAREHOUSE_APPROVAL") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/25">
        <span className="size-1.5 rounded-full bg-amber-500" />
        Awaiting Warehouse
      </span>
    );
  }
  if (s === "REJECTED" || s === "CANCELLED") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/25">
        <span className="size-1.5 rounded-full bg-rose-500" />
        {status}
      </span>
    );
  }
  return (
    <Badge variant="outline" className="text-xs font-medium">
      {status || "PENDING"}
    </Badge>
  );
}

const statusGroups: Record<string, string[]> = {
  PENDING: ["REQUESTED", "PENDING", "SUBMITTED", "PENDING_WAREHOUSE_APPROVAL"],
  APPROVED: ["APPROVED"],
  PICKING: ["PICKING", "IN_PROGRESS"],
  ISSUED: ["ISSUED"],
  RECEIVED: ["RECEIVED", "COMPLETED", "MATERIAL_READY"],
  REJECTED: ["REJECTED", "CANCELLED"],
};
function issuedQuantity(request: AssemblyMaterialRequest, item: AssemblyMaterialRequestItem) {
  if (item.issued_quantity != null) return item.issued_quantity;
  const issuedItems = ((request as any).issue_transaction || (request as any).material_issue)?.items || [];
  const matching = issuedItems.filter((issued: any) => issued.material_code === item.material_code);
  if (matching.length && matching.every((issued: any) => issued.issued_quantity != null)) {
    return matching.reduce((sum: number, issued: any) => sum + Number(issued.issued_quantity), 0);
  }
  return null;
}

function AssemblyMaterialRequestsPage() {
  const navigate = useNavigate();
  const [requests, setRequests] = useState<AssemblyMaterialRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const moduleSearchParams = useSearch({ strict: false }) as { search?: string };
  useEffect(() => { if (typeof moduleSearchParams.search === "string") setSearchTerm(moduleSearchParams.search); }, [moduleSearchParams.search]);
  const [statusFilter, setStatusFilter] = useState("ALL");

  // Create Modal State
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [products, setProducts] = useState<AssemblyProductOption[]>([]);
  const [rawMaterials, setRawMaterials] = useState<any[]>([]);
  const [loadingRawMaterials, setLoadingRawMaterials] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formData, setFormData] = useState({
    product_code: "",
    target_quantity: "",
    required_date: "",
    remarks: "",
  });

  const [requiredDateError, setRequiredDateError] = useState<string | null>(null);
  const openCreateRequest = () => {
    setFormData({
      product_code: "",
      target_quantity: "",
      required_date: "",
      remarks: "",
    });
    setRequiredDateError(null);
    setBomPreview(null);
    setBomPreviewError(null);
    setIsCreateOpen(true);
  };


  // Quick Add Product State
  const [isAddProductOpen, setIsAddProductOpen] = useState(false);
  const [addingProduct, setAddingProduct] = useState(false);
  const [skuManuallyEdited, setSkuManuallyEdited] = useState(false);
  const [newProductData, setNewProductData] = useState({
    product_name: "",
    product_code: "",
    description: "",
    components: [{ material_code: "", material_name: "", quantity_per_unit: 1, uom: "PCS" }],
  });

  const openAddProductModal = () => {
    void refreshAvailableMaterials();
    const existingCodes = products.map((p) => p.product_code);
    const initialSku = generateProductSKU("", existingCodes);
    setSkuManuallyEdited(false);
    setNewProductData({
      product_name: "",
      product_code: initialSku,
      description: "",
      components: [{ material_code: "", material_name: "", quantity_per_unit: 1, uom: "PCS" }],
    });
    setIsAddProductOpen(true);
  };

  const handleProductNameChange = (name: string) => {
    const existingCodes = products.map((p) => p.product_code);
    if (!skuManuallyEdited) {
      const generated = generateProductSKU(name, existingCodes);
      setNewProductData((prev) => ({
        ...prev,
        product_name: name,
        product_code: generated,
      }));
    } else {
      setNewProductData((prev) => ({
        ...prev,
        product_name: name,
      }));
    }
  };

  const handleRegenerateSKU = () => {
    const existingCodes = products.map((p) => p.product_code);
    const generated = generateProductSKU(newProductData.product_name, existingCodes);
    setNewProductData((prev) => ({
      ...prev,
      product_code: generated,
    }));
    setSkuManuallyEdited(false);
  };

  // Live BOM Preview
  const [bomPreview, setBomPreview] = useState<AssemblyProductBOMResponse | null>(null);
  const [loadingBOM, setLoadingBOM] = useState(false);
  const [bomRevision, setBomRevision] = useState(0);
  const [showBomMaterial, setShowBomMaterial] = useState(false);
  const [editingBomMaterial, setEditingBomMaterial] = useState(false);
  const [savingBomMaterial, setSavingBomMaterial] = useState(false);
  const [bomMaterialError, setBomMaterialError] = useState("");
  const [bomMaterialDraft, setBomMaterialDraft] = useState({ material_code: "", quantity_per_unit: "1" });
  useEffect(() => { setShowBomMaterial(false); setBomMaterialError(""); }, [formData.product_code]);
  const refreshAvailableMaterials = async () => {
    setLoadingRawMaterials(true);
    setRawMaterials([]);
    try {
      const rows = await api.getAssemblyAvailableMaterials();
      setRawMaterials((Array.isArray(rows) ? rows : []).filter(
        (material: any) => Number(material.available_quantity) > 0,
      ));
    } catch (error) {
      setRawMaterials([]);
      console.error("Failed to load available warehouse materials:", error);
      toast.error("Unable to check warehouse material availability.");
    } finally {
      setLoadingRawMaterials(false);
    }
  };
  const addBomMaterial = async () => {
    const quantity = Number(bomMaterialDraft.quantity_per_unit);
    if (!bomMaterialDraft.material_code || !Number.isFinite(quantity) || quantity <= 0) {
      setBomMaterialError("Select a material and enter a positive quantity per finished product."); return;
    }
    setSavingBomMaterial(true); setBomMaterialError("");
    try {
      await (editingBomMaterial ? api.updateProductBOMMaterial : api.addProductBOMMaterial)(formData.product_code, { material_code: bomMaterialDraft.material_code, quantity_per_unit: quantity });
      setShowBomMaterial(false); setBomMaterialDraft({ material_code: "", quantity_per_unit: "1" });
      setBomRevision(value => value + 1);
      toast.success(editingBomMaterial ? "BOM quantity updated." : "Material added to the product BOM.");
    } catch (err: any) { setBomMaterialError(err.message || "Unable to add the material."); }
    finally { setSavingBomMaterial(false); }
  };

  const [bomPreviewError, setBomPreviewError] = useState<string | null>(null);

  // In the Bill of Materials, only available materials are shown to assembly
  const availableBomMaterials = useMemo(() => {
    return (bomPreview?.materials || []).filter(item => (Number(item.available_quantity) || 0) > 0);
  }, [bomPreview]);
  const insufficientBomMaterials = useMemo(() =>
    (bomPreview?.materials || []).filter(item => Number(item.required_quantity) > Number(item.available_quantity ?? 0)),
    [bomPreview],
  );
  const insufficientNewProductComponents = useMemo(() => {
    const requiredByMaterial = new Map<string, { required: number; uom: string }>();
    newProductData.components.forEach(component => {
      if (!component.material_code) return;
      const current = requiredByMaterial.get(component.material_code) || { required: 0, uom: component.uom };
      current.required += component.quantity_per_unit;
      requiredByMaterial.set(component.material_code, current);
    });
    return Array.from(requiredByMaterial, ([code, requirement]) => {
      const material = rawMaterials.find(item => String(item.code) === code);
      const available = Number(material?.available_quantity ?? 0);
      return material && requirement.required > available
        ? [{ code, required: requirement.required, available, uom: requirement.uom }]
        : [];
    }).flat();
  }, [newProductData.components, rawMaterials]);

  // Detail Modal State
  const [selectedRequest, setSelectedRequest] = useState<AssemblyMaterialRequest | null>(null);

  // Assembly receipt confirmation state
  const [isReceiptOpen, setIsReceiptOpen] = useState(false);
  const [receiptRequest, setReceiptRequest] = useState<AssemblyMaterialRequest | null>(null);
  const [receiptItems, setReceiptItems] = useState<
    Array<{
      material_code: string;
      material_name: string;
      issued_quantity: number;
      received_quantity: number;
      uom: string;
    }>
  >([]);
  const [receiptRemarks, setReceiptRemarks] = useState("");
  const [confirmingReceipt, setConfirmingReceipt] = useState(false);

  const loadRequests = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await api.getAssemblyMaterialRequests();
      setRequests(res);
      setLoadError(null);
    } catch (err: any) {
      setLoadError(err?.message || "Failed to load material requests.");
      toast.error(err?.message || "Failed to load material requests.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const handleViewRequest = async (request: AssemblyMaterialRequest) => {
    try {
      setSelectedRequest(await api.getAssemblyMaterialRequestDetail(request.id));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to load current request details.",
      );
    }
  };

  const handleOpenReceiptModal = async (req: AssemblyMaterialRequest) => {
    try {
      const detail = await api.getAssemblyMaterialRequestDetail(req.id);
      setReceiptRequest(detail);
      const items = (detail.items || []).map((it) => ({
        material_code: it.material_code,
        material_name: it.material_name || it.material_code,
        issued_quantity: it.issued_quantity ?? 0,
        received_quantity: detail.material_received_at
          ? (it.received_quantity ?? 0)
          : (it.issued_quantity ?? 0),
        uom: it.uom || "PCS",
      }));
      setReceiptItems(items);
      setReceiptRemarks("");
      setIsReceiptOpen(true);
    } catch (err: any) {
      toast.error(err?.message || "Failed to load request details for receipt.");
    }
  };

  const handleConfirmReceipt = async () => {
    if (!receiptRequest) return;
    try {
      setConfirmingReceipt(true);
      const result = await api.confirmAssemblyMaterialReceipt(receiptRequest.id, {
        received_items: receiptItems.map((i) => ({
          material_code: i.material_code,
          received_quantity: Number(i.received_quantity),
        })),
        remarks: receiptRemarks,
      });
      toast.success(
        result.message || `Materials confirmed received for Order ${receiptRequest.order_number}.`,
      );
      setIsReceiptOpen(false);
      setReceiptRequest(null);
      await loadRequests();
    } catch (err: any) {
      toast.error(err?.message || "Failed to confirm material receipt.");
    } finally {
      setConfirmingReceipt(false);
    }
  };

  const loadProducts = async () => {
    try {
      // Only BOM-backed products are eligible for an assembly material request.
      // Raw-material master records must not appear as manufacturable products.
      // In the bill of materials, only available materials (warehouse stock > 0) are shown to assembly.
      const productRows = await api.getAssemblyProducts();
      await refreshAvailableMaterials();
      setProducts(productRows);
    } catch (err: any) {
      console.error("Failed to load products master:", err);
    }
  };

  useEffect(() => {
    loadProducts();
  }, []);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  // Ignore responses for older product/quantity selections.
  useEffect(() => {
    let active = true;
    setBomPreview(null);
    setBomPreviewError(null);
    if (!isCreateOpen || !formData.product_code) {
      setLoadingBOM(false);
      return;
    }
    setLoadingBOM(true);
    void api.getProductBOM(formData.product_code, Number(formData.target_quantity) > 0 ? Number(formData.target_quantity) : 1)
      .then(result => { if (active) setBomPreview(result); })
      .catch((err: Error) => { if (active) setBomPreviewError(err.message || "Unable to load the selected product's BOM."); })
      .finally(() => { if (active) setLoadingBOM(false); });
    return () => { active = false; };
  }, [isCreateOpen, formData.product_code, formData.target_quantity, bomRevision]);

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProductData.product_name.trim()) {
      toast.error("Product name is required.");
      return;
    }
    const normalizedName = newProductData.product_name.trim().replace(/\s+/g, " ").toLowerCase();
    if (products.some(product => product.product_name.trim().replace(/\s+/g, " ").toLowerCase() === normalizedName)) {
      toast.error("A product with this name already exists. Select the existing product.");
      return;
    }
    const components = newProductData.components.filter(
      (component) => component.material_code && component.quantity_per_unit > 0 && component.uom,
    );
    if (!components.length || components.length !== newProductData.components.length) {
      toast.error("Add at least one valid BOM component with a material, quantity, and UOM.");
      return;
    }
    if (insufficientNewProductComponents.length) {
      toast.error(`Insufficient warehouse stock: ${insufficientNewProductComponents.map(item => `${item.code} needs ${item.required} ${item.uom}, only ${item.available} available`).join("; ")}.`);
      return;
    }

    const existingCodes = products.map((p) => p.product_code);
    const finalCode = (
      newProductData.product_code.trim() ||
      generateProductSKU(newProductData.product_name, existingCodes)
    ).toUpperCase();

    try {
      setAddingProduct(true);
      const created = await api.createAssemblyProduct({
        product_name: newProductData.product_name.trim(),
        product_code: finalCode,
        description: newProductData.description.trim() || undefined,
        components,
      });

      toast.success(`Product '${created.product_name}' registered with BOM ${created.bom_number}!`);
      setIsAddProductOpen(false);

      // Reload the complete database-backed product/material list and
      // auto-select the newly created product.
      await loadProducts();
      setFormData((prev) => ({ ...prev, product_code: created.product_code }));

      // Reset new product form
      setNewProductData({
        product_name: "",
        product_code: "",
        description: "",
        components: [{ material_code: "", material_name: "", quantity_per_unit: 1, uom: "PCS" }],
      });
    } catch (err: any) {
      toast.error(err?.message || "Failed to create product.");
    } finally {
      setAddingProduct(false);
    }
  };

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.product_code) {
      toast.error("Please select a product to manufacture.");
      return;
    }
    if (showBomMaterial || savingBomMaterial) { toast.error("Save or cancel the new BOM material first."); return; }
    if (loadingBOM || (bomPreview && (bomPreview.product_code !== formData.product_code || Number(bomPreview.target_quantity) !== Number(formData.target_quantity)))) {
      toast.error("Wait for the material requirements to finish updating.");
      return;
    }
    if (!bomPreview?.materials?.length) {
      toast.error("An active BOM with components is required before submitting this request.");
      return;
    }
    if (insufficientBomMaterials.length) {
      toast.error(`Insufficient warehouse stock: ${insufficientBomMaterials.map(item => `${item.material_code} needs ${item.required_quantity} ${item.uom}, only ${item.available_quantity ?? 0} available`).join("; ")}.`);
      return;
    }
    if (parsePositiveNumber(formData.target_quantity) === null) {
      toast.error("Production quantity must be greater than 0.");
      return;
    }
    const dateError = completionDateError(formData.required_date);
    setRequiredDateError(dateError);
    if (dateError) return;

    const requiredDate = /^\d{2}-\d{2}-\d{4}$/.test(formData.required_date)
      ? formData.required_date.split("-").reverse().join("-")
      : formData.required_date;

    try {
      setCreating(true);
      const newReq = await api.createAssemblyMaterialRequest({
        product_code: formData.product_code,
        target_quantity: Number(formData.target_quantity),
        required_date: requiredDate,
        remarks: formData.remarks,
      });

      toast.success(
        `Material Request ${newReq.request_number} sent to Warehouse for ${newReq.product_name} (${newReq.target_quantity} ${newReq.uom}).`,
      );
      setIsCreateOpen(false);
      setFormData({
        product_code: "",
        target_quantity: "",
        required_date: "",
        remarks: "",
      });
      loadRequests();
    } catch (err: any) {
      toast.error(err?.message || "Failed to submit material request.");
    } finally {
      setCreating(false);
    }
  };

  const kpiStats = useMemo(() => {
    const count = (group: string) =>
      requests.filter((r) => statusGroups[group]?.includes(r.status.toUpperCase())).length;
    return {
      total: requests.length,
      awaitingWH: count("PENDING"),
      approved: count("APPROVED"),
      inPicking: count("PICKING"),
      issued: count("ISSUED"),
      received: count("RECEIVED"),
      rejected: count("REJECTED"),
    };
  }, [requests]);
  const filteredRequests = useMemo(() => {
    const query = searchTerm.toLowerCase().trim();
    return requests.filter((r) => {
      if (statusFilter !== "ALL" && !statusGroups[statusFilter]?.includes(r.status.toUpperCase()))
        return false;
      return (
        !query ||
        [
          r.request_number,
          r.order_number,
          r.product_name,
          r.product_code,
          ...r.items.flatMap((item) => [item.material_code, item.material_name]),
        ].some((value) => value?.toLowerCase().includes(query))
      );
    });
  }, [requests, searchTerm, statusFilter]);
  const [requestPage, setRequestPage] = useState(1);
  const requestPageCount = Math.max(1, Math.ceil(filteredRequests.length / 10));
  const currentRequestPage = Math.min(requestPage, requestPageCount);
  const requestStart = (currentRequestPage - 1) * 10;
  const pagedRequests = filteredRequests.slice(requestStart, requestStart + 10);
  useEffect(() => { setRequestPage(1); }, [searchTerm, statusFilter]);
  useEffect(() => { setRequestPage(page => Math.min(page, requestPageCount)); }, [requestPageCount]);
  const metricValue = (value: number) =>
    loading ? "..." : loadError && !requests.length ? "Unavailable" : value.toLocaleString();

  return (
    <AppShell
      title="Material Requests"
      subtitle="Raw material requisitions sent to Warehouse for production orders"
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
          <Button data-refresh-control="true" aria-label="Refresh" title="Refresh"
            variant="outline"
            size="sm"
            onClick={() => loadRequests(true)}
            disabled={refreshing}
            className="rounded-xl text-xs gap-1.5 shadow-2xs hover:bg-muted/80"
          >
            <RefreshCw className={cn("size-3.5", refreshing && "animate-spin text-primary")} /></Button>
          <Button
            size="sm"
            onClick={openCreateRequest}
            className="rounded-xl text-xs gap-1.5 font-semibold shadow-soft bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <PlusCircle className="size-3.5" />
            New Material Request
          </Button>
        </div>
      }
    >
      <div className="assembly-material-requests-page min-w-0 space-y-5">
        <div
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
          aria-busy={loading || refreshing}
        >
          <StatCard
            compact
            label="Total Requests"
            value={metricValue(kpiStats.total)}
            delta="All assembly material requisitions"
            icon={Layers}
            tone="primary"
          />
          <StatCard
            compact
            label="Awaiting Warehouse"
            value={metricValue(kpiStats.awaitingWH)}
            delta="Requests awaiting warehouse approval"
            icon={Clock}
            tone="warning"
          />
          <StatCard
            compact
            label="In Picking"
            value={metricValue(kpiStats.inPicking)}
            delta="Materials being picked by warehouse"
            icon={Boxes}
            tone="teal"
          />
          <StatCard
            compact
            label="Received in Assembly"
            value={metricValue(kpiStats.received)}
            delta="Requests received on the assembly floor"
            icon={CheckCircle2}
            tone="success"
          />
        </div>

        {loadError && (
          <div
            role="alert"
            className="rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-xs text-destructive"
          >
            {loadError} Use Refresh to retry.
            {requests.length > 0 && " Showing the last successful update."}
          </div>
        )}

        {/* Main Work Center Table Card */}
        <div className="min-w-0 rounded-2xl border border-border/70 bg-card p-5 shadow-soft space-y-4">
          {/* Header & Controls */}
          <div className="space-y-4 pb-4 border-b border-border/60">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                  <Boxes className="size-4 text-primary" />
                  Material Requisition Queue
                </h2>
                <p className="text-xs text-muted-foreground">
                  Track warehouse staging, bill of materials allocation, and assembly floor receipt
                </p>
              </div>
              <div className="text-xs text-muted-foreground self-start sm:self-auto font-medium">
                Showing <strong className="text-foreground">{filteredRequests.length}</strong> of{" "}
                <strong className="text-foreground">{requests.length}</strong> requests
              </div>
            </div>

            {/* Filter & Search Toolbar */}
            <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 pt-1">
              {/* Status Filter Tabs */}
              <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-muted/60 border border-border/60">
                {[
                  { key: "ALL", label: `All (${kpiStats.total})` },
                  { key: "PENDING", label: `Awaiting WH (${kpiStats.awaitingWH})` },
                  { key: "PICKING", label: `Picking (${kpiStats.inPicking})` },
                  { key: "ISSUED", label: `Issued (${kpiStats.issued})` },
                  { key: "RECEIVED", label: `Received (${kpiStats.received})` },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    aria-pressed={statusFilter === tab.key}
                    onClick={() => setStatusFilter(tab.key)}
                    className={cn(
                      "h-8 px-3 text-xs font-semibold rounded-xl border transition-all",
                      statusFilter === tab.key
                        ? "bg-primary text-primary-foreground shadow-xs border-primary"
                        : "border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted",
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Search input */}
              <div className="relative min-w-0 w-full sm:w-auto sm:flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                <input
                  type="text"
                  aria-label="Search requisitions and materials"
                  placeholder="Search requests or materials..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="h-11 w-full rounded-xl border border-border bg-card pl-9 pr-8 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary/40"
                />
                {searchTerm && (
                  <button
                    aria-label="Clear search"
                    onClick={() => setSearchTerm("")}
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
              <p className="text-xs text-muted-foreground">
                Loading Material Requests from database...
              </p>
            </div>
          ) : filteredRequests.length === 0 ? (
            <div className="py-14 text-center">
              <div className="grid size-12 place-items-center rounded-2xl bg-muted mx-auto mb-3 text-muted-foreground">
                <Boxes className="size-6 opacity-60" />
              </div>
              <p className="text-sm font-semibold text-foreground">
                {searchTerm || statusFilter !== "ALL"
                  ? "No material requests match the selected filter"
                  : "No material requests found"}
              </p>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                {searchTerm || statusFilter !== "ALL"
                  ? "Try resetting your search query or switching to 'All' status filter."
                  : "Submit a new material request to stage raw components from warehouse inventory."}
              </p>
              <div className="mt-4 flex items-center justify-center gap-2">
                {searchTerm || statusFilter !== "ALL" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-xl text-xs gap-1.5"
                    onClick={() => {
                      setSearchTerm("");
                      setStatusFilter("ALL");
                    }}
                  >
                    Reset Filters
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="rounded-xl text-xs gap-1.5 font-semibold"
                    onClick={openCreateRequest}
                  >
                    <PlusCircle className="size-3.5" />
                    New Material Request
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="isolate overflow-x-auto rounded-xl border border-border/60">
              <table className="w-full min-w-[900px] text-left text-xs [&_th]:align-middle [&_td]:align-middle">
                <thead className="bg-muted/50">
                  <tr className="border-b border-border/70 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <th className="py-3 px-3">Request ID</th>
                    <th className="py-3 px-3">Product</th>
                    <th className="py-3 px-3">Quantity</th>
                    <th className="py-3 px-3">Required Date</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="min-w-[240px] py-3 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {pagedRequests.map((r) => (
                    <tr
                      key={r.id}
                      className="group hover:bg-muted/40 transition-colors cursor-pointer"
                      onClick={() => void handleViewRequest(r)}
                    >
                      {/* Request Number */}
                      <td className="py-3.5 px-3">
                        <div className="whitespace-nowrap font-bold text-foreground text-xs font-mono group-hover:text-primary transition-colors">
                          {r.request_number}
                        </div>
                        <div className="whitespace-nowrap text-[10px] text-muted-foreground mt-0.5">
                          {formatDate(r.created_at)}
                        </div>
                      </td>

                      {/* Product to Manufacture */}
                      <td className="py-3.5 px-3">
                        <div className="font-semibold text-foreground text-xs">
                          {r.product_name}
                        </div>
                        {r.product_code && (
                          <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
                            <span className="font-mono text-[10px]">{r.product_code}</span>
                          </div>
                        )}
                      </td>

                      {/* Production Qty */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <span className="font-bold text-foreground text-xs tabular-nums">
                          {r.target_quantity}
                        </span>{" "}
                        <span className="text-[11px] text-muted-foreground font-medium">
                          {r.uom || "PCS"}
                        </span>
                      </td>

                      {/* Required Date */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 text-xs text-foreground font-medium">
                          <Calendar className="size-3 text-muted-foreground" />
                          {formatDate(r.required_date)}
                        </div>
                      </td>

                      {/* Warehouse Status */}
                      <td className="py-3.5 px-3 whitespace-nowrap">{getStatusBadge(r.status)}</td>

                      {/* Action Buttons */}
                      <td className="py-3.5 px-3 text-right whitespace-nowrap">
                        <div
                          className="flex items-center justify-end gap-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {r.status === "ISSUED" && (
                            <Button
                              size="sm"
                              className="h-7 px-3 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 rounded-lg shadow-sm"
                              onClick={() => handleOpenReceiptModal(r)}
                            >
                              <CheckCircle2 className="size-3.5" />
                              Confirm Receipt
                            </Button>
                          )}
                          {r.status === "RECEIVED" && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                              <CheckCircle2 className="size-3" />
                              Receipt Confirmed
                            </span>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs font-medium text-muted-foreground hover:text-foreground gap-1 rounded-lg"
                            onClick={() => void handleViewRequest(r)}
                          >
                            <Eye className="size-3.5" />
                            Details
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!loading && filteredRequests.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-sm">
            <p className="text-muted-foreground">Showing {requestStart + 1} to {Math.min(requestStart + 10, filteredRequests.length)} of {filteredRequests.length} requests</p>
            <nav aria-label="Material requests pagination" className="flex items-center gap-3">
              <Button size="sm" variant="outline" disabled={currentRequestPage === 1} onClick={() => setRequestPage(currentRequestPage - 1)}>Previous</Button>
              <span>{currentRequestPage} / {requestPageCount}</span>
              <Button size="sm" variant="outline" disabled={currentRequestPage === requestPageCount} onClick={() => setRequestPage(currentRequestPage + 1)}>Next</Button>
            </nav>
          </div>}
        </div>

        {/* ========================================================================= */}
        {/* CREATE MATERIAL REQUEST MODAL */}
        {/* ========================================================================= */}
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-3xl max-h-[calc(100dvh-1rem)] overflow-y-auto overflow-x-hidden p-4 sm:p-5 rounded-2xl">
            <DialogHeader className="border-b border-border/60 pb-3 pr-6 text-left">
              <DialogTitle className="text-lg font-bold text-foreground flex items-center gap-2">
                <Boxes className="size-5 text-primary" />
                Request Raw Materials from Warehouse
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Select a product and production target. Required components are automatically
                computed from the Product BOM and submitted to Warehouse staging.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleCreateRequest} className="min-w-0 space-y-3 pt-1">
              {/* Product Selection */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground flex items-center gap-1">
                    Product to Manufacture <span className="text-destructive">*</span>
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    className="min-w-0 flex-1 h-11 rounded-xl border border-input bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    value={formData.product_code}
                    onChange={(e) => setFormData({ ...formData, product_code: e.target.value })}
                    required
                  >
                    <option value="" disabled>
                      Select a manufacturable product...
                    </option>
                    {products.length === 0 ? (
                      <option value="" disabled>
                        No active BOM-backed products available
                      </option>
                    ) : (
                      products.map((p) => (
                        <option key={p.id} value={p.product_code}>
                          {p.product_name} ({p.product_code})
                        </option>
                      ))
                    )}
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={openAddProductModal}
                    className="h-11 px-3 rounded-xl text-sm gap-1 font-semibold border-primary/30 text-primary hover:bg-primary/10 shrink-0"
                    title="Add new manufacturable product & BOM"
                  >
                    <Plus className="size-3.5" />
                    Add
                  </Button>
                </div>
                {products.length === 0 && (
                  <p className="text-[11px] text-amber-600">
                    No eligible products are configured. Add a product with an active BOM before
                    creating a warehouse request.
                  </p>
                )}
              </div>

              {/* Quantity & Required Date */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label htmlFor="production-target-quantity" className="text-xs font-semibold text-foreground">
                    Production Quantity (finished products) *
                  </label>
                  <div className="relative">
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      id="production-target-quantity"
                      aria-describedby="production-target-help"
                      value={formData.target_quantity}
                      onChange={(e) =>
                        setFormData({ ...formData, target_quantity: e.target.value === "" ? "" : Number(e.target.value) })
                      }
                      required
                      placeholder="Enter quantity"
                      className="h-11 pr-12 text-sm rounded-xl"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground pointer-events-none">
                      PCS
                    </span>
                  </div>
                  <p id="production-target-help" className="text-[11px] leading-5 text-muted-foreground">Number of finished products to make. Required material = this quantity multiplied by material quantity per product in the BOM.</p>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="required-completion-date"
                    className="text-xs font-semibold text-foreground"
                  >
                    Required Completion Date *
                  </label>
                  <Input
                    id="required-completion-date"
                    type="date"
                    min={localDateInput()}
                    value={formData.required_date}
                    onChange={(e) => {
                      setFormData({ ...formData, required_date: e.target.value });
                      setRequiredDateError(completionDateError(e.target.value));
                    }}
                    onBlur={(e) => setRequiredDateError(completionDateError(e.target.value))}
                    onInvalid={(e) => {
                      e.preventDefault();
                      setRequiredDateError(
                        e.currentTarget.validity.badInput
                          ? "Enter a valid completion date."
                          : completionDateError(e.currentTarget.value),
                      );
                      e.currentTarget.focus();
                    }}
                    aria-invalid={!!requiredDateError}
                    aria-describedby={
                      requiredDateError ? "required-completion-date-error" : undefined
                    }
                    required
                    className="h-11 text-sm rounded-xl"
                  />
                  {requiredDateError && (
                    <p
                      id="required-completion-date-error"
                      role="alert"
                      className="text-xs text-destructive"
                    >
                      {requiredDateError}
                    </p>
                  )}
                </div>
              </div>

              {/* Live BOM Material Preview */}
              {loadingBOM ? (
                <div className="rounded-xl border border-border/80 bg-muted/20 p-3.5 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                  <RefreshCw className="size-3.5 animate-spin text-primary" />
                  <span>Calculating material requirements from Product BOM...</span>
                </div>
              ) : bomPreviewError ? (
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3.5 text-xs text-destructive">
                  {bomPreviewError}
                </div>
              ) : bomPreview ? (
                <div className="rounded-xl border border-border bg-card p-3.5 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 font-semibold text-foreground">
                      <Layers className="size-3.5 text-primary" />
                      <span>BOM Material Preview ({bomPreview.materials?.length || 0} {bomPreview.materials?.length === 1 ? "Item" : "Items"})</span>
                      <Button type="button" size="sm" variant="outline" className="ml-2 h-7 gap-1 text-xs" disabled={savingBomMaterial} onClick={() => { setEditingBomMaterial(false); setBomMaterialDraft({ material_code: "", quantity_per_unit: "1" }); setShowBomMaterial(true); setBomMaterialError(""); }}><Plus className="size-3.5" />Add Material</Button>
                    </div>
                    <span className="text-[11px] text-muted-foreground font-mono">
                      BOM: {bomPreview.bom_number}
                    </span>
                  </div>

                  {showBomMaterial && <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-3">
                    <p className="text-xs text-muted-foreground">Add an available component to this product's saved BOM. Its total requirement is calculated using the production quantity.</p>
                    <div className="grid gap-3 sm:grid-cols-[1fr_160px_72px]">
                      <div className="space-y-1.5"><label htmlFor="bom-add-material" className="text-xs font-semibold">Raw Material</label><select id="bom-add-material" disabled={savingBomMaterial || editingBomMaterial} className="h-9 w-full rounded-xl border bg-card px-3 text-sm" value={bomMaterialDraft.material_code} onChange={e => setBomMaterialDraft({ ...bomMaterialDraft, material_code: e.target.value })}>
                        <option value="">Select material...</option>{rawMaterials.filter(material => editingBomMaterial || !bomPreview.materials?.some(item => item.material_code === material.code)).map(material => <option key={material.id || material.code} value={material.code}>{material.name} ({material.code})</option>)}
                      </select></div>
                      <div className="space-y-1.5"><label htmlFor="bom-add-quantity" className="text-xs font-semibold">Qty per Product</label><Input id="bom-add-quantity" disabled={savingBomMaterial} type="number" min="0.0001" step="0.0001" value={bomMaterialDraft.quantity_per_unit} onChange={e => setBomMaterialDraft({ ...bomMaterialDraft, quantity_per_unit: e.target.value })} className="h-9" /></div>
                      <div className="space-y-1.5"><label className="text-xs font-semibold">UOM</label><div className="flex h-9 items-center rounded-xl border px-3 text-xs">{rawMaterials.find(material => material.code === bomMaterialDraft.material_code)?.uom || "-"}</div></div>
                    </div>
                    {bomMaterialError && <p role="alert" className="text-xs text-destructive">{bomMaterialError}</p>}
                    <div className="flex justify-end gap-2"><Button type="button" size="sm" variant="outline" disabled={savingBomMaterial} onClick={() => setShowBomMaterial(false)}>Cancel Material</Button><Button type="button" size="sm" disabled={savingBomMaterial} onClick={() => void addBomMaterial()}>{savingBomMaterial ? "Saving..." : "Save Material"}</Button></div>
                  </div>}
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-border/60 text-[11px]">
                    <table className="w-full text-left">
                      <thead className="bg-muted/60 text-[10px] uppercase text-muted-foreground border-b border-border/60 sticky top-0">
                        <tr>
                          <th className="p-2 pl-3">Raw Material</th>
                          <th className="p-2 text-right">Qty per Product</th>
                          <th className="p-2 text-right font-semibold">Total Required Qty</th>
                          <th className="p-2 text-right font-semibold">Available in WH</th>
                          <th className="p-2 text-right pr-3">UOM</th><th className="p-2 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/30">
                        {bomPreview.materials?.map((item, idx) => {
                          return (
                            <tr
                              key={item.material_code || `${item.material_name}-${idx}`}
                              className="hover:bg-muted/20"
                            >
                              <td className="p-2 pl-3 font-medium text-foreground truncate max-w-[160px]">
                                {item.material_code}
                                <span className="block text-[10px] text-muted-foreground truncate font-normal">
                                  {item.material_name}
                                </span>
                              </td>
                              <td className="p-2 text-right">{item.quantity_per_unit}</td>
                              <td className="p-2 text-right font-bold text-foreground">
                                {Number(formData.target_quantity) > 0 ? item.required_quantity : "Enter quantity"}
                              </td>
                              <td className={`p-2 text-right font-bold ${Number(item.available_quantity ?? 0) >= Number(item.required_quantity) ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                                {item.available_quantity ?? 0}
                              </td>
                              <td className="p-2 text-right pr-3 font-medium">{item.uom}</td>
                              <td className="p-2 text-right"><Button type="button" variant="outline" size="sm" disabled={savingBomMaterial} onClick={() => {
                                setEditingBomMaterial(true); setBomMaterialDraft({ material_code: item.material_code, quantity_per_unit: String(item.quantity_per_unit) });
                                setBomMaterialError(""); setShowBomMaterial(true);
                              }}>Edit</Button></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {bomPreview.materials && bomPreview.materials.length > availableBomMaterials.length && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400">
                      Note: {bomPreview.materials.length - availableBomMaterials.length} unavailable component(s) excluded. Only materials available in warehouse stock are shown to assembly.
                    </p>
                  )}
                  {insufficientBomMaterials.length > 0 && (
                    <p role="alert" className="text-xs font-medium text-rose-600 dark:text-rose-400">
                      Not enough warehouse stock for {insufficientBomMaterials.map(item => item.material_code).join(", ")}. Reduce the production quantity or wait for stock before submitting.
                    </p>
                  )}
                </div>
              ) : null}

              {/* Remarks */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">Remarks (Optional)</label>
                <Textarea
                  placeholder="Special instructions or batch notes for Warehouse..."
                  value={formData.remarks}
                  onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                  rows={2}
                  className="text-xs resize-none rounded-xl"
                />
              </div>

              <DialogFooter className="flex-col gap-3 border-t pt-4 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsCreateOpen(false)}
                  disabled={creating}
                  className="rounded-xl"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={creating || showBomMaterial || savingBomMaterial || loadingBOM || !bomPreview || !bomPreview.materials?.length || bomPreview.product_code !== formData.product_code || Number(bomPreview.target_quantity) !== Number(formData.target_quantity)}
                  className="h-11 w-full min-w-0 rounded-xl gap-2 px-4 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold shadow-soft sm:w-auto"
                >
                  {creating && <RefreshCw className="size-3.5 animate-spin" />}
                  Submit Request to Warehouse
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* ========================================================================= */}
        {/* ADD MANUFACTURABLE PRODUCT & BOM MODAL */}
        {/* ========================================================================= */}
        <Dialog open={isAddProductOpen} onOpenChange={setIsAddProductOpen}>
          <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-2xl max-h-[90dvh] overflow-y-auto overflow-x-hidden p-6 rounded-2xl">
            <DialogHeader className="border-b border-border/60 pb-4 pr-6 text-left">
              <DialogTitle className="text-lg font-bold text-foreground flex items-center gap-2">
                <PlusCircle className="size-5 text-primary" />
                Add Manufacturable Product & BOM
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-1">
                Register a new finished good item and define its Bill of Materials components for
                assembly.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleCreateProduct} className="min-w-0 space-y-5 pt-2">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">Product Name *</label>
                  <Input
                    type="text"
                    placeholder="e.g. Smart Sensor Hub"
                    value={newProductData.product_name}
                    onChange={(e) => handleProductNameChange(e.target.value)}
                    required
                    className="h-11 text-sm rounded-xl"
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex min-h-6 flex-wrap items-center justify-between gap-2">
                    <label className="text-xs font-semibold text-foreground flex items-center gap-1">
                      Product code <span className="text-destructive">*</span>
                    </label>

                  </div>
                  <div className="relative flex items-center">
                    <Input
                      type="text"
                      placeholder="e.g. FG-SSH-001"
                      value={newProductData.product_code}
                      onChange={(e) => {
                        setSkuManuallyEdited(true);
                        setNewProductData({
                          ...newProductData,
                          product_code: e.target.value.toUpperCase(),
                        });
                      }}
                      required
                      className="h-11 pr-9 text-sm font-mono font-semibold rounded-xl uppercase tracking-wider bg-muted/30 focus:bg-background"
                    />

                  </div>
                </div>
              </div>

              <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
                <div className="flex min-h-6 flex-wrap items-center justify-between gap-2">
                  <label className="text-xs font-semibold text-foreground">
                    Bill of Materials Components *
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 rounded-lg text-[11px]"
                    onClick={() =>
                      setNewProductData((prev) => ({
                        ...prev,
                        components: [
                          ...prev.components,
                          { material_code: "", material_name: "", quantity_per_unit: 1, uom: "" },
                        ],
                      }))
                    }
                  >
                    <Plus className="mr-1 size-3" /> Add Component
                  </Button>
                </div>
                <div className="hidden sm:grid sm:grid-cols-[minmax(0,1fr)_120px_80px_36px] gap-3 text-xs font-semibold uppercase text-muted-foreground">
                  <span>Raw Material</span>
                  <span>Qty per Product</span>
                  <span>UOM</span>
                  <span />
                </div>
                {newProductData.components.map((component, index) => (
                  <div
                    key={`bom-component-${index}`}
                    className="grid grid-cols-[minmax(0,1fr)_80px_36px] sm:grid-cols-[minmax(0,1fr)_120px_80px_36px] items-center gap-3"
                  >
                    <select
                      aria-label={`Raw material ${index + 1}`}
                      className="col-span-3 sm:col-span-1 h-11 min-w-0 rounded-lg border border-input bg-card px-3 text-sm"
                      value={component.material_code}
                      required
                      onChange={(e) => {
                        const material = rawMaterials.find(
                          (item) => String(item.code) === e.target.value,
                        );
                        setNewProductData((prev) => ({
                          ...prev,
                          components: prev.components.map((row, rowIndex) =>
                            rowIndex === index
                              ? {
                                  ...row,
                                  material_code: material?.code || "",
                                  material_name: material?.name || "",
                                  uom: material?.uom || "",
                                }
                              : row,
                          ),
                        }));
                      }}
                    >
                      <option value="">{loadingRawMaterials ? "Checking warehouse availability..." : rawMaterials.length ? "Select available material..." : "No available materials"}</option>
                      {rawMaterials.filter((material) => Number(material.available_quantity) > 0).map((material) => (
                        <option key={material.id || material.code} value={material.code}>
                          {material.name} ({material.code}) · Avail: {material.available_quantity ?? 0} {material.uom}
                        </option>
                      ))}
                    </select>
                    <Input
                      type="number"
                      aria-label={`Quantity per product ${index + 1}`}
                      min="0.0001"
                      step="any"
                      value={component.quantity_per_unit}
                      required
                      className="h-11 min-w-0 rounded-lg text-sm"
                      onChange={(e) =>
                        setNewProductData((prev) => ({
                          ...prev,
                          components: prev.components.map((row, rowIndex) =>
                            rowIndex === index
                              ? { ...row, quantity_per_unit: Number(e.target.value) }
                              : row,
                          ),
                        }))
                      }
                    />
                    <Input
                      value={component.uom}
                      readOnly
                      placeholder="UOM"
                      className="h-11 min-w-0 rounded-lg bg-muted/40 text-sm"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove component ${index + 1}`}
                      className="h-11 px-1 text-destructive"
                      disabled={newProductData.components.length === 1}
                      onClick={() =>
                        setNewProductData((prev) => ({
                          ...prev,
                          components: prev.components.filter((_, rowIndex) => rowIndex !== index),
                        }))
                      }
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>
                ))}
                {!rawMaterials.length && (
                  <p className="text-[11px] text-amber-600">
                    No raw materials currently available in warehouse stock. Please replenish inventory before defining BOM components.
                  </p>
                )}
                {insufficientNewProductComponents.length > 0 && (
                  <p role="alert" className="text-xs font-medium text-rose-600 dark:text-rose-400">
                    Component quantity exceeds warehouse stock: {insufficientNewProductComponents.map(item => `${item.code} (${item.required} ${item.uom} required, ${item.available} available)`).join("; ")}. Reduce the quantity to continue.
                  </p>
                )}
              </div>

              <DialogFooter className="gap-3 border-t pt-4">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-xl"
                  onClick={() => setIsAddProductOpen(false)}
                  disabled={addingProduct}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={
                    addingProduct ||
                    insufficientNewProductComponents.length > 0 ||
                    !newProductData.product_name.trim() ||
                    !newProductData.components.length ||
                    newProductData.components.some(
                      (component) =>
                        !component.material_code ||
                        !component.material_name ||
                        !component.uom ||
                        !Number.isFinite(component.quantity_per_unit) ||
                        component.quantity_per_unit <= 0,
                    )
                  }
                  className="rounded-xl gap-2 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold shadow-soft"
                >
                  {addingProduct && <RefreshCw className="size-3.5 animate-spin" />}
                  Create Product & BOM
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* ========================================================================= */}
        {/* VIEW MATERIAL REQUEST DETAILS MODAL */}
        {/* ========================================================================= */}
        {selectedRequest && (
          <Dialog
            open={Boolean(selectedRequest)}
            onOpenChange={(open) => !open && setSelectedRequest(null)}
          >
            <DialogContent className="w-[calc(100vw-2rem)] max-w-4xl max-h-[85vh] overflow-y-auto p-4 sm:p-6 rounded-2xl">
              <DialogHeader className="border-b border-border/60 pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <DialogTitle className="text-lg font-bold text-foreground font-mono">
                        {selectedRequest.request_number}
                      </DialogTitle>
                      {getStatusBadge(selectedRequest.status)}
                    </div>
                    <DialogDescription className="text-xs text-muted-foreground mt-1">
                      Production Order: {selectedRequest.order_number || "—"} · Product:{" "}
                      {selectedRequest.product_name}
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              <div className="space-y-4 pt-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 rounded-xl bg-muted/30 border border-border text-xs">
                  <div>
                    <span className="text-muted-foreground">Product to Manufacture</span>
                    <p className="font-semibold text-foreground mt-0.5">
                      {selectedRequest.product_name}
                    </p>
                    <p className="text-[10px] text-muted-foreground font-mono">
                      {selectedRequest.product_code}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Production Target</span>
                    <p className="font-semibold text-foreground mt-0.5">
                      {selectedRequest.target_quantity} {selectedRequest.uom}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Required Date</span>
                    <p className="font-semibold text-foreground mt-0.5">
                      {formatDate(selectedRequest.required_date)}
                    </p>
                  </div>
                </div>

                {selectedRequest.material_issue && (
                  <div className="p-3.5 rounded-xl border border-blue-500/30 bg-blue-500/5 text-xs space-y-1">
                    <div className="flex items-center justify-between font-semibold text-blue-700 dark:text-blue-300">
                      <span className="flex items-center gap-1.5">
                        <Warehouse className="size-4" />
                        Warehouse Issue: {selectedRequest.material_issue.issue_number}
                      </span>
                      <span>{formatDate(selectedRequest.material_issue.issued_at)}</span>
                    </div>
                    <p className="text-muted-foreground text-[11px]">
                      Issued by:{" "}
                      <strong className="text-foreground">
                        {selectedRequest.material_issue.issued_by}
                      </strong>{" "}
                      · Destination: Assembly Staging
                    </p>
                  </div>
                )}

                {selectedRequest.material_received_at && (
                  <div className="p-3.5 rounded-xl border border-emerald-500/30 bg-emerald-500/5 text-xs space-y-1">
                    <div className="flex items-center justify-between font-semibold text-emerald-700 dark:text-emerald-300">
                      <span className="flex items-center gap-1.5">
                        <CheckCircle2 className="size-4" />
                        Materials Confirmed Received in Assembly
                      </span>
                      <span>{formatDate(selectedRequest.material_received_at)}</span>
                    </div>
                    <p className="text-muted-foreground text-[11px]">
                      Received by:{" "}
                      <strong className="text-foreground">
                        {selectedRequest.material_received_by || "Assembly Operator"}
                      </strong>
                    </p>
                  </div>
                )}

                {selectedRequest.remarks && (
                  <div className="p-3 rounded-xl border border-border bg-card text-xs">
                    <span className="text-muted-foreground block mb-1 font-medium">
                      Remarks / Instructions
                    </span>
                    <p className="text-foreground">{selectedRequest.remarks}</p>
                  </div>
                )}

                <div>
                  <h4 className="text-xs font-semibold text-foreground mb-2 flex items-center justify-between">
                    <span>Required BOM Items ({selectedRequest.items?.length || 0})</span>
                    <span className="text-[11px] text-muted-foreground font-normal">
                      Requisition Details
                    </span>
                  </h4>

                  <div className="overflow-x-auto rounded-xl border border-border bg-card">
                    <table className="w-full text-left text-xs">
                      <caption className="sr-only">
                        Material quantities for {selectedRequest.request_number}
                      </caption>
                      <thead>
                        <tr className="border-b border-border bg-muted/40 text-[11px] font-semibold text-muted-foreground">
                          <th className="py-2.5 px-3">Material Code</th>
                          <th className="py-2.5 px-3">Material Name</th>
                          <th className="py-2.5 px-3 text-right">Required</th>
                          <th className="py-2.5 px-3 text-right">Issued</th>
                          <th className="py-2.5 px-3 text-right">Received</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/40">
                        {selectedRequest.items?.map((item, idx) => (
                          <tr key={idx}>
                            <td className="py-2.5 px-3 font-mono font-medium text-foreground">
                              {item.material_code}
                            </td>
                            <td className="py-2.5 px-3 text-foreground font-medium">
                              {item.material_name}
                            </td>
                            <td className="py-2.5 px-3 text-right font-bold text-foreground">
                              {Number(item.quantity).toLocaleString()} {item.uom}
                            </td>
                            <td className="py-2.5 px-3 text-right whitespace-nowrap tabular-nums">
                              {issuedQuantity(selectedRequest, item) == null
                                ? "Unavailable"
                                : `${Number(issuedQuantity(selectedRequest, item)).toLocaleString()} ${item.uom}`}
                            </td>
                            <td className="py-2.5 px-3 text-right whitespace-nowrap tabular-nums">
                              {item.received_quantity == null
                                ? "Unavailable"
                                : `${Number(item.received_quantity).toLocaleString()} ${item.uom}`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <DialogFooter className="border-t border-border/60 pt-3 mt-4">
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-xl"
                  onClick={() => setSelectedRequest(null)}
                >
                  Close
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {/* ========================================================================= */}
        {/* CONFIRM MATERIAL RECEIPT MODAL */}
        {/* ========================================================================= */}
        <Dialog open={isReceiptOpen} onOpenChange={setIsReceiptOpen}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto p-6 rounded-2xl">
            <DialogHeader className="border-b border-border/60 pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <DialogTitle className="text-lg font-bold text-foreground flex items-center gap-2">
                    <CheckCircle2 className="size-5 text-emerald-600" />
                    Confirm Material Receipt
                  </DialogTitle>
                  <DialogDescription className="text-xs text-muted-foreground mt-1">
                    Verify physical items issued by Warehouse and confirm arrival into Assembly
                    staging.
                  </DialogDescription>
                </div>
                {receiptRequest && (
                  <Badge className="bg-blue-500/15 text-blue-700 border-blue-500/30 dark:text-blue-300 font-mono">
                    {receiptRequest.order_number}
                  </Badge>
                )}
              </div>
            </DialogHeader>

            {receiptRequest && (
              <div className="space-y-4 pt-3">
                {/* Reference card */}
                <div className="grid grid-cols-3 gap-3 p-3.5 rounded-xl bg-muted/40 border border-border text-xs">
                  <div>
                    <span className="text-muted-foreground">Product to Manufacture</span>
                    <p className="font-semibold text-foreground mt-0.5">
                      {receiptRequest.product_name}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Production Target</span>
                    <p className="font-semibold text-foreground mt-0.5">
                      {receiptRequest.target_quantity} {receiptRequest.uom}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Warehouse Issue Ref</span>
                    <p className="font-semibold text-foreground mt-0.5 font-mono">
                      {receiptRequest.material_issue?.issue_number || "ISSUE CONFIRMED"}
                    </p>
                  </div>
                </div>

                {/* Items receipt table */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-semibold text-foreground">
                      Issued Components ({receiptItems.length})
                    </h4>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[11px] font-semibold text-primary hover:text-primary gap-1"
                      onClick={() => {
                        setReceiptItems((prev) =>
                          prev.map((it) => ({ ...it, received_quantity: it.issued_quantity })),
                        );
                        toast.info("All received quantities matched to issued counts.");
                      }}
                    >
                      <Check className="size-3" />
                      Set All to Issued Qty
                    </Button>
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-border bg-card">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-border bg-muted/40 text-[11px] font-semibold text-muted-foreground">
                          <th className="py-2.5 px-3">Material Code</th>
                          <th className="py-2.5 px-3">Component Description</th>
                          <th className="py-2.5 px-3 text-right">Issued Qty</th>
                          <th className="py-2.5 px-3 text-right w-32">Received Qty</th>
                          <th className="py-2.5 px-3 text-center">UOM</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/40">
                        {receiptItems.map((item, idx) => (
                          <tr key={idx}>
                            <td className="py-2.5 px-3 font-mono font-medium text-foreground">
                              {item.material_code}
                            </td>
                            <td className="py-2.5 px-3 text-foreground font-medium">
                              {item.material_name}
                            </td>
                            <td className="py-2.5 px-3 text-right font-medium text-muted-foreground">
                              {item.issued_quantity}
                            </td>
                            <td className="py-1.5 px-3 text-right">
                              <Input
                                type="number"
                                min="0"
                                step="any"
                                value={item.received_quantity}
                                onChange={(e) => {
                                  const val = Number(e.target.value);
                                  const updated = [...receiptItems];
                                  updated[idx].received_quantity = val;
                                  setReceiptItems(updated);
                                }}
                                className="h-7 text-right font-bold text-foreground text-xs rounded-lg"
                              />
                            </td>
                            <td className="py-2.5 px-3 text-center text-muted-foreground">
                              {item.uom}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Remarks */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    Receipt Remarks / Verification Notes
                  </label>
                  <Textarea
                    placeholder="Physical verification notes (e.g. all components verified sealed and in good condition)..."
                    value={receiptRemarks}
                    onChange={(e) => setReceiptRemarks(e.target.value)}
                    rows={2}
                    className="text-xs resize-none rounded-xl"
                  />
                </div>

                <DialogFooter className="border-t border-border/60 pt-3 mt-4">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-xl"
                    onClick={() => setIsReceiptOpen(false)}
                    disabled={confirmingReceipt}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold gap-1.5 shadow-sm"
                    onClick={handleConfirmReceipt}
                    disabled={confirmingReceipt}
                  >
                    {confirmingReceipt ? (
                      <RefreshCw className="size-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="size-3.5" />
                    )}
                    Confirm Physical Receipt
                  </Button>
                </DialogFooter>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
