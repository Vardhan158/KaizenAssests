import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useRef } from "react";
import { AppShell } from "@/components/wms/app-shell";
import { requireRole } from "@/lib/auth-utils";
import {
  api,
  type AssemblyFinishedGoodItem,
  type AssemblyFinishedGoodDetail,
} from "@/lib/api-client";
import QRCode from "qrcode";
import {
  Boxes,
  Calendar,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Factory,
  Layers,
  LayoutDashboard,
  MapPin,
  PackageCheck,
  Printer,
  QrCode,
  RefreshCw,
  Search,
  ShieldCheck,
  Tag,
  Warehouse,
  X,
  ArrowRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/assembly/finished-goods")({
  beforeLoad: () => requireRole(["ASSEMBLY_MANAGER", "ASSEMBLY", "ADMIN", "SUPERUSER", "STORE_MANAGER", "QUALITY"]),
  head: () => ({ meta: [{ title: "Finished Goods · KaizenX" }] }),
  component: AssemblyFinishedGoodsPage,
});

function AssemblyFinishedGoodsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<AssemblyFinishedGoodItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");

  // Print Label Modal State
  const [selectedFg, setSelectedFg] = useState<AssemblyFinishedGoodDetail | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [labelLoading, setLabelLoading] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  const fetchItems = async (isManual = false) => {
    if (isManual) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await api.getAssemblyFinishedGoods({
        search: search || undefined,
      });
      setItems(res || []);
    } catch (err: any) {
      toast.error("Failed to load Finished Goods: " + (err.message || "Unknown error"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, []);

  const handleOpenPrintModal = async (item: AssemblyFinishedGoodItem) => {
    try {
      setLabelLoading(true);
      const detail = await api.getAssemblyFinishedGoodsDetail(item.id);
      setSelectedFg(detail);

      const qrText = detail.qr_code || `FG|${detail.product_code}|${detail.order_number}|QTY:${detail.quantity}`;
      const url = await QRCode.toDataURL(qrText, {
        width: 256,
        margin: 1,
        color: {
          dark: "#0f172a",
          light: "#ffffff",
        },
      });
      setQrDataUrl(url);
    } catch (err: any) {
      toast.error("Failed to generate label QR: " + (err.message || "Unknown error"));
    } finally {
      setLabelLoading(false);
    }
  };

  const handlePrint = () => {
    if (!printRef.current) return;
    const printContents = printRef.current.innerHTML;
    const printWindow = window.open("", "_blank", "width=600,height=600");
    if (!printWindow) {
      toast.error("Please allow popups to print the label");
      return;
    }
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Finished Good Label - ${selectedFg?.serial_number || "FG"}</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 16px; background: #fff; color: #000; }
            .label-box { border: 2px solid #000; padding: 16px; width: 380px; margin: 0 auto; box-sizing: border-box; }
            .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 12px; }
            .header h2 { margin: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; }
            .header p { margin: 2px 0 0 0; font-size: 10px; color: #555; }
            .qr-center { text-align: center; margin: 12px 0; }
            .qr-center img { width: 140px; height: 140px; }
            .field-row { display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 11px; }
            .field-label { font-weight: bold; }
            .field-val { font-family: monospace; font-weight: bold; }
            .stamp { text-align: center; border: 1px dashed #16a34a; color: #16a34a; padding: 4px; font-size: 11px; font-weight: bold; margin-top: 10px; }
          </style>
        </head>
        <body>
          <div class="label-box">
            ${printContents}
          </div>
          <script>
            window.onload = function() { window.print(); window.close(); }
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  // Quick stats
  const totalBatches = items.length;
  const totalUnits = items.reduce((acc, curr) => acc + curr.quantity, 0);

  // Filtered list
  const filteredItems = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase().trim();
    return items.filter(
      (fg) =>
        fg.order_number?.toLowerCase().includes(q) ||
        fg.product_name?.toLowerCase().includes(q) ||
        fg.product_code?.toLowerCase().includes(q) ||
        fg.serial_number?.toLowerCase().includes(q) ||
        fg.location_code?.toLowerCase().includes(q)
    );
  }, [items, search]);

  // Workflow Quick Link Cards
  const workflowShortcuts = [
    {
      title: "Assembly Dashboard",
      subtitle: "Floor monitoring & KPI metrics",
      icon: LayoutDashboard,
      to: "/assembly-dashboard",
      tone: "blue",
    },
    {
      title: "Work Orders",
      subtitle: "Active manufacturing run pipeline",
      icon: Layers,
      to: "/assembly/orders",
      tone: "amber",
    },
    {
      title: "Production Lines",
      subtitle: "Active line execution & build stages",
      icon: Factory,
      to: "/assembly/production",
      tone: "cyan",
    },
    {
      title: "Quality Inspections",
      subtitle: "Batch verification & QC checks",
      icon: ShieldCheck,
      to: "/assembly/quality",
      tone: "purple",
    },
  ];

  return (
    <AppShell
      title="Finished Goods"
      subtitle="Assembly FG storage tracking, warehouse pickup readiness, and QR label generation"
      actions={
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-card border border-border/80 shadow-2xs text-xs font-medium text-muted-foreground">
            <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
            FG Staging Synced
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate({ to: "/assembly-dashboard" as any })}
            className="rounded-xl text-xs gap-1.5 shadow-2xs hover:bg-muted/80 font-medium"
          >
            <LayoutDashboard className="size-3.5 text-primary" />
            Dashboard
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate({ to: "/assembly/quality" as any })}
            className="rounded-xl text-xs gap-1.5 shadow-2xs hover:bg-muted/80 font-medium"
          >
            <ShieldCheck className="size-3.5 text-purple-500" />
            Quality Checks
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchItems(true)}
            disabled={refreshing}
            className="rounded-xl text-xs gap-1.5 shadow-2xs hover:bg-muted/80"
          >
            <RefreshCw className={cn("size-3.5", refreshing && "animate-spin text-primary")} />
            Refresh
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* 4 Top KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
          {/* Card 1: Total Units */}
          <div className="group relative overflow-hidden rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 via-card to-card p-4 shadow-2xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-soft hover:border-emerald-500/35 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Total Units Stored
              </span>
              <div className="grid size-9 place-items-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shadow-2xs">
                <PackageCheck className="size-4" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-3xl font-black tracking-tight text-emerald-600 dark:text-emerald-400 tabular-nums">
                {loading ? "..." : totalUnits}{" "}
                <span className="text-xs font-normal text-muted-foreground">PCS</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>QC Certified & stored</span>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                  Ready
                </span>
              </div>
            </div>
          </div>

          {/* Card 2: Finished Batches */}
          <div className="group relative overflow-hidden rounded-2xl border border-blue-500/20 bg-gradient-to-br from-blue-500/10 via-card to-card p-4 shadow-2xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-soft hover:border-blue-500/35 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Finished Batches
              </span>
              <div className="grid size-9 place-items-center rounded-xl bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/20 shadow-2xs">
                <Boxes className="size-4" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-3xl font-black tracking-tight text-foreground tabular-nums">
                {loading ? "..." : totalBatches}
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>Tracked in database</span>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-blue-500/10 text-blue-700 dark:text-blue-300">
                  Batches
                </span>
              </div>
            </div>
          </div>

          {/* Card 3: Storage Location */}
          <div className="group relative overflow-hidden rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/10 via-card to-card p-4 shadow-2xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-soft hover:border-cyan-500/35 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Floor Staging Zone
              </span>
              <div className="grid size-9 place-items-center rounded-xl bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20 shadow-2xs">
                <MapPin className="size-4" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-lg font-bold tracking-tight text-foreground font-mono truncate">
                ASSEMBLY-STORAGE-01
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>Physical staging rack</span>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
                  Staging
                </span>
              </div>
            </div>
          </div>

          {/* Card 4: Dispatch Readiness */}
          <div className="group relative overflow-hidden rounded-2xl border border-purple-500/20 bg-gradient-to-br from-purple-500/10 via-card to-card p-4 shadow-2xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-soft hover:border-purple-500/35 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                WH Transfer Status
              </span>
              <div className="grid size-9 place-items-center rounded-xl bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/20 shadow-2xs">
                <ShieldCheck className="size-4" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
                AVAILABLE (100%)
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>Ready for pickup</span>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-purple-500/10 text-purple-700 dark:text-purple-300">
                  Pickup
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Workflow Quick Links */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {workflowShortcuts.map((sc) => {
            const Icon = sc.icon;
            return (
              <Link
                key={sc.to}
                to={sc.to as any}
                className="group relative flex items-center justify-between p-3.5 rounded-xl border border-border/80 bg-card hover:border-primary/40 hover:bg-muted/40 transition-all duration-200 shadow-2xs"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={cn(
                      "grid size-9 shrink-0 place-items-center rounded-lg border",
                      sc.tone === "blue" && "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/20",
                      sc.tone === "amber" && "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20",
                      sc.tone === "cyan" && "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-cyan-500/20",
                      sc.tone === "purple" && "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/20"
                    )}
                  >
                    <Icon className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-foreground group-hover:text-primary transition-colors">
                      {sc.title}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">{sc.subtitle}</div>
                  </div>
                </div>
                <ArrowRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary shrink-0 pl-1" />
              </Link>
            );
          })}
        </div>

        {/* Main Work Center Table Card */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-4">
          {/* Header & Controls */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border/60">
            <div>
              <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                <PackageCheck className="size-4 text-emerald-600" />
                Finished Goods Vault
              </h2>
              <p className="text-xs text-muted-foreground">
                Certified finished products awaiting physical transfer or dispatch to main warehouse
              </p>
            </div>

            {/* Search input */}
            <div className="relative min-w-[260px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search product, order # or serial..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 w-full rounded-lg border border-border bg-card pl-8 pr-7 text-xs outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary/40"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Table Content */}
          {loading ? (
            <div className="py-16 text-center space-y-3">
              <RefreshCw className="size-6 animate-spin text-primary mx-auto opacity-70" />
              <p className="text-xs text-muted-foreground">Loading Finished Goods inventory...</p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="py-14 text-center">
              <div className="grid size-12 place-items-center rounded-2xl bg-muted mx-auto mb-3 text-muted-foreground">
                <PackageCheck className="size-6 opacity-60" />
              </div>
              <p className="text-sm font-semibold text-foreground">
                {search ? "No finished goods match your search" : "No Finished Goods in storage yet"}
              </p>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                {search
                  ? "Try searching by another product name or order number."
                  : "Completed orders certified by Quality Inspection are automatically deposited into this vault."}
              </p>
              <div className="mt-4 flex items-center justify-center gap-2">
                <Button
                  size="sm"
                  className="rounded-xl text-xs gap-1.5 font-semibold"
                  onClick={() => navigate({ to: "/assembly/quality" as any })}
                >
                  <ShieldCheck className="size-3.5" />
                  View Quality Checks
                </Button>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto -mx-5 px-5">
              <table className="w-full text-left text-sm mt-1">
                <thead>
                  <tr className="border-b border-border/60 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    <th className="py-3 px-3">Order Number</th>
                    <th className="py-3 px-3">Product Details</th>
                    <th className="py-3 px-3">FG Quantity</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3">Floor Location</th>
                    <th className="py-3 px-3">Serial / Identity</th>
                    <th className="py-3 px-3">Certified Date</th>
                    <th className="py-3 px-3 text-right">Label Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {filteredItems.map((fg) => (
                    <tr key={fg.id} className="group hover:bg-muted/40 transition-colors">
                      {/* Order Number */}
                      <td className="py-3.5 px-3 font-mono font-bold text-foreground text-xs group-hover:text-primary transition-colors">
                        {fg.order_number}
                      </td>

                      {/* Product */}
                      <td className="py-3.5 px-3">
                        <div className="font-semibold text-foreground text-xs">{fg.product_name}</div>
                        <div className="text-[11px] text-muted-foreground font-mono mt-0.5">
                          {fg.product_code}
                        </div>
                      </td>

                      {/* Quantity */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <span className="font-bold text-foreground text-xs tabular-nums">
                          {fg.quantity}
                        </span>{" "}
                        <span className="text-[11px] text-muted-foreground font-medium">
                          {fg.uom}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25">
                          <span className="size-1.5 rounded-full bg-emerald-500" />
                          AVAILABLE
                        </span>
                      </td>

                      {/* Floor Location */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-mono text-xs bg-muted text-foreground border border-border/60">
                          <MapPin className="size-3 text-muted-foreground" />
                          {fg.location_code || "ASSEMBLY-01"}
                        </span>
                      </td>

                      {/* Serial / Identity */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <span className="font-mono text-xs text-muted-foreground">
                          {fg.serial_number || "BATCH-" + fg.order_number}
                        </span>
                      </td>

                      {/* Certified Date */}
                      <td className="py-3.5 px-3 whitespace-nowrap text-xs text-muted-foreground">
                        {fg.posted_at ? new Date(fg.posted_at).toLocaleDateString() : "Today"}
                      </td>

                      {/* Label Actions */}
                      <td className="py-3.5 px-3 text-right whitespace-nowrap">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2.5 text-xs font-semibold gap-1.5 rounded-lg group-hover:bg-primary group-hover:text-primary-foreground group-hover:border-primary transition-all shadow-2xs"
                          onClick={() => handleOpenPrintModal(fg)}
                        >
                          <QrCode className="size-3.5" />
                          Print QR Label
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ========================================================================= */}
        {/* PRINT QR LABEL MODAL */}
        {/* ========================================================================= */}
        <Dialog open={!!selectedFg} onOpenChange={(open) => !open && setSelectedFg(null)}>
          <DialogContent className="max-w-md p-6 rounded-2xl">
            <DialogHeader className="border-b border-border/60 pb-3">
              <DialogTitle className="flex items-center gap-2 text-foreground text-lg font-bold">
                <Tag className="size-5 text-primary" />
                Finished Goods QR Identification Label
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-1">
                Print industrial QR identification barcode label for batch palletizing and warehouse pickup.
              </DialogDescription>
            </DialogHeader>

            {labelLoading ? (
              <div className="py-12 text-center text-xs text-muted-foreground space-y-2">
                <RefreshCw className="size-6 animate-spin text-primary mx-auto" />
                <p>Generating barcode & QR matrix...</p>
              </div>
            ) : selectedFg ? (
              <div className="space-y-4 pt-2">
                {/* Visual Label Preview */}
                <div
                  ref={printRef}
                  className="rounded-2xl border-2 border-dashed border-border bg-card p-5 text-card-foreground shadow-2xs space-y-3"
                >
                  <div className="border-b-2 border-border pb-2 text-center">
                    <span className="text-[10px] font-black uppercase tracking-widest text-primary">
                      KaizenX Assembly Execution
                    </span>
                    <h3 className="text-sm font-black text-foreground uppercase tracking-wide mt-0.5">
                      Finished Good Batch Label
                    </h3>
                  </div>

                  {qrDataUrl && (
                    <div className="flex justify-center py-1">
                      <img
                        src={qrDataUrl}
                        alt="QR Matrix"
                        className="size-32 rounded-lg border border-border/80 shadow-2xs"
                      />
                    </div>
                  )}

                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between border-b border-border/40 pb-1">
                      <span className="text-muted-foreground">Product:</span>
                      <span className="font-bold text-foreground text-right">
                        {selectedFg.product_name}
                      </span>
                    </div>
                    <div className="flex justify-between border-b border-border/40 pb-1">
                      <span className="text-muted-foreground">Item SKU:</span>
                      <span className="font-mono font-bold text-foreground">
                        {selectedFg.product_code}
                      </span>
                    </div>
                    <div className="flex justify-between border-b border-border/40 pb-1">
                      <span className="text-muted-foreground">Work Order:</span>
                      <span className="font-mono font-bold text-foreground">
                        {selectedFg.order_number}
                      </span>
                    </div>
                    <div className="flex justify-between border-b border-border/40 pb-1">
                      <span className="text-muted-foreground">Quantity:</span>
                      <span className="font-bold text-foreground font-mono">
                        {selectedFg.quantity} {selectedFg.uom}
                      </span>
                    </div>
                    <div className="flex justify-between border-b border-border/40 pb-1">
                      <span className="text-muted-foreground">Staging Rack:</span>
                      <span className="font-mono text-foreground">{selectedFg.location_code}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Certified:</span>
                      <span className="text-foreground">
                        {selectedFg.posted_at ? new Date(selectedFg.posted_at).toLocaleDateString() : "Today"}
                      </span>
                    </div>
                  </div>

                  <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-2 text-center text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                    ✓ QC CERTIFIED - READY FOR WAREHOUSE
                  </div>
                </div>
              </div>
            ) : null}

            <DialogFooter className="pt-2">
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl"
                onClick={() => setSelectedFg(null)}
              >
                Close
              </Button>
              <Button
                size="sm"
                onClick={handlePrint}
                className="rounded-xl gap-2 font-semibold shadow-soft"
              >
                <Printer className="size-3.5" />
                Print Physical Label
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
