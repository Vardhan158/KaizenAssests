import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/wms/app-shell";
import { requireRole } from "@/lib/auth-utils";
import {
  api,
  type AssemblyMaterialRequest,
  type AssemblyMaterialRequestItem,
  type AssemblyProductOption,
  type AssemblyProductBOMResponse,
} from "@/lib/api-client";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Eye,
  Factory,
  Layers,
  LayoutDashboard,
  Package,
  PackageCheck,
  Plus,
  PlusCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Warehouse,
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
import { cn, generateProductSKU } from "@/lib/utils";

export const Route = createFileRoute("/assembly/material-requests")({
  beforeLoad: () => requireRole(["ASSEMBLY_MANAGER", "ASSEMBLY", "ADMIN", "SUPERUSER"]),
  head: () => ({ meta: [{ title: "Material Requests · KaizenX" }] }),
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
  if (s === "RECEIVED" || s === "COMPLETED") {
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
  if (s === "PICKING" || s === "IN_PROGRESS" || s === "APPROVED") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-500/10 text-purple-700 dark:text-purple-300 border border-purple-500/25">
        <span className="size-1.5 rounded-full bg-purple-500 animate-pulse" />
        Warehouse Picking
      </span>
    );
  }
  if (s === "PENDING" || s === "SUBMITTED") {
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

function AssemblyMaterialRequestsPage() {
  const navigate = useNavigate();
  const [requests, setRequests] = useState<AssemblyMaterialRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  // Create Modal State
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [products, setProducts] = useState<AssemblyProductOption[]>([]);
  const [creating, setCreating] = useState(false);
  const [formData, setFormData] = useState({
    product_code: "",
    target_quantity: 10,
    required_date: new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0],
    remarks: "",
  });

  // Quick Add Product State
  const [isAddProductOpen, setIsAddProductOpen] = useState(false);
  const [addingProduct, setAddingProduct] = useState(false);
  const [skuManuallyEdited, setSkuManuallyEdited] = useState(false);
  const [newProductData, setNewProductData] = useState({
    product_name: "",
    product_code: "",
    description: "",
    components: [
      { material_code: "", material_name: "", quantity_per_unit: 1, uom: "PCS" },
    ],
  });

  const openAddProductModal = () => {
    const existingCodes = products.map((p) => p.product_code);
    const initialSku = generateProductSKU("", existingCodes);
    setSkuManuallyEdited(false);
    setNewProductData({
      product_name: "",
      product_code: initialSku,
      description: "",
      components: [
        { material_code: "", material_name: "", quantity_per_unit: 1, uom: "PCS" },
      ],
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

  // Detail Modal State
  const [selectedRequest, setSelectedRequest] = useState<AssemblyMaterialRequest | null>(null);

  // Warehouse Issue & Receipt State
  const [issuingWarehouse, setIssuingWarehouse] = useState<string | null>(null);
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

  const loadRequests = async (isManual = false) => {
    if (isManual) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await api.getAssemblyMaterialRequests({
        search: searchTerm,
        status: statusFilter,
      });
      setRequests(res);
    } catch (err: any) {
      toast.error(err?.message || "Failed to load material requests.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleWarehouseIssue = async (req: AssemblyMaterialRequest) => {
    try {
      setIssuingWarehouse(req.id);
      const res = await api.warehouseIssueMaterials(req.id);
      toast.success(`Warehouse issued materials under ${res.issue_number}!`);
      await loadRequests();
    } catch (err: any) {
      toast.error(err?.message || "Failed to issue materials from warehouse.");
    } finally {
      setIssuingWarehouse(null);
    }
  };

  const handleOpenReceiptModal = async (req: AssemblyMaterialRequest) => {
    try {
      const detail = await api.getAssemblyMaterialRequestDetail(req.id);
      setReceiptRequest(detail);
      const items = (detail.items || []).map((it) => ({
        material_code: it.material_code,
        material_name: it.material_name || it.material_code,
        issued_quantity: it.issued_quantity ?? it.quantity ?? 0,
        received_quantity: it.received_quantity ?? it.issued_quantity ?? it.quantity ?? 0,
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
      await api.confirmAssemblyMaterialReceipt(receiptRequest.id, {
        received_items: receiptItems.map((i) => ({
          material_code: i.material_code,
          received_quantity: Number(i.received_quantity),
        })),
        remarks: receiptRemarks,
      });
      toast.success(
        `Materials confirmed received for Order ${receiptRequest.order_number}! Order is now ready for production.`
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
      const [productRows, materialRows] = await Promise.all([
        api.getAssemblyProducts(),
        api.getMaterialComponents(),
      ]);
      const existingCodes = new Set(productRows.map((p) => p.product_code.toUpperCase()));
      const materialOptions: AssemblyProductOption[] = materialRows
        .filter((m: any) => m.code && m.name && !existingCodes.has(String(m.code).toUpperCase()))
        .map((m: any) => ({
          id: `material-${m.code}`,
          product_code: m.code,
          product_name: m.name,
          bom_number: "",
          description: m.category || "Material",
          uom: m.uom || "PCS",
        }));
      const allOptions = [...productRows, ...materialOptions];
      setProducts(allOptions);
      if (allOptions.length > 0 && !formData.product_code) {
        setFormData((prev) => ({ ...prev, product_code: allOptions[0]?.product_code || "" }));
      }
    } catch (err: any) {
      console.error("Failed to load products master:", err);
    }
  };

  useEffect(() => {
    loadRequests();
    loadProducts();
  }, []);

  useEffect(() => {
    loadRequests();
  }, [statusFilter]);

  // Load BOM preview whenever product or quantity changes in create modal
  useEffect(() => {
    if (isCreateOpen && formData.product_code && formData.target_quantity > 0) {
      loadBOMPreview(formData.product_code, formData.target_quantity);
    }
  }, [isCreateOpen, formData.product_code, formData.target_quantity]);

  const loadBOMPreview = async (productCode: string, qty: number) => {
    try {
      setLoadingBOM(true);
      const res = await api.getProductBOM(productCode, qty);
      setBomPreview(res);
    } catch (err: any) {
      setBomPreview(null);
    } finally {
      setLoadingBOM(false);
    }
  };

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProductData.product_name.trim()) {
      toast.error("Product name is required.");
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
        components: newProductData.components.filter((c) => c.material_code && c.material_name),
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
        components: [
          { material_code: "", material_name: "", quantity_per_unit: 1, uom: "PCS" },
        ],
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
    if (formData.target_quantity <= 0) {
      toast.error("Production quantity must be greater than 0.");
      return;
    }
    if (!formData.required_date) {
      toast.error("Please specify a required completion date.");
      return;
    }

    try {
      setCreating(true);
      const newReq = await api.createAssemblyMaterialRequest({
        product_code: formData.product_code,
        target_quantity: Number(formData.target_quantity),
        required_date: formData.required_date,
        remarks: formData.remarks,
      });

      toast.success(
        `Material Request ${newReq.request_number} sent to Warehouse for ${newReq.product_name} (${newReq.target_quantity} ${newReq.uom}).`
      );
      setIsCreateOpen(false);
      setFormData({
        product_code: products[0]?.product_code || "",
        target_quantity: 10,
        required_date: new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0],
        remarks: "",
      });
      loadRequests();
    } catch (err: any) {
      toast.error(err?.message || "Failed to submit material request.");
    } finally {
      setCreating(false);
    }
  };

  // KPI Calculations
  const kpiStats = useMemo(() => {
    const total = requests.length;
    const awaitingWH = requests.filter((r) => r.status === "PENDING" || r.status === "SUBMITTED").length;
    const inPicking = requests.filter(
      (r) => r.status === "PICKING" || r.status === "IN_PROGRESS" || r.status === "APPROVED"
    ).length;
    const issued = requests.filter((r) => r.status === "ISSUED").length;
    const received = requests.filter((r) => r.status === "RECEIVED" || r.status === "COMPLETED").length;
    return { total, awaitingWH, inPicking, issued, received };
  }, [requests]);

  // Filtered requests for local search
  const filteredRequests = useMemo(() => {
    if (!searchTerm.trim()) return requests;
    const query = searchTerm.toLowerCase().trim();
    return requests.filter((r) => {
      const matchNum = r.request_number?.toLowerCase().includes(query);
      const matchOrder = r.order_number?.toLowerCase().includes(query);
      const matchProd = r.product_name?.toLowerCase().includes(query);
      const matchCode = r.product_code?.toLowerCase().includes(query);
      return matchNum || matchOrder || matchProd || matchCode;
    });
  }, [requests, searchTerm]);

  // Workflow navigation links
  const workflowShortcuts = [
    {
      title: "Assembly Dashboard",
      subtitle: "Floor monitoring & KPI metrics",
      icon: LayoutDashboard,
      to: "/assembly-dashboard",
      tone: "blue",
    },
    {
      title: "Work Orders",
      subtitle: "Active manufacturing run pipeline",
      icon: Layers,
      to: "/assembly/orders",
      tone: "amber",
    },
    {
      title: "Production Lines",
      subtitle: "Line build execution & stations",
      icon: Factory,
      to: "/assembly/production",
      tone: "cyan",
    },
    {
      title: "Quality Inspections",
      subtitle: "Pre-dispatch batch auditing",
      icon: ShieldCheck,
      to: "/assembly/quality",
      tone: "purple",
    },
  ];

  return (
    <AppShell
      title="Material Requests"
      subtitle="Raw material requisitions sent to Warehouse for production orders"
      actions={
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-card border border-border/80 shadow-2xs text-xs font-medium text-muted-foreground">
            <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
            WH Integration Live
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
            onClick={() => loadRequests(true)}
            disabled={refreshing}
            className="rounded-xl text-xs gap-1.5 shadow-2xs hover:bg-muted/80"
          >
            <RefreshCw className={cn("size-3.5", refreshing && "animate-spin text-primary")} />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => setIsCreateOpen(true)}
            className="rounded-xl text-xs gap-1.5 font-semibold shadow-soft bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <PlusCircle className="size-3.5" />
            New Material Request
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* 5 Top KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3.5">
          {/* Card 1: Total Requisitions */}
          <div className="group relative overflow-hidden rounded-2xl border border-blue-500/20 bg-gradient-to-br from-blue-500/10 via-card to-card p-4 shadow-2xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-soft hover:border-blue-500/35 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Total Requests
              </span>
              <div className="grid size-9 place-items-center rounded-xl bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/20 shadow-2xs">
                <Layers className="size-4" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-3xl font-black tracking-tight text-foreground tabular-nums">
                {loading ? "..." : kpiStats.total}
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>All requisitions</span>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-blue-500/10 text-blue-700 dark:text-blue-300">
                  Total
                </span>
              </div>
            </div>
          </div>

          {/* Card 2: Awaiting Warehouse */}
          <div className="group relative overflow-hidden rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/10 via-card to-card p-4 shadow-2xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-soft hover:border-amber-500/35 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Awaiting WH
              </span>
              <div className="grid size-9 place-items-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20 shadow-2xs">
                <Clock className="size-4" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-3xl font-black tracking-tight text-amber-600 dark:text-amber-400 tabular-nums">
                {loading ? "..." : kpiStats.awaitingWH}
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>Pending WH action</span>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-300">
                  Action
                </span>
              </div>
            </div>
          </div>

          {/* Card 3: In Picking */}
          <div className="group relative overflow-hidden rounded-2xl border border-purple-500/20 bg-gradient-to-br from-purple-500/10 via-card to-card p-4 shadow-2xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-soft hover:border-purple-500/35 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                In Picking
              </span>
              <div className="grid size-9 place-items-center rounded-xl bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/20 shadow-2xs">
                <Boxes className="size-4" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-3xl font-black tracking-tight text-foreground tabular-nums">
                {loading ? "..." : kpiStats.inPicking}
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>In warehouse queue</span>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-purple-500/10 text-purple-700 dark:text-purple-300">
                  Picking
                </span>
              </div>
            </div>
          </div>

          {/* Card 4: Issued by WH */}
          <div className="group relative overflow-hidden rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/10 via-card to-card p-4 shadow-2xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-soft hover:border-cyan-500/35 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Issued by WH
              </span>
              <div className="grid size-9 place-items-center rounded-xl bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20 shadow-2xs">
                <Warehouse className="size-4" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-3xl font-black tracking-tight text-cyan-600 dark:text-cyan-400 tabular-nums">
                {loading ? "..." : kpiStats.issued}
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>Awaiting floor receipt</span>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
                  Ready
                </span>
              </div>
            </div>
          </div>

          {/* Card 5: Received in Assembly */}
          <div className="group relative overflow-hidden rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 via-card to-card p-4 shadow-2xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-soft hover:border-emerald-500/35 flex flex-col justify-between col-span-2 md:col-span-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Received in Assembly
              </span>
              <div className="grid size-9 place-items-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shadow-2xs">
                <CheckCircle2 className="size-4" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-3xl font-black tracking-tight text-emerald-600 dark:text-emerald-400 tabular-nums">
                {loading ? "..." : kpiStats.received}
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>Allocated to lines</span>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                  Ready for Line
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
                      sc.tone === "purple" && "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/20"
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
                  placeholder="Search request #, order #, product..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && loadRequests()}
                  className="h-8 w-full rounded-lg border border-border bg-card pl-8 pr-7 text-xs outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary/40"
                />
                {searchTerm && (
                  <button
                    onClick={() => {
                      setSearchTerm("");
                      loadRequests();
                    }}
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
              <p className="text-xs text-muted-foreground">Loading Material Requests from database...</p>
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
                    onClick={() => setIsCreateOpen(true)}
                  >
                    <PlusCircle className="size-3.5" />
                    New Material Request
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto -mx-5 px-5">
              <table className="w-full text-left text-sm mt-1">
                <thead>
                  <tr className="border-b border-border/60 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    <th className="py-3 px-3">Request #</th>
                    <th className="py-3 px-3">Production Order</th>
                    <th className="py-3 px-3">Product to Manufacture</th>
                    <th className="py-3 px-3">Production Qty</th>
                    <th className="py-3 px-3 text-center">Components</th>
                    <th className="py-3 px-3">Required Date</th>
                    <th className="py-3 px-3">Warehouse Status</th>
                    <th className="py-3 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {filteredRequests.map((r) => (
                    <tr
                      key={r.id}
                      className="group hover:bg-muted/40 transition-colors cursor-pointer"
                      onClick={() => setSelectedRequest(r)}
                    >
                      {/* Request Number */}
                      <td className="py-3.5 px-3">
                        <div className="font-bold text-foreground text-xs font-mono group-hover:text-primary transition-colors">
                          {r.request_number}
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {r.created_at ? formatDate(r.created_at) : "Standard"}
                        </div>
                      </td>

                      {/* Production Order */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        {r.order_number ? (
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-xs font-semibold text-foreground px-2 py-0.5 rounded-md bg-muted border border-border/60">
                              {r.order_number}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground font-mono">—</span>
                        )}
                      </td>

                      {/* Product to Manufacture */}
                      <td className="py-3.5 px-3">
                        <div className="font-semibold text-foreground text-xs">{r.product_name}</div>
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

                      {/* Components */}
                      <td className="py-3.5 px-3 text-center whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-muted text-foreground border border-border/60">
                          <Boxes className="size-3 text-muted-foreground" />
                          {r.items_count} Items
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
                          {(r.status === "PENDING" || r.status === "SUBMITTED") && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={issuingWarehouse === r.id}
                              className="h-7 px-3 text-xs font-medium border-blue-500/40 text-blue-600 hover:bg-blue-500/10 dark:text-blue-400 gap-1.5 rounded-lg"
                              onClick={() => handleWarehouseIssue(r)}
                            >
                              {issuingWarehouse === r.id ? (
                                <RefreshCw className="size-3 animate-spin" />
                              ) : (
                                <Warehouse className="size-3" />
                              )}
                              Issue from WH
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
                            onClick={() => setSelectedRequest(r)}
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
        </div>

        {/* ========================================================================= */}
        {/* CREATE MATERIAL REQUEST MODAL */}
        {/* ========================================================================= */}
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogContent className="w-[calc(100vw-2rem)] max-w-3xl p-6 rounded-2xl">
            <DialogHeader className="border-b border-border/60 pb-3">
              <DialogTitle className="text-lg font-bold text-foreground flex items-center gap-2">
                <Boxes className="size-5 text-primary" />
                Request Raw Materials from Warehouse
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Select a product and production target. Required components are automatically computed from the Product BOM and submitted to Warehouse staging.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleCreateRequest} className="space-y-4 pt-3">
              {/* Product Selection */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground flex items-center gap-1">
                    Product to Manufacture <span className="text-destructive">*</span>
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    className="flex-1 h-9 rounded-xl border border-input bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    value={formData.product_code}
                    onChange={(e) => setFormData({ ...formData, product_code: e.target.value })}
                    required
                  >
                    <option value="" disabled>Select a manufacturable product...</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.product_code}>
                        {p.product_name} ({p.product_code})
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={openAddProductModal}
                    className="h-9 px-3 rounded-xl text-xs gap-1 font-semibold border-primary/30 text-primary hover:bg-primary/10 shrink-0"
                    title="Add new manufacturable product & BOM"
                  >
                    <Plus className="size-3.5" />
                    Add
                  </Button>
                </div>
              </div>

              {/* Quantity & Required Date */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">Production Quantity *</label>
                  <div className="relative">
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      value={formData.target_quantity}
                      onChange={(e) => setFormData({ ...formData, target_quantity: Number(e.target.value) })}
                      required
                      className="h-9 pr-12 text-sm rounded-xl"
                    />
                    <span className="absolute right-3 top-2 text-xs font-medium text-muted-foreground pointer-events-none">
                      PCS
                    </span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">Required Completion Date *</label>
                  <Input
                    type="date"
                    value={formData.required_date}
                    onChange={(e) => setFormData({ ...formData, required_date: e.target.value })}
                    required
                    className="h-9 text-sm rounded-xl"
                  />
                </div>
              </div>

              {/* Live BOM Requirements Calculation Preview */}
              {loadingBOM ? (
                <div className="rounded-xl border border-border/80 bg-muted/20 p-3.5 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                  <RefreshCw className="size-3.5 animate-spin text-primary" />
                  <span>Calculating material requirements from Product BOM...</span>
                </div>
              ) : bomPreview ? (
                <div className="rounded-xl border border-border bg-card p-3.5 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 font-semibold text-foreground">
                      <Layers className="size-3.5 text-primary" />
                      <span>Required Components ({bomPreview.materials?.length || 0} Items)</span>
                    </div>
                    <span className="text-[11px] text-muted-foreground font-mono">
                      BOM: {bomPreview.bom_number}
                    </span>
                  </div>

                  <div className="max-h-40 overflow-y-auto rounded-lg border border-border/60 text-[11px]">
                    <table className="w-full text-left">
                      <thead className="bg-muted/60 text-[10px] uppercase text-muted-foreground border-b border-border/60 sticky top-0">
                        <tr>
                          <th className="p-2 pl-3">Component</th>
                          <th className="p-2 text-right">Qty/Unit</th>
                          <th className="p-2 text-right font-semibold">Total Req</th>
                          <th className="p-2 text-right pr-3">WH Stock</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/30">
                        {bomPreview.materials?.map((item, idx) => {
                          const hasShortage = (item.available_quantity ?? 0) < (item.required_quantity ?? 0);
                          return (
                            <tr key={idx} className="hover:bg-muted/20">
                              <td className="p-2 pl-3 font-medium text-foreground truncate max-w-[160px]">
                                {item.material_code}
                                <span className="block text-[10px] text-muted-foreground truncate font-normal">
                                  {item.material_name}
                                </span>
                              </td>
                              <td className="p-2 text-right text-muted-foreground">
                                {item.quantity_per_unit} {item.uom}
                              </td>
                              <td className="p-2 text-right font-bold text-foreground">
                                {item.required_quantity} {item.uom}
                              </td>
                              <td
                                className={cn(
                                  "p-2 text-right pr-3 font-semibold",
                                  hasShortage
                                    ? "text-rose-600 dark:text-rose-400"
                                    : "text-emerald-600 dark:text-emerald-400"
                                )}
                              >
                                {item.available_quantity} {item.uom}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
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

              <DialogFooter className="pt-2">
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
                  disabled={creating}
                  className="rounded-xl gap-2 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold shadow-soft"
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
          <DialogContent className="max-w-lg p-6 rounded-2xl">
            <DialogHeader className="border-b border-border/60 pb-3">
              <DialogTitle className="text-lg font-bold text-foreground flex items-center gap-2">
                <PlusCircle className="size-5 text-primary" />
                Add Manufacturable Product & BOM
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-1">
                Register a new finished good item and define its Bill of Materials components for assembly.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleCreateProduct} className="space-y-4 pt-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">Product Name *</label>
                  <Input
                    type="text"
                    placeholder="e.g. Smart Sensor Hub"
                    value={newProductData.product_name}
                    onChange={(e) => handleProductNameChange(e.target.value)}
                    required
                    className="h-9 text-xs rounded-xl"
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-foreground flex items-center gap-1">
                      Product Code / SKU <span className="text-destructive">*</span>
                    </label>
                    <span className="text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded-full inline-flex items-center gap-0.5">
                      <Sparkles className="size-2.5" />
                      Auto-generated
                    </span>
                  </div>
                  <div className="relative flex items-center">
                    <Input
                      type="text"
                      placeholder="e.g. FG-SSH-001"
                      value={newProductData.product_code}
                      onChange={(e) => {
                        setSkuManuallyEdited(true);
                        setNewProductData({ ...newProductData, product_code: e.target.value.toUpperCase() });
                      }}
                      required
                      className="h-9 pr-9 text-xs font-mono font-semibold rounded-xl uppercase tracking-wider bg-muted/30 focus:bg-background"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleRegenerateSKU}
                      className="absolute right-1 size-7 p-0 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg"
                      title="Re-generate SKU"
                    >
                      <Sparkles className="size-3.5 text-primary" />
                    </Button>
                  </div>
                </div>
              </div>

              <DialogFooter className="pt-2">
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
                  disabled={addingProduct}
                  className="rounded-xl gap-2 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold shadow-soft"
                >
                  {addingProduct && <RefreshCw className="size-3.5 animate-spin" />}
                  Create & Select Product
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* ========================================================================= */}
        {/* VIEW MATERIAL REQUEST DETAILS MODAL */}
        {/* ========================================================================= */}
        {selectedRequest && (
          <Dialog open={Boolean(selectedRequest)} onOpenChange={(open) => !open && setSelectedRequest(null)}>
            <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto p-6 rounded-2xl">
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
                      Production Order: {selectedRequest.order_number || "—"} · Product: {selectedRequest.product_name}
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              <div className="space-y-4 pt-3">
                <div className="grid grid-cols-3 gap-3 p-3.5 rounded-xl bg-muted/30 border border-border text-xs">
                  <div>
                    <span className="text-muted-foreground">Product to Manufacture</span>
                    <p className="font-semibold text-foreground mt-0.5">{selectedRequest.product_name}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">{selectedRequest.product_code}</p>
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
                      Issued by: <strong className="text-foreground">{selectedRequest.material_issue.issued_by}</strong> · Destination: Assembly Staging
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
                      Received by: <strong className="text-foreground">{selectedRequest.material_received_by || "Assembly Operator"}</strong>
                    </p>
                  </div>
                )}

                {selectedRequest.remarks && (
                  <div className="p-3 rounded-xl border border-border bg-card text-xs">
                    <span className="text-muted-foreground block mb-1 font-medium">Remarks / Instructions</span>
                    <p className="text-foreground">{selectedRequest.remarks}</p>
                  </div>
                )}

                <div>
                  <h4 className="text-xs font-semibold text-foreground mb-2 flex items-center justify-between">
                    <span>Required BOM Items ({selectedRequest.items?.length || 0})</span>
                    <span className="text-[11px] text-muted-foreground font-normal">Requisition Details</span>
                  </h4>

                  <div className="overflow-x-auto rounded-xl border border-border bg-card">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-border bg-muted/40 text-[11px] font-semibold text-muted-foreground">
                          <th className="py-2.5 px-3">Material Code</th>
                          <th className="py-2.5 px-3">Material Name</th>
                          <th className="py-2.5 px-3 text-right">Required Qty</th>
                          <th className="py-2.5 px-3 text-center">UOM</th>
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
                              {item.quantity}
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
                    Verify physical items issued by Warehouse and confirm arrival into Assembly staging.
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
                    <p className="font-semibold text-foreground mt-0.5">{receiptRequest.product_name}</p>
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
                          prev.map((it) => ({ ...it, received_quantity: it.issued_quantity }))
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
                  <label className="text-xs font-semibold text-foreground">Receipt Remarks / Verification Notes</label>
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
