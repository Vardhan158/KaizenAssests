import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import {
  Boxes,
  ArrowRightLeft,
  Truck,
  AlertTriangle,
  ShieldAlert,
  Download,
  RefreshCw,
  Search,
  CheckCircle2,
  Clock,
  Archive,
  Layers,
  FileSpreadsheet,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { AppShell } from "@/components/wms/app-shell";
import { SectionCard } from "@/components/wms/primitives";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api-client";
import { toast } from "sonner";

export const Route = createFileRoute("/reports")({
  component: WarehouseReportsPage,
});

type ReportTab = "inventory" | "movement" | "putaway" | "low-stock" | "quarantine";

function WarehouseReportsPage() {
  const [activeTab, setActiveTab] = useState<ReportTab>("inventory");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter States
  const [search, setSearch] = useState("");
  const [selectedStore, setSelectedStore] = useState("ALL");
  const [selectedStatus, setSelectedStatus] = useState("ALL");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  // Data States
  const [stores, setStores] = useState<any[]>([]);
  const [inventoryData, setInventoryData] = useState<any[]>([]);
  const [movementData, setMovementData] = useState<any[]>([]);
  const [putawayData, setPutawayData] = useState<any[]>([]);
  const [quarantineData, setQuarantineData] = useState<any[]>([]);

  // Load Store options
  useEffect(() => {
    async function loadStores() {
      try {
        const storeList = await api.getStores();
        setStores(storeList || []);
      } catch (err) {
        console.warn("Could not fetch store list for reports filter", err);
      }
    }
    loadStores();
  }, []);

  // Reset page on tab or filter change
  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, search, selectedStore, selectedStatus, startDate, endDate]);

  // Fetch Report Data based on active tab
  const fetchReportData = async (isManual = false) => {
    setLoading(true);
    setError(null);
    try {
      if (activeTab === "inventory" || activeTab === "low-stock") {
        const data = await api.getWarehouseInventorySummary({
          store_id: selectedStore !== "ALL" ? selectedStore : undefined,
          search: search.trim() || undefined,
          status_filter:
            activeTab === "low-stock"
              ? "LOW_STOCK"
              : selectedStatus !== "ALL"
                ? selectedStatus
                : undefined,
        });
        setInventoryData(data || []);
      } else if (activeTab === "movement") {
        const data = await api.getStockLedger({
          store_id: selectedStore !== "ALL" ? selectedStore : undefined,
          transaction_type: selectedStatus !== "ALL" ? selectedStatus : undefined,
          search: search.trim() || undefined,
          start_date: startDate || undefined,
          end_date: endDate || undefined,
        });
        setMovementData(data || []);
      } else if (activeTab === "putaway") {
        const data = await api.getPutawayTasks(selectedStore !== "ALL" ? selectedStore : undefined);
        setPutawayData(data || []);
      } else if (activeTab === "quarantine") {
        const data = await api.getQuarantineRecords({
          status: selectedStatus !== "ALL" ? selectedStatus : undefined,
          search: search.trim() || undefined,
        });
        setQuarantineData(data || []);
      }

      if (isManual) {
        toast.success("Report data refreshed successfully");
      }
    } catch (err: any) {
      console.error("Failed to load report data:", err);
      setError(err?.message || "Failed to load report data from warehouse API.");
      toast.error("Failed to load report data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReportData();
  }, [activeTab, selectedStore, selectedStatus, startDate, endDate]);

  // Client-side filtering for Putaway (and cross-tab text searches where applicable)
  const currentFilteredRecords = useMemo(() => {
    const sTerm = search.trim().toLowerCase();

    if (activeTab === "inventory") {
      let list = inventoryData;
      if (sTerm) {
        list = list.filter(
          (r) =>
            r.material_code?.toLowerCase().includes(sTerm) ||
            r.material_name?.toLowerCase().includes(sTerm) ||
            r.store_name?.toLowerCase().includes(sTerm) ||
            r.zone_name?.toLowerCase().includes(sTerm) ||
            r.bin_code?.toLowerCase().includes(sTerm),
        );
      }
      return list;
    }

    if (activeTab === "low-stock") {
      let list = inventoryData.filter(
        (r) =>
          r.status === "LOW_STOCK" ||
          r.status === "OUT_OF_STOCK" ||
          Number(r.available_quantity) <= Number(r.reorder_point || 10),
      );
      if (sTerm) {
        list = list.filter(
          (r) =>
            r.material_code?.toLowerCase().includes(sTerm) ||
            r.material_name?.toLowerCase().includes(sTerm) ||
            r.store_name?.toLowerCase().includes(sTerm),
        );
      }
      return list;
    }

    if (activeTab === "movement") {
      let list = movementData;
      if (sTerm) {
        list = list.filter(
          (r) =>
            r.material_code?.toLowerCase().includes(sTerm) ||
            r.material_name?.toLowerCase().includes(sTerm) ||
            r.reference_number?.toLowerCase().includes(sTerm) ||
            r.performed_by?.toLowerCase().includes(sTerm) ||
            r.source?.toLowerCase().includes(sTerm) ||
            r.destination?.toLowerCase().includes(sTerm),
        );
      }
      return list;
    }

    if (activeTab === "putaway") {
      let list = putawayData;
      if (selectedStatus !== "ALL") {
        list = list.filter((p) => (p.status || "").toUpperCase() === selectedStatus.toUpperCase());
      }
      if (sTerm) {
        list = list.filter(
          (p) =>
            p.task_number?.toLowerCase().includes(sTerm) ||
            p.grn_number?.toLowerCase().includes(sTerm) ||
            p.item_code?.toLowerCase().includes(sTerm) ||
            p.material_name?.toLowerCase().includes(sTerm) ||
            p.destination_zone?.toLowerCase().includes(sTerm),
        );
      }
      if (startDate) {
        list = list.filter((p) => p.created_at && p.created_at.slice(0, 10) >= startDate);
      }
      if (endDate) {
        list = list.filter((p) => p.created_at && p.created_at.slice(0, 10) <= endDate);
      }
      return list;
    }

    if (activeTab === "quarantine") {
      let list = quarantineData;
      if (sTerm) {
        list = list.filter(
          (q) =>
            q.quarantine_number?.toLowerCase().includes(sTerm) ||
            q.item_code?.toLowerCase().includes(sTerm) ||
            q.material_name?.toLowerCase().includes(sTerm) ||
            q.supplier_name?.toLowerCase().includes(sTerm) ||
            q.reason?.toLowerCase().includes(sTerm),
        );
      }
      return list;
    }

    return [];
  }, [
    activeTab,
    inventoryData,
    movementData,
    putawayData,
    quarantineData,
    search,
    selectedStatus,
    startDate,
    endDate,
  ]);

  // Paginated Slices
  const totalPages = Math.max(1, Math.ceil(currentFilteredRecords.length / pageSize));
  const paginatedRecords = useMemo(() => {
    const startIdx = (currentPage - 1) * pageSize;
    return currentFilteredRecords.slice(startIdx, startIdx + pageSize);
  }, [currentFilteredRecords, currentPage, pageSize]);

  // CSV Export Utility
  const handleExportCSV = () => {
    if (!currentFilteredRecords.length) {
      toast.warning("No records to export.");
      return;
    }

    let headers: string[] = [];
    let rows: (string | number)[][] = [];
    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `Warehouse-Report-${activeTab}-${dateStr}.csv`;

    if (activeTab === "inventory" || activeTab === "low-stock") {
      headers = [
        "Material Code",
        "Material Name",
        "Category",
        "Warehouse",
        "Store Code",
        "Store Name",
        "Zone Code",
        "Bin Code",
        "On Hand",
        "Available",
        "Allocated",
        "Quarantined",
        "UOM",
        "Reorder Point",
        "Status",
        "Last GRN",
        "Last Updated",
      ];
      rows = currentFilteredRecords.map((r) => [
        r.material_code,
        `"${(r.material_name || "").replace(/"/g, '""')}"`,
        r.category || "GENERAL",
        r.warehouse_id || "Main Warehouse",
        r.store_code || "UNASSIGNED",
        `"${(r.store_name || "").replace(/"/g, '""')}"`,
        r.zone_code || "N/A",
        r.bin_code || "N/A",
        r.on_hand_quantity ?? r.total_quantity ?? 0,
        r.available_quantity ?? 0,
        r.allocated_quantity ?? 0,
        r.quarantined_quantity ?? 0,
        r.uom || "PCS",
        r.reorder_point ?? 10,
        r.status || "HEALTHY",
        r.last_grn_number || "N/A",
        r.updated_at ? r.updated_at.slice(0, 19).replace("T", " ") : "",
      ]);
    } else if (activeTab === "movement") {
      headers = [
        "Timestamp",
        "Transaction Type",
        "Material Code",
        "Material Name",
        "Quantity",
        "UOM",
        "Store",
        "Zone",
        "Reference Number",
        "Source",
        "Destination",
        "Stock Before",
        "Stock After",
        "Performed By",
        "Notes",
      ];
      rows = currentFilteredRecords.map((r) => [
        r.timestamp ? r.timestamp.slice(0, 19).replace("T", " ") : "",
        r.transaction_type,
        r.material_code,
        `"${(r.material_name || "").replace(/"/g, '""')}"`,
        r.quantity,
        r.uom || "PCS",
        r.store_name || r.store_code || "Dock Area",
        r.zone_name || r.zone_code || "N/A",
        r.reference_number || "",
        `"${(r.source || "").replace(/"/g, '""')}"`,
        `"${(r.destination || "").replace(/"/g, '""')}"`,
        r.stock_before ?? "",
        r.stock_after ?? "",
        `"${(r.performed_by || "").replace(/"/g, '""')}"`,
        `"${(r.notes || "").replace(/"/g, '""')}"`,
      ]);
    } else if (activeTab === "putaway") {
      headers = [
        "Task Number",
        "GRN Number",
        "Item Code",
        "Material Name",
        "Quantity",
        "UOM",
        "Source Location",
        "Destination Zone",
        "Destination Bin",
        "Status",
        "Location Assigned By",
        "Started By",
        "Completed By",
        "Created At",
      ];
      rows = currentFilteredRecords.map((r) => [
        r.task_number,
        r.grn_number,
        r.item_code,
        `"${(r.material_name || "").replace(/"/g, '""')}"`,
        r.quantity,
        r.uom || "PCS",
        r.source_location || "RECEIVING_AREA",
        r.destination_zone || "N/A",
        r.destination_bin_code || r.destination_bin || "N/A",
        r.status,
        r.location_assigned_by || "",
        r.started_by || "",
        r.completed_by || "",
        r.created_at ? r.created_at.slice(0, 19).replace("T", " ") : "",
      ]);
    } else if (activeTab === "quarantine") {
      headers = [
        "Quarantine Number",
        "Item Code",
        "Material Name",
        "Damaged Quantity",
        "UOM",
        "GRN Number",
        "PO Number",
        "Supplier",
        "Reason",
        "Status",
        "Disposition",
        "Reviewed By",
        "Reviewed At",
        "Created At",
      ];
      rows = currentFilteredRecords.map((r) => [
        r.quarantine_number,
        r.item_code,
        `"${(r.material_name || "").replace(/"/g, '""')}"`,
        r.damaged_quantity,
        r.uom || "PCS",
        r.grn_number || "N/A",
        r.po_number || "N/A",
        `"${(r.supplier_name || "").replace(/"/g, '""')}"`,
        `"${(r.reason || "").replace(/"/g, '""')}"`,
        r.status,
        r.disposition || "PENDING",
        r.reviewed_by || "",
        r.reviewed_at ? r.reviewed_at.slice(0, 19).replace("T", " ") : "",
        r.created_at ? r.created_at.slice(0, 19).replace("T", " ") : "",
      ]);
    }

    const csvContent = [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", fileName);
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      try {
        if (link.parentNode) document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } catch {}
    }, 2000);
    toast.success(`Exported ${currentFilteredRecords.length} records to ${fileName}`);
  };

  const handleClearFilters = () => {
    setSearch("");
    setSelectedStore("ALL");
    setSelectedStatus("ALL");
    setStartDate("");
    setEndDate("");
  };

  // KPI Metrics Calculation
  const kpiData = useMemo(() => {
    const totalCount = currentFilteredRecords.length;

    if (activeTab === "inventory") {
      const totalUnits = currentFilteredRecords.reduce(
        (sum, r) => sum + Number(r.on_hand_quantity || r.total_quantity || 0),
        0,
      );
      const totalAvailable = currentFilteredRecords.reduce(
        (sum, r) => sum + Number(r.available_quantity || 0),
        0,
      );
      const lowStockCount = currentFilteredRecords.filter(
        (r) => r.status === "LOW_STOCK" || r.status === "OUT_OF_STOCK",
      ).length;
      return [
        { label: "Total Tracked SKUs", value: totalCount, icon: Boxes, color: "text-primary" },
        {
          label: "Physical On Hand",
          value: totalUnits.toLocaleString(),
          icon: Layers,
          color: "text-blue-600",
        },
        {
          label: "Available Stock",
          value: totalAvailable.toLocaleString(),
          icon: CheckCircle2,
          color: "text-emerald-600",
        },
        {
          label: "Low/Out of Stock Alerts",
          value: lowStockCount,
          icon: AlertTriangle,
          color: "text-amber-600",
        },
      ];
    }

    if (activeTab === "low-stock") {
      const totalShortage = currentFilteredRecords.reduce((sum, r) => {
        const diff = Number(r.reorder_point || 10) - Number(r.available_quantity || 0);
        return sum + (diff > 0 ? diff : 0);
      }, 0);
      const zeroStock = currentFilteredRecords.filter(
        (r) => Number(r.available_quantity) === 0,
      ).length;
      return [
        {
          label: "Critical SKUs Below Threshold",
          value: totalCount,
          icon: AlertTriangle,
          color: "text-rose-600",
        },
        {
          label: "Completely Depleted (0 Qty)",
          value: zeroStock,
          icon: Archive,
          color: "text-red-700",
        },
        {
          label: "Total Replenishment Deficit",
          value: totalShortage.toLocaleString(),
          icon: Layers,
          color: "text-amber-600",
        },
      ];
    }

    if (activeTab === "movement") {
      const receipts = currentFilteredRecords.filter(
        (r) => r.transaction_type === "RECEIPT",
      ).length;
      const putaways = currentFilteredRecords.filter(
        (r) => r.transaction_type === "PUTAWAY",
      ).length;
      const issues = currentFilteredRecords.filter((r) => r.transaction_type === "ISSUE").length;
      return [
        {
          label: "Total Ledger Transactions",
          value: totalCount,
          icon: ArrowRightLeft,
          color: "text-primary",
        },
        { label: "Dock Receipts (GRN)", value: receipts, icon: Truck, color: "text-emerald-600" },
        { label: "Putaway Inbounds", value: putaways, icon: Layers, color: "text-blue-600" },
        { label: "Assembly Issues", value: issues, icon: Boxes, color: "text-purple-600" },
      ];
    }

    if (activeTab === "putaway") {
      const completed = currentFilteredRecords.filter(
        (p) => p.status === "PUTAWAY_COMPLETED",
      ).length;
      const inProgress = currentFilteredRecords.filter(
        (p) => p.status === "PUTAWAY_IN_PROGRESS",
      ).length;
      const pending = currentFilteredRecords.filter((p) =>
        ["PUTAWAY_PENDING", "PENDING", "ASSIGNED_TO_STORE"].includes(p.status),
      ).length;
      return [
        { label: "Total Putaway Tasks", value: totalCount, icon: Truck, color: "text-primary" },
        {
          label: "Completed Putaways",
          value: completed,
          icon: CheckCircle2,
          color: "text-emerald-600",
        },
        { label: "In-Progress Tasks", value: inProgress, icon: Clock, color: "text-blue-600" },
        {
          label: "Pending Assignment/Placement",
          value: pending,
          icon: AlertTriangle,
          color: "text-amber-600",
        },
      ];
    }

    if (activeTab === "quarantine") {
      const totalDamaged = currentFilteredRecords.reduce(
        (sum, q) => sum + Number(q.damaged_quantity || 0),
        0,
      );
      const pendingReview = currentFilteredRecords.filter(
        (q) => q.status === "PENDING_REVIEW" || q.status === "QUARANTINED",
      ).length;
      const scrapped = currentFilteredRecords.filter((q) => q.status === "SCRAPPED").length;
      return [
        {
          label: "Total Quarantine Incidents",
          value: totalCount,
          icon: ShieldAlert,
          color: "text-rose-600",
        },
        {
          label: "Total Quarantined Units",
          value: totalDamaged.toLocaleString(),
          icon: AlertTriangle,
          color: "text-amber-600",
        },
        { label: "Pending QC Review", value: pendingReview, icon: Clock, color: "text-blue-600" },
        { label: "Scrapped / Disposed", value: scrapped, icon: Archive, color: "text-neutral-600" },
      ];
    }

    return [];
  }, [activeTab, currentFilteredRecords]);

  return (
    <AppShell
      title="Warehouse Reports"
      subtitle="Audit-ready operational reports, stock movements, putaway performance, and quality logs"
    >
      <div className="space-y-6">
        {/* Navigation Tabs */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border/70 pb-3">
          <Button
            variant={activeTab === "inventory" ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setActiveTab("inventory");
              handleClearFilters();
            }}
            className="h-9 gap-2 text-xs font-semibold rounded-lg"
          >
            <Boxes className="size-4" />
            Inventory Balance
          </Button>
          <Button
            variant={activeTab === "movement" ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setActiveTab("movement");
              handleClearFilters();
            }}
            className="h-9 gap-2 text-xs font-semibold rounded-lg"
          >
            <ArrowRightLeft className="size-4" />
            Stock Movement Ledger
          </Button>
          <Button
            variant={activeTab === "putaway" ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setActiveTab("putaway");
              handleClearFilters();
            }}
            className="h-9 gap-2 text-xs font-semibold rounded-lg"
          >
            <Truck className="size-4" />
            Putaway Operations
          </Button>
          <Button
            variant={activeTab === "low-stock" ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setActiveTab("low-stock");
              handleClearFilters();
            }}
            className="h-9 gap-2 text-xs font-semibold rounded-lg"
          >
            <AlertTriangle className="size-4 text-amber-500" />
            Low Stock Alerts
          </Button>
          <Button
            variant={activeTab === "quarantine" ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setActiveTab("quarantine");
              handleClearFilters();
            }}
            className="h-9 gap-2 text-xs font-semibold rounded-lg"
          >
            <ShieldAlert className="size-4 text-rose-500" />
            Quarantine & Quality Logs
          </Button>
        </div>

        {/* KPI Metric Summary Badges */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {kpiData.map((kpi, idx) => {
            const Icon = kpi.icon;
            return (
              <Card key={idx} className="border-border/60 bg-card shadow-xs">
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                      {kpi.label}
                    </p>
                    <p className="text-xl font-bold mt-1 text-foreground">{kpi.value}</p>
                  </div>
                  <div className={`p-2.5 rounded-xl bg-muted/40 ${kpi.color}`}>
                    <Icon className="size-5" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Filter Toolbar */}
        <Card className="border-border/60 bg-card">
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              {/* Search Bar */}
              <div className="relative flex-1 min-w-[220px]">
                <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                <Input
                  placeholder={
                    activeTab === "movement"
                      ? "Search material, reference, operator..."
                      : activeTab === "putaway"
                        ? "Search task #, GRN #, material..."
                        : "Search material code, name, location..."
                  }
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 h-9 text-xs"
                />
              </div>

              {/* Store Filter (For relevant reports) */}
              {(activeTab === "inventory" ||
                activeTab === "movement" ||
                activeTab === "putaway" ||
                activeTab === "low-stock") && (
                <Select value={selectedStore} onValueChange={setSelectedStore}>
                  <SelectTrigger className="w-[180px] h-9 text-xs">
                    <SelectValue placeholder="All Stores" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Stores</SelectItem>
                    {stores.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.store_name} ({s.store_code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {/* Status / Transaction Type Filter */}
              {activeTab === "inventory" && (
                <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                  <SelectTrigger className="w-[160px] h-9 text-xs">
                    <SelectValue placeholder="Stock Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Stock Statuses</SelectItem>
                    <SelectItem value="HEALTHY">Healthy</SelectItem>
                    <SelectItem value="LOW_STOCK">Low Stock</SelectItem>
                    <SelectItem value="OUT_OF_STOCK">Out of Stock</SelectItem>
                    <SelectItem value="ALLOCATED">Allocated</SelectItem>
                  </SelectContent>
                </Select>
              )}

              {activeTab === "movement" && (
                <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                  <SelectTrigger className="w-[180px] h-9 text-xs">
                    <SelectValue placeholder="Movement Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Movement Types</SelectItem>
                    <SelectItem value="RECEIPT">Receipt (GRN Posting)</SelectItem>
                    <SelectItem value="PUTAWAY">Putaway (Store Inbound)</SelectItem>
                    <SelectItem value="ISSUE">Issue (Assembly Requisition)</SelectItem>
                    <SelectItem value="QUARANTINE">Quarantine Hold</SelectItem>
                    <SelectItem value="SCRAP">Scrap / Disposal</SelectItem>
                    <SelectItem value="ACCEPTED_WITH_DEVIATION">Accepted with Deviation</SelectItem>
                  </SelectContent>
                </Select>
              )}

              {activeTab === "putaway" && (
                <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                  <SelectTrigger className="w-[180px] h-9 text-xs">
                    <SelectValue placeholder="Putaway Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Statuses</SelectItem>
                    <SelectItem value="PUTAWAY_PENDING">Pending Assignment</SelectItem>
                    <SelectItem value="ASSIGNED_TO_STORE">Assigned to Store</SelectItem>
                    <SelectItem value="PUTAWAY_IN_PROGRESS">In Progress</SelectItem>
                    <SelectItem value="PUTAWAY_COMPLETED">Completed</SelectItem>
                  </SelectContent>
                </Select>
              )}

              {activeTab === "quarantine" && (
                <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                  <SelectTrigger className="w-[180px] h-9 text-xs">
                    <SelectValue placeholder="QC Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All QC Statuses</SelectItem>
                    <SelectItem value="PENDING_REVIEW">Pending Review</SelectItem>
                    <SelectItem value="QUARANTINED">Quarantined</SelectItem>
                    <SelectItem value="SCRAPPED">Scrapped</SelectItem>
                    <SelectItem value="REWORK">Rework</SelectItem>
                    <SelectItem value="ACCEPTED_WITH_DEVIATION">Accepted with Deviation</SelectItem>
                    <SelectItem value="RETURN_TO_VENDOR">Return to Vendor</SelectItem>
                  </SelectContent>
                </Select>
              )}

              {/* Date Filters for Movement & Putaway */}
              {(activeTab === "movement" || activeTab === "putaway") && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground font-medium">From:</span>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-[130px] h-9 text-xs px-2"
                  />
                  <span className="text-[11px] text-muted-foreground font-medium">To:</span>
                  <Input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-[130px] h-9 text-xs px-2"
                  />
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center gap-2 ml-auto">
                {(search ||
                  selectedStore !== "ALL" ||
                  selectedStatus !== "ALL" ||
                  startDate ||
                  endDate) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClearFilters}
                    className="h-9 text-xs text-muted-foreground hover:text-foreground"
                  >
                    Clear Filters
                  </Button>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchReportData(true)}
                  disabled={loading}
                  className="h-9 gap-1.5 text-xs font-semibold"
                >
                  <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
                  Refresh
                </Button>

                <Button
                  variant="default"
                  size="sm"
                  onClick={handleExportCSV}
                  disabled={loading || currentFilteredRecords.length === 0}
                  className="h-9 gap-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  <Download className="size-3.5" />
                  Export CSV
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Main Report Table Content */}
        <SectionCard
          title={
            activeTab === "inventory"
              ? "Inventory Balance & Valuation Report"
              : activeTab === "movement"
                ? "Stock Movement Ledger Report"
                : activeTab === "putaway"
                  ? "Putaway Operations & Assignment Report"
                  : activeTab === "low-stock"
                    ? "Low Stock & Reorder Trigger Report"
                    : "Quarantine & Material Rejection Report"
          }
          description={`Showing ${currentFilteredRecords.length} authoritative database records`}
          icon={FileSpreadsheet}
        >
          {loading ? (
            <div className="py-16 flex flex-col items-center justify-center gap-3">
              <RefreshCw className="size-7 animate-spin text-primary" />
              <p className="text-xs font-medium text-muted-foreground">
                Querying PostgreSQL database records...
              </p>
            </div>
          ) : error ? (
            <div className="py-12 px-6 rounded-xl border border-destructive/30 bg-destructive-soft/10 text-center space-y-3">
              <AlertTriangle className="size-8 text-destructive mx-auto" />
              <p className="text-sm font-bold text-destructive">Failed to load report data</p>
              <p className="text-xs text-muted-foreground max-w-md mx-auto">{error}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchReportData(true)}
                className="mt-2 text-xs"
              >
                Retry Request
              </Button>
            </div>
          ) : currentFilteredRecords.length === 0 ? (
            <div className="py-16 text-center space-y-2">
              <Archive className="size-9 text-muted-foreground/50 mx-auto" />
              <p className="text-sm font-semibold text-foreground">
                No report data found for the selected filters.
              </p>
              <p className="text-xs text-muted-foreground">
                Try adjusting your search terms, store selection, or date ranges.
              </p>
              {(search ||
                selectedStore !== "ALL" ||
                selectedStatus !== "ALL" ||
                startDate ||
                endDate) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClearFilters}
                  className="mt-3 text-xs"
                >
                  Reset All Filters
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-border/70 overflow-x-auto shadow-2xs">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-muted/50 border-b border-border text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                      {activeTab === "inventory" && (
                        <>
                          <th className="p-3 pl-4">Material Code</th>
                          <th className="p-3">Material Name</th>
                          <th className="p-3">Category</th>
                          <th className="p-3">Store Location</th>
                          <th className="p-3">Zone / Bin</th>
                          <th className="p-3 text-right">On Hand</th>
                          <th className="p-3 text-right">Available</th>
                          <th className="p-3 text-right">Allocated</th>
                          <th className="p-3 text-center">UOM</th>
                          <th className="p-3 text-right">Reorder Pt</th>
                          <th className="p-3 text-center pr-4">Status</th>
                        </>
                      )}

                      {activeTab === "low-stock" && (
                        <>
                          <th className="p-3 pl-4">Material Code</th>
                          <th className="p-3">Material Name</th>
                          <th className="p-3">Category</th>
                          <th className="p-3">Store & Zone</th>
                          <th className="p-3 text-right">Available</th>
                          <th className="p-3 text-right">Reorder Point</th>
                          <th className="p-3 text-right text-rose-600">Deficit</th>
                          <th className="p-3 text-center">UOM</th>
                          <th className="p-3 text-center pr-4">Urgency</th>
                        </>
                      )}

                      {activeTab === "movement" && (
                        <>
                          <th className="p-3 pl-4">Timestamp</th>
                          <th className="p-3">Type</th>
                          <th className="p-3">Material</th>
                          <th className="p-3 text-right">Quantity</th>
                          <th className="p-3">Store / Zone</th>
                          <th className="p-3">Source &rarr; Dest</th>
                          <th className="p-3">Reference #</th>
                          <th className="p-3">Operator</th>
                          <th className="p-3 pr-4">Notes</th>
                        </>
                      )}

                      {activeTab === "putaway" && (
                        <>
                          <th className="p-3 pl-4">Task Number</th>
                          <th className="p-3">GRN Reference</th>
                          <th className="p-3">Material Item</th>
                          <th className="p-3 text-right">Quantity</th>
                          <th className="p-3">Destination Store</th>
                          <th className="p-3">Assigned Zone/Bin</th>
                          <th className="p-3">Assigned By</th>
                          <th className="p-3 text-center pr-4">Status</th>
                        </>
                      )}

                      {activeTab === "quarantine" && (
                        <>
                          <th className="p-3 pl-4">Quarantine #</th>
                          <th className="p-3">Material Code</th>
                          <th className="p-3">Material Name</th>
                          <th className="p-3 text-right">Damaged Qty</th>
                          <th className="p-3">GRN Reference</th>
                          <th className="p-3">Supplier</th>
                          <th className="p-3">Damage Reason</th>
                          <th className="p-3 text-center">QC Status</th>
                          <th className="p-3 text-center pr-4">Disposition</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60 font-medium">
                    {paginatedRecords.map((row, idx) => {
                      return (
                        <tr key={row.id || idx} className="hover:bg-muted/30 transition-colors">
                          {activeTab === "inventory" && (
                            <>
                              <td className="p-3 pl-4 font-mono font-bold text-foreground">
                                {row.material_code}
                              </td>
                              <td className="p-3 font-semibold text-foreground max-w-[200px] truncate">
                                {row.material_name}
                              </td>
                              <td className="p-3 text-muted-foreground">
                                <span className="px-2 py-0.5 rounded bg-muted/60 text-[10px] font-semibold">
                                  {row.category || "GENERAL"}
                                </span>
                              </td>
                              <td className="p-3 text-foreground">
                                <span className="font-semibold">{row.store_name}</span>
                                {row.store_code && (
                                  <span className="text-[10px] text-muted-foreground ml-1">
                                    ({row.store_code})
                                  </span>
                                )}
                              </td>
                              <td className="p-3 text-muted-foreground font-mono text-[11px]">
                                {row.zone_code || "N/A"}
                                {row.bin_code && ` · ${row.bin_code}`}
                              </td>
                              <td className="p-3 text-right font-bold text-foreground">
                                {Number(
                                  row.on_hand_quantity ?? row.total_quantity ?? 0,
                                ).toLocaleString()}
                              </td>
                              <td className="p-3 text-right font-bold text-emerald-600">
                                {Number(row.available_quantity ?? 0).toLocaleString()}
                              </td>
                              <td className="p-3 text-right font-medium text-amber-600">
                                {Number(row.allocated_quantity ?? 0).toLocaleString()}
                              </td>
                              <td className="p-3 text-center text-muted-foreground font-bold text-[10px]">
                                {row.uom || "PCS"}
                              </td>
                              <td className="p-3 text-right text-muted-foreground">
                                {row.reorder_point ?? 10}
                              </td>
                              <td className="p-3 text-center pr-4">
                                <StockStatusBadge status={row.status} />
                              </td>
                            </>
                          )}

                          {activeTab === "low-stock" && (
                            <>
                              <td className="p-3 pl-4 font-mono font-bold text-foreground">
                                {row.material_code}
                              </td>
                              <td className="p-3 font-semibold text-foreground max-w-[220px] truncate">
                                {row.material_name}
                              </td>
                              <td className="p-3 text-muted-foreground">
                                <span className="px-2 py-0.5 rounded bg-muted/60 text-[10px] font-semibold">
                                  {row.category || "GENERAL"}
                                </span>
                              </td>
                              <td className="p-3 text-foreground">
                                {row.store_name || "Main Store"} · {row.zone_code || "N/A"}
                              </td>
                              <td className="p-3 text-right font-bold text-rose-600">
                                {Number(row.available_quantity ?? 0).toLocaleString()}
                              </td>
                              <td className="p-3 text-right font-bold text-muted-foreground">
                                {Number(row.reorder_point ?? 10).toLocaleString()}
                              </td>
                              <td className="p-3 text-right font-bold text-rose-600">
                                -
                                {Math.max(
                                  0,
                                  Number(row.reorder_point || 10) -
                                    Number(row.available_quantity || 0),
                                ).toLocaleString()}
                              </td>
                              <td className="p-3 text-center text-muted-foreground font-bold text-[10px]">
                                {row.uom || "PCS"}
                              </td>
                              <td className="p-3 text-center pr-4">
                                {Number(row.available_quantity || 0) === 0 ? (
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/15 text-rose-600 border border-rose-500/30">
                                    OUT OF STOCK
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-600 border border-amber-500/30">
                                    REORDER REQUIRED
                                  </span>
                                )}
                              </td>
                            </>
                          )}

                          {activeTab === "movement" && (
                            <>
                              <td className="p-3 pl-4 font-mono text-[11px] text-muted-foreground whitespace-nowrap">
                                {row.timestamp
                                  ? row.timestamp.slice(0, 16).replace("T", " ")
                                  : "N/A"}
                              </td>
                              <td className="p-3">
                                <TransactionBadge type={row.transaction_type} />
                              </td>
                              <td className="p-3 font-semibold text-foreground">
                                {row.material_name}
                                <span className="block font-mono text-[10px] text-muted-foreground">
                                  {row.material_code}
                                </span>
                              </td>
                              <td
                                className={`p-3 text-right font-bold ${row.quantity < 0 ? "text-rose-600" : "text-emerald-600"}`}
                              >
                                {row.quantity > 0 ? `+${row.quantity}` : row.quantity}{" "}
                                <span className="text-[10px] font-normal text-muted-foreground">
                                  {row.uom}
                                </span>
                              </td>
                              <td className="p-3 text-foreground text-[11px]">
                                {row.store_name || "Receiving Dock"}
                                {row.zone_name && (
                                  <span className="text-muted-foreground block text-[10px]">
                                    {row.zone_name}
                                  </span>
                                )}
                              </td>
                              <td className="p-3 text-muted-foreground text-[11px] max-w-[160px] truncate">
                                {row.source} &rarr; {row.destination}
                              </td>
                              <td className="p-3 font-mono font-bold text-foreground">
                                {row.reference_number || "—"}
                              </td>
                              <td className="p-3 text-muted-foreground text-[11px]">
                                {row.performed_by || "System"}
                              </td>
                              <td className="p-3 pr-4 text-muted-foreground text-[11px] max-w-[180px] truncate">
                                {row.notes || "—"}
                              </td>
                            </>
                          )}

                          {activeTab === "putaway" && (
                            <>
                              <td className="p-3 pl-4 font-mono font-bold text-primary">
                                {row.task_number}
                              </td>
                              <td className="p-3 font-mono text-muted-foreground">
                                {row.grn_number}
                              </td>
                              <td className="p-3 font-semibold text-foreground">
                                {row.material_name}
                                <span className="block font-mono text-[10px] text-muted-foreground">
                                  {row.item_code}
                                </span>
                              </td>
                              <td className="p-3 text-right font-bold text-foreground">
                                {row.quantity}{" "}
                                <span className="text-[10px] font-normal text-muted-foreground">
                                  {row.uom}
                                </span>
                              </td>
                              <td className="p-3 text-foreground">
                                {stores.find((s) => s.id === row.destination_store_id)
                                  ?.store_name ||
                                  row.destination_store_id ||
                                  "Central Warehouse"}
                              </td>
                              <td className="p-3 font-mono text-muted-foreground">
                                {row.destination_zone || "Unassigned"}
                                {row.destination_bin_code && ` · ${row.destination_bin_code}`}
                              </td>
                              <td className="p-3 text-muted-foreground text-[11px]">
                                {row.location_assigned_by || "Auto-routed"}
                              </td>
                              <td className="p-3 text-center pr-4">
                                <PutawayStatusBadge status={row.status} />
                              </td>
                            </>
                          )}

                          {activeTab === "quarantine" && (
                            <>
                              <td className="p-3 pl-4 font-mono font-bold text-rose-600">
                                {row.quarantine_number}
                              </td>
                              <td className="p-3 font-mono font-semibold text-foreground">
                                {row.item_code}
                              </td>
                              <td className="p-3 font-semibold text-foreground max-w-[200px] truncate">
                                {row.material_name}
                              </td>
                              <td className="p-3 text-right font-bold text-rose-600">
                                {row.damaged_quantity}{" "}
                                <span className="text-[10px] font-normal text-muted-foreground">
                                  {row.uom}
                                </span>
                              </td>
                              <td className="p-3 font-mono text-muted-foreground">
                                {row.grn_number}
                              </td>
                              <td className="p-3 text-muted-foreground max-w-[160px] truncate">
                                {row.supplier_name || "Supplier"}
                              </td>
                              <td className="p-3 text-muted-foreground max-w-[180px] truncate">
                                {row.reason || "QC Damaged Inspection"}
                              </td>
                              <td className="p-3 text-center">
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-muted/80 text-foreground border border-border">
                                  {row.status}
                                </span>
                              </td>
                              <td className="p-3 text-center pr-4">
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                    row.disposition === "SCRAPPED"
                                      ? "bg-rose-500/15 text-rose-600 border border-rose-500/30"
                                      : row.disposition === "ACCEPTED_WITH_DEVIATION"
                                        ? "bg-emerald-500/15 text-emerald-600 border border-emerald-500/30"
                                        : "bg-muted text-muted-foreground"
                                  }`}
                                >
                                  {row.disposition || "PENDING"}
                                </span>
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination Controls */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Show</span>
                  <Select
                    value={pageSize.toString()}
                    onValueChange={(val) => {
                      setPageSize(Number(val));
                      setCurrentPage(1);
                    }}
                  >
                    <SelectTrigger className="w-[70px] h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="15">15</SelectItem>
                      <SelectItem value="25">25</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                    </SelectContent>
                  </Select>
                  <span>rows of {currentFilteredRecords.length} records</span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground mr-2">
                    Page {currentPage} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="h-8 px-2 text-xs"
                  >
                    <ChevronLeft className="size-3.5 mr-1" /> Prev
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage >= totalPages}
                    className="h-8 px-2 text-xs"
                  >
                    Next <ChevronRight className="size-3.5 ml-1" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </SectionCard>
      </div>
    </AppShell>
  );
}

function StockStatusBadge({ status }: { status: string }) {
  const st = (status || "").toUpperCase();
  if (st === "HEALTHY" || st === "ACTIVE") {
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-600 border border-emerald-500/30">
        HEALTHY
      </span>
    );
  }
  if (st === "LOW_STOCK") {
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-600 border border-amber-500/30">
        LOW STOCK
      </span>
    );
  }
  if (st === "OUT_OF_STOCK") {
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/15 text-rose-600 border border-rose-500/30">
        OUT OF STOCK
      </span>
    );
  }
  if (st === "ALLOCATED") {
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/15 text-purple-600 border border-purple-500/30">
        ALLOCATED
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-muted text-muted-foreground">
      {status || "UNKNOWN"}
    </span>
  );
}

function TransactionBadge({ type }: { type: string }) {
  const t = (type || "").toUpperCase();
  if (t === "RECEIPT") {
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-600 border border-emerald-500/30">
        RECEIPT
      </span>
    );
  }
  if (t === "PUTAWAY") {
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/15 text-blue-600 border border-blue-500/30">
        PUTAWAY
      </span>
    );
  }
  if (t === "ISSUE") {
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/15 text-purple-600 border border-purple-500/30">
        ISSUE
      </span>
    );
  }
  if (t === "QUARANTINE") {
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-600 border border-amber-500/30">
        QUARANTINE
      </span>
    );
  }
  if (t === "SCRAP") {
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/15 text-rose-600 border border-rose-500/30">
        SCRAP
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-muted text-muted-foreground">
      {type}
    </span>
  );
}

function PutawayStatusBadge({ status }: { status: string }) {
  const st = (status || "").toUpperCase();
  if (st === "PUTAWAY_COMPLETED") {
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-600 border border-emerald-500/30">
        COMPLETED
      </span>
    );
  }
  if (st === "PUTAWAY_IN_PROGRESS") {
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/15 text-blue-600 border border-blue-500/30">
        IN PROGRESS
      </span>
    );
  }
  if (st === "ASSIGNED_TO_STORE") {
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/15 text-purple-600 border border-purple-500/30">
        ASSIGNED TO STORE
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-600 border border-amber-500/30">
      PENDING
    </span>
  );
}
