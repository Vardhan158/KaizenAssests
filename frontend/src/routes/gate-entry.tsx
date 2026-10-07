import { createFileRoute, Link } from "@tanstack/react-router";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import QRCode from "qrcode";
import {
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Truck,
  UserRound,
  X,
  Upload,
  Printer,
  Trash2,
  Table as TableIcon,
  ArrowRight,
  LogOut,
} from "lucide-react";
import { AppShell, StatusBadge } from "@/components/wms/app-shell";
import { SectionCard } from "@/components/wms/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { requireRole } from "@/lib/auth-utils";

function QrThumbnail({ value, onOpen }: { value: string; onOpen: () => void }) {
  const [url, setUrl] = useState<string>("");
  useEffect(() => {
    void QRCode.toDataURL(value, { margin: 2, width: 160, errorCorrectionLevel: "H" }).then(setUrl);
  }, [value]);
  if (!url)
    return <div className="size-12 bg-muted animate-pulse rounded-lg border border-border/50" />;
  return (
    <img
      src={url}
      alt={`Open QR code for ${value}`}
      className="size-12 cursor-zoom-in border border-border/40 rounded-lg p-1 bg-white shadow-sm shrink-0 transition-transform hover:scale-105"
      role="button"
      tabIndex={0}
      title="Open QR code"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpen();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        onOpen();
      }}
    />
  );
}

function LargeQrCode({ value }: { value: string }) {
  const [url, setUrl] = useState<string>("");
  useEffect(() => {
    setUrl("");
    void QRCode.toDataURL(value, {
      margin: 4,
      width: 640,
      errorCorrectionLevel: "H",
      color: { dark: "#000000", light: "#ffffff" },
    }).then(setUrl);
  }, [value]);
  if (!url) return <div className="size-72 animate-pulse rounded-lg bg-muted" />;
  return (
    <img
      src={url}
      alt={`Gate pass QR code ${value}`}
      className="size-72 sm:size-80 bg-white object-contain"
    />
  );
}
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";


function gateQrPayload(gateEntryNumber: string) {
  return `KAIZENX:GATE_ENTRY:${gateEntryNumber.trim().toUpperCase()}`;
}

export const Route = createFileRoute("/gate-entry")({
  beforeLoad: () => requireRole("GATE_SECURITY"),
  component: GateEntry,
});

type GateEntryRecord = {
  id: string;
  gate_entry_number?: string;
  poNumber: string;
  poStatus?: string;
  asnNumber?: string;
  asnStatus?: string;
  vehiclePlate: string;
  driverName: string;
  status: string;
  assignedDock?: string;
  dockAllocationStatus?: string;
  verificationStatus?: string | null;
  truckPhotoBase64?: string | null;
  verificationResult?: { reasons?: string[] } | null;
  exited_at?: string | null;
  exited_by?: string | null;
  exitedAt?: string | null;
  exitedBy?: string | null;
};
type CaptureKind = "po" | "vehicle";
type ArrivalLineItem = {
  material_code: string;
  material_description: string;
  quantity: string;
  uom: string;
};
type PlannedVehicle = {
  asnNumber: string;
  vehicleNumber: string;
  transporter?: string;
  driverName?: string;
  driverPhone?: string;
  pkgCount?: string | number;
  pkgType?: string;
};
const inputClass = "mt-1.5 h-10 rounded-xl border-border/80 bg-background";

function formatVehicleNumber(value: string): string {
  const compact = value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 11);
  const bharat = compact.match(/^(\d{2})BH(\d{4})([A-Z]{2})$/);
  if (bharat && bharat[1] && bharat[2] && bharat[3]) return `${bharat[1]}-BH-${bharat[2]}-${bharat[3]}`;
  const standard = compact.match(/^([A-Z]{2})(\d{1,2})([A-Z]{1,3})(\d{4})$/);
  if (standard && standard[1] && standard[2] && standard[3] && standard[4])
    return `${standard[1]}-${standard[2].padStart(2, "0")}-${standard[3]}-${standard[4]}`;
  return compact;
}

function isValidVehicleNumber(value: string): boolean {
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^(?:[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{4}|\d{2}BH\d{4}[A-Z]{2})$/.test(compact);
}

function extractVehiclesFromAsns(matchingAsns: any[]): PlannedVehicle[] {
  const result: PlannedVehicle[] = [];

  matchingAsns.forEach((asn: any) => {
    let rawLog = asn.logistics;
    if (typeof rawLog === "string") {
      try {
        rawLog = JSON.parse(rawLog);
      } catch {
        rawLog = null;
      }
    }

    const logList = Array.isArray(rawLog) && rawLog.length > 0 ? rawLog : null;
    const asnNum = String(asn.asnNumber || asn.asn_number || asn.id || "");

    if (logList) {
      logList.forEach((item: any) => {
        const rawVeh = String(
          item.vehicle_number ||
            item.vehicleNumber ||
            item.vehicle_plate ||
            item.vehiclePlate ||
            "",
        );
        const formattedVeh = formatVehicleNumber(rawVeh);
        if (formattedVeh) {
          result.push({
            asnNumber: asnNum,
            vehicleNumber: formattedVeh,
            transporter: item.transporter || asn.transporter || "",
            driverName: item.driver_name || item.driverName || asn.driverName || asn.driver_name || "",
            driverPhone: item.driver_contact || item.driverContact || asn.driverContact || asn.driver_contact || "",
            pkgCount: item.number_of_packages ?? item.numberOfPackages ?? asn.numberOfPackages,
            pkgType: item.package_type || item.packageType || asn.packageType,
          });
        }
      });
    }

    const topVeh = formatVehicleNumber(String(asn.vehicleNumber || asn.vehicle_number || ""));
    if (topVeh) {
      result.push({
        asnNumber: asnNum,
        vehicleNumber: topVeh,
        transporter: asn.transporter || "",
        driverName: asn.driverName || asn.driver_name || "",
        driverPhone: asn.driverContact || asn.driver_contact || "",
        pkgCount: asn.numberOfPackages,
        pkgType: asn.packageType,
      });
    }
  });

  return result.filter(
    (v, index, self) =>
      self.findIndex(
        (candidate) =>
          candidate.vehicleNumber.replace(/[^A-Z0-9]/g, "") ===
          v.vehicleNumber.replace(/[^A-Z0-9]/g, ""),
      ) === index,
  );
}

function formatQuantityInputValue(value: unknown): string {
  const quantity = Number(value);
  if (!Number.isFinite(quantity)) return "";
  return String(Math.floor(quantity));
}

function GateEntry() {
  const [entries, setEntries] = useState<GateEntryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [scanning, setScanning] = useState<CaptureKind | null>(null);

  const [poDocument, setPoDocument] = useState<File | null>(null);
  const [vehiclePhoto, setVehiclePhoto] = useState<File | null>(null);
  const [poPreview, setPoPreview] = useState<string | null>(null);
  const [vehiclePreview, setVehiclePreview] = useState<string | null>(null);
  const [poNumber, setPoNumber] = useState("");
  const [asnReference, setAsnReference] = useState("");
  const [poVerificationStatus, setPoVerificationStatus] = useState<
    "PO_VERIFIED" | "UNSCHEDULED_ARRIVAL" | null
  >(null);
  const [supplierName, setSupplierName] = useState("");
  const [materialDescription, setMaterialDescription] = useState("");
  const [totalQuantity, setTotalQuantity] = useState("");
  const [arrivalLineItems, setArrivalLineItems] = useState<ArrivalLineItem[]>([]);
  const [poDate, setPoDate] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [driverName, setDriverName] = useState("Driver");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [driverPhone, setDriverPhone] = useState("");
  const [extractedDetails, setExtractedDetails] = useState<Record<string, unknown> | null>(null);
  const [lastCreatedEntry, setLastCreatedEntry] = useState<GateEntryRecord | null>(null);
  const [availablePos, setAvailablePos] = useState<any[]>([]);
  const [plannedVehicles, setPlannedVehicles] = useState<PlannedVehicle[]>([]);
  const [autoFetchingPo, setAutoFetchingPo] = useState(false);
  const [fieldSources, setFieldSources] = useState<{
    poNumber?: "system" | "generated";
    supplier?: "system" | "generated";
    materials?: "system" | "generated";
    dates?: "system" | "generated";
  }>({});
  const [lastQrCode, setLastQrCode] = useState<string | null>(null);
  const [isDockModalOpen, setIsDockModalOpen] = useState(false);
  const [qrModalEntry, setQrModalEntry] = useState<GateEntryRecord | null>(null);
  const [docks, setDocks] = useState<any[]>([]);
  const [loadingDocks, setLoadingDocks] = useState(false);
  const [selectedDockId, setSelectedDockId] = useState<string | null>(null);
  const [pendingFormData, setPendingFormData] = useState<FormData | null>(null);
  const [exitingId, setExitingId] = useState<string | null>(null);
  const approvalDialog = useRef<HTMLDialogElement>(null);

  const isEligibleForInboundExit = (statusStr: string) => {
    const upper = (statusStr || "").toUpperCase().trim();
    // The backend requires the receiving workflow to be complete; dock
    // release and posted-GRN checks are validated when the action is submitted.
    return upper === "RECEIVING_COMPLETED";
  };

  const handleMarkVehicleExited = async (entry: any) => {
    const vehName = entry.vehiclePlate || entry.vehicle_number || "this vehicle";
    if (
      !confirm(
        `Confirm gate exit approval for ${vehName}? Confirm that vehicle has completed unloading/receiving and is cleared to leave facility.`,
      )
    )
      return;
    setExitingId(entry.id);
    try {
      const updated = await api.markInboundVehicleExited(entry.id);
      toast.success(`Gate exit approved for ${vehName}`, {
        description: `Status updated to VEHICLE_EXITED by ${updated.exited_by || "Security"}.`,
      });
      await loadEntries(true);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("gate-entries:refresh"));
      }
    } catch (error: any) {
      toast.error("Gate exit approval failed", {
        description:
          error?.message || "Ensure receiving/unloading is complete before approving vehicle exit.",
      });
    } finally {
      setExitingId(null);
    }
  };

  const refreshDockAllocationForEntry = useCallback(async (entry: GateEntryRecord) => {
    const passNumber = entry.gate_entry_number || entry.id;
    try {
      const [allocationRequests, gateEntries] = await Promise.all([
        api.getDockAllocationRequests().catch(() => []),
        api.getGateEntries().catch(() => []),
      ]);
      const allocation = allocationRequests.find((request: any) => {
        const requestPass = String(request.existing_gate_pass_id || "").toUpperCase();
        const requestVehicle = String(request.vehicle_number || "").toUpperCase();
        return (
          requestPass === String(passNumber).toUpperCase() ||
          requestPass === String(entry.id).toUpperCase() ||
          requestVehicle === String(entry.vehiclePlate || "").toUpperCase()
        );
      });
      const freshGateEntry = gateEntries.find((candidate: any) => {
        return (
          String(candidate.id || "").toUpperCase() === String(entry.id).toUpperCase() ||
          String(candidate.gate_entry_number || candidate.gateEntryNumber || "").toUpperCase() ===
            String(passNumber).toUpperCase()
        );
      });
      const assignedDock =
        allocation?.assigned_dock_code ||
        allocation?.assignedDockCode ||
        allocation?.dock_code ||
        freshGateEntry?.assignedDock ||
        freshGateEntry?.assigned_dock_id ||
        freshGateEntry?.assignedDockId;
      
      let dockAllocationStatus = "AWAITING_DOCK";
      if (assignedDock) {
        dockAllocationStatus = "DOCK_ASSIGNED";
      } else {
        dockAllocationStatus =
          allocation?.status ||
          freshGateEntry?.dockAllocationStatus ||
          freshGateEntry?.status ||
          "AWAITING_DOCK";
      }

      setLastCreatedEntry((current) => {
        if (!current || current.id !== entry.id) return current;
        return {
          ...current,
          assignedDock: assignedDock || current.assignedDock,
          dockAllocationStatus,
        };
      });
    } catch {
      // The confirmation dialog can still be useful even if the background refresh fails.
    }
  }, []);

  useEffect(() => {
    const element = approvalDialog.current;
    if (!lastCreatedEntry || !element) return;

    // Generate QR Code for the success pass
    const generateQr = async () => {
      try {
        const url = await QRCode.toDataURL(
          lastCreatedEntry.gate_entry_number || lastCreatedEntry.id,
          {
            width: 200,
            margin: 1,
          },
        );
        setLastQrCode(url);
      } catch (err) {
        console.error("Failed to generate pass QR", err);
      }
    };

    void generateQr();

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    if (!element.open) element.showModal();

    return () => {
      if (element.open) element.close();
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [lastCreatedEntry]);

  useEffect(() => {
    if (!lastCreatedEntry) return;
    void refreshDockAllocationForEntry(lastCreatedEntry);
    const timer = window.setInterval(() => {
      void refreshDockAllocationForEntry(lastCreatedEntry);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [lastCreatedEntry?.id, refreshDockAllocationForEntry]);

  const handleVehicleNumberChange = (rawVal: string) => {
    setVehicleNumber(formatVehicleNumber(rawVal));
  };

  const applyLineItems = (rawItems: unknown): boolean => {
    if (!Array.isArray(rawItems) || rawItems.length === 0) return false;
    const items = rawItems
      .map((item: any, idx: number) => ({
        material_code: String(
          item.material_code ?? item.materialCode ?? item.item_code ?? item.itemCode ?? `MAT-${101 + idx}`,
        ),
        material_description: String(
          item.material_description ??
            item.materialDescription ??
            item.material_name ??
            item.materialName ??
            `Standard Item ${idx + 1}`,
        ),
        // ASN lines expose their quantity as shippedQuantity, whereas PO and
        // OCR lines use quantity. Support both when populating the gate form.
        quantity: formatQuantityInputValue(
          item.shipped_quantity ?? item.shippedQuantity ?? item.quantity ?? item.ordered_quantity ?? "10",
        ),
        uom: String(item.uom ?? item.unit ?? "PCS"),
      }))
      .filter((item) => item.material_description || item.material_code);
    if (!items.length) return false;
    setArrivalLineItems(items);
    setMaterialDescription(
      items
        .map((item) => item.material_description)
        .filter(Boolean)
        .join(", "),
    );
    setTotalQuantity(String(items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)));
    return true;
  };

  const updateLineItem = (index: number, field: keyof ArrivalLineItem, value: string) => {
    const items = arrivalLineItems.map((item, itemIndex) =>
      itemIndex === index ? { ...item, [field]: value } : item,
    );
    setArrivalLineItems(items);
    setMaterialDescription(
      items
        .map((item) => item.material_description)
        .filter(Boolean)
        .join(", "),
    );
    setTotalQuantity(String(items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)));
  };

  const loadEntries = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const records = await api.getGateEntries();
      // Gate Entry API returns its persisted records in snake_case. Normalize
      // once at the boundary so the live queue/history renders backend data.
      setEntries(
        (records || []).map((record: any) => {
          const assignedDock = record.assignedDock ?? record.assigned_dock_id;
          let dockAllocationStatus = "AWAITING_DOCK";
          if (assignedDock) {
            dockAllocationStatus = "DOCK_ASSIGNED";
          } else {
            dockAllocationStatus = record.dockAllocationStatus ?? record.dock_allocation_status;
          }
          return {
            ...record,
            poNumber: record.poNumber ?? record.po_number ?? "",
            poStatus: record.poStatus ?? record.po_status,
            asnNumber: record.asnNumber ?? record.asn_number,
            asnStatus: record.asnStatus ?? record.asn_status,
            vehiclePlate: record.vehiclePlate ?? record.vehicle_plate ?? record.vehicle_number ?? "",
            driverName: record.driverName ?? record.driver_name ?? "",
            assignedDock,
            dockAllocationStatus,
            verificationStatus: record.verificationStatus ?? record.verification_status,
            truckPhotoBase64: record.truckPhotoBase64 ?? record.truck_photo_base64,
            verificationResult: record.verificationResult ?? record.verification_result,
            exitedAt: record.exitedAt ?? record.exited_at ?? record.exit_time,
            exitedBy: record.exitedBy ?? record.exited_by,
          };
        }),
      );
    } catch (error) {
      if (!quiet)
        toast.error("Unable to load gate entries", {
          description: error instanceof Error ? error.message : undefined,
        });
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEntries();
    const timer = window.setInterval(() => void loadEntries(true), 2000);
    return () => window.clearInterval(timer);
  }, [loadEntries]);

  // Load available PO list for quick selection
  useEffect(() => {
    void api.getPurchaseOrders().then((pos) => setAvailablePos(pos || [])).catch(() => {});
  }, []);

  // Real-time auto-fetch PO details when entering PO number
  useEffect(() => {
    const trimmed = poNumber.trim();
    if (!trimmed || trimmed.length < 3) return;
    const timer = setTimeout(() => {
      void fetchPoDetails(trimmed, true);
    }, 350);
    return () => clearTimeout(timer);
  }, [poNumber]);
  useEffect(() => {
    if (poDocument) {
      const url = URL.createObjectURL(poDocument);
      setPoPreview(url);
      return () => URL.revokeObjectURL(url);
    }
    setPoPreview(null);
    return undefined;
  }, [poDocument]);

  useEffect(() => {
    if (vehiclePhoto) {
      const url = URL.createObjectURL(vehiclePhoto);
      setVehiclePreview(url);
      return () => URL.revokeObjectURL(url);
    }
    setVehiclePreview(null);
    return undefined;
  }, [vehiclePhoto]);

  async function scanCapture(kind: CaptureKind, file: File) {
    setScanning(null);
    if (kind === "po") {
      setPoDocument(file);
      toast.success("PO document attached. Enter the PO number manually to load details.");
      return;
    }
    if (kind === "vehicle") {
      setVehiclePhoto(file);
      toast.success("Vehicle photo attached. Enter vehicle details manually.");
    }
  }



  async function fetchPoDetails(number: string, preserveScannedFields = false) {
    if (!number || number.trim().length < 3) return;
    setAutoFetchingPo(true);
    const toastId = toast.loading(`Fetching details for PO: ${number}...`);
    try {
      const [purchaseOrders, asns] = await Promise.all([api.getPurchaseOrders(), api.getAsns()]);
      const lookup = number.trim().toUpperCase();
      const exactPo = purchaseOrders.find(
        (candidate: any) =>
          String(candidate.poNumber || candidate.po_number || "").toUpperCase() === lookup,
      );
      const prefixMatches = purchaseOrders.filter((candidate: any) =>
        String(candidate.poNumber || candidate.po_number || "")
          .toUpperCase()
          .startsWith(`${lookup}-`),
      );
      // OCR can read only "PO-2026" from a complete "PO-2026-0001".
      // Prefer a shipment with an ASN when resolving that partial prefix.
      const po =
        exactPo ||
        prefixMatches.find((candidate: any) => {
          const candidateNumber = candidate.poNumber || candidate.po_number;
          return asns.some(
            (asn: any) =>
              String(asn.poNumber || asn.po_number || "").toUpperCase() ===
              String(candidateNumber).toUpperCase(),
          );
        }) ||
        (prefixMatches.length === 1 ? prefixMatches[0] : undefined);

      if (!po) {
        if (preserveScannedFields) {
          setPoVerificationStatus("UNSCHEDULED_ARRIVAL");
          toast.info("PO entered as unscheduled arrival", {
            id: toastId,
            description: `${number} required fields auto-generated for manual review.`,
          });
          const today = new Date().toISOString().split("T")[0];
          const delivery = new Date(Date.now() + 86400000 * 3).toISOString().split("T")[0];
          if (!supplierName) setSupplierName("Unscheduled Supplier");
          if (!poDate) setPoDate(today);
          if (!deliveryDate) setDeliveryDate(delivery);
          if (!arrivalLineItems.length) {
            applyLineItems([
              {
                material_code: "MAT-UNSCHED-01",
                material_description: "General Warehouse Arrival Material",
                quantity: "100",
                uom: "PCS",
              },
            ]);
          }
          setFieldSources({
            poNumber: "generated",
            supplier: "generated",
            materials: "generated",
            dates: "generated",
          });
          return;
        }
        throw new Error(`Complete purchase order not found for ${number}`);
      }

      const resolvedPoNumber = String(po.poNumber || po.po_number || number);
      setPoNumber(resolvedPoNumber);
      setPoVerificationStatus("PO_VERIFIED");

      const normalizePo = (val: string) => String(val || "").toUpperCase().replace(/^PO-?/, "");
      const targetPoNorm = normalizePo(resolvedPoNumber);

      const matchingAsns = asns.filter((asn: any) => {
        const p1 = normalizePo(asn.poNumber || asn.po_number);
        const p2 = normalizePo(asn.poId || asn.po_id);
        return (p1 && p1 === targetPoNorm) || (p2 && p2 === targetPoNorm);
      });
      const vehiclesForPo = extractVehiclesFromAsns(matchingAsns);
      setPlannedVehicles(vehiclesForPo);

      const firstPendingVehicle =
        vehiclesForPo.find(
          (shipment) =>
            !entries.some(
              (entry) =>
                String(entry.poNumber || "").toUpperCase() === resolvedPoNumber.toUpperCase() &&
                formatVehicleNumber(entry.vehiclePlate || "") === shipment.vehicleNumber,
            ),
        ) || vehiclesForPo[0];

      if (firstPendingVehicle) {
        setVehicleNumber(firstPendingVehicle.vehicleNumber);
        setAsnReference(firstPendingVehicle.asnNumber);
        if (firstPendingVehicle.driverName) setDriverName(firstPendingVehicle.driverName);
        if (firstPendingVehicle.driverPhone) setDriverPhone(firstPendingVehicle.driverPhone);
      }

      const items = po.items || po.lines || [];
      if (items.length) {
        applyLineItems(items);
      } else {
        applyLineItems([
          {
            material_code: `MAT-${resolvedPoNumber.replace(/[^A-Z0-9]/gi, "")}-01`,
            material_description:
              po.materialDescription || po.material_description || "Standard Procurement Goods",
            quantity: po.totalQuantity || po.total_quantity || "10",
            uom: "PCS",
          },
        ]);
      }

      const fetchedSupplier = po.supplierName || po.supplier_name || "Primary Supplier Pvt Ltd";
      setSupplierName(fetchedSupplier);

      const today = new Date().toISOString().split("T")[0];
      const defaultDelivery = new Date(Date.now() + 86400000 * 3).toISOString().split("T")[0];
      const fetchedPoDate = String(po.poDate || po.po_date || today);
      const fetchedDeliveryDate = String(
        po.expectedDeliveryDate || po.expected_delivery_date || defaultDelivery,
      );
      setPoDate(fetchedPoDate);
      setDeliveryDate(fetchedDeliveryDate);

      const systemMat = (items.length ? items : [{ material_name: "Standard Item" }])
        .map((i: any) => i.materialName || i.material_name || i.material_description)
        .filter(Boolean)
        .join(", ");
      if (systemMat) setMaterialDescription(systemMat);

      const systemQty = items.length
        ? items.reduce(
            (sum: number, i: any) => sum + Number(i.quantity || i.ordered_quantity || 0),
            0,
          )
        : 10;
      setTotalQuantity(String(systemQty || 10));

      setFieldSources({
        poNumber: "system",
        supplier: "system",
        materials: "system",
        dates: "system",
      });

      const shipment = matchingAsns[0];
      if (shipment) {
        if (!asnReference && shipment.asnNumber) {
          setAsnReference(shipment.asnNumber || shipment.asn_number || shipment.id || "");
        }
        setSupplierName(shipment.supplierName || shipment.supplier_name || fetchedSupplier);
        const expectedArrival = shipment.expectedArrivalAt || shipment.expected_arrival_at;
        if (expectedArrival) setDeliveryDate(String(expectedArrival).slice(0, 10));
        const shipmentItems = shipment.lines || shipment.items || [];
        if (shipmentItems.length) applyLineItems(shipmentItems);
      }

      toast.success(
        vehiclesForPo.length > 0
          ? `PO ${resolvedPoNumber} & ${vehiclesForPo.length} planned vehicle(s) auto-fetched!`
          : `PO ${resolvedPoNumber} details auto-fetched & required fields generated!`,
        { id: toastId },
      );
    } catch (error: any) {
      console.warn("Manual PO lookup failed:", error);
      toast.error(error.message || "PO not found in system", { id: toastId });
    } finally {
      setAutoFetchingPo(false);
    }
  }

  async function fetchAsnDetails(reference: string) {
    if (!reference.trim()) return;
    const toastId = toast.loading(`Loading ASN ${reference}...`);
    try {
      const asns = await api.getAsns();
      const lookup = reference.trim().toUpperCase();
      const shipment = asns.find(
        (asn: any) =>
          String(asn.id || "").toUpperCase() === lookup ||
          String(asn.asnNumber || asn.asn_number || "").toUpperCase() === lookup,
      );
      if (!shipment) throw new Error(`ASN ${reference} was not found`);
      setAsnReference(shipment.asnNumber || shipment.asn_number || shipment.id);
      setPoNumber(shipment.poNumber || shipment.po_number || "");
      setSupplierName(shipment.supplierName || shipment.supplier_name || "");

      const vehiclesForAsn = extractVehiclesFromAsns([shipment]);
      setPlannedVehicles(vehiclesForAsn);

      if (vehiclesForAsn.length > 0) {
        const firstVeh = vehiclesForAsn[0];
        setVehicleNumber(firstVeh.vehicleNumber);
        if (firstVeh.driverName) setDriverName(firstVeh.driverName);
        if (firstVeh.driverPhone) setDriverPhone(firstVeh.driverPhone);
      } else {
        setVehicleNumber(
          formatVehicleNumber(shipment.vehicleNumber || shipment.vehicle_number || ""),
        );
        setDriverName(shipment.driverName || shipment.driver_name || "Driver");
        setDriverPhone(shipment.driverContact || shipment.driver_contact || "");
      }

      setDeliveryDate(
        (shipment.expectedArrivalAt || shipment.expected_arrival_at || "").slice(0, 10),
      );
      applyLineItems(shipment.lines || shipment.items || []);
      toast.success("ASN details loaded", {
        id: toastId,
        description: `PO, supplier and ${vehiclesForAsn.length || 1} vehicle(s) sourced from ASN.`,
      });
    } catch (error) {
      toast.error("Unable to load ASN", {
        id: toastId,
        description: error instanceof Error ? error.message : undefined,
      });
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;

    if (!vehiclePhoto) {
      toast.error("Vehicle photo is required", {
        description: "Please capture or upload a vehicle photo before creating the entry.",
      });
      return;
    }

    if (!poNumber.trim()) {
      toast.error("Purchase order number is required");
      return;
    }

    if (!supplierName.trim()) {
      toast.error("Supplier name is required");
      return;
    }

    const parsedQty = parseFloat(totalQuantity);
    if (!totalQuantity || isNaN(parsedQty) || parsedQty <= 0) {
      toast.error("Total quantity is required and must be greater than 0");
      return;
    }

    if (!vehicleNumber.trim()) {
      toast.error("Vehicle number is required");
      return;
    }

    const isVehicleValid = isValidVehicleNumber(vehicleNumber);
    if (!isVehicleValid) {
      toast.error("Invalid Vehicle Number format", {
        description: "Use a valid format such as MH-12-AB-1234 or 22-BH-1234-AA.",
      });
      return;
    }

    const form = new FormData(formElement);
    if (poDocument) form.append("po_document", poDocument);
    if (vehiclePhoto) form.append("vehicle_photo", vehiclePhoto);

    // Approve the gate entry. Warehouse dock-management will allocate the dock.
    try {
      setSubmitting(true);
      const entry = await api.createGateEntry(form);

      const createdVehicle =
        entry.vehicleNumber ||
        entry.vehicle_number ||
        entry.vehiclePlate ||
        entry.vehicle_plate ||
        vehicleNumber;
      const createdPo = entry.poNumber || entry.po_number || poNumber;
      const createdGateNumber = entry.gateEntryNumber || entry.gate_entry_number;
      const createdDriver = entry.driverName || entry.driver_name || driverName;
      const assignedDock =
        entry.assignedDock ||
        entry.assigned_dock_id ||
        entry.assignedDockId ||
        entry.assigned_dock_code;

      localStorage.setItem(
        "verified_gate_po",
        JSON.stringify({
          gateEntryId: entry.id,
          poNumber,
          supplierName,
          materialDescription,
          totalQuantity,
          poDate,
          deliveryDate,
          vehicleNumber,
          verifiedAt: new Date().toISOString(),
        }),
      );
      toast.success("Gate entry approved", {
        description: assignedDock
          ? `Dock ${assignedDock} is assigned.`
          : "Warehouse Manager can now allocate a dock in Dock Management.",
      });

      setLastCreatedEntry({
        id: entry.id,
        gate_entry_number: createdGateNumber,
        poNumber: createdPo,
        poStatus: entry.poStatus,
        asnNumber: entry.asnNumber,
        asnStatus: entry.asnStatus,
        vehiclePlate: createdVehicle,
        driverName: createdDriver,
        status: entry.status,
        assignedDock,
        dockAllocationStatus: assignedDock ? "DOCK_ASSIGNED" : "AWAITING_DOCK",
        verificationStatus: poVerificationStatus,
      });

      setPoDocument(null);
      setVehiclePhoto(null);
      setAsnReference("");
      setPoNumber("");
      setPoVerificationStatus(null);
      setSupplierName("");
      setMaterialDescription("");
      setTotalQuantity("");
      setArrivalLineItems([]);
      setPoDate("");
      setDeliveryDate("");
      setVehicleNumber("");
      setPlannedVehicles([]);
      setDriverName("Driver");
      setLicenseNumber("");
      setDriverPhone("");
      setPendingFormData(null);
      await loadEntries(true);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("gate-entries:refresh"));
      }
    } catch (error) {
      toast.error("Gate entry approval failed", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDockAssignment(dockId: string) {
    if (!pendingFormData) return;

    setIsDockModalOpen(false);
    setSubmitting(true);
    try {
      const entry = await api.createGateEntry(pendingFormData);

      // Assign the selected dock to this gate entry
      await api.assignDock(entry.id, dockId);

      const createdVehicle =
        entry.vehicleNumber ||
        entry.vehicle_number ||
        entry.vehiclePlate ||
        entry.vehicle_plate ||
        vehicleNumber;
      const createdPo = entry.poNumber || entry.po_number || poNumber;
      const createdGateNumber = entry.gateEntryNumber || entry.gate_entry_number;
      const createdDriver = entry.driverName || entry.driver_name || driverName;

      localStorage.setItem(
        "verified_gate_po",
        JSON.stringify({
          gateEntryId: entry.id,
          poNumber,
          supplierName,
          materialDescription,
          totalQuantity,
          poDate,
          deliveryDate,
          vehicleNumber,
          verifiedAt: new Date().toISOString(),
        }),
      );
      toast.success("Gate entry approved & Dock assigned", {
        description: `Dock ${dockId} has been allocated.`,
      });

      setLastCreatedEntry({
        id: entry.id,
        gate_entry_number: createdGateNumber,
        poNumber: createdPo,
        poStatus: entry.poStatus,
        asnNumber: entry.asnNumber,
        asnStatus: entry.asnStatus,
        vehiclePlate: createdVehicle,
        driverName: createdDriver,
        status: entry.status,
        assignedDock: dockId,
        verificationStatus: poVerificationStatus,
      });

      // Reset form (same as before)
      setPoDocument(null);
      setVehiclePhoto(null);
      setAsnReference("");
      setPoNumber("");
      setPoVerificationStatus(null);
      setSupplierName("");
      setMaterialDescription("");
      setTotalQuantity("");
      setArrivalLineItems([]);
      setPoDate("");
      setDeliveryDate("");
      setVehicleNumber("");
      setDriverName("Driver");
      setLicenseNumber("");
      setDriverPhone("");
      setPendingFormData(null);
      await loadEntries(true);
    } catch (error) {
      toast.error("Gate entry or dock assignment failed", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  }

  const handleClearAll = async () => {
    if (!confirm("Are you sure you want to delete all gate entry data? This cannot be undone."))
      return;
    try {
      await api.resetGateEntries();
      toast.success("Gate entry data deleted successfully");
      void loadEntries();
    } catch (error) {
      toast.error("Failed to delete data");
    }
  };

  return (
    <AppShell
      title="Gate Entry"
      subtitle="Security verification, vehicle photo capture, and arrival queue management."
      actions={
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="rounded-xl text-destructive hover:bg-destructive/10 border-destructive/20"
            onClick={handleClearAll}
          >
            <Trash2 className="mr-2 size-4" /> Delete all data
          </Button>
          <Button
            variant="outline"
            className="rounded-xl"
            onClick={() => void loadEntries()}
            disabled={loading}
          >
            <RefreshCw className={`mr-2 size-4 ${loading ? "animate-spin" : ""}`} /> Refresh queue
          </Button>
        </div>
      }
    >
      <div className="grid gap-4 xl:grid-cols-3">
        <form onSubmit={submit} className="space-y-4 xl:col-span-2">
          <SectionCard
            title="ASN Reference Lookup (Optional)"
            description="Enter an ASN reference to quickly auto-populate PO, supplier, vehicle, and item details"
            icon={ScanLine}
          >
            <div className="w-full">
              <Label htmlFor="asn_reference">ASN Reference</Label>
              <div className="relative mt-1.5">
                <Input
                  suppressHydrationWarning
                  id="asn_reference"
                  name="asn_reference"
                  value={asnReference}
                  onChange={(e) => setAsnReference(e.target.value)}
                  onBlur={() => void fetchAsnDetails(asnReference)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void fetchAsnDetails(asnReference);
                    }
                  }}
                  placeholder="e.g. ASN-2026-0001 (Press Enter or click refresh to load)"
                  className={cn(inputClass, "pr-10")}
                />
                <button
                  suppressHydrationWarning
                  type="button"
                  onClick={() => void fetchAsnDetails(asnReference)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary transition-colors"
                  title="Load ASN Details"
                >
                  <RefreshCw className="size-4" />
                </button>
              </div>
            </div>
          </SectionCard>

          <SectionCard
            title="Arrival photo capture & upload"
            description="Capture from camera or upload PO photo/PDF and vehicle photo"
            icon={Camera}
          >
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 w-full">
              <ScanCard
                label="PO document"
                detail={poDocument ? "PO document photo ready" : "Optional (Photo/PDF)"}
                kind="po"
                captured={!!poDocument}
                onOpen={setScanning}
                onUpload={(f) => void scanCapture("po", f)}
              />
              <ScanCard
                label="Vehicle photo"
                detail={vehiclePhoto ? "Vehicle photo ready" : "Required"}
                kind="vehicle"
                captured={!!vehiclePhoto}
                onOpen={setScanning}
                onUpload={(f) => void scanCapture("vehicle", f)}
              />
            </div>

            {(poPreview || vehiclePreview) && (
              <div className="mt-6 grid gap-4 grid-cols-1 sm:grid-cols-2 w-full">
                {poPreview && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-[10px] uppercase font-bold text-muted-foreground">
                        PO Document
                      </Label>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 px-1 text-destructive"
                        onClick={() => setPoDocument(null)}
                      >
                        <X className="size-3" />
                      </Button>
                    </div>
                    <div className="aspect-[4/3] rounded-xl border border-border/60 overflow-hidden bg-muted/20">
                      {poDocument?.type === "application/pdf" ? (
                        <iframe src={poPreview} title="PO PDF preview" className="h-full w-full" />
                      ) : (
                        <img
                          src={poPreview}
                          alt="PO Preview"
                          className="w-full h-full object-contain"
                        />
                      )}
                    </div>
                  </div>
                )}
                {vehiclePreview && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-[10px] uppercase font-bold text-muted-foreground">
                        Vehicle Photo <span className="text-destructive">*</span>
                      </Label>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 px-1 text-destructive"
                        onClick={() => setVehiclePhoto(null)}
                      >
                        <X className="size-3" />
                      </Button>
                    </div>
                    <div className="aspect-[4/3] rounded-xl border border-border/60 overflow-hidden bg-muted/20">
                      <img
                        src={vehiclePreview}
                        alt="Vehicle Preview"
                        className="w-full h-full object-contain"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            <p className="mt-4 text-xs text-muted-foreground">
              <ShieldCheck className="mr-1 inline size-3.5 text-primary" />
              Captured images and uploaded PO PDFs stay attached to the audited gate-entry record.
            </p>
          </SectionCard>

          <SectionCard
            title="ASN & PO shipment details"
            description="Entering a PO auto-fetches system records and auto-populates all required fields."
            icon={Truck}
          >
            <datalist id="po-options">
              {availablePos.map((item: any, idx: number) => {
                const num = item.poNumber || item.po_number;
                return num ? <option key={`${num}-${idx}`} value={num}>{item.supplierName || item.supplier_name || ""}</option> : null;
              })}
            </datalist>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="relative">
                <div className="flex items-center justify-between">
                  <Label htmlFor="po_number">
                    Purchase order number <span className="text-destructive">*</span>
                  </Label>
                  {fieldSources.poNumber === "system" && (
                    <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-[10px] py-0 h-4">
                      Auto-Fetched
                    </Badge>
                  )}
                </div>
                <div className="relative">
                  <Input
                    id="po_number"
                    name="po_number"
                    list="po-options"
                    required
                    value={poNumber}
                    onChange={(e) => {
                      setPoNumber(e.target.value);
                      setPoVerificationStatus(null);
                    }}
                    onBlur={() => fetchPoDetails(poNumber)}
                    placeholder="Type or select a PO number (e.g. PO-1001)"
                    className={cn(inputClass, "pr-10 font-mono")}
                  />
                  <button
                    suppressHydrationWarning
                    type="button"
                    onClick={() => fetchPoDetails(poNumber)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary transition-colors"
                    title="Lookup PO details"
                  >
                    <RefreshCw className={cn("size-4", autoFetchingPo && "animate-spin text-primary")} />
                  </button>
                </div>
                {poVerificationStatus && (
                  <div className="mt-2">
                    <StatusBadge status={poVerificationStatus} />
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {poVerificationStatus === "PO_VERIFIED"
                        ? "Exact purchase order found in the procurement database."
                        : "Purchase order was not found; required fields auto-generated for unscheduled arrival."}
                    </p>
                  </div>
                )}
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="supplier_name">
                    Supplier name <span className="text-destructive">*</span>
                  </Label>
                  {fieldSources.supplier === "system" ? (
                    <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-[10px] py-0 h-4">
                      Auto-Fetched
                    </Badge>
                  ) : fieldSources.supplier === "generated" ? (
                    <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30 text-[10px] py-0 h-4">
                      Auto-Generated
                    </Badge>
                  ) : null}
                </div>
                <Input
                  id="supplier_name"
                  name="supplier_name"
                  required
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                  placeholder="Auto-filled from PO"
                  className={inputClass}
                />
              </div>
              {arrivalLineItems.length ? (
                <div className="space-y-3 sm:col-span-2 lg:col-span-3">
                  <Label>Materials detected ({arrivalLineItems.length})</Label>
                  <div className="space-y-3">
                    {arrivalLineItems.map((item, index) => (
                      <div
                        key={`${item.material_code}-${index}`}
                        className="grid gap-3 rounded-xl border border-border/80 bg-muted/20 p-3 sm:grid-cols-2 lg:grid-cols-4"
                      >
                        <div>
                          <Label htmlFor={`material_code_${index}`}>Material code</Label>
                          <Input
                            id={`material_code_${index}`}
                            value={item.material_code}
                            onChange={(e) => updateLineItem(index, "material_code", e.target.value)}
                            className={inputClass}
                          />
                        </div>
                        <div className="lg:col-span-2">
                          <Label htmlFor={`material_description_${index}`}>
                            Material description
                          </Label>
                          <Input
                            id={`material_description_${index}`}
                            value={item.material_description}
                            onChange={(e) =>
                              updateLineItem(index, "material_description", e.target.value)
                            }
                            className={inputClass}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <Label htmlFor={`quantity_${index}`}>Quantity</Label>
                            <Input
                              id={`quantity_${index}`}
                              type="number"
                              min="0"
                              step="any"
                              value={item.quantity}
                              onChange={(e) => updateLineItem(index, "quantity", e.target.value)}
                              className={inputClass}
                            />
                          </div>
                          <div>
                            <Label htmlFor={`uom_${index}`}>UOM</Label>
                            <Input
                              id={`uom_${index}`}
                              value={item.uom}
                              onChange={(e) => updateLineItem(index, "uom", e.target.value)}
                              className={inputClass}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <input type="hidden" name="material_description" value={materialDescription} />
                  <input type="hidden" name="total_quantity" value={totalQuantity} />
                </div>
              ) : (
                <>
                  <div>
                    <Label htmlFor="material_description">Material description</Label>
                    <Input
                      id="material_description"
                      name="material_description"
                      value={materialDescription}
                      onChange={(e) => setMaterialDescription(e.target.value)}
                      placeholder="Auto-filled from PO"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <Label htmlFor="total_quantity">
                      Total quantity <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="total_quantity"
                      name="total_quantity"
                      type="number"
                      min="0.01"
                      step="any"
                      required
                      value={totalQuantity}
                      onChange={(e) => setTotalQuantity(e.target.value)}
                      placeholder="Auto-filled from PO"
                      className={inputClass}
                    />
                  </div>
                </>
              )}
              <div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="po_date">PO date</Label>
                  {fieldSources.dates === "system" ? (
                    <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-[10px] py-0 h-4">
                      Auto-Fetched
                    </Badge>
                  ) : fieldSources.dates === "generated" ? (
                    <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30 text-[10px] py-0 h-4">
                      Auto-Generated
                    </Badge>
                  ) : null}
                </div>
                <Input
                  id="po_date"
                  name="po_date"
                  type="date"
                  value={poDate}
                  onChange={(e) => setPoDate(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="delivery_date">Delivery date</Label>
                  {fieldSources.dates === "system" ? (
                    <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-[10px] py-0 h-4">
                      Auto-Fetched
                    </Badge>
                  ) : fieldSources.dates === "generated" ? (
                    <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30 text-[10px] py-0 h-4">
                      Auto-Generated
                    </Badge>
                  ) : null}
                </div>
                <Input
                  id="delivery_date"
                  name="delivery_date"
                  type="date"
                  value={deliveryDate}
                  onChange={(e) => setDeliveryDate(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div className="relative">
                <Label htmlFor="vehicle_number">
                  Vehicle number <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="vehicle_number"
                  name="vehicle_number"
                  required
                  value={vehicleNumber}
                  onChange={(e) => handleVehicleNumberChange(e.target.value)}
                  placeholder="MH-12-AB-1234"
                  className={cn(
                    inputClass,
                    vehicleNumber && !isValidVehicleNumber(vehicleNumber)
                      ? "border-destructive focus-visible:ring-destructive"
                      : "",
                  )}
                />
                {vehicleNumber && !isValidVehicleNumber(vehicleNumber) && (
                  <p className="absolute -bottom-5 left-0 text-[10px] font-medium text-destructive animate-in fade-in slide-in-from-top-1">
                    Format: MH-12-AB-1234 or 22-BH-1234-AA
                  </p>
                )}
              </div>
            </div>
            {plannedVehicles.length > 0 && (
              <div className="mt-4 rounded-xl border border-border/60 bg-muted/20 p-3">
                <div className="mb-2.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Truck className="size-4 text-primary" />
                    <p className="text-xs font-bold text-foreground">
                      Planned Vehicle Arrivals ({plannedVehicles.length} Vehicle{plannedVehicles.length > 1 ? "s" : ""})
                    </p>
                  </div>
                  <Badge variant="outline" className="text-[10px] font-bold">
                    {plannedVehicles.filter((shipment) =>
                      entries.some(
                        (entry) =>
                          String(entry.poNumber || "").toUpperCase() === poNumber.toUpperCase() &&
                          formatVehicleNumber(entry.vehiclePlate || "") === shipment.vehicleNumber,
                      ),
                    ).length}
                    /{plannedVehicles.length} arrived
                  </Badge>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {plannedVehicles.map((shipment) => {
                    const hasArrived = entries.some(
                      (entry) =>
                        String(entry.poNumber || "").toUpperCase() === poNumber.toUpperCase() &&
                        formatVehicleNumber(entry.vehiclePlate || "") === shipment.vehicleNumber,
                    );
                    const isSelected = vehicleNumber === shipment.vehicleNumber;
                    return (
                      <div
                        key={`${shipment.asnNumber}-${shipment.vehicleNumber}`}
                        onClick={() => {
                          if (hasArrived) return;
                          setVehicleNumber(shipment.vehicleNumber);
                          setAsnReference(shipment.asnNumber);
                          if (shipment.driverName) setDriverName(shipment.driverName);
                          if (shipment.driverPhone) setDriverPhone(shipment.driverPhone);
                        }}
                        className={cn(
                          "flex cursor-pointer items-center justify-between gap-2 rounded-xl border p-2.5 text-xs transition-all",
                          isSelected
                            ? "border-primary bg-primary/10 ring-2 ring-primary/30"
                            : hasArrived
                              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200 cursor-default opacity-80"
                              : "border-border/60 bg-card hover:border-primary/50 hover:bg-accent/40",
                        )}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <input
                            type="radio"
                            name="selected_planned_vehicle"
                            checked={isSelected}
                            onChange={() => {
                              if (hasArrived) return;
                              setVehicleNumber(shipment.vehicleNumber);
                              setAsnReference(shipment.asnNumber);
                              if (shipment.driverName) setDriverName(shipment.driverName);
                              if (shipment.driverPhone) setDriverPhone(shipment.driverPhone);
                            }}
                            disabled={hasArrived}
                            className="size-3.5 accent-primary shrink-0"
                          />
                          <div className="min-w-0">
                            <p className="font-mono font-bold text-foreground truncate">
                              {shipment.vehicleNumber}
                            </p>
                            <p className="text-[10px] text-muted-foreground truncate">
                              {shipment.transporter ? `${shipment.transporter} · ` : ""}
                              {shipment.driverName || "Driver"}
                            </p>
                          </div>
                        </div>
                        <div>
                          {hasArrived ? (
                            <Badge variant="outline" className="text-[9px] bg-emerald-500/20 text-emerald-700 border-emerald-500/40 font-bold">
                              Arrived
                            </Badge>
                          ) : isSelected ? (
                            <Badge variant="outline" className="text-[9px] bg-primary/20 text-primary border-primary/40 font-bold">
                              Selected
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[9px] text-muted-foreground">
                              Select
                            </Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-2 text-[10px] text-muted-foreground">
                  Select a planned vehicle to auto-fill its vehicle number, driver details, and ASN reference.
                </p>
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Driver information"
            description="Add any details that cannot be captured automatically"
            icon={UserRound}
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <Label htmlFor="driver_name">Driver name</Label>
                <Input
                  id="driver_name"
                  name="driver_name"
                  value={driverName}
                  onChange={(e) => setDriverName(e.target.value)}
                  className={inputClass}
                  required
                />
              </div>
              <div>
                <Label htmlFor="driver_license_number">Licence number</Label>
                <Input
                  id="driver_license_number"
                  name="driver_license_number"
                  value={licenseNumber}
                  onChange={(e) => setLicenseNumber(e.target.value)}
                  placeholder="MH12 2016 004821"
                  className={inputClass}
                />
              </div>
              <div>
                <Label htmlFor="driver_phone">Phone number</Label>
                <Input
                  id="driver_phone"
                  name="driver_phone"
                  type="tel"
                  value={driverPhone}
                  onChange={(e) => setDriverPhone(e.target.value)}
                  placeholder="+91 98765 43210"
                  className={inputClass}
                />
              </div>
            </div>
          </SectionCard>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-primary-soft/50 p-4">
            <p className="text-sm text-muted-foreground">
              Creating the entry publishes the verified arrival to the yard in real time.
            </p>
            <Button
              type="submit"
              className="rounded-xl shadow-glow"
              disabled={
                submitting ||
                !vehiclePhoto ||
                !poNumber.trim() ||
                !supplierName.trim() ||
                !totalQuantity ||
                parseFloat(totalQuantity) <= 0 ||
                !vehicleNumber.trim() ||
                !isValidVehicleNumber(vehicleNumber)
              }
            >
              {submitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ArrowRight className="size-4" />
              )}
              {submitting ? "Processing…" : "Next"}
            </Button>
          </div>
        </form>

        <SectionCard
          title="Live gate queue"
          description="Refreshes automatically every 2 seconds"
          icon={CheckCircle2}
        >
          {loading ? (
            <div className="flex min-h-56 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading live entries…
            </div>
          ) : entries.length === 0 ? (
            <div className="grid min-h-56 place-items-center rounded-xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
              No gate entries yet.
            </div>
          ) : (
            <div className="space-y-3">
              {entries.slice(0, 8).map((entry) => (
                <div key={entry.id} className="relative group">
                  <div
                    className="flex items-center gap-3 rounded-xl border border-border/70 p-3 transition-colors hover:border-primary/30 hover:bg-primary-soft/50"
                  >
                    {entry.truckPhotoBase64 ? (
                      <div className="size-14 shrink-0 overflow-hidden rounded-lg border border-border/40">
                        <img
                          src={`data:image/jpeg;base64,${entry.truckPhotoBase64}`}
                          alt="Vehicle"
                          className="h-full w-full object-cover"
                        />
                      </div>
                    ) : (
                      <div className="grid size-14 shrink-0 place-items-center rounded-lg bg-muted border border-border/40 text-muted-foreground">
                        <Truck className="size-6" />
                      </div>
                    )}

                    <QrThumbnail
                      value={gateQrPayload(entry.gate_entry_number || entry.id)}
                      onOpen={() => setQrModalEntry(entry)}
                    />

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-mono text-sm font-semibold text-primary truncate">
                          {entry.vehiclePlate || "NO PLATE"}
                        </p>
                        <StatusBadge status={entry.status} />
                      </div>
                      <p className="mt-0.5 truncate text-sm font-medium">{entry.driverName}</p>
                      <p className="mt-0.5 font-mono text-[10px] text-muted-foreground uppercase tracking-tight">
                        PO: {entry.poNumber}
                      </p>
                      {entry.gate_entry_number && (
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <ScanLine className="size-3 text-muted-foreground" />
                          <p className="font-mono text-[9px] text-muted-foreground/70 uppercase">
                            {entry.gate_entry_number}
                          </p>
                        </div>
                      )}
                      {entry.verificationResult?.reasons?.[0] && (
                        <p className="mt-1.5 text-[10px] text-warning-foreground font-medium">
                          ⚠️ {entry.verificationResult.reasons[0]}
                        </p>
                      )}

                      {(entry.status === "VEHICLE_EXITED" || entry.exited_at || entry.exitedAt) ? (
                        <div className="mt-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs space-y-0.5">
                          <p className="font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                            <ShieldCheck className="size-3.5" /> Status: Gate Exit Approved
                          </p>
                          {(entry.exited_at || entry.exitedAt) && (
                            <p className="text-[10px] text-muted-foreground">
                              <span className="font-medium text-foreground">Approved Exit Time:</span>{" "}
                              {new Date(entry.exited_at || entry.exitedAt!).toLocaleString()}
                            </p>
                          )}
                          {(entry.exited_by || entry.exitedBy) && (
                            <p className="text-[10px] text-muted-foreground">
                              <span className="font-medium text-foreground">Approved By:</span>{" "}
                              {entry.exited_by || entry.exitedBy}
                            </p>
                          )}
                        </div>
                      ) : isEligibleForInboundExit(entry.status) ? (
                        <div className="mt-2">
                          <Button
                            size="sm"
                            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-sm gap-1.5 text-xs h-8"
                            disabled={exitingId === entry.id}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              void handleMarkVehicleExited(entry);
                            }}
                          >
                            {exitingId === entry.id ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <ShieldCheck className="size-3.5" />
                            )}
                            Approve Gate Exit
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-2 bottom-2 size-8 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity bg-background/80 backdrop-blur-sm border border-border/50 shadow-sm"
                    title="Print Gate Pass"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void api.downloadGatePass(entry.id, entry.gate_entry_number);
                    }}
                  >
                    <Printer className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
      <Dialog open={!!qrModalEntry} onOpenChange={(open) => !open && setQrModalEntry(null)}>
        <DialogContent className="max-w-md overflow-hidden rounded-2xl p-0">
          <DialogHeader className="border-b border-border px-6 py-5 text-left">
            <DialogTitle>Gate Entry QR Code</DialogTitle>
            <DialogDescription>
              {qrModalEntry?.vehiclePlate || "Vehicle gate pass"}
            </DialogDescription>
          </DialogHeader>
          {qrModalEntry && (
            <div className="flex flex-col items-center bg-white px-6 py-7 text-slate-950">
              <LargeQrCode value={gateQrPayload(qrModalEntry.gate_entry_number || qrModalEntry.id)} />
              <p className="mt-4 font-mono text-lg font-black tracking-wide">
                {qrModalEntry.gate_entry_number || qrModalEntry.id}
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-600">
                {qrModalEntry.poNumber} · {qrModalEntry.driverName}
              </p>
            </div>
          )}
          <DialogFooter className="border-t border-border px-6 py-4">
            <Button className="w-full" onClick={() => setQrModalEntry(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {scanning && (
        <CameraScanner
          kind={scanning}
          onClose={() => setScanning(null)}
          onCapture={(file) => void scanCapture(scanning, file)}
        />
      )}

      {lastCreatedEntry && (
        <dialog
          ref={approvalDialog}
          onCancel={(event) => {
            event.preventDefault();
            setLastCreatedEntry(null);
            setLastQrCode(null);
          }}
          className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none items-center justify-center overflow-hidden bg-transparent p-4 open:flex backdrop:bg-black/65 backdrop:backdrop-blur-sm"
        >
          <div className="relative max-h-[calc(100dvh-2rem)] w-full max-w-2xl overflow-hidden rounded-3xl border border-border/50 bg-card p-6 sm:p-8 shadow-2xl animate-in zoom-in-95 duration-200">
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-4 top-4 rounded-full"
              onClick={() => {
                setLastCreatedEntry(null);
                setLastQrCode(null);
              }}
            >
              <X className="size-5" />
            </Button>

            <div className="flex items-center gap-3 border-b border-border/50 pb-4 mb-6">
              <div className="grid size-10 place-items-center rounded-full bg-success-soft text-success shrink-0">
                <CheckCircle2 className="size-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold tracking-tight">Gate Entry Approved</h3>
                <p className="text-xs text-muted-foreground">
                  Warehouse Manager notified in real-time.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-6 items-center rounded-2xl border border-dashed border-border bg-muted/30 p-5">
              {/* Left Column - QR Pass */}
              {lastQrCode && (
                <div className="sm:col-span-5 flex flex-col items-center justify-center bg-white p-4 rounded-xl border border-border/50 shadow-sm h-full">
                  <img
                    src={lastQrCode}
                    alt="QR Code"
                    className="size-36 sm:size-40 object-contain"
                  />
                  <span className="mt-3 text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground text-center">
                    Digital Verification Pass
                  </span>
                </div>
              )}

              {/* Right Column - Details */}
              <div className={cn("space-y-4", lastQrCode ? "sm:col-span-7" : "sm:col-span-12")}>
                <div className="border-b border-border/50 pb-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Pass Number
                  </span>
                  <p className="mt-0.5 font-mono text-xl font-black text-primary">
                    {lastCreatedEntry.gate_entry_number}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      PO Number
                    </span>
                    <p className="mt-1 font-mono text-sm font-bold">{lastCreatedEntry.poNumber}</p>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Vehicle No
                    </span>
                    <p className="mt-1 font-mono text-sm font-bold">
                      {lastCreatedEntry.vehiclePlate}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-1">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      PO Verification
                    </span>
                    <div className="mt-1.5">
                      <StatusBadge
                        status={lastCreatedEntry.verificationStatus || "UNSCHEDULED_ARRIVAL"}
                      />
                    </div>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      ASN Status
                    </span>
                    <div className="mt-1.5">
                      {lastCreatedEntry.asnStatus ? (
                        <StatusBadge status={lastCreatedEntry.asnStatus} />
                      ) : (
                        <span className="text-[10px] font-medium text-muted-foreground italic tracking-tight">
                          Direct arrival
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="pt-1 border-t border-border/40">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Dock Allocation
                  </span>
                  {lastCreatedEntry.assignedDock ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <span className="rounded-lg border border-primary/20 bg-primary-soft/40 px-2.5 py-1 font-mono text-sm font-black text-primary">
                        {lastCreatedEntry.assignedDock}
                      </span>
                      <StatusBadge status={lastCreatedEntry.dockAllocationStatus || "DOCK_ASSIGNED"} />
                    </div>
                  ) : (
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <StatusBadge status={lastCreatedEntry.dockAllocationStatus || "AWAITING_DOCK"} />
                      <span className="text-[11px] font-medium text-muted-foreground">
                        Waiting for Warehouse Manager allocation in Dock Management.
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <Button
                variant="outline"
                className="rounded-xl font-bold px-6"
                onClick={() => {
                  setLastCreatedEntry(null);
                  setLastQrCode(null);
                }}
              >
                Done
              </Button>
              <Button
                className="rounded-xl font-bold shadow-glow px-6"
                onClick={() =>
                  void api.downloadGatePass(lastCreatedEntry.id, lastCreatedEntry.gate_entry_number)
                }
              >
                <Printer className="mr-2 size-4" /> Print Pass
              </Button>
            </div>
          </div>
        </dialog>
      )}

      {/* Dock Selection Modal */}
      <Dialog open={isDockModalOpen} onOpenChange={setIsDockModalOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col rounded-[32px] p-0 overflow-hidden border-none shadow-2xl">
          <div className="shrink-0 bg-primary p-6 text-white">
            <DialogHeader>
              <DialogTitle className="text-2xl font-black flex items-center gap-3">
                <TableIcon className="size-7" /> Dock Allocation
              </DialogTitle>
              <DialogDescription className="text-white/80 font-medium text-base mt-1.5">
                Select an available unloading bay for{" "}
                <span className="text-white font-black underline underline-offset-4">
                  {vehicleNumber}
                </span>
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Status Legend */}
            <div className="flex flex-wrap gap-4 p-4 rounded-2xl bg-muted/30 border border-border/40">
              <div className="flex items-center gap-2">
                <div className="size-4 rounded-full bg-success" />
                <span className="text-[10px] font-black uppercase text-muted-foreground">
                  Available
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="size-4 rounded-full bg-destructive" />
                <span className="text-[10px] font-black uppercase text-muted-foreground">
                  Occupied
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="size-4 rounded-full bg-orange-500" />
                <span className="text-[10px] font-black uppercase text-muted-foreground">
                  Maintenance
                </span>
              </div>
            </div>

            {loadingDocks ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <Loader2 className="size-10 animate-spin text-primary" />
                <p className="text-sm font-bold text-muted-foreground">Scanning yard status...</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {docks.map((dock) => {
                  const status = String(dock.status || "").toUpperCase();
                  const isAvailable = status === "AVAILABLE";
                  const isOccupied = status === "OCCUPIED" || status === "UNLOADING";
                  const isMaintenance = status === "MAINTENANCE";
                  const dockIdentifier = dock.id || dock.dock_number || dock.dock_code;

                  return (
                    <button
                      key={dock.id}
                      disabled={!isAvailable}
                      onClick={() => setSelectedDockId(dockIdentifier)}
                      className={cn(
                        "relative flex flex-col p-4 rounded-2xl border-2 text-left transition-all duration-300 group overflow-hidden",
                        selectedDockId === dockIdentifier
                          ? "border-primary bg-primary-soft/20 ring-2 ring-primary shadow-xl"
                          : isAvailable
                            ? "border-success/20 bg-success/5 hover:border-success hover:bg-success/10 hover:shadow-lg hover:-translate-y-1 cursor-pointer"
                            : isOccupied
                              ? "border-destructive/10 bg-destructive/5 opacity-60 cursor-not-allowed"
                              : "border-orange-200 bg-orange-50/50 opacity-60 cursor-not-allowed",
                      )}
                    >
                      {(isAvailable || selectedDockId === dockIdentifier) && (
                        <div
                          className={cn(
                            "absolute top-2 right-2 transition-opacity",
                            selectedDockId === dockIdentifier
                              ? "opacity-100"
                              : "opacity-0 group-hover:opacity-100",
                          )}
                        >
                          <CheckCircle2
                            className={cn(
                              "size-4",
                              selectedDockId === dockIdentifier ? "text-primary" : "text-success",
                            )}
                          />
                        </div>
                      )}
                      <span className="text-[10px] font-black uppercase text-muted-foreground/60 tracking-widest mb-1">
                        Dock
                      </span>
                      <span
                        className={cn(
                          "text-xl font-black mb-2 truncate",
                          isAvailable
                            ? "text-success"
                            : isOccupied
                              ? "text-destructive"
                              : "text-orange-600",
                        )}
                      >
                        {dock.dock_number || dock.dock_code || dock.dock_name || "Bay"}
                      </span>

                      <div className="mt-auto pt-3 border-t border-border/20 flex flex-col gap-1">
                        <span className="text-[9px] font-bold text-muted-foreground truncate uppercase">
                          {dock.dock_type || "General"}
                        </span>
                        <span
                          className={cn(
                            "text-[9px] font-black uppercase px-2 py-0.5 rounded-full w-fit",
                            isAvailable
                              ? "bg-success/10 text-success"
                              : isOccupied
                                ? "bg-destructive/10 text-destructive"
                                : "bg-orange-100 text-orange-700",
                          )}
                        >
                          {status.replace("_", " ")}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <DialogFooter className="shrink-0 p-6 bg-muted/10 border-t border-border/60 flex items-center justify-between">
            <Button
              variant="ghost"
              className="rounded-xl font-bold uppercase text-xs tracking-widest"
              onClick={() => {
                setIsDockModalOpen(false);
                setPendingFormData(null);
                setSelectedDockId(null);
                setLastQrCode(null);
              }}
            >
              Cancel
            </Button>
            <Button
              className="rounded-xl font-bold uppercase text-xs tracking-widest shadow-glow h-11 px-8"
              disabled={!selectedDockId || submitting}
              onClick={() => selectedDockId && handleDockAssignment(selectedDockId)}
            >
              {submitting ? (
                <Loader2 className="size-4 animate-spin mr-2" />
              ) : (
                <TableIcon className="size-4 mr-2" />
              )}
              Assign Dock
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function ScanCard({
  label,
  detail,
  kind,
  captured,
  onOpen,
  onUpload,
  hideCamera = false,
}: {
  label: string;
  detail: string;
  kind: CaptureKind;
  captured: boolean;
  onOpen: (kind: CaptureKind) => void;
  onUpload: (file: File) => void;
  hideCamera?: boolean;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const isRequired = detail.toLowerCase().includes("required");

  return (
    <div
      suppressHydrationWarning
      className={cn(
        "relative flex flex-col justify-between rounded-2xl border p-4 transition-all duration-200",
        captured
          ? "border-success/40 bg-success-soft/20 shadow-sm"
          : isRequired
            ? "border-primary/30 bg-card hover:border-primary/50 hover:shadow-md"
            : "border-border bg-card hover:border-primary/30 hover:shadow-sm",
      )}
    >
      <div
        suppressHydrationWarning
        role="button"
        tabIndex={0}
        onClick={() => (hideCamera ? fileInput.current?.click() : onOpen(kind))}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            if (hideCamera) {
              fileInput.current?.click();
            } else {
              onOpen(kind);
            }
          }
        }}
        className="cursor-pointer space-y-3"
      >
        <div className="flex items-center justify-between">
          <span
            className={cn(
              "grid size-10 place-items-center rounded-xl transition-colors",
              captured
                ? "bg-success text-success-foreground shadow-sm"
                : "bg-primary/10 text-primary",
            )}
          >
            {captured ? (
              <CheckCircle2 className="size-5" />
            ) : hideCamera ? (
              <Upload className="size-5" />
            ) : (
              <Camera className="size-5" />
            )}
          </span>
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] font-bold uppercase tracking-wider",
              captured
                ? "border-success/30 bg-success-soft text-success"
                : isRequired
                  ? "border-destructive/30 bg-destructive/10 text-destructive"
                  : "border-border text-muted-foreground",
            )}
          >
            {captured ? "Attached" : isRequired ? "Required *" : "Optional"}
          </Badge>
        </div>

        <div>
          <p className="text-sm font-semibold text-foreground">{label}</p>
          <p className="text-xs text-muted-foreground">{detail}</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 pt-3 border-t border-border/50">
        {!hideCamera && (
          <Button
            suppressHydrationWarning
            type="button"
            variant="outline"
            size="sm"
            className="h-8 w-full rounded-xl text-xs font-semibold bg-background hover:bg-primary-soft hover:text-primary hover:border-primary/40 transition-colors"
            onClick={() => onOpen(kind)}
          >
            <Camera className="mr-1.5 size-3.5" /> Camera
          </Button>
        )}
        <Button
          suppressHydrationWarning
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            "h-8 w-full rounded-xl text-xs font-semibold transition-colors",
            hideCamera
              ? "col-span-2 bg-primary text-primary-foreground hover:bg-primary/90"
              : "bg-background hover:bg-primary-soft hover:text-primary hover:border-primary/40",
          )}
          onClick={() => fileInput.current?.click()}
        >
          <Upload className="mr-1.5 size-3.5" /> Upload
        </Button>
      </div>

      <input
        suppressHydrationWarning
        type="file"
        ref={fileInput}
        className="hidden"
        accept={kind === "po" ? "image/*,application/pdf,.pdf" : "image/*"}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const isImage = file.type.startsWith("image/");
          const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
          if (!isImage && !(kind === "po" && isPdf)) {
            toast.error(
              kind === "po"
                ? "Please upload an image or PDF document"
                : "Please upload an image file",
            );
            e.target.value = "";
            return;
          }
          onUpload(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function ExtractedDetails({ details }: { details: Record<string, unknown> }) {
  const fields =
    details.fields && typeof details.fields === "object" && !Array.isArray(details.fields)
      ? (details.fields as Record<string, unknown>)
      : details;
  const entries = Object.entries(fields).filter(
    ([, value]) => value !== null && value !== "" && typeof value !== "object",
  );
  const rawText = typeof details.raw_text === "string" ? details.raw_text : "";

  return (
    <div className="space-y-4">
      {entries.length > 0 ? (
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {entries.map(([label, value]) => (
            <div key={label} className="border-b border-border/60 pb-2">
              <dt className="text-xs capitalize text-muted-foreground">
                {label.replace(/_/g, " ")}
              </dt>
              <dd className="mt-0.5 break-words text-sm font-medium">{String(value)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">
          No readable structured details were found in this image.
        </p>
      )}
      {rawText && (
        <details className="rounded-xl border border-border bg-muted/30 p-3">
          <summary className="cursor-pointer text-sm font-medium">View all readable text</summary>
          <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap font-sans text-xs text-muted-foreground">
            {rawText}
          </pre>
        </details>
      )}
    </div>
  );
}

function CameraScanner({
  kind,
  onClose,
  onCapture,
}: {
  kind: CaptureKind;
  onClose: () => void;
  onCapture: (file: File) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState("");
  const [cameraReady, setCameraReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    if (navigator.mediaDevices?.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
        .then((active) => {
          if (mounted) {
            stream.current = active;
            if (video.current) {
              video.current.srcObject = active;
            }
          } else {
            active.getTracks().forEach((track) => track.stop());
          }
        })
        .catch((err) => {
          console.error("Camera access error:", err);
          if (mounted) setError("Camera access was blocked. Allow camera access and try again.");
        });
    } else {
      setError("Camera not supported on this browser.");
    }

    return () => {
      mounted = false;
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      if (stream.current) {
        stream.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => {
      if (element?.open) element.close();
    };
  }, []);

  function capture() {
    const element = video.current;
    if (!element || !element.videoWidth) return;

    const canvas = document.createElement("canvas");
    const maxDim = 2000;
    let width = element.videoWidth;
    let height = element.videoHeight;

    if (width > height) {
      if (width > maxDim) {
        height *= maxDim / width;
        width = maxDim;
      }
    } else {
      if (height > maxDim) {
        width *= maxDim / height;
        height = maxDim;
      }
    }

    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.drawImage(element, 0, 0, width, height);
    canvas.toBlob(
      (blob) => {
        if (blob) {
          onCapture(new File([blob], `${kind}-scan-${Date.now()}.jpg`, { type: "image/jpeg" }));
        }
      },
      "image/jpeg",
      0.95,
    );
  }

  const title = kind === "po" ? "Capture PO document photo" : "Capture vehicle photo";

  return createPortal(
    <dialog
      ref={dialog}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none items-center justify-center overflow-hidden bg-transparent p-4 open:flex backdrop:bg-black/75 backdrop:backdrop-blur-sm"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="vehicle-camera-title"
        className="flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border/50 bg-card shadow-2xl"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border/50 px-4 py-3 sm:px-6 sm:py-4">
          <div className="min-w-0">
            <h3
              id="vehicle-camera-title"
              className="truncate text-base font-bold tracking-tight sm:text-lg"
            >
              {title}
            </h3>
            <p className="text-xs text-muted-foreground">
              Keep the complete vehicle and number plate inside the frame.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="rounded-full"
            onClick={onClose}
          >
            <X className="size-5" />
          </Button>
        </div>

        {/* Camera Feed Container */}
        <div className="relative h-[clamp(240px,45dvh,420px)] shrink-0 bg-black">
          {error ? (
            <div className="flex h-64 flex-col items-center justify-center p-8 text-center">
              <div className="mb-4 rounded-full bg-destructive/10 p-3 text-destructive">
                <X className="size-6" />
              </div>
              <p className="text-sm font-medium text-destructive">{error}</p>
            </div>
          ) : (
            <>
              <video
                ref={video}
                autoPlay
                playsInline
                muted
                onCanPlay={() => setCameraReady(true)}
                className="block h-full w-full object-contain"
              />
              {!cameraReady && (
                <div className="absolute inset-0 grid place-items-center bg-black text-white">
                  <div className="flex items-center gap-2 text-sm">
                    <Loader2 className="size-5 animate-spin" /> Starting camera…
                  </div>
                </div>
              )}
              <div className="pointer-events-none absolute inset-x-[8%] bottom-[10%] top-[10%] rounded-2xl border-2 border-dashed border-white/60" />
            </>
          )}
        </div>

        {/* Footer */}
        <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-border/50 p-3 sm:flex sm:justify-end sm:gap-3 sm:p-5">
          <Button
            type="button"
            variant="outline"
            className="h-11 rounded-xl px-4 font-bold sm:px-6"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="h-11 rounded-xl px-4 font-bold shadow-glow sm:px-8"
            disabled={!!error || !cameraReady}
            onClick={capture}
          >
            <Camera className="mr-2 size-4" /> Capture & scan
          </Button>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
