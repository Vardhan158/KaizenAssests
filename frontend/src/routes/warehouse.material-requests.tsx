import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import {
  ClipboardList,
  Plus,
  Search,
  Filter,
  Loader2,
  Calendar,
  Clock,
  Building2,
  CheckCircle2,
  Trash2,
  Save,
  X,
  Check,
  Info,
  Send,
  AlertCircle,
} from "lucide-react";
import { AppShell, StatusBadge } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api-client";
import { getUserInfo } from "@/lib/auth-utils";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

function formatDisplayDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const str = String(dateStr);
  const clean = str.includes("T") ? str.split("T")[0] : str;
  if (!clean) return "—";
  const parts = clean.split("-");
  if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
    const year = parts[0];
    const month = parts[1];
    const day = parts[2];
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    const mIdx = parseInt(month, 10) - 1;
    if (mIdx >= 0 && mIdx < 12 && months[mIdx]) {
      return `${parseInt(day, 10)} ${months[mIdx]} ${year}`;
    }
  }
  return clean;
}

export const formatSpecCode = (code?: string): string => {
  if (!code) return "";
  return code.replace(/-V(\d+)$/i, "-S$1");
};

interface MaterialRequestSearch {
  source_requisition_id?: string;
  source_requisition_number?: string;
  department?: string;
  priority?: string;
  required_date?: string;
  remarks?: string;
  items_json?: string;
}

export const Route = createFileRoute("/warehouse/material-requests")({
  validateSearch: (search: Record<string, unknown>): MaterialRequestSearch => {
    return {
      source_requisition_id: search.source_requisition_id as string | undefined,
      source_requisition_number: search.source_requisition_number as string | undefined,
      department: search.department as string | undefined,
      priority: search.priority as string | undefined,
      required_date: search.required_date as string | undefined,
      remarks: search.remarks as string | undefined,
      items_json: search.items_json as string | undefined,
    };
  },
  component: WarehouseMaterialRequests,
});

// Assembly reuses the canonical material-request workflow through its own route.
export function MaterialRequestsPage({ mode: _mode }: { mode?: "assembly" } = {}) {
  return <WarehouseMaterialRequests />;
}
function MaterialMasterSearchCombobox({
  value,
  onSelect,
  masterMaterials,
  unavailableMaterialIds = [],
  placeholder = "Pick Material Master",
  className,
  size = "md",
}: {
  value: string;
  onSelect: (val: string) => void;
  masterMaterials: any[];
  /** Material master records selected on other request lines. */
  unavailableMaterialIds?: string[];
  placeholder?: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selectedMaterial = masterMaterials.find((m) => m.id === value || m.material_code === value);

  const filteredMaterials = useMemo(() => {
    // Keep the current row's material visible, but do not offer materials that
    // have already been selected on another row of this request.
    const availableMaterials = masterMaterials.filter(
      (material) =>
        material.id === value || !unavailableMaterialIds.includes(material.id),
    );

    if (!search.trim()) return availableMaterials;
    const q = search.toLowerCase();
    return availableMaterials.filter(
      (m) =>
        m.material_code?.toLowerCase().includes(q) ||
        m.material_name?.toLowerCase().includes(q) ||
        m.category?.toLowerCase().includes(q) ||
        m.variants?.some(
          (v: any) =>
            v.variant_code?.toLowerCase().includes(q) ||
            v.size?.toLowerCase().includes(q) ||
            v.color?.toLowerCase().includes(q) ||
            v.grade?.toLowerCase().includes(q),
        ),
    );
  }, [masterMaterials, search, unavailableMaterialIds, value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-full justify-between rounded-xl font-normal text-xs bg-background hover:bg-accent/40 border-input",
            size === "sm" ? "h-9 px-2.5" : "h-9 px-3",
            className,
          )}
        >
          <div className="flex items-center gap-1.5 truncate text-left mr-1 min-w-0">
            {selectedMaterial ? (
              <>
                <span className="font-mono font-bold text-primary shrink-0">
                  {selectedMaterial.material_code}
                </span>
                <span className="text-muted-foreground shrink-0">—</span>
                <span className="truncate">{selectedMaterial.material_name}</span>
              </>
            ) : value === "CUSTOM" ? (
              <span className="text-muted-foreground italic truncate">Manual / Custom Item</span>
            ) : (
              <span className="text-muted-foreground truncate">{placeholder}</span>
            )}
          </div>
          <Search className="size-3.5 shrink-0 opacity-50 ml-1" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[320px] sm:w-[350px] p-0 rounded-2xl shadow-xl border border-border/80 bg-popover overflow-hidden z-[100]"
        align="start"
      >
        <div className="flex items-center border-b border-border/60 px-3 py-2.5 bg-muted/20">
          <Search className="size-4 shrink-0 text-muted-foreground mr-2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search code, name, specs..."
            className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground/70"
            autoFocus
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="text-muted-foreground hover:text-foreground text-xs px-1"
            >
              ×
            </button>
          )}
        </div>
        <div className="max-h-[250px] overflow-y-auto p-1.5 divide-y divide-border/20">
          <div className="pb-1">
            <button
              type="button"
              className={cn(
                "w-full flex items-center justify-between px-3 py-2 text-xs rounded-xl text-left transition-colors",
                value === "CUSTOM" || !value
                  ? "bg-primary/10 text-primary font-bold"
                  : "hover:bg-muted text-muted-foreground italic",
              )}
              onClick={() => {
                onSelect("CUSTOM");
                setOpen(false);
                setSearch("");
              }}
            >
              <span>Manual / Custom Item</span>
              {(value === "CUSTOM" || !value) && <Check className="size-3.5 text-primary" />}
            </button>
          </div>

          <div className="pt-1 space-y-0.5">
            {filteredMaterials.length === 0 ? (
              <div className="p-4 text-center text-xs text-muted-foreground">
                No materials matching "{search}"
              </div>
            ) : (
              filteredMaterials.map((m) => {
                const isSelected = selectedMaterial?.id === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    className={cn(
                      "w-full flex items-center justify-between px-3 py-2 text-xs rounded-xl text-left transition-colors",
                      isSelected
                        ? "bg-primary/10 text-primary font-bold"
                        : "hover:bg-muted text-foreground",
                    )}
                    onClick={() => {
                      onSelect(m.id);
                      setOpen(false);
                      setSearch("");
                    }}
                  >
                    <div className="flex flex-col gap-0.5 min-w-0 pr-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-primary">{m.material_code}</span>
                        <span className="font-medium text-foreground truncate">
                          {m.material_name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        {m.category && (
                          <span className="bg-muted px-1.5 py-0.5 rounded border border-border/50">
                            {m.category}
                          </span>
                        )}
                        {m.variants && m.variants.length > 0 && (
                          <span>
                            {m.variants.length} specification{m.variants.length > 1 ? "s" : ""}
                          </span>
                        )}
                        {m.base_uom && <span>• {m.base_uom}</span>}
                      </div>
                    </div>
                    {isSelected && <Check className="size-4 text-primary shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function WarehouseMaterialRequests() {
  const searchParams = Route.useSearch();
  const [requests, setRequests] = useState<any[]>([]);
  const [masterMaterials, setMasterMaterials] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<string[]>([]);
  const [uoms, setUoms] = useState<string[]>([]);
  const [categoriesList, setCategoriesList] = useState<string[]>([
    "Raw Materials",
    "Mechanical Components",
    "Electrical",
    "Steel & Metals",
    "Fasteners & Hardware",
    "Chemicals & Coatings",
    "Pipes & Fittings",
    "Packaging",
    "Consumables",
  ]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [isCreating, setIsCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [activeSuppliers, setActiveSuppliers] = useState<any[]>([]);
  const [nextRequestNumber, setNextRequestNumber] = useState("");
  const [baseMaterialSequence, setBaseMaterialSequence] = useState(1);
  const [selectedRequest, setSelectedRequest] = useState<any>(null);
  const [isViewing, setIsRequestModalOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    request_number: "",
    warehouse_id: "Main Warehouse",
    department: "Inventory",
    requested_by: "",
    priority: "MEDIUM",
    suggested_supplier: "",
    required_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    remarks: "",
    attachments: [] as any[],
  });
  const [items, setItems] = useState<any[]>([
    {
      material_id: "",
      material_variant_id: "",
      material_code: "",
      variant_code: "",
      material_name: "",
      quantity: 1,
      uom: "",
      category: "Raw Materials",
    },
  ]);
  const fetchData = async () => {
    try {
      setLoading(true);
      const [reqData, matData, locationData, uomData, catData] = await Promise.all([
        api.getMaterialRequests(),
        api.getMaterials({ status: "Active" }).catch(() => []),
        api.getStorageLocations().catch(() => []),
        api.getMaterialUoms().catch(() => []),
        api.getMaterialCategories().catch(() => []),
      ]);

      api.getSuppliers({ status: "Active" })
        .then((sups) => setActiveSuppliers(sups || []))
        .catch(() => {});
      setRequests(reqData);
      setMasterMaterials(matData);
      const warehouseIds = [...new Set(locationData.map((row: any) => row.warehouse_id).filter(Boolean))] as string[];
      setWarehouses(warehouseIds.sort());
      setUoms(uomData);
      if (catData && catData.length > 0) {
        setCategoriesList(catData);
      }
      setFormData((prev) => ({
        ...prev,
        warehouse_id: prev.warehouse_id || "Main Warehouse",
      }));
    } catch (error) {
      toast.error("Failed to load requests");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    fetchData();
    const user = getUserInfo();
    setFormData((prev) => ({ ...prev, requested_by: user?.username?.trim() || "" }));
  }, []);

  // Pre-fill from Assembly Requisition shortage redirect
  useEffect(() => {
    if (searchParams.source_requisition_id || searchParams.items_json) {
      const handlePreFill = async () => {
        try {
          const { requestNumber, nextMaterialSequence } =
            (await api.getNextMaterialRequestNumber().catch(() => ({
              requestNumber: "MR-PENDING",
              nextMaterialSequence: 1,
            }))) as any;
          setNextRequestNumber(requestNumber);
          setBaseMaterialSequence(nextMaterialSequence || 1);

          let parsedItems: any[] = [];
          if (searchParams.items_json) {
            try {
              parsedItems = JSON.parse(searchParams.items_json);
            } catch {}
          }

          // Auto-fetch from the API if items_json is missing or failed to parse
          if (parsedItems.length === 0 && searchParams.source_requisition_id) {
            try {
              // Fetch the specific requisition which is guaranteed to include its detailed items
              const req = await (api as any).getAssemblyRequisition?.(searchParams.source_requisition_id).catch(() => null);
              if (req && req.items) {
                parsedItems = req.items
                  .map((it: any) => {
                    const reqQ = Number(it.required_quantity ?? it.requested_quantity ?? it.quantity ?? 0);
                    const resQ = Number(it.reserved_quantity ?? 0);
                    const shortageQ = Number(it.shortage_quantity ?? Math.max(0, reqQ - resQ));
                    if (shortageQ > 0) {
                      return {
                        material_id: it.material_id || it.materialId || "",
                        material_variant_id: it.material_variant_id || it.materialVariantId || "",
                        material_code: it.material_code || it.materialCode || "CUSTOM",
                        variant_code: it.variant_code || it.variantCode || "",
                        material_name:
                          it.material_name ||
                          it.materialName ||
                          it.custom_material_name ||
                          it.customMaterialName ||
                          "Material",
                        quantity: shortageQ,
                        uom: it.uom || "PCS",
                        category: it.category || "Raw Materials",
                        is_custom: Boolean(it.is_custom || it.isCustom || !it.material_id),
                        custom_material_name: it.custom_material_name || it.customMaterialName || null,
                      };
                    }
                    return null;
                  })
                  .filter(Boolean);
              }
            } catch (err) {
              console.error("Failed to auto-fetch assembly requisition items", err);
            }
          }

          if (parsedItems && parsedItems.length > 0) {
            setItems(
              parsedItems.map((it: any) => ({
                material_id: it.material_id || it.materialId || "",
                material_variant_id: it.material_variant_id || it.materialVariantId || "",
                material_code: it.material_code || it.materialCode || "CUSTOM",
                variant_code: it.variant_code || it.variantCode || "",
                material_name:
                  it.material_name ||
                  it.materialName ||
                  it.custom_material_name ||
                  it.customMaterialName ||
                  "Material",
                quantity: it.quantity || 1,
                uom: it.uom || "PCS",
                category: it.category || "Raw Materials",
                is_custom: Boolean(it.is_custom || it.isCustom || !it.material_id),
                custom_material_name: it.custom_material_name || it.customMaterialName || null,
              })),
            );
          }

          const user = getUserInfo();
          setFormData((prev) => ({
            ...prev,
            request_number: requestNumber || prev.request_number,
            warehouse_id: prev.warehouse_id || "Main Warehouse",
            department: searchParams.department || prev.department || "Assembly",
            priority: (searchParams.priority || "HIGH").toUpperCase(),
            required_date:
              searchParams.required_date ||
              prev.required_date ||
              new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
            remarks:
              searchParams.remarks ||
              (searchParams.source_requisition_number
                ? `Shortage fulfillment for Assembly Requisition ${searchParams.source_requisition_number}`
                : prev.remarks),
            requested_by: user?.username?.trim() || prev.requested_by || "",
          }));
          setIsCreating(true);
        } catch {
          setIsCreating(true);
        }
      };
      handlePreFill();
    }
  }, [searchParams.source_requisition_id, searchParams.items_json, searchParams.source_requisition_number, searchParams.department, searchParams.priority, searchParams.required_date, searchParams.remarks]);
  const addItem = () => {
    const nextSeq = baseMaterialSequence + items.length;
    const code = `MAT-${String(nextSeq).padStart(3, "0")}`;
    setItems([
      ...items,
      {
        material_id: "",
        material_variant_id: "",
        material_code: code,
        variant_code: "",
        material_name: "",
        quantity: 1,
        uom: "",
      },
    ]);
  };
  const removeItem = (idx: number) => {
    if (items.length === 1) return;
    setItems(items.filter((_, i) => i !== idx));
  };
  const handleItemChange = (idx: number, field: string, value: any) => {
    setItems(items.map((it, i) => (i === idx ? { ...it, [field]: value } : it)));
  };
  const handleSelectMasterMaterial = (idx: number, matId: string) => {
    const foundMat = masterMaterials.find((m) => m.id === matId);
    if (!foundMat) return;
    const defaultVariant =
      foundMat.variants && foundMat.variants.length > 0 ? foundMat.variants[0] : null;
    const specDetails = defaultVariant
      ? [defaultVariant.size, defaultVariant.color, defaultVariant.grade].filter(Boolean).join(", ")
      : "";
    const nameWithSpec = specDetails
      ? `${foundMat.material_name} (${specDetails})`
      : foundMat.material_name;
    const matCat = Array.isArray(foundMat.category)
      ? foundMat.category[0] || "Raw Materials"
      : foundMat.category || "Raw Materials";

    setItems(
      items.map((it, i) =>
        i === idx
          ? {
              ...it,
              material_id: foundMat.id,
              material_variant_id: defaultVariant?.id || "",
              material_code: foundMat.material_code,
              variant_code: formatSpecCode(defaultVariant?.variant_code) || "",
              material_name: nameWithSpec,
              category: matCat,
              uom: defaultVariant?.uom || foundMat.base_uom || "",
            }
          : it,
      ),
    );
  };
  const handleSelectVariant = (idx: number, variantId: string) => {
    const currentItem = items[idx];
    const foundMat = masterMaterials.find((m) => m.id === currentItem.material_id);
    if (!foundMat) return;
    const foundVar = foundMat.variants?.find((v: any) => v.id === variantId);
    if (!foundVar) return;
    const specDetails = [foundVar.size, foundVar.color, foundVar.grade].filter(Boolean).join(", ");
    const nameWithSpec = specDetails
      ? `${foundMat.material_name} (${specDetails})`
      : foundMat.material_name;

    setItems(
      items.map((it, i) =>
        i === idx
          ? {
              ...it,
              material_variant_id: foundVar.id,
              variant_code: formatSpecCode(foundVar.variant_code),
              material_name: nameWithSpec,
              uom: foundVar.uom || foundMat.base_uom || "",
            }
          : it,
      ),
    );
  };
  const handleEditItemChange = (idx: number, field: string, value: any) => {
    if (!selectedRequest) return;
    const newItems = [...selectedRequest.items];
    newItems[idx] = { ...newItems[idx], [field]: value };
    setSelectedRequest({ ...selectedRequest, items: newItems });
  };
  const handleEditSelectMasterMaterial = (idx: number, matId: string) => {
    if (!selectedRequest) return;
    const newItems = [...selectedRequest.items];
    if (matId === "CUSTOM") {
      newItems[idx] = {
        ...newItems[idx],
        materialId: "",
        materialVariantId: "",
        variantCode: "",
      };
      setSelectedRequest({ ...selectedRequest, items: newItems });
      return;
    }
    const foundMat = masterMaterials.find((m) => m.id === matId);
    if (!foundMat) return;
    const defaultVariant =
      foundMat.variants && foundMat.variants.length > 0 ? foundMat.variants[0] : null;
    const specDetails = defaultVariant
      ? [defaultVariant.size, defaultVariant.color, defaultVariant.grade].filter(Boolean).join(", ")
      : "";
    const nameWithSpec = specDetails
      ? `${foundMat.material_name} (${specDetails})`
      : foundMat.material_name;
    const matCat = Array.isArray(foundMat.category)
      ? foundMat.category[0] || "Raw Materials"
      : foundMat.category || "Raw Materials";

    newItems[idx] = {
      ...newItems[idx],
      materialId: foundMat.id,
      materialVariantId: defaultVariant?.id || "",
      materialCode: foundMat.material_code,
      variantCode: formatSpecCode(defaultVariant?.variant_code) || "",
      materialName: nameWithSpec,
      category: matCat,
      uom: defaultVariant?.uom || foundMat.base_uom || "",
    };
    setSelectedRequest({ ...selectedRequest, items: newItems });
  };
  const handleEditSelectVariant = (idx: number, variantId: string) => {
    if (!selectedRequest) return;
    const newItems = [...selectedRequest.items];
    const currentItem = newItems[idx];
    const foundMat = masterMaterials.find(
      (m) => m.id === currentItem.materialId || m.material_code === currentItem.materialCode,
    );
    if (!foundMat) return;
    const foundVar = foundMat.variants?.find((v: any) => v.id === variantId);
    if (!foundVar) return;
    const specDetails = [foundVar.size, foundVar.color, foundVar.grade].filter(Boolean).join(", ");
    const nameWithSpec = specDetails
      ? `${foundMat.material_name} (${specDetails})`
      : foundMat.material_name;

    newItems[idx] = {
      ...newItems[idx],
      materialVariantId: foundVar.id,
      variantCode: formatSpecCode(foundVar.variant_code),
      materialName: nameWithSpec,
      uom: foundVar.uom || foundMat.base_uom || "",
    };
    setSelectedRequest({ ...selectedRequest, items: newItems });
  };
  const addEditItem = () => {
    if (!selectedRequest) return;
    const nextSeq = baseMaterialSequence + selectedRequest.items.length;
    const code = `MAT-${String(nextSeq).padStart(3, "0")}`;
    const newItem = {
      materialId: "",
      materialVariantId: "",
      materialCode: code,
      variantCode: "",
      materialName: "",
      quantity: 1,
      uom: "",
    };
    setSelectedRequest({ ...selectedRequest, items: [...selectedRequest.items, newItem] });
  };
  const removeEditItem = (idx: number) => {
    if (!selectedRequest || selectedRequest.items.length <= 1) return;
    const newItems = selectedRequest.items.filter((_: any, i: number) => i !== idx);
    setSelectedRequest({ ...selectedRequest, items: newItems });
  };
  const handleOpenPreSubmitModal = (e: React.FormEvent) => {
    e.preventDefault();
    const requester = formData.requested_by.trim() || getUserInfo()?.username?.trim() || "";
    if (!requester) {
      toast.error("Your user session is missing. Please sign in again before submitting.");
      return;
    }
    if (!items || items.length === 0) {
      toast.error("Please add at least one material item");
      return;
    }
    if (items.some((it) => !it.material_name?.trim())) {
      toast.error("Please fill in material description for all items");
      return;
    }
    if (
      items.some(
        (it) => !it.quantity || parseFloat(it.quantity) <= 0 || isNaN(parseFloat(it.quantity)),
      )
    ) {
      toast.error("Quantity must be strictly greater than 0 for all items");
      return;
    }
    setShowConfirmModal(true);
  };

  const executeSubmitRequest = async () => {
    const requester = formData.requested_by.trim() || getUserInfo()?.username?.trim() || "";
    setSubmitting(true);
    try {
      const itemCategories = [...new Set(items.map((it) => it.category).filter(Boolean))];
      const primaryCategory = itemCategories[0] || "Raw Materials";
      const matchingSuppliers = activeSuppliers.filter((s: any) =>
        Array.isArray(s.category)
          ? s.category.some((c: string) => c.toLowerCase() === primaryCategory.toLowerCase())
          : (s.category || "").toLowerCase() === primaryCategory.toLowerCase(),
      );

      let finalRemarks = formData.remarks.trim();
      if (matchingSuppliers.length === 0) {
        const note = `[Note to Procurement: No active suppliers found in master data for category '${primaryCategory}'. Sourcing & vendor onboarding required.]`;
        finalRemarks = finalRemarks ? `${finalRemarks}\n${note}` : note;
      }

      const itemsToSubmit = items.map((it) => ({
        ...it,
        category: it.category || "Raw Materials",
        variant_code: formatSpecCode(it.variant_code),
      }));

      await api.createMaterialRequest({
        ...formData,
        remarks: finalRemarks,
        warehouse_id: formData.warehouse_id || "Main Warehouse",
        requested_by: requester,
        items: itemsToSubmit,
      });

      toast.success(
        matchingSuppliers.length === 0
          ? "Request submitted to Procurement (Vendor Sourcing Required)"
          : "Material request submitted to Procurement",
      );
      toast.success("Material request submitted to Procurement");
      setShowConfirmModal(false);
      setIsCreating(false);
      setItems([
        {
          material_id: "",
          material_variant_id: "",
          material_code: "",
          variant_code: "",
          material_name: "",
          quantity: 1,
          uom: "",
        },
      ]);
      setFormData((prev) => ({
        ...prev,
        request_number: "",
        warehouse_id: "Main Warehouse",
        priority: "MEDIUM",
        suggested_supplier: "",
        attachments: [],
      }));
      window.dispatchEvent(new Event("material-requests:changed"));
      fetchData();
    } catch (error: any) {
      toast.error("Failed to submit request: " + (error.message || "Unknown error"));
    } finally {
      setSubmitting(false);
    }
  };
  const startCreating = async () => {
    try {
      const { requestNumber, nextMaterialSequence } =
        (await api.getNextMaterialRequestNumber()) as any;
      setNextRequestNumber(requestNumber);
      setBaseMaterialSequence(nextMaterialSequence || 1);
      const initialCode = `MAT-${String(nextMaterialSequence || 1).padStart(3, "0")}`;
      setFormData((prev) => ({
        ...prev,
        request_number: requestNumber,
        warehouse_id: "Main Warehouse",
      }));
      setItems([
        {
          material_id: "",
          material_variant_id: "",
          material_code: initialCode,
          variant_code: "",
          material_name: "",
          quantity: 1,
          uom: "",
        },
      ]);
      setIsCreating(true);
    } catch (error) {
      toast.error("Failed to generate request number");
    }
  };
  const handleRequestClick = (req: any) => {
    const rawReq = JSON.parse(JSON.stringify(req));
    const normalizedItems = (rawReq.items || []).map((it: any) => {
      const matId =
        it.materialId ||
        it.material_id ||
        masterMaterials.find((m) => m.material_code === (it.materialCode || it.material_code))
          ?.id ||
        "";
      const foundMat = masterMaterials.find(
        (m) => m.id === matId || m.material_code === (it.materialCode || it.material_code),
      );
      const varId =
        it.materialVariantId ||
        it.material_variant_id ||
        foundMat?.variants?.find((v: any) => v.variant_code === (it.variantCode || it.variant_code))
          ?.id ||
        "";
      return {
        materialId: matId,
        materialVariantId: varId,
        materialCode: it.materialCode || it.material_code || "",
        variantCode: it.variantCode || it.variant_code || "",
        materialName: it.materialName || it.material_name || "",
        quantity: it.quantity,
        uom: it.uom,
      };
    });
    setSelectedRequest({
      ...rawReq,
      items: normalizedItems,
    });
    setIsRequestModalOpen(true);
    setIsEditing(false);
  };
  const handleUpdate = async () => {
    if (!selectedRequest) return;
    if (!selectedRequest.items || selectedRequest.items.length === 0) {
      toast.error("Please add at least one material item");
      return;
    }
    if (selectedRequest.items.some((it: any) => !(it.materialName || it.material_name)?.trim())) {
      toast.error("Please fill in material description for all items");
      return;
    }
    if (
      selectedRequest.items.some(
        (it: any) => !it.quantity || parseFloat(it.quantity) <= 0 || isNaN(parseFloat(it.quantity)),
      )
    ) {
      toast.error("Quantity must be strictly greater than 0 for all items");
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        request_number: selectedRequest.requestNumber || selectedRequest.request_number,
        warehouse_id: selectedRequest.warehouseId || selectedRequest.warehouse_id,
        department: selectedRequest.department,
        requested_by: selectedRequest.requestedBy || selectedRequest.requested_by,
        priority: selectedRequest.priority || "MEDIUM",
        suggested_supplier: selectedRequest.suggestedSupplier || selectedRequest.suggested_supplier || "",
        attachments: selectedRequest.attachments || [],
        required_date: new Date(selectedRequest.requiredDate || selectedRequest.required_date)
          .toISOString()
          .split("T")[0],
        remarks: selectedRequest.remarks,
        items: selectedRequest.items.map((it: any) => ({
          material_id: it.materialId || it.material_id || null,
          material_variant_id: it.materialVariantId || it.material_variant_id || null,
          material_code: it.materialCode || it.material_code,
          variant_code: it.variantCode || it.variant_code,
          material_name: it.materialName || it.material_name,
          quantity: parseFloat(it.quantity) || 1,
          uom: it.uom,
        })),
      };
      await api.updateMaterialRequest(selectedRequest.id, payload);
      toast.success("Request updated successfully");
      setIsEditing(false);
      setIsRequestModalOpen(false);
      window.dispatchEvent(new Event("material-requests:changed"));
      fetchData();
    } catch (error: any) {
      toast.error("Update failed: " + (error.message || "Unknown error"));
    } finally {
      setSubmitting(false);
    }
  };

  const changeStatus = async (nextStatus: string, comments?: string) => {
    if (!selectedRequest) return;
    try {
      const updated = await api.updateMaterialRequestStatus(
        selectedRequest.id,
        nextStatus,
        comments,
        getUserInfo()?.username || "Warehouse Manager",
      );
      setSelectedRequest(updated);
      setRequests((current) =>
        current.map((req) => (req.id === selectedRequest.id ? updated : req)),
      );
      toast.success(`Material request moved to ${nextStatus}`);
      window.dispatchEvent(new Event("material-requests:changed"));
      fetchData();
    } catch (error: any) {
      toast.error(error.message || "Unable to update material request status");
    }
  };

  const filteredRequests = useMemo(() => {
    return requests.filter((r) => {
      const matchesStatus =
        statusFilter === "ALL" || (r.status || "").toUpperCase() === statusFilter.toUpperCase();
      const q = search.trim().toLowerCase();
      const reqNum = (r.requestNumber || r.request_number || "").toLowerCase();
      const matchesSearch =
        !q ||
        reqNum.includes(q) ||
        (r.department || "").toLowerCase().includes(q) ||
        (r.remarks || "").toLowerCase().includes(q) ||
        (r.items || []).some((it: any) =>
          (it.materialName || it.material_name || it.materialCode || it.material_code || "")
            .toLowerCase()
            .includes(q),
        );
      return matchesStatus && matchesSearch;
    });
  }, [requests, search, statusFilter]);

  return (
    <AppShell
      title={
        <div className="flex items-center gap-2">
          <span>Warehouse Material Requests</span>
          <TooltipProvider>
            <Tooltip delayDuration={200}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Material Requests Info"
                  className="inline-flex items-center text-muted-foreground hover:text-foreground transition-colors cursor-help"
                >
                  <Info className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-xs text-xs">
                View and process material requirements submitted by warehouse users for procurement.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      }
      subtitle="Request stocks and consumables from the procurement team"
      actions={
        <Button className="rounded-xl shadow-glow" onClick={startCreating}>
          <Plus className="mr-2 size-4" /> New Request
        </Button>
      }
    >
      {isCreating ? (
        <Card className="mb-8 overflow-hidden rounded-2xl border-border/70 shadow-soft animate-in slide-in-from-top-4">
          <CardHeader className="border-b border-border/70 bg-muted/20 px-5 py-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold tracking-tight">
                Create Stock Requirement
              </CardTitle>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full"
                onClick={() => setIsCreating(false)}
              >
                <X className="size-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-5 sm:p-6">
            <form onSubmit={handleOpenPreSubmitModal} className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Request Number</Label>
                  <Input
                    value={formData.request_number}
                    readOnly
                    className="h-10 rounded-xl bg-muted/50 font-mono text-sm"
                    placeholder="MR-2026-XXXX"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Warehouse</Label>
                  <Input
                    value={formData.warehouse_id || "Main Warehouse"}
                    readOnly
                    className="h-10 rounded-xl bg-muted/50 text-sm font-medium"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Department</Label>
                  <Input
                    value={formData.department}
                    onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                    className="h-10 rounded-xl text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Required Date</Label>
                  <Input
                    type="date"
                    min={new Date().toISOString().split("T")[0]}
                    value={formData.required_date}
                    onChange={(e) => setFormData({ ...formData, required_date: e.target.value })}
                    className="h-10 rounded-xl text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Priority</Label>
                  <Select
                    value={formData.priority}
                    onValueChange={(value) => setFormData({ ...formData, priority: value })}
                  >
                    <SelectTrigger className="h-10 rounded-xl text-sm">
                      <SelectValue placeholder="Priority" />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                      {["LOW", "MEDIUM", "HIGH", "URGENT"].map((priority) => (
                        <SelectItem key={priority} value={priority}>
                          {priority}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Label className="text-xs font-semibold text-foreground">
                    Material Items
                  </Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 rounded-xl px-3 text-xs font-medium"
                    onClick={addItem}
                  >
                    <Plus className="size-3 mr-1" /> Add Item
                  </Button>
                </div>

                <div className="rounded-2xl border border-border/60 overflow-hidden bg-card shadow-inner">
                  <div className="overflow-x-auto">
                    <table className="w-full table-fixed text-left text-sm border-collapse min-w-[800px]">
                      <colgroup>
                        <col className="w-[20%]" />
                        <col className="w-[18%]" />
                        <col className="w-[24%]" />
                        <col className="w-[15%]" />
                        <col className="w-[10%]" />
                        <col className="w-[8%]" />
                        <col className="w-[5%]" />
                      </colgroup>
                      <thead>
                        <tr className="bg-muted/40 border-b border-border/60">
                          <th className="p-3 text-[10px] uppercase font-black text-muted-foreground truncate">Material Master</th>
                          <th className="p-3 text-[10px] uppercase font-black text-muted-foreground truncate">Specification</th>
                          <th className="p-3 text-[10px] uppercase font-black text-muted-foreground truncate">Material Description</th>
                          <th className="p-3 text-[10px] uppercase font-black text-muted-foreground truncate">Category</th>
                          <th className="p-3 text-[10px] uppercase font-black text-muted-foreground text-center truncate">Qty</th>
                          <th className="p-3 text-[10px] uppercase font-black text-muted-foreground truncate">UOM</th>
                          <th className="p-3 text-right"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {items.map((item, idx) => {
                          const selectedMat = masterMaterials.find((m) => m.id === item.material_id);
                          return (
                            <tr key={idx} className="hover:bg-muted/10 transition-colors">
                              <td className="p-2 min-w-0">
                                <MaterialMasterSearchCombobox
                                  value={item.material_id || "CUSTOM"}
                                  unavailableMaterialIds={items
                                    .filter((otherItem, otherIdx) => otherIdx !== idx)
                                    .map((otherItem) => otherItem.material_id)
                                    .filter(Boolean)}
                                  onSelect={(val) => {
                                    if (val === "CUSTOM") {
                                      setItems(
                                        items.map((it, i) =>
                                          i === idx
                                            ? { ...it, material_id: "", material_variant_id: "", variant_code: "" }
                                            : it
                                        )
                                      );
                                    } else {
                                      handleSelectMasterMaterial(idx, val);
                                    }
                                  }}
                                  masterMaterials={masterMaterials}
                                  size="sm"
                                />
                              </td>
                              <td className="p-2 min-w-0">
                                <Select
                                  value={item.material_variant_id || selectedMat?.variants?.[0]?.id || ""}
                                  onValueChange={(val) => handleSelectVariant(idx, val)}
                                  disabled={!selectedMat?.variants?.length}
                                >
                                  <SelectTrigger className="h-9 w-full rounded-xl bg-background text-xs truncate">
                                    <SelectValue placeholder="No spec" />
                                  </SelectTrigger>
                                  <SelectContent className="rounded-xl max-h-60">
                                    {selectedMat?.variants?.map((v: any) => {
                                      const spec = [v.size, v.color, v.grade].filter(Boolean).join(" · ");
                                      return (
                                        <SelectItem key={v.id} value={v.id} className="text-xs">
                                          <span className="font-mono font-bold">{formatSpecCode(v.variant_code)}</span>{" "}
                                          {spec && `(${spec})`}
                                        </SelectItem>
                                      );
                                    })}
                                  </SelectContent>
                                </Select>
                              </td>
                              <td className="p-2 min-w-0">
                                <Input
                                  placeholder="e.g. Wire 1.5mm Red PVC..."
                                  className={cn(
                                    "h-9 rounded-xl text-xs transition-colors",
                                    Boolean(item.material_id)
                                      ? "bg-muted/50 font-medium cursor-not-allowed text-foreground border-border/60"
                                      : "bg-background"
                                  )}
                                  value={item.material_name}
                                  readOnly={Boolean(item.material_id)}
                                  onChange={(e) => handleItemChange(idx, "material_name", e.target.value)}
                                />
                              </td>
                              <td className="p-2 min-w-0">
                                <Select
                                  value={item.category || selectedMat?.category || "Raw Materials"}
                                  onValueChange={(val) => handleItemChange(idx, "category", val)}
                                >
                                  <SelectTrigger className="h-9 w-full rounded-xl bg-background text-xs truncate">
                                    <SelectValue placeholder="Category..." />
                                  </SelectTrigger>
                                  <SelectContent className="rounded-xl">
                                    {categoriesList.map((cat) => (
                                      <SelectItem key={cat} value={cat} className="text-xs">
                                        {cat}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </td>
                              <td className="p-2 min-w-0">
                                <Input
                                  type="number"
                                  min="1"
                                  className="h-9 rounded-xl bg-background text-center text-xs tabular-nums"
                                  value={item.quantity}
                                  onChange={(e) => handleItemChange(idx, "quantity", e.target.value)}
                                />
                              </td>
                              <td className="p-2 min-w-0">
                                <Select
                                  value={item.uom}
                                  onValueChange={(value) => handleItemChange(idx, "uom", value)}
                                >
                                  <SelectTrigger className="h-9 w-full rounded-xl bg-background text-xs truncate">
                                    <SelectValue placeholder="UOM" />
                                  </SelectTrigger>
                                  <SelectContent className="rounded-xl">
                                    {uoms.map((uom) => (
                                      <SelectItem key={uom} value={uom} className="text-xs rounded-lg">
                                        {uom}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </td>
                              <td className="p-2 text-center">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="size-8 rounded-lg text-destructive hover:bg-destructive/10 disabled:opacity-30"
                                  onClick={() => removeItem(idx)}
                                  disabled={items.length === 1}
                                >
                                  <Trash2 className="size-4" />
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Informational Alert for Selected Categories */}
                <div className="rounded-2xl p-4 bg-muted/20 border border-border/50 space-y-2">
                  <div className="flex items-center gap-2">
                    <Info className="size-4 text-primary shrink-0" />
                    <span className="text-xs font-bold text-foreground">
                      Category Supplier Availability (Informational Alert)
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2.5">
                    {[
                      ...new Set(
                        items.map((it) => it.category || "Raw Materials").filter(Boolean),
                      ),
                    ].map((catName) => {
                      const supCount = activeSuppliers.filter((s: any) =>
                        Array.isArray(s.category)
                          ? s.category.some(
                              (c: string) => c.toLowerCase() === catName.toLowerCase(),
                            )
                          : (s.category || "").toLowerCase() === catName.toLowerCase(),
                      ).length;
                      return (
                        <div
                          key={catName}
                          className={cn(
                            "px-3 py-1.5 rounded-xl border text-xs font-medium flex items-center gap-2",
                            supCount > 0
                              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-300"
                              : "bg-amber-500/10 border-amber-500/30 text-amber-800 dark:text-amber-300",
                          )}
                        >
                          <strong>{catName}:</strong>
                          <span>
                            {supCount > 0
                              ? `${supCount} active supplier${supCount > 1 ? "s" : ""} available for this category`
                              : "No active suppliers found for this category"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    * Informational notice: Supplier availability will not prevent submission. You can submit to Procurement with 0, 1, or multiple active suppliers.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-medium">Remarks / Justification</Label>
                <Textarea
                  placeholder="Why is this stock needed?"
                  className="min-h-24 resize-y rounded-xl text-sm"
                  value={formData.remarks}
                  onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                />
              </div>

              <div className="flex flex-col-reverse gap-3 border-t border-border/70 pt-5 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  className="h-10 rounded-xl px-5"
                  onClick={() => setIsCreating(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" className="h-10 rounded-xl px-8 shadow-glow" disabled={submitting}>
                  {submitting ? (
                    <Loader2 className="size-4 animate-spin mr-2" />
                  ) : (
                    <Save className="size-4 mr-2" />
                  )}
                  Submit Request
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="relative w-72">
          <Search className="size-3.5 absolute left-3 top-2.5 text-muted-foreground" />
          <Input
            placeholder="Search request or item..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9 text-xs rounded-xl bg-background/60 border-border/40"
          />
        </div>

        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44 h-9 text-xs rounded-xl border-border/40">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Status</SelectItem>
              <SelectItem value="DRAFT">Draft</SelectItem>
              <SelectItem value="SUBMITTED">Submitted</SelectItem>
              <SelectItem value="PENDING APPROVAL">Pending Approval</SelectItem>
              <SelectItem value="APPROVED">Approved</SelectItem>
              <SelectItem value="REJECTED">Rejected</SelectItem>
              <SelectItem value="ORDERED">Ordered</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            size="sm"
            onClick={fetchData}
            className="h-9 rounded-xl text-xs"
          >
            Refresh
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
          <Loader2 className="size-8 animate-spin text-primary" />
          <p className="text-sm">Loading material requests...</p>
        </div>
      ) : filteredRequests.length === 0 ? (
        <Card className="border-dashed border-border/60 p-12 text-center bg-card/40">
          <ClipboardList className="size-10 mx-auto text-muted-foreground opacity-40 mb-3" />
          <h3 className="text-sm font-bold text-foreground">No Requests Found</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
            {search ? "No requests match your filters." : "Create a new request to notify the procurement team."}
          </p>
        </Card>
      ) : (
        <div className="grid gap-4">
          {filteredRequests.map((req) => (
            <Card
              key={req.id}
              className="border-border/40 hover:border-primary/40 transition-colors shadow-soft cursor-pointer group"
              onClick={() => handleRequestClick(req)}
            >
              <CardContent className="p-5">
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                  <div className="space-y-3 flex-1">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="font-mono text-sm font-bold text-foreground">
                        {req.requestNumber || req.request_number}
                      </span>
                      <StatusBadge status={req.status} />
                      {req.priority && (
                        <span
                          className={cn(
                            "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase",
                            req.priority === "URGENT"
                              ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                              : req.priority === "HIGH"
                                ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                                : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
                          )}
                        >
                          {req.priority}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Building2 className="size-3.5" /> Department:{" "}
                        <strong className="text-foreground">{req.department}</strong>
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="size-3.5" /> Required:{" "}
                        <strong className="text-foreground">
                          {new Date(req.requiredDate || req.required_date).toLocaleDateString()}
                        </strong>
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {req.items?.map((item: any, idx: number) => (
                        <span
                          key={idx}
                          className="text-[10px] text-primary/80 bg-primary/10 px-2 py-0.5 rounded-md border border-primary/20 font-bold"
                        >
                          {item.materialCode || item.material_code}: {Math.floor(item.quantity)}{" "}
                          {item.uom}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2 text-right shrink-0">
                    <div>
                      <p className="text-[10px] uppercase font-bold text-muted-foreground mb-0.5">
                        Created At
                      </p>
                      <p className="text-xs font-bold tabular-nums">
                        {new Date(req.createdAt || req.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-xl h-8 text-xs mt-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRequestClick(req);
                      }}
                    >
                      View Details
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={isViewing} onOpenChange={setIsRequestModalOpen}>
        <DialogContent className="max-w-4xl w-full rounded-3xl p-0 overflow-hidden border-none shadow-2xl [&>button]:text-white/70 hover:[&>button]:text-white [&>button]:top-6 [&>button]:right-6">
          {selectedRequest && (
            <div className="flex flex-col h-full max-h-[90vh] w-full min-w-0 overflow-hidden">
              <div className={cn("p-6 text-white flex justify-between items-start", "bg-blue-600")}>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <DialogTitle className="text-xl font-bold tracking-tight">
                      {isEditing ? "Edit Request" : "Request Details"}
                    </DialogTitle>
                    {!isEditing && <StatusBadge status={selectedRequest.status} />}
                  </div>
                  <p className="text-white/70 text-sm font-mono font-bold tracking-widest">
                    {selectedRequest.requestNumber}
                  </p>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6 w-full min-w-0">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-2xl bg-muted/20 border border-border/40">
                  <div className="space-y-1 min-w-0">
                    <Label className="text-[10px] uppercase font-black text-muted-foreground">
                      Department
                    </Label>
                    {isEditing ? (
                      <Input
                        value={selectedRequest.department}
                        onChange={(e) =>
                          setSelectedRequest({ ...selectedRequest, department: e.target.value })
                        }
                        className="h-9 rounded-xl text-sm bg-background w-full min-w-0"
                      />
                    ) : (
                      <p className="font-bold text-sm truncate">{selectedRequest.department}</p>
                    )}
                  </div>
                  <div className="space-y-1 min-w-0">
                    <Label className="text-[10px] uppercase font-black text-muted-foreground">
                      Required Date
                    </Label>
                    {isEditing ? (
                      <Input
                        type="date"
                        min={new Date().toISOString().split("T")[0]}
                        value={new Date(selectedRequest.requiredDate).toISOString().split("T")[0]}
                        onChange={(e) =>
                          setSelectedRequest({ ...selectedRequest, requiredDate: e.target.value })
                        }
                        className="h-9 rounded-xl text-sm font-mono bg-background w-full min-w-0"
                      />
                    ) : (
                      <p className="font-bold text-sm tabular-nums">
                        {formatDisplayDate(selectedRequest.requiredDate)}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1 min-w-0">
                    <Label className="text-[10px] uppercase font-black text-muted-foreground">
                      Requested By
                    </Label>
                    <p className="font-bold text-sm truncate">{selectedRequest.requestedBy}</p>
                  </div>
                  <div className="space-y-1 min-w-0 sm:text-right">
                    <Label className="text-[10px] uppercase font-black text-muted-foreground">
                      Warehouse
                    </Label>
                    <p className="font-bold text-sm truncate">{selectedRequest.warehouseId || selectedRequest.warehouse_id || "Main Warehouse"}</p>
                  </div>
                  <div className="space-y-1 min-w-0">
                    <Label className="text-[10px] uppercase font-black text-muted-foreground">
                      Priority
                    </Label>
                    {isEditing ? (
                      <Select
                        value={selectedRequest.priority || "MEDIUM"}
                        onValueChange={(value) =>
                          setSelectedRequest({ ...selectedRequest, priority: value })
                        }
                      >
                        <SelectTrigger className="h-9 rounded-xl text-sm bg-background">
                          <SelectValue placeholder="Priority" />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl">
                          {["LOW", "MEDIUM", "HIGH", "URGENT"].map((priority) => (
                            <SelectItem key={priority} value={priority}>
                              {priority}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <p className="font-bold text-sm truncate">{selectedRequest.priority || "MEDIUM"}</p>
                    )}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-[10px] uppercase font-black text-muted-foreground">
                      Requested Materials
                    </Label>
                    {isEditing && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 rounded-lg text-[10px] font-bold"
                        onClick={addEditItem}
                      >
                        <Plus className="size-3 mr-1" /> Add Item
                      </Button>
                    )}
                  </div>

                  <div className="rounded-2xl border border-border/60 overflow-hidden bg-muted/5 shadow-inner">
                    <table className="w-full table-fixed text-left text-sm border-collapse">
                      <colgroup>
                        <col className="w-[18%]" />
                        <col className="w-[20%]" />
                        <col className="w-[25%]" />
                        <col className="w-[17%]" />
                        <col className="w-[10%]" />
                        <col className="w-[10%]" />
                        {isEditing && <col className="w-10" />}
                      </colgroup>
                      <thead>
                        <tr className="bg-muted/50 border-b border-border/60">
                          <th className="p-3 text-[10px] uppercase font-black text-muted-foreground truncate">
                            Material Code
                          </th>
                          <th className="p-3 text-[10px] uppercase font-black text-muted-foreground truncate">
                            Specification Code
                          </th>
                          <th className="p-3 text-[10px] uppercase font-black text-muted-foreground truncate">
                            Material Name &amp; Specs
                          </th>
                          <th className="p-3 text-[10px] uppercase font-black text-muted-foreground truncate">
                            Category
                          </th>
                          <th className="p-3 text-[10px] uppercase font-black text-muted-foreground text-center truncate">
                            Qty
                          </th>
                          <th className="p-3 text-[10px] uppercase font-black text-muted-foreground truncate">
                            UOM
                          </th>
                          {isEditing && <th className="p-3 text-right"></th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {selectedRequest.items?.map((item: any, idx: number) => {
                          const selectedMat = masterMaterials.find(
                            (m) =>
                              m.id === item.materialId ||
                              m.material_code === (item.materialCode || item.material_code),
                          );
                          const currentMaterialId = item.materialId || selectedMat?.id || "CUSTOM";
                          const hasVariants =
                            selectedMat && selectedMat.variants && selectedMat.variants.length > 0;
                          const currentVariantId =
                            item.materialVariantId ||
                            selectedMat?.variants?.find(
                              (v: any) =>
                                v.variant_code === (item.variantCode || item.variant_code),
                            )?.id ||
                            selectedMat?.variants?.[0]?.id ||
                            "";

                          return (
                            <tr key={idx} className="hover:bg-muted/20 transition-colors">
                              <td className="p-2.5 min-w-0 overflow-hidden">
                                {isEditing ? (
                                  <MaterialMasterSearchCombobox
                                    value={currentMaterialId}
                                    onSelect={(val) => handleEditSelectMasterMaterial(idx, val)}
                                    masterMaterials={masterMaterials}
                                    size="sm"
                                  />
                                ) : (
                                  <span className="font-mono font-bold text-xs text-primary truncate block">
                                    {item.materialCode || item.material_code}
                                  </span>
                                )}
                              </td>
                              <td className="p-2.5 min-w-0 overflow-hidden">
                                {isEditing ? (
                                  hasVariants ? (
                                    <Select
                                      value={currentVariantId}
                                      onValueChange={(val) => handleEditSelectVariant(idx, val)}
                                    >
                                      <SelectTrigger className="h-9 rounded-xl text-xs bg-background border-teal-500/30 text-teal-700 font-semibold font-mono w-full min-w-0 truncate [&>span]:truncate [&>span]:block">
                                        <SelectValue placeholder="Select Specification" />
                                      </SelectTrigger>
                                      <SelectContent className="rounded-xl max-h-60">
                                        {selectedMat.variants.map((v: any) => {
                                          const spec = [v.size, v.color, v.grade]
                                            .filter(Boolean)
                                            .join(" · ");
                                          return (
                                            <SelectItem key={v.id} value={v.id} className="text-xs">
                                              <span className="font-mono font-bold text-teal-700">
                                                {formatSpecCode(v.variant_code)}
                                              </span>{" "}
                                              {spec && `(${spec})`}
                                            </SelectItem>
                                          );
                                        })}
                                      </SelectContent>
                                    </Select>
                                  ) : (
                                    <Input
                                      value={formatSpecCode(item.variantCode || item.variant_code) || ""}
                                      placeholder="Specification Code"
                                      onChange={(e) =>
                                        handleEditItemChange(idx, "variantCode", e.target.value)
                                      }
                                      className="h-9 text-xs font-mono w-full min-w-0 bg-background rounded-xl"
                                    />
                                  )
                                ) : (
                                  <span className="font-mono text-xs text-teal-600 font-semibold truncate block">
                                    {formatSpecCode(item.variantCode || item.variant_code) || "—"}
                                  </span>
                                )}
                              </td>
                              <td className="p-2.5 min-w-0 overflow-hidden">
                                {isEditing ? (
                                  <Input
                                    value={item.materialName || item.material_name || ""}
                                    placeholder="Material Name / Specification"
                                    readOnly={currentMaterialId !== "CUSTOM"}
                                    onChange={(e) =>
                                      handleEditItemChange(idx, "materialName", e.target.value)
                                    }
                                    className={cn(
                                      "h-9 text-xs rounded-xl w-full min-w-0",
                                      currentMaterialId !== "CUSTOM"
                                        ? "bg-muted/50 font-medium cursor-not-allowed text-foreground"
                                        : "bg-background"
                                    )}
                                  />
                                ) : (
                                  <span className="text-xs font-medium truncate block">
                                    {item.materialName || item.material_name}
                                  </span>
                                )}
                              </td>
                              <td className="p-2.5 min-w-0 overflow-hidden">
                                {isEditing ? (
                                  <Input
                                    value={item.category || selectedMat?.category || "Raw Materials"}
                                    placeholder="Category"
                                    readOnly={currentMaterialId !== "CUSTOM"}
                                    onChange={(e) =>
                                      handleEditItemChange(idx, "category", e.target.value)
                                    }
                                    className={cn(
                                      "h-9 text-xs rounded-xl w-full min-w-0 font-medium",
                                      currentMaterialId !== "CUSTOM"
                                        ? "bg-muted/50 cursor-not-allowed text-foreground"
                                        : "bg-background"
                                    )}
                                  />
                                ) : (
                                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block truncate">
                                    {item.category || selectedMat?.category || "Raw Materials"}
                                  </span>
                                )}
                              </td>
                              <td className="p-2.5 min-w-0 overflow-hidden text-center">
                                {isEditing ? (
                                  <Input
                                    type="number"
                                    min="1"
                                    step="any"
                                    value={item.quantity}
                                    onChange={(e) =>
                                      handleEditItemChange(idx, "quantity", e.target.value)
                                    }
                                    className="h-9 text-xs text-center bg-background rounded-xl w-full min-w-0"
                                  />
                                ) : (
                                  <span className="font-bold text-xs text-center block">
                                    {item.quantity}
                                  </span>
                                )}
                              </td>
                              <td className="p-2.5 min-w-0 overflow-hidden">
                                {isEditing ? (
                                  <Select
                                    value={item.uom}
                                    onValueChange={(val) => handleEditItemChange(idx, "uom", val)}
                                  >
                                    <SelectTrigger className="h-9 text-xs bg-background rounded-xl w-full min-w-0">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-xl">
                                      {uoms.map((uom) => (
                                        <SelectItem
                                          key={uom}
                                          value={uom}
                                          className="text-xs rounded-lg"
                                        >
                                          {uom}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                ) : (
                                  <span className="text-muted-foreground font-mono text-xs block">
                                    {item.uom}
                                  </span>
                                )}
                              </td>
                              {isEditing && (
                                <td className="p-2.5 text-center min-w-0">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="size-8 rounded-lg text-destructive hover:bg-destructive/10"
                                    onClick={() => removeEditItem(idx)}
                                    disabled={selectedRequest.items.length <= 1}
                                  >
                                    <Trash2 className="size-4" />
                                  </Button>
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-[10px] uppercase font-black text-muted-foreground">
                    Remarks / Justification
                  </Label>
                  {isEditing ? (
                    <Textarea
                      value={selectedRequest.remarks}
                      onChange={(e) =>
                        setSelectedRequest({ ...selectedRequest, remarks: e.target.value })
                      }
                      className="rounded-2xl min-h-[100px] text-sm"
                    />
                  ) : selectedRequest.remarks?.includes("[Note to Procurement:") ? (
                    <div className="space-y-3">
                      <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-200 flex items-start gap-3 shadow-xs">
                        <AlertCircle className="size-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                        <div>
                          <p className="text-xs font-black uppercase tracking-wider text-amber-700 dark:text-amber-400">
                            Vendor Sourcing Action Required
                          </p>
                          <p className="text-xs font-bold mt-1 leading-relaxed">
                            {selectedRequest.remarks.match(/\[Note to Procurement:[^\]]+\]/)?.[0] || selectedRequest.remarks}
                          </p>
                        </div>
                      </div>
                      {selectedRequest.remarks.replace(/\[Note to Procurement:[^\]]+\]/, "").trim() && (
                        <p className="text-sm bg-muted/30 p-4 rounded-2xl italic text-muted-foreground border border-border/40 leading-relaxed">
                          {selectedRequest.remarks.replace(/\[Note to Procurement:[^\]]+\]/, "").trim()}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm bg-muted/30 p-4 rounded-2xl italic text-muted-foreground border border-border/40 leading-relaxed">
                      {selectedRequest.remarks || "No remarks provided."}
                    </p>
                  )}
                </div>


              </div>

              <div className="p-6 bg-muted/10 border-t border-border/60 flex items-center justify-between">
                <Button
                  variant="ghost"
                  className="rounded-2xl h-11 px-6 font-bold text-xs uppercase"
                  onClick={() => setIsRequestModalOpen(false)}
                >
                  Close
                </Button>
                <div className="flex items-center gap-3">
                  {isEditing ? (
                    <>
                      <Button
                        variant="ghost"
                        className="rounded-2xl h-11 px-6 font-bold text-xs uppercase"
                        onClick={() => setIsEditing(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        className="rounded-full h-11 px-8 bg-blue-600 hover:bg-blue-700 shadow-glow font-bold text-xs uppercase"
                        onClick={handleUpdate}
                        disabled={submitting}
                      >
                        {submitting ? (
                          <Loader2 className="size-4 animate-spin mr-2" />
                        ) : (
                          <Save className="size-4 mr-2" />
                        )}
                        Update Request
                      </Button>
                    </>
                  ) : (
                    <>
                      {selectedRequest.status === "Draft" && (
                        <Button
                          className="rounded-full h-11 px-6 bg-blue-600 hover:bg-blue-700 shadow-glow font-bold text-xs uppercase"
                          onClick={() => changeStatus("Submitted", "Submitted for approval")}
                        >
                          Submit Request
                        </Button>
                      )}
                      {["Draft", "Submitted", "Rejected", "Pending Approval"].includes(selectedRequest.status) && (
                        <Button
                          className="rounded-full h-11 px-8 bg-blue-600 hover:bg-blue-700 shadow-glow font-bold text-xs uppercase"
                          onClick={() => setIsEditing(true)}
                        >
                          Edit Request
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* PRE-SUBMISSION MATERIAL REQUEST CONFIRMATION POPUP MODAL */}
      <Dialog open={showConfirmModal} onOpenChange={setShowConfirmModal}>
        <DialogContent className="max-w-2xl w-full rounded-3xl p-0 overflow-hidden border-none shadow-2xl">
          <div className="p-6 bg-gradient-to-r from-blue-600 to-indigo-600 text-white flex justify-between items-start">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <DialogTitle className="text-xl font-bold tracking-tight text-white">
                  Confirm Material Request Submission
                </DialogTitle>
                <Badge className="bg-white/20 text-white border-white/30 text-[10px] uppercase font-black">
                  Pre-Submission Review
                </Badge>
              </div>
              <DialogDescription className="text-blue-100 text-xs">
                Review request details and category supplier availability before sending to Procurement
              </DialogDescription>
            </div>
          </div>

          <div className="p-6 space-y-5">
            {/* Request Summary Metadata */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 rounded-2xl bg-muted/20 border border-border/40 text-xs">
              <div>
                <p className="text-[10px] uppercase font-black text-muted-foreground">Request Number</p>
                <p className="font-mono font-bold text-primary text-sm mt-0.5">
                  {formData.request_number || "MR-PENDING"}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase font-black text-muted-foreground">Warehouse</p>
                <p className="font-bold text-foreground text-sm mt-0.5">{formData.warehouse_id || "Main Warehouse"}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase font-black text-muted-foreground">Department</p>
                <p className="font-bold text-foreground text-sm mt-0.5">{formData.department || "Inventory"}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase font-black text-muted-foreground">Priority</p>
                <Badge className="mt-0.5 bg-amber-500/10 text-amber-700 border-amber-500/30 text-[10px] font-bold">
                  {formData.priority || "MEDIUM"}
                </Badge>
              </div>
            </div>

            {/* Material Items List */}
            <div className="space-y-2">
              <p className="text-[10px] uppercase font-black text-muted-foreground">
                Requested Materials ({items.length} item{items.length === 1 ? "" : "s"})
              </p>
              <div className="max-h-48 overflow-y-auto rounded-xl border border-border/60 bg-card overflow-hidden">
                <table className="w-full text-xs text-left">
                  <thead className="bg-muted/40 font-bold uppercase text-[10px] text-muted-foreground border-b border-border/60">
                    <tr>
                      <th className="p-2.5">Material</th>
                      <th className="p-2.5">Category</th>
                      <th className="p-2.5 text-right">Qty</th>
                      <th className="p-2.5">UOM</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {items.map((it, i) => (
                      <tr key={i} className="hover:bg-muted/10">
                        <td className="p-2.5">
                          <p className="font-mono font-bold text-primary">{it.material_code || "CUSTOM"}</p>
                          <p className="text-foreground font-medium truncate max-w-[220px]">{it.material_name}</p>
                        </td>
                        <td className="p-2.5 font-semibold text-muted-foreground uppercase text-[10px]">
                          {it.category || "Raw Materials"}
                        </td>
                        <td className="p-2.5 text-right font-mono font-bold text-foreground tabular-nums">
                          {it.quantity}
                        </td>
                        <td className="p-2.5 font-medium text-muted-foreground uppercase text-[10px]">
                          {it.uom || "PCS"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Categorized Suppliers Availability Banner */}
            {(() => {
              const itemCategories = [...new Set(items.map((it) => it.category).filter(Boolean))];
              const primaryCategory = itemCategories[0] || "Raw Materials";
              const matchingSuppliers = activeSuppliers.filter((s: any) =>
                Array.isArray(s.category)
                  ? s.category.some((c: string) => c.toLowerCase() === primaryCategory.toLowerCase())
                  : (s.category || "").toLowerCase() === primaryCategory.toLowerCase(),
              );

              const hasSuppliers = matchingSuppliers.length > 0;

              return (
                <div
                  className={cn(
                    "p-4 rounded-2xl flex items-center justify-between gap-3 border transition-colors",
                    hasSuppliers
                      ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-950 dark:text-emerald-200"
                      : "bg-amber-500/10 border-amber-500/30 text-amber-950 dark:text-amber-200",
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "size-10 rounded-xl text-white flex items-center justify-center shrink-0 font-bold shadow-sm",
                        hasSuppliers ? "bg-emerald-600" : "bg-amber-600",
                      )}
                    >
                      {hasSuppliers ? <Building2 className="size-5" /> : <AlertCircle className="size-5" />}
                    </div>
                    <div>
                      <p
                        className={cn(
                          "text-[10px] font-black uppercase tracking-wider",
                          hasSuppliers
                            ? "text-emerald-700 dark:text-emerald-400"
                            : "text-amber-700 dark:text-amber-400",
                        )}
                      >
                        Category Supplier Master (Informational Alert)
                      </p>
                      {hasSuppliers ? (
                        <p className="text-sm font-bold text-foreground mt-0.5">
                          {matchingSuppliers.length} active supplier{matchingSuppliers.length === 1 ? "" : "s"} available for this category
                        </p>
                      ) : (
                        <div>
                          <p className="text-sm font-bold text-foreground mt-0.5">
                            No active suppliers found for this category
                          </p>
                          <p className="text-xs text-amber-800 dark:text-amber-300 mt-0.5 font-medium">
                            Informational alert only — You can still submit this Material Request. Procurement will source required suppliers.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "font-bold text-xs bg-card shrink-0",
                      hasSuppliers
                        ? "border-emerald-500/30 text-emerald-700 dark:text-emerald-400"
                        : "border-amber-500/30 text-amber-700 dark:text-amber-400",
                    )}
                  >
                    Informational Alert
                  </Badge>
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
              onClick={executeSubmitRequest}
              disabled={submitting}
            >
              {submitting ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Send className="mr-2 size-4" />
              )}
              Confirm &amp; Submit Request
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
