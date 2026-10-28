import { InformationTooltip } from "@/components/ui/information-tooltip";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Eye,
  FileText,
  Loader2,
  Search,
  Trash2,
  Truck,
} from "lucide-react";
import { AppShell } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api-client";
import { getUserInfo } from "@/lib/auth-utils";
import { sanitizeNumericQuantity } from "@/lib/input-validation";

export const Route = createFileRoute("/supplier-dashboard")({
  component: SupplierDashboard,
});

const inputClass = "mt-1.5 h-10 rounded-xl border-border/80 bg-background text-xs font-semibold";
const todayDate = () => {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
};

const statuses: Record<string, string> = {
  SUBMITTED: "bg-sky-50 text-sky-700 border-sky-200",
  APPROVED: "bg-sky-50 text-sky-700 border-sky-200",
  PENDING: "bg-amber-50 text-amber-700 border-amber-200",
  CANCELLED: "bg-rose-50 text-rose-700 border-rose-200",
  COMPLETED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  VEHICLE_EXITED: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

const statusDescriptions: Record<string, string> = {
  SUBMITTED: "Delivery scheduled. Awaiting vehicle arrival at factory gate.",
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
  VEHICLE_EXITED: "Vehicle has completed delivery and exited factory premises.",
  APPROVED: "Delivery approved by warehouse operations.",
  PENDING: "Delivery notice is pending review or confirmation.",
  CANCELLED: "This delivery notice was cancelled and will not be received.",
};

const getStatusDescription = (status: string) => {
  return (
    statusDescriptions[status] ||
    `Status: ${status.replaceAll("_", " ")}. Click View for full details.`
  );
};

function validateTransportDetails(vehicle: string, driver: string, contact: string): string | null {
  const normalizedVehicle = vehicle.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{4}$/.test(normalizedVehicle)) {
    return "Enter a valid vehicle number, for example KA42EH6940.";
  }
  if (!/^[A-Za-z][A-Za-z .'-]{1,49}$/.test(driver.trim())) {
    return "Enter a valid driver name using letters only.";
  }
  if (!/^\d{10}$/.test(contact.trim())) {
    return "Driver contact must contain exactly 10 digits.";
  }
  return null;
}

function SupplierDashboard() {
  const [asns, setAsns] = useState<any[]>([]);
  const [asnsLoading, setAsnsLoading] = useState(true);
  const [asnsError, setAsnsError] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const [trendDays, setTrendDays] = useState<7 | 30 | 90>(7);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAssignmentOpen, setIsAssignmentOpen] = useState(false);
  const [isDeliveryHelpOpen, setIsDeliveryHelpOpen] = useState(false);
  const deliveryHelpTriggerRef = useRef<HTMLButtonElement>(null);
  const [submitting, setSubmitting] = useState(false);

  // Modal Form Inputs
  const [asnNumber, setAsnNumber] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [supplierCompanyName, setSupplierCompanyName] = useState("");
  const [expectedArrivalDate, setExpectedArrivalDate] = useState("");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [driverName, setDriverName] = useState("");
  const [driverMobile, setDriverMobile] = useState("");
  const [registeredVehicles, setRegisteredVehicles] = useState<any[]>([]);
  const [registeredDrivers, setRegisteredDrivers] = useState<any[]>([]);
  const [lines, setLines] = useState<any[]>([
    { material_id: "", item_code: "", material_name: "", shipped_quantity: "", uom: "" },
  ]);

  const [materialCatalog, setMaterialCatalog] = useState<any[]>([]);
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const [materialsError, setMaterialsError] = useState("");
  const [materialSearch, setMaterialSearch] = useState("");
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);
  const [selectedPo, setSelectedPo] = useState<any>(null);
  const currentUser = getUserInfo();

  useEffect(() => {
    loadAsns();
    void (currentUser?.supplierId ? api.getSupplier(currentUser.supplierId) : api.getSuppliers({ search: currentUser?.username })).then((result: any) => { const rows = Array.isArray(result) ? result : result?.items || result?.suppliers || []; const supplier = rows.length ? rows.find((item: any) => String(item.id) === String(currentUser?.supplierId) || String(item.username || item.supplier_name || "").toLowerCase() === String(currentUser?.username || "").toLowerCase()) || rows[0] : result; const companyName = supplier?.registered_company_name || supplier?.company_name || supplier?.supplier_name || ""; setSupplierCompanyName(companyName); if (companyName) setSupplierName(companyName); }).catch(() => undefined);
    setMaterialsLoading(true);
    void api.getMaterialComponents().then((materials) => { setMaterialCatalog((materials || []).map((material: any) => ({ ...material, id: material.id || material.material_id, code: material.code || material.material_code, name: material.name || material.material_name, uom: material.uom || material.base_uom || material.unit_of_measure })).filter((material: any) => material.id && material.code && material.name && material.uom)); setMaterialsError(""); }).catch(() => { setMaterialCatalog([]); setMaterialsError("Unable to load Material Master records."); }).finally(() => setMaterialsLoading(false));
    void Promise.all([api.getVehicles().catch(() => []), api.getDrivers().catch(() => [])]).then(([vehicles, drivers]) => { setRegisteredVehicles((vehicles || []).filter((v: any) => v.is_active !== false && String(v.status || "AVAILABLE").toUpperCase() === "AVAILABLE")); setRegisteredDrivers((drivers || []).filter((d: any) => d.is_active !== false && String(d.status || "ACTIVE").toUpperCase() === "ACTIVE")); });
    void api
      .getPurchaseOrders({ supplierId: currentUser?.supplierId })
      .catch(() => [])
      .then((pos) => setPurchaseOrders(pos || []));
  }, []);

  const handleAddNewCustomMaterial = async () => {
    const compName = prompt("Enter New Material Component Name (to save in Database):");
    if (!compName || !compName.trim()) return;

    try {
      const created = await api.createMaterialComponent(compName.trim(), "PCS");
      setMaterialCatalog((prev) => [created, ...prev]);
      toast.success(`Component '${created.name}' saved to Database ✓`, {
        description: `Code: ${created.code} · Available in dropdown`,
      });
      setLines((prev) => [
        ...prev,
        { item_code: created.code, material_name: created.name, shipped_quantity: "1", uom: created.uom || "PCS" },
      ]);
    } catch {
      toast.error("Failed to save material to database");
    }
  };

  const loadAsns = async () => {
    setAsnsLoading(true);
    setAsnsError("");
    try {
      const data = await api.getAsns(currentUser?.supplierId);
      setAsns((data || []).map((asn: any) => ({
        ...asn,
        expected_arrival_date: asn.expected_arrival_date || asn.delivery_date || asn.expected_arrival_at?.split("T")[0] || "",
        supplier_name: asn.supplier_name || asn.supplierName || asn.supplier_company_name || asn.supplier?.supplier_name || "",
        destination_warehouse: asn.destination_warehouse || asn.destinationWarehouse || asn.warehouse_name || asn.delivery_warehouse_name || "",
      })));
    } catch {
      setAsnsError("Unable to load delivery notices. Please try again.");
    } finally {
      setAsnsLoading(false);
    }
  };

  const handleOpenCreateModal = async () => {
    try {
      const next = await api.getNextAsnNumber();
      setAsnNumber(next.asnNumber);
    } catch {
      setAsnNumber("");
    }
    setExpectedArrivalDate(todayDate());
    setSupplierName(supplierCompanyName || currentUser?.full_name || currentUser?.username || "");
    setSelectedPo(null);
    setVehicleNumber("");
    setDriverName("");
    setDriverMobile("");
    setLines([{ material_id: "", item_code: "", material_name: "", shipped_quantity: "", uom: "" }]);
    setIsModalOpen(true);
  };

  const selectPurchaseOrder = async (id: string) => {
    if (!id) { setSelectedPo(null); setLines([]); return; }
    const po = await api.getPurchaseOrder(id);
    setSelectedPo(po);
    const poLines = po?.lines || po?.items || po?.materials || po?.purchase_order_lines || [];
    setLines(poLines.map((line: any) => ({ item_code: line.item_code || line.material_code || line.code || "", material_name: line.material_name || line.material?.name || line.name || "", shipped_quantity: "", remaining_quantity: Number(line.remaining_quantity ?? line.remaining ?? line.balance_quantity ?? line.ordered_quantity ?? line.quantity ?? 0), uom: line.uom || line.unit_of_measure || "PCS" })));
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const transportError = validateTransportDetails(vehicleNumber, driverName, driverMobile);
    if (transportError) {
      toast.error(transportError);
      return;
    }
    if (
      !lines.length ||
      lines.some(
        (line) =>
          !line.item_code ||
          !line.material_name ||
          Number(line.shipped_quantity) <= 0,
      )
    ) {
      toast.error("Select a material; shipped quantities must be greater than zero");
      return;
    }
    if (!expectedArrivalDate) {
      toast.error("Expected Arrival Date is mandatory *");
      return;
    }
    if (expectedArrivalDate < todayDate()) {
      toast.error("Expected Arrival Date cannot be before today.");
      return;
    }
    if (!vehicleNumber.trim() || !driverName.trim() || !driverMobile.trim()) {
      toast.error("Please fill in Vehicle Number, Driver Name, and Mobile Number *");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        asn_number: asnNumber,
        po_number: undefined,
        supplier_name: supplierName.trim(),
        supplier_id: currentUser?.supplierId,
        expected_arrival_at: expectedArrivalDate,
        vehicle_number: vehicleNumber.toUpperCase().trim(),
        driver_name: driverName.trim(),
        driver_contact: driverMobile.trim(),
        lines: lines.map((l) => ({
          material_id: l.material_id,
          item_code: l.item_code,
          material_name: l.material_name,
          shipped_quantity: Number(l.shipped_quantity) || 0,
          uom: l.uom,
        })),
        status: "SUBMITTED",
      };

      await api.createAsn(payload);

      const newRecord = {
        id: `asn-${Date.now()}`,
        asn_number: asnNumber,
        po_number: "",
        supplier_name: supplierName,
        supplier_company_name: supplierName,
        vehicle_number: vehicleNumber.toUpperCase().trim(),
        driver_name: driverName.trim(),
        driver_contact: driverMobile.trim(),
        expected_arrival_date: expectedArrivalDate,
        expected_arrival_at: expectedArrivalDate,
        created_at: new Date().toISOString(),
        status: "SUBMITTED",
        lines: payload.lines,
      };

      setAsns((prev) => [newRecord, ...prev]);
      setSubmitting(false);
      setIsModalOpen(false);

      toast.success(`ASN ${asnNumber} Created Successfully ✓`, {
        description: `Vehicle ${newRecord.vehicle_number} · Driver ${newRecord.driver_name} (${newRecord.driver_contact})\n\nGate Security can now scan or search ${asnNumber}!`,
      });
    } catch (err: any) {
      setSubmitting(false);
      toast.error("ASN Creation Failed", { description: err?.message || "Could not create ASN." });
    }
  };

  const rows = useMemo(() => {
    return asns
      .filter((a) =>
        `${a.asn_number || ""} ${a.vehicle_number || ""} ${a.status || ""}`
          .toLowerCase()
          .includes(query.toLowerCase())
      )
      .sort(
        (a, b) =>
          new Date(b.created_at || b.submitted_at || 0).getTime() -
          new Date(a.created_at || a.submitted_at || 0).getTime()
      );
  }, [asns, query]);

  const submitted = asns.filter(
    (a) => String(a.status || "SUBMITTED").toUpperCase() === "SUBMITTED"
  ).length;
  const vehicles = new Set(asns.map((a) => a.vehicle_number).filter(Boolean)).size;

  const metrics = [
    {
      title: "Total deliveries",
      value: asns.length,
      icon: FileText,
      tooltip: "Total number of delivery notices registered in the system.",
    },
    {
      title: "Awaiting arrival",
      value: submitted,
      icon: Truck,
      tooltip: "Delivery notices submitted and waiting for the vehicle to check in at the gate.",
    },
    {
      title: "Vehicles used",
      value: vehicles,
      icon: Truck,
      tooltip: "Number of unique transport vehicles registered across your deliveries.",
    },
  ];

  const showDetails = (asn: any) => {
    setSelected(asn);
  };

  useEffect(() => {
    const handleGlobalSearch = (e: any) => {
      if (typeof e?.detail === "string") {
        setQuery(e.detail);
      }
    };
    const handleOpenAsn = (e: Event) => {
      const result = (e as CustomEvent<{ id?: string | number; title?: string }>).detail;
      if (!result?.title) return;

      const asn = asns.find(
        (item) =>
          String(item.asn_number || "") === result.title ||
          (result.id !== undefined && String(item.id) === String(result.id)),
      );
      if (asn) {
        setSelected(asn);
      }
    };
    window.addEventListener("app:search", handleGlobalSearch);
    window.addEventListener("app:open-asn", handleOpenAsn);
    return () => {
      window.removeEventListener("app:search", handleGlobalSearch);
      window.removeEventListener("app:open-asn", handleOpenAsn);
    };
  }, [asns]);

  const trend = useMemo(() => {
    const toLocalDateKey = (value: unknown) => {
      if (!value) return "";
      const text = String(value);
      const isoDate = text.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
      if (isoDate) return isoDate;
      const parsed = new Date(text);
      if (Number.isNaN(parsed.getTime())) return "";
      return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
    };
    const days = Array.from({ length: trendDays }, (_, i) => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - (trendDays - 1 - i));
      return d;
    });
    return days.map((day) => ({
      key: `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`,
      label: day.toLocaleDateString(undefined, { month: "short", day: "2-digit" }),
      count: asns.filter((a) => {
        return toLocalDateKey(a.submitted_at || a.created_at || a.shipment_date) === `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
      }).length,
    }));
  }, [asns, trendDays]);

  return (
    <TooltipProvider delayDuration={150}>
      <AppShell
        title="Supplier Dashboard"
        subtitle="Manage delivery notices and track incoming shipments."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              ref={deliveryHelpTriggerRef}
              type="button"
              onClick={() => setIsDeliveryHelpOpen(true)}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-primary transition-colors hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-haspopup="dialog"
              aria-expanded={isDeliveryHelpOpen}
              aria-controls="supplier-asn-help-dialog"
            >
              <CircleHelp className="size-4 shrink-0" aria-hidden="true" />
              <span>Supplier Guide</span>
            </button>
            <Tooltip delayDuration={150}>
              <TooltipTrigger asChild>
                <Link
                  to="/supplier/asns/new"
                  search={{ open: "create" }}
                  className="inline-flex h-10 shrink-0 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <Truck className="mr-2 size-4" />
                  Create ASN
                </Link>
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                align="end"
                className="max-w-xs border border-border bg-popover text-xs text-popover-foreground shadow-soft"
              >
                Create a new Advance Shipping Notice to inform warehouse receiving of incoming goods
                before truck arrival.
              </TooltipContent>
            </Tooltip>
          </div>
        }
      >
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {metrics.map(({ title, value, icon: Icon, tooltip }) => (
              <div
                key={title}
                className="flex min-h-24 items-center justify-between rounded-xl border border-border bg-card px-4 py-3.5"
              >
                <div>
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-medium text-muted-foreground">{title}</p>

                  </div>
                  <p
                    className="mt-1 text-2xl font-semibold tabular-nums text-foreground"
                    aria-live="polite"
                  >
                    {asnsLoading && asns.length === 0 ? (
                      <span className="text-muted-foreground" aria-label="Loading">
                        —
                      </span>
                    ) : asnsError && asns.length === 0 ? (
                      <span className="text-muted-foreground" aria-label="Unavailable">
                        —
                      </span>
                    ) : (
                      value
                    )}
                  </p>
                </div>

                <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-4" aria-hidden="true" />
                </div>
              </div>
            ))}
          </div>

          {/* ASN History Table Section */}
          <section className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-foreground">Delivery history</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  View and track your delivery notices.
                </p>
              </div>

              <div className="flex w-full items-center sm:w-auto">
                <form onSubmit={(e) => e.preventDefault()} className="relative w-full sm:w-64">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search deliveries"
                    className="h-10 w-full rounded-lg pl-9 pr-8 text-sm"
                    aria-label="Search deliveries by ASN, vehicle number, or status"
                  />
                  {query && (
                    <button
                      type="button"
                      aria-label="Clear search"
                      title="Clear search"
                      onClick={() => setQuery("")}
                      className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground text-xs cursor-pointer"
                    >
                      ✕
                    </button>
                  )}
                </form>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="border-b border-border bg-muted/60 text-xs font-medium text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3.5 py-3">
                      <div className="inline-flex items-center gap-1">
                        <span>ASN Number</span>

                      </div>
                    </th>
                    <th scope="col" className="px-3.5 py-3">
                      Vehicle number
                    </th>
                    <th scope="col" className="px-3.5 py-3">
                      <div className="inline-flex items-center gap-1">
                        <span>Status</span>
                        <InformationTooltip help="workflowStatus" />
                      </div>
                    </th>
                    <th scope="col" className="px-3.5 py-3">
                      Submitted date
                    </th>
                    <th scope="col" className="px-3.5 py-3 text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {asnsError && (
                    <tr>
                      <td colSpan={5} className="px-4 py-3">
                        <div
                          role="alert"
                          className="flex flex-wrap items-center justify-between gap-3 text-sm text-destructive"
                        >
                          <span>{asnsError}</span>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => void loadAsns()}
                          >
                            Try again
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )}
                  {asnsLoading && asns.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-10 text-center text-sm text-muted-foreground"
                      >
                        <span className="inline-flex items-center gap-2" role="status">
                          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                          Loading delivery notices…
                        </span>
                      </td>
                    </tr>
                  )}
                  {!asnsLoading && !asnsError && rows.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-10 text-center text-sm text-muted-foreground"
                      >
                        {query ? "No deliveries match your search." : "No delivery notices yet."}
                      </td>
                    </tr>
                  )}
                  {rows.map((asn) => {
                    const key = String(asn.id || asn.asn_number);
                    const status = String(asn.status || "SUBMITTED").toUpperCase();
                    return (
                      <tr key={key} className="transition-colors hover:bg-muted/40">
                        <td className="px-3.5 py-3 font-mono font-medium text-primary">
                          <Tooltip delayDuration={150}>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="cursor-pointer text-left font-medium text-primary hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                onClick={() => showDetails(asn)}
                              >
                                {asn.asn_number || "—"}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent
                              side="top"
                              className="max-w-xs border border-border bg-popover text-xs text-popover-foreground shadow-soft"
                            >
                              Click to view delivery details for {asn.asn_number}
                            </TooltipContent>
                          </Tooltip>
                        </td>
                        <td className="px-3.5 py-3 font-mono text-foreground">
                          {asn.vehicle_number || "—"}
                        </td>
                        <td className="px-3.5 py-3">
                          <div className="inline-flex items-center gap-1.5">
                            <span
                              className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${
                                statuses[status] || "bg-muted text-muted-foreground border-border"
                              }`}
                            >
                              {status.replaceAll("_", " ")}
                            </span>
                            <InformationTooltip help="workflowStatus" />
                          </div>
                        </td>
                        <td className="px-3.5 py-3 text-muted-foreground">
                          {asn.created_at
                            ? new Date(asn.created_at).toLocaleDateString()
                            : asn.delivery_date ||
                              asn.expected_arrival_date ||
                              asn.expected_arrival_at?.split("T")[0] ||
                              "—"}
                        </td>
                        <td className="px-3.5 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Tooltip delayDuration={150}>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 text-sm font-medium text-primary hover:bg-primary/10"
                                  onClick={() => showDetails(asn)}
                                >
                                  <Eye className="size-4" /> View
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent
                                side="top"
                                className="max-w-xs border border-border bg-popover text-xs text-popover-foreground shadow-soft"
                              >
                                Open delivery details, transport info, and item list
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-3 text-xs text-muted-foreground" aria-live="polite">
              {query
                ? `${rows.length} of ${asns.length} deliveries`
                : `${rows.length} ${rows.length === 1 ? "delivery" : "deliveries"}`}
            </div>
          </section>

          {/* Bottom: ASN Submission Trend */}
          <section className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-foreground">ASN activity</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Delivery notices submitted in the selected period.
                </p>
              </div>
              <label className="relative inline-flex h-10 items-center rounded-lg border border-border bg-background pl-3 pr-8 text-sm font-medium text-foreground transition-colors hover:border-slate-400 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 cursor-pointer">
                <span className="sr-only">ASN activity range</span>
                <span aria-hidden="true">
                  {trendDays === 7
                    ? "Last 7 Days"
                    : trendDays === 30
                      ? "Last 30 Days"
                      : "Last 90 Days"}
                </span>
                <select
                  aria-label="ASN activity range"
                  className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                  value={trendDays}
                  onChange={(event) => setTrendDays(Number(event.target.value) as 7 | 30 | 90)}
                >
                  <option value={7}>Last 7 Days</option>
                  <option value={30}>Last 30 Days</option>
                  <option value={90}>Last 90 Days</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 size-4 text-muted-foreground" aria-hidden="true" />
              </label>
            </div>

            {asnsLoading && asns.length === 0 ? (
              <div
                className="mt-4 flex h-36 items-center justify-center rounded-lg border border-border text-sm text-muted-foreground"
                role="status"
              >
                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
                Loading activity…
              </div>
            ) : asnsError && asns.length === 0 ? (
              <div className="mt-4 flex h-36 items-center justify-center rounded-lg border border-border text-sm text-muted-foreground">
                Activity is unavailable until delivery notices load.
              </div>
            ) : trend.every(({ count }) => count === 0) ? (
              <div className="mt-4 flex h-36 items-center justify-center rounded-lg border border-border text-sm text-muted-foreground">
                No delivery notices in this period.
              </div>
            ) : (
              <div className="mt-4 flex h-36 items-end gap-2 overflow-x-auto rounded-lg border-b border-l border-border bg-[repeating-linear-gradient(to_bottom,transparent_0,transparent_34px,color-mix(in_oklab,var(--border)_50%,transparent)_35px)] px-2 pb-1 pt-3">
                {trend.map(({ key, label, count }) => {
                  const max = Math.max(...trend.map((item) => item.count), 1);
                  return (
                    <div key={key} className="flex flex-1 flex-col items-center justify-end gap-1">
                      <span className="text-[10px] font-bold text-slate-500">{count}</span>
                      <div
                        className="h-auto min-w-4 w-full max-w-8 rounded-t bg-primary transition-colors hover:bg-primary/80"
                        title={`${label}: ${count}`}
                        style={{ height: `${count ? Math.max((count / max) * 100, 8) : 3}px` }}
                      />
                      <span className="text-[9px] font-medium text-muted-foreground">{label}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
            <DialogContent className="max-w-lg rounded-2xl bg-card p-6 shadow-2xl">
              <DialogHeader>
                <DialogTitle className="font-black text-lg text-primary">
                  ASN Details · {selected?.asn_number || "—"}
                </DialogTitle>
              </DialogHeader>
              {selected && (
                <div className="grid max-h-[70vh] gap-3 overflow-y-auto pr-1 text-xs sm:grid-cols-2">
                  <div className="rounded-xl border bg-muted/30 p-3">
                    <div className="flex items-center gap-1">
                      <p className="font-bold uppercase text-muted-foreground">ASN Number</p>

                    </div>
                    <p className="mt-1 font-mono font-black text-sky-600">
                      {selected.asn_number || "—"}
                    </p>
                  </div>
                  <div className="rounded-xl border bg-muted/30 p-3">
                    <p className="font-bold uppercase text-muted-foreground">Supplier Name</p>
                    <p className="mt-1 font-bold text-slate-900">
                      {selected.supplier_name || selected.supplier_company_name || "—"}
                    </p>
                  </div>
                  <div className="rounded-xl border bg-muted/30 p-3">
                    <p className="font-bold uppercase text-muted-foreground">Vehicle Number</p>
                    <p className="mt-1 font-mono font-bold text-slate-900">
                      {selected.vehicle_number || "—"}
                    </p>
                  </div>
                  <div className="rounded-xl border bg-muted/30 p-3">
                    <p className="font-bold uppercase text-muted-foreground">
                      Driver Name & Mobile
                    </p>
                    <p className="mt-1 font-bold text-slate-900">
                      {selected.driver_name || "—"} · {selected.driver_contact || "—"}
                    </p>
                  </div>
                  <div className="rounded-xl border bg-muted/30 p-3">
                    <p className="font-bold uppercase text-muted-foreground">
                      Expected Arrival Date
                    </p>
                    <p className="mt-1 font-bold text-slate-900">
                      {selected.expected_arrival_date ||
                        selected.expected_arrival_at?.split("T")[0] ||
                        selected.delivery_date ||
                        "—"}
                    </p>
                  </div>
                  <div className="rounded-xl border bg-muted/30 p-3">
                    <div className="flex items-center gap-1">
                      <p className="font-bold uppercase text-muted-foreground">Status</p>
                      <InformationTooltip help="workflowStatus" />
                    </div>
                    <p className="mt-1 font-black text-slate-900">
                      {String(selected.status || "SUBMITTED").replaceAll("_", " ")}
                    </p>
                  </div>
                  <div className="rounded-xl border bg-muted/30 p-3 sm:col-span-2">
                    <p className="font-bold uppercase text-muted-foreground">Shipped Materials</p>
                    {selected.lines?.length ? (
                      <div className="mt-2 divide-y">
                        {selected.lines.map((line: any, index: number) => (
                          <div
                            key={`${line.item_code || line.material_name}-${index}`}
                            className="flex justify-between gap-3 py-2"
                          >
                            <span className="font-semibold">
                              {line.material_name || line.item_code}{" "}
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
                      <p className="mt-1 text-muted-foreground">No shipment materials recorded.</p>
                    )}
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>

          {/* TRANSPORT ASSIGNMENT POPUP — matches the Create ASN flow */}
          <Dialog open={isAssignmentOpen} onOpenChange={setIsAssignmentOpen}>
            <DialogContent className="max-w-xl rounded-2xl p-6">
              <DialogHeader>
                <DialogTitle className="text-lg font-black text-primary">
                  Assign vehicle and driver
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-5 text-xs">
                <p className="text-sm leading-6 text-muted-foreground">
                  Enter the transport details first. The complete ASN form will open after you click
                  Next.
                </p>
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <Label htmlFor="dashboard-assignment-vehicle">Vehicle Number *</Label>
                    <Input
                      id="dashboard-assignment-vehicle"
                      required
                      placeholder="e.g. KA42EH6940"
                      value={vehicleNumber}
                      onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())}
                      maxLength={13}
                      pattern="[A-Za-z]{2}[0-9]{1,2}[A-Za-z]{1,3}[0-9]{4}"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <Label htmlFor="dashboard-assignment-driver">Driver Name *</Label>
                    <Input
                      id="dashboard-assignment-driver"
                      required
                      placeholder="Enter driver name"
                      value={driverName}
                      onChange={(e) => setDriverName(e.target.value)}
                      maxLength={50}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <Label htmlFor="dashboard-assignment-mobile">Driver Contact *</Label>
                    <Input
                      id="dashboard-assignment-mobile"
                      required
                      type="tel"
                      inputMode="numeric"
                      placeholder="10-digit mobile number"
                      value={driverMobile}
                      onChange={(e) =>
                        setDriverMobile(e.target.value.replace(/\D/g, "").slice(0, 10))
                      }
                      maxLength={10}
                      pattern="[0-9]{10}"
                      className={inputClass}
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-xl"
                    onClick={() => setIsAssignmentOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    className="rounded-xl px-6"
                    onClick={() => {
                      const validationError = validateTransportDetails(
                        vehicleNumber,
                        driverName,
                        driverMobile,
                      );
                      if (validationError) {
                        toast.error(validationError);
                        return;
                      }
                      setVehicleNumber(vehicleNumber.replace(/\s+/g, "").toUpperCase());
                      setIsAssignmentOpen(false);
                      setIsModalOpen(true);
                    }}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={isDeliveryHelpOpen} onOpenChange={setIsDeliveryHelpOpen}>
            <DialogContent
              id="supplier-asn-help-dialog"
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                deliveryHelpTriggerRef.current?.focus();
              }}
              className="w-[calc(100vw-2rem)] max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl border-slate-200 bg-white p-5 shadow-2xl sm:p-7"
            >
              <DialogHeader className="space-y-2 pr-8 text-left">
                <DialogTitle className="text-xl font-black text-slate-900 sm:text-2xl">
                  Supplier Guide
                </DialogTitle>
                <DialogDescription className="text-sm leading-6 text-slate-600">
                  Everything you need to manage materials, deliveries, claims, and finished-goods
                  requests.
                </DialogDescription>
              </DialogHeader>

              <div className="divide-y divide-slate-200">
                <details open className="group py-3 first:pt-1">
                  <summary className="flex cursor-pointer list-none items-center gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sm font-bold text-sky-700">
                      1
                    </span>
                    <span className="min-w-0 flex-1 text-sm font-bold text-slate-900">
                      Supplier Dashboard
                    </span>
                    <ChevronDown
                      className="size-4 shrink-0 text-slate-500 transition-transform group-open:rotate-180"
                      aria-hidden="true"
                    />
                  </summary>
                  <div className="ml-11 mt-3 space-y-2 text-sm leading-5 text-slate-600">
                    <p>
                      The dashboard gives you a quick view of your deliveries: <strong>Total
                      deliveries</strong> counts your ASN records, <strong>Awaiting arrival</strong>{" "}
                      counts notices marked SUBMITTED, and <strong>Vehicles used</strong> counts
                      the different vehicle numbers on your notices.
                    </p>
                    <p>
                      In <strong>Delivery History</strong>, search by ASN number, vehicle, or
                      status, then select <strong>View</strong> to see a delivery.{" "}
                      <strong>ASN Activity</strong> shows delivery notices over the selected 7, 30,
                      or 90 days.
                    </p>
                    <Link
                      to="/supplier/asns"
                      className="inline-flex font-semibold text-sky-700 underline-offset-4 hover:underline"
                    >
                      Go to Module: ASN Management
                    </Link>
                  </div>
                </details>

                <details className="group py-3">
                  <summary className="flex cursor-pointer list-none items-center gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sm font-bold text-sky-700">
                      2
                    </span>
                    <span className="min-w-0 flex-1 text-sm font-bold text-slate-900">
                      Material Catalog
                    </span>
                    <ChevronDown
                      className="size-4 shrink-0 text-slate-500 transition-transform group-open:rotate-180"
                      aria-hidden="true"
                    />
                  </summary>
                  <div className="ml-11 mt-3 space-y-2 text-sm leading-5 text-slate-600">
                    <p>
                      Browse your materials by <strong>Material Code</strong> (the identifying
                      code), <strong>Material Name</strong>, <strong>UOM</strong> (unit of
                      measurement), and status. Search by name or code, or filter by UOM.
                    </p>
                    <p>
                      Select <strong>Add Material</strong> and enter the material name and base
                      UOM. The catalog generates the material code for a new item. Active catalog
                      materials are available when you add items to an ASN.
                    </p>
                    <Link
                      to="/supplier-materials"
                      className="inline-flex font-semibold text-sky-700 underline-offset-4 hover:underline"
                    >
                      Go to Module: Material Catalog
                    </Link>
                  </div>
                </details>

                <details className="group py-3">
                  <summary className="flex cursor-pointer list-none items-center gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sm font-bold text-sky-700">
                      3
                    </span>
                    <span className="min-w-0 flex-1 text-sm font-bold text-slate-900">
                      ASN Management
                    </span>
                    <ChevronDown
                      className="size-4 shrink-0 text-slate-500 transition-transform group-open:rotate-180"
                      aria-hidden="true"
                    />
                  </summary>
                  <div className="ml-11 mt-3 space-y-2 text-sm leading-5 text-slate-600">
                    <ol className="list-decimal space-y-1 pl-4">
                      <li>
                        Choose <strong>Create ASN</strong>, enter the vehicle registration number,
                        driver name, and mobile number, then select{" "}
                        <strong>Continue to ASN Details</strong>.
                      </li>
                      <li>
                        The ASN number is filled in for you. Check or edit the supplier name, select
                        your expected arrival date, and review the vehicle and driver details.
                        Warehouse staff assign the destination when they allocate a dock after
                        arrival.
                      </li>
                      <li>
                        Select a material from your active catalog, enter the shipped quantity, and
                        check the automatically displayed UOM. Use <strong>Add material</strong>{" "}
                        for another item.
                      </li>
                      <li>
                        Check the details and choose <strong>Submit ASN</strong>. After successful
                        submission, find the ASN in Delivery History or ASN Management to check its
                        status and select <strong>View</strong> for details.
                      </li>
                    </ol>
                    <p className="rounded-lg bg-sky-50 px-3 py-2 text-sky-900">
                      <strong>SUBMITTED</strong> means your delivery notice has been successfully
                      sent to the warehouse. It does not mean the warehouse has approved the
                      delivery.
                    </p>
                    <p>
                      You create the ASN. Gate and warehouse employees handle the next steps:
                      checking the vehicle at the gate, assigning a dock, receiving the materials,
                      and completing quality checks.
                    </p>
                    <Link
                      to="/supplier/asns"
                      className="inline-flex font-semibold text-sky-700 underline-offset-4 hover:underline"
                    >
                      Go to Module: ASN Management
                    </Link>
                  </div>
                </details>

                <details className="group py-3">
                  <summary className="flex cursor-pointer list-none items-center gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sm font-bold text-sky-700">
                      4
                    </span>
                    <span className="min-w-0 flex-1 text-sm font-bold text-slate-900">
                      Damage Claims
                    </span>
                    <ChevronDown
                      className="size-4 shrink-0 text-slate-500 transition-transform group-open:rotate-180"
                      aria-hidden="true"
                    />
                  </summary>
                  <div className="ml-11 mt-3 space-y-2 text-sm leading-5 text-slate-600">
                    <p>
                      In <strong>Damage Returns</strong>, review the claim number, PO number,
                      material, damaged or rejected quantity, original GRN, status, and any available
                      evidence such as reason, remarks, or photos. Status and response details show
                      the current claim progress.
                    </p>
                    <p>
                      When a response is requested, choose to accept, reject, accept partially, or
                      request more information. You can add optional remarks. If accepting, select a
                      resolution such as replacement, credit note, refund, or return and replacement.
                      For a replacement, enter its vehicle number and select <strong>Send
                      Replacement</strong>. The page shows the replacement shipment details and
                      status when available.
                    </p>
                    <Link
                      to="/damage-claims"
                      className="inline-flex font-semibold text-sky-700 underline-offset-4 hover:underline"
                    >
                      Go to Module: Damage Claims
                    </Link>
                  </div>
                </details>

                <details className="group py-3 last:pb-1">
                  <summary className="flex cursor-pointer list-none items-center gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sm font-bold text-sky-700">
                      5
                    </span>
                    <span className="min-w-0 flex-1 text-sm font-bold text-slate-900">
                      Finished Goods Dispatch Requests
                    </span>
                    <ChevronDown
                      className="size-4 shrink-0 text-slate-500 transition-transform group-open:rotate-180"
                      aria-hidden="true"
                    />
                  </summary>
                  <div className="ml-11 mt-3 space-y-2 text-sm leading-5 text-slate-600">
                    <p>
                      Choose <strong>Create Dispatch</strong> and enter the expected pickup date,
                      vehicle number, driver name and contact, finished good, and quantity. The
                      finished-good list comes from Assembly and includes items with available stock
                      that are ready for dispatch.
                    </p>
                    <p>
                      Submit the request, then use <strong>Dispatch History</strong> to check its
                      status and choose <strong>View</strong> for the finished goods, vehicle, driver,
                      and pickup details. Assembly, Dispatch, and Gate teams handle processing and
                      vehicle departure; the status shown in the page reflects its current progress.
                    </p>
                    <Link
                      to="/supplier/dispatch"
                      className="inline-flex font-semibold text-sky-700 underline-offset-4 hover:underline"
                    >
                      Go to Module: FG Dispatch Requests
                    </Link>
                  </div>
                </details>
              </div>

              <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 rounded-xl border-slate-300 px-5 text-sm"
                  onClick={() => setIsDeliveryHelpOpen(false)}
                >
                  Close
                </Button>
                <Link
                  to="/supplier/asns/new"
                  search={{ open: "create" }}
                  onClick={() => setIsDeliveryHelpOpen(false)}
                  className="inline-flex h-10 items-center justify-center rounded-xl bg-sky-600 px-5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
                >
                  Create ASN
                </Link>
              </div>
            </DialogContent>
          </Dialog>

          {/* CREATE ASN POPUP MODAL DIALOG */}
          <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
            <DialogContent className="max-w-4xl rounded-2xl bg-card p-6 shadow-2xl">
              <DialogHeader>
                <DialogTitle className="font-black text-lg text-primary uppercase border-b pb-2">
                  CREATE ADVANCE SHIPPING NOTICE (ASN)
                </DialogTitle>
              </DialogHeader>

              <form onSubmit={handleFormSubmit} className="space-y-4 text-xs">
                {/* SHIPMENT DETAILS */}
                <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
                  <h3 className="text-xs font-black uppercase tracking-wider text-primary">
                    1. SHIPMENT DETAILS
                  </h3>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label className="text-[10px] font-bold uppercase text-muted-foreground">
                        ASN Number
                      </Label>
                      <div className="mt-1 flex h-10 items-center rounded-xl border bg-muted/60 px-3 font-mono font-bold text-primary">
                        {asnNumber}
                      </div>
                    </div>

                    <div>
                      <Label
                        htmlFor="dashboard-supplier-name"
                        className="text-[10px] font-bold uppercase text-muted-foreground"
                      >
                        Supplier Name
                      </Label>
                      <Input
                        id="dashboard-supplier-name"
                        required
                        placeholder="e.g. Bharat Electronics Components Pvt. Ltd."
                        value={supplierName}
                        onChange={(event) => setSupplierName(event.target.value)}
                        onBlur={() => setSupplierName((value) => value.trim())}
                        maxLength={200}
                        className={inputClass}
                      />
                    </div>

                    <div>
                      <Label
                        htmlFor="dashboard-expected-arrival-date"
                        className="text-[10px] font-bold uppercase text-muted-foreground"
                      >
                        Expected Arrival Date *
                      </Label>
                      <Input
                        id="dashboard-expected-arrival-date"
                        type="date"
                        required
                        min={todayDate()}
                        value={expectedArrivalDate}
                        onChange={(e) => setExpectedArrivalDate(e.target.value)}
                        className={inputClass}
                      />
                    </div>
                  </div>
                </div>

                {/* VEHICLE & DRIVER DETAILS */}
                <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-black uppercase tracking-wider text-primary">
                      2. VEHICLE & DRIVER DETAILS
                    </h3>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <Label
                        htmlFor="dash-vehicle-number"
                        className="text-[10px] font-bold uppercase text-muted-foreground"
                      >
                        Vehicle Number *
                      </Label>
                      {registeredVehicles.length > 0 && (
                        <select
                          aria-label="Select registered vehicle"
                          className={`${inputClass} mb-1.5 w-full px-2 text-[11px]`}
                          value={
                            registeredVehicles.some((v) => v.vehicle_number === vehicleNumber)
                              ? vehicleNumber
                              : ""
                          }
                          onChange={(e) => {
                            if (e.target.value) setVehicleNumber(e.target.value);
                          }}
                        >
                          <option value="">Choose registered vehicle...</option>
                          {registeredVehicles.map((v) => (
                            <option key={v.id} value={v.vehicle_number}>
                              {v.vehicle_number} ({v.vehicle_type || "Vehicle"})
                            </option>
                          ))}
                        </select>
                      )}
                      <Input
                        id="dash-vehicle-number"
                        required
                        placeholder="e.g. KA01AB1234"
                        value={vehicleNumber}
                        onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())}
                        className={inputClass}
                      />
                    </div>

                    <div>
                      <Label
                        htmlFor="dash-driver-name"
                        className="text-[10px] font-bold uppercase text-muted-foreground"
                      >
                        Driver Name *
                      </Label>
                      {registeredDrivers.length > 0 && (
                        <select
                          aria-label="Select registered driver"
                          className={`${inputClass} mb-1.5 w-full px-2 text-[11px]`}
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
                              setDriverMobile(String(phone).replace(/\D/g, "").slice(0, 10));
                            }
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
                        id="dash-driver-name"
                        required
                        placeholder="Enter driver name"
                        value={driverName}
                        onChange={(e) => setDriverName(e.target.value)}
                        className={inputClass}
                      />
                    </div>

                    <div>
                      <Label
                        htmlFor="dash-driver-mobile"
                        className="text-[10px] font-bold uppercase text-muted-foreground"
                      >
                        Driver Mobile Number *
                      </Label>
                      <Input
                        id="dash-driver-mobile"
                        required
                        type="tel"
                        maxLength={10}
                        placeholder="10-digit mobile number"
                        value={driverMobile}
                        onChange={(e) =>
                          setDriverMobile(e.target.value.replace(/\D/g, "").slice(0, 10))
                        }
                        className={inputClass}
                      />
                    </div>
                  </div>
                </div>

                {/* MATERIAL LINE ITEMS TABLE */}
                <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
                  <div className="flex justify-between items-center flex-wrap gap-2">
                    <h3 className="text-xs font-black uppercase tracking-wider text-primary">
                      3. SHIPPED MATERIALS & QUANTITIES
                    </h3>
                    <div className="flex items-center gap-2">
                      <div className="flex gap-2">
                        <Input
                          placeholder="Search material name or code"
                          value={materialSearch}
                          onChange={(e) => setMaterialSearch(e.target.value)}
                          className="h-8 w-56 text-[11px]"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8"
                          onClick={() =>
                            setLines((rows) => [
                              ...rows,
                              {
                                material_id: "",
                                item_code: "",
                                material_name: "",
                                shipped_quantity: "",
                                uom: "",
                              },
                            ])
                          }
                        >
                          + Add Row
                        </Button>
                      </div>
                      {materialsLoading && (
                        <span className="text-[11px] text-muted-foreground">
                          Loading materials…
                        </span>
                      )}
                      {materialsError && (
                        <span className="text-[11px] text-red-600">{materialsError}</span>
                      )}
                      {!materialsLoading && !materialsError && materialCatalog.length === 0 && (
                        <span className="text-[11px] text-amber-600">
                          No active materials found.
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="overflow-x-auto rounded-xl border bg-background">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-muted/40 border-b font-bold uppercase text-muted-foreground">
                        <tr>
                          <th className="p-2.5">
                            Material Name Component (Select from DB Dropdown)
                          </th>
                          <th className="p-2.5 text-right">Shipped Qty</th>
                          <th className="p-2.5">UOM</th>
                          <th className="p-2.5 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {lines.map((line, idx) => (
                          <tr key={idx}>
                            <td className="p-2">
                              <select
                                required
                                value={line.material_name}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  const matched = materialCatalog.find(
                                    (m) => m.name === val || m.material_name === val,
                                  );
                                  setLines((prev) =>
                                    prev.map((item, i) =>
                                      i === idx
                                        ? {
                                            ...item,
                                            material_name: val,
                                            item_code:
                                              matched?.code ||
                                              matched?.material_code ||
                                              item.item_code,
                                            uom:
                                              matched?.uom ||
                                              matched?.base_uom ||
                                              item.uom ||
                                              "PCS",
                                          }
                                        : item,
                                    ),
                                  );
                                }}
                                className="h-8 w-full rounded-lg border bg-background px-2 text-xs font-semibold"
                              >
                                <option value="">
                                  -- Select Material Component from Database --
                                </option>
                                {materialCatalog.map((mat, mIdx) => (
                                  <option
                                    key={mat.code || mat.material_code || mIdx}
                                    value={mat.name || mat.material_name}
                                  >
                                    {mat.name || mat.material_name} ({mat.category || "Component"})
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="p-2">
                              <Input
                                required
                                type="text"
                                inputMode="decimal"
                                placeholder="Enter quantity"
                                value={line.shipped_quantity}
                                onKeyDown={(e) => {
                                  if (
                                    e.key === "Backspace" ||
                                    e.key === "Delete" ||
                                    e.key === "Tab" ||
                                    e.key === "ArrowLeft" ||
                                    e.key === "ArrowRight" ||
                                    e.key === "Home" ||
                                    e.key === "End" ||
                                    e.key === "Enter" ||
                                    e.ctrlKey ||
                                    e.metaKey
                                  ) {
                                    return;
                                  }
                                  if (e.key === ".") {
                                    if (line.shipped_quantity.includes(".")) {
                                      e.preventDefault();
                                    }
                                    return;
                                  }
                                  if (!/^\d$/.test(e.key)) {
                                    e.preventDefault();
                                  }
                                }}
                                onChange={(e) => {
                                  const sanitized = sanitizeNumericQuantity(e.target.value, line.uom || "");
                                  setLines((prev) =>
                                    prev.map((item, i) =>
                                      i === idx
                                        ? { ...item, shipped_quantity: sanitized }
                                        : item,
                                    ),
                                  );
                                }}
                                className="h-8 text-xs font-bold text-right"
                              />
                            </td>
                            <td className="p-2">
                              <Input
                                readOnly
                                value={line.uom}
                                className="h-8 bg-muted text-xs font-semibold"
                              />
                            </td>
                            <td className="p-2 text-center">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                disabled
                                onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                                className="h-7 size-7 text-red-500 hover:bg-red-50"
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* SUBMIT ACTIONS */}
                <div className="flex gap-2 justify-end pt-2">
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
                    disabled={
                      submitting ||
                      !lines.length ||
                      lines.some(
                        (line) =>
                          !line.material_id || !line.uom || Number(line.shipped_quantity) <= 0,
                      )
                    }
                    className="rounded-xl font-bold bg-sky-600 hover:bg-sky-700 text-white shadow-md"
                  >
                    {submitting ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="mr-2 size-4" />
                    )}
                    Submit ASN
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </AppShell>
    </TooltipProvider>
  );
}
