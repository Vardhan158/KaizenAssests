import { useSearch, createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ArrowRight,
  CheckCircle2,
  Info,
  Loader2,
  Package,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  SquarePen,
  Truck,
  Warehouse,
  Wrench,
} from "lucide-react";
import { AppShell, StatusBadge } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { InformationTooltip } from "@/components/ui/information-tooltip";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { getUserInfo } from "@/lib/auth-utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/dock-management")({
  head: () => ({
    meta: [
      { title: "Dock Management · KaizenAssests" },
      {
        name: "description",
        content:
          "Real-time dock allocation, vehicle arrival tracking, and operational status.",
      },
    ],
  }),
  component: DockManagement,
});

type AllocationRequest = {
  id: string;
  existing_gate_pass_id: string;
  vendor_reference?: string | null;
  vehicle_number: string;
  material_reference?: string | null;
  material_description?: string | null;
  quantity?: string | number | null;
  uom?: string | null;
  security_approved_at: string;
  priority: string;
  status: string;
  assigned_dock_id?: string | null;
  assigned_dock_code?: string | null;
  assigned_by?: string | null;
  assigned_at?: string | null;
  arrived_at?: string | null;
  released_at?: string | null;
  created_at: string;
  assigned_warehouse_ref_id?: string | null;
  assigned_warehouse_code?: string | null;
  assigned_warehouse_name?: string | null;
  assigned_warehouse_operator_id?: string | null;
  assigned_warehouse_operator_username?: string | null;
  assigned_warehouse_operator_name?: string | null;
};

type Dock = {
  id: string;
  dock_code: string;
  dock_name: string;
  dock_type: string;
  direction?: "INBOUND" | "OUTBOUND" | "BOTH";
  location?: string | null;
  description?: string | null;
  status: "AVAILABLE" | "RESERVED" | "OCCUPIED" | "MAINTENANCE";
  is_active: boolean;
  created_at: string;
  updated_at: string;
  warehouse_ref_id?: string | null;
  warehouse_code?: string | null;
  warehouse_name?: string | null;
  assigned_warehouse_ref_id?: string | null;
  assigned_warehouse_code?: string | null;
  assigned_warehouse_name?: string | null;
  assigned_warehouse_operator_id?: string | null;
  assigned_warehouse_operator_username?: string | null;
  assigned_warehouse_operator_name?: string | null;
  current_allocation?: AllocationRequest | null;
};

// SQLite/legacy API responses can omit the UTC suffix even though the service
// writes these values with datetime.now(timezone.utc). Treat those timestamps
// as UTC before converting them to the user's local timezone.
const formatApiDateTime = (value?: string | null) => {
  if (!value) return "—";
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
  return new Date(hasTimezone ? normalized : `${normalized}Z`).toLocaleString();
};

type WarehouseManager = {
  id: string;
  employee_id: string;
  username: string;
  full_name: string;
  email?: string;
  warehouse_ref_id?: string;
  warehouse_code?: string;
  warehouse_name?: string;
};

type DockHistory = {
  id: string;
  allocation_request_id: string;
  existing_gate_pass_id?: string | null;
  vehicle_number?: string | null;
  vendor_reference?: string | null;
  dock_code?: string | null;
  action: string;
  previous_status?: string | null;
  new_status: string;
  performed_by: string;
  performed_at: string;
  remarks?: string | null;
};

export const PREDEFINED_CATEGORIES = [
  { id: "ALL", name: "All Types" },
  { id: "CHEMICAL_HAZARDOUS", name: "Chemical / Hazardous" },
  { id: "ELECTRONICS", name: "Electronics" },
  { id: "ELECTRICAL", name: "Electrical" },
  { id: "RAW_MATERIAL", name: "Raw Material" },
  { id: "MAIN_RECEIVING", name: "Main Receiving" },
  { id: "FINISHED_GOODS", name: "Finished Goods / FG" },
];

const DOCK_TYPE_CONFIG: Record<string, { prefix: string; namePrefix: string }> = {
  RAW_MATERIAL: { prefix: "RM", namePrefix: "Raw Material Dock" },
  CHEMICAL_HAZARDOUS: { prefix: "CH", namePrefix: "Chemical/Hazardous Dock" },
  ELECTRICAL: { prefix: "EL", namePrefix: "Electrical Dock" },
  ELECTRONICS: { prefix: "EC", namePrefix: "Electronics Dock" },
  MAIN_RECEIVING: { prefix: "MR", namePrefix: "Main Receiving Dock" },
  FINISHED_GOODS: { prefix: "FG", namePrefix: "Finished Goods Dock" },
  CHEMICAL: { prefix: "CH", namePrefix: "Chemical/Hazardous Dock" },
  HAZARDOUS_ITEMS: { prefix: "HZ", namePrefix: "Chemical/Hazardous Dock" },
};

function generateDockCodeAndName(dockType: string, existingDocks: { dock_code?: string }[]) {
  const effectiveType = dockType || "RAW_MATERIAL";
  const config = DOCK_TYPE_CONFIG[effectiveType] || {
    prefix: effectiveType.slice(0, 2).toUpperCase() || "DK",
    namePrefix: `${effectiveType.replaceAll("_", " ")} Dock`,
  };

  const prefix = config.prefix;
  const regex = new RegExp(`^${prefix}-?(\\d+)`, "i");
  let maxNum = 0;

  for (const d of existingDocks) {
    if (!d.dock_code) continue;
    const match = d.dock_code.trim().match(regex);
    if (match && match[1]) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    }
  }

  const nextNumStr = String(maxNum + 1).padStart(2, "0");
  return {
    code: `${prefix}-${nextNumStr}`,
    name: `${config.namePrefix} ${nextNumStr}`,
  };
}

function getCategoryLabel(dockType: string): string {
  switch (dockType) {
    case "CHEMICAL_HAZARDOUS":
    case "CHEMICAL":
    case "HAZARDOUS_ITEMS":
      return "CHEMICAL/HAZARDOUS";
    case "ELECTRONICS":
    case "ELECTRONIC":
      return "ELECTRONICS";
    case "ELECTRICAL":
      return "ELECTRICAL";
    case "RAW_MATERIAL":
      return "RAW MATERIAL";
    case "MAIN_RECEIVING":
      return "MAIN RECEIVING";
    case "FINISHED_GOODS":
      return "FINISHED GOODS / FG";
    default:
      return dockType ? dockType.replaceAll("_", "/").toUpperCase() : "STANDARD";
  }
}

function DockManagement() {
  const [mounted, setMounted] = useState(false);
  const [docks, setDocks] = useState<Dock[]>([]);
  const [metrics, setMetrics] = useState<{
    total_docks: number;
    available_docks: number;
    occupied_docks: number;
    reserved_docks: number;
    maintenance_docks: number;
    pending_allocations_count: number;
  }>({
    total_docks: 0,
    available_docks: 0,
    occupied_docks: 0,
    reserved_docks: 0,
    maintenance_docks: 0,
    pending_allocations_count: 0,
  });
  const [pendingRequests, setPendingRequests] = useState<AllocationRequest[]>([]);
  const [history, setHistory] = useState<DockHistory[]>([]);
  const [loading, setLoading] = useState(true);

  // Filter & tab controls
  const [searchTerm, setSearchTerm] = useState("");
  const moduleSearchParams = useSearch({ strict: false }) as { search?: string };
  useEffect(() => { if (typeof moduleSearchParams.search === "string") setSearchTerm(moduleSearchParams.search); }, [moduleSearchParams.search]);
  const [activeTab, setActiveTab] = useState<
    "ALL" | "AVAILABLE" | "RESERVED" | "OCCUPIED" | "MAINTENANCE" | "PENDING" | "HISTORY"
  >("ALL");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");

  // Modals & Action States
  const [selectedDetailsDock, setSelectedDetailsDock] = useState<Dock | null>(null);
  const [allocateModalDock, setAllocateModalDock] = useState<Dock | null>(null);
  const [allocateModalPendingReq, setAllocateModalPendingReq] = useState<AllocationRequest | null>(
    null,
  );
  const [selectedRequestIdToAllocate, setSelectedRequestIdToAllocate] = useState<string>("");
  const [selectedDockIdToAllocate, setSelectedDockIdToAllocate] = useState<string>("");
  const [releaseConfirmDock, setReleaseConfirmDock] = useState<Dock | null>(null);

  // Create New Dock State
  const [showCreateDock, setShowCreateDock] = useState(false);
  const [createDockType, setCreateDockType] = useState("RAW_MATERIAL");
  const [customDockType, setCustomDockType] = useState("");
  const [createDockDirection, setCreateDockDirection] = useState("INBOUND");
  const [createDockCode, setCreateDockCode] = useState("");
  const [createDockName, setCreateDockName] = useState("");
  const [createLocation, setCreateLocation] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createStatus, setCreateStatus] = useState("AVAILABLE");

  const handleDockTypeChange = (newType: string) => {
    setCreateDockType(newType);
    if (newType !== "CUSTOM") setCustomDockType("");
    const generated = generateDockCodeAndName(newType === "CUSTOM" ? "CUSTOM" : newType, docks);
    setCreateDockCode(generated.code);
    setCreateDockName(generated.name);
  };

  useEffect(() => {
    if (showCreateDock) {
      const generated = generateDockCodeAndName(createDockType, docks);
      setCreateDockCode(generated.code);
      setCreateDockName(generated.name);
    }
  }, [showCreateDock, docks, createDockType]);

  // User Auth & Warehouse Context
  const userInfo = getUserInfo();
  const userRoles = userInfo?.roles || [];
  const isWarehouseManager = userRoles.includes("WAREHOUSE_MANAGER") || userRoles.includes("WAREHOUSE");
  const isWarehouseOrAdmin = isWarehouseManager || userRoles.includes("ADMIN") || userRoles.includes("SUPERUSER");
  const isWarehouseUser =
    userRoles.includes("WAREHOUSE_OPERATOR") ||
    userRoles.includes("WAREHOUSE_OPERATOR") ||
    userRoles.includes("WAREHOUSE_OPERATOR");

  const [currentUserWarehouse, setCurrentUserWarehouse] = useState<{ id?: string; code?: string; name?: string } | null>(null);

  useEffect(() => {
    if (userInfo?.warehouse_ref_id || userInfo?.warehouseRefId || userInfo?.warehouse_code || userInfo?.warehouseCode) {
      setCurrentUserWarehouse({
        id: userInfo?.warehouse_ref_id || userInfo?.warehouseRefId,
        code: userInfo?.warehouse_code || userInfo?.warehouseCode,
      });
    } else if (isWarehouseUser) {
      api.getMyWarehouse().then((res) => {
        if (res) {
          setCurrentUserWarehouse({
            id: res.id,
            code: res.warehouse_code,
            name: res.warehouse_name,
          });
        }
      }).catch(() => {
        // ignore if not configured
      });
    } else {
      setCurrentUserWarehouse(null);
    }
  }, [isWarehouseUser, userInfo?.warehouse_ref_id, userInfo?.warehouseRefId, userInfo?.warehouse_code, userInfo?.warehouseCode]);

  const canReleaseDock = useCallback((dock: Dock | null | undefined): boolean => {
    if (!dock) return false;
    // Warehouse managers without Warehouse role are strictly forbidden from releasing docks
    if (isWarehouseManager && !isWarehouseUser) return false;
    // Only assigned warehouse operators / keepers can release docks
    if (!isWarehouseUser) return false;

    const userWarehouseRefId = currentUserWarehouse?.id || userInfo?.warehouse_ref_id || userInfo?.warehouseRefId;
    const userWarehouseCode = (currentUserWarehouse?.code || userInfo?.warehouse_code || userInfo?.warehouseCode || "").toUpperCase();

    if (!userWarehouseRefId && !userWarehouseCode) return false;

    const dockWarehouseRefId = dock.assigned_warehouse_ref_id || dock.warehouse_ref_id;
    const dockWarehouseCode = (dock.assigned_warehouse_code || dock.warehouse_code || "").toUpperCase();

    const matchesId = Boolean(userWarehouseRefId && dockWarehouseRefId && userWarehouseRefId === dockWarehouseRefId);
    const matchesCode = Boolean(userWarehouseCode && dockWarehouseCode && userWarehouseCode === dockWarehouseCode);

    return matchesId || matchesCode;
  }, [currentUserWarehouse, isWarehouseUser, isWarehouseManager, userInfo]);

  const [warehouseManagers, setWarehouseManagers] = useState<WarehouseManager[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [selectedWarehouseRefId, setSelectedWarehouseRefId] = useState<string>("");
  const [selectedWarehouseManagerId, setSelectedWarehouseManagerId] = useState<string>("");

  // Edit & Maintenance Modals
  const [editDockModalDock, setEditDockModalDock] = useState<Dock | null>(null);
  const [editDockForm, setEditDockForm] = useState({
    code: "",
    name: "",
    type: "RAW_MATERIAL",
    direction: "INBOUND" as "INBOUND" | "OUTBOUND" | "BOTH",
    location: "",
    description: "",
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  const [maintenanceConfirmDock, setMaintenanceConfirmDock] = useState<Dock | null>(null);

  const [actionBusy, setActionBusy] = useState(false);

  const openEditDock = (dock: Dock) => {
    setEditDockForm({
      code: dock.dock_code,
      name: dock.dock_name,
      type: dock.dock_type,
      direction: dock.direction || "INBOUND",
      location: dock.location || "",
      description: dock.description || "",
    });
    setEditDockModalDock(dock);
  };

  const loadAll = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [docksRes, overviewRes, pendingRes, historyRes] = await Promise.all([
        api.getDocks(),
        api.getDockOverviewMetrics().catch(() => null),
        api.getPendingAllocations().catch(() => []),
        api.getDockHistory().catch(() => []),
      ]);

      setDocks(docksRes);
      setPendingRequests(pendingRes);
      setHistory(historyRes);
      if (overviewRes) {
        setMetrics(overviewRes);
      } else {
        const avail = docksRes.filter((d: Dock) => d.status === "AVAILABLE").length;
        const occ = docksRes.filter(
          (d: Dock) => d.status === "OCCUPIED" || d.status === "RESERVED",
        ).length;
        const maint = docksRes.filter((d: Dock) => d.status === "MAINTENANCE").length;
        setMetrics({
          total_docks: docksRes.length,
          available_docks: avail,
          occupied_docks: occ,
          reserved_docks: 0,
          maintenance_docks: maint,
          pending_allocations_count: pendingRes.length,
        });
      }

      setSelectedDetailsDock((prev) => {
        if (!prev) return null;
        const fresh = docksRes.find((d: Dock) => d.id === prev.id);
        if (!fresh) return prev;
        if (
          fresh.status === prev.status &&
          fresh.updated_at === prev.updated_at &&
          fresh.current_allocation?.id === prev.current_allocation?.id
        ) {
          return prev;
        }
        return fresh;
      });
    } catch (error) {
      if (!quiet) {
        toast.error("Unable to load dock management data", {
          description: error instanceof Error ? error.message : undefined,
        });
      }
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  const isAnyModalOpen = Boolean(
    selectedDetailsDock ||
    allocateModalDock ||
    allocateModalPendingReq ||
    releaseConfirmDock ||
    editDockModalDock ||
    maintenanceConfirmDock ||
    showCreateDock,
  );

  useEffect(() => {
    void loadAll();
    if (isAnyModalOpen) return;
    const timer = window.setInterval(() => void loadAll(true), 5000);
    return () => window.clearInterval(timer);
  }, [loadAll, isAnyModalOpen]);

  // Handle Create Dock
  async function handleCreateDock(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const effectiveDockType = createDockType === "CUSTOM"
      ? customDockType.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_")
      : createDockType;
    if (!effectiveDockType || effectiveDockType === "CUSTOM") {
      toast.error("Enter a custom dock type before creating the dock.");
      return;
    }
    setActionBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      await api.createDock({
        dock_code: String(data.get("dock_code") || createDockCode),
        dock_name: String(data.get("dock_name") || createDockName),
        dock_type: effectiveDockType,
        direction: String(data.get("direction") || createDockDirection),
        location: "",
        description: "",
        status: "AVAILABLE",
      });
      toast.success("Dock created successfully", {
        description: `Dock ${createDockCode} is now available in Dock Management.`,
      });
      setShowCreateDock(false);
      setCreateLocation("");
      setCreateDescription("");
      await loadAll(true);
    } catch (error) {
      toast.error("Unable to create dock", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setActionBusy(false);
    }
  }

  // Handle Edit Dock Update
  async function handleUpdateDock() {
    if (!editDockModalDock) return;
    if (!editDockForm.name.trim()) {
      toast.error("Enter a dock name before saving.");
      return;
    }
    if (editDockForm.name.trim().length > 128 || editDockForm.location.trim().length > 128) {
      toast.error("Dock name and location must be 128 characters or fewer.");
      return;
    }
    setActionBusy(true);
    try {
      await api.updateDock(editDockModalDock.id, {
        dock_code: editDockForm.code.trim() || editDockModalDock.dock_code,
        dock_name: editDockForm.name.trim() || editDockModalDock.dock_name,
        dock_type: editDockForm.type,
        direction: editDockForm.direction,
        location: editDockForm.location.trim(),
        description: editDockForm.description.trim(),
      });
      toast.success(`Dock ${editDockModalDock.dock_code} updated successfully`);
      setEditDockModalDock(null);
      await loadAll(true);
    } catch (error) {
      toast.error("Failed to update dock", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setActionBusy(false);
    }
  }

  // Handle Maintenance Toggle
  async function handleToggleMaintenance() {
    if (!maintenanceConfirmDock) return;
    const isMaint = maintenanceConfirmDock.status === "MAINTENANCE";
    const nextStatus = isMaint ? "AVAILABLE" : "MAINTENANCE";
    setActionBusy(true);
    try {
      await api.updateDockStatus(
        maintenanceConfirmDock.id,
        nextStatus,
        isMaint ? "Maintenance completed" : "Scheduled routine maintenance",
      );
      toast.success(
        `Dock ${maintenanceConfirmDock.dock_code} ${isMaint ? "returned to Available" : "marked Under Maintenance"}`,
      );
      setMaintenanceConfirmDock(null);
      await loadAll(true);
    } catch (error) {
      toast.error("Status update failed", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setActionBusy(false);
    }
  }

  // Action Handlers
  async function handleAllocateDock(requestToAllocate?: AllocationRequest) {
    let reqId = "";
    let dockId = "";
    let dockCode = "";
    const pendingRequest = requestToAllocate || allocateModalPendingReq;

    if (pendingRequest) {
      reqId = pendingRequest.id;
      dockId = selectedDockIdToAllocate || docks.find((item) => item.is_active && item.status === "AVAILABLE" && isDockCompatible(pendingRequest, item))?.id || "";
      const d = docks.find((item) => item.id === dockId);
      dockCode = d ? d.dock_code : "Dock";
    } else if (allocateModalDock) {
      reqId = selectedRequestIdToAllocate;
      dockId = allocateModalDock.id;
      dockCode = allocateModalDock.dock_code;
    }

    if (!reqId || !dockId) {
      toast.error("Please select an allocation request and an available dock.");
      return;
    }

    // Verify dock availability
    const targetDock = docks.find((d) => d.id === dockId);
    if (targetDock && targetDock.status !== "AVAILABLE") {
      toast.error("Selected dock is not Available. Please choose an Available dock.");
      return;
    }
    if (pendingRequest && targetDock && !isDockCompatible(pendingRequest, targetDock)) {
      toast.error("Selected dock is incompatible with this material.");
      return;
    }

    setActionBusy(true);
    try {
      await api.allocateDock(reqId, dockId);
      setAllocateModalPendingReq(null);
      setAllocateModalDock(null);
      setSelectedDockIdToAllocate("");
      setSelectedRequestIdToAllocate("");
      setSelectedWarehouseManagerId("");
      setSelectedWarehouseRefId("");
      await loadAll(true);
    } catch (error) {
      toast.error("Allocation failed", {
        description: error instanceof Error ? error.message : undefined,
      });
      await loadAll(true);
    } finally {
      setActionBusy(false);
    }
  }

  async function handleVehicleArrived(dock: Dock) {
    const allocationId = dock.current_allocation?.id;
    if (!allocationId) return;
    setActionBusy(true);
    try {
      await api.markVehicleArrived(allocationId);
      toast.success(`${dock.dock_code} arrival confirmed`, {
        description: "Vehicle is now recorded at the dock and ready for unloading.",
      });
      await loadAll(true);
    } catch (error) {
      toast.error("Unable to confirm dock arrival", {
        description: error instanceof Error ? error.message : undefined,
      });
      await loadAll(true);
    } finally {
      setActionBusy(false);
    }
  }

  function isDockCompatible(req: AllocationRequest, dock: Dock | undefined) {
    if (!dock) return false;
    const material = `${req.material_reference || ""} ${req.material_description || ""}`.toLowerCase();
    const type = (dock.dock_type || "").toUpperCase();
    const chemical = /chemical|hazard|solvent|flammable|fuel|paint|corrosive/.test(material);
    if (chemical) return ["CHEMICAL_HAZARDOUS", "CHEMICAL", "HAZARDOUS_ITEMS"].includes(type);
    if (["CHEMICAL_HAZARDOUS", "CHEMICAL", "HAZARDOUS_ITEMS"].includes(type)) return false;
    return ["RAW_MATERIAL", "GENERAL", "MAIN_RECEIVING", "ELECTRICAL", "ELECTRONICS", "FINISHED_GOODS"].includes(type);
  }

  async function handleReleaseDock() {
    if (!releaseConfirmDock) return;
    if (!canReleaseDock(releaseConfirmDock)) {
      toast.error("Unauthorized: Only the assigned Warehouse Operator can release this dock.");
      setReleaseConfirmDock(null);
      return;
    }
    const reqId = releaseConfirmDock.current_allocation?.id || releaseConfirmDock.id;
    setActionBusy(true);
    try {
      await api.releaseDock(reqId);
      toast.success(`Dock ${releaseConfirmDock.dock_code} released`, {
        description: "Dock status returned to AVAILABLE.",
      });
      setReleaseConfirmDock(null);
      setSelectedDetailsDock(null);
      await loadAll(true);
    } catch (error) {
      toast.error("Dock release failed", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setActionBusy(false);
    }
  }

  // Filtered Docks
  const filteredDocks = docks.filter((dock) => {
    let matchesTab = true;
    if (activeTab === "AVAILABLE") {
      matchesTab = dock.status === "AVAILABLE";
    } else if (activeTab === "OCCUPIED") {
      matchesTab = dock.status === "OCCUPIED";
    } else if (activeTab === "RESERVED") {
      matchesTab = dock.status === "RESERVED";
    } else if (activeTab === "MAINTENANCE") {
      matchesTab = dock.status === "MAINTENANCE";
    }

    let matchesCategory = true;
    if (categoryFilter !== "ALL") {
      if (categoryFilter === "ELECTRONICS") {
        matchesCategory = dock.dock_type === "ELECTRONICS" || dock.dock_type === "ELECTRONIC";
      } else if (categoryFilter === "CHEMICAL_HAZARDOUS") {
        matchesCategory =
          dock.dock_type === "CHEMICAL_HAZARDOUS" ||
          dock.dock_type === "CHEMICAL" ||
          dock.dock_type === "HAZARDOUS_ITEMS";
      } else {
        matchesCategory = dock.dock_type === categoryFilter;
      }
    }

    const q = searchTerm.toLowerCase().trim();
    const matchesSearch =
      !q ||
      dock.dock_code.toLowerCase().includes(q) ||
      dock.dock_name.toLowerCase().includes(q) ||
      (dock.location && dock.location.toLowerCase().includes(q)) ||
      (dock.current_allocation?.vehicle_number &&
        dock.current_allocation.vehicle_number.toLowerCase().includes(q)) ||
      (dock.current_allocation?.existing_gate_pass_id &&
        dock.current_allocation.existing_gate_pass_id.toLowerCase().includes(q)) ||
      (dock.current_allocation?.vendor_reference &&
        dock.current_allocation.vendor_reference.toLowerCase().includes(q));

    return matchesTab && matchesCategory && matchesSearch;
  });

  const warehouseDock = docks.find((dock) => dock.is_active) || docks[0];

  if (mounted && isWarehouseUser && !isWarehouseOrAdmin) {
    return (
      <AppShell
        title="Dock Management"
        subtitle="Global Dock Allocation & Management"
      >
        <div className="flex flex-col items-center justify-center min-h-[50vh] p-8 text-center">
          <Card className="max-w-lg p-8 rounded-3xl border-border/60 shadow-soft space-y-4">
            <div className="size-16 rounded-2xl bg-amber-500/10 text-amber-600 flex items-center justify-center mx-auto">
              <ShieldAlert className="size-8" />
            </div>
            <div className="space-y-2">
              <h2 className="text-lg font-bold text-foreground">Global Dock Management Restricted</h2>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Global dock configuration, allocation, and warehouse assignment are managed exclusively by the Warehouse Manager. Warehouse Operators view and release docks assigned to their specific warehouse from the Assigned Docks portal.
              </p>
            </div>
            <div className="pt-2">
              <Button
                className="rounded-xl font-bold text-xs h-10 px-5 shadow-glow gap-2"
                onClick={() => { window.location.href = "/inventory?tab=docks"; }}
              >
                <Truck className="size-4" /> Go to My Assigned Docks
              </Button>
            </div>
          </Card>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell activeItem="/dock-management">
      <div className="dock-management-workspace space-y-4">
        <div className="dock-management-header flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="flex items-center gap-3"><Warehouse className="size-6 shrink-0 text-primary" />Dock Management<InformationTooltip help="dock" placement="title" /></h1>
            <p className="mt-2 text-sm text-muted-foreground">Allocate approved vehicles and monitor receiving dock availability.</p>
          </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Button disabled={actionBusy} onClick={() => setShowCreateDock(true)} className="gap-2 rounded-xl"><Plus className="size-4" />Add Dock</Button>
          <Button
            variant="outline"
            className="h-10 rounded-xl border-emerald-600 bg-emerald-600 px-4 text-sm font-semibold text-white hover:border-emerald-700 hover:bg-emerald-700 hover:text-white"
            onClick={() => setActiveTab(activeTab === "HISTORY" ? "ALL" : "HISTORY")}
          >
            {activeTab === "HISTORY" ? "Current dock" : "Allocation history"}
          </Button>
          <Button data-refresh-control="true"
            variant="outline"
            size="icon"
            className="size-11 rounded-xl border-border bg-card text-primary shadow-none hover:bg-muted"
            aria-label="Refresh dock management"
            title="Refresh dock management"
            onClick={() => void loadAll()}
          >
            <RefreshCw className={cn("size-4", loading && "animate-spin text-primary")} />
          </Button>
        </div>
        </div>
      {loading ? (
        <div className="flex h-64 items-center justify-center gap-2 text-muted-foreground"><Loader2 className="size-6 animate-spin text-primary" /><p className="text-sm">Loading dock status...</p></div>
      ) : activeTab === "HISTORY" ? (
        <Card className="overflow-hidden rounded-2xl p-0 shadow-soft"><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground font-semibold"><tr><th className="px-4 py-3">Timestamp</th><th className="px-4 py-3">Gate Pass</th><th className="px-4 py-3">Vehicle</th><th className="px-4 py-3">Action</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Performed By</th></tr></thead><tbody className="divide-y divide-border/60">{history.length ? history.map((item) => <tr key={item.id}><td className="px-4 py-3 text-xs">{formatApiDateTime(item.performed_at)}</td><td className="px-4 py-3 font-mono font-semibold text-emerald-700 dark:text-emerald-400">{item.existing_gate_pass_id || "—"}</td><td className="px-4 py-3 font-mono">{item.vehicle_number || "—"}</td><td className="px-4 py-3">{item.action}</td><td className="px-4 py-3"><div className="flex flex-wrap items-center gap-2">
          {item.previous_status && <StatusBadge status={item.previous_status} />}
          {item.previous_status && <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-label="changed to" />}
          <StatusBadge status={item.new_status} />
        </div></td><td className="px-4 py-3">{item.performed_by}</td></tr>) : <tr><td colSpan={6} className="py-12 text-center text-sm text-muted-foreground">No dock activity yet.</td></tr>}</tbody></table></div></Card>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              { label: "Receiving docks", value: docks.length, Icon: Warehouse, tone: "blue" },
              { label: "Available docks", value: docks.filter((dock) => dock.is_active && dock.status === "AVAILABLE").length, Icon: CheckCircle2, tone: "green" },
              { label: "Vehicles waiting", value: pendingRequests.length, Icon: Truck, tone: "amber" },
            ].map(({ label, value, Icon, tone }) => (
              <div key={label} className="inventory-stock-summary" data-tone={tone}>
                <div className="inventory-stock-summary-icon"><Icon className="size-6" /></div>
                <div><p className="text-sm font-medium text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-bold tabular-nums">{value}</p></div>
              </div>
            ))}
          </div>
          {(docks.length ? filteredDocks : [undefined]).map((warehouseDock) => (
          <Card key={warehouseDock?.id || "unconfigured"} className={cn("dock-management-receiving overflow-hidden rounded-3xl border shadow-soft", warehouseDock?.status === "AVAILABLE" ? "border-emerald-200" : warehouseDock?.status === "MAINTENANCE" ? "border-amber-200" : "border-blue-200")}>
            <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_auto_minmax(280px,360px)] lg:items-center">
              <div className="min-w-0 flex-1 space-y-3"><div className="flex flex-wrap items-center gap-3"><span className={cn("size-3 rounded-full", warehouseDock?.status === "AVAILABLE" ? "bg-emerald-500" : warehouseDock?.status === "MAINTENANCE" ? "bg-amber-500" : "bg-blue-600")} /><span className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">Receiving dock</span><span className={cn("rounded-full px-3 py-1 text-xs font-bold", warehouseDock?.status === "AVAILABLE" ? "bg-emerald-100 text-emerald-800" : warehouseDock?.status === "MAINTENANCE" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800")}>{warehouseDock?.status === "OCCUPIED" || warehouseDock?.status === "RESERVED" ? "ALLOCATED" : warehouseDock?.status || "NOT CONFIGURED"}</span></div><div><h2 className="text-3xl font-black tracking-tight">{warehouseDock?.dock_code || "Receiving dock"}</h2><p className="mt-1 text-sm text-muted-foreground">{warehouseDock?.dock_name || "The warehouse dock has not been configured yet."}</p></div></div>
            <Button type="button" variant="outline" disabled={actionBusy} onClick={() => warehouseDock ? openEditDock(warehouseDock) : setShowCreateDock(true)} className="shrink-0 gap-2 rounded-xl border-blue-200 bg-white/80 text-blue-800 hover:bg-blue-50 dark:border-blue-900/60 dark:bg-slate-900 dark:text-blue-200 dark:hover:bg-blue-950/40"><SquarePen className="size-4" />{warehouseDock ? "Edit dock" : "Configure dock"}</Button>
              <div className="grid min-w-[280px] grid-cols-2 gap-3 rounded-2xl bg-muted/40 p-4 text-sm"><div><p className="text-xs font-semibold uppercase text-muted-foreground">Dock status</p><p className="mt-1 font-bold">{warehouseDock?.status || "Unavailable"}</p></div><div><p className="text-xs font-semibold uppercase text-muted-foreground">Waiting vehicles</p><p className="mt-1 font-bold">{pendingRequests.length}</p></div>{warehouseDock?.current_allocation ? <><div><p className="text-xs font-semibold uppercase text-muted-foreground">Vehicle</p><p className="mt-1 font-mono font-bold">{warehouseDock.current_allocation.vehicle_number}</p></div><div><p className="text-xs font-semibold uppercase text-muted-foreground">Gate pass</p><p className="mt-1 font-mono font-bold">{warehouseDock.current_allocation.existing_gate_pass_id}</p></div></> : <div className="col-span-2 text-xs text-muted-foreground">GRN releases the dock automatically after receiving is complete.</div>}</div>
            </div>
            {warehouseDock?.current_allocation && <div className="border-t bg-blue-50/70 px-6 py-4 text-sm text-blue-900"><span className="font-semibold">Receiving in progress.</span> GRN releases this dock when receiving is completed. Status refreshes automatically.</div>}
          </Card>
          ))}
          <section className="dock-management-waiting space-y-3"><div className="flex items-end justify-between gap-3"><div><h3 className="text-lg font-bold">Approved vehicles waiting</h3><p className="text-sm text-muted-foreground">Allocate the available dock to an approved gate entry.</p></div><span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold">{pendingRequests.length} waiting</span></div>
            {pendingRequests.length === 0 ? <Card className="rounded-2xl border-dashed p-8 text-center text-sm text-muted-foreground">No approved vehicles are waiting for dock allocation.</Card> : <div className="space-y-3">{pendingRequests.map((req) => <Card key={req.id} className="rounded-2xl p-4 shadow-2xs"><div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between"><div className="grid flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"><div><p className="text-[11px] font-bold uppercase text-muted-foreground">Gate pass</p><p className="mt-1 font-mono font-bold text-primary">{req.existing_gate_pass_id}</p></div><div><p className="text-[11px] font-bold uppercase text-muted-foreground">Vehicle</p><p className="mt-1 font-mono font-bold">{req.vehicle_number}</p></div><div><p className="text-[11px] font-bold uppercase text-muted-foreground">Vendor / material</p><p className="mt-1 text-sm font-semibold">{req.vendor_reference || req.material_reference || req.material_description || "—"}</p></div><div><p className="text-[11px] font-bold uppercase text-muted-foreground">Approved</p><p className="mt-1 text-sm">{formatApiDateTime(req.security_approved_at)}</p></div></div><Button disabled={actionBusy || !docks.some((dock) => dock.is_active && dock.status === "AVAILABLE" && isDockCompatible(req, dock))} onClick={() => { setSelectedDockIdToAllocate(""); setAllocateModalPendingReq(req); }} className="shrink-0 rounded-xl"><ArrowRight className="mr-2 size-4" />{docks.some((dock) => dock.is_active && dock.status === "AVAILABLE" && isDockCompatible(req, dock)) ? "Allocate dock" : "Dock unavailable"}</Button></div></Card>)}</div>}
          </section>
        </div>
      )}
      <Dialog open={showCreateDock} onOpenChange={(open) => !actionBusy && setShowCreateDock(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add receiving dock</DialogTitle>
            <DialogDescription>Create another receiving dock for approved vehicle allocations.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateDock} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="create-dock-code">Dock code</Label>
              <Input id="create-dock-code" name="dock_code" required maxLength={32}
                pattern={"[A-Za-z0-9_\\-]+"} value={createDockCode}
                onChange={(event) => setCreateDockCode(event.target.value.toUpperCase())} disabled={actionBusy} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-dock-name">Dock name</Label>
              <Input id="create-dock-name" name="dock_name" required maxLength={128}
                value={createDockName} onChange={(event) => setCreateDockName(event.target.value)} disabled={actionBusy} />
            </div>
            <p className="text-xs text-muted-foreground">Inbound receiving dock. Initial status: Available.</p>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={actionBusy} onClick={() => setShowCreateDock(false)}>Cancel</Button>
              <Button type="submit" disabled={actionBusy || !createDockCode.trim() || !createDockName.trim()}>
                {actionBusy && <Loader2 className="mr-2 size-4 animate-spin" />}Create dock
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {/* 4. View Dock Details Modal */}
      {selectedDetailsDock && (
        <Dialog
          open={Boolean(selectedDetailsDock)}
          onOpenChange={() => setSelectedDetailsDock(null)}
        >
          <DialogContent className="max-w-lg rounded-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <div className="flex items-center justify-between">
                <DialogTitle className="font-mono text-xl font-black text-primary flex items-center gap-2">
                  <Warehouse className="size-5" /> {selectedDetailsDock.dock_code}
                </DialogTitle>
                <span
                  className={cn(
                    "rounded-full px-3 py-0.5 text-xs font-extrabold tracking-wider border",
                    selectedDetailsDock.status === "AVAILABLE"
                      ? "bg-[#dcfce7] text-[#15803d] border-[#bbf7d0]"
                      : selectedDetailsDock.status === "MAINTENANCE"
                        ? "bg-slate-100 text-slate-700 border-slate-200"
                        : "bg-[#ffe4e6] text-[#e11d48] border-[#fecdd3]",
                  )}
                >
                  {selectedDetailsDock.status === "OCCUPIED" ? "AT DOCK" : selectedDetailsDock.status}
                </span>
              </div>
              <DialogDescription className="text-xs">
                {selectedDetailsDock.dock_name}
                {selectedDetailsDock.location ? ` · ${selectedDetailsDock.location}` : ""}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2 text-xs">
              <div className="rounded-xl border bg-card p-3 space-y-2 shadow-sm">
                <h4 className="font-extrabold uppercase tracking-wider text-[11px] text-primary flex items-center gap-1.5 border-b pb-1.5">
                  <Warehouse className="size-3.5" /> Dock Information
                </h4>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground block text-[11px]">
                      Dock Code & Name
                    </span>
                    <span className="font-mono font-bold text-foreground">
                      {selectedDetailsDock.dock_code} ({selectedDetailsDock.dock_name})
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Dock Category</span>
                    <span className="font-semibold text-foreground">
                      {getCategoryLabel(selectedDetailsDock.dock_type)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Current Status</span>
                    <span
                      className={cn(
                        "font-bold",
                        selectedDetailsDock.status === "AVAILABLE"
                          ? "text-emerald-600"
                          : selectedDetailsDock.status === "MAINTENANCE"
                            ? "text-slate-600"
                            : "text-rose-600",
                      )}
                    >
                      {selectedDetailsDock.status === "OCCUPIED" ? "AT DOCK" : selectedDetailsDock.status}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Assignment Time</span>
                    <span className="font-mono text-foreground font-medium">
                      {selectedDetailsDock.current_allocation?.assigned_at
                        ? new Date(
                          selectedDetailsDock.current_allocation.assigned_at,
                        ).toLocaleString()
                        : "N/A"}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Assigned Warehouse</span>
                    <span className="font-semibold text-foreground">
                      {selectedDetailsDock.assigned_warehouse_name
                        ? `${selectedDetailsDock.assigned_warehouse_name} (${selectedDetailsDock.assigned_warehouse_code || selectedDetailsDock.warehouse_code})`
                        : (selectedDetailsDock.warehouse_name || selectedDetailsDock.assigned_warehouse_code || selectedDetailsDock.warehouse_code || "Central Warehouse")}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Location</span>
                    <span className="font-medium text-foreground">
                      {selectedDetailsDock.location || "Central Receiving"}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Assigned Warehouse Operator</span>
                    <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                      {selectedDetailsDock.assigned_warehouse_operator_name ||
                        selectedDetailsDock.current_allocation?.assigned_warehouse_operator_name ||
                        "Not assigned"}
                    </span>
                  </div>
                </div>
              </div>

              {selectedDetailsDock.status === "AVAILABLE" && (
                <div className="rounded-xl border border-dashed border-emerald-500/40 bg-emerald-500/10 p-4 text-center text-xs text-emerald-600 font-medium">
                  <CheckCircle2 className="mx-auto mb-1 size-6" />
                  This dock is currently Available and ready for vehicle allocation.
                </div>
              )}

              {selectedDetailsDock.status !== "AVAILABLE" && selectedDetailsDock.status !== "MAINTENANCE" && (
                <>
                  <div className="rounded-xl border bg-card p-3 space-y-2 shadow-sm">
                    <h4 className="font-extrabold uppercase tracking-wider text-[11px] text-primary flex items-center gap-1.5 border-b pb-1.5">
                      <Truck className="size-3.5" /> Allocated Vehicle & Gate Entry Details
                    </h4>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-muted-foreground block text-[11px]">
                          Vehicle Number
                        </span>
                        <span className="font-mono font-black text-sm text-[#2563eb]">
                          {selectedDetailsDock.current_allocation?.vehicle_number || "—"}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-[11px]">
                          Gate Entry / Pass No
                        </span>
                        <span className="font-mono font-bold text-foreground">
                          {selectedDetailsDock.current_allocation?.existing_gate_pass_id || "—"}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-[11px]">
                          Allocation Status
                        </span>
                        <span className="font-bold text-foreground">
                          {selectedDetailsDock.current_allocation?.status || "AT DOCK"}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-[11px]">Approved At</span>
                        <span className="font-mono text-muted-foreground">
                          {selectedDetailsDock.current_allocation?.security_approved_at
                            ? formatApiDateTime(selectedDetailsDock.current_allocation.security_approved_at)
                            : "—"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border bg-card p-3 space-y-2 shadow-sm">
                    <h4 className="font-extrabold uppercase tracking-wider text-[11px] text-primary flex items-center gap-1.5 border-b pb-1.5">
                      <Package className="size-3.5" /> Material & Supplier Details
                    </h4>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-muted-foreground block text-[11px]">
                          Material Code / Name
                        </span>
                        <span className="font-semibold text-foreground">
                          {selectedDetailsDock.current_allocation?.material_reference ||
                            selectedDetailsDock.current_allocation?.material_description ||
                            "—"}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-[11px]">
                          Vendor / Supplier
                        </span>
                        <span className="font-semibold text-foreground">
                          {selectedDetailsDock.current_allocation?.vendor_reference ||
                            "Approved Supplier"}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-[11px]">Quantity</span>
                        <span className="font-mono font-bold text-foreground">
                          {selectedDetailsDock.current_allocation?.quantity ?? "—"}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-[11px]">
                          Gate Pass Ref
                        </span>
                        <span className="font-mono font-bold text-primary">
                          {selectedDetailsDock.current_allocation?.existing_gate_pass_id || "—"}
                        </span>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>

            <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                className="rounded-xl"
                onClick={() => setSelectedDetailsDock(null)}
              >
                Close
              </Button>

              {selectedDetailsDock.status === "AVAILABLE" && pendingRequests.length > 0 && (
                <Button
                  className="rounded-xl shadow-glow w-full sm:w-auto text-xs bg-blue-600 hover:bg-blue-700 text-white"
                  onClick={() => {
                    const target = selectedDetailsDock;
                    setSelectedDetailsDock(null);
                    setAllocateModalDock(target);
                    setSelectedRequestIdToAllocate(pendingRequests[0]?.id || "");
                  }}
                >
                  <ArrowRight className="size-4" /> ALLOCATE DOCK
                </Button>
              )}

              {selectedDetailsDock.status === "OCCUPIED" && canReleaseDock(selectedDetailsDock) && (
                <Button
                  className="rounded-xl shadow-glow w-full sm:w-auto text-xs bg-[#ef4444] hover:bg-red-600 text-white font-bold"
                  onClick={() => {
                    const target = selectedDetailsDock;
                    setSelectedDetailsDock(null);
                    setReleaseConfirmDock(target);
                  }}
                >
                  <CheckCircle2 className="size-4 mr-1" /> RELEASE DOCK
                </Button>
              )}

              {selectedDetailsDock.status === "OCCUPIED" && !canReleaseDock(selectedDetailsDock) && (
                <div className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-xl px-3 py-2 text-left">
                  <Info className="size-4 shrink-0" />
                  <span>
                    Dock release must be performed by the assigned <strong>Warehouse Operator</strong> (
                    {selectedDetailsDock.assigned_warehouse_name || selectedDetailsDock.warehouse_name || "Chemical Warehouse"}
                    ) from their Warehouse Portal.
                  </span>
                </div>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* 5. Allocate Vehicle to This Specific Available Dock Modal */}
      {allocateModalDock && (
        <Dialog open={Boolean(allocateModalDock)} onOpenChange={() => setAllocateModalDock(null)}>
          <DialogContent className="max-w-lg rounded-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ArrowRight className="size-5 text-primary" /> Allocate Dock:{" "}
                <span className="font-mono font-black text-primary">
                  {allocateModalDock.dock_code}
                </span>
              </DialogTitle>
              <DialogDescription className="text-xs">
                Select an approved Gate Pass vehicle to allocate to {allocateModalDock.dock_name}.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2 text-xs">
              <Label className="text-xs font-semibold">Select Pending Gate Pass Request:</Label>
              {pendingRequests.length === 0 ? (
                <div className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">
                  No pending gate pass requests currently awaiting dock allocation.
                </div>
              ) : (
                <div className="max-h-60 overflow-y-auto space-y-2 border rounded-xl p-2 bg-muted/20">
                  {pendingRequests.map((req) => (
                    <label
                      key={req.id}
                      onClick={() => setSelectedRequestIdToAllocate(req.id)}
                      className={cn(
                        "flex cursor-pointer items-center justify-between rounded-xl border p-3 transition-all",
                        selectedRequestIdToAllocate === req.id
                          ? "border-primary bg-primary-soft/30 shadow-sm"
                          : "border-border/60 hover:bg-muted/50",
                      )}
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-primary">
                            {req.existing_gate_pass_id}
                          </span>
                          <span className="font-mono font-bold">{req.vehicle_number}</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          {req.vendor_reference || "Vendor"} ·{" "}
                          {req.material_reference || req.material_description || "Material"}
                        </p>
                      </div>
                      <input
                        type="radio"
                        name="allocation_request"
                        checked={selectedRequestIdToAllocate === req.id}
                        onChange={() => setSelectedRequestIdToAllocate(req.id)}
                        className="size-4 accent-primary"
                      />
                    </label>
                  ))}
                </div>
              )}
              {/* Warehouse Operator Selection */}
              <div className="hidden">
                <Label className="text-xs font-semibold flex items-center justify-between">
                  <span>Assign Responsible Warehouse Operator:</span>
                  <span className="text-[10px] text-muted-foreground font-normal">Required</span>
                </Label>
                <select
                  value={selectedWarehouseManagerId}
                  onChange={(e) => setSelectedWarehouseManagerId(e.target.value)}
                  className="mt-1.5 w-full h-9 rounded-xl border border-input bg-background px-3 text-xs font-medium focus:ring-2 focus:ring-primary/20"
                >
                  <option value="">-- Select Warehouse Operator --</option>
                  {warehouseManagers.map((sm) => (
                    <option key={sm.id || sm.employee_id} value={sm.employee_id || sm.id}>
                      {sm.full_name} ({sm.employee_id || sm.username}) {sm.warehouse_name ? `· ${sm.warehouse_name}` : ""}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground mt-1">
                  The designated Warehouse Operator will be authorized to inspect materials and release this dock.
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                className="rounded-xl"
                onClick={() => setAllocateModalDock(null)}
              >
                Cancel
              </Button>
              <Button
                disabled={!selectedRequestIdToAllocate || actionBusy}
                className="rounded-xl shadow-glow bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                onClick={() => void handleAllocateDock()}
              >
                {actionBusy && <Loader2 className="size-4 animate-spin" />} Confirm Allocation
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* 5b. Allocate Available Dock to Selected Pending Request Modal */}
      {allocateModalPendingReq && (
        <Dialog open={Boolean(allocateModalPendingReq)} onOpenChange={() => setAllocateModalPendingReq(null)}>
          <DialogContent className="max-w-lg rounded-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ArrowRight className="size-5 text-primary" /> Allocate Dock for:{" "}
                <span className="font-mono font-black text-primary">
                  {allocateModalPendingReq.vehicle_number}
                </span>
              </DialogTitle>
              <DialogDescription className="text-xs">
                Pass: {allocateModalPendingReq.existing_gate_pass_id} · Vendor: {allocateModalPendingReq.vendor_reference || "Supplier"}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2 text-xs">
              <Label className="text-xs font-semibold">Select Available Dock:</Label>
              {docks.filter((d) => d.status === "AVAILABLE").length === 0 ? (
                <div className="rounded-xl border border-dashed p-4 text-center text-xs text-rose-600 font-semibold">
                  No docks currently available for allocation.
                </div>
              ) : (
                <div className="max-h-52 overflow-y-auto space-y-2 border rounded-xl p-2 bg-muted/20">
                  {docks
                    .filter((d) => d.status === "AVAILABLE")
                    .map((d) => (
                      <label
                        key={d.id}
                        onClick={() => setSelectedDockIdToAllocate(d.id)}
                        className={cn(
                          "flex cursor-pointer items-center justify-between rounded-xl border p-3 transition-all",
                          selectedDockIdToAllocate === d.id
                            ? "border-primary bg-primary-soft/30 shadow-sm"
                            : "border-border/60 hover:bg-muted/50",
                        )}
                      >
                        <div>
                          <span className="font-mono font-bold text-foreground">{d.dock_code}</span>
                          <span className="ml-2 text-xs text-muted-foreground">{d.dock_name}</span>
                          <span className="block text-[10px] text-muted-foreground uppercase">{getCategoryLabel(d.dock_type)}</span>
                        </div>
                        <input
                          type="radio"
                          name="dock_select"
                          checked={selectedDockIdToAllocate === d.id}
                          onChange={() => setSelectedDockIdToAllocate(d.id)}
                          className="size-4 accent-primary"
                        />
                      </label>
                    ))}
                </div>
              )}

              {(() => {
                const selectedDock = docks.find((dock) => dock.id === selectedDockIdToAllocate);
                return selectedDock && !isDockCompatible(allocateModalPendingReq, selectedDock) ? (
                  <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
                    This dock is incompatible with {allocateModalPendingReq.material_reference || allocateModalPendingReq.material_description || "the selected material"}. Choose a General, Raw Material, or other suitable dock.
                  </div>
                ) : null;
              })()}
              {/* Warehouse Operator Selection */}
              <div className="hidden">
                <Label className="text-xs font-semibold flex items-center justify-between">
                  <span>Assign Responsible Warehouse Operator:</span>
                  <span className="text-[10px] text-muted-foreground font-normal">Required</span>
                </Label>
                <select
                  value={selectedWarehouseManagerId}
                  onChange={(e) => setSelectedWarehouseManagerId(e.target.value)}
                  className="mt-1.5 w-full h-9 rounded-xl border border-input bg-background px-3 text-xs font-medium focus:ring-2 focus:ring-primary/20"
                >
                  <option value="">-- Select Warehouse Operator --</option>
                  {warehouseManagers.map((sm) => (
                    <option key={sm.id || sm.employee_id} value={sm.employee_id || sm.id}>
                      {sm.full_name} ({sm.employee_id || sm.username}) {sm.warehouse_name ? `· ${sm.warehouse_name}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                className="rounded-xl"
                onClick={() => setAllocateModalPendingReq(null)}
              >
                Cancel
              </Button>
              <Button
                disabled={
                  !selectedDockIdToAllocate ||
                  actionBusy ||
                  !isDockCompatible(
                    allocateModalPendingReq,
                    docks.find((dock) => dock.id === selectedDockIdToAllocate) as Dock,
                  )
                }
                className="rounded-xl shadow-glow bg-purple-600 hover:bg-purple-700 text-white font-semibold"
                onClick={() => void handleAllocateDock()}
              >
                {actionBusy && <Loader2 className="size-4 animate-spin" />} Confirm Allocation
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* 6. Release Dock Confirmation Dialog */}
      <AlertDialog
        open={Boolean(releaseConfirmDock)}
        onOpenChange={() => setReleaseConfirmDock(null)}
      >
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <ShieldAlert className="size-5" /> Release Dock?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="mt-2 space-y-2 text-xs text-muted-foreground">
                <div className="rounded-xl border bg-muted/40 p-3 text-foreground space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Dock:</span>
                    <span className="font-mono font-bold">
                      {releaseConfirmDock?.dock_code} ({releaseConfirmDock?.dock_name})
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Vehicle:</span>
                    <span className="font-mono font-bold text-[#2563eb]">
                      {releaseConfirmDock?.current_allocation?.vehicle_number || "—"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Gate Pass:</span>
                    <span className="font-mono font-bold">
                      {releaseConfirmDock?.current_allocation?.existing_gate_pass_id || "—"}
                    </span>
                  </div>
                </div>
                <p>
                  Releasing will immediately change the dock status back to{" "}
                  <strong className="text-emerald-600 font-bold">AVAILABLE</strong>, freeing it for
                  new vehicle allocations.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={actionBusy}
              className="rounded-xl bg-rose-600 hover:bg-rose-700 text-white"
              onClick={(e) => {
                e.preventDefault();
                void handleReleaseDock();
              }}
            >
              {actionBusy && <Loader2 className="size-4 animate-spin" />} Confirm Release
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>



      {/* 8. Edit Dock Dialog */}
      <Dialog open={Boolean(editDockModalDock)} onOpenChange={() => setEditDockModalDock(null)}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <SquarePen className="size-5 text-blue-600" /> Edit Dock: {editDockModalDock?.dock_code}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Update dock parameters and configuration.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3.5 py-2 text-xs">
            <div>
              <Label className="text-xs font-semibold">Dock Name</Label>
              <Input
                required
                maxLength={128}
                value={editDockForm.name}
                onChange={(e) => setEditDockForm({ ...editDockForm, name: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs font-semibold">Dock Code</Label>
              <Input value={editDockForm.code} readOnly className="mt-1 font-mono bg-muted/50" />
            </div>
            <div>
              <Label className="text-xs font-semibold">Dock Category</Label>
              <select
                value={editDockForm.type}
                onChange={(e) => setEditDockForm({ ...editDockForm, type: e.target.value })}
                className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 text-xs"
              >
                <option value="CHEMICAL_HAZARDOUS">Chemical / Hazardous</option>
                <option value="ELECTRONICS">Electronics</option>
                <option value="ELECTRICAL">Electrical</option>
                <option value="RAW_MATERIAL">Raw Material</option>
                <option value="MAIN_RECEIVING">Main Receiving</option>
                <option value="FINISHED_GOODS">Finished Goods / FG</option>
              </select>
            </div>
            <div>
              <Label className="text-xs font-semibold">Dock Direction</Label>
              <select
                value={editDockForm.direction}
                onChange={(e) => {
                  const direction = e.target.value as "INBOUND" | "OUTBOUND" | "BOTH";
                  setEditDockForm({ ...editDockForm, direction });
                }}
                className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 text-xs"
              >
                <option value="INBOUND">INBOUND</option>
                <option value="OUTBOUND">OUTBOUND</option>
                <option value="BOTH">BOTH</option>
              </select>
            </div>
            <div>
              <Label className="text-xs font-semibold">Dock Location</Label>
              <Input
                value={editDockForm.location}
                onChange={(e) => setEditDockForm({ ...editDockForm, location: e.target.value })}
                className="mt-1"
                maxLength={128}
              />
            </div>
            <div>
              <Label className="text-xs font-semibold">Description</Label>
              <Input
                value={editDockForm.description}
                onChange={(e) => setEditDockForm({ ...editDockForm, description: e.target.value })}
                className="mt-1"
                maxLength={500}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => setEditDockModalDock(null)}
            >
              Cancel
            </Button>
            <Button
              disabled={actionBusy}
              className="rounded-xl bg-blue-600 hover:bg-blue-700 text-white"
              onClick={() => void handleUpdateDock()}
            >
              {actionBusy && <Loader2 className="size-4 animate-spin mr-1" />} Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 9. Maintenance Toggle Dialog */}
      <AlertDialog
        open={Boolean(maintenanceConfirmDock)}
        onOpenChange={() => setMaintenanceConfirmDock(null)}
      >
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-amber-600">
              <Wrench className="size-5" />{" "}
              {maintenanceConfirmDock?.status === "MAINTENANCE"
                ? "Complete Maintenance?"
                : "Put Dock Under Maintenance?"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="mt-2 space-y-2 text-xs text-muted-foreground">
                <p>
                  Dock:{" "}
                  <strong className="text-foreground font-mono">
                    {maintenanceConfirmDock?.dock_code} ({maintenanceConfirmDock?.dock_name})
                  </strong>
                </p>
                {maintenanceConfirmDock?.status === "OCCUPIED" && (
                  <p className="text-rose-600 font-semibold">
                    Note: This dock currently has an assigned vehicle. Please release the dock
                    before putting it under maintenance.
                  </p>
                )}
                {maintenanceConfirmDock?.status !== "OCCUPIED" && (
                  <p>
                    {maintenanceConfirmDock?.status === "MAINTENANCE"
                      ? "Dock will be restored to AVAILABLE status for receiving."
                      : "Dock will be marked UNDER MAINTENANCE and removed from available allocation bays."}
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={maintenanceConfirmDock?.status === "OCCUPIED" || actionBusy}
              className="rounded-xl bg-amber-600 hover:bg-amber-700 text-white"
              onClick={(e) => {
                e.preventDefault();
                void handleToggleMaintenance();
              }}
            >
              {actionBusy && <Loader2 className="size-4 animate-spin" />} Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      </div>
    </AppShell>
  );
}

function SummaryCard({
  label,
  value,
  variant,
  active,
  onClick,
}: {
  label: string;
  value: number;
  variant: "total" | "available" | "reserved" | "occupied" | "maintenance" | "pending";
  active: boolean;
  onClick: () => void;
}) {
  const styles = {
    total: {
      bg: "bg-white dark:bg-card border-border/80",
      activeBorder: "border-2 border-blue-600 ring-2 ring-blue-500/15 shadow-sm",
      labelColor: "text-slate-800 dark:text-slate-200",
      numberColor: "text-blue-600",
    },
    available: {
      bg: "bg-[#e8fbf3] dark:bg-emerald-950/20 border-[#c6f6df] dark:border-emerald-900/40",
      activeBorder: "border-2 border-emerald-600 ring-2 ring-emerald-500/20 shadow-sm",
      labelColor: "text-emerald-900 dark:text-emerald-300",
      numberColor: "text-emerald-600 dark:text-emerald-400",
    },
    reserved: {
      bg: "bg-[#fef7e8] dark:bg-amber-950/20 border-[#fdecd0] dark:border-amber-900/40",
      activeBorder: "border-2 border-amber-600 ring-2 ring-amber-500/20 shadow-sm",
      labelColor: "text-amber-900 dark:text-amber-300",
      numberColor: "text-amber-600 dark:text-amber-400",
    },
    occupied: {
      bg: "bg-[#fdf0f4] dark:bg-rose-950/20 border-[#fcd5e0] dark:border-rose-900/40",
      activeBorder: "border-2 border-rose-600 ring-2 ring-rose-500/20 shadow-sm",
      labelColor: "text-rose-900 dark:text-rose-300",
      numberColor: "text-rose-600 dark:text-rose-400",
    },
    maintenance: {
      bg: "bg-[#f1f3f6] dark:bg-slate-900/40 border-[#e2e6eb] dark:border-slate-800",
      activeBorder: "border-2 border-slate-600 ring-2 ring-slate-500/20 shadow-sm",
      labelColor: "text-slate-700 dark:text-slate-300",
      numberColor: "text-slate-600 dark:text-slate-400",
    },
    pending: {
      bg: "bg-[#f8f0fc] dark:bg-purple-950/20 border-[#eed8fa] dark:border-purple-900/40",
      activeBorder: "border-2 border-purple-600 ring-2 ring-purple-500/20 shadow-sm",
      labelColor: "text-purple-900 dark:text-purple-300",
      numberColor: "text-purple-600 dark:text-purple-400",
    },
  }[variant];

  return (
    <div
      onClick={onClick}
      className={cn(
        "cursor-pointer rounded-2xl p-4.5 transition-all duration-200 border select-none hover:-translate-y-0.5 shadow-2xs",
        styles.bg,
        active ? styles.activeBorder : "",
      )}
    >
      <p className={cn("text-[10.5px] font-extrabold uppercase tracking-wider", styles.labelColor)}>
        {label}
      </p>
      <p className={cn("mt-2 text-3xl font-black tracking-tight tabular-nums", styles.numberColor)}>
        {value}
      </p>
      <p className="mt-2 text-[11px] font-medium text-muted-foreground">Click to filter</p>
    </div>
  );
}

function DockCard({
  dock,
  canRelease,
  onViewDetails,
  onEdit,
  onMaintenanceToggle,
  onRelease,
  onConfirmArrival,
}: {
  dock: Dock;
  canRelease: boolean;
  onViewDetails: () => void;
  onEdit: () => void;
  onMaintenanceToggle: () => void;
  onRelease: () => void;
  onConfirmArrival: () => void;
}) {
  const isAvailable = dock.status === "AVAILABLE";
  const isOccupied = dock.status === "OCCUPIED" || dock.status === "RESERVED";
  const isMaintenance = dock.status === "MAINTENANCE";

  const cardBorder = isAvailable
    ? "border-2 border-[#a7f3d0] dark:border-emerald-900/60"
    : isOccupied
      ? "border-2 border-[#fecdd3] dark:border-rose-900/60"
      : "border-2 border-slate-300 dark:border-slate-800";

  const dotColor = isAvailable
    ? "bg-emerald-500"
    : isOccupied
      ? "bg-rose-500"
      : "bg-slate-500";

  const badgeStyle = isAvailable
    ? "bg-[#dcfce7] text-[#15803d] border-[#bbf7d0]"
    : isOccupied
      ? "bg-[#ffe4e6] text-[#e11d48] border-[#fecdd3]"
      : "bg-slate-100 text-slate-700 border-slate-200";

  const badgeText = isAvailable ? "AVAILABLE" : isOccupied ? "AT DOCK" : "MAINTENANCE";

  const vehicleNo = dock.current_allocation?.vehicle_number;
  const gatePassNo = dock.current_allocation?.existing_gate_pass_id;
  const awaitingPhysicalArrival = isOccupied && dock.current_allocation?.status === "DOCK_ASSIGNED";

  return (
    <Card
      className={cn(
        "flex flex-col justify-between rounded-3xl bg-card p-6 transition-all duration-200 shadow-2xs hover:shadow-soft",
        cardBorder,
      )}
    >
      <div>
        {/* Top Header Row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={cn("size-2.5 rounded-full shrink-0", dotColor)} />
            <h3 className="font-mono text-base font-black tracking-tight text-foreground">
              {dock.dock_code}
            </h3>
          </div>
          <span
            className={cn(
              "rounded-full px-3 py-0.5 text-[10px] font-extrabold tracking-wider border",
              badgeStyle,
            )}
          >
            {badgeText}
          </span>
        </div>

        {/* Dock Name */}
        <p className="mt-2 text-xs font-semibold text-muted-foreground">{dock.dock_name}</p>

        {/* Category Pill */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="inline-block rounded-full bg-slate-100 dark:bg-slate-800/80 px-2.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
            {getCategoryLabel(dock.dock_type)}
          </span>
          {(dock.assigned_warehouse_code || dock.warehouse_code) && (
            <span className="inline-block rounded-full bg-blue-50 dark:bg-blue-950/50 border border-blue-200/60 dark:border-blue-800/40 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-blue-700 dark:text-blue-300">
              {dock.assigned_warehouse_name ? `${dock.assigned_warehouse_name} (${dock.assigned_warehouse_code || dock.warehouse_code})` : (dock.warehouse_name || dock.assigned_warehouse_code || dock.warehouse_code)}
            </span>
          )}
          {dock.location && (
            <span className="text-[11px] text-muted-foreground/80">• {dock.location}</span>
          )}
        </div>

        {/* Vehicle Info Box if Occupied */}
        {isOccupied && (
          <div className="mt-5 rounded-2xl border border-border/50 bg-slate-50/70 dark:bg-slate-900/40 p-3.5 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                VEHICLE
              </span>
              <span className="font-mono font-bold text-sm text-[#2563eb]">
                {vehicleNo || "—"}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-xs font-medium text-muted-foreground">Gate Pass</span>
              <span className="font-mono font-bold text-xs text-foreground">
                {gatePassNo || "—"}
              </span>
            </div>
            {(dock.assigned_warehouse_operator_name || dock.current_allocation?.assigned_warehouse_operator_name) && (
              <div className="flex items-center justify-between text-xs pt-1.5 border-t border-border/40">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  WAREHOUSE_OPERATOR MGR
                </span>
                <span className="font-semibold text-xs text-indigo-600 dark:text-indigo-400">
                  {dock.assigned_warehouse_operator_name || dock.current_allocation?.assigned_warehouse_operator_name}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Space reserved for available / maintenance so cards have identical height */}
        {!isOccupied && <div className="min-h-[66px] mt-5" />}
      </div>

      {/* Bottom Actions */}
      <div className="mt-6 pt-4 border-t border-border/60 space-y-2.5">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="flex-1 rounded-full border-border/80 bg-card hover:bg-muted text-xs font-bold text-slate-700 dark:text-slate-200 h-9 shadow-2xs"
            onClick={onViewDetails}
          >
            VIEW DETAILS
          </Button>
          <button
            type="button"
            onClick={onEdit}
            title="Edit Dock"
            className="size-9 rounded-full border border-border/80 flex items-center justify-center hover:bg-muted text-slate-600 dark:text-slate-300 transition-colors shrink-0 shadow-2xs"
          >
            <SquarePen className="size-4" />
          </button>
          <button
            type="button"
            onClick={onMaintenanceToggle}
            title={isMaintenance ? "Resume Operation" : "Set Maintenance"}
            className="size-9 rounded-full border border-border/80 flex items-center justify-center hover:bg-muted text-amber-500 hover:text-amber-600 transition-colors shrink-0 shadow-2xs"
          >
            <Wrench className="size-4" />
          </button>
        </div>

        {isOccupied && canRelease && (
          <Button
            className="w-full rounded-full bg-[#ef4444] hover:bg-red-600 text-white font-bold text-xs h-9 shadow-2xs flex items-center justify-center gap-1.5"
            onClick={onRelease}
          >
            <CheckCircle2 className="size-4" /> RELEASE DOCK
          </Button>
        )}

        {awaitingPhysicalArrival && (
          <Button
            className="w-full rounded-full bg-blue-600 text-xs font-bold text-white hover:bg-blue-700"
            onClick={onConfirmArrival}
          >
            <CheckCircle2 className="size-4" /> CONFIRM ARRIVAL AT DOCK
          </Button>
        )}

        {isOccupied && !canRelease && (
          <div className="w-full rounded-full bg-slate-100 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/60 px-3 py-1.5 text-center text-[10px] font-semibold text-muted-foreground flex items-center justify-center gap-1.5">
            <ShieldAlert className="size-3.5 text-amber-500 shrink-0" />
            <span>Release: Assigned Warehouse Operator only</span>
          </div>
        )}
      </div>
    </Card>
  );
}
