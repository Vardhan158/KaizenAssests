import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import {
  BarChart3,
  Building2,
  ClipboardList,
  FileQuestion,
  FileBadge,
  FileText,
  Truck,
  IndianRupee,
  Download,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertTriangle,
  Info,
  PieChart as PieChartIcon,
  Loader2,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart as RPieChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell, StatusBadge } from "@/components/wms/app-shell";
import { SectionCard, StatCard } from "@/components/wms/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/lib/api-client";
import { requireRole, getUserInfo } from "@/lib/auth-utils";
import { toast } from "sonner";

export const Route = createFileRoute("/procurement/reports")({
  beforeLoad: () => requireRole(["PROCUREMENT", "FINANCE"]),
  head: () => ({
    meta: [
      { title: "Finance Reports · KaizenX" },
      {
        name: "description",
        content: "Analytics and reporting across purchase spend, supplier performance, RFQs, and ASNs.",
      },
    ],
  }),
  component: ProcurementReports,
});

type ReportTab = "spend" | "supplier-performance" | "rfq-analytics" | "asns-compliance" | "material-requests";

const COLORS = ["#0284c7", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#64748b"];

function formatInr(val: number): string {
  if (!Number.isFinite(val)) return "₹0";
  return `₹${val.toLocaleString("en-IN")}`;
}

function formatInrCompact(value: number): string {
  if (!Number.isFinite(value)) return "₹0";
  if (Math.abs(value) >= 10000000) return `₹${(value / 10000000).toFixed(2)} Cr`;
  if (Math.abs(value) >= 100000) return `₹${(value / 100000).toFixed(2)} L`;
  return `₹${value.toLocaleString("en-IN")}`;
}

function ProcurementReports() {
  const [activeTab, setActiveTab] = useState<ReportTab>("spend");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const user = getUserInfo();
  const isFinanceOnly = user?.roles?.includes("FINANCE") && !user?.roles?.includes("PROCUREMENT");

  // Dynamic API Data
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);
  const [rfqs, setRfqs] = useState<any[]>([]);
  const [quotations, setQuotations] = useState<any[]>([]);
  const [materialRequests, setMaterialRequests] = useState<any[]>([]);
  const [asns, setAsns] = useState<any[]>([]);
  const [procurementStats, setProcurementStats] = useState<any>({});

  // Filters
  const [search, setSearch] = useState("");
  const [dateRange, setDateRange] = useState("all");
  const [selectedCategory, setSelectedCategory] = useState("ALL");
  const [selectedStatus, setSelectedStatus] = useState("ALL");

  const loadAllData = async (isManual = false) => {
    if (isManual) setRefreshing(true);
    else setLoading(true);

    try {
      const [sData, poData, rfqData, qData, mrData, asnData, statsData] = await Promise.all([
        api.getSuppliers().catch(() => []),
        api.getPurchaseOrders().catch(() => []),
        api.getRfqs().catch(() => []),
        api.getQuotations().catch(() => []),
        api.getMaterialRequests().catch(() => []),
        api.getAsns().catch(() => []),
        api.getProcurementStats().catch(() => ({})),
      ]);

      setSuppliers(Array.isArray(sData) ? sData : []);
      setPurchaseOrders(Array.isArray(poData) ? poData : []);
      setRfqs(Array.isArray(rfqData) ? rfqData : []);
      setQuotations(Array.isArray(qData) ? qData : []);
      setMaterialRequests(Array.isArray(mrData) ? mrData : []);
      setAsns(Array.isArray(asnData) ? asnData : []);
      setProcurementStats(statsData || {});

      if (isManual) toast.success("Procurement reports refreshed");
    } catch (err: any) {
      console.error("Failed to load procurement report data", err);
      toast.error("Failed to load procurement report data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadAllData();
  }, []);

  // Filter Categories derived from fetched suppliers
  const categories = useMemo(() => {
    const set = new Set<string>();
    suppliers.forEach((s) => {
      const cats = Array.isArray(s.category) ? s.category : [s.category];
      cats.forEach((c: any) => c && set.add(String(c)));
    });
    return Array.from(set);
  }, [suppliers]);

  // Dynamic Aggregate Metrics
  const totalPoValue = useMemo(() => {
    return purchaseOrders.reduce((sum, po) => sum + (Number(po.total_amount || po.totalAmount || 0)), 0);
  }, [purchaseOrders]);

  const activeSupplierCount = useMemo(() => {
    return suppliers.filter((s) => (s.status || "Pending Approval") === "Active").length;
  }, [suppliers]);

  const totalBidsSavings = useMemo(() => {
    let savings = 0;
    const rfqQuotesMap = new Map<string, number[]>();
    quotations.forEach((q) => {
      const rId = q.rfq_id || q.rfqId;
      const amount = Number(q.total_amount || q.totalAmount || 0);
      if (rId && amount > 0) {
        if (!rfqQuotesMap.has(rId)) rfqQuotesMap.set(rId, []);
        rfqQuotesMap.get(rId)!.push(amount);
      }
    });
    rfqQuotesMap.forEach((amounts) => {
      if (amounts.length > 1) {
        const maxAmt = Math.max(...amounts);
        const minAmt = Math.min(...amounts);
        savings += (maxAmt - minAmt);
      }
    });
    return savings;
  }, [quotations]);

  // Dynamic Monthly PO Spend & Volume
  const monthlyTrendData = useMemo(() => {
    if (procurementStats.trend && Array.isArray(procurementStats.trend) && procurementStats.trend.length > 0) {
      return procurementStats.trend.map((t: any) => ({
        month: t.month,
        pos: Number(t.pos || 0),
        spend: Number(t.spend || 0),
      }));
    }

    const monthMap: Record<string, { pos: number; spend: number }> = {};
    purchaseOrders.forEach((po) => {
      const dateStr = po.po_date || po.created_at || po.date;
      if (dateStr) {
        const d = new Date(dateStr);
        if (!isNaN(d.getTime())) {
          const mLabel = d.toLocaleString("default", { month: "short" });
          if (!monthMap[mLabel]) monthMap[mLabel] = { pos: 0, spend: 0 };
          monthMap[mLabel].pos += 1;
          monthMap[mLabel].spend += Number(po.total_amount || po.totalAmount || 0);
        }
      }
    });

    return Object.entries(monthMap).map(([month, val]) => ({
      month,
      pos: val.pos,
      spend: val.spend,
    }));
  }, [procurementStats, purchaseOrders]);

  // Dynamic Category Distribution
  const categorySpendData = useMemo(() => {
    const catMap: Record<string, number> = {};
    suppliers.forEach((s) => {
      const cat = Array.isArray(s.category) ? s.category[0] : s.category;
      if (cat) {
        catMap[cat] = (catMap[cat] || 0) + 1;
      }
    });
    return Object.entries(catMap).map(([name, value]) => ({ name, value }));
  }, [suppliers]);

  // Dynamic PO Status Distribution
  const poStatusDistribution = useMemo(() => {
    const dist: Record<string, number> = {};
    purchaseOrders.forEach((po) => {
      const st = po.status || "Draft";
      dist[st] = (dist[st] || 0) + 1;
    });
    return Object.entries(dist).map(([name, value]) => ({ name, value }));
  }, [purchaseOrders]);

  // Filtered PO Records
  const filteredPurchaseOrders = useMemo(() => {
    return purchaseOrders.filter((po) => {
      const matchesSearch =
        !search.trim() ||
        [po.po_number, po.poNumber, po.supplier_name, po.supplierName]
          .filter(Boolean)
          .some((val) => String(val).toLowerCase().includes(search.toLowerCase().trim()));
      const matchesStatus = selectedStatus === "ALL" || po.status === selectedStatus;
      return matchesSearch && matchesStatus;
    });
  }, [purchaseOrders, search, selectedStatus]);

  // Filtered Suppliers
  const filteredSuppliers = useMemo(() => {
    return suppliers.filter((s) => {
      const matchesSearch =
        !search.trim() ||
        [s.supplierName, s.supplier_name, s.category, s.gstin]
          .filter(Boolean)
          .some((val) => String(val).toLowerCase().includes(search.toLowerCase().trim()));
      const matchesStatus = selectedStatus === "ALL" || (s.status || "Pending Approval") === selectedStatus;
      const matchesCat = selectedCategory === "ALL" || (Array.isArray(s.category) ? s.category.includes(selectedCategory) : s.category === selectedCategory);
      return matchesSearch && matchesStatus && matchesCat;
    });
  }, [suppliers, search, selectedStatus, selectedCategory]);

  // Export Report to CSV
  const handleExportCSV = () => {
    let rows: string[][] = [];
    let filename = `procurement-${activeTab}-report.csv`;

    if (activeTab === "spend" || activeTab === "asns-compliance") {
      rows.push(["PO Number", "Supplier Name", "PO Date", "Status", "Total Amount (INR)"]);
      filteredPurchaseOrders.forEach((po) => {
        rows.push([
          po.po_number || po.poNumber || "—",
          `"${po.supplier_name || po.supplierName || "—"}"`,
          po.po_date || po.created_at || "—",
          po.status || "—",
          String(po.total_amount || po.totalAmount || 0),
        ]);
      });
    } else if (activeTab === "supplier-performance") {
      rows.push(["Supplier Name", "Supplier Code", "Category", "GSTIN", "Status"]);
      filteredSuppliers.forEach((s) => {
        rows.push([
          `"${s.supplierName || s.supplier_name || "—"}"`,
          s.supplierCode || s.supplier_code || "—",
          `"${Array.isArray(s.category) ? s.category.join(", ") : s.category || "—"}"`,
          s.gstin || "—",
          s.status || "Approved",
        ]);
      });
    } else if (activeTab === "rfq-analytics") {
      rows.push(["RFQ Number", "Title", "Warehouse", "Status", "Closing Date"]);
      rfqs.forEach((r) => {
        rows.push([
          r.rfqNumber || r.rfq_number || "—",
          `"${r.title || "—"}"`,
          r.warehouse || "—",
          r.status || "—",
          r.closingDate || r.closing_date || "—",
        ]);
      });
    } else {
      rows.push(["Request Number", "Warehouse", "Department", "Requested By", "Status"]);
      materialRequests.forEach((mr) => {
        rows.push([
          mr.requestNumber || mr.request_number || mr.id || "—",
          mr.warehouse || "—",
          mr.department || "—",
          mr.requestedBy || mr.requested_by || "—",
          mr.status || "—",
        ]);
      });
    }

    const csvContent = "data:text/csv;charset=utf-8," + rows.map((e) => e.join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast.success(`Exported ${activeTab} report to CSV`);
  };

  return (
    <AppShell
      title={
        <div className="flex items-center gap-2">
          <span>Finance Reports</span>
          <TooltipProvider>
            <Tooltip delayDuration={200}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Reports Info"
                  className="inline-flex items-center text-muted-foreground hover:text-foreground transition-colors cursor-help"
                >
                  <Info className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-xs text-xs">
                {isFinanceOnly
                  ? "Financial analytics for purchase order spend and RFQ savings."
                  : "Comprehensive analytics across vendor spend, supplier performance, RFQ quotes, and receiving compliance."}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      }
      subtitle={isFinanceOnly ? "Analyze purchase order spend and quotation bidding" : "Analyze purchase order spend, supplier ratings, quotation bidding, and receiving compliance"}
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl border-border"
            onClick={() => loadAllData(true)}
            disabled={refreshing || loading}
          >
            <RefreshCw className={refreshing ? "mr-1.5 size-4 animate-spin" : "mr-1.5 size-4"} />
            Refresh
          </Button>
          <Button size="sm" className="rounded-xl shadow-glow" onClick={handleExportCSV}>
            <Download className="mr-1.5 size-4" />
            Export CSV
          </Button>
        </div>
      }
    >
      {/* Top Stat Summary Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total Purchase Value"
          value={loading ? "..." : formatInrCompact(totalPoValue)}
          delta={`${purchaseOrders.length} POs issued`}
          icon={IndianRupee}
          tone="primary"
          infoTooltip="Total monetary value of all purchase orders issued to suppliers."
        />
        <StatCard
          label="Active Suppliers"
          value={loading ? "..." : String(activeSupplierCount)}
          delta={`Out of ${suppliers.length} total vendors`}
          icon={Building2}
          tone="success"
          infoTooltip="Approved suppliers currently available for purchase orders."
        />
        <StatCard
          label="RFQs Issued"
          value={loading ? "..." : String(rfqs.length)}
          delta={`${quotations.length} quotations received`}
          icon={FileQuestion}
          tone="warning"
          infoTooltip="Total Requests for Quotation published for vendor bidding."
        />
        <StatCard
          label="Est. Bidding Savings"
          value={loading ? "..." : formatInrCompact(totalBidsSavings)}
          delta="Realized via RFQ comparison"
          icon={TrendingUp}
          tone="teal"
          infoTooltip="Estimated cost savings achieved through competitive RFQ quotation bidding."
        />
      </div>

      {/* Tabs Navigation */}
      <div className="mt-6 flex overflow-x-auto border-b border-border/70 pb-px">
        {[
          { id: "spend", label: "PO Spend & Summary", icon: IndianRupee },
          { id: "supplier-performance", label: "Supplier Performance", icon: Building2 },
          { id: "rfq-analytics", label: "RFQ & Quotation Analytics", icon: FileQuestion },
          { id: "asns-compliance", label: "ASN & Inbound Compliance", icon: Truck },
          { id: "material-requests", label: "Demand & Requests", icon: ClipboardList },
        ].filter(t => isFinanceOnly ? (t.id === "spend" || t.id === "rfq-analytics") : true).map((tab) => {
          const IconComp = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as ReportTab)}
              className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${
                isActive
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
              }`}
            >
              <IconComp className="size-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Filters Bar */}
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-border/70 bg-card p-3 shadow-soft">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search vendor, PO number, or item..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-xl pl-9 text-xs"
          />
        </div>

        {activeTab === "supplier-performance" && categories.length > 0 && (
          <div className="w-44">
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="h-9 rounded-xl text-xs">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Categories</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="w-40">
          <Select value={selectedStatus} onValueChange={setSelectedStatus}>
            <SelectTrigger className="h-9 rounded-xl text-xs">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Statuses</SelectItem>
              {activeTab === "supplier-performance" ? (
                <>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Pending Approval">Pending Approval</SelectItem>
                  <SelectItem value="Draft">Draft</SelectItem>
                  <SelectItem value="Blocked">Blocked</SelectItem>
                </>
              ) : (
                <>
                  <SelectItem value="Draft">Draft</SelectItem>
                  <SelectItem value="Approved">Approved</SelectItem>
                  <SelectItem value="Issued">Issued</SelectItem>
                  <SelectItem value="Completed">Completed</SelectItem>
                </>
              )}
            </SelectContent>
          </Select>
        </div>

        <div className="w-36">
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="h-9 rounded-xl text-xs">
              <SelectValue placeholder="Date Range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Time</SelectItem>
              <SelectItem value="this-month">This Month</SelectItem>
              <SelectItem value="last-quarter">Last Quarter</SelectItem>
              <SelectItem value="ytd">Year to Date</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Main Tab Content */}
      <div className="mt-4">
        {loading ? (
          <div className="flex h-72 items-center justify-center gap-2">
            <Loader2 className="size-6 animate-spin text-primary" />
            <p className="text-sm font-medium text-muted-foreground">Loading finance reports...</p>
          </div>
        ) : (
          <>
            {/* TAB 1: PO SPEND & SUMMARY */}
            {activeTab === "spend" && (
              <div className="space-y-4">
                <div className="grid gap-4 xl:grid-cols-3">
                  <SectionCard
                    title="Monthly PO Issuance & Spend Trend"
                    description="Purchase orders count and total spend per month"
                    icon={BarChart3}
                    infoTooltip="Track purchase order volume and spend trajectory over recent months."
                    className="xl:col-span-2"
                  >
                    <div className="h-[300px] w-full">
                      {monthlyTrendData.length === 0 ? (
                        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                          No monthly purchase order trend data available.
                        </div>
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={monthlyTrendData} margin={{ left: -10, right: 10, top: 10 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                            <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={12} stroke="var(--color-muted-foreground)" />
                            <YAxis tickLine={false} axisLine={false} fontSize={12} stroke="var(--color-muted-foreground)" />
                            <RTooltip
                              cursor={{ fill: "var(--color-muted)", opacity: 0.4 }}
                              contentStyle={{
                                borderRadius: 12,
                                border: "1px solid var(--color-border)",
                                background: "var(--color-card)",
                                fontSize: 12,
                              }}
                              formatter={(value: any, name: any) => [
                                name === "spend" ? formatInrCompact(Number(value)) : value,
                                name === "spend" ? "Spend" : "POs Issued",
                              ]}
                            />
                            <Bar dataKey="pos" name="pos" fill="var(--color-primary)" radius={[4, 4, 0, 0]} barSize={36} />
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </SectionCard>

                  <SectionCard
                    title="PO Status Distribution"
                    description="Breakdown of purchase orders by status"
                    icon={PieChartIcon}
                    infoTooltip="Status proportion across draft, approved, issued, and completed purchase orders."
                  >
                    <div className="h-[300px] w-full">
                      {poStatusDistribution.length === 0 ? (
                        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                          No purchase order status data recorded.
                        </div>
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <RPieChart>
                            <Pie
                              data={poStatusDistribution}
                              cx="50%"
                              cy="50%"
                              innerRadius={60}
                              outerRadius={90}
                              paddingAngle={5}
                              dataKey="value"
                            >
                              {poStatusDistribution.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                              ))}
                            </Pie>
                            <RTooltip
                              contentStyle={{
                                borderRadius: 12,
                                border: "1px solid var(--color-border)",
                                background: "var(--color-card)",
                                fontSize: 12,
                              }}
                            />
                            <Legend verticalAlign="bottom" height={36} wrapperStyle={{ fontSize: 11 }} />
                          </RPieChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </SectionCard>
                </div>

                {/* Purchase Orders Register */}
                <SectionCard
                  title="Purchase Order Spend Register"
                  description="Detailed list of purchase orders and financial values"
                  icon={FileText}
                >
                  <div className="overflow-x-auto">
                    {filteredPurchaseOrders.length === 0 ? (
                      <p className="py-8 text-center text-sm text-muted-foreground">No purchase orders matching criteria.</p>
                    ) : (
                      <table className="w-full min-w-[700px] text-left text-sm">
                        <thead>
                          <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                            <th className="pb-3 font-medium">PO Number</th>
                            <th className="pb-3 font-medium">Supplier</th>
                            <th className="pb-3 font-medium">Date</th>
                            <th className="pb-3 font-medium">Status</th>
                            <th className="pb-3 text-right font-medium">Total Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredPurchaseOrders.slice(0, 15).map((po) => (
                            <tr key={po.id || po.po_number} className="border-b border-border/60 last:border-0 hover:bg-muted/20">
                              <td className="py-3 font-semibold text-primary">{po.po_number || po.poNumber || "—"}</td>
                              <td className="py-3 font-medium">{po.supplier_name || po.supplierName || "—"}</td>
                              <td className="py-3 text-xs text-muted-foreground">{po.po_date || po.created_at || "—"}</td>
                              <td className="py-3">
                                <StatusBadge status={po.status || "Issued"} />
                              </td>
                              <td className="py-3 text-right font-mono font-bold text-foreground">
                                {formatInr(Number(po.total_amount || po.totalAmount || 0))}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </SectionCard>
              </div>
            )}

            {/* TAB 2: SUPPLIER PERFORMANCE */}
            {activeTab === "supplier-performance" && (
              <div className="space-y-4">
                <div className="grid gap-4 xl:grid-cols-3">
                  <SectionCard
                    title="Supplier Category Distribution"
                    description="Vendors categorized by primary material domain"
                    icon={Building2}
                    className="xl:col-span-1"
                  >
                    <div className="h-[280px] w-full">
                      {categorySpendData.length === 0 ? (
                        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                          No supplier category data recorded.
                        </div>
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <RPieChart>
                            <Pie
                              data={categorySpendData}
                              cx="50%"
                              cy="50%"
                              outerRadius={85}
                              dataKey="value"
                              label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                            >
                              {categorySpendData.map((_, index) => (
                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                              ))}
                            </Pie>
                            <RTooltip />
                          </RPieChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </SectionCard>

                  <SectionCard
                    title="Vendor Performance Register"
                    description="Evaluated suppliers list by category and operational status"
                    icon={ShieldCheck}
                    className="xl:col-span-2"
                  >
                    <div className="overflow-x-auto">
                      {filteredSuppliers.length === 0 ? (
                        <p className="py-8 text-center text-sm text-muted-foreground">No suppliers matching criteria.</p>
                      ) : (
                        <table className="w-full min-w-[550px] text-left text-sm">
                          <thead>
                            <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                              <th className="pb-3 font-medium">Vendor</th>
                              <th className="pb-3 font-medium">Category</th>
                              <th className="pb-3 font-medium">Code / GSTIN</th>
                              <th className="pb-3 font-medium">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredSuppliers.map((s, idx) => (
                              <tr key={s.id || s.supplierId || idx} className="border-b border-border/60 last:border-0 hover:bg-muted/20">
                                <td className="py-3 font-semibold text-foreground">
                                  {s.supplierName || s.supplier_name || "—"}
                                </td>
                                <td className="py-3 text-xs text-muted-foreground">
                                  {Array.isArray(s.category) ? s.category.join(", ") : s.category || "—"}
                                </td>
                                <td className="py-3 font-mono text-xs text-muted-foreground">
                                  {s.supplierCode || s.supplier_code || s.gstin || "—"}
                                </td>
                                <td className="py-3">
                                  <StatusBadge status={s.status || "Active"} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </SectionCard>
                </div>
              </div>
            )}

            {/* TAB 3: RFQ & QUOTATION ANALYTICS */}
            {activeTab === "rfq-analytics" && (
              <div className="space-y-4">
                <SectionCard
                  title="RFQ Bidding & Quotations Register"
                  description="Status of published RFQs and supplier quotation responses"
                  icon={FileQuestion}
                >
                  <div className="grid gap-3 sm:grid-cols-3 mb-4">
                    <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
                      <p className="text-xs text-muted-foreground font-medium">Total RFQs Created</p>
                      <p className="text-2xl font-black">{rfqs.length}</p>
                    </div>
                    <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
                      <p className="text-xs text-muted-foreground font-medium">Quotations Submitted</p>
                      <p className="text-2xl font-black">{quotations.length}</p>
                    </div>
                    <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
                      <p className="text-xs text-muted-foreground font-medium">Avg Bids per RFQ</p>
                      <p className="text-2xl font-black">
                        {rfqs.length > 0 ? (quotations.length / rfqs.length).toFixed(1) : "0"}
                      </p>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    {rfqs.length === 0 ? (
                      <p className="py-8 text-center text-sm text-muted-foreground">No RFQs registered in system.</p>
                    ) : (
                      <table className="w-full min-w-[650px] text-left text-sm">
                        <thead>
                          <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                            <th className="pb-3 font-medium">RFQ Number</th>
                            <th className="pb-3 font-medium">Title</th>
                            <th className="pb-3 font-medium">Warehouse</th>
                            <th className="pb-3 font-medium">Closing Date</th>
                            <th className="pb-3 font-medium">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rfqs.map((rfq) => (
                            <tr key={rfq.id} className="border-b border-border/60 last:border-0 hover:bg-muted/20">
                              <td className="py-3 font-semibold text-primary">{rfq.rfqNumber || rfq.rfq_number || "—"}</td>
                              <td className="py-3 font-medium">{rfq.title || "—"}</td>
                              <td className="py-3 text-xs text-muted-foreground">{rfq.warehouse || "—"}</td>
                              <td className="py-3 text-xs font-mono">{rfq.closingDate || rfq.closing_date || "—"}</td>
                              <td className="py-3">
                                <StatusBadge status={rfq.status || "Published"} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </SectionCard>
              </div>
            )}

            {/* TAB 4: ASNS & COMPLIANCE */}
            {activeTab === "asns-compliance" && (
              <div className="space-y-4">
                <SectionCard
                  title="Inbound ASN Shipping Register"
                  description="Advance shipping notices received from suppliers and transit status"
                  icon={Truck}
                >
                  <div className="overflow-x-auto">
                    {asns.length === 0 ? (
                      <div className="py-8 text-center text-sm text-muted-foreground">
                        No ASNs recorded yet.
                      </div>
                    ) : (
                      <table className="w-full min-w-[650px] text-left text-sm">
                        <thead>
                          <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                            <th className="pb-3 font-medium">ASN Number</th>
                            <th className="pb-3 font-medium">PO Reference</th>
                            <th className="pb-3 font-medium">Supplier</th>
                            <th className="pb-3 font-medium">Dispatch Date</th>
                            <th className="pb-3 font-medium">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {asns.map((asn) => (
                            <tr key={asn.id || asn.asn_number} className="border-b border-border/60 last:border-0 hover:bg-muted/20">
                              <td className="py-3 font-semibold text-teal">{asn.asn_number || asn.asnNumber || "—"}</td>
                              <td className="py-3 font-mono text-xs">{asn.po_number || asn.poNumber || "—"}</td>
                              <td className="py-3 font-medium">{asn.supplier_name || asn.supplierName || "—"}</td>
                              <td className="py-3 text-xs text-muted-foreground">{asn.dispatch_date || asn.created_at || "—"}</td>
                              <td className="py-3">
                                <StatusBadge status={asn.status || "In Transit"} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </SectionCard>
              </div>
            )}

            {/* TAB 5: DEMAND & MATERIAL REQUESTS */}
            {activeTab === "material-requests" && (
              <div className="space-y-4">
                <SectionCard
                  title="Warehouse Material Demand Register"
                  description="Material requests raised by warehouse and operational plants"
                  icon={ClipboardList}
                >
                  <div className="overflow-x-auto">
                    {materialRequests.length === 0 ? (
                      <p className="py-8 text-center text-sm text-muted-foreground">No material requests registered.</p>
                    ) : (
                      <table className="w-full min-w-[650px] text-left text-sm">
                        <thead>
                          <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                            <th className="pb-3 font-medium">Request ID</th>
                            <th className="pb-3 font-medium">Warehouse / Plant</th>
                            <th className="pb-3 font-medium">Department</th>
                            <th className="pb-3 font-medium">Requested By</th>
                            <th className="pb-3 font-medium">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {materialRequests.map((mr) => (
                            <tr key={mr.id} className="border-b border-border/60 last:border-0 hover:bg-muted/20">
                              <td className="py-3 font-semibold text-primary">{mr.requestNumber || mr.request_number || mr.id}</td>
                              <td className="py-3 font-medium">{mr.warehouse || "—"}</td>
                              <td className="py-3 text-xs text-muted-foreground">{mr.department || "—"}</td>
                              <td className="py-3 text-xs">{mr.requestedBy || mr.requested_by || "—"}</td>
                              <td className="py-3">
                                <StatusBadge status={mr.status || "Pending Approval"} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </SectionCard>
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
