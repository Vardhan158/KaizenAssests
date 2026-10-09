import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/wms/app-shell";
import { requireRole } from "@/lib/auth-utils";
import {
  api,
  type AssemblyOrder,
  type AssemblyProductOption,
  type AssemblyLineOption,
  type AssemblyOrderItem,
  type AssemblyWorkStep,
} from "@/lib/api-client";
import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  CheckCircle2,
  Clock,
  ExternalLink,
  Eye,
  Factory,
  FileText,
  Filter,
  Layers,
  LayoutDashboard,
  Package,
  Plus,
  PlusCircle,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { cn, generateProductSKU } from "@/lib/utils";

interface SearchParams {
  view?: string;
  create?: string;
}

export const Route = createFileRoute("/assembly/orders")({
  beforeLoad: () => requireRole(["ASSEMBLY_MANAGER", "ASSEMBLY", "ADMIN", "SUPERUSER"]),
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    view: typeof search.view === "string" ? search.view : undefined,
    create: typeof search.create === "string" ? search.create : undefined,
  }),
  head: () => ({ meta: [{ title: "Assembly Orders · KaizenX" }] }),
  component: AssemblyOrdersPage,
});

function getStatusBadge(status: string) {
  const s = (status || "").toUpperCase();
  if (s === "COMPLETED" || s === "READY_FOR_DISPATCH" || s === "PACKED") {
    return <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300">{status}</Badge>;
  }
  if (s === "IN_PRODUCTION" || s === "IN-PROGRESS") {
    return <Badge className="bg-blue-500/15 text-blue-700 border-blue-500/30 dark:text-blue-300">{status}</Badge>;
  }
  if (s === "QC_PENDING") {
    return <Badge className="bg-purple-500/15 text-purple-700 border-purple-500/30 dark:text-purple-300">{status}</Badge>;
  }
  if (s === "MATERIAL_PENDING" || s === "PLANNED") {
    return <Badge className="bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300">{status}</Badge>;
  }
  if (s === "REWORK" || s === "QC_FAILED") {
    return <Badge className="bg-rose-500/15 text-rose-700 border-rose-500/30 dark:text-rose-300">{status}</Badge>;
  }
  return <Badge variant="outline">{status || "UNKNOWN"}</Badge>;
}

function getPriorityBadge(priority: string) {
  const p = (priority || "").toUpperCase();
  if (p === "URGENT") return <Badge className="bg-red-500/15 text-red-700 border-red-500/30 font-semibold">{priority}</Badge>;
  if (p === "HIGH") return <Badge className="bg-orange-500/15 text-orange-700 border-orange-500/30">{priority}</Badge>;
  if (p === "LOW") return <Badge className="bg-slate-500/15 text-slate-700 border-slate-500/30">{priority}</Badge>;
  return <Badge variant="outline">{priority || "NORMAL"}</Badge>;
}

function AssemblyOrdersPage() {
  const searchParams = useSearch({ from: "/assembly/orders" });
  const navigate = useNavigate();

  const [orders, setOrders] = useState<AssemblyOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [priorityFilter, setPriorityFilter] = useState("ALL");

  // Create Order Dialog state
  const [isCreateOpen, setIsCreateOpen] = useState(searchParams.create === "true");
  const [products, setProducts] = useState<AssemblyProductOption[]>([]);
  const [lines, setLines] = useState<AssemblyLineOption[]>([]);
  const [creating, setCreating] = useState(false);
  const [formData, setFormData] = useState({
    product_code: "",
    target_quantity: 1,
    required_date: new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0],
    assembly_line: "",
    priority: "NORMAL",
    notes: "",
  });

  // Add Product & BOM dialog state
  const [isAddProductOpen, setIsAddProductOpen] = useState(false);
  const [addingProduct, setAddingProduct] = useState(false);
  const [skuManuallyEdited, setSkuManuallyEdited] = useState(false);
  const [newProductData, setNewProductData] = useState({
    product_name: "",
    product_code: "",
    description: "",
    components: [
      { material_code: "PCB-CORE-01", material_name: "Core Control PCB", quantity_per_unit: 1, uom: "PCS" },
      { material_code: "HSG-ENC-01", material_name: "Enclosure Chassis", quantity_per_unit: 1, uom: "PCS" },
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
        { material_code: "PCB-CORE-01", material_name: "Core Control PCB", quantity_per_unit: 1, uom: "PCS" },
        { material_code: "HSG-ENC-01", material_name: "Enclosure Chassis", quantity_per_unit: 1, uom: "PCS" },
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

  // Order Detail Drawer/Modal state
  const [selectedOrder, setSelectedOrder] = useState<AssemblyOrder | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");

  // Phase 2: Live Materials & BOM Preview state
  const [orderMaterials, setOrderMaterials] = useState<any | null>(null);
  const [loadingMaterials, setLoadingMaterials] = useState(false);
  const [bomPreview, setBomPreview] = useState<any | null>(null);
  const [loadingBOMPreview, setLoadingBOMPreview] = useState(false);

  const loadOrders = async () => {
    try {
      setLoading(true);
      const res = await api.getAssemblyOrders({
        search: searchTerm,
        status: statusFilter,
        priority: priorityFilter,
      });
      setOrders(res);
    } catch (err: any) {
      toast.error(err?.message || "Failed to load assembly orders.");
    } finally {
      setLoading(false);
    }
  };

  const loadOrderMaterials = async (orderId: string) => {
    try {
      setLoadingMaterials(true);
      const res = await api.getAssemblyOrderMaterials(orderId);
      setOrderMaterials(res);
    } catch (err: any) {
      console.error("Failed to load order materials:", err);
    } finally {
      setLoadingMaterials(false);
    }
  };

  const loadBOMPreview = async (productCode: string, quantity: number) => {
    if (!productCode || quantity <= 0) {
      setBomPreview(null);
      return;
    }
    try {
      setLoadingBOMPreview(true);
      const res = await api.getProductBOM(productCode, quantity);
      setBomPreview(res);
    } catch (err: any) {
      console.error("Failed to load BOM preview:", err);
      setBomPreview(null);
    } finally {
      setLoadingBOMPreview(false);
    }
  };

  // Trigger BOM preview when form product or quantity changes
  useEffect(() => {
    if (isCreateOpen && formData.product_code && formData.target_quantity > 0) {
      loadBOMPreview(formData.product_code, formData.target_quantity);
    }
  }, [isCreateOpen, formData.product_code, formData.target_quantity]);

  // Load materials when selected order changes or tab becomes 'materials'
  useEffect(() => {
    if (selectedOrder) {
      loadOrderMaterials(selectedOrder.id);
    } else {
      setOrderMaterials(null);
    }
  }, [selectedOrder?.id]);

  const loadMasterData = async () => {
    try {
      const [prodsRes, linesRes] = await Promise.all([
        api.getAssemblyProducts(),
        api.getAssemblyLines(),
      ]);
      setProducts(prodsRes);
      setLines(linesRes);
      const firstProd = prodsRes[0];
      if (firstProd && !formData.product_code) {
        setFormData((prev) => ({ ...prev, product_code: firstProd.product_code }));
      }
      const firstLine = linesRes[0];
      if (firstLine && !formData.assembly_line) {
        setFormData((prev) => ({ ...prev, assembly_line: firstLine.code }));
      }
    } catch (err: any) {
      console.error("Failed to load master data:", err);
    }
  };

  useEffect(() => {
    loadOrders();
    loadMasterData();
  }, []);

  useEffect(() => {
    loadOrders();
  }, [statusFilter, priorityFilter]);

  // Load details when searchParams.view changes
  useEffect(() => {
    if (searchParams.view) {
      loadOrderDetail(searchParams.view);
    } else {
      setSelectedOrder(null);
    }
  }, [searchParams.view]);

  // Handle create search param
  useEffect(() => {
    if (searchParams.create === "true") {
      setIsCreateOpen(true);
    }
  }, [searchParams.create]);

  const loadOrderDetail = async (orderId: string) => {
    try {
      setDetailLoading(true);
      const res = await api.getAssemblyOrderDetail(orderId);
      setSelectedOrder(res);
    } catch (err: any) {
      toast.error(err?.message || "Failed to load order details.");
    } finally {
      setDetailLoading(false);
    }
  };

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.product_code) {
      toast.error("Please select a product.");
      return;
    }
    if (formData.target_quantity <= 0) {
      toast.error("Target quantity must be greater than 0.");
      return;
    }
    if (!formData.required_date) {
      toast.error("Please select a required completion date.");
      return;
    }

    try {
      setCreating(true);
      const newOrder = await api.createAssemblyOrder({
        product_code: formData.product_code,
        target_quantity: Number(formData.target_quantity),
        required_date: formData.required_date,
        assembly_line: formData.assembly_line,
        priority: formData.priority,
        notes: formData.notes,
      });

      toast.success(`Assembly Order ${newOrder.order_number} created successfully.`);
      setIsCreateOpen(false);
      navigate({ to: "/assembly/orders", search: { view: newOrder.id } as any });
      loadOrders();
    } catch (err: any) {
      toast.error(err?.message || "Failed to create assembly order.");
    } finally {
      setCreating(false);
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

      // Reload products list and auto-select newly created product
      const updatedList = await api.getAssemblyProducts();
      setProducts(updatedList);
      setFormData((prev) => ({ ...prev, product_code: created.product_code }));

      // Reset new product form
      setNewProductData({
        product_name: "",
        product_code: "",
        description: "",
        components: [
          { material_code: "PCB-CORE-01", material_name: "Core Control PCB", quantity_per_unit: 1, uom: "PCS" },
          { material_code: "HSG-ENC-01", material_name: "Enclosure Chassis", quantity_per_unit: 1, uom: "PCS" },
        ],
      });
    } catch (err: any) {
      toast.error(err?.message || "Failed to create product.");
    } finally {
      setAddingProduct(false);
    }
  };

  const selectedProduct = products.find((p) => p.product_code === formData.product_code);

  return (
    <AppShell
      title="Assembly Orders"
      subtitle="Production work orders, BOM allocations & execution tracking"
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadOrders()}
            disabled={loading}
            className="rounded-xl text-xs gap-1.5 shadow-2xs hover:bg-muted/80"
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin text-primary")} />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => setIsCreateOpen(true)}
            className="rounded-xl text-xs gap-1.5 font-semibold shadow-soft bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <PlusCircle className="size-3.5" />
            Create Assembly Order
          </Button>
        </div>
      }
    >
      <div className="space-y-6">

        {/* Filters Bar */}
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm flex flex-col md:flex-row gap-4 items-center justify-between">
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by order #, product..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadOrders()}
              className="pl-9 h-9 text-sm"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Filter className="h-3.5 w-3.5" />
              <span>Status:</span>
              <select
                className="h-8 rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="ALL">All Statuses</option>
                <option value="PLANNED">Planned</option>
                <option value="MATERIAL_PENDING">Material Pending</option>
                <option value="MATERIAL_READY">Material Ready</option>
                <option value="IN_PRODUCTION">In Production</option>
                <option value="QC_PENDING">QC Pending</option>
                <option value="REWORK">Rework</option>
                <option value="COMPLETED">Completed</option>
                <option value="PACKED">Packed</option>
                <option value="READY_FOR_DISPATCH">Ready For Dispatch</option>
              </select>
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Priority:</span>
              <select
                className="h-8 rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
              >
                <option value="ALL">All Priorities</option>
                <option value="LOW">Low</option>
                <option value="NORMAL">Normal</option>
                <option value="HIGH">High</option>
                <option value="URGENT">Urgent</option>
              </select>
            </div>
          </div>
        </div>

        {/* Orders Table */}
        <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
          {loading ? (
            <div className="py-20 text-center text-sm text-muted-foreground">
              Loading assembly orders from database...
            </div>
          ) : orders.length === 0 ? (
            <div className="py-20 text-center">
              <Layers className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-base font-semibold text-foreground">No Assembly Orders found</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                No orders match your current filters. Click below to create your first production order.
              </p>
              <Button
                size="sm"
                className="mt-4 gap-2"
                onClick={() => setIsCreateOpen(true)}
              >
                <PlusCircle className="h-4 w-4" />
                Create Assembly Order
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-xs font-semibold text-muted-foreground">
                    <th className="py-3 px-4">Order No.</th>
                    <th className="py-3 px-4">Product</th>
                    <th className="py-3 px-4">Target Qty</th>
                    <th className="py-3 px-4">Line</th>
                    <th className="py-3 px-4">Priority</th>
                    <th className="py-3 px-4">Progress</th>
                    <th className="py-3 px-4">Required Date</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {orders.map((ord) => (
                    <tr
                      key={ord.id}
                      onClick={() => navigate({ to: "/assembly/orders", search: { view: ord.id } as any })}
                      className="hover:bg-muted/40 cursor-pointer transition-colors"
                    >
                      <td className="py-3.5 px-4 font-semibold text-primary">
                        {ord.order_number}
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-medium text-foreground">{ord.product_name}</div>
                        {ord.product_code && (
                          <div className="text-xs text-muted-foreground">{ord.product_code}</div>
                        )}
                      </td>
                      <td className="py-3.5 px-4 font-medium text-foreground whitespace-nowrap">
                        {ord.target_quantity} {ord.uom}
                      </td>
                      <td className="py-3.5 px-4 text-xs text-muted-foreground whitespace-nowrap">
                        {ord.assembly_line || ord.assigned_line || "—"}
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {getPriorityBadge(ord.priority)}
                      </td>
                      <td className="py-3.5 px-4 min-w-[130px]">
                        <div className="flex items-center gap-2">
                          <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                            <div
                              className="bg-primary h-2 rounded-full transition-all duration-300"
                              style={{ width: `${Math.min(100, Math.max(0, ord.progress))}%` }}
                            />
                          </div>
                          <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
                            {ord.progress}%
                          </span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-xs text-muted-foreground whitespace-nowrap">
                        {ord.required_date ? new Date(ord.required_date).toLocaleDateString() : "—"}
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {getStatusBadge(ord.status)}
                      </td>
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1 text-xs font-medium text-primary hover:text-primary"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate({ to: "/assembly/orders", search: { view: ord.id } as any });
                          }}
                        >
                          <Eye className="h-3.5 w-3.5" />
                          View
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ========================================================================= */}
        {/* CREATE ASSEMBLY ORDER DIALOG */}
        {/* ========================================================================= */}
        <Dialog open={isCreateOpen} onOpenChange={(open) => {
          setIsCreateOpen(open);
          if (!open && searchParams.create) {
            navigate({ to: "/assembly/orders", search: { view: searchParams.view } as any });
          }
        }}>
          <DialogContent className="sm:max-w-[540px]">
            <form onSubmit={handleCreateOrder}>
              <DialogHeader>
                <DialogTitle className="text-lg font-bold text-foreground">Create Assembly Order</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Select a product from the Product Master to load its active BOM and calculate required materials.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-4 text-sm">
                {/* Product Select */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                      <span>Product to Manufacture <span className="text-destructive">*</span></span>
                      {selectedProduct && (
                        <span className="text-[11px] font-normal text-muted-foreground">
                          (BOM: {selectedProduct.bom_number})
                        </span>
                      )}
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={openAddProductModal}
                      className="h-6 px-2 text-xs font-semibold text-primary hover:text-primary hover:bg-primary/10 gap-1 rounded-lg"
                    >
                      <Plus className="size-3.5" />
                      Add Product
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
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
                      className="h-9 px-3 rounded-md text-xs gap-1 font-semibold border-primary/30 text-primary hover:bg-primary/10 shrink-0"
                      title="Add new manufacturable product & BOM"
                    >
                      <Plus className="size-3.5" />
                      Add
                    </Button>
                  </div>
                </div>

                {/* Target Quantity & Required Date */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-foreground">Quantity *</label>
                    <div className="relative">
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        value={formData.target_quantity}
                        onChange={(e) => setFormData({ ...formData, target_quantity: Number(e.target.value) })}
                        required
                        className="h-9 pr-12 text-sm"
                      />
                      <span className="absolute right-3 top-2 text-xs font-medium text-muted-foreground pointer-events-none">
                        PCS
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-foreground">Required Date *</label>
                    <Input
                      type="date"
                      value={formData.required_date}
                      onChange={(e) => setFormData({ ...formData, required_date: e.target.value })}
                      required
                      className="h-9 text-sm"
                    />
                  </div>
                </div>

                {/* Assembly Line & Priority */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-foreground">Assembly Line</label>
                    <select
                      className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      value={formData.assembly_line}
                      onChange={(e) => setFormData({ ...formData, assembly_line: e.target.value })}
                    >
                      {lines.map((l) => (
                        <option key={l.id} value={l.code}>
                          {l.name} ({l.code})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-foreground">Priority</label>
                    <select
                      className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      value={formData.priority}
                      onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                    >
                      <option value="LOW">Low</option>
                      <option value="NORMAL">Normal</option>
                      <option value="HIGH">High</option>
                      <option value="URGENT">Urgent</option>
                    </select>
                  </div>
                </div>

                {/* Live BOM & Warehouse Availability Preview */}
                {loadingBOMPreview ? (
                  <div className="rounded-lg border border-border/80 bg-muted/20 p-3 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Calculating required materials from BOM & querying warehouse inventory...</span>
                  </div>
                ) : bomPreview ? (
                  <div className="rounded-lg border border-border bg-card p-3 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5 font-semibold text-foreground">
                        <Boxes className="h-3.5 w-3.5 text-primary" />
                        <span>BOM Calculation Preview ({bomPreview.items?.length || 0} Components)</span>
                      </div>
                      <Badge
                        className={
                          bomPreview.shortage_components > 0
                            ? "bg-amber-500/15 text-amber-700 border-amber-500/30 text-[10px]"
                            : "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 text-[10px]"
                        }
                      >
                        {bomPreview.shortage_components > 0
                          ? `${bomPreview.shortage_components} Shortage`
                          : "Full Stock in Warehouse"}
                      </Badge>
                    </div>

                    <div className="max-h-36 overflow-y-auto rounded border border-border/60 text-[11px]">
                      <table className="w-full text-left">
                        <thead className="bg-muted/50 text-[10px] uppercase text-muted-foreground border-b border-border/60 sticky top-0">
                          <tr>
                            <th className="p-1.5 pl-2">Component</th>
                            <th className="p-1.5 text-right">Req Qty</th>
                            <th className="p-1.5 text-right">WH Stock</th>
                            <th className="p-1.5 text-center pr-2">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/30">
                          {bomPreview.items?.map((item: any, idx: number) => {
                            const isShort = item.shortage > 0 || item.status === "SHORTAGE";
                            return (
                              <tr key={idx} className={isShort ? "bg-amber-500/5" : ""}>
                                <td className="p-1.5 pl-2 font-medium text-foreground truncate max-w-[150px]">
                                  {item.material_code}
                                  <span className="block text-[10px] text-muted-foreground truncate font-normal">
                                    {item.material_name}
                                  </span>
                                </td>
                                <td className="p-1.5 text-right font-semibold text-foreground">
                                  {item.required_quantity} {item.uom}
                                </td>
                                <td className="p-1.5 text-right text-muted-foreground">
                                  {item.warehouse_stock} {item.uom}
                                </td>
                                <td className="p-1.5 text-center pr-2">
                                  <span
                                    className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                                      isShort
                                        ? "bg-rose-500/15 text-rose-700 dark:text-rose-300"
                                        : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                                    }`}
                                  >
                                    {isShort ? `-${item.shortage}` : "OK"}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}

                {/* Notes */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">Notes (Optional)</label>
                  <Textarea
                    placeholder="Special instructions or batch details..."
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    rows={2}
                    className="text-xs resize-none"
                  />
                </div>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsCreateOpen(false)}
                  disabled={creating}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={creating}
                  className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {creating && <RefreshCw className="h-4 w-4 animate-spin" />}
                  Create Order
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* ========================================================================= */}
        {/* ORDER DETAIL VIEW MODAL / DRAWER */}
        {/* ========================================================================= */}
        {selectedOrder && (
          <Dialog
            open={Boolean(selectedOrder)}
            onOpenChange={(open) => {
              if (!open) {
                navigate({ to: "/assembly/orders", search: {} as any });
                setSelectedOrder(null);
              }
            }}
          >
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto p-6">
              <DialogHeader className="border-b border-border/60 pb-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <DialogTitle className="text-xl font-bold text-foreground">
                        {selectedOrder.order_number}
                      </DialogTitle>
                      {getStatusBadge(selectedOrder.status)}
                      {getPriorityBadge(selectedOrder.priority)}
                    </div>
                    <DialogDescription className="text-xs text-muted-foreground mt-1">
                      {selectedOrder.product_name} ({selectedOrder.product_code}) · Line: {selectedOrder.assembly_line || selectedOrder.assigned_line || "Unassigned"}
                    </DialogDescription>
                  </div>

                  <div className="text-right">
                    <div className="text-sm font-semibold text-foreground">
                      Target: {selectedOrder.target_quantity} {selectedOrder.uom}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Due: {selectedOrder.required_date ? new Date(selectedOrder.required_date).toLocaleDateString() : "—"}
                    </div>
                  </div>
                </div>
              </DialogHeader>

              {/* Order Detail Tabs */}
              <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4">
                <TabsList className="grid grid-cols-6 h-9 p-0.5 bg-muted/60 text-xs">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="materials">Materials</TabsTrigger>
                  <TabsTrigger value="production">Production</TabsTrigger>
                  <TabsTrigger value="quality">Quality</TabsTrigger>
                  <TabsTrigger value="finished-goods">FG</TabsTrigger>
                  <TabsTrigger value="activity">Activity</TabsTrigger>
                </TabsList>

                {/* 1. OVERVIEW TAB */}
                <TabsContent value="overview" className="mt-4 space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 rounded-xl border border-border bg-card">
                    <div>
                      <span className="text-xs text-muted-foreground">Target Quantity</span>
                      <p className="text-base font-semibold text-foreground mt-0.5">
                        {selectedOrder.target_quantity} {selectedOrder.uom}
                      </p>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">Completed Quantity</span>
                      <p className="text-base font-semibold text-emerald-600 mt-0.5">
                        {selectedOrder.completed_quantity} {selectedOrder.uom}
                      </p>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">Assembly Line</span>
                      <p className="text-base font-semibold text-foreground mt-0.5">
                        {selectedOrder.assembly_line || selectedOrder.assigned_line || "—"}
                      </p>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">Progress</span>
                      <p className="text-base font-semibold text-primary mt-0.5">
                        {selectedOrder.progress}%
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="rounded-xl border border-border bg-card p-4 space-y-2.5 text-xs">
                      <h4 className="font-semibold text-foreground text-sm border-b border-border/50 pb-2">
                        Manufacturing Details
                      </h4>
                      <div className="flex justify-between py-1 border-b border-border/30">
                        <span className="text-muted-foreground">Product Code</span>
                        <span className="font-medium text-foreground">{selectedOrder.product_code || "—"}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-border/30">
                        <span className="text-muted-foreground">Product Name</span>
                        <span className="font-medium text-foreground">{selectedOrder.product_name}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-border/30">
                        <span className="text-muted-foreground">BOM Reference</span>
                        <span className="font-medium font-mono text-foreground">{selectedOrder.bom_number || "Standard BOM"}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-border/30">
                        <span className="text-muted-foreground">Required By Date</span>
                        <span className="font-medium text-foreground">
                          {selectedOrder.required_date ? new Date(selectedOrder.required_date).toLocaleDateString() : "—"}
                        </span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-border/30">
                        <span className="text-muted-foreground">Created By</span>
                        <span className="font-medium text-foreground">{selectedOrder.created_by}</span>
                      </div>
                      <div className="flex justify-between py-1">
                        <span className="text-muted-foreground">Created At</span>
                        <span className="font-medium text-foreground">
                          {selectedOrder.created_at ? new Date(selectedOrder.created_at).toLocaleString() : "—"}
                        </span>
                      </div>
                    </div>

                    <div className="rounded-xl border border-border bg-card p-4 space-y-2.5 text-xs">
                      <h4 className="font-semibold text-foreground text-sm border-b border-border/50 pb-2">
                        Order Notes & Instructions
                      </h4>
                      <p className="text-muted-foreground leading-relaxed">
                        {selectedOrder.notes || "No additional production notes recorded for this order."}
                      </p>

                      <div className="pt-4 border-t border-border/50">
                        <span className="text-xs font-semibold text-foreground block mb-2">Order Workflow Status</span>
                        <div className="flex items-center gap-2">
                          {getStatusBadge(selectedOrder.status)}
                          <span className="text-xs text-muted-foreground">
                            {selectedOrder.status === "MATERIAL_PENDING"
                              ? "Awaiting Material Requisition approval from Warehouse"
                              : selectedOrder.status === "MATERIAL_READY"
                              ? "All materials staged. Ready to start production."
                              : selectedOrder.status === "IN_PRODUCTION"
                              ? "Production active on line."
                              : "Order execution in progress."}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </TabsContent>

                {/* 2. MATERIALS TAB */}
                <TabsContent value="materials" className="mt-4 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Bill of Materials & Warehouse Stock</h3>
                      <p className="text-xs text-muted-foreground">
                        Real-time BOM material requirements cross-referenced with live Warehouse inventory.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => loadOrderMaterials(selectedOrder.id)}
                      disabled={loadingMaterials}
                      className="gap-2 h-8 text-xs shrink-0"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${loadingMaterials ? "animate-spin" : ""}`} />
                      Refresh Stock
                    </Button>
                  </div>

                  {/* Summary Metric Cards */}
                  {(() => {
                    const items = orderMaterials?.items || selectedOrder.items || [];
                    const totalComponents = orderMaterials?.total_components ?? items.length;
                    const shortageCount =
                      orderMaterials?.shortage_components ??
                      items.filter((i: any) => (i.shortage || 0) > 0 || i.status === "SHORTAGE").length;
                    const availableCount =
                      orderMaterials?.available_components ?? Math.max(0, totalComponents - shortageCount);
                    const isAllAvailable = shortageCount === 0 && totalComponents > 0;

                    return (
                      <>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          <div className="rounded-xl border border-border bg-card p-3">
                            <span className="text-[11px] font-medium text-muted-foreground">Total Components</span>
                            <div className="flex items-center justify-between mt-1">
                              <p className="text-xl font-bold text-foreground">{totalComponents}</p>
                              <Layers className="h-4 w-4 text-muted-foreground/60" />
                            </div>
                          </div>

                          <div className="rounded-xl border border-border bg-card p-3">
                            <span className="text-[11px] font-medium text-muted-foreground">In Stock</span>
                            <div className="flex items-center justify-between mt-1">
                              <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
                                {availableCount}
                              </p>
                              <CheckCircle2 className="h-4 w-4 text-emerald-500/60" />
                            </div>
                          </div>

                          <div className="rounded-xl border border-border bg-card p-3">
                            <span className="text-[11px] font-medium text-muted-foreground">Shortage Count</span>
                            <div className="flex items-center justify-between mt-1">
                              <p
                                className={`text-xl font-bold ${
                                  shortageCount > 0 ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground"
                                }`}
                              >
                                {shortageCount}
                              </p>
                              <AlertTriangle
                                className={`h-4 w-4 ${
                                  shortageCount > 0 ? "text-rose-500/80" : "text-muted-foreground/40"
                                }`}
                              />
                            </div>
                          </div>

                          <div className="rounded-xl border border-border bg-card p-3">
                            <span className="text-[11px] font-medium text-muted-foreground">Warehouse Status</span>
                            <div className="mt-1">
                              {isAllAvailable ? (
                                <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30 text-xs font-semibold">
                                  READY FOR ISSUE
                                </Badge>
                              ) : (
                                <Badge className="bg-amber-500/15 text-amber-700 border-amber-500/30 text-xs font-semibold">
                                  SHORTAGE DETECTED
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Shortage Warning Banner */}
                        {shortageCount > 0 && (
                          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 flex items-start gap-3">
                            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                            <div className="text-xs space-y-1">
                              <p className="font-semibold text-amber-900 dark:text-amber-200">
                                Warehouse Stock Shortage Detected ({shortageCount}{" "}
                                {shortageCount === 1 ? "Component" : "Components"})
                              </p>
                              <p className="text-amber-700 dark:text-amber-300">
                                One or more BOM items have insufficient warehouse quantity. When material requisition is
                                created, warehouse can fulfill available inventory while procurement or warehouse restock is
                                arranged.
                              </p>
                            </div>
                          </div>
                        )}

                        {/* Materials Detail Table */}
                        {items.length === 0 ? (
                          <div className="py-12 text-center text-sm text-muted-foreground border border-dashed rounded-xl">
                            No material items calculated for this order.
                          </div>
                        ) : (
                          <div className="overflow-x-auto rounded-xl border border-border bg-card">
                            <table className="w-full text-left text-xs">
                              <thead>
                                <tr className="border-b border-border bg-muted/40 text-[11px] font-semibold text-muted-foreground">
                                  <th className="py-2.5 px-3">Material</th>
                                  <th className="py-2.5 px-3 text-right">Qty/Unit</th>
                                  <th className="py-2.5 px-3 text-right">Required</th>
                                  <th className="py-2.5 px-3 text-right">Warehouse Available</th>
                                  <th className="py-2.5 px-3 text-right">Requested</th>
                                  <th className="py-2.5 px-3 text-right">Received</th>
                                  <th className="py-2.5 px-3 text-right">Shortage</th>
                                  <th className="py-2.5 px-3 text-center">Status</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border/40">
                                {items.map((item: any, idx: number) => {
                                  const isShort =
                                    (item.shortage && item.shortage > 0) || item.status === "SHORTAGE";
                                  return (
                                    <tr key={idx} className={isShort ? "bg-amber-500/5" : ""}>
                                      <td className="py-2.5 px-3">
                                        <div className="font-medium text-foreground">{item.material_code}</div>
                                        <div className="text-[11px] text-muted-foreground">{item.material_name}</div>
                                      </td>
                                      <td className="py-2.5 px-3 text-right text-muted-foreground">
                                        {item.quantity_per_unit} {item.uom}
                                      </td>
                                      <td className="py-2.5 px-3 text-right font-semibold text-foreground">
                                        {item.required_quantity} {item.uom}
                                      </td>
                                      <td className="py-2.5 px-3 text-right font-medium text-foreground">
                                        {item.available_quantity ?? item.warehouse_stock ?? 0} {item.uom}
                                      </td>
                                      <td className="py-2.5 px-3 text-right text-muted-foreground">
                                        {item.requested_quantity || 0} {item.uom}
                                      </td>
                                      <td className="py-2.5 px-3 text-right text-muted-foreground">
                                        {item.received_quantity || 0} {item.uom}
                                      </td>
                                      <td className="py-2.5 px-3 text-right">
                                        {isShort ? (
                                          <span className="font-semibold text-rose-600 dark:text-rose-400">
                                            {item.shortage} {item.uom}
                                          </span>
                                        ) : (
                                          <span className="text-muted-foreground">0 {item.uom}</span>
                                        )}
                                      </td>
                                      <td className="py-2.5 px-3 text-center">
                                        {isShort ? (
                                          <Badge className="bg-amber-500/15 text-amber-700 border-amber-500/30 text-[10px]">
                                            SHORTAGE
                                          </Badge>
                                        ) : (
                                          <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30 text-[10px]">
                                            AVAILABLE
                                          </Badge>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </TabsContent>

                {/* 3. PRODUCTION TAB */}
                <TabsContent value="production" className="mt-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Product Work Steps / Routing</h3>
                      <p className="text-xs text-muted-foreground">
                        Standard sequence of operations defined in master routing for this product.
                      </p>
                    </div>
                  </div>

                  {(!selectedOrder.assembly_steps || selectedOrder.assembly_steps.length === 0) ? (
                    <div className="py-12 text-center text-sm text-muted-foreground border border-dashed rounded-xl">
                      No routing operations configured for this product.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {selectedOrder.assembly_steps.map((step: AssemblyWorkStep, idx: number) => (
                        <div
                          key={step.id || idx}
                          className="rounded-xl border border-border bg-card p-4 flex items-start gap-3 shadow-sm"
                        >
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-xs">
                            {idx + 1}
                          </div>

                          <div className="flex-1 space-y-1">
                            <div className="flex items-center justify-between">
                              <h4 className="text-sm font-semibold text-foreground">{step.name}</h4>
                              <div className="flex items-center gap-2">
                                {step.qc_required && (
                                  <Badge variant="outline" className="text-[10px] border-purple-500/30 text-purple-600">
                                    QC Required
                                  </Badge>
                                )}
                                <Badge variant="outline" className="text-[10px]">
                                  {step.status || "NOT_STARTED"}
                                </Badge>
                              </div>
                            </div>

                            {step.instruction && (
                              <p className="text-xs text-muted-foreground">{step.instruction}</p>
                            )}

                            {step.expected_time_minutes && (
                              <div className="flex items-center gap-1 text-[11px] text-muted-foreground pt-1">
                                <Clock className="h-3 w-3" />
                                <span>Expected time: {step.expected_time_minutes} minutes</span>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>

                {/* 4. QUALITY TAB */}
                <TabsContent value="quality" className="mt-4 space-y-4">
                  <div className="rounded-xl border border-border bg-card p-5 space-y-3">
                    <h3 className="text-sm font-semibold text-foreground">Final Quality Inspection Status</h3>
                    <p className="text-xs text-muted-foreground">
                      Final QC occurs after completion of all production operations. Passed quantity directly converts to Finished Goods.
                    </p>

                    <div className="grid grid-cols-3 gap-4 pt-2 border-t border-border/50 text-xs">
                      <div>
                        <span className="text-muted-foreground">Produced Quantity</span>
                        <p className="text-base font-semibold text-foreground mt-0.5">
                          {selectedOrder.completed_quantity} {selectedOrder.uom}
                        </p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">QC Passed</span>
                        <p className="text-base font-semibold text-emerald-600 mt-0.5">
                          {selectedOrder.status === "COMPLETED" ? selectedOrder.completed_quantity : 0} {selectedOrder.uom}
                        </p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">QC Rejected / Rework</span>
                        <p className="text-base font-semibold text-rose-600 mt-0.5">
                          {selectedOrder.rejected_quantity} {selectedOrder.uom}
                        </p>
                      </div>
                    </div>
                  </div>
                </TabsContent>

                {/* 5. FINISHED GOODS TAB */}
                <TabsContent value="finished-goods" className="mt-4 space-y-4">
                  <div className="rounded-xl border border-border bg-card p-5 space-y-3">
                    <h3 className="text-sm font-semibold text-foreground">Finished Goods & Storage Status</h3>
                    <p className="text-xs text-muted-foreground">
                      Finished goods stay within the Assembly FG storage area and are ready for dispatch pickup.
                    </p>

                    <div className="p-4 rounded-lg bg-muted/40 text-xs space-y-1.5 border border-border/40">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Target FG</span>
                        <span className="font-semibold text-foreground">{selectedOrder.product_name}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Current Status</span>
                        <span className="font-semibold text-foreground">{selectedOrder.status}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Designated Storage Area</span>
                        <span className="font-semibold text-foreground">ASSEMBLY-FG-01</span>
                      </div>
                    </div>
                  </div>
                </TabsContent>

                {/* 6. ACTIVITY TAB */}
                <TabsContent value="activity" className="mt-4 space-y-4">
                  <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                    <h3 className="text-sm font-semibold text-foreground">Lifecycle Audit Trail</h3>
                    <div className="space-y-3 text-xs">
                      {selectedOrder.created_at && (
                        <div className="flex items-start gap-3">
                          <div className="h-2 w-2 rounded-full bg-primary mt-1.5 shrink-0" />
                          <div>
                            <p className="font-medium text-foreground">Assembly Order Created</p>
                            <p className="text-muted-foreground text-[11px]">
                              Created by {selectedOrder.created_by} on {new Date(selectedOrder.created_at).toLocaleString()}
                            </p>
                          </div>
                        </div>
                      )}
                      {selectedOrder.started_at && (
                        <div className="flex items-start gap-3">
                          <div className="h-2 w-2 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                          <div>
                            <p className="font-medium text-foreground">Production Commenced</p>
                            <p className="text-muted-foreground text-[11px]">
                              Started on {new Date(selectedOrder.started_at).toLocaleString()}
                            </p>
                          </div>
                        </div>
                      )}
                      {selectedOrder.completed_at && (
                        <div className="flex items-start gap-3">
                          <div className="h-2 w-2 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                          <div>
                            <p className="font-medium text-foreground">Production Completed</p>
                            <p className="text-muted-foreground text-[11px]">
                              Finished on {new Date(selectedOrder.completed_at).toLocaleString()}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </TabsContent>
              </Tabs>

              <DialogFooter className="mt-6 border-t border-border/60 pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    navigate({ to: "/assembly/orders", search: {} as any });
                    setSelectedOrder(null);
                  }}
                >
                  Close
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

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

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">Description (Optional)</label>
                <Input
                  type="text"
                  placeholder="e.g. High-precision IoT environmental sensor controller"
                  value={newProductData.description}
                  onChange={(e) =>
                    setNewProductData({ ...newProductData, description: e.target.value })
                  }
                  className="h-9 text-xs rounded-xl"
                />
              </div>

              {/* Component Rows */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <Layers className="size-3.5 text-primary" />
                    Bill of Materials Components ({newProductData.components.length})
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[11px] font-semibold text-primary hover:text-primary gap-1"
                    onClick={() =>
                      setNewProductData({
                        ...newProductData,
                        components: [
                          ...newProductData.components,
                          {
                            material_code: `COMP-${newProductData.components.length + 1}`,
                            material_name: `Component ${newProductData.components.length + 1}`,
                            quantity_per_unit: 1,
                            uom: "PCS",
                          },
                        ],
                      })
                    }
                  >
                    <Plus className="size-3" />
                    Add Row
                  </Button>
                </div>

                <div className="max-h-44 overflow-y-auto space-y-2 pr-1 rounded-xl border border-border/60 bg-muted/20 p-2.5">
                  {newProductData.components.map((comp, idx) => (
                    <div key={idx} className="flex items-center gap-2 bg-card p-2 rounded-lg border border-border/50 text-xs">
                      <div className="flex-1 space-y-1">
                        <Input
                          placeholder="Code (e.g. PCB-01)"
                          value={comp.material_code}
                          onChange={(e) => {
                            const updated = [...newProductData.components];
                            updated[idx].material_code = e.target.value.toUpperCase();
                            setNewProductData({ ...newProductData, components: updated });
                          }}
                          required
                          className="h-7 text-xs font-mono uppercase rounded-md"
                        />
                      </div>
                      <div className="flex-[2] space-y-1">
                        <Input
                          placeholder="Description (e.g. Main Board)"
                          value={comp.material_name}
                          onChange={(e) => {
                            const updated = [...newProductData.components];
                            updated[idx].material_name = e.target.value;
                            setNewProductData({ ...newProductData, components: updated });
                          }}
                          required
                          className="h-7 text-xs rounded-md"
                        />
                      </div>
                      <div className="w-16 space-y-1">
                        <Input
                          type="number"
                          min="0.01"
                          step="any"
                          placeholder="Qty"
                          value={comp.quantity_per_unit}
                          onChange={(e) => {
                            const updated = [...newProductData.components];
                            updated[idx].quantity_per_unit = Number(e.target.value);
                            setNewProductData({ ...newProductData, components: updated });
                          }}
                          required
                          className="h-7 text-xs text-right font-mono rounded-md"
                        />
                      </div>
                      {newProductData.components.length > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            const updated = newProductData.components.filter((_, i) => i !== idx);
                            setNewProductData({ ...newProductData, components: updated });
                          }}
                          className="text-muted-foreground hover:text-destructive p-1"
                        >
                          <X className="size-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
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
      </div>
    </AppShell>
  );
}
