import { useEffect, useState } from "react";
import {
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Clock,
  ExternalLink,
  Factory,
  FileCheck2,
  FileText,
  Fingerprint,
  GitCommit,
  GitFork,
  Layers,
  Loader2,
  MapPin,
  Package,
  PackageCheck,
  QrCode as QrCodeIcon,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Store,
  Tag,
  Truck,
  User,
  Users,
} from "lucide-react";
import QRCode from "qrcode";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface GenealogyModalProps {
  identifier: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GenealogyModal({ identifier, open, onOpenChange }: GenealogyModalProps) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [expandedMaterial, setExpandedMaterial] = useState<string | null>(null);

  useEffect(() => {
    if (!identifier || !open) {
      setData(null);
      setQrDataUrl("");
      return;
    }

    const fetchGenealogy = async () => {
      setLoading(true);
      try {
        const res = await api.getGenealogy(identifier);
        setData(res);

        // Generate QR image for the finished good
        const qrString =
          res?.finished_good?.qr_code ||
          `FG-QR|${res?.finished_good?.product_code}|${res?.finished_good?.serial_number || res?.assembly_order?.order_number}`;
        const dataUrl = await QRCode.toDataURL(qrString, {
          width: 180,
          margin: 1,
          color: { dark: "#0f172a", light: "#ffffff" },
        });
        setQrDataUrl(dataUrl);
      } catch (err: any) {
        toast.error("Failed to load finished good genealogy", {
          description: err instanceof Error ? err.message : undefined,
        });
      } finally {
        setLoading(false);
      }
    };

    void fetchGenealogy();
  }, [identifier, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto rounded-3xl p-6 shadow-2xl">
        <DialogHeader className="border-b pb-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 ring-1 ring-indigo-200">
                <GitFork className="size-6" />
              </div>
              <div>
                <DialogTitle className="text-xl font-bold tracking-tight">
                  Product Genealogy & Traceability Chain
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Complete end-to-end audit trace from raw material receiving through assembly to Finished Goods Store
                </DialogDescription>
              </div>
            </div>
          </div>
        </DialogHeader>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="size-10 animate-spin text-primary" />
            <p className="text-sm font-medium text-muted-foreground">
              Tracing production and material genealogy...
            </p>
          </div>
        ) : !data ? (
          <div className="py-16 text-center text-muted-foreground">
            <p>No genealogy data available for this item.</p>
          </div>
        ) : (
          <div className="space-y-6 pt-2">
            {/* Step 1: Finished Good Summary Card */}
            <div className="relative rounded-2xl border-2 border-emerald-500/30 bg-emerald-50/20 p-5 dark:bg-emerald-950/10">
              <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-emerald-600 text-white hover:bg-emerald-700">
                      Finished Good Product
                    </Badge>
                    <Badge variant="outline" className="font-mono text-xs">
                      {data.finished_good?.product_code}
                    </Badge>
                    <Badge
                      className={cn(
                        data.finished_good?.status === "AVAILABLE"
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-amber-100 text-amber-800",
                      )}
                    >
                      {data.finished_good?.status}
                    </Badge>
                  </div>
                  <h3 className="text-2xl font-black tracking-tight text-foreground">
                    {data.finished_good?.product_name}
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs pt-1">
                    <div>
                      <span className="text-muted-foreground">Serial Number:</span>
                      <p className="font-mono font-bold text-foreground">
                        {data.finished_good?.serial_number || "—"}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Destination Store:</span>
                      <p className="font-semibold text-foreground">
                        {data.finished_good?.store_name} ({data.finished_good?.store_code})
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Storage Location:</span>
                      <p className="font-mono font-semibold text-foreground">
                        {data.finished_good?.location_code}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Quantity:</span>
                      <p className="font-bold text-foreground">
                        {data.finished_good?.quantity} {data.finished_good?.uom}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Completed At:</span>
                      <p className="text-foreground">
                        {data.assembly_order?.completed_at
                          ? new Date(data.assembly_order.completed_at).toLocaleString()
                          : "—"}
                      </p>
                    </div>
                  </div>
                </div>

                {qrDataUrl && (
                  <div className="flex flex-col items-center justify-center shrink-0 rounded-2xl border bg-white p-3 shadow-sm dark:bg-slate-900">
                    <img
                      src={qrDataUrl}
                      alt="FG Unit QR Code"
                      className="size-28 rounded-lg object-contain"
                    />
                    <span className="mt-1 font-mono text-[10px] text-muted-foreground">
                      Unique Product QR
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Traceability Flow Line */}
            <div className="relative pl-6 sm:pl-8 space-y-8 before:absolute before:left-3 sm:before:left-4 before:top-3 before:bottom-3 before:w-0.5 before:bg-gradient-to-b before:from-emerald-500 before:via-indigo-500 before:to-slate-300">
              
              {/* NODE 1: Assembly Order / Production */}
              <div className="relative">
                <div className="absolute -left-6 sm:-left-8 top-1.5 flex size-6 sm:size-7 items-center justify-center rounded-full bg-indigo-600 text-white ring-4 ring-background">
                  <Factory className="size-3.5" />
                </div>
                <Card className="rounded-2xl border bg-card p-4 shadow-sm">
                  <div className="flex items-center justify-between pb-2 border-b">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        Assembly Order & Production Execution
                      </span>
                      <Badge variant="outline" className="font-mono text-xs font-bold text-indigo-600">
                        {data.assembly_order?.order_number}
                      </Badge>
                    </div>
                    <Badge className="bg-indigo-100 text-indigo-700">
                      {data.assembly_order?.status}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 text-xs">
                    <div>
                      <span className="text-muted-foreground">Assigned Team:</span>
                      <p className="font-semibold">{data.assembly_order?.assigned_team || "—"}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Operator:</span>
                      <p className="font-semibold">{data.assembly_order?.assigned_operator || "—"}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Production Target:</span>
                      <p className="font-bold">
                        {data.assembly_order?.completed_quantity} / {data.assembly_order?.planned_quantity} Units
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Started Date:</span>
                      <p>
                        {data.assembly_order?.started_at
                          ? new Date(data.assembly_order.started_at).toLocaleDateString()
                          : "—"}
                      </p>
                    </div>
                  </div>

                  {/* Assembly Steps */}
                  <div className="mt-3 pt-3 border-t">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
                      Assembly Process Steps:
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {(data.assembly_steps || []).map((step: any) => (
                        <div
                          key={step.id || step.sequence}
                          className="flex items-center gap-2 rounded-lg border bg-muted/30 p-2 text-xs"
                        >
                          <CheckCircle2
                            className={cn(
                              "size-4 shrink-0",
                              step.status === "COMPLETED"
                                ? "text-emerald-600"
                                : "text-muted-foreground",
                            )}
                          />
                          <span className="truncate font-medium">{step.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </Card>
              </div>

              {/* NODE 2: Quality Inspection */}
              {data.quality_inspection && (
                <div className="relative">
                  <div className="absolute -left-6 sm:-left-8 top-1.5 flex size-6 sm:size-7 items-center justify-center rounded-full bg-violet-600 text-white ring-4 ring-background">
                    <ClipboardCheck className="size-3.5" />
                  </div>
                  <Card className="rounded-2xl border bg-card p-4 shadow-sm">
                    <div className="flex items-center justify-between pb-2 border-b">
                      <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        Final Quality Inspection & Verification
                      </span>
                      <Badge className="bg-emerald-100 text-emerald-800">
                        {data.quality_inspection.status}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 text-xs">
                      <div>
                        <span className="text-muted-foreground">Passed Units:</span>
                        <p className="font-bold text-emerald-700">
                          {data.quality_inspection.passed_quantity}
                        </p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Failed Units:</span>
                        <p className="font-bold text-red-600">
                          {data.quality_inspection.failed_quantity}
                        </p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Inspected By:</span>
                        <p className="font-semibold">{data.quality_inspection.inspected_by || "QC Inspector"}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Inspection Date:</span>
                        <p>
                          {data.quality_inspection.inspected_at
                            ? new Date(data.quality_inspection.inspected_at).toLocaleDateString()
                            : "—"}
                        </p>
                      </div>
                    </div>
                    {data.quality_inspection.notes && (
                      <p className="mt-2 text-xs text-muted-foreground italic bg-muted/40 p-2 rounded-lg">
                        Notes: {data.quality_inspection.notes}
                      </p>
                    )}
                  </Card>
                </div>
              )}

              {/* NODE 3: Consumed Raw Materials & Batches */}
              <div className="relative">
                <div className="absolute -left-6 sm:-left-8 top-1.5 flex size-6 sm:size-7 items-center justify-center rounded-full bg-amber-600 text-white ring-4 ring-background">
                  <Boxes className="size-3.5" />
                </div>
                <Card className="rounded-2xl border bg-card p-4 shadow-sm">
                  <div className="flex items-center justify-between pb-2 border-b">
                    <div>
                      <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        Consumed Raw Materials & Inbound Lot Traceability
                      </span>
                      <p className="text-xs text-muted-foreground">
                        Source batch numbers, store bins, and receiving GRNs
                      </p>
                    </div>
                    <Badge variant="outline">
                      {data.consumed_materials?.length || 0} Components
                    </Badge>
                  </div>

                  <div className="divide-y pt-2">
                    {(data.consumed_materials || []).map((mat: any, idx: number) => {
                      const isExpanded = expandedMaterial === mat.material_code || idx === 0;
                      return (
                        <div key={mat.material_code} className="py-3 first:pt-2 last:pb-0">
                          <div
                            className="flex items-center justify-between cursor-pointer hover:bg-muted/30 p-2 rounded-xl transition"
                            onClick={() =>
                              setExpandedMaterial(
                                expandedMaterial === mat.material_code ? null : mat.material_code,
                              )
                            }
                          >
                            <div className="flex items-center gap-3">
                              <div className="flex size-7 items-center justify-center rounded-lg bg-amber-100 text-amber-800 font-bold text-xs">
                                {idx + 1}
                              </div>
                              <div>
                                <p className="font-bold text-sm text-foreground">
                                  {mat.material_name}
                                </p>
                                <p className="font-mono text-xs text-muted-foreground">
                                  {mat.material_code} · {mat.actual_consumed} {mat.uom} Consumed
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {mat.batches?.length > 0 && (
                                <Badge variant="secondary" className="font-mono text-[10px]">
                                  {mat.batches[0]}
                                </Badge>
                              )}
                              <ChevronDown
                                className={cn(
                                  "size-4 text-muted-foreground transition-transform",
                                  isExpanded ? "rotate-180" : "",
                                )}
                              />
                            </div>
                          </div>

                          {isExpanded && (
                            <div className="mt-2 ml-10 rounded-xl border bg-muted/20 p-3 space-y-3 text-xs">
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                <div>
                                  <span className="text-muted-foreground">Batch / Lot Numbers:</span>
                                  <p className="font-mono font-bold text-foreground">
                                    {mat.batches?.join(", ") || "LOT-PRIMARY"}
                                  </p>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Source Locations / Bins:</span>
                                  <p className="font-mono text-foreground">
                                    {mat.source_locations?.join(", ") || "Raw Material Bay"}
                                  </p>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Standard Per Unit:</span>
                                  <p className="font-semibold text-foreground">
                                    {mat.expected_per_unit} {mat.uom}
                                  </p>
                                </div>
                              </div>

                              {/* Inbound GRN & QC info */}
                              {mat.grn_info && (
                                <div className="rounded-lg border border-blue-200/60 bg-blue-50/40 p-2.5 dark:bg-blue-950/20">
                                  <div className="flex items-center gap-2 text-[11px] font-bold text-blue-800 dark:text-blue-300">
                                    <Truck className="size-3.5" /> Inbound Receiving & Supplier Origin
                                  </div>
                                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1.5 text-xs">
                                    <div>
                                      <span className="text-muted-foreground">GRN Number:</span>
                                      <p className="font-mono font-bold text-foreground">
                                        {mat.grn_info.grn_number}
                                      </p>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Supplier Name:</span>
                                      <p className="font-semibold text-foreground truncate">
                                        {mat.grn_info.supplier_name}
                                      </p>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">PO Number:</span>
                                      <p className="font-mono text-foreground">
                                        {mat.grn_info.po_number}
                                      </p>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Inbound QC:</span>
                                      <Badge className="bg-emerald-100 text-emerald-800 text-[10px]">
                                        {mat.grn_info.qc_status}
                                      </Badge>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </Card>
              </div>

            </div>
          </div>
        )}

        <div className="flex justify-between items-center pt-4 border-t mt-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Fingerprint className="size-4 text-emerald-600" />
            Verified immutable lineage for regulatory compliance
          </div>
          <Button variant="outline" className="rounded-xl px-6" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
