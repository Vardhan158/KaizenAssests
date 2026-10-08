import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
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
  Layers,
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

export const Route = createFileRoute("/assembly/finished-goods")({
  beforeLoad: () => requireRole(["ASSEMBLY_MANAGER", "ASSEMBLY", "ADMIN", "SUPERUSER", "STORE_MANAGER", "QUALITY"]),
  head: () => ({ meta: [{ title: "Finished Goods · KaizenX" }] }),
  component: AssemblyFinishedGoodsPage,
});

function AssemblyFinishedGoodsPage() {
  const [items, setItems] = useState<AssemblyFinishedGoodItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Print Label Modal State
  const [selectedFg, setSelectedFg] = useState<AssemblyFinishedGoodDetail | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [labelLoading, setLabelLoading] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  const fetchItems = async () => {
    try {
      setLoading(true);
      const res = await api.getAssemblyFinishedGoods({
        search: search || undefined,
      });
      setItems(res || []);
    } catch (err: any) {
      toast.error("Failed to load Finished Goods: " + (err.message || "Unknown error"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchItems();
  };

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

  return (
    <AppShell
      title="Finished Goods"
      subtitle="Assembly FG storage tracking, warehouse pickup readiness, and QR label generation"
    >
      <div className="space-y-6">
        {/* Stat Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Total Units In Assembly</span>
              <PackageCheck className="h-4 w-4 text-emerald-500" />
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-foreground font-mono">
              {totalUnits} <span className="text-xs font-normal text-muted-foreground">PCS</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">QC Certified & stored</p>
          </div>

          <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Finished Batches</span>
              <Boxes className="h-4 w-4 text-primary" />
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">{totalBatches}</div>
            <p className="mt-1 text-xs text-muted-foreground">Tracked in database</p>
          </div>

          <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Storage Location</span>
              <MapPin className="h-4 w-4 text-blue-500" />
            </div>
            <div className="mt-2 text-base font-semibold tracking-tight text-foreground font-mono">
              ASSEMBLY-STORAGE-01
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Physical floor staging</p>
          </div>

          <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Dispatch Readiness</span>
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
            </div>
            <div className="mt-2 text-base font-semibold tracking-tight text-emerald-600 dark:text-emerald-400">
              AVAILABLE (100%)
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Ready for warehouse pickup</p>
          </div>
        </div>

        {/* Search & Refresh */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <form onSubmit={handleSearchSubmit} className="flex items-center gap-2 w-full sm:w-80">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search product, order # or serial..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9 text-xs"
              />
            </div>
            <Button type="submit" variant="outline" size="sm" className="h-9 px-3">
              Search
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                fetchItems();
              }}
              className="h-9 px-2"
              title="Refresh"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </form>

          <span className="text-xs text-muted-foreground">
            Finished Goods remain physically inside Assembly until transferred or dispatched.
          </span>
        </div>

        {/* Finished Goods Table */}
        <div className="rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/40 text-muted-foreground font-medium border-b border-border/60">
                <tr>
                  <th className="py-3 px-4">Order Number</th>
                  <th className="py-3 px-4">Product Details</th>
                  <th className="py-3 px-4">FG Quantity</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Floor Location</th>
                  <th className="py-3 px-4">Serial / QR Identity</th>
                  <th className="py-3 px-4">Date Certified</th>
                  <th className="py-3 px-4 text-right">Label Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-muted-foreground">
                      <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-primary" />
                      Loading Finished Goods records...
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-muted-foreground">
                      <PackageCheck className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
                      <p className="font-medium text-foreground">No Finished Goods available.</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Finished Goods are generated automatically when production passes Final Quality Inspection.
                      </p>
                    </td>
                  </tr>
                ) : (
                  items.map((fg) => (
                    <tr key={fg.id} className="hover:bg-muted/30 transition-colors">
                      {/* Order Number */}
                      <td className="py-3.5 px-4 font-mono font-semibold text-foreground">
                        {fg.order_number}
                      </td>

                      {/* Product */}
                      <td className="py-3.5 px-4">
                        <div className="flex flex-col">
                          <span className="font-semibold text-foreground">{fg.product_name}</span>
                          <span className="font-mono text-[11px] text-muted-foreground mt-0.5">
                            {fg.product_code}
                          </span>
                        </div>
                      </td>

                      {/* Quantity */}
                      <td className="py-3.5 px-4 font-mono font-bold text-foreground">
                        {fg.quantity} {fg.uom}
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4">
                        <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300">
                          <CheckCircle2 className="w-3 h-3 inline-block mr-1" />
                          AVAILABLE
                        </Badge>
                      </td>

                      {/* Location */}
                      <td className="py-3.5 px-4 text-muted-foreground">
                        <span className="inline-flex items-center gap-1 font-mono text-[11px] text-foreground font-medium">
                          <MapPin className="h-3 w-3 text-blue-500" />
                          {fg.location_code}
                        </span>
                      </td>

                      {/* Serial Number & QR */}
                      <td className="py-3.5 px-4 font-mono text-[11px] text-muted-foreground">
                        <div className="flex flex-col">
                          <span className="text-foreground font-semibold truncate max-w-[180px]">
                            {fg.serial_number || "—"}
                          </span>
                          <span className="text-[10px] text-muted-foreground/80 truncate max-w-[180px]">
                            {fg.qr_code}
                          </span>
                        </div>
                      </td>

                      {/* Posted At */}
                      <td className="py-3.5 px-4 text-muted-foreground text-[11px]">
                        {fg.posted_at ? new Date(fg.posted_at).toLocaleDateString() : "—"}
                      </td>

                      {/* Action */}
                      <td className="py-3.5 px-4 text-right">
                        <Button
                          size="sm"
                          onClick={() => handleOpenPrintModal(fg)}
                          className="h-8 gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
                        >
                          <QrCode className="h-3.5 w-3.5" />
                          Print QR Label
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Printable QR Label Modal */}
        <Dialog open={!!selectedFg} onOpenChange={(open) => !open && setSelectedFg(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-foreground">
                <Tag className="h-5 w-5 text-emerald-600" />
                Finished Good QR Label
              </DialogTitle>
              <DialogDescription>
                Print and paste this label onto the finished goods packaging. Units remain in Assembly storage.
              </DialogDescription>
            </DialogHeader>

            {selectedFg && (
              <div className="py-2">
                {/* Visual Label Card (Printable Target) */}
                <div
                  ref={printRef}
                  className="rounded-xl border-2 border-slate-900 bg-white p-5 text-slate-900 shadow-md space-y-4 font-sans dark:text-slate-900"
                >
                  {/* Label Header */}
                  <div className="text-center border-b-2 border-slate-900 pb-2.5">
                    <h3 className="text-xs font-black tracking-widest uppercase">
                      KAIZENX ASSEMBLY SYSTEM
                    </h3>
                    <p className="text-[10px] text-slate-600 font-medium">FINISHED GOODS ACCEPTANCE LABEL</p>
                  </div>

                  {/* QR Code Graphic */}
                  <div className="flex flex-col items-center justify-center py-1">
                    {qrDataUrl ? (
                      <img
                        src={qrDataUrl}
                        alt="Finished Good QR Code"
                        className="w-36 h-36 border border-slate-300 rounded p-1 bg-white"
                      />
                    ) : (
                      <div className="w-36 h-36 border border-slate-300 flex items-center justify-center">
                        <RefreshCw className="h-6 w-6 animate-spin text-slate-400" />
                      </div>
                    )}
                    <span className="text-[10px] font-mono text-slate-500 mt-1">
                      Scan with WMS scanner or mobile app
                    </span>
                  </div>

                  {/* Metadata Fields */}
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between border-b border-slate-200 pb-1">
                      <span className="text-slate-600 font-medium">Product:</span>
                      <span className="font-bold text-slate-900 text-right">{selectedFg.product_name}</span>
                    </div>

                    <div className="flex justify-between border-b border-slate-200 pb-1">
                      <span className="text-slate-600 font-medium">Product Code:</span>
                      <span className="font-mono font-bold text-slate-900">{selectedFg.product_code}</span>
                    </div>

                    <div className="flex justify-between border-b border-slate-200 pb-1">
                      <span className="text-slate-600 font-medium">Assembly Order:</span>
                      <span className="font-mono font-bold text-slate-900">{selectedFg.order_number}</span>
                    </div>

                    <div className="flex justify-between border-b border-slate-200 pb-1">
                      <span className="text-slate-600 font-medium">Accepted Quantity:</span>
                      <span className="font-mono font-bold text-emerald-700">
                        {selectedFg.quantity} {selectedFg.uom}
                      </span>
                    </div>

                    <div className="flex justify-between border-b border-slate-200 pb-1">
                      <span className="text-slate-600 font-medium">Storage Location:</span>
                      <span className="font-mono font-bold text-slate-900">{selectedFg.location_code}</span>
                    </div>

                    <div className="flex justify-between">
                      <span className="text-slate-600 font-medium">Serial Batch:</span>
                      <span className="font-mono text-[11px] font-bold text-slate-900 truncate max-w-[200px]">
                        {selectedFg.serial_number}
                      </span>
                    </div>
                  </div>

                  {/* Inspection Certified Stamp */}
                  <div className="border border-emerald-600 rounded p-1.5 text-center bg-emerald-50 text-emerald-800 text-[11px] font-bold tracking-wide">
                    ✓ QC INSPECTED & CERTIFIED · STATUS: AVAILABLE
                  </div>
                </div>
              </div>
            )}

            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" size="sm" onClick={() => setSelectedFg(null)}>
                Close
              </Button>
              <Button
                size="sm"
                onClick={handlePrint}
                className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 shadow-sm"
              >
                <Printer className="h-4 w-4" />
                Print Label
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
