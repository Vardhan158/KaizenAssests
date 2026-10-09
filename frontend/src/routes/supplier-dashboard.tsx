import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileText,
  Loader2,
  MoreVertical,
  Plus,
  Search,
  Trash2,
  Truck,
} from "lucide-react";
import { AppShell } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api-client";

export const Route = createFileRoute("/supplier-dashboard")({
  component: SupplierDashboard,
});

const inputClass = "mt-1.5 h-10 rounded-xl border-border/80 bg-background text-xs font-semibold";

const statuses: Record<string, string> = {
  SUBMITTED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  APPROVED: "bg-sky-50 text-sky-700 border-sky-200",
  PENDING: "bg-amber-50 text-amber-700 border-amber-200",
  CANCELLED: "bg-rose-50 text-rose-700 border-rose-200",
};

function SupplierDashboard() {
  const [asns, setAsns] = useState<any[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Modal Form Inputs
  const [asnNumber, setAsnNumber] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [destinationWarehouse, setDestinationWarehouse] = useState("");
  const [expectedArrivalDate, setExpectedArrivalDate] = useState("");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [driverName, setDriverName] = useState("");
  const [driverMobile, setDriverMobile] = useState("");
  const [lines, setLines] = useState<any[]>([
    { item_code: "", material_name: "", shipped_quantity: "", uom: "KG" },
  ]);

  const [materialCatalog, setMaterialCatalog] = useState<any[]>([]);

  useEffect(() => {
    loadAsns();
    void api.getMaterialComponents().then((mats) => setMaterialCatalog(mats || []));
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
    try {
      const data = await api.getAsns();
      setAsns((data || []).map((asn: any) => ({
        ...asn,
        supplier_name: asn.supplier_name || asn.supplierName || asn.supplier_company_name || asn.supplier?.supplier_name || "",
        destination_warehouse: asn.destination_warehouse || asn.destinationWarehouse || asn.warehouse_name || asn.delivery_warehouse_name || "",
      })));
    } catch {
      setAsns([]);
    }
  };

  const handleOpenCreateModal = async () => {
    try {
      const next = await api.getNextAsnNumber();
    setAsnNumber(next.asnNumber);
    } catch {
      setAsnNumber("");
    }
    setExpectedArrivalDate("");
    setVehicleNumber("");
    setDriverName("");
    setDriverMobile("");
    setLines([{ item_code: "", material_name: "", shipped_quantity: "", uom: "KG" }]);
    setIsModalOpen(true);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!expectedArrivalDate) {
      toast.error("Expected Arrival Date is mandatory *");
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
        po_number: "PO-2026-008741",
        supplier_name: supplierName,
        destination_warehouse: destinationWarehouse,
        expected_arrival_at: expectedArrivalDate,
        vehicle_number: vehicleNumber.toUpperCase().trim(),
        driver_name: driverName.trim(),
        driver_contact: driverMobile.trim(),
        lines: lines.map((l) => ({
          item_code: l.item_code || "MAT-001",
          material_name: l.material_name,
          shipped_quantity: Number(l.shipped_quantity) || 0,
          uom: l.uom || "PCS",
        })),
        status: "SUBMITTED",
      };

      await api.createAsn(payload);

      const newRecord = {
        id: `asn-${Date.now()}`,
        asn_number: asnNumber,
        po_number: "PO-2026-008741",
        supplier_name: supplierName,
        supplier_company_name: supplierName,
        destination_warehouse: destinationWarehouse,
        vehicle_number: vehicleNumber.toUpperCase().trim(),
        driver_name: driverName.trim(),
        driver_contact: driverMobile.trim(),
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
  const pending = asns.filter((a) =>
    ["PENDING", "DRAFT"].includes(String(a.status || "").toUpperCase())
  ).length;
  const vehicles = new Set(asns.map((a) => a.vehicle_number).filter(Boolean)).size;

  const metrics = [
    { title: "Total ASNs", value: asns.length, icon: FileText, tone: "bg-sky-50 text-sky-600" },
    { title: "Submitted", value: submitted, icon: Truck, tone: "bg-emerald-50 text-emerald-600" },
    { title: "Pending", value: pending, icon: CalendarDays, tone: "bg-amber-50 text-amber-600" },
    { title: "Vehicles", value: vehicles, icon: Truck, tone: "bg-purple-50 text-purple-600" },
  ];

  const showDetails = (asn: any) => {
    setSelected(asn);
    setOpenMenu(null);
  };

  const trend = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - (6 - i));
      return d;
    });
    return days.map((day) => ({
      label: day.toLocaleDateString(undefined, { month: "short", day: "2-digit" }),
      count: asns.filter((a) => {
        const raw = a.created_at || a.submitted_at || a.shipment_date;
        return raw && new Date(raw).toDateString() === day.toDateString();
      }).length,
    }));
  }, [asns]);

  return (
    <AppShell>
      <div className="space-y-4">
        {/* Top Banner Card with Top-Right Create ASN CTA */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-gradient-to-r from-white via-slate-50 to-sky-50 p-4 shadow-xs">
          <div>
            <p className="text-xs font-semibold text-slate-500">Welcome back,</p>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">
              Supplier <span className="text-sky-600">Dashboard</span>
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Manage your advance shipping notices (ASNs) and track deliveries in real-time.
            </p>
          </div>

          <Button
            onClick={handleOpenCreateModal}
            className="rounded-xl font-extrabold shadow-sm bg-sky-600 hover:bg-sky-700 text-white px-4 h-10 text-xs"
          >
            <Plus className="mr-1.5 size-4" /> Create ASN
          </Button>
        </div>

        {/* High-Density Metric Cards */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {metrics.map(({ title, value, icon: Icon, tone }) => (
            <div
              key={title}
              className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-xs flex items-center justify-between"
            >
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  {title}
                </p>
                <p className="text-2xl font-black text-slate-900 mt-0.5">{value}</p>
              </div>

              <div
                className={`flex size-10 items-center justify-center rounded-xl border border-slate-200/60 ${tone}`}
              >
                <Icon className="size-5" />
              </div>
            </div>
          ))}
        </div>

        {/* ASN History Table Section */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-black uppercase tracking-wider text-slate-900">
                ASN HISTORY
              </h2>
              <p className="text-xs text-slate-500">View and track all your submitted ASNs</p>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-2.5 size-3.5 text-slate-400" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search ASN, vehicle, status..."
                  className="h-8 pl-8 text-xs font-semibold rounded-xl"
                />
              </div>

            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase font-bold text-slate-500">
                <tr>
                  <th className="px-3.5 py-2.5">ASN Number</th>
                  <th className="px-3.5 py-2.5">Vehicle Number</th>
                  <th className="px-3.5 py-2.5">Status</th>
                  <th className="px-3.5 py-2.5">Submitted Date</th>
                  <th className="px-3.5 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {rows.map((asn) => {
                  const key = String(asn.id || asn.asn_number);
                  const status = String(asn.status || "SUBMITTED").toUpperCase();
                  return (
                    <tr key={key} className="hover:bg-slate-50/60 transition-colors">
                      <td className="px-3.5 py-2.5 font-bold font-mono text-sky-600">
                        {asn.asn_number || "—"}
                      </td>
                      <td className="px-3.5 py-2.5 font-mono font-bold text-slate-900">
                        {asn.vehicle_number || "—"}
                      </td>
                      <td className="px-3.5 py-2.5">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase border ${
                            statuses[status] || "bg-slate-100 text-slate-600 border-slate-200"
                          }`}
                        >
                          ● {status.replaceAll("_", " ")}
                        </span>
                      </td>
                      <td className="px-3.5 py-2.5 text-slate-500">
                        {asn.created_at
                          ? new Date(asn.created_at).toLocaleDateString()
                          : asn.delivery_date || asn.expected_arrival_date || asn.expected_arrival_at?.split("T")[0] || "—"}
                      </td>
                      <td className="px-3.5 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs font-bold text-sky-600"
                            onClick={() => showDetails(asn)}
                          >
                            <Eye className="mr-1 size-3.5" /> View
                          </Button>
                          <div className="relative">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 size-7 text-slate-400"
                              aria-label="Open ASN actions"
                              onClick={() => setOpenMenu(openMenu === key ? null : key)}
                            >
                              <MoreVertical className="size-3.5" />
                            </Button>
                            {openMenu === key && (
                              <div className="absolute right-0 top-8 z-30 w-36 rounded-xl border border-slate-200 bg-white p-1 shadow-lg text-xs">
                                <button
                                  type="button"
                                  className="w-full rounded-lg px-3 py-1.5 text-left font-semibold text-slate-700 hover:bg-slate-50"
                                  onClick={() => showDetails(asn)}
                                >
                                  View Details
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {!rows.length && (
              <p className="p-6 text-center text-xs text-slate-400">No ASN records found.</p>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
            <span>Showing {rows.length} entries</span>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="size-7 rounded-lg">
                <ChevronLeft className="size-3.5" />
              </Button>
              <Button size="icon" className="size-7 rounded-lg bg-sky-600 text-xs font-bold">
                1
              </Button>
              <Button variant="outline" size="icon" className="size-7 rounded-lg">
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>

          {false && selected && (
            <div className="mt-3 rounded-xl bg-sky-50 p-3.5 border border-sky-200 text-xs">
              <div className="flex items-center justify-between">
                <p className="font-bold text-sky-900">{selected.asn_number}</p>
                <button
                  type="button"
                  className="text-slate-400 hover:text-slate-700 font-bold text-sm"
                  onClick={() => setSelected(null)}
                >
                  ✕
                </button>
              </div>
              <p className="mt-1 text-slate-600">
                Vehicle: <span className="font-mono font-bold text-slate-900">{selected.vehicle_number || "—"}</span> · Driver:{" "}
                <span className="font-bold text-slate-900">{selected.driver_name || "—"}</span> ({selected.driver_contact || "+91 98450 12345"})
              </p>
            </div>
          )}
        </section>

        {/* Bottom: ASN Submission Trend */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-black uppercase tracking-wider text-slate-900">
              ASN SUBMISSION TREND
            </h2>
            <Button variant="outline" size="sm" className="h-7 text-xs rounded-lg font-bold">
              Last 7 Days <ChevronDown className="ml-1.5 size-3" />
            </Button>
          </div>

          <div className="mt-4 flex h-28 items-end gap-2 border-b border-l border-slate-200 px-2 pb-1">
            {trend.map(({ label, count }) => {
              const max = Math.max(...trend.map((item) => item.count), 1);
              return (
                <div key={label} className="flex flex-1 flex-col items-center justify-end gap-1">
                  <div
                    className="w-full max-w-8 rounded-t bg-sky-500/80"
                    title={`${label}: ${count}`}
                    style={{ height: `${Math.max((count / max) * 100, count ? 10 : 4)}%` }}
                  />
                  <span className="text-[9px] font-bold text-slate-400">{label}</span>
                </div>
              );
            })}
          </div>
        </section>

        <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
          <DialogContent className="max-w-lg rounded-2xl bg-card p-6 shadow-2xl">
            <DialogHeader>
              <DialogTitle className="font-black text-lg text-primary">
                ASN Details · {selected?.asn_number || "—"}
              </DialogTitle>
            </DialogHeader>
            {selected && (
              <div className="grid gap-3 text-xs sm:grid-cols-2">
                <div className="rounded-xl border bg-muted/30 p-3"><p className="font-bold uppercase text-muted-foreground">ASN Number</p><p className="mt-1 font-mono font-black text-sky-600">{selected.asn_number || "—"}</p></div>
                <div className="rounded-xl border bg-muted/30 p-3"><p className="font-bold uppercase text-muted-foreground">Supplier Name</p><p className="mt-1 font-bold text-slate-900">{selected.supplier_name || selected.supplier_company_name || "—"}</p></div>
                <div className="rounded-xl border bg-muted/30 p-3"><p className="font-bold uppercase text-muted-foreground">Destination Warehouse</p><p className="mt-1 font-bold text-slate-900">{selected.destination_warehouse || "—"}</p></div>
                <div className="rounded-xl border bg-muted/30 p-3"><p className="font-bold uppercase text-muted-foreground">Vehicle Number</p><p className="mt-1 font-mono font-bold text-slate-900">{selected.vehicle_number || "—"}</p></div>
                <div className="rounded-xl border bg-muted/30 p-3"><p className="font-bold uppercase text-muted-foreground">Driver Name & Mobile</p><p className="mt-1 font-bold text-slate-900">{selected.driver_name || "—"} · {selected.driver_contact || "—"}</p></div>
                <div className="rounded-xl border bg-muted/30 p-3"><p className="font-bold uppercase text-muted-foreground">Expected Arrival Date</p><p className="mt-1 font-bold text-slate-900">{selected.expected_arrival_date || selected.expected_arrival_at?.split("T")[0] || selected.delivery_date || "—"}</p></div>
                <div className="rounded-xl border bg-muted/30 p-3"><p className="font-bold uppercase text-muted-foreground">Status</p><p className="mt-1 font-black text-slate-900">{String(selected.status || "SUBMITTED").replaceAll("_", " ")}</p></div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* CREATE ASN POPUP MODAL DIALOG */}
        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogContent className="max-w-2xl rounded-2xl bg-card p-6 shadow-2xl">
            <DialogHeader>
              <DialogTitle className="font-black text-lg text-primary uppercase border-b pb-2">
                CREATE ADVANCE SHIPPING NOTICE (ASN)
              </DialogTitle>
            </DialogHeader>

            <form onSubmit={handleFormSubmit} className="space-y-4 text-xs">
              {/* SHIPMENT & WAREHOUSE DETAILS */}
              <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
                <h3 className="text-xs font-black uppercase tracking-wider text-primary">
                  1. SHIPMENT & WAREHOUSE DETAILS
                </h3>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="text-[10px] font-bold uppercase text-muted-foreground">ASN Number</Label>
                    <div className="mt-1 flex h-10 items-center rounded-xl border bg-muted/60 px-3 font-mono font-bold text-primary">
                      {asnNumber}
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="dashboard-supplier-name" className="text-[10px] font-bold uppercase text-muted-foreground">Supplier Name</Label>
                    <Input
                      id="dashboard-supplier-name"
                      required
                      placeholder="e.g. Bharat Electronics Components Pvt. Ltd."
                      value={supplierName}
                      onChange={(e) => setSupplierName(e.target.value)}
                      className={inputClass}
                    />
                  </div>

                  <div>
                    <Label htmlFor="dashboard-destination-warehouse" className="text-[10px] font-bold uppercase text-muted-foreground">Destination Warehouse</Label>
                    <Input
                      id="dashboard-destination-warehouse"
                      required
                      placeholder="e.g. Raw Material Warehouse"
                      value={destinationWarehouse}
                      onChange={(e) => setDestinationWarehouse(e.target.value)}
                      className={inputClass}
                    />
                  </div>

                  <div>
                    <Label htmlFor="dashboard-expected-arrival-date" className="text-[10px] font-bold uppercase text-muted-foreground">
                      Expected Arrival Date *
                    </Label>
                    <Input
                      id="dashboard-expected-arrival-date"
                      type="date"
                      required
                      value={expectedArrivalDate}
                      onChange={(e) => setExpectedArrivalDate(e.target.value)}
                      className={inputClass}
                    />
                  </div>

                </div>
              </div>

              {/* VEHICLE & DRIVER DETAILS */}
              <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
                <h3 className="text-xs font-black uppercase tracking-wider text-primary">
                  2. VEHICLE & DRIVER DETAILS
                </h3>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <Label htmlFor="dash-vehicle-number" className="text-[10px] font-bold uppercase text-muted-foreground">
                      Vehicle Number *
                    </Label>
                    <Input
                      id="dash-vehicle-number"
                      required
                      placeholder="e.g. KA 01 AB 4582"
                      value={vehicleNumber}
                      onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())}
                      className={inputClass}
                    />
                  </div>

                  <div>
                    <Label htmlFor="dash-driver-name" className="text-[10px] font-bold uppercase text-muted-foreground">
                      Driver Name *
                    </Label>
                    <Input
                      id="dash-driver-name"
                      required
                      placeholder="e.g. Suresh Gowda"
                      value={driverName}
                      onChange={(e) => setDriverName(e.target.value)}
                      className={inputClass}
                    />
                  </div>

                  <div>
                    <Label htmlFor="dash-driver-mobile" className="text-[10px] font-bold uppercase text-muted-foreground">
                      Driver Mobile Number *
                    </Label>
                    <Input
                      id="dash-driver-mobile"
                      required
                      type="tel"
                      placeholder="e.g. +91 98450 12345"
                      value={driverMobile}
                      onChange={(e) => setDriverMobile(e.target.value)}
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
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-[11px] font-bold rounded-lg border-sky-500/40 text-sky-600 hover:bg-sky-50"
                      onClick={handleAddNewCustomMaterial}
                    >
                      + Add New Material Component to Database
                    </Button>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-[11px] font-bold rounded-lg"
                      onClick={() => setLines((prev) => [...prev, { item_code: "", material_name: "", shipped_quantity: "", uom: "PCS" }])}
                    >
                      + Add Row
                    </Button>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-xl border bg-background">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-muted/40 border-b font-bold uppercase text-muted-foreground">
                      <tr>
                        <th className="p-2.5">Material Name Component (Select from DB Dropdown)</th>
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
                                const matched = materialCatalog.find((m) => m.name === val);
                                setLines((prev) =>
                                  prev.map((item, i) =>
                                    i === idx
                                      ? {
                                          ...item,
                                          material_name: val,
                                          item_code: matched?.code || item.item_code,
                                          uom: matched?.uom || item.uom || "PCS",
                                        }
                                      : item
                                  )
                                );
                              }}
                              className="h-8 w-full rounded-lg border bg-background px-2 text-xs font-semibold"
                            >
                              <option value="">-- Select Material Component from Database --</option>
                              {materialCatalog.map((mat, mIdx) => (
                                <option key={mat.code || mIdx} value={mat.name}>
                                  {mat.name} ({mat.category || "Component"})
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="p-2">
                            <Input
                              required
                              type="number"
                              placeholder="e.g. 500"
                              value={line.shipped_quantity}
                              onChange={(e) =>
                                setLines((prev) =>
                                  prev.map((item, i) => (i === idx ? { ...item, shipped_quantity: e.target.value } : item))
                                )
                              }
                              className="h-8 text-xs font-bold text-right"
                            />
                          </td>
                          <td className="p-2">
                            <select
                              value={line.uom}
                              onChange={(e) =>
                                setLines((prev) =>
                                  prev.map((item, i) => (i === idx ? { ...item, uom: e.target.value } : item))
                                )
                              }
                              className="h-8 w-full rounded-lg border bg-background px-2 text-xs font-semibold"
                            >
                              <option value="PCS">PCS</option>
                              <option value="METER">METER</option>
                              <option value="KG">KG</option>
                              <option value="SET">SET</option>
                              <option value="BOX">BOX</option>
                              <option value="PALLET">PALLET</option>
                            </select>
                          </td>
                          <td className="p-2 text-center">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              disabled={lines.length === 1}
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
                  disabled={submitting}
                  className="rounded-xl font-bold bg-sky-600 hover:bg-sky-700 text-white shadow-md"
                >
                  {submitting ? <Loader2 className="mr-2 size-4 animate-spin" /> : <CheckCircle2 className="mr-2 size-4" />}
                  Submit ASN
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
