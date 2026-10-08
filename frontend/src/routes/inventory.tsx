import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState, useMemo, useCallback } from "react";
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

type TabType = "dashboard" | "putaway" | "inventory" | "requests" | "picking" | "locations";

function SimpleWarehouseModule() {
  const navigate = useNavigate();
  const searchParams: any = useSearch({ from: "/inventory" });
  const tabOptions: TabType[] = ["dashboard", "putaway", "inventory", "requests", "picking", "locations"];
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
  const [assignPutawayTask, setAssignPutawayTask] = useState<any>(null);
  const [pickupToConfirm, setPickupToConfirm] = useState<any>(null);
  const [pickupConfirmation, setPickupConfirmation] = useState({ material_scan: "", zone_scan: "", quantity: "" });
  const [selectedLocationId, setSelectedLocationId] = useState("");

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
  const [viewBinQrModal, setViewBinQrModal] = useState<any>(null);
  const [binQrImage, setBinQrImage] = useState<string | null>(null);

  // Submitting States
  const [isSubmitting, setIsSubmitting] = useState(false);

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
      ] = await Promise.all([
        api.getPutawayTasks(),
        api.getWarehouseInventorySummary(),
        api.getMaterialRequests(),
        api.getPickupTasks(),
        api.getStores(),
      ]);

      setPutawayTasks(Array.isArray(putawaysRes) ? putawaysRes : []);
      setInventorySummary(Array.isArray(inventoryRes) ? inventoryRes : []);
      setMaterialRequests(Array.isArray(requestsRes) ? requestsRes : []);
      setPickupTasks(Array.isArray(pickupsRes) ? pickupsRes : []);
      setStores(Array.isArray(storesRes) ? storesRes : []);

      const locationRows = await Promise.all((Array.isArray(storesRes) ? storesRes : []).map(async (store: any) => {
        const storeZones = await api.getStoreZones(store.id);
        const storeBins = await Promise.all((Array.isArray(storeZones) ? storeZones : []).map((zone: any) => api.getStoreBins(store.id, zone.id)));
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
    if (!selectedLocationId) {
      toast.error("Please select a Storage Location.");
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
  const handleCreateLocationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      if (createLocationType === "store") {
        if (!newStoreForm.store_code || !newStoreForm.store_name) {
          toast.error("Please fill in Store Code and Store Name.");
          return;
        }
        await api.createStore(newStoreForm);
        toast.success(`✓ Warehouse created: ${newStoreForm.store_name} (${newStoreForm.store_code})`);
      } else if (createLocationType === "zone") {
        const targetStoreId = newZoneForm.store_id;
        if (!targetStoreId) {
          toast.error("Select a warehouse before creating a zone.");
          return;
        }
        if (!newZoneForm.zone_code || !newZoneForm.zone_name) {
          toast.error("Please fill in Zone Code and Zone Name.");
          return;
        }
        await api.createZone(targetStoreId, newZoneForm);
        toast.success(`✓ Storage Zone created: ${newZoneForm.zone_name} (${newZoneForm.zone_code})`);
      } else if (createLocationType === "bin") {
        const targetStoreId = newBinForm.store_id;
        const targetZoneId = newBinForm.zone_id;
        if (!targetStoreId || !targetZoneId) {
          toast.error("Select a warehouse and zone before creating a bin.");
          return;
        }
        const selectedZoneObj = zones.find((z) => z.id === targetZoneId);

        if (!newBinForm.bin_code) {
          toast.error("Please enter a Bin Code.");
          return;
        }

        const qrVal = `QR-LOC-${stores.find(s => s.id === targetStoreId)?.store_code}-${selectedZoneObj?.zone_code}-${newBinForm.rack}-${newBinForm.position}-${newBinForm.bin_code}`;

        const binRes = await api.createBin(targetStoreId, targetZoneId, {
          bin_code: newBinForm.bin_code,
          bin_name: newBinForm.bin_code,
          rack: newBinForm.rack,
          position: newBinForm.position,
          qr_identifier: qrVal,
        });
        toast.success(`✓ Storage Bin created: ${newBinForm.bin_code} (Rack: ${newBinForm.rack}, Shelf: ${newBinForm.position}) with Auto QR Code!`);
      }
      setCreateLocationType(null);
      void fetchData(true);
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
          <TabsList className="bg-slate-100 dark:bg-slate-900 p-1 rounded-xl flex flex-wrap gap-1 w-full justify-start border border-slate-200 dark:border-slate-800">
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
          </TabsList>

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
                    <th className="py-2.5 px-3">Assigned Bin</th>
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
                    putawayTasks.map((t) => (
                      <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                        <td className="py-3 px-3 font-semibold text-indigo-600">{t.grn_number || t.task_number || t.id}</td>
                        <td className="py-3 px-3 font-medium">{t.material_name || t.item_code}</td>
                        <td className="py-3 px-3 font-mono text-slate-500">{t.batch_number || "-"}</td>
                        <td className="py-3 px-3 font-bold">{t.quantity ?? "—"} {t.uom || ""}</td>
                        <td className="py-3 px-3">
                          {t.destination_bin_code || t.destination_bin ? (
                            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 font-mono text-[10px]">
                              {t.destination_bin_code || t.destination_bin}
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
                            onClick={() => setAssignPutawayTask(t)}
                            className="h-7 text-xs border-indigo-200 text-indigo-700"
                          >
                            Assign Bin
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

            <Card className="p-5 space-y-4">
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
            </Card>

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
              Select destination bin for Putaway Task {assignPutawayTask?.grn_number}
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

              <div className="space-y-1.5">
                <label className="font-semibold text-slate-700 dark:text-slate-300">Single Storage Location Selector</label>
                {allFlattenedBins.length === 0 ? (
                  <p className="text-xs text-rose-500">No bins available in database. Create a bin in Locations tab first.</p>
                ) : (
                  <Select value={selectedLocationId} onValueChange={setSelectedLocationId}>
                    <SelectTrigger className="w-full text-xs">
                      <SelectValue placeholder="Search location (ZONE / RACK / BIN)..." />
                    </SelectTrigger>
                    <SelectContent>
                      {allFlattenedBins.map((loc) => (
                        <SelectItem key={loc.id} value={loc.id}>
                          {loc.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignPutawayTask(null)}>
              Cancel
            </Button>
            <Button onClick={handleConfirmAssignPutaway} disabled={isSubmitting || allFlattenedBins.length === 0} className="bg-indigo-600 text-white">
              ASSIGN
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 2. Inventory Detail Modal */}
      <Dialog open={!!selectedInventory} onOpenChange={() => setSelectedInventory(null)}>
        <DialogContent className="max-w-md">
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
                  <div className="font-mono font-semibold">{selectedInventory.batch_number || selectedInventory.batch || "-"}</div>
                </div>
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
                  <label className="font-semibold text-slate-700">Warehouse Code</label>
                  <Input
                    required
                    placeholder="Enter warehouse code"
                    value={newStoreForm.store_code}
                    onChange={(e) => setNewStoreForm({ ...newStoreForm, store_code: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Warehouse Name</label>
                  <Input
                    required
                    placeholder="e.g. Main Raw Material Warehouse 2"
                    value={newStoreForm.store_name}
                    onChange={(e) => setNewStoreForm({ ...newStoreForm, store_name: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Description</label>
                  <Input
                    placeholder="Primary storage facility for raw assembly parts"
                    value={newStoreForm.description}
                    onChange={(e) => setNewStoreForm({ ...newStoreForm, description: e.target.value })}
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
                  <label className="font-semibold text-slate-700">Zone Code</label>
                  <Input
                    required
                    placeholder="Enter zone code"
                    value={newZoneForm.zone_code}
                    onChange={(e) => setNewZoneForm({ ...newZoneForm, zone_code: e.target.value })}
                  />
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
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-700">Rack</label>
                    <Input
                      required
                      placeholder="Enter rack"
                      value={newBinForm.rack}
                      onChange={(e) => setNewBinForm({ ...newBinForm, rack: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-700">Shelf / Position</label>
                    <Input
                      required
                      placeholder="Enter shelf or position"
                      value={newBinForm.position}
                      onChange={(e) => setNewBinForm({ ...newBinForm, position: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-700">Bin Code</label>
                    <Input
                      required
                      placeholder="Enter bin code"
                      value={newBinForm.bin_code}
                      onChange={(e) => setNewBinForm({ ...newBinForm, bin_code: e.target.value })}
                    />
                  </div>
                </div>

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
                    {newBinForm.store_id && newBinForm.zone_id && newBinForm.rack && newBinForm.position && newBinForm.bin_code
                      ? `QR-LOC-${stores.find(s => s.id === newBinForm.store_id)?.store_code}-${zones.find(z => z.id === newBinForm.zone_id)?.zone_code}-${newBinForm.rack}-${newBinForm.position}-${newBinForm.bin_code}`
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
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : `Create ${createLocationType?.toUpperCase()}`}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
