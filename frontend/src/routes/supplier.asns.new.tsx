import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  Plus,
  Search,
  Trash2,
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
import { getUserInfo } from "@/lib/auth-utils";

export const Route = createFileRoute("/supplier/asns/new")({
  beforeLoad: () => {},
  component: NewAsnPage,
});

const inputClass = "mt-1.5 h-10 rounded-xl border-border/80 bg-background text-xs font-semibold";

interface AsnRecord {
  id: string;
  asn_number: string;
  po_number: string;
  supplier_name: string;
  destination_warehouse: string;
  vehicle_number: string;
  driver_name: string;
  driver_contact: string;
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
  const [loading, setLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Modal Form Inputs
  const [asnNumber, setAsnNumber] = useState("");
    const [supplierName, setSupplierName] = useState("");
  const [supplierCompanyName, setSupplierCompanyName] = useState("");
    const [destinationWarehouse, setDestinationWarehouse] = useState("");
  const [destinationWarehouseId, setDestinationWarehouseId] = useState("");
  const [expectedArrivalDate, setExpectedArrivalDate] = useState("");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [driverName, setDriverName] = useState("");
  const [driverMobile, setDriverMobile] = useState("");
  const [lines, setLines] = useState<any[]>([
    { material_id: "", item_code: "", material_name: "", shipped_quantity: "", uom: "" },
  ]);

  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);
  const [materialCatalog, setMaterialCatalog] = useState<any[]>([]);
  const [materialSearch, setMaterialSearch] = useState("");
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [selectedPo, setSelectedPo] = useState<any>(null);
  const currentUser = getUserInfo();

  useEffect(() => {
    loadAsnData();
    void (currentUser?.supplierId ? api.getSupplier(currentUser.supplierId) : api.getSuppliers({ search: currentUser?.username }))
      .then((result: any) => {
        const supplierRows = Array.isArray(result) ? result : result?.items || result?.suppliers || [];
        const supplier = supplierRows.length ? supplierRows.find((item: any) => String(item.id) === String(currentUser?.supplierId) || String(item.username || item.supplier_name || "").toLowerCase() === String(currentUser?.username || "").toLowerCase()) || supplierRows[0] : result;
        const companyName = supplier?.registered_company_name || supplier?.company_name || supplier?.supplier_name || "";
        setSupplierCompanyName(companyName);
        if (companyName) setSupplierName(companyName);
      }).catch(() => undefined);
    void Promise.all([
      api.getStores({ status: "ALL" }).catch(() => []),
    ]).then(([stores]) => { setWarehouses((stores || []).filter((store: any) => String(store.status || "ACTIVE").toUpperCase() === "ACTIVE")); });
    void api.getMaterials({ status: "ACTIVE" }).then((materials) => setMaterialCatalog((materials || []).map((material: any) => ({ ...material, id: material.id || material.material_id, code: material.code || material.material_code, name: material.name || material.material_name, uom: material.uom || material.base_uom || material.unit_of_measure })))).catch(() => setMaterialCatalog([]));
  }, []);

  const loadAsnData = async () => {
    setLoading(true);
    try {
      const next = await api.getNextAsnNumber();
      setAsnNumber(next.asnNumber);

      const remoteAsns = await api.getAsns();
      if (Array.isArray(remoteAsns) && remoteAsns.length > 0) {
        const mapped = remoteAsns.map((a: any) => ({
          id: a.id || a.asn_number,
          asn_number: a.asn_number || "",
          po_number: a.po_number || "",
          supplier_name: a.supplier_name || "Bharat Electronics Components Pvt. Ltd.",
          destination_warehouse: a.warehouse_name || "Raw Material Warehouse",
          vehicle_number: a.vehicle_number || "KA 01 AB 4582",
          driver_name: a.driver_name || "Suresh Gowda",
          driver_contact: a.driver_contact || "+91 98450 12345",
          status: a.status || "SUBMITTED",
          created_at: a.created_at || new Date().toISOString(),
          lines: a.lines || [{ material_name: "Stainless Steel Sheet 304", quantity: 500, uom: "KG" }],
        }));
        setAsnList(mapped);
      }
    } catch {
      // fallback to INITIAL_ASNS
    } finally {
      setLoading(false);
    }
  };

  const handleOpenCreateModal = async () => {
    const next = await api.getNextAsnNumber();
    setAsnNumber(next.asnNumber);
    setExpectedArrivalDate("");
    setSupplierName(supplierCompanyName || currentUser?.full_name || currentUser?.username || "");
    setDestinationWarehouse("");
    setDestinationWarehouseId("");
    setSelectedPo(null);
    setVehicleNumber("");
    setDriverName("");
    setDriverMobile("");
    setLines([
      { material_id: "", item_code: "", material_name: "", shipped_quantity: "", uom: "" },
    ]);
    setIsModalOpen(true);
  };

  const handleAddNewCustomMaterial = async () => {
    const compName = prompt("Enter New Material Component Name (to save in Database):");
    if (!compName || !compName.trim()) return;

    try {
      const created = await api.createMaterialComponent(compName.trim(), "PCS");
      void created;
      toast.success(`Component '${created.name}' saved to Database ✓`, {
        description: `Code: ${created.code} · Now available in dropdown`,
      });
      setLines((prev) => [
        ...prev,
        { item_code: created.code, material_name: created.name, shipped_quantity: "1", uom: created.uom || "PCS" },
      ]);
    } catch {
      toast.error("Failed to save material to database");
    }
  };

  const selectPurchaseOrder = async (id: string) => {
    if (!id) { setSelectedPo(null); setLines([]); return; }
    const po = await api.getPurchaseOrder(id);
    setSelectedPo(po);
    const poLines = po?.lines || po?.items || po?.materials || po?.purchase_order_lines || [];
    setLines(poLines.map((line: any) => ({
      item_code: line.item_code || line.material_code || line.code || "",
      material_name: line.material_name || line.material?.name || line.name || "",
      shipped_quantity: "",
      remaining_quantity: Number(line.remaining_quantity ?? line.remaining ?? line.balance_quantity ?? line.ordered_quantity ?? line.quantity ?? 0),
      uom: line.uom || line.unit_of_measure || "PCS",
    })));
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!destinationWarehouse || !lines.length || lines.some((line) => !line.item_code || !line.material_name)) {
      toast.error("Select a warehouse and material before submitting the ASN");
      return;
    }
    if (!expectedArrivalDate) {
      toast.error("Expected Arrival Date is mandatory *");
      return;
    }
    if (!vehicleNumber.trim() || !driverName.trim() || !driverMobile.trim()) {
      toast.error("Please fill in Vehicle Number, Driver Name, and Mobile Number *");
      return;
    }
    if (lines.some((line) => Number(line.shipped_quantity) <= 0)) {
      toast.error("Shipped quantity must be greater than zero");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        asn_number: asnNumber,
        po_number: undefined,
        supplier_name: supplierName,
        supplier_id: currentUser?.supplierId,
        destination_warehouse: destinationWarehouse,
        destination_warehouse_id: destinationWarehouseId,
        expected_arrival_at: expectedArrivalDate,
        vehicle_number: vehicleNumber.toUpperCase().trim(),
        driver_name: driverName.trim(),
        driver_contact: driverMobile.trim(),
        lines: lines.map((l) => ({
          material_id: l.material_id,
          item_code: l.item_code,
          material_name: l.material_name,
          shipped_quantity: Number(l.shipped_quantity) || 0,
          uom: l.uom || "PCS",
        })),
        status: "SUBMITTED",
      };

      await api.createAsn(payload);

      const newRecord: AsnRecord = {
        id: `asn-${Date.now()}`,
        asn_number: asnNumber,
        po_number: "",
        supplier_name: supplierName,
        destination_warehouse: destinationWarehouse,
        vehicle_number: vehicleNumber.toUpperCase().trim(),
        driver_name: driverName.trim(),
        driver_contact: driverMobile.trim(),
        expected_arrival_at: expectedArrivalDate,
        status: "SUBMITTED",
        created_at: new Date().toISOString(),
        lines: payload.lines,
      };

      setAsnList((prev) => [newRecord, ...prev]);
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

  const handleDownloadAsnPdf = (record: AsnRecord) => {
    toast.success(`Downloading Official ASN Certificate: ${record.asn_number}`, {
      description: `Vehicle: ${record.vehicle_number} · Supplier: ${record.supplier_name}`,
    });
    window.print();
  };

  const filteredList = asnList.filter((a) => {
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

  return (
    <AppShell>
      <div className="space-y-4 w-full pb-10">
        {/* Search & ASN Table Card */}
        <Card className="rounded-2xl border-border/60 shadow-soft">
          <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-base font-bold uppercase tracking-wider">
                GENERATED ADVANCE SHIPPING NOTICES
              </CardTitle>
              <CardDescription>
                Search and manage generated ASNs or download official certificates
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search ASN, Vehicle, Driver..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-9 w-full rounded-xl border bg-background pl-9 pr-3 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <Button
                onClick={handleOpenCreateModal}
                className="rounded-xl font-bold shadow-md bg-sky-600 hover:bg-sky-700 text-white h-9 px-4 text-xs"
              >
                <Plus className="mr-1.5 size-4" /> Create ASN
              </Button>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b bg-muted/40 font-bold uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">ASN Number</th>
                    <th className="px-4 py-3">Supplier Name</th>
                    <th className="px-4 py-3">Destination Warehouse</th>
                    <th className="px-4 py-3">Vehicle Number</th>
                    <th className="px-4 py-3">Driver Name & Mobile</th>
                    <th className="px-4 py-3">Expected Arrival Date</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60 font-medium">
                  {filteredList.map((asn) => (
                    <tr key={asn.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-mono font-bold text-primary">{asn.asn_number}</td>
                      <td className="px-4 py-3 font-bold text-foreground">{asn.supplier_name}</td>
                      <td className="px-4 py-3">{asn.destination_warehouse}</td>
                      <td className="px-4 py-3 font-mono font-bold text-sky-600">{asn.vehicle_number}</td>
                      <td className="px-4 py-3">
                        <span className="font-bold">{asn.driver_name}</span>{" "}
                        <span className="text-muted-foreground font-mono">({asn.driver_contact})</span>
                      </td>
                      <td className="px-4 py-3 font-bold text-emerald-600">
                        {asn.delivery_date || asn.expected_arrival_date || asn.expected_arrival_at?.split("T")[0] || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge className="rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">
                          {asn.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          className="size-8 rounded-xl border-sky-500/40 text-sky-600 hover:bg-sky-50"
                          aria-label="Download ASN certificate"
                          title="Download ASN certificate"
                          onClick={() => handleDownloadAsnPdf(asn)}
                        >
                          <Download className="size-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* CREATE ASN POPUP MODAL DIALOG */}
        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogContent className="max-w-2xl rounded-2xl bg-card p-6 shadow-2xl">
            <DialogHeader>
              <DialogTitle className="font-black text-lg text-primary uppercase border-b pb-2">
                CREATE ADVANCE SHIPPING NOTICE (ASN)
              </DialogTitle>
            </DialogHeader>

            <form onSubmit={handleFormSubmit} className="space-y-4 text-xs">
              {/* AUTOMATIC / MANDATORY DETAILS */}
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
                    <Label htmlFor="supplier-name" className="text-[10px] font-bold uppercase text-muted-foreground">Supplier Name</Label>
                    <Input id="supplier-name" readOnly required value={supplierName} className={`${inputClass} bg-muted`} />
                  </div>

                  <div>
                    <Label htmlFor="destination-warehouse" className="text-[10px] font-bold uppercase text-muted-foreground">Destination Warehouse *</Label>
                    <select id="destination-warehouse" required value={destinationWarehouseId} onChange={(e) => { const warehouse = warehouses.find((item) => String(item.id) === e.target.value); setDestinationWarehouseId(e.target.value); setDestinationWarehouse(warehouse?.store_name || warehouse?.name || warehouse?.store_code || ""); }} className={`${inputClass} w-full px-3`}>
                      <option value="">Select warehouse</option>
                      {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.store_name || warehouse.name} ({warehouse.store_code})</option>)}
                    </select>
                    {!warehouses.length && <p className="mt-1 text-[10px] font-semibold text-amber-600">No active warehouses exist in the Warehouse Master.</p>}
                  </div>

                  <div>
                    <Label htmlFor="expected-arrival-date" className="text-[10px] font-bold uppercase text-muted-foreground">
                      Expected Arrival Date *
                    </Label>
                    <Input
                      id="expected-arrival-date"
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
                    <Label htmlFor="modal-vehicle-number" className="text-[10px] font-bold uppercase text-muted-foreground">
                      Vehicle Number *
                    </Label>
                    <Input
                      id="modal-vehicle-number"
                      required
                      placeholder="e.g. KA 01 AB 4582"
                      value={vehicleNumber}
                      onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())}
                      className={inputClass}
                    />
                  </div>

                  <div>
                    <Label htmlFor="modal-driver-name" className="text-[10px] font-bold uppercase text-muted-foreground">
                      Driver Name *
                    </Label>
                    <Input
                      id="modal-driver-name"
                      required
                      placeholder="e.g. Suresh Gowda"
                      value={driverName}
                      onChange={(e) => setDriverName(e.target.value)}
                      className={inputClass}
                    />
                  </div>

                  <div>
                    <Label htmlFor="modal-driver-mobile" className="text-[10px] font-bold uppercase text-muted-foreground">
                      Driver Mobile Number *
                    </Label>
                    <Input
                      id="modal-driver-mobile"
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
                  <div className="flex gap-2"><Input placeholder="Search material name or code" value={materialSearch} onChange={(e) => setMaterialSearch(e.target.value)} className="h-8 w-56 text-[11px]" /><Button type="button" variant="outline" size="sm" className="h-8" onClick={() => setLines((rows) => [...rows, { material_id: "", item_code: "", material_name: "", shipped_quantity: "", uom: "" }])}>+ Add Row</Button></div>
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
                            <select required value={line.item_id || line.material_id || ""} onChange={(e) => { const material = materialCatalog.find((item) => String(item.id) === e.target.value); if (material && lines.some((item, i) => i !== idx && String(item.material_id) === String(material.id))) { toast.error("This material is already selected in the ASN."); return; } setLines((current) => current.map((item, i) => i === idx ? { ...item, material_id: material?.id || "", item_code: material?.code || "", material_name: material?.name || "", uom: material?.uom || "" } : item)); }} className="h-8 w-full rounded-lg border bg-background px-2 text-xs font-semibold"><option value="">Select material</option>{materialCatalog.filter((material) => `${material.name || ""} ${material.code || ""}`.toLowerCase().includes(materialSearch.toLowerCase())).map((material) => <option key={material.id} value={material.id}>{material.name} ({material.code})</option>)}</select>
                          </td>
                          <td className="p-2">
                            <Input
                              required
                              type="number"
                              placeholder="Enter quantity"
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
                            <Input readOnly value={line.uom} className="h-8 bg-muted text-xs font-semibold" />
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
