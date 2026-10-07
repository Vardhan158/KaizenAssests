import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Clipboard, ClipboardList, Download, GitFork, Loader2, QrCode, RefreshCw, Search } from "lucide-react";
import QRCode from "qrcode";
import { toast } from "sonner";

import { AppShell } from "@/components/wms/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { GenealogyModal } from "@/components/assembly/genealogy-modal";
import { api } from "@/lib/api-client";

const sectionInfo: Record<string, { title: string; subtitle: string }> = {
  "material-requirements": { title: "Material Requirements", subtitle: "Required components, availability, and shortages by assembly order" },
  "material-reservations": { title: "Material Reservations", subtitle: "Stock protected for released assembly orders" },
  "material-issues": { title: "Material Issues", subtitle: "Warehouse material handoffs to the assembly area" },
  "work-orders": { title: "Work Orders", subtitle: "Assembly execution, steps, targets, and team assignments" },
  "assembly-progress": { title: "Assembly Progress", subtitle: "Target, completed, remaining, and current progress" },
  "material-consumption": { title: "Material Consumption", subtitle: "Planned versus actual component consumption and variance" },
  "scrap-wastage": { title: "Scrap / Wastage", subtitle: "Damaged material, reasons, responsibility, and approvals" },
  "quality-inspection": { title: "Quality Inspection", subtitle: "Finished assembly inspection results and reconciliation" },
  rework: { title: "Rework", subtitle: "Quality failures returned to assembly teams for correction" },
  "finished-goods": { title: "Finished Goods", subtitle: "Quality-approved products transferred into Finished Goods Store inventory" },
};

function badgeTone(value: string) {
  const normalized = value.toUpperCase();
  if (["AVAILABLE", "ISSUED", "COMPLETED", "PASSED", "APPROVED", "CLOSED", "ON_TARGET"].includes(normalized)) return "bg-emerald-100 text-emerald-700";
  if (["FAILED", "SHORTAGE", "OVER_CONSUMPTION", "REJECTED"].includes(normalized)) return "bg-red-100 text-red-700";
  if (["PENDING", "PENDING_INSPECTION", "PENDING_APPROVAL", "PUTAWAY_PENDING", "REWORK_REQUIRED", "ON_HOLD"].includes(normalized)) return "bg-amber-100 text-amber-700";
  return "bg-blue-100 text-blue-700";
}

export function AssemblyModulePage({ section }: { section: string }) {
  const info = sectionInfo[section] || { title: "Assembly Module", subtitle: "Assembly operational module" };
  const [data, setData] = useState<any>();
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selectedGenealogyId, setSelectedGenealogyId] = useState<string | null>(null);
  const [genealogyOpen, setGenealogyOpen] = useState(false);
  const [qrPreview, setQrPreview] = useState<{ value: string; image: string } | null>(null);

  const load = useCallback(async () => {
    try { setData(await api.getAssemblyModuleOverview(section)); }
    catch (error) { toast.error(`Unable to load ${info.title.toLowerCase()}`, { description: error instanceof Error ? error.message : undefined }); }
    finally { setLoading(false); }
  }, [info.title, section]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 10000);
    return () => window.clearInterval(timer);
  }, [load]);
  const rows = useMemo(() => (data?.rows || []).filter((row: any) => JSON.stringify(row).toLowerCase().includes(query.toLowerCase())), [data, query]);
  const columns = data?.columns || [];

  const openGenealogy = (item: any) => {
    const target = item.id || item.qr_code || item.serial_number || item.order_id || item.order || item.code || item.product;
    if (target) {
      setSelectedGenealogyId(target);
      setGenealogyOpen(true);
    }
  };

  const getFinishedGoodsQr = (row: any) => row.qr_code || row.qr || row.serial_number;

  const previewFinishedGoodsQr = async (row: any) => {
    const value = getFinishedGoodsQr(row);
    if (!value) return toast.error("No QR code is available for this finished good.");
    const image = await QRCode.toDataURL(value, { width: 320, margin: 2, errorCorrectionLevel: "H" });
    setQrPreview({ value, image });
  };

  const copyFinishedGoodsQr = async (row: any) => {
    const value = getFinishedGoodsQr(row);
    if (!value) return toast.error("No QR code is available for this finished good.");
    await navigator.clipboard.writeText(value);
    toast.success("Finished-goods QR copied");
  };

  const downloadFinishedGoodsQr = async (row: any) => {
    const value = getFinishedGoodsQr(row);
    if (!value) return toast.error("No QR code is available for this finished good.");
    const image = await QRCode.toDataURL(value, { width: 640, margin: 3, errorCorrectionLevel: "H" });
    const link = document.createElement("a");
    link.href = image;
    link.download = `${row.product_code || row.code || "finished-good"}-${row.serial_number || "qr"}.png`;
    link.click();
  };

  return (
    <AppShell
      title={info.title}
      subtitle={info.subtitle}
      actions={
        <Button variant="outline" onClick={() => void load()}>
          <RefreshCw className="size-4 mr-1.5" />Refresh
        </Button>
      }
    >
      {loading ? (
        <div className="grid h-72 place-items-center">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="rounded-2xl p-4 shadow-sm border">
              <p className="text-xs font-bold uppercase text-muted-foreground">Total records</p>
              <p className="text-3xl font-black mt-1">{data?.total ?? data?.rows?.length ?? 0}</p>
            </Card>
            {(data?.status_summary || []).slice(0, 3).map((item: any) => (
              <Card key={item.status} className="rounded-2xl p-4 shadow-sm border">
                <p className="text-xs font-bold uppercase text-muted-foreground">
                  {item.status.replaceAll("_", " ")}
                </p>
                <p className="text-3xl font-black mt-1">{item.count}</p>
              </Card>
            ))}
          </div>

          <Card className="mb-4 rounded-2xl p-4 shadow-sm border">
            <div className="relative max-w-xl">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9 rounded-xl"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${info.title.toLowerCase()}...`}
              />
            </div>
          </Card>

          <Card className="overflow-hidden rounded-2xl p-0 shadow-sm border">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    {columns.map((column: any) => (
                      <th
                        key={column.key}
                        className="px-4 py-3 text-[10px] font-black uppercase tracking-wider text-muted-foreground"
                      >
                        {column.label}
                      </th>
                    ))}
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.length ? (
                    rows.map((row: any, index: number) => (
                      <tr
                        key={`${row.order_id || "row"}-${index}`}
                        className="hover:bg-muted/20 transition-colors"
                      >
                    {(data?.columns || []).map((column: any) => {
                          const value = row[column.key];
                          const isStatus = ["status", "result"].includes(column.key);
                          const isDate = ["date", "posted", "issued_at", "reserved_at"].includes(column.key);
                          return (
                            <td key={column.key} className="max-w-80 px-4 py-3.5">
                              {isStatus ? (
                                <Badge className={badgeTone(String(value))}>
                                  {String(value).replaceAll("_", " ")}
                                </Badge>
                              ) : isDate && value ? (
                                new Date(value).toLocaleString()
                              ) : (
                                <span className="font-medium text-foreground">
                                  {String(value ?? "—")}
                                </span>
                              )}
                            </td>
                          );
                        })}
                        <td className="px-4 py-3.5 text-right space-x-2 whitespace-nowrap">
                          {section === "finished-goods" && (
                            <div className="inline-flex items-center gap-1">
                              <Button size="sm" variant="outline" className="rounded-xl h-8 text-xs font-bold text-indigo-600 border-indigo-200" onClick={() => void previewFinishedGoodsQr(row)}>
                                <QrCode className="size-3.5 mr-1" /> View QR
                              </Button>
                              <Button size="sm" variant="outline" className="rounded-xl h-8 px-2" title="Copy QR" onClick={() => void copyFinishedGoodsQr(row)}>
                                <Clipboard className="size-3.5" />
                              </Button>
                              <Button size="sm" variant="outline" className="rounded-xl h-8 px-2" title="Download QR" onClick={() => void downloadFinishedGoodsQr(row)}>
                                <Download className="size-3.5" />
                              </Button>
                              <Button size="sm" variant="outline" className="rounded-xl h-8 text-xs font-bold" onClick={() => openGenealogy(row)}>
                                <GitFork className="size-3.5 mr-1" /> Genealogy
                              </Button>
                            </div>
                          )}
                          {row.order_id && (
                            <Link
                              to="/assembly-orders"
                              search={{ q: row.order || row.assembly || "" } as any}
                              className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline"
                            >
                              <ClipboardList className="size-3.5" />
                              Open Order
                            </Link>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={columns.length + 1}
                        className="px-4 py-16 text-center text-muted-foreground"
                      >
                        No records found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <GenealogyModal
            identifier={selectedGenealogyId}
            open={genealogyOpen}
            onOpenChange={setGenealogyOpen}
          />
          <Dialog open={!!qrPreview} onOpenChange={(open) => !open && setQrPreview(null)}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Finished Goods QR</DialogTitle>
                <DialogDescription>Scan this QR in Finished Goods Store putaway.</DialogDescription>
              </DialogHeader>
              {qrPreview && (
                <div className="space-y-4 text-center">
                  <img src={qrPreview.image} alt="Finished goods QR code" className="mx-auto size-64 rounded-lg border p-2" />
                  <code className="block break-all rounded-lg bg-muted p-3 text-left text-xs">{qrPreview.value}</code>
                  <Button className="rounded-xl" onClick={() => void navigator.clipboard.writeText(qrPreview.value).then(() => toast.success("Finished-goods QR copied"))}>
                    <Clipboard className="mr-2 size-4" /> Copy Full QR
                  </Button>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </>
      )}
    </AppShell>
  );
}

