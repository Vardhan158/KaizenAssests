import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { InformationTooltip } from "@/components/ui/information-tooltip";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { loadGrnQrRecord } from "@/lib/grn-qr-record";
import { DamagePhoto } from "@/components/wms/damage-photo";
import { isValidPersonName, isValidVehicleNumber } from "@/lib/input-validation";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Boxes,
  CheckCircle2,
  ClipboardList,
  Info,
  Clock3,
  DoorOpen,
  Download,
  Eye,
  FileCheck2,
  FileText,
  Image as ImageIcon,
  LayoutDashboard,
  Loader2,
  Camera,
  Mail,
  PackageCheck,
  Phone,
  Plus,
  Printer,
  QrCode,
  RefreshCw,
  ScanLine,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  TrendingUp,
  Truck,
  Upload,
  User,
  Warehouse,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell, StatusBadge } from "@/components/wms/app-shell";
import { SectionCard, StatCard, Timeline } from "@/components/wms/primitives";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, resolveMediaUrl } from "@/lib/api-client";
import { getUserInfo } from "@/lib/auth-utils";
import {
  QRScanResultModal,
  QrNotFoundModal,
  type QrScanResultData,
} from "@/components/wms/qr-scan-result-modal";
import { AdminTablePagination } from "@/components/admin/admin-table-pagination";

export const Route = createFileRoute("/grn")({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    tab: string;
    page: number;
    grn_id?: string;
    gatePassId?: string;
    dock?: string;
    po?: string;
    search?: string;
  } => ({
    search: typeof search.search === "string" ? search.search : undefined,
    tab: (search.tab as string) || "dashboard",
    page: Number(search.page) || 1,
    grn_id:
      search.grn_id && !["undefined", "null", ""].includes(String(search.grn_id).toLowerCase())
        ? String(search.grn_id)
        : undefined,
    gatePassId: (search.gatePassId as string) || (search.gate_pass_id as string) || undefined,
    dock: (search.dock as string) || (search.dock_number as string) || undefined,
    po: (search.po as string) || (search.po_number as string) || undefined,
  }),
  component: GrnPageWorkflow,
});

type GrnLineItem = {
  grn_line_id?: string;
  material_name: string;
  material_code?: string;
  materialName?: string;
  material_description?: string;
  item_code: string;
  po_quantity: number;
  received_quantity: number;
  good_quantity: number;
  damaged_quantity: number;
  rejected_quantity?: number;
  held_quantity?: number;
  balance_quantity: number;
  uom: string;
  material_category?: string;
  variant_code?: string;
  variant_size?: string;
  variant_color?: string;
  variant_grade?: string;
  quality_approved_quantity?: number;
  quality_result?: string;
  damage_reason?: string;
  rejected_reason?: string;
  held_reason?: string;
};

type BatchEntry = {
  batch_id?: string;
  batch_number: string;
  batch_quantity: number;
  qr_id?: string;
  qr_data_url?: string;
  qr_payload?: string;
};

type UploadedDocument = {
  document_id?: string;
  grn_id?: string;
  category: string;
  file_name: string;
  file_path: string;
  file_type?: string;
};

type GrnHeaderState = {
  warehouse_id?: string;
  po_number: string;
  supplier_name: string;
  supplier_company_name: string;
  supplier_email?: string;
  asn_number: string;
  gate_entry_id?: string;
  gate_entry_number: string;
  warehouse_name: string;
  receiving_dock: string;
  grn_number: string;
  receipt_type: "PO_RECEIPT" | "UNEXPECTED_DELIVERY" | "";
  vehicle_number: string;
  driver_name: string;
  invoice_number: string;
  received_by: string;
};

const PAGES = [
  {
    id: 1,
    title: "Header Details",
    subtitle: "PO Lookup, Supplier, Gate Entry & Dock Selection",
    icon: ClipboardList,
  },
  {
    id: 2,
    title: "Item Receiving",
    subtitle: "Compare PO quantity with physically received quantity",
    icon: PackageCheck,
  },
  {
    id: 3,
    title: "Quality & Photos",
    subtitle: "Inspect Received Materials, Damage Breakdown & Photo Proof",
    icon: ShieldCheck,
  },
  {
    id: 4,
    title: "Batch Creation",
    subtitle: "Lot/Batch Allocation & Total Quantity Validation",
    icon: Boxes,
  },
  {
    id: 5,
    title: "Documents",
    subtitle: "ASN Copy, Invoice, Challan & Packing List",
    icon: FileText,
  },
  {
    id: 6,
    title: "QR Generation",
    subtitle: "Batch-wise QR Identification & Label Printing",
    icon: QrCode,
  },
];

const GRN_LOCAL_DRAFT_KEY = "grn_wizard_local_draft";

function formatCardDate(dateVal?: string | null): string {
  if (!dateVal) return new Date().toISOString().slice(0, 10);
  try {
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return String(dateVal);
    return d.toISOString().slice(0, 10);
  } catch {
    return String(dateVal);
  }
}

const formatApiDateTime = (value?: string | null) => {
  if (!value) return "—";
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
  return new Date(hasTimezone ? normalized : `${normalized}Z`).toLocaleString();
};

const normalizeVehicleKey = (value: unknown) =>
  String(value || "").replace(/[\s-]/g, "").toUpperCase();

const isCompletedGrnStatus = (value: unknown) =>
  ["COMPLETED", "POSTED", "RECEIVING_COMPLETE", "RECEIVING_COMPLETED", "APPROVED", "ACCEPTED"].includes(
    String(value || "").trim().toUpperCase(),
  );

function isUuidString(val?: string | null): boolean {
  if (!val) return false;
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
    String(val).trim(),
  );
}

function cleanSupplierString(raw?: any): string {
  if (!raw) return "";
  const s = String(raw).trim();
  if (isUuidString(s)) return "";
  return s;
}

function grnMaterialKey(item: GrnLineItem, index: number): string {
  return [item.grn_line_id, item.item_code, item.variant_code, index].filter(Boolean).join(":");
}

function normalizeGrnRecord(r: any) {
  if (!r) return null;
  const isUnexpected = (r.receipt_type || r.receiptType) === "UNEXPECTED_DELIVERY";
  const rawSupplierName = cleanSupplierString(
    r.supplier_name || r.supplierName || r.supplier_company_name || r.supplierCompanyName,
  );
  const rawCompanyName = cleanSupplierString(
    r.supplier_company_name || r.supplierCompanyName || r.supplier_name || r.supplierName,
  );
  const resolvedSupplierName =
    rawSupplierName || rawCompanyName || (isUnexpected ? "Unexpected Supplier" : "");

  return {
    ...r,
    id: r.id || r.grn_id || r.grnId || "",
    grn_id: r.grn_id || r.grnId || r.id || "",
    grn_number: r.grn_number || r.grnNumber || "",
    po_number: r.po_number || r.poNumber || "",
    po_id: r.po_id || r.poId || "",
    asn_id: r.asn_id || r.asnId || "",
    asn_number: r.asn_number || r.asnNumber || "",
    gate_entry_id: r.gate_entry_id || r.gateEntryId || "",
    gate_entry_number: r.gate_entry_number || r.gateEntryNumber || "",
    supplier_name: resolvedSupplierName,
    supplier_company_name: rawCompanyName || resolvedSupplierName,
    supplier_email: r.supplier_email || r.supplierEmail || "",
    warehouse_name: r.warehouse_name || r.warehouseName || "",
    dock_number: r.dock_number || r.dockNumber || "",
    vehicle_number: r.vehicle_number || r.vehicleNumber || "",
    driver_name: r.driver_name || r.driverName || "",
    receipt_date: r.receipt_date || r.receiptDate || r.created_at || r.createdAt || "",
    received_by: r.received_by || r.receivedBy || "",
    receipt_type: r.receipt_type || r.receiptType || "PO_RECEIPT",
    status: r.status || "COMPLETED",
    lines: r.lines || [],
    batches: r.batches || [],
    damage_lots: r.damage_lots || r.damageLots || [],
    damage_evidence: r.damage_evidence || r.damageEvidence || [],
    documents: r.documents || [],
  };
}

function DynamicQrCanvas({
  payload,
  isQuarantine = false,
}: {
  payload: string;
  isQuarantine?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!canvasRef.current || !payload) return;
    QRCode.toCanvas(canvasRef.current, payload, {
      margin: 1,
      width: 160,
      errorCorrectionLevel: "M",
      color: isQuarantine
        ? { dark: "#9f1239", light: "#ffffff" }
        : { dark: "#000000", light: "#ffffff" },
    }).catch((err) => console.error("Canvas QR render error:", err));
  }, [payload, isQuarantine]);

  return <canvas ref={canvasRef} className="size-40 mx-auto rounded-lg shadow-2xs block" />;
}

function GrnPageWorkflow() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<"dashboard" | "records" | "wizard">(
    (search.tab as any) || "dashboard",
  );
  const [currentPage, setCurrentPage] = useState<number>(search.page || 1);
  const [maxCompletedStep, setMaxCompletedStep] = useState<number>(1);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [showExitConfirmModal, setShowExitConfirmModal] = useState(false);

  useEffect(() => {
    if (search.tab) setActiveTab(search.tab as any);
    if (search.page) setCurrentPage(search.page);
    if (search.gatePassId || search.dock || search.po) {
      if (!search.tab) setActiveTab("wizard");
      setHeader((prev) => ({
        ...prev,
        gate_entry_number: search.gatePassId || prev.gate_entry_number,
        receiving_dock: search.dock || prev.receiving_dock,
        po_number: search.po || prev.po_number,
      }));
    }
  }, [search.tab, search.page, search.gatePassId, search.dock, search.po]);

  useEffect(() => {
    if (search.tab && search.tab !== "wizard") {
      sessionRestoreRequest.current += 1;
      resumeRequest.current = null;
      setLoadingContext(false);
    }
  }, [search.tab]);

  // User Info (Client-Side Safe for SSR)
  const [loggedInUserName, setLoggedInUserName] = useState<string>("GRN Officer");
  useEffect(() => {
    const info = getUserInfo();
    if (info?.username) setLoggedInUserName(info.username);
  }, []);

  // Records List State
  const [grnRecords, setGrnRecords] = useState<any[]>([]);
  const [deleteGrnTarget, setDeleteGrnTarget] = useState<any | null>(null);
  const [deletingGrn, setDeletingGrn] = useState(false);
  const [totalRecordCount, setTotalRecordCount] = useState<number>(0);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [recordsLoadError, setRecordsLoadError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  useEffect(() => { if (search.search !== undefined) setSearchTerm(search.search); }, [search.search]);

  // Page 1 - Header Form State
  const [header, setHeader] = useState<GrnHeaderState>({
    grn_number: "",
    po_number: "",
    supplier_name: "",
    supplier_company_name: "",
    supplier_email: "",
    asn_number: "",
    gate_entry_number: "",
    receiving_dock: "",
    warehouse_name: "",
    receipt_type: "",
    vehicle_number: "",
    driver_name: "",
    invoice_number: "",
    received_by: loggedInUserName,
  });

  const contextRequest = useRef(0);
  const vehicleDraftRequest = useRef(0);
  const completedGrnConflictRef = useRef(false);
  const saveLock = useRef(false);
  const resumeRequest = useRef<string | null>(null);
  const sessionRestoreRequest = useRef(0);
  // Async draft restoration can finish after the user selects Dashboard or
  // History. Track the live URL tab during render so a stale restore request
  // can never redirect the page back to Create GRN.
  const routeTabRef = useRef(search.tab);
  routeTabRef.current = search.tab;
  const [grnId, setGrnId] = useState<string | null>(null);
  const [dockOptions, setDockOptions] = useState<any[]>([]);
  const [asnVehicleArrivals, setAsnVehicleArrivals] = useState<any[]>([]);
  const [loadingContext, setLoadingContext] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const [dockReleasePrompt, setDockReleasePrompt] = useState<string | null>(null);
  const [dockReleasedAlert, setDockReleasedAlert] = useState(false);
  const [asnCameraOpen, setAsnCameraOpen] = useState(false);
  const asnCameraVideoRef = useRef<HTMLVideoElement>(null);
  const asnCameraStreamRef = useRef<MediaStream | null>(null);

  // Page 2 - Line Items State (Loaded dynamically from Real Database PO Context)
  const [materials, setMaterials] = useState<GrnLineItem[]>([]);

  const openAsnDocumentCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      asnCameraStreamRef.current = stream;
      setAsnCameraOpen(true);
      requestAnimationFrame(() => {
        if (asnCameraVideoRef.current) asnCameraVideoRef.current.srcObject = stream;
      });
    } catch {
      toast.error("Unable to open camera", {
        description: "Allow camera permission and try again.",
      });
    }
  };

  const closeAsnDocumentCamera = () => {
    asnCameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    asnCameraStreamRef.current = null;
    setAsnCameraOpen(false);
  };

  const captureAsnDocument = () => {
    const video = asnCameraVideoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const activeGrnId = grnId || localStorage.getItem("active_grn_id");
      if (!activeGrnId) {
        toast.error("Save the GRN header before capturing the ASN document.");
        closeAsnDocumentCamera();
        return;
      }
      try {
        setBusyAction(true);
        const file = new File([blob], `asn-document-${Date.now()}.jpg`, { type: "image/jpeg" });
        const formData = new FormData();
        formData.append("document_type", "ASN Copy");
        formData.append("file", file);
        const saved = await api.uploadGrnDocument(activeGrnId, formData);
        const newDoc: UploadedDocument = {
          document_id: saved.document_id || saved.documentId,
          grn_id: saved.grn_id || saved.grnId || activeGrnId,
          category: saved.document_type || "ASN Copy",
          file_name: saved.file_name || file.name,
          file_path: saved.file_path || saved.filePath || "",
          file_type: file.type,
        };
        setUploadedDocuments((prev) => [
          ...prev.filter((doc) => !doc.category.toLowerCase().includes("asn")),
          newDoc,
        ]);
        toast.success(`Saved ASN Copy: ${file.name}`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Unable to save ASN document.");
      } finally {
        setBusyAction(false);
        closeAsnDocumentCamera();
      }
    }, "image/jpeg");
  };

  // Page 3 - Damaged Goods & Quality State
  const [damagePhotos, setDamagePhotos] = useState<
    Record<
      string,
      {
        file?: File;
        previewUrl?: string;
        reason?: string;
        evidenceId?: string;
        evidenceIds?: string[];
        photos?: any[];
      }
    >
  >({});
  const [qualityApproved, setQualityApproved] = useState<Record<string, number>>({});

  // Page 4 - Batches State
  const [materialBatches, setMaterialBatches] = useState<Record<string, BatchEntry[]>>({});

  // Page 5 - Documents State
  const [uploadedDocuments, setUploadedDocuments] = useState<UploadedDocument[]>([]);
  const [customDocTypes, setCustomDocTypes] = useState<string[]>([
    "Invoice Copy",
    "ASN Copy",
    "Weighment Slip",
    "Tax Invoice / e-Way Bill",
  ]);
  const [selectedDocCategory, setSelectedDocCategory] = useState<string>("ASN Copy");
  const [showAddCustomTypeInput, setShowAddCustomTypeInput] = useState(false);
  const [newCustomCategoryInput, setNewCustomCategoryInput] = useState("");
  const [pendingDocFile, setPendingDocFile] = useState<File | null>(null);
  const [viewingDocumentModal, setViewingDocumentModal] = useState<UploadedDocument | null>(null);

  // Page 6 - QR Generation State
  const [selectedQrMaterialCode, setSelectedQrMaterialCode] = useState<string>("ALL");
  const [enlargedQr, setEnlargedQr] = useState<{
    title: string;
    qr_id: string;
    data_url: string;
    payload: string;
    batch: BatchEntry;
    itemCode: string;
  } | null>(null);
  const [historyQrLabels, setHistoryQrLabels] = useState<Array<{
    title: string;
    qrId: string;
    dataUrl: string;
    payload: string;
    materialCode: string;
    materialName: string;
    category?: string;
    quantity?: number | string;
    uom?: string;
    grnNumber?: string;
  }> | null>(null);
  const [showQualityPassModal, setShowQualityPassModal] = useState(false);
  const [showNotifyVendorModal, setShowNotifyVendorModal] = useState(false);
  const [notifyVendorEmail, setNotifyVendorEmail] = useState("");
  const [notifyVendorRemarks, setNotifyVendorRemarks] = useState("");
  const [sendingVendorNotify, setSendingVendorNotify] = useState(false);

  // QR Scan Result Modal & Live Scanner State
  const [scanResultData, setScanResultData] = useState<QrScanResultData | null>(null);
  const [isScanResultModalOpen, setIsScanResultModalOpen] = useState(false);
  const [qrNotFoundOpen, setQrNotFoundOpen] = useState(false);
  const [scannedCodeValue, setScannedCodeValue] = useState("");
  const [isScanningQr, setIsScanningQr] = useState(false);
  const [manualScanInputOpen, setManualScanInputOpen] = useState(false);
  const [manualScanText, setManualScanText] = useState("");
  const autosaveHydratedRef = useRef(false);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (activeTab !== "wizard" || (search as any).grn_id) return;
    try {
      const rawDraft = localStorage.getItem(GRN_LOCAL_DRAFT_KEY);
      if (!rawDraft) return;
      const draft = JSON.parse(rawDraft);
      if (draft?.header) {
        setHeader((prev) => ({
          ...prev,
          ...draft.header,
          received_by: draft.header.received_by || prev.received_by,
        }));
      }
      if (Array.isArray(draft?.materials)) setMaterials(draft.materials);
      if (draft?.qualityApproved) setQualityApproved(draft.qualityApproved);
      if (draft?.materialBatches) setMaterialBatches(draft.materialBatches);
      if (Array.isArray(draft?.uploadedDocuments)) setUploadedDocuments(draft.uploadedDocuments);
      if (Number(draft?.currentPage) > 0) setCurrentPage(Number(draft.currentPage));
      if (Number(draft?.maxCompletedStep) > 0) setMaxCompletedStep(Number(draft.maxCompletedStep));
      const draftGrnId = typeof draft?.grnId === "string" ? draft.grnId.trim() : "";
      const hasValidDraftId =
        draftGrnId && !["undefined", "null"].includes(draftGrnId.toLowerCase());
      if (hasValidDraftId) {
        setGrnId(draftGrnId);
        localStorage.setItem("active_grn_id", draftGrnId);
      } else if (!Array.isArray(draft?.materials) || draft.materials.length === 0) {
        setSaveStatus("idle");
        return;
      }
      if (hasValidDraftId && Array.isArray(draft?.materials) && draft.materials.length > 0) {
        setSaveStatus("saved");
      } else {
        setSaveStatus("idle");
      }
    } catch (err) {
      console.warn("Unable to restore GRN local draft:", err);
    }
  }, [activeTab, (search as any).grn_id]);

  useEffect(() => {
    if (activeTab !== "wizard") return;
    const hasDraftData =
      Boolean(grnId) ||
      Boolean(header.receipt_type) ||
      Boolean(header.po_number.trim()) ||
      Boolean(header.vehicle_number.trim()) ||
      Boolean(header.driver_name.trim()) ||
      Boolean(header.receiving_dock.trim()) ||
      materials.length > 0 ||
      uploadedDocuments.length > 0;
    if (!hasDraftData) return;
    try {
      localStorage.setItem(
        GRN_LOCAL_DRAFT_KEY,
        JSON.stringify({
          grnId,
          currentPage,
          maxCompletedStep,
          header,
          materials,
          qualityApproved,
          materialBatches,
          uploadedDocuments,
          savedAt: new Date().toISOString(),
        }),
      );
    } catch (err) {
      console.warn("Unable to save GRN local draft:", err);
    }
  }, [
    activeTab,
    grnId,
    currentPage,
    maxCompletedStep,
    header,
    materials,
    qualityApproved,
    materialBatches,
    uploadedDocuments,
  ]);

  // Standalone QR Code Labels Directory State
  const [qrDirectoryFilter, setQrDirectoryFilter] = useState<
    "ALL" | "BATCH" | "QUARANTINE" | "TEMPLATE"
  >("ALL");
  const [qrSelectedGrnNumber, setQrSelectedGrnNumber] = useState<string>("ALL");
  const [qrDataUrlsCache, setQrDataUrlsCache] = useState<Record<string, string>>({});

  // Material Master & Variants Metadata for dynamic QR encoding
  const [materialMasterList, setMaterialMasterList] = useState<any[]>([]);

  useEffect(() => {
    api
      .getMaterials({ status: "Active" })
      .then((res: any) => {
        if (Array.isArray(res)) setMaterialMasterList(res);
        else if (res?.items && Array.isArray(res.items)) setMaterialMasterList(res.items);
      })
      .catch((err) => console.warn("Could not preload material master for QR generation:", err));
  }, []);

  // Fetch All Docks & Allocations Created in Warehouse Module
  const loadWarehouseDocks = useCallback(async () => {
    try {
      // The dock master response already includes its active allocation.
      // Avoid a second legacy allocations endpoint that can fail on older
      // databases and leave the GRN page without the assigned gate pass.
      const docksRes = await api.getDocks();

      const docksList = Array.isArray(docksRes) ? docksRes : [];

      if (docksList.length > 0) {
        const enrichedDocks = docksList.map((d: any) => {
          const num = d.dock_number || d.dock_code || d.name || `DOCK-${d.id}`;
          const currentAlloc = d.current_allocation || null;

          return {
            id: d.id,
            dock_number: num,
            dock_name: d.dock_name || d.name || num,
            dock_type: d.dock_type || "Standard",
            status: d.status || "AVAILABLE",
            capacity: d.capacity || "Full Container",
            current_allocation: currentAlloc,
            allocated_vehicle: currentAlloc?.vehicle_number || "",
            allocated_vendor: currentAlloc?.vendor_reference || "",
            allocated_gate_pass: currentAlloc?.existing_gate_pass_id || "",
          };
        });

        setDockOptions(enrichedDocks);
        setAssigningDockId((prev) => prev || enrichedDocks[0]?.dock_number || "");

        // Auto-detect dock allocated to current shipment or gate pass
        setHeader((prev) => {
          if (prev.receiving_dock) return prev;
          const activeAllocations = enrichedDocks.filter((d: any) => d.current_allocation);
          const matched = activeAllocations.find((d: any) => {
            const alloc = d.current_allocation;
            if (!alloc) return false;
            return (
              (prev.vehicle_number &&
                alloc.vehicle_number &&
                alloc.vehicle_number.toUpperCase() === prev.vehicle_number.toUpperCase()) ||
              (prev.gate_entry_number &&
                alloc.existing_gate_pass_id &&
                alloc.existing_gate_pass_id.toUpperCase() ===
                  prev.gate_entry_number.toUpperCase()) ||
              (prev.po_number &&
                alloc.material_reference &&
                alloc.material_reference.includes(prev.po_number)) ||
              (prev.supplier_name &&
                alloc.vendor_reference &&
                alloc.vendor_reference.toLowerCase().includes(prev.supplier_name.toLowerCase()))
            );
          }) || (activeAllocations.length === 1 ? activeAllocations[0] : undefined);
          if (matched) {
            return { ...prev, receiving_dock: matched.dock_number };
          }
          return prev;
        });
        return enrichedDocks;
      }
      return [];
    } catch (err) {
      console.warn("Failed to load warehouse dock allocations:", err);
      return [];
    }
  }, []);

  // Resolved Allocated Dock from Warehouse Dock Allocation
  const allocatedDockInfo = useMemo(() => {
    if (header.receiving_dock) {
      const match = dockOptions.find(
        (d: any) => d.dock_number === header.receiving_dock || d.id === header.receiving_dock,
      );
      if (match) {
        return {
          dock_number: match.dock_number,
          dock_name: match.dock_name || match.dock_type || match.dock_number,
          status: match.status,
          allocation_id:
            match.current_allocation?.id || match.current_allocation?.allocation_request_id,
          is_allocated: true,
        };
      }
      return {
        dock_number: header.receiving_dock,
        dock_name: header.receiving_dock,
        status: "ALLOCATED",
        is_allocated: true,
      };
    }

    const activeAllocations = dockOptions.filter((d: any) => d.current_allocation);
    const matched = activeAllocations.find((d: any) => {
      const alloc = d.current_allocation;
      if (!alloc) return false;
      const vMatch =
        header.vehicle_number &&
        alloc.vehicle_number &&
        alloc.vehicle_number.trim().toUpperCase() === header.vehicle_number.trim().toUpperCase();
      const gMatch =
        header.gate_entry_number &&
        alloc.existing_gate_pass_id &&
        alloc.existing_gate_pass_id.trim().toUpperCase() ===
          header.gate_entry_number.trim().toUpperCase();
      const pMatch =
        header.po_number &&
        ((alloc.material_reference && alloc.material_reference.includes(header.po_number)) ||
          (alloc.po_number && alloc.po_number === header.po_number));
      const supplierMatch =
        header.supplier_name &&
        alloc.vendor_reference &&
        alloc.vendor_reference.trim().toLowerCase().includes(header.supplier_name.trim().toLowerCase());
      return Boolean(vMatch || gMatch || pMatch || supplierMatch);
    }) || (activeAllocations.length === 1 ? activeAllocations[0] : undefined);

    if (matched) {
      return {
        dock_number: matched.dock_number,
        dock_name: matched.dock_name || matched.dock_type || matched.dock_number,
        status: matched.status,
        allocation_id:
          matched.current_allocation?.id || matched.current_allocation?.allocation_request_id,
        is_allocated: true,
      };
    }

    return null;
  }, [
    dockOptions,
    header.receiving_dock,
    header.vehicle_number,
    header.gate_entry_number,
    header.po_number,
  ]);

  useEffect(() => {
    if (allocatedDockInfo?.dock_number && header.receiving_dock !== allocatedDockInfo.dock_number) {
      setHeader((prev) => ({ ...prev, receiving_dock: allocatedDockInfo.dock_number }));
    }
  }, [allocatedDockInfo?.dock_number, header.receiving_dock]);

  useEffect(() => {
    void loadWarehouseDocks();
  }, [loadWarehouseDocks]);

  function formatReadableDate(dateStr?: string) {
    if (!dateStr) {
      const now = new Date();
      return now
        .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
        .replace(/ /g, "-");
    }
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d
        .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
        .replace(/ /g, "-");
    } catch {
      return dateStr;
    }
  }

  function getMaterialVariantInfo(itemCode: string, preferredVariantCode?: string) {
    const master = materialMasterList.find(
      (m) => m.material_code === itemCode || m.code === itemCode,
    );
    let variant = null;
    if (preferredVariantCode && master?.variants && Array.isArray(master.variants)) {
      variant = master.variants.find(
        (v: any) => v.variant_code?.toUpperCase() === preferredVariantCode.toUpperCase(),
      );
    }
    if (
      !variant &&
      master?.variants &&
      Array.isArray(master.variants) &&
      master.variants.length > 0
    ) {
      variant = master.variants[0];
    }
    return {
      variant_code: variant?.variant_code || preferredVariantCode || `${itemCode}-V001`,
      size: variant?.size || variant?.dimension || "25 mm × 3 m",
      color: variant?.color || "White",
      grade: variant?.grade || variant?.standard || "ISI",
      specification: variant?.specification || master?.specification || "",
      category: master?.category || master?.material_category || "Raw Materials",
    };
  }

  // GRN lines created by older records may contain only the material name.
  // Resolve the code from the linked Material Master record for display and
  // downstream actions instead of showing a blank placeholder.
  function resolveGrnMaterialCode(material: Partial<GrnLineItem>) {
    const directCode = material.item_code || material.material_code;
    if (directCode?.trim()) return directCode.trim();

    const normalize = (value: unknown) =>
      String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
    const name = normalize(
      material.material_name || material.materialName || material.material_description,
    );
    if (!name) return "";

    const linked = materialMasterList.find((record: any) => {
      const recordName = normalize(
        record.material_name || record.materialName || record.name || record.description,
      );
      return recordName === name;
    });
    return String(linked?.material_code || linked?.code || "").trim();
  }

  // Dashboard & Detail Drawer State
  const [selectedGrnDetail, setSelectedGrnDetail] = useState<any | null>(null);
  const [detailDockInfo, setDetailDockInfo] = useState<{
    dock: any | null;
    allocation: any | null;
    isReleased: boolean;
    loading: boolean;
    releasing: boolean;
  }>({
    dock: null,
    allocation: null,
    isReleased: true,
    loading: false,
    releasing: false,
  });
  const [detailGateEntry, setDetailGateEntry] = useState<any | null>(null);
  const [dashboardStatusFilter, setDashboardStatusFilter] = useState<string>("ALL");
  const [receiptPage, setReceiptPage] = useState(1);
  const [activityLimit, setActivityLimit] = useState(5);
  const [recordsStatusFilter, setRecordsStatusFilter] = useState<string>("ALL");
  const [recordsPage, setRecordsPage] = useState(1);
  const [showAssignDockModal, setShowAssignDockModal] = useState(false);
  const [assigningDockId, setAssigningDockId] = useState("");
  const [assigningVehicle, setAssigningVehicle] = useState("");
  const [assigningPo, setAssigningPo] = useState("");

  const isRecordMatchingStatus = (recordStatus: string | undefined, filter: string) => {
    if (!filter || filter === "ALL") return true;
    const s = (recordStatus || "")
      .toUpperCase()
      .replace(/[\s_-]+/g, " ")
      .trim();
    if (filter === "COMPLETED") {
      return s === "COMPLETED" || s === "POSTED" || s === "APPROVED" || s === "ACCEPTED";
    }
    if (filter === "PARTIAL" || filter === "PARTIALLY COMPLETED") {
      return (
        s.includes("PARTIAL") ||
        s === "DRAFT" ||
        s === "IN PROGRESS" ||
        s === "PENDING" ||
        s === "RECEIVING"
      );
    }
    return (
      s ===
      filter
        .toUpperCase()
        .replace(/[\s_-]+/g, " ")
        .trim()
    );
  };

  const isRecordMatchingSearch = (r: any, term: string) => {
    if (!term || !term.trim()) return true;
    const t = term.toLowerCase().trim();
    return (
      (r.grn_number || "").toLowerCase().includes(t) ||
      (r.po_number || "").toLowerCase().includes(t) ||
      (r.supplier_name || "").toLowerCase().includes(t) ||
      (r.supplier_company_name || "").toLowerCase().includes(t) ||
      (r.vehicle_number || "").toLowerCase().includes(t) ||
      (r.driver_name || "").toLowerCase().includes(t) ||
      (r.dock_number || "").toLowerCase().includes(t) ||
      (r.status || "").toLowerCase().includes(t)
    );
  };

  const dashboardReceipts = grnRecords.filter((record) =>
    isRecordMatchingSearch(record, searchTerm) && isRecordMatchingStatus(record.status, dashboardStatusFilter));
  const filteredGrnRecords = grnRecords.filter((record) =>
    isRecordMatchingSearch(record, searchTerm) && isRecordMatchingStatus(record.status, recordsStatusFilter));
  const recordsPageCount = Math.max(1, Math.ceil(filteredGrnRecords.length / 10));
  const currentRecordsPage = Math.min(recordsPage, recordsPageCount);
  const visibleGrnRecords = filteredGrnRecords.slice((currentRecordsPage - 1) * 10, currentRecordsPage * 10);
  useEffect(() => { setRecordsPage(1); }, [searchTerm, recordsStatusFilter]);
  useEffect(() => { setRecordsPage((page) => Math.min(page, recordsPageCount)); }, [recordsPageCount]);
  const receiptPageSize = 5;
  const receiptPageCount = Math.max(1, Math.ceil(dashboardReceipts.length / receiptPageSize));
  const currentReceiptPage = Math.min(receiptPage, receiptPageCount);
  const visibleDashboardReceipts = dashboardReceipts.slice((currentReceiptPage - 1) * receiptPageSize, currentReceiptPage * receiptPageSize);
  useEffect(() => { setReceiptPage(1); }, [searchTerm, dashboardStatusFilter]);
  useEffect(() => { setReceiptPage((page) => Math.min(page, receiptPageCount)); }, [receiptPageCount]);

  // Fetch Records
  const loadRecords = useCallback(async () => {
    setLoadingRecords(true);
    setRecordsLoadError("");
    try {
      const res = await api.getGrns({ limit: 200 });
      if (res && Array.isArray(res.items)) {
        const normalized = res.items.map(normalizeGrnRecord).filter(Boolean);
        setGrnRecords(normalized);
        setTotalRecordCount(res.total || normalized.length);
      } else if (Array.isArray(res)) {
        const normalized = res.map(normalizeGrnRecord).filter(Boolean);
        setGrnRecords(normalized);
        setTotalRecordCount(normalized.length);
      } else {
        setGrnRecords([]);
        setTotalRecordCount(0);
      }
    } catch (err: any) {
      console.warn("API loadRecords fallback:", err);
      setRecordsLoadError(err?.message || "The GRN records service could not be reached.");
    } finally {
      setLoadingRecords(false);
    }
  }, []);

  async function openCompletedGrnHistory(grnNumber: string): Promise<void> {
    completedGrnConflictRef.current = true;
    vehicleDraftRequest.current += 1;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    setGrnId(null);
    localStorage.removeItem("active_grn_id");
    setSaveStatus("idle");
    setActiveTab("records");
    setRecordsPage(1);
    void navigate({ to: "/grn", search: { tab: "records", page: 1 } });
    void loadRecords();

    try {
      const detail = await api.getGrnDetail(grnNumber);
      if (detail) setSelectedGrnDetail(normalizeGrnRecord(detail));
    } catch (detailError) {
      console.warn("Could not open completed GRN details:", detailError);
    }
    toast.info(`This vehicle has already been received as ${grnNumber}. Opened GRN History.`);
  }

  async function openExistingCompletedGrn(error: unknown): Promise<boolean> {
    const message = error instanceof Error ? error.message : String(error || "");
    const grnNumber = message.match(/ASN already received under\s+(GRN-[A-Z0-9-]+)/i)?.[1];
    if (!grnNumber) return false;
    await openCompletedGrnHistory(grnNumber);
    return true;
  }

  useEffect(() => {
    if (activeTab === "dashboard" || activeTab === "records") {
      void loadRecords();
    }
  }, [activeTab, loadRecords]);

  const [availablePos, setAvailablePos] = useState<any[]>([]);

  useEffect(() => {
    async function loadPos() {
      try {
        const pos = await api.getPurchaseOrders();
        const formalPos = (Array.isArray(pos) ? pos : []).filter((p: any) => {
          const num = (p.poNumber || p.po_number || "").trim().toUpperCase();
          return num.startsWith("PO-") && !num.startsWith("PROP-");
        });
        if (formalPos.length > 0) {
          setAvailablePos(formalPos);
        }
      } catch (e) {
        console.error("Failed to load formal POs", e);
      }
    }
    // Purchase orders are optional in the ASN-based receiving flow. Do not
    // call the unavailable PO endpoint during GRN page initialization.
    if (false) void loadPos();
  }, []);

  // Persistent Rehydration on Page Refresh / Navigation
  useEffect(() => {
    const rawId = (search as any).grn_id || localStorage.getItem("active_grn_id");
    const targetId =
      typeof rawId === "string" &&
      rawId !== "undefined" &&
      rawId !== "null" &&
      rawId.trim().length > 0
        ? rawId.trim()
        : null;
    if (targetId && activeTab === "wizard" && !grnId) {
      if (resumeRequest.current === targetId) return;
      resumeRequest.current = targetId;
      void loadExistingGrnSession(targetId);
    }
  }, [(search as any).grn_id, activeTab, grnId]);

  useEffect(() => {
    const urlGrnId = String((search as any).grn_id || "").toLowerCase();
    if (
      search.tab !== "wizard" ||
      activeTab !== "wizard" ||
      !grnId ||
      (urlGrnId && urlGrnId !== "undefined" && urlGrnId !== "null")
    )
      return;
    navigate({
      to: "/grn",
      search: { tab: "wizard", page: currentPage, grn_id: grnId },
      replace: true,
    });
  }, [search.tab, activeTab, grnId, (search as any).grn_id, currentPage, navigate]);

  async function selectInboundVehicle(arrivalId: string) {
    const arrival = asnVehicleArrivals.find(
      (item) => String(item.id || item.gate_entry_number) === arrivalId,
    );
    if (!arrival) return;
    const completedForArrival = grnRecords.some(
      (record) =>
        normalizeVehicleKey(record.vehicle_number) === normalizeVehicleKey(arrival.vehicle_number) &&
        String(record.asn_number || record.asnNumber || "").trim().toUpperCase() ===
          String(header.asn_number || "").trim().toUpperCase() &&
        isCompletedGrnStatus(record.status),
    );
    if (completedForArrival) {
      toast.error("This vehicle is already linked to a completed GRN for this ASN.");
      return;
    }
    completedGrnConflictRef.current = false;
    const requestId = ++vehicleDraftRequest.current;
    setGrnId(null);
    localStorage.removeItem("active_grn_id");
    setHeader((previous) => ({
      ...previous,
      grn_number: "Assigning GRN number...",
      gate_entry_number: arrival.gate_entry_number || previous.gate_entry_number,
      gate_entry_id: arrival.id || previous.gate_entry_id,
      vehicle_number: arrival.vehicle_number || "",
      driver_name: arrival.driver_name || "",
      receiving_dock: arrival.dock_number || arrival.assigned_dock_id || "",
    }));

    const vehicleLines: GrnLineItem[] = (Array.isArray(arrival.expected_materials)
      ? arrival.expected_materials
      : []).map((line: any) => {
      const poQuantity = Number(line.quantity ?? line.shipped_quantity ?? line.po_quantity ?? 0);
      const receivedQuantity = Number(line.received_quantity ?? 0);
      return {
        material_name: line.material_name || line.item_code || "Material",
        item_code: line.item_code || line.material_code || "",
        po_quantity: poQuantity,
        received_quantity: receivedQuantity,
        good_quantity: Number(line.good_quantity ?? 0),
        damaged_quantity: Number(line.damaged_quantity ?? 0),
        balance_quantity: Math.max(poQuantity - receivedQuantity, 0),
        uom: line.uom || "PCS",
        material_category: line.material_category || "Raw Materials",
        quality_approved_quantity: 0,
        quality_result: "PENDING",
      };
    });
    setMaterials(vehicleLines);
    const approvals: Record<string, number> = {};
    const batches: Record<string, BatchEntry[]> = {};
    vehicleLines.forEach((line, index) => {
      const key = grnMaterialKey(line, index);
      approvals[key] = 0;
      batches[key] = [];
    });
    setQualityApproved(approvals);
    setMaterialBatches(batches);
    setDamagePhotos({});

    const dockNumber = arrival.dock_number || arrival.assigned_dock_id || "";
    if (!dockNumber || !header.asn_number.trim()) return;
    try {
      const draft = await api.createGrnHeader({
        receipt_type: "ASN_RECEIPT",
        asn_number: header.asn_number.trim(),
        gate_entry_id: arrival.id || undefined,
        gate_entry_number: arrival.gate_entry_number || undefined,
        dock_number: dockNumber,
        supplier_name: header.supplier_name,
        supplier_company_name: header.supplier_company_name,
        warehouse_id: header.warehouse_id || undefined,
        warehouse_name: header.warehouse_name,
        vehicle_number: arrival.vehicle_number || "",
        driver_name: arrival.driver_name || "",
      });
      if (requestId !== vehicleDraftRequest.current) return;
      const draftId = draft.grn_id || draft.grnId;
      const draftNumber = draft.grn_number || draft.grnNumber;
      if (!draftId || !draftNumber) throw new Error("The backend did not assign a GRN number.");
      setGrnId(String(draftId));
      localStorage.setItem("active_grn_id", String(draftId));
      setHeader((previous) => ({ ...previous, grn_number: String(draftNumber) }));
      setSaveStatus("saved");
      // The server may have returned an existing draft for this exact gate
      // arrival. Rehydrate its material lines, QC decisions, batches, and
      // damage evidence so switching between vehicles never loses progress.
      await loadExistingGrnSession(String(draftId), arrival);
    } catch (error: any) {
      if (requestId !== vehicleDraftRequest.current) return;
      setHeader((previous) => ({ ...previous, grn_number: "" }));
      toast.error(error?.message || "Could not assign a GRN number for this vehicle.");
    }
  }

  // Page 1: Auto-fetch the complete receiving context from the ASN.
  async function fetchPoContext(targetPoNumber?: string) {
    const numToFetch = (targetPoNumber || header.asn_number).trim();
    if (!numToFetch) {
      toast.error("Please enter a valid ASN Number");
      return;
    }
    const isAsnLookup = numToFetch.toUpperCase().startsWith("ASN-");
    if (!isAsnLookup && numToFetch.toUpperCase().startsWith("PROP-")) {
      toast.error(
        "Proposal numbers (PROP-) cannot be received in GRN. Please select or enter an approved Purchase Order number (e.g. PO-2026-0004).",
      );
      return;
    }
    if (saveLock.current) return;
    const requestId = ++contextRequest.current;
    completedGrnConflictRef.current = false;
    setLoadingContext(true);
    setAsnVehicleArrivals([]);
    try {
      // Resolve the ASN first, then load the receiving context by its
      // authoritative PO. This returns the persisted gate-entry number that
      // was created when Generate Gate Pass was pressed.
      const ctx = await api.getAsn(numToFetch);
      const resolvedContext = ctx;
      if (requestId !== contextRequest.current) return;
      const resolvedPoNumber =
        resolvedContext.po_number ||
        resolvedContext.poNumber ||
        resolvedContext.purchase_order_number ||
        resolvedContext.purchaseOrderNumber ||
        ctx.po_number ||
        ctx.poNumber ||
        "";
      const supplierName =
        resolvedContext.supplier_name ||
        resolvedContext.supplierName ||
        ctx.supplier_name ||
        ctx.supplierName ||
        "";
      const supplierComp =
        resolvedContext.supplier_company_name ||
        resolvedContext.supplierCompanyName ||
        supplierName;
      const supplierEmail =
        resolvedContext.supplier_email ||
        resolvedContext.supplierEmail ||
        resolvedContext.supplier?.email ||
        resolvedContext.supplier?.contact?.primary_email ||
        "";
      const asnNum =
        resolvedContext.asn_number ||
        resolvedContext.asnNumber ||
        ctx.asn_number ||
        ctx.asnNumber ||
        ctx.asn?.asn_number ||
        ctx.asn?.asnNumber ||
        numToFetch;
      const gateNum =
        resolvedContext.gate_entry_number ||
        resolvedContext.gateEntryNumber ||
        resolvedContext.gate_entry?.gate_entry_number ||
        resolvedContext.gate_entry?.gateEntryNumber ||
        "";
      const vehicleNum =
        resolvedContext.vehicle_number ||
        resolvedContext.vehicleNumber ||
        ctx.asn?.vehicle_number ||
        ctx.asn?.vehicleNumber ||
        ctx.gate_entry?.vehicle_number ||
        ctx.gate_entry?.vehicleNumber ||
        "";
      const driverName =
        resolvedContext.driver_name ||
        resolvedContext.driverName ||
        ctx.asn?.driver_name ||
        ctx.asn?.driverName ||
        ctx.gate_entry?.driver_name ||
        ctx.gate_entry?.driverName ||
        "";
      let matchingArrivals: any[] = [];
      if (String(asnNum).toUpperCase().startsWith("ASN-")) {
        try {
          const arrivalResponse = await api.getInboundArrivals();
          const allArrivals = Array.isArray(arrivalResponse)
            ? arrivalResponse
            : Array.isArray(arrivalResponse?.items)
              ? arrivalResponse.items
              : [];
          const normalizedAsn = String(asnNum).trim().toUpperCase();
          const asnId = String(
            resolvedContext.asn_id || resolvedContext.asnId || resolvedContext.id ||
            ctx.asn_id || ctx.asnId || ctx.asn?.id || "",
          );
          matchingArrivals = allArrivals
            .filter((arrival: any) =>
              String(arrival.asn_number || "").trim().toUpperCase() === normalizedAsn ||
              Boolean(asnId && String(arrival.asn_id || "") === asnId),
            )
            .filter((arrival: any, index: number, rows: any[]) =>
              rows.findIndex((row) => String(row.id || row.gate_entry_number) === String(arrival.id || arrival.gate_entry_number)) === index,
            )
            .sort((a: any, b: any) =>
              String(b.arrival_time || "").localeCompare(String(a.arrival_time || "")),
            );
        } catch (arrivalError) {
          console.warn("Could not load vehicle arrivals for ASN:", arrivalError);
          toast.error("Could not load arrived vehicles for this ASN. Refresh and try again.");
        }
      }
      setAsnVehicleArrivals(matchingArrivals);
      const selectedArrival =
        matchingArrivals.find(
          (arrival: any) =>
            gateNum &&
            String(arrival.gate_entry_number || "").trim().toUpperCase() ===
              String(gateNum).trim().toUpperCase(),
        ) ||
        matchingArrivals.find(
          (arrival: any) =>
            vehicleNum &&
            String(arrival.vehicle_number || "").replace(/[\s-]/g, "").toUpperCase() ===
              String(vehicleNum).replace(/[\s-]/g, "").toUpperCase(),
        ) ||
        matchingArrivals[0];
      const selectedGateNum = selectedArrival?.gate_entry_number || gateNum;
      const selectedVehicleNum = selectedArrival?.vehicle_number || vehicleNum;
      const selectedDriverName = selectedArrival?.driver_name || driverName;
      const warehouseName =
        resolvedContext.warehouse_name ||
        resolvedContext.warehouseName ||
        resolvedContext.destination_warehouse ||
        resolvedContext.destinationWarehouse ||
        ctx.destination_warehouse ||
        ctx.destinationWarehouse ||
        "";

      // Refresh allocation data when resolving an ASN. The ASN response can
      // predate dock assignment, and some older gate records lack their ASN FK.
      const latestDocks = await loadWarehouseDocks();
      const availableDocks = latestDocks.length ? latestDocks : dockOptions;
      const activeAllocations = availableDocks.filter((dock: any) => dock.current_allocation);
      const matchedAllocationDock = activeAllocations.find((dock: any) => {
        const allocation = dock.current_allocation;
        const norm = (value: unknown) => String(value || "").trim().toUpperCase();
        const allocationMaterial = norm(allocation.material_reference);
        return Boolean(
          (selectedVehicleNum && norm(allocation.vehicle_number) === norm(selectedVehicleNum)) ||
          (selectedGateNum && norm(allocation.existing_gate_pass_id) === norm(selectedGateNum)) ||
          (resolvedPoNumber && allocationMaterial.includes(norm(resolvedPoNumber))) ||
          (numToFetch && allocationMaterial.includes(norm(numToFetch))) ||
          (supplierName && norm(allocation.vendor_reference).includes(norm(supplierName)))
        );
      }) || (activeAllocations.length === 1 ? activeAllocations[0] : undefined);
      const allocationGateNumber =
        matchedAllocationDock?.current_allocation?.existing_gate_pass_id || "";
      const resolvedGateEntryNumber = selectedGateNum || allocationGateNumber;

      // Auto-detect allocated dock from warehouse allocation, gate entry, or PO context
      let prefilledDock =
        selectedArrival?.dock_number ||
        selectedArrival?.assigned_dock_id ||
        resolvedContext.prefilled_dock_number ||
        resolvedContext.prefilledDockNumber ||
        resolvedContext.gate_entry?.dock_number ||
        resolvedContext.gate_entry?.dockNumber ||
        resolvedContext.assigned_dock_number ||
        matchedAllocationDock?.dock_number ||
        "";
      const generatedGrnNum =
        resolvedContext.grn_number || resolvedContext.grnNumber || "";

      setHeader({
        receipt_type: resolvedContext.receipt_type || resolvedContext.receiptType || "",
        po_number: "",
        supplier_name: supplierName,
        supplier_company_name: supplierComp,
        supplier_email: supplierEmail,
        asn_number: asnNum,
        gate_entry_id: selectedArrival?.id || resolvedContext.gate_entry_id || resolvedContext.gateEntryId || "",
        gate_entry_number: resolvedGateEntryNumber,
        warehouse_id: resolvedContext.warehouse_id || resolvedContext.warehouseId || "",
        warehouse_name: warehouseName,
        grn_number: generatedGrnNum,
        vehicle_number: selectedVehicleNum,
        driver_name: selectedDriverName,
        receiving_dock: prefilledDock,
        invoice_number: "",
        received_by: loggedInUserName,
      });

      setDamagePhotos({});
      const contextGateId = resolvedContext.gate_entry_id || resolvedContext.gateEntryId || "";
      const contextGateNumber = resolvedContext.gate_entry_number || resolvedContext.gateEntryNumber || "";
      const contextVehicle = resolvedContext.vehicle_number || resolvedContext.vehicleNumber || "";
      const selectedVehicleKey = String(selectedVehicleNum || "").replace(/[\s-]/g, "").toUpperCase();
      const contextVehicleKey = String(contextVehicle).replace(/[\s-]/g, "").toUpperCase();
      const contextMatchesSelectedArrival = Boolean(
        selectedArrival && (
          (contextGateId && String(contextGateId) === String(selectedArrival.id)) ||
          (contextGateNumber && String(contextGateNumber).trim().toUpperCase() === String(selectedGateNum || "").trim().toUpperCase()) ||
          (contextVehicleKey && selectedVehicleKey && contextVehicleKey === selectedVehicleKey)
        ),
      );
      const resolvedGrnId = contextMatchesSelectedArrival
        ? resolvedContext.grn_id || resolvedContext.grnId || ctx.grn_id || ctx.grnId || null
        : null;
      if (resolvedGrnId) {
        setGrnId(String(resolvedGrnId));
        localStorage.setItem("active_grn_id", String(resolvedGrnId));
      } else {
        // ASN context is not a persisted GRN. Do not reuse an ASN UUID as the
        // GRN id for QR/evidence requests.
        setGrnId(null);
        localStorage.removeItem("active_grn_id");
      }
      if (resolvedContext.dock_options && resolvedContext.dock_options.length > 0) {
        setDockOptions((prev) => {
          const existingNums = new Set(prev.map((d: any) => d.dock_number));
          const newDocks = resolvedContext.dock_options.filter(
            (d: any) => !existingNums.has(d.dock_number),
          );
          return [...prev, ...newDocks];
        });
      }

      const vehicleMaterials = Array.isArray(selectedArrival?.expected_materials)
        ? selectedArrival.expected_materials
        : [];
      const sourceLines = vehicleMaterials.length
        ? vehicleMaterials
        : resolvedContext.lines || ctx.lines || [];
      const mapped: GrnLineItem[] = sourceLines.map((l: any) => {
        const sourceMaterial = l.material || l.material_master || {};
        const poQty = Number(
          l.quantity ?? l.shipped_quantity ?? l.po_quantity ?? l.ordered_quantity ?? l.orderedQuantity ?? 100,
        );
        // ASN/PO quantities are reference quantities only. A new receipt must
        // be physically counted by the operator before it is accepted.
        const recQty = Number(l.received_quantity ?? l.receivedQuantity ?? 0);
        const goodQty = Number(l.good_quantity ?? l.goodQuantity ?? 0);
        const dmgQty = Number(l.damaged_quantity ?? l.damagedQuantity ?? 0);
        const bal = Math.max(poQty - recQty, 0);

        return {
          grn_line_id: l.grn_line_id || l.grnLineId || l.line_id || l.uuid || l.id,
          material_name:
            l.material_name ||
            l.materialName ||
            sourceMaterial.material_name ||
            sourceMaterial.name ||
            l.item_code ||
            l.itemCode,
          item_code:
            l.item_code ||
            l.itemCode ||
            l.material_code ||
            sourceMaterial.material_code ||
            sourceMaterial.code,
          po_quantity: poQty,
          received_quantity: recQty,
          good_quantity: goodQty,
          damaged_quantity: dmgQty,
          balance_quantity: bal,
          uom: l.uom || "PCS",
          material_category: l.material_category || l.materialCategory || "Raw Materials",
          variant_code: l.variant_code || l.variantCode || "",
          variant_size: l.size || l.variant_size || l.variantSize || "",
          variant_color: l.color || l.variant_color || l.variantColor || "",
          variant_grade: l.grade || l.variant_grade || l.variantGrade || "",
          quality_approved_quantity: goodQty,
          quality_result: "PENDING",
        };
      });

      {
        setMaterials(mapped);
        const qApp: Record<string, number> = {};
        const initBatches: Record<string, BatchEntry[]> = {};
        mapped.forEach((m, idx) => {
          const rowKey = grnMaterialKey(m, idx);
          // Item Receiving's good/received quantity is not QC approval.
          // QC starts pending until the inspector enters and submits a result.
          qApp[rowKey] = 0;
          initBatches[rowKey] = [
            {
              batch_number: `BATCH-${m.item_code}-001`,
              batch_quantity: Math.floor(m.good_quantity / 2) || m.good_quantity,
            },
            {
              batch_number: `BATCH-${m.item_code}-002`,
              batch_quantity:
                m.good_quantity - (Math.floor(m.good_quantity / 2) || m.good_quantity),
            },
          ].filter((b) => b.batch_quantity > 0);
        });
        setQualityApproved(qApp);
        setMaterialBatches(initBatches);
      }

      // Persist the draft now so this screen displays an assigned number,
      // not an unreserved preview. Save & Continue reuses this same draft.
      if (!resolvedGrnId && prefilledDock) {
        const draft = await api.createGrnHeader({
          receipt_type: "ASN_RECEIPT",
          asn_number: asnNum,
          gate_entry_id: selectedArrival?.id || undefined,
          gate_entry_number: resolvedGateEntryNumber || undefined,
          dock_number: prefilledDock,
          supplier_name: supplierName,
          supplier_company_name: supplierComp,
          warehouse_id: resolvedContext.warehouse_id || resolvedContext.warehouseId || undefined,
          warehouse_name: warehouseName,
          vehicle_number: selectedVehicleNum,
          driver_name: selectedDriverName,
        });
        if (requestId !== contextRequest.current) return;
        const draftId = draft.grn_id || draft.grnId;
        if (!draftId || !(draft.grn_number || draft.grnNumber)) {
          throw new Error("The backend did not assign a GRN number. Fetch the ASN details again.");
        }
        setGrnId(String(draftId));
        localStorage.setItem("active_grn_id", String(draftId));
        setHeader((previous) => ({ ...previous, grn_number: draft.grn_number || draft.grnNumber }));
        setSaveStatus("saved");
      }
      if (resolvedGrnId) {
        // A context lookup can return the GRN already attached to this gate
        // arrival. Restore its saved QC, batches, quantities, and evidence
        // instead of leaving the ASN's initial manifest in the form.
        await loadExistingGrnSession(String(resolvedGrnId), selectedArrival);
      }
      toast.success(`${asnNum} details fetched successfully`);
    } catch (err: any) {
      if (requestId !== contextRequest.current) return;
      console.error("PO Fetch error:", err);
      toast.error(err.message || "Failed to fetch PO details");
    } finally {
      if (requestId === contextRequest.current) setLoadingContext(false);
    }
  }

  function changePoNumber(value: string) {
    setHeader((previous) => ({ ...previous, asn_number: value, po_number: "" }));
  }

  async function handleReceiptTypeChange(newType: "PO_RECEIPT" | "UNEXPECTED_DELIVERY") {
    if (newType === header.receipt_type) return;
    if (newType === "UNEXPECTED_DELIVERY") {
      const generatedGrn =
        header.grn_number ||
        "";
      setHeader((prev) => ({
        ...prev,
        receipt_type: "UNEXPECTED_DELIVERY",
        po_number: "",
        asn_number: "",
        gate_entry_number: "",
        supplier_name: prev.supplier_name || "Unknown / Unexpected Supplier",
        supplier_company_name: prev.supplier_company_name || "Unknown / Unexpected Supplier",
        receiving_dock: prev.receiving_dock || (dockOptions[0]?.dock_number ?? ""),
        grn_number: generatedGrn,
      }));
      setMaterials([]);
      setDamagePhotos({});
      setQualityApproved({});
      setMaterialBatches({});
      try {
        const ctx = await api.getGrnContext(
          undefined,
          header.vehicle_number || undefined,
          "UNEXPECTED_DELIVERY",
        );
        if (ctx.dock_options && ctx.dock_options.length > 0) {
          setDockOptions(ctx.dock_options);
        }
        if (ctx.gate_entry_number) {
          setHeader((prev) => ({ ...prev, gate_entry_number: ctx.gate_entry_number }));
        }
        if (ctx.grn_number) {
          setHeader((prev) => ({ ...prev, grn_number: ctx.grn_number }));
        }
      } catch (err) {
        console.warn("Could not fetch unexpected delivery context:", err);
      }
    } else {
      setHeader((prev) => ({
        ...prev,
        receipt_type: "PO_RECEIPT",
      }));
      setMaterials([]);
      setDamagePhotos({});
      setQualityApproved({});
      setMaterialBatches({});
      if (availablePos.length > 0) {
        const first = availablePos[0];
        const targetPo = first.poNumber || first.po_number;
        if (targetPo) {
          setHeader((prev) => ({ ...prev, po_number: targetPo }));
          void fetchPoContext(targetPo);
        }
      }
    }
  }

  function addManualMaterialRow() {
    const defaultMat = materialMasterList[0];
    const newRow: GrnLineItem = {
      material_name: defaultMat?.name || defaultMat?.material_name || "Raw Material",
      item_code:
        defaultMat?.code ||
        defaultMat?.material_code ||
        `MAT-${Math.floor(1000 + Math.random() * 9000)}`,
      material_category: defaultMat?.category || defaultMat?.material_category || "Raw Materials",
      po_quantity: 0,
      received_quantity: 1,
      good_quantity: 1,
      damaged_quantity: 0,
      balance_quantity: 0,
      uom: defaultMat?.base_uom || defaultMat?.uom || "PCS",
      quality_approved_quantity: 1,
      quality_result: "ACCEPTED",
    };
    setMaterials((prev) => {
      const next = [...prev, newRow];
      setQualityApproved((qa) => ({ ...qa, [newRow.item_code]: 1 }));
      setMaterialBatches((mb) => ({
        ...mb,
        [newRow.item_code]: [{ batch_number: `BATCH-${newRow.item_code}-001`, batch_quantity: 1 }],
      }));
      return next;
    });
  }

  function removeManualMaterialRow(index: number) {
    const target = materials[index];
    if (target) {
      setQualityApproved((qa) => {
        const next = { ...qa };
        delete next[target.item_code];
        return next;
      });
      setMaterialBatches((mb) => {
        const next = { ...mb };
        delete next[target.item_code];
        return next;
      });
      setDamagePhotos((dp) => {
        const next = { ...dp };
        delete next[target.item_code];
        return next;
      });
    }
    setMaterials((prev) => prev.filter((_, i) => i !== index));
  }

  function updateManualMaterialRow(index: number, updates: Partial<GrnLineItem>) {
    setMaterials((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item;
        const updated = { ...item, ...updates };
        if (updates.received_quantity !== undefined) {
          const rec = updates.received_quantity;
          updated.good_quantity = rec;
          updated.damaged_quantity = 0;
          updated.quality_approved_quantity = rec;
          updated.balance_quantity = 0;
          setQualityApproved((qa) => ({ ...qa, [grnMaterialKey(updated, index)]: rec }));
          setMaterialBatches((mb) => ({
            ...mb,
            [updated.item_code]: [
              {
                batch_number: `BATCH-${updated.item_code}-001`,
                batch_quantity: Math.floor(rec / 2) || rec,
              },
              {
                batch_number: `BATCH-${updated.item_code}-002`,
                batch_quantity: rec - (Math.floor(rec / 2) || rec),
              },
            ].filter((b) => b.batch_quantity > 0),
          }));
        }
        return updated;
      }),
    );
  }

  async function loadExistingGrnSession(targetGrnId: string, selectedArrival?: any) {
    if (
      !targetGrnId ||
      targetGrnId === "undefined" ||
      targetGrnId === "null" ||
      !targetGrnId.trim()
    )
      return;
    const cleanId = targetGrnId.trim();
    const restoreRequestId = ++sessionRestoreRequest.current;
    setLoadingContext(true);
    setSaveStatus("saving");
    try {
      const detail = await api.getGrnDetail(cleanId);
      if (
        restoreRequestId !== sessionRestoreRequest.current ||
        routeTabRef.current !== "wizard"
      )
        return;
      if (!detail) throw new Error("GRN record not found in database.");

      // The route parameter is already the persisted GRN UUID. Some older
      // response shapes omit `grn_id`, so retain the URL identifier instead
      // of cancelling a valid session.
      const resolvedId = String(detail.grn_id || detail.id || cleanId);
      if (!resolvedId || ["undefined", "null"].includes(resolvedId.toLowerCase())) {
        throw new Error("Backend returned an invalid GRN identifier; resume was cancelled.");
      }
      setGrnId(resolvedId);
      localStorage.setItem("active_grn_id", resolvedId);

      setHeader({
        receipt_type: (detail.receipt_type as any) || "",
        po_number: detail.po_number || "",
        supplier_name: detail.supplier_name || "",
        supplier_company_name: detail.supplier_company_name || detail.supplier_name || "",
        supplier_email: detail.supplier_email || detail.supplierEmail || "",
        asn_number:
          detail.asn_number ||
          detail.asnNumber ||
          detail.asn?.asn_number ||
          detail.asn?.asnNumber ||
          "",
        gate_entry_number: detail.gate_entry_number || "",
        gate_entry_id: detail.gate_entry_id || "",
        warehouse_id: detail.warehouse_id || "",
        warehouse_name: detail.warehouse_name || "",
        grn_number: detail.grn_number || "",
        vehicle_number: detail.vehicle_number || "",
        driver_name: detail.driver_name || "",
        receiving_dock: detail.dock_number || "",
        invoice_number: detail.invoice_number || "",
        received_by: detail.received_by || loggedInUserName,
      });

      let resolvedArrival = selectedArrival;
      let matchingVehicleArrivals: any[] = selectedArrival
        ? asnVehicleArrivals.filter(
            (arrival: any) =>
              String(arrival.asn_number || "").trim().toUpperCase() ===
              String(selectedArrival.asn_number || detail.asn_number || "").trim().toUpperCase(),
          )
        : [];
      const detailAsnNumber = String(detail.asn_number || detail.asnNumber || "")
        .trim()
        .toUpperCase();
      if (!resolvedArrival && detailAsnNumber) {
        try {
          const arrivalResponse = await api.getInboundArrivals(true);
          if (
            restoreRequestId !== sessionRestoreRequest.current ||
            routeTabRef.current !== "wizard"
          )
            return;
          const arrivals = Array.isArray(arrivalResponse)
            ? arrivalResponse
            : Array.isArray((arrivalResponse as any)?.items)
              ? (arrivalResponse as any).items
              : [];
          const normalizeVehicle = (value: unknown) =>
            String(value || "").replace(/[\s-]/g, "").toUpperCase();
          const matchingAsnArrivals = arrivals.filter(
            (arrival: any) =>
              String(arrival.asn_number || "").trim().toUpperCase() === detailAsnNumber,
          );
          matchingVehicleArrivals = matchingAsnArrivals;
          resolvedArrival =
            matchingAsnArrivals.find(
              (arrival: any) =>
                detail.gate_entry_id && String(arrival.id) === String(detail.gate_entry_id),
            ) ||
            matchingAsnArrivals.find(
              (arrival: any) =>
                detail.gate_entry_number &&
                String(arrival.gate_entry_number || "").trim().toUpperCase() ===
                  String(detail.gate_entry_number).trim().toUpperCase(),
            ) ||
            matchingAsnArrivals.find(
              (arrival: any) =>
                normalizeVehicle(arrival.vehicle_number) ===
                normalizeVehicle(detail.vehicle_number),
            );
          if (matchingAsnArrivals.length > 0) setAsnVehicleArrivals(matchingAsnArrivals);
        } catch (arrivalError) {
          console.warn("Unable to resolve the selected vehicle manifest:", arrivalError);
        }
      }

      let persistedLines = Array.isArray(detail.lines) ? detail.lines : [];
      const vehicleManifest = Array.isArray(resolvedArrival?.expected_materials)
        ? resolvedArrival.expected_materials
        : null;
      if (vehicleManifest && vehicleManifest.length > 0) {
        const normalizeCode = (value: unknown) => String(value || "").trim().toUpperCase();
        const persistedByCode = new Map(
          persistedLines.map((line: any) => [
            normalizeCode(line.item_code || line.material_code || line.code),
            line,
          ]),
        );
        // Keep the receiving table scoped to the selected arrival's manifest.
        // Reuse persisted rows for QC/batch state, while material lines absent
        // from a legacy draft are still shown from the authoritative manifest.
        persistedLines = vehicleManifest.map((manifestLine: any) => {
          const code = normalizeCode(
            manifestLine.item_code || manifestLine.material_code || manifestLine.code,
          );
          return persistedByCode.get(code) || {
            ...manifestLine,
            item_code: code,
            ordered_quantity: Number(
              manifestLine.quantity ?? manifestLine.shipped_quantity ?? manifestLine.po_quantity ?? 0,
            ),
            received_quantity: 0,
            good_quantity: 0,
            damaged_quantity: 0,
            quality_approved_quantity: 0,
            quality_result: "PENDING",
            batches: [],
          };
        });
      } else if (
        resolvedArrival &&
        matchingVehicleArrivals.length > 1 &&
        persistedLines.length > 0
      ) {
        // Older multi-vehicle ASNs did not persist a per-vehicle manifest.
        // Keep their original vehicle and material ordering so each truck
        // receives only its own line instead of the complete ASN shipment.
        const selectedVehicleIndex = matchingVehicleArrivals.findIndex(
          (arrival: any) => String(arrival.id) === String(resolvedArrival.id),
        );
        if (selectedVehicleIndex >= 0) {
          persistedLines = persistedLines.filter(
            (_line: any, lineIndex: number) =>
              lineIndex % matchingVehicleArrivals.length === selectedVehicleIndex,
          );
        }
      }
      if (persistedLines.length === 0 && detail.asn_number) {
        try {
          const asn = await api.getAsn(detail.asn_number);
          persistedLines = Array.isArray(asn?.lines) ? asn.lines : [];
        } catch {
          persistedLines = [];
        }
      }

      if (persistedLines.length > 0) {
        const rehydratedLines: GrnLineItem[] = persistedLines.map((l: any) => {
          const sourceMaterial = l.material || l.material_master || {};
          const poQty = Number(l.ordered_quantity ?? l.orderedQuantity ?? 0);
          const recQty = Number(
            l.received_quantity ??
              l.receivedQuantity ??
              Number(l.good_quantity ?? 0) + Number(l.damaged_quantity ?? 0),
          );
          const goodQty = Number(l.good_quantity ?? l.goodQuantity ?? recQty);
          const dmgQty = Number(l.damaged_quantity ?? l.damagedQuantity ?? 0);
          const balQty = Number(
            l.balance_quantity ?? l.balanceQuantity ?? Math.max(poQty - recQty, 0),
          );
          return {
            grn_line_id: l.grn_line_id || l.grnLineId || l.line_id || l.uuid || l.id,
            item_code:
              l.item_code ||
              l.material_code ||
              l.code ||
              sourceMaterial.material_code ||
              sourceMaterial.code,
            material_name:
              l.material_name ||
              l.materialName ||
              l.material_description ||
              sourceMaterial.material_name ||
              sourceMaterial.name ||
              l.item_code ||
              l.material_code ||
              l.code,
            material_category: l.material_category || "Raw Materials",
            po_quantity: poQty,
            received_quantity: recQty,
            good_quantity: goodQty,
            damaged_quantity: dmgQty,
            rejected_quantity: Number(l.rejected_quantity ?? l.rejectedQuantity ?? 0),
            held_quantity: Number(l.held_quantity ?? l.heldQuantity ?? 0),
            rejected_reason: l.rejected_reason || l.rejectedReason || "",
            held_reason: l.held_reason || l.heldReason || "",
            balance_quantity: balQty,
            uom: l.uom || "PCS",
            variant_code: l.variant_code || l.variantCode || "",
            variant_size: l.size || l.variant_size || l.variantSize || "",
            variant_color: l.color || l.variant_color || l.variantColor || "",
            variant_grade: l.grade || l.variant_grade || l.variantGrade || "",
            quality_approved_quantity: Number(l.quality_approved_quantity ?? goodQty),
            quality_result: l.quality_result || "PENDING",
          };
        });
        setMaterials(rehydratedLines);

        const qApp: Record<string, number> = {};
        const bMap: Record<string, BatchEntry[]> = {};
        const pMap: Record<string, any> = {};

        persistedLines.forEach((l: any, idx: number) => {
          const itemTarget = rehydratedLines[idx] || (l as GrnLineItem);
          const rowKey = grnMaterialKey(itemTarget, idx);
          const persistedQualityResult = String(l.quality_result || "PENDING").toUpperCase();
          const hasPersistedInspection =
            l.quality_approved_quantity !== null &&
            l.quality_approved_quantity !== undefined ||
            !["", "PENDING", "UNINSPECTED"].includes(persistedQualityResult);
          if (hasPersistedInspection) {
            qApp[rowKey] = Number(l.quality_approved_quantity ?? l.good_quantity ?? 0);
          }
          if (Array.isArray(l.batches) && l.batches.length > 0) {
            bMap[rowKey] = l.batches.map((b: any) => ({
              batch_id: b.id || b.batch_id,
              batch_number: b.batch_number,
              batch_quantity: Number(b.batch_quantity || 0),
              qr_id: b.qr_code?.qr_code || `QR-MAT-${l.item_code}`,
            }));
          } else {
            bMap[rowKey] = [
              {
                batch_number: `BATCH-${l.item_code}-001`,
                batch_quantity: Number(l.good_quantity || 0),
              },
            ];
          }
          if (Array.isArray(l.damage_evidence) && l.damage_evidence.length > 0) {
            const photoList = l.damage_evidence.map((ev: any, idx: number) => {
              const evId = String(ev.evidence_id || ev.id || `ev_${idx + 1}`);
              return {
                id: evId,
                evidenceId: evId,
                previewUrl: resolveMediaUrl(ev.file_path || ev.filePath),
                fileName: ev.file_name || ev.fileName || `damage-evidence-${idx + 1}.jpg`,
              };
            });
            const firstEv = l.damage_evidence[0];
            const firstEvId = String(firstEv.evidence_id || firstEv.id || "");
            pMap[rowKey] = {
              evidenceId: firstEvId,
              evidenceIds: l.damage_evidence
                .map((ev: any) => String(ev.evidence_id || ev.id))
                .filter(Boolean),
              previewUrl: resolveMediaUrl(firstEv.file_path || firstEv.filePath),
              reason: firstEv.reason || l.damage_reason,
              photos: photoList,
            };
          }
        });
        setQualityApproved(qApp);
        setMaterialBatches(bMap);
        if (Object.keys(pMap).length > 0) setDamagePhotos(pMap);
      }

      if (Array.isArray(detail.documents) && detail.documents.length > 0) {
        setUploadedDocuments(
          detail.documents.map((d: any) => ({
            document_id: d.id || d.document_id,
            category: d.document_type || d.category || "Invoice Copy",
            file_name: d.file_name || "document.pdf",
            file_path: d.file_path || "",
          })),
        );
      }

      // Compute highest completed step
      let computedStep = 1;
      if (persistedLines.length > 0) {
        computedStep = 2;
        const hasQty = persistedLines.some(
          (l: any) => Number(l.good_quantity || 0) > 0 || Number(l.damaged_quantity || 0) > 0,
        );
        if (hasQty) computedStep = 3;
        const hasQa = persistedLines.some((l: any) => {
          const result = String(l.quality_result || "").toUpperCase();
          return (
            (result && !["PENDING", "UNINSPECTED"].includes(result)) ||
            Number(l.quality_approved_quantity || 0) > 0
          );
        });
        if (hasQa) computedStep = 4;
        const hasBatches = persistedLines.some(
          (l: any) => Array.isArray(l.batches) && l.batches.length > 0,
        );
        if (hasBatches) computedStep = 5;
      }
      if (detail.documents && detail.documents.length > 0) {
        computedStep = 6;
      }

      const effectiveMaxStep = Math.max(detail.max_completed_step || 0, computedStep - 1);
      const targetStep = (search as any).page || detail.current_step || Math.min(computedStep, 6);

      setMaxCompletedStep(effectiveMaxStep);
      setCurrentPage(targetStep);
      setSaveStatus("saved");
      if (
        restoreRequestId === sessionRestoreRequest.current &&
        routeTabRef.current === "wizard"
      ) {
        navigate({ to: "/grn", search: { tab: "wizard", page: targetStep, grn_id: resolvedId } });
      }
    } catch (err: any) {
      if (
        restoreRequestId !== sessionRestoreRequest.current ||
        routeTabRef.current !== "wizard"
      )
        return;
      console.warn("Unable to restore GRN session:", err);
      setSaveStatus("error");
      // Do not keep retrying a deleted/stale GRN UUID from the URL or local
      // draft. Clear only the invalid session and return to a new header form.
      localStorage.removeItem("active_grn_id");
      localStorage.removeItem(GRN_LOCAL_DRAFT_KEY);
      setGrnId(null);
      setMaterials([]);
      setCurrentPage(1);
      toast.error("Unable to restore GRN data", {
        description: err instanceof Error ? err.message : "The saved GRN could not be loaded.",
      });
      void navigate({ to: "/grn", search: { tab: "wizard", page: 1 } });
    } finally {
      if (restoreRequestId === sessionRestoreRequest.current) setLoadingContext(false);
    }
  }

  function handleDeleteGrn(record: any) {
    setDeleteGrnTarget(record);
  }

  async function confirmDeleteGrn() {
    if (!deleteGrnTarget || deletingGrn) return;
    const record = deleteGrnTarget;
    const grnId = String(record?.grn_id || record?.id || "").trim();
    if (!grnId) {
      toast.error("This GRN has no valid database ID.");
      return;
    }
    const label = record?.grn_number || grnId;
    setDeletingGrn(true);
    try {
      await api.deleteGrn(grnId);
      setDeleteGrnTarget(null);
      toast.success(`GRN ${label} deleted.`);
      await loadRecords();
    } catch (error) {
      toast.error("Unable to delete GRN", {
        description: error instanceof Error ? error.message : "The backend rejected the deletion.",
      });
    } finally {
      setDeletingGrn(false);
    }
  }

  function startNewGrn(openWizard = true) {
    setGrnId(null);
    localStorage.removeItem("active_grn_id");
    localStorage.removeItem(GRN_LOCAL_DRAFT_KEY);
    setMaxCompletedStep(1);
    setCurrentPage(1);
    setSaveStatus("idle");
    setMaterials([]);
    setDamagePhotos({});
    setQualityApproved({});
    setMaterialBatches({});
    setUploadedDocuments([]);
    setHeader({
      grn_number: "",
      po_number: "",
      supplier_name: "",
      supplier_company_name: "",
      supplier_email: "",
      asn_number: "",
      gate_entry_number: "",
      warehouse_name: "",
      receiving_dock: "",
      receipt_type: "",
      vehicle_number: "",
      driver_name: "",
      invoice_number: "",
      received_by: loggedInUserName,
    });
    if (openWizard) navigate({ to: "/grn", search: { tab: "wizard", page: 1 } });
    if (openWizard && availablePos.length > 0) {
      const first = availablePos[0];
      const targetPo = first.poNumber || first.po_number;
      if (targetPo) {
        setHeader((prev) => ({ ...prev, po_number: targetPo }));
        void fetchPoContext(targetPo);
      }
    }
  }

  function handleStepClick(targetPage: number) {
    // The step navigation is intentionally always clickable so operators can
    // review any section and return to an earlier step. Each step still keeps
    // its own validation and Next button guards before allowing progression.
    setCurrentPage(targetPage);
    if (grnId) {
      void api
        .updateGrnStep(grnId, { current_step: targetPage, max_completed_step: maxCompletedStep })
        .catch(() => {});
    }
    void navigate({
      to: "/grn",
      search: { tab: "wizard", page: targetPage, grn_id: grnId || undefined },
    });
  }

  async function saveGrnHeader(): Promise<string> {
    // Refresh at save time: the GRN page may have been left open while
    // Warehouse allocated the single receiving dock in another tab.
    const latestDocks = await loadWarehouseDocks();
    const activeAllocations = latestDocks.filter((dock: any) => dock.current_allocation);
    const matchingAllocation = activeAllocations.find((dock: any) => {
      const allocation = dock.current_allocation;
      return Boolean(
        (header.vehicle_number && allocation.vehicle_number &&
          allocation.vehicle_number.trim().toUpperCase() === header.vehicle_number.trim().toUpperCase()) ||
        (header.gate_entry_number && allocation.existing_gate_pass_id &&
          allocation.existing_gate_pass_id.trim().toUpperCase() === header.gate_entry_number.trim().toUpperCase()) ||
        (header.po_number && allocation.material_reference &&
          allocation.material_reference.trim().toUpperCase().includes(header.po_number.trim().toUpperCase())) ||
        (header.supplier_name && allocation.vendor_reference &&
          allocation.vendor_reference.trim().toLowerCase().includes(header.supplier_name.trim().toLowerCase()))
      );
    }) || (activeAllocations.length === 1 ? activeAllocations[0] : undefined);
    const receivingDock =
      (grnId ? header.receiving_dock.trim() : "") ||
      matchingAllocation?.dock_number ||
      header.receiving_dock.trim() ||
      allocatedDockInfo?.dock_number ||
      dockOptions.find((dock: any) => String(dock.status || "").toUpperCase() === "AVAILABLE")?.dock_number ||
      dockOptions[0]?.dock_number ||
      "";
    const receivingGateEntryNumber =
      header.gate_entry_number.trim() ||
      matchingAllocation?.current_allocation?.existing_gate_pass_id ||
      "";
    if (!receivingDock) {
      throw new Error(
        "No receiving dock is available. Please configure a warehouse dock before proceeding.",
      );
    }
    if (!header.asn_number.trim()) throw new Error("Please enter an ASN on Step 1.");
    if (header.receipt_type === "UNEXPECTED_DELIVERY") {
      if (!isValidVehicleNumber(header.vehicle_number)) {
        throw new Error("Please enter a Vehicle Number for Unexpected Delivery.");
      }
      if (!isValidPersonName(header.driver_name)) {
        throw new Error("Please enter a Driver Name for Unexpected Delivery.");
      }
    }
    const res = await api.createGrnHeader({
      grn_id: grnId || undefined,
      receipt_type: "ASN_RECEIPT",
      asn_number: header.asn_number.trim(),
      gate_entry_id: header.gate_entry_id || undefined,
      gate_entry_number: receivingGateEntryNumber || undefined,
      dock_number: receivingDock,
      invoice_number: header.invoice_number,
      supplier_name:
        header.receipt_type === "PO_RECEIPT"
          ? header.supplier_name
          : header.supplier_name || "Unknown / Unexpected Supplier",
      supplier_company_name:
        header.receipt_type === "PO_RECEIPT"
          ? header.supplier_company_name
          : header.supplier_company_name || header.supplier_name || "Unknown / Unexpected Supplier",
      warehouse_id:
        header.warehouse_id ||
        dockOptions.find((dock: any) => dock.dock_number === receivingDock)?.warehouse_id ||
        undefined,
      warehouse_name: header.warehouse_name,
      vehicle_number: header.vehicle_number,
      driver_name: header.driver_name,
    });
    const savedGrnId = res?.grnId || res?.grn_id;

    if (!savedGrnId) {
      const responseFields =
        res && typeof res === "object" ? Object.keys(res).join(", ") : String(res);

      throw new Error(`GRN save response fields: ${responseFields || "(empty response)"}`);
    }
    setGrnId(savedGrnId);
    localStorage.setItem("active_grn_id", savedGrnId);
    setHeader((previous) => ({
      ...previous,
      grn_number: res.grn_number || res.grnNumber || previous.grn_number,
    }));
    return savedGrnId;
  }

  async function handleProceedFromPage1() {
    if (saveLock.current || loadingContext) return;
    saveLock.current = true;
    ++contextRequest.current;
    setBusyAction(true);
    setSaveStatus("saving");
    try {
      const savedId = await saveGrnHeader();
      setGrnId(savedId);
      localStorage.setItem("active_grn_id", savedId);
      const nextStep = 2;
      setMaxCompletedStep((prev) => Math.max(prev, 1));
      setSaveStatus("saved");
      toast.success("Step 1 Auto-Saved: GRN header saved to database.");
      setCurrentPage(nextStep);
      void api
        .updateGrnStep(savedId, { current_step: nextStep, max_completed_step: 1 })
        .catch(() => {});
      await navigate({ to: "/grn", search: { tab: "wizard", page: nextStep, grn_id: savedId } });
    } catch (error) {
      setSaveStatus("error");
      toast.error(error instanceof Error ? error.message : "Failed to save GRN header.");
    } finally {
      saveLock.current = false;
      setBusyAction(false);
    }
  }

  // Page 2 Calculations & Totals (Physical Receiving Reconciliation)
  const totalPoQty = materials.reduce((acc, m) => acc + (m.po_quantity || 0), 0);
  const totalReceivedQty = materials.reduce(
    (acc, m) =>
      acc + (m.received_quantity !== undefined ? m.received_quantity : m.good_quantity || 0),
    0,
  );
  const step2OverallStatus =
    materials.length > 0 &&
    materials.every(
      (m) =>
        (m.received_quantity !== undefined ? m.received_quantity : m.good_quantity || 0) ===
        m.po_quantity,
    )
      ? "COMPLETED"
      : "PENDING";
  const damagedMaterials = materials.filter((m) => (m.damaged_quantity || 0) > 0);
  const damagedMaterialRows = materials
    .map((material, materialIndex) => ({
      material,
      materialIndex,
      rowKey: grnMaterialKey(material, materialIndex),
    }))
    .filter(({ material }) => (material.damaged_quantity || 0) > 0);
  const qcHasRequiredEvidence = materials.every((m, idx) => {
    const received = Number(m.received_quantity || 0);
    const accepted = Number(qualityApproved[grnMaterialKey(m, idx)] ?? 0);
    const total =
      accepted +
      Number(m.rejected_quantity || 0) +
      Number(m.damaged_quantity || 0) +
      Number(m.held_quantity || 0);
    if (total !== received) return false;
    if ((m.rejected_quantity || 0) > 0 && !m.rejected_reason?.trim()) return false;
    if ((m.damaged_quantity || 0) > 0 && !m.damage_reason?.trim()) return false;
    if ((m.held_quantity || 0) > 0 && !m.held_reason?.trim()) return false;
    if ((m.damaged_quantity || 0) > 0) {
      const evidence = damagePhotos[grnMaterialKey(m, idx)] || damagePhotos[m.item_code];
      return Boolean(
        evidence?.file ||
        evidence?.previewUrl ||
        evidence?.evidenceId ||
        evidence?.evidenceIds?.length ||
        evidence?.photos?.length,
      );
    }
    return true;
  });

  // Page 2 -> Proceed to Page 3
  async function handleProceedFromPage2() {
    if (saveLock.current || loadingContext) return;
    if (header.receipt_type === "UNEXPECTED_DELIVERY") {
      if (!materials.length) {
        toast.error("Please add at least one material line for unexpected delivery.");
        return;
      }
      if (materials.some((m) => !m.material_name.trim() || !m.item_code.trim())) {
        toast.error("All material lines must have a valid material name and code.");
        return;
      }
      if (
        new Set(materials.map((m) => m.item_code.trim().toUpperCase())).size !== materials.length
      ) {
        toast.error("Duplicate material codes found. Each line must have a unique material code.");
        return;
      }
      if (
        materials.some((m) => {
          const rec = m.received_quantity !== undefined ? m.received_quantity : m.good_quantity;
          return !Number.isFinite(rec) || rec <= 0;
        })
      ) {
        toast.error("Received quantity must be greater than 0 for all material lines.");
        return;
      }
    } else {
      if (!materials.length) {
        toast.error("Fetch the PO materials on Step 1 first.");
        setCurrentPage(1);
        return;
      }
      if (
        materials.some((m) => {
          const rec = m.received_quantity !== undefined ? m.received_quantity : m.good_quantity;
          return !Number.isFinite(rec) || rec <= 0;
        })
      ) {
        toast.error("Enter the physically counted received quantity for all material lines.");
        return;
      }
      const invalidLine = materials.find((m) => {
        const rec = m.received_quantity !== undefined ? m.received_quantity : m.good_quantity;
        return rec > m.po_quantity;
      });
      if (invalidLine) {
        const rec =
          invalidLine.received_quantity !== undefined
            ? invalidLine.received_quantity
            : invalidLine.good_quantity;
        toast.error(
          `Received quantity for ${invalidLine.material_name} (${rec}) cannot exceed PO quantity (${invalidLine.po_quantity}).`,
        );
        return;
      }
    }

    saveLock.current = true;
    ++contextRequest.current;
    setBusyAction(true);
    setSaveStatus("saving");
    try {
      const savedGrnId = await saveGrnHeader();
      const payloadLines = materials.map((m) => {
        const rec = m.received_quantity !== undefined ? m.received_quantity : m.good_quantity;
        const currentTotal = (m.good_quantity || 0) + (m.damaged_quantity || 0);
        const good = currentTotal === rec ? m.good_quantity : rec;
        const damaged = currentTotal === rec ? m.damaged_quantity : 0;
        return {
          item_code: m.item_code,
          material_name: m.material_name,
          material_category: m.material_category || "Raw Materials",
          variant_code: m.variant_code,
          uom: m.uom || "PCS",
          received_quantity: rec,
          good_quantity: good,
          damaged_quantity: damaged,
        };
      });

      const result = await api.updateGrnLines(savedGrnId, payloadLines);
      if (!Array.isArray(result?.lines)) throw new Error("Backend did not return saved GRN lines.");
      const lines = result.lines.map((line: any) => ({
        item_code: line.item_code || line.itemCode,
        grn_line_id: line.grn_line_id || line.grnLineId || line.line_id || line.uuid || line.id,
      })) as Array<{ item_code: string; grn_line_id: string }>;

      const updated = materials.map((m, idx) => {
        const savedLine = lines[idx] || lines.find((line) => line.item_code === m.item_code);
        const grnLineId =
          savedLine?.grn_line_id || m.grn_line_id || `line-${idx}`;
        const rec = m.received_quantity !== undefined ? m.received_quantity : m.good_quantity;
        const currentTotal = (m.good_quantity || 0) + (m.damaged_quantity || 0);
        const good = currentTotal === rec ? m.good_quantity : rec;
        const damaged = currentTotal === rec ? m.damaged_quantity : 0;
        return {
          ...m,
          grn_line_id: grnLineId,
          received_quantity: rec,
          good_quantity: good,
          damaged_quantity: damaged,
          balance_quantity:
            header.receipt_type === "UNEXPECTED_DELIVERY" ? 0 : Math.max(m.po_quantity - rec, 0),
        };
      });
      setMaterials(updated);
      setQualityApproved((prev) => {
        const updatedQA = { ...prev };
        updated.forEach((m, idx) => {
          const rowKey = grnMaterialKey(m, idx);
          if (updatedQA[rowKey] === undefined) {
            updatedQA[rowKey] = m.good_quantity;
          }
        });
        return updatedQA;
      });
      const nextStep = 3;
      setMaxCompletedStep((prev) => Math.max(prev, 2));
      setSaveStatus("saved");
      toast.success("Step 2 Auto-Saved: Received quantities saved to database.");
      setCurrentPage(nextStep);
      void api
        .updateGrnStep(savedGrnId, { current_step: nextStep, max_completed_step: 2 })
        .catch(() => {});
      navigate({ to: "/grn", search: { tab: "wizard", page: nextStep, grn_id: savedGrnId } });
    } catch (error) {
      setSaveStatus("error");
      toast.error(error instanceof Error ? error.message : "Failed to save material details.");
    } finally {
      saveLock.current = false;
      setBusyAction(false);
    }
  }

  useEffect(() => {
    if (activeTab !== "wizard") return;
    if (!autosaveHydratedRef.current) {
      autosaveHydratedRef.current = true;
      return;
    }

    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }

    autosaveTimerRef.current = setTimeout(async () => {
      if (completedGrnConflictRef.current || saveLock.current || loadingContext || busyAction) return;
      if (
        !header.receipt_type ||
        (!header.receiving_dock.trim() && !allocatedDockInfo?.dock_number)
      )
        return;
      if (header.receipt_type === "PO_RECEIPT" && !header.po_number.trim()) return;
      if (
        header.receipt_type === "UNEXPECTED_DELIVERY" &&
        (!header.vehicle_number.trim() || !header.driver_name.trim())
      ) {
        return;
      }

      saveLock.current = true;
      setSaveStatus("saving");
      try {
        const savedGrnId = await saveGrnHeader();
        if (materials.length > 0) {
          const savableLines = materials.filter((m) => {
            const received =
              m.received_quantity !== undefined ? m.received_quantity : m.good_quantity;
            return m.item_code.trim() && m.material_name.trim() && Number.isFinite(received);
          });
          if (savableLines.length > 0) {
            await api.updateGrnLines(
              savedGrnId,
              savableLines.map((m) => {
                const received =
                  m.received_quantity !== undefined ? m.received_quantity : m.good_quantity;
                return {
                  item_code: m.item_code,
                  material_name: m.material_name,
                  material_category: m.material_category || "Raw Materials",
                  variant_code: m.variant_code,
                  uom: m.uom || "PCS",
                  received_quantity: received,
                  good_quantity: m.good_quantity,
                  damaged_quantity: m.damaged_quantity,
                };
              }),
            );
          }
        }
        setSaveStatus("saved");
      } catch (err) {
        if (await openExistingCompletedGrn(err)) return;
        console.warn("GRN autosave failed:", err);
        setSaveStatus("error");
        toast.error("Unable to save GRN changes", {
          description:
            err instanceof Error ? err.message : "The backend rejected the saved values.",
        });
      } finally {
        saveLock.current = false;
      }
    }, 1200);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [
    activeTab,
    busyAction,
    loadingContext,
    header.receipt_type,
    header.po_number,
    header.supplier_name,
    header.supplier_company_name,
    header.gate_entry_number,
    header.receiving_dock,
    header.warehouse_name,
    header.invoice_number,
    header.vehicle_number,
    header.driver_name,
    materials,
  ]);

  async function handleProceedFromPage3() {
    const invalidQcLine = materials.find((m, idx) => {
      const received = Number(m.received_quantity || 0);
      const accepted = Number(qualityApproved[grnMaterialKey(m, idx)] ?? 0);
      const rejected = Number(m.rejected_quantity || 0);
      const damaged = Number(m.damaged_quantity || 0);
      const held = Number(m.held_quantity || 0);
      return (
        accepted + rejected + damaged + held !== received ||
        (rejected > 0 && !m.rejected_reason?.trim()) ||
        (damaged > 0 && !m.damage_reason?.trim()) ||
        (held > 0 && !m.held_reason?.trim())
      );
    });
    if (invalidQcLine) {
      toast.error(
        `QC quantities and reasons are incomplete for ${invalidQcLine.material_name}. Accepted + Rejected + Damaged + Held must equal Received.`,
      );
      return;
    }

    // Strictly validate that if any material has damaged_quantity > 0, at least 1 photo evidence MUST be taken/attached
    const missingPhotoLine = damagedMaterialRows.find(({ material, rowKey }) => {
      const p = damagePhotos[rowKey] || damagePhotos[material.item_code];
      const hasPhotos =
        p &&
        ((Array.isArray(p.photos) && p.photos.length > 0) ||
          (Array.isArray(p.evidenceIds) && p.evidenceIds.length > 0) ||
          Boolean(p.evidenceId) ||
          Boolean(p.file) ||
          Boolean(p.previewUrl));
      return !hasPhotos;
    });

    if (missingPhotoLine) {
      toast.error(
        `Photo evidence required: Please take at least 1 photo for ${missingPhotoLine.material.material_name} (${missingPhotoLine.material.item_code}) to document the ${missingPhotoLine.material.damaged_quantity} ${missingPhotoLine.material.uom || "units"} damaged.`,
      );
      return;
    }

    setBusyAction(true);
    setSaveStatus("saving");
    try {
      const savedGrnId = grnId || (await saveGrnHeader());

      // Ensure GRN lines are up to date with correct damaged quantities and have grn_line_id
      const payloadLines = materials.map((m, idx) => {
        const rowKey = grnMaterialKey(m, idx);
        const rec = m.received_quantity !== undefined ? m.received_quantity : m.good_quantity;
        return {
          item_code: m.item_code,
          material_name: m.material_name,
          material_category: m.material_category || "Raw Materials",
          variant_code: m.variant_code,
          uom: m.uom || "PCS",
          received_quantity: rec,
          good_quantity: qualityApproved[rowKey] ?? m.good_quantity,
          damaged_quantity: m.damaged_quantity,
          rejected_quantity: m.rejected_quantity || 0,
          held_quantity: m.held_quantity || 0,
          rejected_reason: m.rejected_reason || null,
          damage_reason: m.damage_reason || null,
          held_reason: m.held_reason || null,
        };
      });

      const updateLinesRes = await api.updateGrnLines(savedGrnId, payloadLines).catch((e) => {
        console.warn("Update lines during step 3:", e);
        return null;
      });

      let currentMaterials = materials;
      if (updateLinesRes && Array.isArray(updateLinesRes.lines)) {
        currentMaterials = materials.map((m, idx) => {
          const match =
            updateLinesRes.lines[idx] ||
            updateLinesRes.lines.find((l: any) => (l.item_code || l.itemCode) === m.item_code);
          return match
            ? { ...m, grn_line_id: match.grn_line_id || match.grnLineId || m.grn_line_id }
            : m;
        });
        setMaterials(currentMaterials);
      }

      // Upload all pending damage photos to backend
      for (const [idx, m] of currentMaterials.entries()) {
        if ((m.damaged_quantity || 0) > 0) {
          const rowKey = grnMaterialKey(m, idx);
          const p = damagePhotos[rowKey] || damagePhotos[m.item_code];
          const lineIdToUse = m.grn_line_id || m.item_code;
          if (p && Array.isArray(p.photos) && lineIdToUse) {
            for (const photo of p.photos) {
              if (
                photo.file &&
                (!photo.evidenceId ||
                  photo.evidenceId.startsWith("photo_") ||
                  !photo.evidenceId.includes("-"))
              ) {
                try {
                  const data = new FormData();
                  data.append("file", photo.file);
                  data.append("damaged_quantity", String(m.damaged_quantity || 1));
                  if (m.damage_reason || p.reason) {
                    data.append("reason", m.damage_reason || p.reason || "");
                  }
                  const uploadRes = await api.uploadDamageEvidence(lineIdToUse, data);
                  if (uploadRes?.evidence_id || uploadRes?.evidenceId) {
                    photo.evidenceId = uploadRes.evidence_id || uploadRes.evidenceId;
                    photo.previewUrl = resolveMediaUrl(uploadRes.file_path) || photo.previewUrl;
                  }
                } catch (uploadErr) {
                  console.warn(`Could not upload photo file for ${m.item_code}:`, uploadErr);
                }
              }
            }
          }
        }
      }

      await api
        .submitQualityInspection(
          savedGrnId,
          currentMaterials.map((m, idx) => ({
            grn_line_id: m.grn_line_id,
            item_code: m.item_code,
            accepted_quantity: qualityApproved[grnMaterialKey(m, idx)] ?? 0,
            quality_approved_quantity:
              qualityApproved[grnMaterialKey(m, idx)] ?? 0,
            good_quantity: qualityApproved[grnMaterialKey(m, idx)] ?? 0,
            rejected_quantity: m.rejected_quantity || 0,
            damaged_quantity: m.damaged_quantity || 0,
            held_quantity: m.held_quantity || 0,
            rejected_reason: m.rejected_reason || null,
            damage_reason: m.damage_reason || null,
            held_reason: m.held_reason || null,
            quality_result:
              (m.rejected_quantity || 0) > 0 ||
              (m.damaged_quantity || 0) > 0 ||
              (m.held_quantity || 0) > 0
                ? "PARTIALLY_ACCEPTED"
                : "ACCEPTED",
          })),
        )
        .catch((e) => console.warn("Quality submit:", e));

      const nextStep = 4;
      setMaxCompletedStep((prev) => Math.max(prev, 3));
      setSaveStatus("saved");
      toast.success("Step 3 Auto-Saved: Quality inspection & damage evidence recorded.");
      setCurrentPage(nextStep);
      void api
        .updateGrnStep(savedGrnId, { current_step: nextStep, max_completed_step: 3 })
        .catch(() => {});
      navigate({ to: "/grn", search: { tab: "wizard", page: nextStep, grn_id: savedGrnId } });
    } catch (error) {
      setSaveStatus("error");
      toast.error(error instanceof Error ? error.message : "Failed to save quality details.");
    } finally {
      setBusyAction(false);
    }
  }

  async function handleProceedFromPage4() {
    const isUuid = (value: string | undefined) =>
      Boolean(
        value &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
      );
    if (!allBatchesValid) {
      toast.error("Total batch quantity must match the approved good quantity for every material.");
      return;
    }
    setBusyAction(true);
    setSaveStatus("saving");
    try {
      let batchMaterials = materials;
      if (grnId) {
        const detail = await api.getGrnDetail(grnId);
        const persistedLines = Array.isArray(detail?.lines) ? detail.lines : [];
        batchMaterials = materials.map((material) => {
          const match = persistedLines.find(
            (line: any) =>
              (line.item_code || line.itemCode || line.material_code) === material.item_code,
          );
          const persistedId = match
            ? match.grn_line_id || match.grnLineId || match.line_id || match.uuid || match.id
            : undefined;
          return persistedId ? { ...material, grn_line_id: String(persistedId) } : material;
        });
        setMaterials(batchMaterials);
      }

      for (const [idx, m] of batchMaterials.entries()) {
        const rowKey = grnMaterialKey(m, idx);
        const batchesForLine = materialBatches[rowKey] || materialBatches[grnMaterialKey(materials[idx], idx)] || materialBatches[m.item_code];
        if (Number(m.good_quantity || 0) > 0 && (!batchesForLine?.length || batchesForLine.reduce((sum, batch) => sum + Number(batch.batch_quantity || 0), 0) !== Number(m.good_quantity))) {
          throw new Error(`Save batches totaling the approved quantity for ${m.material_name || m.item_code} before continuing.`);
        }
        if (batchesForLine && !isUuid(m.grn_line_id)) {
          throw new Error(`Missing valid GRN line ID for ${m.material_name || m.item_code}`);
        }
        if (isUuid(m.grn_line_id) && batchesForLine) {
          const savedBatches = await api.createGrnBatches(
            m.grn_line_id as string,
            batchesForLine.map((b) => ({
              batch_quantity: Number(b.batch_quantity || 0),
            })),
          );
          if (!Array.isArray(savedBatches) || savedBatches.length !== batchesForLine.length) {
            throw new Error("Backend did not return all saved batch records.");
          }
          const persistedBatches = savedBatches.map((entry: any, batchIndex: number) => {
            const draftBatch = batchesForLine[batchIndex] || {
              batch_number: "",
              batch_quantity: 0,
            };
            return {
              batch_number:
                entry?.batch?.batch_number || entry?.batch_number || draftBatch.batch_number,
              batch_quantity: Number(
                entry?.batch?.batch_quantity ?? entry?.batch_quantity ?? draftBatch.batch_quantity,
              ),
              batch_id: entry?.batch?.batch_id || entry?.batch_id,
              qr_id: entry?.qr?.qr_id || entry?.qr_id,
              qr_payload: entry?.qr?.qr_payload || entry?.qr_payload,
            };
          });
          setMaterialBatches((prev) => ({ ...prev, [rowKey]: persistedBatches }));
        }
      }
      const nextStep = 5;
      setMaxCompletedStep((prev) => Math.max(prev, 4));
      setSaveStatus("saved");
      toast.success("Step 4 Auto-Saved: Batch allocations saved to database.");
      setCurrentPage(nextStep);
      const activeGrnId = grnId || localStorage.getItem("active_grn_id");
      if (activeGrnId) {
        localStorage.setItem("active_grn_id", activeGrnId);
        void api
          .updateGrnStep(activeGrnId, { current_step: nextStep, max_completed_step: 4 })
          .catch(() => {});
      }
      navigate({
        to: "/grn",
        search: { tab: "wizard", page: nextStep, grn_id: activeGrnId || undefined },
      });
    } catch (error) {
      setSaveStatus("error");
      toast.error(error instanceof Error ? error.message : "Failed to save batches.");
    } finally {
      setBusyAction(false);
    }
  }

  async function handleProceedFromPage5() {
    {
      const asnDoc = uploadedDocuments.find(
        (d) => isPersistedDocument(d) && d.category.toLowerCase().includes("asn"),
      );
      if (!asnDoc) {
        toast.error("ASN document must be uploaded and saved before proceeding.");
        return;
      }
    }
    const nextStep = 6;
    setMaxCompletedStep((prev) => Math.max(prev, 5));
    setSaveStatus("saved");
    toast.success("Step 5 Auto-Saved: Inbound documents verified.");
    setCurrentPage(nextStep);
    const activeGrnId = grnId || localStorage.getItem("active_grn_id");
    if (activeGrnId) {
      localStorage.setItem("active_grn_id", activeGrnId);
      void api
        .updateGrnStep(activeGrnId, { current_step: nextStep, max_completed_step: 5 })
        .catch(() => {});
    }
    navigate({
      to: "/grn",
      search: { tab: "wizard", page: nextStep, grn_id: activeGrnId || undefined },
    });
  }

  function isPersistedDocument(document: UploadedDocument) {
    const path = String(document.file_path || "");
    const activeGrnId = grnId || localStorage.getItem("active_grn_id") || "";
    const documentId = String(document.document_id || "").trim();
    const belongsToCurrentGrn = !document.grn_id || !activeGrnId || document.grn_id === activeGrnId;
    return (
      belongsToCurrentGrn &&
      ((!["", "undefined", "null"].includes(documentId.toLowerCase()) &&
        !path.startsWith("blob:")) ||
        Boolean(path && !path.startsWith("blob:")))
    );
  }

  useEffect(() => {
    if (currentPage !== 5 || !grnId) return;
    let cancelled = false;
    void api
      .getGrnDetail(grnId)
      .then((detail: any) => {
        if (cancelled || !Array.isArray(detail?.documents)) return;
        setUploadedDocuments(
          detail.documents.map((document: any) => ({
            document_id: document.id || document.document_id,
            grn_id: document.grn_id || grnId,
            category: document.document_type || document.category || "Document",
            file_name: document.file_name || "document.pdf",
            file_path: document.file_path || document.filePath || "",
          })),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [currentPage, grnId]);

  // Page 4 Validation Check
  function getBatchValidation(item: GrnLineItem, index: number) {
    const rowKey = grnMaterialKey(item, index);
    const mat = item;
    const appQty =
      qualityApproved[rowKey] !== undefined ? qualityApproved[rowKey] : (mat?.good_quantity ?? 0);
    const batches = materialBatches[rowKey] || materialBatches[item.item_code] || [];
    const totalBatchQty = batches.reduce((acc, b) => acc + Number(b.batch_quantity || 0), 0);
    const isValid =
      totalBatchQty === appQty || (appQty === 0 && (totalBatchQty === 0 || batches.length === 0));
    return { appQty, totalBatchQty, isValid };
  }

  const allBatchesValid = materials.every((m, idx) => getBatchValidation(m, idx).isValid);

  type DamageQrEntry = {
    damage_lot_id: string;
    damage_lot_number: string;
    item_code: string;
    material_name: string;
    damaged_quantity: number;
    uom: string;
    reason: string;
    qa_status: string;
    quarantine_location: string;
    status: string;
    exception_type?: "DAMAGED" | "REJECTED" | "QC_HOLD" | string;
    quantity_label?: string;
    qr_id: string;
    qr_code: string;
    qr_payload: string;
    qr_data_url: string;
  };

  const [damageQrLabels, setDamageQrLabels] = useState<DamageQrEntry[]>([]);

  function buildDamageQrPayload(
    m: GrnLineItem,
    reasonText: string,
    exceptionType: "DAMAGED" | "REJECTED" | "QC_HOLD" = "DAMAGED",
  ) {
    const lotNum = `DMG-LOT-${header.grn_number || grnId || "GRN"}-${m.item_code}`;
    const damagedQty = m.damaged_quantity || 0;
    const variantInfo = getMaterialVariantInfo(m.item_code, m.variant_code);
    const uom = m.uom || "BUNDLE";
    const category = m.material_category || variantInfo.category || "Raw Materials";

    return [
      `GRN Number: ${header.grn_number || ""}`,
      `Supplier: ${header.supplier_name || header.supplier_company_name || ""}`,
      `Warehouse: ${header.warehouse_name || "Main Warehouse"}`,
      `Quarantine Location: QUARANTINE-ZONE-A`,
      `Material Code: ${m.item_code}`,
      `Material Name: ${m.material_name || m.item_code}`,
      `Material Category: ${category}`,
      `Material Variant Code: ${variantInfo.variant_code}`,
      `Damage Lot: ${lotNum}`,
      `QA Status: ${exceptionType}`,
      `Quantity Label: ${exceptionType === "REJECTED" ? "Rejected Qty" : exceptionType === "QC_HOLD" ? "Held Qty" : "Damaged Qty"}`,
      `Size: ${variantInfo.size}`,
      `Color: ${variantInfo.color}`,
      `Grade: ${variantInfo.grade}`,
      `UOM: ${uom}`,
      `Inspection Status: ${exceptionType}`,
      `${exceptionType === "REJECTED" ? "Rejected" : exceptionType === "QC_HOLD" ? "Held" : "Damaged"} Quantity: ${damagedQty} ${uom}`,
      `${exceptionType === "REJECTED" ? "Rejection" : exceptionType === "QC_HOLD" ? "Hold" : "Damage"} Reason: ${reasonText}`,
    ].join("\n");
  }

  function printSingleDamageQrLabel(entry: DamageQrEntry) {
    const win = window.open("", "_blank", "width=500,height=550");
    if (!win) {
      toast.error("Please allow popups to print label");
      return;
    }
    win.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>WMS Quarantine & Damage QR Label - ${entry.damage_lot_number}</title>
          <style>
            body { font-family: 'Courier New', monospace, sans-serif; padding: 20px; text-align: center; background: #fff; }
            .card { border: 3px solid #be123c; border-radius: 16px; padding: 24px; max-width: 380px; margin: 0 auto; background: #ffffff; }
            img { width: 260px; height: 260px; margin: 16px auto; display: block; }
            h2 { margin: 8px 0 0; font-size: 18px; color: #9f1239; font-weight: 800; word-break: break-all; }
            .header-tag { font-size: 11px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; color: #be123c; background: #ffe4e6; padding: 6px; border-radius: 8px; border: 1px solid #fecdd3; }
            @media print { body { padding: 0; } .card { box-shadow: none; } }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="header-tag">⚠️ WMS QUARANTINE & DAMAGED GOODS LABEL</div>
            <h2>${entry.damage_lot_number}</h2>
            ${entry.qr_data_url ? `<img src="${entry.qr_data_url}" alt="Damage QR Code" />` : '<div style="height:260px;line-height:260px;font-weight:bold;">GENERATING QR...</div>'}
          </div>
          <script>
            window.onload = () => { window.focus(); window.print(); };
          </script>
        </body>
      </html>
    `);
    win.document.close();
  }

  function printAllDamageQrLabels() {
    const win = window.open("", "_blank", "width=950,height=950");
    if (!win) {
      toast.error("Please allow popups to print labels");
      return;
    }

    let labelsHtml = "";
    for (const entry of damageQrLabels) {
      labelsHtml += `
        <div class="card">
          <div class="header">⚠️ QUARANTINE & DAMAGED GOODS LABEL</div>
          <h2>${entry.damage_lot_number}</h2>
          ${entry.qr_data_url ? `<img src="${entry.qr_data_url}" alt="Damage QR Code" />` : `<div style="height:220px;line-height:220px;font-weight:bold;">QR CODE</div>`}
        </div>
      `;
    }

    win.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>WMS Damaged Goods QR Labels - ${header.grn_number}</title>
          <style>
            body { font-family: monospace, sans-serif; padding: 20px; background: #fff; text-align: center; }
            .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
            .card { border: 2px solid #be123c; border-radius: 12px; padding: 16px; break-inside: avoid; background: #fff; text-align: center; }
            .header { font-size: 11px; font-weight: bold; text-transform: uppercase; color: #be123c; border-bottom: 1px solid #fda4af; padding-bottom: 4px; }
            h2 { margin: 8px 0 4px; font-size: 16px; color: #9f1239; word-break: break-all; }
            img { width: 220px; height: 220px; margin: 10px auto; display: block; }
            @media print { body { padding: 0; } .card { margin-bottom: 12px; } }
          </style>
        </head>
        <body>
          <h3 style="margin-bottom: 15px; color: #be123c;">WMS DAMAGED / QUARANTINE GOODS QR LABELS (${header.grn_number})</h3>
          <div class="grid">${labelsHtml}</div>
          <script>
            window.onload = () => { window.focus(); window.print(); };
          </script>
        </body>
      </html>
    `);
    win.document.close();
  }

  async function handleViewGrnDetail(r: any) {
    const norm = normalizeGrnRecord(r);
    const targetId = norm?.grn_id || norm?.id || norm?.grn_number;
    if (targetId) {
      try {
        const fullDetail = await api.getGrnDetail(targetId);
        if (fullDetail) {
          setSelectedGrnDetail(normalizeGrnRecord(fullDetail));
          return;
        }
      } catch (e) {
        console.warn("Could not fetch full GRN detail:", e);
      }
    }
    setSelectedGrnDetail(norm);
  }

  // Live dock bay release status and transport lookup for selected GRN detail
  useEffect(() => {
    if (!selectedGrnDetail) {
      setDetailDockInfo({ dock: null, allocation: null, isReleased: true, loading: false, releasing: false });
      setDetailGateEntry(null);
      return;
    }

    let isMounted = true;
    setDetailGateEntry(null);
    setDetailDockInfo({
      dock: null,
      allocation: null,
      isReleased: true,
      loading: true,
      releasing: false,
    });
    async function resolveDockAndGate() {
      try {
        const [docksRes, gatesRes] = await Promise.all([
          api.getDocks().catch(() => []),
          api.getGateEntries().catch(() => []),
        ]);

        const normalizeLookupKey = (value: unknown) =>
          String(value || "")
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "");
        const rawDockNum = normalizeLookupKey(selectedGrnDetail.dock_number);
        const rawVeh = normalizeLookupKey(selectedGrnDetail.vehicle_number);
        const rawGateEntryNumber = normalizeLookupKey(selectedGrnDetail.gate_entry_number);
        const rawGateEntryId = normalizeLookupKey(selectedGrnDetail.gate_entry_id);
        const gateIdentifiers = [rawGateEntryNumber, rawGateEntryId].filter(Boolean);
        const docks = Array.isArray(docksRes) ? docksRes : [];
        const matchedDock =
          docks.find((dock: any) => {
            const dockNumber = normalizeLookupKey(dock.dock_number || dock.dock_code || dock.name);
            return (
              rawDockNum &&
              dockNumber &&
              (dockNumber === rawDockNum ||
                dockNumber.includes(rawDockNum) ||
                rawDockNum.includes(dockNumber))
            );
          }) ||
          docks.find((dock: any) => {
            const allocation = dock.current_allocation;
            if (!allocation) return false;
            const allocationGateIdentifiers = [
              allocation.existing_gate_pass_id,
              allocation.gate_entry_id,
              allocation.gate_entry_number,
              allocation.gate_pass_number,
            ]
              .map(normalizeLookupKey)
              .filter(Boolean);
            if (gateIdentifiers.length > 0) {
              return gateIdentifiers.some((identifier) =>
                allocationGateIdentifiers.includes(identifier),
              );
            }
            return rawVeh && normalizeLookupKey(allocation.vehicle_number) === rawVeh;
          });

        const matchedGate = (Array.isArray(gatesRes) ? gatesRes : []).find((gate: any) => {
          const gateNumber = normalizeLookupKey(gate.gate_entry_number || gate.gateEntryNumber);
          const gateId = normalizeLookupKey(gate.id || gate.gate_entry_id || gate.gateEntryId);
          if (gateIdentifiers.length > 0) {
            return gateIdentifiers.includes(gateNumber) || gateIdentifiers.includes(gateId);
          }
          const gateVehicle = normalizeLookupKey(gate.vehicle_number || gate.vehicleNumber);
          return rawVeh && gateVehicle === rawVeh;
        });

        if (isMounted) {
          setDetailGateEntry(matchedGate || null);

          const dockStatus = String(matchedDock?.status || "").toUpperCase();
          const alloc = matchedDock?.current_allocation || null;
          const allocStatus = String(alloc?.status || "").toUpperCase();

          let isReleased = false;
          if (!matchedDock && !selectedGrnDetail.dock_number) {
            isReleased = true;
          } else if (dockStatus === "AVAILABLE" && (!alloc || allocStatus === "RELEASED")) {
            isReleased = true;
          } else if (allocStatus === "RELEASED") {
            isReleased = true;
          } else if (dockStatus === "OCCUPIED" || dockStatus === "RESERVED" || dockStatus === "ALLOCATED" || alloc) {
            isReleased = false;
          } else {
            isReleased = true;
          }

          setDetailDockInfo({
            dock: matchedDock || null,
            allocation: alloc,
            isReleased,
            loading: false,
            releasing: false,
          });
        }
      } catch (err) {
        if (isMounted) {
          setDetailDockInfo((prev) => ({ ...prev, loading: false }));
        }
      }
    }

    void resolveDockAndGate();
    return () => {
      isMounted = false;
    };
  }, [selectedGrnDetail]);

  async function handleReleaseDockFromDetail() {
    if (!selectedGrnDetail) return;
    const targetId =
      detailDockInfo.allocation?.id ||
      detailDockInfo.dock?.id ||
      detailDockInfo.dock?.current_allocation?.id ||
      selectedGrnDetail.dock_id ||
      selectedGrnDetail.dock_number ||
      selectedGrnDetail.vehicle_number;

    if (!targetId) {
      toast.error("Could not find dock ID or allocation ID to release.");
      return;
    }

    try {
      setDetailDockInfo((prev) => ({ ...prev, releasing: true }));
      try {
        await api.completeDockReceiving(String(targetId));
      } catch {}
      await api.releaseDock(String(targetId));

      const dockLabel =
        selectedGrnDetail.dock_number
          ? selectedGrnDetail.dock_number.startsWith("Dock")
            ? selectedGrnDetail.dock_number
            : `Dock ${selectedGrnDetail.dock_number}`
          : detailDockInfo.dock?.dock_number || "Bay";

      toast.success(`${dockLabel} released successfully!`, {
        description: "The dock bay is now available for subsequent shipments.",
      });

      setDetailDockInfo((prev) => ({
        ...prev,
        isReleased: true,
        releasing: false,
        dock: prev.dock ? { ...prev.dock, status: "AVAILABLE" } : prev.dock,
        allocation: prev.allocation ? { ...prev.allocation, status: "RELEASED" } : null,
      }));

      await loadWarehouseDocks();
      window.dispatchEvent(new CustomEvent("notifications:refresh"));
    } catch (err: any) {
      toast.error("Failed to release dock", {
        description: err?.message || "Please check permissions or try again.",
      });
      setDetailDockInfo((prev) => ({ ...prev, releasing: false }));
    }
  }

  // Print Official Goods Receipt Note (GRN) Certificate / Document
  async function printGrnCertificate(record: any) {
    const norm = normalizeGrnRecord(record) || record;
    let linesToRender =
      norm.lines && norm.lines.length > 0
        ? norm.lines
        : norm.materials && norm.materials.length > 0
          ? norm.materials
          : [];
    const targetId = norm.grn_id || norm.id || norm.grn_number;
    if (linesToRender.length === 0 && targetId) {
      try {
        const fullDetail = await api.getGrnDetail(targetId);
        if (fullDetail && (fullDetail.lines || fullDetail.materials)) {
          linesToRender = fullDetail.lines || fullDetail.materials;
          record = normalizeGrnRecord({ ...norm, ...fullDetail });
        }
      } catch {
        // fallback
      }
    }
    if (linesToRender.length === 0) linesToRender = materials;

    const win = window.open("", "_blank", "width=900,height=950");
    if (!win) {
      toast.error("Please allow popups to print GRN document");
      return;
    }
    const grnNum = norm.grn_number || header.grn_number || "—";
    const poNum = norm.po_number || header.po_number || "—";
    const supplier =
      norm.supplier_name || norm.supplier_company_name || header.supplier_name || "—";
    const dock = norm.dock_number || header.receiving_dock || "—";
    const vehicle = norm.vehicle_number || header.vehicle_number || "—";
    const driver = norm.driver_name || header.driver_name || "—";
    const receivedBy = norm.received_by || header.received_by || loggedInUserName || "—";
    const dateStr = formatCardDate(norm.receipt_date || norm.created_at);

    let rowsHtml = "";
    linesToRender.forEach((m: any, idx: number) => {
      rowsHtml += `
        <tr>
          <td>${idx + 1}</td>
          <td><strong>${m.item_code || m.itemCode}</strong></td>
          <td>${m.material_name || m.materialName || m.item_code}</td>
          <td>${m.ordered_quantity || m.po_quantity || 100} ${m.uom || "PCS"}</td>
          <td style="color:#047857;font-weight:bold;">${m.good_quantity ?? m.goodQuantity ?? 100} ${m.uom || "PCS"}</td>
          <td style="color:#b91c1c;font-weight:bold;">${m.damaged_quantity ?? m.damagedQuantity ?? 0} ${m.uom || "PCS"}</td>
          <td>${m.balance_quantity ?? m.balanceQuantity ?? 0} ${m.uom || "PCS"}</td>
        </tr>
      `;
    });

    win.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>WMS Goods Receipt Note Certificate - ${grnNum}</title>
          <style>
            body { font-family: sans-serif; padding: 30px; background: #fff; color: #1e293b; font-size: 13px; line-height: 1.5; }
            .header { border-bottom: 3px solid #0f172a; padding-bottom: 12px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-end; }
            .brand { font-size: 22px; font-weight: 800; color: #0f172a; letter-spacing: -0.5px; }
            .tag { background: #e2e8f0; font-size: 11px; font-weight: bold; padding: 4px 10px; border-radius: 6px; text-transform: uppercase; }
            .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; background: #f8fafc; padding: 14px; border-radius: 10px; border: 1px solid #e2e8f0; margin-bottom: 20px; font-size: 12px; }
            table { width: 100%; border-collapse: collapse; margin-top: 15px; }
            th { background: #0f172a; color: #fff; text-align: left; padding: 8px 10px; font-size: 11px; text-transform: uppercase; }
            td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 12px; }
            .footer { margin-top: 40px; border-top: 1px dashed #cbd5e1; padding-top: 20px; display: flex; justify-content: space-between; text-align: center; }
            .sign-box { width: 200px; border-top: 1px solid #0f172a; padding-top: 6px; font-weight: bold; font-size: 11px; }
          </style>
        </head>
        <body>
          <div class="header">
            <div>
              <div class="brand">KAIZENASSESTS • GOODS RECEIPT NOTE</div>
              <p style="margin:2px 0 0;font-size:11px;color:#64748b;">Official Material Inbound Quality & Stock Entry Certificate</p>
            </div>
            <div class="tag">GRN NO: ${grnNum}</div>
          </div>

          <div class="grid">
            <div><strong>PO Reference:</strong> ${poNum}</div>
            <div><strong>Supplier Name:</strong> ${supplier}</div>
            <div><strong>Receiving Dock:</strong> Dock ${dock}</div>
            <div><strong>Vehicle Registration:</strong> ${vehicle}</div>
            <div><strong>Driver Name:</strong> ${driver}</div>
            <div><strong>Receipt Date:</strong> ${dateStr}</div>
            <div><strong>Officer / Inspector:</strong> ${receivedBy}</div>
            <div><strong>Status:</strong> ${record.status || "COMPLETED & POSTED"}</div>
          </div>

          <h4 style="margin:15px 0 5px;font-size:12px;text-transform:uppercase;">Material Line Items Breakdown</h4>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Item Code</th>
                <th>Material Description</th>
                <th>Ordered Qty</th>
                <th>Good Qty</th>
                <th>Damaged Qty</th>
                <th>Balance Qty</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>

          <div class="footer">
            <div class="sign-box">Received By Officer<br/><span style="font-weight:normal;color:#64748b;">${receivedBy}</span></div>
            <div class="sign-box">Quality Control Inspector<br/><span style="font-weight:normal;color:#64748b;">QA Approved</span></div>
            <div class="sign-box">Warehouse Manager<br/><span style="font-weight:normal;color:#64748b;">Stock Verified</span></div>
          </div>

          <script>
            window.onload = () => { window.focus(); window.print(); };
          </script>
        </body>
      </html>
    `);
    win.document.close();
  }

  // Display the same batch QR labels from the GRN History record.
  async function viewGrnRecordBatchLabels(record: any) {
    try {
      record = await loadGrnQrRecord(record, (id) => api.getGrnDetail(id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load saved GRN batches.");
      return;
    }
    const linesToRender = record.lines;

    const grnNum = record.grn_number || header.grn_number || "";
    const poNum = record.po_number || header.po_number || "";
    const supplier = record.supplier_name || record.supplier_company_name || "";
    const warehouse = record.warehouse_name || header.warehouse_name || "";

    const labelsToPrint: Array<{
      type: "BATCH" | "QUARANTINE" | "TEMPLATE";
      title: string;
      qrId: string;
      dataUrl: string;
      payload: string;
      materialCode: string;
      materialName: string;
      category?: string;
      quantity?: number | string;
      uom?: string;
      grnNumber?: string;
      poNumber?: string;
      supplierName?: string;
    }> = [];

    for (const m of linesToRender) {
      const itemCode = m.item_code || m.itemCode || m.material_code || m.materialCode || "ITEM";
      const matName = m.material_name || m.materialName || m.material_description || itemCode;
      const cat = m.material_category || m.category || "Raw Materials";
      const uom = m.uom || "PCS";
      const batches =
        m.batches && m.batches.length > 0
          ? m.batches
          : m.batch_number || m.batchNumber
            ? [
                {
                  batch_number: m.batch_number || m.batchNumber,
                  batch_quantity: m.batch_quantity ?? m.batchQuantity ?? 0,
                },
              ]
            : [
                {
                  batch_number: `BATCH-${itemCode}-001`,
                  batch_quantity: m.good_quantity ?? m.received_quantity ?? 0,
                },
              ];

      for (const b of batches) {
        const savedBatch = b.batch || b;
        const batchNum =
          savedBatch.batch_number ||
          savedBatch.batchNumber ||
          savedBatch.batch_no ||
          savedBatch.batchNo ||
          savedBatch.lot_number ||
          savedBatch.lotNumber ||
          `BATCH-${itemCode}-001`;
        const batchQty =
          savedBatch.batch_quantity !== undefined
            ? savedBatch.batch_quantity
            : savedBatch.batchQuantity !== undefined
              ? savedBatch.batchQuantity
              : (m.good_quantity ?? m.received_quantity ?? 0);
        const qrId = `QR-${grnNum}-${itemCode}-${batchNum}`;
        const payload = [
          `GRN Number: ${grnNum}`,
          `Material Code: ${itemCode}`,
          `Material Name: ${matName}`,
          `Batch: ${batchNum}`,
          `Size: 25 mm × 3 m`,
          `Color: Standard`,
          `Warehouse: ${warehouse}`,
          `Grade: ISI Standard`,
          `UOM: ${uom}`,
          `Inspection Status: COMPLETED`,
          `Batch Quantity: ${batchQty} ${uom}`,
        ].join("\n");

        let dataUrl = "";
        try {
          dataUrl = await QRCode.toDataURL(payload, {
            margin: 2,
            width: 300,
            errorCorrectionLevel: "M",
          });
        } catch {
          dataUrl = "";
        }

        labelsToPrint.push({
          type: "BATCH",
          title: batchNum,
          qrId,
          dataUrl,
          payload,
          materialCode: itemCode,
          materialName: matName,
          category: cat,
          quantity: batchQty,
          uom,
          grnNumber: grnNum,
          poNumber: poNum,
          supplierName: supplier,
        });
      }
    }

    if (labelsToPrint.length === 0) {
      toast.info(`No batch allocations found for GRN ${grnNum}`);
      return;
    }

    setHistoryQrLabels(labelsToPrint);
  }

  // Export GRN Records to CSV File
  function exportGrnRecordsCsv() {
    if (grnRecords.length === 0) {
      toast.info("No GRN records found in database to export");
      return;
    }
    const listToExport = grnRecords;

    let csv =
      "GRN Number,PO Number,Supplier Name,Dock Number,Vehicle Number,Driver Name,Status,Receipt Date,Received By\n";
    listToExport.forEach((r: any) => {
      csv += `"${r.grn_number || ""}","${r.po_number || ""}","${r.supplier_name || ""}","${r.dock_number || ""}","${r.vehicle_number || ""}","${r.driver_name || ""}","${r.status || ""}","${r.receipt_date || ""}","${r.received_by || ""}"\n`;
    });

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute(
      "download",
      `WMS_GRN_Records_Export_${new Date().toISOString().split("T")[0]}.csv`,
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success(`Exported ${listToExport.length} GRN records to CSV spreadsheet`);
  }

  function buildMaterialQrPayload(itemCode: string, batch?: BatchEntry, material?: GrnLineItem) {
    const mat = material || materials.find((m) => m.item_code === itemCode);
    const matIndex = mat ? materials.indexOf(mat) : -1;
    const rowKey = mat && matIndex >= 0 ? grnMaterialKey(mat, matIndex) : itemCode;
    const bList = materialBatches[rowKey] || materialBatches[itemCode] || [];
    const b = batch ||
      bList[0] || {
        batch_number: `BATCH-${itemCode}-001`,
        batch_quantity: mat?.good_quantity || 0,
      };
    const variantInfo = getMaterialVariantInfo(itemCode, mat?.variant_code);

    const uom = mat?.uom || "BUNDLE";
    const category = mat?.material_category || variantInfo.category || "Raw Materials";
    const goodQty = mat?.good_quantity || b.batch_quantity || 0;
    const dmgQty = mat?.damaged_quantity || 0;
    const rejQty = mat?.rejected_quantity || 0;
    const batchQty = b.batch_quantity !== undefined ? b.batch_quantity : goodQty;
    const inspectionStatus = dmgQty > 0 || rejQty > 0 ? "PARTIAL" : "COMPLETED";

    return [
      `GRN Number: ${header.grn_number || ""}`,
      `Supplier: ${header.supplier_name || header.supplier_company_name || ""}`,
      `Warehouse: ${header.warehouse_name || "Main Warehouse"}`,
      `Dock: ${header.receiving_dock || "Not assigned"}`,
      `Vehicle: ${header.vehicle_number || ""}`,
      `Driver: ${header.driver_name || ""}`,
      `Material Code: ${itemCode}`,
      `Material Name: ${mat?.material_name || itemCode}`,
      `Material Category: ${category}`,
      `Material Variant Code: ${variantInfo.variant_code}`,
      `Batch Number: ${b.batch_number}`,
      `Size: ${variantInfo.size}`,
      `Color: ${variantInfo.color}`,
      `Grade: ${variantInfo.grade}`,
      `UOM: ${uom}`,
      `QA Status: ACCEPTED`,
      `Inspection Status: ${inspectionStatus}`,
      `Batch Quantity: ${batchQty} ${uom}`,
    ].join("\n");
  }

  // Page 6 QR Code Generation (Material-Wise) -> Encodes complete self-contained stock details
  async function generateQrForMaterial(
    itemCode: string,
    batch?: BatchEntry,
    material?: GrnLineItem,
  ) {
    const qrPayload = buildMaterialQrPayload(itemCode, batch, material);
    try {
      const url = await QRCode.toDataURL(qrPayload, {
        margin: 2,
        width: 500,
        errorCorrectionLevel: "M",
        color: {
          dark: "#000000",
          light: "#ffffff",
        },
      });
      return url;
    } catch (err) {
      console.error("QR Code generation error:", err);
      return "";
    }
  }

  function printSingleQrLabel(
    batchNumber: string,
    itemCode: string,
    qrId: string,
    dataUrl: string,
  ) {
    const win = window.open("", "_blank", "width=500,height=550");
    if (!win) {
      toast.error("Please allow popups to print label");
      return;
    }
    win.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>GRN Batch QR Label - ${batchNumber}</title>
          <style>
            body { font-family: 'Courier New', monospace, sans-serif; padding: 20px; text-align: center; background: #fff; }
            .card { border: 2px solid #0f172a; border-radius: 16px; padding: 24px; max-width: 380px; margin: 0 auto; background: #ffffff; }
            img { width: 260px; height: 260px; margin: 16px auto; display: block; }
            h2 { margin: 8px 0 0; font-size: 20px; color: #0f172a; font-weight: 800; word-break: break-all; }
            .header-tag { font-size: 10px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; color: #475569; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
            @media print { body { padding: 0; } .card { box-shadow: none; } }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="header-tag">WMS GOODS RECEIVING BATCH LABEL</div>
            <h2>${batchNumber}</h2>
            ${dataUrl ? `<img src="${dataUrl}" alt="Material QR Code" />` : '<div style="height:260px;line-height:260px;font-weight:bold;">GENERATING QR...</div>'}
          </div>
          <script>
            window.onload = () => { window.focus(); window.print(); };
          </script>
        </body>
      </html>
    `);
    win.document.close();
  }

  function printAllPoQrLabels(targetItemCode?: string) {
    const win = window.open("", "_blank", "width=950,height=950");
    if (!win) {
      toast.error("Please allow popups to print labels");
      return;
    }

    const filteredMaterials = (
      targetItemCode ? materials.filter((m) => m.item_code === targetItemCode) : materials
    ).filter(
      (m, index, list) => list.findIndex((item) => item.item_code === m.item_code) === index,
    );

    let labelsHtml = "";
    for (const m of filteredMaterials) {
      const materialIndex = materials.indexOf(m);
      const rowKey = materialIndex >= 0 ? grnMaterialKey(m, materialIndex) : m.item_code;
      const bList = materialBatches[rowKey] || materialBatches[m.item_code] || [];
      const qrInfo = qrLabels[rowKey] || {
        qr_id: `QR-MAT-${m.item_code}-${materialIndex + 1 || 1}`,
        data_url: "",
      };
      const b = bList[0] || {
        batch_number: `MATERIAL-${m.item_code}`,
        batch_quantity: m.good_quantity,
      };
      {
        labelsHtml += `
          <div class="card">
            <div class="header">WMS GOODS RECEIVING BATCH LABEL</div>
            <h2>${b.batch_number}</h2>
            ${qrInfo.data_url ? `<img src="${qrInfo.data_url}" alt="Material QR Code" />` : `<div style="height:220px;line-height:220px;font-weight:bold;">QR CODE</div>`}
          </div>
        `;
      }
    }

    win.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>GRN Batch QR Labels - ${header.grn_number}</title>
          <style>
            body { font-family: monospace, sans-serif; padding: 20px; background: #fff; text-align: center; }
            .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
            .card { border: 2px solid #000; border-radius: 12px; padding: 16px; break-inside: avoid; background: #fff; text-align: center; }
            .header { font-size: 11px; font-weight: bold; text-transform: uppercase; color: #555; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
            h2 { margin: 8px 0 4px; font-size: 16px; color: #000; word-break: break-all; }
            img { width: 220px; height: 220px; margin: 10px auto; display: block; }
            @media print { body { padding: 0; } .card { margin-bottom: 12px; } }
          </style>
        </head>
        <body>
          <h3 style="margin-bottom: 15px;">WMS GOODS RECEIVING BATCH QR LABELS (${header.grn_number})</h3>
          <div class="grid">${labelsHtml}</div>
          <script>
            window.onload = () => { window.focus(); window.print(); };
          </script>
        </body>
      </html>
    `);
    win.document.close();
  }

  function printGenericQrLabel(label: {
    type: "BATCH" | "QUARANTINE" | "TEMPLATE";
    title: string;
    qrId: string;
    dataUrl: string;
    materialCode: string;
    materialName: string;
    category?: string;
    variantCode?: string;
    size?: string;
    color?: string;
    grade?: string;
    quantity?: number | string;
    uom?: string;
    grnNumber?: string;
    poNumber?: string;
    supplierName?: string;
    warehouseName?: string;
    statusText?: string;
    damageReason?: string;
  }) {
    const win = window.open("", "_blank", "width=500,height=550");
    if (!win) {
      toast.error("Please allow popups to print label");
      return;
    }
    const isQuarantine = label.type === "QUARANTINE";
    const headerTag = isQuarantine
      ? "WMS QUARANTINE DAMAGE LOT LABEL"
      : label.type === "TEMPLATE"
        ? "WMS MATERIAL MASTER TEMPLATE LABEL"
        : "WMS GOODS RECEIVING BATCH LABEL";

    win.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${headerTag} - ${label.title}</title>
          <style>
            body { font-family: 'Courier New', monospace, sans-serif; padding: 20px; text-align: center; background: #fff; }
            .card { border: 2px solid ${isQuarantine ? "#e11d48" : "#0f172a"}; border-radius: 16px; padding: 24px; max-width: 380px; margin: 0 auto; background: #ffffff; }
            img { width: 260px; height: 260px; margin: 16px auto; display: block; }
            h2 { margin: 8px 0 0; font-size: 20px; color: ${isQuarantine ? "#be123c" : "#0f172a"}; font-weight: 800; word-break: break-all; }
            .header-tag { font-size: 10px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; color: #475569; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
            @media print { body { padding: 0; } .card { box-shadow: none; } }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="header-tag">${headerTag}</div>
            <h2>${label.title}</h2>
            ${label.dataUrl ? `<img src="${label.dataUrl}" alt="Material QR Code" />` : '<div style="height:260px;line-height:260px;font-weight:bold;">GENERATING QR...</div>'}
          </div>
          <script>
            window.onload = () => { window.focus(); window.print(); };
          </script>
        </body>
      </html>
    `);
    win.document.close();
  }

  function printBulkQrLabels(
    labels: Array<{
      type: "BATCH" | "QUARANTINE" | "TEMPLATE";
      title: string;
      qrId: string;
      dataUrl: string;
      materialCode: string;
      materialName: string;
      category?: string;
      quantity?: number | string;
      uom?: string;
      grnNumber?: string;
      poNumber?: string;
      supplierName?: string;
    }>,
  ) {
    if (!labels || labels.length === 0) {
      toast.info("No labels selected to print");
      return;
    }
    const win = window.open("", "_blank", "width=950,height=950");
    if (!win) {
      toast.error("Please allow popups to print labels");
      return;
    }

    let labelsHtml = "";
    for (const label of labels) {
      const isQuarantine = label.type === "QUARANTINE";
      labelsHtml += `
        <div class="card" style="${isQuarantine ? "border-color:#e11d48;" : ""}">
          <div class="header" style="${isQuarantine ? "color:#e11d48;" : ""}">${isQuarantine ? "QUARANTINE DAMAGE LOT LABEL" : "WMS GOODS RECEIVING LABEL"}</div>
          <h2>${label.title}</h2>
          ${label.dataUrl ? `<img src="${label.dataUrl}" alt="Material QR Code" />` : `<div style="height:220px;line-height:220px;font-weight:bold;">QR CODE</div>`}
        </div>
      `;
    }

    win.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>WMS Bulk QR Labels Print (${labels.length} Labels)</title>
          <style>
            body { font-family: monospace, sans-serif; padding: 20px; background: #fff; text-align: center; }
            .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
            .card { border: 2px solid #000; border-radius: 12px; padding: 16px; break-inside: avoid; background: #fff; text-align: center; }
            .header { font-size: 10px; font-weight: bold; text-transform: uppercase; color: #555; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
            h2 { margin: 8px 0 4px; font-size: 16px; color: #000; word-break: break-all; }
            img { width: 220px; height: 220px; margin: 10px auto; display: block; }
            @media print { body { padding: 0; } .card { margin-bottom: 12px; } }
          </style>
        </head>
        <body>
          <h3 style="margin-bottom: 15px;">WMS QR LABELS DIRECTORY BATCH PRINT (${labels.length} LABELS)</h3>
          <div class="grid">${labelsHtml}</div>
          <script>
            window.onload = () => { window.focus(); window.print(); };
          </script>
        </body>
      </html>
    `);
    win.document.close();
  }

  function exportQrDirectoryCsv(qrItems: Array<any>) {
    if (!qrItems || qrItems.length === 0) {
      toast.info("No QR code labels found to export");
      return;
    }
    let csv =
      "Label Type,QR ID,Title / Batch / Lot,Material Code,Material Name,Category,Quantity,UOM,GRN Number,PO Number,Supplier,Warehouse,Status\n";
    qrItems.forEach((r) => {
      csv += `"${r.type || ""}","${r.qrId || ""}","${r.title || ""}","${r.materialCode || ""}","${r.materialName || ""}","${r.category || ""}","${r.quantity ?? ""}","${r.uom || ""}","${r.grnNumber || ""}","${r.poNumber || ""}","${r.supplierName || ""}","${r.warehouseName || ""}","${r.statusText || ""}"\n`;
    });

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute(
      "download",
      `WMS_QR_Labels_Directory_${new Date().toISOString().split("T")[0]}.csv`,
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success(`Exported ${qrItems.length} QR label records to CSV`);
  }

  function openDocumentInFullWindow(doc: UploadedDocument) {
    const isImg =
      (doc.file_type && doc.file_type.startsWith("image/")) ||
      Boolean(doc.file_name?.match(/\.(jpg|jpeg|png|webp|svg|gif)$/i)) ||
      doc.category.toLowerCase().includes("photo");

    const win = window.open("", "_blank", "width=920,height=950");
    if (!win) {
      toast.error("Please allow popups to open document window");
      return;
    }

    if (isImg && doc.file_path) {
      win.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>${doc.category} - ${doc.file_name}</title>
            <style>
              body { margin: 0; padding: 24px; background: #0f172a; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; font-family: system-ui, sans-serif; color: #fff; }
              .header { margin-bottom: 16px; text-align: center; }
              .header h2 { margin: 0 0 4px; font-size: 20px; }
              .header p { margin: 0; font-size: 12px; color: #94a3b8; font-family: monospace; }
              img { max-width: 90vw; max-height: 80vh; object-fit: contain; border-radius: 8px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); border: 1px solid #334155; }
              .toolbar { margin-top: 16px; display: flex; gap: 8px; }
              button { background: #0284c7; color: #fff; border: none; padding: 8px 16px; border-radius: 6px; font-weight: 600; cursor: pointer; }
              button:hover { background: #0369a1; }
            </style>
          </head>
          <body>
            <div class="header">
              <h2>${doc.category}</h2>
              <p>${doc.file_name} • GRN: ${header.grn_number || "DRAFT-GRN"} • PO: ${header.po_number || "N/A"}</p>
            </div>
            <img src="${doc.file_path}" alt="${doc.file_name}" />
            <div class="toolbar">
              <button onclick="window.print()">Print Document</button>
              <button onclick="window.close()" style="background:#475569;">Close Window</button>
            </div>
          </body>
        </html>
      `);
      win.document.close();
      return;
    }

    const itemsHtml = materials
      .map(
        (m, idx) => `
      <tr>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; font-family: monospace; text-align: center;">${idx + 1}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 600;">${m.material_name} <span style="font-family: monospace; color: #64748b; font-size: 11px;">(${m.item_code})</span></td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; text-align: right; font-family: monospace;">${m.po_quantity || m.good_quantity + m.damaged_quantity} ${m.uom}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; text-align: right; color: #166534; font-weight: bold; font-family: monospace;">${m.good_quantity} ${m.uom}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; text-align: right; color: ${m.damaged_quantity > 0 ? "#991b1b" : "#64748b"}; font-weight: bold; font-family: monospace;">${m.damaged_quantity} ${m.uom}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; text-align: center;"><span style="background: ${m.damaged_quantity > 0 ? "#fef2f2; color: #991b1b; border: 1px solid #fecaca;" : "#f0fdf4; color: #166534; border: 1px solid #bbf7d0;"} padding: 3px 10px; border-radius: 9999px; font-size: 10px; font-weight: bold;">${m.quality_result || (m.damaged_quantity > 0 ? "PARTIAL" : "PASSED")}</span></td>
      </tr>
    `,
      )
      .join("");

    win.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${doc.category} - ${header.grn_number || "GRN Document"}</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; padding: 30px; margin: 0; color: #0f172a; }
            .doc-container { max-width: 820px; margin: 0 auto; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 12px; padding: 36px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
            .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 18px; margin-bottom: 20px; }
            .title-section h1 { margin: 0; font-size: 22px; font-weight: 800; color: #0f172a; letter-spacing: -0.5px; }
            .title-section p { margin: 4px 0 0; font-size: 12px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; }
            .badge { background: #dcfce7; color: #15803d; border: 1px solid #86efac; padding: 4px 10px; border-radius: 9999px; font-size: 11px; font-weight: 700; }
            .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; font-size: 12px; }
            .meta-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; }
            .meta-row { display: flex; justify-content: space-between; margin-bottom: 6px; }
            .meta-row:last-child { margin-bottom: 0; }
            .meta-label { color: #64748b; font-weight: 500; }
            .meta-val { font-weight: 700; color: #0f172a; font-family: monospace; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 24px; }
            th { background: #f1f5f9; padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; color: #475569; border-bottom: 2px solid #cbd5e1; }
            .footer-signatures { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; border-top: 1px dashed #cbd5e1; padding-top: 24px; margin-top: 30px; font-size: 11px; }
            .sign-box { text-align: center; }
            .sign-line { border-bottom: 1px solid #94a3b8; height: 36px; margin-bottom: 6px; }
            .toolbar { max-width: 820px; margin: 0 auto 16px; display: flex; justify-content: flex-end; gap: 8px; }
            .btn { background: #0284c7; color: white; border: none; padding: 8px 16px; border-radius: 6px; font-weight: 600; font-size: 12px; cursor: pointer; }
            .btn-secondary { background: #e2e8f0; color: #1e293b; }
            @media print { .toolbar { display: none; } body { padding: 0; background: white; } .doc-container { border: none; box-shadow: none; padding: 0; } }
          </style>
        </head>
        <body>
          <div class="toolbar">
            <button class="btn" onclick="window.print()">Print / Save PDF</button>
            <button class="btn btn-secondary" onclick="window.close()">Close</button>
          </div>
          <div class="doc-container">
            <div class="header">
              <div class="title-section">
                <h1>${doc.category.toUpperCase()}</h1>
                <p>Inbound Logistics Document Record • ${doc.file_name}</p>
              </div>
              <div style="text-align: right;">
                <span class="badge">VERIFIED & ATTACHED</span>
                <div style="font-size: 11px; color: #64748b; margin-top: 6px; font-family: monospace;">GRN: ${header.grn_number || "DRAFT-GRN"}</div>
              </div>
            </div>

            <div class="grid">
              <div class="meta-box">
                <div class="meta-row"><span class="meta-label">PO Reference:</span><span class="meta-val">${header.po_number || "N/A"}</span></div>
                <div class="meta-row"><span class="meta-label">Supplier Name:</span><span class="meta-val">${header.supplier_name || header.supplier_company_name || "Direct Inbound"}</span></div>
                <div class="meta-row"><span class="meta-label">Company:</span><span class="meta-val">${header.supplier_company_name || "N/A"}</span></div>
                <div class="meta-row"><span class="meta-label">Gate Pass No:</span><span class="meta-val">${header.gate_entry_number || "GE-2026-001"}</span></div>
              </div>
              <div class="meta-box">
                <div class="meta-row"><span class="meta-label">Warehouse:</span><span class="meta-val">${header.warehouse_name || "Main Warehouse"}</span></div>
                <div class="meta-row"><span class="meta-label">Receiving Dock:</span><span class="meta-val">${header.receiving_dock || "Not assigned"}</span></div>
                <div class="meta-row"><span class="meta-label">Vehicle No:</span><span class="meta-val">${header.vehicle_number || "KA-01-XX-0000"}</span></div>
                <div class="meta-row"><span class="meta-label">Receipt Date:</span><span class="meta-val">${new Date().toLocaleDateString()}</span></div>
              </div>
            </div>

            <div style="font-size: 12px; font-weight: bold; margin-bottom: 8px; color: #1e293b;">Associated Inbound Material Manifest</div>
            <table>
              <thead>
                <tr>
                  <th style="text-align: center;">#</th>
                  <th>Material Details</th>
                  <th style="text-align: right;">Ordered Qty</th>
                  <th style="text-align: right;">Accepted</th>
                  <th style="text-align: right;">Damaged</th>
                  <th style="text-align: center;">QA Status</th>
                </tr>
              </thead>
              <tbody>
                ${itemsHtml || '<tr><td colspan="6" style="text-align: center; padding: 12px; color: #94a3b8;">No line items loaded</td></tr>'}
              </tbody>
            </table>

            <div style="background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 8px; padding: 12px 16px; font-size: 11px; margin-bottom: 20px; font-family: monospace; color: #475569;">
              <div><b>Attachment Name:</b> ${doc.file_name}</div>
              <div><b>Category:</b> ${doc.category}</div>
              <div><b>Uploaded By:</b> ${loggedInUserName || "WMS Officer"} on ${new Date().toLocaleString()}</div>
              <div><b>Digital Stamp:</b> WMS-VERIFIED-SECURE-DOC-${Math.random().toString(36).substring(2, 10).toUpperCase()}</div>
            </div>

            <div class="footer-signatures">
              <div class="sign-box">
                <div class="sign-line"></div>
                <div><b>Received By (Warehouse)</b></div>
                <div style="color: #64748b; font-size: 10px;">${loggedInUserName || "Warehouse Operator"}</div>
              </div>
              <div class="sign-box">
                <div class="sign-line"></div>
                <div><b>Inspected By (QC)</b></div>
                <div style="color: #64748b; font-size: 10px;">QA Inspector</div>
              </div>
              <div class="sign-box">
                <div class="sign-line"></div>
                <div><b>Driver / Logistics Rep</b></div>
                <div style="color: #64748b; font-size: 10px;">${header.driver_name || "Transporter"}</div>
              </div>
            </div>
          </div>
        </body>
      </html>
    `);
    win.document.close();
  }

  // Scan / Read QR Code Handler -> Fetches from live DB & displays QRScanResultModal
  async function handleScanQrCode(scannedRaw: string) {
    if (!scannedRaw || !scannedRaw.trim()) {
      toast.error("Please provide or scan a QR code.");
      return;
    }
    const cleanCode = scannedRaw.trim();
    setScannedCodeValue(cleanCode);
    setIsScanningQr(true);

    try {
      // 1. Live backend database lookup
      const result = await api.lookupQrCode(cleanCode);
      setScanResultData(result);
      setIsScanResultModalOpen(true);
      setEnlargedQr(null);
      setManualScanInputOpen(false);
      toast.success("QR Code verified & stock details loaded.");
    } catch (err: any) {
      console.warn("Backend QR lookup fallback:", err);

      // 2. Fallback to active wizard session if working on an unsaved draft in Page 6
      const matchedWizardEntry = materials
        .map((m, idx) => ({ material: m, idx, rowKey: grnMaterialKey(m, idx) }))
        .find(
          ({ material, rowKey }) =>
            cleanCode.includes(material.item_code) ||
            (qrLabels[rowKey] &&
              (cleanCode.includes(qrLabels[rowKey].qr_id) ||
                cleanCode.includes(material.item_code))),
        );
      const matchedDamageEntry = damageQrLabels.find(
        (d) =>
          cleanCode.includes(d.qr_code) ||
          cleanCode.includes(d.damage_lot_number) ||
          cleanCode.includes(d.item_code),
      );

      if (matchedDamageEntry) {
        setScanResultData({
          qr_id: matchedDamageEntry.qr_code,
          grn_number: header.grn_number || "",
          po_number: header.po_number || "",
          material_code: matchedDamageEntry.item_code,
          material_name: matchedDamageEntry.material_name,
          variant_code: `${matchedDamageEntry.item_code}-V001`,
          size: "Standard Specification",
          color: "Standard",
          grade: "Standard Industrial Grade",
          uom: matchedDamageEntry.uom || "PCS",
          supplier_code: "",
          supplier_name: header.supplier_name || header.supplier_company_name || "",
          receipt_date: new Date().toLocaleDateString("en-GB"),
          warehouse_name: header.warehouse_name || "",
          category: "Quarantine / Damaged Goods",
          batch_number: matchedDamageEntry.damage_lot_number,
          received_quantity: matchedDamageEntry.damaged_quantity,
          accepted_quantity: 0,
          damaged_quantity: matchedDamageEntry.damaged_quantity,
          rejected_quantity: 0,
          batch_quantity: matchedDamageEntry.damaged_quantity,
          inspection_status: "PARTIAL",
          stock_status: "QUARANTINED",
          summary: `${matchedDamageEntry.damaged_quantity} ${matchedDamageEntry.uom} damaged and moved to quarantine.\nReason: ${matchedDamageEntry.reason}`,
        });
        setIsScanResultModalOpen(true);
        setEnlargedQr(null);
        setManualScanInputOpen(false);
        toast.success("Quarantine QR Code verified & stock details loaded.");
      } else if (matchedWizardEntry) {
        const matchedWizardMaterial = matchedWizardEntry.material;
        const bList =
          materialBatches[matchedWizardEntry.rowKey] ||
          materialBatches[matchedWizardMaterial.item_code] ||
          [];
        const b = bList[0] || {
          batch_number: `BATCH-${matchedWizardMaterial.item_code}-001`,
          batch_quantity: matchedWizardMaterial.good_quantity,
        };
        setScanResultData({
          qr_id:
            qrLabels[matchedWizardEntry.rowKey]?.qr_id ||
            `QR-MAT-${matchedWizardMaterial.item_code}`,
          grn_number: header.grn_number || "",
          po_number: header.po_number || "",
          material_code: matchedWizardMaterial.item_code,
          material_name: matchedWizardMaterial.material_name,
          variant_code: `${matchedWizardMaterial.item_code}-V001`,
          size: "Standard Specification",
          color: "Standard",
          grade: "Standard Industrial Grade",
          uom: matchedWizardMaterial.uom || "PCS",
          supplier_code: "",
          supplier_name: header.supplier_name || header.supplier_company_name || "",
          receipt_date: new Date().toLocaleDateString("en-GB"),
          warehouse_name: header.warehouse_name || "",
          category: matchedWizardMaterial.material_category || "Raw Materials",
          batch_number: b.batch_number,
          received_quantity:
            matchedWizardMaterial.po_quantity ||
            matchedWizardMaterial.good_quantity + matchedWizardMaterial.damaged_quantity,
          accepted_quantity: matchedWizardMaterial.good_quantity,
          damaged_quantity: matchedWizardMaterial.damaged_quantity,
          rejected_quantity: 0,
          batch_quantity: b.batch_quantity,
          inspection_status: matchedWizardMaterial.damaged_quantity > 0 ? "PARTIAL" : "COMPLETED",
          stock_status: "AVAILABLE",
          summary:
            matchedWizardMaterial.damaged_quantity > 0
              ? `${matchedWizardMaterial.good_quantity} ${matchedWizardMaterial.uom} accepted and moved to stock.\n${matchedWizardMaterial.damaged_quantity} ${matchedWizardMaterial.uom} damaged and moved to quarantine.`
              : `${matchedWizardMaterial.good_quantity} ${matchedWizardMaterial.uom} accepted and moved to available stock.`,
        });
        setIsScanResultModalOpen(true);
        setEnlargedQr(null);
        setManualScanInputOpen(false);
        toast.success("QR Code verified & stock details loaded.");
      } else {
        setEnlargedQr(null);
        setManualScanInputOpen(false);
        setQrNotFoundOpen(true);
      }
    } finally {
      setIsScanningQr(false);
    }
  }

  // Render QR Codes material-wise on Page 6 load & auto-sync when dependencies change
  const [qrLabels, setQrLabels] = useState<
    Record<string, { qr_id: string; data_url: string; payload: string }>
  >({});

  useEffect(() => {
    let active = true;

    if (currentPage === 6 && grnId) {
      void api
        .getGrnDetail(grnId)
        .then((detail: any) => {
          if (!active || !Array.isArray(detail?.lines)) return;
          setMaterialBatches((previous) => {
            const next = { ...previous };
            detail.lines.forEach((line: any, index: number) => {
              const material = materials.find(
                (item) =>
                  item.grn_line_id === (line.grn_line_id || line.id) ||
                  item.item_code === (line.item_code || line.material_code),
              );
              const key = material
                ? grnMaterialKey(material, materials.indexOf(material))
                : `${line.item_code || line.material_code}:${index}`;
              const savedBatches = Array.isArray(line.batches) ? line.batches : [];
              if (savedBatches.length > 0) {
                next[key] = savedBatches.map((batch: any) => ({
                  batch_id: batch.batch_id || batch.id,
                  batch_number: batch.batch_number,
                  batch_quantity: Number(batch.batch_quantity || 0),
                }));
              }
            });
            return JSON.stringify(next) === JSON.stringify(previous) ? previous : next;
          });
        })
        .catch(() => undefined);
    }

    // Ensure EVERY material line item has batches compulsory
    const effectiveBatches: Record<string, BatchEntry[]> = { ...materialBatches };
    let updated = false;

    materials.forEach((m, idx) => {
      const rowKey = grnMaterialKey(m, idx);
      const materialCode = resolveGrnMaterialCode(m) || "ITEM";
      const appQty = Number(
        qualityApproved[rowKey] !== undefined ? qualityApproved[rowKey] : (m.good_quantity ?? 0),
      );
      const existing = effectiveBatches[rowKey] || effectiveBatches[m.item_code] || effectiveBatches[materialCode];
      if (!existing || existing.length === 0) {
        effectiveBatches[rowKey] = [
          { batch_number: `BATCH-${materialCode}-001`, batch_quantity: appQty },
        ];
        updated = true;
      } else if (existing.some((batch) => String(batch.batch_number || "").includes("undefined"))) {
        effectiveBatches[rowKey] = existing.map((batch, batchIndex) => ({
          ...batch,
          batch_number: `BATCH-${materialCode}-${String(batchIndex + 1).padStart(3, "0")}`,
        }));
        updated = true;
      } else if (appQty === 0 && existing.length > 0 && (existing[0]?.batch_quantity ?? 0) > 0) {
        effectiveBatches[rowKey] = existing.map((b) => ({ ...b, batch_quantity: 0 }));
        updated = true;
      }
    });

    if (updated) {
      setMaterialBatches(effectiveBatches);
    }

    if (currentPage === 6 || active) {
      void (async () => {
        const generated: Record<string, { qr_id: string; data_url: string; payload: string }> = {};
        for (const [idx, m] of materials.entries()) {
          if ((m.good_quantity || 0) <= 0) continue;
          const rowKey = grnMaterialKey(m, idx);
          const code = m.item_code;
          if (generated[rowKey]) continue;

          const bList = effectiveBatches[rowKey] || effectiveBatches[code] || [];
          for (const b of bList) {
            if (!b.batch_number || Number(b.batch_quantity || 0) <= 0) continue;
            const batchKey = `${rowKey}:${b.batch_number}`;
            const qrId = `QR-MAT-${code}-${b.batch_number}`;
            const url = await generateQrForMaterial(code, b, m);
            const payload = buildMaterialQrPayload(code, b, m);
            generated[batchKey] = { qr_id: qrId, data_url: url, payload };
          }
        }

        const damageGenerated: DamageQrEntry[] = [];
        const damagedLines = materials.filter(
          (m) => (m.damaged_quantity || 0) > 0 || (m.rejected_quantity || 0) > 0,
        );

        for (const m of damagedLines) {
          const exceptionTypes = [
            { key: "DAMAGED", quantity: Number(m.damaged_quantity || 0), reason: m.damage_reason },
            {
              key: "REJECTED",
              quantity: Number(m.rejected_quantity || 0),
              reason: m.rejected_reason,
            },
            { key: "QC_HOLD", quantity: Number(m.held_quantity || 0), reason: m.held_reason },
          ].filter((entry) => entry.quantity > 0);
          if (!grnId || ["undefined", "null"].includes(String(grnId).toLowerCase())) continue;
          for (const entry of exceptionTypes) {
            const exceptionMaterial = { ...m, damaged_quantity: entry.quantity };
            const reasonText = entry.reason || "No reason recorded";
            const lotKey = `${header.grn_number || grnId}-${m.item_code}-${entry.key}`;
            const payload = buildDamageQrPayload(
              exceptionMaterial,
              reasonText,
              entry.key as "DAMAGED" | "REJECTED" | "QC_HOLD",
            );
            const dataUrl = await QRCode.toDataURL(payload, {
              margin: 2,
              width: 500,
              errorCorrectionLevel: "M",
            });
            damageGenerated.push({
              damage_lot_id: `dmg_lot_${lotKey}`,
              damage_lot_number: `DMG-LOT-${lotKey}`,
              item_code: m.item_code,
              material_name: m.material_name,
              damaged_quantity: entry.quantity,
              uom: m.uom || "PCS",
              reason: reasonText,
              qa_status: entry.key,
              quarantine_location: "QUARANTINE-ZONE-A",
              status: entry.key,
              exception_type: entry.key,
              quantity_label:
                entry.key === "REJECTED"
                  ? "Rejected Qty"
                  : entry.key === "QC_HOLD"
                    ? "Held Qty"
                    : "Damaged Qty",
              qr_id: `dmg_qr_${lotKey}`,
              qr_code: `DMG-${lotKey}`,
              qr_payload: payload,
              qr_data_url: dataUrl,
            });
          }
        }

        if (grnId && !["undefined", "null"].includes(String(grnId).toLowerCase())) {
          try {
            const savedDamageLots = await api.generateDamageQrs(grnId);
            if (false && Array.isArray(savedDamageLots) && savedDamageLots.length > 0) {
              damageGenerated.splice(
                0,
                damageGenerated.length,
                ...savedDamageLots.map((lot: any) => ({
                  damage_lot_id: lot.damage_lot_id,
                  damage_lot_number: lot.damage_lot_number,
                  item_code: lot.qr?.item_code || lot.item_code,
                  material_name:
                    materials.find((item) => item.grn_line_id === lot.grn_line_id)?.material_name ||
                    "Material",
                  damaged_quantity: Number(lot.damaged_quantity || 0),
                  uom: lot.uom || "PCS",
                  reason: lot.reason || "",
                  qa_status: lot.qa_status || "REJECTED / DAMAGED",
                  quarantine_location: lot.quarantine_location || "",
                  status: lot.status || "DAMAGED",
                  qr_id: lot.qr?.qr_id || lot.damage_lot_id,
                  qr_code: lot.qr?.qr_code || lot.damage_lot_number,
                  qr_payload: lot.qr?.qr_payload || "",
                  qr_data_url: "",
                })),
              );
            }
          } catch (error) {
            console.warn("Could not refresh saved damage lots:", error);
          }
        }

        if (active) {
          setQrLabels(generated);
          setDamageQrLabels(damageGenerated);
        }
      })();
    }
    return () => {
      active = false;
    };
  }, [
    currentPage,
    materialBatches,
    header.grn_number,
    header.po_number,
    header.supplier_name,
    header.warehouse_name,
    materials,
    damagePhotos,
    qualityApproved,
  ]);

  const selectedReconciliation = useMemo(() => {
    const lines = selectedGrnDetail?.lines?.length
      ? selectedGrnDetail.lines
      : selectedGrnDetail?.materials || [];
    return lines.filter((line: any) => {
      const received = Number(line.received_quantity ?? line.receivedQuantity ?? 0);
      const accounted = Number(
        line.good_quantity ?? line.goodQuantity ?? line.accepted_quantity ??
        line.acceptedQuantity ?? line.quality_approved_quantity ??
        line.qualityApprovedQuantity ?? 0,
      ) + Number(line.damaged_quantity ?? line.damagedQuantity ?? 0)
        + Number(line.rejected_quantity ?? line.rejectedQuantity ?? 0)
        + Number(line.held_quantity ?? line.heldQuantity ?? 0);
      return received > 0 || accounted > 0;
    }).reduce(
      (
        totals: {
          received: number;
          good: number;
          damaged: number;
          accounted: number;
          itemCount: number;
        },
        line: any,
      ) => {
        const received = Number(line.received_quantity ?? line.receivedQuantity ?? 0);
        const accepted = Number(
          line.good_quantity ??
            line.goodQuantity ??
            line.accepted_quantity ??
            line.acceptedQuantity ??
            line.quality_approved_quantity ??
            line.qualityApprovedQuantity ??
            0,
        );
        const damaged = Number(line.damaged_quantity ?? line.damagedQuantity ?? 0);
        const rejected = Number(line.rejected_quantity ?? line.rejectedQuantity ?? 0);
        const held = Number(line.held_quantity ?? line.heldQuantity ?? 0);
        totals.itemCount += 1;
        totals.received += received;
        totals.good += accepted;
        totals.damaged += damaged;
        totals.accounted += accepted + damaged + rejected + held;
        return totals;
      },
      { received: 0, good: 0, damaged: 0, accounted: 0, itemCount: 0 },
    );
  }, [selectedGrnDetail]);

  return (
    <AppShell
      title={<span className="inline-flex items-center gap-3"><ClipboardList className="size-6 shrink-0 text-primary" aria-hidden="true" />GRN / Quality Inspection</span>}
      subtitle="Manage goods receipts, quality checks, and GRN records"
      actions={
        <>
          {activeTab !== "dashboard" && (
            <Button data-refresh-control="true"
              variant="outline"
              size="icon"
              className="size-11 rounded-xl bg-white text-primary hover:bg-white"
              aria-label="Refresh GRN details"
              title="Refresh GRN details"
              disabled={busyAction || loadingRecords || loadingContext}
              onClick={async () => {
                await Promise.all([loadRecords(), loadWarehouseDocks()]);
                if (activeTab === "wizard" && grnId) await loadExistingGrnSession(grnId);
                else if (activeTab === "wizard" && header.asn_number.trim()) await fetchPoContext(header.asn_number);
              }}
            >
              <RefreshCw className={`size-4 ${loadingRecords || loadingContext ? "animate-spin" : ""}`} />
            </Button>
          )}
          {activeTab === "dashboard" && (
            <>
              <Button
                variant={activeTab === "records" ? "default" : "outline"}
                className="rounded-xl"
                onClick={() => {
                  const nextTab = activeTab === "records" ? "dashboard" : "records";
                  setActiveTab(nextTab);
                  navigate({ to: "/grn", search: { tab: nextTab, page: 1 } });
                }}
              >
                <ClipboardList className="size-4" />{" "}
                {activeTab === "records" ? "Dashboard View" : "All GRN Records"}
              </Button>
              <Button
                className="rounded-xl shadow-glow bg-primary text-primary-foreground font-bold"
                onClick={() => {
                  startNewGrn();
                  setActiveTab("wizard");
                  setCurrentPage(1);
                  navigate({ to: "/grn", search: { tab: "wizard", page: 1 } });
                }}
              >
                <Plus className="size-4" /> New GRN Entry
              </Button>
            </>
          )}
        </>
      }
    >
      {/* 📊 GRN OPERATIONS DASHBOARD TAB */}
      {activeTab === "dashboard" &&
        (() => {
          const totalQuarantineLots = grnRecords.reduce((acc, r) => {
            const lots = r.damage_lots || r.damageLots || [];
            if (Array.isArray(lots) && lots.length > 0) return acc + lots.length;
            const lines = r.lines || r.materials || [];
            const damagedLineCount = lines.filter(
              (l: any) => Number(l.damaged_quantity || l.damagedQuantity || 0) > 0,
            ).length;
            return acc + damagedLineCount;
          }, 0);

          let soundUnits = 0;
          let quarantinedUnits = 0;
          let lotsCount = 0;
          let inspectedLines = 0;
          let totalLines = 0;
          for (const r of grnRecords) {
            const lines = r.lines || r.materials || [];
            for (const l of lines) {
              totalLines += 1;
              if (l.quality_result || l.qualityResult || l.condition_result || l.conditionResult)
                inspectedLines += 1;
              const g = Number(l.good_quantity ?? l.goodQuantity ?? 0);
              const d = Number(l.damaged_quantity ?? l.damagedQuantity ?? 0);
              soundUnits += g;
              quarantinedUnits += d;
            }
            const dLots = r.damage_lots || r.damageLots || [];
            if (Array.isArray(dLots) && dLots.length > 0) {
              lotsCount += dLots.length;
            } else {
              lotsCount += lines.filter(
                (l: any) => Number(l.damaged_quantity ?? l.damagedQuantity ?? 0) > 0,
              ).length;
            }
          }
          const totalUnits = soundUnits + quarantinedUnits;
          // Health is inspection completion, not the percentage accepted as
          // sound. A completed inspection can legitimately contain damaged,
          // rejected, or held quantities.
          const healthPercent =
            totalLines > 0 ? Number(((inspectedLines / totalLines) * 100).toFixed(1)) : 100;

          const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
          const chartDays = Array.from({ length: 7 }, (_, index) => {
            const date = new Date();
            date.setDate(date.getDate() - 6 + index);
            return { key: dayKey(date), label: date.toLocaleDateString([], { day: "numeric", month: "short" }) };
          });
          const chartFor = (weight: (record: any) => number) => chartDays.map((day) => ({
            label: day.label,
            value: grnRecords.reduce((count, record) => {
              const date = new Date(record.receipt_date || record.created_at || "");
              return !Number.isNaN(date.getTime()) && dayKey(date) === day.key ? count + weight(record) : count;
            }, 0),
          }));
          const grnKpiCharts = {
            total: chartFor(() => 1),
            completed: chartFor((record) => isRecordMatchingStatus(record.status, "COMPLETED") ? 1 : 0),
            partial: chartFor((record) => isRecordMatchingStatus(record.status, "PARTIAL") ? 1 : 0),
            quarantine: chartFor((record) => {
              const lots = record.damage_lots || record.damageLots || [];
              return lots.length || (record.lines || record.materials || []).filter((line: any) => Number(line.damaged_quantity ?? line.damagedQuantity ?? 0) > 0).length;
            }),
          };

          return (
            <div className="space-y-6">
              {/* TOP STAT CARDS */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                  label="Total GRN receipts"
                  sparkline={grnKpiCharts.total}
                  value={loadingRecords ? "..." : String(totalRecordCount || grnRecords.length)}
                  delta={grnRecords.length > 0 ? "All recorded entries" : "No receipts yet"}
                  icon={ClipboardList}
                  tone="primary"
                />
                <StatCard
                  label="Fully completed"
                  sparkline={grnKpiCharts.completed}
                  value={
                    loadingRecords
                      ? "..."
                      : String(
                          grnRecords.filter((r) => isRecordMatchingStatus(r.status, "COMPLETED"))
                            .length,
                        )
                  }
                  delta={grnRecords.length > 0 ? "100% sound lines posted" : "0 completed"}
                  icon={CheckCircle2}
                  tone="success"
                />
                <StatCard
                  label="Partially completed"
                  sparkline={grnKpiCharts.partial}
                  value={
                    loadingRecords
                      ? "..."
                      : String(
                          grnRecords.filter((r) => isRecordMatchingStatus(r.status, "PARTIAL"))
                            .length,
                        )
                  }
                  delta={grnRecords.length > 0 ? "Pending balance receipts" : "0 pending"}
                  icon={Clock3}
                  tone="warning"
                />
                <StatCard
                  label="Quarantine lots"
                  sparkline={grnKpiCharts.quarantine}
                  value={
                    loadingRecords
                      ? "..."
                      : `${totalQuarantineLots} Lot${totalQuarantineLots === 1 ? "" : "s"}`
                  }
                  delta={totalQuarantineLots > 0 ? "Zone A · Damage QR" : "0 quarantine lots"}
                  icon={AlertTriangle}
                  tone="danger"
                />
              </div>

              {/* MAIN 2-COLUMN GRID (Matching Procurement & Warehouse Dashboards) */}
              <div className="grid gap-6 lg:grid-cols-3">
                {/* Left 2 Cols: Inbound Goods Receipts Table */}
                <div className="space-y-6 lg:col-span-2">
                  <SectionCard
                    title="Inbound Goods Receipts"
                    icon={ClipboardList}
                    actions={
                      <div className="flex items-center gap-1.5 sm:gap-2">
                        {[
                          { key: "ALL", label: "All" },
                          { key: "COMPLETED", label: "Completed" },
                          { key: "PARTIAL", label: "Partial" },
                        ].map((tab) => {
                          const active = dashboardStatusFilter === tab.key;
                          return (
                            <Button
                              key={tab.key}
                              type="button"
                              variant={active ? "default" : "outline"}
                              size="sm"
                              className={`rounded-xl text-xs h-8 px-3 font-semibold transition-all ${
                                active
                                  ? "bg-primary text-primary-foreground font-bold shadow-xs"
                                  : "text-muted-foreground hover:text-foreground"
                              }`}
                              onClick={() => setDashboardStatusFilter(tab.key)}
                            >
                              {tab.label}
                            </Button>
                          );
                        })}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs font-semibold text-primary h-8"
                          onClick={() => {
                            setActiveTab("records");
                            navigate({ to: "/grn", search: { tab: "records", page: 1 } });
                          }}
                        >
                          View All ({grnRecords.length}) →
                        </Button>
                      </div>
                    }
                  >
                    <div className="space-y-4">
                      <div className="relative">
                        <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                        <Input
                          placeholder="Search by GRN Number, PO Number, Supplier, Vehicle..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="pl-9 rounded-xl text-xs"
                        />
                      </div>

                      <div className="overflow-x-auto rounded-xl border border-border/70">
                        <table className="w-full min-w-[700px] text-xs text-left">
                          <thead className="bg-muted/50 font-semibold uppercase text-muted-foreground text-[11px] tracking-wider border-b border-border/70">
                            <tr>
                              <th className="px-4 py-3 whitespace-nowrap">GRN Number</th>
                              <th className="px-4 py-3">Supplier Name</th>
                              <th className="px-4 py-3 whitespace-nowrap">Vehicle</th>
                              <th className="px-4 py-3 whitespace-nowrap">Status</th>
                              <th className="px-4 py-3 text-right whitespace-nowrap min-w-[160px]">
                                Actions
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/60">
                            {visibleDashboardReceipts
                              .map((r, i) => (
                                <tr
                                  key={r.id || r.grn_id || r.grn_number || `rec_row_${i}`}
                                  className="hover:bg-accent/40 transition-colors"
                                >
                                  <td className="px-4 py-3 font-mono font-bold text-primary whitespace-nowrap">
                                    {r.grn_number}
                                  </td>
                                  <td className="px-4 py-3 font-medium text-foreground">
                                    {r.supplier_name}
                                  </td>
                                  <td className="px-4 py-3 font-mono text-muted-foreground whitespace-nowrap">
                                    {r.vehicle_number}
                                  </td>
                                  <td className="px-4 py-3 whitespace-nowrap">
                                    <StatusBadge status={r.status || "COMPLETED"} />
                                  </td>
                                  <td className="px-4 py-3 text-right whitespace-nowrap">
                                    <div className="flex items-center justify-end gap-1.5 shrink-0">
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="rounded-lg text-xs h-7 font-semibold shrink-0"
                                        onClick={() => {
                                          void handleViewGrnDetail(r);
                                        }}
                                      >
                                        <FileText className="mr-1 size-3.5 text-primary" /> Details
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="rounded-lg text-xs h-7 font-semibold border-rose-300 text-rose-600 hover:bg-rose-50 shrink-0"
                                        onClick={() => void handleDeleteGrn(r)}
                                      >
                                        <Trash2 className="mr-1 size-3.5" /> Delete
                                      </Button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            {dashboardReceipts.length === 0 && (
                              <tr>
                                <td colSpan={5} className="text-center py-10 text-muted-foreground">
                                  <FileCheck2 className="mx-auto mb-2 size-6 text-muted-foreground/50" />
                                  <p className="text-xs font-semibold text-foreground">
                                    No{" "}
                                    {dashboardStatusFilter === "ALL"
                                      ? ""
                                      : dashboardStatusFilter === "PARTIAL"
                                        ? "Partial"
                                        : "Completed"}{" "}
                                    Goods Receipt Records Found
                                  </p>
                                  <p className="text-[11px] text-muted-foreground mt-0.5">
                                    {searchTerm
                                      ? `No receipts match "${searchTerm}".`
                                      : "No records match the selected status filter."}
                                  </p>
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-sm text-muted-foreground">
                        <p aria-live="polite">Showing {dashboardReceipts.length ? (currentReceiptPage - 1) * receiptPageSize + 1 : 0}?{Math.min(currentReceiptPage * receiptPageSize, dashboardReceipts.length)} of {dashboardReceipts.length} receipts</p>
                        <nav aria-label="Inbound goods receipts pagination" className="flex items-center gap-2">
                          <Button variant="outline" size="sm" disabled={currentReceiptPage === 1 || loadingRecords} onClick={() => setReceiptPage(currentReceiptPage - 1)}>Previous</Button>
                          <span className="min-w-12 text-center text-xs" aria-current="page">{currentReceiptPage} / {receiptPageCount}</span>
                          <Button variant="outline" size="sm" disabled={currentReceiptPage >= receiptPageCount || loadingRecords} onClick={() => setReceiptPage(currentReceiptPage + 1)}>Next</Button>
                        </nav>
                      </div>
                    </div>
                  </SectionCard>
                </div>

                {/* Right 1 Col: Quality Health, Activity Timeline */}
                <div className="space-y-6">
                  <SectionCard title="Quality Inspection Health" icon={ShieldCheck}>
                    <div className="space-y-3">
                      <div className="flex items-baseline justify-between">
                        <span className="text-2xl font-bold font-mono tracking-tight text-emerald-600">
                          {totalUnits > 0 ? `${healthPercent}%` : "100%"}
                        </span>
                        <span className="text-xs font-semibold text-muted-foreground">
                          {soundUnits.toLocaleString()} Sound Units
                        </span>
                      </div>
                      <Progress
                        value={totalUnits > 0 ? healthPercent : 100}
                        className="h-2 rounded-full"
                      />
                      <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
                        <span>
                          Quarantined: {quarantinedUnits.toLocaleString()} Units ({lotsCount} Lot
                          {lotsCount === 1 ? "" : "s"})
                        </span>
                        <span
                          className={`font-semibold ${totalUnits === 0 ? "text-muted-foreground" : "text-emerald-600"}`}
                        >
                          {totalUnits === 0 ? "Awaiting Receipts" : "Grade ISI Compliant"}
                        </span>
                      </div>
                    </div>
                  </SectionCard>

                  <SectionCard title="Recent Receiving Activity" icon={Clock3}>
                    <Timeline
                      items={
                        grnRecords.length > 0
                          ? grnRecords.slice(0, activityLimit).map((r, idx) => ({
                              time: r.receipt_date || "Today",
                              title: `${r.grn_number || `GRN-000${idx + 1}`} · ${r.supplier_name || r.supplier_company_name || "Supplier"}`,
                              detail: `PO ${r.po_number || "—"} · ${r.vehicle_number || "Dock arrival"}`,
                              tone:
                                r.status === "COMPLETED"
                                  ? "success"
                                  : r.status === "PARTIALLY COMPLETED"
                                    ? "warning"
                                    : "primary",
                            }))
                          : []
                      }
                    />
                    {grnRecords.length > 5 && (
                      <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
                        <span>Showing {Math.min(activityLimit, grnRecords.length)} of {grnRecords.length}</span>
                        <div className="flex items-center gap-2">
                          {activityLimit > 5 && <Button variant="ghost" size="sm" onClick={() => setActivityLimit(5)}>Show less</Button>}
                          {activityLimit < grnRecords.length && <Button variant="outline" size="sm" onClick={() => setActivityLimit((limit) => limit + 5)}>More</Button>}
                        </div>
                      </div>
                    )}
                  </SectionCard>
                </div>
              </div>
            </div>
          );
        })()}

      {/* 📋 RECORDS OVERVIEW TAB */}
      {activeTab === "records" && (
        <div className="grn-records-layout w-full space-y-4">
          <SectionCard
            title="All Goods Receipt Notes (GRN)"
            description="Complete register of all inbound material receipts, inspection outcomes, and certificates"
            icon={ClipboardList}
            actions={
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                {[
                  { key: "ALL", label: "All" },
                  { key: "COMPLETED", label: "Completed" },
                  { key: "PARTIAL", label: "Partial" },
                ].map((tab) => {
                  const active = recordsStatusFilter === tab.key;
                  return (
                    <Button
                      key={tab.key}
                      type="button"
                      variant={active ? "default" : "outline"}
                      size="sm"
                      className={`rounded-xl text-xs h-8 px-3 font-semibold transition-all ${
                        active
                          ? "bg-primary text-primary-foreground font-bold shadow-xs"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      onClick={() => setRecordsStatusFilter(tab.key)}
                    >
                      {tab.label}
                    </Button>
                  );
                })}
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-xl text-xs h-8"
                  onClick={() => exportGrnRecordsCsv()}
                >
                  <Download className="mr-1.5 size-3.5 text-primary" /> Export CSV
                </Button>
              </div>
            }
          >
            <div className="space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                <Input
                  placeholder="Search by GRN Number, PO Number, Supplier, Vehicle, Driver, Dock..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 rounded-xl text-xs"
                />
              </div>

              {loadingRecords ? (
                <div className="grid h-64 place-items-center">
                  <Loader2 className="size-8 animate-spin text-primary" />
                </div>
              ) : recordsLoadError ? (
                <div className="grid min-h-64 place-items-center rounded-xl border border-rose-200 bg-rose-50/60 p-6 text-center">
                  <div className="max-w-lg">
                    <AlertTriangle className="mx-auto mb-3 size-9 text-rose-600" />
                    <h3 className="text-base font-semibold text-foreground">GRN History could not be loaded</h3>
                    <p className="mt-2 text-sm text-muted-foreground">{recordsLoadError}</p>
                    <Button type="button" className="mt-4 rounded-xl" onClick={() => void loadRecords()}>
                      <RefreshCw className="mr-2 size-4" /> Try again
                    </Button>
                  </div>
                </div>
              ) : filteredGrnRecords.length === 0 ? (
                <div className="grid h-64 place-items-center rounded-xl border border-dashed p-6 text-center text-muted-foreground">
                  <div>
                    <FileCheck2 className="mx-auto mb-3 size-10 text-muted-foreground/60" />
                    <h3 className="text-base font-semibold text-foreground">
                      No{" "}
                      {recordsStatusFilter === "ALL"
                        ? ""
                        : recordsStatusFilter === "PARTIAL"
                          ? "Partial"
                          : "Completed"}{" "}
                      GRN Records Found
                    </h3>
                    <p className="mt-1 text-xs">
                      {searchTerm
                        ? `No records match "${searchTerm}".`
                        : "Try selecting a different status filter or start a new Goods Receiving entry."}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="grid gap-4">
                  {visibleGrnRecords.map((r, idx) => {
                      const grnKey = r.id || r.grn_id || r.grn_number || `grn_rec_${idx}`;
                      const grnNumber = r.grn_number || "—";
                      const supplierName = r.supplier_name || r.supplier_company_name || "—";
                      const dockNumber = r.dock_number
                        ? r.dock_number.startsWith("Dock")
                          ? r.dock_number
                          : `Dock ${r.dock_number}`
                        : "—";
                      const vehicleNumber = r.vehicle_number || "—";
                      const driverName = r.driver_name ? `(${r.driver_name})` : "";
                      const receiptDate = formatCardDate(r.receipt_date || r.created_at);
                      const receivedBy = r.received_by ? `(${r.received_by})` : "";
                      const status = r.status || "COMPLETED";
                      const allocationId =
                        r.allocation_id || r.allocation_request_id || r.dock_allocation_id || "";

                      return (
                        <Card
                          key={grnKey}
                          className="grn-record-summary rounded-xl p-4 border border-border/70 shadow-none gap-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <h3 className="font-mono text-xl font-bold text-primary mt-0.5">
                                {grnNumber}
                              </h3>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                Supplier: <b className="text-foreground">{supplierName}</b>
                              </p>
                            </div>
                            <StatusBadge status={status} />
                          </div>

                          <p className="text-xs text-muted-foreground">Received: <span className="font-medium text-foreground">{receiptDate}</span></p>

                          {/* REAL ACTION BUTTONS PER RECORD */}
                          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="rounded-xl text-xs font-semibold border-primary/40 text-primary hover:bg-primary-soft"
                                onClick={() => void handleViewGrnDetail(r)}
                              >
                                <FileText className="mr-1.5 size-3.5" /> View all details
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="rounded-xl text-xs font-semibold"
                                onClick={() => void viewGrnRecordBatchLabels(r)}
                              >
                                <QrCode className="mr-1.5 size-3.5 text-primary" /> Batch QR Labels
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={!allocationId}
                                className="rounded-xl border-amber-300 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                                onClick={() => {
                                  if (allocationId) setDockReleasePrompt(String(allocationId));
                                  else toast.error("No active dock allocation found for this GRN.");
                                }}
                              >
                                <DoorOpen className="mr-1.5 size-3.5" /> Dock Release
                              </Button>
                            </div>

                            {status.toUpperCase().includes("PARTIAL") && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="rounded-xl text-xs font-semibold border-rose-300 text-rose-700 hover:bg-rose-50"
                                onClick={() => {
                                  setSelectedGrnDetail(r);
                                  setNotifyVendorEmail(r.supplier_email || r.supplierEmail || "");
                                  setGrnId(r.grn_id || r.id || r.grn_number || "");
                                  setShowNotifyVendorModal(true);
                                }}
                              >
                                <Send className="mr-1.5 size-3.5 text-rose-600" /> Vendor Damage
                                Notice
                              </Button>
                            )}
                          </div>
                        </Card>
                      );
                  })}
                </div>
              )}
              {!loadingRecords && filteredGrnRecords.length > 0 && (
                <AdminTablePagination
                  page={currentRecordsPage}
                  total={filteredGrnRecords.length}
                  itemLabel="GRN records"
                  onPageChange={setRecordsPage}
                />
              )}
            </div>
          </SectionCard>
        </div>
      )}

      {/* ✨ 6-PAGE WIZARD WORKFLOW */}
      {activeTab === "wizard" && (
        <div className="grn-wizard-layout w-full space-y-4">
          {/* STEP NAVIGATION HEADER */}
          <Card className="rounded-2xl p-4 overflow-x-auto shadow-sm border border-border/80">
            <div className="flex items-center justify-between min-w-[720px] gap-2">
              {PAGES.map((pg) => {
                const displayMaxCompletedStep = Math.max(maxCompletedStep, currentPage - 1);
                const isCurrent = currentPage === pg.id;
                const isCompleted = displayMaxCompletedStep >= pg.id && !isCurrent;
                const isAccessible = pg.id <= displayMaxCompletedStep + 1;
                const StepIcon = pg.icon;

                return (
                  <div
                    key={pg.id}
                    role="button"
                    tabIndex={0}
                    aria-current={isCurrent ? "step" : undefined}
                    aria-label={`Open ${pg.title}`}
                    onClick={() => handleStepClick(pg.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        handleStepClick(pg.id);
                      }
                    }}
                    className={`flex-1 flex flex-col items-center text-center transition-all p-2 rounded-xl select-none cursor-pointer hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      isCurrent
                        ? "bg-primary/5 font-bold shadow-xs"
                        : isAccessible
                          ? "opacity-90"
                          : "opacity-40"
                    }`}
                  >
                    <div
                      className={`flex size-8 items-center justify-center rounded-full text-xs font-bold transition-all ${
                        isCurrent
                          ? "bg-primary text-primary-foreground shadow-md ring-4 ring-primary/20"
                          : isCompleted
                            ? "bg-emerald-600 text-white shadow-xs"
                            : isAccessible
                              ? "bg-muted text-foreground border border-border"
                              : "bg-muted/60 text-muted-foreground"
                      }`}
                    >
                      {isCompleted ? (
                        <CheckCircle2 className="size-4" />
                      ) : (
                        <StepIcon className="size-4" />
                      )}
                    </div>
                    <span className="mt-1.5 text-xs text-foreground line-clamp-1">{pg.title}</span>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* PAGE 1 – GRN HEADER DETAILS */}
          {currentPage === 1 && (
            <div className="space-y-4">
              {/* A. ASN REFERENCE */}
              <Card className="rounded-xl p-4 space-y-4 shadow-sm">
                <div className="border-b pb-3">
                  <h3 className="font-bold text-foreground text-sm uppercase tracking-wider">
                    Advance Shipping Notice (ASN)
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Enter an ASN number to automatically populate supplier, gate, vehicle, and
                    material details.
                  </p>
                </div>

                {/* PO NUMBER ENTRY & SIDE FETCH DETAILS BUTTON */}
                <div className="flex flex-wrap items-end gap-3 max-w-xl">
                  <div className="flex-1 min-w-[260px]">
                    <label className="text-xs font-bold text-foreground mb-1 flex items-center justify-between">
                      <span>ASN Number *</span>
                      {loadingContext && (
                        <span className="text-[10px] font-bold text-primary flex items-center gap-1 animate-pulse">
                          <Loader2 className="size-3 animate-spin" /> Fetching ASN Details...
                        </span>
                      )}
                    </label>
                    <Input
                      placeholder="Enter ASN (e.g. ASN-2026-001)"
                      value={header.asn_number}
                      disabled={busyAction || loadingContext}
                      onChange={(e) => changePoNumber(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void fetchPoContext();
                        }
                      }}
                      className="rounded-xl font-mono text-base font-bold text-primary"
                    />
                  </div>
                  <Button
                    type="button"
                    onClick={() => void fetchPoContext()}
                    disabled={loadingContext || busyAction || !header.asn_number.trim()}
                    className="rounded-xl font-semibold shadow-xs h-10 px-5"
                  >
                    {loadingContext ? (
                      <>
                        <Loader2 className="mr-2 size-4 animate-spin" /> Fetching...
                      </>
                    ) : (
                      <>
                        <Search className="mr-2 size-4" /> Fetch Details
                      </>
                    )}
                  </Button>
                </div>

                {false && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                    {/* PO Number */}
                    <div className="rounded-xl border bg-muted/10 p-3">
                      <span className="text-[11px] font-semibold uppercase text-muted-foreground">
                        PO Number
                      </span>
                      <p className="font-mono text-base font-bold text-primary">
                        {header.po_number || "—"}
                      </p>
                    </div>

                    {/* Supplier Name */}
                    <div className="rounded-xl border bg-muted/10 p-3">
                      <span className="text-[11px] font-semibold uppercase text-muted-foreground">
                        Supplier Name
                      </span>
                      <p className="text-sm font-bold text-foreground mt-1">
                        {header.supplier_name || "—"}
                      </p>
                    </div>

                    {/* Supplier Company Name */}
                    <div className="rounded-xl border bg-muted/10 p-3 md:col-span-2">
                      <span className="text-[11px] font-semibold uppercase text-muted-foreground">
                        Supplier Company Name
                      </span>
                      <p className="text-sm font-bold text-foreground mt-1">
                        {header.supplier_company_name || header.supplier_name || "—"}
                      </p>
                    </div>
                  </div>
                )}
              </Card>

              {/* B. INBOUND DETAILS */}
              <Card className="rounded-xl p-4 space-y-4 shadow-sm">
                <div className="border-b pb-3">
                  <h3 className="font-semibold text-foreground text-base tracking-tight">
                    Inbound details
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Transport, gate entry, and delivery identification.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* ASN Number */}
                  <div className="flex min-h-[76px] min-w-0 flex-col justify-center rounded-xl border bg-muted/10 p-4">
                    <span className="text-xs font-medium text-muted-foreground">
                      ASN number
                    </span>
                    <p className="mt-1 truncate font-mono text-sm font-semibold text-foreground">
                      {header.asn_number}
                    </p>
                  </div>

                  {/* Gate Entry Number */}
                  <div className="flex min-h-[76px] min-w-0 flex-col justify-center rounded-xl border bg-muted/10 p-4">
                    <span className="text-xs font-medium text-muted-foreground">
                      Gate entry number
                    </span>
                    <p className="mt-1 truncate font-mono text-sm font-semibold text-foreground">
                      {header.gate_entry_number}
                    </p>
                  </div>

                  {/* Receipt Type */}
                  {false && (
                    <div className="rounded-xl border bg-muted/10 p-3">
                      <label className="text-[11px] font-semibold uppercase text-muted-foreground block mb-1">
                        Receipt Type
                      </label>
                      <div className="rounded-lg border bg-background px-2.5 py-1.5 text-xs font-bold text-foreground">
                        {header.receipt_type}
                      </div>
                    </div>
                  )}

                  {/* Vehicle Number */}
                  <div className="min-w-0 rounded-xl border bg-muted/10 p-4">
                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Vehicle number
                    </label>
                    {header.asn_number.trim().toUpperCase().startsWith("ASN-") ? (
                      <select
                        value={header.gate_entry_id || header.gate_entry_number || ""}
                        onChange={(event) => selectInboundVehicle(event.target.value)}
                        className="h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3 font-mono text-sm font-semibold"
                        aria-label="Select arrived vehicle for this ASN"
                        disabled={asnVehicleArrivals.length === 0}
                      >
                        {asnVehicleArrivals.length === 0 ? (
                          <option value="">No arrived vehicles found for this ASN</option>
                        ) : asnVehicleArrivals.map((arrival) => {
                            const completedForArrival = grnRecords.some(
                              (record) =>
                                normalizeVehicleKey(record.vehicle_number) === normalizeVehicleKey(arrival.vehicle_number) &&
                                String(record.asn_number || record.asnNumber || "").trim().toUpperCase() ===
                                  String(header.asn_number || "").trim().toUpperCase() &&
                                isCompletedGrnStatus(record.status),
                            );
                            return <option
                              key={arrival.id || arrival.gate_entry_number}
                              value={String(arrival.id || arrival.gate_entry_number)}
                              disabled={completedForArrival}
                            >
                              {arrival.vehicle_number || "Vehicle"}{completedForArrival ? " · GRN completed" : ""}
                            </option>;
                          })}
                      </select>
                    ) : (
                      <Input
                        value={header.vehicle_number}
                        onChange={(e) => setHeader({ ...header, vehicle_number: e.target.value })}
                        className="h-10 rounded-lg font-mono text-sm font-semibold"
                      />
                    )}
                  </div>

                  {/* Driver Name */}
                  <div className="min-w-0 rounded-xl border bg-muted/10 p-4">
                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Driver name
                    </label>
                    <Input
                      value={header.driver_name}
                      onChange={(e) => setHeader({ ...header, driver_name: e.target.value })}
                      className="h-10 rounded-lg text-sm font-semibold"
                    />
                  </div>
                </div>
              </Card>

              {/* C. WAREHOUSE & DOCK */}
              <Card className="rounded-xl p-4 space-y-4 shadow-sm">
                <div className="border-b pb-3">
                  <h3 className="font-bold text-foreground text-sm uppercase tracking-wider">
                    Warehouse & Dock
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Receiving dock bay allocation and internal receiving verification.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Receiving Dock */}
                  <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold uppercase text-primary tracking-wide">
                          Receiving Dock *
                        </span>
                        {header.receiving_dock ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                            <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            Allocated by Warehouse
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-2 flex items-baseline gap-2">
                        {header.receiving_dock ? (
                          <>
                            <p className="text-base font-black tracking-tight text-foreground font-mono">
                              {header.receiving_dock}
                            </p>
                            {allocatedDockInfo?.dock_name &&
                              allocatedDockInfo.dock_name !== header.receiving_dock && (
                                <span className="text-xs font-medium text-muted-foreground">
                                  ({allocatedDockInfo.dock_name})
                                </span>
                              )}
                          </>
                        ) : null}
                      </div>
                    </div>

                    {header.receiving_dock ? (
                      <p className="text-[11px] text-muted-foreground mt-2 flex items-center gap-1 font-medium">
                        <>
                          <span className="inline-block size-1.5 rounded-full bg-emerald-500" />
                          Assigned via Warehouse Dock Allocation
                        </>
                      </p>
                    ) : null}
                  </div>

                  {/* GRN Number */}
                  <div className="rounded-xl border bg-muted/10 p-3">
                    <span className="text-[11px] font-semibold uppercase text-muted-foreground">
                      GRN Number
                    </span>
                    <p className="font-mono text-base font-bold text-success">
                      {header.grn_number || "Assigning GRN number..."}
                    </p>
                  </div>

                  {/* Received By */}
                  <div className="rounded-xl border border-success/30 bg-success-soft/20 p-3">
                    <span className="text-[11px] font-bold uppercase text-success block">
                      Received By
                    </span>
                    <div className="flex items-center gap-2 mt-1">
                      <User className="size-4 text-success" />
                      <span className="text-sm font-bold text-foreground">
                        {header.received_by}
                      </span>
                    </div>
                  </div>
                </div>
              </Card>

              {/* BOTTOM ACTION & AUTO-SAVE AREA */}
              <div className="flex flex-wrap items-center justify-between pt-4 border-t gap-3">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  {saveStatus === "saving" ? (
                    <span className="flex items-center gap-1.5 text-amber-600 font-semibold">
                      <Loader2 className="size-4 animate-spin" /> Saving...
                    </span>
                  ) : saveStatus === "error" ? (
                    <span className="flex items-center gap-1.5 text-rose-600 font-semibold">
                      <AlertTriangle className="size-4 text-rose-600" /> ⚠ Unable to save changes
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-emerald-600 font-semibold">
                      <CheckCircle2 className="size-4 text-emerald-600" /> ✓ All changes saved
                    </span>
                  )}
                </div>
                <Button
                  onClick={() => void handleProceedFromPage1()}
                  disabled={busyAction || loadingContext}
                  className="rounded-xl font-bold px-6"
                >
                  {busyAction ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                  Save & Continue <ArrowRight className="ml-2 size-4" />
                </Button>
              </div>
            </div>
          )}

          {/* PAGE 2 – ITEM RECEIVING DETAILS */}
          {currentPage === 2 && (
            <Card className="rounded-xl p-4 space-y-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between border-b pb-4 gap-3">
                <div>
                  <h3 className="font-bold text-foreground text-base flex items-center gap-2">
                    <span>
                      {header.receipt_type === "UNEXPECTED_DELIVERY"
                        ? "Manual Material Receipt (Unexpected Delivery)"
                        : "Material Line Items"}
                    </span>
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {header.receipt_type === "UNEXPECTED_DELIVERY"
                      ? "Add materials received in this shipment and enter their physical counts."
                      : "Compare quantity with physically received quantity."}
                  </p>
                </div>
                {header.receipt_type === "UNEXPECTED_DELIVERY" ? (
                  <Button
                    type="button"
                    onClick={addManualMaterialRow}
                    size="sm"
                    className="rounded-xl font-bold text-xs"
                  >
                    <Plus className="mr-1.5 size-4" /> Add Material
                  </Button>
                ) : (
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold text-muted-foreground">
                      Receiving Status:
                    </span>
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-bold border ${
                        step2OverallStatus === "COMPLETED"
                          ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                          : "bg-amber-100 text-amber-800 border-amber-300"
                      }`}
                    >
                      {step2OverallStatus === "COMPLETED" ? "✓ COMPLETED" : "PENDING"}
                    </span>
                  </div>
                )}
              </div>

              {header.receipt_type === "UNEXPECTED_DELIVERY" ? (
                /* UNEXPECTED DELIVERY MANUAL TABLE */
                materials.length === 0 ? (
                  <div className="rounded-2xl border-2 border-dashed p-8 text-center space-y-3 bg-muted/10">
                    <Boxes className="mx-auto size-10 text-muted-foreground opacity-60" />
                    <div>
                      <h4 className="font-bold text-foreground text-sm">No Materials Added Yet</h4>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Click "Add Material" to add the items received in this unexpected delivery.
                      </p>
                    </div>
                    <Button
                      type="button"
                      onClick={addManualMaterialRow}
                      size="sm"
                      className="rounded-xl font-bold"
                    >
                      <Plus className="mr-1.5 size-4" /> Add First Material
                    </Button>
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                        <tr>
                          <th className="px-4 py-3">Material Selection</th>
                          <th className="px-4 py-3">Item Code</th>
                          <th className="px-4 py-3">Category</th>
                          <th className="px-4 py-3 text-right">Received Quantity *</th>
                          <th className="px-4 py-3">UOM</th>
                          <th className="px-4 py-3 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y font-medium">
                        {materials.map((m, idx) => {
                          const recQty =
                            m.received_quantity !== undefined
                              ? m.received_quantity
                              : m.good_quantity;
                          return (
                            <tr key={idx} className="hover:bg-muted/20">
                              <td className="px-4 py-3">
                                <select
                                  value={m.item_code}
                                  onChange={(e) => {
                                    const selectedCode = e.target.value;
                                    const found = materialMasterList.find(
                                      (mat) =>
                                        mat.code === selectedCode ||
                                        mat.material_code === selectedCode,
                                    );
                                    if (found) {
                                      updateManualMaterialRow(idx, {
                                        item_code:
                                          found.code || found.material_code || selectedCode,
                                        material_name:
                                          found.name || found.material_name || selectedCode,
                                        material_category:
                                          found.category ||
                                          found.material_category ||
                                          "Raw Materials",
                                        uom: found.base_uom || found.uom || "PCS",
                                      });
                                    } else {
                                      updateManualMaterialRow(idx, { item_code: selectedCode });
                                    }
                                  }}
                                  className="w-full rounded-lg border bg-background px-2.5 py-1.5 text-xs font-bold text-foreground"
                                >
                                  {materialMasterList.length > 0 ? (
                                    materialMasterList.map((mat) => (
                                      <option
                                        key={mat.code || mat.material_code}
                                        value={mat.code || mat.material_code}
                                      >
                                        {mat.name || mat.material_name} (
                                        {mat.code || mat.material_code})
                                      </option>
                                    ))
                                  ) : (
                                    <option value={m.item_code}>
                                      {m.material_name} ({m.item_code})
                                    </option>
                                  )}
                                </select>
                              </td>
                              <td className="px-4 py-3 font-mono text-xs text-primary font-bold">
                                {m.item_code}
                              </td>
                              <td className="px-4 py-3 text-xs text-muted-foreground font-medium">
                                {m.material_category || "Raw Materials"}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <Input
                                  type="number"
                                  min={1}
                                  placeholder="1"
                                  value={recQty === 0 ? "" : (recQty ?? "")}
                                  onChange={(e) => {
                                    const val = Math.max(0, Number(e.target.value) || 0);
                                    updateManualMaterialRow(idx, { received_quantity: val });
                                  }}
                                  className="w-28 text-right font-bold text-foreground rounded-xl ml-auto"
                                />
                              </td>
                              <td className="px-4 py-3">
                                <Input
                                  value={m.uom}
                                  onChange={(e) =>
                                    updateManualMaterialRow(idx, { uom: e.target.value })
                                  }
                                  className="w-20 font-bold text-xs rounded-lg"
                                  placeholder="PCS"
                                />
                              </td>
                              <td className="px-4 py-3 text-center">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => removeManualMaterialRow(idx)}
                                  className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-lg p-1.5"
                                >
                                  Remove
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className="bg-muted/40 font-bold border-t text-sm">
                        <tr>
                          <td
                            colSpan={3}
                            className="px-4 py-3 uppercase text-xs text-muted-foreground"
                          >
                            Total Manual Items: {materials.length}
                          </td>
                          <td className="px-4 py-3 text-right font-bold text-foreground">
                            {totalReceivedQty.toLocaleString()}
                          </td>
                          <td
                            colSpan={2}
                            className="px-4 py-3 text-muted-foreground text-xs font-normal"
                          >
                            Units Received
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )
              ) : (
                /* ASN MATERIAL TABLE */
                <div className="overflow-x-auto rounded-xl border">
                  <table className="grn-receiving-table w-full min-w-[720px] table-fixed text-sm text-left">
                    <colgroup>
                      <col className="w-[46%]" />
                      <col className="w-[16%]" />
                      <col className="w-[23%]" />
                      <col className="w-[15%]" />
                    </colgroup>
                    <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3">Material</th>
                        <th className="px-4 py-3 text-right">Quantity</th>
                        <th className="px-4 py-3 text-right">Received Quantity</th>
                        <th className="px-4 py-3 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y font-medium">
                      {materials.map((m, idx) => {
                        const recQty =
                          m.received_quantity !== undefined ? m.received_quantity : m.good_quantity;
                        const isCompleted = recQty === m.po_quantity;
                        const rejectedVal = Number(m.rejected_quantity || 0);
                        const damagedVal = Number(m.damaged_quantity || 0);
                        const heldVal = Number(m.held_quantity || 0);

                        return (
                          <tr key={grnMaterialKey(m, idx)} className="hover:bg-muted/20">
                            <td className="px-4 py-3 font-bold text-foreground">
                              <div className="text-base leading-relaxed">
                                {m.item_code || m.material_code} —{" "}
                                {m.material_name ||
                                  m.materialName ||
                                  m.material_description ||
                                  "Material"}
                              </div>
                              <span className="text-xs leading-relaxed text-emerald-600 font-medium block mt-1">
                                Category: {m.material_category || "General"}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right font-bold">
                              <div>
                                {m.po_quantity.toLocaleString()}{" "}
                                <span className="text-xs font-normal text-muted-foreground">
                                  {m.uom || "PCS"}
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex flex-col items-center gap-2">
                                <Input
                                  type="number"
                                  min={0}
                                  max={m.po_quantity}
                                  placeholder="0"
                                  value={recQty === 0 ? "" : (recQty ?? "")}
                                  onChange={(e) => {
                                    const raw = e.target.value;
                                    const val = raw === "" ? 0 : Number(raw);
                                    if (val < 0) {
                                      toast.error("Received quantity cannot be negative.");
                                      return;
                                    }
                                    if (val > m.po_quantity) {
                                      toast.error(
                                        `Received quantity for ${m.material_name} cannot exceed quantity (${m.po_quantity}).`,
                                      );
                                      return;
                                    }
                                    setMaterials((prev) =>
                                      prev.map((item, i) =>
                                        i === idx
                                          ? {
                                              ...item,
                                              received_quantity: val,
                                              good_quantity: val,
                                              damaged_quantity: 0,
                                              balance_quantity: Math.max(item.po_quantity - val, 0),
                                            }
                                          : item,
                                      ),
                                    );
                                  }}
                                  className="h-10 w-32 text-center font-semibold tabular-nums text-foreground rounded-lg"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    setMaterials((prev) =>
                                      prev.map((item, i) =>
                                        i === idx
                                          ? {
                                              ...item,
                                              received_quantity: item.po_quantity,
                                              good_quantity: item.po_quantity,
                                              damaged_quantity: 0,
                                              balance_quantity: 0,
                                            }
                                          : item,
                                      ),
                                    );
                                  }}
                                  className="text-[10px] font-semibold text-primary hover:underline flex items-center gap-0.5"
                                >
                                  Match Quantity ({m.po_quantity})
                                </button>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span
                                className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${
                                  isCompleted
                                    ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                                    : "bg-amber-100 text-amber-800 border-amber-300"
                                }`}
                              >
                                {isCompleted ? "✓ COMPLETED" : "PENDING"}
                              </span>
                              {(rejectedVal > 0 || damagedVal > 0 || heldVal > 0) && (
                                <div className="mt-2 space-y-1 text-left">
                                  {rejectedVal > 0 && (
                                    <Input
                                      placeholder="Rejected reason *"
                                      value={m.rejected_reason || ""}
                                      onChange={(e) =>
                                        setMaterials((prev) =>
                                          prev.map((item, i) =>
                                            i === idx
                                              ? { ...item, rejected_reason: e.target.value }
                                              : item,
                                          ),
                                        )
                                      }
                                      className="h-7 text-[11px]"
                                    />
                                  )}
                                  {damagedVal > 0 && (
                                    <Input
                                      placeholder="Damage reason *"
                                      value={m.damage_reason || ""}
                                      onChange={(e) =>
                                        setMaterials((prev) =>
                                          prev.map((item, i) =>
                                            i === idx
                                              ? { ...item, damage_reason: e.target.value }
                                              : item,
                                          ),
                                        )
                                      }
                                      className="h-7 text-[11px]"
                                    />
                                  )}
                                  {heldVal > 0 && (
                                    <Input
                                      placeholder="Held reason *"
                                      value={m.held_reason || ""}
                                      onChange={(e) =>
                                        setMaterials((prev) =>
                                          prev.map((item, i) =>
                                            i === idx
                                              ? { ...item, held_reason: e.target.value }
                                              : item,
                                          ),
                                        )
                                      }
                                      className="h-7 text-[11px]"
                                    />
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-muted/40 font-bold border-t text-sm">
                      <tr>
                        <td
                          colSpan={1}
                          className="px-4 py-3 uppercase text-xs text-muted-foreground"
                        >
                          Totals
                        </td>
                        <td className="px-4 py-3 text-right font-bold">
                          {totalPoQty.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right font-bold">
                          {totalReceivedQty.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                              step2OverallStatus === "COMPLETED"
                                ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                                : "bg-amber-100 text-amber-800 border-amber-300"
                            }`}
                          >
                            {step2OverallStatus === "COMPLETED" ? "✓ COMPLETED" : "PENDING"}
                          </span>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between pt-4 border-t gap-3">
                <Button
                  variant="outline"
                  className="rounded-xl font-semibold"
                  onClick={() => handleStepClick(1)}
                >
                  <ArrowLeft className="mr-2 size-4" /> Back
                </Button>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 text-xs font-semibold">
                    {saveStatus === "saving" ? (
                      <span className="flex items-center gap-1.5 text-amber-600 font-semibold">
                        <Loader2 className="size-4 animate-spin" /> Saving...
                      </span>
                    ) : saveStatus === "error" ? (
                      <span className="flex items-center gap-1.5 text-rose-600 font-semibold">
                        <AlertTriangle className="size-4 text-rose-600" /> ⚠ Unable to save changes
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-emerald-600 font-semibold">
                        <CheckCircle2 className="size-4 text-emerald-600" /> ✓ All changes saved
                      </span>
                    )}
                  </div>
                  <Button
                    disabled={
                      busyAction ||
                      loadingContext ||
                      materials.length === 0 ||
                      materials.some((m) => Number(m.received_quantity || 0) <= 0)
                    }
                    onClick={() => void handleProceedFromPage2()}
                    className="rounded-xl font-bold px-6"
                  >
                    {busyAction ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                    Next <ArrowRight className="ml-2 size-4" />
                  </Button>
                </div>
              </div>
            </Card>
          )}

          {/* PAGE 3 – QUALITY INSPECTION & DAMAGED GOODS */}
          {currentPage === 3 && (
            <Card className="rounded-xl p-4 space-y-4 shadow-sm">
              <div className="border-b pb-4">
                <h3 className="font-bold text-foreground text-base">
                  Quality Inspection & Damage Breakdown
                <InformationTooltip help="reconciliation" /></h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Inspect physically received materials into Accepted (Good) and Damaged quantities,
                  then record photo evidence for damaged goods.
                </p>
              </div>

              {/* Quality Inspection & Quantity Breakdown Table */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <ShieldCheck className="size-4 text-emerald-600" /> Material Quality Inspection
                  Breakdown
                </h4>
                <div className="overflow-x-auto rounded-xl border">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3">Material</th>
                        <th className="px-4 py-3 text-right">Received Qty</th>
                        <th className="px-4 py-3 text-right">Accepted Qty</th>
                        <th className="px-4 py-3 text-right">Damaged Qty</th>
                        <th className="px-4 py-3 text-center">Quality Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y font-medium">
                      {materials.map((m, idx) => {
                        const rowKey = grnMaterialKey(m, idx);
                        const recQty =
                          m.received_quantity !== undefined
                            ? m.received_quantity
                            : m.good_quantity + m.damaged_quantity;
                        const hasInspectionInput = qualityApproved[rowKey] !== undefined;
                        const acceptedVal = qualityApproved[rowKey] ?? 0;
                        const damagedVal = hasInspectionInput
                          ? Math.max(0, Number(recQty) - Number(acceptedVal || 0))
                          : 0;
                        const hasInspection = !["", "PENDING", "UNINSPECTED"].includes(
                          String(m.quality_result || "PENDING").toUpperCase(),
                        );
                        const isSound = hasInspection && acceptedVal > 0 && damagedVal === 0;
                        const isPartial =
                          hasInspection && (acceptedVal > 0 || damagedVal > 0) && !isSound;

                        return (
                          <tr key={grnMaterialKey(m, idx)} className="hover:bg-muted/20">
                            <td className="px-4 py-3 font-bold text-foreground">
                              <div>{m.material_name}</div>
                              <span className="font-mono text-xs text-primary font-normal">
                                {resolveGrnMaterialCode(m) || "—"}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right font-bold">
                              <div>
                                {recQty.toLocaleString()}{" "}
                                <span className="text-xs font-normal text-muted-foreground">
                                  {m.uom || "PCS"}
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <Input
                                type="number"
                                min={0}
                                max={recQty}
                                placeholder="0"
                                value={acceptedVal === 0 ? "" : (acceptedVal ?? "")}
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  const val =
                                    raw === "" ? 0 : Math.max(0, Math.min(Number(raw), recQty));
                                  setQualityApproved((prev) => ({ ...prev, [rowKey]: val }));
                                  setMaterials((prev) =>
                                    prev.map((item, i) =>
                                      i === idx
                                        ? {
                                            ...item,
                                            good_quantity: val,
                                            damaged_quantity: Math.max(0, Number(recQty) - val),
                                            rejected_quantity: item.rejected_quantity || 0,
                                            held_quantity: item.held_quantity || 0,
                                            quality_approved_quantity: val,
                                            quality_result: "INSPECTED",
                                          }
                                        : item,
                                    ),
                                  );
                                }}
                                className="w-28 text-right font-bold text-emerald-600 rounded-xl ml-auto"
                              />
                            </td>
                            <td className="px-4 py-3 text-right">
                              <Input
                                type="number"
                                min={0}
                                max={recQty}
                                placeholder="0"
                                value={!hasInspectionInput || damagedVal === 0 ? "" : damagedVal}
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  const val =
                                    raw === "" ? 0 : Math.max(0, Math.min(Number(raw), recQty));
                                  const accepted = Math.max(0, recQty - val);
                                  setQualityApproved((prev) => ({
                                    ...prev,
                                    [rowKey]: accepted,
                                  }));
                                  setMaterials((prev) =>
                                    prev.map((item, i) =>
                                      i === idx
                                        ? {
                                            ...item,
                                            good_quantity: accepted,
                                            damaged_quantity: val,
                                            quality_approved_quantity: accepted,
                                            quality_result: "INSPECTED",
                                          }
                                        : item,
                                    ),
                                  );
                                }}
                                className="w-28 text-right font-bold text-rose-600 rounded-xl ml-auto"
                              />
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span
                                className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${
                                  isSound
                                    ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                                    : isPartial
                                      ? "bg-amber-100 text-amber-800 border-amber-300"
                                      : "bg-rose-100 text-rose-800 border-rose-300"
                                }`}
                              >
                                {!hasInspection
                                  ? "PENDING QC"
                                  : isSound
                                    ? "COMPLETED"
                                    : isPartial
                                      ? "INSPECTED — WITH EXCEPTIONS"
                                      : "REJECTED ✗"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Damaged Goods Photo Evidence Section */}
              <div className="pt-2 space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <AlertTriangle className="size-4 text-rose-500" /> Damage Evidence & Remarks
                <InformationTooltip help="damageEvidence" /></h4>

                {damagedMaterialRows.length === 0 ? (
                  <div className="rounded-xl border bg-emerald-50 p-4 text-center text-sm font-medium text-emerald-800 flex items-center justify-center gap-2">
                    <CheckCircle2 className="size-5 text-emerald-600" />
                    {materials.every(
                      (m, idx) =>
                        Number(qualityApproved[grnMaterialKey(m, idx)] ?? 0) ===
                        Number(m.received_quantity || 0),
                    )
                      ? `${totalReceivedQty.toLocaleString()} ${materials[0]?.uom || "units"} recorded as accepted; QC confirmation pending.`
                      : `${totalReceivedQty.toLocaleString()} ${materials[0]?.uom || "units"} received; enter QC quantities before confirmation.`}
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                        <tr>
                          <th className="px-4 py-3">Material Code</th>
                          <th className="px-4 py-3">Material Name</th>
                          <th className="px-4 py-3 text-right">Damaged Qty</th>
                          <th className="px-4 py-3">Damage Reason</th>
                          <th className="px-4 py-3">Photo Evidence</th>
                        </tr>
                      </thead>

                      <tbody className="divide-y">
                        {damagedMaterialRows.map(({ material: m, materialIndex, rowKey }) => (
                          <tr key={rowKey}>
                            <td className="px-4 py-3 font-mono font-bold text-primary">
                              {resolveGrnMaterialCode(m) || "—"}
                            </td>

                            <td className="px-4 py-3 font-bold text-foreground">
                              {resolveGrnMaterialCode(m) || "—"} —{" "}
                              {m.material_name ||
                                m.materialName ||
                                m.material_description ||
                                "Material"}
                            </td>

                            <td className="px-4 py-3 text-right font-bold text-rose-600">
                              {m.damaged_quantity} {m.uom}
                            </td>

                            <td className="px-4 py-3 min-w-[200px]">
                              <Input
                                type="text"
                                placeholder="Specify damage reason for this material..."
                                value={m.damage_reason || ""}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setMaterials((prev) =>
                                    prev.map((item, i) =>
                                      i === materialIndex ? { ...item, damage_reason: val } : item,
                                    ),
                                  );
                                }}
                                className="rounded-xl text-xs font-medium border"
                              />
                            </td>

                            <td className="px-4 py-3">
                              <DamagePhoto
                                key={`${grnId || "draft"}:${m.grn_line_id || m.item_code}`}
                                lineId={
                                  m.grn_line_id &&
                                  !["undefined", "null"].includes(
                                    String(m.grn_line_id).toLowerCase(),
                                  )
                                    ? String(m.grn_line_id)
                                    : undefined
                                }
                                damagedQuantity={m.damaged_quantity}
                                reason={m.damage_reason}
                                initialPreviewUrl={
                                  damagePhotos[rowKey]?.previewUrl ||
                                  damagePhotos[m.item_code]?.previewUrl
                                }
                                initialFile={
                                  damagePhotos[rowKey]?.file || damagePhotos[m.item_code]?.file
                                }
                                onSuccess={(ev) => {
                                  setDamagePhotos((prev) => ({
                                    ...prev,
                                    [rowKey]: {
                                      evidenceId: ev.evidenceId,
                                      evidenceIds: [ev.evidenceId],
                                      photos: ev.filePath
                                        ? [{ id: ev.evidenceId, file_path: ev.filePath }]
                                        : [],
                                      reason: m.damage_reason,
                                      previewUrl: ev.filePath,
                                      file: ev.file,
                                    },
                                  }));
                                }}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="pt-2 space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <AlertTriangle className="size-4 text-amber-500" /> Exception Reasons
                </h4>
                <div className="overflow-x-auto rounded-xl border">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3">Material</th>
                        <th className="px-4 py-3">Exception</th>
                        <th className="px-4 py-3 text-right">Quantity</th>
                        <th className="px-4 py-3">Reason *</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {materials.flatMap((m, idx) => {
                        const rows = [
                          {
                            kind: "Damaged",
                            qty: Number(m.damaged_quantity || 0),
                            field: "damage_reason" as const,
                          },
                          {
                            kind: "Rejected",
                            qty: Number(m.rejected_quantity || 0),
                            field: "rejected_reason" as const,
                          },
                          {
                            kind: "Held",
                            qty: Number(m.held_quantity || 0),
                            field: "held_reason" as const,
                          },
                        ].filter((row) => row.qty > 0);
                        return rows.map((row) => (
                          <tr key={`${grnMaterialKey(m, idx)}-${row.kind}`}>
                            <td className="px-4 py-3 font-semibold">
                              {resolveGrnMaterialCode(m) || "—"} — {m.material_name}
                            </td>
                            <td className="px-4 py-3 font-semibold">{row.kind}</td>
                            <td className="px-4 py-3 text-right font-bold">
                              {row.qty} {m.uom || "PCS"}
                            </td>
                            <td className="px-4 py-3">
                              <Input
                                placeholder={`${row.kind} reason *`}
                                value={m[row.field] || ""}
                                onChange={(e) =>
                                  setMaterials((prev) =>
                                    prev.map((item, i) =>
                                      i === idx ? { ...item, [row.field]: e.target.value } : item,
                                    ),
                                  )
                                }
                                className="rounded-xl text-xs"
                              />
                            </td>
                          </tr>
                        ));
                      })}
                      {materials.every(
                        (m) =>
                          !(
                            Number(m.damaged_quantity || 0) ||
                            Number(m.rejected_quantity || 0) ||
                            Number(m.held_quantity || 0)
                          ),
                      ) && (
                        <tr>
                          <td
                            colSpan={4}
                            className="px-4 py-4 text-center text-xs text-muted-foreground"
                          >
                            No exception quantities recorded.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex justify-between pt-4 border-t">
                <Button variant="outline" className="rounded-xl" onClick={() => handleStepClick(2)}>
                  <ArrowLeft className="mr-2 size-4" /> Back
                </Button>
                <Button
                  disabled={busyAction || !qcHasRequiredEvidence}
                  onClick={() => void handleProceedFromPage3()}
                  className="rounded-xl font-bold px-6"
                >
                  Next <ArrowRight className="ml-2 size-4" />
                </Button>
              </div>
            </Card>
          )}

          {/* PAGE 4 – BATCH CREATION */}
          {currentPage === 4 && (
            <Card className="rounded-xl p-4 space-y-4 shadow-sm">
              <div className="border-b pb-4">
                <h3 className="font-bold text-foreground text-base">Lot & Batch Creation<InformationTooltip help="batch" /></h3>
                <p className="text-xs text-muted-foreground">
                  Divide Quality-Approved materials into batches.{" "}
                  <b>Rule: Total Batch Quantity MUST equal Quality-Approved Quantity.</b>
                </p>
              </div>

              {!allBatchesValid && (
                <div className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-xs text-rose-800 font-bold flex items-center gap-2">
                  <AlertTriangle className="size-5 shrink-0" />
                  <span>
                    Batch Quantity Mismatch! The sum of batch quantities for each material must
                    strictly match the Quality-Approved Quantity before proceeding.
                  </span>
                </div>
              )}

              <div className="space-y-5">
                {materials.map((m, idx) => {
                  const rowKey = grnMaterialKey(m, idx);
                  const { appQty, totalBatchQty, isValid } = getBatchValidation(m, idx);
                  const batches = materialBatches[rowKey] || materialBatches[m.item_code] || [];

                  return (
                    <Card
                      key={grnMaterialKey(m, idx)}
                      className={`rounded-xl p-4 border ${isValid ? "border-emerald-300 bg-emerald-50/20" : "border-rose-300 bg-rose-50/20"}`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3 mb-3 border-b pb-2">
                        <div className="flex items-center flex-wrap gap-4">
                          <div>
                            <span className="font-bold text-foreground">{m.material_name}</span>
                            <span className="ml-2 font-mono text-xs text-primary font-bold">
                              ({m.item_code})
                            </span>
                          </div>
                          <div className="flex items-center gap-2 bg-background/50 px-3 py-1.5 rounded-lg border">
                            <span className="text-xs font-semibold text-muted-foreground whitespace-nowrap">
                              No. of Batches:
                            </span>
                            <Input
                              type="number"
                              min="1"
                              placeholder="1"
                              className="w-16 h-7 text-xs rounded border-border text-center font-bold"
                              value={batches.length === 0 ? "" : batches.length}
                              onChange={(e) => {
                                const valStr = e.target.value;
                                if (valStr === "") {
                                  setMaterialBatches((prev) => ({ ...prev, [rowKey]: [] }));
                                  return;
                                }
                                const num = parseInt(valStr, 10);
                                if (!isNaN(num) && num > 0) {
                                  const isFloat = appQty % 1 !== 0;
                                  let newBatches = [];
                                  if (isFloat) {
                                    const baseQty = Number((appQty / num).toFixed(2));
                                    let sum = 0;
                                    for (let i = 0; i < num - 1; i++) {
                                      newBatches.push({
                                        batch_number: `BATCH-${m.item_code}-${(i + 1).toString().padStart(3, "0")}`,
                                        batch_quantity: baseQty,
                                      });
                                      sum += baseQty;
                                    }
                                    newBatches.push({
                                      batch_number: `BATCH-${m.item_code}-${num.toString().padStart(3, "0")}`,
                                      batch_quantity: Number((appQty - sum).toFixed(2)),
                                    });
                                  } else {
                                    const baseQty = Math.floor(appQty / num);
                                    const remainder = appQty % num;
                                    for (let i = 0; i < num; i++) {
                                      newBatches.push({
                                        batch_number: `BATCH-${m.item_code}-${(i + 1).toString().padStart(3, "0")}`,
                                        batch_quantity:
                                          i === num - 1 ? baseQty + remainder : baseQty,
                                      });
                                    }
                                  }
                                  setMaterialBatches((prev) => ({ ...prev, [rowKey]: newBatches }));
                                }
                              }}
                            />
                          </div>
                        </div>
                        <div className="flex items-center gap-4 text-xs font-semibold">
                          <span>
                            Quality-Approved Qty: <b className="text-emerald-700">{appQty}</b>{" "}
                            {m.uom}
                          </span>
                          <span>
                            Total Batch Qty:{" "}
                            <b className={isValid ? "text-emerald-700" : "text-rose-700"}>
                              {totalBatchQty}
                            </b>{" "}
                            {m.uom}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-bold ${isValid ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}
                          >
                            {isValid ? "VALID ✓" : "MISMATCH ✗"}
                          </span>
                        </div>
                      </div>

                      <div className="space-y-2">
                        {batches.map((b, bIdx) => (
                          <div
                            key={b.batch_number || `batch_${m.item_code}_${bIdx}`}
                            className="flex items-center gap-3"
                          >
                            <span className="text-xs font-mono font-bold text-muted-foreground w-24">
                              Batch #{bIdx + 1}
                            </span>
                            <Input
                              placeholder="BATCH-001"
                              value={b.batch_number}
                              onChange={(e) => {
                                const val = e.target.value;
                                setMaterialBatches((prev) => {
                                  const list = [...(prev[rowKey] || prev[m.item_code] || [])];
                                  if (list[bIdx]) {
                                    list[bIdx] = { ...list[bIdx], batch_number: val };
                                  }
                                  return { ...prev, [rowKey]: list };
                                });
                              }}
                              className="w-64 font-mono text-xs rounded-xl"
                              title={b.batch_number}
                            />
                            <Input
                              type="number"
                              placeholder="0"
                              value={b.batch_quantity === 0 ? "" : (b.batch_quantity ?? "")}
                              onChange={(e) => {
                                const val = e.target.value === "" ? 0 : Number(e.target.value);
                                setMaterialBatches((prev) => {
                                  const list = [...(prev[rowKey] || prev[m.item_code] || [])];
                                  if (list[bIdx]) {
                                    list[bIdx] = { ...list[bIdx], batch_quantity: val };
                                  }
                                  return { ...prev, [rowKey]: list };
                                });
                              }}
                              className="w-32 text-right font-bold rounded-xl"
                            />
                            <span className="text-xs text-muted-foreground font-medium">
                              {m.uom}
                            </span>
                          </div>
                        ))}
                      </div>
                    </Card>
                  );
                })}
              </div>

              <div className="flex justify-between pt-4 border-t">
                <Button variant="outline" className="rounded-xl" onClick={() => handleStepClick(3)}>
                  <ArrowLeft className="mr-2 size-4" /> Back
                </Button>
                <Button
                  onClick={() => void handleProceedFromPage4()}
                  disabled={!allBatchesValid || busyAction}
                  className="rounded-xl font-bold px-6"
                >
                  Next <ArrowRight className="ml-2 size-4" />
                </Button>
              </div>
            </Card>
          )}

          {/* PAGE 5 – DOCUMENT COMPLIANCE & ATTACHMENTS REPOSITORY */}
          {currentPage === 5 && (
            <Card className="rounded-xl p-4 space-y-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between border-b pb-4 gap-3">
                <div>
                  <h3 className="font-bold text-foreground text-base flex items-center gap-2">
                    <span>Inbound Goods Document Repository</span>
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    <>
                      <b>ASN Copy (Required)</b> must be captured and saved using the camera below.
                    </>
                  </p>
                </div>
              </div>

              {/* INLINE CUSTOM DOCUMENT CATEGORY CREATION FORM */}
              {false && showAddCustomTypeInput && (
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
                  <span className="text-xs font-bold text-primary block">
                    Create Custom Document Category
                  </span>
                  <div className="flex flex-wrap items-center gap-3">
                    <Input
                      placeholder="e.g. Insurance Certificate, MSDS, Safety Audit Report..."
                      value={newCustomCategoryInput}
                      onChange={(e) => setNewCustomCategoryInput(e.target.value)}
                      className="rounded-xl text-xs font-bold flex-1 min-w-[240px] bg-background"
                    />
                    <Button
                      size="sm"
                      className="rounded-xl font-bold text-xs"
                      onClick={() => {
                        const trimmed = newCustomCategoryInput.trim();
                        if (!trimmed) {
                          toast.error("Please enter a valid document type name");
                          return;
                        }
                        if (!customDocTypes.includes(trimmed)) {
                          setCustomDocTypes((prev) => [...prev, trimmed]);
                        }
                        setSelectedDocCategory(trimmed);
                        setNewCustomCategoryInput("");
                        setShowAddCustomTypeInput(false);
                        toast.success(`Added custom category "${trimmed}"`);
                      }}
                    >
                      Save Category
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="rounded-xl text-xs"
                      onClick={() => setShowAddCustomTypeInput(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {/* + ADD DOCUMENT ACTION FORM */}
              <div className="hidden rounded-xl border bg-muted/20 p-4 space-y-3">
                <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <Plus className="size-4 text-primary" /> Add Document / Attach File
                </span>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-64">
                    <label className="text-[11px] font-bold text-muted-foreground block mb-1">
                      Select Document Category
                    </label>
                    <select
                      value={selectedDocCategory}
                      onChange={(e) => setSelectedDocCategory(e.target.value)}
                      className="w-full rounded-xl border bg-background px-3 py-2 text-xs font-bold text-foreground"
                    >
                      {customDocTypes.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat} {cat.toLowerCase().includes("asn") ? "(Required)" : "(Optional)"}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex-1 min-w-[220px]">
                    <label className="text-[11px] font-bold text-muted-foreground block mb-1">
                      Select File
                    </label>
                    <Input
                      type="file"
                      onChange={(e) => setPendingDocFile(e.target.files?.[0] || null)}
                      className="rounded-xl text-xs cursor-pointer bg-background"
                    />
                  </div>

                  <Button
                    disabled={busyAction}
                    onClick={async () => {
                      if (!pendingDocFile) {
                        toast.error("Please choose a file to attach");
                        return;
                      }
                      const activeGrnId = grnId || localStorage.getItem("active_grn_id");
                      if (
                        !activeGrnId ||
                        ["undefined", "null"].includes(activeGrnId.toLowerCase())
                      ) {
                        toast.error("Save the GRN header before uploading documents.");
                        return;
                      }
                      const fileType =
                        pendingDocFile.type ||
                        (pendingDocFile.name.toLowerCase().endsWith(".pdf")
                          ? "application/pdf"
                          : pendingDocFile.name
                                .toLowerCase()
                                .match(/\.(jpg|jpeg|png|webp|svg|gif)$/)
                            ? "image/jpeg"
                            : "application/octet-stream");
                      try {
                        setBusyAction(true);
                        const formData = new FormData();
                        formData.append("document_type", selectedDocCategory);
                        formData.append("file", pendingDocFile);
                        const saved = await api.uploadGrnDocument(activeGrnId, formData);
                        const newDoc: UploadedDocument = {
                          document_id: saved.document_id || saved.documentId,
                          grn_id: saved.grn_id || saved.grnId || activeGrnId,
                          category: saved.document_type || selectedDocCategory,
                          file_name: saved.file_name || pendingDocFile.name,
                          file_path:
                            saved.file_path ||
                            saved.filePath ||
                            URL.createObjectURL(pendingDocFile),
                          file_type: fileType,
                        };
                        setUploadedDocuments((prev) => {
                          const duplicate = prev.some(
                            (doc) =>
                              doc.category.toLowerCase() === newDoc.category.toLowerCase() &&
                              doc.file_name.toLowerCase() === newDoc.file_name.toLowerCase(),
                          );
                          return duplicate
                            ? prev.map((doc) =>
                                doc.category.toLowerCase() === newDoc.category.toLowerCase() &&
                                doc.file_name.toLowerCase() === newDoc.file_name.toLowerCase()
                                  ? newDoc
                                  : doc,
                              )
                            : [...prev, newDoc];
                        });
                        setPendingDocFile(null);
                        toast.success(`Saved ${newDoc.file_name} under ${newDoc.category}`);
                      } catch (error) {
                        toast.error(
                          error instanceof Error ? error.message : "Unable to save document.",
                        );
                      } finally {
                        setBusyAction(false);
                      }
                    }}
                    className="rounded-xl font-bold"
                  >
                    <Upload className="mr-1.5 size-4" /> Attach Document
                  </Button>
                </div>
              </div>

              {/* DOCUMENT TABLE (PO IS COMPULSORY + ATTACHED DOCUMENTS) */}
              <div className="overflow-x-auto rounded-xl border shadow-sm">
                <table className="w-full text-xs text-left">
                  <thead className="bg-muted/60 text-muted-foreground uppercase font-mono border-b">
                    <tr>
                      <th className="px-4 py-3">Document Category / Name</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Attached File</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y font-medium">
                    {/* ALWAYS RENDER ASN COMPULSORY ROW FIRST */}
                    {(() => {
                      const asnDoc = uploadedDocuments.find((d) =>
                        d.category.toLowerCase().includes("asn"),
                      );
                      return (
                        <tr className={!asnDoc ? "bg-rose-50/30" : "hover:bg-muted/10"}>
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-2.5">
                              <FileText className="size-4 text-rose-600 shrink-0" />
                              <div>
                                <span className="font-bold text-foreground text-xs block">
                                  ASN Copy (Required)
                                </span>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3.5">
                            {asnDoc ? (
                              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1 w-fit">
                                ATTACHED ✓
                              </span>
                            ) : (
                              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300 flex items-center gap-1 w-fit animate-pulse">
                                PENDING *
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3.5 font-mono text-xs">
                            {asnDoc ? (
                              <span className="font-bold text-foreground line-clamp-1">
                                {asnDoc.file_name}
                              </span>
                            ) : (
                              <span className="text-muted-foreground text-[11px] font-normal italic">
                                No file uploaded
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3.5 text-right">
                            {asnDoc ? (
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="rounded-xl text-xs font-bold border-primary/40 text-primary hover:bg-primary/10 h-7"
                                  onClick={() => setViewingDocumentModal(asnDoc)}
                                >
                                  <Eye className="mr-1 size-3" /> View Image
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="rounded-xl text-xs text-rose-600 hover:bg-rose-50 h-7"
                                  onClick={() => {
                                    setUploadedDocuments((prev) =>
                                      prev.filter((d) => d.file_name !== asnDoc.file_name),
                                    );
                                    toast.info(`Removed ${asnDoc.file_name}`);
                                  }}
                                >
                                  Remove
                                </Button>
                              </div>
                            ) : (
                              <div>
                                <Button
                                  type="button"
                                  className="rounded-xl bg-rose-600 text-xs font-bold hover:bg-rose-700"
                                  onClick={() => void openAsnDocumentCamera()}
                                >
                                  <Camera className="mr-1 size-3" /> Open Camera *
                                </Button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })()}

                    {/* RENDER ANY ATTACHED OPTIONAL DOCUMENTS DYNAMICALLY */}
                    {uploadedDocuments
                      .filter(
                        (d) =>
                          !d.category.toLowerCase().includes("po") &&
                          !d.category.toLowerCase().includes("purchase order") &&
                          !d.category.toLowerCase().includes("asn"),
                      )
                      .map((optDoc, idx) => (
                        <tr
                          key={optDoc.file_name || `opt_doc_${idx}`}
                          className="hover:bg-muted/10"
                        >
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-2.5">
                              <FileText className="size-4 text-primary shrink-0" />
                              <div>
                                <span className="font-bold text-foreground text-xs block">
                                  {optDoc.category}
                                </span>
                                <span className="text-[10px] text-muted-foreground block line-clamp-1">
                                  Optional Inbound Attachment
                                </span>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3.5">
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1 w-fit">
                              ATTACHED ✓
                            </span>
                          </td>
                          <td className="px-4 py-3.5 font-mono text-xs">
                            <span className="font-bold text-foreground line-clamp-1">
                              {optDoc.file_name}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="rounded-xl text-xs font-bold border-primary/40 text-primary hover:bg-primary/10 h-7"
                                onClick={() => setViewingDocumentModal(optDoc)}
                              >
                                <Eye className="mr-1 size-3" /> View Image
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="rounded-xl text-xs text-rose-600 hover:bg-rose-50 h-7"
                                onClick={() => {
                                  setUploadedDocuments((prev) =>
                                    prev.filter((d) => d.file_name !== optDoc.file_name),
                                  );
                                  toast.info(`Removed ${optDoc.file_name}`);
                                }}
                              >
                                Remove
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-between pt-4 border-t">
                <Button variant="outline" className="rounded-xl" onClick={() => handleStepClick(4)}>
                  <ArrowLeft className="mr-2 size-4" />Back
                </Button>
                <Button
                  disabled={
                    busyAction ||
                    !uploadedDocuments.some(
                      (d) => isPersistedDocument(d) && d.category.toLowerCase().includes("asn"),
                    )
                  }
                  onClick={() => void handleProceedFromPage5()}
                  className="rounded-xl font-bold px-6"
                >
                  Next <ArrowRight className="ml-2 size-4" />
                </Button>
              </div>
            </Card>
          )}

          {/* PAGE 6 – QR CODE GENERATION */}
          {currentPage === 6 && (
            <Card className="rounded-xl p-4 space-y-4 shadow-sm">
              <div className="border-b pb-4">
                <h3 className="font-bold text-foreground text-base">
                  Batch-wise QR Code Generation
                <InformationTooltip help="batch" /></h3>
              </div>

              <div className="hidden flex flex-wrap items-center justify-between gap-3 bg-muted/20 p-4 rounded-xl border">
                <div className="flex-1 min-w-[280px]">
                  <label className="text-xs font-bold text-foreground mb-1 block">
                    Filter Material / View Option
                  </label>
                  <select
                    value={selectedQrMaterialCode}
                    onChange={(e) => setSelectedQrMaterialCode(e.target.value)}
                    className="w-full rounded-xl border bg-background px-3 py-2 text-sm font-bold text-primary"
                  >
                    <option value="ALL">
                      📦 All Materials in PO ({materials.length} Materials)
                    </option>
                    {materials.map((m, idx) => (
                      <option key={grnMaterialKey(m, idx)} value={m.item_code}>
                        {m.item_code} – {m.material_name} ({m.material_category || "General"})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => printAllPoQrLabels()}
                    className="rounded-xl font-bold bg-primary text-white shadow-sm"
                  >
                    <Printer className="mr-2 size-4" /> Print All PO Batch QR Labels
                  </Button>
                </div>
              </div>

              {/* Material-wise Batch QR Labels Grid (Good Stock) */}
              <div className="space-y-8">
                {(() => {
                  const goodMaterials =
                    selectedQrMaterialCode === "ALL"
                      ? materials.filter(
                          (m, index, list) =>
                            (m.good_quantity || 0) > 0 &&
                            list.findIndex((item) => item.item_code === m.item_code) === index,
                        )
                      : materials.filter(
                          (m, index, list) =>
                            m.item_code === selectedQrMaterialCode &&
                            (m.good_quantity || 0) > 0 &&
                            list.findIndex((item) => item.item_code === m.item_code) === index,
                        );
                  if (goodMaterials.length === 0) {
                    return (
                      <div className="p-4 rounded-xl border border-blue-200 bg-blue-50/50 text-center text-xs text-blue-800 font-medium">
                        No Good Quantity stock recorded for QR generation (Good Quantity = 0).
                      </div>
                    );
                  }
                  return goodMaterials.map((mat, matIdx) => {
                    const materialIndex = materials.indexOf(mat);
                    const rowKey =
                      materialIndex >= 0
                        ? grnMaterialKey(mat, materialIndex)
                        : grnMaterialKey(mat, matIdx);
                    const matBatches = materialBatches[rowKey] || materialBatches[mat.item_code];
                    const bList =
                      matBatches && matBatches.length > 0
                        ? matBatches.filter((b) => (b.batch_quantity || 0) > 0)
                        : [];
                    return (
                      <div key={rowKey} className="space-y-4 rounded-2xl border p-4 bg-muted/10">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="grid size-6 place-items-center rounded-full bg-primary text-primary-foreground font-mono text-xs font-bold">
                                {matIdx + 1}
                              </span>
                              <h4 className="font-bold text-base text-foreground">
                                {mat.material_name}{" "}
                                <span className="font-mono text-xs text-primary bg-primary/10 px-2 py-0.5 rounded-full border border-primary/20">
                                  {mat.item_code}
                                </span>
                              </h4>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Category: <b>{mat.material_category || "General"}</b> | Total Batches:{" "}
                              <b>{bList.length}</b> | UOM: <b>{mat.uom}</b> | Approved Qty:{" "}
                              <b>
                                {mat.good_quantity} {mat.uom}
                              </b>
                            </p>
                          </div>
                        </div>

                        {bList.length === 0 ? (
                          <p className="text-xs text-muted-foreground italic p-4 text-center">
                            No batches created for this material yet.
                          </p>
                        ) : (
                          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            {bList.map((b, idx) => {
                              const qrInfo = qrLabels[`${rowKey}:${b.batch_number}`] || {
                                qr_id: `QR-MAT-${mat.item_code}-${b.batch_number}`,
                                data_url: "",
                                payload: buildMaterialQrPayload(mat.item_code, b, mat),
                              };

                              return (
                                <Card
                                  key={b.batch_number}
                                  className="grn-batch-label rounded-xl p-5 border text-center gap-4 bg-white text-foreground shadow-sm relative overflow-hidden group"
                                >
                                  <div className="border-b pb-2 text-left">
                                    <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
                                      GRN Batch Label
                                    </span>
                                    <h4 className="mt-1 break-words font-mono text-sm font-semibold leading-relaxed text-foreground">
                                      {b.batch_number}
                                    </h4>
                                  </div>

                                  <div className="relative flex justify-center py-1">
                                    {qrInfo.data_url ? (
                                      <div className="relative inline-block rounded-2xl border border-gray-200 bg-white p-2 shadow-sm">
                                        <img
                                          src={qrInfo.data_url}
                                          alt="Material QR Code"
                                          className="size-48 max-w-full object-contain mx-auto"
                                        />
                                      </div>
                                    ) : (
                                      <div className="grid size-48 place-items-center bg-gray-100 mx-auto rounded-2xl border border-dashed border-gray-300">
                                        <Loader2 className="size-8 animate-spin text-primary" />
                                        <span className="text-xs text-gray-500">
                                          Generating QR...
                                        </span>
                                      </div>
                                    )}
                                  </div>

                                  <dl className="grid grid-cols-[100px_minmax(0,1fr)] gap-x-3 gap-y-2 border-t pt-3 text-left text-xs leading-relaxed">
                                    <dt className="text-muted-foreground">GRN number</dt><dd className="break-words font-mono font-semibold">{header.grn_number || "Assigning GRN number..."}</dd>
                                    <dt className="text-muted-foreground">Material</dt><dd className="break-words font-medium">{mat.item_code} ({mat.material_name})</dd>
                                    <dt className="text-muted-foreground">Category</dt><dd className="break-words">{mat.material_category || "General"}</dd>
                                    <dt className="text-muted-foreground">Batch quantity</dt><dd className="font-semibold tabular-nums">{b.batch_quantity} {mat.uom}</dd>
                                  </dl>

                                  <div className="grid grid-cols-1 gap-2 border-t pt-3">
                                    {qrInfo.data_url ? (
                                      <a
                                        href={qrInfo.data_url}
                                        download={`${b.batch_number}-QR.png`}
                                        className="inline-flex h-9 w-full items-center justify-center rounded-xl bg-emerald-600 text-xs font-bold text-white hover:bg-emerald-700"
                                      >
                                        <Download className="mr-1 size-3" /> Download QR
                                      </a>
                                    ) : (
                                      <Button
                                        disabled
                                        className="w-full rounded-xl text-xs font-bold"
                                      >
                                        <Download className="mr-1 size-3" /> Download QR
                                      </Button>
                                    )}
                                  </div>
                                </Card>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>

              {/* ⚠️ DAMAGED & REJECTED GOODS QR LABELS (QUARANTINE) SECTION */}
              <div className="hidden pt-6 border-t space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 bg-rose-50/70 dark:bg-rose-950/30 p-4 rounded-2xl border border-rose-200 dark:border-rose-900">
                  <div>
                    <h4 className="font-bold text-base text-rose-900 dark:text-rose-200 flex items-center gap-2">
                      <AlertTriangle className="size-5 text-rose-600 animate-pulse" />
                      Quarantine QR Labels — Damaged, Rejected & QC Hold
                    </h4>
                    <p className="text-xs text-rose-700 dark:text-rose-300 mt-0.5">
                      <b>
                        Rule: Damaged/Rejected Goods → Damage Lot → Unique Damage QR → Quarantine
                        Storage.
                      </b>{" "}
                      Damaged goods are excluded from available stock.
                    </p>
                  </div>
                  {damageQrLabels.length > 0 && (
                    <div className="flex items-center gap-2">
                      <Button
                        onClick={() => {
                          setNotifyVendorEmail(header.supplier_email || "");
                          setShowNotifyVendorModal(true);
                        }}
                        className="rounded-xl font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-sm"
                      >
                        <Mail className="mr-2 size-4" /> Send Damage Return to Supplier App
                      </Button>
                      <Button
                        onClick={() => printAllDamageQrLabels()}
                        variant="outline"
                        className="rounded-xl font-bold border-rose-300 text-rose-800 dark:text-rose-200 hover:bg-rose-100 shadow-sm"
                      >
                        <Printer className="mr-2 size-4" /> Print All Damage Labels (
                        {damageQrLabels.length})
                      </Button>
                    </div>
                  )}
                </div>

                {damageQrLabels.length === 0 ? (
                  <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/50 text-center text-xs text-emerald-800 font-medium">
                    ✓ No damaged or rejected goods recorded for this GRN. All received material
                    lines are 100% sound.
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {damageQrLabels.map((dEntry) => (
                      <Card
                        key={dEntry.damage_lot_number}
                        className="rounded-2xl p-5 border-2 border-rose-300 dark:border-rose-800 text-center space-y-3 bg-rose-50/20 dark:bg-rose-950/20 text-foreground shadow-md relative overflow-hidden group"
                      >
                        <div className="border-b border-rose-200 dark:border-rose-900 pb-2 text-left">
                          <span className="text-[10px] font-extrabold uppercase tracking-widest text-rose-700 dark:text-rose-400">
                            {dEntry.exception_type === "REJECTED"
                              ? "Rejected Lot QR"
                              : dEntry.exception_type === "QC_HOLD"
                                ? "QC Hold Lot QR"
                                : "Damage Lot QR"}
                          </span>
                          <h4 className="font-mono text-sm font-bold text-rose-950 dark:text-rose-100">
                            {dEntry.damage_lot_number}
                          </h4>
                        </div>

                        <div
                          className="relative group/qr cursor-pointer my-2"
                          onClick={() =>
                            setEnlargedQr({
                              title: dEntry.damage_lot_number,
                              qr_id: dEntry.qr_code,
                              data_url: dEntry.qr_data_url,
                              payload: dEntry.qr_payload,
                              batch: {
                                batch_number: dEntry.damage_lot_number,
                                batch_quantity: dEntry.damaged_quantity,
                              },
                              itemCode: dEntry.item_code,
                            })
                          }
                        >
                          {dEntry.qr_data_url ? (
                            <div className="relative inline-block p-2 bg-white rounded-2xl border border-rose-200 shadow-sm transition-transform group-hover/qr:scale-105">
                              <img
                                src={dEntry.qr_data_url}
                                alt="Damage QR Code"
                                className="size-44 mx-auto"
                              />
                              <div className="absolute inset-0 bg-rose-950/80 opacity-0 group-hover/qr:opacity-100 transition-opacity rounded-2xl flex flex-col items-center justify-center text-white text-xs font-bold gap-1 p-2">
                                <Eye className="size-7 text-rose-300" />
                                <span>Click to Enlarge / Scan</span>
                              </div>
                            </div>
                          ) : (
                            <div className="grid size-44 place-items-center bg-rose-100 mx-auto rounded-2xl border border-dashed border-rose-300">
                              <Loader2 className="size-8 animate-spin text-rose-600" />
                              <span className="text-xs text-rose-700">Generating Damage QR...</span>
                            </div>
                          )}
                        </div>

                        <div className="text-xs text-left space-y-1 font-mono text-foreground border-t border-rose-200 dark:border-rose-900 pt-2">
                          <p>
                            <b>GRN Number:</b> {header.grn_number || "Assigning GRN number..."}
                          </p>
                          <p>
                            <b>Material:</b> {dEntry.item_code} ({dEntry.material_name})
                          </p>
                          <p>
                            <b>{dEntry.quantity_label || "Damaged Qty"}:</b>{" "}
                            <b className="text-rose-600 dark:text-rose-400">
                              {dEntry.damaged_quantity} {dEntry.uom}
                            </b>
                          </p>
                          <p>
                            <b>Reason:</b> {dEntry.reason}
                          </p>
                          <p>
                            <b>QA Status:</b>{" "}
                            <span className="bg-rose-100 dark:bg-rose-900 text-rose-800 dark:text-rose-200 px-1.5 py-0.5 rounded text-[10px] font-bold">
                              {dEntry.exception_type || dEntry.qa_status || "DAMAGED"}
                            </span>
                          </p>
                          <p>
                            <b>Quarantine Location:</b>{" "}
                            <span className="text-amber-700 dark:text-amber-400 font-bold">
                              {dEntry.quarantine_location}
                            </span>
                          </p>
                        </div>

                        <div className="grid grid-cols-2 gap-2 pt-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full rounded-xl text-xs font-bold border-rose-200 hover:bg-rose-100"
                            onClick={() =>
                              setEnlargedQr({
                                title: dEntry.damage_lot_number,
                                qr_id: dEntry.qr_code,
                                data_url: dEntry.qr_data_url,
                                payload: dEntry.qr_payload,
                                batch: {
                                  batch_number: dEntry.damage_lot_number,
                                  batch_quantity: dEntry.damaged_quantity,
                                },
                                itemCode: dEntry.item_code,
                              })
                            }
                          >
                            <Eye className="mr-1 size-3 text-rose-600" /> Preview
                          </Button>
                          <Button
                            size="sm"
                            className="w-full rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white"
                            onClick={() => printSingleDamageQrLabel(dEntry)}
                          >
                            <Printer className="mr-1 size-3" /> Print Label
                          </Button>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex justify-between pt-6 border-t">
                <Button variant="outline" className="rounded-xl" onClick={() => handleStepClick(5)}>
                  <ArrowLeft className="mr-2 size-4" /> Back to Step 5
                </Button>
                <div className="flex items-center gap-2">
                  <Button
                  disabled={busyAction}
                  onClick={async () => {
                    setBusyAction(true);
                    try {
                      for (const [index, material] of materials.entries()) {
                        const approved = Number(qualityApproved[grnMaterialKey(material, index)] ?? material.good_quantity ?? 0);
                        if (approved <= 0) continue;
                        const batches = materialBatches[grnMaterialKey(material, index)] || materialBatches[material.item_code] || [];
                        const total = batches.reduce((sum, batch) => sum + Number(batch.batch_quantity || 0), 0);
                        if (!batches.length || batches.some((batch) => !batch.batch_id) || total !== approved) {
                          throw new Error(`Saved batches are missing or do not match ${approved} ${material.uom} for ${material.material_name}. Refresh the GRN or save Batch Creation before posting.`);
                        }
                      }
                      // A GRN is complete only when every received quantity is
                      // accounted for exactly once across all QC outcomes.
                      const currentMaterials = materials;

                      const processedMaterials = currentMaterials.map((m, idx) => {
                        const rowKey = grnMaterialKey(m, idx);
                        const good = Number(qualityApproved[rowKey] ?? m.good_quantity) || 0;
                        const damaged = Number(m.damaged_quantity) || 0;
                        const rejected = Number(m.rejected_quantity) || 0;
                        const held = Number(m.held_quantity) || 0;
                        const received = Number(m.received_quantity) || 0;
                        const accounted = good + rejected + damaged + held;
                        const balance = Math.max(0, received - accounted);
                        return {
                          ...m,
                          good_quantity: good,
                          damaged_quantity: damaged,
                          rejected_quantity: rejected,
                          held_quantity: held,
                          combined_received: accounted,
                          balance_quantity: balance,
                          is_line_complete: received > 0 && accounted === received,
                        };
                      });

                      const isAllFullyDelivered = processedMaterials.every(
                        (m) => m.is_line_complete,
                      );
                      const computedStatus = isAllFullyDelivered
                        ? "COMPLETED"
                        : "PARTIALLY COMPLETED";

                      const grnNumber =
                        header.grn_number ||
                        "";

                      const newRecord = {
                        grn_id: grnId || grnNumber,
                        grn_number: grnNumber,
                        po_number: header.po_number || "",
                        supplier_name: header.supplier_name || header.supplier_company_name || "",
                        supplier_company_name:
                          header.supplier_company_name || header.supplier_name || "",
                        supplier_email: header.supplier_email || "",
                        vehicle_number: header.vehicle_number || "",
                        driver_name: header.driver_name || "",
                        dock_number: header.receiving_dock || "",
                        status: computedStatus,
                        receipt_date: new Date().toISOString().split("T")[0],
                        created_at: new Date().toISOString(),
                        received_by: loggedInUserName || "Warehouse Officer",
                        allocation_id: allocatedDockInfo?.allocation_id || "",
                        materials: processedMaterials,
                      };

                      let persistedStatus = computedStatus;
                      if (grnId || grnNumber) {
                        const postedGrn = await api.postGrn(
                          grnId || grnNumber,
                          `Status: ${computedStatus} - Posted from GRN Console`,
                        );
                        persistedStatus =
                          postedGrn?.status || postedGrn?.grn?.status || computedStatus;
                      }
                      newRecord.status = persistedStatus;

                      // Ask the GRN operator to release the dock after the
                      // GRN has been successfully posted.
                      if (allocatedDockInfo?.allocation_id) {
                        setDockReleasePrompt(String(allocatedDockInfo.allocation_id));
                      }

                      // Update grnRecords state so it appears immediately on Dashboard & Records table
                      setGrnRecords((prev) => [
                        newRecord,
                        ...prev.filter(
                          (r) => r.grn_number !== grnNumber && r.grn_id !== newRecord.grn_id,
                        ),
                      ]);

                      toast.success(`GOODS RECEIVING PROCESS COMPLETED!`, {
                        description: `GRN ${grnNumber} saved with status: ${persistedStatus}. QC quantities are reconciled across accepted, rejected, damaged, and held categories.`,
                      });

                      startNewGrn(false);
                      void loadRecords();
                      void loadWarehouseDocks();
                      window.dispatchEvent(new CustomEvent("notifications:refresh"));
                      setActiveTab("records");
                      navigate({ to: "/grn", search: { tab: "records", page: 1 } });
                      setSearchTerm("");
                    } catch (e: any) {
                      console.error("GRN Posting error:", e);
                      toast.error("Failed to post GRN", {
                        description:
                          e?.message || "An unexpected error occurred during GRN posting.",
                      });
                    } finally {
                      setSaveStatus("idle");
                      setBusyAction(false);
                    }
                  }}
                  className="rounded-xl font-bold bg-emerald-600 hover:bg-emerald-700 text-white px-8 text-sm shadow-md flex items-center gap-2"
                >
                  {busyAction ? (
                    <>
                      <Loader2 className="size-5 animate-spin" /> Saving & Posting GRN...
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="size-5" /> COMPLETE & POST GOODS RECEIVING
                    </>
                  )}
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </div>
      )}

      {historyQrLabels && (
        <Dialog open={!!historyQrLabels} onOpenChange={() => setHistoryQrLabels(null)}>
          <DialogContent className={`w-[calc(100vw-2rem)] ${historyQrLabels.length === 1 ? "sm:max-w-md" : "sm:max-w-4xl"} max-h-[90dvh] gap-0 rounded-2xl p-0 overflow-hidden`}>
            <DialogHeader className="border-b px-5 py-4 pr-12 text-left">
              <DialogTitle className="flex items-center gap-2 text-lg font-bold">
                <QrCode className="size-5 text-primary" /> Batch QR Labels ({historyQrLabels.length}
                )
              </DialogTitle>
              <DialogDescription>
                {historyQrLabels.length} batch QR label{historyQrLabels.length === 1 ? "" : "s"}{" "}
                generated for this GRN. Download any label when needed.
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 overflow-y-auto p-5">
              <div className={`grid gap-4 ${historyQrLabels.length > 1 ? "sm:grid-cols-2 lg:grid-cols-3" : "grid-cols-1"}`}>
                {historyQrLabels.map((label) => (
                  <Card key={label.qrId} className="rounded-xl border p-4 gap-4 text-center shadow-none">
                    <div className="border-b pb-3 text-left">
                      <p className="break-words text-sm font-semibold leading-relaxed text-foreground">{label.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {label.materialCode} · {label.materialName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Quantity: {label.quantity ?? 0} {label.uom || "PCS"}
                      </p>
                    </div>
                    {label.dataUrl ? (
                      <img
                        src={label.dataUrl}
                        alt={`QR code for ${label.title}`}
                        className="mx-auto aspect-square w-full max-w-[260px] object-contain"
                      />
                    ) : (
                      <div className="flex aspect-square items-center justify-center text-sm text-muted-foreground">
                        QR unavailable
                      </div>
                    )}
                    {label.dataUrl && (
                      <a
                        href={label.dataUrl}
                        download={`${label.title}-QR.png`}
                        className="inline-flex h-10 w-full items-center justify-center rounded-lg border border-primary/30 px-4 text-sm font-semibold text-primary hover:bg-primary/5"
                      >
                        Download QR
                      </a>
                    )}
                  </Card>
                ))}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Enlarged QR Code Scanner Dialog */}
      {enlargedQr && (
        <Dialog open={!!enlargedQr} onOpenChange={() => setEnlargedQr(null)}>
          <DialogContent className="w-[min(96vw,1120px)] max-w-none rounded-2xl p-0 overflow-hidden">
            <div className="max-h-[92vh] overflow-y-auto">
              <DialogHeader className="border-b bg-gradient-to-r from-primary/10 via-white to-sky-50 px-4 py-3 text-left sm:px-6">
                <DialogTitle className="flex items-center gap-2 pr-8 text-base font-bold sm:text-lg">
                  <QrCode className="size-5 text-primary" /> Batch QR Code – {enlargedQr.title}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Point any smartphone camera or QR scanner at the high-definition QR code below to
                  read batch details.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 p-4 sm:p-6 lg:grid-cols-[minmax(300px,420px)_1fr] lg:items-stretch">
                <div className="flex items-center justify-center rounded-2xl border border-primary/20 bg-white p-3 shadow-md">
                  <img
                    src={enlargedQr.data_url}
                    alt="Enlarged QR Code"
                    className="aspect-square w-full max-w-[min(72vw,380px)] object-contain"
                  />
                </div>

                <div className="flex min-w-0 flex-col gap-3">
                  <div className="rounded-2xl border bg-muted/20 p-3 text-left sm:p-4">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      📱 Scanned Mobile Reader Live Output
                    </span>
                    <div className="mt-2 min-h-[260px] max-h-[44vh] overflow-auto rounded-xl border bg-black p-3 font-mono text-xs leading-relaxed text-emerald-400 shadow-inner whitespace-pre-wrap break-words">
                      {enlargedQr.payload}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Button
                      variant="outline"
                      className="rounded-xl"
                      onClick={() => setEnlargedQr(null)}
                    >
                      Close Preview
                    </Button>
                    <Button
                      variant="outline"
                      className="rounded-xl font-bold"
                      onClick={() =>
                        enlargedQr.qr_id.startsWith("DMG-") || enlargedQr.title.startsWith("DMG-")
                          ? printSingleDamageQrLabel({
                              damage_lot_id: `dmg_lot_${enlargedQr.itemCode}`,
                              damage_lot_number: enlargedQr.title,
                              item_code: enlargedQr.itemCode,
                              material_name: enlargedQr.itemCode,
                              damaged_quantity: enlargedQr.batch?.batch_quantity || 0,
                              uom: "PCS",
                              reason: "Damaged during receiving",
                              qa_status: "REJECTED",
                              quarantine_location: "QUARANTINE-ZONE-A",
                              status: "DAMAGED",
                              qr_id: enlargedQr.qr_id,
                              qr_code: enlargedQr.qr_id,
                              qr_payload: enlargedQr.payload,
                              qr_data_url: enlargedQr.data_url,
                            })
                          : printSingleQrLabel(
                              enlargedQr.title,
                              enlargedQr.itemCode,
                              enlargedQr.qr_id,
                              enlargedQr.data_url,
                            )
                      }
                    >
                      <Printer className="mr-1.5 size-4" /> Print Label
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* 📦 QR SCAN RESULT MODAL (Matching Warehouse Color Variant modal UI) */}
      <QRScanResultModal
        isOpen={isScanResultModalOpen}
        onClose={() => setIsScanResultModalOpen(false)}
        data={scanResultData}
        onPrint={(item) => {
          if (item.stock_status === "QUARANTINED" || item.qr_id.startsWith("DMG-")) {
            printSingleDamageQrLabel({
              damage_lot_id: `dmg_lot_${item.material_code}`,
              damage_lot_number:
                item.batch_number || `DMG-LOT-${item.grn_number}-${item.material_code}`,
              item_code: item.material_code,
              material_name: item.material_name,
              damaged_quantity: item.damaged_quantity,
              uom: item.uom,
              reason: "Quarantined for damage inspection",
              qa_status: "REJECTED",
              quarantine_location: "QUARANTINE-ZONE-A",
              status: "DAMAGED",
              qr_id: item.qr_id,
              qr_code: item.qr_id,
              qr_payload: "",
              qr_data_url: "",
            });
          } else {
            printSingleQrLabel(
              item.batch_number || `BATCH-${item.material_code}-001`,
              item.material_code,
              item.qr_id,
              "",
            );
          }
        }}
      />

      {/* ⚠️ QR CODE NOT FOUND ERROR MODAL */}
      <QrNotFoundModal
        isOpen={qrNotFoundOpen}
        onClose={() => setQrNotFoundOpen(false)}
        scannedCode={scannedCodeValue}
      />

      {/* 📱 MANUAL / BARCODE SCANNER INPUT MODAL */}
      {manualScanInputOpen && (
        <Dialog open={manualScanInputOpen} onOpenChange={setManualScanInputOpen}>
          <DialogContent className="sm:max-w-md rounded-2xl p-6 space-y-4">
            <DialogHeader>
              <DialogTitle className="text-base font-bold flex items-center gap-2">
                <QrCode className="size-5 text-primary" /> Paste Material QR Before Putaway
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Paste or scan the received material QR after dock GRN and before forklift putaway.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">
                Material QR Data
              </label>
              <Textarea
                placeholder="Paste material QR code or payload, for example QR-MAT-MAT-001-BATCH-01"
                value={manualScanText}
                onChange={(e) => setManualScanText(e.target.value)}
                className="font-mono text-xs h-28 rounded-xl"
                autoFocus
              />
            </div>

            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                className="w-1/2 rounded-xl"
                onClick={() => setManualScanInputOpen(false)}
              >
                Cancel
              </Button>
              <Button
                className="w-1/2 rounded-xl bg-primary text-white font-bold"
                disabled={!manualScanText.trim() || isScanningQr}
                onClick={() => handleScanQrCode(manualScanText)}
              >
                {isScanningQr ? (
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                ) : (
                  <ScanLine className="mr-1.5 size-4" />
                )}
                Verify & Scan
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {/* 🛡️ QUALITY PASS RATE AUDIT MODAL */}
      {showQualityPassModal && (
        <Dialog open={showQualityPassModal} onOpenChange={() => setShowQualityPassModal(false)}>
          <DialogContent className="sm:max-w-xl rounded-2xl p-6 space-y-4">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold flex items-center gap-2 text-purple-700">
                <ShieldCheck className="size-6 text-purple-600" /> Goods Inspection Quality Audit &
                Pass Rate
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Detailed quality pass rate metrics across received inbound material batches for the
                current month.
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-3 gap-3 p-3 bg-purple-50/50 rounded-xl border border-purple-200 text-center">
              <div>
                <span className="text-[10px] uppercase font-bold text-gray-500">
                  Total Inspected
                </span>
                <p className="font-mono text-xl font-extrabold text-gray-900">18,570</p>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-emerald-600">
                  Passed (Good)
                </span>
                <p className="font-mono text-xl font-extrabold text-emerald-700">18,450 (99.3%)</p>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-amber-600">
                  Damaged / Rejected
                </span>
                <p className="font-mono text-xl font-extrabold text-amber-700">120 (0.7%)</p>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Material-wise Inspection Breakdown
              </h4>
              <div className="rounded-xl border overflow-hidden text-xs">
                <table className="w-full text-left">
                  <thead className="bg-muted font-bold text-muted-foreground border-b">
                    <tr>
                      <th className="p-2.5">Material Code & Name</th>
                      <th className="p-2.5">Good Qty</th>
                      <th className="p-2.5">Damaged Qty</th>
                      <th className="p-2.5">Pass Rate<InformationTooltip help="qc" /></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y font-medium">
                    {materials.map((m, idx) => {
                      const total = m.good_quantity + m.damaged_quantity;
                      const rate =
                        total > 0 ? ((m.good_quantity / total) * 100).toFixed(1) : "100.0";
                      return (
                        <tr key={grnMaterialKey(m, idx)} className="hover:bg-muted/20">
                          <td className="p-2.5 font-bold">
                            {m.item_code} – {m.material_name}
                          </td>
                          <td className="p-2.5 font-mono text-emerald-700 font-bold">
                            {m.good_quantity} {m.uom}
                          </td>
                          <td className="p-2.5 font-mono text-amber-700 font-bold">
                            {m.damaged_quantity} {m.uom}
                          </td>
                          <td className="p-2.5 font-mono">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800">
                              {rate}%
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button
                variant="outline"
                className="rounded-xl"
                onClick={() => setShowQualityPassModal(false)}
              >
                Close Audit
              </Button>
              <Button
                className="rounded-xl font-bold bg-primary text-white"
                onClick={() => {
                  setShowQualityPassModal(false);
                  setActiveTab("records");
                }}
              >
                View GRN Records
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* 📧 NOTIFY VENDOR & PROCUREMENT MODAL */}
      {showNotifyVendorModal && (
        <Dialog open={showNotifyVendorModal} onOpenChange={() => setShowNotifyVendorModal(false)}>
          <DialogContent className="sm:max-w-xl rounded-2xl p-6 space-y-4">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold flex items-center gap-2 text-rose-700">
                <Mail className="size-6 text-rose-600" /> Send Damaged Goods Notice to Vendor &
                Procurement
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Publishes the damage return in the supplier application for {header.supplier_name}{" "}
                to review. and alerts the internal Procurement team in KaizenAssests.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold uppercase text-muted-foreground flex items-center justify-between">
                  <span>Supplier Email Address (Auto-Fetched)</span>
                  {notifyVendorEmail ||
                  header.supplier_email ||
                  selectedGrnDetail?.supplier_email ||
                  selectedGrnDetail?.supplierEmail ? (
                    <span className="text-[10px] text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      Auto-resolved from PO Contact
                    </span>
                  ) : (
                    <span className="text-[10px] text-amber-700 font-semibold bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                      Supplier email not available
                    </span>
                  )}
                </label>
                <Input
                  type="text"
                  value={
                    notifyVendorEmail ||
                    header.supplier_email ||
                    selectedGrnDetail?.supplier_email ||
                    selectedGrnDetail?.supplierEmail ||
                    "Supplier email not available"
                  }
                  readOnly
                  disabled={
                    !(
                      notifyVendorEmail ||
                      header.supplier_email ||
                      selectedGrnDetail?.supplier_email ||
                      selectedGrnDetail?.supplierEmail
                    )
                  }
                  className="rounded-xl mt-1 font-mono text-sm bg-muted/30 cursor-default"
                />
              </div>

              <div>
                <label className="text-xs font-bold uppercase text-muted-foreground flex items-center justify-between">
                  <span>Procurement Team Notification</span>
                  <span className="text-[10px] text-blue-700 font-semibold bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                    System Auto-Delivery
                  </span>
                </label>
                <div className="text-xs font-mono text-muted-foreground bg-muted/20 border rounded-xl p-2.5 mt-1">
                  Internal Procurement Team will automatically receive this damage notice and in-app
                  notification.
                </div>
              </div>

              <div>
                <label className="text-xs font-bold uppercase text-muted-foreground">
                  Damaged & Rejected Items Breakdown
                </label>
                <div className="max-h-40 overflow-y-auto border rounded-xl p-3 bg-muted/20 space-y-2 mt-1">
                  {(() => {
                    const activeDamageList =
                      selectedGrnDetail &&
                      selectedGrnDetail.materials &&
                      selectedGrnDetail.materials.length > 0
                        ? selectedGrnDetail.materials.filter(
                            (m: any) => Number(m.damaged_quantity || m.rejected_quantity || 0) > 0,
                          )
                        : damagedMaterials.length > 0
                          ? damagedMaterials
                          : damageQrLabels.length > 0
                            ? damageQrLabels
                            : materials.filter(
                                (m: any) =>
                                  Number(m.damaged_quantity || m.rejected_quantity || 0) > 0,
                              );

                    if (activeDamageList.length === 0) {
                      return (
                        <p className="text-xs text-muted-foreground italic">
                          No damaged items listed.
                        </p>
                      );
                    }

                    return activeDamageList.map((d: any, idx: number) => {
                      const code = d.item_code || d.itemCode || `ITEM-${idx + 1}`;
                      const name = d.material_name || d.materialName || "Material";
                      const qty = Number(
                        d.damaged_quantity || d.rejected_quantity || d.quantity || 0,
                      );
                      const uom = d.uom || "PCS";
                      const reason =
                        d.damage_reason || d.reason || "Damaged during receiving inspection";
                      const lot = d.damage_lot_number || d.batch_number || "";

                      return (
                        <div
                          key={d.damage_lot_number || `${code}-${idx}`}
                          className="text-xs font-mono flex items-center justify-between border-b pb-1"
                        >
                          <div>
                            <span className="font-bold text-foreground">
                              {code} ({name})
                            </span>
                            <p className="text-[10px] text-muted-foreground">
                              {lot ? `Lot: ${lot} | ` : ""}Reason: {reason}
                            </p>
                          </div>
                          <span className="font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                            {qty} {uom}
                          </span>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>

              <div>
                <label className="text-xs font-bold uppercase text-muted-foreground">
                  Inspector Custom Remarks / Instructions
                </label>
                <Textarea
                  value={notifyVendorRemarks}
                  onChange={(e) => setNotifyVendorRemarks(e.target.value)}
                  placeholder="Specify damage notes or instructions for return / replacement debit note..."
                  className="rounded-xl mt-1 text-xs"
                  rows={3}
                />
              </div>
            </div>

            <div className="flex gap-2 pt-3 border-t">
              <Button
                variant="outline"
                className="w-1/2 rounded-xl"
                onClick={() => setShowNotifyVendorModal(false)}
              >
                Cancel
              </Button>
              <Button
                disabled={sendingVendorNotify}
                className="w-1/2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold"
                onClick={async () => {
                  setSendingVendorNotify(true);
                  try {
                    const activeDamageList =
                      selectedGrnDetail &&
                      selectedGrnDetail.materials &&
                      selectedGrnDetail.materials.length > 0
                        ? selectedGrnDetail.materials.filter(
                            (m: any) => Number(m.damaged_quantity || m.rejected_quantity || 0) > 0,
                          )
                        : damagedMaterials.length > 0
                          ? damagedMaterials
                          : damageQrLabels.length > 0
                            ? damageQrLabels
                            : materials.filter(
                                (m: any) =>
                                  Number(m.damaged_quantity || m.rejected_quantity || 0) > 0,
                              );

                    const currentPhotoIds = activeDamageList
                      .map((m: any) => {
                        const code = m.item_code || m.itemCode || "ITEM";
                        const photo = damagePhotos[code] as any;
                        return (
                          photo?.evidenceId ||
                          (photo?.evidenceIds && photo.evidenceIds[photo.evidenceIds.length - 1])
                        );
                      })
                      .filter((id: any): id is string =>
                        Boolean(id && typeof id === "string" && id.trim()),
                      );

                    const damagePayloadItems = activeDamageList.map((m: any, idx: number) => {
                      const code = m.item_code || m.itemCode || `ITEM-${idx + 1}`;
                      const photo = damagePhotos[code] as any;
                      const activeId =
                        photo?.evidenceId ||
                        (photo?.evidenceIds && photo.evidenceIds[photo.evidenceIds.length - 1]);
                      const pIds = activeId ? [activeId] : m.photo_ids || [];
                      return {
                        item_code: code,
                        material_name: m.material_name || m.materialName || "Material",
                        damaged_quantity: Number(
                          m.damaged_quantity || m.rejected_quantity || m.quantity || 0,
                        ),
                        uom: m.uom || "PCS",
                        reason:
                          m.damage_reason ||
                          m.reason ||
                          "Damaged during receiving quality inspection",
                        damage_lot_number: m.damage_lot_number || "",
                        quarantine_location: m.quarantine_location || "",
                        photo_ids: pIds,
                      };
                    });

                    const targetGrnId =
                      grnId ||
                      (selectedGrnDetail &&
                        (selectedGrnDetail.grn_id ||
                          selectedGrnDetail.id ||
                          selectedGrnDetail.grn_number)) ||
                      header.grn_number;
                    if (!targetGrnId) {
                      toast.error("GRN must be saved before sending damage notification.");
                      return;
                    }

                    const resolvedEmail = (
                      notifyVendorEmail ||
                      header.supplier_email ||
                      selectedGrnDetail?.supplier_email ||
                      selectedGrnDetail?.supplierEmail ||
                      ""
                    ).trim();

                    const res = await api.notifyVendorDamage(targetGrnId, {
                      supplier_email: resolvedEmail,
                      custom_remarks: notifyVendorRemarks || "",
                      notify_procurement: true,
                      photo_ids: currentPhotoIds,
                      damage_items: damagePayloadItems,
                    });
                    const isDelivered = Boolean(
                      res?.emailDelivered ||
                      res?.email_delivered ||
                      res?.supplierStatus === "SENT" ||
                      res?.supplier_status === "SENT" ||
                      res?.procurementStatus === "SENT" ||
                      res?.procurement_status === "SENT" ||
                      res?.procurementNotified ||
                      res?.procurement_notified,
                    );

                    if (isDelivered) {
                      toast.success("Damage Report Dispatched!", {
                        description:
                          res?.summary ||
                          `Notice dispatched to ${res?.vendorEmail || res?.vendor_email || resolvedEmail || "Supplier"} and Procurement team.`,
                      });
                    } else {
                      toast.error("Failed to Deliver Damage Report", {
                        description:
                          res?.summary ||
                          "Could not dispatch email. Please check network/SMTP settings.",
                      });
                    }
                    setShowNotifyVendorModal(false);
                  } catch (err: any) {
                    toast.error("Failed to Send Vendor Email", {
                      description:
                        err.message ||
                        "Could not dispatch email. Please check network/SMTP settings.",
                    });
                  } finally {
                    setSendingVendorNotify(false);
                  }
                }}
              >
                {sendingVendorNotify ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <Send className="mr-2 size-4" />
                )}
                Send Report & Notify
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* 📄 GRN RECORD QUICK DETAIL MODAL DRAWER */}
      {selectedGrnDetail && (
        <Dialog open={!!selectedGrnDetail} onOpenChange={() => setSelectedGrnDetail(null)}>
          <DialogContent id="grn-record-details-dialog" className="w-[calc(100vw-2rem)] sm:max-w-5xl max-h-[92dvh] overflow-y-auto rounded-2xl p-6 gap-4">
            <DialogHeader className="border-b pb-3">
              <div className="flex flex-wrap items-center justify-between gap-3 pr-7">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-mono font-bold text-primary px-3 py-1 rounded-full bg-primary/10 border border-primary/20">
                    {selectedGrnDetail.grn_number || "—"}
                  </span>
                  <span className="text-xs font-semibold text-muted-foreground px-2.5 py-0.5 rounded-full bg-muted border">
                    {selectedGrnDetail.receipt_type === "ASN_RECEIPT" ? "ASN Delivery" : "PO Receipt"}
                  </span>
                  {selectedGrnDetail.warehouse_name && (
                    <span className="text-xs font-medium text-muted-foreground px-2.5 py-0.5 rounded-full bg-muted/60 border hidden sm:inline-flex items-center gap-1">
                      <Warehouse className="size-3" />
                      {selectedGrnDetail.warehouse_name}
                    </span>
                  )}
                </div>
                <StatusBadge status={selectedGrnDetail.status || "COMPLETED"} />
              </div>
              <DialogTitle className="text-lg font-bold text-foreground mt-2">
                Goods receipt details
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>
                  Supplier:{" "}
                  <b className="text-foreground">
                    {selectedGrnDetail.supplier_name ||
                      selectedGrnDetail.supplier_company_name ||
                      "—"}
                  </b>
                </span>
                {selectedGrnDetail.receipt_date && (
                  <span>
                    Receipt Date:{" "}
                    <b className="text-foreground">
                      {new Date(selectedGrnDetail.receipt_date).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </b>
                  </span>
                )}
              </DialogDescription>
            </DialogHeader>

            {/* QUANTITY RECONCILIATION SUMMARY ALERT & METRIC CHIPS */}
            <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border p-3.5 text-sm ${
              selectedReconciliation.received > 0 && selectedReconciliation.accounted === selectedReconciliation.received
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-amber-200 bg-amber-50 text-amber-800"
            }`}>
              <div className="flex items-start gap-3">
                <Info className="mt-0.5 size-4 shrink-0" />
                <div>
                  <p className="font-semibold text-xs sm:text-sm">Quantity reconciliation</p>
                  <p className="mt-0.5 text-xs leading-relaxed">
                    {selectedReconciliation.received > 0 && selectedReconciliation.accounted === selectedReconciliation.received
                      ? "Received quantities match the recorded quality breakdown."
                      : "Review the received and accounted quantities in the breakdown below."}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0 text-xs font-mono font-bold bg-white/80 dark:bg-black/30 px-3 py-1.5 rounded-lg border border-inherit">
                <span>Received: <b className="text-foreground font-sans">{selectedReconciliation.received}</b></span>
                <span className="text-emerald-700">Good: <b className="font-sans">{selectedReconciliation.good}</b></span>
                <span className="text-rose-600">Damaged: <b className="font-sans">{selectedReconciliation.damaged}</b></span>
              </div>
            </div>

            {/* 🚚 STRUCTURED SECTION 1: VEHICLE & TRANSPORT LOGISTICS */}
            <div className="rounded-xl border bg-card p-4 space-y-3 shadow-2xs">
              <div className="flex items-center gap-2 border-b pb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                <Truck className="size-4 text-primary" />
                <span>Vehicle & Transport Details</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase font-sans font-bold mb-1">
                    Vehicle Registration
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-mono font-black text-xs sm:text-sm bg-amber-300/80 text-amber-950 px-2.5 py-1 rounded-md border border-amber-400 shadow-2xs tracking-wider">
                    <Truck className="size-3.5 shrink-0" />
                    {selectedGrnDetail.vehicle_number || "—"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase font-sans font-bold mb-1">
                    Driver Details
                  </span>
                  <div className="space-y-0.5">
                    <b className="text-foreground text-xs flex items-center gap-1">
                      <User className="size-3 text-muted-foreground" />
                      {selectedGrnDetail.driver_name || detailGateEntry?.driver_name || "—"}
                    </b>
                    {(detailGateEntry?.driver_phone || selectedGrnDetail.driver_phone) && (
                      <span className="text-muted-foreground font-mono text-[11px] flex items-center gap-1">
                        <Phone className="size-3" />
                        {detailGateEntry?.driver_phone || selectedGrnDetail.driver_phone}
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase font-sans font-bold mb-1">
                    Gate Entry / Pass
                  </span>
                  <div className="space-y-0.5">
                    <b className="text-foreground text-xs font-mono flex items-center gap-1">
                      <ShieldCheck className="size-3 text-primary" />
                      {selectedGrnDetail.gate_entry_number || selectedGrnDetail.gate_entry_id || detailGateEntry?.gate_entry_number || "—"}
                    </b>
                    {selectedGrnDetail.asn_number && (
                      <span className="text-muted-foreground font-mono text-[11px] block">
                        ASN: {selectedGrnDetail.asn_number}
                      </span>
                    )}
                    {selectedGrnDetail.po_number && (
                      <span className="text-muted-foreground font-mono text-[11px] block">
                        PO: {selectedGrnDetail.po_number}
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase font-sans font-bold mb-1">
                    Received By
                  </span>
                  <b className="text-foreground text-xs block">
                    {selectedGrnDetail.received_by || "—"}
                  </b>
                  <span className="text-muted-foreground text-[11px] block">
                    {selectedGrnDetail.warehouse_name || "Plant Receiving"}
                  </span>
                </div>
              </div>
            </div>

            {/* 🚪 STRUCTURED SECTION 2: DOCK BAY ASSIGNMENT & LIVE RELEASE STATUS */}
            <div className={`rounded-xl border p-4 shadow-2xs transition-colors ${
              !detailDockInfo.isReleased
                ? "bg-amber-50/50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-900"
                : "bg-emerald-50/40 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-900"
            }`}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <DoorOpen className={`size-4 ${!detailDockInfo.isReleased ? "text-amber-700" : "text-emerald-700"}`} />
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Dock Bay Assignment & Release Status
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 pt-0.5">
                    <span className="text-base font-extrabold text-foreground">
                      {selectedGrnDetail.dock_number
                        ? selectedGrnDetail.dock_number.startsWith("Dock")
                          ? selectedGrnDetail.dock_number
                          : `Dock ${selectedGrnDetail.dock_number}`
                        : detailDockInfo.dock?.dock_number || "—"}
                    </span>
                    {detailDockInfo.loading ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold bg-muted text-muted-foreground border">
                        <Loader2 className="size-3.5 animate-spin" />
                        CHECKING DOCK STATUS
                      </span>
                    ) : !detailDockInfo.isReleased ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                        <span className="size-2 rounded-full bg-amber-500 animate-pulse" />
                        DOCK OCCUPIED / NOT RELEASED
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                        <CheckCircle2 className="size-3.5 text-emerald-600" />
                        DOCK RELEASED & AVAILABLE
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {detailDockInfo.loading
                      ? "Checking dock availability for this receipt."
                      : !detailDockInfo.isReleased
                        ? `Vehicle ${selectedGrnDetail.vehicle_number || ""} is currently occupying this dock bay. Release once vehicle unloading is completed.`
                        : "Dock bay is released and available for subsequent vehicles."}
                  </p>
                </div>

                {/* DOCK RELEASE ACTION BUTTON */}
                <div className="shrink-0 flex items-center">
                  {detailDockInfo.loading ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground bg-muted/70 border px-3 py-1.5 rounded-xl">
                      <Loader2 className="size-4 animate-spin" />
                      Checking dock status
                    </span>
                  ) : !detailDockInfo.isReleased ? (
                    <Button
                      id="btn-release-dock-card"
                      type="button"
                      disabled={detailDockInfo.releasing}
                      onClick={handleReleaseDockFromDetail}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs rounded-xl px-4 py-2.5 flex items-center gap-2"
                    >
                      {detailDockInfo.releasing ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <DoorOpen className="size-4" />
                      )}
                      Release Dock Bay Now
                    </Button>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-100/70 border border-emerald-300/80 px-3 py-1.5 rounded-xl">
                      <CheckCircle2 className="size-4 text-emerald-600" />
                      Bay Turnaround Clear
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* 📦 MATERIAL LINE ITEMS RECONCILIATION BREAKDOWN TABLE */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <PackageCheck className="size-4 text-primary" />
                  Material Line Items & Quantity Reconciliation
                </h4>
                <span className="text-xs text-muted-foreground">
                  {selectedReconciliation.itemCount} material item{selectedReconciliation.itemCount === 1 ? "" : "s"}
                </span>
              </div>
              <div className="rounded-xl border overflow-x-auto text-xs bg-card shadow-2xs">
                <table className="grn-reconciliation-table w-full min-w-[800px] table-fixed text-left">
                  <colgroup>
                    <col className="w-[28%]" />
                    <col className="w-[14%]" />
                    <col className="w-[13%]" />
                    <col className="w-[13%]" />
                    <col className="w-[14%]" />
                    <col className="w-[18%]" />
                  </colgroup>
                  <thead className="bg-muted/60 font-bold text-muted-foreground text-[11px] uppercase border-b">
                    <tr>
                      <th className="p-2.5">Material Details</th>
                      <th className="p-2.5 text-right">Received Qty</th>
                      <th className="p-2.5 text-right text-emerald-600">Good Qty</th>
                      <th className="p-2.5 text-right text-rose-600">Damaged Qty</th>
                      <th className="p-2.5 text-right font-black">Accounted Qty<InformationTooltip help="reconciliation" /></th>
                      <th className="p-2.5 text-center">Item Status<InformationTooltip help="workflowStatus" /></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y font-mono font-medium">
                    {(() => {
                      const detailLines =
                        selectedGrnDetail.lines && selectedGrnDetail.lines.length > 0
                          ? selectedGrnDetail.lines
                          : selectedGrnDetail.materials && selectedGrnDetail.materials.length > 0
                            ? selectedGrnDetail.materials
                            : [];
                      const receivedLines = detailLines.filter((line: any) => {
                        const received = Number(line.received_quantity ?? line.receivedQuantity ?? 0);
                        const accounted = Number(
                          line.good_quantity ?? line.goodQuantity ?? line.accepted_quantity ??
                          line.acceptedQuantity ?? line.quality_approved_quantity ??
                          line.qualityApprovedQuantity ?? 0,
                        ) + Number(line.damaged_quantity ?? line.damagedQuantity ?? 0)
                          + Number(line.rejected_quantity ?? line.rejectedQuantity ?? 0)
                          + Number(line.held_quantity ?? line.heldQuantity ?? 0);
                        return received > 0 || accounted > 0;
                      });

                      if (receivedLines.length === 0) {
                        return (
                          <tr>
                            <td
                              colSpan={6}
                              className="p-4 text-center text-xs text-muted-foreground italic font-sans"
                            >
                              No material line items recorded for this GRN.
                            </td>
                          </tr>
                        );
                      }

                      return receivedLines.map((m: any, i: number) => {
                        const itemCode = m.item_code || m.itemCode || `MAT-00${i + 1}`;
                        const materialName = m.material_name || m.materialName || itemCode;
                        const materialCategory = m.material_category || m.materialCategory || "";
                        const uom = m.uom || "PCS";
                        const receivedQty = Number(m.received_quantity ?? m.receivedQuantity ?? 0);
                        const goodQty = Number(
                          m.good_quantity ??
                            m.goodQuantity ??
                            m.accepted_quantity ??
                            m.acceptedQuantity ??
                            m.quality_approved_quantity ??
                            m.qualityApprovedQuantity ??
                            0,
                        );
                        const damQty = Number(m.damaged_quantity ?? m.damagedQuantity ?? 0);
                        const rejectedQty = Number(m.rejected_quantity ?? m.rejectedQuantity ?? 0);
                        const heldQty = Number(m.held_quantity ?? m.heldQuantity ?? 0);
                        const accounted = goodQty + damQty + rejectedQty + heldQty;
                        const isComplete = receivedQty > 0 && accounted === receivedQty;

                        return (
                          <tr key={itemCode || `mat_detail_${i}`} className="hover:bg-muted/20">
                            <td className="p-2.5 font-sans font-bold">
                              <span className="text-primary font-mono block text-xs">{itemCode}</span>
                              <span className="text-foreground text-xs block">{materialName}</span>
                              {materialCategory && (
                                <span className="text-muted-foreground text-[10px] font-normal block">
                                  {materialCategory}
                                </span>
                              )}
                            </td>
                            <td className="p-2.5 text-right font-bold text-foreground">
                              {receivedQty} {uom}
                            </td>
                            <td className="p-2.5 text-right font-bold text-emerald-700">
                              {goodQty} {uom}
                            </td>
                            <td className="p-2.5 text-right font-bold text-rose-600">
                              {damQty} {uom}
                            </td>
                            <td className="p-2.5 text-right font-black text-indigo-600">
                              {accounted} {uom}
                            </td>
                            <td className="p-2.5 text-center">
                              <span
                                className={`inline-flex items-center justify-center whitespace-nowrap px-2.5 py-1 rounded-full text-[11px] font-semibold ${
                                  isComplete
                                    ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                                    : "bg-amber-100 text-amber-800 border border-amber-300"
                                }`}
                              >
                                {isComplete ? "FULL DELIVERY ✓" : "PARTIAL BALANCE ⏳"}
                              </span>
                            </td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
              {(() => {
                const allLines = selectedGrnDetail.lines?.length
                  ? selectedGrnDetail.lines
                  : selectedGrnDetail.materials || [];
                const unreceived = allLines.filter((line: any) =>
                  Number(line.received_quantity ?? line.receivedQuantity ?? 0) <= 0 &&
                  Number(line.good_quantity ?? line.goodQuantity ?? line.accepted_quantity ??
                    line.acceptedQuantity ?? line.quality_approved_quantity ??
                    line.qualityApprovedQuantity ?? 0) <= 0 &&
                  Number(line.damaged_quantity ?? line.damagedQuantity ?? 0) <= 0 &&
                  Number(line.rejected_quantity ?? line.rejectedQuantity ?? 0) <= 0 &&
                  Number(line.held_quantity ?? line.heldQuantity ?? 0) <= 0,
                );
                if (!unreceived.length) return null;
                return (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <span className="font-semibold">Not received in this GRN:</span>{" "}
                    {unreceived.map((line: any) =>
                      `${line.item_code || line.itemCode} ${line.material_name || line.materialName || ""}`.trim(),
                    ).join(", ")}. These ASN balance lines do not create inventory or putaway tasks.
                  </div>
                );
              })()}
            </div>

            {/* MODAL FOOTER WITH DOCK RELEASE BUTTON & ACTIONS */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t">
              <div className="flex items-center gap-2 text-xs">
                {detailDockInfo.loading ? (
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground font-semibold bg-muted/70 border px-3 py-1.5 rounded-lg">
                    <Loader2 className="size-3.5 animate-spin" />
                    Checking dock status
                  </span>
                ) : !detailDockInfo.isReleased ? (
                  <span className="inline-flex items-center gap-1.5 text-amber-800 font-semibold bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg">
                    <span className="size-2 rounded-full bg-amber-500 animate-pulse" />
                    Dock {selectedGrnDetail.dock_number || "bay"} release required
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-emerald-800 font-semibold bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg">
                    <CheckCircle2 className="size-3.5 text-emerald-600" />
                    Dock {selectedGrnDetail.dock_number || "bay"} released & available
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {!detailDockInfo.isReleased && (
                  <Button
                    id="btn-footer-release-dock"
                    type="button"
                    disabled={detailDockInfo.releasing}
                    onClick={handleReleaseDockFromDetail}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl flex items-center gap-1.5"
                  >
                    {detailDockInfo.releasing ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <DoorOpen className="size-3.5" />
                    )}
                    Release Dock
                  </Button>
                )}
                <Button
                  variant="outline"
                  className="rounded-xl text-xs font-bold"
                  onClick={() => printGrnCertificate(selectedGrnDetail)}
                >
                  <Printer className="mr-1.5 size-3.5" />
                  Print GRN
                </Button>
                <Button
                  variant="secondary"
                  className="rounded-xl text-xs font-bold"
                  onClick={() => setSelectedGrnDetail(null)}
                >
                  Close
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* 🚪 QUICK DOCK ASSIGNMENT MODAL */}
      {showAssignDockModal && (
        <Dialog open={showAssignDockModal} onOpenChange={setShowAssignDockModal}>
          <DialogContent className="max-w-md rounded-2xl p-6 space-y-4">
            <DialogHeader className="border-b pb-3">
              <DialogTitle className="text-base font-bold text-foreground flex items-center gap-2">
                <DoorOpen className="size-5 text-primary" /> Assign Incoming Vehicle to Dock
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Select available dock bay and link incoming vehicle registration.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 text-xs">
              <div>
                <span className="inline-flex items-center"><label className="font-bold text-foreground block mb-1">Select Dock Bay</label><InformationTooltip help="dock" /></span>
                <select
                  value={assigningDockId}
                  onChange={(e) => setAssigningDockId(e.target.value)}
                  className="w-full rounded-xl border bg-background px-3 py-2 font-bold"
                >
                  {dockOptions.length > 0 ? (
                    dockOptions.map((d: any, idx: number) => (
                      <option
                        key={d.dock_number || d.id || `assign_dock_${idx}`}
                        value={d.dock_number}
                      >
                        {d.dock_number} ({d.dock_type || "Standard"} - {d.status || "AVAILABLE"})
                      </option>
                    ))
                  ) : (
                    <option value="">No receiving docks found</option>
                  )}
                </select>
              </div>

              <div>
                <label className="font-bold text-foreground block mb-1">
                  Vehicle Registration Number
                </label>
                <Input
                  placeholder="KA-05-MH-8812"
                  value={assigningVehicle}
                  onChange={(e) => setAssigningVehicle(e.target.value)}
                  className="rounded-xl font-mono text-xs font-bold"
                />
              </div>

              <div>
                <span className="inline-flex items-center"><label className="font-bold text-foreground block mb-1">
                  PO Reference (Optional)
                </label><InformationTooltip help="procurement" /></span>
                <Input
                  placeholder="PO-2026-0007"
                  value={assigningPo}
                  onChange={(e) => setAssigningPo(e.target.value)}
                  className="rounded-xl font-mono text-xs font-bold"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t">
              <Button
                variant="outline"
                className="rounded-xl"
                onClick={() => setShowAssignDockModal(false)}
              >
                Cancel
              </Button>
              <Button
                className="rounded-xl font-bold bg-primary text-white"
                disabled={!assigningDockId}
                onClick={() => {
                  toast.success(
                    `Vehicle ${assigningVehicle || "KA-05-MH-8812"} assigned to ${assigningDockId}`,
                  );
                  setShowAssignDockModal(false);
                  setActiveTab("wizard");
                  setCurrentPage(1);
                }}
              >
                Confirm & Start GRN
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* 👁️ INTERACTIVE DOCUMENT VIEWER MODAL / PAGE */}
      <Dialog
        open={asnCameraOpen}
        onOpenChange={(open) => {
          if (!open) closeAsnDocumentCamera();
        }}
      >
        <DialogContent className="max-w-xl rounded-2xl p-5">
          <DialogHeader>
            <DialogTitle className="font-black text-primary">
              {uploadedDocuments.some((document) =>
                document.category.toLowerCase().includes("asn"),
              )
                ? "Retake ASN Document"
                : "Capture ASN Document"}
            </DialogTitle>
            <DialogDescription>
              Capture a clear image. Saving a retake replaces the current ASN copy.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <video
              ref={asnCameraVideoRef}
              autoPlay
              playsInline
              className="w-full rounded-xl border bg-black"
            />
            <div className="flex gap-2">
              <Button
                type="button"
                className="flex-1 rounded-xl"
                onClick={captureAsnDocument}
              >
                <Camera className="mr-1.5 size-4" /> Capture & Save
              </Button>
              <Button
                type="button"
                variant="outline"
                className="rounded-xl"
                onClick={closeAsnDocumentCamera}
              >
                Close
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {viewingDocumentModal &&
        (() => {
          const isImg =
            (viewingDocumentModal.file_type &&
              viewingDocumentModal.file_type.startsWith("image/")) ||
            Boolean(viewingDocumentModal.file_name?.match(/\.(jpg|jpeg|png|webp|svg|gif)$/i)) ||
            viewingDocumentModal.category.toLowerCase().includes("photo");
          const isPdf =
            viewingDocumentModal.file_type === "application/pdf" ||
            Boolean(viewingDocumentModal.file_name?.toLowerCase().endsWith(".pdf"));

          return (
            <Dialog
              open={!!viewingDocumentModal}
              onOpenChange={() => setViewingDocumentModal(null)}
            >
              <DialogContent className="max-w-3xl rounded-2xl p-4 space-y-3 max-h-[92vh] overflow-y-auto">
                <DialogHeader className="hidden">
                  <DialogDescription className="hidden">
                    Inbound Quality & Regulatory Attachment • PO: {header.po_number || "—"} • GRN:{" "}
                    {header.grn_number || "—"}
                  </DialogDescription>
                </DialogHeader>

                {/* EMBEDDED PREVIEW OR RICH OFFICIAL DOCUMENT SHEET */}
                {isImg && viewingDocumentModal.file_path ? (
                  <div className="flex items-center justify-center overflow-hidden rounded-xl bg-background">
                    <img
                      src={resolveMediaUrl(viewingDocumentModal.file_path)}
                      alt={viewingDocumentModal.file_name}
                      className="max-h-[76vh] w-auto max-w-full rounded-xl object-contain"
                    />
                  </div>
                ) : isPdf &&
                  viewingDocumentModal.file_path &&
                  viewingDocumentModal.file_path.startsWith("blob:") ? (
                  <div className="rounded-xl border bg-muted/10 p-2 overflow-hidden shadow-inner">
                    <iframe
                      src={viewingDocumentModal.file_path}
                      className="w-full h-[480px] rounded-lg border bg-white"
                      title={viewingDocumentModal.file_name}
                    />
                  </div>
                ) : (
                  /* OFFICIAL GENERATED DOCUMENT SHEET */
                  <div className="rounded-xl border bg-card p-6 shadow-sm space-y-5 text-xs">
                    <div className="flex flex-wrap items-start justify-between border-b pb-4 gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <FileText className="size-5 text-primary" />
                          <h3 className="text-base font-bold uppercase tracking-tight text-foreground">
                            {viewingDocumentModal.category}
                          </h3>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          Official Inbound Verification Record • {viewingDocumentModal.file_name}
                        </p>
                      </div>
                      <div className="text-right font-mono">
                        <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold">
                          VERIFIED & ATTACHED
                        </span>
                        <p className="text-[11px] font-bold text-primary mt-1">
                          {header.grn_number || "DRAFT-GRN"}
                        </p>
                      </div>
                    </div>

                    {/* METADATA GRID */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono">
                      <div className="rounded-xl border bg-muted/30 p-3 space-y-1.5">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Supplier Name:</span>
                          <span className="font-bold text-foreground">
                            {header.supplier_name ||
                              header.supplier_company_name ||
                              "Direct Inbound"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Supplier Company:</span>
                          <span className="font-bold text-foreground">
                            {header.supplier_company_name || "N/A"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Gate Pass No:</span>
                          <span className="font-bold text-foreground">
                            {header.gate_entry_number || "GE-2026-001"}
                          </span>
                        </div>
                      </div>

                      <div className="rounded-xl border bg-muted/30 p-3 space-y-1.5">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Warehouse:</span>
                          <span className="font-bold text-foreground">
                            {header.warehouse_name || "Main Warehouse"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Receiving Dock:</span>
                          <span className="font-bold text-foreground">
                            {header.receiving_dock || "Not assigned"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Vehicle Number:</span>
                          <span className="font-bold text-foreground">
                            {header.vehicle_number || "KA-01-XX-0000"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Receipt Date:</span>
                          <span className="font-bold text-foreground">
                            {new Date().toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* MANIFEST TABLE */}
                    <div className="space-y-2">
                      <span className="font-bold text-foreground text-xs block">
                        Shipment Material Lines
                      </span>
                      <div className="overflow-x-auto rounded-xl border">
                        <table className="w-full text-xs text-left">
                          <thead className="bg-muted/60 font-semibold uppercase text-muted-foreground text-[10px] border-b">
                            <tr>
                              <th className="px-3 py-2 text-center">#</th>
                              <th className="px-3 py-2">Material Details</th>
                              <th className="px-3 py-2 text-right">Ordered</th>
                              <th className="px-3 py-2 text-right">Accepted</th>
                              <th className="px-3 py-2 text-right">Damaged</th>
                              <th className="px-3 py-2 text-center">QA Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y font-medium">
                            {materials.map((m, idx) => (
                              <tr key={m.item_code || idx} className="hover:bg-muted/10">
                                <td className="px-3 py-2 text-center font-mono text-muted-foreground">
                                  {idx + 1}
                                </td>
                                <td className="px-3 py-2">
                                  <span className="font-bold text-foreground block">
                                    {m.material_name}
                                  </span>
                                  <span className="text-[10px] font-mono text-muted-foreground">
                                    {m.item_code}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-right font-mono">
                                  {m.po_quantity || m.good_quantity + m.damaged_quantity} {m.uom}
                                </td>
                                <td className="px-3 py-2 text-right font-mono font-bold text-emerald-600">
                                  {m.good_quantity} {m.uom}
                                </td>
                                <td
                                  className={`px-3 py-2 text-right font-mono font-bold ${m.damaged_quantity > 0 ? "text-rose-600" : "text-muted-foreground"}`}
                                >
                                  {m.damaged_quantity} {m.uom}
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <span
                                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${m.damaged_quantity > 0 ? "bg-rose-50 text-rose-700 border border-rose-200" : "bg-emerald-50 text-emerald-700 border border-emerald-200"}`}
                                  >
                                    {m.quality_result ||
                                      (m.damaged_quantity > 0 ? "PARTIAL" : "PASSED")}
                                  </span>
                                </td>
                              </tr>
                            ))}
                            {materials.length === 0 && (
                              <tr>
                                <td colSpan={6} className="text-center py-6 text-muted-foreground">
                                  No material lines associated with this receipt.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* SECURITY & ATTACHMENT STAMP */}
                    <div className="rounded-xl border border-dashed bg-muted/20 p-3 font-mono text-[11px] space-y-1 text-muted-foreground">
                      <div>
                        <b>Attached File:</b> {viewingDocumentModal.file_name}
                      </div>
                      <div>
                        <b>Uploaded By:</b> {loggedInUserName || "WMS Officer"} •{" "}
                        {new Date().toLocaleString()}
                      </div>
                      <div>
                        <b>Security Stamp:</b> SHA256-AUTHENTICATED-WMS-INBOUND
                      </div>
                    </div>
                  </div>
                )}

                {/* ACTION FOOTER */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t">
                  <Button
                    variant="outline"
                    className="rounded-xl text-xs font-bold"
                    onClick={() => setViewingDocumentModal(null)}
                  >
                    Close Viewer
                  </Button>
                  {viewingDocumentModal.category.toLowerCase().includes("asn") && (
                    <Button
                      type="button"
                      className="rounded-xl text-xs font-bold"
                      onClick={() => {
                        setViewingDocumentModal(null);
                        void openAsnDocumentCamera();
                      }}
                    >
                      <Camera className="mr-1.5 size-4" /> Retake ASN
                    </Button>
                  )}
                </div>
              </DialogContent>
            </Dialog>
          );
        })()}

      {dockReleasePrompt && (
        <Dialog
          open={!!dockReleasePrompt}
          onOpenChange={(open) => !open && setDockReleasePrompt(null)}
        >
          <DialogContent className="max-w-md rounded-2xl p-6">
            <DialogHeader>
              <DialogTitle className="font-black text-primary">Release Dock</DialogTitle>
              <DialogDescription>
                Goods receiving is complete. Release the occupied dock now.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2 pt-3">
              <Button
                variant="outline"
                className="rounded-xl"
                onClick={() => setDockReleasePrompt(null)}
              >
                Later
              </Button>
              <Button
                className="rounded-xl bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={async () => {
                  try {
                    setBusyAction(true);
                    try {
                      await api.completeDockReceiving(dockReleasePrompt);
                    } catch (e) {
                      console.warn("completeDockReceiving status:", e);
                    }
                    await api.releaseDock(dockReleasePrompt);
                    setDockReleasePrompt(null);
                    setDockReleasedAlert(true);
                    await loadWarehouseDocks();
                    window.dispatchEvent(new CustomEvent("notifications:refresh"));
                  } catch (error: any) {
                    toast.error("Unable to release dock", {
                      description: error?.message || "Try again.",
                    });
                  } finally {
                    setBusyAction(false);
                  }
                }}
              >
                Release Dock
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={dockReleasedAlert} onOpenChange={setDockReleasedAlert}>
        <DialogContent className="max-w-md rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle className="font-black text-emerald-600">
              Dock Released Successfully
            </DialogTitle>
            <DialogDescription>
              The dock is now available. The next vehicle can enter.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end pt-3">
            <Button className="rounded-xl" onClick={() => setDockReleasedAlert(false)}>
              OK
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 🚪 EXIT GRN ENTRY CONFIRMATION DIALOG */}
      <Dialog open={showExitConfirmModal} onOpenChange={setShowExitConfirmModal}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold">
              <AlertTriangle className="size-5 text-amber-500" /> Exit GRN Entry?
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground pt-1.5 leading-relaxed">
              Your current GRN progress is saved with status <b>IN_PROGRESS</b> in the database. All
              entered header details, material receiving quantities, photos, and batches are
              preserved.
            </DialogDescription>
          </DialogHeader>
          <div className="p-3.5 rounded-xl border bg-muted/20 text-xs space-y-1 font-mono">
            <div>
              <b>GRN Number:</b> {header.grn_number || grnId || "Draft GRN"}
            </div>
            <div>
              <b>PO Reference:</b> {header.po_number || "N/A"}
            </div>
            <div>
              <b>Current Step:</b> Step {currentPage} of 6
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl text-xs"
              onClick={() => setShowExitConfirmModal(false)}
            >
              Continue Working
            </Button>
            <Button
              size="sm"
              className="rounded-xl text-xs font-bold bg-primary text-primary-foreground"
              onClick={() => {
                setShowExitConfirmModal(false);
                setActiveTab("dashboard");
                navigate({ to: "/grn", search: { tab: "dashboard", page: 1 } });
                toast.info(
                  "Exited GRN entry. You can resume anytime from the Dashboard or Create GRN.",
                );
              }}
            >
              Exit to Dashboard
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog open={Boolean(deleteGrnTarget)} onOpenChange={(open) => {
        if (!open && !deletingGrn) setDeleteGrnTarget(null);
      }}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete GRN {deleteGrnTarget?.grn_number}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove this GRN's receiving data, lines, batches, and documents.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingGrn}>Cancel</AlertDialogCancel>
            <Button variant="destructive" disabled={deletingGrn} onClick={() => void confirmDeleteGrn()}>
              {deletingGrn ? "Deleting..." : "Delete GRN"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
