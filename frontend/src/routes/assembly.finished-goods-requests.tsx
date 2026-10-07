import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  AlertCircle,
  Boxes,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Download,
  Edit3,
  Eye,
  FileText,
  Info,
  Layers,
  Loader2,
  Package,
  PackageCheck,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Store,
  Trash2,
  TrendingDown,
  X,
} from "lucide-react";
import { AppShell, StatusBadge } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, BUSINESS_API_URL } from "@/lib/api-client";
import { requireRole } from "@/lib/auth-utils";
import { toast } from "sonner";

export const Route = createFileRoute("/assembly/finished-goods-requests")({
  beforeLoad: () => requireRole(["ASSEMBLY_MANAGER", "ASSEMBLY", "ADMIN", "SUPERUSER"]),
  component: AssemblyFinishedGoodsRequests,
});

function formatDisplayDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  const date = new Date(String(dateStr));
  if (Number.isNaN(date.getTime())) return String(dateStr).split("T")[0] || "-";
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

interface BOMItemRow {
  material_id: string;
  material_code: string;
  material_name: string;
  variant_code: string;
  quantity_per_unit: number | string;
  uom: string;
  notes?: string;
}

interface MaterialRequestRow {
  material_id: string;
  material_code: string;
  material_name: string;
  variant_code: string;
  bom_per_unit_qty: number;
  quantity: number | string;
  uom: string;
  notes?: string;
}

function AssemblyFinishedGoodsRequests() {
  const [requests, setRequests] = useState<any[]>([]);
  const [masterMaterials, setMasterMaterials] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRequest, setSelectedRequest] = useState<any | null>(null);

  // BOM Modal State (Create / View / Edit)
  const [bomModal, setBomModal] = useState<{
    open: boolean;
    mode: "create" | "view" | "edit";
    request: any | null;
    product_name: string;
    product_code: string;
    bom: any | null;
  }>({
    open: false,
    mode: "create",
    request: null,
    product_name: "",
    product_code: "",
    bom: null,
  });
  const [bomRows, setBomRows] = useState<BOMItemRow[]>([]);
  const [savingBom, setSavingBom] = useState(false);

  // Auto-filled Material Request from BOM Modal State
  const [mrModal, setMrModal] = useState<{
    open: boolean;
    request: any | null;
    bom: any | null;
    remainingAssemblyQty: number;
    warehouse_id: string;
    priority: string;
    required_date: string;
    remarks: string;
    items: MaterialRequestRow[];
  }>({
    open: false,
    request: null,
    bom: null,
    remainingAssemblyQty: 0,
    warehouse_id: "Main Warehouse",
    priority: "MEDIUM",
    required_date: "",
    remarks: "",
    items: [],
  });
  const [submittingMr, setSubmittingMr] = useState(false);

  const fetchRequests = async () => {
    try {
      setLoading(true);
      const [data, materials] = await Promise.all([
        api.getAssemblyFinishedGoodsRequests().catch(() => api.getFinishedGoodsRequests()),
        api.getMaterials({ status: "Active" }).catch(() => []),
      ]);
      setRequests(Array.isArray(data) ? data : []);
      setMasterMaterials(Array.isArray(materials) ? materials : []);
      if (selectedRequest) {
        const updated = (Array.isArray(data) ? data : []).find(
          (r: any) => r.id === selectedRequest.id || r.request_number === selectedRequest.request_number
        );
        if (updated) setSelectedRequest(updated);
      }
    } catch (error) {
      console.error("Failed to fetch Finished Goods Requests:", error);
      toast.error("Failed to load Finished Goods Requests");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchRequests();
    const timer = window.setInterval(() => void fetchRequests(), 10000);
    return () => window.clearInterval(timer);
  }, []);

  const filteredRequests = requests.filter((req) => {
    const q = searchQuery.toLowerCase();
    return (
      (req.request_number || "").toLowerCase().includes(q) ||
      (req.product_name || req.finished_goods_name || "").toLowerCase().includes(q) ||
      (req.product_code || req.finished_goods_code || "").toLowerCase().includes(q) ||
      (req.status || "").toLowerCase().includes(q)
    );
  });

  // --- Handlers for BOM modal ---
  const handleOpenCreateBom = (req: any) => {
    const pName = req.product_name || req.finished_goods_name || "";
    const pCode = req.product_code || req.finished_goods_code || "";
    setBomModal({
      open: true,
      mode: "create",
      request: req,
      product_name: pName,
      product_code: pCode,
      bom: null,
    });
    setBomRows([
      {
        material_id: "",
        material_code: "",
        material_name: "",
        variant_code: "",
        quantity_per_unit: 1,
        uom: "PCS",
        notes: "",
      },
    ]);
  };

  const handleOpenViewBom = (req: any) => {
    const pName = req.product_name || req.finished_goods_name || "";
    const pCode = req.product_code || req.finished_goods_code || "";
    setBomModal({
      open: true,
      mode: "view",
      request: req,
      product_name: pName,
      product_code: pCode,
      bom: req.bom,
    });
    setBomRows(
      (req.bom?.items || []).map((it: any) => ({
        material_id: it.material_id || "",
        material_code: it.material_code,
        material_name: it.material_name,
        variant_code: it.variant_code || "",
        quantity_per_unit: it.quantity_per_unit,
        uom: it.uom || "PCS",
        notes: it.notes || "",
      }))
    );
  };

  const handleAddBomRow = () => {
    setBomRows([
      ...bomRows,
      {
        material_id: "",
        material_code: "",
        material_name: "",
        variant_code: "",
        quantity_per_unit: 1,
        uom: "PCS",
        notes: "",
      },
    ]);
  };

  const handleRemoveBomRow = (index: number) => {
    if (bomRows.length <= 1) return;
    setBomRows(bomRows.filter((_, i) => i !== index));
  };

  const handleSelectMasterMaterialForBom = (index: number, matId: string) => {
    const found = masterMaterials.find((m) => m.id === matId);
    if (!found) return;
    const defaultVariant = found.variants?.[0];
    const specDetails = defaultVariant
      ? [defaultVariant.size, defaultVariant.color, defaultVariant.grade].filter(Boolean).join(", ")
      : "";
    const nameWithSpec = specDetails ? `${found.material_name} (${specDetails})` : found.material_name;

    setBomRows(
      bomRows.map((row, i) =>
        i === index
          ? {
              ...row,
              material_id: found.id,
              material_code: found.material_code,
              material_name: nameWithSpec,
              variant_code: defaultVariant?.variant_code || "",
              uom: defaultVariant?.uom || found.base_uom || "PCS",
            }
          : row
      )
    );
  };

  const handleSaveBom = async () => {
    const pName = bomModal.product_name.trim();
    if (!pName) {
      toast.error("Product Name is required");
      return;
    }
    for (let i = 0; i < bomRows.length; i++) {
      const r = bomRows[i];
      if (!r.material_code.trim() || !r.material_name.trim()) {
        toast.error(`Please select or specify a material for component row ${i + 1}`);
        return;
      }
      const q = Number(r.quantity_per_unit);
      if (isNaN(q) || q <= 0) {
        toast.error(`Quantity per unit must be greater than 0 for component row ${i + 1}`);
        return;
      }
    }

    setSavingBom(true);
    try {
      const payload = {
        product_name: pName,
        product_code: bomModal.product_code?.trim() || null,
        description: `BOM recipe for ${pName}`,
        created_by: "Assembly",
        items: bomRows.map((r) => ({
          material_id: r.material_id || null,
          material_code: r.material_code.trim(),
          material_name: r.material_name.trim(),
          variant_code: r.variant_code?.trim() || null,
          quantity_per_unit: Number(r.quantity_per_unit),
          uom: r.uom || "PCS",
          notes: r.notes || null,
        })),
      };

      let saved;
      if (bomModal.mode === "edit" && bomModal.bom?.id) {
        saved = await api.updateBOM(bomModal.bom.id, payload);
        toast.success(`BOM ${saved.bom_number || ""} updated successfully for ${pName}`);
      } else {
        saved = await api.createBOM(payload);
        toast.success(`BOM ${saved.bom_number || ""} saved and linked to ${pName}`);
      }

      setBomModal((prev) => ({ ...prev, open: false }));
      await fetchRequests();
    } catch (err: any) {
      toast.error(err.message || "Failed to save BOM");
    } finally {
      setSavingBom(false);
    }
  };

  // --- Handlers for Auto-filled Material Request from BOM ---
  const handleOpenMaterialRequestFromBom = (req: any) => {
    const avail = Number(req.fg_store_available ?? req.available_quantity ?? 0);
    const requestedQty = Number(req.quantity ?? req.requested_quantity ?? 0);
    // Formula: remaining_assembly_qty = max(requested_fg_qty - fg_store_available, 0)
    const remainingAssemblyQty = Math.max(0, requestedQty - avail);

    if (remainingAssemblyQty <= 0) {
      toast.info("Zero Assembly Required", {
        description: `Finished Goods Store available stock (${avail} ${req.uom || "PCS"}) fully covers the request (${requestedQty} ${req.uom || "PCS"}). No material requisition is needed.`,
      });
      return;
    }

    const bom = req.bom;
    if (!bom || !Array.isArray(bom.items) || bom.items.length === 0) {
      toast.error("No BOM items found. Please define the BOM first.");
      return;
    }

    // Auto-fill Material Request:
    // material_request_qty = bom_per_unit_qty * remaining_assembly_qty
    const autoFilledItems: MaterialRequestRow[] = bom.items.map((it: any) => {
      const perUnit = Number(it.quantity_per_unit || 1);
      const calculatedQty = perUnit * remainingAssemblyQty;
      return {
        material_id: it.material_id || "",
        material_code: it.material_code,
        material_name: it.material_name,
        variant_code: it.variant_code || "",
        bom_per_unit_qty: perUnit,
        quantity: calculatedQty, // EDITABLE! Changing this will NOT alter the BOM
        uom: it.uom || "PCS",
        notes: "",
      };
    });

    setMrModal({
      open: true,
      request: req,
      bom: bom,
      remainingAssemblyQty,
      warehouse_id: req.warehouse_id || "Main Warehouse",
      priority: "MEDIUM",
      required_date: req.required_date || new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      remarks: `Requisition auto-filled from BOM (${bom.bom_number}) for FG Request ${req.request_number} to assemble ${remainingAssemblyQty} unit(s).`,
      items: autoFilledItems,
    });
  };

  const handleAddMrRow = () => {
    setMrModal((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        {
          material_id: "",
          material_code: "",
          material_name: "",
          variant_code: "",
          bom_per_unit_qty: 1,
          quantity: 1,
          uom: "PCS",
          notes: "",
        },
      ],
    }));
  };

  const handleRemoveMrRow = (index: number) => {
    if (mrModal.items.length <= 1) return;
    setMrModal((prev) => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index),
    }));
  };

  const handleSelectMaterialForMr = (index: number, matId: string) => {
    const found = masterMaterials.find((m) => m.id === matId);
    if (!found) return;
    const defaultVariant = found.variants?.[0];
    const specDetails = defaultVariant
      ? [defaultVariant.size, defaultVariant.color, defaultVariant.grade].filter(Boolean).join(", ")
      : "";
    const nameWithSpec = specDetails ? `${found.material_name} (${specDetails})` : found.material_name;

    setMrModal((prev) => ({
      ...prev,
      items: prev.items.map((row, i) =>
        i === index
          ? {
              ...row,
              material_id: found.id,
              material_code: found.material_code,
              material_name: nameWithSpec,
              variant_code: defaultVariant?.variant_code || "",
              uom: defaultVariant?.uom || found.base_uom || "PCS",
            }
          : row
      ),
    }));
  };

  const handleSubmitMaterialRequest = async () => {
    if (mrModal.items.length === 0) {
      toast.error("Please include at least one material component.");
      return;
    }
    for (let i = 0; i < mrModal.items.length; i++) {
      const it = mrModal.items[i];
      if (!it.material_code?.trim() || !it.material_name?.trim()) {
        toast.error(`Please select or specify material for row ${i + 1}`);
        return;
      }
      const q = Number(it.quantity);
      if (isNaN(q) || q <= 0) {
        toast.error(`Quantity must be greater than 0 for ${it.material_name || `row ${i + 1}`}`);
        return;
      }
    }

    setSubmittingMr(true);
    try {
      const payload = {
        warehouse_id: mrModal.warehouse_id,
        department: "Assembly",
        requested_by: "Assembly Operator",
        priority: mrModal.priority,
        required_date: mrModal.required_date,
        remarks: mrModal.remarks,
        items: mrModal.items.map((it) => ({
          material_id: it.material_id || null,
          material_variant_id: null,
          material_code: it.material_code,
          variant_code: it.variant_code || null,
          material_name: it.material_name,
          quantity: Number(it.quantity),
          uom: it.uom || "PCS",
          is_custom: false,
        })),
      };

      const created = await api.createAssemblyRequisition(payload);
      const reqNum = created?.requisition_number || created?.requisitionNumber || created?.request_number || "REQ";
      toast.success("Assembly Material Requisition submitted to Warehouse!", {
        description: `Requisition ${reqNum} generated for ${mrModal.remainingAssemblyQty} unit(s). Note: BOM recipe was preserved.`,
      });
      setMrModal((prev) => ({ ...prev, open: false }));
    } catch (err: any) {
      toast.error(err.message || "Failed to create material requisition");
    } finally {
      setSubmittingMr(false);
    }
  };

  return (
    <AppShell
      title="Assembly Finished Goods Requests"
      subtitle="Inspect incoming Finished Goods Requests from Procurement, check FG Store availability, and manage BOMs"
      actions={
        <Button variant="outline" onClick={() => void fetchRequests()} disabled={loading}>
          <RefreshCw className={`mr-2 size-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      }
    >
      <div className="space-y-6">
        {/* KPI Top Cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="rounded-2xl border p-4 shadow-sm bg-card">
            <div className="flex items-center justify-between text-muted-foreground text-xs font-bold uppercase">
              <span>Total Requests</span>
              <ClipboardList className="size-4 text-primary" />
            </div>
            <p className="text-3xl font-black mt-2 text-foreground">{requests.length}</p>
            <p className="text-xs text-muted-foreground mt-1">From Procurement</p>
          </Card>

          <Card className="rounded-2xl border p-4 shadow-sm bg-card">
            <div className="flex items-center justify-between text-muted-foreground text-xs font-bold uppercase">
              <span>Sent to Assembly</span>
              <PackageCheck className="size-4 text-blue-600" />
            </div>
            <p className="text-3xl font-black mt-2 text-blue-600">
              {requests.filter((r) => r.status === "SENT_TO_ASSEMBLY" || !r.status).length}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Pending FG store verification</p>
          </Card>

          <Card className="rounded-2xl border p-4 shadow-sm bg-card">
            <div className="flex items-center justify-between text-muted-foreground text-xs font-bold uppercase">
              <span>In Stock (Zero Shortage)</span>
              <CheckCircle2 className="size-4 text-emerald-600" />
            </div>
            <p className="text-3xl font-black mt-2 text-emerald-600">
              {requests.filter((r) => (r.shortage ?? 0) <= 0).length}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Covered by FG Store inventory</p>
          </Card>

          <Card className="rounded-2xl border p-4 shadow-sm bg-card">
            <div className="flex items-center justify-between text-muted-foreground text-xs font-bold uppercase">
              <span>Shortage (To Assemble)</span>
              <TrendingDown className="size-4 text-red-600" />
            </div>
            <p className="text-3xl font-black mt-2 text-red-600">
              {requests.filter((r) => (r.shortage ?? 0) > 0).length}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Assembly production required</p>
          </Card>
        </div>

        {/* Search & Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search request #, product name, code..."
              className="pl-9 h-10 rounded-xl"
            />
          </div>
        </div>

        {/* Requests Table */}
        <Card className="rounded-2xl border bg-card p-0 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/50 border-b border-border text-[11px] uppercase tracking-wider font-bold text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Request Number</th>
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3 text-right">Requested Qty</th>
                  <th className="px-4 py-3 text-right">FG Store Available</th>
                  <th className="px-4 py-3 text-right">Shortage</th>
                  <th className="px-4 py-3">BOM Definition</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Created Date</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading ? (
                  <tr>
                    <td colSpan={9} className="h-48 text-center">
                      <Loader2 className="size-7 animate-spin mx-auto text-primary" />
                      <span className="block mt-2 text-xs text-muted-foreground">Loading Finished Goods Requests...</span>
                    </td>
                  </tr>
                ) : filteredRequests.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="h-48 text-center p-6">
                      <ClipboardList className="size-10 text-muted-foreground/30 mx-auto mb-2" />
                      <p className="text-sm font-semibold text-muted-foreground">No Finished Goods Requests Received</p>
                      <p className="text-xs text-muted-foreground/80 mt-1">Requests sent from Procurement will appear here.</p>
                    </td>
                  </tr>
                ) : (
                  filteredRequests.map((req) => {
                    const avail = req.fg_store_available ?? req.available_quantity ?? 0;
                    const shortage = req.shortage ?? req.shortage_quantity ?? Math.max(0, req.quantity - avail);

                    return (
                      <tr
                        key={req.id}
                        onClick={() => setSelectedRequest(req)}
                        className={`hover:bg-muted/20 cursor-pointer transition-colors ${
                          selectedRequest?.id === req.id ? "bg-muted/30" : ""
                        }`}
                      >
                        <td className="px-4 py-3 font-mono font-bold text-primary">
                          {req.request_number}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-foreground">
                            {req.product_name || req.finished_goods_name}
                          </div>
                          <div className="text-[11px] text-muted-foreground font-mono">
                            {req.product_code || req.finished_goods_code || "-"}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-foreground">
                          {req.quantity || req.requested_quantity} {req.uom || "PCS"}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-emerald-600">
                          {avail} {req.uom || "PCS"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {shortage > 0 ? (
                            <Badge variant="destructive" className="font-bold">
                              {shortage} {req.uom || "PCS"}
                            </Badge>
                          ) : (
                            <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-200 border-none font-bold">
                              0 (In Stock)
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {req.has_bom ? (
                            <div className="flex items-center gap-1.5">
                              <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 border-none font-bold text-[11px]">
                                BOM Available
                              </Badge>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenViewBom(req);
                                }}
                                className="h-6 px-1.5 text-xs text-primary font-bold hover:underline"
                              >
                                View BOM
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <Badge variant="outline" className="text-amber-700 border-amber-300 dark:text-amber-400 font-semibold text-[11px]">
                                No BOM exists
                              </Badge>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenCreateBom(req);
                                }}
                                className="h-6 px-2 text-xs font-bold text-primary border-primary/30 hover:bg-primary/10"
                              >
                                Create BOM
                              </Button>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={req.status || "SENT_TO_ASSEMBLY"} />
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {formatDisplayDate(req.created_at)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedRequest(req);
                            }}
                            className="rounded-xl h-8 text-xs font-semibold gap-1.5"
                          >
                            <Eye className="size-3.5" />
                            Inspect FG Store
                          </Button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Selected Request Inspection Modal / Detailed Card */}
        {selectedRequest && (
          <Card className="rounded-2xl border-2 border-primary/30 bg-card p-6 shadow-lg space-y-6">
            <div className="flex items-center justify-between border-b border-border/60 pb-4">
              <div className="flex items-center gap-3">
                <div className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
                  <Store className="size-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-black text-foreground">{selectedRequest.request_number}</h3>
                    <StatusBadge status={selectedRequest.status || "SENT_TO_ASSEMBLY"} />
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Finished Goods Store Availability Inspection &amp; BOM Planning
                  </p>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelectedRequest(null)} className="h-8 w-8 p-0">
                <X className="size-4" />
              </Button>
            </div>

            {/* Inventory Inspection Panel */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Requested Card */}
              <div className="rounded-2xl border border-blue-200 bg-blue-50/50 dark:bg-blue-950/20 p-5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-blue-700 dark:text-blue-300">
                  Requested Quantity
                </span>
                <div className="text-3xl font-black text-blue-700 dark:text-blue-300 mt-2">
                  {selectedRequest.quantity || selectedRequest.requested_quantity} {selectedRequest.uom || "PCS"}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Required By: {formatDisplayDate(selectedRequest.required_date)}
                </div>
              </div>

              {/* FG Store Available Card */}
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/20 p-5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                  FG Store Available
                </span>
                <div className="text-3xl font-black text-emerald-700 dark:text-emerald-300 mt-2">
                  {selectedRequest.fg_store_available ?? selectedRequest.available_quantity ?? 0} {selectedRequest.uom || "PCS"}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Actual database inventory in FG Store
                </div>
              </div>

              {/* Shortage Card */}
              <div
                className={`rounded-2xl border p-5 ${
                  (selectedRequest.shortage ?? 0) > 0
                    ? "border-red-200 bg-red-50/50 dark:bg-red-950/20"
                    : "border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/20"
                }`}
              >
                <span
                  className={`text-[11px] font-bold uppercase tracking-wider ${
                    (selectedRequest.shortage ?? 0) > 0
                      ? "text-red-700 dark:text-red-300"
                      : "text-emerald-700 dark:text-emerald-300"
                  }`}
                >
                  Assembly Required
                </span>
                <div
                  className={`text-3xl font-black mt-2 ${
                    (selectedRequest.shortage ?? 0) > 0
                      ? "text-red-700 dark:text-red-300"
                      : "text-emerald-700 dark:text-emerald-300"
                  }`}
                >
                  {selectedRequest.shortage ?? selectedRequest.shortage_quantity ?? 0} {selectedRequest.uom || "PCS"}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {(selectedRequest.shortage ?? 0) > 0
                    ? "Production required to fulfill shortage"
                    : "0 units needed (completely in stock)"}
                </div>
              </div>
            </div>

            {/* BOM Management & Material Requisition Callout */}
            <div className="rounded-2xl border border-border/80 bg-muted/20 p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary">
                    <Layers className="size-5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm text-foreground">
                      Bill of Materials (BOM) — {selectedRequest.product_name || selectedRequest.finished_goods_name}
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      Reusable product-level recipe (quantity per 1 finished good unit)
                    </p>
                  </div>
                </div>

                {selectedRequest.has_bom ? (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleOpenViewBom(selectedRequest)}
                      className="rounded-xl text-xs font-semibold gap-1.5"
                    >
                      <Eye className="size-3.5" /> View BOM
                    </Button>
                    {(selectedRequest.shortage ?? 0) > 0 ? (
                      <Button
                        size="sm"
                        onClick={() => handleOpenMaterialRequestFromBom(selectedRequest)}
                        className="rounded-xl font-bold text-xs gap-1.5 bg-primary text-primary-foreground"
                      >
                        <ClipboardList className="size-3.5" /> Create Material Request from BOM
                      </Button>
                    ) : (
                      <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 border-none font-bold text-xs px-2.5 py-1">
                        Zero Assembly Required
                      </Badge>
                    )}
                  </div>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => handleOpenCreateBom(selectedRequest)}
                    className="rounded-xl font-bold text-xs gap-1.5 bg-primary text-primary-foreground"
                  >
                    <Plus className="size-3.5" /> Create BOM
                  </Button>
                )}
              </div>

              {selectedRequest.has_bom ? (
                <div className="rounded-xl border bg-card p-3.5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                      <CheckCircle2 className="size-4 text-emerald-600" />
                      BOM Available: {selectedRequest.bom?.bom_number}
                    </span>
                    <span className="text-[11px] text-muted-foreground font-mono">
                      {selectedRequest.bom?.items?.length || 0} component(s) defined
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 text-xs">
                    {(selectedRequest.bom?.items || []).map((itm: any, idx: number) => (
                      <div key={idx} className="rounded-lg bg-muted/40 p-2 border border-border/40">
                        <span className="font-semibold text-foreground block truncate" title={itm.material_name}>
                          {itm.material_name}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {itm.quantity_per_unit} {itm.uom} / unit
                        </span>
                      </div>
                    ))}
                  </div>

                  {(selectedRequest.shortage ?? 0) <= 0 && (
                    <div className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 p-2 text-xs text-emerald-800 dark:text-emerald-300">
                      <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
                      <span>
                        <strong>In Stock:</strong> The requested quantity is completely covered by FG Store inventory ({selectedRequest.fg_store_available ?? 0} available). No raw materials needed.
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50/40 dark:bg-amber-950/20 p-4 text-xs text-amber-900 dark:text-amber-300 flex items-start gap-2.5">
                  <AlertCircle className="size-4 shrink-0 text-amber-600 mt-0.5" />
                  <div>
                    <p className="font-bold">No BOM exists for this Finished Good</p>
                    <p className="text-muted-foreground mt-0.5">
                      Click <strong>"Create BOM"</strong> to define the standard components and quantities needed to assemble one unit of{" "}
                      <strong>{selectedRequest.product_name || selectedRequest.finished_goods_name}</strong>. The saved BOM will be reused for all future requests.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Product & Request Details */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs border-t border-border/60 pt-4">
              <div>
                <span className="font-bold text-muted-foreground uppercase text-[10px]">Product Name</span>
                <p className="font-semibold text-foreground text-sm mt-0.5">
                  {selectedRequest.product_name || selectedRequest.finished_goods_name}
                </p>
              </div>

              <div>
                <span className="font-bold text-muted-foreground uppercase text-[10px]">Product Code</span>
                <p className="font-mono font-semibold text-foreground text-sm mt-0.5">
                  {selectedRequest.product_code || selectedRequest.finished_goods_code || "-"}
                </p>
              </div>

              <div>
                <span className="font-bold text-muted-foreground uppercase text-[10px]">Requested By</span>
                <p className="font-semibold text-foreground text-sm mt-0.5">
                  {selectedRequest.requested_by || selectedRequest.created_by || "Procurement"}
                </p>
              </div>

              <div>
                <span className="font-bold text-muted-foreground uppercase text-[10px]">Target Warehouse</span>
                <p className="font-semibold text-foreground text-sm mt-0.5">
                  {selectedRequest.warehouse_id || "MAIN"}
                </p>
              </div>
            </div>

            {/* BOM Attachment Download if any from Procurement */}
            {selectedRequest.bom_attachment_url && (
              <div className="flex items-center justify-between rounded-xl bg-primary/5 border border-primary/20 p-3.5">
                <div className="flex items-center gap-2.5">
                  <div className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary">
                    <FileText className="size-4" />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-foreground block">
                      {selectedRequest.bom_attachment_name || "BOM Attachment"}
                    </span>
                    <span className="text-[11px] text-muted-foreground">Document attached by Procurement</span>
                  </div>
                </div>
                <a
                  href={`${BUSINESS_API_URL}${selectedRequest.bom_attachment_url}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 transition shadow-sm"
                >
                  <Download className="size-3.5" /> Download Attachment
                </a>
              </div>
            )}

            {/* Remarks if any */}
            {selectedRequest.remarks && (
              <div className="rounded-xl bg-muted/30 p-3 border text-xs">
                <span className="font-bold text-muted-foreground uppercase text-[10px] block mb-1">Remarks</span>
                <p className="text-foreground">{selectedRequest.remarks}</p>
              </div>
            )}

            {/* Safety & Non-Deduction Notice */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/20 p-3 rounded-xl border border-dashed">
              <ShieldCheck className="size-4 text-emerald-600 shrink-0" />
              <span>
                <strong>Availability Inspection Only:</strong> Checking inventory availability does not reserve or deduct finished goods stock.
              </span>
            </div>
          </Card>
        )}

        {/* ========================================================================= */}
        {/* MODAL 1: CREATE / VIEW / EDIT BOM MODAL                                   */}
        {/* ========================================================================= */}
        <Dialog
          open={bomModal.open}
          onOpenChange={(open) => !open && setBomModal((prev) => ({ ...prev, open: false }))}
        >
          <DialogContent className="max-w-3xl rounded-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <div className="flex items-center justify-between">
                <div>
                  <DialogTitle className="text-lg font-bold flex items-center gap-2">
                    <Layers className="size-5 text-primary" />
                    {bomModal.mode === "create"
                      ? "Create Product Bill of Materials (BOM)"
                      : bomModal.mode === "edit"
                      ? `Edit BOM — ${bomModal.bom?.bom_number || bomModal.product_name}`
                      : `View BOM — ${bomModal.bom?.bom_number || bomModal.product_name}`}
                  </DialogTitle>
                  <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                    Define the raw materials and components required to manufacture <strong>ONE unit</strong> of this finished good.
                  </DialogDescription>
                </div>
                {bomModal.mode === "view" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setBomModal((prev) => ({ ...prev, mode: "edit" }))}
                    className="rounded-xl gap-1.5 text-xs font-bold"
                  >
                    <Edit3 className="size-3.5" /> Edit BOM
                  </Button>
                )}
              </div>
            </DialogHeader>

            <div className="space-y-4 py-2">
              {/* Product Info Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-xl bg-muted/30 border">
                <div>
                  <Label className="text-xs font-semibold uppercase text-muted-foreground">Product Name</Label>
                  <Input
                    value={bomModal.product_name}
                    onChange={(e) => setBomModal((prev) => ({ ...prev, product_name: e.target.value }))}
                    disabled={bomModal.mode === "view"}
                    className="mt-1 h-9 rounded-xl font-bold text-sm"
                    placeholder="e.g. Laptop"
                  />
                </div>
                <div>
                  <Label className="text-xs font-semibold uppercase text-muted-foreground">Product Code</Label>
                  <Input
                    value={bomModal.product_code}
                    onChange={(e) => setBomModal((prev) => ({ ...prev, product_code: e.target.value }))}
                    disabled={bomModal.mode === "view"}
                    className="mt-1 h-9 rounded-xl font-mono text-sm"
                    placeholder="e.g. LAP-001"
                  />
                </div>
              </div>

              {/* Standard Recipe Rule Notice */}
              <div className="flex items-center gap-2 rounded-xl bg-primary/10 p-3 text-xs text-primary font-medium">
                <Info className="size-4 shrink-0" />
                <span>
                  <strong>Standard Recipe:</strong> BOM quantities are ALWAYS defined per <strong>ONE unit</strong> of the finished good. This recipe is reusable across all future requests.
                </span>
              </div>

              {/* Components Table */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Required Components &amp; Raw Materials ({bomRows.length})
                  </Label>
                  {bomModal.mode !== "view" && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleAddBomRow}
                      className="rounded-xl h-7 text-xs font-bold gap-1 text-primary border-primary/40 hover:bg-primary/10"
                    >
                      <Plus className="size-3.5" /> Add Component
                    </Button>
                  )}
                </div>

                <div className="rounded-xl border overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-muted/60 border-b text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="p-2.5">Material / Component</th>
                        <th className="p-2.5 w-32">Material Code</th>
                        <th className="p-2.5 w-24 text-center">Qty / Unit</th>
                        <th className="p-2.5 w-20">UOM</th>
                        {bomModal.mode !== "view" && <th className="p-2.5 w-10 text-right"></th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {bomRows.map((row, idx) => (
                        <tr key={idx} className="hover:bg-muted/10">
                          <td className="p-2.5">
                            {bomModal.mode === "view" ? (
                              <span className="font-semibold text-foreground">{row.material_name}</span>
                            ) : (
                              <div className="space-y-1">
                                {masterMaterials.length > 0 && (
                                  <Select
                                    value={row.material_id || ""}
                                    onValueChange={(val) => handleSelectMasterMaterialForBom(idx, val)}
                                  >
                                    <SelectTrigger className="h-8 text-xs rounded-lg">
                                      <SelectValue placeholder="Select from Master Materials..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {masterMaterials.map((mat) => (
                                        <SelectItem key={mat.id} value={mat.id}>
                                          {mat.material_name} ({mat.material_code})
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                )}
                                <Input
                                  placeholder="Or enter component name..."
                                  value={row.material_name}
                                  onChange={(e) =>
                                    setBomRows(
                                      bomRows.map((r, i) => (i === idx ? { ...r, material_name: e.target.value } : r))
                                    )
                                  }
                                  className="h-8 text-xs rounded-lg"
                                />
                              </div>
                            )}
                          </td>
                          <td className="p-2.5">
                            {bomModal.mode === "view" ? (
                              <span className="font-mono text-muted-foreground">{row.material_code}</span>
                            ) : (
                              <Input
                                placeholder="Code"
                                value={row.material_code}
                                onChange={(e) =>
                                  setBomRows(
                                    bomRows.map((r, i) => (i === idx ? { ...r, material_code: e.target.value } : r))
                                  )
                                }
                                className="h-8 text-xs font-mono rounded-lg"
                              />
                            )}
                          </td>
                          <td className="p-2.5 text-center">
                            {bomModal.mode === "view" ? (
                              <span className="font-bold text-primary text-sm">{row.quantity_per_unit}</span>
                            ) : (
                              <Input
                                type="number"
                                min="0.01"
                                step="any"
                                value={row.quantity_per_unit}
                                onChange={(e) =>
                                  setBomRows(
                                    bomRows.map((r, i) =>
                                      i === idx ? { ...r, quantity_per_unit: e.target.value } : r
                                    )
                                  )
                                }
                                className="h-8 text-xs font-bold text-center rounded-lg w-20 mx-auto"
                              />
                            )}
                          </td>
                          <td className="p-2.5">
                            {bomModal.mode === "view" ? (
                              <span className="text-muted-foreground font-semibold">{row.uom}</span>
                            ) : (
                              <Input
                                value={row.uom}
                                onChange={(e) =>
                                  setBomRows(bomRows.map((r, i) => (i === idx ? { ...r, uom: e.target.value } : r)))
                                }
                                className="h-8 text-xs rounded-lg uppercase"
                              />
                            )}
                          </td>
                          {bomModal.mode !== "view" && (
                            <td className="p-2.5 text-right">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => handleRemoveBomRow(idx)}
                                disabled={bomRows.length <= 1}
                                className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600"
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <DialogFooter className="gap-2 pt-2 border-t">
              <Button
                variant="outline"
                onClick={() => setBomModal((prev) => ({ ...prev, open: false }))}
                className="rounded-xl"
              >
                {bomModal.mode === "view" ? "Close" : "Cancel"}
              </Button>
              {bomModal.mode !== "view" && (
                <Button
                  onClick={handleSaveBom}
                  disabled={savingBom}
                  className="rounded-xl font-bold bg-primary text-primary-foreground gap-1.5"
                >
                  {savingBom ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                  Save BOM Recipe
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ========================================================================= */}
        {/* MODAL 2: AUTO-FILLED MATERIAL REQUEST FROM BOM (EDITABLE QUANTITIES)     */}
        {/* ========================================================================= */}
        <Dialog
          open={mrModal.open}
          onOpenChange={(open) => !open && setMrModal((prev) => ({ ...prev, open: false }))}
        >
          <DialogContent className="max-w-4xl rounded-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold flex items-center gap-2">
                <ClipboardList className="size-5 text-primary" />
                Assembly Material Requisition from BOM
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Auto-calculated material quantities for Finished Goods Request{" "}
                <strong className="text-foreground font-mono">{mrModal.request?.request_number}</strong> (
                {mrModal.request?.product_name || mrModal.request?.finished_goods_name}).
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              {/* Formula & Availability Summary Banner */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 rounded-xl bg-muted/40 border text-xs">
                <div className="rounded-lg bg-background p-2.5 border">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground block">Requested FG Qty</span>
                  <span className="text-base font-black text-foreground">
                    {mrModal.request?.quantity || mrModal.request?.requested_quantity} {mrModal.request?.uom || "PCS"}
                  </span>
                </div>
                <div className="rounded-lg bg-background p-2.5 border">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground block">FG Store Available</span>
                  <span className="text-base font-black text-emerald-600">
                    {mrModal.request?.fg_store_available ?? 0} {mrModal.request?.uom || "PCS"}
                  </span>
                </div>
                <div className="rounded-lg bg-background p-2.5 border border-primary/30">
                  <span className="text-[10px] uppercase font-bold text-primary block">Remaining Assembly Qty</span>
                  <span className="text-base font-black text-primary">
                    {mrModal.remainingAssemblyQty} {mrModal.request?.uom || "PCS"}
                  </span>
                </div>
              </div>

              {/* Crucial Separation Notice */}
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs text-foreground flex items-start gap-2.5">
                <Info className="size-4 shrink-0 text-primary mt-0.5" />
                <div>
                  <span className="font-bold text-primary">Editable Requisition Quantities:</span>
                  <p className="text-muted-foreground mt-0.5">
                    Quantities have been auto-populated based on the BOM recipe multiplied by{" "}
                    <strong>{mrModal.remainingAssemblyQty} unit(s)</strong> to assemble. You may adjust quantities below as needed for this particular assembly order.{" "}
                    <strong>Adjustments here will NOT alter the master BOM definition.</strong>
                  </p>
                </div>
              </div>

              {/* Items Table */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Requisition Materials ({mrModal.items.length})
                  </Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAddMrRow}
                    className="rounded-xl h-7 text-xs font-bold gap-1 text-primary border-primary/40 hover:bg-primary/10"
                  >
                    <Plus className="size-3.5" /> Add Material
                  </Button>
                </div>

                <div className="rounded-xl border overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-muted/60 border-b text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="p-2.5">Component Material</th>
                        <th className="p-2.5 w-28">Code</th>
                        <th className="p-2.5 w-24 text-center">BOM / Unit</th>
                        <th className="p-2.5 w-28 text-center text-primary font-black">
                          Req. Qty (Editable)
                        </th>
                        <th className="p-2.5 w-16">UOM</th>
                        <th className="p-2.5 w-10 text-right"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {mrModal.items.map((row, idx) => (
                        <tr key={idx} className="hover:bg-muted/10">
                          <td className="p-2.5">
                            {row.material_code && row.material_name ? (
                              <span className="font-semibold text-foreground">{row.material_name}</span>
                            ) : (
                              <Select
                                value={row.material_id || ""}
                                onValueChange={(val) => handleSelectMaterialForMr(idx, val)}
                              >
                                <SelectTrigger className="h-8 text-xs rounded-lg">
                                  <SelectValue placeholder="Select material..." />
                                </SelectTrigger>
                                <SelectContent>
                                  {masterMaterials.map((mat) => (
                                    <SelectItem key={mat.id} value={mat.id}>
                                      {mat.material_name} ({mat.material_code})
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          </td>
                          <td className="p-2.5 font-mono text-muted-foreground">{row.material_code || "-"}</td>
                          <td className="p-2.5 text-center text-muted-foreground font-semibold">
                            {row.bom_per_unit_qty ? `${row.bom_per_unit_qty} / unit` : "-"}
                          </td>
                          <td className="p-2.5 text-center">
                            <Input
                              type="number"
                              min="0.01"
                              step="any"
                              value={row.quantity}
                              onChange={(e) =>
                                setMrModal((prev) => ({
                                  ...prev,
                                  items: prev.items.map((r, i) =>
                                    i === idx ? { ...r, quantity: e.target.value } : r
                                  ),
                                }))
                              }
                              className="h-8 text-xs font-bold text-center rounded-lg w-24 mx-auto border-primary/50 focus:border-primary text-primary"
                            />
                          </td>
                          <td className="p-2.5 font-semibold text-muted-foreground">{row.uom}</td>
                          <td className="p-2.5 text-right">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRemoveMrRow(idx)}
                              disabled={mrModal.items.length <= 1}
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600"
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Requisition Meta Details */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                <div>
                  <Label className="text-xs font-semibold uppercase text-muted-foreground">Target Warehouse</Label>
                  <Input
                    value={mrModal.warehouse_id}
                    onChange={(e) => setMrModal((prev) => ({ ...prev, warehouse_id: e.target.value }))}
                    className="mt-1 h-8 rounded-xl text-xs"
                  />
                </div>
                <div>
                  <Label className="text-xs font-semibold uppercase text-muted-foreground">Priority</Label>
                  <Select
                    value={mrModal.priority}
                    onValueChange={(val) => setMrModal((prev) => ({ ...prev, priority: val }))}
                  >
                    <SelectTrigger className="mt-1 h-8 text-xs rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="LOW">LOW</SelectItem>
                      <SelectItem value="MEDIUM">MEDIUM</SelectItem>
                      <SelectItem value="HIGH">HIGH</SelectItem>
                      <SelectItem value="CRITICAL">CRITICAL</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs font-semibold uppercase text-muted-foreground">Required Date</Label>
                  <Input
                    type="date"
                    value={mrModal.required_date}
                    onChange={(e) => setMrModal((prev) => ({ ...prev, required_date: e.target.value }))}
                    className="mt-1 h-8 rounded-xl text-xs"
                  />
                </div>
              </div>

              <div>
                <Label className="text-xs font-semibold uppercase text-muted-foreground">Requisition Remarks</Label>
                <Textarea
                  value={mrModal.remarks}
                  onChange={(e) => setMrModal((prev) => ({ ...prev, remarks: e.target.value }))}
                  rows={2}
                  className="mt-1 text-xs rounded-xl resize-none"
                />
              </div>
            </div>

            <DialogFooter className="gap-2 pt-2 border-t">
              <Button
                variant="outline"
                onClick={() => setMrModal((prev) => ({ ...prev, open: false }))}
                className="rounded-xl"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmitMaterialRequest}
                disabled={submittingMr}
                className="rounded-xl font-bold bg-primary text-primary-foreground gap-1.5"
              >
                {submittingMr ? <Loader2 className="size-4 animate-spin" /> : <ClipboardList className="size-4" />}
                Submit Material Requisition
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
