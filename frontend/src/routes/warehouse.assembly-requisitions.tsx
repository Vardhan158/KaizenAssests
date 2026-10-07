import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import {
  ClipboardCheck,
  Search,
  Loader2,
  Calendar,
  Building2,
  CheckCircle2,
  Clock,
  ArrowRight,
  Warehouse,
  Boxes,
  Eye,
  Send,
  Sparkles,
  Plus,
  Package,
  AlertTriangle,
  AlertCircle,
} from "lucide-react";
import { AppShell, StatusBadge } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getUserInfo } from "@/lib/auth-utils";

export const Route = createFileRoute("/warehouse/assembly-requisitions")({
  head: () => ({
    meta: [
      { title: "Assembly Material Requisitions · KaizenX" },
      {
        name: "description",
        content:
          "Review Assembly material requisitions, approve and assign fulfilling Stores for pickup tasks.",
      },
    ],
  }),
  component: WarehouseAssemblyRequisitionsPage,
});

const DEFAULT_CATEGORIES = [
  "Raw Materials",
  "Mechanical Components",
  "Electrical",
  "Steel & Metals",
  "Fasteners & Hardware",
  "Chemicals & Coatings",
  "Pipes & Fittings",
  "Packaging",
  "Consumables",
];

const UOM_OPTIONS = ["PCS", "MTR", "KG", "LTR", "BOX", "PKT", "SET", "NOS", "ROLL", "TON"];

function WarehouseAssemblyRequisitionsPage() {
  const navigate = useNavigate();
  const userRoles = (getUserInfo()?.roles || []).map((role) => role.toUpperCase());
  const isStoreUser = userRoles.includes("STORE_MANAGER") || userRoles.includes("STORE_KEEPER");
  const [requisitions, setRequisitions] = useState<any[]>([]);
  const [stores, setStores] = useState<any[]>([]);
  const [categories, setCategories] = useState<string[]>(DEFAULT_CATEGORIES);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  // Store Assignment modal
  const [assigningReq, setAssigningReq] = useState<any>(null);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [assigning, setAssigning] = useState(false);

  // View details modal
  const [viewingReq, setViewingReq] = useState<any>(null);

  // Create Material modal for custom items
  const [creatingMaterialReq, setCreatingMaterialReq] = useState<any>(null);
  const [creatingMaterialItem, setCreatingMaterialItem] = useState<any>(null);
  const [materialForm, setMaterialForm] = useState({
    material_code: "",
    material_name: "",
    category: "Raw Materials",
    base_uom: "PCS",
    description: "",
  });
  const [suggestedCodeLoading, setSuggestedCodeLoading] = useState(false);
  const [creatingMaterialLoading, setCreatingMaterialLoading] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [reqData, storeData, hierarchyData, catData] = await Promise.all([
        api.getAssemblyRequisitions(),
        api.getStores({ status: "ACTIVE" }).catch(() => []),
        api.getStoreHierarchy().catch(() => []),
        api.getMaterialCategories().catch(() => DEFAULT_CATEGORIES),
      ]);
      setRequisitions(reqData || []);
      // Store endpoints have returned both a plain array and wrapped payloads
      // in older deployments. Normalize both shapes so the assignment list is
      // never empty when the store master is populated.
      const storeList = Array.isArray(storeData)
        ? storeData
        : Array.isArray((storeData as any)?.items)
          ? (storeData as any).items
          : [];
      const hierarchyList = Array.isArray(hierarchyData)
        ? hierarchyData
        : Array.isArray((hierarchyData as any)?.stores)
          ? (hierarchyData as any).stores
          : [];
      setStores(storeList.length ? storeList : hierarchyList);
      if (catData && catData.length > 0) {
        setCategories(catData);
      }
    } catch {
      toast.error("Failed to load assembly requisitions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleOpenCreateMaterial = async (req: any, item: any) => {
    setCreatingMaterialReq(req);
    setCreatingMaterialItem(item);
    setSuggestedCodeLoading(true);
    try {
      const codeRes = await api
        .getNextMaterialCode()
        .catch(() => ({ suggested_material_code: "MAT-001" }));
      const customName =
        item.custom_material_name ||
        item.customMaterialName ||
        item.material_name ||
        item.materialName ||
        "";

      setMaterialForm({
        material_code: codeRes?.suggested_material_code || "MAT-001",
        material_name: customName,
        category: "Raw Materials",
        base_uom: item.uom || "PCS",
        description: `Created from Assembly Requisition ${req.requisitionNumber || req.requisition_number}`,
      });
    } finally {
      setSuggestedCodeLoading(false);
    }
  };

  const handleCreateMaterialSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!creatingMaterialReq || !creatingMaterialItem) return;
    if (!materialForm.material_name.trim()) {
      toast.error("Material name is required");
      return;
    }

    setCreatingMaterialLoading(true);
    try {
      const res = await api.createMaterialForAssemblyRequisitionItem(
        creatingMaterialReq.id,
        creatingMaterialItem.id,
        {
          material_name: materialForm.material_name.trim(),
          category: materialForm.category,
          base_uom: materialForm.base_uom,
          description: materialForm.description,
        },
      );
      const updatedItem = (res?.items || []).find(
        (i: any) => i.id === creatingMaterialItem.id,
      );
      const generatedCode =
        updatedItem?.material_code ||
        updatedItem?.materialCode ||
        materialForm.material_code;

      toast.success(
        `Material ${generatedCode} created successfully in Material Master and linked to requisition line!`,
      );
      setCreatingMaterialReq(null);
      setCreatingMaterialItem(null);

      // Refresh viewing state if viewing modal is open
      if (viewingReq && viewingReq.id === res.id) {
        setViewingReq(res);
      }
      fetchData();
    } catch (err: any) {
      toast.error(err.message || "Failed to create material master item");
    } finally {
      setCreatingMaterialLoading(false);
    }
  };

  const handleAssignStore = async () => {
    if (!assigningReq) {
      toast.error("Please select a Store to fulfill this requisition");
      return;
    }

    const storeIdToUse =
      selectedStoreId ||
      assigningReq.suggestedStoreId ||
      assigningReq.suggested_store_id ||
      assigningReq.assignedStoreId ||
      assigningReq.assigned_store_id ||
      (stores.length > 0 ? stores[0].id : "");

    setAssigning(true);
    try {
      const res = await api.assignAssemblyRequisitionStore(assigningReq.id, storeIdToUse);
      toast.success(
        `Requisition automatically assigned to ${res?.assigned_store?.store_name || "Store"}! Pickup tasks created for Store Keepers.`,
      );
      setAssigningReq(null);
      setSelectedStoreId("");
      fetchData();
    } catch (err: any) {
      toast.error(err.message || "Failed to assign store to requisition");
    } finally {
      setAssigning(false);
    }
  };

  // Action states
  const [reservingId, setReservingId] = useState<string | null>(null);
  const [creatingMrId, setCreatingMrId] = useState<string | null>(null);

  const handleReserveStock = async (req: any) => {
    setReservingId(req.id);
    try {
      const res = await api.reserveAssemblyRequisitionStock(req.id);
      toast.success(
        `Successfully reserved available inventory for Requisition ${res.requisition_number || res.requisitionNumber || req.requisitionNumber}!`,
      );
      if (viewingReq && viewingReq.id === req.id) {
        setViewingReq(res);
      }
      fetchData();
    } catch (err: any) {
      toast.error(err.message || "Failed to reserve available stock");
    } finally {
      setReservingId(null);
    }
  };

  const handleCreateShortageMR = (req: any) => {
    setCreatingMrId(req.id);
    const shortageItems = (req.items || [])
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

    navigate({
      to: "/warehouse/material-requests",
      search: {
        source_requisition_id: req.id,
        source_requisition_number: req.requisitionNumber || req.requisition_number,
        department: req.department || "Assembly",
        priority: req.priority || "HIGH",
        required_date: req.requiredDate || req.required_date || "",
        remarks: `Shortage fulfillment for Assembly Requisition ${req.requisitionNumber || req.requisition_number}`,
        items_json: JSON.stringify(shortageItems),
      },
    });
    setTimeout(() => setCreatingMrId(null), 1000);
  };

  const filteredRequisitions = useMemo(() => {
    return requisitions.filter((r) => {
      const matchesStatus =
        statusFilter === "ALL" || (r.status || "").toUpperCase() === statusFilter.toUpperCase();
      const q = search.trim().toLowerCase();
      const reqNum = (r.requisitionNumber || r.requisition_number || "").toLowerCase();
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
  }, [requisitions, search, statusFilter]);

  return (
    <AppShell
      title="Assembly Material Requisitions"
      subtitle="Review internal requisitions from Assembly, reserve stock, order shortages, and assign destination Stores for pickup"
    >
      <div className="space-y-6">
        {/* Filters */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="relative w-72">
            <Search className="size-3.5 absolute left-3 top-2.5 text-muted-foreground" />
            <Input
              placeholder="Search requisition or item..."
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
                <SelectItem value="PENDING">Pending Store Assignment</SelectItem>
                <SelectItem value="RESERVED">Stock Reserved</SelectItem>
                <SelectItem value="ASSIGNED_TO_STORE">Assigned to Store</SelectItem>
                <SelectItem value="PICKING">Picking In Progress</SelectItem>
                <SelectItem value="PARTIALLY_ISSUED">Partially Issued</SelectItem>
                <SelectItem value="COMPLETED">Completed</SelectItem>
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

        {/* Content */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
            <Loader2 className="size-8 animate-spin text-primary" />
            <p className="text-sm">Loading assembly requisitions...</p>
          </div>
        ) : filteredRequisitions.length === 0 ? (
          <Card className="border-dashed border-border/60 p-12 text-center bg-card/40">
            <ClipboardCheck className="size-10 mx-auto text-muted-foreground opacity-40 mb-3" />
            <h3 className="text-sm font-bold text-foreground">No Requisitions Found</h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
              Assembly requisitions awaiting warehouse stock reservation, shortage replenishment, or store assignment will appear here.
            </p>
          </Card>
        ) : (
          <div className="grid gap-4">
            {filteredRequisitions.map((req) => {
              const isAssigned = Boolean(req.assignedStoreId || req.assigned_store_id);
              const isPending =
                (req.status || "").toUpperCase() === "PENDING" ||
                (req.status || "").toUpperCase() === "RESERVED";
              const canAssign = Boolean(
                req.canAssignStore ??
                req.can_assign_store ??
                req.allItemsAvailable ??
                req.all_items_available,
              );
              const totalShortage = Number(req.total_shortage ?? req.totalShortage ?? 0);
              const totalReserved = Number(req.total_reserved ?? req.totalReserved ?? 0);
              const totalRequired = Number(req.total_required ?? req.totalRequired ?? 0);
              const hasUnreservedAvailable = (req.items || []).some((it: any) => {
                const reqQ = Number(it.required_quantity ?? it.requested_quantity ?? it.quantity ?? 0);
                const resQ = Number(it.reserved_quantity ?? 0);
                const avQ = Number(it.available_quantity ?? 0);
                return avQ > 0 && resQ < reqQ;
              });

              return (
                <Card
                  key={req.id}
                  className="border-border/40 hover:border-primary/40 transition-colors shadow-soft"
                >
                  <CardContent className="p-5">
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                      <div className="space-y-3 flex-1">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <span className="font-mono text-sm font-bold text-foreground">
                            {req.requisitionNumber || req.requisition_number}
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
                          {totalReserved > 0 && (
                            <Badge className="bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30 text-[10px] font-bold">
                              🔒 {totalReserved} Reserved
                            </Badge>
                          )}
                          {totalShortage > 0 && (
                            <Badge className="bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30 text-[10px] font-bold">
                              ⚠ Shortage: {totalShortage}
                            </Badge>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Building2 className="size-3.5" /> Department:{" "}
                            <strong className="text-foreground">{req.department}</strong>
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="size-3.5" /> Required Date:{" "}
                            <strong className="text-foreground">
                              {new Date(req.requiredDate || req.required_date).toLocaleDateString()}
                            </strong>
                          </span>
                          <span className="flex items-center gap-1">
                            <Boxes className="size-3.5" /> Items:{" "}
                            <strong className="text-foreground">{(req.items || []).length}</strong>
                          </span>
                        </div>

                        {/* Store Info & Material Availability Banner */}
                        {isAssigned ? (
                          <div className="text-xs bg-emerald-500/10 border border-emerald-500/30 text-emerald-800 dark:text-emerald-300 px-3 py-2 rounded-xl flex items-center gap-2 font-medium">
                            <Warehouse className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                            <span>
                              Assigned Store:{" "}
                              <strong>{req.assignedStoreName || req.assigned_store_name}</strong> (
                              {req.assignedStoreCode || req.assigned_store_code}) · Tasks dispatched to Store Keepers.
                            </span>
                          </div>
                        ) : isPending ? (
                          canAssign ? (
                            <div className="text-xs bg-emerald-500/10 border border-emerald-500/30 text-emerald-800 dark:text-emerald-300 px-3 py-2 rounded-xl flex items-center gap-2 font-medium">
                              <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                              <span>
                                {req.availabilityMessage ||
                                  req.availability_message ||
                                  "All materials available/reserved in inventory — Ready for Store assignment"}
                              </span>
                            </div>
                          ) : (
                            <div className="text-xs bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 px-3 py-2 rounded-xl flex items-center justify-between gap-3 font-medium">
                              <div className="flex items-center gap-2">
                                <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400 shrink-0" />
                                <span>
                                  {req.availabilityMessage ||
                                    req.availability_message ||
                                    `Material shortage (${totalShortage} remaining) — Store assignment unavailable.`}
                                </span>
                              </div>
                            </div>
                          )
                        ) : (
                          <div className="text-xs bg-muted/40 border border-border/40 text-muted-foreground px-3 py-1.5 rounded-xl flex items-center gap-2 font-medium">
                            <Clock className="size-3.5 shrink-0" />
                            <span>Status: {req.status}</span>
                          </div>
                        )}
                      </div>

                      {/* Action buttons */}
                      <div className="flex flex-wrap sm:flex-col lg:flex-row items-center gap-2 shrink-0 justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-xl h-9 text-xs"
                          onClick={() => setViewingReq(req)}
                        >
                          <Eye className="size-3.5 mr-1" /> View Details
                        </Button>

                        {isPending && hasUnreservedAvailable && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="rounded-xl h-9 text-xs border-indigo-500/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-500/10 font-bold"
                            disabled={reservingId === req.id}
                            onClick={() => handleReserveStock(req)}
                          >
                            {reservingId === req.id ? (
                              <Loader2 className="size-3.5 animate-spin mr-1.5" />
                            ) : (
                              <Sparkles className="size-3.5 mr-1.5 text-indigo-500" />
                            )}
                            Reserve Available Stock
                          </Button>
                        )}

                        {isPending && totalShortage > 0 && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="rounded-xl h-9 text-xs border-red-500/40 text-red-700 dark:text-red-300 hover:bg-red-500/10 font-bold"
                            onClick={() => handleCreateShortageMR(req)}
                          >
                            <Plus className="size-3.5 mr-1.5 text-red-500" />
                            Create Material Request ({totalShortage})
                          </Button>
                        )}

                        {!isStoreUser && isPending && canAssign && (
                          <Button
                            size="sm"
                            className="rounded-xl h-9 text-xs bg-blue-600 hover:bg-blue-700 text-white font-bold"
                            onClick={() => {
                              setAssigningReq(req);
                              setSelectedStoreId(
                                req.suggestedStoreId ||
                                req.suggested_store_id ||
                                req.assignedStoreId ||
                                req.assigned_store_id ||
                                (stores[0]?.id || ""),
                              );
                            }}
                          >
                            <Send className="size-3.5 mr-1.5" /> Assign Store
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Assign Store Modal */}
      {!isStoreUser && <Dialog open={Boolean(assigningReq)} onOpenChange={(open) => !open && setAssigningReq(null)}>
        <DialogContent className="max-w-md rounded-3xl p-6 bg-card border-none shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              <Warehouse className="size-5 text-blue-600" />
              Automatic Store Assignment
            </DialogTitle>
          </DialogHeader>

          {assigningReq && (
            <div className="space-y-4 py-2">
              <div className="p-3 bg-muted/40 rounded-2xl space-y-1 text-xs">
                <p className="text-muted-foreground">Requisition Number:</p>
                <p className="font-mono font-bold text-sm text-foreground">
                  {assigningReq.requisitionNumber || assigningReq.requisition_number}
                </p>
                <p className="text-muted-foreground mt-1">
                  Department: <strong className="text-foreground">{assigningReq.department}</strong>{" "}
                  · Priority: <strong className="text-foreground">{assigningReq.priority}</strong>
                </p>
              </div>

              {/* Auto-determined Store Banner */}
              <div className="p-3.5 bg-blue-500/10 border border-blue-500/25 rounded-2xl space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-bold text-blue-800 dark:text-blue-300">
                  <CheckCircle2 className="size-4 text-blue-600 shrink-0" />
                  <span>Auto-Determined Store from Inventory</span>
                </div>
                <p className="text-xs font-medium text-foreground">
                  {assigningReq.suggestedStoreName ||
                    assigningReq.suggested_store_name ||
                    stores.find((s) => s.id === selectedStoreId)?.store_name ||
                    "Auto-selected Store"}
                </p>
                {(assigningReq.storeAvailabilitySummary || assigningReq.store_availability_summary) && (
                  <p className="text-[11px] text-muted-foreground">
                    <strong>Availability:</strong>{" "}
                    {assigningReq.storeAvailabilitySummary || assigningReq.store_availability_summary}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-bold">Fulfilling Store</Label>
                <Select value={selectedStoreId} onValueChange={setSelectedStoreId}>
                  <SelectTrigger className="rounded-xl text-xs h-10 border-border/40">
                    <SelectValue placeholder="System auto-selected store..." />
                  </SelectTrigger>
                  <SelectContent>
                    {stores.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-mono font-bold text-primary">
                            {s.store_code || s.storeCode}
                          </span>
                          <span>—</span>
                          <span className="font-medium">{s.store_name || s.storeName}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Assigning this Store will create Pickup Tasks for Store Keepers and send them targeted notifications.
                </p>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="ghost" className="rounded-xl" onClick={() => setAssigningReq(null)}>
              Cancel
            </Button>
            <Button
              className="rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold"
              disabled={assigning || (!selectedStoreId && !assigningReq?.suggested_store_id && !assigningReq?.suggestedStoreId)}
              onClick={handleAssignStore}
            >
              {assigning ? (
                <Loader2 className="size-4 animate-spin mr-2" />
              ) : (
                <CheckCircle2 className="size-4 mr-2" />
              )}
              Confirm Store Assignment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>}

      {/* View Details Modal */}
      <Dialog open={Boolean(viewingReq)} onOpenChange={(open) => !open && setViewingReq(null)}>
        <DialogContent className="max-w-3xl rounded-3xl p-6 bg-card border-none shadow-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              <ClipboardCheck className="size-5 text-blue-600" />
              Requisition Details & Stock Availability
            </DialogTitle>
          </DialogHeader>

          {viewingReq && (
            <div className="space-y-4 py-2 text-xs">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-muted/40 p-3.5 rounded-2xl">
                <div>
                  <p className="text-[10px] uppercase font-bold text-muted-foreground">
                    Requisition Number
                  </p>
                  <p className="font-mono font-bold text-base text-foreground">
                    {viewingReq.requisitionNumber || viewingReq.requisition_number}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <StatusBadge status={viewingReq.status} />
                  {viewingReq.priority && (
                    <Badge variant="outline" className="text-[10px] font-bold uppercase">
                      {viewingReq.priority}
                    </Badge>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 bg-muted/20 rounded-2xl border border-border/30">
                  <span className="text-muted-foreground block text-[11px]">Total Required</span>
                  <strong className="text-sm font-mono text-foreground">
                    {Number(viewingReq.total_required ?? viewingReq.totalRequired ?? 0)}
                  </strong>
                </div>
                <div className="p-3 bg-muted/20 rounded-2xl border border-border/30">
                  <span className="text-muted-foreground block text-[11px]">Total Available</span>
                  <strong className="text-sm font-mono text-emerald-600">
                    {Number(viewingReq.total_available ?? viewingReq.totalAvailable ?? 0)}
                  </strong>
                </div>
                <div className="p-3 bg-indigo-500/10 rounded-2xl border border-indigo-500/20">
                  <span className="text-indigo-700 dark:text-indigo-300 block text-[11px] font-medium">Already Reserved</span>
                  <strong className="text-sm font-mono text-indigo-700 dark:text-indigo-300">
                    {Number(viewingReq.total_reserved ?? viewingReq.totalReserved ?? 0)}
                  </strong>
                </div>
                <div className="p-3 bg-red-500/10 rounded-2xl border border-red-500/20">
                  <span className="text-red-700 dark:text-red-300 block text-[11px] font-medium">Remaining Shortage</span>
                  <strong className="text-sm font-mono text-red-700 dark:text-red-300">
                    {Number(viewingReq.total_shortage ?? viewingReq.totalShortage ?? 0)}
                  </strong>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs bg-muted/20 p-3 rounded-2xl">
                <div>
                  <span className="text-muted-foreground">Department:</span>{" "}
                  <strong className="text-foreground">{viewingReq.department}</strong>
                </div>
                <div>
                  <span className="text-muted-foreground">Requested By:</span>{" "}
                  <strong className="text-foreground">
                    {viewingReq.requested_by || viewingReq.requestedBy}
                  </strong>
                </div>
                <div>
                  <span className="text-muted-foreground">Required Date:</span>{" "}
                  <strong className="text-foreground">
                    {new Date(
                      viewingReq.requiredDate || viewingReq.required_date,
                    ).toLocaleDateString()}
                  </strong>
                </div>
                <div>
                  <span className="text-muted-foreground">Store Assignment:</span>{" "}
                  <strong className="text-foreground">
                    {viewingReq.assignedStoreName || viewingReq.assigned_store_name || "Unassigned"}
                  </strong>
                </div>
              </div>

              {/* Status Alert in Modal */}
              {viewingReq.status === "PENDING" && (
                (viewingReq.allItemsAvailable ??
                viewingReq.all_items_available ??
                viewingReq.canAssignStore ??
                viewingReq.can_assign_store) ? (
                  <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex items-center gap-2.5 text-emerald-800 dark:text-emerald-300">
                    <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <div className="flex-1">
                      <p className="font-bold text-xs">Inventory Available</p>
                      <p className="text-[11px] opacity-90">
                        {viewingReq.availabilityMessage ||
                          viewingReq.availability_message ||
                          "All requested materials are available/reserved in inventory — Ready for Store assignment."}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-2xl flex items-center gap-2.5 text-amber-800 dark:text-amber-300">
                    <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400 shrink-0" />
                    <div className="flex-1">
                      <p className="font-bold text-xs">Store Assignment Unavailable</p>
                      <p className="text-[11px] opacity-90">
                        {viewingReq.availabilityMessage ||
                          viewingReq.availability_message ||
                          "Material shortage — Store assignment unavailable until inventory is replenished or custom items are registered."}
                      </p>
                    </div>
                  </div>
                )
              )}

              {/* Material Lines Table */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="font-bold text-muted-foreground uppercase text-[11px]">
                    Requested Materials & Stock Availability Breakdown
                  </p>
                </div>
                <div className="border border-border/40 rounded-2xl overflow-hidden bg-card">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-border/40 bg-muted/40 text-muted-foreground text-[11px] font-semibold">
                          <th className="p-3">Material</th>
                          <th className="p-3 text-right">Required</th>
                          <th className="p-3 text-right">Available</th>
                          <th className="p-3 text-right">Reserved</th>
                          <th className="p-3 text-right">Shortage</th>
                          <th className="p-3">Location / Hint</th>
                          <th className="p-3 text-center">Status</th>
                          <th className="p-3 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/30">
                        {(viewingReq.items || []).map((it: any, idx: number) => {
                          const isCustom =
                            it.isCustom ||
                            it.is_custom ||
                            it.materialCode === "CUSTOM" ||
                            it.material_code === "CUSTOM";
                          const isPendingCreation =
                            isCustom && (!it.materialId && !it.material_id);
                          const reqQty = Number(
                            it.required_quantity ?? it.requiredQuantity ?? it.requested_quantity ?? it.requestedQuantity ?? it.quantity ?? 0,
                          );
                          const availQty = Number(it.available_quantity ?? it.availableQuantity ?? 0);
                          const resQty = Number(it.reserved_quantity ?? it.reservedQuantity ?? 0);
                          const shortageQty = Number(
                            it.shortage_quantity ?? it.shortageQuantity ?? Math.max(0, reqQty - resQty - availQty),
                          );
                          const locHint = it.location_hint || it.locationHint;

                          return (
                            <tr
                              key={idx}
                              className={cn(
                                "transition-colors hover:bg-muted/20",
                                isCustom ? "bg-amber-500/5" : shortageQty > 0 ? "bg-red-500/5" : "",
                              )}
                            >
                              <td className="p-3">
                                <div>
                                  <p className="font-semibold text-foreground">
                                    {it.custom_material_name ||
                                      it.customMaterialName ||
                                      it.material_name ||
                                      it.materialName}
                                  </p>
                                  <div className="flex items-center gap-1.5 mt-0.5">
                                    {isCustom ? (
                                      <Badge className="bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/30 text-[9px] font-bold">
                                        ✨ CUSTOM
                                      </Badge>
                                    ) : (
                                      <span className="font-mono text-[10px] text-muted-foreground">
                                        {it.material_code || it.materialCode}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td className="p-3 text-right font-mono font-bold text-foreground">
                                {reqQty} <span className="text-[10px] text-muted-foreground font-normal">{it.uom}</span>
                              </td>
                              <td className="p-3 text-right font-mono font-bold text-emerald-600">
                                {availQty} <span className="text-[10px] text-muted-foreground font-normal">{it.uom}</span>
                              </td>
                              <td className="p-3 text-right font-mono font-bold text-indigo-600">
                                {resQty} <span className="text-[10px] text-muted-foreground font-normal">{it.uom}</span>
                              </td>
                              <td className="p-3 text-right font-mono font-bold text-red-600">
                                {shortageQty} <span className="text-[10px] text-muted-foreground font-normal">{it.uom}</span>
                              </td>
                              <td className="p-3 text-[11px] text-muted-foreground max-w-[150px] truncate">
                                {locHint ? (
                                  <span title={locHint} className="font-medium text-foreground">
                                    📍 {locHint}
                                  </span>
                                ) : (
                                  <span className="italic opacity-60">None / Warehouse</span>
                                )}
                              </td>
                              <td className="p-3 text-center">
                                {isPendingCreation ? (
                                  <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 text-[10px]">
                                    Unregistered
                                  </Badge>
                                ) : resQty >= reqQty ? (
                                  <Badge className="bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30 text-[10px]">
                                    Reserved
                                  </Badge>
                                ) : shortageQty === 0 ? (
                                  <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 text-[10px]">
                                    Available
                                  </Badge>
                                ) : (
                                  <Badge className="bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30 text-[10px]">
                                    Shortage
                                  </Badge>
                                )}
                              </td>
                              <td className="p-3 text-right">
                                {isPendingCreation && (
                                  <Button
                                    size="sm"
                                    className="h-7 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-bold text-[11px] px-2"
                                    onClick={() => handleOpenCreateMaterial(viewingReq, it)}
                                  >
                                    <Sparkles className="size-3 mr-1" /> Register
                                  </Button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {viewingReq.remarks && (
                <div className="p-3 bg-muted/20 rounded-xl text-muted-foreground">
                  <strong>Remarks:</strong> {viewingReq.remarks}
                </div>
              )}
            </div>
          )}

          <DialogFooter className="flex-col sm:flex-row gap-2 sm:justify-between items-center pt-2">
            <div className="flex items-center gap-2 flex-wrap">
              {viewingReq &&
                (viewingReq.status === "PENDING" || viewingReq.status === "RESERVED") && (
                  <>
                    {(viewingReq.items || []).some((it: any) => {
                      const reqQ = Number(it.required_quantity ?? it.requested_quantity ?? it.quantity ?? 0);
                      const resQ = Number(it.reserved_quantity ?? 0);
                      const avQ = Number(it.available_quantity ?? 0);
                      return avQ > 0 && resQ < reqQ;
                    }) && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-xl h-9 text-xs border-indigo-500/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-500/10 font-bold"
                        disabled={reservingId === viewingReq.id}
                        onClick={() => handleReserveStock(viewingReq)}
                      >
                        {reservingId === viewingReq.id ? (
                          <Loader2 className="size-3.5 animate-spin mr-1.5" />
                        ) : (
                          <Sparkles className="size-3.5 mr-1.5 text-indigo-500" />
                        )}
                        Reserve Available Stock
                      </Button>
                    )}

                    {Number(viewingReq.total_shortage ?? viewingReq.totalShortage ?? 0) > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-xl h-9 text-xs border-red-500/40 text-red-700 dark:text-red-300 hover:bg-red-500/10 font-bold"
                        disabled={creatingMrId === viewingReq.id}
                        onClick={() => handleCreateShortageMR(viewingReq)}
                      >
                        {creatingMrId === viewingReq.id ? (
                          <Loader2 className="size-3.5 animate-spin mr-1.5" />
                        ) : (
                          <Plus className="size-3.5 mr-1.5 text-red-500" />
                        )}
                        Create Material Request ({Number(viewingReq.total_shortage ?? viewingReq.totalShortage ?? 0)})
                      </Button>
                    )}

                    {Boolean(
                      viewingReq.canAssignStore ??
                      viewingReq.can_assign_store ??
                      viewingReq.allItemsAvailable ??
                      viewingReq.all_items_available,
                    ) && (
                      <Button
                        size="sm"
                        className="rounded-xl h-9 text-xs bg-blue-600 hover:bg-blue-700 text-white font-bold"
                        onClick={() => {
                          const reqToAssign = viewingReq;
                          setViewingReq(null);
                          setAssigningReq(reqToAssign);
                          setSelectedStoreId(
                            reqToAssign.assignedStoreId || reqToAssign.assigned_store_id || "",
                          );
                        }}
                      >
                        <Send className="size-3.5 mr-1.5" /> Assign Store
                      </Button>
                    )}
                  </>
                )}
            </div>

            <Button variant="outline" className="rounded-xl text-xs h-9" onClick={() => setViewingReq(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Material Master Modal for Custom Requisition Items */}
      <Dialog
        open={Boolean(creatingMaterialReq && creatingMaterialItem)}
        onOpenChange={(open) => {
          if (!open) {
            setCreatingMaterialReq(null);
            setCreatingMaterialItem(null);
          }
        }}
      >
        <DialogContent className="max-w-lg rounded-3xl p-6 bg-card border-none shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              <Sparkles className="size-5 text-amber-500" />
              Create Material in Master Data
            </DialogTitle>
          </DialogHeader>

          {creatingMaterialItem && (
            <form onSubmit={handleCreateMaterialSubmit} className="space-y-4 py-2 text-xs">
              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-2xl space-y-1">
                <p className="text-[11px] font-semibold text-amber-800 dark:text-amber-300">
                  Custom Assembly Request Line:
                </p>
                <p className="text-sm font-bold text-foreground">
                  {creatingMaterialItem.custom_material_name ||
                    creatingMaterialItem.customMaterialName ||
                    creatingMaterialItem.material_name ||
                    creatingMaterialItem.materialName}
                </p>
                <p className="text-muted-foreground text-[11px]">
                  Requested:{" "}
                  <strong>
                    {creatingMaterialItem.quantity || creatingMaterialItem.requested_quantity}{" "}
                    {creatingMaterialItem.uom}
                  </strong>{" "}
                  · Req #{creatingMaterialReq?.requisitionNumber || creatingMaterialReq?.requisition_number}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold flex items-center justify-between">
                    Generated Code
                    {suggestedCodeLoading && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
                  </Label>
                  <Input
                    value={materialForm.material_code}
                    readOnly
                    className="h-9 rounded-xl bg-muted/50 font-mono font-bold text-xs text-primary border-border/40"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Canonical auto-sequenced code
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-bold">Base UOM</Label>
                  <Select
                    value={materialForm.base_uom}
                    onValueChange={(val) => setMaterialForm({ ...materialForm, base_uom: val })}
                  >
                    <SelectTrigger className="h-9 rounded-xl text-xs border-border/40">
                      <SelectValue placeholder="Select UOM" />
                    </SelectTrigger>
                    <SelectContent>
                      {UOM_OPTIONS.map((u) => (
                        <SelectItem key={u} value={u}>
                          {u}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Material Name *</Label>
                <Input
                  value={materialForm.material_name}
                  onChange={(e) =>
                    setMaterialForm({ ...materialForm, material_name: e.target.value })
                  }
                  className="h-9 rounded-xl text-xs border-border/40"
                  placeholder="e.g. Special Impeller Shaft"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Category</Label>
                <Select
                  value={materialForm.category}
                  onValueChange={(val) => setMaterialForm({ ...materialForm, category: val })}
                >
                  <SelectTrigger className="h-9 rounded-xl text-xs border-border/40">
                    <SelectValue placeholder="Select Category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Description / Technical Specifications</Label>
                <Textarea
                  value={materialForm.description}
                  onChange={(e) =>
                    setMaterialForm({ ...materialForm, description: e.target.value })
                  }
                  className="rounded-xl text-xs border-border/40 min-h-[60px]"
                  placeholder="Optional material specs, grade, dimensions, etc."
                />
              </div>

              <DialogFooter className="gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  className="rounded-xl"
                  onClick={() => {
                    setCreatingMaterialReq(null);
                    setCreatingMaterialItem(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold"
                  disabled={creatingMaterialLoading || !materialForm.material_name.trim()}
                >
                  {creatingMaterialLoading ? (
                    <Loader2 className="size-4 animate-spin mr-2" />
                  ) : (
                    <Sparkles className="size-4 mr-2" />
                  )}
                  Create & Link to Requisition
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
