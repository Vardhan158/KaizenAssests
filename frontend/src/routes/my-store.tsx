import { createFileRoute } from "@tanstack/react-router";
import type { KeyboardEvent } from "react";
import { useEffect, useState, useMemo } from "react";
import {
  Building2,
  ShieldCheck,
  UserCheck,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Layers,
  Boxes,
  ClipboardList,
  AlertTriangle,
  Info,
  Plus,
  Edit,
  Power,
  Search,
  XCircle,
  Tag,
  QrCode,
  Printer,
  Download,
  ScanLine,
  Play,
  ArrowRight,
  MapPin,
  Clock,
  PackageCheck,
  Save,
  Grid,
  ChevronDown,
  ChevronRight,
  Truck,
  Warehouse,
  LogOut,
  ExternalLink,
  Calendar,
  BadgeCheck,
  History,
  Send,
  ArrowUpRight,
  FileText,
  Scan,
  LayoutDashboard,
  Package,
  ShieldAlert,
  TrendingDown,
  Activity,
  Sparkles,
} from "lucide-react";
import QRCode from "qrcode";
import { AppShell, StatusBadge } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api-client";
import { getUserInfo, requireRole } from "@/lib/auth-utils";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type MyStoreSearch = {
  tab?:
    | "overview"
    | "dashboard"
    | "putaway"
    | "pickup"
    | "takeaway"
    | "history"
    | "zones"
    | "inventory"
    | "docks";
};

export const Route = createFileRoute("/my-store")({
  beforeLoad: () => requireRole(["STORE_MANAGER", "STORE_KEEPER", "ADMIN", "SUPERUSER"]),
  validateSearch: (search: Record<string, unknown>): MyStoreSearch => {
    const tab = search.tab;
    if (
      typeof tab === "string" &&
      [
        "overview",
        "dashboard",
        "putaway",
        "pickup",
        "takeaway",
        "history",
        "zones",
        "inventory",
        "docks",
      ].includes(tab)
    ) {
      return { tab: (tab === "dashboard" ? "overview" : tab) as MyStoreSearch["tab"] };
    }
    return {};
  },
  head: () => ({
    meta: [
      { title: "My Store · KaizenX" },
      {
        name: "description",
        content:
          "Dedicated Store Keeper & Manager portal for store operations, putaway execution, material pickup, and inventory movements.",
      },
    ],
  }),
  component: MyStorePage,
});

interface StoreDashboardKPIs {
  total_skus: number;
  total_quantity: number;
  available_quantity: number;
  quarantined_quantity: number;
  damaged_quantity: number;
  low_stock_count: number;
  low_stock_items?: number;
  zones_count: number;
  bins_count: number;
  assigned_docks_count: number;
}

interface StoreAssemblyReservationItem {
  id: string;
  requisition_id: string;
  requisition_item_id: string;
  requisition_number: string;
  material_code: string;
  material_name: string;
  required_quantity: number;
  reserved_quantity: number;
  uom: string;
  status: string;
  store_id?: string | null;
  store_code?: string | null;
  store_name?: string | null;
  zone_code?: string | null;
  bin_code?: string | null;
  location_code?: string | null;
  reserved_by: string;
  reserved_at: string;
}

interface StoreInventoryItem {
  material_code: string;
  material_name: string;
  category: string;
  uom: string;
  total_quantity: number;
  available_quantity: number;
  reserved_quantity?: number;
  quarantined_quantity: number;
  damaged_quantity: number;
  locations_count: number;
  last_activity_at?: string | null;
}

interface StoreMovementActivity {
  id: string;
  material_code: string;
  material_name: string;
  movement_type: string;
  quantity: number;
  uom: string;
  source_location?: string | null;
  destination_location?: string | null;
  reference_document?: string | null;
  performed_by_name?: string | null;
  created_at: string;
}

interface StoreDashboardMetricsResponse {
  store?: Store;
  kpis: StoreDashboardKPIs;
  inventory_summary: any[];
  inventory_items?: StoreInventoryItem[];
  recent_activity: StoreMovementActivity[];
  assembly_reservations?: StoreAssemblyReservationItem[];
}

interface Store {
  id: string;
  store_code: string;
  store_name: string;
  description?: string | null;
  warehouse_id: string;
  store_manager_id?: string | null;
  store_manager_name?: string | null;
  status: string;
  store_type?: string;
  created_at?: string;
  updated_at?: string;
  zones_count?: number;
}

interface Bin {
  id: string;
  store_id: string;
  zone_id: string;
  bin_code: string;
  bin_name: string;
  rack?: string | null;
  shelf?: string | null;
  capacity: number;
  occupied_quantity: number;
  available_capacity: number;
  occupancy_percentage: number;
  status: string;
  created_at?: string;
  updated_at?: string;
  zone_code?: string;
  zone_name?: string;
  store_code?: string;
  store_name?: string;
}

interface Zone {
  id: string;
  store_id: string;
  zone_code: string;
  zone_name: string;
  description?: string | null;
  status: string;
  created_at?: string;
  updated_at?: string;
  bins_count: number;
  bins?: Bin[];
  store_code?: string;
  store_name?: string;
}

interface PutawayTask {
  id: string;
  task_number: string;
  grn_id: string;
  grn_number: string;
  handling_unit_id?: string | null;
  item_code: string;
  material_name: string;
  material_qr?: string | null;
  quantity: number;
  uom: string;
  warehouse_id: string;
  source_location?: string | null;
  destination_store_id?: string | null;
  destination_zone_id?: string | null;
  destination_bin_id?: string | null;
  destination_bin_code?: string | null;
  destination_zone?: string | null;
  destination_rack?: string | null;
  destination_bin?: string | null;
  assigned_to?: string | null;
  assigned_store_manager_name?: string | null;
  completed_by?: string | null;
  completed_at?: string | null;
  status:
    | "PENDING"
    | "IN_PROGRESS"
    | "COMPLETED"
    | "CANCELLED"
    | "PUTAWAY_PENDING"
    | "PUTAWAY_IN_PROGRESS"
    | "PUTAWAY_COMPLETED"
    | "ASSIGNED_TO_STORE"
    | string;
  created_at: string;
  updated_at?: string;
}

interface PickupTask {
  id: string;
  task_number: string;
  requisition_id?: string | null;
  requisition_number?: string | null;
  request_number?: string | null;
  item_code: string;
  material_code?: string;
  material_name: string;
  quantity_requested?: number;
  requested_quantity?: number;
  quantity_picked?: number;
  picked_quantity?: number;
  uom: string;
  warehouse_id?: string;
  source_store_id?: string | null;
  source_zone_id?: string | null;
  source_bin_id?: string | null;
  source_zone?: string | null;
  source_bin?: string | null;
  assigned_to?: string | null;
  picked_by?: string | null;
  department?: string | null;
  priority?: string | null;
  required_date?: string | null;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "ASSIGNED_TO_STORE" | string;
  created_at: string;
  updated_at?: string;
}

interface InventoryBalance {
  id: string;
  material_id: string;
  material_code: string;
  material_name: string;
  warehouse_id: string;
  category?: string | null;
  location_code?: string | null;
  store_id?: string | null;
  store_code?: string | null;
  store_name?: string | null;
  zone_id?: string | null;
  zone_code?: string | null;
  zone_name?: string | null;
  quantity: number;
  available_quantity: number;
  uom: string;
  last_grn_number?: string | null;
  updated_at: string;
}

interface StoreDock {
  id: string;
  dock_code: string;
  dock_name: string;
  dock_type: string;
  status: "AVAILABLE" | "OCCUPIED" | "MAINTENANCE" | "RESERVED" | "RELEASED" | string;
  location?: string | null;
  description?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  store_id?: string | null;
  store_code?: string | null;
  store_name?: string | null;
  assigned_store_id?: string | null;
  assigned_store_code?: string | null;
  assigned_store_name?: string | null;
  current_allocation?: {
    id: string;
    vehicle_number: string;
    existing_gate_pass_id: string;
    vendor_reference?: string | null;
    material_reference?: string | null;
    quantity?: number | null;
    priority: string;
    status: string;
    assigned_dock_id?: string | null;
    assigned_at?: string | null;
    assigned_store_id?: string | null;
    assigned_store_code?: string | null;
    assigned_store_name?: string | null;
  } | null;
}

function MyStorePage() {
  const searchParams = Route.useSearch();
  const [activeTab, setActiveTab] = useState<
    "overview" | "putaway" | "pickup" | "takeaway" | "history" | "zones" | "inventory" | "docks"
  >(searchParams.tab === "dashboard" ? "overview" : searchParams.tab || "overview");

  useEffect(() => {
    if (searchParams.tab) {
      setActiveTab(searchParams.tab === "dashboard" ? "overview" : searchParams.tab);
    }
  }, [searchParams.tab]);
  const [store, setStore] = useState<Store | null>(null);
  const isStoreActive = store?.status?.toUpperCase() === "ACTIVE";
  const [storeMetrics, setStoreMetrics] = useState<StoreDashboardMetricsResponse | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [overviewSearch, setOverviewSearch] = useState("");
  const [zones, setZones] = useState<Zone[]>([]);
  const [putawayTasks, setPutawayTasks] = useState<PutawayTask[]>([]);
  const [pickupTasks, setPickupTasks] = useState<PickupTask[]>([]);
  const [inventoryBalances, setInventoryBalances] = useState<InventoryBalance[]>([]);
  const [docks, setDocks] = useState<StoreDock[]>([]);
  const [docksLoading, setDocksLoading] = useState(false);
  const [dockSearch, setDockSearch] = useState("");
  const [dockStatusFilter, setDockStatusFilter] = useState("ALL");
  const [selectedDockForDetails, setSelectedDockForDetails] = useState<StoreDock | null>(null);
  const [releaseConfirmDock, setReleaseConfirmDock] = useState<StoreDock | null>(null);
  const [releasingDockBusy, setReleasingDockBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [zonesLoading, setZonesLoading] = useState(false);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [pickupTasksLoading, setPickupTasksLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Takeaway Operation State
  const [takeawayBinInput, setTakeawayBinInput] = useState("");
  const [takeawayScannedBinCode, setTakeawayScannedBinCode] = useState("");
  const [takeawayBinMaterials, setTakeawayBinMaterials] = useState<any[]>([]);
  const [takeawayLoadingMaterials, setTakeawayLoadingMaterials] = useState(false);
  const [takeawaySelectedMaterial, setTakeawaySelectedMaterial] = useState<any | null>(null);
  const [takeawayQuantity, setTakeawayQuantity] = useState("");
  const [takeawayRemarks, setTakeawayRemarks] = useState("");
  const [takeawayRefDoc, setTakeawayRefDoc] = useState("");
  const [takeawayExecuting, setTakeawayExecuting] = useState(false);

  // Movement History State
  const [movementHistory, setMovementHistory] = useState<any[]>([]);
  const [movementHistoryLoading, setMovementHistoryLoading] = useState(false);
  const [movementHistoryTypeFilter, setMovementHistoryTypeFilter] = useState("ALL");
  const [movementHistorySearch, setMovementHistorySearch] = useState("");

  // Expanded Zones in accordion
  const [expandedZoneIds, setExpandedZoneIds] = useState<Set<string>>(new Set());

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [putawaySearch, setPutawaySearch] = useState("");
  const [putawayStatusFilter, setPutawayStatusFilter] = useState("ALL");
  const [pickupSearch, setPickupSearch] = useState("");
  const [pickupStatusFilter, setPickupStatusFilter] = useState("ALL");

  const activateCardOnKey = (event: KeyboardEvent<HTMLDivElement>, action: () => void) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      action();
    }
  };

  // Zone QR Modal
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [selectedZoneForQr, setSelectedZoneForQr] = useState<Zone | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrPayloadData, setQrPayloadData] = useState<any>(null);
  const [loadingQr, setLoadingQr] = useState(false);

  // Bin QR Modal
  const [binQrModalOpen, setBinQrModalOpen] = useState(false);
  const [selectedBinForQr, setSelectedBinForQr] = useState<Bin | null>(null);
  const [selectedZoneForBinQr, setSelectedZoneForBinQr] = useState<Zone | null>(null);
  const [binQrDataUrl, setBinQrDataUrl] = useState<string | null>(null);
  const [loadingBinQr, setLoadingBinQr] = useState(false);

  // Store Keeper Putaway Execution Modal
  const [executingTask, setExecutingTask] = useState<PutawayTask | null>(null);
  const [executeModalOpen, setExecuteModalOpen] = useState(false);
  const [matScanInput, setMatScanInput] = useState("");
  const [zoneScanInput, setZoneScanInput] = useState("");
  const [binScanInput, setBinScanInput] = useState("");
  const [confirmedQty, setConfirmedQty] = useState("");
  const [verifyingMat, setVerifyingMat] = useState(false);
  const [verifiedHU, setVerifiedHU] = useState<any>(null);
  const [confirmingPutaway, setConfirmingPutaway] = useState(false);

  // Store Keeper Pickup Execution Modal
  const [executingPickupTask, setExecutingPickupTask] = useState<PickupTask | null>(null);
  const [executePickupModalOpen, setExecutePickupModalOpen] = useState(false);
  const [pickupMatScan, setPickupMatScan] = useState("");
  const [pickupZoneScan, setPickupZoneScan] = useState("");
  const [pickupQty, setPickupQty] = useState("");
  const [confirmingPickup, setConfirmingPickup] = useState(false);

  const user = getUserInfo();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const resolveAssignedStore = async () => {
    const storeKey = user?.store_id || user?.storeId || user?.store_code || user?.storeCode;
    if (storeKey) {
      return api.getStore(storeKey);
    }

    const stores = await api.getStores().catch(() => []);
    return stores[0] || null;
  };

  const fetchStoreData = async () => {
    try {
      setLoading(true);
      setError(null);
      const storeData = await resolveAssignedStore();
      if (!storeData) {
        throw new Error("No assigned store found for this user.");
      }
      setStore(storeData);

      if (storeData?.id) {
        setZonesLoading(true);
        setTasksLoading(true);
        setPickupTasksLoading(true);
        setDocksLoading(true);
        setMetricsLoading(true);
        const [hierarchyData, tasksData, pickupData, balancesData, docksData, metricsData] =
          await Promise.all([
            api.getStoreHierarchy().catch(() => []),
            api.getPutawayTasks().catch(() => []),
            api.getPickupTasks().catch(() => []),
            api.getInventoryLocationBalances().catch(() => []),
            api.getDocks().catch(() => []),
            api.getStoreDashboardMetrics(storeData.id).catch(() => null),
          ]);

        if (metricsData) {
          setStoreMetrics(metricsData);
        }

        const myHierarchy = (hierarchyData || []).find(
          (s: any) => s.id === storeData.id || s.store_code === storeData.store_code,
        );
        if (myHierarchy && myHierarchy.zones) {
          setZones(myHierarchy.zones);
        } else {
          const fallbackZones = await api.getStoreZones(storeData.id).catch(() => []);
          setZones(fallbackZones || []);
        }

        setPutawayTasks(tasksData || []);
        setPickupTasks(pickupData || []);
        setDocks(docksData || []);
        // Filter balances for this store
        const storeBals = (balancesData || []).filter(
          (b: InventoryBalance) =>
            b.store_id === storeData.id || b.store_code === storeData.store_code,
        );
        setInventoryBalances(storeBals);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load assigned store.");
      toast.error("Could not load your assigned store.");
    } finally {
      setLoading(false);
      setZonesLoading(false);
      setTasksLoading(false);
      setPickupTasksLoading(false);
      setDocksLoading(false);
      setMetricsLoading(false);
    }
  };

  useEffect(() => {
    fetchStoreData();
  }, []);

  const refreshDocks = async () => {
    setDocksLoading(true);
    try {
      const data = await api.getDocks();
      setDocks(data || []);
    } catch {
      toast.error("Failed to refresh docks");
    } finally {
      setDocksLoading(false);
    }
  };

  const refreshZones = async () => {
    if (!store?.id) return;
    setZonesLoading(true);
    try {
      const hierarchyData = await api.getStoreHierarchy().catch(() => []);
      const myHierarchy = (hierarchyData || []).find(
        (s: any) => s.id === store.id || s.store_code === store.store_code,
      );
      if (myHierarchy && myHierarchy.zones) {
        setZones(myHierarchy.zones);
      } else {
        const z = await api.getStoreZones(store.id);
        setZones(z || []);
      }
    } catch {
      toast.error("Failed to refresh zones");
    } finally {
      setZonesLoading(false);
    }
  };

  const refreshTasksAndBalances = async () => {
    if (!store?.id) return;
    setTasksLoading(true);
    try {
      const [tasksData, balancesData, docksData, metricsData] = await Promise.all([
        api.getPutawayTasks().catch(() => []),
        api.getInventoryLocationBalances().catch(() => []),
        api.getDocks().catch(() => []),
        api.getStoreDashboardMetrics(store.id).catch(() => null),
      ]);
      setPutawayTasks(tasksData || []);
      setDocks(docksData || []);
      if (metricsData) {
        setStoreMetrics(metricsData);
      }
      const storeBals = (balancesData || []).filter(
        (b: InventoryBalance) => b.store_id === store.id || b.store_code === store.store_code,
      );
      setInventoryBalances(storeBals);
    } catch {
      toast.error("Failed to refresh tasks and balances");
    } finally {
      setTasksLoading(false);
    }
  };

  // Compute docks with active allocations assigned to this store
  const assignedStoreDocks = useMemo(() => {
    if (!store) return [];
    const sId = store.id;
    const sCode = (store.store_code || "").toUpperCase();

    return docks.filter((d) => {
      const alloc = d.current_allocation;
      if (alloc) {
        const aStoreId = alloc.assigned_store_id;
        const aStoreCode = (alloc.assigned_store_code || "").toUpperCase();
        if (sId && aStoreId && sId === aStoreId) return true;
        if (sCode && aStoreCode && sCode === aStoreCode) return true;
      }
      const dStoreId = d.assigned_store_id;
      const dStoreCode = (d.assigned_store_code || "").toUpperCase();
      // A newly allocated dock is visible to its assigned store before the
      // truck reaches it as well as while it is occupied.
      if (["OCCUPIED", "RESERVED", "ALLOCATED", "DOCK_ASSIGNED"].includes((d.status || "").toUpperCase())) {
        if (sId && dStoreId && sId === dStoreId) return true;
        if (sCode && dStoreCode && sCode === dStoreCode) return true;
      }
      return false;
    });
  }, [docks, store]);

  // Occupied or At Dock docks for this store
  const occupiedDocks = useMemo(() => {
    return assignedStoreDocks.filter((d) => d.status === "OCCUPIED" || d.status === "RESERVED");
  }, [assignedStoreDocks]);

  // Filtered assigned docks
  const filteredAssignedDocks = useMemo(() => {
    return assignedStoreDocks.filter((d) => {
      const matchesStatus =
        dockStatusFilter === "ALL" ||
        (dockStatusFilter === "OCCUPIED" && (d.status === "OCCUPIED" || d.status === "RESERVED")) ||
        d.status?.toUpperCase() === dockStatusFilter.toUpperCase();

      const q = dockSearch.toLowerCase().trim();
      const matchesSearch =
        !q ||
        d.dock_code.toLowerCase().includes(q) ||
        d.dock_name.toLowerCase().includes(q) ||
        (d.location && d.location.toLowerCase().includes(q)) ||
        (d.current_allocation?.vehicle_number &&
          d.current_allocation.vehicle_number.toLowerCase().includes(q)) ||
        (d.current_allocation?.existing_gate_pass_id &&
          d.current_allocation.existing_gate_pass_id.toLowerCase().includes(q)) ||
        (d.current_allocation?.material_reference &&
          d.current_allocation.material_reference.toLowerCase().includes(q)) ||
        (d.current_allocation?.vendor_reference &&
          d.current_allocation.vendor_reference.toLowerCase().includes(q));

      return matchesStatus && matchesSearch;
    });
  }, [assignedStoreDocks, dockStatusFilter, dockSearch]);

  const handleReleaseDockSubmit = async () => {
    if (!releaseConfirmDock) return;
    const targetId = releaseConfirmDock.current_allocation?.id || releaseConfirmDock.id;
    setReleasingDockBusy(true);
    try {
      await api.releaseDock(targetId);
      toast.success(`Dock ${releaseConfirmDock.dock_code} released successfully!`, {
        description: "Dock status returned to AVAILABLE. Inbound logistics may now reassign it.",
      });
      setReleaseConfirmDock(null);
      setSelectedDockForDetails(null);
      await Promise.all([refreshDocks(), refreshTasksAndBalances()]);
    } catch (err: any) {
      toast.error("Failed to release dock", {
        description: err.message || "Ensure you are the authorized Store Manager for this dock.",
      });
    } finally {
      setReleasingDockBusy(false);
    }
  };

  const toggleExpandZone = (zoneId: string) => {
    setExpandedZoneIds((prev) => {
      const next = new Set(prev);
      if (next.has(zoneId)) {
        next.delete(zoneId);
      } else {
        next.add(zoneId);
      }
      return next;
    });
  };

  // Filtered Zones
  const filteredZones = useMemo(() => {
    return zones.filter((z) => {
      const matchesStatus =
        statusFilter === "ALL" || z.status?.toUpperCase() === statusFilter.toUpperCase();
      const q = search.toLowerCase().trim();
      const matchesSearch =
        !q ||
        z.zone_code.toLowerCase().includes(q) ||
        z.zone_name.toLowerCase().includes(q) ||
        (z.description && z.description.toLowerCase().includes(q));
      return matchesStatus && matchesSearch;
    });
  }, [zones, statusFilter, search]);

  // Filtered Putaway Tasks
  const filteredPutawayTasks = useMemo(() => {
    return putawayTasks.filter((t) => {
      const matchesStatus =
        putawayStatusFilter === "ALL" ||
        t.status?.toUpperCase() === putawayStatusFilter.toUpperCase();
      const q = putawaySearch.toLowerCase().trim();
      const matchesSearch =
        !q ||
        t.task_number.toLowerCase().includes(q) ||
        t.item_code.toLowerCase().includes(q) ||
        t.material_name.toLowerCase().includes(q) ||
        t.grn_number.toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    });
  }, [putawayTasks, putawayStatusFilter, putawaySearch]);

  // Filtered Pickup Tasks
  const filteredPickupTasks = useMemo(() => {
    return pickupTasks.filter((t) => {
      const matchesStatus =
        pickupStatusFilter === "ALL" ||
        t.status?.toUpperCase() === pickupStatusFilter.toUpperCase();
      const q = pickupSearch.toLowerCase().trim();
      const matchesSearch =
        !q ||
        t.task_number.toLowerCase().includes(q) ||
        (t.request_number || t.requisition_number || "").toLowerCase().includes(q) ||
        (t.material_code || t.item_code || "").toLowerCase().includes(q) ||
        t.material_name.toLowerCase().includes(q) ||
        (t.department || "").toLowerCase().includes(q);

      return matchesStatus && matchesSearch;
    });
  }, [pickupTasks, pickupSearch, pickupStatusFilter]);

  const activeZonesList = useMemo(() => {
    return zones.filter((z) => z.status?.toUpperCase() === "ACTIVE");
  }, [zones]);

  const selectedZoneBins = useMemo(() => {
    if (!zoneScanInput) return [];
    const z = zones.find((item) => item.id === zoneScanInput || item.zone_code === zoneScanInput);
    return (z?.bins || []).filter((b) => b.status?.toUpperCase() === "ACTIVE");
  }, [zones, zoneScanInput]);

  const handleViewZoneQR = async (z: Zone) => {
    setSelectedZoneForQr(z);
    setQrDataUrl(null);
    setQrPayloadData(null);
    setLoadingQr(true);
    setQrModalOpen(true);
    try {
      const qrData = await api.getZoneQR(z.id);
      setQrPayloadData(qrData);
      const dataUrl = await QRCode.toDataURL(qrData.qr_payload || z.id, {
        width: 300,
        margin: 1,
        errorCorrectionLevel: "M",
      });
      setQrDataUrl(dataUrl);
    } catch (err: any) {
      toast.error(err.message || "Failed to generate Zone QR");
    } finally {
      setLoadingQr(false);
    }
  };

  const handleViewBinQR = async (b: Bin, z: Zone) => {
    setSelectedBinForQr(b);
    setSelectedZoneForBinQr(z);
    setBinQrDataUrl(null);
    setLoadingBinQr(true);
    setBinQrModalOpen(true);
    try {
      const qrData = await api.getBinQR(b.id);
      const dataUrl = await QRCode.toDataURL(qrData.qr_payload || b.id, {
        width: 300,
        margin: 1,
        errorCorrectionLevel: "M",
      });
      setBinQrDataUrl(dataUrl);
    } catch (err: any) {
      toast.error(err.message || "Failed to generate Bin QR");
    } finally {
      setLoadingBinQr(false);
    }
  };

  const handleDownloadQR = () => {
    if (!qrDataUrl || !selectedZoneForQr) return;
    const a = document.createElement("a");
    a.href = qrDataUrl;
    a.download = `${selectedZoneForQr.zone_code}_QR_Label.png`;
    a.click();
    toast.success(`Downloaded ${selectedZoneForQr.zone_code} QR code`);
  };

  const handlePrintQR = () => {
    if (!qrDataUrl || !selectedZoneForQr) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      toast.error("Popup blocked. Please allow popups to print QR label.");
      return;
    }
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Zone QR Label · ${selectedZoneForQr.zone_code}</title>
          <style>
            body { font-family: monospace, sans-serif; text-align: center; padding: 24px; }
            .label-box { border: 2px solid #000; padding: 20px; border-radius: 12px; max-width: 320px; margin: 0 auto; }
            .store-name { font-size: 13px; font-weight: bold; color: #444; }
            .zone-code { font-size: 26px; font-weight: 900; margin: 8px 0; letter-spacing: 1px; }
            .zone-name { font-size: 14px; margin-bottom: 12px; font-weight: 600; }
            img { width: 220px; height: 220px; display: block; margin: 0 auto; }
            .meta { font-size: 10px; color: #666; margin-top: 10px; }
          </style>
        </head>
        <body>
          <div class="label-box">
            <div class="store-name">${store?.store_code || "STORE"} · ${store?.store_name || "Store"}</div>
            <div class="zone-code">${selectedZoneForQr.zone_code}</div>
            <div class="zone-name">${selectedZoneForQr.zone_name}</div>
            <img src="${qrDataUrl}" alt="Zone QR Code" />
            <div class="meta">Zone ID: ${selectedZoneForQr.id}<br/>Warehouse: ${store?.warehouse_id || "Main Warehouse"}</div>
          </div>
          <script>
            window.onload = function() { window.print(); window.close(); }
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleDownloadBinQR = () => {
    if (!binQrDataUrl || !selectedBinForQr) return;
    const a = document.createElement("a");
    a.href = binQrDataUrl;
    a.download = `${selectedBinForQr.bin_code}_Bin_QR.png`;
    a.click();
    toast.success(`Downloaded ${selectedBinForQr.bin_code} QR code`);
  };

  const handlePrintBinQR = () => {
    if (!binQrDataUrl || !selectedBinForQr) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      toast.error("Popup blocked. Please allow popups to print QR label.");
      return;
    }
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Bin QR Label · ${selectedBinForQr.bin_code}</title>
          <style>
            body { font-family: monospace, sans-serif; text-align: center; padding: 24px; }
            .label-box { border: 2px solid #000; padding: 20px; border-radius: 12px; max-width: 320px; margin: 0 auto; }
            .store-name { font-size: 13px; font-weight: bold; color: #444; }
            .bin-code { font-size: 24px; font-weight: 900; margin: 8px 0; letter-spacing: 1px; }
            .bin-name { font-size: 14px; margin-bottom: 12px; font-weight: 600; }
            img { width: 220px; height: 220px; display: block; margin: 0 auto; }
            .meta { font-size: 10px; color: #666; margin-top: 10px; }
          </style>
        </head>
        <body>
          <div class="label-box">
            <div class="store-name">${store?.store_code || "STORE"} · ${selectedZoneForBinQr?.zone_code || "ZONE"}</div>
            <div class="bin-code">${selectedBinForQr.bin_code}</div>
            <div class="bin-name">${selectedBinForQr.bin_name} (Rack: ${selectedBinForQr.rack || "-"}, Shelf: ${selectedBinForQr.shelf || "-"})</div>
            <img src="${binQrDataUrl}" alt="Bin QR Code" />
            <div class="meta">Bin ID: ${selectedBinForQr.id}<br/>Capacity: ${selectedBinForQr.capacity} · Status: ${selectedBinForQr.status}</div>
          </div>
          <script>
            window.onload = function() { window.print(); window.close(); }
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  // Putaway Execution Handlers
  const handleStartPutaway = async (task: PutawayTask) => {
    try {
      await api.startPutaway(task.id);
      toast.success("Putaway task started. Ready for physical QR scanning.");
      refreshTasksAndBalances();
      handleOpenExecuteModal(task);
    } catch (err: any) {
      toast.error(err.message || "Failed to start putaway task");
    }
  };

  const handleOpenExecuteModal = (task: PutawayTask) => {
    setExecutingTask(task);
    setMatScanInput("");
    setZoneScanInput(task.destination_zone_id || activeZonesList[0]?.id || "");
    setBinScanInput(task.destination_bin_id || "");
    setConfirmedQty(String(task.quantity));
    setVerifiedHU(null);
    setExecuteModalOpen(true);
  };

  const handleVerifyMaterial = async () => {
    if (!matScanInput.trim() || !executingTask) {
      toast.error("Scan or enter Material QR / code");
      return;
    }
    setVerifyingMat(true);
    try {
      let unit: any;
      try {
        unit = await api.getHandlingUnit(matScanInput.trim());
      } catch {
        // GRN batch labels are not handling-unit labels. Resolve them through
        // the GRN QR endpoint so one scanned batch cannot default to the
        // aggregate putaway-task quantity.
        unit = await api.resolveGrnQr(matScanInput.trim());
      }
      setVerifiedHU(unit);
      const scannedBatchQty = Number(
        unit.available_quantity ?? unit.batch_quantity ?? unit.quantity,
      );
      if (Number.isFinite(scannedBatchQty) && scannedBatchQty > 0) {
        setConfirmedQty(String(scannedBatchQty));
      }
      toast.success(`Material verified: ${unit.material_name} (${unit.item_code})`);
    } catch (err: any) {
      if (matScanInput.trim().toUpperCase() === executingTask.item_code.toUpperCase()) {
        setVerifiedHU({
          item_code: executingTask.item_code,
          material_name: executingTask.material_name,
          quantity: executingTask.quantity,
          uom: executingTask.uom,
          grn_number: executingTask.grn_number,
        });
        toast.success(`Material code verified: ${executingTask.item_code}`);
      } else {
        setVerifiedHU(null);
        toast.error("Material verification failed", {
          description: err.message || "Scanned QR does not match task material.",
        });
      }
    } finally {
      setVerifyingMat(false);
    }
  };

  const handleConfirmPutawaySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!executingTask) return;
    if (!matScanInput.trim()) {
      toast.error("Scan or enter Material QR code");
      return;
    }
    const locationScanTarget = binScanInput.trim() || zoneScanInput.trim();
    if (!locationScanTarget) {
      toast.error("Scan or select Destination Location (Zone/Bin)");
      return;
    }
    const qty = Number(confirmedQty);
    if (isNaN(qty) || qty <= 0) {
      toast.error("Quantity must be greater than zero");
      return;
    }
    if (qty > executingTask.quantity) {
      toast.error(
        `Quantity cannot exceed task remaining quantity (${executingTask.quantity} ${executingTask.uom})`,
      );
      return;
    }

    setConfirmingPutaway(true);
    try {
      const result = await api.completePutaway(executingTask.id, {
        material_scan: matScanInput.trim(),
        location_scan: locationScanTarget,
        quantity: qty,
      });
      toast.success("Physical Putaway Confirmed & Stored!", {
        description: `${qty.toLocaleString()} ${executingTask.uom} of ${executingTask.material_name} is now available in store inventory.`,
      });
      setExecuteModalOpen(false);
      refreshTasksAndBalances();
    } catch (err: any) {
      toast.error(err.message || "Putaway confirmation failed");
    } finally {
      setConfirmingPutaway(false);
    }
  };

  const handleOpenExecutePickup = (task: PickupTask) => {
    setExecutingPickupTask(task);
    setPickupMatScan(task.material_code || task.item_code || "");
    const defaultZone = activeZonesList[0]?.id || "";
    setPickupZoneScan(defaultZone);
    const remQty = Math.max(
      0,
      Number(task.requested_quantity || task.quantity_requested || 0) -
        Number(task.picked_quantity || task.quantity_picked || 0),
    );
    setPickupQty(String(remQty || task.requested_quantity || task.quantity_requested || ""));
    setExecutePickupModalOpen(true);
  };

  const handleConfirmPickupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!executingPickupTask) return;

    if (!pickupMatScan.trim()) {
      toast.error("Please provide or scan Material QR / Item Code");
      return;
    }

    if (!pickupZoneScan.trim()) {
      toast.error("Please scan or select a valid Store Zone");
      return;
    }

    const qtyNum = parseFloat(pickupQty);
    if (isNaN(qtyNum) || qtyNum <= 0) {
      toast.error("Please enter a valid positive quantity");
      return;
    }

    setConfirmingPickup(true);
    try {
      await api.completePickupTask(executingPickupTask.id, {
        material_scan: pickupMatScan.trim(),
        zone_scan: pickupZoneScan.trim(),
        quantity: qtyNum,
      });

      toast.success(
        `Pickup Task ${executingPickupTask.task_number} completed! ${qtyNum} ${executingPickupTask.uom} issued to ${executingPickupTask.department}.`,
      );
      setExecutePickupModalOpen(false);
      setExecutingPickupTask(null);
      fetchStoreData();
    } catch (err: any) {
      toast.error(err.message || "Failed to complete pickup task");
    } finally {
      setConfirmingPickup(false);
    }
  };

  // Takeaway Handlers
  const handleFetchBinMaterials = async (binTarget: string) => {
    const clean = binTarget.trim();
    if (!clean) {
      toast.error("Please scan or enter a Bin Code / Bin ID");
      return;
    }
    setTakeawayLoadingMaterials(true);
    try {
      const res = await api.getBinMaterials(clean);
      setTakeawayScannedBinCode(res.bin_code);
      setTakeawayBinMaterials(res.materials || []);
      setTakeawaySelectedMaterial(null);
      setTakeawayQuantity("");
      if (!res.materials || res.materials.length === 0) {
        toast.info(`Bin ${res.bin_code} is currently empty.`);
      } else {
        toast.success(`Found ${res.materials.length} material(s) in Bin ${res.bin_code}`);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to load materials in this bin");
      setTakeawayBinMaterials([]);
    } finally {
      setTakeawayLoadingMaterials(false);
    }
  };

  const handleTakeawaySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!takeawayScannedBinCode && !takeawayBinInput) {
      toast.error("Please scan or select a Bin first");
      return;
    }
    if (!takeawaySelectedMaterial) {
      toast.error("Please select a material to take away");
      return;
    }
    const qty = parseFloat(takeawayQuantity);
    if (isNaN(qty) || qty <= 0) {
      toast.error("Please enter a valid positive quantity");
      return;
    }
    if (qty > takeawaySelectedMaterial.available_quantity) {
      toast.error(
        `Quantity cannot exceed available stock (${takeawaySelectedMaterial.available_quantity} ${takeawaySelectedMaterial.uom})`,
      );
      return;
    }

    setTakeawayExecuting(true);
    try {
      const res = await api.performTakeaway({
        bin_scan: takeawayScannedBinCode || takeawayBinInput.trim(),
        material_scan:
          takeawaySelectedMaterial.material_qr || takeawaySelectedMaterial.material_code,
        quantity: qty,
        remarks: takeawayRemarks.trim() || undefined,
        reference_document: takeawayRefDoc.trim() || undefined,
      });
      toast.success("Takeaway Completed Successfully!", {
        description: `Dispatched ${qty} ${takeawaySelectedMaterial.uom} of ${takeawaySelectedMaterial.material_name}. Remaining in Bin: ${res.remaining_bin_quantity}.`,
      });
      setTakeawayQuantity("");
      setTakeawayRemarks("");
      setTakeawayRefDoc("");
      // Refresh bin materials and inventory balances
      await Promise.all([
        handleFetchBinMaterials(takeawayScannedBinCode || takeawayBinInput.trim()),
        refreshTasksAndBalances(),
      ]);
    } catch (err: any) {
      toast.error("Takeaway failed", {
        description: err.message || "Could not process takeaway.",
      });
    } finally {
      setTakeawayExecuting(false);
    }
  };

  // Movement History Handlers
  const fetchMovementHistory = async () => {
    setMovementHistoryLoading(true);
    try {
      const mType = movementHistoryTypeFilter === "ALL" ? undefined : movementHistoryTypeFilter;
      const data = await api.getMovementHistory({
        movement_type: mType,
        limit: 100,
      });
      setMovementHistory(data || []);
    } catch (err: any) {
      toast.error("Failed to load movement history", {
        description: err.message || undefined,
      });
    } finally {
      setMovementHistoryLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === "history") {
      void fetchMovementHistory();
    }
  }, [activeTab, movementHistoryTypeFilter]);

  const filteredMovementHistory = useMemo(() => {
    return movementHistory.filter((m) => {
      const q = movementHistorySearch.toLowerCase().trim();
      if (!q) return true;
      return (
        m.material_code?.toLowerCase().includes(q) ||
        m.material_name?.toLowerCase().includes(q) ||
        m.material_qr?.toLowerCase().includes(q) ||
        m.from_location?.toLowerCase().includes(q) ||
        m.to_location?.toLowerCase().includes(q) ||
        m.movement_type?.toLowerCase().includes(q) ||
        m.created_by?.toLowerCase().includes(q) ||
        m.reference_document?.toLowerCase().includes(q)
      );
    });
  }, [movementHistory, movementHistorySearch]);

  return (
    <AppShell
      title="Store Management & Putaway Portal"
      subtitle={`Authenticated as ${mounted ? user?.username || "Store Keeper" : "Store Keeper"} · Scoped to ${store?.store_name || "Store"}`}
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={fetchStoreData}
          disabled={loading}
          className="rounded-xl border-border/40"
        >
          <RefreshCw className={cn("size-3.5 mr-1.5", loading && "animate-spin")} /> Refresh
        </Button>
      }
    >
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
          <Loader2 className="size-8 animate-spin text-primary" />
          <p className="text-sm">Fetching your assigned store profile...</p>
        </div>
      ) : error || !store ? (
        <Card className="border-border/40 max-w-xl mx-auto mt-8 shadow-soft">
          <CardContent className="p-8 text-center flex flex-col items-center gap-4">
            <div className="size-14 rounded-2xl bg-amber-500/10 text-amber-500 flex items-center justify-center">
              <AlertTriangle className="size-7" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-foreground">No Store Assigned</h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-md">
                {error ||
                  "Your user account is not currently linked to an active Store. Please contact the Warehouse Administrator to assign your store profile."}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchStoreData}
              className="rounded-xl text-xs mt-2"
            >
              <RefreshCw className="size-3.5 mr-1.5" /> Retry Sync
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Store Hero Banner */}
          <Card className="border-border/40 bg-gradient-to-r from-primary/10 via-card to-card shadow-soft overflow-hidden">
            <CardContent className="p-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="flex items-start gap-4">
                  <div className="size-16 rounded-2xl bg-primary/20 text-primary flex items-center justify-center font-extrabold text-xl shadow-inner shrink-0">
                    <Building2 className="size-8" />
                  </div>
                  <div>
                    <div className="flex items-center gap-3">
                      <h2 className="text-2xl font-black tracking-tight text-foreground">
                        {store.store_name}
                      </h2>
                      <span className="font-mono text-xs px-2.5 py-1 rounded-lg bg-primary/15 text-primary font-bold border border-primary/20">
                        {store.store_code}
                      </span>
                      <StatusBadge status={isStoreActive ? "OPERATIONAL" : store.status || "Inactive"} />
                    </div>
                    <p className="text-xs text-muted-foreground mt-2 max-w-2xl leading-relaxed">
                      {store.description ||
                        "Designated organizational storage facility for specialized inventory and controlled unit access."}
                    </p>
                  </div>
                </div>

                <div className="bg-card/80 border border-border/40 p-4 rounded-xl shrink-0 min-w-48 shadow-soft">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Store Authority
                  </p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <div className="size-7 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-bold">
                      {store.store_manager_name ? store.store_manager_name.charAt(0) : "S"}
                    </div>
                    <div>
                      <p className="text-xs font-bold text-foreground">
                        {store.store_manager_name || user?.username || "Store Keeper"}
                      </p>
                      <p className="text-[10px] font-mono text-muted-foreground">
                        {store.store_manager_id || "EMP-STORE"} · {store.warehouse_id}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Active At-Dock Inbound Delivery Notification Banner */}
          {occupiedDocks.length > 0 && occupiedDocks[0] && (
            <div className="rounded-2xl border border-rose-200 dark:border-rose-900/60 bg-gradient-to-r from-rose-50/80 via-card to-card dark:from-rose-950/30 p-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 animate-in fade-in duration-200">
              <div className="flex items-start gap-3.5">
                <div className="size-10 rounded-xl bg-rose-500 text-white flex items-center justify-center shrink-0 shadow-sm mt-0.5">
                  <Truck className="size-5 animate-pulse" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-rose-950 dark:text-rose-200 text-sm">
                      {occupiedDocks.length === 1
                        ? `Vehicle At Dock: ${occupiedDocks[0].dock_code} (${occupiedDocks[0].dock_name})`
                        : `${occupiedDocks.length} Docks Currently Occupied for Offloading`}
                    </span>
                    <span className="rounded-full bg-rose-500/20 text-rose-700 dark:text-rose-300 text-[10px] font-black px-2 py-0.5 uppercase tracking-wider">
                      AT DOCK
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {occupiedDocks.length === 1 ? (
                      <>
                        Vehicle{" "}
                        <strong className="font-mono text-foreground">
                          {occupiedDocks[0].current_allocation?.vehicle_number || "Incoming"}
                        </strong>{" "}
                        (Pass:{" "}
                        <strong className="font-mono text-foreground">
                          {occupiedDocks[0].current_allocation?.existing_gate_pass_id || "N/A"}
                        </strong>
                        ) is currently docked with{" "}
                        {occupiedDocks[0].current_allocation?.material_reference || "materials"} for{" "}
                        {store.store_name}. Once offloaded, release the dock to free it for incoming
                        shipments.
                      </>
                    ) : (
                      <>
                        Docks {occupiedDocks.map((d) => d.dock_code).join(", ")} are currently
                        offloading goods for {store.store_name}. Release docks once receiving is
                        complete.
                      </>
                    )}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 self-end md:self-center shrink-0">
                {occupiedDocks.length === 1 && occupiedDocks[0] ? (
                  <Button
                    size="sm"
                    className="rounded-xl bg-[#ef4444] hover:bg-red-600 text-white font-bold text-xs shadow-sm"
                    onClick={() => setReleaseConfirmDock(occupiedDocks[0]!)}
                  >
                    <LogOut className="size-3.5 mr-1.5" /> Release Dock {occupiedDocks[0].dock_code}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-xl border-rose-300 text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:text-rose-300 text-xs font-semibold"
                    onClick={() => setActiveTab("docks")}
                  >
                    View All Assigned Docks ({occupiedDocks.length})
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Navigation Tabs */}
          <div className="flex flex-nowrap items-center gap-2 overflow-x-auto border-b border-border/40 pb-3">
            <Button
              variant={activeTab === "overview" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTab("overview")}
              className="rounded-xl text-xs font-bold gap-2 shadow-xs whitespace-nowrap shrink-0"
            >
              <LayoutDashboard className="size-4" />
              Store Dashboard
            </Button>

            <Button
              variant={activeTab === "putaway" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTab("putaway")}
              className="rounded-xl text-xs font-semibold gap-2 whitespace-nowrap shrink-0"
            >
              <PackageCheck className="size-4" />
              Inbound Putaway Tasks
              <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-primary/20 text-primary font-bold">
                {putawayTasks.filter((t) => t.status !== "PUTAWAY_COMPLETED").length}
              </span>
            </Button>

            <Button
              variant={activeTab === "pickup" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTab("pickup")}
              className="rounded-xl text-xs font-semibold gap-2 whitespace-nowrap shrink-0"
            >
              <ClipboardList className="size-4" />
              Outbound Pickup Tasks
              <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-primary/20 text-primary font-bold">
                {pickupTasks.filter((t) => t.status !== "COMPLETED").length}
              </span>
            </Button>

            <Button
              variant={activeTab === "takeaway" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTab("takeaway")}
              className="rounded-xl text-xs font-semibold gap-2 whitespace-nowrap shrink-0"
            >
              <Send className="size-4" />
              Takeaway (Outbound Dispatch)
            </Button>

            <Button
              variant={activeTab === "history" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTab("history")}
              className="rounded-xl text-xs font-semibold gap-2 whitespace-nowrap shrink-0"
            >
              <History className="size-4" />
              Movement History
            </Button>

            <Button
              variant={activeTab === "zones" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTab("zones")}
              className="rounded-xl text-xs font-semibold gap-2 whitespace-nowrap shrink-0"
            >
              <Layers className="size-4" />
              Zones & Bins ({zones.length})
            </Button>

            <Button
              variant={activeTab === "inventory" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTab("inventory")}
              className="rounded-xl text-xs font-semibold gap-2 whitespace-nowrap shrink-0"
            >
              <Boxes className="size-4" />
              Store Inventory Balances ({inventoryBalances.length})
            </Button>

            <Button
              variant={activeTab === "docks" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTab("docks")}
              className={cn(
                "rounded-xl text-xs font-semibold gap-2 whitespace-nowrap shrink-0",
                occupiedDocks.length > 0 &&
                  activeTab !== "docks" &&
                  "border-rose-300 dark:border-rose-800 text-rose-600 dark:text-rose-400",
              )}
            >
              <Truck className="size-4" />
              Assigned Docks & Release
              {occupiedDocks.length > 0 ? (
                <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-[#ef4444] text-white font-black shadow-2xs animate-pulse">
                  {occupiedDocks.length} AT DOCK
                </span>
              ) : (
                <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-primary/20 text-primary font-bold">
                  {assignedStoreDocks.length}
                </span>
              )}
            </Button>
          </div>

          {/* TAB 0: STORE DASHBOARD & INVENTORY OVERVIEW */}
          {activeTab === "overview" && (
            <div className="space-y-6">
              {/* 8 Store Inventory & Operations KPI Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
                <Card
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setActiveTab("inventory");
                    setOverviewSearch("");
                  }}
                  onKeyDown={(event) =>
                    activateCardOnKey(event, () => {
                      setActiveTab("inventory");
                      setOverviewSearch("");
                    })
                  }
                  className="border-border/40 bg-card/70 shadow-2xs hover:border-primary/40 transition-colors cursor-pointer"
                >
                  <CardContent className="p-3.5 space-y-1">
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span className="text-[10px] font-bold uppercase tracking-wider">
                        Total SKUs
                      </span>
                      <Package className="size-3.5 text-primary" />
                    </div>
                    <p className="text-xl font-black tracking-tight text-foreground">
                      {storeMetrics?.kpis?.total_skus ?? inventoryBalances.length}
                    </p>
                    <p className="text-[10px] text-muted-foreground">Distinct items</p>
                  </CardContent>
                </Card>

                <Card
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setActiveTab("inventory");
                    setOverviewSearch("");
                  }}
                  onKeyDown={(event) =>
                    activateCardOnKey(event, () => {
                      setActiveTab("inventory");
                      setOverviewSearch("");
                    })
                  }
                  className="border-border/40 bg-card/70 shadow-2xs hover:border-primary/40 transition-colors cursor-pointer"
                >
                  <CardContent className="p-3.5 space-y-1">
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span className="text-[10px] font-bold uppercase tracking-wider">
                        Total Stored
                      </span>
                      <Boxes className="size-3.5 text-blue-500" />
                    </div>
                    <p className="text-xl font-black tracking-tight text-foreground">
                      {Number(storeMetrics?.kpis?.total_quantity ?? 0).toLocaleString()}
                    </p>
                    <p className="text-[10px] text-muted-foreground">Units in store</p>
                  </CardContent>
                </Card>

                <Card
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setActiveTab("inventory");
                    setOverviewSearch("");
                  }}
                  onKeyDown={(event) =>
                    activateCardOnKey(event, () => {
                      setActiveTab("inventory");
                      setOverviewSearch("");
                    })
                  }
                  className="border-border/40 bg-card/70 shadow-2xs hover:border-emerald-500/40 transition-colors cursor-pointer"
                >
                  <CardContent className="p-3.5 space-y-1">
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                        Available
                      </span>
                      <CheckCircle2 className="size-3.5 text-emerald-500" />
                    </div>
                    <p className="text-xl font-black tracking-tight text-emerald-600 dark:text-emerald-400">
                      {Number(storeMetrics?.kpis?.available_quantity ?? 0).toLocaleString()}
                    </p>
                    <p className="text-[10px] text-muted-foreground">Ready for issue</p>
                  </CardContent>
                </Card>

                <Card
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setActiveTab("inventory");
                    setOverviewSearch("");
                  }}
                  onKeyDown={(event) =>
                    activateCardOnKey(event, () => {
                      setActiveTab("inventory");
                      setOverviewSearch("");
                    })
                  }
                  className="border-border/40 bg-card/70 shadow-2xs hover:border-amber-500/40 transition-colors cursor-pointer"
                >
                  <CardContent className="p-3.5 space-y-1">
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                        Quarantine
                      </span>
                      <ShieldAlert className="size-3.5 text-amber-500" />
                    </div>
                    <p className="text-xl font-black tracking-tight text-amber-600 dark:text-amber-400">
                      {Number(storeMetrics?.kpis?.quarantined_quantity ?? 0).toLocaleString()}
                    </p>
                    <p className="text-[10px] text-muted-foreground">QC hold</p>
                  </CardContent>
                </Card>

                <Card
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setActiveTab("inventory");
                    setOverviewSearch("");
                  }}
                  onKeyDown={(event) =>
                    activateCardOnKey(event, () => {
                      setActiveTab("inventory");
                      setOverviewSearch("");
                    })
                  }
                  className="border-border/40 bg-card/70 shadow-2xs hover:border-rose-500/40 transition-colors cursor-pointer"
                >
                  <CardContent className="p-3.5 space-y-1">
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">
                        Damaged
                      </span>
                      <AlertTriangle className="size-3.5 text-rose-500" />
                    </div>
                    <p className="text-xl font-black tracking-tight text-rose-600 dark:text-rose-400">
                      {Number(storeMetrics?.kpis?.damaged_quantity ?? 0).toLocaleString()}
                    </p>
                    <p className="text-[10px] text-muted-foreground">Vendor claim</p>
                  </CardContent>
                </Card>

                <Card
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setActiveTab("inventory");
                    setOverviewSearch("");
                  }}
                  onKeyDown={(event) =>
                    activateCardOnKey(event, () => {
                      setActiveTab("inventory");
                      setOverviewSearch("");
                    })
                  }
                  className="border-border/40 bg-card/70 shadow-2xs hover:border-orange-500/40 transition-colors cursor-pointer"
                >
                  <CardContent className="p-3.5 space-y-1">
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-orange-600 dark:text-orange-400">
                        Low Stock
                      </span>
                      <TrendingDown className="size-3.5 text-orange-500" />
                    </div>
                    <p className="text-xl font-black tracking-tight text-orange-600 dark:text-orange-400">
                      {storeMetrics?.kpis?.low_stock_count ?? storeMetrics?.kpis?.low_stock_items ?? 0}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {(storeMetrics?.kpis?.low_stock_count ?? storeMetrics?.kpis?.low_stock_items ?? 0) > 0
                        ? "SKUs alert"
                        : "No low-stock SKUs"}
                    </p>
                  </CardContent>
                </Card>

                <Card
                  role="button"
                  tabIndex={0}
                  onClick={() => setActiveTab("zones")}
                  onKeyDown={(event) => activateCardOnKey(event, () => setActiveTab("zones"))}
                  className="border-border/40 bg-card/70 shadow-2xs hover:border-indigo-500/40 transition-colors cursor-pointer"
                >
                  <CardContent className="p-3.5 space-y-1">
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                        Zones
                      </span>
                      <Layers className="size-3.5 text-indigo-500" />
                    </div>
                    <p className="text-xl font-black tracking-tight text-indigo-600 dark:text-indigo-400">
                      {storeMetrics?.kpis?.zones_count ?? zones.length}
                    </p>
                    <p className="text-[10px] text-muted-foreground">Storage zones</p>
                  </CardContent>
                </Card>

                <Card
                  role="button"
                  tabIndex={0}
                  onClick={() => setActiveTab("zones")}
                  onKeyDown={(event) => activateCardOnKey(event, () => setActiveTab("zones"))}
                  className="border-border/40 bg-card/70 shadow-2xs hover:border-cyan-500/40 transition-colors cursor-pointer"
                >
                  <CardContent className="p-3.5 space-y-1">
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-600 dark:text-cyan-400">
                        Bins
                      </span>
                      <Grid className="size-3.5 text-cyan-500" />
                    </div>
                    <p className="text-xl font-black tracking-tight text-cyan-600 dark:text-cyan-400">
                      {storeMetrics?.kpis?.bins_count ?? 0}
                    </p>
                    <p className="text-[10px] text-muted-foreground">QR storage bins</p>
                  </CardContent>
                </Card>
              </div>

              {/* Quick Operation Shortcuts */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <button
                  type="button"
                  onClick={() => setActiveTab("inventory")}
                  className="flex items-center justify-between p-3.5 rounded-2xl border border-border/60 bg-gradient-to-br from-card to-muted/20 hover:border-primary/50 transition-all text-left group shadow-2xs"
                >
                  <div className="flex items-center gap-3">
                    <div className="size-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold group-hover:scale-105 transition-transform">
                      <Boxes className="size-5" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-foreground">View Full Inventory</p>
                      <p className="text-[11px] text-muted-foreground">
                        All stored stock & balances
                      </p>
                    </div>
                  </div>
                  <ArrowUpRight className="size-4 text-muted-foreground group-hover:text-primary transition-colors" />
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab("zones")}
                  className="flex items-center justify-between p-3.5 rounded-2xl border border-border/60 bg-gradient-to-br from-card to-muted/20 hover:border-indigo-500/50 transition-all text-left group shadow-2xs"
                >
                  <div className="flex items-center gap-3">
                    <div className="size-9 rounded-xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center font-bold group-hover:scale-105 transition-transform">
                      <Layers className="size-5" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-foreground">Manage Zones & Bins</p>
                      <p className="text-[11px] text-muted-foreground">
                        {zones.length} Zones · Create & QR
                      </p>
                    </div>
                  </div>
                  <ArrowUpRight className="size-4 text-muted-foreground group-hover:text-indigo-500 transition-colors" />
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab("docks")}
                  className="flex items-center justify-between p-3.5 rounded-2xl border border-border/60 bg-gradient-to-br from-card to-muted/20 hover:border-rose-500/50 transition-all text-left group shadow-2xs"
                >
                  <div className="flex items-center gap-3">
                    <div className="size-9 rounded-xl bg-rose-500/10 text-rose-500 flex items-center justify-center font-bold group-hover:scale-105 transition-transform">
                      <Truck className="size-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <p className="text-xs font-bold text-foreground">Assigned Docks</p>
                        {occupiedDocks.length > 0 && (
                          <span className="size-2 rounded-full bg-rose-500 animate-ping" />
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {occupiedDocks.length > 0
                          ? `${occupiedDocks.length} Active At Dock`
                          : `${assignedStoreDocks.length} Allocated Docks`}
                      </p>
                    </div>
                  </div>
                  <ArrowUpRight className="size-4 text-muted-foreground group-hover:text-rose-500 transition-colors" />
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab("putaway")}
                  className="flex items-center justify-between p-3.5 rounded-2xl border border-border/60 bg-gradient-to-br from-card to-muted/20 hover:border-emerald-500/50 transition-all text-left group shadow-2xs"
                >
                  <div className="flex items-center gap-3">
                    <div className="size-9 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center font-bold group-hover:scale-105 transition-transform">
                      <PackageCheck className="size-5" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-foreground">Inbound Putaway</p>
                      <p className="text-[11px] text-muted-foreground">
                        {putawayTasks.filter((t) => t.status !== "PUTAWAY_COMPLETED").length}{" "}
                        Pending Tasks
                      </p>
                    </div>
                  </div>
                  <ArrowUpRight className="size-4 text-muted-foreground group-hover:text-emerald-500 transition-colors" />
                </button>
              </div>

              {/* Store Inventory Summary & Recent Activity Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Store Inventory Summary (2 Cols) */}
                <Card className="lg:col-span-2 border-border/40 shadow-soft overflow-hidden">
                  <CardHeader className="p-4 border-b border-border/40 bg-card/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                        <Boxes className="size-4" />
                      </div>
                      <div>
                        <CardTitle className="text-sm font-bold">Store Inventory Summary</CardTitle>
                        <CardDescription className="text-xs">
                          Live stock levels in {store.store_name}
                        </CardDescription>
                      </div>
                    </div>

                    <div className="relative w-full sm:w-56">
                      <Search className="size-3.5 absolute left-3 top-2.5 text-muted-foreground" />
                      <Input
                        placeholder="Filter materials..."
                        value={overviewSearch}
                        onChange={(e) => setOverviewSearch(e.target.value)}
                        className="pl-8 pr-8 h-8 text-xs rounded-xl bg-background/50 border-border/40"
                      />
                      {overviewSearch && (
                        <button
                          type="button"
                          onClick={() => setOverviewSearch("")}
                          className="absolute right-2 top-2 text-muted-foreground hover:text-foreground transition-colors"
                          aria-label="Clear material search"
                        >
                          <XCircle className="size-3.5" />
                        </button>
                      )}
                    </div>
                  </CardHeader>

                  <CardContent className="p-0">
                    {metricsLoading ? (
                      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                        <Loader2 className="size-6 animate-spin text-primary" />
                        <p className="text-xs">Loading inventory summary...</p>
                      </div>
                    ) : (storeMetrics?.inventory_summary || storeMetrics?.inventory_items || []).length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2 px-4 text-center">
                        <Boxes className="size-8 text-muted-foreground/40" />
                        <p className="font-semibold text-sm text-foreground">No Stock In Store</p>
                        <p className="text-xs text-muted-foreground max-w-sm">
                          This store has no received inventory yet. Review assigned putaway tasks to
                          bring accepted materials into stock.
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setActiveTab("putaway")}
                          className="mt-2 rounded-xl text-xs"
                        >
                          <PackageCheck className="size-3.5 mr-1.5" /> View Putaway Tasks{" "}
                          <ArrowRight className="size-3.5 ml-1" />
                        </Button>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-muted/30 text-[11px] font-semibold uppercase text-muted-foreground border-b border-border/40">
                            <tr>
                              <th className="py-2.5 px-3">Material</th>
                              <th className="py-2.5 px-3">Category</th>
                              <th className="py-2.5 px-3 text-right">Available</th>
                              <th className="py-2.5 px-3 text-right">Reserved (Assembly)</th>
                              <th className="py-2.5 px-3 text-right">Quarantined</th>
                              <th className="py-2.5 px-3 text-right">Total</th>
                              <th className="py-2.5 px-3 text-center">Locations</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/20">
                            {(storeMetrics?.inventory_summary || storeMetrics?.inventory_items || [])
                              .filter((item) => {
                                if (!overviewSearch.trim()) return true;
                                const q = overviewSearch.toLowerCase().trim();
                                return (
                                  item.material_code.toLowerCase().includes(q) ||
                                  item.material_name.toLowerCase().includes(q) ||
                                  item.category?.toLowerCase().includes(q)
                                );
                              })
                              .map((item) => (
                                <tr
                                  key={item.material_code}
                                  className="hover:bg-muted/10 transition-colors"
                                >
                                  <td className="py-2.5 px-3">
                                    <div className="font-mono font-bold text-primary">
                                      {item.material_code}
                                    </div>
                                    <div className="text-[11px] font-medium text-foreground truncate max-w-[200px]">
                                      {item.material_name}
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-3 text-muted-foreground uppercase text-[10px] font-mono">
                                    {item.category || "GENERAL"}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                    {Number(item.available_quantity).toLocaleString()} {item.uom}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono font-bold text-indigo-600 dark:text-indigo-400">
                                    {Number(item.reserved_quantity ?? 0) > 0 ? (
                                      <span className="bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded-full border border-indigo-500/20 text-[10px]">
                                        🔒 {Number(item.reserved_quantity).toLocaleString()} {item.uom}
                                      </span>
                                    ) : (
                                      <span className="text-muted-foreground font-normal text-[11px]">—</span>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono text-amber-600 dark:text-amber-400">
                                    {Number(item.quarantined_quantity) > 0
                                      ? `${Number(item.quarantined_quantity).toLocaleString()} ${item.uom}`
                                      : "—"}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono font-extrabold text-foreground">
                                    {Number(item.total_quantity ?? item.quantity ?? 0).toLocaleString()} {item.uom}
                                  </td>
                                  <td className="py-2.5 px-3 text-center">
                                    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground border border-border/40">
                                      {item.locations_count}{" "}
                                      {item.locations_count === 1 ? "bin" : "bins"}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Assembly Stock Reservations Card */}
                {(storeMetrics?.assembly_reservations || []).length > 0 && (
                  <Card className="lg:col-span-3 border-indigo-500/30 bg-indigo-500/5 shadow-soft overflow-hidden">
                    <CardHeader className="p-4 border-b border-indigo-500/20 bg-indigo-500/10 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="size-8 rounded-lg bg-indigo-500/20 flex items-center justify-center text-indigo-600 dark:text-indigo-300">
                          <Sparkles className="size-4" />
                        </div>
                        <div>
                          <CardTitle className="text-sm font-bold text-indigo-950 dark:text-indigo-100 flex items-center gap-2">
                            Assembly Stock Reservations
                            <span className="text-[10px] bg-indigo-600 text-white font-black px-2 py-0.5 rounded-full">
                              {(storeMetrics?.assembly_reservations || []).length} Active
                            </span>
                          </CardTitle>
                          <CardDescription className="text-xs text-indigo-700 dark:text-indigo-300">
                            Inventory locked exclusively for Assembly Requisitions — Not available for unrelated issue.
                          </CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-indigo-500/10 text-[11px] font-semibold uppercase text-indigo-900 dark:text-indigo-200 border-b border-indigo-500/20">
                            <tr>
                              <th className="py-2.5 px-3.5">Requisition #</th>
                              <th className="py-2.5 px-3.5">Material</th>
                              <th className="py-2.5 px-3.5 text-right">Required</th>
                              <th className="py-2.5 px-3.5 text-right">Reserved Qty</th>
                              <th className="py-2.5 px-3.5">Status</th>
                              <th className="py-2.5 px-3.5">Store / Location</th>
                              <th className="py-2.5 px-3.5 text-right">Reserved Date</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-indigo-500/10 bg-card/60">
                            {(storeMetrics?.assembly_reservations || []).map((res) => (
                              <tr key={res.id} className="hover:bg-indigo-500/10 transition-colors">
                                <td className="py-2.5 px-3.5 font-mono font-bold text-primary">
                                  {res.requisition_number}
                                </td>
                                <td className="py-2.5 px-3.5">
                                  <div className="font-semibold text-foreground">{res.material_name}</div>
                                  <div className="font-mono text-[10px] text-muted-foreground">{res.material_code}</div>
                                </td>
                                <td className="py-2.5 px-3.5 text-right font-mono text-muted-foreground">
                                  {Number(res.required_quantity)} {res.uom}
                                </td>
                                <td className="py-2.5 px-3.5 text-right font-mono font-bold text-indigo-700 dark:text-indigo-300">
                                  🔒 {Number(res.reserved_quantity)} {res.uom}
                                </td>
                                <td className="py-2.5 px-3.5">
                                  <span className="font-bold text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30 uppercase tracking-wide">
                                    {res.status || "RESERVED FOR ASSEMBLY"}
                                  </span>
                                </td>
                                <td className="py-2.5 px-3.5 text-[11px] text-muted-foreground">
                                  {res.store_name || res.store_code ? (
                                    <span className="font-medium text-foreground">
                                      📍 {res.store_name || res.store_code}
                                      {res.zone_code ? ` · Zone ${res.zone_code}` : ""}
                                      {res.bin_code && res.bin_code !== "DEFAULT" ? ` · Bin ${res.bin_code}` : ""}
                                    </span>
                                  ) : (
                                    <span className="italic opacity-70">Store Inventory</span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3.5 text-right text-[11px] text-muted-foreground">
                                  {res.reserved_at ? new Date(res.reserved_at).toLocaleDateString() : "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Recent Store Activity (1 Col) */}
                <Card className="border-border/40 shadow-soft overflow-hidden">
                  <CardHeader className="p-4 border-b border-border/40 bg-card/40 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="size-8 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-500">
                        <Activity className="size-4" />
                      </div>
                      <div>
                        <CardTitle className="text-sm font-bold">Recent Store Activity</CardTitle>
                        <CardDescription className="text-xs">
                          Inbound & Outbound audit trail
                        </CardDescription>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setActiveTab("history")}
                      className="rounded-xl text-xs font-bold text-primary hover:text-primary"
                    >
                      View All <ArrowRight className="ml-1 size-3.5" />
                    </Button>
                  </CardHeader>

                  <CardContent className="p-3">
                    {(storeMetrics?.recent_activity || []).length === 0 ? (
                      <div className="py-8 text-center text-muted-foreground text-xs">
                        <History className="size-6 mx-auto opacity-40 mb-1" />
                        No recent store movements recorded yet.
                      </div>
                    ) : (
                      <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
                        {(storeMetrics?.recent_activity || []).map((act) => {
                          const isPutaway = act.movement_type === "PUTAWAY";
                          const isTakeaway =
                            act.movement_type === "TAKEAWAY" || act.movement_type === "OUTBOUND";
                          const isPickup =
                            act.movement_type === "PICKUP" || act.movement_type === "ISSUE";

                          return (
                            <div
                              key={act.id}
                              className="p-2.5 rounded-xl border border-border/40 bg-card text-xs space-y-1.5 shadow-2xs hover:border-primary/30 transition-colors"
                            >
                              <div className="flex items-center justify-between gap-1">
                                <span
                                  className={cn(
                                    "font-mono text-[9px] font-extrabold px-2 py-0.5 rounded uppercase",
                                    isPutaway
                                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                                      : isTakeaway
                                        ? "bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/20"
                                        : "bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/20",
                                  )}
                                >
                                  {act.movement_type}
                                </span>
                                <span className="text-[10px] text-muted-foreground">
                                  {act.created_at
                                    ? new Date(act.created_at).toLocaleTimeString([], {
                                        hour: "2-digit",
                                        minute: "2-digit",
                                      })
                                    : "—"}
                                </span>
                              </div>

                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <p className="font-bold text-foreground truncate max-w-[150px]">
                                    {act.material_name}
                                  </p>
                                  <p className="font-mono text-[10px] text-muted-foreground">
                                    {act.material_code}
                                  </p>
                                </div>
                                <span className="font-mono font-bold text-xs text-primary">
                                  {Number(act.quantity).toLocaleString()} {act.uom}
                                </span>
                              </div>

                              <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1 border-t border-border/30">
                                <span className="truncate max-w-[130px]">
                                  {act.destination_location ||
                                    act.source_location ||
                                    "Store Location"}
                                </span>
                                <span>{act.performed_by_name || "Store Keeper"}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

          {/* TAB 1: INBOUND PUTAWAY TASKS */}
          {activeTab === "putaway" && (
            <div className="space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="relative w-72">
                  <Search className="size-3.5 absolute left-3 top-2.5 text-muted-foreground" />
                  <Input
                    placeholder="Search assigned putaway tasks..."
                    value={putawaySearch}
                    onChange={(e) => setPutawaySearch(e.target.value)}
                    className="pl-8 h-8 text-xs rounded-xl bg-background/50 border-border/40"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <Select value={putawayStatusFilter} onValueChange={setPutawayStatusFilter}>
                    <SelectTrigger className="w-36 h-8 text-xs rounded-xl border-border/40">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">All Status</SelectItem>
                      <SelectItem value="ASSIGNED_TO_STORE">Ready to Receive</SelectItem>
                      <SelectItem value="PUTAWAY_IN_PROGRESS">In Progress</SelectItem>
                      <SelectItem value="PUTAWAY_COMPLETED">Completed</SelectItem>
                    </SelectContent>
                  </Select>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={refreshTasksAndBalances}
                    disabled={tasksLoading}
                    className="h-8 rounded-xl text-xs"
                  >
                    <RefreshCw className={cn("size-3.5", tasksLoading && "animate-spin")} />
                  </Button>
                </div>
              </div>

              {tasksLoading ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                  <Loader2 className="size-6 animate-spin text-primary" />
                  <p className="text-xs">Loading store putaway tasks...</p>
                </div>
              ) : filteredPutawayTasks.length === 0 ? (
                <Card className="rounded-2xl p-12 text-center text-muted-foreground border-dashed">
                  <PackageCheck className="size-10 mx-auto text-muted-foreground/40 mb-3" />
                  <p className="font-semibold text-sm text-foreground">No Putaway Tasks</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {putawaySearch || putawayStatusFilter !== "ALL"
                      ? "No tasks match your filter criteria."
                      : "When Warehouse assigns goods from GRN to your store, they will appear here for physical QR scanning and confirmation."}
                  </p>
                </Card>
              ) : (
                <div className="grid gap-4 lg:grid-cols-2">
                  {filteredPutawayTasks.map((task) => {
                    const isPending =
                      task.status === "ASSIGNED_TO_STORE" || task.status === "PUTAWAY_PENDING";
                    const isInProgress = task.status === "PUTAWAY_IN_PROGRESS";
                    const isCompleted = task.status === "PUTAWAY_COMPLETED";

                    return (
                      <Card key={task.id} className="rounded-2xl p-5 shadow-sm border bg-card">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                              Store Putaway Order
                            </p>
                            <h3 className="font-mono text-base font-bold text-primary">
                              {task.task_number}
                            </h3>
                            <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                              GRN:{" "}
                              <span className="font-semibold text-foreground">
                                {task.grn_number}
                              </span>
                            </p>
                          </div>
                          <StatusBadge status={task.status} />
                        </div>

                        <div className="my-3.5 rounded-xl border bg-muted/20 p-3.5">
                          <div className="flex items-start justify-between">
                            <div>
                              <p className="font-bold text-foreground">{task.material_name}</p>
                              <p className="font-mono text-xs text-muted-foreground">
                                {task.item_code}
                              </p>
                            </div>
                            <p className="text-right text-lg font-black text-primary">
                              {task.quantity.toLocaleString()}{" "}
                              <span className="text-xs font-normal text-muted-foreground">
                                {task.uom}
                              </span>
                            </p>
                          </div>
                        </div>

                        <div className="grid items-center gap-3 sm:grid-cols-[1fr_auto_1fr] text-xs">
                          <div className="rounded-xl border bg-muted/10 p-2.5">
                            <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                              Source
                            </p>
                            <p className="font-mono font-semibold text-foreground truncate mt-0.5">
                              {task.source_location}
                            </p>
                          </div>
                          <ArrowRight className="mx-auto size-4 text-primary shrink-0" />
                          <div className="rounded-xl border bg-muted/10 p-2.5">
                            <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                              Assigned Location
                            </p>
                            <p className="font-mono font-semibold text-foreground truncate mt-0.5">
                              {task.destination_bin_code ||
                                task.destination_zone ||
                                "Store Keeper Choice"}
                            </p>
                          </div>
                        </div>

                        {/* Actions based on task status */}
                        {isPending && (
                          <div className="mt-4 flex items-center justify-between gap-3 pt-3 border-t">
                            <p className="text-[11px] text-amber-700 dark:text-amber-400 font-medium flex items-center gap-1">
                              <Clock className="size-3.5" /> Assigned to your store
                            </p>
                            <Button
                              size="sm"
                              className="rounded-xl gap-1.5 shadow-glow text-xs"
                              onClick={() => handleStartPutaway(task)}
                            >
                              <Play className="size-3.5" /> Start Putaway
                            </Button>
                          </div>
                        )}

                        {isInProgress && (
                          <div className="mt-4 flex items-center justify-between gap-3 pt-3 border-t">
                            <p className="text-[11px] text-purple-700 dark:text-purple-400 font-medium flex items-center gap-1">
                              <ScanLine className="size-3.5 animate-pulse" /> Ready to scan QR codes
                            </p>
                            <Button
                              size="sm"
                              className="rounded-xl gap-1.5 shadow-glow text-xs bg-purple-600 hover:bg-purple-700 text-white"
                              onClick={() => handleOpenExecuteModal(task)}
                            >
                              <ScanLine className="size-3.5" /> Scan QR & Confirm
                            </Button>
                          </div>
                        )}

                        {isCompleted && (
                          <div className="mt-4 rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-400">
                            <p className="font-bold flex items-center gap-1.5">
                              <CheckCircle2 className="size-3.5 text-emerald-600" /> Stored in{" "}
                              {task.destination_bin_code || task.destination_zone || "Bin/Zone"}
                            </p>
                            <p className="text-[11px] mt-0.5 text-muted-foreground">
                              Confirmed by {task.completed_by} ·{" "}
                              {task.completed_at
                                ? new Date(task.completed_at).toLocaleString()
                                : ""}
                            </p>
                          </div>
                        )}
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: STORE ZONES & BINS */}
          {activeTab === "zones" && (
            <Card className="border-border/40 shadow-soft overflow-hidden">
              <CardHeader className="p-4 border-b border-border/40 bg-card/40 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                    <Layers className="size-4" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-bold">
                      Store Zones & Bins ({zones.length} zones)
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Physical layout: Store → Zones → Bins for organizing physical racks, shelves,
                      and storage bays.
                    </CardDescription>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="relative w-56">
                    <Search className="size-3.5 absolute left-3 top-2.5 text-muted-foreground" />
                    <Input
                      placeholder="Search zones & bins..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="pl-8 h-8 text-xs rounded-xl bg-background/50 border-border/40"
                    />
                  </div>

                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-28 h-8 text-xs rounded-xl border-border/40">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">All Status</SelectItem>
                      <SelectItem value="ACTIVE">Active</SelectItem>
                      <SelectItem value="INACTIVE">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>

              <CardContent className="p-0">
                {zonesLoading ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                    <Loader2 className="size-6 animate-spin text-primary" />
                    <p className="text-xs">Loading zones and bins...</p>
                  </div>
                ) : filteredZones.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                    <Layers className="size-8 text-muted-foreground/40" />
                    <p className="font-semibold text-sm text-foreground">No zones configured</p>
                    <p className="text-xs text-muted-foreground">
                      {search || statusFilter !== "ALL"
                        ? "No zones match your search filter"
                        : "No storage zones assigned to this store"}
                    </p>
                  </div>
                ) : (
                  <div className="p-4 space-y-3">
                    {filteredZones.map((z) => {
                      const isZoneExpanded = expandedZoneIds.has(z.id);
                      const binsInZone = z.bins || [];

                      return (
                        <div
                          key={z.id}
                          className="rounded-xl border border-border/50 bg-card/60 overflow-hidden shadow-subtle"
                        >
                          <div className="flex items-center justify-between p-3 bg-muted/20 hover:bg-muted/30 transition-colors">
                            <div className="flex items-center gap-3">
                              <button
                                type="button"
                                onClick={() => toggleExpandZone(z.id)}
                                className="p-1 rounded-md hover:bg-muted/60 text-muted-foreground"
                              >
                                {isZoneExpanded ? (
                                  <ChevronDown className="size-4 text-indigo-400" />
                                ) : (
                                  <ChevronRight className="size-4" />
                                )}
                              </button>
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-mono font-bold text-xs text-indigo-400">
                                    {z.zone_code}
                                  </span>
                                  <span className="font-semibold text-xs text-foreground">
                                    {z.zone_name}
                                  </span>
                                  <span className="font-mono text-[10px] text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded">
                                    {binsInZone.length} {binsInZone.length === 1 ? "bin" : "bins"}
                                  </span>
                                </div>
                                {z.description && (
                                  <p className="text-[11px] text-muted-foreground mt-0.5">
                                    {z.description}
                                  </p>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5">
                              <StatusBadge
                                status={z.status?.toUpperCase() === "ACTIVE" ? "PASS" : "REJECTED"}
                              />
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleViewZoneQR(z)}
                                className="h-7 px-2 rounded-lg text-xs bg-primary/5 text-primary hover:bg-primary/15"
                              >
                                <QrCode className="size-3 mr-1" /> Zone QR
                              </Button>
                            </div>
                          </div>

                          {/* Nested Bins */}
                          {isZoneExpanded && (
                            <div className="p-3 pl-8 border-t border-border/40 bg-muted/10 space-y-2">
                              <div className="flex items-center justify-between text-[11px] text-muted-foreground font-semibold">
                                <div className="flex items-center gap-1.5">
                                  <Grid className="size-3.5 text-emerald-400" />
                                  <span>Physical Bins in {z.zone_code}</span>
                                </div>
                              </div>

                              {binsInZone.length > 0 ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 pt-1">
                                  {binsInZone.map((b) => (
                                    <div
                                      key={b.id}
                                      className="flex items-start justify-between p-2.5 rounded-lg border bg-card/80 text-xs hover:border-emerald-500/30 transition-colors shadow-subtle"
                                    >
                                      <div className="space-y-1">
                                        <div className="flex items-center gap-1.5">
                                          <span className="font-mono font-bold text-emerald-400">
                                            {b.bin_code}
                                          </span>
                                          <span className="text-[11px] font-medium text-foreground">
                                            {b.bin_name}
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
                                          <span>Rack: {b.rack || "-"}</span>
                                          <span>Shelf: {b.shelf || "-"}</span>
                                          <span>Cap: {b.capacity}</span>
                                        </div>
                                      </div>
                                      <div className="flex flex-col items-end gap-1">
                                        <StatusBadge status={b.status} />
                                        <div className="flex items-center gap-1">
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleViewBinQR(b, z)}
                                            className="h-6 px-1.5 text-[10px] rounded text-primary hover:bg-primary/10"
                                            title="View Bin QR Label"
                                          >
                                            <QrCode className="size-3 mr-0.5" /> Bin QR
                                          </Button>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-xs text-muted-foreground italic py-2">
                                  No bins configured in this zone.
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* TAB 3: LIVE STORE INVENTORY */}
          {activeTab === "inventory" && (
            <Card className="border-border/40 shadow-soft overflow-hidden">
              <CardHeader className="p-4 border-b border-border/40 bg-card/40 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                    <Boxes className="size-4" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-bold">
                      Physical Stock Balances ({inventoryBalances.length})
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Materials confirmed and stored inside {store.store_name} across all zones and
                      bins.
                    </CardDescription>
                  </div>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={refreshTasksAndBalances}
                  className="h-8 rounded-xl text-xs gap-1.5"
                >
                  <RefreshCw className="size-3" /> Refresh Balances
                </Button>
              </CardHeader>

              <CardContent className="p-0">
                {inventoryBalances.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2 px-4 text-center">
                    <Boxes className="size-8 text-muted-foreground/40" />
                    <p className="font-semibold text-sm text-foreground">No Material Stored Yet</p>
                    <p className="text-xs text-muted-foreground max-w-md">
                      No physical stock has been confirmed for this store. Start with assigned
                      putaway tasks to scan materials into zones and bins.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setActiveTab("putaway")}
                      className="mt-2 rounded-xl text-xs"
                    >
                      <PackageCheck className="size-3.5 mr-1.5" /> View Putaway Tasks{" "}
                      <ArrowRight className="size-3.5 ml-1" />
                    </Button>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-muted/30 text-xs font-semibold uppercase text-muted-foreground border-b border-border/40">
                        <tr>
                          <th className="py-3 px-4">Material Code</th>
                          <th className="py-3 px-4">Material Name</th>
                          <th className="py-3 px-4">Location / Zone</th>
                          <th className="py-3 px-4 text-right">Available Stock</th>
                          <th className="py-3 px-4 text-right">Last GRN</th>
                          <th className="py-3 px-4 text-right">Updated At</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/20">
                        {inventoryBalances.map((bal, idx) => (
                          <tr
                            key={bal.id || `${bal.material_code}-${bal.location_code}-${idx}`}
                            className="hover:bg-muted/10 transition-colors"
                          >
                            <td className="py-3 px-4 font-mono font-bold text-xs text-primary">
                              {bal.material_code}
                            </td>
                            <td className="py-3 px-4">
                              <div className="font-semibold text-xs text-foreground">
                                {bal.material_name}
                              </div>
                              <div className="text-[10px] text-muted-foreground">
                                {bal.category || "GENERAL"}
                              </div>
                            </td>
                            <td className="py-3 px-4 font-mono text-xs">
                              <span className="bg-muted/40 px-2 py-0.5 rounded border border-border/40">
                                {bal.location_code || bal.zone_code || "STORE"}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right font-mono font-bold text-xs text-emerald-600">
                              {bal.available_quantity.toLocaleString()} {bal.uom}
                            </td>
                            <td className="py-3 px-4 text-right font-mono text-xs text-muted-foreground">
                              {bal.last_grn_number || "—"}
                            </td>
                            <td className="py-3 px-4 text-right text-[11px] text-muted-foreground">
                              {bal.updated_at ? new Date(bal.updated_at).toLocaleString() : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* TAB 5: ASSIGNED DOCKS & DOCK RELEASE */}
          {activeTab === "docks" && (
            <div className="space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                    <Truck className="size-4 text-primary" /> Incoming & Assigned Docks (
                    {assignedStoreDocks.length})
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Docks currently allocated for inbound shipments destined for {store?.store_name}{" "}
                    ({store?.store_code}).
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={refreshDocks}
                    disabled={docksLoading}
                    className="h-8 rounded-xl text-xs gap-1.5"
                    title="Refresh Docks"
                  >
                    <RefreshCw className={cn("size-3.5", docksLoading && "animate-spin")} />
                    Refresh
                  </Button>
                </div>
              </div>

              {docksLoading ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                  <Loader2 className="size-6 animate-spin text-primary" />
                  <p className="text-xs">Loading dock allocations assigned to your store...</p>
                </div>
              ) : filteredAssignedDocks.length === 0 ? (
                <Card className="rounded-2xl p-12 text-center text-muted-foreground border-dashed">
                  <Truck className="size-10 mx-auto text-muted-foreground/40 mb-3" />
                  <p className="font-semibold text-sm text-foreground">
                    No Dock Currently Assigned
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
                    There are currently no inbound trucks or docks allocated to {store?.store_name}{" "}
                    ({store?.store_code}). When the Warehouse Manager allocates a dock for incoming
                    shipments to your store, it will appear here for unloading and dock release.
                  </p>
                </Card>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {filteredAssignedDocks.map((dock) => {
                    const isOccupied = dock.status === "OCCUPIED" || dock.status === "RESERVED";
                    const isReleased =
                      dock.status === "RELEASED" || dock.current_allocation?.status === "RELEASED";
                    const alloc = dock.current_allocation;

                    return (
                      <Card
                        key={dock.id}
                        className={cn(
                          "rounded-2xl p-5 shadow-sm border transition-all duration-200 bg-card flex flex-col justify-between",
                          isOccupied
                            ? "border-rose-300/80 dark:border-rose-900/60 ring-1 ring-rose-400/20"
                            : isReleased
                              ? "border-slate-300 dark:border-slate-800"
                              : "border-emerald-300/60 dark:border-emerald-900/40",
                        )}
                      >
                        <div className="space-y-4">
                          {/* Card Header */}
                          <div className="flex items-start justify-between gap-2 border-b border-border/40 pb-3">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xl font-black tracking-tight text-foreground">
                                  {dock.dock_code}
                                </span>
                                <span className="font-mono text-[9px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-muted-foreground uppercase">
                                  {dock.dock_type.replace(/_/g, " ")}
                                </span>
                              </div>
                              <p className="text-xs font-semibold text-foreground/90 mt-0.5">
                                {dock.dock_name}
                              </p>
                              {dock.location && (
                                <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                                  <MapPin className="size-3 shrink-0" />
                                  <span>{dock.location}</span>
                                </p>
                              )}
                            </div>

                            <span
                              className={cn(
                                "rounded-full px-2.5 py-0.5 text-[10px] font-extrabold tracking-wider border shrink-0 flex items-center gap-1.5",
                                isReleased
                                  ? "bg-slate-100 text-slate-700 border-slate-200"
                                  : isOccupied
                                    ? "bg-[#ffe4e6] text-[#e11d48] border-[#fecdd3]"
                                    : "bg-[#dcfce7] text-[#15803d] border-[#bbf7d0]",
                              )}
                            >
                              {isOccupied && (
                                <span className="size-1.5 rounded-full bg-[#e11d48] animate-ping" />
                              )}
                              {isReleased ? "RELEASED" : isOccupied ? "ALLOCATED" : dock.status}
                            </span>
                          </div>

                          {/* Allocation Details / Vehicle Box */}
                          {alloc ? (
                            <div className="rounded-xl border border-rose-200/60 dark:border-rose-900/40 bg-rose-50/50 dark:bg-rose-950/20 p-3 space-y-2 text-xs">
                              <div className="flex items-center justify-between font-mono">
                                <span className="text-[10px] uppercase font-bold text-rose-800/80 dark:text-rose-300">
                                  Inbound Vehicle
                                </span>
                                <span className="font-black text-rose-700 dark:text-rose-400">
                                  {alloc.vehicle_number}
                                </span>
                              </div>

                              <div className="grid grid-cols-2 gap-2 text-[11px] border-t border-rose-200/50 dark:border-rose-900/30 pt-2">
                                <div>
                                  <span className="text-muted-foreground block text-[10px]">
                                    Gate Entry
                                  </span>
                                  <span className="font-mono font-bold text-foreground truncate block">
                                    {alloc.existing_gate_pass_id || "—"}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground block text-[10px]">
                                    Destination Store
                                  </span>
                                  <span className="font-semibold text-foreground truncate block">
                                    {store?.store_name} ({store?.store_code})
                                  </span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground block text-[10px]">
                                    Vendor
                                  </span>
                                  <span
                                    className="font-semibold text-foreground truncate block"
                                    title={alloc.vendor_reference || ""}
                                  >
                                    {alloc.vendor_reference || "—"}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground block text-[10px]">
                                    Material
                                  </span>
                                  <span
                                    className="font-semibold text-foreground truncate block"
                                    title={alloc.material_reference || ""}
                                  >
                                    {alloc.material_reference || "Material Shipment"}{" "}
                                    {alloc.quantity ? `(${alloc.quantity} units)` : ""}
                                  </span>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="rounded-xl border border-border/40 bg-muted/10 p-3 text-xs text-muted-foreground flex items-center gap-2">
                              <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />
                              <span>Dock allocation active for this store.</span>
                            </div>
                          )}
                        </div>

                        {/* Card Actions */}
                        <div className="pt-4 mt-2 border-t border-border/40 flex items-center gap-2">
                          {isOccupied && !isReleased ? (
                            <Button
                              className="flex-1 rounded-xl bg-[#ef4444] hover:bg-red-600 text-white font-bold text-xs h-9 shadow-sm flex items-center justify-center gap-1.5"
                              onClick={() => setReleaseConfirmDock(dock)}
                            >
                              <LogOut className="size-3.5" /> Release Dock
                            </Button>
                          ) : (
                            <div className="flex-1 text-[11px] text-muted-foreground font-semibold flex items-center gap-1">
                              <ShieldCheck className="size-3.5 text-emerald-600" /> Released /
                              Completed
                            </div>
                          )}

                          <Button
                            variant="outline"
                            size="sm"
                            className="rounded-xl text-xs h-9"
                            onClick={() => setSelectedDockForDetails(dock)}
                          >
                            Details
                          </Button>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB: TAKEAWAY (OUTBOUND MATERIAL DISPATCH) */}
          {activeTab === "takeaway" && (
            <div className="space-y-6">
              <Card className="border-border/40 shadow-soft bg-gradient-to-r from-blue-500/10 via-card to-card">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2 text-primary font-black">
                    <Send className="size-5 text-blue-600" />
                    <CardTitle className="text-base font-extrabold text-foreground">
                      Store Takeaway & Material Dispatch
                    </CardTitle>
                  </div>
                  <CardDescription className="text-xs">
                    Scan or select a storage Bin QR to inspect available materials, then scan/select
                    a Material QR to record takeaway quantities with immediate atomic inventory
                    decrement.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Step 1: Bin Scan Input */}
                  <div className="rounded-2xl border bg-card p-4 space-y-3 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-1.5">
                        <Scan className="size-3.5" /> 1. Scan or Select Bin Location
                      </Label>
                      {takeawayScannedBinCode && (
                        <span className="font-mono text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 font-bold border border-emerald-500/20">
                          Active Bin: {takeawayScannedBinCode}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-col sm:flex-row items-center gap-2">
                      <div className="relative flex-1 w-full">
                        <ScanLine className="size-4 absolute left-3 top-2.5 text-muted-foreground" />
                        <Input
                          placeholder="Scan Bin QR or enter Bin Code (e.g. BIN-MET-001)..."
                          value={takeawayBinInput}
                          onChange={(e) => setTakeawayBinInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void handleFetchBinMaterials(takeawayBinInput);
                            }
                          }}
                          className="pl-9 h-9 text-xs rounded-xl font-mono"
                        />
                      </div>
                      <Button
                        type="button"
                        onClick={() => void handleFetchBinMaterials(takeawayBinInput)}
                        disabled={takeawayLoadingMaterials || !takeawayBinInput.trim()}
                        className="w-full sm:w-auto rounded-xl text-xs bg-blue-600 hover:bg-blue-700 text-white font-semibold h-9 shadow-sm"
                      >
                        {takeawayLoadingMaterials ? (
                          <Loader2 className="size-3.5 animate-spin mr-1.5" />
                        ) : (
                          <Search className="size-3.5 mr-1.5" />
                        )}
                        Load Bin Materials
                      </Button>
                    </div>

                    {/* Quick Select from Store Bins */}
                    {zones.length > 0 && (
                      <div className="pt-2 border-t border-border/40">
                        <p className="text-[11px] text-muted-foreground mb-1.5">
                          Quick select from active bins in {store?.store_name}:
                        </p>
                        <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                          {zones
                            .flatMap((z) => (z.bins || []).filter((b) => b.status === "ACTIVE"))
                            .map((b) => (
                              <button
                                key={b.id}
                                type="button"
                                onClick={() => {
                                  setTakeawayBinInput(b.bin_code);
                                  void handleFetchBinMaterials(b.bin_code);
                                }}
                                className={cn(
                                  "font-mono text-[10px] px-2.5 py-1 rounded-lg border transition-all font-semibold",
                                  takeawayScannedBinCode === b.bin_code
                                    ? "bg-blue-600 text-white border-blue-600 shadow-xs"
                                    : "bg-muted/40 hover:bg-muted text-foreground border-border/60",
                                )}
                              >
                                {b.bin_code} ({b.bin_name})
                              </button>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Step 2: Bin Content & Material Selection */}
                  {takeawayScannedBinCode && (
                    <div className="rounded-2xl border bg-card p-4 space-y-3 shadow-2xs animate-in fade-in">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-1.5">
                          <Boxes className="size-3.5" /> 2. Materials Stored in Bin{" "}
                          {takeawayScannedBinCode}
                        </Label>
                        <span className="text-xs text-muted-foreground">
                          {takeawayBinMaterials.length} item(s) found
                        </span>
                      </div>

                      {takeawayBinMaterials.length === 0 ? (
                        <div className="py-8 text-center text-xs text-muted-foreground border border-dashed rounded-xl">
                          <Boxes className="size-8 mx-auto text-muted-foreground/40 mb-1.5" />
                          No materials currently stored in this bin. Complete Putaway to populate
                          stock.
                        </div>
                      ) : (
                        <div className="overflow-x-auto border rounded-xl">
                          <table className="w-full text-left text-xs">
                            <thead className="border-b bg-muted/40 text-[10px] uppercase font-bold text-muted-foreground">
                              <tr>
                                <th className="px-3 py-2.5">Material Code</th>
                                <th className="px-3 py-2.5">Material Name</th>
                                <th className="px-3 py-2.5">Material QR</th>
                                <th className="px-3 py-2.5 text-right">Available Qty</th>
                                <th className="px-3 py-2.5 text-right">Action</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border/50">
                              {takeawayBinMaterials.map((mat) => {
                                const isSelected =
                                  takeawaySelectedMaterial?.material_code === mat.material_code;
                                return (
                                  <tr
                                    key={mat.material_code}
                                    className={cn(
                                      "hover:bg-muted/30 transition-colors",
                                      isSelected && "bg-blue-50/60 dark:bg-blue-950/40",
                                    )}
                                  >
                                    <td className="px-3 py-2.5 font-mono font-bold text-primary">
                                      {mat.material_code}
                                    </td>
                                    <td className="px-3 py-2.5 font-semibold text-foreground">
                                      {mat.material_name}
                                    </td>
                                    <td className="px-3 py-2.5 font-mono text-[11px] text-muted-foreground">
                                      <span className="px-2 py-0.5 rounded-md bg-muted font-bold text-foreground">
                                        {mat.material_qr || `QR-MAT-${mat.material_code}`}
                                      </span>
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-mono font-black text-emerald-600 dark:text-emerald-400">
                                      {mat.available_quantity} {mat.uom}
                                    </td>
                                    <td className="px-3 py-2.5 text-right">
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant={isSelected ? "default" : "outline"}
                                        onClick={() => {
                                          setTakeawaySelectedMaterial(mat);
                                          setTakeawayQuantity(String(mat.available_quantity));
                                        }}
                                        className={cn(
                                          "rounded-lg text-xs h-7 px-3 font-semibold",
                                          isSelected ? "bg-blue-600 text-white" : "",
                                        )}
                                      >
                                        {isSelected ? "Selected" : "Select Material"}
                                      </Button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Step 3: Takeaway Confirmation Form */}
                  {takeawaySelectedMaterial && (
                    <form
                      onSubmit={handleTakeawaySubmit}
                      className="rounded-2xl border border-blue-500/30 bg-blue-500/5 p-4 space-y-4 shadow-sm animate-in fade-in"
                    >
                      <div className="flex items-center justify-between border-b border-border/40 pb-2">
                        <Label className="text-xs font-bold uppercase tracking-wider text-blue-700 dark:text-blue-300 flex items-center gap-1.5">
                          <Send className="size-3.5" /> 3. Confirm Takeaway Quantity & Dispatch
                        </Label>
                        <span className="text-xs font-mono font-bold text-foreground">
                          {takeawaySelectedMaterial.material_name} (
                          {takeawaySelectedMaterial.material_code})
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                        <div>
                          <Label className="text-xs font-semibold">
                            Takeaway Quantity ({takeawaySelectedMaterial.uom}){" "}
                            <span className="text-destructive">*</span>
                          </Label>
                          <Input
                            type="number"
                            step="any"
                            min="0.0001"
                            max={takeawaySelectedMaterial.available_quantity}
                            value={takeawayQuantity}
                            onChange={(e) => setTakeawayQuantity(e.target.value)}
                            required
                            className="mt-1 h-9 rounded-xl font-mono font-bold text-base"
                          />
                          <span className="text-[10px] text-muted-foreground mt-0.5 block">
                            Max Available:{" "}
                            <strong>
                              {takeawaySelectedMaterial.available_quantity}{" "}
                              {takeawaySelectedMaterial.uom}
                            </strong>
                          </span>
                        </div>

                        <div>
                          <Label className="text-xs font-semibold">
                            Reference Document / Requisition
                          </Label>
                          <Input
                            placeholder="e.g. REQ-PROD-2026-09"
                            value={takeawayRefDoc}
                            onChange={(e) => setTakeawayRefDoc(e.target.value)}
                            className="mt-1 h-9 rounded-xl font-mono text-xs"
                          />
                          <span className="text-[10px] text-muted-foreground mt-0.5 block">
                            Production issue slip, job order, or transfer ref.
                          </span>
                        </div>

                        <div>
                          <Label className="text-xs font-semibold">Remarks / Purpose</Label>
                          <Input
                            placeholder="e.g. Dispatch to Assembly Line A"
                            value={takeawayRemarks}
                            onChange={(e) => setTakeawayRemarks(e.target.value)}
                            className="mt-1 h-9 rounded-xl text-xs"
                          />
                          <span className="text-[10px] text-muted-foreground mt-0.5 block">
                            Audit note for movement history log.
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/40">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setTakeawaySelectedMaterial(null)}
                          className="rounded-xl text-xs h-9"
                        >
                          Cancel
                        </Button>
                        <Button
                          type="submit"
                          disabled={
                            takeawayExecuting || !takeawayQuantity || Number(takeawayQuantity) <= 0
                          }
                          className="rounded-xl text-xs bg-blue-600 hover:bg-blue-700 text-white font-bold h-9 shadow-glow"
                        >
                          {takeawayExecuting && (
                            <Loader2 className="size-3.5 animate-spin mr-1.5" />
                          )}
                          <CheckCircle2 className="size-4 mr-1.5" /> Confirm & Dispatch Takeaway
                        </Button>
                      </div>
                    </form>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* TAB: MOVEMENT HISTORY (FULL AUDIT TRAIL) */}
          {activeTab === "history" && (
            <div className="space-y-4">
              <Card className="border-border/40 shadow-soft">
                <CardHeader className="pb-3">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 font-black text-foreground">
                        <History className="size-5 text-primary" />
                        <CardTitle className="text-base font-extrabold">
                          Inventory Movement Audit Trail
                        </CardTitle>
                      </div>
                      <CardDescription className="text-xs mt-0.5">
                        Comprehensive ledger of all PUTAWAY and TAKEAWAY actions with scanned QR
                        tags, location transitions, and operator attribution.
                      </CardDescription>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={fetchMovementHistory}
                        disabled={movementHistoryLoading}
                        className="rounded-xl text-xs h-8"
                      >
                        <RefreshCw
                          className={cn(
                            "size-3.5 mr-1.5",
                            movementHistoryLoading && "animate-spin",
                          )}
                        />{" "}
                        Refresh
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Filters */}
                  <div className="flex flex-col sm:flex-row items-center gap-2">
                    <div className="relative flex-1 w-full">
                      <Search className="size-3.5 absolute left-3 top-2.5 text-muted-foreground" />
                      <Input
                        placeholder="Search by material code, name, QR, location, or operator..."
                        value={movementHistorySearch}
                        onChange={(e) => setMovementHistorySearch(e.target.value)}
                        className="pl-8 h-8 text-xs rounded-xl bg-background/50 border-border/40"
                      />
                    </div>
                    <Select
                      value={movementHistoryTypeFilter}
                      onValueChange={setMovementHistoryTypeFilter}
                    >
                      <SelectTrigger className="w-40 h-8 text-xs rounded-xl border-border/40">
                        <SelectValue placeholder="Movement Type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">All Types</SelectItem>
                        <SelectItem value="PUTAWAY">PUTAWAY (Inbound)</SelectItem>
                        <SelectItem value="TAKEAWAY">TAKEAWAY (Outbound)</SelectItem>
                        <SelectItem value="TRANSFER">TRANSFER</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Table */}
                  <div className="overflow-x-auto border rounded-2xl">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b bg-muted/40 text-[10px] uppercase font-bold text-muted-foreground">
                        <tr>
                          <th className="px-3.5 py-3">Timestamp</th>
                          <th className="px-3.5 py-3">Type</th>
                          <th className="px-3.5 py-3">Material</th>
                          <th className="px-3.5 py-3">Scanned Material QR</th>
                          <th className="px-3.5 py-3">Movement Route</th>
                          <th className="px-3.5 py-3 text-right">Quantity</th>
                          <th className="px-3.5 py-3 text-center">Stock Level</th>
                          <th className="px-3.5 py-3">Operator</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {movementHistoryLoading ? (
                          <tr>
                            <td
                              colSpan={8}
                              className="py-12 text-center text-xs text-muted-foreground"
                            >
                              <Loader2 className="size-6 animate-spin mx-auto text-primary mb-2" />
                              Loading movement records...
                            </td>
                          </tr>
                        ) : filteredMovementHistory.length === 0 ? (
                          <tr>
                            <td
                              colSpan={8}
                              className="py-12 text-center text-xs text-muted-foreground"
                            >
                              <History className="size-6 mx-auto text-muted-foreground/40 mb-1.5" />
                              No movement records found matching the filter.
                            </td>
                          </tr>
                        ) : (
                          filteredMovementHistory.map((m) => (
                            <tr key={m.id} className="hover:bg-muted/30 transition-colors">
                              <td className="px-3.5 py-3 font-mono text-[11px] text-muted-foreground whitespace-nowrap">
                                {m.created_at ? new Date(m.created_at).toLocaleString() : "—"}
                              </td>
                              <td className="px-3.5 py-3">
                                <span
                                  className={cn(
                                    "px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border",
                                    m.movement_type === "PUTAWAY"
                                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                                      : m.movement_type === "TAKEAWAY"
                                        ? "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30"
                                        : "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30",
                                  )}
                                >
                                  {m.movement_type}
                                </span>
                              </td>
                              <td className="px-3.5 py-3">
                                <div className="font-mono font-bold text-foreground">
                                  {m.material_code}
                                </div>
                                <div className="text-[11px] text-muted-foreground truncate max-w-44">
                                  {m.material_name}
                                </div>
                              </td>
                              <td className="px-3.5 py-3 font-mono text-[11px]">
                                <span className="px-1.5 py-0.5 rounded bg-muted/60 font-semibold text-foreground">
                                  {m.material_qr || "—"}
                                </span>
                              </td>
                              <td className="px-3.5 py-3 text-[11px]">
                                <div className="flex items-center gap-1 font-mono">
                                  <span className="text-muted-foreground">
                                    {m.from_location || "—"}
                                  </span>
                                  <ArrowRight className="size-3 text-primary shrink-0" />
                                  <span className="font-bold text-foreground">
                                    {m.to_location || "—"}
                                  </span>
                                </div>
                              </td>
                              <td className="px-3.5 py-3 text-right font-mono font-black text-foreground whitespace-nowrap">
                                {m.movement_type === "TAKEAWAY" ? "-" : "+"}
                                {m.quantity} {m.uom || "PCS"}
                              </td>
                              <td className="px-3.5 py-3 text-center font-mono text-[11px]">
                                {m.stock_before !== null && m.stock_after !== null ? (
                                  <span className="text-muted-foreground">
                                    {m.stock_before} →{" "}
                                    <strong className="text-foreground">{m.stock_after}</strong>
                                  </span>
                                ) : (
                                  "—"
                                )}
                              </td>
                              <td className="px-3.5 py-3 text-[11px]">
                                <div className="font-semibold text-foreground">
                                  {m.created_by || "System"}
                                </div>
                                {m.reference_document && (
                                  <div className="font-mono text-[10px] text-muted-foreground">
                                    Ref: {m.reference_document}
                                  </div>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ZONE QR MODAL */}
          <Dialog open={qrModalOpen} onOpenChange={setQrModalOpen}>
            <DialogContent className="sm:max-w-md rounded-2xl text-center">
              <DialogHeader>
                <DialogTitle className="flex items-center justify-center gap-2">
                  <QrCode className="size-5 text-primary" /> Zone QR Code
                </DialogTitle>
                <DialogDescription className="text-xs">
                  Physical storage location barcode label for scanning during Putaway.
                </DialogDescription>
              </DialogHeader>

              {loadingQr ? (
                <div className="flex flex-col items-center justify-center py-10 gap-2">
                  <Loader2 className="size-8 animate-spin text-primary" />
                  <p className="text-xs text-muted-foreground">Generating QR payload...</p>
                </div>
              ) : (
                selectedZoneForQr && (
                  <div className="space-y-4 pt-2">
                    <div className="p-4 rounded-xl border border-border/60 bg-white inline-block shadow-sm">
                      {qrDataUrl ? (
                        <img src={qrDataUrl} alt="Zone QR" className="size-48 mx-auto" />
                      ) : (
                        <div className="size-48 flex items-center justify-center text-xs text-muted-foreground">
                          No QR available
                        </div>
                      )}
                    </div>

                    <div>
                      <span className="font-mono text-lg font-black text-primary">
                        {selectedZoneForQr.zone_code}
                      </span>
                      <p className="font-semibold text-xs text-foreground mt-0.5">
                        {selectedZoneForQr.zone_name}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {store?.store_name} ({store?.store_code})
                      </p>
                    </div>

                    <div className="flex items-center justify-center gap-2 pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handlePrintQR}
                        className="rounded-xl text-xs gap-1.5"
                      >
                        <Printer className="size-3.5" /> Print Label
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={handleDownloadQR}
                        className="rounded-xl text-xs gap-1.5 shadow-glow"
                      >
                        <Download className="size-3.5" /> Download PNG
                      </Button>
                    </div>
                  </div>
                )
              )}
            </DialogContent>
          </Dialog>

          {/* BIN QR MODAL */}
          <Dialog open={binQrModalOpen} onOpenChange={setBinQrModalOpen}>
            <DialogContent className="sm:max-w-md rounded-2xl text-center">
              <DialogHeader>
                <DialogTitle className="flex items-center justify-center gap-2">
                  <QrCode className="size-5 text-emerald-500" /> Bin QR Code
                </DialogTitle>
                <DialogDescription className="text-xs">
                  Physical storage bin barcode label for exact location verification.
                </DialogDescription>
              </DialogHeader>

              {loadingBinQr ? (
                <div className="flex flex-col items-center justify-center py-10 gap-2">
                  <Loader2 className="size-8 animate-spin text-emerald-500" />
                  <p className="text-xs text-muted-foreground">Generating Bin QR payload...</p>
                </div>
              ) : (
                selectedBinForQr && (
                  <div className="space-y-4 pt-2">
                    <div className="p-4 rounded-xl border border-border/60 bg-white inline-block shadow-sm">
                      {binQrDataUrl ? (
                        <img src={binQrDataUrl} alt="Bin QR" className="size-48 mx-auto" />
                      ) : (
                        <div className="size-48 flex items-center justify-center text-xs text-muted-foreground">
                          No QR available
                        </div>
                      )}
                    </div>

                    <div>
                      <span className="font-mono text-lg font-black text-emerald-500">
                        {selectedBinForQr.bin_code}
                      </span>
                      <p className="font-semibold text-xs text-foreground mt-0.5">
                        {selectedBinForQr.bin_name}
                      </p>
                      <p className="text-[11px] text-muted-foreground font-mono">
                        Rack: {selectedBinForQr.rack || "-"} · Shelf:{" "}
                        {selectedBinForQr.shelf || "-"} · Capacity: {selectedBinForQr.capacity}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {store?.store_name} ({store?.store_code}) /{" "}
                        {selectedZoneForBinQr?.zone_code}
                      </p>
                    </div>

                    <div className="flex items-center justify-center gap-2 pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handlePrintBinQR}
                        className="rounded-xl text-xs gap-1.5"
                      >
                        <Printer className="size-3.5" /> Print Label
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={handleDownloadBinQR}
                        className="rounded-xl text-xs gap-1.5 shadow-glow bg-emerald-600 hover:bg-emerald-700 text-white"
                      >
                        <Download className="size-3.5" /> Download PNG
                      </Button>
                    </div>
                  </div>
                )
              )}
            </DialogContent>
          </Dialog>

          {/* STORE KEEPER PUTAWAY EXECUTION MODAL */}
          <Dialog open={executeModalOpen} onOpenChange={setExecuteModalOpen}>
            <DialogContent className="sm:max-w-lg rounded-2xl">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-primary font-bold">
                  <ScanLine className="size-5" /> Execute Physical Putaway
                </DialogTitle>
                <DialogDescription className="text-xs">
                  Scan Material QR & Destination Zone/Bin QR to confirm physical putaway into{" "}
                  {store?.store_name}.
                </DialogDescription>
              </DialogHeader>

              {executingTask && (
                <form onSubmit={handleConfirmPutawaySubmit} className="space-y-4 pt-2">
                  {/* Task Summary Banner */}
                  <div className="rounded-xl border bg-muted/20 p-3.5 text-xs">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-mono font-bold text-primary">
                          {executingTask.task_number}
                        </p>
                        <p className="font-bold text-foreground mt-0.5">
                          {executingTask.material_name}
                        </p>
                        <p className="font-mono text-muted-foreground">{executingTask.item_code}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-black text-base text-primary">
                          {executingTask.quantity.toLocaleString()} {executingTask.uom}
                        </p>
                        <p className="font-mono text-[11px] text-muted-foreground">
                          GRN: {executingTask.grn_number}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Step 1: Scan Material QR */}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold text-foreground flex items-center justify-between">
                      <span>
                        1. Material QR / Tag <span className="text-destructive">*</span>
                      </span>
                      {verifiedHU && (
                        <span className="text-emerald-600 font-normal text-[11px] flex items-center gap-1">
                          <CheckCircle2 className="size-3" /> Verified
                        </span>
                      )}
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Scan Material QR payload / HU tag"
                        value={matScanInput}
                        onChange={(e) => setMatScanInput(e.target.value)}
                        className="text-xs font-mono"
                        required
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!matScanInput.trim() || verifyingMat}
                        onClick={handleVerifyMaterial}
                        className="shrink-0 text-xs rounded-xl"
                      >
                        {verifyingMat ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <ScanLine className="size-3.5" />
                        )}{" "}
                        Verify
                      </Button>
                    </div>
                  </div>

                  {/* Step 2: Select Destination Zone & Bin */}
                  <div className="space-y-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-bold text-foreground">
                        2. Destination Store Zone <span className="text-destructive">*</span>
                      </Label>
                      <Select
                        value={zoneScanInput}
                        onValueChange={(val) => {
                          setZoneScanInput(val);
                          setBinScanInput("");
                        }}
                      >
                        <SelectTrigger className="text-xs rounded-xl">
                          <SelectValue placeholder="Select active store zone" />
                        </SelectTrigger>
                        <SelectContent>
                          {activeZonesList.map((z) => (
                            <SelectItem key={z.id} value={z.id}>
                              {z.zone_name} ({z.zone_code})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {selectedZoneBins.length > 0 && (
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                          <Grid className="size-3 text-emerald-400" />
                          <span>
                            Destination Bin (Optional - Auto-provisions primary bin if none
                            selected)
                          </span>
                        </Label>
                        <Select value={binScanInput} onValueChange={setBinScanInput}>
                          <SelectTrigger className="text-xs rounded-xl font-mono text-emerald-600">
                            <SelectValue placeholder="-- Select Specific Physical Bin (or Auto-assign) --" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="">-- Default Zone Primary Bin --</SelectItem>
                            {selectedZoneBins.map((b) => (
                              <SelectItem key={b.id} value={b.id}>
                                {b.bin_code} — {b.bin_name} (Rack: {b.rack || "-"}, Shelf:{" "}
                                {b.shelf || "-"})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>

                  {/* Step 3: Quantity Confirmation */}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold text-foreground">
                      3. Confirmed Quantity ({executingTask.uom}){" "}
                      <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      type="number"
                      min="0.0001"
                      max={executingTask.quantity}
                      step="any"
                      placeholder="Enter confirmed quantity"
                      value={confirmedQty}
                      onChange={(e) => setConfirmedQty(e.target.value)}
                      className="text-xs"
                      required
                    />
                  </div>

                  <DialogFooter className="pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setExecuteModalOpen(false)}
                      className="rounded-xl text-xs"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      size="sm"
                      disabled={confirmingPutaway || !matScanInput.trim() || !zoneScanInput.trim()}
                      className="rounded-xl text-xs font-semibold shadow-glow bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      {confirmingPutaway ? (
                        <Loader2 className="size-3.5 animate-spin mr-1.5" />
                      ) : (
                        <CheckCircle2 className="size-3.5 mr-1.5" />
                      )}
                      Confirm Physical Putaway
                    </Button>
                  </DialogFooter>
                </form>
              )}
            </DialogContent>
          </Dialog>

          {/* TAB 2: OUTBOUND PICKUP / FINISHED GOODS DISPATCH TASKS */}
          {activeTab === "pickup" && (
            <div className="space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="relative w-72">
                  <Search className="size-3.5 absolute left-3 top-2.5 text-muted-foreground" />
                  <Input
                    placeholder={`Search assigned ${store?.store_type === "FINISHED_GOODS" ? "dispatch" : "pickup"} tasks...`}
                    value={pickupSearch}
                    onChange={(e) => setPickupSearch(e.target.value)}
                    className="pl-8 h-8 text-xs rounded-xl bg-background/50 border-border/40"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <Select value={pickupStatusFilter} onValueChange={setPickupStatusFilter}>
                    <SelectTrigger className="w-36 h-8 text-xs rounded-xl border-border/40">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">All Status</SelectItem>
                      <SelectItem value="ASSIGNED_TO_STORE">Ready to Pick</SelectItem>
                      <SelectItem value="PICKING">In Progress</SelectItem>
                      <SelectItem value="COMPLETED">Completed</SelectItem>
                    </SelectContent>
                  </Select>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={fetchStoreData}
                    className="h-8 rounded-xl text-xs"
                  >
                    <RefreshCw className="size-3 mr-1" /> Refresh
                  </Button>
                </div>
              </div>

              {pickupTasksLoading ? (
                <div className="flex items-center justify-center p-12">
                  <Loader2 className="size-6 animate-spin text-primary" />
                </div>
              ) : filteredPickupTasks.length === 0 ? (
                <Card className="border-dashed border-border/60 p-8 text-center bg-card/40">
                  <ClipboardList className="size-8 mx-auto text-muted-foreground opacity-40 mb-2" />
                  <p className="text-xs font-bold text-muted-foreground">
                    No Outbound {store?.store_type === "FINISHED_GOODS" ? "Dispatch" : "Pickup"} Tasks Found
                  </p>
                  <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                    Material requests assigned to your store by Warehouse will appear here for
                    picking.
                  </p>
                </Card>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {filteredPickupTasks.map((pt) => {
                    const isPending = pt.status === "ASSIGNED_TO_STORE";
                    const isCompleted = pt.status === "COMPLETED";

                    return (
                      <Card key={pt.id} className="border-border/40 shadow-soft overflow-hidden">
                        <CardHeader className="p-4 bg-muted/20 border-b border-border/40 flex flex-row items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs font-bold text-primary">
                                {pt.task_number}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                Req: {pt.request_number}
                              </span>
                            </div>
                            <h4 className="font-bold text-sm text-foreground mt-1">
                              {pt.material_name}
                            </h4>
                            <p className="text-xs font-mono text-muted-foreground">
                              {pt.material_code}
                            </p>
                          </div>
                          <StatusBadge status={pt.status} />
                        </CardHeader>
                        <CardContent className="p-4 space-y-3">
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="p-2.5 rounded-xl bg-card border border-border/40">
                              <p className="text-[10px] uppercase font-bold text-muted-foreground">
                                Requested Qty
                              </p>
                              <p className="font-black text-foreground mt-0.5 text-sm">
                                {pt.requested_quantity}{" "}
                                <span className="text-[10px] font-normal">{pt.uom}</span>
                              </p>
                            </div>
                            <div className="p-2.5 rounded-xl bg-card border border-border/40">
                              <p className="text-[10px] uppercase font-bold text-muted-foreground">
                                Target Dept
                              </p>
                              <p className="font-bold text-foreground mt-0.5 truncate">
                                {pt.department}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1">
                            <span>
                              Priority:{" "}
                              <strong className="text-foreground">{pt.priority || "NORMAL"}</strong>
                            </span>
                            <span>
                              Required:{" "}
                              <strong>
                                {pt.required_date
                                  ? new Date(pt.required_date).toLocaleDateString()
                                  : "—"}
                              </strong>
                            </span>
                          </div>

                          <div className="pt-2 border-t border-border/40 flex items-center justify-between">
                            <span className="text-[10px] text-muted-foreground">
                              {isCompleted
                                ? `${store?.store_type === "FINISHED_GOODS" ? "Dispatched" : "Picked"} by ${pt.picked_by}`
                                : `Ready for ${store?.store_type === "FINISHED_GOODS" ? "Dispatch" : "Store Pickup"}`}
                            </span>
                            {!isCompleted && (
                              <Button
                                size="sm"
                                onClick={() => handleOpenExecutePickup(pt)}
                                className="h-7 px-3 text-xs rounded-xl shadow-glow gap-1.5"
                              >
                                <ScanLine className="size-3.5" />
                                {store?.store_type === "FINISHED_GOODS" ? "Dispatch" : "Pick & Issue"}
                              </Button>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* STORE KEEPER PICKUP EXECUTION MODAL */}
          <Dialog open={executePickupModalOpen} onOpenChange={setExecutePickupModalOpen}>
            <DialogContent className="sm:max-w-md rounded-2xl">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <ScanLine className="size-5 text-primary" />
                  {store?.store_type === "FINISHED_GOODS" ? "Execute Finished Goods Dispatch" : "Execute Store Pickup & Issue"}
                </DialogTitle>
                <DialogDescription className="text-xs">
                  Pick and issue material from {store.store_name} to{" "}
                  {executingPickupTask?.department}.
                </DialogDescription>
              </DialogHeader>

              {executingPickupTask && (
                <form onSubmit={handleConfirmPickupSubmit} className="space-y-4 pt-2">
                  <div className="p-3 bg-muted/20 border border-border/40 rounded-xl space-y-1">
                    <p className="text-xs font-bold text-foreground">
                      {executingPickupTask.material_name}
                    </p>
                    <p className="text-[11px] font-mono text-muted-foreground">
                      Code: {executingPickupTask.material_code}
                    </p>
                    <p className="text-[11px] text-primary font-bold">
                      Requested: {executingPickupTask.requested_quantity} {executingPickupTask.uom}
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">
                      1. Material QR / Code Verification
                    </Label>
                    <Input
                      value={pickupMatScan}
                      onChange={(e) => setPickupMatScan(e.target.value)}
                      placeholder="Scan or enter material code"
                      className="text-xs font-mono rounded-xl"
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">2. Source Store Bin / Zone</Label>
                    <Select value={pickupZoneScan} onValueChange={setPickupZoneScan}>
                      <SelectTrigger className="text-xs rounded-xl">
                        <SelectValue placeholder="Select Zone" />
                      </SelectTrigger>
                      <SelectContent>
                        {activeZonesList.map((z) => (
                          <SelectItem key={z.id} value={z.id}>
                            {z.zone_name} ({z.zone_code})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">
                      3. Picked / Issued Quantity ({executingPickupTask.uom})
                    </Label>
                    <Input
                      type="number"
                      step="any"
                      min="0.0001"
                      max={executingPickupTask.requested_quantity}
                      value={pickupQty}
                      onChange={(e) => setPickupQty(e.target.value)}
                      className="text-xs rounded-xl font-mono font-bold"
                      required
                    />
                  </div>

                  <DialogFooter className="pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setExecutePickupModalOpen(false)}
                      className="rounded-xl text-xs"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={confirmingPickup}
                      className="rounded-xl text-xs font-semibold shadow-glow"
                    >
                      {confirmingPickup && <Loader2 className="size-3.5 animate-spin mr-1.5" />}
                      Confirm Pickup & Issue
                    </Button>
                  </DialogFooter>
                </form>
              )}
            </DialogContent>
          </Dialog>

          {/* RELEASE DOCK CONFIRMATION MODAL */}
          <AlertDialog
            open={Boolean(releaseConfirmDock)}
            onOpenChange={() => setReleaseConfirmDock(null)}
          >
            <AlertDialogContent className="rounded-2xl">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-destructive flex items-center gap-2">
                  <LogOut className="size-5" /> Release Dock {releaseConfirmDock?.dock_code}?
                </AlertDialogTitle>
                <AlertDialogDescription className="space-y-2 text-xs">
                  <p>
                    You are authorizing the release of dock{" "}
                    <strong>{releaseConfirmDock?.dock_code}</strong> (
                    {releaseConfirmDock?.dock_name}).
                  </p>
                  {releaseConfirmDock?.current_allocation?.vehicle_number && (
                    <div className="p-3 bg-muted/30 border border-border/50 rounded-xl space-y-1 font-mono text-[11px]">
                      <p>
                        Vehicle:{" "}
                        <strong>{releaseConfirmDock.current_allocation.vehicle_number}</strong>
                      </p>
                      <p>
                        Gate Pass:{" "}
                        <strong>
                          {releaseConfirmDock.current_allocation.existing_gate_pass_id || "N/A"}
                        </strong>
                      </p>
                      {releaseConfirmDock.current_allocation.material_reference && (
                        <p>Material: {releaseConfirmDock.current_allocation.material_reference}</p>
                      )}
                    </div>
                  )}
                  <p className="text-foreground font-semibold">
                    This action will mark the dock status as AVAILABLE for new inbound deliveries.
                  </p>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="rounded-xl text-xs">Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="rounded-xl bg-[#ef4444] hover:bg-red-600 text-white font-bold text-xs"
                  disabled={releasingDockBusy}
                  onClick={(e) => {
                    e.preventDefault();
                    void handleReleaseDockSubmit();
                  }}
                >
                  {releasingDockBusy && <Loader2 className="size-3.5 animate-spin mr-1.5" />}
                  Confirm Release Dock
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* DOCK DETAILS MODAL */}
          {selectedDockForDetails && (
            <Dialog
              open={Boolean(selectedDockForDetails)}
              onOpenChange={() => setSelectedDockForDetails(null)}
            >
              <DialogContent className="max-w-lg rounded-2xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <div className="flex items-center justify-between">
                    <DialogTitle className="font-mono text-xl font-black text-primary flex items-center gap-2">
                      <Warehouse className="size-5" /> {selectedDockForDetails.dock_code}
                    </DialogTitle>
                    <span
                      className={cn(
                        "rounded-full px-3 py-0.5 text-xs font-extrabold tracking-wider border",
                        selectedDockForDetails.status === "AVAILABLE"
                          ? "bg-[#dcfce7] text-[#15803d] border-[#bbf7d0]"
                          : selectedDockForDetails.status === "MAINTENANCE"
                            ? "bg-slate-100 text-slate-700 border-slate-200"
                            : "bg-[#ffe4e6] text-[#e11d48] border-[#fecdd3]",
                      )}
                    >
                      {selectedDockForDetails.status === "OCCUPIED"
                        ? "AT DOCK"
                        : selectedDockForDetails.status}
                    </span>
                  </div>
                  <DialogDescription className="text-xs">
                    {selectedDockForDetails.dock_name}
                    {selectedDockForDetails.location ? ` · ${selectedDockForDetails.location}` : ""}
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
                          {selectedDockForDetails.dock_code} ({selectedDockForDetails.dock_name})
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-[11px]">
                          Dock Category
                        </span>
                        <span className="font-mono font-bold text-foreground">
                          {selectedDockForDetails.dock_type}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-[11px]">
                          Current Status
                        </span>
                        <span className="font-bold text-[#ef4444]">
                          {selectedDockForDetails.status === "OCCUPIED"
                            ? "AT DOCK"
                            : selectedDockForDetails.status}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-[11px]">
                          Assigned Store
                        </span>
                        <span className="font-semibold text-foreground">
                          {selectedDockForDetails.assigned_store_name || store?.store_name} (
                          {selectedDockForDetails.assigned_store_code || store?.store_code})
                        </span>
                      </div>
                      <div className="col-span-2">
                        <span className="text-muted-foreground block text-[11px]">Location</span>
                        <span className="font-medium text-foreground">
                          {selectedDockForDetails.location || "Central Receiving"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {selectedDockForDetails.current_allocation && (
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
                              {selectedDockForDetails.current_allocation.vehicle_number || "—"}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground block text-[11px]">
                              Gate Entry / Pass No
                            </span>
                            <span className="font-mono font-bold text-foreground">
                              {selectedDockForDetails.current_allocation.existing_gate_pass_id ||
                                "—"}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground block text-[11px]">
                              Allocation Status
                            </span>
                            <span className="font-mono font-bold text-emerald-600">
                              {selectedDockForDetails.current_allocation.status || "DOCK_ASSIGNED"}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground block text-[11px]">
                              Priority
                            </span>
                            <span className="font-bold text-foreground">
                              {selectedDockForDetails.current_allocation.priority || "NORMAL"}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl border bg-card p-3 space-y-2 shadow-sm">
                        <h4 className="font-extrabold uppercase tracking-wider text-[11px] text-primary flex items-center gap-1.5 border-b pb-1.5">
                          <Boxes className="size-3.5" /> Material & Supplier Details
                        </h4>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <span className="text-muted-foreground block text-[11px]">
                              Material Code / Name
                            </span>
                            <span className="font-bold text-foreground">
                              {selectedDockForDetails.current_allocation.material_reference ||
                                "Materials"}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground block text-[11px]">
                              Vendor / Supplier
                            </span>
                            <span className="font-medium text-foreground">
                              {selectedDockForDetails.current_allocation.vendor_reference || "—"}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground block text-[11px]">
                              Quantity
                            </span>
                            <span className="font-mono font-bold text-foreground">
                              {selectedDockForDetails.current_allocation.quantity || "—"}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground block text-[11px]">
                              Gate Pass Ref
                            </span>
                            <span className="font-mono text-muted-foreground">
                              {selectedDockForDetails.current_allocation.existing_gate_pass_id ||
                                "—"}
                            </span>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                <DialogFooter className="flex flex-col sm:flex-row gap-2 pt-2">
                  <Button
                    variant="outline"
                    className="rounded-xl text-xs"
                    onClick={() => setSelectedDockForDetails(null)}
                  >
                    Close
                  </Button>

                  {(selectedDockForDetails.status === "OCCUPIED" ||
                    selectedDockForDetails.status === "RESERVED") && (
                    <Button
                      className="rounded-xl bg-[#ef4444] hover:bg-red-600 text-white font-bold text-xs"
                      onClick={() => {
                        const target = selectedDockForDetails;
                        setSelectedDockForDetails(null);
                        setReleaseConfirmDock(target);
                      }}
                    >
                      <LogOut className="size-3.5 mr-1" /> Release Dock
                    </Button>
                  )}
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      )}
    </AppShell>
  );
}
