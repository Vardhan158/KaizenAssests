import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo, Fragment } from "react";
import {
  Building2,
  Plus,
  Search,
  Loader2,
  Edit,
  Power,
  ShieldCheck,
  UserCheck,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Layers,
  ChevronDown,
  ChevronRight,
  Tag,
  Users,
  KeyRound,
  Mail,
  UserPlus,
  QrCode,
  Printer,
  Download,
  Grid,
  Box,
  Trash2,
} from "lucide-react";
import QRCode from "qrcode";
import { AppShell, StatusBadge } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
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
import { api } from "@/lib/api-client";
import { requireRole } from "@/lib/auth-utils";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/warehouse/stores")({
  beforeLoad: () => requireRole(["ADMIN", "WAREHOUSE", "WAREHOUSE_MANAGER", "SUPERUSER"]),
  head: () => ({
    meta: [
      { title: "Store Master, Zones & Bins · KaizenX" },
      {
        name: "description",
        content:
          "Warehouse organizational store master data, zone and bin hierarchy, and manager user provisioning.",
      },
    ],
  }),
  component: WarehouseStores,
});

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
  status: string;
  created_at?: string;
  updated_at?: string;
}

interface Zone {
  id: string;
  store_id: string;
  zone_code: string;
  zone_name: string;
  description?: string | null;
  status: string;
  bins?: Bin[];
}

interface Store {
  id: string;
  store_code: string;
  store_name: string;
  store_type?: string | null;
  description?: string | null;
  warehouse_id: string;
  store_manager_id?: string | null;
  store_manager_name?: string | null;
  status: string;
  created_at?: string;
  updated_at?: string;
  zones?: Zone[];
}

interface StoreManagerUser {
  id: string;
  employee_id: string;
  username: string;
  full_name: string;
  email: string;
  store_id: string;
  store_code?: string | null;
  store_name?: string | null;
  status: string;
  created_at?: string;
  updated_at?: string;
}

function WarehouseStores() {
  const [activeTab, setActiveTab] = useState<"stores" | "managers">("stores");
  const [stores, setStores] = useState<Store[]>([]);
  const [storeManagers, setStoreManagers] = useState<StoreManagerUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [expandedStoreIds, setExpandedStoreIds] = useState<Set<string>>(new Set());
  const [expandedZoneIds, setExpandedZoneIds] = useState<Set<string>>(new Set());

  // Create Store Modal State
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [previewCode, setPreviewCode] = useState("STR-001");
  const [newStoreName, setNewStoreName] = useState("");
  const [newStoreType, setNewStoreType] = useState("RAW_MATERIAL");
  const [newDescription, setNewDescription] = useState("");
  const [newWarehouseId, setNewWarehouseId] = useState("Main Warehouse");
  const [newManagerId, setNewManagerId] = useState("NONE");
  const [newStatus, setNewStatus] = useState("ACTIVE");

  // Edit Store Modal State
  const [editOpen, setEditOpen] = useState(false);
  const [editingStore, setEditingStore] = useState<Store | null>(null);
  const [saving, setSaving] = useState(false);
  const [editStoreName, setEditStoreName] = useState("");
  const [editStoreType, setEditStoreType] = useState("RAW_MATERIAL");
  const [editDescription, setEditDescription] = useState("");
  const [editWarehouseId, setEditWarehouseId] = useState("Main Warehouse");
  const [editManagerId, setEditManagerId] = useState("NONE");
  const [editStatus, setEditStatus] = useState("ACTIVE");

  // Create Zone Modal State
  const [createZoneOpen, setCreateZoneOpen] = useState(false);
  const [targetStoreForZone, setTargetStoreForZone] = useState<Store | null>(null);
  const [creatingZone, setCreatingZone] = useState(false);
  const [newZoneName, setNewZoneName] = useState("");
  const [newZoneDesc, setNewZoneDesc] = useState("");
  const [previewZoneCode, setPreviewZoneCode] = useState("");

  // Create Bin Modal State
  const [createBinOpen, setCreateBinOpen] = useState(false);
  const [targetZoneForBin, setTargetZoneForBin] = useState<Zone | null>(null);
  const [targetStoreForBin, setTargetStoreForBin] = useState<Store | null>(null);
  const [creatingBin, setCreatingBin] = useState(false);
  const [newBinName, setNewBinName] = useState("");
  const [newBinRack, setNewBinRack] = useState("R01");
  const [newBinShelf, setNewBinShelf] = useState("S01");
  const [newBinCapacity, setNewBinCapacity] = useState("1000");
  const [previewBinCode, setPreviewBinCode] = useState("");

  // Create Store Manager Modal State
  const [createMgrOpen, setCreateMgrOpen] = useState(false);
  const [creatingMgr, setCreatingMgr] = useState(false);
  const [mgrFullName, setMgrFullName] = useState("");
  const [mgrEmployeeId, setMgrEmployeeId] = useState("");
  const [mgrUsername, setMgrUsername] = useState("");
  const [mgrEmail, setMgrEmail] = useState("");
  const [mgrPassword, setMgrPassword] = useState("password");
  const [mgrStoreId, setMgrStoreId] = useState("");
  const [mgrStatus, setMgrStatus] = useState("ACTIVE");

  // Edit Store Manager Modal State
  const [editMgrOpen, setEditMgrOpen] = useState(false);
  const [editingMgr, setEditingMgr] = useState<StoreManagerUser | null>(null);
  const [savingMgr, setSavingMgr] = useState(false);
  const [editMgrFullName, setEditMgrFullName] = useState("");
  const [editMgrEmail, setEditMgrEmail] = useState("");
  const [editMgrPassword, setEditMgrPassword] = useState("");
  const [editMgrStoreId, setEditMgrStoreId] = useState("");
  const [editMgrStatus, setEditMgrStatus] = useState("ACTIVE");

  // Zone QR Modal State
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [selectedZoneForQr, setSelectedZoneForQr] = useState<any | null>(null);
  const [selectedStoreForQr, setSelectedStoreForQr] = useState<Store | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [loadingQr, setLoadingQr] = useState(false);

  // Bin QR Modal State
  const [binQrModalOpen, setBinQrModalOpen] = useState(false);
  const [selectedBinForQr, setSelectedBinForQr] = useState<Bin | null>(null);
  const [selectedZoneForBinQr, setSelectedZoneForBinQr] = useState<Zone | null>(null);
  const [selectedStoreForBinQr, setSelectedStoreForBinQr] = useState<Store | null>(null);
  const [binQrDataUrl, setBinQrDataUrl] = useState<string | null>(null);
  const [loadingBinQr, setLoadingBinQr] = useState(false);

  // Delete Store State
  const [deleteStoreModal, setDeleteStoreModal] = useState<Store | null>(null);
  const [deletingStore, setDeletingStore] = useState(false);

  const handleDeleteStore = async () => {
    if (!deleteStoreModal) return;
    if (stores.length <= 1) {
      toast.error("Cannot delete the sole remaining Chemical Store in the system.");
      setDeleteStoreModal(null);
      return;
    }
    setDeletingStore(true);
    try {
      await api.deleteStore(deleteStoreModal.id);
      toast.success(`Store ${deleteStoreModal.store_name} (${deleteStoreModal.store_code}) deleted.`);
      setDeleteStoreModal(null);
      await loadData();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete store");
    } finally {
      setDeletingStore(false);
    }
  };

  const handleViewZoneQR = async (z: any, parentStore: Store) => {
    setSelectedZoneForQr(z);
    setSelectedStoreForQr(parentStore);
    setQrDataUrl(null);
    setLoadingQr(true);
    setQrModalOpen(true);
    try {
      const qrData = await api.getZoneQR(z.id);
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
            <div class="store-name">${selectedStoreForQr?.store_code || "STORE"} · ${selectedStoreForQr?.store_name || "Store"}</div>
            <div class="zone-code">${selectedZoneForQr.zone_code}</div>
            <div class="zone-name">${selectedZoneForQr.zone_name}</div>
            <img src="${qrDataUrl}" alt="Zone QR Code" />
            <div class="meta">Zone ID: ${selectedZoneForQr.id}<br/>Warehouse: ${selectedStoreForQr?.warehouse_id || "Main Warehouse"}</div>
          </div>
          <script>
            window.onload = function() { window.print(); window.close(); }
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleViewBinQR = async (b: Bin, parentZone: Zone, parentStore: Store) => {
    setSelectedBinForQr(b);
    setSelectedZoneForBinQr(parentZone);
    setSelectedStoreForBinQr(parentStore);
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
            <div class="store-name">${selectedStoreForBinQr?.store_code || "STORE"} · ${selectedZoneForBinQr?.zone_code || "ZONE"}</div>
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

  const loadData = async () => {
    setLoading(true);
    try {
      const [hierarchyData, managersData] = await Promise.all([
        api.getStoreHierarchy().catch(() => []),
        api.getStoreManagers().catch(() => []),
      ]);
      setStores(hierarchyData || []);
      setStoreManagers(managersData || []);
    } catch (err: any) {
      toast.error(err.message || "Failed to load store and manager master data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const openCreateStoreDialog = async () => {
    setNewStoreName("");
    setNewStoreType("RAW_MATERIAL");
    setNewDescription("");
    setNewWarehouseId("Main Warehouse");
    setNewManagerId("NONE");
    setNewStatus("ACTIVE");
    try {
      const res = await api.getNextStoreCode();
      if (res?.suggested_store_code) {
        setPreviewCode(res.suggested_store_code);
      }
    } catch {
      setPreviewCode("STR-001");
    }
    setCreateOpen(true);
  };

  const handleCreateStore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStoreName.trim()) {
      toast.error("Please provide a valid store name.");
      return;
    }

    setCreating(true);
    try {
      const selectedMgr = storeManagers.find((m) => m.employee_id === newManagerId);
      const payload: any = {
        store_name: newStoreName.trim(),
        store_type: newStoreType,
        description: newDescription.trim() || undefined,
        warehouse_id: newWarehouseId.trim() || "Main Warehouse",
        status: newStatus,
      };

      if (selectedMgr) {
        payload.store_manager_id = selectedMgr.employee_id;
        payload.store_manager_name = selectedMgr.full_name;
      }

      const created = await api.createStore(payload);
      toast.success(`Store ${created.store_code} (${created.store_name}) created successfully!`);
      setCreateOpen(false);
      await loadData();
    } catch (err: any) {
      toast.error(err.message || "Failed to create store.");
    } finally {
      setCreating(false);
    }
  };

  const openEditStoreDialog = (store: Store) => {
    setEditingStore(store);
    setEditStoreName(store.store_name);
    setEditStoreType(store.store_type || "RAW_MATERIAL");
    setEditDescription(store.description || "");
    setEditWarehouseId(store.warehouse_id || "Main Warehouse");
    setEditManagerId(store.store_manager_id || "NONE");
    setEditStatus(store.status || "ACTIVE");
    setEditOpen(true);
  };

  const handleSaveStoreEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStore) return;
    if (!editStoreName.trim()) {
      toast.error("Store name cannot be empty.");
      return;
    }

    setSaving(true);
    try {
      const selectedMgr = storeManagers.find((m) => m.employee_id === editManagerId);
      const payload: any = {
        store_name: editStoreName.trim(),
        store_type: editStoreType,
        description: editDescription.trim() || undefined,
        warehouse_id: editWarehouseId.trim() || "Main Warehouse",
        status: editStatus,
        store_manager_id: selectedMgr ? selectedMgr.employee_id : null,
        store_manager_name: selectedMgr ? selectedMgr.full_name : null,
      };

      await api.updateStore(editingStore.id, payload);
      toast.success(`Store ${editingStore.store_code} updated successfully!`);
      setEditOpen(false);
      await loadData();
    } catch (err: any) {
      toast.error(err.message || "Failed to update store.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStoreStatus = async (store: Store) => {
    const nextStatus = store.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    try {
      await api.updateStoreStatus(store.id, nextStatus);
      toast.success(`Store ${store.store_code} is now ${nextStatus}`);
      await loadData();
    } catch (err: any) {
      toast.error(err.message || "Failed to toggle store status.");
    }
  };

  // Add Zone Dialog
  const openCreateZoneDialog = async (store: Store) => {
    setTargetStoreForZone(store);
    setNewZoneName("");
    setNewZoneDesc("");
    try {
      const res = await api.getNextZoneCode(store.id);
      if (res?.suggested_zone_code) {
        setPreviewZoneCode(res.suggested_zone_code);
      }
    } catch {
      setPreviewZoneCode(`${store.store_code}-Z01`);
    }
    setCreateZoneOpen(true);
  };

  const handleCreateZone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetStoreForZone) return;
    if (!newZoneName.trim()) {
      toast.error("Please enter a Zone Name");
      return;
    }

    setCreatingZone(true);
    try {
      const res = await api.createZone(targetStoreForZone.id, {
        zone_name: newZoneName.trim(),
        description: newZoneDesc.trim() || undefined,
        status: "ACTIVE",
      });
      toast.success(`Zone ${res.zone_code} created under ${targetStoreForZone.store_code}`);
      setCreateZoneOpen(false);
      await loadData();
    } catch (err: any) {
      toast.error(err.message || "Failed to create zone");
    } finally {
      setCreatingZone(false);
    }
  };

  // Add Bin Dialog
  const openCreateBinDialog = async (zone: Zone, store: Store) => {
    setTargetZoneForBin(zone);
    setTargetStoreForBin(store);
    setNewBinName(`${zone.zone_name} Bin`);
    setNewBinRack("R01");
    setNewBinShelf("S01");
    setNewBinCapacity("1000");
    try {
      const res = await api.getNextBinCode(zone.id);
      if (res?.suggested_bin_code) {
        setPreviewBinCode(res.suggested_bin_code);
      }
    } catch {
      setPreviewBinCode(`BIN-${zone.zone_code}-001`);
    }
    setCreateBinOpen(true);
  };

  const handleCreateBin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetZoneForBin || !targetStoreForBin) return;
    if (!newBinName.trim()) {
      toast.error("Please enter a Bin Name");
      return;
    }

    setCreatingBin(true);
    try {
      const res = await api.createBin(targetZoneForBin.id, {
        bin_name: newBinName.trim(),
        rack: newBinRack.trim() || "R01",
        shelf: newBinShelf.trim() || "S01",
        capacity: parseFloat(newBinCapacity) || 1000,
        status: "ACTIVE",
      });
      toast.success(`Bin ${res.bin_code} created under ${targetZoneForBin.zone_code}`);
      setCreateBinOpen(false);
      await loadData();
    } catch (err: any) {
      toast.error(err.message || "Failed to create bin");
    } finally {
      setCreatingBin(false);
    }
  };

  const handleToggleBinStatus = async (bin: Bin) => {
    const nextStatus = bin.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    try {
      await api.updateBinStatus(bin.id, nextStatus);
      toast.success(`Bin ${bin.bin_code} is now ${nextStatus}`);
      await loadData();
    } catch (err: any) {
      toast.error(err.message || "Failed to update bin status");
    }
  };

  // Store Manager Actions
  const openCreateMgrDialog = () => {
    setMgrFullName("");
    const autoEmpId = `EMP-MGR-${Math.floor(100000 + Math.random() * 900000)}`;
    setMgrEmployeeId(autoEmpId);
    setMgrUsername("");
    setMgrEmail("");
    setMgrPassword("password");
    setMgrStoreId(stores[0]?.id || "");
    setMgrStatus("ACTIVE");
    setCreateMgrOpen(true);
  };

  const handleCreateMgr = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !mgrFullName.trim() ||
      !mgrEmployeeId.trim() ||
      !mgrUsername.trim() ||
      !mgrEmail.trim() ||
      !mgrStoreId
    ) {
      toast.error("Please fill in all required fields.");
      return;
    }

    setCreatingMgr(true);
    try {
      const created = await api.createStoreManager({
        full_name: mgrFullName.trim(),
        employee_id: mgrEmployeeId.trim().toUpperCase(),
        username: mgrUsername.trim().toLowerCase(),
        email: mgrEmail.trim().toLowerCase(),
        password: mgrPassword,
        store_id: mgrStoreId,
        status: mgrStatus,
      });

      toast.success(
        `Store Manager ${created.full_name} (${created.employee_id}) created successfully!`,
      );
      setCreateMgrOpen(false);
      await loadData();
    } catch (err: any) {
      toast.error(err.message || "Failed to create store manager account.");
    } finally {
      setCreatingMgr(false);
    }
  };

  const openEditMgrDialog = (mgr: StoreManagerUser) => {
    setEditingMgr(mgr);
    setEditMgrFullName(mgr.full_name);
    setEditMgrEmail(mgr.email);
    setEditMgrStoreId(mgr.store_id);
    setEditMgrStatus(mgr.status || "ACTIVE");
    setEditMgrPassword("");
    setEditMgrOpen(true);
  };

  const handleSaveMgrEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMgr) return;

    setSavingMgr(true);
    try {
      const payload: any = {
        full_name: editMgrFullName.trim(),
        email: editMgrEmail.trim().toLowerCase(),
        store_id: editMgrStoreId,
        status: editMgrStatus,
      };
      if (editMgrPassword.trim()) {
        payload.password = editMgrPassword.trim();
      }

      await api.updateStoreManager(editingMgr.id, payload);
      toast.success(`Store Manager ${editingMgr.employee_id} updated successfully!`);
      setEditMgrOpen(false);
      await loadData();
    } catch (err: any) {
      toast.error(err.message || "Failed to update store manager.");
    } finally {
      setSavingMgr(false);
    }
  };

  const handleToggleMgrStatus = async (mgr: StoreManagerUser) => {
    const nextStatus = mgr.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    try {
      await api.updateStoreManagerStatus(mgr.id, nextStatus);
      toast.success(`Manager ${mgr.employee_id} status changed to ${nextStatus}`);
      await loadData();
    } catch (err: any) {
      toast.error(err.message || "Failed to change manager status.");
    }
  };

  const toggleExpand = (storeId: string) => {
    setExpandedStoreIds((prev) => {
      const next = new Set(prev);
      if (next.has(storeId)) {
        next.delete(storeId);
      } else {
        next.add(storeId);
      }
      return next;
    });
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

  // Filtered lists
  const filteredStores = useMemo(() => {
    return stores.filter((s) => {
      const matchesStatus = statusFilter === "ALL" || s.status === statusFilter;
      const q = search.toLowerCase().trim();
      const matchesSearch =
        !q ||
        s.store_code.toLowerCase().includes(q) ||
        s.store_name.toLowerCase().includes(q) ||
        (s.store_manager_name && s.store_manager_name.toLowerCase().includes(q)) ||
        (s.description && s.description.toLowerCase().includes(q));
      return matchesStatus && matchesSearch;
    });
  }, [stores, statusFilter, search]);

  const filteredManagers = useMemo(() => {
    return storeManagers.filter((m) => {
      const matchesStatus = statusFilter === "ALL" || m.status === statusFilter;
      const q = search.toLowerCase().trim();
      const matchesSearch =
        !q ||
        m.employee_id.toLowerCase().includes(q) ||
        m.full_name.toLowerCase().includes(q) ||
        m.username.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q) ||
        (m.store_code && m.store_code.toLowerCase().includes(q));
      return matchesStatus && matchesSearch;
    });
  }, [storeManagers, statusFilter, search]);

  // Metrics
  const totalStores = stores.length;
  const activeStores = stores.filter((s) => s.status === "ACTIVE").length;
  const totalZones = stores.reduce((acc, s) => acc + (s.zones?.length || 0), 0);
  const totalBins = stores.reduce(
    (acc, s) => acc + (s.zones || []).reduce((zAcc, z) => zAcc + (z.bins?.length || 0), 0),
    0,
  );
  const totalManagers = storeManagers.length;
  const activeManagers = storeManagers.filter((m) => m.status === "ACTIVE").length;

  return (
    <AppShell
      title="Store Master, Zones & Bins"
      subtitle="Warehouse location hierarchy: Warehouse → Store → Zone → Bin with strict physical isolation and QR codes."
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            disabled={loading}
            className="rounded-xl text-xs"
          >
            <RefreshCw className={cn("size-3.5 mr-1.5", loading && "animate-spin")} />
            Refresh
          </Button>
          {activeTab === "stores" ? (
            <Button
              onClick={openCreateStoreDialog}
              size="sm"
              className="rounded-xl shadow-glow text-xs font-semibold"
            >
              <Plus className="size-3.5 mr-1.5" />
              Create Store
            </Button>
          ) : (
            <Button
              onClick={openCreateMgrDialog}
              size="sm"
              className="rounded-xl shadow-glow text-xs font-semibold"
            >
              <UserPlus className="size-3.5 mr-1.5" />
              Provision Store Manager
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-5">
        {/* Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="rounded-2xl border bg-card/60 shadow-subtle p-3.5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                  Total Stores
                </p>
                <p className="text-xl font-bold mt-1 text-foreground">{totalStores}</p>
              </div>
              <div className="size-9 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                <Building2 className="size-4" />
              </div>
            </div>
          </Card>

          <Card className="rounded-2xl border bg-card/60 shadow-subtle p-3.5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                  Total Zones
                </p>
                <p className="text-xl font-bold mt-1 text-indigo-500">{totalZones}</p>
              </div>
              <div className="size-9 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-500">
                <Layers className="size-4" />
              </div>
            </div>
          </Card>

          <Card className="rounded-2xl border bg-card/60 shadow-subtle p-3.5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                  Physical Bins
                </p>
                <p className="text-xl font-bold mt-1 text-emerald-500">{totalBins}</p>
              </div>
              <div className="size-9 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                <Grid className="size-4" />
              </div>
            </div>
          </Card>

          <Card className="rounded-2xl border bg-card/60 shadow-subtle p-3.5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                  Store Managers
                </p>
                <p className="text-xl font-bold mt-1 text-amber-500">
                  {activeManagers} / {totalManagers}
                </p>
              </div>
              <div className="size-9 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-500">
                <Users className="size-4" />
              </div>
            </div>
          </Card>
        </div>

        {/* Tab Toggle Navigation */}
        <div className="flex items-center gap-2 border-b pb-3">
          <Button
            variant={activeTab === "stores" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveTab("stores")}
            className="rounded-xl text-xs font-semibold gap-1.5"
          >
            <Building2 className="size-3.5" />
            Stores, Zones & Bins ({stores.length})
          </Button>
          <Button
            variant={activeTab === "managers" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveTab("managers")}
            className="rounded-xl text-xs font-semibold gap-1.5"
          >
            <Users className="size-3.5" />
            Store Manager Accounts ({storeManagers.length})
          </Button>
        </div>

        {/* Filters and Search Bar */}
        <Card className="rounded-2xl border bg-card/40 p-3 shadow-subtle">
          <div className="flex flex-col sm:flex-row gap-2.5 items-center justify-between">
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
              <Input
                placeholder={
                  activeTab === "stores"
                    ? "Search store code, name, manager..."
                    : "Search manager name, employee ID, username, email..."
                }
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 text-xs rounded-xl bg-background/50 h-9"
              />
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-36 text-xs rounded-xl h-9">
                  <SelectValue placeholder="Status Filter" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Status</SelectItem>
                  <SelectItem value="ACTIVE">Active Only</SelectItem>
                  <SelectItem value="INACTIVE">Inactive Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </Card>

        {/* TAB 1: STORES, ZONES & BINS HIERARCHY */}
        {activeTab === "stores" && (
          <Card className="rounded-2xl border overflow-hidden shadow-subtle">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-muted/40 text-muted-foreground uppercase text-[10px] font-semibold border-b">
                  <tr>
                    <th className="py-2.5 px-3 w-8"></th>
                    <th className="py-2.5 px-3">Store Code</th>
                    <th className="py-2.5 px-3">Store Name</th>
                    <th className="py-2.5 px-3">Warehouse</th>
                    <th className="py-2.5 px-3">Store Manager</th>
                    <th className="py-2.5 px-3">Zones & Bins</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {loading ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-muted-foreground">
                        <Loader2 className="size-5 animate-spin mx-auto mb-2 text-primary" />
                        Loading Stores & Hierarchy...
                      </td>
                    </tr>
                  ) : filteredStores.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-muted-foreground">
                        No stores found matching your query.
                      </td>
                    </tr>
                  ) : (
                    filteredStores.map((store) => {
                      const isExpanded = expandedStoreIds.has(store.id);
                      const zonesCount = store.zones?.length || 0;
                      const binsCount = (store.zones || []).reduce(
                        (acc, z) => acc + (z.bins?.length || 0),
                        0,
                      );

                      return (
                        <Fragment key={store.id}>
                          <tr
                            className={cn(
                              "hover:bg-muted/20 transition-colors",
                              isExpanded && "bg-muted/10",
                            )}
                          >
                            <td className="py-2.5 px-3 text-center">
                              <button
                                type="button"
                                onClick={() => toggleExpand(store.id)}
                                className="p-1 rounded-md hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
                              >
                                {isExpanded ? (
                                  <ChevronDown className="size-3.5 text-primary" />
                                ) : (
                                  <ChevronRight className="size-3.5" />
                                )}
                              </button>
                            </td>
                            <td className="py-2.5 px-3 font-mono font-semibold text-primary">
                              {store.store_code}
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="flex items-center gap-1.5">
                                <span className="font-semibold text-foreground">
                                  {store.store_name}
                                </span>
                                <span
                                  className={cn(
                                    "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-bold uppercase",
                                    store.store_type === "FINISHED_GOODS"
                                      ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                                      : store.store_type === "CHEMICAL"
                                        ? "bg-amber-500/10 text-amber-500 border border-amber-500/20"
                                        : "bg-primary/10 text-primary border border-primary/20",
                                  )}
                                >
                                  {store.store_type?.replace(/_/g, " ") || "RAW MATERIAL"}
                                </span>
                              </div>
                              {store.description && (
                                <div className="text-[11px] text-muted-foreground truncate max-w-xs">
                                  {store.description}
                                </div>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-muted-foreground">
                              {store.warehouse_id}
                            </td>
                            <td className="py-2.5 px-3">
                              {store.store_manager_name ? (
                                <div className="flex items-center gap-1 text-foreground font-medium">
                                  <UserCheck className="size-3 text-emerald-500" />
                                  <span>{store.store_manager_name}</span>
                                </div>
                              ) : (
                                <span className="text-muted-foreground/60 italic text-[11px]">
                                  Unassigned
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={cn(
                                    "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border font-mono",
                                    zonesCount > 0
                                      ? "bg-indigo-500/10 text-indigo-400 border-indigo-500/20"
                                      : "bg-muted/30 text-muted-foreground border-border/40",
                                  )}
                                >
                                  <Layers className="size-3" />
                                  {zonesCount} {zonesCount === 1 ? "zone" : "zones"}
                                </span>
                                <span
                                  className={cn(
                                    "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border font-mono",
                                    binsCount > 0
                                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                      : "bg-muted/30 text-muted-foreground border-border/40",
                                  )}
                                >
                                  <Grid className="size-3" />
                                  {binsCount} {binsCount === 1 ? "bin" : "bins"}
                                </span>
                              </div>
                            </td>
                            <td className="py-2.5 px-3">
                              <StatusBadge status={store.status} />
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => openCreateZoneDialog(store)}
                                  className="h-7 px-2 text-[11px] rounded-lg text-indigo-400 hover:bg-indigo-500/10"
                                  title="Add Zone to Store"
                                >
                                  <Plus className="size-3 mr-1" /> Zone
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => openEditStoreDialog(store)}
                                  className="size-7 rounded-lg text-muted-foreground hover:text-foreground"
                                  title="Edit Store Details"
                                >
                                  <Edit className="size-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleToggleStoreStatus(store)}
                                  className={cn(
                                    "size-7 rounded-lg",
                                    store.status === "ACTIVE"
                                      ? "text-muted-foreground hover:text-rose-400"
                                      : "text-muted-foreground hover:text-emerald-400",
                                  )}
                                  title={
                                    store.status === "ACTIVE"
                                      ? "Deactivate Store"
                                      : "Activate Store"
                                  }
                                >
                                  <Power className="size-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => setDeleteStoreModal(store)}
                                  className="size-7 rounded-lg text-muted-foreground hover:text-rose-500"
                                  title="Delete Store"
                                  disabled={stores.length <= 1}
                                >
                                  <Trash2 className="size-3.5" />
                                </Button>
                              </div>
                            </td>
                          </tr>

                          {/* Expanded Nested Zones & Bins View */}
                          {isExpanded && (
                            <tr key={`${store.id}-zones`} className="bg-muted/10">
                              <td colSpan={8} className="p-3 pl-10 border-b border-border/60">
                                <div className="rounded-xl border bg-card/80 p-3 space-y-3">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <Layers className="size-4 text-indigo-400" />
                                      <span className="font-semibold text-xs text-foreground">
                                        Zones inside {store.store_name} ({store.store_code})
                                      </span>
                                    </div>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => openCreateZoneDialog(store)}
                                      className="h-6 px-2 text-[10px] rounded-md"
                                    >
                                      <Plus className="size-3 mr-1" /> Add Zone
                                    </Button>
                                  </div>

                                  {store.zones && store.zones.length > 0 ? (
                                    <div className="space-y-2 pt-1">
                                      {store.zones.map((z) => {
                                        const isZoneExpanded = expandedZoneIds.has(z.id);
                                        const binsInZone = z.bins || [];

                                        return (
                                          <div
                                            key={z.id}
                                            className="rounded-lg border bg-background/50 text-xs overflow-hidden"
                                          >
                                            <div className="flex items-center justify-between p-2.5 hover:bg-muted/20 transition-colors">
                                              <div className="flex items-center gap-2">
                                                <button
                                                  type="button"
                                                  onClick={() => toggleExpandZone(z.id)}
                                                  className="p-0.5 rounded hover:bg-muted/60 text-muted-foreground"
                                                >
                                                  {isZoneExpanded ? (
                                                    <ChevronDown className="size-3 text-indigo-400" />
                                                  ) : (
                                                    <ChevronRight className="size-3" />
                                                  )}
                                                </button>
                                                <span className="font-mono font-bold text-indigo-400">
                                                  {z.zone_code}
                                                </span>
                                                <span className="font-medium text-foreground">
                                                  {z.zone_name}
                                                </span>
                                                {z.description && (
                                                  <span className="text-[11px] text-muted-foreground truncate max-w-xs">
                                                    · {z.description}
                                                  </span>
                                                )}
                                              </div>

                                              <div className="flex items-center gap-2">
                                                <span className="font-mono text-[10px] text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded">
                                                  {binsInZone.length}{" "}
                                                  {binsInZone.length === 1 ? "bin" : "bins"}
                                                </span>
                                                <StatusBadge status={z.status} />
                                                <Button
                                                  variant="ghost"
                                                  size="sm"
                                                  onClick={() => openCreateBinDialog(z, store)}
                                                  className="h-6 px-1.5 text-[10px] rounded-md text-emerald-500 hover:bg-emerald-500/10"
                                                  title="Add Bin to Zone"
                                                >
                                                  <Plus className="size-3 mr-1" /> Bin
                                                </Button>
                                                <Button
                                                  variant="ghost"
                                                  size="sm"
                                                  onClick={() => handleViewZoneQR(z, store)}
                                                  className="h-6 px-1.5 text-[10px] rounded-md text-primary hover:bg-primary/10"
                                                  title="View / Print Zone QR"
                                                >
                                                  <QrCode className="size-3 mr-1" /> Zone QR
                                                </Button>
                                              </div>
                                            </div>

                                            {/* Nested Bins inside Zone */}
                                            {isZoneExpanded && (
                                              <div className="p-2.5 pl-8 border-t border-border/40 bg-muted/10 space-y-1.5">
                                                <div className="flex items-center justify-between text-[11px] text-muted-foreground font-semibold">
                                                  <div className="flex items-center gap-1.5">
                                                    <Grid className="size-3 text-emerald-400" />
                                                    <span>
                                                      Physical Storage Bins in {z.zone_code}
                                                    </span>
                                                  </div>
                                                  <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={() => openCreateBinDialog(z, store)}
                                                    className="h-5 px-1.5 text-[10px] text-emerald-500 hover:bg-emerald-500/10"
                                                  >
                                                    <Plus className="size-2.5 mr-1" /> New Bin
                                                  </Button>
                                                </div>

                                                {binsInZone.length > 0 ? (
                                                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 pt-1">
                                                    {binsInZone.map((b) => (
                                                      <div
                                                        key={b.id}
                                                        className="flex items-start justify-between p-2 rounded-md border bg-card/60 text-xs hover:border-emerald-500/30 transition-colors"
                                                      >
                                                        <div className="space-y-0.5">
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
                                                              onClick={() =>
                                                                handleViewBinQR(b, z, store)
                                                              }
                                                              className="h-5 px-1 text-[9px] rounded text-primary hover:bg-primary/10"
                                                              title="View Bin QR Label"
                                                            >
                                                              <QrCode className="size-2.5 mr-0.5" />{" "}
                                                              QR
                                                            </Button>
                                                            <Button
                                                              variant="ghost"
                                                              size="icon"
                                                              onClick={() =>
                                                                handleToggleBinStatus(b)
                                                              }
                                                              className={cn(
                                                                "size-5 rounded",
                                                                b.status === "ACTIVE"
                                                                  ? "text-muted-foreground hover:text-rose-400"
                                                                  : "text-muted-foreground hover:text-emerald-400",
                                                              )}
                                                              title={
                                                                b.status === "ACTIVE"
                                                                  ? "Deactivate Bin"
                                                                  : "Activate Bin"
                                                              }
                                                            >
                                                              <Power className="size-2.5" />
                                                            </Button>
                                                          </div>
                                                        </div>
                                                      </div>
                                                    ))}
                                                  </div>
                                                ) : (
                                                  <div className="py-2 text-center text-muted-foreground text-[11px] italic">
                                                    No physical bins created yet in this zone. Click
                                                    "+ New Bin" to add one.
                                                  </div>
                                                )}
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  ) : (
                                    <div className="py-3 text-center text-muted-foreground text-xs italic">
                                      No zones created yet for this store. Click "+ Add Zone" above
                                      to configure zones.
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* TAB 2: STORE MANAGERS USER ACCOUNTS */}
        {activeTab === "managers" && (
          <Card className="rounded-2xl border overflow-hidden shadow-subtle">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-muted/40 text-muted-foreground uppercase text-[10px] font-semibold border-b">
                  <tr>
                    <th className="py-2.5 px-3">Employee ID</th>
                    <th className="py-2.5 px-3">Manager Name</th>
                    <th className="py-2.5 px-3">Username</th>
                    <th className="py-2.5 px-3">Email</th>
                    <th className="py-2.5 px-3">Assigned Store</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-muted-foreground">
                        <Loader2 className="size-5 animate-spin mx-auto mb-2 text-primary" />
                        Loading Store Manager Accounts...
                      </td>
                    </tr>
                  ) : filteredManagers.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-muted-foreground">
                        No Store Manager accounts found matching your filter.
                      </td>
                    </tr>
                  ) : (
                    filteredManagers.map((mgr) => (
                      <tr key={mgr.id} className="hover:bg-muted/20 transition-colors">
                        <td className="py-2.5 px-3 font-mono font-bold text-amber-400">
                          {mgr.employee_id}
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-foreground">
                          {mgr.full_name}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-muted-foreground">
                          {mgr.username}
                        </td>
                        <td className="py-2.5 px-3 text-muted-foreground">
                          <div className="flex items-center gap-1.5">
                            <Mail className="size-3 text-muted-foreground/60" />
                            <span>{mgr.email}</span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          {mgr.store_code ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border bg-primary/10 text-primary border-primary/20">
                              <Building2 className="size-3" />
                              {mgr.store_code} — {mgr.store_name}
                            </span>
                          ) : (
                            <span className="text-muted-foreground italic">Unassigned</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          <StatusBadge status={mgr.status} />
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEditMgrDialog(mgr)}
                              className="size-7 rounded-lg text-muted-foreground hover:text-foreground"
                              title="Edit Manager Account"
                            >
                              <Edit className="size-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleToggleMgrStatus(mgr)}
                              className={cn(
                                "size-7 rounded-lg",
                                mgr.status === "ACTIVE"
                                  ? "text-muted-foreground hover:text-rose-400"
                                  : "text-muted-foreground hover:text-emerald-400",
                              )}
                              title={
                                mgr.status === "ACTIVE" ? "Deactivate Manager" : "Activate Manager"
                              }
                            >
                              <Power className="size-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      {/* CREATE STORE DIALOG */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <Building2 className="size-4 text-primary" />
              Create Warehouse Store
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Define a new storage store. Store Code is sequentially generated automatically.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateStore} className="space-y-3.5 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Store Code (Auto-Generated)</Label>
              <Input
                value={previewCode}
                disabled
                className="text-xs bg-muted/50 font-mono font-bold text-primary rounded-xl"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">
                Store Name <span className="text-rose-500">*</span>
              </Label>
              <Input
                placeholder="e.g. Electrical & Instrumentation Store"
                value={newStoreName}
                onChange={(e) => setNewStoreName(e.target.value)}
                required
                className="text-xs rounded-xl"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Store Type</Label>
              <Select value={newStoreType} onValueChange={setNewStoreType}>
                <SelectTrigger className="text-xs rounded-xl">
                  <SelectValue placeholder="Select store type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="RAW_MATERIAL">Raw Material Store</SelectItem>
                  <SelectItem value="FINISHED_GOODS">Finished Goods Store</SelectItem>
                  <SelectItem value="CHEMICAL">Chemical / Hazardous Store</SelectItem>
                  <SelectItem value="SPARE_PARTS">Spare Parts Store</SelectItem>
                  <SelectItem value="GENERAL">General Store</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Warehouse / Location ID</Label>
              <Input
                value={newWarehouseId}
                onChange={(e) => setNewWarehouseId(e.target.value)}
                className="text-xs rounded-xl"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Store Manager (Optional)</Label>
              <Select value={newManagerId} onValueChange={setNewManagerId}>
                <SelectTrigger className="text-xs rounded-xl">
                  <SelectValue placeholder="Assign Store Manager" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">-- No Manager Assigned --</SelectItem>
                  {storeManagers
                    .filter((m) => m.status === "ACTIVE")
                    .map((m) => (
                      <SelectItem key={m.id} value={m.employee_id}>
                        {m.full_name} ({m.employee_id})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Description</Label>
              <Textarea
                placeholder="Store purpose, storage requirements, safety notes..."
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                className="text-xs rounded-xl min-h-16"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
                disabled={creating}
                className="rounded-xl text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={creating}
                className="rounded-xl shadow-glow text-xs font-semibold"
              >
                {creating && <Loader2 className="size-3.5 animate-spin mr-1.5" />}
                Create Store
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* EDIT STORE DIALOG */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <Edit className="size-4 text-primary" />
              Edit Store: {editingStore?.store_code}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Update store configuration, description, or manager assignment.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveStoreEdit} className="space-y-3.5 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Store Code</Label>
              <Input
                value={editingStore?.store_code || ""}
                disabled
                className="text-xs bg-muted/50 font-mono font-bold text-primary rounded-xl"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">
                Store Name <span className="text-rose-500">*</span>
              </Label>
              <Input
                value={editStoreName}
                onChange={(e) => setEditStoreName(e.target.value)}
                required
                className="text-xs rounded-xl"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Store Type</Label>
              <Select value={editStoreType} onValueChange={setEditStoreType}>
                <SelectTrigger className="text-xs rounded-xl">
                  <SelectValue placeholder="Select store type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="RAW_MATERIAL">Raw Material Store</SelectItem>
                  <SelectItem value="FINISHED_GOODS">Finished Goods Store</SelectItem>
                  <SelectItem value="CHEMICAL">Chemical / Hazardous Store</SelectItem>
                  <SelectItem value="SPARE_PARTS">Spare Parts Store</SelectItem>
                  <SelectItem value="GENERAL">General Store</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Warehouse ID</Label>
              <Input
                value={editWarehouseId}
                onChange={(e) => setEditWarehouseId(e.target.value)}
                className="text-xs rounded-xl"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Store Manager</Label>
              <Select value={editManagerId} onValueChange={setEditManagerId}>
                <SelectTrigger className="text-xs rounded-xl">
                  <SelectValue placeholder="Assign Store Manager" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">-- No Manager Assigned --</SelectItem>
                  {storeManagers
                    .filter((m) => m.status === "ACTIVE")
                    .map((m) => (
                      <SelectItem key={m.id} value={m.employee_id}>
                        {m.full_name} ({m.employee_id})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Status</Label>
              <Select value={editStatus} onValueChange={setEditStatus}>
                <SelectTrigger className="text-xs rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">ACTIVE</SelectItem>
                  <SelectItem value="INACTIVE">INACTIVE</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Description</Label>
              <Textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                className="text-xs rounded-xl min-h-16"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditOpen(false)}
                disabled={saving}
                className="rounded-xl text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={saving}
                className="rounded-xl shadow-glow text-xs font-semibold"
              >
                {saving && <Loader2 className="size-3.5 animate-spin mr-1.5" />}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* CREATE ZONE DIALOG */}
      <Dialog open={createZoneOpen} onOpenChange={setCreateZoneOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <Layers className="size-4 text-indigo-400" />
              Add Zone to {targetStoreForZone?.store_code}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Define a logical storage zone inside {targetStoreForZone?.store_name}.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateZone} className="space-y-3.5 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Suggested Zone Code</Label>
              <Input
                value={previewZoneCode}
                disabled
                className="text-xs bg-muted/50 font-mono font-bold text-indigo-400 rounded-xl"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">
                Zone Name <span className="text-rose-500">*</span>
              </Label>
              <Input
                placeholder="e.g. High Voltage Panel Bay"
                value={newZoneName}
                onChange={(e) => setNewZoneName(e.target.value)}
                required
                className="text-xs rounded-xl"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Description (Optional)</Label>
              <Textarea
                placeholder="Zone purpose, temperature requirements, rack layout..."
                value={newZoneDesc}
                onChange={(e) => setNewZoneDesc(e.target.value)}
                className="text-xs rounded-xl min-h-16"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateZoneOpen(false)}
                disabled={creatingZone}
                className="rounded-xl text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={creatingZone}
                className="rounded-xl shadow-glow text-xs font-semibold bg-indigo-500 hover:bg-indigo-600"
              >
                {creatingZone && <Loader2 className="size-3.5 animate-spin mr-1.5" />}
                Create Zone
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* CREATE BIN DIALOG */}
      <Dialog open={createBinOpen} onOpenChange={setCreateBinOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <Grid className="size-4 text-emerald-500" />
              Add Physical Storage Bin to {targetZoneForBin?.zone_code}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Define a specific physical bin location inside {targetStoreForBin?.store_name} →{" "}
              {targetZoneForBin?.zone_name}.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateBin} className="space-y-3.5 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Suggested Bin Code</Label>
              <Input
                value={previewBinCode}
                disabled
                className="text-xs bg-muted/50 font-mono font-bold text-emerald-400 rounded-xl"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">
                Bin Name / Label <span className="text-rose-500">*</span>
              </Label>
              <Input
                placeholder="e.g. Primary Shelf Bin 01"
                value={newBinName}
                onChange={(e) => setNewBinName(e.target.value)}
                required
                className="text-xs rounded-xl"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Rack Code</Label>
                <Input
                  placeholder="R01"
                  value={newBinRack}
                  onChange={(e) => setNewBinRack(e.target.value)}
                  className="text-xs rounded-xl"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Shelf Code</Label>
                <Input
                  placeholder="S01"
                  value={newBinShelf}
                  onChange={(e) => setNewBinShelf(e.target.value)}
                  className="text-xs rounded-xl"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Capacity Quantity</Label>
              <Input
                type="number"
                value={newBinCapacity}
                onChange={(e) => setNewBinCapacity(e.target.value)}
                required
                className="text-xs rounded-xl"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateBinOpen(false)}
                disabled={creatingBin}
                className="rounded-xl text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={creatingBin}
                className="rounded-xl shadow-glow text-xs font-semibold bg-emerald-600 hover:bg-emerald-700"
              >
                {creatingBin && <Loader2 className="size-3.5 animate-spin mr-1.5" />}
                Create Bin
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* CREATE STORE MANAGER DIALOG */}
      <Dialog open={createMgrOpen} onOpenChange={setCreateMgrOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <UserPlus className="size-4 text-amber-500" />
              Provision Store Manager Account
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Create a real database-backed Store Manager user with isolated store authority.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateMgr} className="space-y-3.5 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">
                Full Name <span className="text-rose-500">*</span>
              </Label>
              <Input
                placeholder="e.g. David Williams"
                value={mgrFullName}
                onChange={(e) => setMgrFullName(e.target.value)}
                required
                className="text-xs rounded-xl"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold flex items-center justify-between">
                  <span>Employee ID <span className="text-rose-500">*</span></span>
                  <span className="text-[10px] text-primary font-bold">Auto-generated</span>
                </Label>
                <Input
                  placeholder="EMP-MGR-001"
                  value={mgrEmployeeId}
                  readOnly
                  className="text-xs uppercase font-mono rounded-xl bg-muted/50 cursor-not-allowed"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">
                  Username <span className="text-rose-500">*</span>
                </Label>
                <Input
                  placeholder="store_mgr_001"
                  value={mgrUsername}
                  onChange={(e) => setMgrUsername(e.target.value)}
                  required
                  className="text-xs lowercase font-mono rounded-xl"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">
                Email Address <span className="text-rose-500">*</span>
              </Label>
              <Input
                type="email"
                placeholder="david.williams@wms.local"
                value={mgrEmail}
                onChange={(e) => setMgrEmail(e.target.value)}
                required
                className="text-xs rounded-xl"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">
                Temporary Password <span className="text-rose-500">*</span>
              </Label>
              <Input
                type="password"
                value={mgrPassword}
                onChange={(e) => setMgrPassword(e.target.value)}
                required
                className="text-xs rounded-xl"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">
                Assigned Store <span className="text-rose-500">*</span>
              </Label>
              <Select value={mgrStoreId} onValueChange={setMgrStoreId}>
                <SelectTrigger className="text-xs rounded-xl">
                  <SelectValue placeholder="Select target store" />
                </SelectTrigger>
                <SelectContent>
                  {stores.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.store_code} — {s.store_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateMgrOpen(false)}
                disabled={creatingMgr}
                className="rounded-xl text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={creatingMgr}
                className="rounded-xl shadow-glow text-xs font-semibold"
              >
                {creatingMgr && <Loader2 className="size-3.5 animate-spin mr-1.5" />}
                Provision Account
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* EDIT STORE MANAGER DIALOG */}
      <Dialog open={editMgrOpen} onOpenChange={setEditMgrOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <Edit className="size-4 text-amber-500" />
              Edit Manager: {editingMgr?.employee_id}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Update manager contact, store assignment, or status.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveMgrEdit} className="space-y-3.5 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Full Name</Label>
              <Input
                value={editMgrFullName}
                onChange={(e) => setEditMgrFullName(e.target.value)}
                required
                className="text-xs rounded-xl"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Email Address</Label>
              <Input
                type="email"
                value={editMgrEmail}
                onChange={(e) => setEditMgrEmail(e.target.value)}
                required
                className="text-xs rounded-xl"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Reassign Store</Label>
              <Select value={editMgrStoreId} onValueChange={setEditMgrStoreId}>
                <SelectTrigger className="text-xs rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {stores.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.store_code} — {s.store_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Status</Label>
              <Select value={editMgrStatus} onValueChange={setEditMgrStatus}>
                <SelectTrigger className="text-xs rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">ACTIVE</SelectItem>
                  <SelectItem value="INACTIVE">INACTIVE</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Reset Password (Optional)</Label>
              <Input
                type="password"
                placeholder="Leave blank to keep unchanged"
                value={editMgrPassword}
                onChange={(e) => setEditMgrPassword(e.target.value)}
                className="text-xs rounded-xl"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditMgrOpen(false)}
                disabled={savingMgr}
                className="rounded-xl text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={savingMgr}
                className="rounded-xl shadow-glow text-xs font-semibold"
              >
                {savingMgr && <Loader2 className="size-3.5 animate-spin mr-1.5" />}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Zone QR Dialog */}
      <Dialog open={qrModalOpen} onOpenChange={setQrModalOpen}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold">
              <QrCode className="size-5 text-primary" /> Zone Physical Storage QR Label
            </DialogTitle>
            <DialogDescription className="text-xs">
              Physical QR identifier for {selectedZoneForQr?.zone_code} in{" "}
              {selectedStoreForQr?.store_name}.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center justify-center p-4 bg-muted/20 border border-border/60 rounded-2xl space-y-3">
            {loadingQr ? (
              <div className="py-12 flex flex-col items-center gap-2 text-muted-foreground">
                <Loader2 className="size-8 animate-spin text-primary" />
                <p className="text-xs">Generating high-contrast QR code...</p>
              </div>
            ) : qrDataUrl ? (
              <>
                <div className="bg-white p-4 rounded-xl shadow-md border border-border/40">
                  <img src={qrDataUrl} alt="Zone QR Code" className="w-52 h-52 object-contain" />
                </div>
                <div className="text-center space-y-1">
                  <div className="font-mono text-lg font-black text-foreground">
                    {selectedZoneForQr?.zone_code}
                  </div>
                  <div className="text-xs font-semibold text-muted-foreground">
                    {selectedZoneForQr?.zone_name}
                  </div>
                  <div className="text-[11px] text-muted-foreground/80">
                    Store:{" "}
                    <span className="font-semibold text-primary">
                      {selectedStoreForQr?.store_code} · {selectedStoreForQr?.store_name}
                    </span>
                  </div>
                  <div className="text-[10px] text-muted-foreground/60 font-mono">
                    Zone ID: {selectedZoneForQr?.id}
                  </div>
                </div>
              </>
            ) : (
              <p className="text-xs text-rose-500">Failed to render QR</p>
            )}
          </div>

          <DialogFooter className="flex items-center justify-between sm:justify-between pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setQrModalOpen(false)}
              className="rounded-xl text-xs"
            >
              Close
            </Button>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleDownloadQR}
                disabled={!qrDataUrl || loadingQr}
                className="rounded-xl text-xs gap-1.5"
              >
                <Download className="size-3.5" /> Download PNG
              </Button>
              <Button
                type="button"
                onClick={handlePrintQR}
                disabled={!qrDataUrl || loadingQr}
                className="rounded-xl text-xs font-semibold shadow-glow gap-1.5"
              >
                <Printer className="size-3.5" /> Print Label
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bin QR Dialog */}
      <Dialog open={binQrModalOpen} onOpenChange={setBinQrModalOpen}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold">
              <QrCode className="size-5 text-emerald-500" /> Bin Physical Storage QR Label
            </DialogTitle>
            <DialogDescription className="text-xs">
              Physical QR identifier for {selectedBinForQr?.bin_code} in{" "}
              {selectedStoreForBinQr?.store_name} → {selectedZoneForBinQr?.zone_name}.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center justify-center p-4 bg-muted/20 border border-border/60 rounded-2xl space-y-3">
            {loadingBinQr ? (
              <div className="py-12 flex flex-col items-center gap-2 text-muted-foreground">
                <Loader2 className="size-8 animate-spin text-emerald-500" />
                <p className="text-xs">Generating high-contrast Bin QR code...</p>
              </div>
            ) : binQrDataUrl ? (
              <>
                <div className="bg-white p-4 rounded-xl shadow-md border border-border/40">
                  <img src={binQrDataUrl} alt="Bin QR Code" className="w-52 h-52 object-contain" />
                </div>
                <div className="text-center space-y-1">
                  <div className="font-mono text-lg font-black text-foreground">
                    {selectedBinForQr?.bin_code}
                  </div>
                  <div className="text-xs font-semibold text-muted-foreground">
                    {selectedBinForQr?.bin_name}
                  </div>
                  <div className="text-[11px] text-muted-foreground/80 font-mono">
                    Rack: {selectedBinForQr?.rack || "-"} · Shelf: {selectedBinForQr?.shelf || "-"}{" "}
                    · Capacity: {selectedBinForQr?.capacity}
                  </div>
                  <div className="text-[11px] text-muted-foreground/80">
                    Location:{" "}
                    <span className="font-semibold text-primary">
                      {selectedStoreForBinQr?.store_code} / {selectedZoneForBinQr?.zone_code}
                    </span>
                  </div>
                  <div className="text-[10px] text-muted-foreground/60 font-mono">
                    Bin ID: {selectedBinForQr?.id}
                  </div>
                </div>
              </>
            ) : (
              <p className="text-xs text-rose-500">Failed to render Bin QR</p>
            )}
          </div>

          <DialogFooter className="flex items-center justify-between sm:justify-between pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setBinQrModalOpen(false)}
              className="rounded-xl text-xs"
            >
              Close
            </Button>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleDownloadBinQR}
                disabled={!binQrDataUrl || loadingBinQr}
                className="rounded-xl text-xs gap-1.5"
              >
                <Download className="size-3.5" /> Download PNG
              </Button>
              <Button
                type="button"
                onClick={handlePrintBinQR}
                disabled={!binQrDataUrl || loadingBinQr}
                className="rounded-xl text-xs font-semibold shadow-glow gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <Printer className="size-3.5" /> Print Label
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Store Confirmation Modal */}
      <AlertDialog
        open={Boolean(deleteStoreModal)}
        onOpenChange={() => setDeleteStoreModal(null)}
      >
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">
              Delete Store {deleteStoreModal?.store_name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete store <strong>{deleteStoreModal?.store_code}</strong> ({deleteStoreModal?.store_name}) and all its associated zones and bins. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-xl bg-destructive hover:bg-destructive/90 text-white font-semibold"
              disabled={deletingStore}
              onClick={(e) => {
                e.preventDefault();
                void handleDeleteStore();
              }}
            >
              {deletingStore && <Loader2 className="size-4 animate-spin mr-1" />} Delete Store
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
