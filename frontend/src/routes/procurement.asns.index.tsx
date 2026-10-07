import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Search,
  Filter,
  Truck,
  MoreHorizontal,
  ArrowRight,
  Loader2,
  MapPin,
  Eye,
  FileText,
  RefreshCw,
  Download,
  Info,
} from "lucide-react";
import { AppShell, StatusBadge } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api, BUSINESS_API_URL } from "@/lib/api-client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/procurement/asns/")({
  component: Asns,
});

const poColorClasses = [
  {
    card: "border-l-blue-500 hover:border-l-blue-500",
    icon: "bg-blue-50 text-blue-600",
    badge: "border-blue-200 bg-blue-50 text-blue-700",
  },
  {
    card: "border-l-emerald-500 hover:border-l-emerald-500",
    icon: "bg-emerald-50 text-emerald-600",
    badge: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  {
    card: "border-l-amber-500 hover:border-l-amber-500",
    icon: "bg-amber-50 text-amber-700",
    badge: "border-amber-200 bg-amber-50 text-amber-800",
  },
  {
    card: "border-l-rose-500 hover:border-l-rose-500",
    icon: "bg-rose-50 text-rose-600",
    badge: "border-rose-200 bg-rose-50 text-rose-700",
  },
  {
    card: "border-l-cyan-500 hover:border-l-cyan-500",
    icon: "bg-cyan-50 text-cyan-700",
    badge: "border-cyan-200 bg-cyan-50 text-cyan-800",
  },
  {
    card: "border-l-indigo-500 hover:border-l-indigo-500",
    icon: "bg-indigo-50 text-indigo-600",
    badge: "border-indigo-200 bg-indigo-50 text-indigo-700",
  },
];

function getPoReference(asn: any): string {
  return String(asn.poNumber || asn.po_number || asn.poId || asn.po_id || "UNLINKED");
}

function getPoColorIndex(poReference: string): number {
  let hash = 0;
  for (const char of poReference) {
    hash = (hash * 31 + char.charCodeAt(0)) % poColorClasses.length;
  }
  return hash;
}

function readField(row: any, camelKey: string, snakeKey: string = camelKey): any {
  return row?.[camelKey] ?? row?.[snakeKey];
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function resolveDocumentUrl(fileUrl?: string): string {
  if (!fileUrl) return "";
  if (/^https?:\/\//i.test(fileUrl)) return fileUrl;
  const normalizedPath = fileUrl.startsWith("/") ? fileUrl : `/${fileUrl}`;
  return `${BUSINESS_API_URL}${normalizedPath}`;
}

function buildAsnPrintHtml(asn: any): string {
  const lines = readField(asn, "lines", "lines") || [];
  const documents = readField(asn, "documents", "documents") || [];
  const asnNumber = readField(asn, "asnNumber", "asn_number") || "ASN";
  const poNumber = readField(asn, "poNumber", "po_number") || "N/A";

  const lineRows = lines.length
    ? lines
        .map(
          (line: any) => `
            <tr>
              <td>${escapeHtml(readField(line, "itemCode", "item_code"))}</td>
              <td>${escapeHtml(readField(line, "materialName", "material_name"))}</td>
              <td class="num">${escapeHtml(readField(line, "shippedQuantity", "shipped_quantity") || 0)}</td>
              <td>${escapeHtml(line.uom || "PCS")}</td>
            </tr>
          `,
        )
        .join("")
    : `<tr><td colspan="4" class="empty">No shipment lines found.</td></tr>`;

  const documentRows = documents.length
    ? documents
        .map(
          (document: any) => `
            <tr>
              <td>${escapeHtml(readField(document, "documentType", "document_type"))}</td>
              <td>${escapeHtml(readField(document, "fileName", "file_name"))}</td>
              <td>${escapeHtml(readField(document, "uploadedBy", "uploaded_by") || "N/A")}</td>
            </tr>
          `,
        )
        .join("")
    : `<tr><td colspan="3" class="empty">No documents attached.</td></tr>`;

  return `<!doctype html>
    <html>
      <head>
        <title>${escapeHtml(asnNumber)} Export</title>
        <style>
          body { margin: 0; color: #111827; font-family: Arial, Helvetica, sans-serif; background: #f8fafc; }
          main { max-width: 900px; margin: 24px auto; background: #fff; padding: 32px; border: 1px solid #e5e7eb; }
          header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 3px solid #2563eb; padding-bottom: 18px; }
          h1 { margin: 0; font-size: 28px; }
          h2 { margin: 28px 0 12px; font-size: 16px; }
          .muted { color: #64748b; }
          .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 20px; }
          .box { border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px; }
          .label { color: #64748b; font-size: 11px; font-weight: 700; text-transform: uppercase; }
          .value { margin-top: 4px; font-weight: 700; }
          table { width: 100%; border-collapse: collapse; font-size: 13px; }
          th { background: #f1f5f9; color: #475569; text-align: left; padding: 10px; }
          td { border-top: 1px solid #e5e7eb; padding: 10px; vertical-align: top; }
          .num { text-align: right; font-variant-numeric: tabular-nums; }
          .empty { text-align: center; color: #64748b; font-style: italic; }
          @media print { body { background: #fff; } main { margin: 0; border: 0; } button { display: none; } }
        </style>
      </head>
      <body>
        <main>
          <header>
            <div>
              <h1>Advance Shipment Notice</h1>
              <div class="muted">${escapeHtml(asnNumber)}</div>
            </div>
            <div>
              <div class="label">PO Reference</div>
              <div class="value">${escapeHtml(poNumber)}</div>
            </div>
          </header>
          <section class="grid">
            <div class="box"><div class="label">Supplier</div><div class="value">${escapeHtml(readField(asn, "supplierName", "supplier_name") || "Independent Supplier")}</div></div>
            <div class="box"><div class="label">Status</div><div class="value">${escapeHtml(asn.status || "N/A")}</div></div>
            <div class="box"><div class="label">Transporter</div><div class="value">${escapeHtml(asn.transporter || "N/A")}</div></div>
            <div class="box"><div class="label">Vehicle</div><div class="value">${escapeHtml(readField(asn, "vehicleNumber", "vehicle_number") || "N/A")}</div></div>
            <div class="box"><div class="label">Driver</div><div class="value">${escapeHtml(readField(asn, "driverName", "driver_name") || "N/A")}</div></div>
            <div class="box"><div class="label">Expected Arrival</div><div class="value">${escapeHtml(readField(asn, "expectedArrivalAt", "expected_arrival_at") ? new Date(readField(asn, "expectedArrivalAt", "expected_arrival_at")).toLocaleDateString() : "N/A")}</div></div>
            <div class="box"><div class="label">Invoice</div><div class="value">${escapeHtml(readField(asn, "invoiceNumber", "invoice_number") || "N/A")}</div></div>
            <div class="box"><div class="label">Invoice Date</div><div class="value">${escapeHtml(readField(asn, "invoiceDate", "invoice_date") ? new Date(readField(asn, "invoiceDate", "invoice_date")).toLocaleDateString() : "N/A")}</div></div>
            <div class="box"><div class="label">Challan</div><div class="value">${escapeHtml(readField(asn, "challanNumber", "challan_number") || "N/A")}</div></div>
            <div class="box"><div class="label">Challan Date</div><div class="value">${escapeHtml(readField(asn, "challanDate", "challan_date") ? new Date(readField(asn, "challanDate", "challan_date")).toLocaleDateString() : "N/A")}</div></div>
          </section>
          <h2>Shipment Lines</h2>
          <table>
            <thead><tr><th>Material</th><th>Description</th><th class="num">Shipped Qty</th><th>UOM</th></tr></thead>
            <tbody>${lineRows}</tbody>
          </table>
          <h2>Documents</h2>
          <table>
            <thead><tr><th>Type</th><th>File Name</th><th>Uploaded By</th></tr></thead>
            <tbody>${documentRows}</tbody>
          </table>
        </main>
        <script>window.addEventListener("load", () => setTimeout(() => window.print(), 250));</script>
      </body>
    </html>`;
}

function Asns() {
  const [asns, setAsns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [selectedAsn, setSelectedAsn] = useState<any | null>(null);
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const [loadingDocumentsId, setLoadingDocumentsId] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);

  const fetchData = useCallback(async (showLoader = false) => {
    try {
      if (showLoader) setRefreshing(true);
      const data = await api.getAsns();
      setAsns(data);
    } catch (error) {
      console.error("Failed to fetch ASNs:", error);
      if (showLoader) toast.error("Failed to refresh ASNs");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") fetchData();
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    const refreshTimer = window.setInterval(() => fetchData(), 15000);

    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.clearInterval(refreshTimer);
    };
  }, [fetchData]);

  const statuses = useMemo(() => {
    const values = asns
      .map((asn) => String(asn.status || "").trim())
      .filter(Boolean);
    return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
  }, [asns]);

  const filteredAsns = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();

    return asns.filter((asn) => {
      const status = String(asn.status || "");
      if (statusFilter !== "ALL" && status !== statusFilter) return false;
      if (!query) return true;

      const searchableText = [
        asn.asnNumber,
        asn.asn_number,
        asn.poNumber,
        asn.po_number,
        asn.supplierName,
        asn.supplier_name,
        asn.transporter,
        asn.vehicleNumber,
        asn.vehicle_number,
        asn.driverName,
        asn.driver_name,
        asn.invoiceNumber,
        asn.invoice_number,
        asn.challanNumber,
        asn.challan_number,
        status,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return searchableText.includes(query);
    });
  }, [asns, searchTerm, statusFilter]);

  const hasActiveFilters = searchTerm.trim() !== "" || statusFilter !== "ALL";

  const handleViewDocuments = async (asn: any) => {
    const asnId = readField(asn, "id");
    try {
      setLoadingDocumentsId(asnId);
      const freshAsn = await api.getAsn(asnId);
      setSelectedAsn(freshAsn);
      setDocumentsOpen(true);
    } catch (error: any) {
      toast.error("Unable to load ASN documents", { description: error.message });
    } finally {
      setLoadingDocumentsId(null);
    }
  };

  const handleExportPdf = async (asn: any) => {
    const asnId = readField(asn, "id");
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      toast.error("Popup blocked", {
        description: "Allow popups for this site to export the ASN PDF.",
      });
      return;
    }

    printWindow.document.open();
    printWindow.document.write(
      "<!doctype html><html><body style=\"font-family:Arial,sans-serif;padding:24px\">Preparing ASN export...</body></html>",
    );
    printWindow.document.close();

    try {
      setExportingId(asnId);
      const freshAsn = await api.getAsn(asnId);
      printWindow.document.open();
      printWindow.document.write(buildAsnPrintHtml(freshAsn));
      printWindow.document.close();
      toast.success("ASN PDF export opened");
    } catch (error: any) {
      printWindow.close();
      toast.error("Unable to export ASN PDF", { description: error.message });
    } finally {
      setExportingId(null);
    }
  };

  return (
    <AppShell
      title={
        <div className="flex items-center gap-2">
          <span>Advanced Shipping Notices</span>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="ASNs Info"
                className="inline-flex items-center text-muted-foreground hover:text-foreground transition-colors"
              >
                <Info className="size-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-3 text-xs font-normal text-popover-foreground rounded-xl shadow-lg" align="start">
              Advance Shipment Notices sent by suppliers before material arrives at the warehouse.
            </PopoverContent>
          </Popover>
        </div>
      }
      subtitle="Track incoming supplier shipments and vehicle arrivals"
      actions={
        <Button
          className="rounded-xl shadow-glow"
          onClick={() => fetchData(true)}
          disabled={refreshing}
        >
          <RefreshCw className={`mr-2 size-4 ${refreshing ? "animate-spin" : ""}`} /> Refresh ASNs
        </Button>
      }
    >
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            placeholder="Search ASN no, PO no, vendor..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            className="h-10 w-full rounded-xl border border-border bg-card pl-10 pr-4 text-sm outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div className="relative">
          <Filter className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="h-10 rounded-xl border border-border bg-card pl-10 pr-9 text-sm font-medium outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="ALL">All Statuses</option>
            {statuses.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>
        {hasActiveFilters && (
          <Button
            variant="outline"
            className="rounded-xl border-border"
            onClick={() => {
              setSearchTerm("");
              setStatusFilter("ALL");
            }}
          >
            Clear
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : asns.length === 0 ? (
        <Card className="flex h-64 flex-col items-center justify-center p-6 text-center border-dashed border-border/50 bg-muted/20">
          <Truck className="size-12 text-muted-foreground/30 mb-4" />
          <h3 className="text-lg font-semibold text-muted-foreground">No shipments tracked yet</h3>
          <p className="text-sm text-muted-foreground/70">
            Incoming supplier shipments will appear here once ASNs are submitted.
          </p>
        </Card>
      ) : filteredAsns.length === 0 ? (
        <Card className="flex h-64 flex-col items-center justify-center p-6 text-center border-dashed border-border/50 bg-muted/20">
          <Search className="size-12 text-muted-foreground/30 mb-4" />
          <h3 className="text-lg font-semibold text-muted-foreground">No ASNs match your filters</h3>
          <p className="text-sm text-muted-foreground/70">
            Try a different ASN, PO, supplier, transporter, vehicle, or status.
          </p>
        </Card>
      ) : (
        <div className="grid gap-4">
          {filteredAsns.map((asn) => {
            const poReference = getPoReference(asn);
            const poColor = poColorClasses[getPoColorIndex(poReference)];

            let rawLog = asn.logistics;
            if (typeof rawLog === "string") {
              try {
                rawLog = JSON.parse(rawLog);
              } catch {
                rawLog = null;
              }
            }
            const logList = Array.isArray(rawLog) && rawLog.length > 0 ? rawLog : null;
            const displayTransporter = logList
              ? logList.map((l: any) => l.transporter).filter(Boolean).join(", ") || asn.transporter || "N/A"
              : asn.transporter || "N/A";
            const displayVehicles = logList
              ? logList.map((l: any) => l.vehicle_number || l.vehicleNumber).filter(Boolean).join(", ") || asn.vehicleNumber || "N/A"
              : asn.vehicleNumber || "N/A";

            return (
              <Card
                key={asn.id}
                className={`overflow-hidden border-l-4 border-border/50 transition-all hover:border-primary/30 hover:shadow-soft ${poColor.card}`}
              >
              <div className="flex flex-col p-5 md:flex-row md:items-center">
                <div className="mb-4 flex flex-1 items-start gap-4 md:mb-0">
                  <div className={`grid size-12 shrink-0 place-items-center rounded-2xl ${poColor.icon}`}>
                    <Truck className="size-6" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-foreground tracking-tight">{asn.asnNumber}</h3>
                      <StatusBadge status={asn.status} />
                    </div>
                    <p className="mt-1 text-sm font-semibold text-foreground/80">
                      {asn.supplierName || "Independent Supplier"}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground font-medium">
                      <span className={`flex items-center gap-1.5 italic px-2 py-0.5 rounded border ${poColor.badge}`}>
                        PO Ref: {poReference === "UNLINKED" ? "N/A" : poReference}
                      </span>
                      <span className="flex items-center gap-1.5">
                        Transporter:{" "}
                        <span className="text-foreground font-bold">
                          {displayTransporter}
                        </span>
                      </span>
                      <span className="flex items-center gap-1.5">
                        Vehicle:{" "}
                        <span className="text-foreground font-bold">
                          {displayVehicles}
                        </span>
                      </span>
                      <span className="flex items-center gap-1.5">
                        Pkg:{" "}
                        <span className="text-foreground font-bold">
                          {asn.numberOfPackages || 0}
                        </span>
                      </span>
                      <span className="flex items-center gap-1.5">
                        Invoice:{" "}
                        <span className="text-foreground font-bold">
                          {asn.invoiceNumber || asn.invoice_number || "N/A"}
                        </span>
                      </span>
                      <span className="flex items-center gap-1.5">
                        Challan:{" "}
                        <span className="text-foreground font-bold">
                          {asn.challanNumber || asn.challan_number || "N/A"}
                        </span>
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-border/40 pt-4 md:border-0 md:pt-0">
                  <div className="mr-8 text-right hidden md:block">
                    <div className="flex flex-col items-end gap-1">
                      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-black">
                        <MapPin className="size-3 text-primary" /> Expected Arrival
                      </div>
                      <p className="text-sm font-bold tabular-nums text-foreground">
                        {asn.expectedArrivalAt
                          ? new Date(asn.expectedArrivalAt).toLocaleDateString()
                          : "-"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="rounded-xl hover:bg-muted/50"
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="rounded-xl min-w-[160px]">
                        <DropdownMenuItem
                          className="rounded-lg gap-2 cursor-pointer font-medium text-xs"
                          disabled={loadingDocumentsId === asn.id}
                          onSelect={(event) => {
                            event.preventDefault();
                            void handleViewDocuments(asn);
                          }}
                        >
                          {loadingDocumentsId === asn.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Eye className="size-3.5" />
                          )}
                          View Documents
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="rounded-lg gap-2 cursor-pointer font-medium text-xs"
                          disabled={exportingId === asn.id}
                          onSelect={(event) => {
                            event.preventDefault();
                            void handleExportPdf(asn);
                          }}
                        >
                          {exportingId === asn.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <FileText className="size-3.5" />
                          )}
                          Export PDF
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>

                    <Button
                      variant="outline"
                      className="rounded-xl group h-9 px-4 font-bold border-primary/20 text-primary hover:bg-primary-soft/10"
                      asChild
                    >
                      <Link to="/procurement/asns/$asnId" params={{ asnId: asn.id }}>
                        Track Shipment{" "}
                        <ArrowRight className="ml-2 size-3.5 transition-transform group-hover:translate-x-1" />
                      </Link>
                    </Button>
                  </div>
                </div>
              </div>
              </Card>
            );
          })}
        </div>
      )}
      <Dialog open={documentsOpen} onOpenChange={setDocumentsOpen}>
        <DialogContent className="max-w-2xl rounded-2xl">
          <DialogHeader>
            <DialogTitle>ASN Documents</DialogTitle>
            <DialogDescription>
              {readField(selectedAsn, "asnNumber", "asn_number") || "Selected ASN"} shipping
              documents loaded from the latest ASN record.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {(readField(selectedAsn, "documents", "documents") || []).length > 0 ? (
              (readField(selectedAsn, "documents", "documents") || []).map((document: any, index: number) => {
                const fileName = readField(document, "fileName", "file_name") || "Document";
                const documentType = readField(document, "documentType", "document_type") || "Document";
                const fileUrl = resolveDocumentUrl(readField(document, "fileUrl", "file_url"));

                return (
                  <div
                    key={`${fileName}-${index}`}
                    className="flex flex-col gap-3 rounded-xl border border-border/60 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                        <FileText className="size-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-foreground">{fileName}</p>
                        <p className="text-xs font-medium uppercase text-muted-foreground">
                          {documentType}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      className="rounded-xl"
                      disabled={!fileUrl}
                      asChild={!!fileUrl}
                    >
                      {fileUrl ? (
                        <a href={fileUrl} target="_blank" rel="noreferrer">
                          <Download className="mr-2 size-4" /> Open
                        </a>
                      ) : (
                        <span>
                          <Download className="mr-2 size-4" /> Missing File
                        </span>
                      )}
                    </Button>
                  </div>
                );
              })
            ) : (
              <div className="rounded-xl border-2 border-dashed border-border/60 p-8 text-center">
                <FileText className="mx-auto mb-3 size-10 text-muted-foreground/40" />
                <p className="text-sm font-semibold text-muted-foreground">
                  No shipping documents attached.
                </p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
