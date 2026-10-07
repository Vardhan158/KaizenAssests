import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import {
  ClipboardList,
  Plus,
  Search,
  Loader2,
  Calendar,
  Clock,
  Building2,
  CheckCircle2,
  Trash2,
  Save,
  X,
  Check,
  PackageCheck,
  AlertCircle,
  Sparkles,
  ArrowRightLeft,
} from "lucide-react";
import { AppShell, StatusBadge } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api-client";
import { getUserInfo } from "@/lib/auth-utils";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/assembly/requests")({
  head: () => ({
    meta: [
      { title: "Assembly Material Requisitions · KaizenX" },
      {
        name: "description",
        content:
          "Create and track internal material requisitions from Assembly to Stores and Warehouse.",
      },
    ],
  }),
  component: AssemblyRequestsPage,
});

const UOM_OPTIONS = ["PCS", "MTR", "KG", "LTR", "BOX", "PKT", "SET", "NOS", "ROLL", "TON"];

interface RequisitionItemRow {
  material_id: string;
  material_variant_id: string;
  material_code: string;
  variant_code: string;
  material_name: string;
  quantity: number | string;
  uom: string;
  is_custom: boolean;
  custom_material_name: string;
}

function AssemblyRequestsPage() {
  const [requests, setRequests] = useState<any[]>([]);
  const [masterMaterials, setMasterMaterials] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [selectedRequest, setSelectedRequest] = useState<any>(null);
  const [isViewing, setIsViewing] = useState(false);

  const user = getUserInfo();

  const [formData, setFormData] = useState({
    warehouse_id: "Main Warehouse",
    department: "Assembly",
    requested_by: user?.username || "Assembly Operator",
    priority: "MEDIUM",
    required_date: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    remarks: "",
  });

  const [items, setItems] = useState<RequisitionItemRow[]>([
    {
      material_id: "",
      material_variant_id: "",
      material_code: "",
      variant_code: "",
      material_name: "",
      quantity: 1,
      uom: "PCS",
      is_custom: false,
      custom_material_name: "",
    },
  ]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [reqData, matData] = await Promise.all([
        api.getAssemblyRequisitions("Assembly"),
        api.getMaterials({ status: "Active" }).catch(() => []),
      ]);
      setRequests(reqData || []);
      setMasterMaterials(matData || []);
    } catch {
      toast.error("Failed to load assembly material requisitions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const timer = window.setInterval(() => void fetchData(), 10000);
    return () => window.clearInterval(timer);
  }, []);

  const addItem = (isCustom = false) => {
    setItems([
      ...items,
      {
        material_id: "",
        material_variant_id: "",
        material_code: isCustom ? "CUSTOM" : "",
        variant_code: "",
        material_name: "",
        quantity: 1,
        uom: "PCS",
        is_custom: isCustom,
        custom_material_name: "",
      },
    ]);
  };

  const removeItem = (idx: number) => {
    if (items.length === 1) return;
    setItems(items.filter((_, i) => i !== idx));
  };

  const handleSelectMaterial = (idx: number, matId: string) => {
    if (matId === "__CUSTOM__") {
      setItems(
        items.map((it, i) =>
          i === idx
            ? {
                ...it,
                material_id: "",
                material_variant_id: "",
                material_code: "CUSTOM",
                variant_code: "",
                material_name: "",
                is_custom: true,
                custom_material_name: "",
              }
            : it,
        ),
      );
      return;
    }

    const foundMat = masterMaterials.find((m) => m.id === matId);
    if (!foundMat) return;
    const defaultVariant = foundMat.variants?.[0];
    const specDetails = defaultVariant
      ? [defaultVariant.size, defaultVariant.color, defaultVariant.grade].filter(Boolean).join(", ")
      : "";
    const nameWithSpec = specDetails
      ? `${foundMat.material_name} (${specDetails})`
      : foundMat.material_name;

    setItems(
      items.map((it, i) =>
        i === idx
          ? {
              ...it,
              material_id: foundMat.id,
              material_variant_id: defaultVariant?.id || "",
              material_code: foundMat.material_code,
              variant_code: defaultVariant?.variant_code || "",
              material_name: nameWithSpec,
              uom: defaultVariant?.uom || foundMat.base_uom || "PCS",
              is_custom: false,
              custom_material_name: "",
            }
          : it,
      ),
    );
  };

  const toggleRowMode = (idx: number, toCustom: boolean) => {
    setItems(
      items.map((it, i) =>
        i === idx
          ? {
              ...it,
              is_custom: toCustom,
              material_id: "",
              material_variant_id: "",
              material_code: toCustom ? "CUSTOM" : "",
              variant_code: "",
              material_name: toCustom ? it.custom_material_name : "",
            }
          : it,
      ),
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.is_custom) {
        if (!it.custom_material_name?.trim()) {
          toast.error(`Please enter the Custom Material Name for row ${i + 1}`);
          return;
        }
      } else {
        if (!it.material_id?.trim() || !it.material_code?.trim()) {
          toast.error(`Please select a material for row ${i + 1}`);
          return;
        }
      }
      if (!it.quantity || parseFloat(it.quantity as string) <= 0) {
        toast.error(`Quantity must be greater than 0 for row ${i + 1}`);
        return;
      }
    }

    setSubmitting(true);
    try {
      const payload = {
        warehouse_id: formData.warehouse_id,
        department: "Assembly",
        requested_by: formData.requested_by,
        priority: formData.priority,
        required_date: formData.required_date,
        remarks: formData.remarks,
        items: items.map((it) => ({
          material_id: it.is_custom ? null : it.material_id || null,
          material_variant_id: it.is_custom ? null : it.material_variant_id || null,
          material_code: it.is_custom ? "CUSTOM" : it.material_code,
          variant_code: it.is_custom ? null : it.variant_code || null,
          material_name: it.is_custom ? it.custom_material_name.trim() : it.material_name,
          custom_material_name: it.is_custom ? it.custom_material_name.trim() : null,
          quantity: parseFloat(it.quantity as string) || 1,
          uom: it.uom || "PCS",
          is_custom: !!it.is_custom,
        })),
      };

      const created = await api.createAssemblyRequisition(payload);
      const shortage = Number(created?.totalShortage ?? created?.total_shortage ?? 0);
      if (shortage > 0 || created?.availabilityStatus === "SHORTAGE" || created?.availability_status === "SHORTAGE") {
        toast.warning("Request submitted with an inventory shortage", {
          description: created?.availabilityMessage || created?.availability_message || `${shortage} unit${shortage === 1 ? "" : "s"} are not currently available. Warehouse must replenish stock before the full request can be issued.`,
        });
      } else {
        toast.success("Assembly Material Requisition submitted to Warehouse!");
      }
      setIsCreating(false);
      setItems([
        {
          material_id: "",
          material_variant_id: "",
          material_code: "",
          variant_code: "",
          material_name: "",
          quantity: 1,
          uom: "PCS",
          is_custom: false,
          custom_material_name: "",
        },
      ]);
      fetchData();
    } catch (err: any) {
      toast.error(err.message || "Failed to create assembly material requisition");
    } finally {
      setSubmitting(false);
    }
  };

  const filteredRequests = useMemo(() => {
    return requests.filter((r) => {
      const matchesStatus =
        statusFilter === "ALL" || (r.status || "").toUpperCase() === statusFilter.toUpperCase();
      const q = search.trim().toLowerCase();
      const reqNum = (
        r.requisitionNumber ||
        r.requisition_number ||
        r.requestNumber ||
        r.request_number ||
        ""
      ).toLowerCase();
      const matchesSearch =
        !q ||
        reqNum.includes(q) ||
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
      title="Assembly Material Requisitions"
      subtitle="Request components and production materials from Warehouse & Stores"
      actions={
        <Button
          className="rounded-xl shadow-glow bg-blue-600 hover:bg-blue-700 text-white font-bold"
          onClick={() => setIsCreating(true)}
        >
          <Plus className="mr-2 size-4" /> New Material Requisition
        </Button>
      }
    >
      <div className="space-y-6">
        {/* Filters */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="relative w-72">
            <Search className="size-3.5 absolute left-3 top-2.5 text-muted-foreground" />
            <Input
              placeholder="Search request number or material..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-9 text-xs rounded-xl bg-background/60 border-border/40"
            />
          </div>

          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40 h-9 text-xs rounded-xl border-border/40">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Status</SelectItem>
                <SelectItem value="PENDING">Pending Warehouse</SelectItem>
                <SelectItem value="ASSIGNED_TO_STORE">Assigned to Store</SelectItem>
                <SelectItem value="PICKING">Picking In Progress</SelectItem>
                <SelectItem value="COMPLETED">Completed / Handed Over</SelectItem>
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
            <p className="text-sm">Loading assembly requests...</p>
          </div>
        ) : filteredRequests.length === 0 ? (
          <Card className="border-dashed border-border/60 p-12 text-center bg-card/40">
            <ClipboardList className="size-10 mx-auto text-muted-foreground opacity-40 mb-3" />
            <h3 className="text-sm font-bold text-foreground">No Material Requests Found</h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
              Create a new request to notify Warehouse and have your required items picked from the
              appropriate Store.
            </p>
            <Button
              size="sm"
              onClick={() => setIsCreating(true)}
              className="mt-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold"
            >
              <Plus className="size-3.5 mr-1.5" /> Create First Request
            </Button>
          </Card>
        ) : (
          <div className="grid gap-3">
            {filteredRequests.map((req) => (
              <Card
                key={req.id}
                className="border-border/40 hover:border-primary/40 transition-colors cursor-pointer shadow-soft"
                onClick={() => {
                  setSelectedRequest(req);
                  setIsViewing(true);
                }}
              >
                <CardContent className="p-5">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="space-y-2 flex-1">
                      <div className="flex items-center gap-2.5">
                        <span className="font-mono text-sm font-bold text-foreground">
                          {req.requisitionNumber ||
                            req.requisition_number ||
                            req.requestNumber ||
                            req.request_number}
                        </span>
                        <StatusBadge status={req.status} />
                        {req.priority && (
                          <span
                            className={cn(
                              "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase",
                              req.priority === "URGENT"
                                ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                                : req.priority === "HIGH"
                                  ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                                  : "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
                            )}
                          >
                            {req.priority}
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Building2 className="size-3.5" /> Dept:{" "}
                          <strong className="text-foreground">{req.department}</strong>
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="size-3.5" /> Required by:{" "}
                          <strong className="text-foreground">
                            {new Date(req.requiredDate || req.required_date).toLocaleDateString()}
                          </strong>
                        </span>
                        {req.assignedStoreName || req.assigned_store_name ? (
                          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-bold bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800 text-[11px]">
                            <Building2 className="size-3" /> Fulfilling Store:{" "}
                            {req.assignedStoreName || req.assigned_store_name} (
                            {req.assignedStoreCode || req.assigned_store_code})
                          </span>
                        ) : (
                          <span className="text-amber-600 text-[11px] font-medium italic">
                            Awaiting Warehouse Store Assignment
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2 pt-1">
                        {req.items?.map((it: any, idx: number) => {
                          const reqQty = Number(
                            it.requestedQuantity || it.requested_quantity || it.quantity || 0,
                          );
                          const issQty = Number(it.issuedQuantity || it.issued_quantity || 0);
                          const remQty = Math.max(0, reqQty - issQty);
                          const isCustomLine = Boolean(
                            it.is_custom ||
                            it.isCustom ||
                            it.materialCode === "CUSTOM" ||
                            it.material_code === "CUSTOM" ||
                            (!it.material_id && !it.materialId && (it.custom_material_name || it.customMaterialName))
                          );
                          const matCreated = Boolean(
                            it.materialCode &&
                            it.materialCode !== "CUSTOM" &&
                            it.materialCode !== "MAT-REQ" &&
                            (it.custom_material_name || it.customMaterialName)
                          );

                          return (
                            <span
                              key={idx}
                              className={cn(
                                "text-[11px] px-2.5 py-1 rounded-lg border font-medium flex items-center gap-1.5",
                                isCustomLine
                                  ? "text-amber-700 dark:text-amber-300 bg-amber-500/10 border-amber-500/30"
                                  : "text-primary bg-primary/10 border-primary/20",
                              )}
                            >
                              {isCustomLine && (
                                <span className="inline-flex items-center px-1.5 py-0.2 text-[9px] font-black uppercase tracking-wider bg-amber-500/20 text-amber-700 dark:text-amber-300 rounded">
                                  ✨ NEW MATERIAL
                                </span>
                              )}
                              {matCreated && (
                                <span className="inline-flex items-center px-1.5 py-0.2 text-[9px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 rounded">
                                  ✓ CODE: {it.materialCode || it.material_code}
                                </span>
                              )}
                              <span>
                                {it.materialName ||
                                  it.material_name ||
                                  it.materialCode ||
                                  it.material_code}
                                :{" "}
                                <strong>
                                  {reqQty} {it.uom}
                                </strong>
                              </span>
                              {issQty > 0 && (
                                <span className="ml-1 text-emerald-600 font-bold">
                                  (Issued: {issQty}/{reqQty}
                                  {remQty > 0 ? ` · Rem: ${remQty}` : " · Complete"})
                                </span>
                              )}
                            </span>
                          );
                        })}
                      </div>
                      {Number(req.totalShortage ?? req.total_shortage ?? 0) > 0 && (
                        <div className="mt-2 flex items-center gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200">
                          <AlertCircle className="size-3.5 shrink-0" />
                          Inventory shortage: {Number(req.totalShortage ?? req.total_shortage).toLocaleString()} {req.items?.[0]?.uom || "units"} still required. Inventory low-stock alerts have been updated.
                        </div>
                      )}
                      {req.pickup_progress && req.pickup_progress.task_count > 0 && (
                        <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50/60 px-3 py-2 text-xs dark:border-blue-900 dark:bg-blue-950/30">
                          <div className="flex flex-wrap items-center gap-2 font-bold text-blue-800 dark:text-blue-200">
                            <PackageCheck className="size-3.5" />
                            Store pickup: {String(req.pickup_progress.status || "ASSIGNED").replaceAll("_", " ")}
                            <span className="font-normal text-blue-700 dark:text-blue-300">
                              {req.pickup_progress.picked_quantity}/{req.pickup_progress.requested_quantity} issued
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                            {(req.pickup_tracking || []).map((task: any) => (
                              <span key={task.task_number}>
                                {task.task_number}: {String(task.status || "PENDING").replaceAll("_", " ")} ({task.picked_quantity}/{task.requested_quantity})
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="text-right shrink-0">
                      <p className="text-[10px] uppercase font-bold text-muted-foreground">
                        Created
                      </p>
                      <p className="text-xs font-bold tabular-nums">
                        {new Date(req.createdAt || req.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Create Material Request Dialog */}
      <Dialog open={isCreating} onOpenChange={setIsCreating}>
        <DialogContent className="max-w-2xl rounded-3xl p-6 border-none shadow-2xl bg-card">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              <ClipboardList className="size-5 text-blue-600" />
              New Assembly Material Request
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-bold text-muted-foreground">Department</Label>
                <Input value="Assembly" readOnly className="h-9 rounded-xl text-xs bg-muted/50" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-bold text-muted-foreground">Priority</Label>
                <Select
                  value={formData.priority}
                  onValueChange={(val) => setFormData({ ...formData, priority: val })}
                >
                  <SelectTrigger className="h-9 rounded-xl text-xs">
                    <SelectValue placeholder="Priority" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LOW">Low</SelectItem>
                    <SelectItem value="MEDIUM">Medium</SelectItem>
                    <SelectItem value="HIGH">High</SelectItem>
                    <SelectItem value="URGENT">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 col-span-2 sm:col-span-1">
                <Label className="text-xs font-bold text-muted-foreground">Required Date</Label>
                <Input
                  type="date"
                  min={new Date().toISOString().split("T")[0]}
                  value={formData.required_date}
                  onChange={(e) => setFormData({ ...formData, required_date: e.target.value })}
                  className="h-9 rounded-xl text-xs"
                  required
                />
              </div>
            </div>

            {/* Requested Items */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold uppercase text-muted-foreground">
                  Requested Items
                </Label>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => addItem(false)}
                    className="h-7 text-xs rounded-lg border-border/60"
                  >
                    <Plus className="size-3 mr-1" /> Add Standard Item
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => addItem(true)}
                    className="h-7 text-xs rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold shadow-sm"
                  >
                    <Sparkles className="size-3 mr-1 text-amber-300" /> + Add Custom Item
                  </Button>
                </div>
              </div>

              <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
                {items.map((item, idx) => (
                  <div
                    key={idx}
                    className={cn(
                      "p-3 rounded-2xl border transition-all flex flex-col gap-2.5",
                      item.is_custom
                        ? "bg-amber-500/5 border-amber-500/30 dark:bg-amber-950/10"
                        : "bg-muted/20 border-border/50",
                    )}
                  >
                    {item.is_custom ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 text-[10px] font-bold px-2 py-0.5">
                            <Sparkles className="size-3 mr-1 text-amber-500 inline" /> Custom / New Raw Material
                          </Badge>
                          <button
                            type="button"
                            onClick={() => toggleRowMode(idx, false)}
                            className="text-[11px] text-blue-600 hover:text-blue-700 dark:text-blue-400 hover:underline flex items-center gap-1 font-medium"
                          >
                            <ArrowRightLeft className="size-3" /> Select from Material Master instead
                          </button>
                        </div>

                        <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
                          <div className="flex-1 w-full">
                            <Input
                              placeholder="Enter custom raw material name (e.g. Special Impeller Shaft)"
                              value={item.custom_material_name}
                              onChange={(e) =>
                                setItems(
                                  items.map((it, i) =>
                                    i === idx
                                      ? {
                                          ...it,
                                          custom_material_name: e.target.value,
                                          material_name: e.target.value,
                                        }
                                      : it,
                                  ),
                                )
                              }
                              className="h-9 rounded-xl text-xs bg-background/80 border-amber-500/30 focus-visible:ring-amber-500/40"
                              required
                              autoFocus={item.is_custom && !item.custom_material_name}
                            />
                          </div>

                          <div className="w-24">
                            <Input
                              type="number"
                              min="0.0001"
                              step="any"
                              placeholder="Qty"
                              value={item.quantity}
                              onChange={(e) =>
                                setItems(
                                  items.map((it, i) =>
                                    i === idx ? { ...it, quantity: e.target.value } : it,
                                  ),
                                )
                              }
                              className="h-9 rounded-xl text-xs bg-background/80"
                              required
                            />
                          </div>

                          <div className="w-24">
                            <Select
                              value={item.uom}
                              onValueChange={(val) =>
                                setItems(
                                  items.map((it, i) => (i === idx ? { ...it, uom: val } : it)),
                                )
                              }
                            >
                              <SelectTrigger className="h-9 rounded-xl text-xs bg-background/80">
                                <SelectValue placeholder="UOM" />
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

                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={items.length <= 1}
                            onClick={() => removeItem(idx)}
                            className="size-9 rounded-xl text-destructive hover:bg-destructive/10 shrink-0"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
                        <div className="flex-1 w-full">
                          <Select
                            value={item.material_id}
                            onValueChange={(val) => handleSelectMaterial(idx, val)}
                          >
                            <SelectTrigger className="h-9 rounded-xl text-xs bg-background">
                              <SelectValue placeholder="Select Material" />
                            </SelectTrigger>
                            <SelectContent className="max-h-60">
                              <SelectItem
                                value="__CUSTOM__"
                                className="text-blue-600 font-semibold cursor-pointer border-b border-border/40 pb-1.5 focus:bg-blue-50 dark:focus:bg-blue-950"
                              >
                                <span className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400">
                                  <Sparkles className="size-3.5 text-amber-500" /> + Add Custom Item (New Raw Material)
                                </span>
                              </SelectItem>
                              {masterMaterials.map((m) => (
                                <SelectItem key={m.id} value={m.id}>
                                  <span className="font-mono font-bold text-primary">
                                    {m.material_code}
                                  </span>{" "}
                                  — {m.material_name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="w-24">
                          <Input
                            type="number"
                            min="0.0001"
                            step="any"
                            placeholder="Qty"
                            value={item.quantity}
                            onChange={(e) =>
                              setItems(
                                items.map((it, i) =>
                                    i === idx ? { ...it, quantity: e.target.value } : it,
                                ),
                              )
                            }
                            className="h-9 rounded-xl text-xs bg-background"
                            required
                          />
                        </div>

                        <div className="w-20">
                          <Select
                            value={item.uom}
                            onValueChange={(val) =>
                              setItems(items.map((it, i) => (i === idx ? { ...it, uom: val } : it)))
                            }
                          >
                            <SelectTrigger className="h-9 rounded-xl text-xs bg-background">
                              <SelectValue placeholder="UOM" />
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

                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={items.length <= 1}
                          onClick={() => removeItem(idx)}
                          className="size-9 rounded-xl text-destructive hover:bg-destructive/10 shrink-0"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-bold text-muted-foreground">
                Remarks / Line Usage Justification
              </Label>
              <Textarea
                placeholder="Specify production line or purpose (e.g. Urgent custom raw material for assembly order)"
                value={formData.remarks}
                onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                className="rounded-xl text-xs min-h-[60px]"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="ghost"
                className="rounded-xl"
                onClick={() => setIsCreating(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold"
                disabled={submitting}
              >
                {submitting ? (
                  <Loader2 className="size-4 animate-spin mr-2" />
                ) : (
                  <CheckCircle2 className="size-4 mr-2" />
                )}
                Submit to Warehouse
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Request Details View Dialog */}
      <Dialog open={isViewing} onOpenChange={setIsViewing}>
        <DialogContent className="max-w-lg rounded-3xl p-6 border-none shadow-2xl bg-card">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              <ClipboardList className="size-5 text-blue-600" />
              Request Details
            </DialogTitle>
          </DialogHeader>

          {selectedRequest && (
            <div className="space-y-4 py-2">
              <div className="flex justify-between items-center bg-muted/40 p-3 rounded-2xl">
                <div>
                  <p className="text-[10px] uppercase font-bold text-muted-foreground">
                    Requisition Number
                  </p>
                  <p className="font-mono font-bold text-sm text-foreground">
                    {selectedRequest.requisitionNumber ||
                      selectedRequest.requisition_number ||
                      selectedRequest.requestNumber ||
                      selectedRequest.request_number}
                  </p>
                </div>
                <StatusBadge status={selectedRequest.status} />
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-muted-foreground">Department:</span>{" "}
                  <strong className="text-foreground">{selectedRequest.department}</strong>
                </div>
                <div>
                  <span className="text-muted-foreground">Priority:</span>{" "}
                  <strong className="text-foreground">
                    {selectedRequest.priority || "MEDIUM"}
                  </strong>
                </div>
                <div>
                  <span className="text-muted-foreground">Required Date:</span>{" "}
                  <strong className="text-foreground">
                    {new Date(
                      selectedRequest.requiredDate || selectedRequest.required_date,
                    ).toLocaleDateString()}
                  </strong>
                </div>
                <div>
                  <span className="text-muted-foreground">Fulfilling Store:</span>{" "}
                  <strong className="text-emerald-600 dark:text-emerald-400">
                    {selectedRequest.assignedStoreName ||
                      selectedRequest.assigned_store_name ||
                      "Pending Assignment"}
                  </strong>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-bold text-muted-foreground uppercase">Items</p>
                <div className="p-3 bg-muted/20 border border-border/40 rounded-2xl space-y-2.5">
                  {selectedRequest.items?.map((it: any, idx: number) => {
                    const reqQty = Number(
                      it.requestedQuantity || it.requested_quantity || it.quantity || 0,
                    );
                    const issQty = Number(it.issuedQuantity || it.issued_quantity || 0);
                    const isCustomLine = Boolean(
                      it.is_custom ||
                      it.isCustom ||
                      it.materialCode === "CUSTOM" ||
                      it.material_code === "CUSTOM" ||
                      (!it.material_id && !it.materialId && (it.custom_material_name || it.customMaterialName))
                    );
                    const matCreated = Boolean(
                      it.materialCode &&
                      it.materialCode !== "CUSTOM" &&
                      it.materialCode !== "MAT-REQ" &&
                      (it.custom_material_name || it.customMaterialName)
                    );

                    return (
                      <div key={idx} className="flex justify-between items-center text-xs pb-2 border-b border-border/30 last:border-0 last:pb-0">
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5">
                            <p className="font-semibold text-foreground">
                              {it.materialName ||
                                it.material_name ||
                                it.materialCode ||
                                it.material_code}
                            </p>
                            {isCustomLine && (
                              <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 text-[9px] font-bold px-1.5 py-0">
                                ✨ NEW MATERIAL
                              </Badge>
                            )}
                            {matCreated && (
                              <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 text-[9px] font-bold px-1.5 py-0">
                                ✓ Created ({it.materialCode || it.material_code})
                              </Badge>
                            )}
                          </div>
                          <p className="font-mono text-[10px] text-muted-foreground">
                            {it.materialCode || it.material_code}
                            {it.variantCode || it.variant_code
                              ? ` · ${it.variantCode || it.variant_code}`
                              : ""}
                          </p>
                        </div>
                        <div className="text-right">
                          <span className="font-mono font-bold text-primary">
                            Requested: {reqQty} {it.uom}
                          </span>
                          {issQty > 0 && (
                            <p className="text-[10px] text-emerald-600 font-bold">
                              Issued: {issQty} {it.uom}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {selectedRequest.remarks && (
                <div className="text-xs text-muted-foreground bg-muted/20 p-3 rounded-xl">
                  <strong>Remarks:</strong> {selectedRequest.remarks}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" className="rounded-xl" onClick={() => setIsViewing(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
