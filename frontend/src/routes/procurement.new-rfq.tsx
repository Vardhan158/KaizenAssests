import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Save,
  Calendar as CalendarIcon,
  Building2,
  User,
  FileText,
  Loader2,
  CheckCircle2,
  Search,
  Plus,
  Trash2,
  Package,
  Sparkles,
  ClipboardList,
  Send,
  Check,
  AlertCircle,
  X,
} from "lucide-react";
import { AppShell, StatusBadge } from "@/components/wms/app-shell";
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
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api-client";
import { requireRole } from "@/lib/auth-utils";
import { cn } from "@/lib/utils";
import { getUserInfo } from "@/lib/auth-utils";
export const Route = createFileRoute("/procurement/new-rfq")({
  beforeLoad: () => requireRole(["PROCUREMENT", "MANAGER", "ADMIN", "SUPERUSER"]),
  component: NewRfq,
});
const inputClass = "mt-1.5 h-11 rounded-xl border-border/80 bg-background";
function NewRfq() {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [selectedSuppliers, setSelectedSuppliers] = useState<string[]>([]);
  const [loadingSuppliers, setLoadingSuppliers] = useState(true);
  const [materialRequests, setMaterialRequests] = useState<any[]>([]);
  const [selectedRequestId, setSelectedRequestId] = useState("");
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);
  const [filters, setFilters] = useState({
    search: "",
    category: "",
    material: "",
    city: "",
  });
  const [formData, setFormData] = useState({
    rfq_date: new Date().toISOString().split("T")[0],
    material_request_number: "",
    department: "",
    requested_by: "",
    required_delivery_date: "",
    warehouse: "Main Warehouse",
    procurement_officer: "",
    remarks: "",
  });
  const generateRandomCode = () => `MAT-${Math.floor(100000 + Math.random() * 900000)}`;
  const [items, setItems] = useState<any[]>([
    {
      material_code: generateRandomCode(),
      material_name: "",
      category: "Raw Materials",
      quantity: 1,
      uom: "PCS",
    },
  ]);
  const addItem = () => {
    setItems((prev) => [
      ...prev,
      {
        material_code: generateRandomCode(),
        material_name: "",
        category: "Raw Materials",
        quantity: 1,
        uom: "PCS",
      },
    ]);
  };
  const removeItem = (index: number) => {
    if (items.length === 1) {
      toast.error("At least one material requirement is required");
      return;
    }
    setItems((prev) => prev.filter((_, i) => i !== index));
  };
  const handleItemChange = (index: number, field: string, value: any) => {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
  };
  const supplierIdOf = (supplier: any) =>
    String(supplier?.supplierId || supplier?.supplier_id || supplier?.id || "");
  const supplierNameOf = (supplier: any) =>
    supplier?.supplierName || supplier?.supplier_name || supplier?.registeredCompanyName || supplier?.registered_company_name || "Supplier";
  const supplierCategories = (supplier: any) =>
    supplier?.category || supplier?.categories || supplier?.materialCategories || supplier?.material_categories || [];
  const supplierMaterials = (supplier: any) =>
    supplier?.mainMaterials || supplier?.main_materials || supplier?.materials || [];
  const normalizeMatchText = (value: unknown) =>
    String(value || "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .map((part) => part.trim())
      .filter((part) => part && part !== "and")
      .map((part) => (part.length > 3 && part.endsWith("s") ? part.slice(0, -1) : part));
  const normalizedValues = (value: unknown) => {
    const values = Array.isArray(value) ? value : [value];
    return values.flatMap((entry) => normalizeMatchText(entry));
  };
  const hasSharedMatchToken = (left: unknown, right: unknown) => {
    const leftTokens = new Set(normalizedValues(left));
    if (leftTokens.size === 0) return false;
    return normalizedValues(right).some((token) => leftTokens.has(token));
  };
  const supplierMatchesFilters = (supplier: any) => {
    const search = filters.search.trim().toLowerCase();
    const material = filters.material.trim();
    const category = filters.category.trim();
    const city = filters.city.trim().toLowerCase();
    const supplierText = [
      supplierNameOf(supplier),
      supplier?.supplierCode,
      supplier?.supplier_code,
      supplier?.gstin,
      supplier?.registeredCompanyName,
      supplier?.registered_company_name,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const supplierCityText = [
      supplier?.city,
      supplier?.location,
      supplier?.address?.city,
      supplier?.registeredAddress?.city,
      supplier?.registered_address?.city,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return (
      (!search || supplierText.includes(search)) &&
      (!city || supplierCityText.includes(city)) &&
      (!category ||
        hasSharedMatchToken(category, supplierCategories(supplier)) ||
        hasSharedMatchToken(category, supplierMaterials(supplier))) &&
      (!material ||
        hasSharedMatchToken(material, supplierMaterials(supplier)) ||
        hasSharedMatchToken(material, supplierCategories(supplier)))
    );
  };
  const supplierCategoryText = (supplier: any, fallback = "Category not set") => {
    const category = supplierCategories(supplier);
    if (Array.isArray(category)) return category.filter(Boolean).join(", ") || fallback;
    return String(category || "").trim() || fallback;
  };

  const applyMaterialRequest = (requestId: string, requests = materialRequests) => {
    const mr = requests.find(
      (request) => request.id === requestId || request.requestNumber === requestId,
    );
    if (!mr) return;

    setSelectedRequestId(mr.id);
    setFormData((prev) => ({
      ...prev,
      material_request_number: mr.requestNumber || mr.request_number || "",
      department: mr.department || "",
      requested_by: mr.requestedBy || mr.requested_by || "",
      warehouse: mr.warehouseId || mr.warehouse_id || mr.warehouse || "Main Warehouse",
      required_delivery_date:
        mr.requiredDate || mr.required_date
          ? String(mr.requiredDate || mr.required_date).split("T")[0]
          : "",
      remarks: mr.remarks || "",
    }));

    if (mr.items && mr.items.length > 0) {
      setItems(
        mr.items.map((item: any) => ({
          material_id: item.materialId || item.material_id || null,
          material_variant_id: item.materialVariantId || item.material_variant_id || null,
          material_code: item.materialCode || item.material_code || "",
          variant_code: item.variantCode || item.variant_code || null,
          material_name: item.materialName || item.material_name || item.materialCode || "",
          category: item.category || "Raw Materials",
          quantity: item.quantity ?? 1,
          uom: item.uom || "PCS",
        })),
      );

      const mrCats = [...new Set(mr.items.map((it: any) => it.category).filter(Boolean))];
      if (mrCats.length > 0) {
        const primaryCat = mrCats[0];
        setFilters((prev) => ({
          ...prev,
          category: primaryCat,
        }));
      }
    }
  };
  useEffect(() => {
    async function fetchSuppliers() {
      try {
        setLoadingSuppliers(true);
        const data = await api.getSuppliers({ status: "Active" });
        const activeSuppliers = data.filter(
          (supplier: any) =>
            String(supplier.status ?? "")
              .trim()
              .toLowerCase() === "active" && supplierIdOf(supplier),
        );
        const matchedSuppliers = activeSuppliers.filter(supplierMatchesFilters);
        setSuppliers(matchedSuppliers);
        if (matchedSuppliers.length > 0) {
          setSelectedSuppliers((current) => {
            const validIds = new Set(matchedSuppliers.map(supplierIdOf));
            const retained = current.filter((id) => validIds.has(id));
            return retained.length > 0 ? retained : matchedSuppliers.map(supplierIdOf);
          });
        } else {
          setSelectedSuppliers([]);
        }
      } catch (err) {
        toast.error("Failed to load suppliers");
      } finally {
        setLoadingSuppliers(false);
      }
    }
    const debounceTimer = setTimeout(() => {
      fetchSuppliers();
    }, 300);
    return () => clearTimeout(debounceTimer);
  }, [filters, items]);
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const cats = await api.getSupplierCategories();
        if (cats.length > 0) {
          setAvailableCategories(cats.map((c: any) => c.name));
        } else {
          setAvailableCategories(["Raw Materials", "Components", "Services", "Hardware"]);
        }
      } catch (e) {
        console.warn("Failed to fetch supplier categories", e);
        setAvailableCategories(["Raw Materials", "Components", "Services", "Hardware"]);
      }
    };
    fetchCategories();
    const user = getUserInfo();
    if (user) {
      setFormData((prev) => ({ ...prev, procurement_officer: user.full_name || user.username || "" }));
    }
    const loadMaterialRequests = async () => {
      try {
        setLoadingRequests(true);
        const allMRs = await api.getMaterialRequests();
        const approvedMRs = allMRs.filter((request: any) => request.status === "Approved");
        setMaterialRequests(approvedMRs);

        let fromRequestId = new URLSearchParams(window.location.search).get("fromRequestId");
        if (!fromRequestId && typeof window !== "undefined") {
          const match = window.location.href.match(/fromRequestId=([^&]+)/);
          if (match) fromRequestId = decodeURIComponent(match[1]);
        }

        if (fromRequestId) {
          const found = approvedMRs.find(
            (request: any) =>
              request.id === fromRequestId || request.requestNumber === fromRequestId,
          );
          if (found) {
            applyMaterialRequest(found.id, approvedMRs);
          } else {
            toast.error("Only approved material requests can be converted to RFQ");
          }
        } else if (approvedMRs.length > 0) {
          applyMaterialRequest(approvedMRs[0].id, approvedMRs);
        }
      } catch (e) {
        console.error("Failed to load material requests", e);
        toast.error("Failed to load material requests");
      } finally {
        setLoadingRequests(false);
      }
    };
    void loadMaterialRequests();
  }, []);
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };
  const toggleSupplier = (id: string) => {
    setSelectedSuppliers((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  };
  const handleOpenPreSubmitModal = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedSuppliers.length === 0) {
      toast.error("Please select at least one supplier for the RFQ invitation");
      return;
    }
    if (items.some((item) => !item.material_code.trim() || !item.material_name.trim())) {
      toast.error("Please fill in Material Code and Name for all items");
      return;
    }
    setShowConfirmModal(true);
  };

  const executeSubmitRfq = async () => {
    setSubmitting(true);
    try {
      const uniqueSupplierIds = [...new Set(selectedSuppliers.filter(Boolean))];
      const payload = {
        ...formData,
        supplier_ids: uniqueSupplierIds,
        items: items.map((item) => ({
          ...item,
          quantity: parseFloat(item.quantity) || 0,
        })),
        required_delivery_date: formData.required_delivery_date || null,
      };
      await api.createRfq(payload);
      toast.success("RFQ created", {
        description: "Review and send it from the RFQ list to email suppliers.",
      });
      setShowConfirmModal(false);
      navigate({ to: "/procurement/rfqs" });
    } catch (error: any) {
      toast.error("Failed to create RFQ: " + (error.message || "Unknown error"));
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <AppShell
      title="Create New RFQ"
      subtitle="Request for Quotations — Auto-generate RFQ numbers and track bids"
      actions={
        <Button
          variant="outline"
          className="rounded-xl"
          onClick={() => navigate({ to: "/procurement/rfqs" })}
        >
          <ArrowLeft className="mr-2 size-4" /> Cancel
        </Button>
      }
    >
      <form onSubmit={handleOpenPreSubmitModal} className="mx-auto max-w-4xl space-y-6">
        <SectionCard
          title="RFQ Metadata"
          description="Core identification and scheduling for this request"
          icon={FileText}
        >
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="rfq_date">RFQ Date</Label>
              <div className="relative">
                <CalendarIcon className="absolute left-3 top-3 size-4 text-muted-foreground" />
                <Input
                  id="rfq_date"
                  name="rfq_date"
                  type="date"
                  min={new Date().toISOString().split("T")[0]}
                  className={cn(inputClass, "pl-10 bg-muted/50")}
                  value={formData.rfq_date}
                  readOnly
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="material_request_number">Material Request Number</Label>
              <div className="relative">
                <FileText className="absolute left-3 top-3 size-4 text-muted-foreground" />
                <Input
                  id="material_request_number"
                  name="material_request_number"
                  className={cn(inputClass, "pl-10 bg-muted/50 font-mono text-sm font-bold text-primary")}
                  value={
                    formData.material_request_number ||
                    (loadingRequests ? "Loading material request..." : "None")
                  }
                  readOnly
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="department">Department</Label>
              <div className="relative">
                <Building2 className="absolute left-3 top-3 size-4 text-muted-foreground" />
                <Input
                  id="department"
                  name="department"
                  className={cn(inputClass, "pl-10 bg-muted/50 font-medium")}
                  value={formData.department || "—"}
                  readOnly
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="requested_by">Requested By</Label>
              <div className="relative">
                <User className="absolute left-3 top-3 size-4 text-muted-foreground" />
                <Input
                  id="requested_by"
                  name="requested_by"
                  className={cn(inputClass, "pl-10 bg-muted/50 font-medium")}
                  value={formData.requested_by || "—"}
                  readOnly
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="required_delivery_date">Required Delivery Date</Label>
              <div className="relative">
                <CalendarIcon className="absolute left-3 top-3 size-4 text-muted-foreground" />
                <Input
                  id="required_delivery_date"
                  name="required_delivery_date"
                  type="date"
                  min={new Date().toISOString().split("T")[0]}
                  className={cn(inputClass, "pl-10")}
                  value={formData.required_delivery_date}
                  onChange={handleInputChange}
                  readOnly
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="warehouse">Warehouse</Label>
              <div className="relative">
                <Building2 className="absolute left-3 top-3 size-4 text-muted-foreground" />
                <Input
                  id="warehouse"
                  name="warehouse"
                  placeholder="e.g. Pune Plant 1"
                  className={cn(inputClass, "pl-10")}
                  value={formData.warehouse}
                  onChange={handleInputChange}
                  required
                />
              </div>
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="procurement_officer">Procurement Officer</Label>
              <div className="relative">
                <User className="absolute left-3 top-3 size-4 text-muted-foreground" />
                <Input
                  id="procurement_officer"
                  name="procurement_officer"
                  placeholder="Officer name"
                  className={cn(inputClass, "pl-10")}
                  value={formData.procurement_officer}
                  onChange={handleInputChange}
                  required
                />
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Material Requirements"
          description="List materials required in this RFQ"
          icon={Package}
        >
          <div className="space-y-4">
            {items.map((item, index) => (
              <div
                key={index}
                className="rounded-2xl border border-border/80 bg-muted/20 p-5 transition-all"
              >
                <p className="mb-3 text-xs font-bold text-primary uppercase tracking-wider">
                  Item #{index + 1}
                </p>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="space-y-1.5 font-mono text-xs font-bold text-primary">
                    <Label className="text-xs font-semibold">Material Code</Label>
                    <Input
                      className="h-10 rounded-xl bg-muted/50 font-mono text-xs font-bold text-primary"
                      value={item.material_code}
                      readOnly
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Variant Code</Label>
                    <Input
                      className="h-10 rounded-xl font-mono text-xs text-teal-600 bg-muted/50 font-semibold"
                      value={item.variant_code || "—"}
                      readOnly
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Required Quantity</Label>
                    <Input
                      className="h-10 rounded-xl font-mono font-bold text-orange-600 bg-muted/50"
                      value={item.quantity ?? ""}
                      readOnly
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">UOM</Label>
                    <Input
                      className="h-10 rounded-xl font-bold uppercase text-muted-foreground bg-muted/50"
                      value={item.uom || "PCS"}
                      readOnly
                    />
                  </div>

                  <div className="space-y-1.5 sm:col-span-2 lg:col-span-4">
                    <Label className="text-xs font-semibold">Material Name &amp; Specs</Label>
                    <Input
                      className="h-10 rounded-xl font-medium bg-muted/50"
                      value={item.material_name}
                      readOnly
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="Select Suppliers"
          description="Search and select active vendors from the master data"
          icon={Building2}
        >
          <div className="mb-6 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Name or code..."
                  className="pl-10 rounded-xl"
                  value={filters.search}
                  onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                />
              </div>
              <Input
                placeholder="Material..."
                className="rounded-xl"
                value={filters.material}
                onChange={(e) => setFilters((f) => ({ ...f, material: e.target.value }))}
              />
              <Input
                placeholder="City/Location..."
                className="rounded-xl"
                value={filters.city}
                onChange={(e) => setFilters((f) => ({ ...f, city: e.target.value }))}
              />
              <select
                className="h-11 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                value={filters.category}
                onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))}
              >
                <option value="">All Categories</option>
                {availableCategories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {loadingSuppliers ? (
            <div className="flex h-48 items-center justify-center gap-2">
              <Loader2 className="size-6 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Searching supplier master...</p>
            </div>
          ) : suppliers.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground border-2 border-dashed rounded-2xl border-border/40">
              No suppliers found matching your criteria.
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {suppliers.map((s) => {
                const supplierId = supplierIdOf(s);
                const isSelected = selectedSuppliers.includes(supplierId);
                return (
                  <div
                    key={supplierId}
                    onClick={() => toggleSupplier(supplierId)}
                    className={cn(
                      "relative cursor-pointer rounded-2xl border p-4 transition-all hover:bg-accent/30",
                      isSelected
                        ? "border-primary bg-primary-soft/10 ring-1 ring-primary"
                        : "border-border/60 bg-card",
                    )}
                  >
                    <div className="flex items-start gap-4">
                      <div
                        className={cn(
                          "grid size-12 shrink-0 place-items-center rounded-xl transition-colors",
                          isSelected
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {isSelected ? (
                          <CheckCircle2 className="size-6" />
                        ) : (
                          <Building2 className="size-6" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-bold">{supplierNameOf(s)}</p>
                        </div>
                        <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">
                          {supplierCategoryText(s)}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {selectedSuppliers.length > 0 && (
            <div className="mt-4 flex items-center justify-between rounded-xl bg-primary-soft/20 px-4 py-2 border border-primary/20">
              <p className="text-xs font-semibold text-primary">
                {selectedSuppliers.length} supplier(s) selected for invitation
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[10px] text-primary hover:bg-primary-soft/30"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedSuppliers([]);
                }}
              >
                Clear all
              </Button>
            </div>
          )}
        </SectionCard>

        <div className="flex items-center justify-end gap-4 rounded-2xl border border-primary/10 bg-primary-soft/5 p-6 shadow-soft">
          <p className="hidden text-sm text-muted-foreground sm:block">
            Creating this RFQ will save a draft for review before supplier emails are sent.
          </p>
          <Button type="submit" size="lg" className="rounded-xl shadow-glow" disabled={submitting}>
            {submitting ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Save className="mr-2 size-4" />
            )}
            Create RFQ
          </Button>
        </div>
      </form>

      {/* PRE-SUBMISSION CATEGORIZED SUPPLIER REVIEW POPUP MODAL */}
      <Dialog open={showConfirmModal} onOpenChange={setShowConfirmModal}>
        <DialogContent className="max-w-2xl w-full rounded-3xl p-0 overflow-hidden border-none shadow-2xl">
          <div className="p-6 bg-gradient-to-r from-blue-600 to-indigo-600 text-white flex justify-between items-start">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <DialogTitle className="text-xl font-bold tracking-tight text-white">
                  Pre-Submission Supplier Review
                </DialogTitle>
                <Badge className="bg-white/20 text-white border-white/30 text-[10px] uppercase font-black">
                  Category Match
                </Badge>
              </div>
              <DialogDescription className="text-blue-100 text-xs">
                Review Material Request requirements and category-matched suppliers before publishing
              </DialogDescription>
            </div>
          </div>

          <div className="p-6 space-y-5">
            {/* Selected Material Request Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4 rounded-2xl bg-muted/20 border border-border/40 text-xs">
              <div>
                <p className="text-[10px] uppercase font-black text-muted-foreground">Material Request</p>
                <p className="font-mono font-bold text-primary text-sm mt-0.5">
                  {formData.material_request_number || "Direct RFQ"}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase font-black text-muted-foreground">Department</p>
                <p className="font-bold text-foreground text-sm mt-0.5">{formData.department || "Procurement"}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase font-black text-muted-foreground">Warehouse</p>
                <p className="font-bold text-foreground text-sm mt-0.5">{formData.warehouse}</p>
              </div>
            </div>

            {/* Category & Matching Suppliers Count Banner */}
            {(() => {
              const primaryCategory = items[0]?.category || filters.category || "Raw Materials";

              return (
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-950 dark:text-blue-200">
                    <div className="flex items-center gap-3">
                      <div className="size-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0 font-bold shadow-sm">
                        <Building2 className="size-5" />
                      </div>
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-wider text-blue-600 dark:text-blue-400">
                          Category: {primaryCategory}
                        </p>
                        <p className="text-sm font-bold text-foreground mt-0.5">
                          {suppliers.length} Active Supplier(s) Found for Category
                        </p>
                      </div>
                    </div>
                    <Badge variant="outline" className="font-bold text-xs bg-card border-blue-500/30">
                      {selectedSuppliers.length} Selected
                    </Badge>
                  </div>

                  {/* List of Category Suppliers */}
                  <div className="space-y-2">
                    <p className="text-[10px] uppercase font-black text-muted-foreground">
                      Categorized Suppliers To Be Invited ({selectedSuppliers.length} of {suppliers.length})
                    </p>
                    <div className="max-h-52 overflow-y-auto space-y-2 pr-1">
                      {suppliers.map((sup: any) => {
                        const supplierId = supplierIdOf(sup);
                        const isChecked = selectedSuppliers.includes(supplierId);
                        return (
                          <div
                            key={supplierId}
                            className={cn(
                              "flex items-center justify-between p-3 rounded-xl border text-xs transition-colors",
                              isChecked
                                ? "border-primary/50 bg-primary/5 text-foreground"
                                : "border-border/50 bg-muted/20 opacity-60",
                            )}
                          >
                            <div className="flex items-center gap-2.5">
                              <CheckCircle2
                                className={cn(
                                  "size-4 shrink-0",
                                  isChecked ? "text-primary" : "text-muted-foreground/40",
                                )}
                              />
                              <div>
                                <p className="font-bold text-foreground">{supplierNameOf(sup)}</p>
                                <p className="text-[10px] text-muted-foreground font-mono">
                                  {sup.gstin || sup.supplierCode || sup.supplier_code || "Active Vendor"}
                                </p>
                              </div>
                            </div>
                            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-muted text-muted-foreground border border-border/40">
                              {supplierCategoryText(sup, primaryCategory)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>

          <div className="p-4 bg-muted/10 border-t border-border/60 flex items-center justify-between">
            <Button
              type="button"
              variant="ghost"
              className="rounded-xl font-bold text-xs uppercase"
              onClick={() => setShowConfirmModal(false)}
            >
              Back to Edit
            </Button>
            <Button
              type="button"
              className="rounded-full px-8 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase shadow-glow"
              onClick={executeSubmitRfq}
              disabled={submitting}
            >
              {submitting ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Send className="mr-2 size-4" />
              )}
              Confirm &amp; Send RFQ
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
