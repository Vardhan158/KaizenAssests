import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  Eye,
  FileCheck2,
  Loader2,
  PlusCircle,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Truck,
  Warehouse,
} from "lucide-react";
import { AppShell, StatusBadge } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api-client";

export const Route = createFileRoute("/vehicle-queue")({
  head: () => ({ meta: [{ title: "Inbound Arrivals · KaizenX" }] }),
  component: InboundArrivals,
});

type Arrival = {
  id: string;
  gate_entry_number: string;
  asn_id: string;
  asn_number: string;
  po_number: string;
  supplier_name: string;
  vehicle_number: string;
  driver_name: string;
  driver_contact?: string | null;
  arrival_time: string;
  expected_arrival_at?: string | null;
  status: string;
  exited_at?: string | null;
  exited_by?: string | null;
  assigned_dock_id?: string | null;
  po_id?: string | null;
  assigned_by?: string | null;
  assigned_at?: string | null;
  movement_started_by?: string | null;
  movement_started_at?: string | null;
  dock_checked_in_by?: string | null;
  dock_arrival_at?: string | null;
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

function InboundArrivals() {
  const search = useSearch({ strict: false }) as any;
  const [arrivals, setArrivals] = useState<Arrival[]>([]);
  const [docks, setDocks] = useState<Dock[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selectedDock, setSelectedDock] = useState<Record<string, string>>({});
  const [assigning, setAssigning] = useState<string | null>(null);

  // FR-02 New Gate Entry Registration Modal State
  const [isNewRegistrationModalOpen, setIsNewRegistrationModalOpen] = useState(
    Boolean(search?.action === "new")
  );

  // FR-02 Section A: Supplier and Shipment Details
  const [selectedWarehouse, setSelectedWarehouse] = useState("Raw Material Warehouse");
  const [selectedSupplier, setSelectedSupplier] = useState("Bharat Electronics Components Pvt. Ltd.");
  const [selectedAsn, setSelectedAsn] = useState("ASN-2026-004582");
  const [autoPoNumber, setAutoPoNumber] = useState("PO-2026-008741");
  const [autoExpectedDate, setAutoExpectedDate] = useState("07 Oct 2026");
  const [deliveryType, setDeliveryType] = useState("Regular Delivery");
  const [remarksText, setRemarksText] = useState("");

  // FR-02 Section B: Vehicle and Driver Details
  const [vehicleNumberInput, setVehicleNumberInput] = useState("KA 01 AB 4582");
  const [vehicleTypeInput, setVehicleTypeInput] = useState("Container Truck");
  const [driverNameInput, setDriverNameInput] = useState("Suresh Gowda");
  const [driverMobileInput, setDriverMobileInput] = useState("+91 98450 12345");
  const [transporterInput, setTransporterInput] = useState("VRL Logistics Ltd");
  const [driverIdTypeInput, setDriverIdTypeInput] = useState("Driving Licence");
  const [driverIdRefInput, setDriverIdRefInput] = useState("DL-2026-90812");
  const [entryGateInput, setEntryGateInput] = useState("Main Gate – 01");

  // FR-02 Section C: Invoice & Supporting Documents
  const [invoiceNoInput, setInvoiceNoInput] = useState("INV-2026-9901");
  const [invoiceDateInput, setInvoiceDateInput] = useState("2026-10-07");
  const [challanNoInput, setChallanNoInput] = useState("DC-2026-4412");
  const [ewayNoInput, setEwayNoInput] = useState("EWAY-8812-4091");
  const [uploadedInvoiceFile, setUploadedInvoiceFile] = useState<string | null>("invoice_copy_inv9901.pdf");
  const [uploadedVehiclePhoto, setUploadedVehiclePhoto] = useState<string | null>("truck_front_plate_ka01ab4582.jpg");
  const [submittingWebEntry, setSubmittingWebEntry] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [arrivalRows, dockRows] = await Promise.all([api.getInboundArrivals(), api.getDocks()]);
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

  const isEligibleForInboundExit = (statusStr: string) => {
    const upper = (statusStr || "").toUpperCase().trim();
    return [
      "RECEIVING_COMPLETED",
      "COMPLETED",
      "RELEASED",
      "DOCK_RELEASED",
      "GRN_POSTED",
      "QUALITY_PASSED",
      "UNLOADED",
    ].includes(upper);
  };

  async function approveGateExit(arrival: Arrival) {
    const vehName = arrival.vehicle_number || "this vehicle";
    if (!confirm(`Confirm gate exit approval for ${vehName}? Confirm that vehicle has completed unloading/receiving and is cleared to leave.`)) return;
    setAssigning(arrival.id);
    try {
      const updated = await api.markInboundVehicleExited(arrival.id);
      toast.success(`Gate exit approved for ${vehName}`, {
        description: `Status updated to VEHICLE_EXITED by ${updated.exited_by || "Security"}.`,
      });
      await load(true);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("gate-entries:refresh"));
      }
    } catch (error: any) {
      toast.error("Gate exit approval failed", {
        description: error?.message || "Ensure receiving/unloading is complete before approving vehicle exit.",
      });
    } finally {
      setAssigning(null);
    }
  }

  return (
    <AppShell
      title="Inbound arrivals"
      subtitle="Approved gate entries awaiting warehouse dock assignment"
      actions={
        <Button variant="outline" className="rounded-xl" onClick={() => void load()}>
          <RefreshCw className="size-4" /> Refresh
        </Button>
      }
    >
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Summary label="Arrivals in queue" value={arrivals.length} />
        <Summary
          label="Awaiting dock"
          value={arrivals.filter((a) => a.status === "AWAITING_DOCK").length}
        />
        <Summary
          label="Moving to dock"
          value={arrivals.filter((a) => a.status === "MOVING_TO_DOCK").length}
        />
        <Summary
          label="Available docks"
          value={docks.filter((d) => d.status === "AVAILABLE").length}
        />
      </div>

      <Card className="rounded-2xl p-0 shadow-soft overflow-hidden">
        {loading ? (
          <div className="grid h-64 place-items-center">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : arrivals.length === 0 ? (
          <div className="grid min-h-64 place-items-center p-8 text-center text-muted-foreground">
            <Truck className="size-10 stroke-1" />
            <p className="mt-2 font-medium">No inbound vehicles in queue</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">ASN Number</th>
                  <th className="px-4 py-3">PO Number</th>
                  <th className="px-4 py-3">Supplier</th>
                  <th className="px-4 py-3">Vehicle / Driver</th>
                  <th className="px-4 py-3">Arrival Time</th>
                  <th className="px-4 py-3">Status / Dock</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {arrivals.map((arrival) => (
                  <ArrivalRows
                    key={arrival.id}
                    arrival={arrival}
                    expanded={expanded === arrival.id}
                    onToggle={() => setExpanded(expanded === arrival.id ? null : arrival.id)}
                    docks={docks}
                    selected={selectedDock[arrival.id] || ""}
                    onSelect={(dockId) => setSelectedDock((v) => ({ ...v, [arrival.id]: dockId }))}
                    onAssign={() => void assignDock(arrival)}
                    onMove={() => void startMovement(arrival)}
                    onCheckIn={() => void confirmDockArrival(arrival)}
                    onApproveExit={() => void approveGateExit(arrival)}
                    isEligibleForInboundExit={isEligibleForInboundExit}
                    busy={assigning === arrival.id}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* FR-02 New Gate Entry Registration Modal */}
      <Dialog
        open={isNewRegistrationModalOpen}
        onOpenChange={setIsNewRegistrationModalOpen}
      >
        <DialogContent className="max-w-2xl rounded-2xl bg-card p-6 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="font-black text-lg text-primary uppercase">
              FR-02: NEW GATE ENTRY REGISTRATION
            </DialogTitle>
          </DialogHeader>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              setSubmittingWebEntry(true);
              setTimeout(() => {
                setSubmittingWebEntry(false);
                setIsNewRegistrationModalOpen(false);
                toast.success("Web Gate Entry Registered Successfully ✓", {
                  description: `Supplier: ${selectedSupplier}\nASN: ${selectedAsn} (${autoPoNumber})\nDelivery Type: ${deliveryType}`,
                });
                void load();
              }, 600);
            }}
            className="space-y-4 text-xs"
          >
            {/* SECTION A: SUPPLIER AND SHIPMENT DETAILS */}
            <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
              <h3 className="text-xs font-black uppercase tracking-wider text-primary border-b pb-2">
                SECTION A: SUPPLIER AND SHIPMENT DETAILS
              </h3>

              <div className="grid gap-3 sm:grid-cols-2">
                {/* Warehouse Dropdown */}
                <div>
                  <label className="text-[10px] font-bold uppercase text-muted-foreground block mb-1">
                    Warehouse *
                  </label>
                  <select
                    value={selectedWarehouse}
                    onChange={(e) => setSelectedWarehouse(e.target.value)}
                    className="h-9 w-full rounded-xl border bg-background px-3 font-semibold text-xs focus:ring-1 focus:ring-primary"
                  >
                    <option value="Raw Material Warehouse">Raw Material Warehouse</option>
                    <option value="Central Store">Central Store</option>
                    <option value="Electrical Spares Store">Electrical Spares Store</option>
                    <option value="Finished Goods Store">Finished Goods Store</option>
                  </select>
                </div>

                {/* Supplier Searchable Dropdown */}
                <div>
                  <label className="text-[10px] font-bold uppercase text-muted-foreground block mb-1">
                    Supplier *
                  </label>
                  <select
                    value={selectedSupplier}
                    onChange={(e) => setSelectedSupplier(e.target.value)}
                    className="h-9 w-full rounded-xl border bg-background px-3 font-semibold text-xs focus:ring-1 focus:ring-primary"
                  >
                    <option value="Bharat Electronics Components Pvt. Ltd.">Bharat Electronics Components Pvt. Ltd.</option>
                    <option value="SteelTech Heavy Precision Alloys">SteelTech Heavy Precision Alloys</option>
                    <option value="Mysore Electricals Ltd">Mysore Electricals Ltd</option>
                  </select>
                </div>

                {/* ASN Number Searchable Dropdown */}
                <div>
                  <label className="text-[10px] font-bold uppercase text-muted-foreground block mb-1">
                    ASN Number (Required for ASN Delivery) *
                  </label>
                  <select
                    value={selectedAsn}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSelectedAsn(val);
                      if (val === "ASN-2026-004582") {
                        setAutoPoNumber("PO-2026-008741");
                        setAutoExpectedDate("07 Oct 2026");
                      } else if (val === "ASN-2026-009912") {
                        setAutoPoNumber("PO-8755");
                        setAutoExpectedDate("08 Oct 2026");
                      } else {
                        setAutoPoNumber("PO-8790");
                        setAutoExpectedDate("09 Oct 2026");
                      }
                    }}
                    className="h-9 w-full rounded-xl border bg-background px-3 font-semibold text-xs font-mono focus:ring-1 focus:ring-primary"
                  >
                    <option value="ASN-2026-004582">ASN-2026-004582</option>
                    <option value="ASN-2026-009912">ASN-2026-009912</option>
                    <option value="ASN-2026-003310">ASN-2026-003310</option>
                  </select>
                </div>

                {/* PO Number Auto-Filled */}
                <div>
                  <label className="text-[10px] font-bold uppercase text-muted-foreground block mb-1">
                    PO Number (Auto-Filled)
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={autoPoNumber}
                    className="h-9 w-full rounded-xl border bg-muted/50 px-3 font-mono font-bold text-xs text-primary"
                  />
                </div>

                {/* Expected Delivery Date Auto-Filled */}
                <div>
                  <label className="text-[10px] font-bold uppercase text-muted-foreground block mb-1">
                    Expected Delivery Date (Read-Only)
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={autoExpectedDate}
                    className="h-9 w-full rounded-xl border bg-muted/50 px-3 font-bold text-xs text-emerald-600 dark:text-emerald-400"
                  />
                </div>

                {/* Delivery Type Dropdown */}
                <div>
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

              {/* Material Summary Auto-Filled Table */}
              <div>
                <label className="text-[10px] font-bold uppercase text-muted-foreground block mb-1">
                  Material Summary (Auto-Filled Table)
                </label>
                <div className="rounded-xl border bg-background overflow-hidden p-2 text-xs">
                  <div className="flex justify-between font-bold text-primary border-b pb-1">
                    <span>MAT-SS-304-001</span>
                    <span>Stainless Steel Sheet 304</span>
                    <span className="text-emerald-600">500 KG</span>
                  </div>
                </div>
              </div>

              {/* Remarks Textarea */}
              <div>
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

              <p className="text-[10px] text-muted-foreground italic">
                * Deliveries without an ASN or PO trigger a separately authorized exception workflow. Security cannot bypass this validation independently.
              </p>
            </div>

            {/* SECTION B: VEHICLE AND DRIVER DETAILS */}
            <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
              <h3 className="text-xs font-black uppercase tracking-wider text-primary border-b pb-2">
                SECTION B: VEHICLE AND DRIVER DETAILS
              </h3>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-[10px] font-bold uppercase text-muted-foreground block mb-1">
                    Vehicle Registration Number *
                  </label>
                  <input
                    type="text"
                    required
                    value={vehicleNumberInput}
                    onChange={(e) => setVehicleNumberInput(e.target.value.toUpperCase())}
                    placeholder="e.g. KA 01 AB 4582"
                    className="h-9 w-full rounded-xl border bg-background px-3 font-mono font-bold text-xs focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div>
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
                    onChange={(e) => setDriverNameInput(e.target.value)}
                    placeholder="Driver's Full Name"
                    className="h-9 w-full rounded-xl border bg-background px-3 font-semibold text-xs focus:ring-1 focus:ring-primary"
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
                    onChange={(e) => setDriverMobileInput(e.target.value)}
                    placeholder="+91 98450 12345"
                    className="h-9 w-full rounded-xl border bg-background px-3 font-mono text-xs focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div>
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

                <div>
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

                <div>
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

                <div>
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
            <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
              <h3 className="text-xs font-black uppercase tracking-wider text-primary border-b pb-2">
                SECTION C: INVOICE AND SUPPORTING DOCUMENTS
              </h3>

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
                    <p className="text-[10px] font-bold text-emerald-600 mt-1">✓ {uploadedInvoiceFile}</p>
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
                    <p className="text-[10px] font-bold text-emerald-600 mt-1">✓ {uploadedVehiclePhoto}</p>
                  )}
                </div>
              </div>
            </div>

            {/* SECTION D: SHIPMENT VERIFICATION TABLE */}
            <div className="rounded-xl border bg-muted/30 p-4 space-y-2">
              <h3 className="text-xs font-black uppercase tracking-wider text-primary border-b pb-2">
                SECTION D: SHIPMENT VERIFICATION (AUTO-FETCHED FROM PO/ASN)
              </h3>

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
                      <td className="px-3 py-2 font-bold">Stainless Steel Sheet 304 (MAT-SS-304-001)</td>
                      <td className="px-3 py-2 text-right font-semibold">500</td>
                      <td className="px-3 py-2 text-right font-bold text-emerald-600">500</td>
                      <td className="px-3 py-2 text-right font-mono">KG</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <p className="text-[10px] text-muted-foreground italic">
                * Security verifies the shipment reference and documentation, but does not perform final quantity acceptance or quality inspection. Actual received quantities are determined later in the receiving/GRN process.
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
                disabled={submittingWebEntry}
                className="rounded-xl font-bold shadow-sm"
              >
                {submittingWebEntry ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <PlusCircle className="mr-2 size-4" />
                )}
                Save & Proceed to Vehicle Details →
              </Button>
            </div>
          </form>
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
  onApproveExit: (arrival: Arrival) => void;
  isEligibleForInboundExit: (status: string) => boolean;
  busy: boolean;
}) {
  const isExited = arrival.status === "VEHICLE_EXITED" || !!arrival.exited_at;

  return (
    <>
      <tr className="hover:bg-muted/20">
        <td className="px-4 py-4">
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
        <td className="px-4 py-4">
          <span className="font-mono">{arrival.po_number}</span>
        </td>
        <td className="px-4 py-4 font-medium">{arrival.supplier_name || "—"}</td>
        <td className="px-4 py-4">
          <p className="font-mono font-semibold">{arrival.vehicle_number}</p>
          <p className="text-xs text-muted-foreground">{arrival.driver_name || "—"}</p>
        </td>
        <td className="px-4 py-4">
          {new Date(arrival.arrival_time).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </td>
        <td className="px-4 py-4">
          <StatusBadge status={arrival.status} />
          {arrival.assigned_dock_id && (
            <p className="mt-1 text-xs font-semibold">{arrival.assigned_dock_id}</p>
          )}
          {isExited && (
            <p className="mt-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
              Approved exit
            </p>
          )}
        </td>
        <td className="px-4 py-4">
          <div className="flex flex-wrap items-center gap-2">
            {!isExited && isEligibleForInboundExit(arrival.status) && (
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg shadow-sm gap-1.5 text-xs px-3"
                disabled={busy}
                onClick={() => onApproveExit(arrival)}
              >
                <ShieldCheck className="size-3.5" /> Approve Gate Exit
              </Button>
            )}
            <Button size="sm" variant="outline" className="rounded-lg" onClick={onToggle}>
              <Eye className="size-3.5" /> Details
            </Button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7} className="bg-muted/20 px-4 py-5">
            <ArrivalDetails
              arrival={arrival}
              docks={docks}
              selected={selected}
              onSelect={onSelect}
              onAssign={onAssign}
              onMove={onMove}
              onCheckIn={onCheckIn}
              busy={busy}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return (
    <Card className="rounded-2xl p-4">
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </Card>
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
  busy,
}: {
  arrival: Arrival;
  docks: Dock[];
  selected: string;
  onSelect: (id: string) => void;
  onAssign: () => void;
  onMove: () => void;
  onCheckIn: () => void;
  busy: boolean;
}) {
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
        <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Detail label="ASN number" value={arrival.asn_number} mono />
          <Detail label="PO number" value={arrival.po_number} mono />
          <Detail label="Supplier" value={arrival.supplier_name} />
          <Detail label="Current status" value={arrival.status.replaceAll("_", " ")} />
          <Detail label="Vehicle number" value={arrival.vehicle_number} mono />
          <Detail label="Driver" value={arrival.driver_name} />
          <Detail label="Driver contact" value={arrival.driver_contact} />
          <Detail label="Arrival time" value={new Date(arrival.arrival_time).toLocaleString()} />
        </dl>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <h3 className="mb-3 flex items-center gap-2 font-semibold">
            <Boxes className="size-4 text-primary" /> Gate entry information
          </h3>
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <dt className="text-muted-foreground">Gate entry</dt>
            <dd className="font-mono">{arrival.gate_entry_number}</dd>
            <dt className="text-muted-foreground">Entry time</dt>
            <dd>{new Date(arrival.arrival_time).toLocaleString()}</dd>
            <dt className="text-muted-foreground">Transporter</dt>
            <dd>{arrival.shipment.transporter || "—"}</dd>
            <dt className="text-muted-foreground">Packages</dt>
            <dd>
              {arrival.shipment.number_of_packages ?? "—"} {arrival.shipment.package_type || ""}
            </dd>
            <dt className="text-muted-foreground">Expected arrival</dt>
            <dd>
              {arrival.expected_arrival_at
                ? new Date(arrival.expected_arrival_at).toLocaleString()
                : "—"}
            </dd>
          </dl>
        </div>
        <div>
          <h3 className="mb-3 font-semibold">Expected materials</h3>
          <div className="space-y-2">
            {arrival.expected_materials.map((m) => (
              <div
                key={m.item_code}
                className="flex justify-between rounded-lg border bg-card px-3 py-2 text-xs"
              >
                <span>
                  <b>{m.item_code}</b>
                  <br />
                  {m.material_name}
                </span>
                <span className="font-semibold">
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
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-1 font-semibold ${mono ? "font-mono" : ""}`}>{value || "—"}</dd>
    </div>
  );
}
