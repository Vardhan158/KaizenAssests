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
  QrCode,
  ListOrdered,
  Plus,
  Eye,
  Scan,
  Camera,
  Clock,
  Layers,
  Tag,
} from "lucide-react";
import { AppShell } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

export const Route = createFileRoute("/inventory")({
  head: () => ({
    meta: [
      { title: "Warehouse Module · KaizenX" },
      {
        name: "description",
        content: "Authoritative, simple end-to-end Warehouse & Inventory operations control system.",
      },
    ],
  }),
  component: SimpleWarehouseModule,
});

type TabType = "dashboard" | "putaway" | "inventory" | "picking" | "locations";

function SimpleWarehouseModule() {
  const navigate = useNavigate();
  const searchParams: any = useSearch({ from: "/inventory" });
  const tabOptions: TabType[] = ["dashboard", "putaway", "inventory", "picking", "locations"];
  const activeTab: TabType = tabOptions.includes(searchParams?.tab) ? searchParams.tab : "dashboard";

  // Data States (All coming strictly from backend)
  const [loading, setLoading] = useState<boolean>(true);
  const [putawayTasks, setPutawayTasks] = useState<any[]>([]);
  const [inventorySummary, setInventorySummary] = useState<any[]>([]);
  const [materialRequests, setMaterialRequests] = useState<any[]>([]);
  const [pickupTasks, setPickupTasks] = useState<any[]>([]);
  const [stores, setStores] = useState<any[]>([]);
  const [zones, setZones] = useState<any[]>([]);
  const [bins, setBins] = useState<any[]>([]);
  const [docks, setDocks] = useState<any[]>([]);
  const [dockRequests, setDockRequests] = useState<any[]>([]);
  const [dockChoices, setDockChoices] = useState<Record<string, string>>({});
  const [dockStoreChoices, setDockStoreChoices] = useState<Record<string, string>>({});

  // Search & Filter States
  const [invSearch, setInvSearch] = useState("");
  const [invWarehouseFilter, setInvWarehouseFilter] = useState("ALL");
  const [invStatusFilter, setInvStatusFilter] = useState("ALL");

  // Selected Detail Modals
  const [selectedInventory, setSelectedInventory] = useState<any>(null);
  const [selectedPutawayGroup, setSelectedPutawayGroup] = useState<any>(null);
  const [assignPutawayTask, setAssignPutawayTask] = useState<any>(null);
  const [scanPutawayTask, setScanPutawayTask] = useState<any>(null);
  const [putawayScan, setPutawayScan] = useState({ materialQr: "", rackQr: "", quantity: "" });
  const [putawayQrImages, setPutawayQrImages] = useState({ material: "", rack: "" });
  const [qrPreview, setQrPreview] = useState<{ title: string; image: string } | null>(null);
  const [putawayScanValid, setPutawayScanValid] = useState(false);
  const [materialQrVerified, setMaterialQrVerified] = useState(false);
  const [rackQrVerified, setRackQrVerified] = useState(false);
  const [qrScanError, setQrScanError] = useState("");
  const [cameraField, setCameraField] = useState<"material" | "rack" | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const cameraCanvasRef = useRef<HTMLCanvasElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState("");
  const [pickupToConfirm, setPickupToConfirm] = useState<any>(null);
  const [pickupConfirmation, setPickupConfirmation] = useState({ material_scan: "", zone_scan: "", quantity: "" });
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [assignStoreId, setAssignStoreId] = useState("");
  const [assignZoneId, setAssignZoneId] = useState("");
  const [assignQuantity, setAssignQuantity] = useState("");

  // Location Creation Modals
  const [createLocationType, setCreateLocationType] = useState<"store" | "zone" | "bin" | null>(null);
  const [newStoreForm, setNewStoreForm] = useState({ store_code: "", store_name: "", description: "" });
  const [newZoneForm, setNewZoneForm] = useState({ store_id: "", zone_code: "", zone_name: "" });
  const [newBinForm, setNewBinForm] = useState({
    store_id: "",
    zone_id: "",
    bin_code: "",
    bin_name: "",
    rack: "",
    position: "",
  });
  const [newBinRows, setNewBinRows] = useState([{ rack: "", position: "", bin_code: "" }]);
  const [rackGenerator, setRackGenerator] = useState({ prefix: "RACK-", start: "1", count: "10" });
  const [viewBinQrModal, setViewBinQrModal] = useState<any>(null);
  const [binQrImage, setBinQrImage] = useState<string | null>(null);

  // Submitting States
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!cameraField) return;
    let cancelled = false;
    setCameraError("");
    void navigator.mediaDevices?.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
      .then((stream) => {
        if (cancelled) return stream.getTracks().forEach((track) => track.stop());
        cameraStreamRef.current = stream;
        if (cameraVideoRef.current) {
          cameraVideoRef.current.srcObject = stream;
          void cameraVideoRef.current.play();
        }
      })
      .catch(() => setCameraError("Camera permission was denied or is unavailable. Enter the QR value manually."));
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
        setPutawayScan((current) => ({ ...current, [cameraField === "material" ? "materialQr" : "rackQr"]: result.data }));
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
    void QRCode.toDataURL(value).then((dataUrl) => {
      if (active) setBinQrImage(dataUrl);
    }).catch(() => {
      if (active) setBinQrImage(null);
    });
    return () => { active = false; };
  }, [viewBinQrModal]);

  // Load Real Operational Data (No Hardcoded Fallbacks)
  const fetchData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [
        putawaysRes,
        inventoryRes,
        requestsRes,
        pickupsRes,
        storesRes,
        materialCatalogRes,
      ] = await Promise.all([
        api.getPutawayTasks(),
        api.getWarehouseInventorySummary(),
        // Material requests are auxiliary to Putaway. Some deployments do
        // not expose the legacy Procurement route, so a 404 must not prevent
        // the valid Putaway, inventory, pickup, and store data from loading.
        api.getMaterialRequests().catch(() => []),
        api.getPickupTasks(),
        api.getStores(),
        api.getMaterialComponents(),
      ]);

      setPutawayTasks(Array.isArray(putawaysRes) ? putawaysRes : []);
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
      setInventorySummary([...stockRows, ...catalogRows]);
      setMaterialRequests(Array.isArray(requestsRes) ? requestsRes : []);
      setPickupTasks(Array.isArray(pickupsRes) ? pickupsRes : []);
      setStores(Array.isArray(storesRes) ? storesRes : []);

      const locationRows = await Promise.all((Array.isArray(storesRes) ? storesRes : []).map(async (store: any) => {
        const storeZones = await api.getStoreZones(store.id);
        const storeBins = await Promise.all((Array.isArray(storeZones) ? storeZones : []).map((zone: any) => api.getZoneBins(zone.id)));
        return { zones: storeZones, bins: storeBins.flat() };
      }));
      setZones(locationRows.flatMap((row) => row.zones || []));
      setBins(locationRows.flatMap((row) => row.bins || []));
      const [dockRows, pendingDockRows] = await Promise.all([api.getDocks(), api.getPendingAllocations()]);
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
    const list: Array<{ id: string; label: string; bin_code: string; store_id: string; zone_id: string; rack?: string; position?: string; qr_identifier?: string; status?: string }> = [];
    if (bins && bins.length > 0) {
      bins.forEach((b) => {
        list.push({
          id: b.id,
          label: `${b.zone_code || b.zone_name || "—"} / ${b.rack || "—"} / ${b.bin_code}`,
          bin_code: b.bin_code,
          store_id: b.store_id,
          zone_id: b.zone_id,
          rack: b.rack,
          position: b.position || b.shelf,
          qr_identifier: b.qr_identifier,
          status: b.status,
        });
      });
    }
    return list;
  }, [bins]);

  // Action: Assign Storage Location to Putaway Task
  const handleConfirmAssignPutaway = async () => {
    if (!assignPutawayTask) return;
    const quantity = Number(assignQuantity);
    if (!assignStoreId || !assignZoneId || !selectedLocationId || !Number.isFinite(quantity) || quantity <= 0 || quantity > Number(assignPutawayTask.quantity || 0)) {
      toast.error("Select an active rack and enter a valid assignment quantity.");
      return;
    }
    setIsSubmitting(true);
    try {
      const selectedBinObj = allFlattenedBins.find((b) => b.id === selectedLocationId || b.bin_code === selectedLocationId);
      await api.assignPutawayLocation(
        assignPutawayTask.id,
        selectedBinObj?.id,
        selectedBinObj?.store_id,
        selectedBinObj?.zone_id,
        selectedBinObj?.id
      );
      toast.success(`Assigned ${assignPutawayTask.material_name || "Material"} to ${selectedBinObj?.label || selectedLocationId}`);
      setAssignPutawayTask(null);
      void fetchData();
    } catch (err: any) {
      toast.error(err.message || "Failed to assign location");
    } finally {
      setIsSubmitting(false);
    }
  };

  const openAssignPutaway = (task: any) => {
    setAssignPutawayTask(task);
    setAssignStoreId(task.destination_store_id || task.assigned_store_id || "");
    setAssignZoneId(task.destination_zone_id || "");
    setSelectedLocationId(task.destination_bin_id || "");
    setAssignQuantity(String(task.quantity ?? ""));
  };

  const openPutawayScan = (task: any) => {
    setScanPutawayTask(task);
    setPutawayScan({ materialQr: "", rackQr: "", quantity: String(task.quantity ?? "") });
    setPutawayScanValid(false);
    setMaterialQrVerified(false);
    setRackQrVerified(false);
    setQrScanError("");
  };

  const decodeQrUpload = (file: File, field: "material" | "rack") => {
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
          setQrScanError(`No readable ${field === "material" ? "Material" : "Rack"} QR found in the image.`);
          return;
        }
        setQrScanError("");
        setPutawayScan((current) => ({ ...current, [field === "material" ? "materialQr" : "rackQr"]: decoded.data }));
      };
      image.onerror = () => setQrScanError("Could not load the uploaded image.");
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    let active = true;
    const quantity = Number(putawayScan.quantity);
    setPutawayScanValid(false);
    setMaterialQrVerified(false);
    setRackQrVerified(false);
    if (!scanPutawayTask || !putawayScan.materialQr.trim() || !putawayScan.rackQr.trim() || !Number.isFinite(quantity) || quantity <= 0 || quantity > Number(scanPutawayTask.quantity || 0)) return;
    void Promise.all([
      api.resolveGrnQr(putawayScan.materialQr.trim()),
      api.resolveBinQr(putawayScan.rackQr.trim(), scanPutawayTask.destination_store_id),
    ]).then(([material, rack]) => {
      const materialMatches = String(material.material_code || "").toUpperCase() === String(scanPutawayTask.item_code || "").toUpperCase()
        && (!material.putaway_task_id || material.putaway_task_id === scanPutawayTask.id)
        && (!scanPutawayTask.batch_number || String(material.batch_lot_number || "").toUpperCase() === String(scanPutawayTask.batch_number).toUpperCase());
      const rackMatches = (!scanPutawayTask.destination_bin_id || rack.bin_id === scanPutawayTask.destination_bin_id)
        && String(rack.bin_code || "").toUpperCase() === String(scanPutawayTask.destination_bin_code || scanPutawayTask.destination_bin || rack.bin_code).toUpperCase();
      if (active) {
        setMaterialQrVerified(materialMatches);
        setRackQrVerified(rackMatches);
        setPutawayScanValid(materialMatches && rackMatches);
        if (!materialMatches || !rackMatches) setQrScanError("One or more scanned QR codes do not match this putaway task.");
      }
    }).catch(() => { if (active) { setMaterialQrVerified(false); setRackQrVerified(false); setPutawayScanValid(false); setQrScanError("QR validation failed. Check the material batch and assigned rack."); } });
    return () => { active = false; };
  }, [scanPutawayTask, putawayScan.materialQr, putawayScan.rackQr, putawayScan.quantity]);

  useEffect(() => {
    if (!scanPutawayTask) {
      setPutawayQrImages({ material: "", rack: "" });
      return;
    }
    let active = true;
    const assignedBin = allFlattenedBins.find((bin) => bin.id === scanPutawayTask.destination_bin_id || bin.bin_code === scanPutawayTask.destination_bin_code);
    const previewMaterialQr = putawayScan.materialQr.trim() || scanPutawayTask.material_qr || scanPutawayTask.barcode_value || "";
    const previewRackQr = putawayScan.rackQr.trim() || assignedBin?.qr_identifier || scanPutawayTask.destination_bin_code || scanPutawayTask.destination_bin || "";
    void Promise.all([
      previewMaterialQr ? QRCode.toDataURL(previewMaterialQr, { width: 180, margin: 1 }) : Promise.resolve(""),
      previewRackQr ? QRCode.toDataURL(previewRackQr, { width: 180, margin: 1 }) : Promise.resolve(""),
    ]).then(([material, rack]) => {
      if (active) setPutawayQrImages({ material, rack });
    }).catch(() => {
      if (active) setPutawayQrImages({ material: "", rack: "" });
    });
    return () => { active = false; };
  }, [scanPutawayTask, putawayScan.materialQr, putawayScan.rackQr, allFlattenedBins]);

  const handleConfirmPutaway = async () => {
    if (!scanPutawayTask) return;
    const quantity = Number(putawayScan.quantity);
    if (!putawayScan.materialQr.trim() || !putawayScan.rackQr.trim() || !Number.isFinite(quantity) || quantity <= 0) {
      toast.error("Scan the material QR and rack QR, then enter a valid quantity.");
      return;
    }
    setIsSubmitting(true);
    try {
      const resolved = await api.resolveGrnQr(putawayScan.materialQr.trim());
      if (resolved.putaway_task_id && resolved.putaway_task_id !== scanPutawayTask.id) {
        throw new Error("The scanned material does not match this putaway task.");
      }
      if (String(resolved.material_code || "").toUpperCase() !== String(scanPutawayTask.item_code || "").toUpperCase()) {
        throw new Error("The scanned material does not match this putaway task.");
      }
      const rack = await api.resolveBinQr(putawayScan.rackQr.trim(), scanPutawayTask.destination_store_id);
      if (scanPutawayTask.destination_bin_id && rack.bin_id !== scanPutawayTask.destination_bin_id) {
        throw new Error(`Wrong rack. Scan ${scanPutawayTask.destination_bin_code || scanPutawayTask.destination_bin}.`);
      }
      await api.executePutaway({
        task_id: scanPutawayTask.id,
        grn_qr_code: putawayScan.materialQr.trim(),
        bin_qr_code: putawayScan.rackQr.trim(),
        quantity,
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
        `Insufficient stock. Requested: ${reqQty} ${req.uom || ""}, available: ${availQty} ${req.uom || ""}, shortage: ${reqQty - availQty} ${req.uom || ""}.`
      );
      return;
    }

    setIsSubmitting(true);
    try {
      await api.approveMaterialRequest(req.id || req.request_number);
      toast.success(`Approved Material Request ${req.request_number || req.id}. Reserved ${reqQty} ${req.uom || ""} and created a pick task.`);
      void fetchData();
    } catch (err: any) {
      toast.error(err.message || "Failed to approve request");
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
      await api.completePickupTask(pickupToConfirm.id, {
        material_scan: pickupConfirmation.material_scan.trim(),
        zone_scan: pickupConfirmation.zone_scan.trim(),
        quantity: Number(pickupConfirmation.quantity),
      });
      toast.success("Pick confirmed and inventory updated.");
      setPickupToConfirm(null);
      setPickupConfirmation({ material_scan: "", zone_scan: "", quantity: "" });
      void fetchData();
    } catch (err: any) {
      toast.error(err.message || "Failed to complete pickup task");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Action: Create Location Sub-Form (Warehouse, Zone, Bin)
  async function printRackQrLabels() {
    const store = stores.find((s) => s.id === newBinForm.store_id);
    const zone = zones.find((z) => z.id === newBinForm.zone_id);
    const start = Number(rackGenerator.start) || 1;
    const count = Math.min(100, Math.max(1, Number(rackGenerator.count) || 1));
    const prefix = rackGenerator.prefix.trim() || "RACK-";
    const labels = await Promise.all(Array.from({ length: count }, async (_, i) => {
      const code = `${prefix}${String(start + i).padStart(3, "0")}`;
      const payload = `QR-RACK-${store?.store_code || "WAREHOUSE"}-${zone?.zone_code || "ZONE"}-${code}`;
      return { code, image: await QRCode.toDataURL(payload, { width: 220, margin: 1 }) };
    }));
    const win = window.open("", "_blank", "width=900,height=800");
    if (!win) { toast.error("Please allow popups to print QR labels"); return; }
    win.document.write(`<html><head><title>Rack QR Labels</title><style>body{font-family:Arial;padding:16px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.label{text-align:center;border:1px solid #999;padding:8px;break-inside:avoid}.label img{width:150px;height:150px}@media print{.label{break-inside:avoid}}</style></head><body><h2>${store?.store_name || "Warehouse"} / ${zone?.zone_code || "Zone"}</h2><div class="grid">${labels.map((l) => `<div class="label"><img src="${l.image}"/><b>${l.code}</b></div>`).join("")}</div><script>window.onload=()=>{window.print()}</script></body></html>`);
    win.document.close();
  }

  const handleCreateLocationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      if (createLocationType === "store") {
        const storeName = newStoreForm.store_name.trim();
        if (!storeName) {
          toast.error("Please enter a warehouse name.");
          return;
        }
        const nextCode = await api.getNextStoreCode();
        const generatedStoreCode = nextCode?.suggested_store_code;
        const createdStore = await api.createStore({
          store_name: storeName,
          store_code: generatedStoreCode,
          description: undefined,
        });
        toast.success(`Warehouse created: ${createdStore?.store_name || storeName} (${createdStore?.store_code || generatedStoreCode || "auto-generated"})`);
        setNewStoreForm({ store_code: "", store_name: "", description: "" });
      } else if (createLocationType === "zone") {
        const targetStoreId = newZoneForm.store_id;
        if (!targetStoreId) {
          toast.error("Select a warehouse before creating a zone.");
          return;
        }
        if (!newZoneForm.zone_name.trim()) {
          toast.error("Please enter a zone name.");
          return;
        }
        const nextZone = await api.getNextZoneCode(targetStoreId);
        const generatedZoneCode = nextZone?.suggested_zone_code;
        const createdZone = await api.createZone(targetStoreId, { zone_name: newZoneForm.zone_name.trim(), zone_code: generatedZoneCode });
        setNewZoneForm({ store_id: "", zone_code: "", zone_name: "" });
        toast.success(`Zone created: ${createdZone?.zone_name || newZoneForm.zone_name} (${createdZone?.zone_code || generatedZoneCode || "auto-generated"})`);
      } else if (createLocationType === "bin") {
        const targetStoreId = newBinForm.store_id;
        const targetZoneId = newBinForm.zone_id;
        if (!targetStoreId || !targetZoneId) {
          toast.error("Select a warehouse and zone before creating a bin.");
          return;
        }
        const selectedZoneObj = zones.find((z) => z.id === targetZoneId);

        const prefix = rackGenerator.prefix.trim() || "RACK-";
        const start = Number(rackGenerator.start);
        const count = Number(rackGenerator.count);
        if (!Number.isInteger(start) || !Number.isInteger(count) || start < 1 || count < 1 || count > 100) {
          toast.error("Enter a valid starting number and between 1 and 100 racks.");
          return;
        }

        const storeCode = stores.find(s => s.id === targetStoreId)?.store_code;
        const rackCodes = Array.from({ length: count }, (_, i) => `${prefix}${String(start + i).padStart(3, "0")}`);
        const existingBins = await api.getZoneBins(targetZoneId);
        const existingCodes = new Set((existingBins || []).map((b: any) => String(b.bin_code || "").toUpperCase()));
        const duplicateCodes = rackCodes.filter((code) => existingCodes.has(code.toUpperCase()));
        if (duplicateCodes.length) {
          toast.error(`Rack codes already exist: ${duplicateCodes.join(", ")}`);
          return;
        }
        await Promise.all(rackCodes.map((code) => api.createBin(targetZoneId, {
          bin_code: code,
          bin_name: code,
          rack: code,
          position: "",
          qr_identifier: `QR-RACK-${storeCode}-${selectedZoneObj?.zone_code}-${code}`,
        })));
        setNewBinRows([{ rack: "", position: "", bin_code: "" }]);
        toast.success(`✓ Storage Bin created: ${newBinForm.bin_code} (Rack: ${newBinForm.rack}, Shelf: ${newBinForm.position}) with Auto QR Code!`);
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
        (item.material_name || item.material || "").toLowerCase().includes(invSearch.toLowerCase()) ||
        (item.material_code || "").toLowerCase().includes(invSearch.toLowerCase()) ||
        (item.batch_number || item.batch || "").toLowerCase().includes(invSearch.toLowerCase());

      const matchesWarehouse =
        invWarehouseFilter === "ALL" || (item.warehouse_id || item.store_name || "").includes(invWarehouseFilter);

      const matchesStatus = invStatusFilter === "ALL" || item.status === invStatusFilter;

      return matchesSearch && matchesWarehouse && matchesStatus;
    });
  }, [inventorySummary, invSearch, invWarehouseFilter, invStatusFilter]);

  // Dashboard Aggregates (Real backend numbers)
  const pendingPutawayCount = putawayTasks.filter((t) => t.status === "PENDING" || t.status === "CREATED").length;
  const pendingRequestsCount = materialRequests.filter((r) => r.status === "PENDING" || r.status === "SUBMITTED").length;
  const pendingPickingCount = pickupTasks.filter((p) => p.status === "PENDING" || p.status === "IN_PROGRESS").length;
  const groupedPutawayTasks = useMemo(() => {
    const groups = new Map<string, any>();
    for (const task of putawayTasks) {
      const key = task.grn_number || task.grnNumber || task.order_number || task.asn_number || task.asnNumber || task.id;
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
      if (task.batch_number || task.batchNumber) group.batches.add(task.batch_number || task.batchNumber);
      if (task.material_name || task.item_code) group.materials.add(task.material_name || task.item_code);
      group.quantity += Number(task.quantity || task.received_quantity || 0);
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
        quantity: task.quantity ?? task.received_quantity ?? 0,
        uom: task.uom || "PCS",
      })),
      status: group.tasks.every((task: any) => ["COMPLETED", "PUTAWAY_COMPLETED", "STORED"].includes(String(task.status || "").toUpperCase()))
        ? "COMPLETED"
        : group.tasks.some((task: any) => String(task.status || "").toUpperCase() === "PARTIALLY_COMPLETED")
          ? "PARTIALLY_COMPLETED"
        : group.tasks.every((task: any) => task.destination_bin_id || task.destination_bin_code || task.destination_bin)
          ? "ASSIGNED"
          : "PENDING",
    }));
  }, [putawayTasks]);
  const totalAvailableStock = inventorySummary.reduce((acc, i) => acc + Number(i.available || i.available_quantity || 0), 0);

  const handleAllocateDockFromLocations = async (requestId: string) => {
    const dockId = dockChoices[requestId];
    const storeId = dockStoreChoices[requestId];
    if (!dockId || !storeId) {
      toast.error("Select an available dock and warehouse for this gate entry.");
      return;
    }
    setIsSubmitting(true);
    try {
      await api.allocateDock(requestId, dockId, { assignedStoreId: storeId });
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

  return (
    <AppShell activeItem="/inventory">
      <div className="space-y-6 pb-12">
        {/* Header Title Bar */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between border-b border-slate-200 dark:border-slate-800 pb-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Boxes className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
              Warehouse Control Center
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => void fetchData()} title="Refresh Data">
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
          </div>
        </div>

        {/* 7 Simple Warehouse Navbar Sub-Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => handleTabChange(v as TabType)} className="w-full">
          {false && <TabsList className="bg-slate-100 dark:bg-slate-900 p-1 rounded-xl flex flex-wrap gap-1 w-full justify-start border border-slate-200 dark:border-slate-800">
            <TabsTrigger value="dashboard" className="gap-2 px-4 py-2 text-xs font-semibold">
              <Boxes className="h-4 w-4" />
              Dashboard
            </TabsTrigger>
            <TabsTrigger value="putaway" className="gap-2 px-4 py-2 text-xs font-semibold">
              <PackageCheck className="h-4 w-4" />
              Putaway
              {pendingPutawayCount > 0 && (
                <Badge variant="secondary" className="ml-1 bg-amber-500/15 text-amber-700 dark:text-amber-400 font-bold px-1.5 py-0.2">
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
                <Badge variant="secondary" className="ml-1 bg-blue-500/15 text-blue-700 dark:text-blue-400 font-bold px-1.5 py-0.2">
                  {pendingRequestsCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="picking" className="gap-2 px-4 py-2 text-xs font-semibold">
              <ListOrdered className="h-4 w-4" />
              Picking
              {pendingPickingCount > 0 && (
                <Badge variant="secondary" className="ml-1 bg-indigo-500/15 text-indigo-700 dark:text-indigo-400 font-bold px-1.5 py-0.2">
                  {pendingPickingCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="locations" className="gap-2 px-4 py-2 text-xs font-semibold">
              <Building2 className="h-4 w-4" />
              Locations
            </TabsTrigger>
          </TabsList>}

          {/* ========================================================================= */}
          {/* 1. DASHBOARD TAB */}
          {/* ========================================================================= */}
          <TabsContent value="dashboard" className="space-y-6 mt-6">
            {/* Top Metric Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card className="p-4 border-l-4 border-l-emerald-500 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Available Inventory</span>
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                </div>
                <div className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100">
                  {totalAvailableStock.toLocaleString()}
                </div>
                <p className="text-xs text-slate-500 mt-1">Ready for Assembly</p>
              </Card>

              <Card className="p-4 border-l-4 border-l-amber-500 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Putaway Pending</span>
                  <PackageCheck className="h-5 w-5 text-amber-500" />
                </div>
                <div className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100">{pendingPutawayCount} Tasks</div>
                <p className="text-xs text-slate-500 mt-1">From Posted GRNs</p>
              </Card>

              <Card className="p-4 border-l-4 border-l-blue-500 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Material Requests</span>
                  <ClipboardList className="h-5 w-5 text-blue-500" />
                </div>
                <div className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100">{pendingRequestsCount} Requisitions</div>
                <p className="text-xs text-slate-500 mt-1">Awaiting Warehouse Approval</p>
              </Card>

              <Card className="p-4 border-l-4 border-l-indigo-500 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Picking Queue</span>
                  <ListOrdered className="h-5 w-5 text-indigo-500" />
                </div>
                <div className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100">{pendingPickingCount} Tasks</div>
                <p className="text-xs text-slate-500 mt-1">Current warehouse stock</p>
              </Card>
            </div>
          </TabsContent>

          {/* ========================================================================= */}
          {/* 2. PUTAWAY TAB */}
          {/* ========================================================================= */}
          <TabsContent value="putaway" className="space-y-6 mt-6">
            <Card className="p-5 overflow-x-auto">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-4 uppercase tracking-wider">
                Putaway Work Queue (Assign Storage Locations & Confirm)
              </h3>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 uppercase">
                    <th className="py-2.5 px-3">GRN / Task No</th>
                    <th className="py-2.5 px-3">Material</th>
                    <th className="py-2.5 px-3">Batch</th>
                    <th className="py-2.5 px-3">Quantity</th>
                    <th className="py-2.5 px-3">Assigned Rack</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {putawayTasks.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-6 text-slate-500">
                        No putaway tasks pending. Post a GRN to generate putaway work.
                      </td>
                    </tr>
                  ) : (
                    groupedPutawayTasks.map((t) => (
                      <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                        <td className="py-3 px-3 font-semibold text-indigo-600">{t.grn_number || t.key}</td>
                        <td className="py-3 px-3 font-medium">
                          <button type="button" className="text-left hover:text-indigo-600" onClick={() => setSelectedPutawayGroup(t)}>
                            {t.material_names?.join(", ") || "-"}
                            {t.material_count > 1 && <span className="ml-1 text-slate-400">({t.material_count})</span>}
                          </button>
                        </td>
                        <td className="py-3 px-3 font-mono text-slate-500">
                          {t.batch_count ? (
                            <button type="button" className="underline hover:text-indigo-600" onClick={() => setSelectedPutawayGroup(t)}>
                              {t.batch_count} batch{t.batch_count === 1 ? "" : "es"}
                            </button>
                          ) : "-"}
                        </td>
                        <td className="py-3 px-3 font-bold">{t.quantity ?? "—"} {t.uom || ""}</td>
                        <td className="py-3 px-3">
                          {t.tasks[0]?.destination_bin_code || t.tasks[0]?.destination_bin ? (
                            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 font-mono text-[10px]">
                              {t.tasks[0]?.destination_bin_code || t.tasks[0]?.destination_bin}
                            </Badge>
                          ) : (
                            <span className="text-slate-400 italic">Unassigned</span>
                          )}
                        </td>
                        <td className="py-3 px-3">
                          <Badge
                            className={cn(
                              "text-[10px] font-bold uppercase",
                              t.status === "COMPLETED" || t.status === "STORED" ? "bg-emerald-500/15 text-emerald-700" : "bg-amber-500/15 text-amber-700"
                            )}
                          >
                            {t.status || "—"}
                          </Badge>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openAssignPutaway(t.tasks[0])}
                            className="h-7 text-xs border-indigo-200 text-indigo-700"
                          >
                            Assign Rack
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openPutawayScan(t.tasks[0])}
                            disabled={!t.tasks[0]?.destination_bin_id || t.status === "PUTAWAY_COMPLETED" || t.status === "COMPLETED" || t.status === "STORED"}
                            className="h-7 text-xs border-emerald-200 text-emerald-700"
                          >
                            <Scan className="mr-1 h-3 w-3" /> Scan QR
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setSelectedPutawayGroup(t)}
                            className="h-7 text-xs"
                          >
                            View Details
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </Card>
          </TabsContent>

          {/* ========================================================================= */}
          {/* 3. INVENTORY TAB */}
          {/* ========================================================================= */}
          <TabsContent value="inventory" className="space-y-6 mt-6">
            <Card className="p-5 space-y-4">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="relative w-full sm:w-80">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                  <Input
                    placeholder="Search material, code, batch..."
                    value={invSearch}
                    onChange={(e) => setInvSearch(e.target.value)}
                    className="pl-9 text-xs"
                  />
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <Select value={invWarehouseFilter} onValueChange={setInvWarehouseFilter}>
                    <SelectTrigger className="w-40 text-xs">
                      <SelectValue placeholder="Warehouse" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">All Warehouses</SelectItem>
                      {stores.map((s) => (
                        <SelectItem key={s.id} value={s.store_code || s.store_name}>
                          {s.store_code || s.store_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 uppercase">
                      <th className="py-2.5 px-3">Material Code</th>
                      <th className="py-2.5 px-3">Material Name</th>
                      <th className="py-2.5 px-3">Batch</th>
                      <th className="py-2.5 px-3">Available Stock</th>
                      <th className="py-2.5 px-3">Location</th>
                      <th className="py-2.5 px-3 text-right">Action</th>
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
                          <td className="py-3 px-3 font-mono font-semibold text-indigo-600">{item.material_code || "-"}</td>
                          <td className="py-3 px-3 font-medium text-slate-900 dark:text-slate-100">{item.material_name || item.material}</td>
                          <td className="py-3 px-3 font-mono text-slate-500">{item.batch_number || item.batch || "-"}</td>
                          <td className="py-3 px-3 font-bold text-emerald-600">
                            {item.available ?? item.available_quantity ?? item.total_quantity ?? "—"} {item.uom || ""}
                          </td>
                          <td className="py-3 px-3">
                            <Badge variant="outline" className="text-[10px] font-mono">
                              {item.bin_code || item.location || "—"}
                            </Badge>
                          </td>
                          <td className="py-3 px-3 text-right">
                            <Button size="sm" variant="ghost" onClick={() => setSelectedInventory(item)} className="h-7 text-xs text-indigo-600">
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
            <Card className="p-5 overflow-x-auto">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-4 uppercase tracking-wider">
                Assembly Material Requisitions (Warehouse Approval & Reservation)
              </h3>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 uppercase">
                    <th className="py-2.5 px-3">Request No</th>
                    <th className="py-2.5 px-3">Assembly Order</th>
                    <th className="py-2.5 px-3">Material Required</th>
                    <th className="py-2.5 px-3">Required Qty</th>
                    <th className="py-2.5 px-3">Available Stock</th>
                    <th className="py-2.5 px-3">Status</th>
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
                        <td className="py-3 px-3 font-semibold text-indigo-600">{req.request_number || req.id}</td>
                        <td className="py-3 px-3 text-slate-600">{req.assembly_order || req.assembly_order_number || "-"}</td>
                        <td className="py-3 px-3 font-medium">{req.material_name || req.material_code}</td>
                        <td className="py-3 px-3 font-bold text-slate-900 dark:text-slate-100">{req.quantity ?? req.required_quantity ?? "—"} {req.uom || ""}</td>
                        <td className="py-3 px-3 font-bold text-emerald-600">{req.available ?? req.available_quantity ?? "—"} {req.uom || ""}</td>
                        <td className="py-3 px-3">
                          <Badge
                            className={cn(
                              "text-[10px] font-bold uppercase",
                              req.status === "APPROVED" ? "bg-emerald-500/15 text-emerald-700" : "bg-blue-500/15 text-blue-700"
                            )}
                          >
                            {req.status || "—"}
                          </Badge>
                        </td>
                        <td className="py-3 px-3 text-right">
                          {req.status !== "APPROVED" && (
                            <Button
                              size="sm"
                              onClick={() => handleApproveMaterialRequest(req)}
                              className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                            >
                              Approve Request
                            </Button>
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
          <TabsContent value="picking" className="space-y-6 mt-6">
            <Card className="p-5 overflow-x-auto">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-4 uppercase tracking-wider">
                Warehouse Picking Queue (Operator Pick Tasks)
              </h3>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 uppercase">
                    <th className="py-2.5 px-3">Task No</th>
                    <th className="py-2.5 px-3">Assembly Order</th>
                    <th className="py-2.5 px-3">Material</th>
                    <th className="py-2.5 px-3">Pick Location</th>
                    <th className="py-2.5 px-3">Quantity</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {pickupTasks.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-6 text-slate-500">
                        No pick tasks in queue. Approve a Material Request to generate pick tasks.
                      </td>
                    </tr>
                  ) : (
                    pickupTasks.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                        <td className="py-3 px-3 font-semibold text-indigo-600">{p.task_number || p.id}</td>
                        <td className="py-3 px-3 text-slate-600">{p.assembly_order_number || p.assembly_order || "-"}</td>
                        <td className="py-3 px-3 font-medium">{p.material_name || p.material_code}</td>
                        <td className="py-3 px-3">
                          <Badge variant="outline" className="bg-slate-50 font-mono text-[10px]">
                            {p.pick_location || "—"}
                          </Badge>
                        </td>
                        <td className="py-3 px-3 font-bold">{p.quantity ?? "—"} {p.uom || ""}</td>
                        <td className="py-3 px-3">
                          <Badge
                            className={cn(
                              "text-[10px] font-bold uppercase",
                              p.status === "COMPLETED" ? "bg-emerald-500/15 text-emerald-700" : "bg-indigo-500/15 text-indigo-700"
                            )}
                          >
                            {p.status || "—"}
                          </Badge>
                        </td>
                        <td className="py-3 px-3 text-right">
                          {p.status !== "COMPLETED" && (
                            <Button
                              size="sm"
                              onClick={() => setPickupToConfirm(p)}
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
          </TabsContent>

          {/* ========================================================================= */}
          {/* 7. LOCATIONS TAB */}
          {/* ========================================================================= */}
          <TabsContent value="locations" className="space-y-6 mt-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-indigo-600" /> Warehouse Location Hierarchy
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">Warehouse → Zone → Rack → Shelf/Position → Bin</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setCreateLocationType("store")} className="gap-1 text-xs">
                  <Plus className="h-3.5 w-3.5 text-indigo-600" /> Add Warehouse
                </Button>
                <Button size="sm" variant="outline" onClick={() => setCreateLocationType("zone")} className="gap-1 text-xs">
                  <Plus className="h-3.5 w-3.5 text-indigo-600" /> Add Zone
                </Button>
                <Button size="sm" onClick={() => setCreateLocationType("bin")} className="gap-1 text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-semibold shadow-sm">
                  <Plus className="h-3.5 w-3.5" /> Add Bin
                </Button>
              </div>
            </div>

            {false && <Card className="p-5 space-y-4">
              <div>
                <h3 className="text-base font-bold">Dock allocation for Gate Entry</h3>
                <p className="text-xs text-muted-foreground mt-1">Allocate an available dock to an approved gate entry. Gate Security is notified on allocation and release.</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => navigate({ to: "/dock-management" })}>Manage docks</Button>
              {dockRequests.length > 0 && (
                <div className="space-y-2">
                  {dockRequests.map((request) => (
                    <div key={request.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
                      <div className="min-w-48 flex-1 text-xs">
                        <strong>{request.vehicle_number}</strong> · {request.existing_gate_pass_id}
                      </div>
                      <select className="h-9 rounded-md border bg-background px-2 text-xs" value={dockChoices[request.id] || ""} onChange={(event) => setDockChoices((current) => ({ ...current, [request.id]: event.target.value }))}>
                        <option value="">Select available dock</option>
                        {docks.filter((dock) => dock.status === "AVAILABLE").map((dock) => <option key={dock.id} value={dock.id}>{dock.dock_code} · {dock.dock_name}</option>)}
                      </select>
                      <select className="h-9 rounded-md border bg-background px-2 text-xs" value={dockStoreChoices[request.id] || ""} onChange={(event) => setDockStoreChoices((current) => ({ ...current, [request.id]: event.target.value }))}>
                        <option value="">Select warehouse</option>
                        {stores.filter((store) => (store.status || "").toUpperCase() === "ACTIVE").map((store) => <option key={store.id} value={store.id}>{store.store_name} · {store.store_code}</option>)}
                      </select>
                      <Button size="sm" disabled={isSubmitting || !stores.length} onClick={() => void handleAllocateDockFromLocations(request.id)}>Allocate dock</Button>
                    </div>
                  ))}
                </div>
              )}
              <div className="space-y-2">
                {docks.filter((dock) => ["OCCUPIED", "RESERVED"].includes(dock.status)).map((dock) => (
                  <div key={dock.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-xs">
                    <span><strong>{dock.dock_code}</strong>{dock.current_allocation?.vehicle_number ? ` · ${dock.current_allocation.vehicle_number}` : ""} · {dock.status}</span>
                    <Button size="sm" variant="outline" disabled={isSubmitting || !dock.current_allocation?.id} onClick={() => void handleReleaseDockFromLocations(dock)}>Release dock</Button>
                  </div>
                ))}
                {!dockRequests.length && !docks.some((dock) => ["OCCUPIED", "RESERVED"].includes(dock.status)) && <p className="text-xs text-muted-foreground">No pending gate entries or active dock allocations.</p>}
              </div>
            </Card>}

            {/* Bins List Table */}
            <Card className="p-5 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 uppercase">
                    <th className="py-2.5 px-3">Bin Code</th>
                    <th className="py-2.5 px-3">Rack</th>
                    <th className="py-2.5 px-3">Shelf / Position</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">QR Code</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {allFlattenedBins.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-6 text-slate-500">
                        No storage bins configured in database. Click "Add Bin" above to create a location.
                      </td>
                    </tr>
                  ) : (
                    allFlattenedBins.map((b) => (
                      <tr key={b.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                        <td className="py-3 px-3 font-bold text-indigo-600">{b.bin_code}</td>
                        <td className="py-3 px-3 font-medium text-slate-700">{b.rack || "—"}</td>
                        <td className="py-3 px-3 text-slate-500">{b.position || "—"}</td>
                        <td className="py-3 px-3">
                          <Badge className="text-[10px] font-bold">{b.status || "UNKNOWN"}</Badge>
                        </td>
                        <td className="py-3 px-3 font-mono text-[10px] text-slate-500">
                          {b.qr_identifier || "—"}
                        </td>
                        <td className="py-3 px-3 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setViewBinQrModal(b)}
                            className="h-7 text-xs gap-1.5 border-indigo-200 text-indigo-600 hover:bg-indigo-50"
                          >
                            <QrCode className="h-3.5 w-3.5" /> View QR & Placed Material
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* ========================================================================= */}
      {/* MODALS */}
      {/* ========================================================================= */}

      <Dialog open={Boolean(pickupToConfirm)} onOpenChange={(open) => {
        if (!open && !isSubmitting) {
          setPickupToConfirm(null);
          setPickupConfirmation({ material_scan: "", zone_scan: "", quantity: "" });
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm physical pick</DialogTitle>
            <DialogDescription>
              Enter the scanned material and storage location codes and the quantity actually picked. Stock updates only after the server validates them.
            </DialogDescription>
          </DialogHeader>
          {pickupToConfirm && (
            <form onSubmit={handleCompletePickup} className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Task {pickupToConfirm.task_number || pickupToConfirm.id} · {pickupToConfirm.material_name || pickupToConfirm.material_code}
              </p>
              <div className="space-y-2">
                <label className="text-xs font-semibold" htmlFor="pickup-material-scan">Material code / QR scan</label>
                <Input id="pickup-material-scan" required value={pickupConfirmation.material_scan} onChange={(event) => setPickupConfirmation((current) => ({ ...current, material_scan: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold" htmlFor="pickup-zone-scan">Zone or bin code / QR scan</label>
                <Input id="pickup-zone-scan" required value={pickupConfirmation.zone_scan} onChange={(event) => setPickupConfirmation((current) => ({ ...current, zone_scan: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold" htmlFor="pickup-quantity">Quantity picked {pickupToConfirm.uom ? `(${pickupToConfirm.uom})` : ""}</label>
                <Input id="pickup-quantity" type="number" min="0.0001" step="0.0001" required value={pickupConfirmation.quantity} onChange={(event) => setPickupConfirmation((current) => ({ ...current, quantity: event.target.value }))} />
                {pickupToConfirm.requested_quantity != null && <p className="text-xs text-muted-foreground">Requested: {pickupToConfirm.requested_quantity} {pickupToConfirm.uom || ""}</p>}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setPickupToConfirm(null)}>Cancel</Button>
                <Button type="submit" disabled={isSubmitting || !pickupConfirmation.material_scan.trim() || !pickupConfirmation.zone_scan.trim() || Number(pickupConfirmation.quantity) <= 0}>
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm pick"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* 1. Assign Storage Location Modal */}
      <Dialog open={!!assignPutawayTask} onOpenChange={() => setAssignPutawayTask(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Storage Location</DialogTitle>
            <DialogDescription>
              Select destination rack for Putaway Task {assignPutawayTask?.grn_number}
            </DialogDescription>
          </DialogHeader>

          {assignPutawayTask && (
            <div className="space-y-4 text-xs py-2">
              <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg space-y-1">
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  {assignPutawayTask.material_name || "-"}
                </div>
                <div className="text-slate-500">
                  Quantity: {assignPutawayTask.quantity ?? "—"} {assignPutawayTask.uom || ""} | Batch: {assignPutawayTask.batch_number || "—"}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <Select value={assignStoreId} onValueChange={(value) => { setAssignStoreId(value); setAssignZoneId(""); setSelectedLocationId(""); }}>
                  <SelectTrigger className="text-xs"><SelectValue placeholder="Select warehouse" /></SelectTrigger>
                  <SelectContent>{stores.filter((s) => !s.status || String(s.status).toUpperCase() === "ACTIVE").map((s) => <SelectItem key={s.id} value={s.id}>{s.store_code} - {s.store_name}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={assignZoneId} onValueChange={(value) => { setAssignZoneId(value); setSelectedLocationId(""); }} disabled={!assignStoreId}>
                  <SelectTrigger className="text-xs"><SelectValue placeholder="Select zone" /></SelectTrigger>
                  <SelectContent>{zones.filter((z) => z.store_id === assignStoreId && (!z.status || String(z.status).toUpperCase() === "ACTIVE")).map((z) => <SelectItem key={z.id} value={z.id}>{z.zone_code || z.zone_name}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={selectedLocationId} onValueChange={setSelectedLocationId} disabled={!assignZoneId}>
                  <SelectTrigger className="text-xs"><SelectValue placeholder="Select active rack" /></SelectTrigger>
                  <SelectContent>{allFlattenedBins.filter((loc) => loc.store_id === assignStoreId && loc.zone_id === assignZoneId && (!loc.status || ["ACTIVE", "AVAILABLE"].includes(String(loc.status).toUpperCase()))).map((loc) => <SelectItem key={loc.id} value={loc.id}>{loc.rack || loc.bin_code} ({loc.bin_code})</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="font-semibold">Assign Quantity ({assignPutawayTask.uom || "PCS"})</label>
                <Input type="number" min="0.0001" step="0.0001" max={assignPutawayTask.quantity} value={assignQuantity} onChange={(event) => setAssignQuantity(event.target.value)} />
                <p className="text-xs text-slate-500">Selected batch: {assignPutawayTask.quantity ?? 0} {assignPutawayTask.uom || "PCS"} · Remaining: {Math.max(0, Number(assignPutawayTask.quantity || 0) - Number(assignQuantity || 0))} {assignPutawayTask.uom || "PCS"}</p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignPutawayTask(null)}>
              Cancel
            </Button>
            <Button onClick={handleConfirmAssignPutaway} disabled={isSubmitting || !assignStoreId || !assignZoneId || !selectedLocationId || !Number.isFinite(Number(assignQuantity)) || Number(assignQuantity) <= 0 || Number(assignQuantity) > Number(assignPutawayTask?.quantity || 0)} className="bg-indigo-600 text-white">
              ASSIGN RACK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 1b. Scan and confirm physical rack putaway */}
      <Dialog open={!!scanPutawayTask} onOpenChange={() => setScanPutawayTask(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Scan Material & Rack</DialogTitle>
            <DialogDescription>Scan the existing material QR first, then scan the assigned rack QR.</DialogDescription>
          </DialogHeader>
          {scanPutawayTask && (
            <div className="space-y-4 text-xs">
              <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900">
                <div className="font-semibold">{scanPutawayTask.material_name || scanPutawayTask.item_code}</div>
                <div className="text-slate-500">GRN: {scanPutawayTask.grn_number || "-"} · Batch: {scanPutawayTask.batch_number || "-"}</div>
                <div className="mt-1 font-semibold">Pending: {scanPutawayTask.quantity} {scanPutawayTask.uom || ""}</div>
              </div>
              <div className="space-y-1.5">
                <label className="font-semibold">Material QR</label>
                <div className="flex gap-2"><Input className="flex-1" value={putawayScan.materialQr} placeholder="Scan material QR" onChange={(e) => { setMaterialQrVerified(false); setPutawayScan((s) => ({ ...s, materialQr: e.target.value })); }} autoFocus /><Button type="button" variant="outline" size="sm" onClick={() => setCameraField("material")}><Camera className="mr-1 h-4 w-4" />Scan with Camera</Button></div>
                <div className="flex items-center gap-2"><label className="cursor-pointer text-xs text-primary underline">Upload QR Image<input type="file" accept="image/png,image/jpeg,image/jpg" className="hidden" onChange={(e) => e.target.files?.[0] && decodeQrUpload(e.target.files[0], "material")} /></label>{materialQrVerified && <span className="font-semibold text-emerald-600">✓ Verified</span>}</div>
                <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => putawayQrImages.material && setQrPreview({ title: "Material QR", image: putawayQrImages.material })}>View QR</Button>
              </div>
              <div className="space-y-1.5">
                <label className="font-semibold">Rack QR</label>
                <div className="flex gap-2"><Input className="flex-1" value={putawayScan.rackQr} placeholder="Scan rack QR" onChange={(e) => { setRackQrVerified(false); setPutawayScan((s) => ({ ...s, rackQr: e.target.value })); }} /><Button type="button" variant="outline" size="sm" onClick={() => setCameraField("rack")}><Camera className="mr-1 h-4 w-4" />Scan with Camera</Button></div>
                <div className="flex items-center gap-2"><label className="cursor-pointer text-xs text-primary underline">Upload QR Image<input type="file" accept="image/png,image/jpeg,image/jpg" className="hidden" onChange={(e) => e.target.files?.[0] && decodeQrUpload(e.target.files[0], "rack")} /></label>{rackQrVerified && <span className="font-semibold text-emerald-600">✓ Verified</span>}</div>
                {qrScanError && <p className="text-xs text-rose-600">{qrScanError}</p>}
                <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => putawayQrImages.rack && setQrPreview({ title: "Rack QR", image: putawayQrImages.rack })}>View QR</Button>
              </div>
              <div className="space-y-1.5">
                <label className="font-semibold">Stored quantity {scanPutawayTask.uom ? `(${scanPutawayTask.uom})` : ""}</label>
                <Input type="number" min="0.0001" step="0.0001" max={scanPutawayTask.quantity} value={putawayScan.quantity} onChange={(e) => setPutawayScan((s) => ({ ...s, quantity: e.target.value }))} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setScanPutawayTask(null)}>Cancel</Button>
            <Button onClick={handleConfirmPutaway} disabled={isSubmitting || !putawayScanValid} className="bg-emerald-600 text-white">
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm Putaway"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!cameraField} onOpenChange={(open) => !open && setCameraField(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-sm">
          <DialogHeader><DialogTitle>Scan {cameraField === "material" ? "Material" : "Rack"} QR</DialogTitle><DialogDescription>Allow camera access and hold the QR label inside the frame.</DialogDescription></DialogHeader>
          <video ref={cameraVideoRef} className="w-full rounded-xl bg-black" playsInline muted />
          <canvas ref={cameraCanvasRef} className="hidden" />
          {cameraError && <p className="text-sm text-rose-600">{cameraError}</p>}
          <DialogFooter><Button type="button" variant="outline" onClick={() => setCameraField(null)}>Use Manual Entry</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!qrPreview} onOpenChange={(open) => !open && setQrPreview(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-xs">
          <DialogHeader><DialogTitle>{qrPreview?.title}</DialogTitle></DialogHeader>
          {qrPreview?.image && <>
            <img src={qrPreview.image} alt={qrPreview.title} className="mx-auto h-56 w-56 rounded-lg border bg-white p-3" />
            <a href={qrPreview.image} download={`${qrPreview.title.replaceAll(" ", "-").toLowerCase()}.png`} className="mx-auto block text-center text-sm font-semibold text-primary underline">Download QR Image</a>
          </>}
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedPutawayGroup} onOpenChange={() => setSelectedPutawayGroup(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Putaway Details</DialogTitle>
            <DialogDescription>
              {selectedPutawayGroup?.grn_number || "GRN"}
            </DialogDescription>
          </DialogHeader>
          {selectedPutawayGroup && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3 rounded-xl border bg-muted/20 p-4 sm:grid-cols-4">
                <div><span className="text-xs text-muted-foreground">GRN Number</span><p className="font-mono font-bold">{selectedPutawayGroup.grn_number || ""}</p></div>
                <div><span className="text-xs text-muted-foreground">Materials</span><p className="font-bold">{selectedPutawayGroup.material_count}</p></div>
                <div><span className="text-xs text-muted-foreground">Batches</span><p className="font-bold">{selectedPutawayGroup.batch_count}</p></div>
                <div><span className="text-xs text-muted-foreground">Total Quantity</span><p className="font-bold">{selectedPutawayGroup.quantity} {selectedPutawayGroup.uom}</p></div>
              </div>
              <div className="max-h-64 overflow-auto rounded-xl border">
                {selectedPutawayGroup.tasks.map((task: any) => (
                  <div key={task.id} className="grid grid-cols-4 gap-2 border-b p-3 last:border-0">
                    <span className="font-medium">{task.material_name || task.item_code || "—"}</span>
                    <span className="font-mono text-muted-foreground">{task.batch_number || ""}</span>
                    <span>{task.quantity ?? "—"} {task.uom || ""}</span>
                    <span className="text-right">{task.status || "—"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 2. Inventory Detail Modal */}
      <Dialog open={!!selectedInventory} onOpenChange={() => setSelectedInventory(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedInventory?.material_name || selectedInventory?.material || "Material Details"}</DialogTitle>
          </DialogHeader>

          {selectedInventory && (
            <div className="space-y-4 text-xs py-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-slate-500">Material Code:</span>
                  <div className="font-mono font-semibold">{selectedInventory.material_code || "-"}</div>
                </div>
                <div>
                  <span className="text-slate-500">Batch:</span>
                  <div className="font-mono font-semibold">{selectedInventory.batch_details?.length ? selectedInventory.batch_details.map((b: any) => b.batch_number).join(", ") : selectedInventory.batch_number || selectedInventory.batch || "-"}</div>
                </div>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg space-y-1">
                <div className="font-bold uppercase tracking-wider text-[10px] text-slate-400">Storage Location</div>
                <div className="font-semibold">{selectedInventory.warehouse || selectedInventory.warehouse_id || "-"} → {selectedInventory.zone_code || selectedInventory.zone_name || "-"} → {selectedInventory.bin_code || selectedInventory.location || "-"}</div>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg space-y-2">
                <div className="font-bold uppercase tracking-wider text-[10px] text-slate-400">Batch-wise Stock</div>
                {(selectedInventory.batch_details || []).length > 0 ? selectedInventory.batch_details.map((batch: any) => (
                  <div key={batch.batch_number} className="flex justify-between border-b last:border-0 pb-1 last:pb-0">
                    <span className="font-mono">{batch.batch_number}</span>
                    <span className="font-semibold">{batch.quantity} {batch.uom || selectedInventory.uom || ""}</span>
                  </div>
                )) : <div className="text-slate-500">No batch movement details available.</div>}
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg space-y-2">
                <div className="font-bold uppercase tracking-wider text-[10px] text-slate-400">Stock</div>
                <div className="flex justify-between font-medium">
                  <span>Total Physical Stock:</span>
                  <span className="font-bold">{selectedInventory.total_quantity ?? selectedInventory.on_hand_quantity ?? "—"} {selectedInventory.uom || ""}</span>
                </div>
                <div className="flex justify-between font-medium text-emerald-600">
                  <span>Available Stock:</span>
                  <span className="font-bold">{selectedInventory.available ?? selectedInventory.available_quantity ?? "—"} {selectedInventory.uom || ""}</span>
                </div>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg space-y-1">
                <div className="font-bold uppercase tracking-wider text-[10px] text-slate-400">Location</div>
                <div className="font-semibold text-slate-800 dark:text-slate-200">
                  {selectedInventory.bin_code || selectedInventory.location || "-"}
                </div>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg space-y-1">
                <div className="font-bold uppercase tracking-wider text-[10px] text-slate-400">Source</div>
                <div>GRN: {selectedInventory.grn_number || "-"}</div>
                <div>Supplier: {selectedInventory.supplier_name || "-"}</div>
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
              Scanned location details and real-time physical stock placed in this bin.
            </DialogDescription>
          </DialogHeader>

          {viewBinQrModal && (() => {
            const bCode = viewBinQrModal.bin_code;
            const placedItems = inventorySummary.filter((item) => {
              const itemLoc = (item.bin_code || item.location || "").toLowerCase();
              return itemLoc.includes(bCode.toLowerCase());
            });

            const qrCodeVal = viewBinQrModal.qr_identifier;

            return (
              <div className="space-y-4 text-xs py-2">
                <div className="flex flex-col sm:flex-row items-center gap-4 p-4 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
                  <div className="p-3 bg-white rounded-lg border-2 border-indigo-600 shadow-inner flex flex-col items-center">
                    {binQrImage ? <img src={binQrImage} alt={`QR code for ${viewBinQrModal.bin_code}`} className="h-32 w-32" /> : <p className="h-32 w-32 flex items-center justify-center text-center text-[10px] text-muted-foreground">QR code unavailable for this bin</p>}
                  </div>
                  <div className="space-y-1 flex-1 text-center sm:text-left">
                    <div className="text-[11px] font-bold text-indigo-600 font-mono">{qrCodeVal}</div>
                    <h4 className="font-extrabold text-base text-slate-900 dark:text-slate-100">{viewBinQrModal.bin_code}</h4>
                    <p className="text-slate-500 font-medium">
                      Rack: <span className="font-semibold text-slate-800 dark:text-slate-200">{viewBinQrModal.rack || "—"}</span> | Shelf: <span className="font-semibold text-slate-800 dark:text-slate-200">{viewBinQrModal.position || "—"}</span>
                    </p>
                    <Badge className="bg-emerald-500/15 text-emerald-700 text-[10px] font-bold uppercase mt-1">
                      STATUS: {viewBinQrModal.status || "UNKNOWN"}
                    </Badge>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-xs uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                      <Boxes className="h-4 w-4 text-indigo-600" /> Placed Materials in Bin ({placedItems.length})
                    </h4>
                    {placedItems.length > 0 ? (
                      <Badge className="bg-emerald-600 text-white text-[10px] font-bold">
                        {placedItems.reduce((acc, i) => acc + Number(i.available ?? i.total_quantity ?? 0), 0)} {placedItems[0]?.uom || ""} STORED
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-slate-500 text-[10px]">BIN IS EMPTY</Badge>
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
                          <th className="py-2 px-3">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
                        {placedItems.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="text-center py-6 text-slate-400">
                              No materials currently placed in this bin location. Ready for Putaway.
                            </td>
                          </tr>
                        ) : (
                          placedItems.map((item, idx) => (
                            <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                              <td className="py-2.5 px-3">
                                <div className="font-bold text-slate-900 dark:text-slate-100">{item.material_name || item.material}</div>
                                <div className="font-mono text-[10px] text-slate-400">{item.material_code || "-"}</div>
                              </td>
                              <td className="py-2.5 px-3 font-mono text-indigo-600">{item.batch_number || item.batch || "-"}</td>
                              <td className="py-2.5 px-3 font-bold text-emerald-600">{item.available ?? item.total_quantity ?? 0} {item.uom || ""}</td>
                              <td className="py-2.5 px-3 font-mono text-slate-500">{item.grn_number || "-"}</td>
                              <td className="py-2.5 px-3">
                                <Badge className="text-[9px] font-bold uppercase">{item.status || "UNKNOWN"}</Badge>
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

      {/* 4. Create Location Entity Modal (Add Warehouse, Add Zone, Add Bin) */}
      <Dialog open={!!createLocationType} onOpenChange={(open) => !open && setCreateLocationType(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-indigo-600" />
              {createLocationType === "store" && "Add New Warehouse / Store"}
              {createLocationType === "zone" && "Add New Storage Zone"}
              {createLocationType === "bin" && "Add Storage Bin (Rack, Shelf & Auto QR)"}
            </DialogTitle>
            <DialogDescription>
              {createLocationType === "store" && "Create an authoritative warehouse storage unit in database."}
              {createLocationType === "zone" && "Define a zone within an existing warehouse."}
              {createLocationType === "bin" && "Configure a physical bin with Rack, Shelf/Position, and auto-generated QR code."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateLocationSubmit} className="space-y-4 text-xs py-2">
            {createLocationType === "store" && (
              <>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Warehouse Name</label>
                  <Input
                    required
                    placeholder="e.g. Main Raw Material Warehouse 2"
                    value={newStoreForm.store_name}
                    onChange={(e) => setNewStoreForm({ ...newStoreForm, store_name: e.target.value })}
                  />
                </div>
              </>
            )}

            {createLocationType === "zone" && (
              <>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Target Warehouse</label>
                  <Select
                    value={newZoneForm.store_id}
                    onValueChange={(val) => setNewZoneForm({ ...newZoneForm, store_id: val })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select Store..." />
                    </SelectTrigger>
                    <SelectContent>
                      {stores.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.store_code} - {s.store_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Zone Name</label>
                  <Input
                    required
                    placeholder="e.g. Zone B - Heavy Metals & Fasteners"
                    value={newZoneForm.zone_name}
                    onChange={(e) => setNewZoneForm({ ...newZoneForm, zone_name: e.target.value })}
                  />
                </div>
              </>
            )}

            {createLocationType === "bin" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-700">Warehouse</label>
                    <Select
                      value={newBinForm.store_id}
                      onValueChange={(val) => setNewBinForm({ ...newBinForm, store_id: val })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select Warehouse..." />
                      </SelectTrigger>
                      <SelectContent>
                        {stores.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.store_code} - {s.store_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <label className="font-semibold text-slate-700">Zone</label>
                    <Select
                      value={newBinForm.zone_id}
                      onValueChange={(val) => setNewBinForm({ ...newBinForm, zone_id: val })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select Zone..." />
                      </SelectTrigger>
                      <SelectContent>
                        {zones.map((z) => (
                          <SelectItem key={z.id} value={z.id}>
                            {z.zone_code || z.zone_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1"><label className="font-semibold text-slate-700">Rack Prefix</label><Input value={rackGenerator.prefix} placeholder="RACK-" onChange={(e) => setRackGenerator({ ...rackGenerator, prefix: e.target.value })} /></div>
                  <div className="space-y-1"><label className="font-semibold text-slate-700">Starting Number</label><Input type="number" min={1} value={rackGenerator.start} onChange={(e) => setRackGenerator({ ...rackGenerator, start: e.target.value })} /></div>
                  <div className="space-y-1"><label className="font-semibold text-slate-700">Number of Racks</label><Input type="number" min={1} max={100} value={rackGenerator.count} onChange={(e) => setRackGenerator({ ...rackGenerator, count: e.target.value })} /></div>
                </div>
                <div className="rounded-lg border bg-muted/20 p-3 text-xs font-mono">
                  Preview: {rackGenerator.prefix || "RACK-"}{String(Number(rackGenerator.start) || 1).padStart(3, "0")} to {rackGenerator.prefix || "RACK-"}{String((Number(rackGenerator.start) || 1) + Math.max(1, Number(rackGenerator.count) || 1) - 1).padStart(3, "0")}
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => void printRackQrLabels()}><QrCode className="mr-1.5 size-4" /> Print All QR Labels</Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => toast.info("Preview uses the generated rack range shown above.")}>Preview</Button>
                </div>
                <div className="hidden grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-700">Rack</label>
                    <Input
                      placeholder="Enter rack"
                      value={newBinRows[0].rack}
                      onChange={(e) => setNewBinRows((rows) => rows.map((row, i) => i === 0 ? { ...row, rack: e.target.value } : row))}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-700">Shelf / Position</label>
                    <Input
                      placeholder="Enter shelf or position"
                      value={newBinRows[0].position}
                      onChange={(e) => setNewBinRows((rows) => rows.map((row, i) => i === 0 ? { ...row, position: e.target.value } : row))}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-700">Bin Code</label>
                    <Input
                      placeholder="Enter bin code"
                      value={newBinRows[0].bin_code}
                      onChange={(e) => setNewBinRows((rows) => rows.map((row, i) => i === 0 ? { ...row, bin_code: e.target.value } : row))}
                    />
                  </div>
                </div>

                {false && newBinRows.length > 1 && newBinRows.slice(1).map((row, rowIndex) => {
                  const index = rowIndex + 1;
                  return (
                    <div key={index} className="grid grid-cols-3 gap-2 items-end">
                      <Input placeholder="Enter rack" value={row.rack} onChange={(e) => setNewBinRows((rows) => rows.map((item, i) => i === index ? { ...item, rack: e.target.value } : item))} />
                      <Input placeholder="Enter shelf or position" value={row.position} onChange={(e) => setNewBinRows((rows) => rows.map((item, i) => i === index ? { ...item, position: e.target.value } : item))} />
                      <div className="flex gap-2"><Input placeholder="Enter bin code" value={row.bin_code} onChange={(e) => setNewBinRows((rows) => rows.map((item, i) => i === index ? { ...item, bin_code: e.target.value } : item))} /><Button type="button" variant="outline" onClick={() => setNewBinRows((rows) => rows.filter((_, i) => i !== index))}>Remove</Button></div>
                    </div>
                  );
                })}
                <Button className="hidden" type="button" variant="outline" size="sm" onClick={() => setNewBinRows((rows) => [...rows, { rack: "", position: "", bin_code: "" }])}>
                  + Add Rack Row
                </Button>

                {/* Auto-Generated QR Code Preview */}
                <div className="p-3 bg-indigo-50/50 dark:bg-indigo-950/30 rounded-lg border border-indigo-100 dark:border-indigo-900 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[11px] uppercase tracking-wider text-indigo-700 dark:text-indigo-300 flex items-center gap-1">
                      <QrCode className="h-3.5 w-3.5 text-indigo-600" /> Auto-Generated Bin QR Code
                    </span>
                    <Badge variant="outline" className="bg-white text-[10px] border-indigo-200 text-indigo-700 font-mono">
                      AUTO-GENERATE
                    </Badge>
                  </div>
                  <div className="font-mono font-bold text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-900 p-2 rounded border border-indigo-200 text-xs">
                    {newBinForm.store_id && newBinForm.zone_id && newBinRows[0].rack && newBinRows[0].position && newBinRows[0].bin_code
                      ? `QR-LOC-${stores.find(s => s.id === newBinForm.store_id)?.store_code}-${zones.find(z => z.id === newBinForm.zone_id)?.zone_code}-${newBinRows[0].rack}-${newBinRows[0].position}-${newBinRows[0].bin_code}`
                      : "Select a warehouse and zone and enter rack, position, and bin code."}
                  </div>
                </div>
              </>
            )}

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setCreateLocationType(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting} className="bg-indigo-600 text-white">
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : createLocationType === "bin" ? "Bulk Create Racks" : `Create ${createLocationType?.toUpperCase()}`}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
