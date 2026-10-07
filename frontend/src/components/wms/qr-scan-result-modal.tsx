import { useState } from "react";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  Copy,
  Check,
  FileText,
  Layers,
  Printer,
  QrCode,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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

export type QrScanResultData = {
  qr_id: string;
  grn_number: string;
  po_number: string;
  material_code: string;
  material_name: string;
  variant_code?: string | null;
  size?: string | null;
  color?: string | null;
  grade?: string | null;
  specification?: string | null;
  uom: string;
  supplier_code?: string | null;
  supplier_name: string;
  receipt_date?: string | null;
  warehouse_name?: string | null;
  category?: string | null;
  batch_number?: string | null;
  received_quantity: number;
  accepted_quantity: number;
  damaged_quantity: number;
  rejected_quantity?: number;
  batch_quantity?: number | null;
  inspection_status: string;
  stock_status: string;
  summary: string;
};

interface QRScanResultModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: QrScanResultData | null;
  onPrint?: (data: QrScanResultData) => void;
}

interface QrNotFoundModalProps {
  isOpen: boolean;
  onClose: () => void;
  scannedCode?: string;
}

export function QRScanResultModal({
  isOpen,
  onClose,
  data,
  onPrint,
}: QRScanResultModalProps) {
  const [copied, setCopied] = useState(false);

  if (!data) return null;

  const handleCopyQrId = () => {
    navigator.clipboard.writeText(data.qr_id);
    setCopied(true);
    toast.success(`Copied QR ID ${data.qr_id} to clipboard`);
    setTimeout(() => setCopied(false), 2000);
  };

  const isDamaged = data.stock_status === "QUARANTINED" || data.damaged_quantity > 0;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[96vw] max-w-4xl max-h-[90vh] overflow-y-auto rounded-3xl p-5 sm:p-7 shadow-2xl">
        <div className="space-y-5">
          {/* Header matching warehouse color variant modal */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/60 pb-4 pr-10">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "grid size-11 place-items-center rounded-2xl shrink-0",
                  isDamaged
                    ? "bg-danger-soft text-destructive"
                    : "bg-primary-soft text-primary"
                )}
              >
                <QrCode className="size-5" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-black text-primary px-2.5 py-0.5 rounded-lg bg-primary-soft border border-primary/20">
                    {data.qr_id}
                  </span>
                  <h2 className="text-lg font-bold text-foreground">
                    {data.material_name}
                  </h2>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold border",
                      data.stock_status === "AVAILABLE"
                        ? "bg-success-soft text-success border-success/30"
                        : "bg-danger-soft text-destructive border-destructive/30"
                    )}
                  >
                    {data.stock_status === "AVAILABLE" ? (
                      <CheckCircle2 className="size-3" />
                    ) : (
                      <AlertTriangle className="size-3" />
                    )}
                    {data.stock_status}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold bg-primary-soft text-primary border border-primary/20">
                    <ShieldCheck className="size-3" />
                    QA: {data.inspection_status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-foreground/80">
                    GRN: {data.grn_number}
                  </span>
                  <span>·</span>
                  <span>
                    PO: <strong className="font-mono">{data.po_number}</strong>
                  </span>
                  <span>·</span>
                  <span>
                    Supplier: <strong>{data.supplier_name}</strong>
                  </span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                className="h-8.5 rounded-xl text-xs font-semibold"
                onClick={handleCopyQrId}
              >
                {copied ? <Check className="mr-1 size-3.5 text-success" /> : <Copy className="mr-1 size-3.5" />}
                {copied ? "Copied" : "Copy QR ID"}
              </Button>
              {onPrint && (
                <Button
                  size="sm"
                  className={cn(
                    "h-8.5 rounded-xl font-bold text-xs shadow-glow text-primary-foreground",
                    isDamaged
                      ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      : "bg-primary hover:bg-primary/90"
                  )}
                  onClick={() => onPrint(data)}
                >
                  <Printer className="mr-1 size-3.5" /> Print Label
                </Button>
              )}
            </div>
          </div>

          {/* Section 1: Reference & Supplier Details Card */}
          <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-2xs space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5">
              <FileText className="size-3.5 text-primary" />
              Reference & Supplier Details
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="space-y-0.5">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  QR / Stock ID
                </span>
                <div className="font-mono font-bold text-foreground break-all">
                  {data.qr_id}
                </div>
              </div>
              <div className="space-y-0.5">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  GRN Number
                </span>
                <div className="font-mono font-bold text-foreground">
                  {data.grn_number}
                </div>
              </div>
              <div className="space-y-0.5">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  PO Reference
                </span>
                <div className="font-mono font-bold text-foreground">
                  {data.po_number}
                </div>
              </div>
              <div className="space-y-0.5">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  Receiving Date
                </span>
                <div className="font-medium text-foreground">
                  {data.receipt_date || "—"}
                </div>
              </div>
              <div className="space-y-0.5">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  Supplier Code
                </span>
                <div className="font-mono font-bold text-primary">
                  {data.supplier_code || "—"}
                </div>
              </div>
              <div className="space-y-0.5">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  Supplier Name
                </span>
                <div className="font-medium text-foreground">
                  {data.supplier_name}
                </div>
              </div>
              <div className="space-y-0.5">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  Warehouse
                </span>
                <div className="font-medium text-foreground">
                  {data.warehouse_name || "Main Warehouse"}
                </div>
              </div>
              <div className="space-y-0.5">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  Category
                </span>
                <div className="font-medium text-foreground">
                  {data.category || "General"}
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Material & Variant Specifications Card */}
          <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5">
                <Boxes className="size-3.5 text-teal" />
                Material & Variant Specifications
              </h3>
              {data.variant_code && (
                <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded-md bg-teal-soft text-teal border border-teal/20">
                  {data.variant_code}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="space-y-0.5">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  Material Code
                </span>
                <div className="font-mono font-bold text-foreground">
                  {data.material_code}
                </div>
              </div>
              <div className="space-y-0.5">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  Variant Code
                </span>
                <div className="font-mono font-bold text-teal">
                  {data.variant_code || `${data.material_code}-V001`}
                </div>
              </div>
              <div className="space-y-0.5">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  Size / Dimension
                </span>
                <div className="font-medium text-foreground">
                  {data.size || "Standard Specification"}
                </div>
              </div>
              <div className="space-y-0.5">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  Color
                </span>
                <div>
                  {data.color ? (
                    <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                      <span
                        className="size-2.5 rounded-full border border-border inline-block shrink-0 shadow-xs"
                        style={{
                          backgroundColor:
                            data.color.toLowerCase() === "white"
                              ? "#f8fafc"
                              : data.color.toLowerCase(),
                        }}
                      />
                      <span>{data.color}</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </div>
              </div>
              <div className="space-y-0.5">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  Grade / Standard
                </span>
                <div className="font-medium text-foreground">
                  {data.grade || "Standard Industrial Grade"}
                </div>
              </div>
              <div className="space-y-0.5">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  Base UOM
                </span>
                <div className="font-mono font-bold text-foreground">
                  {data.uom}
                </div>
              </div>
              <div className="space-y-0.5 sm:col-span-2">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  Batch / Lot Number
                </span>
                <div className="font-mono font-bold text-foreground">
                  {data.batch_number || "BATCH-001"}
                </div>
              </div>
            </div>

            {data.specification && (
              <div className="mt-2 p-2.5 rounded-xl bg-muted/20 border border-border/50 text-[11px] text-muted-foreground leading-relaxed">
                <span className="font-bold text-foreground mr-1">Specification:</span>
                {data.specification}
              </div>
            )}
          </div>

          {/* Section 3: Quantity Details Breakdown */}
          <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-2xs space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5">
              <Layers className="size-3.5 text-primary" />
              Received & Quality Quantities
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-xl bg-muted/20 border border-border/50">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">
                  Received Qty
                </span>
                <div className="font-mono text-base font-extrabold text-foreground mt-0.5">
                  {data.received_quantity}{" "}
                  <span className="text-xs font-medium text-muted-foreground">
                    {data.uom}
                  </span>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-success-soft border border-success/30">
                <span className="text-[10px] font-bold text-success uppercase tracking-wider block">
                  Accepted Qty
                </span>
                <div className="font-mono text-base font-extrabold text-success mt-0.5">
                  {data.accepted_quantity}{" "}
                  <span className="text-xs font-medium">
                    {data.uom}
                  </span>
                </div>
              </div>

              <div
                className={cn(
                  "p-3 rounded-xl border",
                  data.damaged_quantity > 0
                    ? "bg-danger-soft border-destructive/30 text-destructive"
                    : "bg-muted/20 border-border/50 text-muted-foreground"
                )}
              >
                <span className="text-[10px] font-bold uppercase tracking-wider block">
                  Damaged Qty
                </span>
                <div className="font-mono text-base font-extrabold mt-0.5">
                  {data.damaged_quantity}{" "}
                  <span className="text-xs font-medium">
                    {data.uom}
                  </span>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-muted/20 border border-border/50">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">
                  Rejected Qty
                </span>
                <div className="font-mono text-base font-extrabold text-foreground mt-0.5">
                  {data.rejected_quantity || 0}{" "}
                  <span className="text-xs font-medium text-muted-foreground">
                    {data.uom}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Section 4: Dynamic Summary Callout Box */}
          <div
            className={cn(
              "rounded-2xl p-4 border text-xs space-y-1.5 shadow-2xs",
              isDamaged
                ? "bg-danger-soft/40 border-destructive/30 text-destructive"
                : "bg-primary-soft/40 border-primary/20 text-foreground"
            )}
          >
            <div className="font-bold flex items-center gap-1.5 uppercase text-[11px]">
              {isDamaged ? (
                <AlertTriangle className="size-3.5 text-destructive" />
              ) : (
                <CheckCircle2 className="size-3.5 text-primary" />
              )}
              <span>Stock & Quality Summary</span>
            </div>
            <p className="text-sm font-semibold whitespace-pre-line leading-relaxed">
              {data.summary}
            </p>
          </div>

          <DialogFooter className="border-t pt-4 flex sm:flex-row items-center justify-between gap-3">
            <div className="text-[11px] text-muted-foreground flex items-center gap-2">
              <span className="inline-block size-2 rounded-full bg-success animate-pulse" />
              Database Record Verified
            </div>
            <Button
              variant="outline"
              className="rounded-xl px-6 font-semibold"
              onClick={onClose}
            >
              Close
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function QrNotFoundModal({
  isOpen,
  onClose,
  scannedCode,
}: QrNotFoundModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md rounded-3xl p-6 text-center space-y-4 shadow-2xl">
        <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-danger-soft text-destructive shadow-inner">
          <XCircle className="size-8" />
        </div>

        <DialogHeader className="space-y-1 text-center">
          <DialogTitle className="text-lg font-bold text-foreground">
            QR Code Not Found
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground max-w-sm mx-auto">
            This QR code is not registered in the system.
          </DialogDescription>
        </DialogHeader>

        {scannedCode && (
          <div className="p-3 rounded-xl bg-muted/40 border border-border text-left">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
              Scanned Value
            </span>
            <span className="font-mono text-xs font-bold text-destructive break-all">
              {scannedCode.length > 100
                ? `${scannedCode.substring(0, 100)}...`
                : scannedCode}
            </span>
          </div>
        )}

        <DialogFooter className="pt-2">
          <Button
            className="w-full rounded-xl font-bold shadow-glow"
            onClick={onClose}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
