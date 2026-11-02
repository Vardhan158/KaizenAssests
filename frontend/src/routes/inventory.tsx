import { PutawayBatchTable, type PutawayView } from "@/components/wms/putaway-batch-table";
import { canAssignPutaway, canScanPutaway, assignedPutawayLocations, unassignedPutawayQuantity, isAssignableRack } from "@/lib/putaway-task-selection";
import { Label } from "@/components/ui/label";
import { RackOccupancyCards } from "@/components/wms/rack-occupancy-cards";
import { InformationTooltip } from "@/components/ui/information-tooltip";
import { inventoryHelp } from "@/lib/information-help";
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import {
  Boxes,
  Search,
  Loader2,
  AlertTriangle,
  Building2,
  RefreshCw,
  CheckCircle2,
  PackageCheck,
  ClipboardList,
  History,
  QrCode,
  ListOrdered,
  Plus,
  Eye,
  Scan,
  Camera,
  Layers,
  Tag,
  Download,
  Upload,
  Printer,
  Truck,
  ArrowRight,
} from "lucide-react";
import { AssemblyRequisitionsPanel } from "@/components/wms/assembly-requisitions-panel";
import { AppShell } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { isValidIdentifier } from "@/lib/input-validation";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import QRCode from "qrcode";
import jsQR from "jsqr";
import warehouseHero from "@/assets/warehouse-operations-hero.png";

export const Route = createFileRoute("/inventory")({
  head: () => ({
    meta: [
      { title: "Warehouse Module · KaizenAssests" },
      {
        name: "description",
        content:
          "Authoritative, simple end-to-end Warehouse & Inventory operations control system.",
      },
    ],
  }),
  component: SimpleWarehouseModule,
});

type TabType = "dashboard" | "putaway" | "inventory" | "requests" | "picking" | "locations";

const formatApiDateTime = (value?: string | null) => {
  if (!value) return "—";
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
  return new Date(hasTimezone ? normalized : `${normalized}Z`).toLocaleString();
};

function SimpleWarehouseModule() {
  const navigate = useNavigate();
  const searchParams: any = useSearch({ from: "/inventory" });
  const tabOptions: TabType[] = ["dashboard", "putaway", "inventory", "requests", "picking", "locations"];
  const activeTab: TabType = tabOptions.includes(searchParams?.tab)
    ? (searchParams.tab === "requests" ? "picking" : searchParams.tab)
    : "dashboard";
  const pageHeader: Record<TabType, { eyebrow: string; title: string; description: string; icon: typeof Boxes }> = {
    dashboard: {
      eyebrow: "Warehouse Operations",
      title: "Warehouse Dashboard",
      description: "Monitor inventory, putaway, material requests, and picking activity.",
      icon: Boxes,
    },
    putaway: {
      eyebrow: "Inbound Operations",
      title: "Putaway Tasks",
      description: "Move received materials into their assigned warehouse bins.",
      icon: PackageCheck,
    },
    inventory: {
      eyebrow: "Stock Control",
      title: "Inventory",
      description: "Review on-hand quantities, availability, and material locations.",
      icon: Boxes,
    },
    requests: {
      eyebrow: "Warehouse Requests",
      title: "Material Requests",
      description: "Review and fulfill material requests from production and warehouses.",
      icon: ClipboardList,
    },
    picking: {
      eyebrow: "Outbound Operations",
      title: "Assembly Requisitions & Picking",
      description: "Review assembly requisitions, reserve stock, and confirm material picks for issue.",
      icon: ListOrdered,
    },
    locations: {
      eyebrow: "Warehouse Layout",
      title: "Zones & Racks",
      description: "Manage storage zones, rack capacities, and occupancy.",
      icon: Building2,
    },
  };
  const PageHeaderIcon = pageHeader[activeTab].icon;

  // Data States (All coming strictly from backend)
  const [loading, setLoading] = useState<boolean>(true);
  const [putawayTasks, setPutawayTasks] = useState<any[]>([]);
  const [inventorySummary, setInventorySummary] = useState<any[]>([]);
  const [materialRequests, setMaterialRequests] = useState<any[]>([]);
  const [pickupTasks, setPickupTasks] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [zones, setZones] = useState<any[]>([]);
  const [bins, setBins] = useState<any[]>([]);
  const [docks, setDocks] = useState<any[]>([]);
  const [dockRequests, setDockRequests] = useState<any[]>([]);
  const [dockChoices, setDockChoices] = useState<Record<string, string>>({});

  const [requisitionRefreshKey, setRequisitionRefreshKey] = useState(0);
  const [putawaySearch, setPutawaySearch] = useState("");
  const [putawayStatus, setPutawayStatus] = useState("ALL");
  const [putawayBatchFilter, setPutawayBatchFilter] = useState("ALL");
  // Search & Filter States
  const [invSearch, setInvSearch] = useState("");
  const [invWarehouseFilter, setInvWarehouseFilter] = useState("ALL");
  const [invStatusFilter, setInvStatusFilter] = useState("ALL");
  useEffect(() => {
    if (typeof searchParams.search !== "string") return;
    if (activeTab === "putaway") setPutawaySearch(searchParams.search);
    else if (activeTab === "inventory") setInvSearch(searchParams.search);
  }, [searchParams.search, activeTab]);

  // Selected Detail Modals
  const [selectedInventory, setSelectedInventory] = useState<any>(null);
  const [selectedInventoryBatchCode, setSelectedInventoryBatchCode] = useState<string | null>(null);
  const [selectedPutawayGroup, setSelectedPutawayGroup] = useState<any>(null);
  const [putawayView, setPutawayView] = useState<PutawayView>("details");
  const openPutawayGroup = (group: any, view: PutawayView = "details") => { setPutawayView(view); setSelectedPutawayGroup(group); };
  const [assignPutawayTask, setAssignPutawayTask] = useState<any>(null);
  const [scanPutawayTask, setScanPutawayTask] = useState<any>(null);
  const [putawayScan, setPutawayScan] = useState({ materialQr: "", binQr: "", quantity: "" });
  const [putawayQrImages, setPutawayQrImages] = useState({ material: "", bin: "" });
  const [qrPreview, setQrPreview] = useState<{ title: string; image: string } | null>(null);
  const [putawayScanValid, setPutawayScanValid] = useState(false);
  const [materialQrVerified, setMaterialQrVerified] = useState(false);
  const [binQrVerified, setBinQrVerified] = useState(false);
  const [qrScanError, setQrScanError] = useState("");
  const [cameraField, setCameraField] = useState<"material" | "bin" | "pickup-material" | "pickup-bin" | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const cameraCanvasRef = useRef<HTMLCanvasElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState("");
  const [pickupToConfirm, setPickupToConfirm] = useState<any>(null);
  const [showPickupHistory, setShowPickupHistory] = useState(false);
  const [pickupFifoAlert, setPickupFifoAlert] = useState("");
  const [pickupConfirmation, setPickupConfirmation] = useState({
    material_scan: "",
    zone_scan: "",
    quantity: "",
  });
  const [pickupQrImages, setPickupQrImages] = useState({ material: "", rack: "" });
  const [pickupQrVerified, setPickupQrVerified] = useState({ material: false, rack: false });
  const [pickupQrError, setPickupQrError] = useState("");
  const [availablePickupBin, setAvailablePickupBin] = useState<any>(null);
  const pickupMaterialFileInput = useRef<HTMLInputElement>(null);
  const pickupRackFileInput = useRef<HTMLInputElement>(null);
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [assignWarehouseRefId, setAssignWarehouseRefId] = useState("");
  const [assignZoneId, setAssignZoneId] = useState("");
  const [assignQuantity, setAssignQuantity] = useState("");

  // Location Creation Modals
  const [createLocationType, setCreateLocationType] = useState<
    "zone" | "bin" | null
  >(null);
  const [editingZone, setEditingZone] = useState<any | null>(null);
  const [newZoneForm, setNewZoneForm] = useState({ zone_code: "", zone_name: "" });
  const [firstWarehouse, setFirstWarehouse] = useState({ name: "", location: "" });
  const [newBinForm, setNewBinForm] = useState({ zone_id: "" });
  const [newBinRows, setNewBinRows] = useState<[{ rack: string; position: string; capacity: string; bin_code: string }]>([{ rack: "", position: "", capacity: "", bin_code: "" }]);
  const [viewBinQrModal, setViewBinQrModal] = useState<any>(null);
  const [binQrImage, setBinQrImage] = useState<string | null>(null);

  // Submitting States
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!cameraField) return;
    let cancelled = false;
    setCameraError("");
    void navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
      .then((stream) => {
        if (cancelled) return stream.getTracks().forEach((track) => track.stop());
        cameraStreamRef.current = stream;
        if (cameraVideoRef.current) {
          cameraVideoRef.current.srcObject = stream;
          void cameraVideoRef.current.play();
        }
      })
      .catch(() =>
        setCameraError(
          "Camera permission was denied or is unavailable. Enter the QR value manually.",
        ),
      );
    return () => {
      cancelled = true;
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
    };
  }, [cameraField]);

  useEffect(() => {
    if (!cameraField) return;
    const timer = window.setInterval(() => {
      const video = cameraVideoRef.current;
      const canvas = cameraCanvasRef.current;
      if (!video || !canvas || video.readyState < 2 || !video.videoWidth) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const result = jsQR(image.data, image.width, image.height);
      if (result?.data) {
        if (cameraField === "pickup-material" || cameraField === "pickup-bin") {
          const pickupField = cameraField === "pickup-material" ? "material" : "rack";
          setPickupConfirmation((current) => ({
            ...current,
            [pickupField === "material" ? "material_scan" : "zone_scan"]: result.data,
          }));
          void verifyPickupQr(pickupField, result.data);
        } else {
          setPutawayScan((current) => ({
            ...current,
            [cameraField === "material" ? "materialQr" : "binQr"]: result.data,
          }));
        }
        setCameraField(null);
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [cameraField]);

  useEffect(() => {
    const value = viewBinQrModal?.qr_identifier;
    if (!value) {
      setBinQrImage(null);
      return;
    }
    let active = true;
    void QRCode.toDataURL(value)
      .then((dataUrl) => {
        if (active) setBinQrImage(dataUrl);
      })
      .catch(() => {
        if (active) setBinQrImage(null);
      });
    return () => {
      active = false;
    };
  }, [viewBinQrModal]);

  // Load Real Operational Data (No Hardcoded Fallbacks)
  const fetchData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [
        putawaysRes,
        inventoryRes,
        warehouseConfigurationRes,
        materialCatalogRes,
        assemblyRequestsRes,
        assemblyPickingTasksRes,
      ] = await Promise.all([
        api.getPutawayTasks(),
        api.getWarehouseInventorySummary(),
        api.getWarehouses(),
        api.getMaterialComponents(),
        api.getAssemblyMaterialRequests(),
        api.getAssemblyPickingTasks(),
      ]);

      let normalizedPutawayTasks = (Array.isArray(putawaysRes) ? putawaysRes : []).filter(
        (task: any, index: number, tasks: any[]) => {
          const grn = String(task.grn_id || task.grn_number || "").toUpperCase();
          const item = String(task.item_code || task.material_code || "").toUpperCase();
          const batch = String(task.batch_number || task.batchNumber || "")
            .trim()
            .toUpperCase();
          if (!batch) return true;
          return (
            tasks.findIndex(
              (candidate: any) =>
                String(candidate.grn_id || candidate.grn_number || "").toUpperCase() === grn &&
                String(candidate.item_code || candidate.material_code || "").toUpperCase() ===
                  item &&
                String(candidate.batch_number || candidate.batchNumber || "")
                  .trim()
                  .toUpperCase() === batch,
            ) === index
          );
        },
      );
      // Reconcile legacy task rows against the saved GRN batches. This keeps
      // old duplicate posting attempts out of the queue without deleting
      // historical records.
      const grnKeys = Array.from(
        new Set(
          normalizedPutawayTasks
            .map((task: any) => task.grn_number || task.grnNumber || task.grn_id)
            .filter((value: any) => value),
        ),
      );
      const canonicalByGrnMaterial = new Map<string, Set<string>>();
      const canonicalMaterialsByGrn = new Map<string, Set<string>>();
      await Promise.all(
        grnKeys.map(async (grnKey) => {
          try {
            const detail = await api.getGrnDetail(String(grnKey));
            if (!detail || !Array.isArray(detail.lines)) return;
            const canonicalMaterials = new Set<string>();
            const identityKeys = Array.from(new Set([
              String(grnKey),
              String(detail?.grn_id || ""),
              String(detail?.grn_number || ""),
            ].filter(Boolean)));
            for (const line of Array.isArray(detail?.lines) ? detail.lines : []) {
              const itemCode = String(line.item_code || line.material_code || "")
                .trim()
                .toUpperCase();
              if (!itemCode) continue;
              const approved = Number(line.quality_approved_quantity ?? line.good_quantity ?? 0);
              if (!(approved > 0)) continue;
              canonicalMaterials.add(itemCode);
              let remaining = approved;
              const allowed = new Set<string>();
              for (const batch of [...(Array.isArray(line.batches) ? line.batches : [])].sort(
                (a: any, b: any) =>
                  String(a.created_at || "").localeCompare(String(b.created_at || "")),
              )) {
                const batchNumber = String(batch.batch_number || "")
                  .trim()
                  .toUpperCase();
                const quantity = Number(batch.batch_quantity || 0);
                if (!batchNumber || allowed.has(batchNumber) || remaining <= 0 || quantity <= 0)
                  continue;
                allowed.add(batchNumber);
                remaining -= Math.min(quantity, remaining);
              }
              if (allowed.size > 0) {
                for (const identityKey of identityKeys) {
                  canonicalByGrnMaterial.set(`${identityKey}:${itemCode}`, allowed);
                }
              }
            }
            for (const identityKey of identityKeys) {
              canonicalMaterialsByGrn.set(identityKey, canonicalMaterials);
            }
          } catch {
            // The task endpoint remains the source if a legacy GRN cannot be read.
          }
        }),
      );
      normalizedPutawayTasks = normalizedPutawayTasks.filter((task: any) => {
        const grnKey = String(task.grn_number || task.grnNumber || task.grn_id || "");
        const itemCode = String(task.item_code || task.material_code || "")
          .trim()
          .toUpperCase();
        const canonicalMaterials = canonicalMaterialsByGrn.get(grnKey);
        if (canonicalMaterials && !canonicalMaterials.has(itemCode)) return false;
        const batch = String(task.batch_number || task.batchNumber || "")
          .trim()
          .toUpperCase();
        if (!batch || !task.grn_id) return true;
        const allowed = canonicalByGrnMaterial.get(
          `${grnKey}:${itemCode}`,
        );
        return !allowed || allowed.has(batch);
      });
      setPutawayTasks(normalizedPutawayTasks);
      const assemblyRequests = (
        Array.isArray(assemblyRequestsRes) ? assemblyRequestsRes : []
      ).flatMap((req: any) =>
        (Array.isArray(req.items) ? req.items : []).map((item: any) => ({
          ...req,
          id: req.id,
          request_number: req.request_number,
          material_code: item.material_code,
          material_name: item.material_name,
          material_qr: item.material_qr,
          quantity: item.quantity,
          required_quantity: item.quantity,
          uom: item.uom,
          available: item.available_quantity,
          available_quantity: item.available_quantity,
        })),
      );
      setMaterialRequests(assemblyRequests);
      const stockRows = Array.isArray(inventoryRes) ? inventoryRes : [];
      const stockCodes = new Set(
        stockRows.map((row: any) => String(row.material_code || row.code || "").toUpperCase()),
      );
      const catalogRows = (Array.isArray(materialCatalogRes) ? materialCatalogRes : [])
        .filter((material: any) => material.code && material.name)
        .filter((material: any) => !stockCodes.has(String(material.code).toUpperCase()))
        .map((material: any) => ({
          material_code: material.code,
          material_name: material.name,
          batch_number: "-",
          available_quantity: 0,
          on_hand_quantity: 0,
          total_quantity: 0,
          uom: material.uom || "PCS",
          location: "-",
          is_catalog_item: true,
        }));
      // The warehouse summary is location/batch based, so one material can be
      // returned once for every stored balance. This screen is a material-level
      // overview and its detail endpoint already supplies all locations and
      // batches; keep one row per material code before enriching it.
      const rowsByMaterialCode = new Map<string, any>();
      for (const row of [...stockRows, ...catalogRows]) {
        const materialKey = String(row.material_code || row.code || "")
          .trim()
          .toUpperCase();
        const key = materialKey || `ROW:${row.id || rowsByMaterialCode.size}`;
        if (!rowsByMaterialCode.has(key)) rowsByMaterialCode.set(key, row);
      }
      const rowsToRefresh = Array.from(rowsByMaterialCode.values());
      const refreshedStockRows = await Promise.all(
        rowsToRefresh.map(async (row: any) => {
          const code = row.material_code || row.code;
          if (!code) return row;
          try {
            const detail = await api.getMaterialInventoryDetail(String(code));
            const summary = detail?.summary || {};
            const firstLocation = Array.isArray(detail?.locations) ? detail.locations[0] : null;
            const movementBatches = (Array.isArray(detail?.movements) ? detail.movements : [])
              .filter((movement: any) => movement.movement_type === "PUTAWAY" && movement.batch_lot)
              .map((movement: any) => ({
                batch_number: movement.batch_lot,
                quantity: movement.quantity,
                uom: movement.uom || summary.uom,
                received_at: movement.performed_at,
              }))
              .sort((a: any, b: any) => String(a.received_at || "").localeCompare(String(b.received_at || "")));
            return {
              ...row,
              available: summary.available_stock ?? row.available,
              available_quantity: summary.available_stock ?? row.available_quantity,
              total_quantity: summary.total_stock ?? row.total_quantity,
              on_hand_quantity: summary.total_stock ?? row.on_hand_quantity,
              batch_details: movementBatches.length ? movementBatches : row.batch_details,
              batch_number:
                movementBatches.map((b: any) => b.batch_number).join(", ") || row.batch_number,
              location: firstLocation?.bin_code || firstLocation?.location_code || row.location,
              location_code: firstLocation?.location_code || row.location_code,
              bin_code: firstLocation?.bin_code || row.bin_code,
              uom: summary.uom || row.uom,
            };
          } catch {
            return row;
          }
        }),
      );
      setInventorySummary(refreshedStockRows);
      const assemblyPickingTasks = (
        Array.isArray(assemblyPickingTasksRes) ? assemblyPickingTasksRes : []
      ).flatMap((task: any) =>
        (Array.isArray(task.items) ? task.items : []).map((item: any) => ({
          id: `${task.id}:${item.material_code}`,
          task_number: task.task_number,
          assembly_order_number: task.request_number,
          material_code: item.material_code,
          material_name: item.material_name,
          material_qr: item.material_qr,
          quantity:
            item.picked_quantity ??
            item.issued_quantity ??
            item.required_quantity ??
            item.requested_quantity,
          requested_quantity: item.requested_quantity ?? item.required_quantity,
          picked_quantity: item.picked_quantity ?? item.issued_quantity ?? 0,
          batch_number:
            item.batch_number || item.batch_lot_number || task.confirmation?.batch_number,
          uom: item.uom,
          pick_location: item.pick_location || task.pick_location || task.destination,
          confirmation: item.confirmation || task.confirmation,
          status: item.status || task.status,
          assembly_pick_task_id: task.id,
        })),
      );
      setPickupTasks(assemblyPickingTasks);
      setWarehouses(Array.isArray(warehouseConfigurationRes) ? warehouseConfigurationRes : []);

      const locationZones = await api.getLocationZones();
      const zoneRows = Array.isArray(locationZones) ? locationZones : [];
      const zoneBins = await Promise.all(zoneRows.map((zone: any) => api.getZoneBins(zone.id)));
      setZones(zoneRows);
      setBins(zoneBins.flatMap((rows: any[]) => rows || []));
      const [dockRows, pendingDockRows] = await Promise.all([
        api.getDocks(),
        api.getPendingAllocations(),
      ]);
      setDocks(Array.isArray(dockRows) ? dockRows : []);
      setDockRequests(Array.isArray(pendingDockRows) ? pendingDockRows : []);
    } catch (err: any) {
      toast.error(err.message || "Failed to fetch warehouse data");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
    const interval = setInterval(() => void fetchData(true), 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleTabChange = (tab: TabType) => {
    navigate({ to: "/inventory", search: { tab } });
  };

  // Flattened Bins List for Single Location Selector (Strictly from DB)
  const allFlattenedBins = useMemo(() => {
    const list: Array<{
      id: string;
      label: string;
      bin_code: string;
      warehouse_ref_id: string;
      zone_id: string;
      rack: string;
      rack_capacity?: any;
      position?: string;
      qr_identifier?: string;
      status?: string;
    }> = [];
    if (bins && bins.length > 0) {
      bins.forEach((b) => {
        list.push({
          id: b.id,
          label: `${b.zone_code || b.zone_name || "—"} / ${b.rack || "—"} / ${b.bin_code}`,
          bin_code: b.bin_code,
          warehouse_ref_id: b.warehouse_ref_id,
          zone_id: b.zone_id,
          rack: b.rack,
          rack_capacity: b.rack_capacity,
          position: b.position || b.shelf,
          qr_identifier: b.qr_identifier,
          status: b.status,
        });
      });
    }
    return list;
  }, [bins]);
  const scanAssignedBin = scanPutawayTask
    ? allFlattenedBins.find(
        (bin) =>
          bin.id === scanPutawayTask.destination_bin_id ||
          bin.bin_code === scanPutawayTask.destination_bin_code,
      )
    : undefined;
  const scanAvailableCapacity = Number(
    scanAssignedBin?.rack_capacity?.available_capacity ?? Number.POSITIVE_INFINITY,
  );
  const scanMaximumQuantity = scanPutawayTask
    ? Math.min(Number(scanPutawayTask.quantity || 0), scanAvailableCapacity)
    : 0;

  // Action: Assign Storage Location to Putaway Task
  const handleConfirmAssignPutaway = async () => {
    if (!assignPutawayTask) return;
    const quantity = Number(assignQuantity);
    if (
      !assignWarehouseRefId ||
      !assignZoneId ||
      !selectedLocationId ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      quantity > unassignedPutawayQuantity(assignPutawayTask)
    ) {
      toast.error("Select an active rack and enter a valid assignment quantity.");
      return;
    }
    setIsSubmitting(true);
    try {
      const selectedBinObj = allFlattenedBins.find(
        (b) => b.id === selectedLocationId || b.bin_code === selectedLocationId,
      );
      await api.assignPutawayLocation(
        assignPutawayTask.id,
        selectedBinObj?.id,
        selectedBinObj?.warehouse_ref_id,
        selectedBinObj?.zone_id,
        selectedBinObj?.id,
        quantity,
      );
      toast.success(
        `Assigned ${assignPutawayTask.material_name || "Material"} to ${selectedBinObj?.label || selectedLocationId}`,
      );
      setAssignPutawayTask(null);
      void fetchData();
    } catch (err: any) {
      toast.error(err.message || "Failed to assign location");
    } finally {
      setIsSubmitting(false);
    }
  };

  const openAssignPutaway = (task: any) => {
    if (!canAssignPutaway(task)) return;
    setSelectedPutawayGroup(null);
    setAssignPutawayTask(task);
    setAssignWarehouseRefId(task.destination_warehouse_ref_id || task.assigned_warehouse_ref_id || warehouses[0]?.id || "");
    setAssignZoneId(task.destination_zone_id || "");
    setSelectedLocationId(task.destination_bin_id || "");
    setAssignQuantity(String(unassignedPutawayQuantity(task)));
  };

  const openPutawayScan = (task: any) => {
    setSelectedPutawayGroup(null);
    setScanPutawayTask(task);
    const assignedBin = allFlattenedBins.find(
      (bin) => bin.id === task.destination_bin_id || bin.bin_code === task.destination_bin_code,
    );
    const availableCapacity = Number(
      assignedBin?.rack_capacity?.available_capacity ?? Number.POSITIVE_INFINITY,
    );
    setPutawayScan({
      materialQr: "",
      binQr: "",
      quantity: String(Math.min(Number(task.quantity || 0), availableCapacity)),
    });
    setPutawayScanValid(false);
    setMaterialQrVerified(false);
    setBinQrVerified(false);
    setQrScanError("");
  };

  const pickupMaterialQrValue =
    pickupToConfirm?.material_qr ||
    pickupToConfirm?.confirmation?.material_qr ||
    (pickupToConfirm?.batch_number ? `QR-BATCH-${pickupToConfirm.batch_number}` : "") ||
    pickupToConfirm?.material_code ||
    "";
  const pickupRackQrValue =
    pickupToConfirm?.pick_location ||
    pickupToConfirm?.confirmation?.rack_qr ||
    pickupToConfirm?.rack_qr ||
    "";

  useEffect(() => {
    let active = true;
    setAvailablePickupBin(null);
    if (!pickupToConfirm?.material_code || pickupToConfirm?.status === "COMPLETED") return;
    void api.getInventoryLocationBalances(pickupToConfirm.material_code)
      .then(async (rows: any[]) => {
        const balance = (Array.isArray(rows) ? rows : [])
          .filter((row: any) => Number(row.available_quantity || 0) > 0)
          .sort((a: any, b: any) => Number(b.available_quantity || 0) - Number(a.available_quantity || 0))[0];
        if (!balance) return;
        const resolved = await api.resolveBinQr(balance.location_code);
        if (active) setAvailablePickupBin({
          ...balance,
          ...resolved,
          qr_value: resolved.qr_identifier || resolved.qr_code || balance.location_code,
        });
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [pickupToConfirm?.id, pickupToConfirm?.material_code, pickupToConfirm?.picked_quantity, pickupToConfirm?.status]);

  const verifyPickupQr = async (field: "material" | "rack", rawValue?: string) => {
    const value = (rawValue ?? (field === "material" ? pickupConfirmation.material_scan : pickupConfirmation.zone_scan)).trim();
    if (!pickupToConfirm || !value) {
      setPickupQrError(`Scan or enter the ${field === "material" ? "material" : "BIN"} QR first.`);
      return false;
    }
    try {
      if (field === "material") {
        const expectedCode = String(pickupToConfirm.material_code || "").trim().toUpperCase();
        const expectedBatch = String(pickupToConfirm.batch_number || "").trim().toUpperCase();
        const normalizedValue = value.toUpperCase();
        if (!normalizedValue.includes(expectedCode) && (!expectedBatch || !normalizedValue.includes(expectedBatch))) {
          throw new Error(`Material QR does not match ${expectedCode}.`);
        }
      } else {
        const rack = await api.resolveBinQr(value);
        const expectedLocation = String(pickupToConfirm.pick_location || "").trim().toUpperCase();
        const actualLocation = String(rack.location_code || "").trim().toUpperCase();
        const actualBin = String(rack.bin_code || "").trim().toUpperCase();
        const balances = await api.getInventoryLocationBalances(pickupToConfirm.material_code);
        const matchingBalance = balances.find((balance: any) => {
          const balanceLocation = String(balance.location_code || "").trim().toUpperCase();
          return balanceLocation === actualLocation || balanceLocation.includes(actualBin);
        });
        if (!matchingBalance || Number(matchingBalance.available_quantity || 0) <= 0)
          throw new Error(`BIN QR does not contain available ${pickupToConfirm.material_code}.`);
        if (expectedLocation && actualLocation !== expectedLocation && !expectedLocation.includes(actualBin)) {
          toast.info(`Verified alternate BIN with ${matchingBalance.available_quantity} ${matchingBalance.uom || ""} available.`);
        }
      }
      setPickupQrVerified((current) => ({ ...current, [field]: true }));
      setPickupQrError("");
      toast.success(`${field === "material" ? "Material" : "BIN"} QR verified.`);
      return true;
    } catch (error: any) {
      setPickupQrVerified((current) => ({ ...current, [field]: false }));
      setPickupQrError(error?.message || `${field === "material" ? "Material" : "BIN"} QR could not be verified.`);
      return false;
    }
  };

  const decodeQrUpload = (file: File, field: "material" | "bin") => {
    if (!/image\/(png|jpeg|jpg)/i.test(file.type)) {
      setQrScanError("Upload a PNG, JPG, or JPEG QR image.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return setQrScanError("Could not read the uploaded image.");
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        const decoded = jsQR(pixels.data, pixels.width, pixels.height);
        if (!decoded?.data) {
          setQrScanError(
            `No readable ${field === "material" ? "Material" : "BIN"} QR found in the image.`,
          );
          return;
        }
        setQrScanError("");
        setPutawayScan((current) => ({
          ...current,
          [field === "material" ? "materialQr" : "binQr"]: decoded.data,
        }));
      };
      image.onerror = () => setQrScanError("Could not load the uploaded image.");
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const decodePickupQrUpload = (file: File, field: "material" | "rack") => {
    if (!/image\/(png|jpeg|jpg)/i.test(file.type)) {
      toast.error("Upload a PNG, JPG, or JPEG QR image.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return toast.error("Could not read the uploaded QR image.");
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        const decoded = jsQR(pixels.data, pixels.width, pixels.height);
        if (!decoded?.data)
          return toast.error(`No readable ${field === "material" ? "material" : "rack"} QR found.`);
        setPickupConfirmation((current) => ({
          ...current,
          [field === "material" ? "material_scan" : "zone_scan"]: decoded.data,
        }));
        void verifyPickupQr(field, decoded.data);
      };
      image.onerror = () => toast.error("Could not load the uploaded QR image.");
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const downloadQrValue = async (value: string, title: string) => {
    if (!value.trim()) {
      toast.error(`No ${title.toLowerCase()} value is available to generate a QR.`);
      return;
    }
    try {
      const image = await QRCode.toDataURL(value.trim(), { width: 320, margin: 2 });
      const link = document.createElement("a");
      link.href = image;
      link.download = `${title.replaceAll(" ", "-").toLowerCase()}.png`;
      link.click();
    } catch {
      toast.error(`Unable to generate the ${title.toLowerCase()} QR.`);
    }
  };

  const printBinQr = () => {
    if (!viewBinQrModal || !binQrImage) return;
    const printWindow = window.open("", "_blank", "width=700,height=700");
    if (!printWindow) {
      toast.error("Allow pop-ups to print the bin QR label.");
      return;
    }
    const doc = printWindow.document;
    doc.title = `Bin QR - ${viewBinQrModal.bin_code}`;
    const style = doc.createElement("style");
    style.textContent = "@page { margin: 15mm; } body { font: 16px Arial, sans-serif; color: #000; text-align: center; } img { width: 240px; height: 240px; } h1 { font-size: 24px; } p { margin: 8px 0; }";
    doc.head.appendChild(style);
    const heading = doc.createElement("h1");
    heading.textContent = viewBinQrModal.bin_code;
    doc.body.appendChild(heading);
    const image = doc.createElement("img");
    image.alt = `QR code for ${viewBinQrModal.bin_code}`;
    image.onload = () => {
      printWindow.focus();
      printWindow.print();
    };
    image.onerror = () => {
      printWindow.close();
      toast.error("Unable to load the bin QR for printing.");
    };
    doc.body.appendChild(image);
    const zone = zones.find((item) => String(item.id) === String(viewBinQrModal.zone_id));
    for (const text of [
      viewBinQrModal.qr_identifier,
      `Zone: ${zone?.zone_name || zone?.zone_code || "—"}`,
      `Rack: ${viewBinQrModal.rack || "—"} | Shelf: ${viewBinQrModal.position || "—"}`,
      `Status: ${viewBinQrModal.status || "UNKNOWN"}`,
    ]) {
      const line = doc.createElement("p");
      line.textContent = text;
      doc.body.appendChild(line);
    }
    image.src = binQrImage;
  };

  useEffect(() => {
    let active = true;
    const quantity = Number(putawayScan.quantity);
    setPutawayScanValid(false);
    setMaterialQrVerified(false);
    setBinQrVerified(false);
    if (
      !scanPutawayTask ||
      !putawayScan.materialQr.trim() ||
      !(putawayScan.binQr || "").trim() ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      quantity > Number(scanPutawayTask.quantity || 0) ||
      quantity > scanMaximumQuantity
    )
      return;
    void Promise.allSettled([
      api.resolveGrnQr(putawayScan.materialQr.trim()),
      api.resolveBinQr((putawayScan.binQr || "").trim(), scanPutawayTask.destination_warehouse_ref_id),
    ])
      .then(([materialResult, rackResult]) => {
        if (materialResult.status === "rejected") {
          throw new Error(materialResult.reason?.message || "Material QR could not be resolved.");
        }
        if (rackResult.status === "rejected") {
          throw new Error(rackResult.reason?.message || "BIN QR could not be resolved.");
        }
        const material = materialResult.value;
        const rack = rackResult.value;
        const materialMatches =
          String(material.material_code || "").toUpperCase() ===
            String(scanPutawayTask.item_code || "").toUpperCase() &&
          (!material.putaway_task_id || material.putaway_task_id === scanPutawayTask.id) &&
          (!scanPutawayTask.batch_number ||
            String(material.batch_lot_number || "").toUpperCase() ===
              String(scanPutawayTask.batch_number).toUpperCase());
        const rackMatches =
          (!scanPutawayTask.destination_bin_id ||
            rack.bin_id === scanPutawayTask.destination_bin_id) &&
          String(rack.bin_code || "").toUpperCase() ===
            String(
              scanPutawayTask.destination_bin_code ||
                scanPutawayTask.destination_bin ||
                rack.bin_code,
            ).toUpperCase();
        if (active) {
          setMaterialQrVerified(materialMatches);
          setBinQrVerified(rackMatches);
          setPutawayScanValid(materialMatches && rackMatches);
          if (!materialMatches && !rackMatches)
            setQrScanError("Material QR batch and BIN QR do not match this putaway task.");
          else if (!materialMatches)
            setQrScanError(
              `Material QR does not match batch ${scanPutawayTask.batch_number || "the assigned batch"}.`,
            );
          else if (!rackMatches)
            setQrScanError(
              `BIN QR does not match assigned bin ${scanPutawayTask.destination_bin_code || scanPutawayTask.destination_bin || "the assigned bin"}.`,
            );
        }
      })
      .catch((error: any) => {
        if (active) {
          setMaterialQrVerified(false);
          setBinQrVerified(false);
          setPutawayScanValid(false);
          setQrScanError(error?.message || "QR validation failed.");
        }
      });
    return () => {
      active = false;
    };
  }, [scanPutawayTask, putawayScan.materialQr, putawayScan.binQr, putawayScan.quantity, scanMaximumQuantity]);

  useEffect(() => {
    if (!scanPutawayTask) {
      setPutawayQrImages({ material: "", bin: "" });
      return;
    }
    let active = true;
    const assignedBin = allFlattenedBins.find(
      (bin) =>
        bin.id === scanPutawayTask.destination_bin_id ||
        bin.bin_code === scanPutawayTask.destination_bin_code,
    );
    const previewMaterialQr =
      putawayScan.materialQr.trim() ||
      scanPutawayTask.material_qr ||
      (scanPutawayTask.batch_number ? `QR-BATCH-${scanPutawayTask.batch_number}` : "") ||
      scanPutawayTask.barcode_value ||
      "";
    const previewRackQr =
      assignedBin?.qr_identifier ||
      scanPutawayTask.destination_bin_code ||
      scanPutawayTask.destination_bin ||
      (putawayScan.binQr || "").trim() ||
      "";
    void Promise.all([
      previewMaterialQr
        ? QRCode.toDataURL(previewMaterialQr, { width: 180, margin: 1 })
        : Promise.resolve(""),
      previewRackQr
        ? QRCode.toDataURL(previewRackQr, { width: 180, margin: 1 })
        : Promise.resolve(""),
    ])
      .then(([material, rack]) => {
        if (active) setPutawayQrImages({ material, bin: rack });
      })
      .catch(() => {
        if (active) setPutawayQrImages({ material: "", bin: "" });
      });
    return () => {
      active = false;
    };
  }, [scanPutawayTask, putawayScan.materialQr, putawayScan.binQr, allFlattenedBins]);

  const handleConfirmPutaway = async () => {
    if (!scanPutawayTask) return;
    const quantity = Number(putawayScan.quantity);
    if (
      !putawayScan.materialQr.trim() ||
      !(putawayScan.binQr || "").trim() ||
      !Number.isFinite(quantity) ||
      quantity <= 0
    ) {
      toast.error("Scan the material QR and BIN QR, then enter a valid quantity.");
      return;
    }
    if (quantity > scanMaximumQuantity) {
      toast.error(`This rack can currently store only ${scanMaximumQuantity} ${scanPutawayTask.uom || "PCS"}.`);
      return;
    }
    setIsSubmitting(true);
    try {
      const resolved = await api.resolveGrnQr(putawayScan.materialQr.trim());
      if (resolved.putaway_task_id && resolved.putaway_task_id !== scanPutawayTask.id) {
        throw new Error("The scanned material does not match this putaway task.");
      }
      if (
        String(resolved.material_code || "").toUpperCase() !==
        String(scanPutawayTask.item_code || "").toUpperCase()
      ) {
        throw new Error("The scanned material does not match this putaway task.");
      }
      const rack = await api.resolveBinQr(
        (putawayScan.binQr || "").trim(),
        scanPutawayTask.destination_warehouse_ref_id,
      );
      if (
        scanPutawayTask.destination_bin_id &&
        rack.bin_id !== scanPutawayTask.destination_bin_id
      ) {
        throw new Error(
          `Wrong BIN. Scan ${scanPutawayTask.destination_bin_code || scanPutawayTask.destination_bin}.`,
        );
      }
      await api.executePutaway({
        task_id: scanPutawayTask.id,
        grn_qr_code: putawayScan.materialQr.trim(),
        bin_qr_code: (putawayScan.binQr || "").trim(),
        quantity,
        batch_number: scanPutawayTask.batch_number || undefined,
      });
      toast.success("Putaway confirmed and inventory updated.");
      setScanPutawayTask(null);
      await fetchData(true);
    } catch (err: any) {
      toast.error(err.message || "Putaway confirmation failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Action: Approve Material Request
  const handleApproveMaterialRequest = async (req: any) => {
    const reqQty = Number(req.quantity ?? req.required_quantity ?? 0);
    const availQty = Number(req.available_quantity ?? req.available ?? 0);

    if (availQty < reqQty) {
      toast.error(
        `Insufficient stock. Requested: ${reqQty} ${req.uom || ""}, available: ${availQty} ${req.uom || ""}, shortage: ${reqQty - availQty} ${req.uom || ""}.`,
      );
      return;
    }

    setIsSubmitting(true);
    try {
      await api.approveAssemblyMaterialRequest(req.id || req.request_number);
      toast.success(
        `Approved Material Request ${req.request_number || req.id}. Stock verified; picking can now begin.`,
      );
      void fetchData();
    } catch (err: any) {
      toast.error(err.message || "Failed to approve request");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePartialApproveMaterialRequest = async (req: any) => {
    const requestItems = Array.isArray(req.items) ? req.items : [req];
    const approvedItems = requestItems
      .map((item: any) => ({
        material_code: item.material_code,
        approved_quantity: Math.min(
          Number(item.required_quantity ?? item.quantity ?? 0),
          Number(item.available_quantity ?? item.available ?? 0),
        ),
      }))
      .filter((item: any) => item.approved_quantity > 0);
    if (!approvedItems.length) {
      toast.error("No available stock can be approved for this request.");
      return;
    }
    setIsSubmitting(true);
    try {
      await api.approveAssemblyMaterialRequest(req.id || req.request_number, {
        approved_items: approvedItems,
        remarks: "Partially approved against current available stock.",
      });
      toast.success(`Partially approved ${req.request_number || req.id}.`);
      void fetchData();
    } catch (err: any) {
      toast.error(err.message || "Failed to partially approve request");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRejectMaterialRequest = async (req: any) => {
    const reason = window.prompt("Reason for rejecting this material request:");
    if (!reason?.trim()) return;
    setIsSubmitting(true);
    try {
      await api.rejectAssemblyMaterialRequest(req.id || req.request_number, reason.trim());
      toast.success(`Rejected Material Request ${req.request_number || req.id}.`);
      void fetchData();
    } catch (err: any) {
      toast.error(err.message || "Failed to reject request");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Action: Complete Pickup Task
  const handleCompletePickup = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!pickupToConfirm) return;
    setIsSubmitting(true);
    try {
      if (pickupToConfirm.assembly_pick_task_id) {
        await api.completeAssemblyPickingTask(pickupToConfirm.assembly_pick_task_id, {
          material_scan: pickupConfirmation.material_scan.trim(),
          zone_scan: pickupConfirmation.zone_scan.trim(),
          quantity: Number(pickupConfirmation.quantity),
        });
      } else {
        await api.completePickupTask(pickupToConfirm.id, {
          material_scan: pickupConfirmation.material_scan.trim(),
          zone_scan: pickupConfirmation.zone_scan.trim(),
          quantity: Number(pickupConfirmation.quantity),
        });
      }
      toast.success("Pick confirmed and inventory updated.");
      setPickupToConfirm(null);
      setPickupConfirmation({ material_scan: "", zone_scan: "", quantity: "" });
      void fetchData();
    } catch (err: any) {
      if (String(err.message || "").toUpperCase().includes("FIFO:")) {
        setPickupFifoAlert(String(err.message).replace(/^.*FIFO:\s*/is, ""));
      }
      toast.error(err.message || "Failed to complete pickup task");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Location codes are scoped to zones; the legacy warehouse parent stays internal.
  const openCreateZone = async () => {
    try {
      const nextZone = await api.getNextLocationZoneCode();
      setEditingZone(null);
      setNewZoneForm({ zone_code: nextZone.suggested_zone_code, zone_name: "" });
      setCreateLocationType("zone");
    } catch (err: any) {
      toast.error(err.message || "Unable to generate the next zone code.");
    }
  };

  const openCreateBin = async (zone: any) => {
    if (!zone || String(zone.status || "ACTIVE").toUpperCase() !== "ACTIVE") {
      toast.error("Bins can only be added to an active zone.");
      return;
    }
    try {
      const nextCode = await api.getNextBinCode(zone.id);
      setNewBinForm({ zone_id: zone.id });
      setNewBinRows([{ rack: nextCode.suggested_rack_code, position: "", capacity: "", bin_code: nextCode.suggested_bin_code }]);
    } catch (err: any) {
      toast.error(err.message || "Unable to prepare the next bin code.");
      return;
    }
    setCreateLocationType("bin");
  };

  // Action: Create Location Sub-Form (Zone, Bin)
  const handleCreateLocationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      if (createLocationType === "zone") {
        const zoneName = newZoneForm.zone_code;
        if (!newZoneForm.zone_code) {
          toast.error("A zone code could not be generated. Close and reopen this form.");
          return;
        }
        const generatedZoneCode = newZoneForm.zone_code;
        if (editingZone) {
          await api.updateZone(String(editingZone.id), { zone_name: zoneName });
          toast.success(`Zone ${generatedZoneCode} updated.`);
        } else {
          if (!warehouses.length && (!firstWarehouse.name.trim() || !firstWarehouse.location.trim())) {
            toast.error("Enter the warehouse name and location / plant for the first zone.");
            return;
          }
          const createdZone = await api.createLocationZone({
            zone_name: zoneName,
            zone_code: generatedZoneCode,
            ...(!warehouses.length ? {
              warehouse_name: firstWarehouse.name.trim(), warehouse_id: firstWarehouse.location.trim(),
            } : {}),
          });
          toast.success(
            `Zone created: ${createdZone?.zone_name || newZoneForm.zone_name} (${createdZone?.zone_code || generatedZoneCode || "auto-generated"})`,
          );
        }
        setNewZoneForm({ zone_code: "", zone_name: "" });
        setEditingZone(null);
      } else if (createLocationType === "bin") {
        const row = newBinRows[0];
        if (
          !newBinForm.zone_id ||
          !row.rack.trim() ||
          !Number.isSafeInteger(Number(row.capacity)) || Number(row.capacity) <= 0 ||
          !row.bin_code.trim()
        ) {
          toast.error("Enter a positive whole Maximum Capacity (PCS). Reopen the form if codes are missing.");
          return;
        }
        if (
          row.rack.trim().length > 64 ||
          row.bin_code.trim().length > 64 ||
          !isValidIdentifier(row.rack) ||
          !isValidIdentifier(row.bin_code)
        ) {
          toast.error("Rack and bin codes must be 1–64 characters using letters, numbers, underscores, or hyphens.");
          return;
        }
        const existingBins = await api.getZoneBins(newBinForm.zone_id);
        const normalizedBinCode = row.bin_code.trim().toUpperCase();
        const normalizedRack = row.rack.trim().toUpperCase();
        if ((existingBins || []).some((b: any) => String(b.bin_code).toUpperCase() === normalizedBinCode)) {
          toast.error(`Bin code '${row.bin_code}' already exists in this zone.`);
          return;
        }
        if (
          (existingBins || []).some(
            (b: any) =>
              String(b.rack || "").toUpperCase() === normalizedRack,
          )
        ) {
          toast.error("This rack already exists in the zone. Use Add Material.");
          return;
        }
        const zone = zones.find((z) => z.id === newBinForm.zone_id);
        if (!zone) {
          toast.error("The selected zone no longer exists. Refresh and try again.");
          return;
        }
        await api.createBin(newBinForm.zone_id, {
          bin_code: normalizedBinCode,
          bin_name: normalizedBinCode,
          capacity: Number(row.capacity),
          qr_identifier: `QR-${normalizedBinCode}`,
        });
        toast.success(`Rack ${normalizedRack} created with capacity ${row.capacity} PCS.`);
      }
      setCreateLocationType(null);
      await fetchData(true);
    } catch (err: any) {
      toast.error(err.message || "Failed to create location entity");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filtered Inventory List
  const filteredInventory = useMemo(() => {
    return inventorySummary.filter((item) => {
      const matchesSearch =
        !invSearch ||
        (item.material_name || item.material || "")
          .toLowerCase()
          .includes(invSearch.toLowerCase()) ||
        (item.material_code || "").toLowerCase().includes(invSearch.toLowerCase()) ||
        (item.batch_number || item.batch || "").toLowerCase().includes(invSearch.toLowerCase());

      const matchesWarehouse =
        true;

      const matchesStatus = invStatusFilter === "ALL" || item.status === invStatusFilter;

      return matchesSearch && matchesWarehouse && matchesStatus;
    });
  }, [inventorySummary, invSearch, invWarehouseFilter, invStatusFilter]);

  const getInventoryDisplayQuantity = (item: any) => {
    const batches = Array.isArray(item.batch_details) ? item.batch_details : [];
    const batchTotal = batches.reduce(
      (sum: number, batch: any) => sum + Number(batch.quantity || 0),
      0,
    );
    const summaryQuantity =
      item.available_to_pick_quantity ??
      item.available ??
      item.available_quantity ??
      item.total_quantity;
    return Number(summaryQuantity || 0) === 0 && batchTotal > 0
      ? batchTotal
      : (summaryQuantity ?? "—");
  };

  const getInventoryDisplayLocation = (item: any) =>
    item.location_code ||
    item.bin_code ||
    item.location ||
    item.batch_details?.[0]?.location ||
    "—";

  // Dashboard Aggregates (Real backend numbers)
  const pendingPutawayCount = putawayTasks.filter(
    (t) => t.status === "PENDING" || t.status === "CREATED",
  ).length;
  const pendingRequestsCount = materialRequests.filter(
    (r) => ["PENDING", "SUBMITTED", "PENDING_WAREHOUSE_APPROVAL"].includes(String(r.status || "").toUpperCase()),
  ).length;
  const pendingPickingCount = pickupTasks.filter(
    (p) => p.status === "PENDING" || p.status === "IN_PROGRESS",
  ).length;
  const statusChart = (rows: any[], statuses: string[]) => statuses.map((status) => ({
    label: status.replaceAll("_", " "),
    value: rows.filter((row) => String(row.status || "").toUpperCase() === status).length,
  }));
  const stockChart = inventorySummary.map((item: any) => ({
    label: String(item.material_code || item.code || item.material_name || "Material"),
    value: Math.max(0, Number(item.available_quantity ?? item.available ?? 0) || 0),
  })).sort((a, b) => b.value - a.value).slice(0, 7);
  const warehouseKpiCharts = {
    stock: stockChart,
    putaway: statusChart(putawayTasks, ["PENDING", "CREATED", "IN_PROGRESS", "COMPLETED", "STORED"]),
    requests: statusChart(materialRequests, ["PENDING", "SUBMITTED", "PENDING_WAREHOUSE_APPROVAL", "APPROVED", "REJECTED"]),
    picks: statusChart(pickupTasks, ["PENDING", "IN_PROGRESS", "COMPLETED"]),
  };

  const pendingDockAllocationsCount = dockRequests.length;
  const availableDocksCount = docks.filter((d) => d.status === "AVAILABLE").length;
  const occupiedDocksCount = docks.filter((d) => ["OCCUPIED", "RESERVED"].includes(d.status)).length;
  const totalDocksCount = docks.length;
  const groupedPutawayTasks = useMemo(() => {
    const groups = new Map<string, any>();
    for (const task of putawayTasks) {
      const key =
        task.grn_number ||
        task.grnNumber ||
        (task.grn_id ? `grn:${task.grn_id}` : undefined) ||
        task.order_number ||
        task.asn_number ||
        task.asnNumber ||
        task.id;
      const group = groups.get(key) || {
        key,
        grn_number: task.grn_number || task.grnNumber,
        asn_number: task.asn_number || task.asnNumber,
        tasks: [],
        batches: new Set<string>(),
        materials: new Set<string>(),
        quantity: 0,
        uom: task.uom || "",
        status: task.status,
      };
      group.tasks.push(task);
      if (task.batch_number || task.batchNumber)
        group.batches.add(task.batch_number || task.batchNumber);
      if (task.material_name || task.item_code)
        group.materials.add(task.material_name || task.item_code);
      group.quantity += Number(
        task.stored_quantity ?? task.quantity ?? task.received_quantity ?? 0,
      );
      if (task.status !== "COMPLETED" && task.status !== "STORED") group.status = task.status;
      groups.set(key, group);
    }
    return Array.from(groups.values()).map((group) => ({
      ...group,
      batch_count: group.batches.size,
      material_count: group.materials.size,
      material_names: Array.from(group.materials),
      batch_details: group.tasks.map((task: any) => ({
        batch_number: task.batch_number || task.batchNumber || "-",
        quantity: task.stored_quantity ?? task.quantity ?? task.received_quantity ?? 0,
        uom: task.uom || "PCS",
      })),
      status: group.tasks.every((task: any) =>
        ["COMPLETED", "PUTAWAY_COMPLETED", "STORED"].includes(
          String(task.status || "").toUpperCase(),
        ),
      )
        ? "COMPLETED"
        : group.tasks.some(
              (task: any) => String(task.status || "").toUpperCase() === "PARTIALLY_COMPLETED",
            )
          ? "PARTIALLY_COMPLETED"
          : group.tasks.every(
                (task: any) =>
                  task.destination_bin_id || task.destination_bin_code || task.destination_bin,
              )
            ? "ASSIGNED"
            : "PENDING",
    }));
  }, [putawayTasks]);
  const visiblePutawayBatches = (selectedPutawayGroup?.tasks || []).filter((task: any) =>
    putawayView === "assign" ? canAssignPutaway(task) : putawayView === "scan" ? canScanPutaway(task) : true);
  const visiblePutawayMaterials = new Set(visiblePutawayBatches.map((task: any) => task.item_code || task.material_name)).size;
  const visiblePutawayQuantity = visiblePutawayBatches.reduce((total: number, task: any) =>
    total + (putawayView === "assign" ? unassignedPutawayQuantity(task) : Number(task.quantity || 0)), 0);
  const putawayStage = (status: string) => ["COMPLETED", "STORED"].includes(status)
    ? "COMPLETED" : ["IN_PROGRESS", "ASSIGNED", "PARTIALLY_COMPLETED"].includes(status) ? "IN_PROGRESS" : "PENDING";
  const putawayStageCounts = groupedPutawayTasks.reduce((counts, task) => {
    counts[putawayStage(task.status)] += 1;
    return counts;
  }, { PENDING: 0, IN_PROGRESS: 0, COMPLETED: 0 } as Record<string, number>);
  const filteredPutawayTasks = groupedPutawayTasks.filter((task) => {
    const query = putawaySearch.trim().toLowerCase();
    const searchable = [task.grn_number, task.key, ...(task.material_names || []),
      ...task.tasks.flatMap((item: any) => [item.batch_number, item.item_code, ...assignedPutawayLocations(item)])];
    return (!query || searchable.some((value) => String(value || "").toLowerCase().includes(query)))
      && (putawayStatus === "ALL" || putawayStage(task.status) === putawayStatus)
      && (putawayBatchFilter === "ALL" || (putawayBatchFilter === "MULTIPLE" ? task.batch_count > 1 : task.batch_count === 1));
  });
  const totalAvailableStock = inventorySummary.reduce(
    (acc, i) => acc + Number(i.available || i.available_quantity || 0),
    0,
  );
  const handleAllocateDockFromLocations = async (requestId: string) => {
    const dockId = dockChoices[requestId];
    const warehouseRefId = warehouses[0]?.id;
    if (!dockId) {
      toast.error("Select an available dock and warehouse for this gate entry.");
      return;
    }
    setIsSubmitting(true);
    try {
      await api.allocateDock(requestId, dockId, { assignedWarehouseRefId: warehouseRefId });
      toast.success("Dock allocated. Gate Entry has been notified.");
      await fetchData(true);
    } catch (error: any) {
      toast.error(error.message || "Unable to allocate dock");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReleaseDockFromLocations = async (dock: any) => {
    const allocationId = dock.current_allocation?.id;
    if (!allocationId) {
      toast.error("No active allocation is linked to this dock.");
      return;
    }
    setIsSubmitting(true);
    try {
      await api.releaseDock(allocationId);
      toast.success("Dock released. Gate Entry has been notified that it is empty.");
      await fetchData(true);
    } catch (error: any) {
      toast.error(error.message || "Unable to release dock");
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedInventoryBatches = useMemo(() => {
    const batches = [...(selectedInventory?.batch_details || [])];
    const timestamp = (batch: any) => {
      const parsed = Date.parse(batch.received_at || batch.created_at || batch.mfg_date || "");
      if (!Number.isNaN(parsed)) return parsed;
      const compactDate = String(batch.batch_number || "").match(/20\d{6}/)?.[0];
      if (compactDate) {
        const date = Date.parse(`${compactDate.slice(0, 4)}-${compactDate.slice(4, 6)}-${compactDate.slice(6, 8)}`);
        if (!Number.isNaN(date)) return date;
      }
      return Number.MAX_SAFE_INTEGER;
    };
    return batches.sort((a, b) => timestamp(a) - timestamp(b) || String(a.batch_number || "").localeCompare(String(b.batch_number || "")));
  }, [selectedInventory]);
  const visibleInventoryBatches = selectedInventoryBatchCode
    ? selectedInventoryBatches.filter((batch: any) => batch.batch_number === selectedInventoryBatchCode)
    : selectedInventoryBatches;
  const openInventoryBatchDetails = async (item: any) => {
    setSelectedInventoryBatchCode(null);
    setSelectedInventory(item);
    try {
      const detail: any = await api.getMaterialInventoryDetail(String(item.material_code || ""));
      const putawayMovements = (Array.isArray(detail?.movements) ? detail.movements : []).filter(
        (movement: any) => movement.movement_type === "PUTAWAY" && movement.batch_lot,
      );
      const movementBatches = putawayMovements.map((movement: any) => ({
        batch_number: movement.batch_lot,
        quantity: movement.quantity,
        uom: movement.uom || detail?.summary?.uom,
        location: movement.to_location || movement.location_code,
        received_at: movement.performed_at,
      }));
      setSelectedInventory((current: any) => current ? {
        ...current,
        batch_details: movementBatches.length ? movementBatches : detail?.batches || current.batch_details,
        bin_code: movementBatches[0]?.location || current.bin_code,
        location: movementBatches[0]?.location || current.location,
        inventory_history: detail?.inventory_history,
        total_quantity: detail?.summary?.total_stock ?? current.total_quantity,
        available: detail?.summary?.available_stock ?? current.available,
        uom: detail?.summary?.uom || current.uom,
      } : current);
    } catch {
      // Keep the row details available if the per-material request fails.
    }
  };
  const oldestAvailableBatch = selectedInventoryBatches.find((batch: any) =>
    Number(batch.quantity ?? batch.available_quantity ?? 0) > 0,
  );
  const inventoryBatchQrValue = (batch: any) =>
    batch.qr_payload || batch.qr_code || batch.material_qr ||
    (batch.batch_number ? `QR-BATCH-${batch.batch_number}` : selectedInventory?.material_code || "");
  const previewInventoryBatchQr = async (batch: any) => {
    const value = inventoryBatchQrValue(batch);
    if (!value) {
      toast.error("No material or batch code is available for this QR.");
      return;
    }
    try {
      const image = await QRCode.toDataURL(value, { width: 320, margin: 2 });
      setQrPreview({ title: `Material QR ${batch.batch_number || selectedInventory?.material_code || ""}`.trim(), image });
    } catch {
      toast.error("Unable to generate the material QR.");
    }
  };

  return (
    <AppShell activeItem="/inventory">
      <div className="warehouse-module-content space-y-5" data-warehouse-tab={activeTab}>
        {/* Header Title Bar */}
        <div className="warehouse-module-hero relative isolate flex min-h-[164px] flex-col justify-center gap-4 overflow-hidden rounded-2xl px-6 py-5 md:flex-row md:items-center md:justify-between md:px-8">
          <div aria-hidden="true" className="warehouse-hero-image absolute inset-0 -z-20 bg-cover bg-[center_43%]" style={{ backgroundImage: `url(${warehouseHero})` }} />
          <div aria-hidden="true" className="warehouse-hero-overlay absolute inset-0 -z-10" />
          <div className="relative max-w-3xl text-white">
            <p hidden={activeTab === "putaway" || activeTab === "inventory" || activeTab === "picking" || activeTab === "locations"} className="warehouse-hero-eyebrow text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-200">
              Warehouse Control <span className="px-1 text-blue-300/70">/</span> {pageHeader[activeTab].eyebrow}
            </p>
            <h1 className="mt-2 flex items-center gap-2.5 text-[25px] font-semibold tracking-tight md:text-[28px]">
              <PageHeaderIcon className="h-6 w-6 text-[#71b5ff]" />
              <span className="inline-flex items-center">{pageHeader[activeTab].title}<InformationTooltip help={inventoryHelp[activeTab]} placement="title" className="text-blue-100 hover:text-white" /></span>
            </h1>
            <p className="mt-1.5 text-sm text-blue-50/85">
              {pageHeader[activeTab].description}
            </p>
          </div>
          <div className="warehouse-hero-actions flex items-center gap-2">
            {activeTab === "picking" && (
              <Button
                data-pickup-history="true"
                variant="outline"
                size="sm"
                onClick={() => setShowPickupHistory(true)}
                className="gap-2 border-primary bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:text-primary-foreground"
              >
                <History className="size-4" /> History
                <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] text-primary-foreground">
                  {pickupTasks.filter((task) => ["COMPLETED", "PICKED", "ISSUED"].includes(String(task.status || "").toUpperCase())).length}
                </span>
              </Button>
            )}
            <Button data-refresh-control="true"
              variant="outline"
              size="icon"
              onClick={() => { void fetchData(); if (activeTab === "picking") setRequisitionRefreshKey((value) => value + 1); }}
              title={`Refresh ${pageHeader[activeTab].title}`}
              aria-label={`Refresh ${pageHeader[activeTab].title}`}
              className="border-white/35 bg-white/10 text-white hover:bg-white/20 hover:text-white"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
          </div>
        </div>

        {/* 7 Simple Warehouse Navbar Sub-Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={(v) => handleTabChange(v as TabType)}
          className="w-full"
        >
          {false && (
            <TabsList className="bg-slate-100 dark:bg-slate-900 p-1 rounded-xl flex flex-wrap gap-1 w-full justify-start border border-slate-200 dark:border-slate-800">
              <TabsTrigger value="dashboard" className="gap-2 px-4 py-2 text-xs font-semibold">
                <Boxes className="h-4 w-4" />
                Dashboard
              </TabsTrigger>
              <TabsTrigger value="putaway" className="gap-2 px-4 py-2 text-xs font-semibold">
                <PackageCheck className="h-4 w-4" />
                Putaway
                {pendingPutawayCount > 0 && (
                  <Badge
                    variant="secondary"
                    className="ml-1 bg-amber-500/15 text-amber-700 dark:text-amber-400 font-bold px-1.5 py-0.2"
                  >
                    {pendingPutawayCount}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="inventory" className="gap-2 px-4 py-2 text-xs font-semibold">
                <Boxes className="h-4 w-4" />
                Inventory
              </TabsTrigger>
              <TabsTrigger value="requests" className="gap-2 px-4 py-2 text-xs font-semibold">
                <ClipboardList className="h-4 w-4" />
                Material Requests
                {pendingRequestsCount > 0 && (
                  <Badge
                    variant="secondary"
                    className="ml-1 bg-blue-500/15 text-blue-700 dark:text-blue-400 font-bold px-1.5 py-0.2"
                  >
                    {pendingRequestsCount}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="picking" className="gap-2 px-4 py-2 text-xs font-semibold">
                <ListOrdered className="h-4 w-4" />
                Picking
                {pendingPickingCount > 0 && (
                  <Badge
                    variant="secondary"
                    className="ml-1 bg-indigo-500/15 text-indigo-700 dark:text-indigo-400 font-bold px-1.5 py-0.2"
                  >
                    {pendingPickingCount}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="locations" className="gap-2 px-4 py-2 text-xs font-semibold">
                <Building2 className="h-4 w-4" />
                Locations
              </TabsTrigger>
            </TabsList>
          )}

          {/* ========================================================================= */}
          {/* 1. DASHBOARD TAB */}
          {/* ========================================================================= */}
          <TabsContent value="dashboard" className="mt-5 space-y-4">
            <div className="warehouse-dashboard-kpis grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
              {([
                { label: "Available stock", value: totalAvailableStock.toLocaleString(), help: "availableStockKpi", Icon: CheckCircle2, tone: "stock" },
                { label: "Putaway to do", value: pendingPutawayCount, help: "putawayKpi", Icon: PackageCheck, tone: "putaway" },
                { label: "Requests to review", value: pendingRequestsCount, help: "requestsReviewKpi", Icon: ClipboardList, tone: "requests" },
                { label: "Picks to complete", value: pendingPickingCount, help: "picksCompleteKpi", Icon: ListOrdered, tone: "picks" },
              ] as const).map(({ label, value, help, Icon, tone }) => (
                <Card key={tone} className="warehouse-dashboard-kpi" data-tone={tone}>
                  <div className="warehouse-dashboard-kpi-icon"><Icon aria-hidden="true" /></div>
                  <div className="warehouse-dashboard-kpi-copy min-w-0">
                    <div className="warehouse-dashboard-kpi-label flex items-start gap-1"><span className="text-sm font-medium">{label}</span><InformationTooltip help={help} /></div>
                    <p className="mt-1 text-[32px] font-bold leading-tight tabular-nums">{value}</p>
                  </div>
                  <div className="warehouse-dashboard-kpi-chart" role="img"
                    aria-label={`${label}: ${warehouseKpiCharts[tone].map((bar) => `${bar.label}: ${bar.value}`).join(", ") || "No data"}`}>
                    {warehouseKpiCharts[tone].length === 0 ? <span className="warehouse-kpi-empty" title="No stock records" /> :
                      warehouseKpiCharts[tone].map((bar, index, bars) => (
                        <span key={`${bar.label}-${index}`} title={`${bar.label}: ${bar.value}`}
                          style={{ height: `${bar.value > 0 ? Math.max(12, bar.value / Math.max(1, ...bars.map((item) => item.value)) * 100) : 3}%`, opacity: bar.value > 0 ? 0.5 + index / Math.max(1, bars.length - 1) * 0.5 : 0.15 }} />
                      ))}
                  </div>
                </Card>
              ))}
            </div>

            {/* Horizontal Dock Allocation Status Banner */}
            <div
              data-dock-allocation={pendingDockAllocationsCount > 0 ? "waiting" : "clear"}
              role="button"
              tabIndex={0}
              onClick={() => navigate({ to: "/dock-management" })}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  navigate({ to: "/dock-management" });
                }
              }}
              title={
                pendingDockAllocationsCount > 0
                  ? "Docks need to be allocated! Click to open Dock Allocation."
                  : "Click to open Dock Management & Allocation."
              }
              aria-label={
                pendingDockAllocationsCount > 0
                  ? `${pendingDockAllocationsCount} vehicle allocations pending. Click to open dock allocation.`
                  : "Dock allocation status operational. Click to open dock management."
              }
              className={cn(
                "group relative flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border p-4 sm:px-5 sm:py-3.5 transition-all duration-300 cursor-pointer shadow-xs hover:shadow-md",
                pendingDockAllocationsCount > 0
                  ? "animate-dock-blink border-red-400 bg-gradient-to-r from-red-500/15 via-red-500/10 to-red-500/15 text-red-950 dark:border-red-500/70 dark:bg-red-950/40 dark:text-red-100 ring-2 ring-red-400/40"
                  : "border-emerald-200 bg-emerald-50 text-emerald-900 hover:border-emerald-300 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100"
              )}
            >
              <div className="flex items-center gap-3.5">
                <div
                  className={cn(
                    "flex size-11 shrink-0 items-center justify-center rounded-xl border transition-transform duration-300 group-hover:scale-105",
                    pendingDockAllocationsCount > 0
                      ? "border-red-400 bg-red-500 text-white shadow-sm"
                      : "border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                  )}
                >
                  <Truck className="size-5" />
                </div>
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Dock Allocation Status
                    </span>
                    {pendingDockAllocationsCount > 0 ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/20 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-red-900 dark:text-red-200 border border-red-400/50 animate-dock-badge-blink">
                        <span className="relative flex h-2 w-2">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-red-600" />
                        </span>
                        Allocation Required ({pendingDockAllocationsCount})
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800 dark:text-emerald-300 border border-emerald-300/60 dark:border-emerald-800">
                        <CheckCircle2 className="size-3 text-emerald-600 dark:text-emerald-400" />
                        No Vehicles Waiting
                      </span>
                    )}
                  </div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {pendingDockAllocationsCount > 0 ? (
                      <span>
                        {pendingDockAllocationsCount}{" "}
                        {pendingDockAllocationsCount === 1 ? "vehicle" : "vehicles"}{" "}
                        waiting for dock assignment
                        {dockRequests[0]?.vehicle_number && (
                          <span className="ml-1 font-mono font-normal text-xs text-red-900/80 dark:text-red-200/80">
                            (Latest: {dockRequests[0].vehicle_number})
                          </span>
                        )}
                      </span>
                    ) : (
                      <span>
                        All approved vehicles assigned · {availableDocksCount} of {totalDocksCount} docks available
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {pendingDockAllocationsCount > 0
                      ? `${availableDocksCount} dock${availableDocksCount === 1 ? "" : "s"} ready for allocation. Click to open dock allocation.`
                      : `Active utilization: ${occupiedDocksCount} occupied / in-service. Click to open dock management.`}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2 self-end sm:self-center">
                <Button
                  size="sm"
                  variant={pendingDockAllocationsCount > 0 ? "default" : "outline"}
                  className={cn(
                    "pointer-events-none rounded-lg text-xs font-semibold shadow-xs transition-colors",
                    pendingDockAllocationsCount > 0
                      ? "bg-red-600 hover:bg-red-700 text-white border-transparent"
                      : "border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300"
                  )}
                  tabIndex={-1}
                >
                  <span>{pendingDockAllocationsCount > 0 ? "Allocate Dock" : "Manage Docks"}</span>
                  <ArrowRight className="ml-1.5 size-3.5 transition-transform duration-200 group-hover:translate-x-1" />
                </Button>
              </div>
            </div>


            <div className="warehouse-dashboard-panels grid grid-cols-1 gap-4 xl:grid-cols-2">
              <Card className="rounded-xl border-sky-200 bg-gradient-to-br from-sky-50 via-white to-blue-50/60 p-5 shadow-sm dark:border-sky-900/60 dark:bg-sky-950/20">
                <div className="mb-4 flex items-start justify-between gap-3"><div><h2 className="font-bold text-slate-900 dark:text-slate-100">Warehouse locations</h2><p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Your zones and storage bins</p></div><Building2 className="size-5 text-sky-700" /></div>
                <div className="flex gap-3">
                  <div className="min-w-28 flex-1 rounded-lg border border-blue-200 bg-blue-100/70 p-3"><p className="text-xs font-semibold uppercase text-blue-800">Zones</p><p className="mt-1 text-2xl font-bold text-blue-950">{zones.length}</p></div>
                  <div className="min-w-28 flex-1 rounded-lg border border-teal-200 bg-teal-100/70 p-3"><p className="text-xs font-semibold uppercase text-teal-800">Bins</p><p className="mt-1 text-2xl font-bold text-teal-950">{bins.length}</p></div>
                </div>
                <Button size="sm" variant="outline" className="mt-4 border-sky-300 bg-white hover:bg-sky-100" onClick={() => handleTabChange("locations")}>View zones and bins</Button>
              </Card>

              <Card className="rounded-xl border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-violet-50/60 p-5 shadow-sm dark:border-indigo-900/60 dark:bg-indigo-950/20">
                <div className="mb-4 flex items-start justify-between gap-3"><div><h2 className="font-bold text-slate-900 dark:text-slate-100">What needs attention</h2><p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Open work, grouped by task</p></div><ClipboardList className="size-5 text-indigo-600" /></div>
                <div className="space-y-2">
                  {[
                    { label: "Putaway tasks", count: pendingPutawayCount, tab: "putaway" as TabType, tone: "border-amber-200 bg-amber-50 text-amber-900" },
                    { label: "Material requests", count: pendingRequestsCount, tab: "requests" as TabType, tone: "border-blue-200 bg-blue-50 text-blue-900" },
                    { label: "Picking tasks", count: pendingPickingCount, tab: "picking" as TabType, tone: "border-violet-200 bg-violet-50 text-violet-900" },
                  ].map((item) => (
                    <button key={item.tab} type="button" onClick={() => handleTabChange(item.tab)} className={`flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm font-semibold transition hover:brightness-[0.98] ${item.tone}`}>
                      <span>{item.label}</span><span className="rounded-full bg-white/80 px-2.5 py-0.5 font-bold tabular-nums">{item.count}</span>
                    </button>
                  ))}
                </div>
              </Card>
            </div>


          </TabsContent>
          <TabsContent value="putaway" className="putaway-overview space-y-4 mt-4">
            <div className="grid gap-4 sm:grid-cols-3">
              {([
                { label: "Pending putaway", status: "PENDING", Icon: PackageCheck, tone: "border-amber-200 bg-amber-50 text-amber-800" },
                { label: "In progress", status: "IN_PROGRESS", Icon: RefreshCw, tone: "border-blue-200 bg-blue-50 text-blue-800" },
                { label: "Completed", status: "COMPLETED", Icon: CheckCircle2, tone: "border-emerald-200 bg-emerald-50 text-emerald-800" },
              ] as const).map(({ label, status, Icon, tone }) => (
                <button key={status} type="button" onClick={() => setPutawayStatus(putawayStatus === status ? "ALL" : status)}
                  aria-pressed={putawayStatus === status}
                  className={`flex items-center gap-4 rounded-xl border p-4 text-left ${tone} ${putawayStatus === status ? "ring-2 ring-primary" : ""}`}>
                  <Icon className="size-8 shrink-0" />
                  <span><span className="block text-sm font-medium">{label}</span><span className="mt-1 block text-2xl font-bold tabular-nums">{putawayStageCounts[status]}</span></span>
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-3 md:flex-row">
              <div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={putawaySearch} onChange={(event) => setPutawaySearch(event.target.value)} placeholder="Search by GRN, material, batch or rack?" aria-label="Search putaway tasks" className="pl-9" /></div>
              <select aria-label="Filter putaway status" value={putawayStatus} onChange={(event) => setPutawayStatus(event.target.value)} className="h-10 rounded-lg border bg-card px-3"><option value="ALL">All statuses</option><option value="PENDING">Pending putaway</option><option value="IN_PROGRESS">In progress</option><option value="COMPLETED">Completed</option></select>
              <select aria-label="Filter putaway batches" value={putawayBatchFilter} onChange={(event) => setPutawayBatchFilter(event.target.value)} className="h-10 rounded-lg border bg-card px-3"><option value="ALL">All batches</option><option value="SINGLE">Single batch</option><option value="MULTIPLE">Multiple batches</option></select>
              <Button variant="outline" onClick={() => { setPutawaySearch(""); setPutawayStatus("ALL"); setPutawayBatchFilter("ALL"); }}>Clear</Button>
            </div>
            <Card className="putaway-work-queue overflow-hidden border-amber-200 bg-gradient-to-br from-amber-50/80 via-white to-orange-50/50 p-5 shadow-sm dark:border-amber-900/60 dark:bg-amber-950/20">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-4 uppercase tracking-wider">
                Putaway Work Queue (Assign Storage Locations & Confirm)
              </h3>
              <div className="overflow-x-auto">
              <table className="w-full min-w-[1050px] table-fixed text-left text-sm">
                <colgroup><col className="w-[14%]" /><col className="w-[15%]" /><col className="w-[8%]" /><col className="w-[12%]" /><col className="w-[18%]" /><col className="w-[13%]" /><col className="w-[20%]" /></colgroup>
                <thead>
                  <tr className="border-b border-sky-200 bg-sky-100/70 text-sky-950 uppercase dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-100">
                    <th className="py-2.5 px-3">GRN / Task No</th>
                    <th className="py-2.5 px-3">Material</th>
                    <th className="py-2.5 px-3">Batch</th>
                    <th className="py-2.5 px-3 whitespace-nowrap">Remaining Qty</th>
                    <th className="py-2.5 px-3">Assigned Rack</th>
                    <th className="py-2.5 px-3">Status<InformationTooltip help="workflowStatus" /></th>
                    <th className="sticky right-0 z-10 bg-muted px-3 py-2.5 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredPutawayTasks.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-6 text-slate-500">
                        {putawayTasks.length === 0 ? "No putaway tasks available." : "No tasks match your search or filters."}
                      </td>
                    </tr>
                  ) : (
                    filteredPutawayTasks.map((t, index) => (
                      <tr
                        key={t.id || t.key || `${t.grn_number || "putaway"}-${index}`}
                        className="hover:bg-slate-50 dark:hover:bg-slate-900/50"
                      >
                        <td className="py-3 px-3 font-semibold text-indigo-600">
                          {t.grn_number || t.key}
                        </td>
                        <td className="py-3 px-3 font-medium">
                          <button
                            type="button"
                            className="text-left hover:text-indigo-600"
                            onClick={() => openPutawayGroup(t)}
                          >
                            {t.material_names?.join(", ") || "-"}
                            {t.material_count > 1 && (
                              <span className="ml-1 text-slate-400">({t.material_count})</span>
                            )}
                          </button>
                        </td>
                        <td className="py-3 px-3 font-mono text-slate-500">
                          {t.batch_count ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 whitespace-nowrap rounded-lg px-3 text-xs font-medium text-primary"
                              onClick={() => openPutawayGroup(t)}
                            >
                              {t.batch_count} batch{t.batch_count === 1 ? "" : "es"}
                            </Button>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td className="py-3 px-3 font-bold">
                          {t.quantity ?? "—"} {t.uom || ""}
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex flex-wrap gap-1">
                            {Array.from(new Set<string>(t.tasks.flatMap(assignedPutawayLocations))).map(code => <Badge key={code} variant="outline" className="bg-emerald-50 font-mono text-[10px] text-emerald-700">{code}</Badge>)}
                            {!t.tasks.some((task: any) => assignedPutawayLocations(task).length) && <span className="italic text-slate-400">Unassigned</span>}
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <Badge
                            className={cn(
                              "text-[10px] font-bold uppercase",
                              t.status === "COMPLETED" || t.status === "STORED"
                                ? "bg-emerald-500/15 text-emerald-700"
                                : "bg-amber-500/15 text-amber-700",
                            )}
                          >
                            {t.status || "—"}
                          </Badge>
                        </td>
                        <td className="sticky right-0 bg-card py-3 px-3 text-right">
                          <div className="grid grid-cols-1 items-center gap-2 [&_button]:w-full">
                          {t.tasks.some(canAssignPutaway) && <Button
                            size="sm"
                            variant="outline"
                            onClick={() => t.tasks.length === 1 ? openAssignPutaway(t.tasks[0]) : openPutawayGroup(t, "assign")}
                            disabled={!t.tasks.some(canAssignPutaway)}
                            className="h-8 w-full min-w-0 whitespace-nowrap px-2 text-xs border-indigo-200 text-indigo-700"
                          >
                            Assign Rack
                          </Button>}
                          {t.tasks.some(canScanPutaway) && <Button
                            size="sm"
                            variant="outline"
                            onClick={() => t.tasks.length === 1 ? openPutawayScan(t.tasks[0]) : openPutawayGroup(t, "scan")}
                            disabled={!t.tasks.some(canScanPutaway)}
                            className="h-8 w-full min-w-0 whitespace-nowrap px-2 text-xs border-emerald-200 text-emerald-700"
                          >
                            <Scan className="mr-1 h-3 w-3" /> Scan QR
                          </Button>}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openPutawayGroup(t)}
                            className="h-8 w-full min-w-0 whitespace-nowrap px-2 text-xs"
                          >
                            View Details
                          </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              </div>
              <p className="border-t px-3 pt-3 text-sm text-muted-foreground">Showing {filteredPutawayTasks.length} of {groupedPutawayTasks.length} tasks</p>
            </Card>
            <div role="status" className={cn(
              "flex items-center gap-3 rounded-xl border p-4",
              putawayStageCounts.COMPLETED === groupedPutawayTasks.length
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-red-200 bg-red-50 text-red-800",
            )}>
              {putawayStageCounts.COMPLETED === groupedPutawayTasks.length
                ? <CheckCircle2 className="size-6 shrink-0" />
                : <AlertTriangle className="size-6 shrink-0" />}
              <div>
                <p className="font-semibold">{putawayStageCounts.COMPLETED === groupedPutawayTasks.length ? "No putaway tasks pending" : "Putaway tasks require attention"}</p>
                <p className="text-sm">{putawayStageCounts.COMPLETED === groupedPutawayTasks.length
                  ? "All currently listed materials have been assigned to storage locations."
                  : `${groupedPutawayTasks.length - putawayStageCounts.COMPLETED} task(s) still need putaway work.`}</p>
              </div>
            </div>
          </TabsContent>

          {/* ========================================================================= */}
          {/* 3. INVENTORY TAB */}
          {/* ========================================================================= */}
          <TabsContent value="inventory" className="space-y-6 mt-6">
            <div className="inventory-stock-overview grid gap-4 sm:grid-cols-3">
              {[
                { label: "Materials tracked", value: inventorySummary.length, Icon: Boxes, tone: "blue" },
                { label: "In stock", value: inventorySummary.filter((item) => Number(getInventoryDisplayQuantity(item)) > 0).length, Icon: CheckCircle2, tone: "green" },
                { label: "Out of stock", value: inventorySummary.filter((item) => Number(getInventoryDisplayQuantity(item)) === 0).length, Icon: AlertTriangle, tone: "amber" },
              ].map(({ label, value, Icon, tone }) => (
                <div key={label} className="inventory-stock-summary" data-tone={tone}>
                  <div className="inventory-stock-summary-icon"><Icon className="size-6" /></div>
                  <div><p className="text-sm font-medium text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-bold tabular-nums">{value}</p></div>
                </div>
              ))}
            </div>
            <Card className="inventory-stock-card space-y-4 border-sky-200 bg-gradient-to-br from-sky-50/80 via-white to-cyan-50/50 p-5 shadow-sm dark:border-sky-900/60 dark:bg-sky-950/20">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><h2 className="text-lg font-semibold">Stock overview</h2><p className="mt-1 text-sm text-muted-foreground">Material availability and storage locations</p></div>
                <span className="text-sm text-muted-foreground">{filteredInventory.length} of {inventorySummary.length} materials</span>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative w-full sm:max-w-lg sm:flex-1">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                  <Input
                    placeholder="Search material, code, batch..."
                    value={invSearch}
                    onChange={(e) => setInvSearch(e.target.value)}
                    className="pl-9 text-xs"
                  />
                </div>

              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[1000px] table-fixed text-left text-sm">
                  <colgroup><col className="w-[15%]" /><col className="w-[15%]" /><col className="w-[24%]" /><col className="w-[13%]" /><col className="w-[21%]" /><col className="w-[12%]" /></colgroup>
                  <thead>
                    <tr className="border-b border-sky-200 bg-sky-100/70 text-sky-950 uppercase dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-100">
                      <th className="py-2.5 px-3">Material Code</th>
                      <th className="py-2.5 px-3">Material Name</th>
                      <th className="py-2.5 px-3">Batches</th>
                      <th className="py-2.5 px-3">Available<InformationTooltip help="inventory" /></th>
                      <th className="py-2.5 px-3">Location</th>
                      <th className="sticky right-0 bg-muted py-2.5 px-3 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filteredInventory.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center py-6 text-slate-500">
                          No inventory stock records found.
                        </td>
                      </tr>
                    ) : (
                      filteredInventory.map((item, idx) => (
                        <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                          <td className="py-3 px-3 font-mono font-semibold text-indigo-600">
                            {item.material_code || "-"}
                          </td>
                          <td className="py-3 px-3 font-medium text-slate-900 dark:text-slate-100">
                            {item.material_name || item.material}
                          </td>
                          <td className="py-3 px-3 text-slate-600">
                            {(() => {
                              const batchCodes = Array.isArray(item.batch_details)
                                ? item.batch_details.map((batch: any) => String(batch.batch_number || "")).filter(Boolean)
                                : [
                                ...(item.batch_number ? String(item.batch_number).split(",") : []),
                                ...(item.batch ? String(item.batch).split(",") : []),
                              ].map((batch) => batch.trim()).filter((batch, index, all) => batch && all.indexOf(batch) === index);
                              return batchCodes.length ? (
                                <button type="button" onClick={() => void openInventoryBatchDetails(item)} className="inline-flex min-w-20 items-center justify-center rounded-full border bg-muted/40 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                                  Batch {batchCodes.length}
                                </button>
                              ) : "—";
                            })()}
                          </td>
                          <td className={`py-3 px-3 font-semibold tabular-nums ${Number(getInventoryDisplayQuantity(item)) > 0 ? "text-emerald-700" : "text-amber-700"}`}>
                            {getInventoryDisplayQuantity(item)} {item.uom || ""}
                          </td>
                          <td className="py-3 px-3">
                            <Badge variant="outline" className="text-[10px] font-mono">
                              {getInventoryDisplayLocation(item)}
                            </Badge>
                          </td>
                          <td className="sticky right-0 bg-card py-3 px-3 text-center">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSelectedInventoryBatchCode(null);
                                setSelectedInventory(item);
                                void api
                                  .getMaterialInventoryDetail(String(item.material_code || ""))
                                  .then((detail: any) => {
                                    const firstLocation = Array.isArray(detail?.locations)
                                      ? detail.locations[0]
                                      : null;
                                    const putawayMovements = (
                                      Array.isArray(detail?.movements) ? detail.movements : []
                                    ).filter(
                                      (movement: any) => movement.movement_type === "PUTAWAY",
                                    );
                                    const movementBatches = putawayMovements
                                      .filter((movement: any) => movement.batch_lot)
                                      .map((movement: any) => ({
                                        batch_number: movement.batch_lot,
                                        quantity: movement.quantity,
                                        uom: movement.uom || detail?.summary?.uom,
                                        location: movement.to_location || movement.location_code,
                                      }));
                                    const refreshedRow = {
                                      batch_details: movementBatches,
                                      batch_number: movementBatches
                                        .map((b: any) => b.batch_number)
                                        .join(", "),
                                      available: detail?.summary?.available_stock,
                                      available_quantity: detail?.summary?.available_stock,
                                      total_quantity: detail?.summary?.total_stock,
                                      on_hand_quantity: detail?.summary?.total_stock,
                                      location_code: firstLocation?.location_code,
                                      bin_code:
                                        firstLocation?.bin_code || putawayMovements[0]?.to_location,
                                      location:
                                        firstLocation?.bin_code ||
                                        firstLocation?.location_code ||
                                        putawayMovements[0]?.to_location,
                                      uom: detail?.summary?.uom,
                                    };
                                    setInventorySummary((rows: any[]) =>
                                      rows.map((row: any) =>
                                        String(row.material_code || "").toUpperCase() ===
                                        String(item.material_code || "").toUpperCase()
                                          ? { ...row, ...refreshedRow }
                                          : row,
                                      ),
                                    );
                                    setSelectedInventory((current: any) =>
                                      current
                                        ? {
                                            ...current,
                                            inventory_history: detail?.inventory_history,
                                            batch_details: movementBatches.length
                                              ? movementBatches
                                              : detail?.batches || [],
                                            detail_movements: detail?.movements,
                                            warehouse:
                                              firstLocation?.warehouse_name || detail?.warehouse,
                                            zone_code: firstLocation?.zone_code,
                                            bin_code:
                                              firstLocation?.bin_code ||
                                              putawayMovements[0]?.to_location,
                                            location:
                                              firstLocation?.location_code ||
                                              putawayMovements[0]?.to_location,
                                            total_quantity:
                                              detail?.summary?.total_stock ??
                                              current.total_quantity,
                                            available:
                                              detail?.summary?.available_stock ?? current.available,
                                            uom:
                                              detail?.summary?.uom ||
                                              firstLocation?.uom ||
                                              current.uom,
                                          }
                                        : current,
                                    );
                                  })
                                  .catch(() => undefined);
                              }}
                              className="h-7 text-xs text-indigo-600"
                            >
                              <Eye className="h-3.5 w-3.5 mr-1" /> View Details
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabsContent>

          {/* ========================================================================= */}
          {/* 4. MATERIAL REQUESTS TAB */}
          {/* ========================================================================= */}
          <TabsContent value="requests" className="space-y-6 mt-6">
            <Card className="overflow-x-auto border-blue-200 bg-gradient-to-br from-blue-50/80 via-white to-indigo-50/50 p-5 shadow-sm dark:border-blue-900/60 dark:bg-blue-950/20">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-4 uppercase tracking-wider">
                Assembly Material Requisitions (Warehouse Approval & Reservation)
              <InformationTooltip help="reserved" /></h3>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-sky-200 bg-sky-100/70 text-sky-950 uppercase dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-100">
                    <th className="py-2.5 px-3">Request No</th>
                    <th className="py-2.5 px-3">Assembly Order</th>
                    <th className="py-2.5 px-3">Material Required</th>
                    <th className="py-2.5 px-3">Required Qty</th>
                    <th className="py-2.5 px-3">Available Stock</th>
                    <th className="py-2.5 px-3">Status<InformationTooltip help="workflowStatus" /></th>
                    <th className="py-2.5 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {materialRequests.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-6 text-slate-500">
                        No material requisitions pending.
                      </td>
                    </tr>
                  ) : (
                    materialRequests.map((req) => (
                      <tr key={req.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                        <td className="py-3 px-3 font-semibold text-indigo-600">
                          {req.request_number || req.id}
                        </td>
                        <td className="py-3 px-3 text-slate-600">
                          {req.assembly_order || req.assembly_order_number || "-"}
                        </td>
                        <td className="py-3 px-3 font-medium">
                          {req.material_name || req.material_code}
                        </td>
                        <td className="py-3 px-3 font-bold text-slate-900 dark:text-slate-100">
                          {req.quantity ?? req.required_quantity ?? "—"} {req.uom || ""}
                        </td>
                        <td className="py-3 px-3 font-bold text-emerald-600">
                          {req.available ?? req.available_quantity ?? "—"} {req.uom || ""}
                        </td>
                        <td className="py-3 px-3">
                          <Badge
                            className={cn(
                              "text-[10px] font-bold uppercase",
                              req.status === "APPROVED"
                                ? "bg-emerald-500/15 text-emerald-700"
                                : "bg-blue-500/15 text-blue-700",
                            )}
                          >
                            {req.status || "—"}
                          </Badge>
                        </td>
                        <td className="py-3 px-3 text-right">
                          {(req.status === "PENDING" ||
                            req.status === "SUBMITTED" ||
                            req.status === "PENDING_WAREHOUSE_APPROVAL") && (
                            <div className="flex justify-end gap-1">
                              <Button
                                size="sm"
                                onClick={() => handleApproveMaterialRequest(req)}
                                className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                              >
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handlePartialApproveMaterialRequest(req)}
                                className="h-7 text-xs"
                              >
                                Partial
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleRejectMaterialRequest(req)}
                                className="h-7 text-xs text-red-600"
                              >
                                Reject
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </Card>
          </TabsContent>

          {/* ========================================================================= */}
          {/* 5. PICKING TAB */}
          {/* ========================================================================= */}
          <TabsContent value="picking" className="assembly-picking-overview space-y-4 mt-4">
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                { label: "Requests to review", value: pendingRequestsCount, Icon: ClipboardList, tone: "blue" },
                { label: "Picks in progress", value: pendingPickingCount, Icon: ListOrdered, tone: "amber" },
                { label: "Completed picks", value: pickupTasks.filter((task) => ["COMPLETED", "PICKED", "ISSUED"].includes(String(task.status || "").toUpperCase())).length, Icon: CheckCircle2, tone: "green" },
              ].map(({ label, value, Icon, tone }) => (
                <div key={label} className="inventory-stock-summary" data-tone={tone}>
                  <div className="inventory-stock-summary-icon"><Icon className="size-6" /></div>
                  <div><p className="text-sm font-medium text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-bold tabular-nums">{value}</p></div>
                </div>
              ))}
            </div>
            <AssemblyRequisitionsPanel
              refreshKey={requisitionRefreshKey}
              showRefresh={false}
              pickupTasks={pickupTasks}
              onConfirmPick={(task) => {
                setPickupFifoAlert("");
                setPickupQrVerified({ material: false, rack: false });
                setPickupQrError("");
                setPickupConfirmation({
                  material_scan: "",
                  zone_scan: "",
                  quantity: String(Math.max(0, Number(task.requested_quantity || 0) - Number(task.picked_quantity || 0))),
                });
                setPickupToConfirm(task);
              }}
              onUpdated={() => fetchData(true)}
            />
            <Card className="warehouse-picking-queue overflow-x-auto border-violet-200 bg-gradient-to-br from-violet-50/80 via-white to-indigo-50/50 p-5 shadow-sm dark:border-violet-900/60 dark:bg-violet-950/20">
              <h3 className="mb-4 text-sm font-bold uppercase tracking-wider text-slate-900 dark:text-slate-100">
                Warehouse picking queue <InformationTooltip help="pickRemaining" />
              </h3>
              <table className="w-full min-w-[1040px] table-fixed text-left text-sm">
                <colgroup><col className="w-[15%]" /><col className="w-[15%]" /><col className="w-[14%]" /><col className="w-[24%]" /><col className="w-[10%]" /><col className="w-[12%]" /><col className="w-[10%]" /></colgroup>
                <thead>
                  <tr className="border-b border-violet-200 bg-violet-100/70 text-violet-950 uppercase dark:border-violet-900 dark:bg-violet-950/50 dark:text-violet-100">
                    <th className="py-2.5 px-3">Task No</th>
                    <th className="py-2.5 px-3">Assembly Order</th>
                    <th className="py-2.5 px-3">Material</th>
                    <th className="py-2.5 px-3">Pick Location</th>
                    <th className="py-2.5 px-3">Quantity</th>
                    <th className="py-2.5 px-3">Status<InformationTooltip help="workflowStatus" /></th>
                    <th className="py-2.5 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {pickupTasks.filter((task) => !["COMPLETED", "PICKED", "ISSUED"].includes(String(task.status || "").toUpperCase())).length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-6 text-slate-500">
                        No pick tasks in queue. Approve a Material Request to generate pick tasks.
                      </td>
                    </tr>
                  ) : (
                    pickupTasks.filter((task) => !["COMPLETED", "PICKED", "ISSUED"].includes(String(task.status || "").toUpperCase())).map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                        <td className="py-3 px-3 font-semibold text-indigo-600">
                          <button
                            type="button"
                            className="underline underline-offset-2"
                            onClick={() => { setPickupFifoAlert(""); setPickupQrVerified({ material: false, rack: false }); setPickupQrError(""); setPickupConfirmation({ material_scan: "", zone_scan: "", quantity: String(Math.max(0, Number(p.requested_quantity || 0) - Number(p.picked_quantity || 0))) }); setPickupToConfirm(p); }}
                          >
                            {p.task_number || p.id}
                          </button>
                        </td>
                        <td className="py-3 px-3 text-slate-600">
                          {p.assembly_order_number || p.assembly_order || "-"}
                        </td>
                        <td className="py-3 px-3 font-medium">
                          {p.material_name || p.material_code}
                        </td>
                        <td className="py-3 px-3">
                          <Badge variant="outline" className="bg-slate-50 font-mono text-[10px]">
                            {p.pick_location || "—"}
                          </Badge>
                        </td>
                        <td className="py-3 px-3 font-bold">
                          {p.quantity ?? "—"} {p.uom || ""}
                        </td>
                        <td className="py-3 px-3">
                          <Badge
                            className={cn(
                              "text-[10px] font-bold uppercase",
                              p.status === "COMPLETED"
                                ? "bg-emerald-500/15 text-emerald-700"
                                : "bg-indigo-500/15 text-indigo-700",
                            )}
                          >
                            {p.status || "—"}
                          </Badge>
                        </td>
                        <td className="py-3 px-3 text-right">
                          {p.status !== "COMPLETED" && (
                            <Button
                              size="sm"
                              onClick={() => { setPickupFifoAlert(""); setPickupQrVerified({ material: false, rack: false }); setPickupQrError(""); setPickupConfirmation({ material_scan: "", zone_scan: "", quantity: String(Math.max(0, Number(p.requested_quantity || 0) - Number(p.picked_quantity || 0))) }); setPickupToConfirm(p); }}
                              className="h-7 text-xs bg-indigo-600 hover:bg-indigo-700 text-white"
                            >
                              Confirm Pick
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </Card>
            <Dialog open={showPickupHistory} onOpenChange={setShowPickupHistory}>
              <DialogContent className="w-[calc(100vw-2rem)] max-h-[85dvh] max-w-5xl overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2"><History className="size-5 text-primary" /> Warehouse pick history</DialogTitle>
                  <DialogDescription>Completed assembly material picks and their confirmation details.</DialogDescription>
                </DialogHeader>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full min-w-[850px] text-left text-sm">
                    <thead className="border-b bg-muted/50 text-xs uppercase text-muted-foreground">
                      <tr><th className="px-3 py-3">Task No</th><th className="px-3">Assembly Request</th><th className="px-3">Material</th><th className="px-3">Pick Location</th><th className="px-3">Picked Quantity</th><th className="px-3">Confirmed By</th><th className="px-3">Confirmed At</th></tr>
                    </thead>
                    <tbody className="divide-y">
                      {pickupTasks.filter((task) => ["COMPLETED", "PICKED", "ISSUED"].includes(String(task.status || "").toUpperCase())).map((task) => (
                        <tr key={task.id}>
                          <td className="px-3 py-3 font-semibold text-primary">{task.task_number || task.id}</td>
                          <td className="px-3">{task.assembly_order_number || task.assembly_order || "—"}</td>
                          <td className="px-3"><span className="font-medium">{task.material_name || task.material_code || "—"}</span>{task.material_name && task.material_code && <span className="block text-xs text-muted-foreground">{task.material_code}</span>}</td>
                          <td className="px-3 font-mono text-xs">{task.pick_location || "—"}</td>
                          <td className="px-3 font-semibold">{task.picked_quantity ?? task.quantity ?? "—"} {task.uom || ""}</td>
                          <td className="px-3">{task.confirmation?.confirmed_by || "—"}</td>
                          <td className="px-3 text-xs text-muted-foreground">{formatApiDateTime(task.confirmation?.confirmed_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!pickupTasks.some((task) => ["COMPLETED", "PICKED", "ISSUED"].includes(String(task.status || "").toUpperCase())) && (
                    <p className="p-8 text-center text-sm text-muted-foreground">No completed picks have been recorded yet.</p>
                  )}
                </div>
              </DialogContent>
            </Dialog>
          </TabsContent>

          {/* ========================================================================= */}
          {/* 7. LOCATIONS TAB */}
          {/* ========================================================================= */}
          <TabsContent value="locations" className="warehouse-locations-overview space-y-4 mt-4">
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                { label: "Storage zones", value: zones.length, Icon: Building2, tone: "blue" },
                { label: "Racks configured", value: new Set(allFlattenedBins.map((bin) => bin.rack_capacity?.id || `${bin.zone_id}:${bin.rack || bin.id}`)).size, Icon: Building2, tone: "green" },
                { label: "Storage bins", value: allFlattenedBins.length, Icon: Boxes, tone: "amber" },
              ].map(({ label, value, Icon, tone }) => (
                <div key={label} className="inventory-stock-summary" data-tone={tone}>
                  <div className="inventory-stock-summary-icon"><Icon className="size-6" /></div>
                  <div><p className="text-sm font-medium text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-bold tabular-nums">{value}</p></div>
                </div>
              ))}
            </div>
            <div className="locations-section-header flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Layers className="h-5 w-5 text-primary" /> Zones & Racks
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Zone → Rack → Bin
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isSubmitting}
                  onClick={openCreateZone}
                  className="gap-1 text-xs"
                >
                  <Plus className="h-3.5 w-3.5 text-indigo-600" /> Add Zone
                </Button>
              </div>
            </div>

            {false && (
              <Card className="p-5 space-y-4">
                <div>
                  <h3 className="text-base font-bold">Dock allocation for Gate Entry</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Allocate an available dock to an approved gate entry. Gate Security is notified
                    on allocation and release.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate({ to: "/dock-management" })}
                >
                  Manage docks
                </Button>
                {dockRequests.length > 0 && (
                  <div className="space-y-2">
                    {dockRequests.map((request) => (
                      <div
                        key={request.id}
                        className="flex flex-wrap items-center gap-2 rounded-lg border p-3"
                      >
                        <div className="min-w-48 flex-1 text-xs">
                          <strong>{request.vehicle_number}</strong> ·{" "}
                          {request.existing_gate_pass_id}
                        </div>
                        <select
                          className="h-9 rounded-md border bg-background px-2 text-xs"
                          value={dockChoices[request.id] || ""}
                          onChange={(event) =>
                            setDockChoices((current) => ({
                              ...current,
                              [request.id]: event.target.value,
                            }))
                          }
                        >
                          <option value="">Select available dock</option>
                          {docks
                            .filter((dock) => dock.status === "AVAILABLE")
                            .map((dock) => (
                              <option key={dock.id} value={dock.id}>
                                {dock.dock_code} · {dock.dock_name}
                              </option>
                            ))}
                        </select>

                        <Button
                          size="sm"
                          disabled={isSubmitting || !warehouses.length}
                          onClick={() => void handleAllocateDockFromLocations(request.id)}
                        >
                          Allocate dock
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="space-y-2">
                  {docks
                    .filter((dock) => ["OCCUPIED", "RESERVED"].includes(dock.status))
                    .map((dock) => (
                      <div
                        key={dock.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-xs"
                      >
                        <span>
                          <strong>{dock.dock_code}</strong>
                          {dock.current_allocation?.vehicle_number
                            ? ` · ${dock.current_allocation.vehicle_number}`
                            : ""}{" "}
                          · {dock.status}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isSubmitting || !dock.current_allocation?.id}
                          onClick={() => void handleReleaseDockFromLocations(dock)}
                        >
                          Release dock
                        </Button>
                      </div>
                    ))}
                  {!dockRequests.length &&
                    !docks.some((dock) => ["OCCUPIED", "RESERVED"].includes(dock.status)) && (
                      <p className="text-xs text-muted-foreground">
                        No pending gate entries or active dock allocations.
                      </p>
                    )}
                </div>
              </Card>
            )}

            {zones.length === 0 ? (
              <Card className="border-indigo-200 bg-gradient-to-br from-indigo-50/80 via-white to-blue-50/50 p-8 text-center text-sm text-slate-600 shadow-sm dark:border-indigo-900/60 dark:bg-indigo-950/20">
                No zones configured yet. Use Add Zone to create the first zone.
              </Card>
            ) : (
              <div className="space-y-4">
                {zones.map((zone) => {
                  const zoneBins = allFlattenedBins.filter((bin) => bin.zone_id === zone.id);
                  const rackCount = new Set(zoneBins.map(bin => bin.rack_capacity?.id || bin.rack || bin.id)).size;
                  return (
                    <Card key={zone.id} className="zone-storage-card overflow-hidden border-indigo-200 bg-gradient-to-br from-indigo-50/70 via-white to-sky-50/40 shadow-sm dark:border-indigo-900/60 dark:bg-indigo-950/20">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-slate-50 px-5 py-4">
                        <div>
                          <h3 className="font-bold text-slate-900">
                            {zone.zone_code}
                          </h3>
                          <p className="mt-1 text-xs text-slate-500">
                      {rackCount} {rackCount === 1 ? "rack" : "racks"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px]">
                            {zone.status || "ACTIVE"}
                          </Badge>
                          <Button
                            size="sm"
                            disabled={isSubmitting || String(zone.status || "ACTIVE").toUpperCase() !== "ACTIVE"}
                            onClick={() => void openCreateBin(zone)}
                            className="h-8 gap-1 bg-indigo-600 text-xs text-white hover:bg-indigo-700"
                          >
                            <Plus className="h-3.5 w-3.5" /> Add Rack
                          </Button>
                        </div>
                      </div>
                      {zoneBins.length === 0 ? (
                        <p className="px-5 py-6 text-center text-sm text-slate-500">
                          No racks in this zone. Use Add Rack to add a storage location.
                        </p>
                      ) : (
                        <RackOccupancyCards bins={zoneBins} allBins={allFlattenedBins}
                          onAddMaterial={() => handleTabChange("putaway")}
                          zone={{ zone_code: zone.zone_code, zone_name: zone.zone_name }} onUpdated={() => fetchData(true)} />
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* ========================================================================= */}
      {/* MODALS */}
      {/* ========================================================================= */}

      <Dialog
        open={Boolean(pickupToConfirm)}
        onOpenChange={(open) => {
          if (!open && !isSubmitting) {
            setPickupToConfirm(null);
            setPickupFifoAlert("");
            setPickupQrVerified({ material: false, rack: false });
            setPickupQrError("");
            setPickupConfirmation({ material_scan: "", zone_scan: "", quantity: "" });
          }
        }}
      >
        <DialogContent className="w-[calc(100vw-2rem)] max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {pickupToConfirm?.status === "COMPLETED"
                ? "Picking Task Details"
                : "Confirm physical pick"}
            </DialogTitle>
            <DialogDescription>
              {pickupToConfirm?.status === "COMPLETED"
                ? "Read-only audit summary for the completed warehouse picking operation."
                : "Enter the scanned material and storage location codes and the quantity actually picked. Stock updates only after the server validates them."}
            </DialogDescription>
          </DialogHeader>
          {pickupToConfirm && (
            <form onSubmit={handleCompletePickup} className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-muted/30 px-3 py-2.5 text-xs">
                <span className="font-semibold text-foreground">Task {pickupToConfirm.task_number || pickupToConfirm.id}</span>
                <span className="text-muted-foreground">{pickupToConfirm.assembly_order_number || "Assembly request"}</span>
                <span className="font-medium text-primary">{pickupToConfirm.material_name || pickupToConfirm.material_code}</span>
              </div>
              {pickupFifoAlert && <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><p><strong>Older stock must be cleared first.</strong> {pickupFifoAlert}</p></div>}
              {pickupToConfirm.status === "COMPLETED" && (
                <div className="space-y-1 rounded-md border bg-muted/30 p-3 text-xs">
                  <p>
                    <strong>Material:</strong>{" "}
                    {pickupToConfirm.material_name || pickupToConfirm.material_code} (
                    {pickupToConfirm.material_code})
                  </p>
                  <p>
                    <strong>Batch:</strong> {pickupToConfirm.batch_number || "Not recorded"}
                  </p>
                  <p>
                    <strong>Material QR:</strong>{" "}
                    {pickupToConfirm.confirmation?.material_qr || "Not recorded"}
                  </p>
                  <p>
                    <strong>Rack QR:</strong>{" "}
                    {pickupToConfirm.confirmation?.rack_qr ||
                      pickupToConfirm.pick_location ||
                      "Not recorded"}
                  </p>
                  <p>
                    <strong>Picked quantity:</strong>{" "}
                    {pickupToConfirm.picked_quantity ?? pickupToConfirm.quantity ?? 0}{" "}
                    {pickupToConfirm.uom || ""}
                  </p>
                  <p>
                    <strong>Confirmed by:</strong>{" "}
                    {pickupToConfirm.confirmation?.confirmed_by || "Not recorded"}
                  </p>
                  <p>
                    <strong>Completed:</strong>{" "}
                    {pickupToConfirm.confirmation?.confirmed_at
                      ? new Date(pickupToConfirm.confirmation.confirmed_at).toLocaleString()
                      : "Not recorded"}
                  </p>
                </div>
              )}
              {pickupToConfirm.status !== "COMPLETED" && (
                <>
                  <div className="space-y-2.5 rounded-xl border border-border/80 p-3">
                    <span className="inline-flex items-center"><label className="text-xs font-semibold" htmlFor="pickup-material-scan">
                      Material code / QR scan
                    </label><InformationTooltip help="qr" /></span>
                    <Input
                      id="pickup-material-scan"
                      required
                      value={pickupConfirmation.material_scan}
                      onChange={(event) => {
                        setPickupFifoAlert("");
                        setPickupQrVerified((current) => ({ ...current, material: false }));
                        setPickupConfirmation((current) => ({
                          ...current,
                          material_scan: event.target.value,
                        }));
                      }}
                    />
                    <div className="grid grid-cols-3 gap-2">
                      <Button type="button" variant="outline" size="sm" className="w-full gap-1" onClick={() => setCameraField("pickup-material")}>
                        <Camera className="size-4" /> Scan &amp; Verify
                      </Button>
                      <Button type="button" variant="outline" size="sm" className="w-full gap-2" onClick={() => pickupMaterialFileInput.current?.click()}>
                        <Upload className="size-4" /> Upload QR
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full gap-2"
                        disabled={!pickupMaterialQrValue}
                        onClick={() => void downloadQrValue(pickupMaterialQrValue, "Material QR")}
                      >
                        <Download className="size-4" /> Download QR
                      </Button>
                    </div>
                    <input
                      ref={pickupMaterialFileInput}
                      type="file"
                      accept="image/png,image/jpeg,image/jpg"
                      className="sr-only"
                      aria-label="Upload material QR image"
                      onChange={(event) => event.target.files?.[0] && decodePickupQrUpload(event.target.files[0], "material")}
                    />
                    {pickupQrVerified.material && <p className="text-xs font-semibold text-emerald-700">✓ Material QR verified</p>}
                  </div>
                  <div className="space-y-2.5 rounded-xl border border-border/80 p-3">
                    <span className="inline-flex items-center"><label className="text-xs font-semibold" htmlFor="pickup-zone-scan">
                      BIN / location code / QR scan
                    </label><InformationTooltip help="qr" /></span>
                    <Input
                      id="pickup-zone-scan"
                      required
                      value={pickupConfirmation.zone_scan}
                      onChange={(event) => {
                        setPickupQrVerified((current) => ({ ...current, rack: false }));
                        setPickupConfirmation((current) => ({
                          ...current,
                          zone_scan: event.target.value,
                        }));
                      }}
                    />
                    <div className="grid grid-cols-3 gap-2">
                      <Button type="button" variant="outline" size="sm" className="w-full gap-1" onClick={() => setCameraField("pickup-bin")}>
                        <Camera className="size-4" /> Scan &amp; Verify
                      </Button>
                      <Button type="button" variant="outline" size="sm" className="w-full gap-2" onClick={() => pickupRackFileInput.current?.click()}>
                        <Upload className="size-4" /> Upload QR
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full gap-2"
                        disabled={!pickupRackQrValue}
                        onClick={() => void downloadQrValue(pickupRackQrValue, "BIN QR")}
                      >
                        <Download className="size-4" /> Download QR
                      </Button>
                    </div>
                    <input
                      ref={pickupRackFileInput}
                      type="file"
                      accept="image/png,image/jpeg,image/jpg"
                      className="sr-only"
                      aria-label="Upload bin or location QR image"
                      onChange={(event) => event.target.files?.[0] && decodePickupQrUpload(event.target.files[0], "rack")}
                    />
                    {pickupQrVerified.rack && <p className="text-xs font-semibold text-emerald-700">✓ BIN QR verified</p>}
                    {availablePickupBin && (
                      <div className="rounded-lg border border-blue-200 bg-blue-50 p-2.5 text-xs text-blue-900">
                        <p className="font-semibold">Remaining stock location</p>
                        <p className="mt-1">{availablePickupBin.location_code} · {availablePickupBin.available_quantity} {availablePickupBin.uom || ""} available</p>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <Button type="button" size="sm" variant="outline" onClick={() => {
                            const value = String(availablePickupBin.qr_value || availablePickupBin.location_code || "");
                            setPickupConfirmation((current) => ({ ...current, zone_scan: value }));
                            void verifyPickupQr("rack", value);
                          }}>Use &amp; Verify BIN</Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => void downloadQrValue(String(availablePickupBin.qr_value || availablePickupBin.location_code || ""), `${availablePickupBin.bin_code || "Available BIN"} QR`)}>
                            <Download className="mr-1 size-4" /> Download BIN QR
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                  {pickupQrError && <p role="alert" className="text-xs font-medium text-rose-600">{pickupQrError}</p>}
                  <div className="space-y-2">
                    <span className="inline-flex items-center"><label className="text-xs font-semibold" htmlFor="pickup-quantity">
                      Quantity picked {pickupToConfirm.uom ? `(${pickupToConfirm.uom})` : ""}
                    </label><InformationTooltip help="pickRemaining" /></span>
                    <Input
                      id="pickup-quantity"
                      type="number"
                      min="0.0001"
                      step="0.0001"
                      required
                      value={pickupConfirmation.quantity}
                      onChange={(event) =>
                        setPickupConfirmation((current) => ({
                          ...current,
                          quantity: event.target.value,
                        }))
                      }
                    />
                    {pickupToConfirm.requested_quantity != null && (
                      <p className="text-xs text-muted-foreground">
                        Requested: {pickupToConfirm.requested_quantity} {pickupToConfirm.uom || ""}{" "}
                        · Remaining:{" "}
                        {Math.max(
                          0,
                          Number(pickupToConfirm.requested_quantity) -
                            Number(
                              pickupToConfirm.picked_quantity ??
                                (pickupToConfirm.status === "COMPLETED"
                                  ? pickupToConfirm.requested_quantity
                                  : pickupToConfirm.status === "IN_PROGRESS"
                                    ? pickupToConfirm.quantity
                                    : 0),
                            ),
                        )}{" "}
                        {pickupToConfirm.uom || ""}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Source rack: {pickupToConfirm.pick_location || "Not assigned"}
                    </p>
                    {pickupToConfirm.batch_number && (
                      <p className="text-xs text-muted-foreground">
                        Material batch: {pickupToConfirm.batch_number}
                      </p>
                    )}
                    {pickupToConfirm.confirmation?.confirmed && (
                      <p className="text-xs text-emerald-700">
                        Confirmed by{" "}
                        {pickupToConfirm.confirmation.confirmed_by || "Warehouse Operator"} on{" "}
                        {new Date(pickupToConfirm.confirmation.confirmed_at).toLocaleString()}
                      </p>
                    )}
                  </div>
                </>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setPickupToConfirm(null)}>
                  {pickupToConfirm.status === "COMPLETED" ? "Close" : "Cancel"}
                </Button>
                {pickupToConfirm.status !== "COMPLETED" && (
                  <Button
                    type="submit"
                    disabled={
                      isSubmitting ||
                      !pickupConfirmation.material_scan.trim() ||
                      !pickupConfirmation.zone_scan.trim() ||
                      Number(pickupConfirmation.quantity) <= 0
                      || !pickupQrVerified.material
                      || !pickupQrVerified.rack
                    }
                  >
                    {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm pick"}
                  </Button>
                )}
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* 1. Assign Storage Location Modal */}
      <Dialog open={!!assignPutawayTask} onOpenChange={() => setAssignPutawayTask(null)}>
        <DialogContent className="sm:max-w-xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader className="pr-6 text-left">
            <DialogTitle>Assign Storage Location</DialogTitle>
            <DialogDescription>
              Select destination rack for Putaway Task {assignPutawayTask?.grn_number}
            </DialogDescription>
          </DialogHeader>

          {assignPutawayTask && (
            <div className="space-y-5 text-sm py-2 min-w-0">
              <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg space-y-1">
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  {assignPutawayTask.material_name || "-"}
                </div>
                <dl className="grid gap-3 pt-2 sm:grid-cols-[100px_1fr] text-sm">
                  <div><dt className="text-muted-foreground text-xs">Quantity</dt><dd className="mt-1 font-medium">{assignPutawayTask.quantity ?? "—"} {assignPutawayTask.uom || ""}</dd></div>
                  <div className="min-w-0"><dt className="text-muted-foreground text-xs">Batch</dt><dd className="mt-1 break-all font-medium">{assignPutawayTask.batch_number || "—"}</dd></div>
                </dl>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">

                <div className="min-w-0 space-y-2">
                <label htmlFor="assign-zone" className="font-medium">Zone</label>
                <Select
                  value={assignZoneId}
                  onValueChange={(value) => {
                    setAssignZoneId(value);
                    setSelectedLocationId("");
                  }}
                  disabled={!assignWarehouseRefId}
                >
                  <SelectTrigger id="assign-zone" className="w-full text-sm">
                    <SelectValue placeholder="Select zone" />
                  </SelectTrigger>
                  <SelectContent>
                    {zones
                      .filter(
                        (z) =>
                          z.warehouse_ref_id === assignWarehouseRefId &&
                          (!z.status || String(z.status).toUpperCase() === "ACTIVE"),
                      )
                      .map((z) => (
                        <SelectItem key={z.id} value={z.id}>
                          {z.zone_code || z.zone_name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                </div>
                <div className="min-w-0 space-y-2 sm:col-span-2">
                <label htmlFor="assign-rack" className="font-medium">Destination rack</label>
                <Select
                  value={selectedLocationId}
                  onValueChange={setSelectedLocationId}
                  disabled={!assignZoneId}
                >
                  <SelectTrigger id="assign-rack" className="w-full text-sm">
                    <SelectValue placeholder="Select active rack" />
                  </SelectTrigger>
                  <SelectContent>
                    {allFlattenedBins
                      .filter(
                        (loc) =>
                          loc.warehouse_ref_id === assignWarehouseRefId &&
                          loc.zone_id === assignZoneId &&
                          isAssignableRack(loc.status),
                      )
                      .map((loc) => (
                        <SelectItem key={loc.id} value={loc.id} disabled={typeof loc.rack_capacity?.available_capacity === "number" && loc.rack_capacity.available_capacity <= 0}>
                          {loc.rack || loc.bin_code} ({loc.bin_code}){typeof loc.rack_capacity?.available_capacity === "number" ? ` / ${loc.rack_capacity.available_capacity} PCS available` : ""}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="assign-quantity" className="font-medium">
                  Assign Quantity ({assignPutawayTask.uom || "PCS"})
                </label>
                <Input
                  id="assign-quantity"
                  type="number"
                  min="0.0001"
                  step="0.0001"
                  max={unassignedPutawayQuantity(assignPutawayTask)}
                  value={assignQuantity}
                  onChange={(event) => setAssignQuantity(event.target.value)}
                />
                <p className="text-xs text-slate-500">
                  Unassigned in selected batch: {unassignedPutawayQuantity(assignPutawayTask)} {assignPutawayTask.uom || "PCS"}{" "}
                  · Remaining:{" "}
                  {Math.max(
                    0,
                    unassignedPutawayQuantity(assignPutawayTask) - Number(assignQuantity || 0),
                  )}{" "}
                  {assignPutawayTask.uom || "PCS"}
                </p>
              </div>
            </div>
          )}

          <DialogFooter className="border-t pt-4 gap-2">
            <Button variant="outline" onClick={() => setAssignPutawayTask(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleConfirmAssignPutaway}
              disabled={
                isSubmitting ||
                !assignWarehouseRefId ||
                !assignZoneId ||
                !selectedLocationId ||
                !Number.isFinite(Number(assignQuantity)) ||
                Number(assignQuantity) <= 0 ||
                Number(assignQuantity) > (assignPutawayTask ? unassignedPutawayQuantity(assignPutawayTask) : 0)
              }
              className="bg-primary text-primary-foreground"
            >
              {isSubmitting ? "Assigning…" : "Assign rack"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 1b. Scan and confirm physical BIN putaway */}
      <Dialog open={!!scanPutawayTask} onOpenChange={() => setScanPutawayTask(null)}>
        <DialogContent className="sm:max-w-xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader className="pr-6 text-left">
            <DialogTitle>Scan Material & BIN</DialogTitle>
            <DialogDescription>
              Scan the existing material QR first, then scan the assigned BIN QR.
            </DialogDescription>
          </DialogHeader>
          {scanPutawayTask && (
            <div className="space-y-5 text-sm min-w-0">
              <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900">
                <div className="font-semibold">
                  {scanPutawayTask.material_name || scanPutawayTask.item_code}
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-3">
                  <div><dt className="text-xs text-muted-foreground">GRN</dt><dd className="mt-1 font-medium">{scanPutawayTask.grn_number || "-"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Pending quantity</dt><dd className="mt-1 font-medium">{scanPutawayTask.quantity} {scanPutawayTask.uom || ""}</dd></div>
                  <div className="col-span-2 min-w-0"><dt className="text-xs text-muted-foreground">Batch</dt><dd className="mt-1 break-all font-medium">{scanPutawayTask.batch_number || "-"}</dd></div>
                </dl>
              </div>
              <div className="space-y-1.5">
                <span className="inline-flex items-center"><label htmlFor="putaway-material-qr" className="font-medium">Material QR</label><InformationTooltip help="qr" /></span>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] items-stretch">
                  <Input
                    id="putaway-material-qr"
                    className="min-w-0 w-full"
                    value={putawayScan.materialQr}
                    placeholder="Scan material QR"
                    onChange={(e) => {
                      setMaterialQrVerified(false);
                      setPutawayScan((s) => ({ ...s, materialQr: e.target.value }));
                    }}
                    autoFocus
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="h-auto min-h-10 py-2"
                    onClick={() => setCameraField("material")}
                  >
                    <Camera className="mr-1 h-4 w-4" />
                    Scan with Camera
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <label className="relative inline-flex min-h-9 cursor-pointer items-center justify-center rounded-md border border-input bg-white px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-accent focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
                    Upload QR Image
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/jpg"
                      aria-label="Upload material QR image"
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                      onChange={(e) =>
                        e.target.files?.[0] && decodeQrUpload(e.target.files[0], "material")
                      }
                    />
                  </label>
                  {materialQrVerified && (
                    <span className="font-semibold text-emerald-600">✓ Verified</span>
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="putaway-bin-qr" className="font-medium">BIN QR</label>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] items-stretch">
                  <Input
                    id="putaway-bin-qr"
                    className="min-w-0 w-full"
                    value={putawayScan.binQr}
                    placeholder="Scan BIN QR"
                    onChange={(e) => {
                      setBinQrVerified(false);
                      setPutawayScan((s) => ({ ...s, binQr: e.target.value }));
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="h-auto min-h-10 py-2"
                    onClick={() => setCameraField("bin")}
                  >
                    <Camera className="mr-1 h-4 w-4" />
                    Scan with Camera
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <label className="relative inline-flex min-h-9 cursor-pointer items-center justify-center rounded-md border border-input bg-white px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-accent focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
                    Upload QR Image
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/jpg"
                      aria-label="Upload BIN QR image"
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                      onChange={(e) =>
                        e.target.files?.[0] && decodeQrUpload(e.target.files[0], "bin")
                      }
                    />
                  </label>
                  {binQrVerified && (
                    <span className="font-semibold text-emerald-600">✓ Verified</span>
                  )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="ml-auto bg-white px-3"
                  disabled={!putawayQrImages.bin}
                  onClick={() =>
                    putawayQrImages.bin &&
                    setQrPreview({
                      title: `Assigned BIN QR — ${scanPutawayTask.destination_bin_code || scanPutawayTask.destination_bin || "Bin"}`,
                      image: putawayQrImages.bin,
                    })
                  }
                >
                  View QR
                </Button>
                </div>
                {qrScanError && <p className="text-xs text-rose-600">{qrScanError}</p>}
              </div>
              <div className="space-y-1.5">
                <label htmlFor="putaway-stored-quantity" className="font-medium">
                  Stored quantity {scanPutawayTask.uom ? `(${scanPutawayTask.uom})` : ""}
                </label>
                <Input
                  id="putaway-stored-quantity"
                  type="number"
                  min="0.0001"
                  step="0.0001"
                  max={scanMaximumQuantity}
                  value={putawayScan.quantity}
                  onChange={(e) => setPutawayScan((s) => ({ ...s, quantity: e.target.value }))}
                />
                {Number.isFinite(scanAvailableCapacity) && (
                  <p className="text-xs text-muted-foreground">
                    Rack space available: <span className="font-semibold text-foreground">{Math.max(0, scanAvailableCapacity)} {scanPutawayTask.uom || "PCS"}</span>.
                    {scanAvailableCapacity < Number(scanPutawayTask.quantity || 0) &&
                      " Confirm this partial quantity, then assign the remainder to another rack."}
                  </p>
                )}
              </div>
            </div>
          )}
          <DialogFooter className="items-center gap-2 border-t pt-4">
            <Button variant="outline" onClick={() => setScanPutawayTask(null)}>
              Cancel
            </Button>
            <div className="flex items-center justify-end gap-2">
            <Button
              onClick={handleConfirmPutaway}
              disabled={isSubmitting || !putawayScanValid}
              className="bg-emerald-600 text-white"
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm Putaway"}
            </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!cameraField} onOpenChange={(open) => !open && setCameraField(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-sm">
          <DialogHeader>
            <DialogTitle>Scan {cameraField?.includes("material") ? "Material" : "BIN"} QR</DialogTitle>
            <DialogDescription>
              Allow camera access and hold the QR label inside the frame.
            </DialogDescription>
          </DialogHeader>
          <video ref={cameraVideoRef} className="w-full rounded-xl bg-black" playsInline muted />
          <canvas ref={cameraCanvasRef} className="hidden" />
          {cameraError && <p className="text-sm text-rose-600">{cameraError}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCameraField(null)}>
              Use Manual Entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!qrPreview} onOpenChange={(open) => !open && setQrPreview(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-sm max-h-[90dvh] overflow-y-auto gap-5">
          <DialogHeader className="pr-6 text-left">
            <DialogTitle>{qrPreview?.title}</DialogTitle>
            <DialogDescription>Scan this code or download the label.</DialogDescription>
          </DialogHeader>
          {qrPreview?.image && (
            <>
              <div className="flex justify-center rounded-xl border bg-slate-50 p-4">
              <img
                src={qrPreview.image}
                alt={qrPreview.title}
                className="aspect-square w-full max-w-64 object-contain rounded-lg bg-white p-3"
              />
              </div>
              <Button asChild className="w-full">
              <a
                href={qrPreview.image}
                download={`${qrPreview.title.replaceAll(" ", "-").toLowerCase()}.png`}
              >
                Download QR Image
              </a>
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedPutawayGroup} onOpenChange={() => setSelectedPutawayGroup(null)}>
        <DialogContent className="max-h-[90dvh] w-[calc(100vw-2rem)] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{putawayView === "assign" ? "Assign Rack / Select Batch" : putawayView === "scan" ? "Scan QR / Select Assigned Batch" : "Putaway Details"}</DialogTitle>
            <DialogDescription>{selectedPutawayGroup?.grn_number || "GRN"}</DialogDescription>
          </DialogHeader>
          {selectedPutawayGroup && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3 rounded-xl border bg-muted/20 p-4 sm:grid-cols-4">
                <div>
                  <span className="text-xs text-muted-foreground">GRN Number</span>
                  <p className="font-mono font-bold">{selectedPutawayGroup.grn_number || ""}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Materials</span>
                  <p className="font-bold">{visiblePutawayMaterials}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Batches</span>
                  <p className="font-bold">{visiblePutawayBatches.length}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">{putawayView === "assign" ? "Quantity to Assign" : "Remaining to Put Away"}</span>
                  <p className="font-bold">
                    {visiblePutawayQuantity} {selectedPutawayGroup.uom}
                  </p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">{putawayView === "assign" ? "Only batches with unassigned quantities are shown. Select a batch to assign its remaining quantity to a rack." : putawayView === "scan" ? "Only assigned, unfinished batches are shown. Select a batch to scan its material and rack QR and confirm putaway." : "Review all material batches, remaining quantities, assigned locations, and completion statuses."}</p>
              <PutawayBatchTable mode={putawayView} tasks={selectedPutawayGroup.tasks} onAssign={openAssignPutaway} onScan={openPutawayScan} />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 2. Inventory Detail Modal */}
      <Dialog open={!!selectedInventory} onOpenChange={() => { setSelectedInventory(null); setSelectedInventoryBatchCode(null); }}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedInventory?.material_name ||
                selectedInventory?.material ||
                "Material Details"}
            </DialogTitle>
          </DialogHeader>

          {selectedInventory && (
            <div className="space-y-4 py-2 text-xs">
              <div className="grid gap-3 rounded-xl border bg-muted/20 p-4 sm:grid-cols-[minmax(150px,0.7fr)_minmax(0,1.3fr)]">
                <div className="min-w-0">
                  <span className="text-slate-500">Material Code:</span>
                  <div className="font-mono font-semibold">
                    {selectedInventory.material_code || "-"}
                  </div>
                </div>
                <div className="min-w-0">
                  <span className="text-slate-500">Batch:</span>
                  <div className="mt-1 flex min-w-0 flex-wrap gap-1.5 font-mono font-semibold">
                    {visibleInventoryBatches.length ? visibleInventoryBatches.map((batch: any, index: number) => (
                      <span key={`${batch.batch_number || "batch"}-summary-${index}`} className="max-w-full break-all rounded-md bg-background px-2 py-1">
                        Batch {selectedInventoryBatchCode ? selectedInventoryBatches.findIndex((entry: any) => entry.batch_number === selectedInventoryBatchCode) + 1 : index + 1}: {batch.batch_number || "-"}
                      </span>
                    )) : <span>{selectedInventory.batch_number || selectedInventory.batch || "-"}</span>}
                  </div>
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
              <div className="min-w-0 space-y-1 rounded-lg bg-slate-50 p-3 dark:bg-slate-900">
                <div className="font-bold uppercase tracking-wider text-[10px] text-slate-400">
                  Storage Location
                </div>
                <div className="break-words font-semibold">
                  {selectedInventory.warehouse || selectedInventory.warehouse_id || "-"} →{" "}
                  {selectedInventory.zone_code || selectedInventory.zone_name || "-"} →{" "}
                  {selectedInventory.bin_code || selectedInventory.location || "-"}
                </div>
              </div>
              <div className="space-y-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-900">
                <div className="font-bold uppercase tracking-wider text-[10px] text-slate-400">Stock</div>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 font-medium">
                  <span>Total Physical Stock:</span>
                  <span className="text-right font-bold">{selectedInventory.total_quantity ?? selectedInventory.on_hand_quantity ?? "—"} {selectedInventory.uom || ""}</span>
                  <span className="text-emerald-600">Available Stock:</span>
                  <span className="text-right font-bold text-emerald-600">{selectedInventory.available ?? selectedInventory.available_quantity ?? "—"} {selectedInventory.uom || ""}</span>
                </div>
              </div>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg space-y-2">
                <div className="font-bold uppercase tracking-wider text-[10px] text-slate-400">
                  {selectedInventoryBatchCode ? "Selected Batch Details" : "Batch-wise Stock"}
                </div>
                {visibleInventoryBatches.length > 0 ? (
                  visibleInventoryBatches.map((batch: any, index: number) => {
                    const batchIndex = selectedInventoryBatches.findIndex((entry: any) => entry.batch_number === batch.batch_number);
                    const isOldestAvailable = Boolean(oldestAvailableBatch) && batch === oldestAvailableBatch;
                    const qrValue = inventoryBatchQrValue(batch);
                    const qrTitle = `Material QR ${batch.batch_number || selectedInventory.material_code}`;
                    return (
                      <div
                        key={`${batch.batch_number || "batch"}-${index}`}
                        className={`grid gap-2 border-b pb-2 last:border-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center ${isOldestAvailable ? "rounded-lg border border-red-200 bg-red-50 p-2.5 text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-100" : ""}`}
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="space-y-0.5">
                            <span className="block font-semibold">Batch {batchIndex + 1}</span>
                            <span className="block break-all font-mono">{batch.batch_number || selectedInventory.material_code}</span>
                            <span className="block break-words text-[10px] text-muted-foreground">Location: {batch.location || batch.location_code || batch.to_location || selectedInventory.bin_code || selectedInventory.location || "-"}</span>
                          </div>
                          {isOldestAvailable ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-1 text-[10px] font-bold text-red-800 dark:bg-red-900/50 dark:text-red-100">
                              <AlertTriangle className="size-3" /> Oldest stock · Use first (FIFO)
                            </span>
                          ) : null}
                        </div>
                        <span className="font-semibold sm:min-w-20 sm:text-right">{batch.quantity ?? batch.available_quantity ?? "—"} {batch.uom || selectedInventory.uom || ""}</span>
                        <div className="flex flex-wrap gap-2 sm:justify-end">
                          <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 px-2 text-[10px]" onClick={() => void previewInventoryBatchQr(batch)}><QrCode className="size-3.5" /> Material QR</Button>
                          <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 px-2 text-[10px]" disabled={!qrValue} onClick={() => void downloadQrValue(qrValue, qrTitle)}><Download className="size-3.5" /> Download</Button>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-slate-500">No batch movement details available.</div>
                )}
              </div>

              {selectedInventory.inventory_history && (
                <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900">
                  <div className="font-bold uppercase tracking-wider text-[10px] text-slate-400">
                    Inventory History
                  </div>
                  <dl className="mt-2 grid grid-cols-[minmax(120px,0.35fr)_minmax(0,1fr)] gap-x-3 gap-y-2">
                    <dt className="text-muted-foreground">Original GRN</dt><dd className="break-all font-semibold">{selectedInventory.inventory_history.original_grn || "-"}</dd>
                    <dt className="text-muted-foreground">Batch</dt><dd className="break-all font-mono font-semibold">{selectedInventory.inventory_history.batch_number || "-"}</dd>
                    <dt className="text-muted-foreground">Previous Rack Location</dt><dd className="break-all font-semibold">{selectedInventory.inventory_history.original_rack || "-"}</dd>
                    <dt className="text-muted-foreground">Received Quantity</dt><dd className="font-semibold">{selectedInventory.inventory_history.received_quantity} {selectedInventory.uom || ""}</dd>
                    <dt className="text-muted-foreground">Issued to Assembly</dt><dd className="font-semibold">{selectedInventory.inventory_history.issued_quantity} {selectedInventory.uom || ""}</dd>
                    <dt className="text-muted-foreground">Remaining Quantity</dt><dd className="font-semibold">{selectedInventory.inventory_history.remaining_quantity} {selectedInventory.uom || ""}</dd>
                    <dt className="text-muted-foreground">Picking Task</dt><dd className="break-all font-mono font-semibold">{selectedInventory.inventory_history.picking_task || "-"}</dd>
                  </dl>
                </div>
              )}

              <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg space-y-1">
                <div className="font-bold uppercase tracking-wider text-[10px] text-slate-400">
                  Location
                </div>
                <div className="font-semibold text-slate-800 dark:text-slate-200">
                  {selectedInventory.bin_code || selectedInventory.location || "-"}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 3. Bin QR & Placed Material Inspector Modal */}
      <Dialog open={!!viewBinQrModal} onOpenChange={() => setViewBinQrModal(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-indigo-600">
              <QrCode className="h-5 w-5" /> Storage Location & Placed Material Inspector
            </DialogTitle>
            <DialogDescription>
              Scanned location details and real-time physical stock placed in this location.
            </DialogDescription>
          </DialogHeader>

          {viewBinQrModal &&
            (() => {
              const bCode = viewBinQrModal.bin_code;
              const locationZone = zones.find(
                (zone) => String(zone.id) === String(viewBinQrModal.zone_id),
              );
              const placedItems = inventorySummary.filter((item) => {
                const itemLoc = (item.bin_code || item.location || "").toLowerCase();
                return itemLoc.includes(bCode.toLowerCase());
              });

              const qrCodeVal = viewBinQrModal.qr_identifier;

              return (
                <div className="space-y-4 text-xs py-2">
                  <div className="flex flex-col sm:flex-row items-center gap-4 p-4 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
                    <div className="p-3 bg-white rounded-lg border-2 border-indigo-600 shadow-inner flex flex-col items-center">
                      {binQrImage ? (
                        <img
                          src={binQrImage}
                          alt={`QR code for ${viewBinQrModal.bin_code}`}
                          className="h-32 w-32"
                        />
                      ) : (
                        <p className="h-32 w-32 flex items-center justify-center text-center text-[10px] text-muted-foreground">
                          QR code unavailable for this bin
                        </p>
                      )}
                    </div>
                    <div className="space-y-1 flex-1 text-center sm:text-left">
                      <div className="text-[11px] font-bold text-indigo-600 font-mono">
                        {qrCodeVal}
                      </div>
                      <h4 className="font-extrabold text-base text-slate-900 dark:text-slate-100">
                        {viewBinQrModal.bin_code}
                      </h4>
                      <p className="text-slate-500 font-medium">
                        Zone:{" "}
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          {locationZone?.zone_name || locationZone?.zone_code || "—"}
                        </span>
                      </p>
                      <p className="text-slate-500 font-medium">
                        Rack:{" "}
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          {viewBinQrModal.rack || "—"}
                        </span>{" "}
                        | Shelf:{" "}
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          {viewBinQrModal.position || "—"}
                        </span>
                      </p>
                      <Badge className="bg-emerald-500/15 text-emerald-700 text-[10px] font-bold uppercase mt-1">
                        STATUS: {viewBinQrModal.status || "UNKNOWN"}
                      </Badge>
                      <div className="flex flex-wrap justify-center gap-2 pt-3 sm:justify-start">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!binQrImage}
                          onClick={() => void downloadQrValue(qrCodeVal || "", `Bin QR ${bCode}`)}
                        >
                          <Download className="mr-2 h-4 w-4" /> Download QR
                        </Button>
                        <Button size="sm" disabled={!binQrImage} onClick={printBinQr}>
                          <Printer className="mr-2 h-4 w-4" /> Print QR
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-xs uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                        <Boxes className="h-4 w-4 text-indigo-600" /> Placed Materials in Location (
                        {placedItems.length})
                      </h4>
                      {placedItems.length > 0 ? (
                        <Badge className="bg-emerald-600 text-white text-[10px] font-bold">
                          {placedItems.reduce(
                            (acc, i) => acc + Number(i.available ?? i.total_quantity ?? 0),
                            0,
                          )}{" "}
                          {placedItems[0]?.uom || ""} STORED
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-slate-500 text-[10px]">
                          LOCATION IS EMPTY
                        </Badge>
                      )}
                    </div>

                    <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-100 dark:bg-slate-800 text-slate-500 uppercase text-[10px]">
                          <tr>
                            <th className="py-2 px-3">Material</th>
                            <th className="py-2 px-3">Batch</th>
                            <th className="py-2 px-3">Quantity</th>
                            <th className="py-2 px-3">Source GRN</th>
                            <th className="py-2 px-3">Status<InformationTooltip help="workflowStatus" /></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
                          {placedItems.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="text-center py-6 text-slate-400">
                                No materials currently placed in this location. Ready for Putaway.
                              </td>
                            </tr>
                          ) : (
                            placedItems.map((item, idx) => (
                              <tr
                                key={idx}
                                className="hover:bg-slate-50 dark:hover:bg-slate-800/50"
                              >
                                <td className="py-2.5 px-3">
                                  <div className="font-bold text-slate-900 dark:text-slate-100">
                                    {item.material_name || item.material}
                                  </div>
                                  <div className="font-mono text-[10px] text-slate-400">
                                    {item.material_code || "-"}
                                  </div>
                                </td>
                                <td className="py-2.5 px-3 font-mono text-indigo-600">
                                  {item.batch_number || item.batch || "-"}
                                </td>
                                <td className="py-2.5 px-3 font-bold text-emerald-600">
                                  {item.available ?? item.total_quantity ?? 0} {item.uom || ""}
                                </td>
                                <td className="py-2.5 px-3 font-mono text-slate-500">
                                  {item.grn_number || "-"}
                                </td>
                                <td className="py-2.5 px-3">
                                  <Badge className="text-[9px] font-bold uppercase">
                                    {item.status || "UNKNOWN"}
                                  </Badge>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              );
            })()}
        </DialogContent>
      </Dialog>

      {/* 4. Create Location Entity Modal (Add Zone, Add Bin) */}
      <Dialog
        open={!!createLocationType}
        onOpenChange={(open) => {
          if (!open) {
            setCreateLocationType(null);
            setEditingZone(null);
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-indigo-600" />
              {createLocationType === "zone" && (editingZone ? "Edit Storage Zone" : "Add New Storage Zone")}
              {createLocationType === "bin" && "Add Rack (Capacity & Auto QR)"}
            </DialogTitle>
            <DialogDescription>
              {createLocationType === "zone" && (editingZone ? "Update the zone name. The generated zone code remains unchanged." : "Define a storage zone.")}
              {createLocationType === "bin" &&
                "Configure the rack capacity. Rack, bin, and QR codes are generated automatically."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateLocationSubmit} className="space-y-4 text-xs py-2">
            {createLocationType === "zone" && (
              <>
                {!editingZone && !warehouses.length && (
                  <div className="space-y-3 rounded-lg border p-3">
                    <p className="text-muted-foreground">Set up the warehouse with your first zone.</p>
                    <div className="space-y-1">
                      <label htmlFor="first-warehouse-name" className="font-semibold">Warehouse name</label>
                      <Input id="first-warehouse-name" required maxLength={128}
                        value={firstWarehouse.name} onChange={(event) => setFirstWarehouse({ ...firstWarehouse, name: event.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <label htmlFor="first-warehouse-location" className="font-semibold">Location / plant</label>
                      <Input id="first-warehouse-location" required maxLength={64}
                        value={firstWarehouse.location} onChange={(event) => setFirstWarehouse({ ...firstWarehouse, location: event.target.value })} />
                    </div>
                  </div>
                )}
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Zone Code</label>
                  <Input
                    value={newZoneForm.zone_code}
                    readOnly
                    className="bg-slate-50 font-mono"
                  />
                </div>
              </>
            )}

            {createLocationType === "bin" && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">Zone</label>
                  <div className="rounded-md border bg-slate-50 px-3 py-2 text-slate-700">
                    {zones.find((zone) => zone.id === newBinForm.zone_id)?.zone_code} - {zones.find((zone) => zone.id === newBinForm.zone_id)?.zone_name}
                  </div>
                </div>
                <div className="grid grid-cols-1 items-start gap-x-4 gap-y-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="new-rack-code" className="block text-sm leading-5">Rack Code (auto-generated)</Label>
                    <Input id="new-rack-code" className="h-11 w-full" readOnly value={newBinRows[0].rack} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-rack-capacity" className="block text-sm leading-5">Maximum Capacity (PCS) *</Label>
                    <Input id="new-rack-capacity" className="h-11 w-full" type="number" min={1} max={2147483647} step={1} required placeholder="80" value={newBinRows[0].capacity} onChange={e => setNewBinRows([{ ...newBinRows[0], capacity: e.target.value }])} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-rack-bin-code" className="block text-sm leading-5">Bin Code (auto-generated)</Label>
                    <Input id="new-rack-bin-code" className="h-11 w-full" readOnly value={newBinRows[0].bin_code} />
                  </div>
                </div>
              </div>
            )}
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setCreateLocationType(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting} className="bg-indigo-600 text-white">
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                ) : createLocationType === "bin" ? (
                  "Create Rack"
                ) : (
                  editingZone ? "Save Changes" : `Create ${createLocationType?.toUpperCase()}`
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
