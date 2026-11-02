import { InformationTooltip } from "@/components/ui/information-tooltip";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  Truck,
  Plus,
  RefreshCw,
  Loader2,
  Boxes,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Search,
  Filter,
  X,
  ShieldCheck,
  Box,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api-client";
import { isValidDateInput, parsePositiveNumber } from "@/lib/input-validation";

export const Route = createFileRoute("/dispatch-orders")({
  component: DispatchOrdersPage,
});

const STATUS_OPTIONS = [
  "Draft",
  "Planned",
  "Stock Reserved",
  "Picking",
  "Picked",
  "Packing",
  "Dispatch Ready",
  "Driver Assigned",
  "Vehicle Assigned",
  "Loading",
  "Loaded",
  "Ready for Gate Exit",
  "Dispatched",
  "In Transit",
  "Delivered",
  "Closed",
  "Cancelled",
  "On Hold",
  "Delayed",
];

function dateOnly(value: string | null | undefined): string {
  return value ? String(value).split("T")[0] : "";
}

function DispatchOrdersPage() {
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [assignmentDrafts, setAssignmentDrafts] = useState<Record<string, { driverId: string; vehicleId: string }>>({});
  const [salesOrders, setSalesOrders] = useState<any[]>([]);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  // Filter States
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [warehouseFilter, setWarehouseFilter] = useState("");
  const [driverFilter, setDriverFilter] = useState("");

  // Create Dispatch Form State (7 Sections)
  const [dispatchNumber, setDispatchNumber] = useState("");
  const [autosaveStatus, setAutosaveStatus] = useState("Draft Autosaved");
  const [selectedSo, setSelectedSo] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [dispatchDate, setDispatchDate] = useState("");
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState("");
  // Retained for backwards-compatible draft payloads; transport is assigned during Loading.
  const [transportMode] = useState("Road");
  const [transportType] = useState("Full Truckload");
  const [transporter] = useState("");

  // Section 2: Delivery Info
  const [customerAddress, setCustomerAddress] = useState("");
  const [destination, setDestination] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [deliveryInstructions, setDeliveryInstructions] = useState("");

  // Section 3: Transport Info

  // Section 4 & 5: Finished Goods & Stock Reservation
  const [productSearch, setProductSearch] = useState("");
  const [formItems, setFormItems] = useState<any[]>([]);
  const [isStockReserved, setIsStockReserved] = useState(false);

  // Section 7: Remarks
  const [remarks, setRemarks] = useState("");

  // Auto-save effect for form changes
  useEffect(() => {
    if (!isCreateOpen) return;
    setAutosaveStatus("Autosaving...");
    const timer = setTimeout(() => {
      const timeStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      setAutosaveStatus(`Draft Autosaved (${timeStr})`);
    }, 1000);
    return () => clearTimeout(timer);
  }, [customerName, destination, expectedDeliveryDate, remarks, formItems, isCreateOpen]);

  const getNextDispatchNumber = (existingOrders: any[]): string => {
    const currentYear = new Date().getFullYear();
    let maxSeq = 0;

    (existingOrders || []).forEach((o: any) => {
      const numStr = String(o.dispatch_number || o.dispatchNumber || o.id || "");
      const match =
        numStr.match(/DO-\d{4}-(\d+)/i) || numStr.match(/DO-(\d+)/i) || numStr.match(/(\d+)/);
      if (match && match[1]) {
        const seq = parseInt(match[1], 10);
        if (!isNaN(seq) && seq > maxSeq) {
          maxSeq = seq;
        }
      }
    });

    const nextSeq = maxSeq + 1;
    const seqStr = String(nextSeq).padStart(5, "0");
    return `DO-${currentYear}-${seqStr}`;
  };

  const handleOpenCreate = () => {
    const newDoNum = getNextDispatchNumber(orders);
    setDispatchNumber(newDoNum);
    setAutosaveStatus("Draft Autosaved");
    setDispatchDate(dateOnly(new Date().toISOString()));
    setIsStockReserved(false);
    setSelectedSo("");
    setOrderNumber("");
    setCustomerName("");
    setCustomerAddress("");
    setDestination("");
    setExpectedDeliveryDate("");
    setFormItems([]);
    setIsCreateOpen(true);
  };

  const handleSalesOrderSelect = (soNum: string) => {
    setSelectedSo(soNum);
    const found = salesOrders.find((so) => so.order_number === soNum);
    if (found) {
      setOrderNumber(found.order_number);
      setCustomerName(found.customer_name);
      setCustomerAddress(found.customer_address);
      setDestination(found.destination);
      setDispatchDate(dateOnly(found.dispatch_date));
      setExpectedDeliveryDate(dateOnly(found.expected_delivery_date));
      setContactPerson(found.contact_person);
      setContactPhone(found.contact_phone);
      setDeliveryInstructions(found.delivery_instructions);
      setRemarks(found.notes);
      setFormItems(found.items.map((i) => ({ ...i })));
      setIsStockReserved(false);
      toast.success("Finished goods retrieved", {
        description: `Loaded ${found.items.length} items from ${soNum}`,
      });
    }
  };

  const [fgInventory, setFgInventory] = useState<any[]>([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [res, balances, warehouses, putawayTasks, assemblyFinishedGoods, driverList, vehicleList] =
        await Promise.all([
          api.getDispatches().catch(() => ({ items: [], total: 0 })),
          api.getInventoryLocationBalances().catch(() => []),
          api.getWarehouses().catch(() => []),
          api.getPutawayTasks().catch(() => []),
          api.getAssemblyFinishedGoods().catch(() => []),
          api.getDrivers().catch(() => []),
          api.getVehicles().catch(() => []),
        ]);

      setOrders(res.items || []);
      setDrivers(Array.isArray(driverList) ? driverList : []);
      setVehicles(Array.isArray(vehicleList) ? vehicleList : []);

      const fgWarehouse = (warehouses || []).find(
        (s: any) =>
          String(s.warehouse_type || "").toUpperCase() === "FINISHED_GOODS" ||
          String(s.warehouse_name || "")
            .toUpperCase()
            .includes("FINISHED GOODS"),
      );

      const fgBalances = (balances || []).filter((b: any) =>
        fgWarehouse
          ? b.warehouse_ref_id === fgWarehouse.id || b.warehouse_code === fgWarehouse.warehouse_code
          : String(b.location_code || b.zone_code || "")
              .toUpperCase()
              .includes("FG"),
      );

      const assemblyStock = (assemblyFinishedGoods || [])
        .filter((fg: any) =>
          ["AVAILABLE", "QC_CERTIFIED", "READY"].includes(String(fg.status || "").toUpperCase()),
        )
        .map((fg: any) => ({
          material_code: fg.product_code,
          material_name: fg.product_name,
          uom: fg.uom || "PCS",
          batch: fg.batch_number || fg.batch_id || fg.serial_number || fg.qr_code,
          bin: fg.location_code,
          quantity_available: Number(fg.quantity || 0),
        }));
      setFgInventory(assemblyStock);

      const requestOrders = ([] as any[])
        .filter((request) => String(request.status || "").toUpperCase() === "CONFIRMED")
        .map((request) => {
          const orderItems = Array.isArray(request.items) ? request.items : [];
          return {
            order_number: request.order_number,
            customer_name: request.customer_name,
            customer_address: request.customer_address || request.delivery_address || "",
            destination: request.destination || request.delivery_address || "",
            dispatch_date: request.order_date || new Date().toISOString(),
            expected_delivery_date: request.expected_delivery_date || "",
            contact_person: request.contact_person || "",
            contact_phone: request.phone || request.contact_phone || "",
            delivery_instructions: "Finished goods requested for assembly",
            notes: request.remarks || `Customer Order ${request.order_number}`,
            items: orderItems.map((orderItem: any) => {
              const code = String(orderItem.product_code || "").toUpperCase();
              const name = String(orderItem.product_name || "").toUpperCase();
              const stocks = assemblyStock.filter(
                (b: any) =>
                  String(b.material_code || "").toUpperCase() === code ||
                  String(b.material_name || "").toUpperCase() === name,
              );
              const available = stocks.reduce(
                (sum: number, b: any) => sum + Number(b.quantity_available || 0),
                0,
              );
              const first = stocks[0] || {};
              const remaining = Number(orderItem.remaining_quantity || 0);
              return {
                material_code: orderItem.product_code,
                material_name: orderItem.product_name,
                uom: orderItem.uom || "PCS",
                batch: first.batch || null,
                bin: first.bin || null,
                quantity_ordered: remaining,
                quantity_available: available,
                dispatch_qty: Math.min(remaining, available),
              };
            }),
          };
        });

      setSalesOrders(requestOrders);
    } catch (e) {
      toast.error("Failed to load dispatch orders", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const updateAssignmentDraft = (id: string, field: "driverId" | "vehicleId", value: string) => {
    setAssignmentDrafts((current) => ({
      ...current,
      [id]: { driverId: current[id]?.driverId || "", vehicleId: current[id]?.vehicleId || "", [field]: value },
    }));
  };

  const handleAssignTransport = async (order: any) => {
    const draft = assignmentDrafts[order.id] || { driverId: "", vehicleId: "" };
    if (!draft.driverId || !draft.vehicleId) {
      toast.error("Select both a driver and vehicle before loading");
      return;
    }
    try {
      const [withDriver] = await Promise.all([
        api.allocateDispatchDriver(order.id, draft.driverId),
        api.allocateDispatchVehicle(order.id, draft.vehicleId),
      ]);
      const vehicle = vehicles.find((item) => String(item.id) === draft.vehicleId);
      const driver = drivers.find((item) => String(item.id) === draft.driverId);
      setOrders((current) =>
        current.map((item) =>
          item.id === order.id
            ? { ...item, ...(withDriver || {}), driver_id: draft.driverId, vehicle_id: draft.vehicleId, driver_name: driver?.name || driver?.driver_name, vehicle_number: vehicle?.registration_number || vehicle?.vehicle_number }
            : item,
        ),
      );
      toast.success("Driver and vehicle assigned");
    } catch (err) {
      toast.error("Unable to assign driver and vehicle", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const hasInsufficientStock = formItems.some(
    (item) =>
      Number(item.dispatch_qty || item.quantity_ordered || 0) >
      Number(item.quantity_available || 0),
  );
  const hasQuantityOverOrder = formItems.some(
    (item) => Number(item.dispatch_qty || 0) > Number(item.quantity_ordered || 0),
  );

  const handleReserveAllStock = () => {
    if (!selectedSo || !formItems.length) {
      toast.error(
        "Select a customer order and Assembly finished goods before creating the dispatch",
      );
      return;
    }
    if (formItems.some((item) => !item.bin)) {
      toast.error("Assembly storage location is missing for one or more finished-goods items");
      return;
    }
    if (hasInsufficientStock) {
      toast.error("Insufficient Stock", {
        description: "Cannot reserve stock. Dispatch quantity exceeds available stock.",
      });
      return;
    }
    setIsStockReserved(true);
    setAutosaveStatus("Stock Reserved");
    toast.success("Stock reserved successfully for all items", {
      description: "Available stock locked. Ready to create dispatch.",
    });
  };

  const handleAutosaveDraft = () => {
    const timeStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setAutosaveStatus(`Draft Saved (${timeStr})`);
    toast.success("Dispatch draft autosaved successfully");
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formItems.length || formItems.some((item) => parsePositiveNumber(item.dispatch_qty ?? item.quantity_ordered) === null)) {
      toast.error("Every dispatch line must have a positive quantity");
      return;
    }
    if (!isValidDateInput(dispatchDate) || (expectedDeliveryDate && !isValidDateInput(expectedDeliveryDate))) {
      toast.error("Enter valid dispatch and delivery dates");
      return;
    }
    if (hasInsufficientStock || hasQuantityOverOrder) {
      toast.error("Insufficient Stock Error", {
        description: hasQuantityOverOrder
          ? "Dispatch quantity exceeds the sales order's outstanding quantity."
          : "Dispatch quantity exceeds available Assembly FG stock.",
      });
      return;
    }

    try {
      const payload = {
        dispatch_number: dispatchNumber,
        order_number: orderNumber || selectedSo || "SO-2026-00521",
        customer_name: customerName,
        warehouse_id: formItems[0].bin,
        delivery_address: customerAddress,
        destination: destination,
        scheduled_date: new Date(dispatchDate).toISOString(),
        expected_delivery_date: expectedDeliveryDate
          ? new Date(expectedDeliveryDate).toISOString()
          : null,
        contact_person: contactPerson,
        contact_phone: contactPhone,
        delivery_instructions: deliveryInstructions,
        notes: remarks,
        items: formItems.map((item) => ({
          material_code: item.material_code,
          material_name: item.material_name,
          quantity_ordered: Number(item.dispatch_qty || item.quantity_ordered || 0),
          quantity_available: Number(item.quantity_available || 0),
          quantity_reserved: 0,
          quantity_picked: 0,
          quantity_packed: 0,
          quantity_loaded: 0,
          quantity_pending: Number(item.dispatch_qty || item.quantity_ordered || 0),
          uom: item.uom || "PCS",
          batch: item.batch || "BATCH-01",
          bin: item.bin || "A-01-01",
        })),
      };

      await api.createDispatch(payload);
      toast.success("Dispatch order created successfully", {
        description: `Dispatch No: ${dispatchNumber}`,
      });
      setIsCreateOpen(false);
      void loadData();
    } catch (err) {
      toast.error("Failed to create order", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const handleReserve = async (id: string) => {
    try {
      await api.reserveDispatchStock(id);
      toast.success("Stock reserved successfully");
      void loadData();
    } catch (err) {
      toast.error("Failed to reserve stock", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const handleStartPicking = async (id: string) => {
    try {
      await api.startDispatchPicking(id);
      toast.success("Picking workflow initiated");
      void loadData();
    } catch (err) {
      toast.error("Failed to start picking", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await api.cancelDispatch(id);
      toast.success("Dispatch order cancelled");
      void loadData();
    } catch (err) {
      toast.error("Failed to cancel order", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const handleClearFilters = () => {
    setSearchQuery("");
    setStatusFilter("");
    setPriorityFilter("");
    setWarehouseFilter("");
    setDriverFilter("");
    toast.info("Filters cleared");
  };

  // Section 6 Calculations
  const totalItemsCount = formItems.reduce(
    (acc, item) => acc + Number(item.dispatch_qty || item.quantity_ordered || 0),
    0,
  );
  const packageValues = formItems.map(
    (item) => item.package_count ?? item.packages_count ?? item.packages,
  );
  const totalPackagesCount = packageValues.every((value) => Number.isFinite(Number(value)))
    ? packageValues.reduce((sum, value) => sum + Number(value), 0)
    : null;
  const netWeightValues = formItems.map((item) => item.net_weight_kg ?? item.net_weight);
  const netWeightKg = netWeightValues.every((value) => Number.isFinite(Number(value)))
    ? Number(netWeightValues.reduce((sum, value) => sum + Number(value), 0).toFixed(2))
    : null;
  const grossWeightValues = formItems.map((item) => item.gross_weight_kg ?? item.gross_weight);
  const grossWeightKg = grossWeightValues.every((value) => Number.isFinite(Number(value)))
    ? Number(grossWeightValues.reduce((sum, value) => sum + Number(value), 0).toFixed(2))
    : null;
  const volumeValues = formItems.map((item) => item.volume_cbm ?? item.volume);
  const volumeCbm = volumeValues.every((value) => Number.isFinite(Number(value)))
    ? Number(volumeValues.reduce((sum, value) => sum + Number(value), 0).toFixed(2))
    : null;

  const filteredOrders = orders.filter((order) => {
    const matchesSearch =
      !searchQuery ||
      order.dispatch_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.order_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.customer_name?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus =
      !statusFilter ||
      order.status?.toLowerCase() === statusFilter.toLowerCase().replace(/\s+/g, "_");
    const matchesPriority =
      !priorityFilter || order.priority?.toLowerCase() === priorityFilter.toLowerCase();
    const matchesWarehouse =
      true;
    const matchesDriver =
      !driverFilter ||
      order.driver_id?.toLowerCase().includes(driverFilter.toLowerCase()) ||
      order.driver_name?.toLowerCase().includes(driverFilter.toLowerCase());

    return matchesSearch && matchesStatus && matchesPriority && matchesWarehouse && matchesDriver;
  });

  return (
    <AppShell
      title="Dispatch Orders Management"
      subtitle="Advanced filtering, stock reservation, and outbound finished goods order management"
      actions={
        <div className="flex items-center gap-2">
          <Button data-refresh-control="true" size="icon" aria-label="Refresh" title="Refresh" variant="outline" className="rounded-xl" onClick={() => void loadData()}>
            <RefreshCw className="size-4" /></Button>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="rounded-xl shadow-glow" onClick={handleOpenCreate}>
                <Plus className="size-4 mr-2" /> Create Dispatch
              </Button>
            </DialogTrigger>
            <DialogContent className="rounded-2xl max-w-5xl max-h-[92vh] overflow-y-auto">
              <DialogHeader>
                <div className="flex items-center justify-between border-b pb-3 pr-8">
                  <div>
                    <DialogTitle className="text-xl font-bold tracking-tight">
                      CREATE FINISHED GOODS DISPATCH ORDER
                    </DialogTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Enterprise outbound fulfillment & multi-section dispatch intake
                    </p>
                  </div>
                  <div className="text-right flex items-center gap-3">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-muted-foreground block">
                        Dispatch No
                      </span>
                      <span className="inline-flex items-center rounded-lg bg-primary/10 px-3 py-1 text-sm font-bold text-primary font-mono">
                        {dispatchNumber}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold text-muted-foreground block">
                        Status
                      </span>
                      <span className="inline-flex items-center rounded-lg bg-emerald-500/10 px-2.5 py-1 text-xs font-bold text-emerald-600 font-mono shadow-sm">
                        {autosaveStatus}
                      </span>
                    </div>
                  </div>
                </div>
              </DialogHeader>

              <form onSubmit={handleCreate} className="space-y-3 mt-3 text-sm">
                {/* 1. DISPATCH INFORMATION */}
                <div className="p-4 rounded-2xl border bg-muted/20 space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                    <span className="grid size-5 place-items-center rounded-full bg-primary text-primary-foreground text-[10px]">
                      1
                    </span>
                    Order Details
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <Label className="text-xs font-semibold uppercase text-muted-foreground">
                        Sales Order *
                      </Label>
                      <select
                        value={selectedSo}
                        onChange={(e) => handleSalesOrderSelect(e.target.value)}
                        className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2 text-xs shadow-sm font-semibold text-primary"
                      >
                        <option value="">
                          {salesOrders.length
                            ? "-- Select Sales Order --"
                            : "No eligible sales orders available"}
                        </option>
                        {salesOrders.map((so) => (
                          <option key={so.order_number} value={so.order_number}>
                            {so.order_number} - {so.customer_name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs font-semibold uppercase text-muted-foreground">
                        Customer
                      </Label>
                      <Input
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        placeholder="Selected from sales order"
                        readOnly
                        className="mt-1.5 rounded-xl text-xs font-semibold"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
                    <div>
                      <Label className="text-xs font-semibold uppercase text-muted-foreground">
                        Dispatch Date
                      </Label>
                      <Input
                        type="date"
                        value={dispatchDate}
                        onChange={(e) => setDispatchDate(e.target.value)}
                        className="mt-1.5 rounded-xl font-mono text-xs"
                      />
                    </div>
                    <div>
                      <Label className="text-xs font-semibold uppercase text-muted-foreground">
                        Expected Delivery
                      </Label>
                      <Input
                        type="date"
                        value={expectedDeliveryDate}
                        onChange={(e) => setExpectedDeliveryDate(e.target.value)}
                        className="mt-1.5 rounded-xl font-mono text-xs"
                      />
                    </div>
                  </div>
                </div>

                {/* 3. DELIVERY DETAILS */}
                <div className="p-3 rounded-2xl border bg-muted/20 space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-primary">
                    Delivery Details
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <Input
                      value={customerAddress}
                      onChange={(e) => setCustomerAddress(e.target.value)}
                      placeholder="Customer address"
                      className="rounded-xl text-xs"
                    />
                    <Input
                      value={destination}
                      onChange={(e) => setDestination(e.target.value)}
                      placeholder="Destination"
                      className="rounded-xl text-xs"
                    />
                    <Input
                      value={contactPerson}
                      onChange={(e) => setContactPerson(e.target.value)}
                      placeholder="Contact person"
                      className="rounded-xl text-xs"
                    />
                    <Input
                      value={contactPhone}
                      onChange={(e) => setContactPhone(e.target.value)}
                      placeholder="Contact phone"
                      className="rounded-xl text-xs font-mono"
                    />
                  </div>
                </div>

                {false && (
                  <>
                    {/* 2. DELIVERY INFORMATION */}
                    <div className="p-4 rounded-2xl border bg-muted/20 space-y-4">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                        <span className="grid size-5 place-items-center rounded-full bg-primary text-primary-foreground text-[10px]">
                          2
                        </span>
                        Delivery Information
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <Label className="text-xs font-semibold uppercase text-muted-foreground">
                            Customer Address
                          </Label>
                          <Input
                            value={customerAddress}
                            onChange={(e) => setCustomerAddress(e.target.value)}
                            placeholder="Industrial Suburb, Rajajinagar, Bangalore, KA"
                            className="mt-1.5 rounded-xl text-xs"
                          />
                        </div>
                        <div>
                          <Label className="text-xs font-semibold uppercase text-muted-foreground">
                            Destination
                          </Label>
                          <Input
                            value={destination}
                            onChange={(e) => setDestination(e.target.value)}
                            placeholder="Mysore"
                            required
                            className="mt-1.5 rounded-xl text-xs font-semibold"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
                        <div>
                          <Label className="text-xs font-semibold uppercase text-muted-foreground">
                            Contact Person
                          </Label>
                          <Input
                            value={contactPerson}
                            onChange={(e) => setContactPerson(e.target.value)}
                            placeholder="Ramesh Rao"
                            className="mt-1.5 rounded-xl text-xs"
                          />
                        </div>
                        <div>
                          <Label className="text-xs font-semibold uppercase text-muted-foreground">
                            Contact Phone
                          </Label>
                          <Input
                            value={contactPhone}
                            onChange={(e) => setContactPhone(e.target.value)}
                            placeholder="+91 9812345678"
                            className="mt-1.5 rounded-xl text-xs font-mono"
                          />
                        </div>
                        <div>
                          <Label className="text-xs font-semibold uppercase text-muted-foreground">
                            Delivery Instructions
                          </Label>
                          <Input
                            value={deliveryInstructions}
                            onChange={(e) => setDeliveryInstructions(e.target.value)}
                            placeholder="Handle fragile automotive parts with care"
                            className="mt-1.5 rounded-xl text-xs"
                          />
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {false && (
                  <>
                    {/* 3. TRANSPORT INFORMATION */}
                    <div className="p-4 rounded-2xl border bg-muted/20 space-y-4">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                        <span className="grid size-5 place-items-center rounded-full bg-primary text-primary-foreground text-[10px]">
                          3
                        </span>
                        Transport Information
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                          <Label className="text-xs font-semibold uppercase text-muted-foreground">
                            Transport Mode
                          </Label>
                          <select
                            value={transportMode}
                            onChange={(e) => setTransportMode(e.target.value)}
                            className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2 text-xs shadow-sm font-semibold"
                          >
                            <option value="Vehicle">Vehicle / Truck</option>
                            <option value="Rail">Rail Freight</option>
                            <option value="Air">Air Cargo</option>
                            <option value="Sea">Sea Freight</option>
                          </select>
                        </div>
                        <div>
                          <Label className="text-xs font-semibold uppercase text-muted-foreground">
                            Transport Type
                          </Label>
                          <select
                            value={transportType}
                            onChange={(e) => setTransportType(e.target.value)}
                            className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2 text-xs shadow-sm font-semibold"
                          >
                            <option value="Full Truckload">Full Truckload (FTL)</option>
                            <option value="Part Truckload">Part Truckload (PTL)</option>
                            <option value="Container">Container</option>
                          </select>
                        </div>
                        <div>
                          <Label className="text-xs font-semibold uppercase text-muted-foreground">
                            Transporter / Logistics Provider
                          </Label>
                          <Input
                            value={transporter}
                            onChange={(e) => setTransporter(e.target.value)}
                            placeholder="VRL Logistics"
                            className="mt-1.5 rounded-xl text-xs font-semibold"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                        <div className="p-3 rounded-xl bg-card border flex items-center justify-between text-xs">
                          <div>
                            <span className="text-muted-foreground block">Assigned Driver:</span>
                            <strong className="text-amber-600 font-semibold">Not Assigned</strong>
                          </div>
                          <span className="text-[11px] text-muted-foreground">
                            Allocate via Driver Portal
                          </span>
                        </div>
                        <div className="p-3 rounded-xl bg-card border flex items-center justify-between text-xs">
                          <div>
                            <span className="text-muted-foreground block">Assigned Vehicle:</span>
                            <strong className="text-amber-600 font-semibold">Not Assigned</strong>
                          </div>
                          <span className="text-[11px] text-muted-foreground">
                            Allocate via Vehicle Portal
                          </span>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {/* 4. FINISHED GOODS SELECTION & STOCK CHECK */}
                <div className="p-4 rounded-2xl border bg-muted/20 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                      <span className="grid size-5 place-items-center rounded-full bg-primary text-primary-foreground text-[10px]">
                        2
                      </span>
                      Assembly Finished Goods & Stock Check
                    </h3>
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <Search className="absolute left-3 top-2.5 size-3.5 text-muted-foreground" />
                        <Input
                          placeholder="Search Product..."
                          value={productSearch}
                          onChange={(e) => setProductSearch(e.target.value)}
                          className="pl-8 rounded-xl text-xs h-8 w-48"
                        />
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="rounded-xl text-xs h-8"
                        onClick={() => {
                          const unadded = fgInventory.find(
                            (b) =>
                              !formItems.some(
                                (i) => i.material_code === (b.material_code || b.item_code),
                              ),
                          );
                          if (unadded) {
                            const avail = Number(
                              unadded.available_quantity ?? unadded.quantity ?? 100,
                            );
                            setFormItems([
                              ...formItems,
                              {
                                material_code:
                                  unadded.material_code ||
                                  unadded.item_code ||
                                  `FG-00${formItems.length + 1}`,
                                material_name: unadded.material_name || "Finished Good",
                                uom: unadded.uom || "PCS",
                                batch: unadded.batch_number || unadded.batch || null,
                                bin: unadded.bin_code || unadded.location_code || null,
                                quantity_ordered: Math.min(50, avail || 50),
                                quantity_available: avail || 100,
                                dispatch_qty: Math.min(50, avail || 50),
                              },
                            ]);
                            toast.success("Finished good added from FG Warehouse", {
                              description: `${unadded.material_name || unadded.material_code}`,
                            });
                          } else {
                            toast.info("No QC-approved Assembly finished goods available");
                          }
                        }}
                      >
                        <Plus className="size-3.5 mr-1" /> Add Item
                      </Button>
                    </div>
                  </div>

                  <div className="border rounded-xl overflow-x-auto bg-card shadow-sm">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-muted/50 uppercase text-[10px] text-muted-foreground font-bold border-b">
                        <tr>
                          <th className="px-3 py-2.5">Product</th>
                          <th className="px-3 py-2.5">UOM</th>
                          <th className="px-3 py-2.5">Batch</th>
                          <th className="px-3 py-2.5">Bin</th>
                          <th className="px-3 py-2.5 text-right">Ordered</th>
                          <th className="px-3 py-2.5 text-right">Available</th>
                          <th className="px-3 py-2.5 text-right">Dispatch Qty</th>
                          <th className="px-3 py-2.5 text-center">Stock Check</th>
                          <th className="px-3 py-2.5 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {formItems.filter(
                          (item) =>
                            !productSearch ||
                            item.material_code
                              .toLowerCase()
                              .includes(productSearch.toLowerCase()) ||
                            item.material_name.toLowerCase().includes(productSearch.toLowerCase()),
                        ).length === 0 ? (
                          <tr>
                            <td colSpan={9} className="text-center py-8 text-muted-foreground">
                              No finished goods match your product search.
                            </td>
                          </tr>
                        ) : (
                          formItems
                            .filter(
                              (item) =>
                                !productSearch ||
                                item.material_code
                                  .toLowerCase()
                                  .includes(productSearch.toLowerCase()) ||
                                item.material_name
                                  .toLowerCase()
                                  .includes(productSearch.toLowerCase()),
                            )
                            .map((item, idx) => {
                              const dispatchQty = Number(
                                item.dispatch_qty ?? item.quantity_ordered ?? 0,
                              );
                              const availQty = Number(item.quantity_available ?? 0);
                              const isAvailable = dispatchQty <= availQty;

                              return (
                                <tr
                                  key={idx}
                                  className={`border-t transition-colors ${!isAvailable ? "bg-rose-500/10" : "hover:bg-muted/25"}`}
                                >
                                  <td className="px-3 py-3">
                                    <div className="font-mono font-bold text-primary">
                                      {item.material_code}
                                    </div>
                                    <div className="text-[11px] text-muted-foreground font-medium">
                                      {item.material_name}
                                    </div>
                                  </td>
                                  <td className="px-3 py-3 font-semibold">{item.uom || "PCS"}</td>
                                  <td className="px-3 py-3 font-mono text-xs">
                                    {item.batch || "BATCH-A1"}
                                  </td>
                                  <td className="px-3 py-3 font-mono text-xs text-blue-600 font-bold">
                                    {item.bin || "A-01-05"}
                                  </td>
                                  <td className="px-3 py-3 text-right font-mono font-semibold">
                                    {item.quantity_ordered}
                                  </td>
                                  <td className="px-3 py-3 text-right font-mono font-bold text-emerald-600">
                                    {item.quantity_available}
                                  </td>
                                  <td className="px-3 py-3 text-right">
                                    <Input
                                      type="number"
                                      value={item.dispatch_qty ?? item.quantity_ordered}
                                      max={Math.min(
                                        Number(item.quantity_available || 0),
                                        Number(item.quantity_ordered || 0),
                                      )}
                                      onChange={(e) => {
                                        const val = parseFloat(e.target.value) || 0;
                                        const updated = [...formItems];
                                        updated[idx].dispatch_qty = val;
                                        setFormItems(updated);
                                      }}
                                      className={`w-24 h-8 text-right rounded-lg font-bold ${!isAvailable ? "border-rose-500 text-rose-600 ring-rose-500" : ""}`}
                                    />
                                  </td>
                                  <td className="px-3 py-3 text-center">
                                    {isAvailable ? (
                                      <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
                                        <CheckCircle2 className="size-3" /> Available
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 rounded-lg bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold text-rose-600">
                                        <AlertTriangle className="size-3" /> Insufficient
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-3 py-3 text-center">
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 w-7 p-0 text-rose-500 hover:text-rose-700 hover:bg-rose-500/10 rounded-lg"
                                      onClick={() =>
                                        setFormItems(formItems.filter((_, i) => i !== idx))
                                      }
                                      title="Delete item"
                                    >
                                      <Trash2 className="size-3.5" />
                                    </Button>
                                  </td>
                                </tr>
                              );
                            })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {false && (
                  <>
                    {/* 5. STOCK RESERVATION */}
                    <div className="p-4 rounded-2xl border bg-muted/20 space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                          <span className="grid size-5 place-items-center rounded-full bg-primary text-primary-foreground text-[10px]">
                            5
                          </span>
                          Stock Reservation
                        </h3>
                        <Button
                          type="button"
                          size="sm"
                          className="rounded-xl text-xs font-bold shadow-glow"
                          onClick={handleReserveAllStock}
                        >
                          <ShieldCheck className="size-3.5 mr-1.5" /> Reserve All Stock
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                        <div className="p-3 rounded-xl border bg-card">
                          <span className="text-muted-foreground block text-[10px] uppercase font-bold">
                            Required
                          </span>
                          <span className="font-mono font-bold text-base text-foreground">
                            {formItems.reduce((acc, i) => acc + Number(i.quantity_ordered || 0), 0)}{" "}
                            PCS
                          </span>
                        </div>
                        <div className="p-3 rounded-xl border bg-card">
                          <span className="text-muted-foreground block text-[10px] uppercase font-bold">
                            Available in Assembly FG Area
                          </span>
                          <span className="font-mono font-bold text-base text-emerald-600">
                            {formItems.reduce(
                              (acc, i) => acc + Number(i.quantity_available || 0),
                              0,
                            )}{" "}
                            PCS
                          </span>
                        </div>
                        <div className="p-3 rounded-xl border bg-card">
                          <span className="text-muted-foreground block text-[10px] uppercase font-bold">
                            Reserved
                          </span>
                          <span className="font-mono font-bold text-base text-purple-600">
                            {isStockReserved
                              ? formItems.reduce(
                                  (acc, i) => acc + Number(i.quantity_ordered || 0),
                                  0,
                                )
                              : 0}{" "}
                            PCS
                          </span>
                        </div>
                        <div className="p-3 rounded-xl border bg-card">
                          <span className="text-muted-foreground block text-[10px] uppercase font-bold">
                            To Dispatch
                          </span>
                          <span className="font-mono font-bold text-base text-primary">
                            {formItems.reduce(
                              (acc, i) => acc + Number(i.dispatch_qty || i.quantity_ordered || 0),
                              0,
                            )}{" "}
                            PCS
                          </span>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {/* 6. DISPATCH SUMMARY */}
                <div className="p-4 rounded-2xl border bg-muted/20 space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                    <span className="grid size-5 place-items-center rounded-full bg-primary text-primary-foreground text-[10px]">
                      6
                    </span>
                    Dispatch Summary
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                    <div className="p-3 rounded-xl border bg-card">
                      <span className="text-muted-foreground block text-[10px] uppercase font-bold">
                        Total Items
                      </span>
                      <span className="font-mono font-bold text-base">{totalItemsCount} Units</span>
                    </div>
                    <div className="p-3 rounded-xl border bg-card">
                      <span className="text-muted-foreground block text-[10px] uppercase font-bold">
                        Total Packages
                      </span>
                      <span className="font-mono font-bold text-base text-blue-600">
                        {totalPackagesCount == null
                          ? "Not specified"
                          : `${totalPackagesCount} Pkgs`}
                      </span>
                    </div>
                    <div className="p-3 rounded-xl border bg-card">
                      <span className="text-muted-foreground block text-[10px] uppercase font-bold">
                        Net Weight
                      </span>
                      <span className="font-mono font-bold text-base">
                        {netWeightKg == null ? "Not specified" : `${netWeightKg.toFixed(2)} KG`}
                      </span>
                    </div>
                    <div className="p-3 rounded-xl border bg-card">
                      <span className="text-muted-foreground block text-[10px] uppercase font-bold">
                        Gross Weight
                      </span>
                      <span className="font-mono font-bold text-base text-amber-600">
                        {grossWeightKg == null ? "Not specified" : `${grossWeightKg.toFixed(2)} KG`}
                      </span>
                    </div>
                    <div className="p-3 rounded-xl border bg-card col-span-2 sm:col-span-1">
                      <span className="text-muted-foreground block text-[10px] uppercase font-bold">
                        Volume
                      </span>
                      <span className="font-mono font-bold text-base text-purple-600">
                        {volumeCbm == null ? "Not specified" : `${volumeCbm.toFixed(2)} CBM`}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 7. REMARKS */}
                <div className="p-4 rounded-2xl border bg-muted/20 space-y-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                    <span className="grid size-5 place-items-center rounded-full bg-primary text-primary-foreground text-[10px]">
                      7
                    </span>
                    Remarks & Special Instructions
                  </h3>
                  <Input
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    placeholder="Enter special handling instructions, delivery notes, etc..."
                    className="rounded-xl text-xs"
                  />
                </div>

                {/* Bottom Action Bar */}
                <div className="flex flex-wrap items-center justify-end gap-3 pt-4 border-t">
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-xl text-xs"
                    onClick={() => setIsCreateOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="rounded-xl text-xs font-semibold"
                    onClick={handleAutosaveDraft}
                  >
                    Auto Save Draft
                  </Button>
                  <Button
                    type="submit"
                    disabled={
                      hasInsufficientStock ||
                      hasQuantityOverOrder ||
                      !selectedSo ||
                      !formItems.length
                    }
                    className="rounded-xl px-6 text-xs font-bold shadow-glow disabled:opacity-50"
                  >
                    Create Dispatch
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      }
    >
      {loading ? (
        <div className="grid h-64 place-items-center">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Clean Advanced Filters Toolbar */}
          <Card className="rounded-2xl p-5 shadow-sm border-border/80 bg-card">
            <div className="flex items-center gap-2 mb-3">
              <Filter className="size-4 text-primary" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Advanced Dispatch Filters
              </h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Search */}
              <div className="relative">
                <Label className="text-[10px] font-bold uppercase text-muted-foreground mb-1 block">
                  Search
                </Label>
                <Search className="absolute left-3 top-9 size-4 text-muted-foreground" />
                <Input
                  placeholder="Dispatch / Order / Customer..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 rounded-xl text-xs h-10"
                />
              </div>

              {/* Status Filter */}
              <div>
                <Label className="text-[10px] font-bold uppercase text-muted-foreground mb-1 block">
                  Status
                </Label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2 text-xs shadow-sm focus:ring-2 focus:ring-primary font-semibold h-10"
                >
                  <option value="">All Statuses</option>
                  {STATUS_OPTIONS.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>

              {/* Priority Filter */}
              <div>
                <Label className="text-[10px] font-bold uppercase text-muted-foreground mb-1 block">
                  Priority
                </Label>
                <select
                  value={priorityFilter}
                  onChange={(e) => setPriorityFilter(e.target.value)}
                  className="w-full responsive-select bg-background px-3 py-2 text-xs shadow-sm focus:ring-2 focus:ring-primary font-semibold h-10 w-full rounded-xl border border-input"
                >
                  <option value="">All Priorities</option>
                  <option value="Normal">Normal</option>
                  <option value="High">High</option>
                  <option value="Urgent">Urgent</option>
                </select>
              </div>


            </div>

            <div className="flex items-center justify-end gap-2 mt-4 pt-3 border-t">
              <Button
                size="sm"
                variant="outline"
                className="rounded-xl text-xs"
                onClick={handleClearFilters}
              >
                <X className="size-3.5 mr-1" /> Clear
              </Button>
              <Button
                size="sm"
                className="rounded-xl text-xs font-bold shadow-glow"
                onClick={() => toast.success("Filters applied successfully")}
              >
                <Filter className="size-3.5 mr-1" /> Apply Filters
              </Button>
            </div>
          </Card>

          {/* Dispatch Orders Table */}
          <Card className="rounded-2xl overflow-hidden shadow-sm">
            <div className="p-4 border-b font-semibold flex items-center justify-between">
              <span>Filtered Dispatch Orders ({filteredOrders.length})</span>
              <span className="text-xs text-muted-foreground">
                Outbound shipments & lifecycle status
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 text-[10px] uppercase text-muted-foreground font-bold">
                  <tr>
                    <th className="px-4 py-3">Dispatch # / Order #</th>
                    <th className="px-4 py-3">Customer & Destination</th>
                    <th className="px-4 py-3">Priority</th>
                    <th className="px-4 py-3">Warehouse</th>
                    <th className="px-4 py-3">Driver / Vehicle</th>
                    <th className="px-4 py-3">Status<InformationTooltip help="workflowStatus" /></th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-12 text-muted-foreground">
                        No dispatch orders match the selected filters.
                      </td>
                    </tr>
                  ) : (
                    filteredOrders.map((order) => (
                      <tr key={order.id} className="border-t hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-bold text-primary font-mono">
                            {order.dispatch_number}
                          </div>
                          <div className="text-xs text-muted-foreground font-mono">
                            SO: {order.order_number}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-semibold">{order.customer_name}</div>
                          <div className="text-xs text-muted-foreground">
                            {order.destination || order.delivery_address || "N/A"}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center rounded-lg px-2 py-0.5 text-xs font-bold ${
                              order.priority === "Urgent"
                                ? "bg-rose-500/10 text-rose-600"
                                : order.priority === "High"
                                  ? "bg-amber-500/10 text-amber-600"
                                  : "bg-blue-500/10 text-blue-600"
                            }`}
                          >
                            {order.priority || "Normal"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs font-medium">{order.warehouse_id}</td>
                        <td className="px-4 py-3 min-w-[260px]">
                          {(() => {
                            const draft = assignmentDrafts[order.id] || {
                              driverId: String(order.driver_id || ""),
                              vehicleId: String(order.vehicle_id || ""),
                            };
                            return (
                              <div className="space-y-1.5">
                                <select
                                  value={draft.driverId}
                                  onChange={(event) =>
                                    updateAssignmentDraft(order.id, "driverId", event.target.value)
                                  }
                                  className="w-full rounded-lg border border-input bg-background px-2 py-1 text-xs"
                                >
                                  <option value="">Select driver</option>
                                  {drivers.map((driver) => (
                                    <option key={driver.id} value={driver.id}>
                                      {driver.name || driver.driver_name} ({driver.phone || driver.contact_number || "no contact"})
                                    </option>
                                  ))}
                                </select>
                                <select
                                  value={draft.vehicleId}
                                  onChange={(event) =>
                                    updateAssignmentDraft(order.id, "vehicleId", event.target.value)
                                  }
                                  className="w-full rounded-lg border border-input bg-background px-2 py-1 text-xs"
                                >
                                  <option value="">Select vehicle</option>
                                  {vehicles.map((vehicle) => (
                                    <option key={vehicle.id} value={vehicle.id}>
                                      {vehicle.registration_number || vehicle.vehicle_number || vehicle.registration_no}
                                    </option>
                                  ))}
                                </select>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 rounded-lg text-[11px]"
                                  onClick={() => void handleAssignTransport(order)}
                                >
                                  Save assignment
                                </Button>
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                            {order.status || "DRAFT"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right space-x-2">
                          {order.status === "DRAFT" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="rounded-lg text-xs"
                              onClick={() => void handleReserve(order.id)}
                            >
                              Reserve Stock
                            </Button>
                          )}
                          {order.status === "STOCK_RESERVED" && (
                            <Button
                              size="sm"
                              className="rounded-lg text-xs"
                              onClick={() => void handleStartPicking(order.id)}
                            >
                              Start Picking
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="rounded-lg text-xs text-rose-500 hover:text-rose-600"
                            onClick={() => void handleCancel(order.id)}
                          >
                            Cancel
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </AppShell>
  );
}
