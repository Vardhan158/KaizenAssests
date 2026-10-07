import { createFileRoute, Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ClipboardList,
  Search,
  Filter,
  Loader2,
  Calendar,
  ArrowRight,
  Building2,
  Clock,
  Check,
  X,
  Eye,
  Info,
  AlertCircle,
} from "lucide-react";
import { AppShell, StatusBadge } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import { requireRole } from "@/lib/auth-utils";

function formatDisplayDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const clean = String(dateStr).split("T")[0];
  const parts = clean.split("-");
  if (parts.length === 3) {
    const [year, month, day] = parts;
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
    if (mIdx >= 0 && mIdx < 12) {
      return `${parseInt(day, 10)} ${months[mIdx]} ${year}`;
    }
  }
  return clean;
}

export const Route = createFileRoute("/procurement/material-requests")({
  beforeLoad: () => requireRole(["PROCUREMENT", "MANAGER", "ADMIN", "SUPERUSER"]),
  component: MaterialRequests,
});
function MaterialRequests() {
  const location = useRouterState({ select: (state) => state.location });
  const routeParams = new URLSearchParams(location.searchStr || "");
  const routeStatus = routeParams.get("status");
  const [requests, setRequests] = useState<any[]>([]);
  const [supplierAvailability, setSupplierAvailability] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState<any>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState(() => {
    if (typeof window === "undefined") return "all";
    const status = new URLSearchParams(window.location.search).get("status");
    if (status === "manager-approval") return "manager-approval";
    return "all";
  });
  const fetchData = async () => {
    try {
      setLoading(true);
      const data = await api.getMaterialRequests();
      setRequests(data);
      void fetchSupplierAvailability(data);
    } catch (error) {
      console.error("Failed to fetch material requests:", error);
      toast.error("Failed to load material requests");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    fetchData();

    const refreshRequests = () => {
      void fetchData();
    };
    window.addEventListener("material-requests:changed", refreshRequests);
    return () => window.removeEventListener("material-requests:changed", refreshRequests);
  }, []);
  useEffect(() => {
    if (routeStatus === "manager-approval") {
      setStatusFilter("manager-approval");
    }
  }, [routeStatus]);
  const matchesStatusFilter = (request: any, filter: string) => {
    const normalizedStatus = String(request.status || "").toLowerCase();
    if (filter === "manager-approval") return normalizedStatus === "submitted";
    if (filter === "rfq-created") {
      return normalizedStatus === "converted to rfq" || normalizedStatus === "rfq created";
    }
    if (filter === "po-created") {
      return normalizedStatus === "po created" || normalizedStatus === "purchase order created";
    }
    if (filter === "fulfilled") {
      return normalizedStatus === "fulfilled" || normalizedStatus === "closed";
    }
    if (filter === "rejected") return normalizedStatus === "rejected";
    return true;
  };
  const statusTabs = [
    { id: "all", label: "All" },
    { id: "manager-approval", label: "Manager Approval" },
    { id: "rfq-created", label: "RFQ Created" },
    { id: "po-created", label: "PO Created" },
    { id: "fulfilled", label: "Fulfilled" },
    { id: "rejected", label: "Rejected" },
  ];
  const getTabCount = (filter: string) =>
    requests.filter((request) => matchesStatusFilter(request, filter)).length;
  const activeTab = statusTabs.find((tab) => tab.id === statusFilter) || statusTabs[0];
  const filteredRequests = requests.filter((request) => {
    if (!matchesStatusFilter(request, statusFilter)) return false;
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return true;
    const itemText = (request.items || [])
      .map((item: any) =>
        [
          item.materialCode,
          item.material_code,
          item.materialName,
          item.material_name,
          item.variantCode,
          item.variant_code,
        ]
          .filter(Boolean)
          .join(" "),
      )
      .join(" ");
    return [
      request.requestNumber,
      request.request_number,
      request.warehouseId,
      request.warehouse_id,
      request.requestedBy,
      request.requested_by,
      itemText,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalizedQuery));
  });
  const totalQuantity = (request: any) =>
    (request.items || []).reduce((sum: number, item: any) => sum + Number(item.quantity || 0), 0);
  const itemCategory = (item: any) => item.category || item.materialCategory || item.material_category;
  const itemMaterialName = (item: any) => item.materialName || item.material_name || item.materialCode || item.material_code;
  const hasMatchingSuppliers = (request: any) => supplierAvailability[request.id] === true;
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
  const supplierCategories = (supplier: any) =>
    supplier.category || supplier.categories || supplier.materialCategories || supplier.material_categories || [];
  const supplierMaterials = (supplier: any) =>
    supplier.mainMaterials || supplier.main_materials || supplier.materials || [];
  const supplierMatchesItem = (supplier: any, item: any) => {
    const category = itemCategory(item);
    const material = itemMaterialName(item);
    return (
      (!!category && hasSharedMatchToken(category, supplierCategories(supplier))) ||
      (!!category && hasSharedMatchToken(category, supplierMaterials(supplier))) ||
      (!!material && hasSharedMatchToken(material, supplierMaterials(supplier))) ||
      (!!material && hasSharedMatchToken(material, supplierCategories(supplier)))
    );
  };
  const fetchSupplierAvailability = async (materialRequests: any[]) => {
    const approvedRequests = materialRequests.filter(
      (request) => String(request.status || "").toLowerCase() === "approved",
    );
    if (approvedRequests.length === 0) {
      setSupplierAvailability({});
      return;
    }

    try {
      const activeSuppliers = (await api.getSuppliers({ status: "Active" })).filter(
        (supplier: any) =>
          String(supplier.status ?? "")
            .trim()
            .toLowerCase() === "active",
      );
      const availabilityEntries = approvedRequests.map((request) => {
        const items = request.items || [];
        if (items.length === 0) return [request.id, false] as const;

        const itemMatches = items.map((item: any) =>
          activeSuppliers.some((supplier: any) => supplierMatchesItem(supplier, item)),
        );
        return [request.id, itemMatches.every(Boolean)] as const;
      });

      setSupplierAvailability(Object.fromEntries(availabilityEntries));
    } catch (error) {
      console.error("Failed to check matching suppliers:", error);
      setSupplierAvailability(
        Object.fromEntries(approvedRequests.map((request) => [request.id, false])),
      );
    }
  };
  const requestStatusLabel = (status: string) => {
    if (status === "Converted to RFQ") return "RFQ Created";
    return status;
  };
  const handleRequestClick = (req: any) => {
    setSelectedRequest(req);
    setIsModalOpen(true);
  };

  return (
    <AppShell
      title={
        <div className="flex items-center gap-2">
          <span>Material Requests</span>
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
      subtitle={
        statusFilter === "manager-approval"
          ? "Material requests waiting for manager approval"
          : "View and process material requirements from the warehouse"
      }
    >
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search request / material / warehouse"
            className="h-10 w-full rounded-xl border border-border bg-card pl-10 pr-4 text-sm outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <Button variant="outline" className="rounded-xl border-border">
          <Filter className="mr-2 size-4" /> Filter
        </Button>
      </div>
      <div className="mb-6 flex flex-wrap gap-2">
        {statusTabs.map((tab) => (
          <Button
            key={tab.id}
            variant={statusFilter === tab.id ? "default" : "outline"}
            className="rounded-full"
            onClick={() => setStatusFilter(tab.id)}
          >
            {tab.label}{" "}
            <span className="ml-1 rounded-full bg-background/30 px-1.5 py-0.5 text-[10px]">
              {getTabCount(tab.id)}
            </span>
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : filteredRequests.length === 0 ? (
        <Card className="flex h-64 flex-col items-center justify-center p-6 text-center border-dashed border-border/50 bg-muted/20">
          <ClipboardList className="size-12 text-muted-foreground/30 mb-4" />
          <h3 className="text-lg font-semibold text-muted-foreground">
            {statusFilter === "manager-approval"
              ? "No manager approval requests"
              : "No pending requests"}
          </h3>
          <p className="text-sm text-muted-foreground/70">
            {statusFilter === "manager-approval"
              ? "No warehouse requests are waiting for manager approval."
              : "No material requests match this workflow status."}
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden rounded-2xl border-border/70 p-0 shadow-soft">
          <div className="flex items-center justify-between border-b border-border/70 bg-muted/20 px-5 py-4">
            <div>
              <h2 className="text-sm font-bold tracking-tight">{activeTab.label}</h2>
              <p className="text-xs text-muted-foreground">
                {statusFilter === "manager-approval"
                  ? "Warehouse requests ready for manager review"
                  : "Material requests grouped by procurement workflow status"}
              </p>
            </div>
            <span className="text-2xl font-bold tabular-nums">{getTabCount(statusFilter)}</span>
          </div>
          <div className="divide-y divide-border/70">
            {filteredRequests.map((req) => (
              <div key={req.id} className="p-5 transition-colors hover:bg-muted/20">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                  <div className="min-w-0 flex-1 space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-mono text-base font-black tracking-tight text-foreground">
                        {req.requestNumber || req.request_number}
                      </h3>
                      <StatusBadge status={requestStatusLabel(req.status)} />
                      <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
                        Priority: {req.priority || "MEDIUM"}
                      </span>
                      {req.remarks?.includes("[Note to Procurement:") && (
                        <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-black uppercase text-amber-700 dark:text-amber-400 flex items-center gap-1">
                          <AlertCircle className="size-3" /> Sourcing Required
                        </span>
                      )}
                    </div>

                    <div className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
                      <div className="space-y-1">
                        <p className="text-[10px] font-black uppercase text-muted-foreground">
                          Warehouse
                        </p>
                        <p className="flex items-center gap-1.5 font-semibold">
                          <Building2 className="size-3.5 text-primary" />
                          {req.warehouseId || req.warehouse_id || "Warehouse"}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-[10px] font-black uppercase text-muted-foreground">
                          Requested By
                        </p>
                        <p className="flex items-center gap-1.5 font-semibold">
                          <Clock className="size-3.5 text-primary" />
                          {req.requestedBy || req.requested_by || "Warehouse Manager"}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-[10px] font-black uppercase text-muted-foreground">
                          Required Date
                        </p>
                        <p className="flex items-center gap-1.5 font-semibold">
                          <Calendar className="size-3.5 text-primary" />
                          {formatDisplayDate(req.requiredDate || req.required_date)}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-[10px] font-black uppercase text-muted-foreground">
                          Status
                        </p>
                        <p className="font-semibold">{requestStatusLabel(req.status)}</p>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-4 rounded-xl border border-border/60 bg-background px-4 py-3 text-sm">
                      <div>
                        <span className="text-muted-foreground">Items: </span>
                        <span className="font-bold">{req.items?.length || 0}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Total Qty: </span>
                        <span className="font-bold tabular-nums">{Math.floor(totalQuantity(req))}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap justify-end gap-2">
                    <Button
                      variant="outline"
                      className="rounded-xl"
                      onClick={() => handleRequestClick(req)}
                    >
                      <Eye className="size-4" /> View
                    </Button>
                    {req.status === "Approved" && hasMatchingSuppliers(req) && (
                      <Button className="rounded-xl shadow-glow" asChild>
                        <Link to="/procurement/new-rfq" search={{ fromRequestId: req.id }}>
                          <ArrowRight className="size-4" /> Create RFQ
                        </Link>
                      </Button>
                    )}
                    {req.status === "Approved" && supplierAvailability[req.id] === false && (
                      <span className="flex h-10 items-center rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 text-xs font-bold text-amber-700 dark:text-amber-300">
                        <AlertCircle className="mr-2 size-4" /> No active supplier
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-4xl w-full rounded-3xl p-0 overflow-hidden border-none shadow-2xl [&>button]:text-white/70 hover:[&>button]:text-white [&>button]:top-6 [&>button]:right-6">
          {selectedRequest && (
            <div className="flex flex-col h-full max-h-[90vh]">
              <div className="p-6 text-white bg-blue-600 flex justify-between items-start">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <DialogTitle className="text-xl font-bold tracking-tight">
                      Material Request Details
                    </DialogTitle>
                    <StatusBadge status={selectedRequest.status} />
                  </div>
                  <p className="text-white/70 text-sm font-mono font-bold tracking-widest">
                    {selectedRequest.requestNumber}
                  </p>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6 w-full min-w-0">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-2xl bg-muted/20 border border-border/40">
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase font-black text-muted-foreground">
                      Department
                    </Label>
                    <p className="font-bold text-sm">{selectedRequest.department || "N/A"}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase font-black text-muted-foreground">
                      Required Date
                    </Label>
                    <p className="font-bold text-sm tabular-nums">
                      {formatDisplayDate(selectedRequest.requiredDate)}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase font-black text-muted-foreground">
                      Requested By
                    </Label>
                    <p className="font-bold text-sm">{selectedRequest.requestedBy}</p>
                  </div>
                  <div className="space-y-1 sm:text-right">
                    <Label className="text-[10px] uppercase font-black text-muted-foreground">
                      Warehouse
                    </Label>
                    <p className="font-bold text-sm">{selectedRequest.warehouseId}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase font-black text-muted-foreground">
                      Priority
                    </Label>
                    <p className="font-bold text-sm">{selectedRequest.priority || "MEDIUM"}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase font-black text-muted-foreground">
                      Suggested Supplier
                    </Label>
                    <p className="font-bold text-sm">
                      {selectedRequest.suggestedSupplier || "Not specified"}
                    </p>
                  </div>
                </div>

                <div className="space-y-3">
                  <Label className="text-[10px] uppercase font-black text-muted-foreground">
                    Requested Materials
                  </Label>
                  <div className="rounded-2xl border border-border/60 overflow-hidden bg-muted/5 shadow-inner">
                    <table className="w-full table-fixed text-left text-sm border-collapse">
                      <colgroup>
                        <col className="w-[18%]" />
                        <col className="w-[20%]" />
                        <col className="w-[25%]" />
                        <col className="w-[17%]" />
                        <col className="w-[10%]" />
                        <col className="w-[10%]" />
                      </colgroup>
                      <thead>
                        <tr className="bg-muted/50 border-b border-border/60">
                          <th className="p-3 text-[10px] uppercase font-black text-muted-foreground">
                            Material Code
                          </th>
                          <th className="p-3 text-[10px] uppercase font-black text-muted-foreground">
                            Variant Code
                          </th>
                          <th className="p-3 text-[10px] uppercase font-black text-muted-foreground">
                            Material Name &amp; Specs
                          </th>
                          <th className="p-3 text-[10px] uppercase font-black text-muted-foreground">
                            Category
                          </th>
                          <th className="p-3 text-[10px] uppercase font-black text-muted-foreground w-20 text-center">
                            Qty
                          </th>
                          <th className="p-3 text-[10px] uppercase font-black text-muted-foreground w-24">
                            UOM
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedRequest.items?.map((item: any, idx: number) => (
                          <tr
                            key={idx}
                            className="border-b border-border/40 last:border-0 hover:bg-muted/20 transition-colors"
                          >
                            <td className="p-3 font-mono text-xs font-bold text-primary">
                              {item.materialCode || item.material_code}
                            </td>
                            <td className="p-3 font-mono text-xs font-semibold text-teal-600">
                              {item.variantCode || item.variant_code || "—"}
                            </td>
                            <td className="p-3 font-medium text-foreground truncate">
                              {item.materialName || item.material_name || "—"}
                            </td>
                            <td className="p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider truncate">
                              {item.category || "Raw Materials"}
                            </td>
                            <td className="p-3 text-center font-bold text-orange-600 tabular-nums">
                              {Math.floor(Number(item.quantity || 0))}
                            </td>
                            <td className="p-3 text-[10px] font-black uppercase text-muted-foreground">
                              {item.uom}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-[10px] uppercase font-black text-muted-foreground">
                    Remarks / Justification
                  </Label>
                  {selectedRequest.remarks?.includes("[Note to Procurement:") ? (
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
                <div className="space-y-3">
                  <Label className="text-[10px] uppercase font-black text-muted-foreground">
                    Approval History
                  </Label>
                  <div className="rounded-2xl border border-border/40 bg-muted/20 p-4">
                    {selectedRequest.approvalHistory?.length ? (
                      <div className="space-y-3">
                        {selectedRequest.approvalHistory.map((entry: any, idx: number) => (
                          <div key={idx} className="flex items-start justify-between gap-4 text-sm">
                            <div>
                              <p className="font-bold">{entry.status}</p>
                              <p className="text-xs text-muted-foreground">
                                {entry.actor || "System"} {entry.comments ? `- ${entry.comments}` : ""}
                              </p>
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {entry.timestamp ? formatDisplayDate(entry.timestamp) : ""}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No approval history yet.</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="p-6 bg-muted/10 border-t border-border/60 flex items-center justify-between">
                <Button
                  variant="ghost"
                  className="rounded-2xl h-11 px-6 font-bold text-xs uppercase"
                  onClick={() => setIsModalOpen(false)}
                >
                  Close
                </Button>
                <div className="flex items-center gap-3">

                  {selectedRequest.status === "Approved" && hasMatchingSuppliers(selectedRequest) && (
                    <Button
                      className="rounded-2xl h-11 px-8 shadow-glow font-bold text-xs uppercase"
                      asChild
                    >
                      <Link to="/procurement/new-rfq" search={{ fromRequestId: selectedRequest.id }}>
                        <ArrowRight className="mr-2 size-4" /> Create RFQ from Request
                      </Link>
                    </Button>
                  )}
                  {selectedRequest.status === "Approved" && supplierAvailability[selectedRequest.id] === false && (
                    <span className="flex h-11 items-center rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 text-xs font-bold uppercase text-amber-700 dark:text-amber-300">
                      <AlertCircle className="mr-2 size-4" /> No active supplier
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
