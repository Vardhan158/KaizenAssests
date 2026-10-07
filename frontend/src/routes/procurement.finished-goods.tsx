import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import {
  Boxes,
  ClipboardList,
  Download,
  FileText,
  Loader2,
  Paperclip,
  RefreshCw,
  Search,
  Send,
  Upload,
  X,
} from "lucide-react";
import { AppShell, StatusBadge } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { api, BUSINESS_API_URL } from "@/lib/api-client";
import { getUserInfo, requireRole } from "@/lib/auth-utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

export const Route = createFileRoute("/procurement/finished-goods")({
  beforeLoad: () => requireRole(["PROCUREMENT", "PROCUREMENT_MANAGER", "ADMIN", "SUPERUSER"]),
  component: ProcurementFinishedGoods,
});

const today = () => new Date().toISOString().split("T")[0];

function formatDisplayDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  const date = new Date(String(dateStr));
  if (Number.isNaN(date.getTime())) return String(dateStr).split("T")[0] || "-";
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function ProcurementFinishedGoods() {
  const [requests, setRequests] = useState<any[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingBom, setUploadingBom] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRequest, setSelectedRequest] = useState<any | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [bomFile, setBomFile] = useState<File | null>(null);
  const [uploadedBomUrl, setUploadedBomUrl] = useState<string | null>(null);
  const [uploadedBomName, setUploadedBomName] = useState<string | null>(null);

  const defaultRequester = getUserInfo()?.username?.trim() || "procurement";

  const [form, setForm] = useState({
    product_name: "",
    warehouse_id: "MAIN",
    quantity: "10",
    uom: "PCS",
    required_date: today(),
    requested_by: defaultRequester,
    requested_date: today(),
    remarks: "",
  });

  const fetchRequests = async () => {
    try {
      setLoadingRequests(true);
      const data = await api.getFinishedGoodsRequests();
      setRequests(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Failed to fetch finished goods requests:", error);
      toast.error("Failed to load finished goods requests");
    } finally {
      setLoadingRequests(false);
    }
  };

  useEffect(() => {
    void fetchRequests();
    const user = getUserInfo()?.username?.trim();
    if (user) {
      setForm((prev) => ({ ...prev, requested_by: prev.requested_by || user }));
    }
  }, []);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setBomFile(file);
    setUploadingBom(true);
    try {
      const res = await api.uploadBomAttachment(file);
      setUploadedBomUrl(res.file_url);
      setUploadedBomName(res.file_name);
      toast.success("BOM attachment uploaded successfully");
    } catch (err: any) {
      console.error("BOM upload failed:", err);
      toast.error("Failed to upload BOM file", { description: err.message });
      setBomFile(null);
      setUploadedBomUrl(null);
      setUploadedBomName(null);
    } finally {
      setUploadingBom(false);
    }
  };

  const removeBomFile = () => {
    setBomFile(null);
    setUploadedBomUrl(null);
    setUploadedBomName(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const requester = form.requested_by.trim() || getUserInfo()?.username?.trim() || "procurement";
    const requestDate = form.requested_date || today();
    const productName = form.product_name.trim();
    const quantity = Number(form.quantity);

    if (!productName) {
      toast.error("Finished Product name/code is required");
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      toast.error("Quantity must be a positive number greater than 0");
      return;
    }
    if (!requester) {
      toast.error("Requested By (Requester name) is required");
      return;
    }

    setSubmitting(true);
    try {
      await api.createFinishedGoodsRequest({
        warehouse_id: form.warehouse_id.trim() || "MAIN",
        finished_goods_code: productName,
        finished_goods_name: productName,
        quantity,
        uom: form.uom.trim() || "PCS",
        required_date: form.required_date,
        requested_by: requester,
        requested_date: requestDate,
        bom_attachment_url: uploadedBomUrl,
        bom_attachment_name: uploadedBomName,
        remarks: form.remarks.trim() || null,
      });

      toast.success("Finished Goods Request created and sent to Assembly!", {
        description: `Request for ${quantity} ${form.uom} of ${productName} sent by ${requester}.`,
      });

      // Reset form
      setForm({
        product_name: "",
        warehouse_id: "MAIN",
        quantity: "10",
        uom: "PCS",
        required_date: today(),
        requested_by: defaultRequester,
        requested_date: today(),
        remarks: "",
      });
      removeBomFile();

      await fetchRequests();
    } catch (error: any) {
      toast.error("Failed to send Finished Goods Request", { description: error.message });
    } finally {
      setSubmitting(false);
    }
  };

  const filteredRequests = requests.filter((req) => {
    const q = searchQuery.toLowerCase();
    return (
      (req.request_number || "").toLowerCase().includes(q) ||
      (req.product_name || req.finished_goods_name || "").toLowerCase().includes(q) ||
      (req.product_code || req.finished_goods_code || "").toLowerCase().includes(q) ||
      (req.requested_by || "").toLowerCase().includes(q) ||
      (req.status || "").toLowerCase().includes(q)
    );
  });

  return (
    <AppShell
      title="Finished Goods Requests"
      subtitle="Create and route Finished Goods production requests to Assembly and Warehouse"
      actions={
        <Button variant="outline" onClick={() => void fetchRequests()} disabled={loadingRequests}>
          <RefreshCw className={`mr-2 size-4 ${loadingRequests ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      }
    >
      <div className="grid gap-6 xl:grid-cols-[480px_minmax(0,1fr)]">
        {/* Create Request Form */}
        <Card className="rounded-2xl border bg-card p-6 shadow-sm">
          <div className="mb-6 flex items-center gap-3 border-b border-border/60 pb-5">
            <div className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
              <Boxes className="size-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight">New Finished Goods Request</h2>
              <p className="text-xs text-muted-foreground">
                Request product manufacturing and availability confirmation from Assembly
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Finished Product (Manual Input) */}
            <div className="space-y-1.5">
              <Label htmlFor="finished-product" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Finished Product <span className="text-red-500">*</span>
              </Label>
              <Input
                id="finished-product"
                value={form.product_name}
                onChange={(e) => setForm((c) => ({ ...c, product_name: e.target.value }))}
                className="h-11 rounded-xl"
                placeholder="e.g. PUMP-100"
                required
              />
            </div>

            {/* Quantity & UOM */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="fg-quantity" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Quantity <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="fg-quantity"
                  type="number"
                  min="0.01"
                  step="any"
                  value={form.quantity}
                  onChange={(e) => setForm((c) => ({ ...c, quantity: e.target.value }))}
                  className="h-11 rounded-xl font-bold"
                  placeholder="10"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="fg-uom" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  UOM <span className="text-red-500">*</span>
                </Label>
                <Select
                  value={form.uom}
                  onValueChange={(v) => setForm((c) => ({ ...c, uom: v }))}
                >
                  <SelectTrigger id="fg-uom" className="h-11 rounded-xl">
                    <SelectValue placeholder="Select UOM" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PCS">PCS (Pieces)</SelectItem>
                    <SelectItem value="KG">KG (Kilograms)</SelectItem>
                    <SelectItem value="MTR">MTR (Meters)</SelectItem>
                    <SelectItem value="LTR">LTR (Liters)</SelectItem>
                    <SelectItem value="BOX">BOX (Boxes)</SelectItem>
                    <SelectItem value="SET">SET (Sets)</SelectItem>
                    <SelectItem value="TON">TON (Metric Tons)</SelectItem>
                    <SelectItem value="PACK">PACK (Packages)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Required Date & Warehouse */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="fg-req-date" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Required Date <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="fg-req-date"
                  type="date"
                  min={today()}
                  value={form.required_date}
                  onChange={(e) => setForm((c) => ({ ...c, required_date: e.target.value }))}
                  className="h-11 rounded-xl"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="fg-warehouse" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Target Warehouse
                </Label>
                <Input
                  id="fg-warehouse"
                  value={form.warehouse_id}
                  onChange={(e) => setForm((c) => ({ ...c, warehouse_id: e.target.value }))}
                  className="h-11 rounded-xl"
                  placeholder="MAIN"
                />
              </div>
            </div>

            {/* Who has requested & Date he requested (Above BOM Attachment) */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="fg-requested-by" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Requested By <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="fg-requested-by"
                  value={form.requested_by}
                  onChange={(e) => setForm((c) => ({ ...c, requested_by: e.target.value }))}
                  className="h-11 rounded-xl font-medium"
                  placeholder="e.g. procurement / Officer Name"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="fg-requested-date" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Request Date <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="fg-requested-date"
                  type="date"
                  value={form.requested_date}
                  onChange={(e) => setForm((c) => ({ ...c, requested_date: e.target.value }))}
                  className="h-11 rounded-xl"
                  required
                />
              </div>
            </div>

            {/* BOM Attachment (Optional) */}
            <div className="space-y-1.5 pt-1">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                <span>BOM Attachment (Optional)</span>
                {uploadedBomUrl && (
                  <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-300 bg-emerald-50">
                    Uploaded
                  </Badge>
                )}
              </Label>
              <div className="rounded-xl border border-dashed border-border p-3.5 bg-muted/20">
                <input
                  ref={fileInputRef}
                  id="bom-upload-input"
                  type="file"
                  accept=".pdf,.xlsx,.xls,.csv,.doc,.docx,.png,.jpg,.jpeg"
                  className="hidden"
                  onChange={handleFileChange}
                />
                {!bomFile ? (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="flex flex-col items-center justify-center cursor-pointer py-2 text-center hover:opacity-80 transition"
                  >
                    <Upload className="size-6 text-muted-foreground mb-1" />
                    <span className="text-xs font-semibold text-primary">Click to upload BOM file</span>
                    <span className="text-[11px] text-muted-foreground mt-0.5">PDF, Excel, CSV or Docs</span>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="size-5 text-primary shrink-0" />
                      <span className="text-xs font-medium truncate">{bomFile.name}</span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={removeBomFile}
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-red-500"
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                )}
                {uploadingBom && (
                  <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground mt-2">
                    <Loader2 className="size-3.5 animate-spin text-primary" />
                    Uploading BOM...
                  </div>
                )}
              </div>
            </div>

            {/* Remarks */}
            <div className="space-y-1.5">
              <Label htmlFor="fg-remarks" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Remarks / Notes
              </Label>
              <Textarea
                id="fg-remarks"
                value={form.remarks}
                onChange={(e) => setForm((c) => ({ ...c, remarks: e.target.value }))}
                className="min-h-20 rounded-xl text-xs"
                placeholder="Optional assembly instructions or special requirements..."
              />
            </div>

            {/* Submit Action */}
            <div className="pt-3 border-t border-border/60">
              <Button
                type="submit"
                className="w-full h-11 rounded-xl font-bold gap-2 text-sm shadow-sm"
                disabled={submitting || uploadingBom}
              >
                {submitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Sending to Assembly...
                  </>
                ) : (
                  <>
                    <Send className="size-4" />
                    Send to Assembly
                  </>
                )}
              </Button>
            </div>
          </form>
        </Card>

        {/* Request List & Live Tracking */}
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search request #, product name, status..."
                className="pl-9 h-10 rounded-xl"
              />
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="px-3 py-1 font-bold">
                {requests.length} Requests
              </Badge>
            </div>
          </div>

          <Card className="rounded-2xl border bg-card p-0 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 border-b border-border text-[11px] uppercase tracking-wider font-bold text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Request #</th>
                    <th className="px-4 py-3">Product</th>
                    <th className="px-4 py-3 text-right">Requested Qty</th>
                    <th className="px-4 py-3">Requested By</th>
                    <th className="px-4 py-3 text-right">FG Store Avail.</th>
                    <th className="px-4 py-3">BOM Attachment</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Request Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {loadingRequests ? (
                    <tr>
                      <td colSpan={8} className="h-48 text-center">
                        <Loader2 className="size-7 animate-spin mx-auto text-primary" />
                        <span className="block mt-2 text-xs text-muted-foreground">Loading Finished Goods Requests...</span>
                      </td>
                    </tr>
                  ) : filteredRequests.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="h-48 text-center p-6">
                        <ClipboardList className="size-10 text-muted-foreground/30 mx-auto mb-2" />
                        <p className="text-sm font-semibold text-muted-foreground">No Finished Goods Requests Found</p>
                        <p className="text-xs text-muted-foreground/80 mt-1">Create a new request to send to Assembly.</p>
                      </td>
                    </tr>
                  ) : (
                    filteredRequests.map((req) => {
                      const avail = req.fg_store_available ?? req.available_quantity ?? 0;
                      const shortage = req.shortage ?? req.shortage_quantity ?? Math.max(0, req.quantity - avail);
                      const bomUrl = req.bom_attachment_url;
                      const bomName = req.bom_attachment_name || "BOM Document";

                      return (
                        <tr
                          key={req.id}
                          onClick={() => setSelectedRequest(req)}
                          className="hover:bg-muted/20 cursor-pointer transition-colors"
                        >
                          <td className="px-4 py-3 font-mono font-bold text-primary">
                            {req.request_number}
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-semibold text-foreground">
                              {req.product_name || req.finished_goods_name}
                            </div>
                            <div className="text-[11px] text-muted-foreground font-mono">
                              {req.product_code || req.finished_goods_code || "-"}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-bold text-foreground">
                            {req.quantity || req.requested_quantity} {req.uom || "PCS"}
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-semibold text-xs text-foreground">
                              {req.requested_by || req.created_by || "Procurement"}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="font-semibold text-foreground">
                              {avail} {req.uom || "PCS"}
                            </div>
                            {shortage > 0 ? (
                              <span className="inline-block text-[11px] text-red-600 font-semibold">
                                Shortage: {shortage}
                              </span>
                            ) : (
                              <span className="inline-block text-[11px] text-emerald-600 font-semibold">
                                In Stock
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {bomUrl ? (
                              <a
                                href={`${BUSINESS_API_URL}${bomUrl}`}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
                              >
                                <Paperclip className="size-3.5" />
                                <span className="max-w-[120px] truncate">{bomName}</span>
                              </a>
                            ) : (
                              <span className="text-xs text-muted-foreground italic">None</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge status={req.status || "SENT_TO_ASSEMBLY"} />
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {formatDisplayDate(req.requested_date || req.created_at)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Request Detail Modal / Drawer Card */}
          {selectedRequest && (
            <Card className="rounded-2xl border-2 border-primary/20 bg-card p-5 shadow-md">
              <div className="flex items-center justify-between border-b border-border/60 pb-3 mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
                    <Boxes className="size-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2.5">
                      <h3 className="text-base font-bold text-foreground">{selectedRequest.request_number}</h3>
                      <StatusBadge status={selectedRequest.status || "SENT_TO_ASSEMBLY"} />
                    </div>
                    <p className="text-xs text-muted-foreground">Finished Goods Request Overview</p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setSelectedRequest(null)} className="h-8 w-8 p-0">
                  <X className="size-4" />
                </Button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
                <div className="rounded-xl bg-muted/30 p-3 border">
                  <span className="text-[10px] font-bold uppercase text-muted-foreground">Product</span>
                  <div className="font-bold text-sm text-foreground mt-0.5">
                    {selectedRequest.product_name || selectedRequest.finished_goods_name}
                  </div>
                  <div className="text-[11px] text-muted-foreground font-mono mt-0.5">
                    {selectedRequest.product_code || selectedRequest.finished_goods_code || "-"}
                  </div>
                </div>

                <div className="rounded-xl bg-muted/30 p-3 border">
                  <span className="text-[10px] font-bold uppercase text-muted-foreground">Requested Quantity</span>
                  <div className="font-black text-lg text-primary mt-0.5">
                    {selectedRequest.quantity || selectedRequest.requested_quantity} {selectedRequest.uom || "PCS"}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Required: {formatDisplayDate(selectedRequest.required_date)}
                  </div>
                </div>

                <div className="rounded-xl bg-muted/30 p-3 border">
                  <span className="text-[10px] font-bold uppercase text-muted-foreground">Requested By</span>
                  <div className="font-bold text-sm text-foreground mt-0.5">
                    {selectedRequest.requested_by || selectedRequest.created_by || "Procurement"}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Requested on: {formatDisplayDate(selectedRequest.requested_date || selectedRequest.created_at)}
                  </div>
                </div>

                <div className="rounded-xl bg-muted/30 p-3 border">
                  <span className="text-[10px] font-bold uppercase text-muted-foreground">Status</span>
                  <div className="mt-1.5">
                    <StatusBadge status={selectedRequest.status || "SENT_TO_ASSEMBLY"} />
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    Sent to Assembly
                  </div>
                </div>

                <div className="rounded-xl bg-muted/30 p-3 border">
                  <span className="text-[10px] font-bold uppercase text-muted-foreground">FG Store Available</span>
                  <div className="font-black text-lg text-emerald-600 mt-0.5">
                    {selectedRequest.fg_store_available ?? selectedRequest.available_quantity ?? 0} {selectedRequest.uom || "PCS"}
                  </div>
                  <div className="text-[11px] text-muted-foreground">From FG Inventory</div>
                </div>

                <div className="rounded-xl bg-muted/30 p-3 border">
                  <span className="text-[10px] font-bold uppercase text-muted-foreground">Calculated Shortage</span>
                  <div className={`font-black text-lg mt-0.5 ${(selectedRequest.shortage ?? 0) > 0 ? "text-red-600" : "text-emerald-600"}`}>
                    {selectedRequest.shortage ?? selectedRequest.shortage_quantity ?? 0} {selectedRequest.uom || "PCS"}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {(selectedRequest.shortage ?? 0) > 0 ? "Production needed" : "Fully available in store"}
                  </div>
                </div>
              </div>

              {/* Visual Workflow Status Stepper */}
              <div className="mt-4 rounded-xl border bg-muted/20 p-3.5">
                <div className="flex items-center justify-between text-xs mb-2">
                  <span className="font-semibold text-foreground flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-blue-500 animate-pulse" />
                    Request Workflow Status
                  </span>
                  <StatusBadge status={selectedRequest.status || "SENT_TO_ASSEMBLY"} />
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-lg bg-blue-500/10 border border-blue-500/30 p-2 font-medium text-blue-700 dark:text-blue-300">
                    <div className="font-bold text-[11px] uppercase tracking-wider">1. Procurement</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">Request Sent</div>
                  </div>
                  <div className={`rounded-lg p-2 font-medium ${selectedRequest.status === "COMPLETED" ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 font-bold" : "bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 font-bold"}`}>
                    <div className="font-bold text-[11px] uppercase tracking-wider">2. Assembly</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{selectedRequest.status === "COMPLETED" ? "Completed" : "In Progress / Pending"}</div>
                  </div>
                  <div className={`rounded-lg p-2 font-medium ${selectedRequest.status === "COMPLETED" ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 font-bold" : "bg-muted/40 border text-muted-foreground"}`}>
                    <div className="font-bold text-[11px] uppercase tracking-wider">3. FG Store</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{selectedRequest.status === "COMPLETED" ? "Stock Available" : "Awaiting Production"}</div>
                  </div>
                </div>
              </div>

              {selectedRequest.bom_attachment_url && (
                <div className="mt-4 flex items-center justify-between rounded-xl bg-primary/5 border border-primary/20 p-3">
                  <div className="flex items-center gap-2">
                    <Paperclip className="size-4 text-primary" />
                    <span className="text-xs font-semibold">Attached BOM: {selectedRequest.bom_attachment_name || "BOM File"}</span>
                  </div>
                  <a
                    href={`${BUSINESS_API_URL}${selectedRequest.bom_attachment_url}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline"
                  >
                    <Download className="size-3.5" /> Download BOM
                  </a>
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </AppShell>
  );
}
