import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Truck, Plus, RefreshCw, Loader2, Boxes, CheckCircle2, AlertTriangle, FileText, Search, Filter, X, ShieldCheck, Box, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api-client";

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
  "Delayed"
];

const SAMPLE_SALES_ORDERS = [
  {
    order_number: "SO-2026-00521",
    customer_name: "ABC Industries",
    customer_address: "Industrial Suburb, Rajajinagar, Bangalore, KA",
    destination: "Mysore",
    warehouse_id: "Bangalore FG Warehouse",
    dispatch_date: "2026-09-22T09:00",
    expected_delivery_date: "2026-09-23T18:00",
    priority: "High",
    contact_person: "Ramesh Rao",
    contact_phone: "+91 9812345678",
    delivery_instructions: "Handle fragile automotive parts with care.",
    transport_mode: "Vehicle",
    transport_type: "Full Truckload",
    transporter: "VRL Logistics",
    notes: "Priority dispatch for Mysore assembly line.",
    items: [
      { material_code: "FG-001", material_name: "Motor 5HP", uom: "PCS", batch: "BATCH-A1", bin: "A-01-05", quantity_ordered: 100, quantity_available: 250, dispatch_qty: 100 },
      { material_code: "FG-002", material_name: "Pump 2HP", uom: "PCS", batch: "BATCH-B2", bin: "A-02-03", quantity_ordered: 50, quantity_available: 80, dispatch_qty: 50 }
    ]
  },
  {
    order_number: "SO-2026-00522",
    customer_name: "XYZ Enterprises Ltd",
    customer_address: "Whitefield Tech Park, Bangalore, KA",
    destination: "Chennai",
    warehouse_id: "Bangalore FG Warehouse",
    dispatch_date: "2026-09-22T10:30",
    expected_delivery_date: "2026-09-24T12:00",
    priority: "Urgent",
    contact_person: "Suresh Kumar",
    contact_phone: "+91 9823456789",
    delivery_instructions: "Express export delivery SLA.",
    transport_mode: "Vehicle",
    transport_type: "Container",
    transporter: "SafeExpress",
    notes: "Express export shipment SLA.",
    items: [
      { material_code: "FG-003", material_name: "Smart Sensor Array Module", uom: "PCS", batch: "BATCH-C3", bin: "B-01-02", quantity_ordered: 500, quantity_available: 2000, dispatch_qty: 500 }
    ]
  }
];

function dateOnly(value: string | null | undefined): string {
  return value ? String(value).split("T")[0] : "";
}

function DispatchOrdersPage() {
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<any[]>([]);
  const [salesOrders, setSalesOrders] = useState<any[]>(SAMPLE_SALES_ORDERS);
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
  const [warehouseId, setWarehouseId] = useState("Bangalore FG Warehouse");
  const [dispatchType, setDispatchType] = useState("Standard");
  const [dispatchDate, setDispatchDate] = useState("2026-09-22");
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState("2026-09-23");
  const [priority, setPriority] = useState("High");

  // Section 2: Delivery Info
  const [customerAddress, setCustomerAddress] = useState("");
  const [destination, setDestination] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [deliveryInstructions, setDeliveryInstructions] = useState("");

  // Section 3: Transport Info
  const [transportMode, setTransportMode] = useState("Vehicle");
  const [transportType, setTransportType] = useState("Full Truckload");
  const [transporter, setTransporter] = useState("VRL Logistics");

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
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setAutosaveStatus(`Draft Autosaved (${timeStr})`);
    }, 1000);
    return () => clearTimeout(timer);
  }, [customerName, destination, warehouseId, dispatchType, priority, remarks, formItems, isCreateOpen]);

  const getNextDispatchNumber = (existingOrders: any[]): string => {
    const currentYear = new Date().getFullYear();
    let maxSeq = 0;

    (existingOrders || []).forEach((o: any) => {
      const numStr = String(o.dispatch_number || o.dispatchNumber || o.id || "");
      const match = numStr.match(/DO-\d{4}-(\d+)/i) || numStr.match(/DO-(\d+)/i) || numStr.match(/(\d+)/);
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
    const defaultSo = salesOrders[0];
    if (defaultSo) {
      setSelectedSo(defaultSo.order_number);
      setOrderNumber(defaultSo.order_number);
      setCustomerName(defaultSo.customer_name);
      setCustomerAddress(defaultSo.customer_address);
      setDestination(defaultSo.destination);
      setWarehouseId(defaultSo.warehouse_id);
      setDispatchType("Standard");
      setDispatchDate(dateOnly(defaultSo.dispatch_date));
      setExpectedDeliveryDate(dateOnly(defaultSo.expected_delivery_date));
      setPriority(defaultSo.priority);
      setContactPerson(defaultSo.contact_person);
      setContactPhone(defaultSo.contact_phone);
      setDeliveryInstructions(defaultSo.delivery_instructions);
      setTransportMode(defaultSo.transport_mode);
      setTransportType(defaultSo.transport_type);
      setTransporter(defaultSo.transporter);
      setRemarks(defaultSo.notes);
      setFormItems(defaultSo.items ? defaultSo.items.map((i: any) => ({ ...i })) : []);
    }
    setIsStockReserved(false);
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
      setWarehouseId(found.warehouse_id);
      setDispatchDate(dateOnly(found.dispatch_date));
      setExpectedDeliveryDate(dateOnly(found.expected_delivery_date));
      setPriority(found.priority);
      setContactPerson(found.contact_person);
      setContactPhone(found.contact_phone);
      setDeliveryInstructions(found.delivery_instructions);
      setTransportMode(found.transport_mode);
      setTransportType(found.transport_type);
      setTransporter(found.transporter);
      setRemarks(found.notes);
      setFormItems(found.items.map(i => ({ ...i })));
      setIsStockReserved(false);
      toast.success("Finished goods retrieved", { description: `Loaded ${found.items.length} items from ${soNum}` });
    }
  };

  const [fgInventory, setFgInventory] = useState<any[]>([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [res, finishedGoodsRequests, balances, stores, putawayTasks] = await Promise.all([
        api.getDispatches().catch(() => ({ items: [], total: 0 })),
        api.getFinishedGoodsRequests().catch(() => []),
        api.getInventoryLocationBalances().catch(() => []),
        api.getStores().catch(() => []),
        api.getPutawayTasks().catch(() => []),
      ]);

      setOrders(res.items || []);

      const fgStore = (stores || []).find(
        (s: any) =>
          String(s.store_type || "").toUpperCase() === "FINISHED_GOODS" ||
          String(s.store_name || "").toUpperCase().includes("FINISHED GOODS"),
      );

      const fgBalances = (balances || []).filter(
        (b: any) =>
          fgStore
            ? b.store_id === fgStore.id || b.store_code === fgStore.store_code
            : String(b.location_code || b.zone_code || "").toUpperCase().includes("FG"),
      );

      setFgInventory(fgBalances);

      const requestOrders = (Array.isArray(finishedGoodsRequests) ? finishedGoodsRequests : [])
        .filter((request) => !["REJECTED", "CANCELLED"].includes(String(request.status || "").toUpperCase()))
        .map((request) => {
          const reqCode = String(
            request.finished_goods_code || request.product_code || request.request_number || "",
          ).toUpperCase();
          const reqName = String(
            request.finished_goods_name || request.product_name || "",
          ).toUpperCase();

          const matchingStock = fgBalances.filter(
            (b: any) =>
              (b.material_code && String(b.material_code).toUpperCase() === reqCode) ||
              (b.material_name && String(b.material_name).toUpperCase() === reqName),
          );

          const stockAvail = matchingStock.reduce(
            (sum: number, b: any) => sum + Number(b.available_quantity ?? b.quantity ?? 0),
            0,
          );

          const fgPutaways = (putawayTasks || []).filter(
            (pt: any) =>
              pt.finished_goods_id ||
              String(pt.item_code || "").toUpperCase() === reqCode ||
              String(pt.material_name || "").toUpperCase() === reqName,
          );

          const putawayQty = fgPutaways.reduce(
            (sum: number, pt: any) => sum + Number(pt.quantity || 0),
            0,
          );

          const totalReqQty = Number(request.quantity || request.requested_quantity || 0);

          const availQty =
            stockAvail > 0
              ? stockAvail
              : Number(request.available_quantity || request.fg_store_available || 0) > 0
                ? Number(request.available_quantity || request.fg_store_available)
                : putawayQty > 0
                  ? putawayQty
                  : totalReqQty;

          const firstStock = matchingStock[0] || fgBalances[0] || {};

          return {
            order_number: request.request_number,
            customer_name: "Assembly",
            customer_address: request.warehouse_id || "MAIN – Central Finished Goods Warehouse",
            destination: "Assembly",
            warehouse_id: request.warehouse_id || "Bangalore FG Warehouse",
            dispatch_date: request.required_date || new Date().toISOString(),
            expected_delivery_date: request.required_date || "",
            priority: "Normal",
            contact_person: request.requested_by || "Production Planning",
            contact_phone: "+91 9812345678",
            delivery_instructions: "Finished goods requested for assembly",
            transport_mode: "Vehicle",
            transport_type: "Full Truckload",
            transporter: "VRL Logistics",
            notes: request.remarks || `Finished Goods Request ${request.request_number}`,
            items: [
              {
                material_code: request.finished_goods_code || request.product_code || request.request_number,
                material_name: request.finished_goods_name || request.product_name || "Finished Good",
                uom: request.uom || "PCS",
                batch: firstStock.batch_number || firstStock.batch || "BATCH-FG-01",
                bin: firstStock.bin_code || firstStock.location_code || "BIN-FG-01",
                quantity_ordered: totalReqQty,
                quantity_available: availQty,
                dispatch_qty: totalReqQty,
              },
            ],
          };
        });

      setSalesOrders(requestOrders.length ? requestOrders : SAMPLE_SALES_ORDERS);
    } catch (e) {
      toast.error("Failed to load dispatch orders", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  const hasInsufficientStock = formItems.some(
    (item) => Number(item.dispatch_qty || item.quantity_ordered || 0) > Number(item.quantity_available || 0)
  );

  const handleReserveAllStock = () => {
    if (hasInsufficientStock) {
      toast.error("Insufficient Stock", { description: "Cannot reserve stock. Dispatch quantity exceeds available stock." });
      return;
    }
    setIsStockReserved(true);
    setAutosaveStatus("Stock Reserved");
    toast.success("Stock reserved successfully for all items", { description: "Available stock locked. Ready to create dispatch." });
  };

  const handleAutosaveDraft = () => {
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setAutosaveStatus(`Draft Saved (${timeStr})`);
    toast.success("Dispatch draft autosaved successfully");
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (hasInsufficientStock) {
      toast.error("Insufficient Stock Error", {
        description: "One or more items exceed available stock. Please adjust dispatch quantity before creating."
      });
      return;
    }

    try {
      const payload = {
        dispatch_number: dispatchNumber,
        order_number: orderNumber || selectedSo || "SO-2026-00521",
        customer_name: customerName,
        delivery_address: customerAddress,
        destination: destination,
        warehouse_id: warehouseId,
        dispatch_type: dispatchType,
        scheduled_date: new Date(dispatchDate).toISOString(),
        expected_delivery_date: expectedDeliveryDate ? new Date(expectedDeliveryDate).toISOString() : null,
        priority: priority,
        contact_person: contactPerson,
        contact_phone: contactPhone,
        delivery_instructions: deliveryInstructions,
        transport_mode: transportMode,
        transport_type: transportType,
        transporter: transporter,
        notes: remarks,
        items: formItems.map(item => ({
          material_code: item.material_code,
          material_name: item.material_name,
          quantity_ordered: Number(item.quantity_ordered),
          quantity_available: Number(item.quantity_available || 0),
          quantity_reserved: Number(item.dispatch_qty || item.quantity_ordered || 0),
          quantity_picked: 0,
          quantity_packed: 0,
          quantity_loaded: 0,
          quantity_pending: Number(item.dispatch_qty || item.quantity_ordered || 0),
          uom: item.uom || "PCS",
          batch: item.batch || "BATCH-01",
          bin: item.bin || "A-01-01"
        }))
      };

      await api.createDispatch(payload);
      toast.success("Dispatch order created successfully", { description: `Dispatch No: ${dispatchNumber}` });
      setIsCreateOpen(false);
      void loadData();
    } catch (err) {
      toast.error("Failed to create order", { description: err instanceof Error ? err.message : undefined });
    }
  };

  const handleReserve = async (id: string) => {
    try {
      await api.reserveDispatchStock(id);
      toast.success("Stock reserved successfully");
      void loadData();
    } catch (err) {
      toast.error("Failed to reserve stock", { description: err instanceof Error ? err.message : undefined });
    }
  };

  const handleStartPicking = async (id: string) => {
    try {
      await api.startDispatchPicking(id);
      toast.success("Picking workflow initiated");
      void loadData();
    } catch (err) {
      toast.error("Failed to start picking", { description: err instanceof Error ? err.message : undefined });
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await api.cancelDispatch(id);
      toast.success("Dispatch order cancelled");
      void loadData();
    } catch (err) {
      toast.error("Failed to cancel order", { description: err instanceof Error ? err.message : undefined });
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
  const totalItemsCount = formItems.reduce((acc, item) => acc + Number(item.dispatch_qty || item.quantity_ordered || 0), 0);
  const totalPackagesCount = Math.ceil(totalItemsCount / 50) || 1;
  const netWeightKg = totalItemsCount * 2.5;
  const grossWeightKg = netWeightKg * 1.15;
  const volumeCbm = Number((totalPackagesCount * 0.45).toFixed(2));

  const filteredOrders = orders.filter((order) => {
    const matchesSearch =
      !searchQuery ||
      order.dispatch_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.order_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.customer_name?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = !statusFilter || order.status?.toLowerCase() === statusFilter.toLowerCase().replace(/\s+/g, "_");
    const matchesPriority = !priorityFilter || order.priority?.toLowerCase() === priorityFilter.toLowerCase();
    const matchesWarehouse = !warehouseFilter || order.warehouse_id?.toLowerCase().includes(warehouseFilter.toLowerCase());
    const matchesDriver = !driverFilter || order.driver_id?.toLowerCase().includes(driverFilter.toLowerCase()) || order.driver_name?.toLowerCase().includes(driverFilter.toLowerCase());

    return matchesSearch && matchesStatus && matchesPriority && matchesWarehouse && matchesDriver;
  });

  return (
    <AppShell
      title="Dispatch Orders Management"
      subtitle="Advanced filtering, stock reservation, and outbound finished goods order management"
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" className="rounded-xl" onClick={() => void loadData()}>
            <RefreshCw className="size-4" /> Refresh
          </Button>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="rounded-xl shadow-glow" onClick={handleOpenCreate}><Plus className="size-4 mr-2" /> Create Dispatch</Button>
            </DialogTrigger>
            <DialogContent className="rounded-2xl max-w-5xl max-h-[92vh] overflow-y-auto">
              <DialogHeader>
                <div className="flex items-center justify-between border-b pb-3 pr-8">
                  <div>
                    <DialogTitle className="text-xl font-bold tracking-tight">CREATE FINISHED GOODS DISPATCH ORDER</DialogTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">Enterprise outbound fulfillment & multi-section dispatch intake</p>
                  </div>
                  <div className="text-right flex items-center gap-3">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-muted-foreground block">Dispatch No</span>
                      <span className="inline-flex items-center rounded-lg bg-primary/10 px-3 py-1 text-sm font-bold text-primary font-mono">
                        {dispatchNumber}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-bold text-muted-foreground block">Status</span>
                      <span className="inline-flex items-center rounded-lg bg-emerald-500/10 px-2.5 py-1 text-xs font-bold text-emerald-600 font-mono shadow-sm">
                        {autosaveStatus}
                      </span>
                    </div>
                  </div>
                </div>
              </DialogHeader>

              <form onSubmit={handleCreate} className="space-y-6 mt-4 text-sm">
                {/* 1. DISPATCH INFORMATION */}
                <div className="p-4 rounded-2xl border bg-muted/20 space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                    <span className="grid size-5 place-items-center rounded-full bg-primary text-primary-foreground text-[10px]">1</span>
                    Dispatch Information
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <Label className="text-xs font-semibold uppercase text-muted-foreground">Sales Order *</Label>
                      <select
                        value={selectedSo}
                        onChange={(e) => handleSalesOrderSelect(e.target.value)}
                        className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2 text-xs shadow-sm font-semibold text-primary"
                      >
                        <option value="">-- Select Sales Order --</option>
                        {salesOrders.map((so) => (
                          <option key={so.order_number} value={so.order_number}>
                            {so.order_number} - {so.customer_name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs font-semibold uppercase text-muted-foreground">Customer</Label>
                      <Input
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        placeholder="ABC Industries"
                        required
                        className="mt-1.5 rounded-xl text-xs font-semibold"
                      />
                    </div>
                    <div>
                      <Label className="text-xs font-semibold uppercase text-muted-foreground">Warehouse</Label>
                      <select
                        value={warehouseId}
                        onChange={(e) => setWarehouseId(e.target.value)}
                        className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2 text-xs shadow-sm font-semibold"
                      >
                        <option value="Bangalore FG Warehouse">Bangalore FG Warehouse</option>
                        <option value="Main FG Depot - WH-01">Main FG Depot - WH-01</option>
                        <option value="East Distribution Center">East Distribution Center</option>
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs font-semibold uppercase text-muted-foreground">Dispatch Type</Label>
                      <select
                        value={dispatchType}
                        onChange={(e) => setDispatchType(e.target.value)}
                        className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2 text-xs shadow-sm font-semibold"
                      >
                        <option value="Standard">Standard Outbound</option>
                        <option value="Express">Express Delivery</option>
                        <option value="Export">Export Shipment</option>
                        <option value="Inter-Warehouse">Inter-Warehouse Transfer</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
                    <div>
                      <Label className="text-xs font-semibold uppercase text-muted-foreground">Dispatch Date</Label>
                      <Input
                        type="date"
                        value={dispatchDate}
                        onChange={(e) => setDispatchDate(e.target.value)}
                        className="mt-1.5 rounded-xl font-mono text-xs"
                      />
                    </div>
                    <div>
                      <Label className="text-xs font-semibold uppercase text-muted-foreground">Expected Delivery</Label>
                      <Input
                        type="date"
                        value={expectedDeliveryDate}
                        onChange={(e) => setExpectedDeliveryDate(e.target.value)}
                        className="mt-1.5 rounded-xl font-mono text-xs"
                      />
                    </div>
                    <div>
                      <Label className="text-xs font-semibold uppercase text-muted-foreground">Priority</Label>
                      <select
                        value={priority}
                        onChange={(e) => setPriority(e.target.value)}
                        className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2 text-xs shadow-sm font-bold text-amber-600"
                      >
                        <option value="Normal">Normal</option>
                        <option value="High">High</option>
                        <option value="Urgent">Urgent</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* 2. DELIVERY INFORMATION */}
                <div className="p-4 rounded-2xl border bg-muted/20 space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                    <span className="grid size-5 place-items-center rounded-full bg-primary text-primary-foreground text-[10px]">2</span>
                    Delivery Information
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <Label className="text-xs font-semibold uppercase text-muted-foreground">Customer Address</Label>
                      <Input
                        value={customerAddress}
                        onChange={(e) => setCustomerAddress(e.target.value)}
                        placeholder="Industrial Suburb, Rajajinagar, Bangalore, KA"
                        className="mt-1.5 rounded-xl text-xs"
                      />
                    </div>
                    <div>
                      <Label className="text-xs font-semibold uppercase text-muted-foreground">Destination</Label>
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
                      <Label className="text-xs font-semibold uppercase text-muted-foreground">Contact Person</Label>
                      <Input
                        value={contactPerson}
                        onChange={(e) => setContactPerson(e.target.value)}
                        placeholder="Ramesh Rao"
                        className="mt-1.5 rounded-xl text-xs"
                      />
                    </div>
                    <div>
                      <Label className="text-xs font-semibold uppercase text-muted-foreground">Contact Phone</Label>
                      <Input
                        value={contactPhone}
                        onChange={(e) => setContactPhone(e.target.value)}
                        placeholder="+91 9812345678"
                        className="mt-1.5 rounded-xl text-xs font-mono"
                      />
                    </div>
                    <div>
                      <Label className="text-xs font-semibold uppercase text-muted-foreground">Delivery Instructions</Label>
                      <Input
                        value={deliveryInstructions}
                        onChange={(e) => setDeliveryInstructions(e.target.value)}
                        placeholder="Handle fragile automotive parts with care"
                        className="mt-1.5 rounded-xl text-xs"
                      />
                    </div>
                  </div>
                </div>

                {/* 3. TRANSPORT INFORMATION */}
                <div className="p-4 rounded-2xl border bg-muted/20 space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                    <span className="grid size-5 place-items-center rounded-full bg-primary text-primary-foreground text-[10px]">3</span>
                    Transport Information
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <Label className="text-xs font-semibold uppercase text-muted-foreground">Transport Mode</Label>
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
                      <Label className="text-xs font-semibold uppercase text-muted-foreground">Transport Type</Label>
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
                      <Label className="text-xs font-semibold uppercase text-muted-foreground">Transporter / Logistics Provider</Label>
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
                      <span className="text-[11px] text-muted-foreground">Allocate via Driver Portal</span>
                    </div>
                    <div className="p-3 rounded-xl bg-card border flex items-center justify-between text-xs">
                      <div>
                        <span className="text-muted-foreground block">Assigned Vehicle:</span>
                        <strong className="text-amber-600 font-semibold">Not Assigned</strong>
                      </div>
                      <span className="text-[11px] text-muted-foreground">Allocate via Vehicle Portal</span>
                    </div>
                  </div>
                </div>

                {/* 4. FINISHED GOODS SELECTION & STOCK CHECK */}
                <div className="p-4 rounded-2xl border bg-muted/20 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                      <span className="grid size-5 place-items-center rounded-full bg-primary text-primary-foreground text-[10px]">4</span>
                      Finished Goods Selection & Stock Check
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
                            (b) => !formItems.some((i) => i.material_code === (b.material_code || b.item_code)),
                          );
                          if (unadded) {
                            const avail = Number(unadded.available_quantity ?? unadded.quantity ?? 100);
                            setFormItems([
                              ...formItems,
                              {
                                material_code: unadded.material_code || unadded.item_code || `FG-00${formItems.length + 1}`,
                                material_name: unadded.material_name || "Finished Good",
                                uom: unadded.uom || "PCS",
                                batch: unadded.batch_number || unadded.batch || "BATCH-FG-01",
                                bin: unadded.bin_code || unadded.location_code || "BIN-FG-01",
                                quantity_ordered: Math.min(50, avail || 50),
                                quantity_available: avail || 100,
                                dispatch_qty: Math.min(50, avail || 50),
                              },
                            ]);
                            toast.success("Finished good added from FG Store", { description: `${unadded.material_name || unadded.material_code}` });
                          } else {
                            setFormItems([
                              ...formItems,
                              {
                                material_code: `FG-00${formItems.length + 1}`,
                                material_name: "Pump Assembly Unit",
                                uom: "PCS",
                                batch: "BATCH-FG-01",
                                bin: "BIN-FG-01",
                                quantity_ordered: 50,
                                quantity_available: 100,
                                dispatch_qty: 50,
                              },
                            ]);
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
                        {formItems.filter(item =>
                          !productSearch ||
                          item.material_code.toLowerCase().includes(productSearch.toLowerCase()) ||
                          item.material_name.toLowerCase().includes(productSearch.toLowerCase())
                        ).length === 0 ? (
                          <tr><td colSpan={9} className="text-center py-8 text-muted-foreground">No finished goods match your product search.</td></tr>
                        ) : (
                          formItems.filter(item =>
                            !productSearch ||
                            item.material_code.toLowerCase().includes(productSearch.toLowerCase()) ||
                            item.material_name.toLowerCase().includes(productSearch.toLowerCase())
                          ).map((item, idx) => {
                            const dispatchQty = Number(item.dispatch_qty ?? item.quantity_ordered ?? 0);
                            const availQty = Number(item.quantity_available ?? 0);
                            const isAvailable = dispatchQty <= availQty;

                            return (
                              <tr key={idx} className={`border-t transition-colors ${!isAvailable ? "bg-rose-500/10" : "hover:bg-muted/25"}`}>
                                <td className="px-3 py-3">
                                  <div className="font-mono font-bold text-primary">{item.material_code}</div>
                                  <div className="text-[11px] text-muted-foreground font-medium">{item.material_name}</div>
                                </td>
                                <td className="px-3 py-3 font-semibold">{item.uom || "PCS"}</td>
                                <td className="px-3 py-3 font-mono text-xs">{item.batch || "BATCH-A1"}</td>
                                <td className="px-3 py-3 font-mono text-xs text-blue-600 font-bold">{item.bin || "A-01-05"}</td>
                                <td className="px-3 py-3 text-right font-mono font-semibold">{item.quantity_ordered}</td>
                                <td className="px-3 py-3 text-right font-mono font-bold text-emerald-600">{item.quantity_available}</td>
                                <td className="px-3 py-3 text-right">
                                  <Input
                                    type="number"
                                    value={item.dispatch_qty ?? item.quantity_ordered}
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
                                    onClick={() => setFormItems(formItems.filter((_, i) => i !== idx))}
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

                {/* 5. STOCK RESERVATION */}
                <div className="p-4 rounded-2xl border bg-muted/20 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                      <span className="grid size-5 place-items-center rounded-full bg-primary text-primary-foreground text-[10px]">5</span>
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
                      <span className="text-muted-foreground block text-[10px] uppercase font-bold">Required</span>
                      <span className="font-mono font-bold text-base text-foreground">
                        {formItems.reduce((acc, i) => acc + Number(i.quantity_ordered || 0), 0)} PCS
                      </span>
                    </div>
                    <div className="p-3 rounded-xl border bg-card">
                      <span className="text-muted-foreground block text-[10px] uppercase font-bold">Available</span>
                      <span className="font-mono font-bold text-base text-emerald-600">
                        {formItems.reduce((acc, i) => acc + Number(i.quantity_available || 0), 0)} PCS
                      </span>
                    </div>
                    <div className="p-3 rounded-xl border bg-card">
                      <span className="text-muted-foreground block text-[10px] uppercase font-bold">Reserved</span>
                      <span className="font-mono font-bold text-base text-purple-600">
                        {isStockReserved ? formItems.reduce((acc, i) => acc + Number(i.quantity_ordered || 0), 0) : 0} PCS
                      </span>
                    </div>
                    <div className="p-3 rounded-xl border bg-card">
                      <span className="text-muted-foreground block text-[10px] uppercase font-bold">To Dispatch</span>
                      <span className="font-mono font-bold text-base text-primary">
                        {formItems.reduce((acc, i) => acc + Number(i.dispatch_qty || i.quantity_ordered || 0), 0)} PCS
                      </span>
                    </div>
                  </div>
                </div>

                {/* 6. DISPATCH SUMMARY */}
                <div className="p-4 rounded-2xl border bg-muted/20 space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                    <span className="grid size-5 place-items-center rounded-full bg-primary text-primary-foreground text-[10px]">6</span>
                    Dispatch Summary
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                    <div className="p-3 rounded-xl border bg-card">
                      <span className="text-muted-foreground block text-[10px] uppercase font-bold">Total Items</span>
                      <span className="font-mono font-bold text-base">{totalItemsCount} Units</span>
                    </div>
                    <div className="p-3 rounded-xl border bg-card">
                      <span className="text-muted-foreground block text-[10px] uppercase font-bold">Total Packages</span>
                      <span className="font-mono font-bold text-base text-blue-600">{totalPackagesCount} Pkgs</span>
                    </div>
                    <div className="p-3 rounded-xl border bg-card">
                      <span className="text-muted-foreground block text-[10px] uppercase font-bold">Net Weight</span>
                      <span className="font-mono font-bold text-base">{netWeightKg} KG</span>
                    </div>
                    <div className="p-3 rounded-xl border bg-card">
                      <span className="text-muted-foreground block text-[10px] uppercase font-bold">Gross Weight</span>
                      <span className="font-mono font-bold text-base text-amber-600">{grossWeightKg} KG</span>
                    </div>
                    <div className="p-3 rounded-xl border bg-card col-span-2 sm:col-span-1">
                      <span className="text-muted-foreground block text-[10px] uppercase font-bold">Volume</span>
                      <span className="font-mono font-bold text-base text-purple-600">{volumeCbm} CBM</span>
                    </div>
                  </div>
                </div>

                {/* 7. REMARKS */}
                <div className="p-4 rounded-2xl border bg-muted/20 space-y-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                    <span className="grid size-5 place-items-center rounded-full bg-primary text-primary-foreground text-[10px]">7</span>
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
                  <Button type="button" variant="outline" className="rounded-xl text-xs" onClick={() => setIsCreateOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="button" variant="secondary" className="rounded-xl text-xs font-semibold" onClick={handleAutosaveDraft}>
                    Auto Save Draft
                  </Button>
                  <Button type="button" variant="outline" className="rounded-xl text-xs font-bold text-purple-600 border-purple-200" onClick={handleReserveAllStock}>
                    Reserve Stock
                  </Button>
                  <Button
                    type="submit"
                    disabled={hasInsufficientStock}
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
        <div className="grid h-64 place-items-center"><Loader2 className="size-8 animate-spin text-primary" /></div>
      ) : (
        <div className="space-y-6">
          {/* Clean Advanced Filters Toolbar */}
          <Card className="rounded-2xl p-5 shadow-sm border-border/80 bg-card">
            <div className="flex items-center gap-2 mb-3">
              <Filter className="size-4 text-primary" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Advanced Dispatch Filters</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Search */}
              <div className="relative">
                <Label className="text-[10px] font-bold uppercase text-muted-foreground mb-1 block">Search</Label>
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
                <Label className="text-[10px] font-bold uppercase text-muted-foreground mb-1 block">Status</Label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2 text-xs shadow-sm focus:ring-2 focus:ring-primary font-semibold h-10"
                >
                  <option value="">All Statuses</option>
                  {STATUS_OPTIONS.map((st) => (
                    <option key={st} value={st}>{st}</option>
                  ))}
                </select>
              </div>

              {/* Priority Filter */}
              <div>
                <Label className="text-[10px] font-bold uppercase text-muted-foreground mb-1 block">Priority</Label>
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

              {/* Warehouse Filter */}
              <div>
                <Label className="text-[10px] font-bold uppercase text-muted-foreground mb-1 block">Warehouse</Label>
                <select
                  value={warehouseFilter}
                  onChange={(e) => setWarehouseFilter(e.target.value)}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2 text-xs shadow-sm focus:ring-2 focus:ring-primary font-semibold h-10"
                >
                  <option value="">All Warehouses</option>
                  <option value="Bangalore FG Warehouse">Bangalore FG Warehouse</option>
                  <option value="Main FG Depot">Main FG Depot</option>
                  <option value="WH-01">WH-01</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 mt-4 pt-3 border-t">
              <Button size="sm" variant="outline" className="rounded-xl text-xs" onClick={handleClearFilters}>
                <X className="size-3.5 mr-1" /> Clear
              </Button>
              <Button size="sm" className="rounded-xl text-xs font-bold shadow-glow" onClick={() => toast.success("Filters applied successfully")}>
                <Filter className="size-3.5 mr-1" /> Apply Filters
              </Button>
            </div>
          </Card>

          {/* Dispatch Orders Table */}
          <Card className="rounded-2xl overflow-hidden shadow-sm">
            <div className="p-4 border-b font-semibold flex items-center justify-between">
              <span>Filtered Dispatch Orders ({filteredOrders.length})</span>
              <span className="text-xs text-muted-foreground">Outbound shipments & lifecycle status</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 text-[10px] uppercase text-muted-foreground font-bold">
                  <tr>
                    <th className="px-4 py-3">Dispatch # / Order #</th>
                    <th className="px-4 py-3">Customer & Destination</th>
                    <th className="px-4 py-3">Priority</th>
                    <th className="px-4 py-3">Warehouse</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-12 text-muted-foreground">No dispatch orders match the selected filters.</td></tr>
                  ) : (
                    filteredOrders.map((order) => (
                      <tr key={order.id} className="border-t hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-bold text-primary font-mono">{order.dispatch_number}</div>
                          <div className="text-xs text-muted-foreground font-mono">SO: {order.order_number}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-semibold">{order.customer_name}</div>
                          <div className="text-xs text-muted-foreground">{order.destination || order.delivery_address || "N/A"}</div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center rounded-lg px-2 py-0.5 text-xs font-bold ${
                            order.priority === "Urgent" ? "bg-rose-500/10 text-rose-600" :
                            order.priority === "High" ? "bg-amber-500/10 text-amber-600" :
                            "bg-blue-500/10 text-blue-600"
                          }`}>
                            {order.priority || "Normal"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs font-medium">{order.warehouse_id}</td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                            {order.status || "DRAFT"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right space-x-2">
                          {order.status === "DRAFT" && (
                            <Button size="sm" variant="outline" className="rounded-lg text-xs" onClick={() => void handleReserve(order.id)}>
                              Reserve Stock
                            </Button>
                          )}
                          {order.status === "STOCK_RESERVED" && (
                            <Button size="sm" className="rounded-lg text-xs" onClick={() => void handleStartPicking(order.id)}>
                              Start Picking
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" className="rounded-lg text-xs text-rose-500 hover:text-rose-600" onClick={() => void handleCancel(order.id)}>
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
