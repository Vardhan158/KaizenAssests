import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  Calendar,
  Download,
  Eye,
  FileText,
  Filter,
  Loader2,
  Package,
  Search,
  Info,
} from "lucide-react";
import { AppShell, StatusBadge } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import { requireRole } from "@/lib/auth-utils";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/procurement/purchase-orders")({
  beforeLoad: () => requireRole("PROCUREMENT"),
  component: PurchaseOrders,
});

const statusOptions = [
  { value: "ALL", label: "All POs" },
  { value: "DRAFT", label: "Draft" },
  { value: "PENDING_FINANCE", label: "Pending Approval" },
  { value: "APPROVED", label: "Approved" },
  { value: "SENT", label: "Sent" },
  { value: "ACKNOWLEDGED", label: "Acknowledged" },
  { value: "PARTIALLY_RECEIVED", label: "Partially Received" },
  { value: "FULLY_RECEIVED", label: "Fully Received" },
  { value: "CLOSED", label: "Closed" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "REJECTED", label: "Rejected" },
];

const poFlow = [
  "DRAFT",
  "PENDING_FINANCE",
  "APPROVED",
  "SENT",
  "ACKNOWLEDGED",
  "PARTIALLY_RECEIVED",
  "FULLY_RECEIVED",
  "CLOSED",
];

function PurchaseOrders() {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  const formatCurrency = (value: unknown) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(Number(value) || 0);

  const fetchData = async () => {
    try {
      setLoading(true);
      const data = await api.getPurchaseOrders();
      setOrders(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Failed to fetch purchase orders:", error);
      toast.error("Failed to load purchase orders");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((po) => {
      const status = String(po.status || "").toUpperCase();
      const matchesStatus =
        statusFilter === "ALL" ||
        (statusFilter === "APPROVED" && status.includes("APPROV")) ||
        (statusFilter === "REJECTED" && status.includes("REJECT")) ||
        status === statusFilter;

      const matchesSearch =
        !q ||
        po.poNumber?.toLowerCase().includes(q) ||
        po.po_number?.toLowerCase().includes(q) ||
        po.supplierName?.toLowerCase().includes(q) ||
        po.supplier_name?.toLowerCase().includes(q) ||
        po.procurementOfficer?.toLowerCase().includes(q) ||
        po.rfqNumber?.toLowerCase().includes(q);

      return matchesStatus && matchesSearch;
    });
  }, [orders, search, statusFilter]);

  const downloadPo = async (po: any) => {
    try {
      setDownloadingId(po.id);
      await api.downloadPoPdf(po.id, po.poNumber || po.po_number);
      toast.success("Purchase Order PDF generated and downloaded");
    } catch (e: any) {
      toast.error("Failed to generate PDF", {
        description: e?.message || "Please try again.",
      });
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <AppShell
      title={
        <div className="flex items-center gap-2">
          <span>Purchase Orders</span>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Purchase Orders Info"
                className="inline-flex items-center text-muted-foreground hover:text-foreground transition-colors"
              >
                <Info className="size-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-3 text-xs font-normal text-popover-foreground rounded-xl shadow-lg" align="start">
              Approved purchase orders issued to suppliers.
            </PopoverContent>
          </Popover>
        </div>
      }
      subtitle="All supplier purchase orders, finance decisions, and downloadable PO PDFs"
    >
      <div className="space-y-6">
        <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-card/70 p-3 shadow-sm sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search PO number, supplier, RFQ, officer..."
              className="h-11 w-full rounded-xl border border-border bg-background pl-10 pr-4 text-sm outline-none transition focus:border-primary/40 focus:ring-2 focus:ring-primary/15"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="hidden size-4 text-muted-foreground sm:block" />
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="h-11 w-full rounded-xl border border-border bg-background px-3 text-xs font-bold outline-none transition focus:border-primary/40 focus:ring-2 focus:ring-primary/15 sm:w-44"
            >
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed border-border/60 bg-muted/10">
            <Loader2 className="size-8 animate-spin text-primary" />
          </div>
        ) : filteredOrders.length === 0 ? (
          <Card className="flex h-64 flex-col items-center justify-center border-dashed border-border/50 bg-muted/20 p-6 text-center">
            <FileText className="mb-4 size-12 text-muted-foreground/30" />
            <h3 className="text-lg font-semibold text-muted-foreground">No purchase orders found</h3>
            <p className="text-sm text-muted-foreground/70">
              Try a different search or finalize a supplier selection from quotations.
            </p>
            <Button variant="outline" className="mt-4 rounded-xl" asChild>
              <Link to="/procurement/rfqs">View active RFQs</Link>
            </Button>
          </Card>
        ) : (
          <div className="grid gap-4">
            {filteredOrders.map((po) => {
              const poNumber = po.poNumber || po.po_number || "PO Draft";
              const supplierName = po.supplierName || po.supplier_name || "Independent Supplier";
              const totalAmount = po.totalAmount ?? po.total_amount;
              const itemCount = po.items?.length || po.lines?.length || 0;
              const deliveryDate = po.expectedDeliveryDate || po.expected_delivery_date || "Not scheduled";
              const currentStep = Math.max(0, poFlow.indexOf(String(po.status || "").toUpperCase()));
              const isDownloading = downloadingId === po.id;

              return (
                <Card
                  key={po.id}
                  className="group overflow-hidden border-border/50 bg-card transition-all hover:border-primary/35 hover:shadow-soft"
                >
                  <div className="grid gap-4 p-4 lg:grid-cols-[1fr_auto] lg:items-center lg:p-5">
                    <div className="flex min-w-0 gap-4">
                      <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-teal-500/20 to-primary/20 text-teal-700 ring-1 ring-teal-500/15">
                        <FileText className="size-6" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-mono text-base font-black tracking-tight text-foreground">
                            {poNumber}
                          </h3>
                          <StatusBadge status={po.status || "DRAFT"} />
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1.5 font-medium">
                            <Building2 className="size-3.5" />
                            {supplierName}
                          </span>
                          <span className="flex items-center gap-1.5">
                            <Package className="size-3.5" />
                            {itemCount} line items
                          </span>
                          <span className="flex items-center gap-1.5">
                            <Calendar className="size-3.5" />
                            {deliveryDate}
                          </span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <span className="rounded-lg border border-teal-500/20 bg-teal-500/10 px-2.5 py-1 text-xs font-black text-teal-700">
                            {formatCurrency(totalAmount)}
                          </span>
                          <span className="rounded-lg border border-border/60 bg-muted/35 px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                            {po.warehouseId || po.deliveryWarehouseName || "Main Warehouse"}
                          </span>
                          {(po.rfqNumber || po.rfq_id) && (
                            <span className="rounded-lg border border-primary/20 bg-primary-soft/20 px-2.5 py-1 font-mono text-xs font-bold text-primary">
                              Ref: {po.rfqNumber || String(po.rfq_id).substring(0, 8)}
                            </span>
                          )}
                        </div>
                        <div className="mt-4 grid grid-cols-4 gap-1 text-[10px] font-bold uppercase text-muted-foreground sm:grid-cols-7">
                          {poFlow.map((step, index) => (
                            <span
                              key={step}
                              className={cn(
                                "rounded-md border px-2 py-1 text-center",
                                index <= currentStep
                                  ? "border-primary/25 bg-primary-soft/20 text-primary"
                                  : "border-border/60 bg-muted/20",
                              )}
                            >
                              {step.replace("PENDING_FINANCE", "Approval").replaceAll("_", " ")}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-2 border-t border-border/50 pt-4 sm:flex sm:items-center lg:border-0 lg:pt-0">
                      <Button variant="outline" className="h-10 rounded-xl font-semibold" asChild>
                        <Link to="/purchase-order" search={{ poId: po.id }}>
                          <Eye className="mr-1.5 size-3.5" />
                          View
                        </Link>
                      </Button>
                      <Button
                        className="h-10 rounded-xl bg-primary font-semibold shadow-glow hover:bg-primary/90"
                        disabled={isDownloading}
                        onClick={() => downloadPo(po)}
                      >
                        {isDownloading ? (
                          <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                        ) : (
                          <Download className="mr-1.5 size-3.5" />
                        )}
                        Download PDF
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
