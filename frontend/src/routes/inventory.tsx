import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useMemo, useCallback, lazy, Suspense } from "react";
import {
  Boxes,
  Search,
  Loader2,
  AlertTriangle,
  History,
  Building2,
  RefreshCw,
  Eye,
  ShieldAlert,
  CheckCircle2,
  PackageCheck,
  ClipboardList,
  Layers,
  ArrowRight,
  Info,
} from "lucide-react";
import { AppShell, StatusBadge } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/inventory")({
  head: () => ({
    meta: [
      { title: "Authoritative Inventory Matrix · KaizenX" },
      {
        name: "description",
        content:
          "Authoritative real-time inventory matrix by Store, Zone, and Bin with live stock breakdown, physical allocations, and auditable movement ledger.",
      },
    ],
  }),
  component: InventoryPage,
});

const InventoryScene = lazy(() => import("@/components/wms/inventory-scene"));

function InventoryPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const [activeTab, setActiveTab] = useState<"scene" | "matrix" | "ledger">("scene");
  const [summaryList, setSummaryList] = useState<any[]>([]);
  const [ledgerList, setLedgerList] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [stores, setStores] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [selectedStore, setSelectedStore] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [ledgerTxType, setLedgerTxType] = useState("ALL");

  // Traceability Modal
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [itemLedger, setItemLedger] = useState<any[]>([]);
  const [itemLedgerLoading, setItemLedgerLoading] = useState(false);

  const fetchInventoryData = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        const [summaryData, ledgerData, statsData, storesData] = await Promise.all([
          api
            .getWarehouseInventorySummary({
              store_id: selectedStore,
              status_filter: statusFilter,
              search: search.trim() || undefined,
            })
            .catch(() => []),
          api
            .getStockLedger({
              store_id: selectedStore,
              transaction_type: ledgerTxType,
            })
            .catch(() => []),
          api.getInventoryStats().catch(() => null),
          api.getStores().catch(() => []),
        ]);

        setSummaryList(summaryData || []);
        setLedgerList(ledgerData || []);
        setStats(statsData);
        setStores(storesData || []);
        setLastUpdatedAt(new Date());
      } catch (error: any) {
        toast.error(error.message || "Failed to load authoritative inventory");
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [selectedStore, statusFilter, ledgerTxType, search],
  );

  useEffect(() => {
    void fetchInventoryData();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void fetchInventoryData(true);
    };
    const timer = window.setInterval(refreshWhenVisible, 5000);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [fetchInventoryData]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void fetchInventoryData();
  };

  const handleOpenItemTraceability = async (item: any) => {
    setSelectedItem(item);
    setItemLedgerLoading(true);
    try {
      const history = await api.getStockLedger({
        material_code: item.material_code,
      });
      setItemLedger(history || []);
    } catch {
      setItemLedger([]);
    } finally {
      setItemLedgerLoading(false);
    }
  };

  // Filtered Summary in matrix view
  const filteredSummary = useMemo(() => {
    return summaryList.filter((s) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        s.material_code.toLowerCase().includes(q) ||
        s.material_name.toLowerCase().includes(q) ||
        (s.store_name || "").toLowerCase().includes(q) ||
        (s.store_code || "").toLowerCase().includes(q) ||
        (s.zone_code || "").toLowerCase().includes(q) ||
        (s.bin_code || "").toLowerCase().includes(q) ||
        (s.location_code || "").toLowerCase().includes(q)
      );
    });
  }, [summaryList, search]);

  // Filtered Ledger in ledger view
  const filteredLedger = useMemo(() => {
    return ledgerList.filter((l) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        l.material_code.toLowerCase().includes(q) ||
        l.material_name.toLowerCase().includes(q) ||
        (l.reference_number || "").toLowerCase().includes(q) ||
        (l.store_code || "").toLowerCase().includes(q) ||
        (l.zone_code || "").toLowerCase().includes(q)
      );
    });
  }, [ledgerList, search]);

  // The matrix is the source of truth for this page. The stats endpoint totals
  // material_stock (warehouse-wide), while this view is based on location
  // balances, so using stats here can show values that do not add up to the
  // rows visible below.
  const numeric = (value: unknown) => Number(value ?? 0);
  const totalSkus = new Set(summaryList.map((s) => s.material_code)).size;
  const totalAvailable = summaryList.reduce(
    (acc, s) => acc + numeric(s.available_quantity),
    0,
  );
  const totalQuarantined = summaryList.reduce(
    (acc, s) => acc + numeric(s.quarantined_quantity),
    0,
  );
  const totalOnHand = summaryList.reduce(
    (acc, s) => acc + numeric(s.total_quantity),
    0,
  );
  const totalAllocated = summaryList.reduce(
    (acc, s) => acc + numeric(s.allocated_quantity),
    0,
  );
  const lowStockCount = summaryList.filter((s) => s.status === "LOW_STOCK").length;

  return (
    <AppShell
      title="Authoritative Inventory Control"
      subtitle="Complete warehouse stock matrix: physical location (Store → Zone → Bin), live allocations, and auditable movement ledger"
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchInventoryData()}
            className="rounded-xl text-xs"
          >
            <RefreshCw className={cn("size-3.5 mr-1.5", loading && "animate-spin")} /> Refresh
          </Button>
          <Button className="rounded-xl shadow-glow text-xs font-semibold" asChild>
            <Link to="/warehouse/material-requests">
              <ClipboardList className="size-3.5 mr-1.5" /> Raise MR
            </Link>
          </Button>
        </div>
      }
    >
      {/* ============================================================ */}
      {/* TOP INVENTORY SUMMARY METRICS (6 COMPACT CARDS)              */}
      {/* ============================================================ */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 mb-6">
        <InventoryStat
          label="Tracked SKUs"
          value={totalSkus}
          subtext="Material codes"
          icon={Boxes}
          color="text-primary"
          bg="bg-primary/10"
        />
        <InventoryStat
          label="Total On Hand"
          value={totalOnHand.toLocaleString()}
          subtext="Physical units in DC"
          icon={Layers}
          color="text-foreground"
          bg="bg-muted"
        />
        <InventoryStat
          label="Available Stock"
          value={totalAvailable.toLocaleString()}
          subtext="Ready for picking"
          icon={CheckCircle2}
          color="text-emerald-600"
          bg="bg-emerald-50 dark:bg-emerald-950/40"
        />
        <InventoryStat
          label="Allocated Stock"
          value={totalAllocated.toLocaleString()}
          subtext="Reserved for MR"
          icon={PackageCheck}
          color="text-blue-600"
          bg="bg-blue-50 dark:bg-blue-950/40"
        />
        <InventoryStat
          label="Quarantine"
          value={totalQuarantined.toLocaleString()}
          subtext="Damaged / segregated"
          icon={ShieldAlert}
          color="text-rose-600"
          bg="bg-rose-50 dark:bg-rose-950/40"
        />
        <InventoryStat
          label="Low Stock Alerts"
          value={lowStockCount}
          subtext="Below reorder point"
          icon={AlertTriangle}
          color="text-amber-600"
          bg="bg-amber-50 dark:bg-amber-950/40"
        />
      </div>

      {/* ============================================================ */}
      {/* TABS: STOCK MATRIX & STOCK LEDGER                            */}
      {/* ============================================================ */}
      <Tabs value={activeTab} onValueChange={(v: any) => setActiveTab(v)} className="space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-border/40 pb-3">
          <TabsList className="bg-muted/40 p-1 rounded-xl">
            <TabsTrigger value="scene" className="rounded-lg text-xs font-semibold"><Boxes className="size-3.5 mr-1.5" />3D Warehouse</TabsTrigger>
            <TabsTrigger value="matrix" className="rounded-lg text-xs font-semibold">
              <Building2 className="size-3.5 mr-1.5" />
              Stock by Location Matrix (Store → Zone → Bin)
            </TabsTrigger>
            <TabsTrigger value="ledger" className="rounded-lg text-xs font-semibold">
              <History className="size-3.5 mr-1.5" />
              Authoritative Stock Movement Ledger
            </TabsTrigger>
          </TabsList>

          {/* Search & Filter Controls */}
          <form onSubmit={handleSearchSubmit} className="flex flex-wrap items-center gap-2">
            <div className="relative w-60">
              <Search className="absolute left-3 top-2.5 size-3.5 text-muted-foreground" />
              <Input
                placeholder="Search code, name, zone, bin..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-8 text-xs rounded-xl bg-background/60 border-border/60"
              />
            </div>

            <Select value={selectedStore} onValueChange={setSelectedStore}>
              <SelectTrigger className="w-36 h-8 text-xs rounded-xl border-border/60">
                <SelectValue placeholder="Store" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Stores</SelectItem>
                {stores.map((st) => (
                  <SelectItem key={st.id} value={st.id}>
                    {st.store_name} ({st.store_code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {activeTab !== "ledger" ? (
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-32 h-8 text-xs rounded-xl border-border/60">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Status</SelectItem>
                  <SelectItem value="HEALTHY">In Stock / Healthy</SelectItem>
                  <SelectItem value="LOW_STOCK">Low Stock</SelectItem>
                  <SelectItem value="OUT_OF_STOCK">Out of Stock</SelectItem>
                  <SelectItem value="ALLOCATED">Allocated</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <Select value={ledgerTxType} onValueChange={setLedgerTxType}>
                <SelectTrigger className="w-36 h-8 text-xs rounded-xl border-border/60">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Types</SelectItem>
                  <SelectItem value="RECEIPT">Receipt (GRN)</SelectItem>
                  <SelectItem value="PUTAWAY">Putaway</SelectItem>
                  <SelectItem value="ISSUE">Issue (Assembly)</SelectItem>
                  <SelectItem value="QUARANTINE">Quarantine</SelectItem>
                  <SelectItem value="SCRAP">Scrap</SelectItem>
                </SelectContent>
              </Select>
            )}
          </form>
        </div>

        <TabsContent value="scene">
          {loading || !mounted ? <div className="grid h-96 place-items-center"><Loader2 className="size-8 animate-spin text-primary" /></div> : <Suspense fallback={<div className="grid h-96 place-items-center"><Loader2 className="size-8 animate-spin text-primary" /></div>}><InventoryScene items={filteredSummary} onInspect={handleOpenItemTraceability} lastUpdatedAt={lastUpdatedAt} /></Suspense>}
        </TabsContent>
        {/* TAB 1: STOCK BY STORE & ZONE & BIN MATRIX */}
        <TabsContent value="matrix" className="space-y-4">
          {loading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="size-8 animate-spin text-primary" />
            </div>
          ) : filteredSummary.length === 0 ? (
            <Card className="border-dashed border-border/60 p-12 text-center bg-card/40">
              <Boxes className="size-8 mx-auto text-muted-foreground opacity-40 mb-2" />
              <p className="text-xs font-bold text-muted-foreground">No Stock Records Found</p>
              <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                Try adjusting your search query, store selection, or status filters.
              </p>
            </Card>
          ) : (
            <Card className="border-border/40 overflow-hidden shadow-subtle">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/30 border-b border-border/60 text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">Material Master</th>
                      <th className="px-3 py-3">Category</th>
                      <th className="px-3 py-3">Store</th>
                      <th className="px-3 py-3">Zone</th>
                      <th className="px-3 py-3">Bin Location</th>
                      <th className="px-3 py-3 text-right">On Hand</th>
                      <th className="px-3 py-3 text-right">Available</th>
                      <th className="px-3 py-3 text-right">Allocated</th>
                      <th className="px-3 py-3 text-right">Quarantined</th>
                      <th className="px-3 py-3 text-right">Reorder Pt</th>
                      <th className="px-3 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {filteredSummary.map((item) => (
                      <tr key={item.id} className="hover:bg-muted/10 transition-colors">
                        <td className="px-4 py-3">
                          <p className="font-bold text-foreground">{item.material_name}</p>
                          <p className="font-mono text-[11px] text-muted-foreground">
                            {item.material_code}
                          </p>
                        </td>
                        <td className="px-3 py-3 text-muted-foreground font-medium">
                          {item.category || "GENERAL"}
                        </td>
                        <td className="px-3 py-3">
                          <span className="font-semibold text-foreground">{item.store_name}</span>
                          {item.store_code && item.store_code !== "UNASSIGNED" && (
                            <p className="font-mono text-[10px] text-muted-foreground">
                              {item.store_code}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <span className="font-mono font-medium text-foreground bg-muted/40 px-2 py-0.5 rounded text-[11px]">
                            {item.zone_code || "—"}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          {item.bin_code ? (
                            <div>
                              <span className="font-mono font-bold text-primary bg-primary/10 px-2 py-0.5 rounded text-[11px]">
                                {item.bin_code}
                              </span>
                              {(item.rack || item.shelf) && (
                                <p className="text-[10px] text-muted-foreground mt-0.5">
                                  {item.rack ? `Rack: ${item.rack}` : ""}{" "}
                                  {item.shelf ? `Shelf: ${item.shelf}` : ""}
                                </p>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground font-mono text-[11px]">
                              {item.location_code || "—"}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right font-mono font-bold text-foreground">
                          {Number(item.total_quantity).toLocaleString()} {item.uom}
                        </td>
                        <td className="px-3 py-3 text-right font-mono font-bold text-emerald-600">
                          {Number(item.available_quantity).toLocaleString()} {item.uom}
                        </td>
                        <td className="px-3 py-3 text-right font-mono">
                          {item.allocated_quantity > 0 ? (
                            <span className="text-blue-600 font-bold bg-blue-50 dark:bg-blue-950/40 px-1.5 py-0.5 rounded">
                              {Number(item.allocated_quantity).toLocaleString()} {item.uom}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">0 {item.uom}</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right font-mono">
                          {item.quarantined_quantity > 0 ? (
                            <span className="text-rose-600 font-bold bg-rose-50 dark:bg-rose-950/40 px-1.5 py-0.5 rounded">
                              {Number(item.quarantined_quantity).toLocaleString()} {item.uom}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">0 {item.uom}</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-muted-foreground">
                          {item.reorder_point} {item.uom}
                        </td>
                        <td className="px-3 py-3">
                          <StatusBadge status={item.status} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void handleOpenItemTraceability(item)}
                            className="h-7 text-xs rounded-lg text-primary hover:bg-primary/10"
                          >
                            <Eye className="size-3.5 mr-1" /> Details
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </TabsContent>

        {/* TAB 2: AUTHORITATIVE STOCK LEDGER */}
        <TabsContent value="ledger" className="space-y-4">
          {loading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="size-8 animate-spin text-primary" />
            </div>
          ) : filteredLedger.length === 0 ? (
            <Card className="border-dashed border-border/60 p-12 text-center bg-card/40">
              <History className="size-8 mx-auto text-muted-foreground opacity-40 mb-2" />
              <p className="text-xs font-bold text-muted-foreground">
                No Stock Ledger Events Found
              </p>
              <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                Receipts, putaway movements, and issue transactions will be recorded here
                automatically.
              </p>
            </Card>
          ) : (
            <Card className="border-border/40 overflow-hidden shadow-subtle">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/30 border-b border-border/60 text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">Date / Time</th>
                      <th className="px-4 py-3">Transaction Type</th>
                      <th className="px-4 py-3">Material</th>
                      <th className="px-4 py-3 text-right">Quantity</th>
                      <th className="px-4 py-3">Store & Zone</th>
                      <th className="px-4 py-3">Reference / Doc</th>
                      <th className="px-4 py-3">Source → Dest</th>
                      <th className="px-4 py-3">Performed By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {filteredLedger.map((tx) => {
                      const isPositive = tx.quantity > 0;
                      return (
                        <tr key={tx.id} className="hover:bg-muted/10 transition-colors">
                          <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground whitespace-nowrap">
                            {new Date(tx.timestamp).toLocaleString()}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={cn(
                                "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase",
                                tx.transaction_type === "RECEIPT" &&
                                  "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
                                tx.transaction_type === "PUTAWAY" &&
                                  "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
                                tx.transaction_type === "ISSUE" &&
                                  "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300",
                                tx.transaction_type === "QUARANTINE" &&
                                  "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
                                tx.transaction_type === "SCRAP" &&
                                  "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
                                tx.transaction_type === "ACCEPTED_WITH_DEVIATION" &&
                                  "bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300",
                              )}
                            >
                              {tx.transaction_type}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-semibold text-foreground">{tx.material_name}</p>
                            <p className="font-mono text-[10px] text-muted-foreground">
                              {tx.material_code}
                            </p>
                          </td>
                          <td className="px-4 py-3 text-right font-mono font-bold whitespace-nowrap">
                            <span className={cn(isPositive ? "text-emerald-600" : "text-rose-600")}>
                              {isPositive
                                ? `+${Number(tx.quantity).toLocaleString()}`
                                : Number(tx.quantity).toLocaleString()}{" "}
                              {tx.uom}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-medium text-foreground">
                              {tx.store_name || "—"}
                            </span>
                            {tx.zone_code && (
                              <p className="font-mono text-[10px] text-muted-foreground">
                                {tx.zone_code}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3 font-mono text-[11px] font-bold text-foreground">
                            {tx.reference_number || "—"}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground font-mono text-[11px]">
                            {tx.source || "—"} → {tx.destination || "—"}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {tx.performed_by || "System"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* ============================================================ */}
      {/* ITEM DETAILS & COMPLETE TRACEABILITY DIALOG                   */}
      {/* ============================================================ */}
      <Dialog open={!!selectedItem} onOpenChange={(open) => !open && setSelectedItem(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold">
              <Boxes className="size-5 text-primary" />
              SKU Inventory Traceability & Location Hierarchy
            </DialogTitle>
            <DialogDescription className="text-xs">
              Physical location hierarchy, authoritative balances, and movement audit trail.
            </DialogDescription>
          </DialogHeader>

          {selectedItem && (
            <div className="space-y-4 text-xs">
              {/* Material and Location Breakdown */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3.5 bg-muted/20 rounded-xl border border-border/40">
                <div>
                  <p className="text-[10px] uppercase font-bold text-muted-foreground">
                    Material Name
                  </p>
                  <p className="font-semibold text-foreground mt-0.5">
                    {selectedItem.material_name}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-muted-foreground">
                    Material Code
                  </p>
                  <p className="font-mono font-bold text-foreground mt-0.5">
                    {selectedItem.material_code}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-muted-foreground">Category</p>
                  <p className="font-medium text-foreground mt-0.5">
                    {selectedItem.category || "GENERAL"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-muted-foreground">
                    Reorder Threshold
                  </p>
                  <p className="font-mono font-bold text-foreground mt-0.5">
                    {selectedItem.reorder_point} {selectedItem.uom}
                  </p>
                </div>
              </div>

              {/* Location Hierarchy */}
              <div className="p-3 bg-muted/10 rounded-xl border border-border/40">
                <p className="text-[10px] uppercase font-bold text-muted-foreground mb-1.5 flex items-center gap-1">
                  <Building2 className="size-3.5 text-primary" /> Physical Location Hierarchy
                </p>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div className="p-2 rounded-lg bg-background border">
                    <span className="text-[10px] text-muted-foreground">Warehouse</span>
                    <p className="font-semibold text-foreground text-xs mt-0.5">
                      {selectedItem.warehouse_id || "Main Warehouse"}
                    </p>
                  </div>
                  <div className="p-2 rounded-lg bg-background border">
                    <span className="text-[10px] text-muted-foreground">Store</span>
                    <p className="font-semibold text-foreground text-xs mt-0.5">
                      {selectedItem.store_name} ({selectedItem.store_code || "—"})
                    </p>
                  </div>
                  <div className="p-2 rounded-lg bg-background border">
                    <span className="text-[10px] text-muted-foreground">Zone</span>
                    <p className="font-semibold text-foreground text-xs mt-0.5">
                      {selectedItem.zone_code || "—"}
                    </p>
                  </div>
                  <div className="p-2 rounded-lg bg-background border">
                    <span className="text-[10px] text-muted-foreground">Bin Location</span>
                    <p className="font-bold text-primary text-xs mt-0.5">
                      {selectedItem.bin_code || selectedItem.location_code || "—"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Stock Balances Breakdown */}
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="p-2.5 rounded-xl border border-border/40 bg-muted/20">
                  <p className="text-[10px] uppercase font-bold text-muted-foreground">
                    Total On Hand
                  </p>
                  <p className="font-mono font-black text-sm text-foreground mt-0.5">
                    {Number(selectedItem.total_quantity).toLocaleString()} {selectedItem.uom}
                  </p>
                </div>
                <div className="p-2.5 rounded-xl border border-emerald-200/60 dark:border-emerald-800/40 bg-emerald-50/40 dark:bg-emerald-950/20">
                  <p className="text-[10px] uppercase font-bold text-emerald-800 dark:text-emerald-300">
                    Available
                  </p>
                  <p className="font-mono font-black text-sm text-emerald-700 dark:text-emerald-400 mt-0.5">
                    {Number(selectedItem.available_quantity).toLocaleString()} {selectedItem.uom}
                  </p>
                </div>
                <div className="p-2.5 rounded-xl border border-blue-200/60 dark:border-blue-800/40 bg-blue-50/40 dark:bg-blue-950/20">
                  <p className="text-[10px] uppercase font-bold text-blue-800 dark:text-blue-300">
                    Allocated
                  </p>
                  <p className="font-mono font-black text-sm text-blue-700 dark:text-blue-400 mt-0.5">
                    {Number(selectedItem.allocated_quantity || 0).toLocaleString()}{" "}
                    {selectedItem.uom}
                  </p>
                </div>
                <div className="p-2.5 rounded-xl border border-rose-200/60 dark:border-rose-800/40 bg-rose-50/40 dark:bg-rose-950/20">
                  <p className="text-[10px] uppercase font-bold text-rose-800 dark:text-rose-300">
                    Quarantined
                  </p>
                  <p className="font-mono font-black text-sm text-rose-700 dark:text-rose-400 mt-0.5">
                    {Number(selectedItem.quarantined_quantity || 0).toLocaleString()}{" "}
                    {selectedItem.uom}
                  </p>
                </div>
              </div>

              {/* Movement History */}
              <div>
                <h4 className="font-bold text-foreground flex items-center gap-1.5 mb-2">
                  <History className="size-3.5 text-primary" />
                  Chronological Movement Ledger
                </h4>

                {itemLedgerLoading ? (
                  <div className="p-8 text-center">
                    <Loader2 className="size-5 animate-spin mx-auto text-primary" />
                  </div>
                ) : itemLedger.length === 0 ? (
                  <p className="text-muted-foreground text-center py-6 bg-muted/10 rounded-xl">
                    No movements recorded for this SKU yet.
                  </p>
                ) : (
                  <div className="max-h-52 overflow-y-auto border border-border/40 rounded-xl divide-y divide-border/40">
                    {itemLedger.map((tx) => (
                      <div
                        key={tx.id}
                        className="p-2.5 flex items-center justify-between text-xs hover:bg-muted/10"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold font-mono text-foreground">
                              {tx.reference_number || "MOVE"}
                            </span>
                            <span className="text-[10px] uppercase font-bold px-1.5 py-0.2 rounded bg-muted">
                              {tx.transaction_type}
                            </span>
                          </div>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {new Date(tx.timestamp).toLocaleString()} · Performed by{" "}
                            {tx.performed_by || "System"}
                          </p>
                        </div>
                        <div className="text-right">
                          <span
                            className={cn(
                              "font-mono font-bold",
                              tx.quantity > 0 ? "text-emerald-600" : "text-rose-600",
                            )}
                          >
                            {tx.quantity > 0
                              ? `+${Number(tx.quantity).toLocaleString()}`
                              : Number(tx.quantity).toLocaleString()}{" "}
                            {tx.uom}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedItem(null)}
              className="rounded-xl text-xs"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function InventoryStat({ label, value, subtext, icon: Icon, color, bg }: any) {
  return (
    <Card className="border-border/40 shadow-subtle overflow-hidden p-3.5 bg-card/60">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
            {label}
          </p>
          <h3 className="text-lg font-black mt-0.5 tabular-nums text-foreground">{value}</h3>
          {subtext && <p className="text-[10px] text-muted-foreground mt-0.5">{subtext}</p>}
        </div>
        <div
          className={cn("size-8 rounded-xl flex items-center justify-center shrink-0", bg, color)}
        >
          <Icon className="size-4" />
        </div>
      </div>
    </Card>
  );
}
