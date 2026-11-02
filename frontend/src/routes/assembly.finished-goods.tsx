import { FgLoading, FgSections } from "@/components/wms/fg-sections";
import { InformationTooltip } from "@/components/ui/information-tooltip";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Fragment, useCallback, useEffect, useMemo, useState, useRef } from "react";
import { AppShell } from "@/components/wms/app-shell";
import { StatCard } from "@/components/wms/primitives";
import { FgQrInput } from "@/components/wms/fg-qr-input";
import {
  OriginalMaterialQrPreview,
  PrintAllMaterialQrs,
} from "@/components/wms/original-material-qr";
import { requireRole } from "@/lib/auth-utils";
import {
  api,
  type AssemblyFinishedGoodItem,
  type AssemblyFinishedGoodDetail,
  type AssemblyFinishedGoodsTraceability,
  type AssemblyFinishedGoodsTraceabilityMaterial,
} from "@/lib/api-client";
import QRCode from "qrcode";
import {
  Copy,
  Download,
  LayoutDashboard,
  Eye,
  Factory,
  Layers3,
  LockKeyhole,
  PackageCheck,
  Printer,
  QrCode,
  RefreshCw,
  Search,
  ShieldCheck,
  Tag,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  beforeLoad: () =>
    requireRole(["ASSEMBLY_MANAGER", "ASSEMBLY", "ADMIN", "SUPERUSER", "WAREHOUSE_OPERATOR", "QUALITY"]),
  head: () => ({ meta: [{ title: "Finished Goods · KaizenAssests" }] }),
  component: AssemblyFinishedGoodsPage,
});

function TraceabilityInfo({
  label,
  value,
  mono = false,
}: {
  label: string;
  value?: string | number | null;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn("break-words font-medium text-foreground", mono && "font-mono")}>
        {value == null || value === "" ? "Unavailable" : value}
      </dd>
    </div>
  );
}

// Keep all API quantity precision; the default locale formatter rounds to 3 decimals.
function traceabilityQuantity(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 20 });
}

function TraceabilityCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border/70 bg-white p-4">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">
        {value.toLocaleString()}
      </p>
    </div>
  );
}

function TraceabilityStatus({ status }: { status: string }) {
  const styles: Record<string, string> = {
    COMPLETE: "border-emerald-200 bg-emerald-50 text-emerald-800",
    VERIFIED: "border-emerald-200 bg-emerald-50 text-emerald-800",
    PARTIAL: "border-amber-200 bg-amber-50 text-amber-800",
    UNLINKED: "border-slate-300 bg-slate-100 text-slate-700",
    NOT_AVAILABLE: "border-slate-200 bg-slate-50 text-slate-600",
  };
  return (
    <Badge
      variant="outline"
      className={cn("mt-2 rounded-full font-semibold", styles[status] || styles.NOT_AVAILABLE)}
    >
      {status}
    </Badge>
  );
}

function AssemblyFinishedGoodsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<AssemblyFinishedGoodItem[]>([]);
  const [detailsFg, setDetailsFg] = useState<AssemblyFinishedGoodItem | null>(null);
  const [traceabilityFg, setTraceabilityFg] = useState<AssemblyFinishedGoodItem | null>(null);
  const [traceabilityData, setTraceabilityData] =
    useState<AssemblyFinishedGoodsTraceability | null>(null);
  const [traceabilityLoading, setTraceabilityLoading] = useState(false);
  const [traceabilityError, setTraceabilityError] = useState<string | null>(null);
  const [selectedMaterial, setSelectedMaterial] =
    useState<AssemblyFinishedGoodsTraceabilityMaterial | null>(null);
  const [qrMaterial, setQrMaterial] = useState<AssemblyFinishedGoodsTraceabilityMaterial | null>(
    null,
  );
  const [traceabilityRefresh, setTraceabilityRefresh] = useState(0);
  const [scanFg, setScanFg] = useState<AssemblyFinishedGoodItem | null>(null);
  const [scannedQr, setScannedQr] = useState("");
  const [verifyingQr, setVerifyingQr] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [expandedBatches, setExpandedBatches] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");

  // Print Label Modal State
  const [selectedFg, setSelectedFg] = useState<AssemblyFinishedGoodDetail | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [labelLoading, setLabelLoading] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);
  const traceabilityFgId = traceabilityFg?.id;

  useEffect(() => {
    setSelectedMaterial(null);
    setQrMaterial(null);
    if (!traceabilityFgId) {
      setTraceabilityData(null);
      setTraceabilityError(null);
      setTraceabilityLoading(false);
      return;
    }

    let cancelled = false;
    setTraceabilityData(null);
    setTraceabilityError(null);
    setTraceabilityLoading(true);
    void api
      .getAssemblyFinishedGoodsTraceability(traceabilityFgId)
      .then((response) => {
        if (!cancelled) setTraceabilityData(response);
      })
      .catch((error: Error & { status?: number }) => {
        if (cancelled) return;
        if (error.status === 401)
          setTraceabilityError(
            "Your session has expired. Sign in again to view material traceability.",
          );
        else if (error.status === 403)
          setTraceabilityError(
            "You do not have permission to view material traceability for this finished-goods batch.",
          );
        else if (error.status === 400)
          setTraceabilityError(
            "This finished-goods identifier is invalid. Refresh the inventory and select the batch again.",
          );
        else if (error.status === 404)
          setTraceabilityError(
            "This finished-goods record could not be found. Refresh the inventory and try again.",
          );
        else
          setTraceabilityError(
            "Material traceability could not be loaded. Check your connection and try again.",
          );
      })
      .finally(() => {
        if (!cancelled) setTraceabilityLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [traceabilityFgId, traceabilityRefresh]);

  const verifyTraceabilityQr = async () => {
    if (!scanFg || !scannedQr.trim() || verifyingQr) return;
    setVerifyingQr(true);
    setScanError(null);
    try {
      // Preserve the existing verification endpoint and original scanned payload.
      const result = await api.verifyAssemblyFinishedGoodsQr(scanFg.id, scannedQr);
      if (result.status !== "LABEL_VERIFIED" || result.fg_id !== scanFg.id) {
        setScanError("The QR could not be verified for this finished-goods batch.");
        return;
      }
      setTraceabilityFg(scanFg);
      setScanFg(null);
    } catch (error) {
      const status = (error as { status?: number })?.status;
      setScanError(
        status === 401
          ? "Your session has expired. Sign in again to verify this QR."
          : status === 403
            ? "You do not have permission to verify this finished-goods QR."
            : status === 422
              ? "This QR does not match the selected finished-goods batch. Scan its original label."
              : status === 409
                ? "This batch is not eligible for QR verification. Select a QC-approved batch."
                : "The QR could not be verified. Check your connection and try again.",
      );
    } finally {
      setVerifyingQr(false);
    }
  };

  const fetchItems = useCallback(async (isManual = false, background = false) => {
    if (isManual) setRefreshing(true);
    else if (!background) setLoading(true);
    try {
      const res = await api.getAssemblyFinishedGoods({
        group_by: "product",
      } as any);
      setItems(res || []);
    } catch (err: any) {
      if (!background)
        toast.error("Failed to load Finished Goods: " + (err.message || "Unknown error"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchItems();
    const sync = () => {
      if (document.visibilityState !== "hidden") void fetchItems(false, true);
    };
    const timer = window.setInterval(sync, 15000);
    window.addEventListener("focus", sync);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", sync);
    };
  }, [fetchItems]);

  const handleOpenPrintModal = async (item: AssemblyFinishedGoodItem) => {
    try {
      setLabelLoading(true);
      const detail = await api.getAssemblyFinishedGoodsDetail(item.id);
      setSelectedFg(detail);

      const qrText =
        detail.qr_code || `FG|${detail.product_code}|${detail.order_number}|QTY:${detail.quantity}`;
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

  const handleDownloadLabel = () => {
    if (!qrDataUrl || !selectedFg) return;
    const link = document.createElement("a");
    link.href = qrDataUrl;
    link.download = `${selectedFg.batch_number || selectedFg.serial_number || "finished-good"}-qr.png`;
    link.click();
  };

  // Filtered list
  const filteredItems = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase().trim();
    return items.filter(
      (fg: any) =>
        fg.order_number?.toLowerCase().includes(q) ||
        fg.product_name?.toLowerCase().includes(q) ||
        fg.product_code?.toLowerCase().includes(q) ||
        fg.serial_number?.toLowerCase().includes(q) ||
        fg.batch_number?.toLowerCase().includes(q) ||
        fg.location_code?.toLowerCase().includes(q) ||
        fg.batches?.some((batch: any) =>
          [batch.batch_number, batch.order_number, batch.serial_number, batch.location_code].some(
            (value) => value?.toLowerCase().includes(q),
          ),
        ),
    );
  }, [items, search]);
  const [listPage, setListPage] = useState(1);
  const listPageCount = Math.max(1, Math.ceil(filteredItems.length / 10));
  const currentListPage = Math.min(listPage, listPageCount);
  const listStart = (currentListPage - 1) * 10;
  const pagedRows = filteredItems.slice(listStart, listStart + 10);
  useEffect(() => { setListPage(1); }, [search]);
  useEffect(() => { setListPage(page => Math.min(page, listPageCount)); }, [listPageCount]);


  const detailBatches = useMemo(() => {
    const timestamp = (batch: AssemblyFinishedGoodItem) => {
      const value = Date.parse(batch.posted_at || "");
      return Number.isFinite(value) ? value : Infinity;
    };
    return detailsFg
      ? [...((detailsFg as any).batches || [detailsFg])].sort(
          (a, b) => timestamp(a) - timestamp(b) || a.id.localeCompare(b.id),
        )
      : [];
  }, [detailsFg]);

  return (
    <AppShell
      title="Finished Goods Records"
      subtitle="Assembly FG storage tracking, customer dispatch readiness, and QR label generation"
      actions={
        <div className="flex flex-wrap items-center gap-2.5">
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
          <Button data-refresh-control="true" aria-label="Refresh" title="Refresh"
            variant="outline"
            size="sm"
            onClick={() => fetchItems(true)}
            disabled={refreshing}
            className="rounded-xl text-xs gap-1.5 shadow-2xs hover:bg-muted/80"
          >
            <RefreshCw className={cn("size-3.5", refreshing && "animate-spin text-primary")} /></Button>
        </div>
      }
    >
      <div className="min-w-0 space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard compact label="Products" value={items.length.toLocaleString()} delta="Finished-good SKUs" icon={Layers3} tone="primary" />
          <StatCard compact label="Produced" value={items.reduce((sum, item) => sum + Number((item as any).produced_quantity ?? item.quantity ?? 0), 0).toLocaleString()} delta="Total manufactured quantity" icon={Factory} tone="teal" />
          <StatCard compact label="Available" value={items.reduce((sum, item) => sum + Number((item as any).available_quantity ?? item.quantity ?? 0), 0).toLocaleString()} delta="Ready for customer dispatch" icon={PackageCheck} tone="success" />
          <StatCard compact label="Reserved" value={items.reduce((sum, item) => sum + Number((item as any).reserved_quantity ?? 0), 0).toLocaleString()} delta="Allocated finished-goods stock" icon={LockKeyhole} tone="warning" />
        </div>
        <FgLoading />
        {/* Main Work Center Table Card */}
        <div className="min-w-0 rounded-2xl border border-border/70 bg-card p-5 shadow-soft space-y-4">
          {/* Header & Controls */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border/60">
            <div className="space-y-1">
              <h2 className="flex items-center gap-2 text-lg font-semibold"><PackageCheck className="size-5 text-primary" />Finished goods inventory</h2>
              <p className="text-sm text-muted-foreground">
              Showing <strong className="text-foreground">{filteredItems.length}</strong> of{" "}
              {items.length} products
              </p>
            </div>

            {/* Search input */}
            <div className="relative w-full sm:w-96 sm:shrink-0">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <input
                type="text"
                aria-label="Search finished goods"
                placeholder="Search batch, product or order..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-11 w-full rounded-xl border border-border bg-card pl-9 pr-8 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary/40"
              />
              {search && (
                <button
                  aria-label="Clear search"
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
                {search
                  ? "No finished goods match your search"
                  : "No Finished Goods in storage yet"}
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
            <div className="overflow-x-auto rounded-xl border border-border/70">
              <table className="w-full min-w-[980px] table-fixed text-left text-sm [&_th]:align-middle [&_td]:align-middle [&_td]:tabular-nums">
                <colgroup><col className="w-[23%]" /><col className="w-[11%]" /><col className="w-[11%]" /><col className="w-[11%]" /><col className="w-[11%]" /><col className="w-[20%]" /><col className="w-[13%]" /></colgroup>
                <thead className="bg-muted/50">
                  <tr className="border-b border-border/70 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <th scope="col" className="py-3 px-4">
                      Product
                    </th>
                    <th scope="col" className="py-3 px-4 text-right">
                      Produced
                    </th>
                    <th scope="col" className="py-3 px-4 text-right">
                      Available
                    </th>
                    <th scope="col" className="py-3 px-4 text-right">
                      Reserved
                    </th>
                    <th scope="col" className="py-3 px-4 text-right">
                      Dispatched
                    </th>
                    <th scope="col" className="py-3 px-4">
                      Status
                      <InformationTooltip help="finishedGoods" />
                    </th>
                    <th scope="col" className="py-3 px-4 text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {pagedRows.map((fg) => {
                    const available = Number(fg.available_quantity ?? fg.quantity ?? 0);
                    const reserved = Number(fg.reserved_quantity ?? 0);
                    const dispatched = Number(fg.dispatched_quantity ?? 0);
                    const productStatus = available > 0 ? "AVAILABLE" : reserved > 0 ? "RESERVED" : "OUT OF STOCK";
                    return (
                    <tr key={fg.id} className="group hover:bg-muted/40 transition-colors">
                      {/* Product */}
                      <td className="py-4 px-4">
                        <div className="font-semibold text-foreground">
                          {fg.product_name}
                        </div>
                        <div className="text-[11px] text-muted-foreground font-mono mt-0.5">
                          {fg.product_code}
                        </div>
                      </td>

                      {[
                        (fg as any).produced_quantity ?? fg.quantity,
                        (fg as any).available_quantity ?? fg.quantity,
                        (fg as any).reserved_quantity ?? 0,
                        (fg as any).dispatched_quantity ?? 0,
                      ].map((quantity, index) => (
                        <td
                          key={index}
                          className="py-3.5 px-4 text-right whitespace-nowrap tabular-nums font-semibold"
                        >
                          {quantity.toLocaleString()}{" "}
                          <span className="text-muted-foreground font-normal">{fg.uom}</span>
                        </td>
                      ))}

                      {/* Status */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                            available > 0
                              ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                              : reserved > 0
                              ? "border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300"
                              : dispatched > 0
                              ? "border-slate-500/25 bg-slate-500/10 text-slate-700 dark:text-slate-300"
                              : "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300",
                          )}
                        >
                          {productStatus}
                        </span>
                        {((fg.batches || [fg]) as any[]).filter(b => b.main_fg_id).map(b => <p key={b.id} className="mt-1 text-[11px]">{b.main_fg_id}: {b.dispatch_status} ({b.dispatched_sections}/8)</p>)}
                      </td>

                      {/* Label Actions */}
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 rounded-xl px-3 text-xs gap-1.5"
                            onClick={() => {
                              setExpandedBatches([]);
                              setDetailsFg(fg);
                            }}
                          >
                            <Eye className="size-3.5" /> View Details
                          </Button>
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {!loading && filteredItems.length > 0 && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-sm">
            <p className="text-muted-foreground">Showing {listStart + 1} to {Math.min(listStart + 10, filteredItems.length)} of {filteredItems.length} products</p>
            <nav aria-label="Products pagination" className="flex items-center gap-3">
              <Button className="rounded-xl" size="sm" variant="outline" disabled={currentListPage === 1} onClick={() => setListPage(currentListPage - 1)}>Previous</Button>
              <span className="min-w-16 text-center text-xs font-medium">{currentListPage} / {listPageCount}</span>
              <Button className="rounded-xl" size="sm" variant="outline" disabled={currentListPage === listPageCount} onClick={() => setListPage(currentListPage + 1)}>Next</Button>
            </nav>
          </div>}
        </div>

        {/* ========================================================================= */}
        <Dialog open={!!detailsFg} onOpenChange={(open) => !open && setDetailsFg(null)}>
          <DialogContent className="flex w-[calc(100vw-2rem)] max-w-6xl max-h-[90dvh] flex-col gap-0 overflow-hidden rounded-2xl p-0">
            <DialogHeader className="shrink-0 border-b border-border/60 bg-gradient-to-r from-primary/5 via-background to-background p-6 pr-12">
              <DialogTitle className="flex items-center gap-2 text-xl"><PackageCheck className="size-5 text-primary" />Finished Goods Details</DialogTitle>
              <DialogDescription className="text-xs">
                {detailsFg?.product_name} ({detailsFg?.product_code})
              </DialogDescription>
              <dl className="grid grid-cols-1 gap-3 pt-4 text-left text-xs sm:grid-cols-3">
                {[
                  ["Produced", (detailsFg as any)?.produced_quantity ?? detailsFg?.quantity],
                  ["Available", (detailsFg as any)?.available_quantity],
                  ["Reserved", (detailsFg as any)?.reserved_quantity],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-xl border border-border/60 bg-background/90 p-4 shadow-sm">
                    <dt className="font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
                    <dd className="mt-1 text-lg font-bold tabular-nums text-foreground">
                      {value == null ? "Unavailable" : Number(value).toLocaleString()}{" "}
                      {detailsFg?.uom}
                    </dd>
                  </div>
                ))}
              </dl>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-auto px-6 pb-5">
              <p className="my-4 rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-xs text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/20 dark:text-blue-200">
                FIFO: oldest stock received first, matching dispatch allocation. Zero available
                stock cannot be newly allocated.
              </p>
              <div className="overflow-x-auto rounded-xl border border-border/70"><table className="w-full min-w-[980px] table-fixed text-left text-xs">
                <colgroup><col className="w-[21%]" /><col className="w-[14%]" /><col className="w-[12%]" /><col className="w-[12%]" /><col className="w-[16%]" /><col className="w-[25%]" /></colgroup>
                <thead className="sticky top-0 z-10 bg-muted text-[11px] uppercase text-muted-foreground">
                  <tr>
                    {[
                      "Batch ID",
                      "Manufacturing Date",
                      "Available Qty",
                      "Reserved Qty",
                      "Status",
                      "QR Label",
                    ].map((label) => (
                      <th key={label} className="border-b px-3 py-3 last:text-right">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {detailBatches.map((batch) => {
                    const expanded = expandedBatches.includes(batch.id);
                    const available = Number(batch.available_quantity ?? batch.quantity);
                    const reserved = Number(batch.reserved_quantity ?? 0);
                    const batchStatus = reserved > 0
                      ? available > 0 ? "Partially Reserved" : "Reserved for Dispatch"
                      : available > 0 ? "Available" : "Out of stock";
                    return (
                      <Fragment key={batch.id}>
                        <tr className="align-middle hover:bg-muted/20">
                          <td className="px-4 py-4">
                            <p className="break-all font-mono font-semibold leading-5">
                              {batch.batch_number || batch.serial_number || batch.order_number}
                            </p>
                            <button
                              type="button"
                              className="mt-2 text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2"
                              aria-expanded={expanded}
                              aria-controls={`batch-details-${batch.id}`}
                              onClick={() =>
                                setExpandedBatches((rows) =>
                                  expanded
                                    ? rows.filter((id) => id !== batch.id)
                                    : [...rows, batch.id],
                                )
                              }
                            >
                              {expanded ? "Hide details" : "Batch details"}
                            </button>
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap">
                            {batch.manufacturing_date
                              ? new Date(batch.manufacturing_date).toLocaleDateString()
                              : "Unavailable"}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap tabular-nums font-semibold">
                            {available.toLocaleString()} {batch.uom}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap tabular-nums font-semibold text-blue-700">
                            {reserved.toLocaleString()} {batch.uom}
                          </td>
                          <td className="px-3 py-3">
                            <span
                              className={cn(
                                "inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium",
                                reserved > 0
                                  ? "border-blue-200 bg-blue-50 text-blue-700"
                                  : available > 0
                                    ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"
                                    : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300",
                              )}
                            >
                              {batchStatus}
                            </span>
                          </td>
                          <td className="px-4 py-4">
                            <div className="ml-auto grid max-w-56 gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8 w-full justify-start rounded-xl text-xs gap-1.5 border-blue-200 text-blue-700 hover:bg-blue-50"
                                onClick={() => setTraceabilityFg(batch)}
                              >
                                <Layers3 className="size-3.5" />
                                Material Traceability
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8 w-full justify-start rounded-xl text-xs gap-1.5"
                                onClick={() => {
                                  setScannedQr("");
                                  setScanError(null);
                                  setScanFg(batch);
                                }}
                              >
                                <QrCode className="size-3.5" /> Scan FG QR
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8 w-full justify-start rounded-xl text-xs gap-1.5"
                                onClick={() => {
                                  setDetailsFg(null);
                                  void handleOpenPrintModal(batch);
                                }}
                              >
                                <QrCode className="size-3.5" />
                                View/Print QR
                              </Button>
                            </div>
                          </td>
                        </tr>
                        {expanded && (
                          <tr id={`batch-details-${batch.id}`} className="bg-muted/20">
                            <td colSpan={6} className="p-4">
                              <FgSections sections={(batch as any).sections} />
                              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                                {[
                                  ["Order Number", batch.order_number],
                                  ["QC Inspector", batch.inspected_by || "Unavailable"],
                                  [
                                    "QC Status",
                                    (batch.qc_status || batch.status).replaceAll("_", " "),
                                  ],
                                  [
                                    "Inspection Date",
                                    batch.inspected_at
                                      ? new Date(batch.inspected_at).toLocaleString()
                                      : "Unavailable",
                                  ],
                                  ["Floor Location", batch.location_code || "Unavailable"],
                                  [
                                    "Stock Recorded",
                                    batch.posted_at
                                      ? new Date(batch.posted_at).toLocaleString()
                                      : "Unavailable",
                                  ],
                                  [
                                    "Produced",
                                    `${batch.produced_quantity ?? batch.quantity} ${batch.uom}`,
                                  ],
                                  ["Reserved", `${batch.reserved_quantity ?? 0} ${batch.uom}`],
                                  ["Dispatched", `${batch.dispatched_quantity ?? 0} ${batch.uom}`],
                                ].map(([label, value]) => (
                                  <div key={label} className="min-w-0 space-y-1">
                                    <dt className="text-muted-foreground">{label}</dt>
                                    <dd className="break-words font-medium">{value}</dd>
                                  </div>
                                ))}
                              </dl>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table></div>
            </div>
            <DialogFooter className="shrink-0 border-t border-border/60 px-5 py-3">
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl"
                onClick={() => setDetailsFg(null)}
              >
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={!!scanFg}
          onOpenChange={(open) => {
            if (!open && !verifyingQr) setScanFg(null);
          }}
        >
          <DialogContent className="rounded-2xl sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Verify Finished Goods QR</DialogTitle>
              <DialogDescription>
                Scan the original label for{" "}
                {scanFg?.batch_number || scanFg?.serial_number || "the selected batch"} to view its
                material traceability.
              </DialogDescription>
            </DialogHeader>
            <FgQrInput
              value={scannedQr}
              onChange={(value) => {
                setScannedQr(value);
                setScanError(null);
              }}
              disabled={verifyingQr}
              inputId="fg-traceability-qr"
            />
            {scanError && (
              <p role="alert" className="text-sm text-rose-700">
                {scanError}
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" disabled={verifyingQr} onClick={() => setScanFg(null)}>
                Cancel
              </Button>
              <Button
                disabled={verifyingQr || !scannedQr.trim()}
                onClick={() => void verifyTraceabilityQr()}
              >
                {verifyingQr ? "Verifying..." : "Verify QR"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={!!traceabilityFg}
          onOpenChange={(open) => {
            if (!open) {
              setTraceabilityFg(null);
              setSelectedMaterial(null);
            }
          }}
        >
          <DialogContent className="flex w-[calc(100vw-2rem)] max-w-6xl max-h-[88dvh] flex-col gap-0 overflow-hidden rounded-2xl p-0">
            <DialogHeader className="shrink-0 border-b border-border/60 p-5 pr-10">
              <DialogTitle className="flex items-center gap-2 text-foreground">
                <Layers3 className="size-5 text-primary" /> Material Traceability
              </DialogTitle>
              <DialogDescription className="text-xs">
                Original GRN material batches consumed to manufacture this finished-goods batch.
              </DialogDescription>
            </DialogHeader>

            <div className="min-h-0 flex-1 overflow-auto p-5 space-y-5">
              {traceabilityLoading && (
                <div
                  role="status"
                  className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"
                >
                  <RefreshCw className="size-4 animate-spin text-primary" />
                  Loading material traceability...
                </div>
              )}

              {traceabilityError && !traceabilityLoading && (
                <div
                  role="alert"
                  className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"
                >
                  <p>{traceabilityError}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => setTraceabilityRefresh((value) => value + 1)}
                  >
                    Retry
                  </Button>
                </div>
              )}

              <FgSections sections={(traceabilityData?.finished_goods as any)?.sections} />
              {traceabilityData && !traceabilityLoading && (
                <>
                  <section aria-labelledby="fg-traceability-info-heading" className="space-y-2">
                    <h3 id="fg-traceability-info-heading" className="text-sm font-semibold">
                      Finished Goods Information
                    </h3>
                    <dl className="grid grid-cols-2 gap-3 rounded-xl border border-border/70 bg-white p-4 text-xs sm:grid-cols-4">
                      <TraceabilityInfo
                        label="Finished Goods Batch"
                        value={traceabilityData.finished_goods.fg_batch_number}
                      />
                      <TraceabilityInfo
                        label="Product Name"
                        value={traceabilityData.finished_goods.product_name}
                      />
                      <TraceabilityInfo
                        label="Product Code"
                        value={traceabilityData.finished_goods.product_code}
                        mono
                      />
                      <TraceabilityInfo
                        label="Serial Number"
                        value={traceabilityData.finished_goods.serial_number}
                        mono
                      />
                      <TraceabilityInfo
                        label="Finished Quantity"
                        value={`${traceabilityData.finished_goods.finished_quantity} ${traceabilityData.finished_goods.uom}`}
                      />
                      <TraceabilityInfo
                        label="QC Status"
                        value={traceabilityData.finished_goods.qc_status}
                      />
                      <TraceabilityInfo
                        label="Assembly Order"
                        value={traceabilityData.assembly.assembly_order_number}
                        mono
                      />
                      <TraceabilityInfo
                        label="Production Status"
                        value={traceabilityData.assembly.production_status}
                      />
                    </dl>
                  </section>

                  <section aria-labelledby="fg-traceability-summary-heading" className="space-y-2">
                    <h3 id="fg-traceability-summary-heading" className="text-sm font-semibold">
                      Traceability Summary
                    </h3>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div className="col-span-2 rounded-xl border border-border/70 bg-white p-4 sm:col-span-1">
                        <p className="text-[11px] text-muted-foreground">Overall Status</p>
                        <TraceabilityStatus status={traceabilityData.traceability.overall_status} />
                      </div>
                      <TraceabilityCount
                        label="Total Material Batches"
                        value={traceabilityData.traceability.total_material_batches}
                      />
                      <TraceabilityCount
                        label="Verified Material Batches"
                        value={traceabilityData.traceability.verified_material_batches}
                      />
                      <TraceabilityCount
                        label="Unlinked Material Records"
                        value={traceabilityData.traceability.unlinked_material_records}
                      />
                    </div>
                    {traceabilityData.traceability.data_quality_warnings.length > 0 && (
                      <ul className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                        {traceabilityData.traceability.data_quality_warnings.map(
                          (warning, index) => (
                            <li key={`${index}-${warning}`}>{warning}</li>
                          ),
                        )}
                      </ul>
                    )}
                    {["NOT_AVAILABLE", "UNLINKED"].includes(
                      traceabilityData.traceability.overall_status,
                    ) && (
                      <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                        Traceability information is unavailable for this historical production
                        record.
                      </p>
                    )}
                    {traceabilityData.traceability.overall_status === "PARTIAL" && (
                      <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                        Some material history is verified. Unlinked or missing records are listed
                        separately below.
                      </p>
                    )}
                  </section>

                  <section aria-labelledby="fg-consumed-materials-heading" className="space-y-2">
                    <h3 id="fg-consumed-materials-heading" className="text-sm font-semibold">
                      Consumed Materials
                    </h3>
                    <PrintAllMaterialQrs
                      key={traceabilityData.finished_goods.fg_id}
                      data={traceabilityData}
                    />
                    {traceabilityData.consumed_materials.length === 0 ? (
                      <p className="rounded-xl border border-border/70 bg-white p-5 text-center text-xs text-muted-foreground">
                        No verified material batch records are available.
                      </p>
                    ) : (
                      <div className="overflow-x-auto rounded-xl border border-border/70 bg-white">
                        <table className="w-full min-w-[1050px] text-left text-xs">
                          <thead className="bg-muted/50 text-[10px] uppercase text-muted-foreground">
                            <tr>
                              {[
                                "Material Name",
                                "Material Code",
                                "GRN Batch Number",
                                "Actual Quantity Consumed",
                                "UOM",
                                "Original Material QR Reference",
                                "Traceability Status",
                                "Action",
                              ].map((heading) => (
                                <th key={heading} className="border-b px-3 py-3">
                                  {heading}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/60">
                            {traceabilityData.consumed_materials.map((material) => (
                              <tr
                                key={`${material.material_code}-${material.grn_batch_id}-${material.original_qr_identity}`}
                                className="align-top"
                              >
                                <td className="px-3 py-3 font-medium">{material.material_name}</td>
                                <td className="px-3 py-3 font-mono">{material.material_code}</td>
                                <td className="px-3 py-3 font-mono">
                                  {material.batch_number || "Unavailable"}
                                </td>
                                <td className="px-3 py-3 text-right tabular-nums font-semibold">
                                  {traceabilityQuantity(material.quantity_consumed)}
                                </td>
                                <td className="px-3 py-3">{material.uom}</td>
                                <td
                                  className="max-w-48 truncate px-3 py-3 font-mono"
                                  title={material.original_qr_identity}
                                >
                                  {material.original_qr_identity}
                                </td>
                                <td className="px-3 py-3">
                                  <TraceabilityStatus status="VERIFIED" />
                                </td>
                                <td className="px-3 py-3">
                                  <div className="flex flex-wrap gap-2">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-7 whitespace-nowrap text-[11px]"
                                      onClick={() => setSelectedMaterial(material)}
                                    >
                                      View Details
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-7 whitespace-nowrap text-[11px]"
                                      onClick={() => setQrMaterial(material)}
                                    >
                                      View Original QR
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>

                  {traceabilityData.unlinked_material_records.length > 0 && (
                    <section aria-labelledby="fg-unlinked-materials-heading" className="space-y-2">
                      <h3 id="fg-unlinked-materials-heading" className="text-sm font-semibold">
                        Legacy / Unlinked Material Records
                      </h3>
                      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-slate-50">
                        <table className="w-full min-w-[650px] text-left text-xs">
                          <thead className="text-[10px] uppercase text-muted-foreground">
                            <tr>
                              {[
                                "Material Code",
                                "Batch Reference",
                                "Quantity",
                                "UOM",
                                "Original QR Reference",
                                "Reason",
                                "Status",
                              ].map((heading) => (
                                <th key={heading} className="border-b px-3 py-3">
                                  {heading}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {traceabilityData.unlinked_material_records.map((record, index) => (
                              <tr
                                key={
                                  record.consumption_id ||
                                  record.consumption_event_id ||
                                  `${record.material_code}-${index}`
                                }
                                className="align-top"
                              >
                                <td className="px-3 py-3 font-mono">{record.material_code}</td>
                                <td className="px-3 py-3 font-mono">
                                  {record.batch_number || "Unverified"}
                                </td>
                                <td className="px-3 py-3 text-right tabular-nums">
                                  {traceabilityQuantity(record.quantity_consumed)}
                                </td>
                                <td className="px-3 py-3">{record.uom}</td>
                                <td className="px-3 py-3 font-mono">
                                  {record.original_material_qr_reference || "Unavailable"}
                                </td>
                                <td className="max-w-md px-3 py-3">{record.reason}</td>
                                <td className="px-3 py-3">
                                  <TraceabilityStatus status="UNLINKED" />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  )}
                </>
              )}
            </div>

            <DialogFooter className="shrink-0 border-t border-border/60 px-5 py-3">
              <Button variant="outline" size="sm" onClick={() => setTraceabilityFg(null)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {qrMaterial && (
          <OriginalMaterialQrPreview
            key={`${qrMaterial.grn_batch_id}-${qrMaterial.original_qr_identity}`}
            material={qrMaterial}
            onClose={() => setQrMaterial(null)}
          />
        )}

        <Dialog
          open={!!selectedMaterial}
          onOpenChange={(open) => !open && setSelectedMaterial(null)}
        >
          <DialogContent className="max-h-[85dvh] overflow-auto rounded-2xl sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Material Batch Details</DialogTitle>
              <DialogDescription>Original GRN batch and consumption evidence.</DialogDescription>
            </DialogHeader>
            {selectedMaterial && (
              <div className="space-y-5">
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold">Material Information</h3>
                  <dl className="grid grid-cols-2 gap-3 rounded-xl border border-border/70 bg-white p-4 text-xs sm:grid-cols-3">
                    <TraceabilityInfo
                      label="Material Name"
                      value={selectedMaterial.material_name}
                    />
                    <TraceabilityInfo
                      label="Material Code"
                      value={selectedMaterial.material_code}
                      mono
                    />
                    <TraceabilityInfo
                      label="GRN Batch Number"
                      value={selectedMaterial.batch_number}
                      mono
                    />
                    <TraceabilityInfo
                      label="GRN Reference"
                      value={
                        selectedMaterial.grn_reference.grn_number ||
                        selectedMaterial.grn_reference.grn_id
                      }
                      mono
                    />
                    <TraceabilityInfo
                      label="Supplier Name"
                      value={selectedMaterial.supplier.supplier_name}
                    />
                    <TraceabilityInfo
                      label="Actual Quantity Consumed"
                      value={`${traceabilityQuantity(selectedMaterial.quantity_consumed)} ${selectedMaterial.uom}`}
                    />
                    <TraceabilityInfo label="Unit of Measurement" value={selectedMaterial.uom} />
                  </dl>
                </section>
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold">Original QR Information</h3>
                  <dl className="space-y-3 rounded-xl border border-border/70 bg-white p-4 text-xs">
                    <TraceabilityInfo
                      label="Original QR Identity / Reference"
                      value={selectedMaterial.original_qr_identity}
                      mono
                    />
                    <TraceabilityInfo
                      label="Original QR Payload"
                      value={
                        selectedMaterial.original_qr_payload
                          ? "Available in original GRN record"
                          : "Unavailable"
                      }
                    />
                    {selectedMaterial.original_qr_payload && (
                      <div>
                        <dt className="mb-1 text-muted-foreground">Stored Payload (read-only)</dt>
                        <dd className="break-all rounded-lg bg-muted/50 p-3 font-mono text-[11px]">
                          {selectedMaterial.original_qr_payload}
                        </dd>
                      </div>
                    )}
                    <div>
                      <dt className="mb-2 text-muted-foreground">
                        Linked Consumption Event References
                      </dt>
                      <dd className="space-y-2">
                        {selectedMaterial.consumption_event_ids.map((eventId) => {
                          const event = traceabilityData?.consumption_events.find(
                            (item) => item.consumption_event_id === eventId,
                          );
                          return (
                            <div
                              key={eventId}
                              className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/50 p-2"
                            >
                              <span className="break-all font-mono">{eventId}</span>
                              <span className="whitespace-nowrap tabular-nums">
                                {event
                                  ? `${traceabilityQuantity(event.quantity_consumed)} ${event.uom} · ${new Date(event.consumed_at).toLocaleString()}`
                                  : "Event details unavailable"}
                              </span>
                            </div>
                          );
                        })}
                      </dd>
                    </div>
                  </dl>
                </section>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setSelectedMaterial(null)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* PRINT QR LABEL MODAL */}
        {/* ========================================================================= */}
        <Dialog open={!!selectedFg} onOpenChange={(open) => !open && setSelectedFg(null)}>
          <DialogContent className="flex max-h-[92dvh] w-[calc(100vw-2rem)] max-w-6xl flex-col gap-0 overflow-hidden rounded-2xl p-0">
            <DialogHeader className="shrink-0 border-b border-border/60 bg-gradient-to-r from-primary/5 via-background to-background px-6 py-5 pr-12">
              <DialogTitle className="flex items-center gap-2 text-xl font-bold text-foreground">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10"><Tag className="size-5 text-primary" /></span>
                Finished Goods QR Identification Label
              </DialogTitle>
              <DialogDescription className="ml-11 mt-1 max-w-2xl text-sm text-muted-foreground">
                Print the FG batch QR identification label for Assembly storage and customer
                dispatch.
              </DialogDescription>
            </DialogHeader>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {labelLoading ? (
              <div className="py-12 text-center text-xs text-muted-foreground space-y-2">
                <RefreshCw className="size-6 animate-spin text-primary mx-auto" />
                <p>Generating barcode & QR matrix...</p>
              </div>
            ) : selectedFg ? (
              <div className="space-y-6">
                <FgSections sections={(selectedFg as any).sections} />
                {/* Visual Label Preview */}
                <section className="mx-auto max-w-xl space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div><h3 className="text-sm font-semibold">Main finished-good label</h3><p className="text-xs text-muted-foreground">Print-ready batch identification label</p></div>
                    <Badge variant="outline" className="rounded-full border-emerald-200 bg-emerald-50 text-emerald-700">QC Certified</Badge>
                  </div>
                <div ref={printRef} className="space-y-3 rounded-2xl border-2 border-dashed border-border bg-card p-5 text-card-foreground shadow-sm">
                  <div className="border-b-2 border-border pb-2 text-center">
                    <span className="text-[10px] font-black uppercase tracking-widest text-primary">
                      KaizenAssests Assembly Execution
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
                      <span className="text-muted-foreground">FG Batch / QR Identity:</span>
                      <span className="font-mono font-bold text-foreground">
                        {selectedFg.batch_number || selectedFg.serial_number || "Not recorded"}
                      </span>
                    </div>
                    <div className="flex justify-between border-b border-border/40 pb-1">
                      <span className="text-muted-foreground">Staging Rack:</span>
                      <span className="font-mono text-foreground">{selectedFg.location_code}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Certified:</span>
                      <span className="text-foreground">
                        {selectedFg.posted_at
                          ? new Date(selectedFg.posted_at).toLocaleDateString()
                          : "Today"}
                      </span>
                    </div>
                  </div>

                  <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-2 text-center text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                    ✓ QC CERTIFIED - READY FOR CUSTOMER DISPATCH
                  </div>
                </div>
                </section>
              </div>
            ) : null}
            </div>

            <DialogFooter className="shrink-0 border-t border-border/60 bg-background px-6 py-4">
              <Button variant="ghost" size="sm" onClick={() => setSelectedFg(null)} className="rounded-xl">Close</Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownloadLabel}
                disabled={!qrDataUrl}
                className="rounded-xl gap-2 font-semibold"
              >
                <Download className="size-3.5" />
                Download QR
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
