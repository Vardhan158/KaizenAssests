import { InformationTooltip } from "@/components/ui/information-tooltip";
import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Calendar as CalendarIcon,
  CheckCircle2,
  Download,
  Eye,
  FileText,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  XCircle,
} from "lucide-react";
import { AppShell } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { getUserInfo } from "@/lib/auth-utils";
import type { DateRange } from "react-day-picker";
import {
  isIntegerQuantityUom,
  isValidAsnQuantity,
  isValidAsnVehicleNumber,
  isValidDateInput,
  isValidAsnDriverMobileNumber,
  isValidAsnDriverName,
  normalizeAsnVehicleNumber,
  sanitizeMobileNumber,
  sanitizeNumericQuantity,
} from "@/lib/input-validation";

export const Route = createFileRoute("/supplier/asns/new")({
  beforeLoad: () => { },
  component: NewAsnPage,
});

const inputClass = "mt-1.5 h-10 rounded-xl border-border/80 bg-background text-xs font-semibold";
const formInputClass = "mt-1.5 h-10 w-full rounded-lg border-border bg-background text-sm";
const todayDate = () => {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
};
const dateToFilterValue = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const displayFilterDate = (value: string) => {
  if (!value) return "";
  const dateValue = value.split("T")[0];
  const date = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const statusDescriptions: Record<string, string> = {
  SUBMITTED: "Your delivery notice has been submitted and is awaiting further processing.",
  APPROVED: "Delivery approved by warehouse operations.",
  PENDING: "Delivery notice is pending review or confirmation.",
  CANCELLED: "This delivery notice was cancelled and will not be received.",
  GATE_ENTRY_CREATED: "Vehicle checked in at security gate and awaiting dock bay assignment.",
  AWAITING_DOCK: "Vehicle checked in at security gate and awaiting dock bay assignment.",
  DOCK_ALLOCATED: "Dock bay assigned. Vehicle is moving to unloading bay.",
  DOCK_ASSIGNED: "Dock bay assigned. Vehicle is moving to unloading bay.",
  RECEIVING: "Vehicle at bay. Unloading and physical verification in progress.",
  OCCUPIED: "Vehicle at bay. Unloading and physical verification in progress.",
  UNLOADING_IN_PROGRESS: "Goods are currently being unloaded at the dock bay.",
  QUALITY_INSPECTION_REQUIRED: "Materials undergoing QC inspection before receiving.",
  GRN_PENDING: "Materials unloaded. Goods Receipt Note (GRN) being prepared.",
  GRN_POSTED: "Goods Receipt Note posted. Materials accepted into inventory.",
  COMPLETED: "Delivery completed and goods accepted into inventory.",
  VEHICLE_EXITED: "Vehicle has completed delivery and exited the factory premises.",
};

const statusStyles: Record<string, string> = {
  SUBMITTED: "border-primary/25 bg-primary-soft text-primary",
  GATE_ENTRY_CREATED: "border-primary/25 bg-primary-soft text-primary",
  DOCK_ALLOCATED: "border-primary/25 bg-primary-soft text-primary",
  DOCK_ASSIGNED: "border-primary/25 bg-primary-soft text-primary",
  RECEIVING: "border-primary/25 bg-primary-soft text-primary",
  OCCUPIED: "border-primary/25 bg-primary-soft text-primary",
  UNLOADING_IN_PROGRESS: "border-primary/25 bg-primary-soft text-primary",
  APPROVED: "border-success/30 bg-success-soft text-success",
  COMPLETED: "border-success/30 bg-success-soft text-success",
  GRN_POSTED: "border-success/30 bg-success-soft text-success",
  VEHICLE_EXITED: "border-success/30 bg-success-soft text-success",
  PENDING: "border-warning/30 bg-warning-soft text-warning-foreground",
  AWAITING_DOCK: "border-warning/30 bg-warning-soft text-warning-foreground",
  QUALITY_INSPECTION_REQUIRED: "border-warning/30 bg-warning-soft text-warning-foreground",
  GRN_PENDING: "border-warning/30 bg-warning-soft text-warning-foreground",
  CANCELLED: "border-destructive/25 bg-danger-soft text-destructive",
};


function TapTooltip({ text, children }: { text: string; children: ReactElement }) {
  const [open, setOpen] = useState(false);

  return (
    <Tooltip open={open} onOpenChange={setOpen} delayDuration={150}>
      <TooltipTrigger asChild onClick={() => setOpen((current) => !current)}>
        {children}
      </TooltipTrigger>
      <TooltipContent className="max-w-xs rounded-lg border border-border bg-popover text-xs font-medium leading-5 text-popover-foreground shadow-soft">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

function StatusTooltip({ status }: { status: string }) {
  const [open, setOpen] = useState(false);
  const normalizedStatus = status.trim().toUpperCase();
  if (!normalizedStatus) {
    return <span className="text-muted-foreground">—</span>;
  }
  const description = statusDescriptions[normalizedStatus];
  const badge = (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${statusStyles[normalizedStatus] || "border-border bg-muted text-muted-foreground"
        }`}
    >
      {normalizedStatus.replaceAll("_", " ")}
    </span>
  );

  if (!description) return badge;

  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`${normalizedStatus.replaceAll("_", " ")} status: ${description}`}
          onClick={() => setOpen((current) => !current)}
          className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {badge}
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs rounded-lg border border-border bg-popover text-xs font-medium text-popover-foreground shadow-soft">
        {description}
      </TooltipContent>
    </Tooltip>
  );
}

interface AsnRecord {
  id: string;
  asn_number: string;
  po_number: string;
  supplier_name: string;
  destination_warehouse: string;
  vehicle_number: string;
  driver_name: string;
  driver_contact: string;
  delivery_date?: string;
  expected_arrival_date?: string;
  expected_arrival_at?: string;
  status: string;
  created_at: string;
  lines: any[];
}

const INITIAL_ASNS: AsnRecord[] = [];

function NewAsnPage() {
  const search = useSearch({ strict: false }) as any;

  const [asnList, setAsnList] = useState<AsnRecord[]>(INITIAL_ASNS);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [arrivalFrom, setArrivalFrom] = useState("");
  const [arrivalTo, setArrivalTo] = useState("");
  const [arrivalRangeOpen, setArrivalRangeOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAssignmentOpen, setIsAssignmentOpen] = useState(false);
  const [assignmentSubmitting, setAssignmentSubmitting] = useState(false);
  const [assignmentTouched, setAssignmentTouched] = useState({
    vehicle: false,
    driver: false,
    contact: false,
  });
  const [asnSubmitted, setAsnSubmitted] = useState(false);
  const [isMaterialPopupOpen, setIsMaterialPopupOpen] = useState(false);
  const [customMaterialRowIndex, setCustomMaterialRowIndex] = useState<number | null>(null);
  const [customMaterialName, setCustomMaterialName] = useState("");
  const [manualVehicle, setManualVehicle] = useState(false);
  const [manualDriver, setManualDriver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [asnFormErrors, setAsnFormErrors] = useState<Record<string, string>>({});
  const [submissionError, setSubmissionError] = useState("");
  const [creatingMaterial, setCreatingMaterial] = useState(false);
  const [materialLoading, setMaterialLoading] = useState(true);
  const [materialLoadError, setMaterialLoadError] = useState("");
  const [selectedAsn, setSelectedAsn] = useState<AsnRecord | null>(null);
  const [asnPendingDelete, setAsnPendingDelete] = useState<AsnRecord | null>(null);

  // Modal Form Inputs
  const [asnNumber, setAsnNumber] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [supplierCompanyName, setSupplierCompanyName] = useState("");
  const [expectedArrivalDate, setExpectedArrivalDate] = useState("");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [driverName, setDriverName] = useState("");
  const [driverMobile, setDriverMobile] = useState("");
  const [registeredDrivers, setRegisteredDrivers] = useState<any[]>([]);
  const [lines, setLines] = useState<any[]>([
    { material_id: "", item_code: "", material_name: "", shipped_quantity: "", uom: "" },
  ]);

  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);
  const [materialCatalog, setMaterialCatalog] = useState<any[]>([]);
  const [selectedPo, setSelectedPo] = useState<any>(null);
  const currentUser = getUserInfo();
  const requestIdRef = useRef("");
  const submitInFlightRef = useRef(false);

  const loadActiveMaterials = useCallback(async () => {
    setMaterialLoading(true);
    setMaterialLoadError("");
    try {
      const materials = await api.getMaterials({ status: "ACTIVE" });
      setMaterialCatalog(
        (Array.isArray(materials) ? materials : [])
          .filter((material: any) => String(material.status || "ACTIVE").toUpperCase() === "ACTIVE")
          .map((material: any) => ({
            ...material,
            id: material.id || material.material_id,
            code: material.code || material.material_code,
            name: material.name || material.material_name,
            uom: material.uom || material.base_uom || material.unit_of_measure,
          }))
          .filter((material: any) => material.id && material.code && material.name && material.uom),
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to load active Material Master records.";
      setMaterialCatalog([]);
      setMaterialLoadError(message);
    } finally {
      setMaterialLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAsnData();
    void (
      currentUser?.supplierId
        ? api.getSupplier(currentUser.supplierId)
        : api.getSuppliers({ search: currentUser?.username })
    )
      .then((result: any) => {
        const supplierRows = Array.isArray(result)
          ? result
          : result?.items || result?.suppliers || [];
        const supplier = supplierRows.length
          ? supplierRows.find(
            (item: any) =>
              String(item.id) === String(currentUser?.supplierId) ||
              String(item.username || item.supplier_name || "").toLowerCase() ===
              String(currentUser?.username || "").toLowerCase(),
          )
          : result;
        const companyName =
          supplier?.registered_company_name ||
          supplier?.company_name ||
          supplier?.supplier_name ||
          "";
        setSupplierCompanyName(companyName);
        if (companyName) setSupplierName(companyName);
      })
      .catch((error) => {
        toast.error("Unable to load supplier account details", {
          description: error instanceof Error ? error.message : undefined,
        });
      });
    void loadActiveMaterials();
    void api
      .getDrivers()
      .catch(() => [])
      .then((drivers) => {
        setRegisteredDrivers(
          (drivers || []).filter(
            (d: any) =>
              d.is_active !== false && String(d.status || "ACTIVE").toUpperCase() === "ACTIVE",
          ),
        );
      });
  }, [loadActiveMaterials]);

  const loadAsnData = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const remoteAsns = await api.getAsns(currentUser?.supplierId);
      const mapped = (Array.isArray(remoteAsns) ? remoteAsns : []).map((a: any) => ({
        id: String(a.id || a.asn_number || ""),
        asn_number: a.asn_number || "",
        po_number: a.po_number || "",
        supplier_name:
          a.supplier_name || a.supplier_company_name || a.supplier?.supplier_name || "",
        destination_warehouse:
          a.destination_warehouse || a.warehouse_name || a.delivery_warehouse_name || "",
        vehicle_number: a.vehicle_number || "",
        driver_name: a.driver_name || "",
        driver_contact: a.driver_contact || "",
        // Preserve the persisted value returned by the API across reloads/sessions.
        expected_arrival_at: a.expected_arrival_at || undefined,
        expected_arrival_date: a.expected_arrival_date || undefined,
        delivery_date: a.delivery_date || undefined,
        status: a.status || "",
        created_at: a.created_at || a.submitted_at || "",
        lines: Array.isArray(a.lines) ? a.lines : [],
      }));
      setAsnList(mapped);
    } catch {
      setAsnList([]);
      setLoadError("Unable to load ASN records.");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenCreateModal = async () => {
    // Reset state synchronously BEFORE opening dialog to prevent race condition
    requestIdRef.current = window.crypto.randomUUID();
    setAsnNumber("");
    setAsnFormErrors({});
    setSubmissionError("");
    setExpectedArrivalDate(todayDate());
    setSupplierName(supplierCompanyName || currentUser?.full_name || currentUser?.username || "");
    setSelectedPo(null);
    setVehicleNumber("");
    setDriverName("");
    setDriverMobile("");
    setAssignmentTouched({ vehicle: false, driver: false, contact: false });
    setAssignmentSubmitting(false);
    setManualVehicle(false);
    setManualDriver(false);
    setLines([
      { material_id: "", item_code: "", material_name: "", shipped_quantity: "", uom: "" },
    ]);
    setIsAssignmentOpen(true);

    try {
      const next = await api.getNextAsnNumber();
      if (next?.asnNumber) setAsnNumber(next.asnNumber);
    } catch (error) {
      toast.error("ASN number preview is unavailable", {
        description:
          error instanceof Error
            ? error.message
            : "The ASN number will be assigned when submitted.",
      });
    }
  };

  useEffect(() => {
    if (search?.open === "create") {
      void handleOpenCreateModal();
    }
  }, [search?.open]);

  const continueToAsnForm = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (assignmentSubmitting) return;
    const normalizedVehicle = normalizeAsnVehicleNumber(vehicleNumber);
    const normalizedDriver = driverName.trim().replace(/ +/g, " ");
    const normalizedContact = driverMobile.trim();
    setAssignmentTouched({ vehicle: true, driver: true, contact: true });
    setVehicleNumber(normalizedVehicle);
    setDriverName(normalizedDriver);
    setDriverMobile(normalizedContact);
    const invalidField = !isValidAsnVehicleNumber(normalizedVehicle)
      ? "assignment-vehicle"
      : !isValidAsnDriverName(normalizedDriver)
        ? "assignment-driver"
        : !isValidAsnDriverMobileNumber(normalizedContact)
          ? "assignment-contact"
          : "";
    if (invalidField) {
      document.getElementById(invalidField)?.focus();
      return;
    }
    setAssignmentSubmitting(true);
    window.setTimeout(() => {
      setIsAssignmentOpen(false);
      setIsModalOpen(true);
      setAssignmentSubmitting(false);
    }, 150);
  };

  const handleAddNewCustomMaterial = async () => {
    const compName = customMaterialName.trim();
    if (!compName || creatingMaterial) return;
    setCreatingMaterial(true);
    try {
      const created = await api.createMaterialComponent(compName.trim(), "PCS");
      const refreshedMaterials = await api.getMaterials({ status: "ACTIVE" });
      const normalizedMaterials = (refreshedMaterials || []).map((material: any) => ({
        ...material,
        id: material.id || material.material_id,
        code: material.code || material.material_code,
        name: material.name || material.material_name,
        uom: material.uom || material.base_uom || material.unit_of_measure,
      }));
      const createdId = String(created.id || created.material_id || "");
      const selectedMaterial =
        normalizedMaterials.find((material: any) => String(material.id) === createdId) ||
        normalizedMaterials.find(
          (material: any) =>
            String(material.code) === String(created.code || created.material_code),
        );
      if (!selectedMaterial?.id || !selectedMaterial.uom) {
        throw new Error(
          "Material was created, but its canonical Material Master record or UOM could not be loaded.",
        );
      }
      setMaterialCatalog(normalizedMaterials);
      const createdMaterial = {
        material_id: selectedMaterial.id,
        item_code: selectedMaterial.code,
        material_name: selectedMaterial.name,
        shipped_quantity: "1",
        uom: selectedMaterial.uom,
      };
      setLines((prev) => {
        const targetIndex =
          customMaterialRowIndex ?? prev.findIndex((line) => !line.material_id && !line.item_code);
        if (targetIndex < 0) return [...prev, createdMaterial];
        return prev.map((line, index) =>
          index === targetIndex ? { ...line, ...createdMaterial } : line,
        );
      });
      toast.success(`Component '${selectedMaterial.name}' saved to Database ✓`, {
        description: `Code: ${selectedMaterial.code} · UOM: ${selectedMaterial.uom}`,
      });
      setCustomMaterialName("");
      setIsMaterialPopupOpen(false);
    } catch (error) {
      toast.error("Failed to save material to database", {
        description: error instanceof Error ? error.message : "The material was not saved.",
      });
    } finally {
      setCreatingMaterial(false);
    }
  };

  const selectPurchaseOrder = async (id: string) => {
    if (!id) {
      setSelectedPo(null);
      setLines([]);
      return;
    }
    const po = await api.getPurchaseOrder(id);
    setSelectedPo(po);
    const poLines = po?.lines || po?.items || po?.materials || po?.purchase_order_lines || [];
    setLines(
      poLines.map((line: any) => ({
        item_code: line.item_code || line.material_code || line.code || "",
        material_name: line.material_name || line.material?.name || line.name || "",
        shipped_quantity: "",
        remaining_quantity: Number(
          line.remaining_quantity ??
          line.remaining ??
          line.balance_quantity ??
          line.ordered_quantity ??
          line.quantity ??
          0,
        ),
        uom: line.uom || line.unit_of_measure || "PCS",
      })),
    );
  };

  const handleFormSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitInFlightRef.current) return;
    if (!isValidAsnVehicleNumber(vehicleNumber) || !isValidAsnDriverName(driverName) ||
      !isValidAsnDriverMobileNumber(driverMobile)) {
      setAssignmentTouched({ vehicle: true, driver: true, contact: true });
      setIsModalOpen(false);
      setIsAssignmentOpen(true);
      return;
    }
    const errors: Record<string, string> = {};
    if (!isValidDateInput(expectedArrivalDate)) {
      errors["expected-arrival-date"] = "Enter a valid expected arrival date.";
    } else if (expectedArrivalDate < todayDate()) {
      errors["expected-arrival-date"] = "Expected arrival date cannot be before today.";
    }
    if (!lines.length) {
      errors["material-0"] = "Add at least one material from Material Master.";
    }
    const selectedMaterialIds = new Set<string>();
    lines.forEach((line, index) => {
      const material = materialCatalog.find(
        (entry) => String(entry.id) === String(line.material_id),
      );
      if (!material || (material.status && String(material.status).toUpperCase() !== "ACTIVE")) {
        errors[`material-${index}`] = "Select an active material from Material Master.";
      } else if (selectedMaterialIds.has(String(material.id))) {
        errors[`material-${index}`] = "This material is already selected.";
      } else {
        selectedMaterialIds.add(String(material.id));
      }
      if (!isValidAsnQuantity(line.shipped_quantity, line.uom || material?.uom || "")) {
        errors[`quantity-${index}`] = material
          ? `Enter a positive quantity allowed for ${material.uom}.`
          : "Enter a valid positive quantity.";
      }
    });
    setAsnFormErrors(errors);
    setSubmissionError("");
    if (Object.keys(errors).length) {
      const firstInvalidId = Object.keys(errors)[0];
      if (firstInvalidId) {
        const firstInvalid = document.getElementById(firstInvalidId);
        firstInvalid?.focus();
        firstInvalid?.scrollIntoView({ block: "center", behavior: "smooth" });
      }
      return;
    }

    submitInFlightRef.current = true;
    setSubmitting(true);
    try {
      const payload = {
        client_request_id:
          requestIdRef.current || (requestIdRef.current = window.crypto.randomUUID()),
        po_number: undefined,
        supplier_name: supplierName.trim(),
        expected_arrival_at: expectedArrivalDate,
        vehicle_number: normalizeAsnVehicleNumber(vehicleNumber),
        driver_name: driverName.trim().replace(/ +/g, " "),
        driver_contact: driverMobile.trim(),
        lines: lines.map((l) => ({
          material_id: l.material_id,
          item_code: l.item_code,
          material_name: l.material_name,
          shipped_quantity: String(l.shipped_quantity).trim(),
          uom: l.uom,
        })),
        status: "SUBMITTED",
      };

      const createdAsn = await api.createAsn(payload);
      const createdAsnNumber = createdAsn?.asn_number || asnNumber;
      const createdSupplierName = createdAsn?.supplier_name || supplierName.trim();

      const newRecord: AsnRecord = {
        // Keep the server identifier so the PDF endpoint can resolve this
        // newly-created ASN immediately. Fall back to the number for older
        // backend responses, which also support number-based lookup.
        id: String(createdAsn?.id || createdAsn?.asn_id || createdAsnNumber),
        asn_number: createdAsnNumber,
        po_number: "",
        supplier_name: createdSupplierName,
        destination_warehouse: createdAsn?.destination_warehouse || "",
        vehicle_number: createdAsn?.vehicle_number || payload.vehicle_number,
        driver_name: createdAsn?.driver_name || payload.driver_name,
        driver_contact: createdAsn?.driver_contact || payload.driver_contact,
        expected_arrival_at: createdAsn?.expected_arrival_at || expectedArrivalDate,
        status: createdAsn?.status || "SUBMITTED",
        created_at: createdAsn?.created_at || new Date().toISOString(),
        lines: Array.isArray(createdAsn?.lines) ? createdAsn.lines : payload.lines,
      };

      setAsnList((prev) => [newRecord, ...prev]);
      setAsnSubmitted(true);
      setIsModalOpen(false);
      setIsAssignmentOpen(false);

      setAsnNumber(createdAsnNumber);
      toast.success(`ASN ${createdAsnNumber} submitted successfully`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not create ASN.";
      setSubmissionError(message);
      toast.error("ASN creation failed", { description: message });
    } finally {
      submitInFlightRef.current = false;
      setSubmitting(false);
    }
  };

  const downloadSelectedAsn = async () => {
    if (!selectedAsn) return;
    try {
      await api.downloadAsnPdf(selectedAsn.asn_number);
      toast.success("ASN PDF downloaded");
    } catch (error: any) {
      toast.error(error?.message || "Unable to download ASN");
    }
  };

  const cancelSelectedAsn = async () => {
    if (!selectedAsn) return;
    try {
      const updated = await api.cancelAsn(selectedAsn.asn_number);
      setAsnList((rows) =>
        rows.map((row) =>
          row.asn_number === selectedAsn.asn_number
            ? { ...row, ...updated, status: "CANCELLED" }
            : row,
        ),
      );
      setSelectedAsn((current) =>
        current ? { ...current, ...updated, status: "CANCELLED" } : current,
      );
      toast.success(`ASN ${selectedAsn.asn_number} cancelled`);
    } catch (error: any) {
      toast.error(error?.message || "Unable to cancel ASN");
    }
  };

  const canModifyAsn = (asn: AsnRecord) => {
    if (String(asn.status).toUpperCase() === "CANCELLED") return false;
    const createdAt = new Date(asn.created_at).getTime();
    return Number.isFinite(createdAt) && Date.now() - createdAt <= 60 * 60 * 1000;
  };

  const deleteAsnRecord = (asn: AsnRecord) => {
    if (canModifyAsn(asn)) setAsnPendingDelete(asn);
  };

  const confirmDeleteAsn = async () => {
    const asn = asnPendingDelete;
    if (!asn) return;
    setAsnPendingDelete(null);
    try {
      await api.deleteAsn(asn.asn_number);
      setAsnList((rows) => rows.filter((row) => row.asn_number !== asn.asn_number));
      setSelectedAsn((current) => (current?.asn_number === asn.asn_number ? null : current));
      toast.success(`ASN ${asn.asn_number} deleted`);
    } catch (error: any) {
      toast.error(error?.message || "Unable to delete ASN");
    }
  };

  const editAsnRecord = (asn: AsnRecord) => {
    if (!canModifyAsn(asn)) {
      toast.error("Edit window expired", {
        description: "ASN edits are allowed only within 1 hour of submission.",
      });
      return;
    }
    setSelectedAsn(null);
    setAsnNumber(asn.asn_number);
    setSupplierName(asn.supplier_name || "");
    setExpectedArrivalDate(
      asn.delivery_date ||
      asn.expected_arrival_date ||
      asn.expected_arrival_at?.split("T")[0] ||
      "",
    );
    setVehicleNumber(asn.vehicle_number || "");
    setDriverName(asn.driver_name || "");
    setDriverMobile(asn.driver_contact || "");
    setLines(
      asn.lines?.length
        ? asn.lines
        : [{ material_id: "", item_code: "", material_name: "", shipped_quantity: "", uom: "" }],
    );
    setIsAssignmentOpen(true);
  };

  const filteredList = asnList.filter((a) => {
    const arrival =
      a.delivery_date || a.expected_arrival_date || a.expected_arrival_at?.split("T")[0] || "";
    if (statusFilter !== "ALL" && String(a.status || "").toUpperCase() !== statusFilter)
      return false;
    if (arrivalFrom && arrival < arrivalFrom) return false;
    if (arrivalTo && arrival > arrivalTo) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      a.asn_number.toLowerCase().includes(q) ||
      a.supplier_name.toLowerCase().includes(q) ||
      a.vehicle_number.toLowerCase().includes(q) ||
      a.driver_name.toLowerCase().includes(q) ||
      a.po_number.toLowerCase().includes(q)
    );
  });
  const clearFilters = () => {
    setSearchQuery("");
    setStatusFilter("ALL");
    setArrivalFrom("");
    setArrivalTo("");
    setArrivalRangeOpen(false);
  };
  const arrivalRange: DateRange | undefined =
    arrivalFrom || arrivalTo
      ? {
        from: arrivalFrom ? new Date(`${arrivalFrom}T00:00:00`) : undefined,
        to: arrivalTo ? new Date(`${arrivalTo}T00:00:00`) : undefined,
      }
      : undefined;
  const arrivalRangeLabel =
    arrivalFrom && arrivalTo
      ? `${displayFilterDate(arrivalFrom)} – ${displayFilterDate(arrivalTo)}`
      : arrivalFrom
        ? `${displayFilterDate(arrivalFrom)} – End date`
        : arrivalTo
          ? `Start date – ${displayFilterDate(arrivalTo)}`
          : "Filter date";

  return (
    <TooltipProvider delayDuration={150}>
      <AppShell
        title={
          <span className="inline-flex items-center gap-2">
            Advance Shipment Notices
          </span>
        }
        subtitle="Create, track and download shipment notices"
      >
        <div className="w-full space-y-5 pb-10">
          {/* Search & ASN Table Card */}
          <Card className="rounded-xl border-border bg-card shadow-sm">
            <CardHeader className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
              <div>
                <CardTitle className="text-base font-semibold">Delivery notices</CardTitle>
                <CardDescription>
                  Search and review the delivery notices you have created.
                </CardDescription>
              </div>

              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
                <div className="relative w-full sm:w-64">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <input
                    type="text"
                    aria-label="Search delivery notices by ASN, vehicle, or driver"
                    placeholder="Search deliveries"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <Popover open={arrivalRangeOpen} onOpenChange={setArrivalRangeOpen}>
                  <TapTooltip text="Find shipment notices by their relevant date.">
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-10 max-w-full min-w-0 justify-start rounded-lg px-3 text-left text-sm font-normal"
                      >
                        <CalendarIcon className="mr-2 size-4" />
                        <span className="truncate">{arrivalRangeLabel}</span>
                      </Button>
                    </PopoverTrigger>
                  </TapTooltip>
                  <PopoverContent align="end" className="w-auto p-0">
                    <Calendar
                      mode="range"
                      selected={arrivalRange}
                      onSelect={(range: DateRange | undefined) => {
                        setArrivalFrom(range?.from ? dateToFilterValue(range.from) : "");
                        setArrivalTo(range?.to ? dateToFilterValue(range.to) : "");
                        if (range?.from && range?.to) setArrivalRangeOpen(false);
                      }}
                      numberOfMonths={1}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 rounded-lg text-sm"
                  onClick={clearFilters}
                >
                  Clear Filters
                </Button>

                <TapTooltip text="Create a new delivery notice with vehicle, driver, arrival date, and material details.">
                  <Button
                    onClick={handleOpenCreateModal}
                    className="h-10 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-none hover:bg-primary/90"
                  >
                    <Plus className="size-4" /> Create ASN
                  </Button>
                </TapTooltip>
              </div>
            </CardHeader>

            <CardContent className="p-0">
              {loadError && (
                <div
                  role="alert"
                  className="m-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/25 bg-danger-soft p-3 text-sm text-destructive"
                >
                  <span>{loadError}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void loadAsnData()}
                  >
                    <RefreshCw className="size-4" /> Try again
                  </Button>
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1080px] text-left text-sm">
                  <thead className="border-b border-border bg-muted/60 text-xs font-medium text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5">
                          ASN Number

                        </span>
                      </th>
                      <th scope="col" className="px-4 py-3">
                        Supplier name
                      </th>
                      <th scope="col" className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5">
                          Vehicle Number

                        </span>
                      </th>
                      <th scope="col" className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5">
                          Driver Name &amp; Mobile

                        </span>
                      </th>
                      <th scope="col" className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5">
                          Expected Arrival Date

                        </span>
                      </th>
                      <th scope="col" className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5">
                          Status
                          <InformationTooltip help="workflowStatus" />
                        </span>
                      </th>
                      <th scope="col" className="px-4 py-3 text-right">
                        <span className="inline-flex items-center gap-1.5">
                          Materials
                          <InformationTooltip help="quantity" />
                        </span>
                      </th>
                      <th scope="col" className="w-44 px-4 py-3 text-right">
                        <span className="inline-flex items-center justify-end gap-1.5">
                          Actions

                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70">
                    {loading ? (
                      <tr>
                        <td
                          colSpan={8}
                          className="px-4 py-10 text-center text-sm text-muted-foreground"
                        >
                          <span className="inline-flex items-center gap-2" role="status">
                            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                            Loading delivery notices…
                          </span>
                        </td>
                      </tr>
                    ) : loadError ? (
                      <tr>
                        <td
                          colSpan={8}
                          className="px-4 py-10 text-center text-sm text-muted-foreground"
                        >
                          Delivery notices could not be loaded. Use Try again above to retry.
                        </td>
                      </tr>
                    ) : !filteredList.length ? (
                      <tr>
                        <td
                          colSpan={8}
                          className="px-4 py-10 text-center text-sm text-muted-foreground"
                        >
                          {asnList.length
                            ? "No delivery notices match your search or date filter."
                            : "No delivery notices yet."}
                        </td>
                      </tr>
                    ) : (
                      filteredList.map((asn) => (
                        <tr key={asn.id} className="transition-colors hover:bg-muted/40">
                          <td className="px-4 py-3 font-mono font-medium text-primary">
                            {asn.asn_number || "—"}
                          </td>
                          <td className="px-4 py-3 text-foreground">{asn.supplier_name || "—"}</td>
                          <td className="px-4 py-3 font-mono text-foreground">
                            {asn.vehicle_number || "—"}
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-foreground">{asn.driver_name || "—"}</span>
                            {asn.driver_contact && (
                              <span className="ml-1 font-mono text-muted-foreground">
                                ({asn.driver_contact})
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {displayFilterDate(
                              asn.delivery_date ||
                              asn.expected_arrival_date ||
                              asn.expected_arrival_at?.split("T")[0] ||
                              "",
                            ) || "—"}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3">
                            <StatusTooltip status="SUBMITTED" />
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-foreground">
                            {asn.lines?.length || 0} items ·{" "}
                            {asn.lines?.reduce(
                              (sum: number, line: any) =>
                                sum + Number(line.shipped_quantity ?? line.quantity ?? 0),
                              0,
                            ) || 0}{" "}
                            units
                          </td>
                          <td className="w-20 px-4 py-3 text-right">
                            <DropdownMenu>
                              <TapTooltip text="View, download, or manage this ASN, depending on available actions.">
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="size-8 rounded-lg"
                                    aria-label={`Actions for ${asn.asn_number}`}
                                  >
                                    <MoreHorizontal className="size-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                              </TapTooltip>
                              <DropdownMenuContent align="end" className="w-40">
                                <DropdownMenuItem
                                  disabled={!canModifyAsn(asn)}
                                  onSelect={() => editAsnRecord(asn)}
                                >
                                  <Pencil /> Edit
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-rose-600 focus:text-rose-700"
                                  disabled={!canModifyAsn(asn)}
                                  onSelect={() => deleteAsnRecord(asn)}
                                >
                                  <Trash2 /> Delete
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => setSelectedAsn(asn)}>
                                  <Eye /> View
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {!loading && !loadError && (
                <div
                  className="border-t border-border px-4 py-3 text-xs text-muted-foreground"
                  aria-live="polite"
                >
                  {filteredList.length === asnList.length
                    ? `${filteredList.length} ${filteredList.length === 1 ? "delivery notice" : "delivery notices"}`
                    : `${filteredList.length} of ${asnList.length} delivery notices`}
                </div>
              )}
            </CardContent>
          </Card>

          <Dialog
            open={Boolean(selectedAsn)}
            onOpenChange={(open) => !open && setSelectedAsn(null)}
          >
            <DialogContent className="w-[calc(100%-2rem)] max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto rounded-xl p-4 shadow-lg sm:p-6">
              <DialogHeader>
                <DialogTitle className="text-lg font-black text-primary">ASN Details</DialogTitle>
              </DialogHeader>
              {selectedAsn && (
                <div className="grid grid-cols-2 gap-3 rounded-xl border p-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">ASN Number</span>
                    <p className="font-mono font-bold">{selectedAsn.asn_number}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Supplier</span>
                    <p className="font-semibold">{selectedAsn.supplier_name}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Vehicle</span>
                    <p className="font-mono font-semibold">{selectedAsn.vehicle_number}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Driver</span>
                    <p className="font-semibold">{selectedAsn.driver_name}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Driver Contact</span>
                    <p className="font-mono">{selectedAsn.driver_contact}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Status</span>
                    <p className="font-semibold">
                      {String(selectedAsn.status || "SUBMITTED").replaceAll("_", " ")}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Expected Arrival</span>
                    <p className="font-semibold">
                      {selectedAsn.delivery_date ||
                        selectedAsn.expected_arrival_date ||
                        selectedAsn.expected_arrival_at?.split("T")[0] ||
                        "—"}
                    </p>
                  </div>
                  <div className="col-span-2 border-t pt-3">
                    <span className="text-muted-foreground">Shipped Materials</span>
                    {selectedAsn.lines?.length ? (
                      <div className="mt-2 divide-y">
                        {selectedAsn.lines.map((line: any, index: number) => (
                          <div
                            key={`${line.item_code || line.material_name}-${index}`}
                            className="flex items-center justify-between gap-3 py-2"
                          >
                            <span className="font-semibold">
                              {line.material_name || line.item_code || "—"}{" "}
                              <span className="font-mono text-muted-foreground">
                                ({line.item_code || "—"})
                              </span>
                            </span>
                            <span className="font-bold">
                              {line.shipped_quantity ?? line.quantity ?? 0} {line.uom || ""}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-muted-foreground">No shipment materials recorded.</p>
                    )}
                  </div>
                  <div className="col-span-2 flex justify-end gap-2 border-t pt-4">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void downloadSelectedAsn()}
                    >
                      <Download className="mr-2 size-4" /> Download
                    </Button>
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>
          <AlertDialog
            open={Boolean(asnPendingDelete)}
            onOpenChange={(open) => !open && setAsnPendingDelete(null)}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete ASN?</AlertDialogTitle>
                <AlertDialogDescription>
                  Delete ASN {asnPendingDelete?.asn_number}? This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => void confirmDeleteAsn()}
                >
                  Delete ASN
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <Dialog
            open={isAssignmentOpen}
            onOpenChange={(open) => {
              if (!assignmentSubmitting) setIsAssignmentOpen(open);
            }}
          >
            <DialogContent className="w-[calc(100%-2rem)] max-h-[calc(100dvh-2rem)] max-w-xl overflow-y-auto rounded-xl p-4 shadow-lg sm:p-6">
              <DialogHeader>
                <DialogTitle className="text-lg font-black text-primary">
                  Assign vehicle and driver
                </DialogTitle>
              </DialogHeader>
              <form onSubmit={continueToAsnForm} className="space-y-5">
                <p className="text-sm text-muted-foreground">
                  Enter transport details. The complete ASN form will open after you continue.
                </p>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <Label htmlFor="assignment-vehicle">Vehicle Number *</Label>
                    <Input
                      id="assignment-vehicle"
                      required
                      placeholder="e.g. KA01AB1234"
                      value={vehicleNumber}
                      onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())}
                      onBlur={() => {
                        setVehicleNumber((value) => normalizeAsnVehicleNumber(value));
                        setAssignmentTouched((value) => ({ ...value, vehicle: true }));
                      }}
                      aria-invalid={
                        assignmentTouched.vehicle && !isValidAsnVehicleNumber(vehicleNumber)
                      }
                      aria-describedby="assignment-vehicle-error"
                      maxLength={20}
                      className={formInputClass}
                    />
                    {assignmentTouched.vehicle && !vehicleNumber.trim() && (
                      <p id="assignment-vehicle-error" className="mt-1 text-xs text-rose-600">
                        Vehicle number is required.
                      </p>
                    )}
                    {assignmentTouched.vehicle &&
                      vehicleNumber.trim() &&
                      !isValidAsnVehicleNumber(vehicleNumber) && (
                        <p id="assignment-vehicle-error" className="mt-1 text-xs text-rose-600">
                          Enter a valid registration, such as KA01AB1234 or 22BH1234AA.
                        </p>
                      )}
                  </div>
                  <div>
                    <Label htmlFor="assignment-driver">Driver Name *</Label>
                    {registeredDrivers.length > 0 && (
                      <select
                        aria-label="Select registered driver"
                        className="mb-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                        value={
                          registeredDrivers.some((d) => (d.driver_name || d.name) === driverName)
                            ? driverName
                            : ""
                        }
                        onChange={(e) => {
                          if (!e.target.value) return;
                          const d = registeredDrivers.find(
                            (row) => (row.driver_name || row.name) === e.target.value,
                          );
                          setDriverName(e.target.value);
                          const phone = d?.phone || d?.mobile_number || d?.phone_number;
                          if (phone) {
                            setDriverMobile(sanitizeMobileNumber(String(phone)));
                          }
                          setAssignmentTouched((prev) => ({
                            ...prev,
                            driver: true,
                            contact: true,
                          }));
                        }}
                      >
                        <option value="">Choose registered driver...</option>
                        {registeredDrivers.map((d) => (
                          <option key={d.id} value={d.driver_name || d.name}>
                            {d.driver_name || d.name}
                          </option>
                        ))}
                      </select>
                    )}
                    <Input
                      id="assignment-driver"
                      required
                      placeholder="Enter driver name"
                      value={driverName}
                      onChange={(e) => setDriverName(e.target.value)}
                      onBlur={() => {
                        setDriverName((value) => value.trim().replace(/ +/g, " "));
                        setAssignmentTouched((value) => ({ ...value, driver: true }));
                      }}
                      aria-invalid={assignmentTouched.driver && !isValidAsnDriverName(driverName)}
                      aria-describedby="assignment-driver-error"
                      maxLength={100}
                      className={formInputClass}
                    />
                    {assignmentTouched.driver && !driverName.trim() && (
                      <p id="assignment-driver-error" className="mt-1 text-xs text-rose-600">
                        Driver name is required.
                      </p>
                    )}
                    {assignmentTouched.driver &&
                      driverName.trim() &&
                      !isValidAsnDriverName(driverName) && (
                        <p id="assignment-driver-error" className="mt-1 text-xs text-rose-600">
                          Enter 2–100 characters using letters, spaces, periods, commas, apostrophes or hyphens.
                        </p>
                      )}
                  </div>
                  <div>
                    <Label htmlFor="assignment-contact">Driver Contact *</Label>
                    <Input
                      id="assignment-contact"
                      required
                      type="tel"
                      value={driverMobile}
                      onChange={(e) => setDriverMobile(sanitizeMobileNumber(e.target.value))}
                      onBlur={() => setAssignmentTouched((value) => ({ ...value, contact: true }))}
                      aria-invalid={
                        assignmentTouched.contact && !isValidAsnDriverMobileNumber(driverMobile)
                      }
                      aria-describedby="assignment-contact-error"
                      inputMode="numeric"
                      maxLength={10}
                      pattern="[6-9][0-9]{9}"
                      className={formInputClass}
                    />
                    {assignmentTouched.contact && !driverMobile && (
                      <p id="assignment-contact-error" className="mt-1 text-xs text-rose-600">
                        Driver contact is required.
                      </p>
                    )}
                    {assignmentTouched.contact &&
                      driverMobile &&
                      !isValidAsnDriverMobileNumber(driverMobile) && (
                        <p id="assignment-contact-error" className="mt-1 text-xs text-rose-600">
                          Enter a 10-digit Indian mobile number starting with 6–9.
                        </p>
                      )}
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={assignmentSubmitting}
                    onClick={() => setIsAssignmentOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={
                      assignmentSubmitting ||
                      !isValidAsnVehicleNumber(vehicleNumber) ||
                      !isValidAsnDriverName(driverName) ||
                      !isValidAsnDriverMobileNumber(driverMobile)
                    }
                  >
                    {assignmentSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
                    Next
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>

          {/* CREATE ASN POPUP MODAL DIALOG */}
          <Dialog
            open={isModalOpen}
            onOpenChange={(open) => {
              setIsModalOpen(open);
              if (!open && !asnSubmitted) setIsAssignmentOpen(true);
              if (!open) setAsnSubmitted(false);
            }}
          >
            <DialogContent className="w-[calc(100%-2rem)] max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto rounded-xl bg-card p-4 shadow-lg sm:p-6">
              <DialogHeader>
                <DialogTitle className="font-black text-lg text-primary uppercase border-b pb-2">
                  CREATE ADVANCE SHIPPING NOTICE (ASN)
                </DialogTitle>
              </DialogHeader>

              <form noValidate onSubmit={handleFormSubmit} className="space-y-5 text-sm">
                <section className="space-y-4">
                  <h3 className="border-b border-border pb-2 text-sm font-semibold text-foreground">
                    Shipment information
                  </h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="asn-number">ASN number</Label>
                      <Input
                        id="asn-number"
                        readOnly
                        value={asnNumber || "Assigned when submitted"}
                        className="h-10 rounded-lg border-border bg-muted/50 font-mono text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="supplier-name">Supplier Name</Label>
                      <Input
                        id="supplier-name"
                        required
                        value={supplierName}
                        onChange={(event) => setSupplierName(event.target.value)}
                        onBlur={() => setSupplierName((value) => value.trim())}
                        maxLength={200}
                        className="h-10 rounded-lg border-border bg-background text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <span className="inline-flex items-center"><Label htmlFor="expected-arrival-date">Expected arrival date *</Label><InformationTooltip help="arrivalDate" /></span>
                      <Input
                        id="expected-arrival-date"
                        type="date"
                        required
                        min={todayDate()}
                        value={expectedArrivalDate}
                        onBlur={() => {
                          if (!isValidDateInput(expectedArrivalDate)) {
                            setAsnFormErrors((errors) => ({
                              ...errors,
                              "expected-arrival-date": "Enter a valid expected arrival date.",
                            }));
                          } else if (expectedArrivalDate < todayDate()) {
                            setAsnFormErrors((errors) => ({
                              ...errors,
                              "expected-arrival-date":
                                "Expected arrival date cannot be before today.",
                            }));
                          }
                        }}
                        onChange={(event) => {
                          setExpectedArrivalDate(event.target.value);
                          setAsnFormErrors((errors) => ({
                            ...errors,
                            "expected-arrival-date": "",
                          }));
                          setSubmissionError("");
                        }}
                        aria-invalid={Boolean(asnFormErrors["expected-arrival-date"])}
                        aria-describedby={
                          asnFormErrors["expected-arrival-date"]
                            ? "expected-arrival-date-error"
                            : undefined
                        }
                        className="h-10 rounded-lg border-border bg-background text-sm"
                      />
                      {asnFormErrors["expected-arrival-date"] && (
                        <p
                          id="expected-arrival-date-error"
                          className="text-xs text-destructive"
                          role="alert"
                        >
                          {asnFormErrors["expected-arrival-date"]}
                        </p>
                      )}
                    </div>
                  </div>
                </section>

                <section className="space-y-3">
                  <h3 className="border-b border-border pb-2 text-sm font-semibold text-foreground">
                    Vehicle and driver summary
                  </h3>
                  <div className="grid gap-3 rounded-lg border border-border bg-muted/20 p-4 sm:grid-cols-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Vehicle registration</p>
                      <p className="mt-1 font-medium">{normalizeAsnVehicleNumber(vehicleNumber)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Driver name</p>
                      <p className="mt-1 font-medium">{driverName.trim().replace(/\s+/g, " ")}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Driver mobile number</p>
                      <p className="mt-1 font-medium">{driverMobile}</p>
                    </div>
                  </div>
                </section>

                <section className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-2">
                    <h3 className="text-sm font-semibold text-foreground">Shipped materials</h3>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 rounded-lg"
                      disabled={materialLoading || Boolean(materialLoadError)}
                      onClick={() => {
                        setSubmissionError("");
                        setAsnFormErrors((errors) =>
                          Object.fromEntries(
                            Object.entries(errors).filter(
                              ([key]) =>
                                !key.startsWith("material-") && !key.startsWith("quantity-"),
                            ),
                          ),
                        );
                        setLines((rows) => [
                          ...rows,
                          {
                            material_id: "",
                            item_code: "",
                            material_name: "",
                            shipped_quantity: "",
                            uom: "",
                          },
                        ]);
                      }}
                    >
                      <Plus className="mr-2 size-4" />
                      Add material
                    </Button>
                  </div>

                  {materialLoadError && (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                      <p className="text-sm text-destructive" role="alert">
                        {materialLoadError}
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 rounded-lg"
                        onClick={() => void loadActiveMaterials()}
                      >
                        Retry
                      </Button>
                    </div>
                  )}
                  {!materialLoading && !materialLoadError && materialCatalog.length === 0 && (
                    <p className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
                      No active materials are available. Contact your warehouse administrator.
                    </p>
                  )}

                  <div className="space-y-3">
                    {lines.map((line, idx) => (
                      <div
                        key={
                          line.material_id ? `${line.material_id}-${idx}` : `material-row-${idx}`
                        }
                        className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(8rem,0.45fr)_5rem_auto] sm:items-start"
                      >
                        <div className="min-w-0 space-y-1.5">
                          <Label htmlFor={`material-${idx}`}>Material *</Label>
                          <select
                            id={`material-${idx}`}
                            required
                            disabled={materialLoading || Boolean(materialLoadError)}
                            value={line.item_id || line.material_id || ""}
                            onBlur={() => {
                              if (!line.material_id) {
                                setAsnFormErrors((errors) => ({
                                  ...errors,
                                  [`material-${idx}`]: "Select a material from Material Master.",
                                }));
                              }
                            }}
                            onChange={(event) => {
                              const material = materialCatalog.find(
                                (item) => String(item.id) === event.target.value,
                              );
                              if (
                                material &&
                                lines.some(
                                  (item, index) =>
                                    index !== idx &&
                                    String(item.material_id) === String(material.id),
                                )
                              ) {
                                toast.error("This material is already selected in the ASN.");
                                return;
                              }
                              setLines((current) =>
                                current.map((item, index) =>
                                  index === idx
                                    ? {
                                      ...item,
                                      material_id: material?.id || "",
                                      item_code: material?.code || "",
                                      material_name: material?.name || "",
                                      shipped_quantity: item.shipped_quantity,
                                      uom: material?.uom || "",
                                    }
                                    : item,
                                ),
                              );
                              setAsnFormErrors((errors) => ({
                                ...errors,
                                [`material-${idx}`]: "",
                                [`quantity-${idx}`]: "",
                              }));
                              setSubmissionError("");
                            }}
                            aria-invalid={Boolean(asnFormErrors[`material-${idx}`])}
                            aria-describedby={
                              asnFormErrors[`material-${idx}`] ? `material-${idx}-error` : undefined
                            }
                            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <option value="">
                              {materialLoading ? "Loading materials…" : "Select material"}
                            </option>
                            {materialCatalog.map((material) => (
                              <option key={material.id} value={material.id}>
                                {material.name} ({material.code})
                              </option>
                            ))}
                          </select>
                          {asnFormErrors[`material-${idx}`] && (
                            <p
                              id={`material-${idx}-error`}
                              className="text-xs text-destructive"
                              role="alert"
                            >
                              {asnFormErrors[`material-${idx}`]}
                            </p>
                          )}
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={`quantity-${idx}`}>Quantity *</Label>
                          <Input
                            id={`quantity-${idx}`}
                            required
                            type="text"
                            inputMode="decimal"
                            maxLength={19}
                            placeholder="Enter quantity"
                            value={line.shipped_quantity}
                            onKeyDown={(event) => {
                              if (
                                event.key === "Backspace" ||
                                event.key === "Delete" ||
                                event.key === "Tab" ||
                                event.key === "ArrowLeft" ||
                                event.key === "ArrowRight" ||
                                event.key === "Home" ||
                                event.key === "End" ||
                                event.key === "Enter" ||
                                event.ctrlKey ||
                                event.metaKey
                              ) {
                                return;
                              }
                              const isInteger = isIntegerQuantityUom(line.uom || "");
                              if (event.key === ".") {
                                if (isInteger || line.shipped_quantity.includes(".")) {
                                  event.preventDefault();
                                }
                                return;
                              }
                              if (!/^\d$/.test(event.key)) {
                                event.preventDefault();
                              }
                            }}
                            onBlur={() => {
                              if (!isValidAsnQuantity(line.shipped_quantity, line.uom || "")) {
                                setAsnFormErrors((errors) => ({
                                  ...errors,
                                  [`quantity-${idx}`]: line.uom
                                    ? `Enter a positive quantity allowed for ${line.uom}.`
                                    : "Select a material and enter a valid quantity.",
                                }));
                              }
                            }}
                            onChange={(event) => {
                              const shippedQuantity = sanitizeNumericQuantity(
                                event.target.value,
                                line.uom || "",
                              );
                              setLines((current) =>
                                current.map((item, index) =>
                                  index === idx
                                    ? { ...item, shipped_quantity: shippedQuantity }
                                    : item,
                                ),
                              );
                              if (isValidAsnQuantity(shippedQuantity, line.uom || "")) {
                                setAsnFormErrors((errors) => ({
                                  ...errors,
                                  [`quantity-${idx}`]: "",
                                }));
                              }
                              setSubmissionError("");
                            }}
                            aria-invalid={Boolean(asnFormErrors[`quantity-${idx}`])}
                            aria-describedby={
                              asnFormErrors[`quantity-${idx}`] ? `quantity-${idx}-error` : undefined
                            }
                            className="h-10 rounded-lg border-border bg-background text-right text-sm"
                          />
                          {asnFormErrors[`quantity-${idx}`] && (
                            <p
                              id={`quantity-${idx}-error`}
                              className="text-xs text-destructive"
                              role="alert"
                            >
                              {asnFormErrors[`quantity-${idx}`]}
                            </p>
                          )}
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={`uom-${idx}`}>UOM</Label>
                          <Input
                            id={`uom-${idx}`}
                            readOnly
                            value={line.uom || "—"}
                            aria-label={`Unit of measure for material ${idx + 1}`}
                            className="h-10 rounded-lg border-border bg-muted/50 text-sm"
                          />
                        </div>
                        <div className="flex justify-end pt-6">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={lines.length === 1}
                            aria-label={`Remove material row ${idx + 1}`}
                            onClick={() => {
                              setSubmissionError("");
                              setLines((current) => current.filter((_, index) => index !== idx));
                              setAsnFormErrors((errors) =>
                                Object.fromEntries(
                                  Object.entries(errors).filter(
                                    ([key]) =>
                                      !key.startsWith("material-") && !key.startsWith("quantity-"),
                                  ),
                                ),
                              );
                            }}
                            className="size-9 rounded-lg text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                {submissionError && (
                  <p
                    className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
                    role="alert"
                  >
                    {submissionError}
                  </p>
                )}

                {/* SUBMIT ACTIONS */}
                <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-between">
                  <Button
                    type="button"
                    variant="ghost"
                    className="rounded-xl font-bold sm:mr-auto"
                    onClick={() => {
                      setAsnSubmitted(false);
                      setIsModalOpen(false);
                      setIsAssignmentOpen(true);
                    }}
                  >
                    <ArrowLeft className="mr-2 size-4" /> Back
                  </Button>
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-xl font-bold"
                      onClick={() => setIsModalOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={submitting}
                      className="rounded-lg bg-primary font-medium text-primary-foreground shadow-none hover:bg-primary/90"
                    >
                      {submitting ? (
                        <Loader2 className="mr-2 size-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="mr-2 size-4" />
                      )}
                      Submit ASN
                    </Button>
                  </div>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </AppShell>
    </TooltipProvider>
  );
}
