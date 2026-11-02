import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Boxes,
  Eye,
  FileCheck2,
  Loader2,
  PlusCircle,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Truck,
  Camera,
} from "lucide-react";
import { AppShell, StatusBadge } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api-client";

export const Route = createFileRoute("/vehicle-queue")({
  head: () => ({ meta: [{ title: "Inbound Arrivals · KaizenAssests" }] }),
  component: InboundArrivals,
});

type Arrival = {
  id: string;
  gate_entry_number: string;
  asn_id: string;
  asn_number: string;
  po_number?: string | null;
  supplier_name: string;
  vehicle_number: string;
  driver_name: string;
  driver_contact?: string | null;
  truck_photo_base64?: string | null;
  vehicle_photo_base64?: string | null;
  document_image_base64?: string | null;
  arrival_time: string;
  expected_arrival_at?: string | null;
  status: string;
  exited_at?: string | null;
  exited_by?: string | null;
  assigned_dock_id?: string | null;
  po_id?: string | null;
  assigned_by?: string | null;
  assigned_at?: string | null;
  allocation_request_id?: string | null;
  movement_started_by?: string | null;
  movement_started_at?: string | null;
  facility_entry_at?: string | null;
  dock_checked_in_by?: string | null;
  dock_arrival_at?: string | null;
  allocation_arrived_at?: string | null;
  shipment: {
    transporter?: string;
    number_of_packages?: number;
    package_type?: string;
    shipping_method?: string;
  };
  expected_materials: Array<{
    item_code: string;
    material_name?: string;
    quantity: number;
    uom?: string;
  }>;
};

type Dock = {
  id: string;
  zone: string;
  type: string;
  status: "AVAILABLE" | "OCCUPIED";
  vehicle_number?: string;
};

type AsnTransportEntry = {
  vehicle_number: string;
  driver_name: string;
  driver_contact: string;
  has_active_gate_pass: boolean;
};

const normalizePlate = (value: unknown) =>
  String(value || "")
    .replace(/[\s-]/g, "")
    .toUpperCase();

const formatApiDateTime = (value?: string | null) => {
  if (!value) return "—";
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
  return new Date(hasTimezone ? normalized : `${normalized}Z`).toLocaleString();
};

const displaySupplierName = (value?: string | null) =>
  String(value || "").replace(/\s*\(EMP-[^)]+\)/gi, "").trim();

function getAsnTransportEntries(asn: any): Omit<AsnTransportEntry, "has_active_gate_pass">[] {
  const assignment = Array.isArray(asn?.logistics)
    ? asn.logistics.find((item: any) => item?.type === "transport_assignment")
    : null;
  const vehicles = Array.isArray(assignment?.vehicles) ? assignment.vehicles : [];
  if (vehicles.length) {
    return vehicles
      .map((item: any) => ({
        vehicle_number: String(item?.vehicle_number || "").trim(),
        driver_name: String(item?.driver_name || "").trim(),
        driver_contact: String(item?.driver_contact || "").trim(),
      }))
      .filter((item: any) => item.vehicle_number);
  }
  const vehicleNumbers = String(asn?.vehicle_number || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const drivers = String(asn?.driver_name || "")
    .split(",")
    .map((value) => value.trim());
  const contacts = String(asn?.driver_contact || "")
    .split(",")
    .map((value) => value.trim());
  return vehicleNumbers.map((vehicle_number, index) => ({
    vehicle_number,
    driver_name: drivers[index] || "",
    driver_contact: contacts[index] || "",
  }));
}

function InboundArrivals() {
  const search = useSearch({ strict: false }) as any;
  const [arrivals, setArrivals] = useState<Arrival[]>([]);
  const arrivalsRef = useRef<Arrival[]>(arrivals);
  arrivalsRef.current = arrivals;
  const [docks, setDocks] = useState<Dock[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedArrival, setSelectedArrival] = useState<Arrival | null>(null);
  const [selectedDock, setSelectedDock] = useState<Record<string, string>>({});
  const [assigning, setAssigning] = useState<string | null>(null);
  const [exitTarget, setExitTarget] = useState<Arrival | null>(null);
  const [exitPass, setExitPass] = useState("");
  const [exitVerified, setExitVerified] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [arrivalPage, setArrivalPage] = useState(1);
  const arrivalsPerPage = 10;

  // FR-02 New Gate Entry Registration Modal State
  const [isNewRegistrationModalOpen, setIsNewRegistrationModalOpen] = useState(
    Boolean(search?.action === "new"),
  );

  // FR-02 Section A: Supplier and Shipment Details
  const [selectedSupplier, setSelectedSupplier] = useState("");
  const [selectedAsn, setSelectedAsn] = useState("");
  const [asnRecords, setAsnRecords] = useState<any[]>([]);
  const [asnTransportEntries, setAsnTransportEntries] = useState<AsnTransportEntry[]>([]);
  const [selectedTransportIndex, setSelectedTransportIndex] = useState(-1);
  const [autoExpectedDate, setAutoExpectedDate] = useState("");
  const [deliveryType, setDeliveryType] = useState("");
  const [remarksText, setRemarksText] = useState("");
  const [asnMaterials, setAsnMaterials] = useState<any[]>([]);

  // FR-02 Section B: Vehicle and Driver Details
  const [vehicleNumberInput, setVehicleNumberInput] = useState("");
  const [vehicleTypeInput, setVehicleTypeInput] = useState("Container Truck");
  const [driverNameInput, setDriverNameInput] = useState("");
  const [driverMobileInput, setDriverMobileInput] = useState("");
  const [transporterInput, setTransporterInput] = useState("VRL Logistics Ltd");
  const [driverIdTypeInput, setDriverIdTypeInput] = useState("Driving Licence");
  const [driverIdRefInput, setDriverIdRefInput] = useState("DL-2026-90812");
  const [entryGateInput, setEntryGateInput] = useState("Main Gate – 01");

  // FR-02 Section C: Invoice & Supporting Documents
  const [invoiceNoInput, setInvoiceNoInput] = useState("INV-2026-9901");
  const [invoiceDateInput, setInvoiceDateInput] = useState("2026-10-07");
  const [challanNoInput, setChallanNoInput] = useState("DC-2026-4412");
  const [ewayNoInput, setEwayNoInput] = useState("EWAY-8812-4091");
  const [uploadedInvoiceFile, setUploadedInvoiceFile] = useState<string | null>(
    "invoice_copy_inv9901.pdf",
  );
  const [asnDocumentFile, setAsnDocumentFile] = useState<File | null>(null);
  // Do not seed this with a demo filename: the gate pass must require a real
  // photo captured/uploaded during the current registration.
  const [uploadedVehiclePhoto, setUploadedVehiclePhoto] = useState<string | null>(null);
  const [vehiclePhotoPreview, setVehiclePhotoPreview] = useState<string | null>(null);
  const [vehiclePhotoBlob, setVehiclePhotoBlob] = useState<Blob | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const [asnCameraOpen, setAsnCameraOpen] = useState(false);
  const [asnDocumentPreview, setAsnDocumentPreview] = useState<string | null>(null);
  const asnCameraVideoRef = useRef<HTMLVideoElement>(null);
  const asnCameraStreamRef = useRef<MediaStream | null>(null);
  const [submittingWebEntry, setSubmittingWebEntry] = useState(false);
  const [generatedGatePass, setGeneratedGatePass] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [arrivalRows, dockRows] = await Promise.all([
        api.getInboundArrivals(true),
        api.getDocks(),
      ]);
      setArrivals(arrivalRows);
      setDocks(dockRows);
    } catch (error) {
      if (!quiet)
        toast.error("Unable to load inbound arrivals", {
          description: error instanceof Error ? error.message : undefined,
        });
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  const filteredArrivals = arrivals.filter((arrival) => {
    if (statusFilter !== "ALL" && arrival.status !== statusFilter) return false;
    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;
    return [
      arrival.asn_number,
      arrival.gate_entry_number,
      arrival.supplier_name,
      arrival.vehicle_number,
      arrival.driver_name,
    ].some((value) =>
      String(value || "")
        .toLowerCase()
        .includes(query),
    );
  });
  const arrivalStatuses = [
    "AWAITING_DOCK",
    "DOCK_ASSIGNED",
    "INSIDE_FACILITY",
    "AT_DOCK",
    "UNLOADING_IN_PROGRESS",
    "RECEIVING_COMPLETED",
    "VEHICLE_EXITED",
  ];
  const totalArrivalPages = Math.max(1, Math.ceil(filteredArrivals.length / arrivalsPerPage));
  const visibleArrivals = filteredArrivals.slice(
    (arrivalPage - 1) * arrivalsPerPage,
    arrivalPage * arrivalsPerPage,
  );
  const firstVisibleArrival =
    filteredArrivals.length === 0 ? 0 : (arrivalPage - 1) * arrivalsPerPage + 1;
  const lastVisibleArrival = Math.min(arrivalPage * arrivalsPerPage, filteredArrivals.length);

  useEffect(() => {
    setArrivalPage((page) => Math.min(page, totalArrivalPages));
  }, [totalArrivalPages]);

  useEffect(() => {
    void api.getAsns().then((records) => {
      setAsnRecords(records || []);
    });
  }, []);

  const applyAsnDetails = useCallback((asn: any) => {
    if (!asn) {
      setSelectedSupplier("");
      setAutoExpectedDate("");
      setAsnMaterials([]);
      setAsnTransportEntries([]);
      setSelectedTransportIndex(-1);
      setVehicleNumberInput("");
      setDriverNameInput("");
      setDriverMobileInput("");
      setVehiclePhotoBlob(null);
      setVehiclePhotoPreview(null);
      setUploadedVehiclePhoto(null);
      return;
    }

    setSelectedSupplier(asn.supplier_name || asn.supplier_company_name || "");
    setAutoExpectedDate(asn.expected_arrival_at?.split("T")[0] || asn.delivery_date || "");
    setAsnMaterials(asn.lines || asn.expected_materials || []);

    const transports = getAsnTransportEntries(asn).map((transport) => ({
      ...transport,
      has_active_gate_pass: arrivalsRef.current.some(
        (arrival) =>
          String(arrival.asn_id || "") === String(asn.id || asn.asn_id || "") &&
          normalizePlate(arrival.vehicle_number) === normalizePlate(transport.vehicle_number) &&
          !["REJECTED", "DENIED_ENTRY", "GATE_EXIT_COMPLETED", "VEHICLE_EXITED", "CHECKED_OUT"].includes(
            String(arrival.status || "").toUpperCase(),
          ),
      ),
    }));
    setAsnTransportEntries(transports);

    const nextIndex = transports.findIndex((transport) => !transport.has_active_gate_pass);
    setSelectedTransportIndex(nextIndex);
    const selectedTransport = nextIndex >= 0 ? transports[nextIndex] : null;
    setVehicleNumberInput(selectedTransport?.vehicle_number || "");
    setDriverNameInput(selectedTransport?.driver_name || "");
    setDriverMobileInput(selectedTransport?.driver_contact || "");
    setVehiclePhotoBlob(null);
    setVehiclePhotoPreview(null);
    setUploadedVehiclePhoto(null);
  }, []);

  const openVehicleCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      cameraStreamRef.current = stream;
      setCameraOpen(true);
      requestAnimationFrame(() => {
        if (cameraVideoRef.current) cameraVideoRef.current.srcObject = stream;
      });
    } catch {
      toast.error("Unable to open camera", {
        description: "Allow camera permission and try again.",
      });
    }
  };

  const closeVehicleCamera = () => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    setCameraOpen(false);
  };

  const captureVehiclePhoto = () => {
    const video = cameraVideoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (blob) {
        const previewUrl = URL.createObjectURL(blob);
        setVehiclePhotoPreview(previewUrl);
        setVehiclePhotoBlob(blob);
        setUploadedVehiclePhoto(`vehicle-photo-${Date.now()}.jpg`);
      }
      closeVehicleCamera();
    }, "image/jpeg");
  };

  const openAsnCamera = async () => {
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

  const closeAsnCamera = () => {
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
    canvas.toBlob((blob) => {
      if (blob) {
        if (asnDocumentPreview) URL.revokeObjectURL(asnDocumentPreview);
        setAsnDocumentFile(
          new File([blob], `asn-document-${Date.now()}.jpg`, { type: "image/jpeg" }),
        );
        setAsnDocumentPreview(URL.createObjectURL(blob));
      }
      closeAsnCamera();
    }, "image/jpeg");
  };

  useEffect(() => {
    const number = selectedAsn.trim();
    if (!isNewRegistrationModalOpen || !number) return;
    let active = true;
    const local = asnRecords.find(
      (asn) => String(asn.asn_number).toLowerCase() === number.toLowerCase(),
    );
    if (local) {
      applyAsnDetails(local);
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const remote = await api.getAsn(number);
        if (!active) return;
        if (remote?.asn_number) {
          applyAsnDetails(remote);
        } else {
          toast.error("ASN not found", { description: `No ASN was found for ${number}.` });
        }
      } catch (error) {
        if (active) toast.error("Unable to load ASN", {
          description: error instanceof Error ? error.message : "Please check the ASN number.",
        });
      }
    }, 500);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [selectedAsn, isNewRegistrationModalOpen, asnRecords, applyAsnDetails]);

  async function assignDock(arrival: Arrival) {
    const dockId = selectedDock[arrival.id];
    if (!dockId) {
      toast.error("Select an available dock");
      return;
    }
    setAssigning(arrival.id);
    try {
      await api.assignDock(arrival.id, dockId);
      toast.success(`${dockId} assigned`, {
        description: `${arrival.vehicle_number} can proceed to the dock.`,
      });
      await load(true);
    } catch (error) {
      toast.error("Dock assignment failed", {
        description: error instanceof Error ? error.message : undefined,
      });
      await load(true);
    } finally {
      setAssigning(null);
    }
  }

  async function startMovement(arrival: Arrival) {
    setAssigning(arrival.id);
    try {
      await api.startDockMovement(arrival.id);
      toast.success("Vehicle instructed to move", {
        description: `${arrival.vehicle_number} is moving to ${arrival.assigned_dock_id}.`,
      });
      await load(true);
    } catch (error) {
      toast.error("Unable to start dock movement", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setAssigning(null);
    }
  }

  async function confirmDockArrival(arrival: Arrival) {
    setAssigning(arrival.id);
    try {
      await api.confirmDockCheckIn(arrival.id);
      toast.success("Vehicle arrived", {
        description: `${arrival.vehicle_number} checked in at ${arrival.assigned_dock_id}.`,
      });
      await load(true);
    } catch (error) {
      toast.error("Dock check-in failed", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setAssigning(null);
    }
  }

  async function confirmPhysicalDockArrival(arrival: Arrival) {
    if (!arrival.allocation_request_id) {
      toast.error("Dock check-in unavailable", {
        description: "No persisted dock allocation is linked to this arrival.",
      });
      return;
    }
    setAssigning(arrival.id);
    try {
      await api.markVehicleArrived(arrival.allocation_request_id);
      toast.success("Vehicle checked in at dock", {
        description: `${arrival.vehicle_number} is now AT DOCK at ${arrival.assigned_dock_id}.`,
      });
      await load(true);
    } catch (error) {
      toast.error("Dock check-in failed", {
        description: error instanceof Error ? error.message : undefined,
      });
      await load(true);
    } finally {
      setAssigning(null);
    }
  }

  const isEligibleForInboundExit = (statusStr: string) => {
    const upper = (statusStr || "").toUpperCase().trim();
    // Security may release an inbound vehicle only after receiving/GRN is
    // complete and the warehouse has released its dock assignment.
    return ["RECEIVING_COMPLETED", "DOCK_RELEASED"].includes(upper);
  };

  async function approveGateExit(arrival: Arrival) {
    setExitTarget(arrival);
    setExitPass("");
    setExitVerified(false);
  }

  function verifyGatePass() {
    const normalized = exitPass.trim().toUpperCase();
    const matchingArrival = arrivals.find(
      (arrival) => arrival.gate_entry_number?.toUpperCase() === normalized,
    );
    if (!matchingArrival) {
      setExitVerified(false);
      toast.error("Gate pass not found", {
        description: "Enter or scan the active gate pass for this vehicle.",
      });
      return;
    }
    if (matchingArrival.id !== exitTarget?.id) {
      setExitVerified(false);
      toast.error("Wrong gate pass", {
        description: "This pass does not belong to the selected vehicle.",
      });
      return;
    }
    if (!isEligibleForInboundExit(matchingArrival.status)) {
      setExitVerified(false);
      toast.error("Vehicle is not ready for exit", {
        description: "GRN/receiving must be completed and the dock must be released first.",
      });
      return;
    }
    setExitTarget(matchingArrival);
    setExitPass(normalized);
    setExitVerified(true);
    toast.success("Gate pass verified", { description: "Vehicle and active visit details match." });
  }

  async function confirmGateExit() {
    if (!exitTarget || !exitPass.trim()) return;
    const arrival = exitTarget;
    const vehName = arrival.vehicle_number || "this vehicle";
    setAssigning(arrival.id);
    try {
      const updated = await api.markInboundVehicleExited(arrival.id, exitPass.trim());
      toast.success(`Gate exit approved for ${vehName}`, {
        description: `Status updated to VEHICLE_EXITED by ${updated.exited_by || "Security"}.`,
      });
      await load(true);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("gate-entries:refresh"));
      }
      setExitTarget(null);
      setExitPass("");
      setExitVerified(false);
    } catch (error: any) {
      toast.error("Gate exit approval failed", {
        description:
          error?.message || "Ensure receiving/unloading is complete before approving vehicle exit.",
      });
    } finally {
      setAssigning(null);
    }
  }

  return (
    <AppShell
      title={
        <span className="gate-entry-title inline-flex items-center gap-3">
          <span className="gate-entry-title-icon inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-primary">
            <Truck className="size-5" aria-hidden="true" />
          </span>
          <span>Vehicle Entry &amp; Exit Management</span>
        </span>
      }
      subtitle="Create gate entries, generate gate passes, and securely manage vehicle exits."
      onSearchChange={(value) => {
        setSearchQuery(value);
        setArrivalPage(1);
      }}
      actions={
        <div className="gate-entry-actions flex flex-wrap justify-end gap-2">
          <Button
            className="rounded-xl font-bold shadow-sm"
            onClick={() => setIsNewRegistrationModalOpen(true)}
          >
            <PlusCircle className="mr-2 size-4" /> New Gate Entry
          </Button>
          <Button data-refresh-control="true" size="icon" aria-label="Refresh" title="Refresh" variant="outline" className="rounded-xl" onClick={() => void load()}>
            <RefreshCw className="size-4" /></Button>
        </div>
      }
    >
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="font-bold">Vehicle Entries</h2>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              className="w-full sm:w-56"
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setArrivalPage(1);
              }}
              placeholder="Search vehicles…"
              aria-label="Search vehicle entries"
            />
            <select
              className="h-9 min-w-40 shrink-0 whitespace-nowrap rounded-md border bg-background px-2 text-sm"
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value);
                setArrivalPage(1);
              }}
              aria-label="Filter vehicle entry status"
            >
              <option value="ALL">All statuses</option>
              {arrivalStatuses.map((status) => (
                <option key={status} value={status}>
                  {status.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </div>
        </div>
        {loading ? (
          <div className="grid h-64 place-items-center">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : filteredArrivals.length === 0 ? (
          <div className="grid min-h-64 place-items-center p-8 text-center text-muted-foreground">
            <Truck className="size-10 stroke-1" />
            <p className="mt-2 font-medium">
              {searchQuery.trim() || statusFilter !== "ALL" ? "No matching inbound vehicles" : "No inbound vehicles in queue"}
            </p>
          </div>
        ) : (
          <div className="overflow-hidden bg-card">
            <table aria-label="Vehicle entries and exits" className="w-full min-w-0 table-fixed text-left text-sm [&_th]:align-middle [&_td]:align-middle">
              <colgroup>
                <col className="w-[11%]" />
                <col className="w-[10%]" />
                <col className="w-[12%]" />
                <col className="w-[16%]" />
                <col className="w-[12%]" />
                <col className="w-[10%]" />
                <col className="w-[13%]" />
                <col className="w-[16%]" />
              </colgroup>
              <thead className="border-b bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground [&_th]:font-semibold">
                <tr>
                  <th className="px-2 py-3 sm:px-3">ASN Number</th>
                  <th className="px-2 py-3 sm:px-3">Gate Pass No.</th>
                  <th className="px-2 py-3 sm:px-3">Supplier</th>
                  <th className="px-2 py-3 sm:px-3">Vehicle / Driver</th>
                  <th className="px-2 py-3 sm:px-3">Expected Arrival</th>
                  <th className="px-2 py-3 sm:px-3">Actual Arrival</th>
                  <th className="px-2 py-3 sm:px-3">Status</th>
                  <th className="px-2 py-3 sm:px-3">
                    <span className="block w-full text-center">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visibleArrivals.map((arrival) => (
                  <ArrivalRows
                    key={arrival.id}
                    arrival={arrival}
                    expanded={false}
                    onToggle={() => setSelectedArrival(arrival)}
                    docks={docks}
                    selected={selectedDock[arrival.id] || ""}
                    onSelect={(dockId) => setSelectedDock((v) => ({ ...v, [arrival.id]: dockId }))}
                    onAssign={() => void assignDock(arrival)}
                    onMove={() => void startMovement(arrival)}
                    onCheckIn={() => void confirmDockArrival(arrival)}
                    onDockCheckIn={() => void confirmPhysicalDockArrival(arrival)}
                    onApproveExit={() => void approveGateExit(arrival)}
                    isEligibleForInboundExit={isEligibleForInboundExit}
                    busy={assigning === arrival.id}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-col gap-3 border-t px-4 py-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            Showing {firstVisibleArrival}–{lastVisibleArrival} of {filteredArrivals.length} arrivals
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Previous page"
              disabled={arrivalPage === 1 || loading}
              onClick={() => setArrivalPage((page) => Math.max(1, page - 1))}
              className="focus-visible:ring-2 focus-visible:ring-primary"
            >
              Previous
            </Button>
            <span
              aria-label="Current page"
              className="min-w-8 text-center font-medium text-foreground"
            >
              {arrivalPage}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Next page"
              disabled={arrivalPage >= totalArrivalPages || loading}
              onClick={() => setArrivalPage((page) => Math.min(totalArrivalPages, page + 1))}
              className="focus-visible:ring-2 focus-visible:ring-primary"
            >
              Next
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={Boolean(exitTarget)} onOpenChange={(open) => !open && setExitTarget(null)}>
        <DialogContent className="max-w-md rounded-2xl bg-card p-6 shadow-2xl">
          <DialogHeader>
            <DialogTitle>Vehicle Gate Exit</DialogTitle>
            <DialogDescription>
              Enter the gate pass generated during gate entry to complete vehicle exit.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-3">
            <div>
              <Label htmlFor="exit-gate-pass">Gate Pass Number *</Label>
              <div className="flex gap-2">
                <Input
                  id="exit-gate-pass"
                  value={exitPass}
                  onChange={(e) => {
                    setExitPass(e.target.value.toUpperCase());
                    setExitVerified(false);
                  }}
                  placeholder="Enter or scan gate pass number"
                  autoFocus
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={!exitPass.trim()}
                  onClick={verifyGatePass}
                >
                  Verify
                </Button>
              </div>
            </div>
            {exitVerified && exitTarget && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
                <p>
                  <b>Gate pass verified:</b> {exitTarget.gate_entry_number}
                </p>
                <p>
                  <b>Vehicle:</b> {exitTarget.vehicle_number || "—"}
                </p>
                <p>
                  <b>Driver:</b> {exitTarget.driver_name || "—"}
                </p>
                <p>
                  <b>Status:</b> {exitTarget.status.replaceAll("_", " ")}
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExitTarget(null)}>
              Cancel
            </Button>
            <Button
              disabled={!exitVerified || Boolean(assigning)}
              onClick={() => void confirmGateExit()}
            >
              {assigning ? "Processing…" : "Confirm Exit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(selectedArrival)}
        onOpenChange={(open) => !open && setSelectedArrival(null)}
      >
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto rounded-2xl bg-card p-6 shadow-2xl">
          {selectedArrival && (
            <ArrivalDetails
              arrival={selectedArrival}
              docks={docks}
              selected={selectedDock[selectedArrival.id] || ""}
              onSelect={(dockId) =>
                setSelectedDock((v) => ({ ...v, [selectedArrival.id]: dockId }))
              }
              onAssign={() => void assignDock(selectedArrival)}
              onMove={() => void startMovement(selectedArrival)}
              onCheckIn={() => void confirmDockArrival(selectedArrival)}
              onDockCheckIn={() => void confirmPhysicalDockArrival(selectedArrival)}
              busy={assigning === selectedArrival.id}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* FR-02 New Gate Entry Registration Modal */}
      <Dialog open={isNewRegistrationModalOpen} onOpenChange={setIsNewRegistrationModalOpen}>
        <DialogContent className="max-w-2xl rounded-2xl bg-card p-6 shadow-2xl">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (asnTransportEntries.length > 0 && selectedTransportIndex < 0) {
                toast.error("No supplier-assigned vehicle is available", {
                  description: "Every vehicle on this ASN already has an active gate pass. Record its exit before creating another entry.",
                });
                return;
              }
              if (!asnDocumentFile) {
                toast.error("ASN Document Photo is required", {
                  description: "Capture the ASN document photo before generating the gate pass.",
                });
                return;
              }
              if (!vehiclePhotoBlob) {
                toast.error("Vehicle Photo is required", {
                  description: "Capture the vehicle photo before generating the gate pass.",
                });
                return;
              }
              setSubmittingWebEntry(true);
              const formData = new FormData();
              formData.append("vehicle_number", vehicleNumberInput);
              formData.append("asn_reference", selectedAsn);
              formData.append("supplier_name", selectedSupplier);
              formData.append("driver_name", driverNameInput);
              if (driverMobileInput.trim())
                formData.append("driver_contact", driverMobileInput.trim());
              if (asnDocumentFile)
                formData.append("po_document", asnDocumentFile, asnDocumentFile.name);
              const asnQuantity = asnMaterials.reduce(
                (total, line) => total + Number(line.shipped_quantity ?? line.quantity ?? 0),
                0,
              );
              formData.append("total_quantity", String(asnQuantity));
              if (vehiclePhotoBlob)
                formData.append("vehicle_photo", vehiclePhotoBlob, "vehicle-photo.jpg");
              api
                .createGateEntry(formData)
                .then(async (createdEntry) => {
                  setSubmittingWebEntry(false);
                  setIsNewRegistrationModalOpen(false);
                  const savedEntry = createdEntry?.data || createdEntry?.gate_entry || createdEntry;
                  let gatePassId =
                    savedEntry?.gate_entry_number ||
                    savedEntry?.gate_entry_no ||
                    savedEntry?.gate_pass_number ||
                    savedEntry?.gate_pass_id;
                  if (!gatePassId) {
                    const arrivals = await api.getInboundArrivals();
                    const matchingArrival = arrivals.find(
                      (arrival: any) =>
                        String(arrival.asn_number || "").toLowerCase() ===
                          selectedAsn.toLowerCase() &&
                        String(arrival.vehicle_number || "")
                          .replace(/[^a-z0-9]/gi, "")
                          .toLowerCase() ===
                          vehicleNumberInput.replace(/[^a-z0-9]/gi, "").toLowerCase(),
                    );
                    gatePassId = matchingArrival?.gate_entry_number;
                  }
                  if (!gatePassId) {
                    throw new Error(
                      "Gate entry was created but no persisted gate-pass number was returned.",
                    );
                  }
                  setGeneratedGatePass(gatePassId);
                  toast.success("Web Gate Entry Registered Successfully ✓", {
                    description: `Gate Pass: ${gatePassId}\nSupplier: ${selectedSupplier}\nASN: ${selectedAsn}`,
                  });
                  void load();
                })
                .catch((error) => {
                  setSubmittingWebEntry(false);
                  if (String(error instanceof Error ? error.message : "").includes("already has active Gate Pass")) {
                    void api.getInboundArrivals(true).then((rows) => {
                      arrivalsRef.current = rows;
                      setArrivals(rows);
                      const selectedRecord = asnRecords.find(
                        (record) => String(record.asn_number || "").toLowerCase() === selectedAsn.toLowerCase(),
                      );
                      if (selectedRecord) applyAsnDetails(selectedRecord);
                    });
                  }
                  toast.error("Unable to register gate entry", {
                    description: error instanceof Error ? error.message : "Please try again.",
                  });
                });
            }}
            className="space-y-4 text-xs"
          >
            {/* SECTION A: SUPPLIER AND SHIPMENT DETAILS */}
            <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                {/* Supplier Searchable Dropdown */}
                <div>
                  <label className="text-[10px] font-bold uppercase text-muted-foreground block mb-1">
                    Supplier *
                  </label>
                  <input
                    type="text"
                    value={selectedSupplier}
                    readOnly
                    className="h-9 w-full rounded-xl border bg-muted/50 px-3 font-semibold text-xs text-primary"
                  />
                </div>

                {/* ASN Number Searchable Dropdown */}
                <div className="order-first sm:order-first">
                  <label className="text-[10px] font-bold uppercase text-muted-foreground block mb-1">
                    ASN Number *
                  </label>
                  <input
                    type="text"
                    value={selectedAsn}
                    autoFocus
                    onChange={(e) => {
                      setSelectedAsn(e.target.value);
                      applyAsnDetails({});
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                      }
                    }}
                    placeholder="Enter ASN number"
                    className="h-9 w-full rounded-xl border bg-background px-3 font-semibold text-xs font-mono focus:ring-1 focus:ring-primary"
                  />
                </div>

                {/* Expected Delivery Date Auto-Filled */}
                <div>
                  <label className="text-[10px] font-bold uppercase text-muted-foreground block mb-1">
                    Expected Delivery Date *
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={autoExpectedDate}
                    className="h-9 w-full rounded-xl border bg-muted/50 px-3 font-bold text-xs text-emerald-600 dark:text-emerald-400"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase text-muted-foreground block mb-1">
                    ASN Document Photo *
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 w-full rounded-xl text-xs"
                    onClick={() => void openAsnCamera()}
                  >
                    <Camera className="mr-2 size-4" /> Open Camera
                  </Button>
                  {asnCameraOpen && (
                    <div className="mt-2 space-y-2 rounded-xl border bg-background p-2">
                      <video
                        ref={asnCameraVideoRef}
                        autoPlay
                        playsInline
                        className="w-full rounded-lg"
                      />
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          className="h-8 flex-1 text-xs"
                          onClick={captureAsnDocument}
                        >
                          Capture Photograph
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-8 text-xs"
                          onClick={closeAsnCamera}
                        >
                          Close
                        </Button>
                      </div>
                    </div>
                  )}
                  {asnDocumentFile && (
                    <p className="mt-1 text-[10px] font-bold text-emerald-600">
                      ✓ Photograph captured
                    </p>
                  )}
                  {asnDocumentPreview && (
                    <img
                      src={asnDocumentPreview}
                      alt="Captured ASN document"
                      className="mt-2 h-32 w-full rounded-lg border object-cover"
                    />
                  )}
                </div>

                {/* Delivery Type Dropdown */}
                <div className="hidden">
                  <label className="text-[10px] font-bold uppercase text-muted-foreground block mb-1">
                    Delivery Type *
                  </label>
                  <select
                    value={deliveryType}
                    onChange={(e) => setDeliveryType(e.target.value)}
                    className="h-9 w-full rounded-xl border bg-background px-3 font-semibold text-xs focus:ring-1 focus:ring-primary"
                  >
                    <option value="Regular Delivery">Regular Delivery</option>
                    <option value="Partial Delivery">Partial Delivery</option>
                    <option value="Replacement Delivery">Replacement Delivery</option>
                    <option value="Return Delivery">Return Delivery</option>
                    <option value="Other Authorized Inbound">Other Authorized Inbound</option>
                  </select>
                </div>
              </div>

              {/* Remarks Textarea */}
              <div className="hidden">
                <label className="text-[10px] font-bold uppercase text-muted-foreground block mb-1">
                  Remarks (Optional)
                </label>
                <textarea
                  rows={2}
                  value={remarksText}
                  onChange={(e) => setRemarksText(e.target.value)}
                  placeholder="Enter any additional inbound shipment or gate notes..."
                  className="w-full rounded-xl border bg-background p-2.5 text-xs font-medium focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            {/* SECTION B: VEHICLE AND DRIVER DETAILS */}
            <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
              {asnTransportEntries.length > 1 && (
                <div>
                  <label className="text-[10px] font-bold uppercase text-muted-foreground block mb-1">
                    Supplier-assigned vehicles ({asnTransportEntries.length})
                  </label>
                  <select
                    value={selectedTransportIndex}
                    onChange={(event) => {
                      const index = Number(event.target.value);
                      const entry = asnTransportEntries[index];
                      if (!entry || entry.has_active_gate_pass) return;
                      setSelectedTransportIndex(index);
                      setVehicleNumberInput(entry.vehicle_number);
                      setDriverNameInput(entry.driver_name);
                      setDriverMobileInput(entry.driver_contact);
                      setVehiclePhotoBlob(null);
                      setVehiclePhotoPreview(null);
                      setUploadedVehiclePhoto(null);
                    }}
                    className="h-9 w-full rounded-xl border bg-background px-3 text-xs font-semibold focus:ring-1 focus:ring-primary"
                  >
                    {selectedTransportIndex < 0 && (
                      <option value={-1}>No assigned vehicle is currently available</option>
                    )}
                    {asnTransportEntries.map((entry, index) => (
                      <option
                        key={`${entry.vehicle_number}-${index}`}
                        value={index}
                        disabled={entry.has_active_gate_pass}
                      >
                        Vehicle & Driver #{index + 1}: {entry.vehicle_number} ·{" "}
                        {entry.driver_name || "Driver"}
                        {entry.has_active_gate_pass ? " · Active gate pass" : " · Available"}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    The next vehicle without an active gate pass is selected automatically.
                  </p>
                </div>
              )}
              {asnTransportEntries.length > 0 &&
                asnTransportEntries.every((entry) => entry.has_active_gate_pass) && (
                  <p
                    className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900"
                    role="alert"
                  >
                    All supplier-assigned vehicles already have active gate passes for this ASN.
                    Create another pass after a vehicle exits.
                  </p>
                )}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-[10px] font-bold uppercase text-muted-foreground block mb-1">
                    Vehicle Registration Number *
                  </label>
                  <input
                    type="text"
                    required
                    value={vehicleNumberInput}
                    readOnly
                    className="h-9 w-full rounded-xl border bg-muted/50 px-3 font-mono font-bold text-xs text-primary"
                  />
                </div>

                <div className="hidden">
                  <label className="text-[10px] font-bold uppercase text-muted-foreground block mb-1">
                    Vehicle Type *
                  </label>
                  <select
                    value={vehicleTypeInput}
                    onChange={(e) => setVehicleTypeInput(e.target.value)}
                    className="h-9 w-full rounded-xl border bg-background px-3 font-semibold text-xs focus:ring-1 focus:ring-primary"
                  >
                    <option value="Truck">Truck</option>
                    <option value="Mini Truck">Mini Truck</option>
                    <option value="Container Truck">Container Truck</option>
                    <option value="Van">Van</option>
                    <option value="Tempo">Tempo</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase text-muted-foreground block mb-1">
                    Driver Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={driverNameInput}
                    readOnly
                    className="h-9 w-full rounded-xl border bg-muted/50 px-3 font-semibold text-xs text-primary"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase text-muted-foreground block mb-1">
                    Driver Mobile Number *
                  </label>
                  <input
                    type="text"
                    required
                    value={driverMobileInput}
                    readOnly
                    className="h-9 w-full rounded-xl border bg-muted/50 px-3 font-mono text-xs text-primary"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase text-muted-foreground block mb-1">
                    Vehicle Photo *
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 w-full rounded-xl text-xs"
                    onClick={() => void openVehicleCamera()}
                  >
                    <Camera className="mr-2 size-4" /> Open Camera
                  </Button>
                  {cameraOpen && (
                    <div className="mt-2 space-y-2 rounded-xl border bg-background p-2">
                      <video
                        ref={cameraVideoRef}
                        autoPlay
                        playsInline
                        className="w-full rounded-lg"
                      />
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          className="h-8 flex-1 text-xs"
                          onClick={captureVehiclePhoto}
                        >
                          Capture Photo
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-8 text-xs"
                          onClick={closeVehicleCamera}
                        >
                          Close
                        </Button>
                      </div>
                    </div>
                  )}
                  {uploadedVehiclePhoto && (
                    <p className="mt-1 text-[10px] font-bold text-emerald-600">
                      ✓{" "}
                      {uploadedVehiclePhoto.startsWith("vehicle-photo-")
                        ? "vehicle-photo-captured"
                        : uploadedVehiclePhoto}
                    </p>
                  )}
                  {vehiclePhotoPreview && (
                    <div className="relative mt-2">
                      <img
                        src={vehiclePhotoPreview}
                        alt="Captured vehicle"
                        className="h-24 w-full rounded-lg object-cover"
                      />
                    </div>
                  )}
                </div>

                <div className="hidden">
                  <label className="text-[10px] font-bold uppercase text-muted-foreground block mb-1">
                    Transporter Name (Optional)
                  </label>
                  <input
                    type="text"
                    value={transporterInput}
                    onChange={(e) => setTransporterInput(e.target.value)}
                    placeholder="Transporter / Logistics Company"
                    className="h-9 w-full rounded-xl border bg-background px-3 font-semibold text-xs focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div className="hidden">
                  <label className="text-[10px] font-bold uppercase text-muted-foreground block mb-1">
                    Driver ID Type
                  </label>
                  <select
                    value={driverIdTypeInput}
                    onChange={(e) => setDriverIdTypeInput(e.target.value)}
                    className="h-9 w-full rounded-xl border bg-background px-3 font-semibold text-xs focus:ring-1 focus:ring-primary"
                  >
                    <option value="Driving Licence">Driving Licence</option>
                    <option value="Aadhaar">Aadhaar Card</option>
                    <option value="Government ID">Government ID</option>
                    <option value="Company Gate Badge">Company Gate Badge</option>
                  </select>
                </div>

                <div className="hidden">
                  <label className="text-[10px] font-bold uppercase text-muted-foreground block mb-1">
                    Driver ID Reference (Site Policy)
                  </label>
                  <input
                    type="text"
                    value={driverIdRefInput}
                    onChange={(e) => setDriverIdRefInput(e.target.value)}
                    placeholder="e.g. DL-2026-90812"
                    className="h-9 w-full rounded-xl border bg-background px-3 font-mono text-xs focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div className="hidden">
                  <label className="text-[10px] font-bold uppercase text-muted-foreground block mb-1">
                    Entry Gate *
                  </label>
                  <select
                    value={entryGateInput}
                    onChange={(e) => setEntryGateInput(e.target.value)}
                    className="h-9 w-full rounded-xl border bg-background px-3 font-semibold text-xs focus:ring-1 focus:ring-primary"
                  >
                    <option value="Main Gate – 01">Main Gate – 01</option>
                    <option value="North Gate – 02">North Gate – 02</option>
                    <option value="South Gate – 03">South Gate – 03</option>
                  </select>
                </div>
              </div>
            </div>

            {/* SECTION C: INVOICE AND SUPPORTING DOCUMENTS */}
            <div className="hidden rounded-xl border bg-muted/30 p-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-[10px] font-bold uppercase text-muted-foreground block mb-1">
                    Supplier Invoice Number *
                  </label>
                  <input
                    type="text"
                    required
                    value={invoiceNoInput}
                    onChange={(e) => setInvoiceNoInput(e.target.value)}
                    placeholder="e.g. INV-2026-9901"
                    className="h-9 w-full rounded-xl border bg-background px-3 font-mono font-bold text-xs focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase text-muted-foreground block mb-1">
                    Invoice Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={invoiceDateInput}
                    onChange={(e) => setInvoiceDateInput(e.target.value)}
                    className="h-9 w-full rounded-xl border bg-background px-3 text-xs font-semibold focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase text-muted-foreground block mb-1">
                    Delivery Challan Number
                  </label>
                  <input
                    type="text"
                    value={challanNoInput}
                    onChange={(e) => setChallanNoInput(e.target.value)}
                    placeholder="e.g. DC-2026-4412"
                    className="h-9 w-full rounded-xl border bg-background px-3 font-mono text-xs focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase text-muted-foreground block mb-1">
                    E-Way Bill Number
                  </label>
                  <input
                    type="text"
                    value={ewayNoInput}
                    onChange={(e) => setEwayNoInput(e.target.value)}
                    placeholder="e.g. EWAY-8812-4091"
                    className="h-9 w-full rounded-xl border bg-background px-3 font-mono text-xs focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>

              {/* Uploads */}
              <div className="grid gap-3 sm:grid-cols-2 pt-2">
                <div className="rounded-xl border border-dashed p-3 text-center bg-background">
                  <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">
                    Supplier Invoice Copy (PDF/JPG/PNG) *
                  </p>
                  <input
                    type="file"
                    accept=".pdf,.jpg,.png"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) setUploadedInvoiceFile(file.name);
                    }}
                    className="text-xs w-full"
                  />
                  {uploadedInvoiceFile && (
                    <p className="text-[10px] font-bold text-emerald-600 mt-1">
                      ✓ {uploadedInvoiceFile}
                    </p>
                  )}
                </div>

                <div className="rounded-xl border border-dashed p-3 text-center bg-background">
                  <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">
                    Vehicle Front Plate Photograph (JPG/PNG)
                  </p>
                  <input
                    type="file"
                    accept=".jpg,.png"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) setUploadedVehiclePhoto(file.name);
                    }}
                    className="text-xs w-full"
                  />
                  {uploadedVehiclePhoto && (
                    <p className="text-[10px] font-bold text-emerald-600 mt-1">
                      ✓{" "}
                      {uploadedVehiclePhoto.startsWith("vehicle-photo-")
                        ? "vehicle-photo-captured"
                        : uploadedVehiclePhoto}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* SECTION D: SHIPMENT VERIFICATION TABLE */}
            <div className="hidden rounded-xl border bg-muted/30 p-4 space-y-2">
              <div className="overflow-x-auto rounded-xl border bg-background">
                <table className="w-full text-left text-xs">
                  <thead className="border-b bg-muted/40 font-bold uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Material</th>
                      <th className="px-3 py-2 text-right">Ordered Qty</th>
                      <th className="px-3 py-2 text-right">ASN Qty</th>
                      <th className="px-3 py-2 text-right">UOM</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    <tr>
                      <td className="px-3 py-2 font-bold">
                        Stainless Steel Sheet 304 (MAT-SS-304-001)
                      </td>
                      <td className="px-3 py-2 text-right font-semibold">500</td>
                      <td className="px-3 py-2 text-right font-bold text-emerald-600">500</td>
                      <td className="px-3 py-2 text-right font-mono">KG</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <p className="text-[10px] text-muted-foreground italic">
                * Security verifies the shipment reference and documentation, but does not perform
                final quantity acceptance or quality inspection. Actual received quantities are
                determined later in the receiving/GRN process.
              </p>
            </div>

            {/* Actions */}
            <div className="flex gap-2 justify-end">
              <Button
                type="button"
                variant="outline"
                className="rounded-xl"
                onClick={() => setIsNewRegistrationModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submittingWebEntry || (asnTransportEntries.length > 0 && selectedTransportIndex < 0)}
                className="rounded-xl font-bold shadow-sm"
              >
                {submittingWebEntry ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <PlusCircle className="mr-2 size-4" />
                )}
                Generate Gate Pass →
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(generatedGatePass)}
        onOpenChange={(open) => {
          if (!open) {
            setGeneratedGatePass(null);
          }
        }}
      >
        <DialogContent className="max-w-md rounded-2xl bg-card p-6 text-center shadow-2xl">
          <div className="mx-auto grid size-14 place-items-center rounded-full bg-emerald-100 text-emerald-600">
            <ShieldCheck className="size-8" />
          </div>
          <h2 className="mt-4 text-xl font-black text-primary">Gate Pass Generated</h2>
          <p className="mt-2 text-xs text-muted-foreground">Show this pass at the security gate.</p>
          <div className="mt-4 rounded-xl border bg-muted/40 p-4 font-mono text-2xl font-black tracking-wider text-primary">
            {generatedGatePass}
          </div>
          <div className="mt-5 flex gap-2">
            <Button
              variant="outline"
              className="w-full rounded-xl"
              onClick={() => {
                setGeneratedGatePass(null);
              }}
            >
              Done
            </Button>
            <Button
              className="w-full rounded-xl"
              disabled={
                !arrivals.some(
                  (arrival) =>
                    arrival.gate_entry_number === generatedGatePass &&
                    isEligibleForInboundExit(arrival.status),
                )
              }
              title="Exit becomes available after GRN/receiving is complete and the dock is released"
              onClick={async () => {
                const rows = await api.getInboundArrivals();
                const arrival = rows.find(
                  (row: Arrival) => row.gate_entry_number === generatedGatePass,
                );
                setGeneratedGatePass(null);
                if (arrival && isEligibleForInboundExit(arrival.status)) setExitTarget(arrival);
                else if (arrival)
                  toast.error("Exit is not ready", {
                    description:
                      "GRN/receiving must be completed and the dock must be released first.",
                  });
                else
                  toast.error("Gate pass was created, but its active visit could not be loaded.");
              }}
            >
              Exit Vehicle
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function ArrivalRows({
  arrival,
  expanded,
  onToggle,
  docks,
  selected,
  onSelect,
  onAssign,
  onMove,
  onCheckIn,
  onDockCheckIn,
  onApproveExit,
  isEligibleForInboundExit,
  busy,
}: {
  arrival: Arrival;
  expanded: boolean;
  onToggle: () => void;
  docks: Dock[];
  selected: string;
  onSelect: (id: string) => void;
  onAssign: () => void;
  onMove: () => void;
  onCheckIn: () => void;
  onDockCheckIn: () => void;
  onApproveExit: (arrival: Arrival) => void;
  isEligibleForInboundExit: (status: string) => boolean;
  busy: boolean;
}) {
  const isExited = arrival.status === "VEHICLE_EXITED" || !!arrival.exited_at;

  return (
    <>
      <tr className="hover:bg-muted/20">
        <td className="whitespace-nowrap px-2 py-3 sm:px-3">
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onToggle();
            }}
            aria-expanded={expanded}
            className="font-mono font-semibold text-primary hover:underline"
          >
            {arrival.asn_number}
          </button>
        </td>
        <td className="whitespace-nowrap px-2 py-3 font-mono text-xs font-semibold text-primary sm:px-3">
          {arrival.gate_entry_number || "—"}
        </td>
        <td className="break-words px-2 py-3 font-medium leading-5 sm:px-3">{displaySupplierName(arrival.supplier_name) || "—"}</td>
        <td className="px-2 py-3 sm:px-3">
          <p className="break-words font-mono text-xs font-semibold">{arrival.vehicle_number}</p>
          <p className="mt-1 text-xs text-muted-foreground">{arrival.driver_name || "—"}</p>
        </td>
        <td className="whitespace-nowrap px-2 py-3 text-xs tabular-nums sm:px-3">
          {arrival.expected_arrival_at
            ? new Date(arrival.expected_arrival_at).toLocaleDateString([], {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })
            : "—"}
        </td>
        <td className="whitespace-nowrap px-2 py-3 text-xs tabular-nums sm:px-3">
          {new Date(arrival.arrival_time).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </td>
        <td className="px-2 py-3 sm:px-3">
          <StatusBadge status={isExited ? "EXITED" : arrival.status} />
        </td>
        <td className="whitespace-nowrap px-2 py-3 sm:px-3">
          <div className="flex flex-nowrap items-center justify-end gap-1.5 [&_button]:h-8 [&_button]:justify-center [&_button]:px-2 [&_button]:text-[11px] [&_button]:font-semibold">
            <Button size="sm" variant="outline" className="rounded-lg whitespace-nowrap" onClick={onToggle} aria-label={`View details for ${arrival.gate_entry_number || arrival.asn_number}`}>
              <Eye className="size-3.5" /> Details
            </Button>
            {!isExited && (
              <Button
                size="sm"
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-sm gap-1.5 text-xs px-3 whitespace-nowrap"
                disabled={busy || !isEligibleForInboundExit(arrival.status)}
                onClick={() => onApproveExit(arrival)}
                aria-label={`Exit vehicle ${arrival.vehicle_number || ""}`}
                title={
                  isEligibleForInboundExit(arrival.status)
                    ? "Enter and verify the gate pass to complete vehicle exit"
                    : "Vehicle is not ready for exit"
                }
              >
                <ShieldCheck className="size-3.5" /> Exit
              </Button>
            )}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={8} className="bg-muted/20 px-4 py-5">
            <ArrivalDetails
              arrival={arrival}
              docks={docks}
              selected={selected}
              onSelect={onSelect}
              onAssign={onAssign}
              onMove={onMove}
              onCheckIn={onCheckIn}
              onDockCheckIn={onDockCheckIn}
              busy={busy}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function ArrivalDetails({
  arrival,
  docks,
  selected,
  onSelect,
  onAssign,
  onMove,
  onCheckIn,
  onDockCheckIn,
  busy,
}: {
  arrival: Arrival;
  docks: Dock[];
  selected: string;
  onSelect: (id: string) => void;
  onAssign: () => void;
  onMove: () => void;
  onCheckIn: () => void;
  onDockCheckIn: () => void;
  busy: boolean;
}) {
  const imageSrc = (value?: string | null) => {
    if (!value) return "";
    return value.startsWith("data:") || value.startsWith("http")
      ? value
      : `data:image/jpeg;base64,${value}`;
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border bg-card p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Inbound arrival details
            </p>
            <h3 className="mt-1 font-mono text-lg font-bold text-primary">{arrival.asn_number}</h3>
          </div>
          <StatusBadge status={arrival.status} />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
        <section className="min-w-0 rounded-lg border bg-muted/10 p-4">
          <h4 className="mb-4 text-sm font-semibold">Shipment details</h4>
        <dl className="grid gap-x-4 gap-y-4 text-sm sm:grid-cols-2">
          <Detail label="ASN number" value={arrival.asn_number} mono />
          <Detail label="Supplier" value={displaySupplierName(arrival.supplier_name)} />
          <Detail label="Current status" value={arrival.status.replaceAll("_", " ")} />
          <Detail label="Arrival time" value={formatApiDateTime(arrival.arrival_time)} />
        </dl>
        </section>
        <section className="min-w-0 rounded-lg border bg-muted/10 p-4">
          <h4 className="mb-4 text-sm font-semibold">Vehicle / Driver</h4>
          <dl className="grid gap-x-4 gap-y-4 text-sm sm:grid-cols-2">
            <Detail label="Vehicle number" value={arrival.vehicle_number} mono />
            <Detail label="Driver" value={arrival.driver_name} />
            <Detail label="Driver contact" value={arrival.driver_contact} />
          </dl>
        </section>
        </div>
        <div className="mt-5 grid gap-4 border-t pt-4 md:grid-cols-2">
        <div className="min-w-0">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Vehicle photo
          </p>
          {arrival.truck_photo_base64 || arrival.vehicle_photo_base64 ? (
            <img
              src={imageSrc(arrival.truck_photo_base64 || arrival.vehicle_photo_base64)}
              alt={`Vehicle ${arrival.vehicle_number || "photo"}`}
              className="h-60 w-full rounded-xl border object-contain bg-muted/20 p-2"
            />
          ) : (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              No vehicle photo uploaded.
            </p>
          )}
        </div>
        <div className="min-w-0">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            ASN document photograph
          </p>
          {arrival.document_image_base64 ? (
            <img
              src={imageSrc(arrival.document_image_base64)}
              alt={`ASN document for ${arrival.asn_number || "gate entry"}`}
              className="h-60 w-full rounded-xl border object-contain bg-muted/20 p-2"
            />
          ) : (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              No ASN document photograph captured.
            </p>
          )}
        </div>
        </div>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="min-w-0 rounded-xl border bg-card p-4">
          <h3 className="mb-3 flex items-center gap-2 font-semibold">
            <Boxes className="size-4 text-primary" /> Gate entry information
          </h3>
          <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-x-4 gap-y-3 text-sm [&_dd]:break-words">
            <dt className="text-muted-foreground">Gate entry</dt>
            <dd className="font-mono">{arrival.gate_entry_number}</dd>
            <dt className="text-muted-foreground">Entry time</dt>
            <dd>
              {arrival.facility_entry_at || arrival.arrival_time
                ? formatApiDateTime(arrival.facility_entry_at || arrival.arrival_time)
                : "Not entered"}
            </dd>
            <dt className="text-muted-foreground">Allocated dock</dt>
            <dd className="font-semibold">{arrival.assigned_dock_id || "—"}</dd>
            <dt className="text-muted-foreground">Dock assigned</dt>
            <dd>{formatApiDateTime(arrival.assigned_at)}</dd>
            <dt className="text-muted-foreground">Assigned by</dt>
            <dd>{arrival.assigned_by || "—"}</dd>
            <dt className="text-muted-foreground">Dock check-in</dt>
            <dd>
              {arrival.dock_arrival_at || arrival.allocation_arrived_at
                ? new Date(
                    arrival.dock_arrival_at || arrival.allocation_arrived_at!,
                  ).toLocaleString()
                : "Not checked in"}
            </dd>
          </dl>
          {arrival.status === "DOCK_ASSIGNED" && (
            <Button
              className="mt-4 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={onMove}
              disabled={busy}
            >
              <ShieldCheck className="size-4" /> Allow Entry
            </Button>
          )}
          {arrival.assigned_dock_id &&
            (arrival.status === "INSIDE_FACILITY" || arrival.status === "MOVING_TO_DOCK") && (
              <Button className="mt-4 rounded-lg" onClick={onDockCheckIn} disabled={busy}>
                <ShieldCheck className="size-4" /> Confirm Dock Check-In
              </Button>
            )}
        </div>
        <div className="min-w-0 rounded-xl border bg-card p-4">
          <h3 className="mb-3 font-semibold">Expected materials</h3>
          <div className="space-y-2">
            {arrival.expected_materials.map((m) => (
              <div
                key={m.item_code}
                className="flex items-start justify-between gap-4 rounded-lg border bg-card px-3 py-2 text-sm"
              >
                <span className="min-w-0 break-words">
                  <b>{m.item_code}</b>
                  <br />
                  {m.material_name}
                </span>
                <span className="shrink-0 font-semibold tabular-nums">
                  {m.quantity} {m.uom}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Detail({
  label,
  value,
  mono = false,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-1 break-words font-semibold leading-relaxed ${mono ? "font-mono" : ""}`}>{value || "—"}</dd>
    </div>
  );
}
