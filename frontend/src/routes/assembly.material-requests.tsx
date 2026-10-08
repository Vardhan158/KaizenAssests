import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/wms/app-shell";
import { requireRole } from "@/lib/auth-utils";
import {
  api,
  type AssemblyMaterialRequest,
  type AssemblyMaterialRequestItem,
  type AssemblyProductOption,
  type AssemblyProductBOMResponse,
} from "@/lib/api-client";
import {
  AlertTriangle,
  Boxes,
  Calendar,
  CheckCircle2,
  Clock,
  Eye,
  FileText,
  Filter,
  Layers,
  Package,
  PlusCircle,
  RefreshCw,
  Search,
  Warehouse,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/assembly/material-requests")({
  beforeLoad: () => requireRole(["ASSEMBLY_MANAGER", "ASSEMBLY", "ADMIN", "SUPERUSER"]),
  head: () => ({ meta: [{ title: "Material Requests · KaizenX" }] }),
  component: AssemblyMaterialRequestsPage,
});

function getStatusBadge(status: string) {
  const s = (status || "").toUpperCase();
  if (s === "RECEIVED" || s === "COMPLETED") {
    return <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300">RECEIVED</Badge>;
  }
  if (s === "ISSUED") {
    return <Badge className="bg-blue-500/15 text-blue-700 border-blue-500/30 dark:text-blue-300">ISSUED BY WAREHOUSE</Badge>;
  }
  if (s === "PICKING" || s === "IN_PROGRESS" || s === "APPROVED") {
    return <Badge className="bg-purple-500/15 text-purple-700 border-purple-500/30 dark:text-purple-300">WAREHOUSE PICKING</Badge>;
  }
  if (s === "PENDING" || s === "SUBMITTED") {
    return <Badge className="bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300">AWAITING WAREHOUSE</Badge>;
  }
  if (s === "REJECTED" || s === "CANCELLED") {
    return <Badge className="bg-rose-500/15 text-rose-700 border-rose-500/30 dark:text-rose-300">{status}</Badge>;
  }
  return <Badge variant="outline">{status || "PENDING"}</Badge>;
}

function AssemblyMaterialRequestsPage() {
  const [requests, setRequests] = useState<AssemblyMaterialRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  // Create Modal State
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [products, setProducts] = useState<AssemblyProductOption[]>([]);
  const [creating, setCreating] = useState(false);
  const [formData, setFormData] = useState({
    product_code: "",
    target_quantity: 10,
    required_date: new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0],
    remarks: "",
  });

  // Live BOM Preview
  const [bomPreview, setBomPreview] = useState<AssemblyProductBOMResponse | null>(null);
  const [loadingBOM, setLoadingBOM] = useState(false);

  // Detail Modal State
  const [selectedRequest, setSelectedRequest] = useState<AssemblyMaterialRequest | null>(null);

  // Warehouse Issue & Receipt State
  const [issuingWarehouse, setIssuingWarehouse] = useState<string | null>(null);
  const [isReceiptOpen, setIsReceiptOpen] = useState(false);
  const [receiptRequest, setReceiptRequest] = useState<AssemblyMaterialRequest | null>(null);
  const [receiptItems, setReceiptItems] = useState<
    Array<{
      material_code: string;
      material_name: string;
      issued_quantity: number;
      received_quantity: number;
      uom: string;
    }>
  >([]);
  const [receiptRemarks, setReceiptRemarks] = useState("");
  const [confirmingReceipt, setConfirmingReceipt] = useState(false);

  const loadRequests = async () => {
    try {
      setLoading(true);
      const res = await api.getAssemblyMaterialRequests({
        search: searchTerm,
        status: statusFilter,
      });
      setRequests(res);
    } catch (err: any) {
      toast.error(err?.message || "Failed to load material requests.");
    } finally {
      setLoading(false);
    }
  };

  const handleWarehouseIssue = async (req: AssemblyMaterialRequest) => {
    try {
      setIssuingWarehouse(req.id);
      const res = await api.warehouseIssueMaterials(req.id);
      toast.success(`Warehouse issued materials under ${res.issue_number}!`);
      await loadRequests();
    } catch (err: any) {
      toast.error(err?.message || "Failed to issue materials from warehouse.");
    } finally {
      setIssuingWarehouse(null);
    }
  };

  const handleOpenReceiptModal = async (req: AssemblyMaterialRequest) => {
    try {
      const detail = await api.getAssemblyMaterialRequestDetail(req.id);
      setReceiptRequest(detail);
      const items = (detail.items || []).map((it) => ({
        material_code: it.material_code,
        material_name: it.material_name || it.material_code,
        issued_quantity: it.issued_quantity ?? it.quantity ?? 0,
        received_quantity: it.received_quantity ?? it.issued_quantity ?? it.quantity ?? 0,
        uom: it.uom || "PCS",
      }));
      setReceiptItems(items);
      setReceiptRemarks("");
      setIsReceiptOpen(true);
    } catch (err: any) {
      toast.error(err?.message || "Failed to load request details for receipt.");
    }
  };

  const handleConfirmReceipt = async () => {
    if (!receiptRequest) return;
    try {
      setConfirmingReceipt(true);
      await api.confirmAssemblyMaterialReceipt(receiptRequest.id, {
        received_items: receiptItems.map((i) => ({
          material_code: i.material_code,
          received_quantity: Number(i.received_quantity),
        })),
        remarks: receiptRemarks,
      });
      toast.success(`Materials confirmed received for Order ${receiptRequest.order_number}! Order is now ready for production.`);
      setIsReceiptOpen(false);
      setReceiptRequest(null);
      await loadRequests();
    } catch (err: any) {
      toast.error(err?.message || "Failed to confirm material receipt.");
    } finally {
      setConfirmingReceipt(false);
    }
  };

  const loadProducts = async () => {
    try {
      const res = await api.getAssemblyProducts();
      setProducts(res);
      if (res.length > 0 && !formData.product_code) {
        setFormData((prev) => ({ ...prev, product_code: res[0].product_code }));
      }
    } catch (err: any) {
      console.error("Failed to load products master:", err);
    }
  };

  useEffect(() => {
    loadRequests();
    loadProducts();
  }, []);

  useEffect(() => {
    loadRequests();
  }, [statusFilter]);

  // Load BOM preview whenever product or quantity changes
  useEffect(() => {
    if (isCreateOpen && formData.product_code && formData.target_quantity > 0) {
      loadBOMPreview(formData.product_code, formData.target_quantity);
    }
  }, [isCreateOpen, formData.product_code, formData.target_quantity]);

  const loadBOMPreview = async (productCode: string, qty: number) => {
    try {
      setLoadingBOM(true);
      const res = await api.getProductBOM(productCode, qty);
      setBomPreview(res);
    } catch (err: any) {
      setBomPreview(null);
    } finally {
      setLoadingBOM(false);
    }
  };

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.product_code) {
      toast.error("Please select a product to manufacture.");
      return;
    }
    if (formData.target_quantity <= 0) {
      toast.error("Production quantity must be greater than 0.");
      return;
    }
    if (!formData.required_date) {
      toast.error("Please specify a required completion date.");
      return;
    }

    try {
      setCreating(true);
      const newReq = await api.createAssemblyMaterialRequest({
        product_code: formData.product_code,
        target_quantity: Number(formData.target_quantity),
        required_date: formData.required_date,
        remarks: formData.remarks,
      });

      toast.success(
        `Material Request ${newReq.request_number} sent to Warehouse for ${newReq.product_name} (${newReq.target_quantity} ${newReq.uom}).`
      );
      setIsCreateOpen(false);
      setFormData({
        product_code: products[0]?.product_code || "",
        target_quantity: 10,
        required_date: new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0],
        remarks: "",
      });
      loadRequests();
    } catch (err: any) {
      toast.error(err?.message || "Failed to submit material request.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <AppShell
      title="Material Requests"
      subtitle="Raw material requisitions sent to Warehouse for production orders"
    >
      <div className="space-y-6">
        {/* Header Controls */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Material Requests</h1>
            <p className="text-sm text-muted-foreground">
              Request raw materials from Warehouse based on Product BOM requirements.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadRequests()}
              className="gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              size="sm"
              onClick={() => setIsCreateOpen(true)}
              className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <PlusCircle className="h-4 w-4" />
              + NEW MATERIAL REQUEST
            </Button>
          </div>
        </div>

        {/* Filters Bar */}
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm flex flex-col md:flex-row gap-4 items-center justify-between">
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by request #, order #, product..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadRequests()}
              className="pl-9 h-9 text-sm"
            />
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground w-full md:w-auto">
            <Filter className="h-3.5 w-3.5" />
            <span>Warehouse Status:</span>
            <select
              className="h-8 rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="ALL">All Statuses</option>
              <option value="PENDING">Awaiting Warehouse</option>
              <option value="PICKING">Warehouse Picking</option>
              <option value="ISSUED">Issued by Warehouse</option>
              <option value="RECEIVED">Received in Assembly</option>
            </select>
          </div>
        </div>

        {/* Requests Table */}
        <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
          {loading ? (
            <div className="py-16 text-center text-sm text-muted-foreground flex flex-col items-center justify-center gap-2">
              <RefreshCw className="h-5 w-5 animate-spin text-primary" />
              <span>Loading Material Requests from PostgreSQL...</span>
            </div>
          ) : requests.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground flex flex-col items-center justify-center gap-3">
              <Boxes className="h-10 w-10 text-muted-foreground/40" />
              <div className="max-w-xs space-y-1">
                <p className="font-semibold text-foreground">No Material Requests found</p>
                <p className="text-xs text-muted-foreground">
                  Click "+ NEW MATERIAL REQUEST" to select a product and request raw materials from Warehouse.
                </p>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-xs font-semibold text-muted-foreground">
                    <th className="py-3 px-4">Request #</th>
                    <th className="py-3 px-4">Production Order</th>
                    <th className="py-3 px-4">Product to Manufacture</th>
                    <th className="py-3 px-4 text-right">Production Qty</th>
                    <th className="py-3 px-4 text-center">Components</th>
                    <th className="py-3 px-4">Required Date</th>
                    <th className="py-3 px-4">Warehouse Status</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {requests.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                      <td className="py-3 px-4 font-mono font-medium text-foreground">
                        {r.request_number}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-muted-foreground">
                        {r.order_number || "—"}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-foreground">{r.product_name}</div>
                        {r.product_code && (
                          <div className="text-[11px] text-muted-foreground font-mono">{r.product_code}</div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-semibold text-foreground">
                        {r.target_quantity} {r.uom}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <Badge variant="outline" className="text-xs">
                          {r.items_count} Items
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-xs text-muted-foreground whitespace-nowrap">
                        {r.required_date ? new Date(r.required_date).toLocaleDateString() : "—"}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {getStatusBadge(r.status)}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          {r.status === "ISSUED" && (
                            <Button
                              size="sm"
                              className="h-8 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 shadow-sm"
                              onClick={() => handleOpenReceiptModal(r)}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Confirm Receipt
                            </Button>
                          )}
                          {(r.status === "PENDING" || r.status === "SUBMITTED") && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={issuingWarehouse === r.id}
                              className="h-8 text-xs font-medium border-blue-500/40 text-blue-600 hover:bg-blue-500/10 dark:text-blue-400 gap-1.5"
                              onClick={() => handleWarehouseIssue(r)}
                            >
                              {issuingWarehouse === r.id ? (
                                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Warehouse className="h-3.5 w-3.5" />
                              )}
                              Issue from WH
                            </Button>
                          )}
                          {r.status === "RECEIVED" && (
                            <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300 gap-1 py-1 px-2.5">
                              <CheckCircle2 className="h-3 w-3" />
                              Receipt Confirmed
                            </Badge>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 text-xs font-medium text-muted-foreground hover:text-foreground gap-1.5"
                            onClick={() => setSelectedRequest(r)}
                          >
                            <Eye className="h-3.5 w-3.5" />
                            Details
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ========================================================================= */}
        {/* CREATE MATERIAL REQUEST MODAL */}
        {/* ========================================================================= */}
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogContent className="max-w-xl p-6">
            <DialogHeader className="border-b border-border/60 pb-3">
              <DialogTitle className="text-lg font-bold text-foreground flex items-center gap-2">
                <Boxes className="h-5 w-5 text-primary" />
                Request Raw Materials from Warehouse
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Select a product and production quantity. Required raw materials are automatically calculated from the Product BOM and submitted to the Warehouse.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleCreateRequest} className="space-y-4 pt-3">
              {/* Product Selection */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">Product to Manufacture *</label>
                <select
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  value={formData.product_code}
                  onChange={(e) => setFormData({ ...formData, product_code: e.target.value })}
                  required
                >
                  <option value="" disabled>Select a manufacturable product...</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.product_code}>
                      {p.product_name} ({p.product_code})
                    </option>
                  ))}
                </select>
              </div>

              {/* Quantity & Required Date */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">Production Quantity *</label>
                  <div className="relative">
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      value={formData.target_quantity}
                      onChange={(e) => setFormData({ ...formData, target_quantity: Number(e.target.value) })}
                      required
                      className="h-9 pr-12 text-sm"
                    />
                    <span className="absolute right-3 top-2 text-xs font-medium text-muted-foreground pointer-events-none">
                      PCS
                    </span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">Required Completion Date *</label>
                  <Input
                    type="date"
                    value={formData.required_date}
                    onChange={(e) => setFormData({ ...formData, required_date: e.target.value })}
                    required
                    className="h-9 text-sm"
                  />
                </div>
              </div>

              {/* Live BOM Requirements Calculation Preview */}
              {loadingBOM ? (
                <div className="rounded-lg border border-border/80 bg-muted/20 p-3 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  <span>Calculating material requirements from Product BOM...</span>
                </div>
              ) : bomPreview ? (
                <div className="rounded-lg border border-border bg-card p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 font-semibold text-foreground">
                      <Layers className="h-3.5 w-3.5 text-primary" />
                      <span>Required Materials ({bomPreview.materials?.length || 0} Components)</span>
                    </div>
                    <span className="text-[11px] text-muted-foreground">
                      BOM: {bomPreview.bom_number}
                    </span>
                  </div>

                  <div className="max-h-36 overflow-y-auto rounded border border-border/60 text-[11px]">
                    <table className="w-full text-left">
                      <thead className="bg-muted/50 text-[10px] uppercase text-muted-foreground border-b border-border/60 sticky top-0">
                        <tr>
                          <th className="p-1.5 pl-2">Component</th>
                          <th className="p-1.5 text-right">Qty/Unit</th>
                          <th className="p-1.5 text-right font-semibold">Total Required</th>
                          <th className="p-1.5 text-right pr-2">WH Stock</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/30">
                        {bomPreview.materials?.map((item, idx) => (
                          <tr key={idx}>
                            <td className="p-1.5 pl-2 font-medium text-foreground truncate max-w-[160px]">
                              {item.material_code}
                              <span className="block text-[10px] text-muted-foreground truncate font-normal">
                                {item.material_name}
                              </span>
                            </td>
                            <td className="p-1.5 text-right text-muted-foreground">
                              {item.quantity_per_unit} {item.uom}
                            </td>
                            <td className="p-1.5 text-right font-bold text-foreground">
                              {item.required_quantity} {item.uom}
                            </td>
                            <td className="p-1.5 text-right pr-2 text-muted-foreground">
                              {item.available_quantity} {item.uom}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              {/* Remarks */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">Remarks (Optional)</label>
                <Textarea
                  placeholder="Special instructions or batch notes for Warehouse..."
                  value={formData.remarks}
                  onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                  rows={2}
                  className="text-xs resize-none"
                />
              </div>

              <DialogFooter className="pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsCreateOpen(false)}
                  disabled={creating}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={creating}
                  className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {creating && <RefreshCw className="h-4 w-4 animate-spin" />}
                  Submit Request to Warehouse
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* ========================================================================= */}
        {/* VIEW MATERIAL REQUEST DETAILS MODAL */}
        {/* ========================================================================= */}
        {selectedRequest && (
          <Dialog open={Boolean(selectedRequest)} onOpenChange={(open) => !open && setSelectedRequest(null)}>
            <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto p-6">
              <DialogHeader className="border-b border-border/60 pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <DialogTitle className="text-lg font-bold text-foreground">
                        {selectedRequest.request_number}
                      </DialogTitle>
                      {getStatusBadge(selectedRequest.status)}
                    </div>
                    <DialogDescription className="text-xs text-muted-foreground mt-1">
                      Production Order: {selectedRequest.order_number || "—"} · Product: {selectedRequest.product_name}
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              <div className="space-y-4 pt-3">
                <div className="grid grid-cols-3 gap-3 p-3 rounded-lg bg-muted/30 border border-border text-xs">
                  <div>
                    <span className="text-muted-foreground">Product to Manufacture</span>
                    <p className="font-semibold text-foreground mt-0.5">{selectedRequest.product_name}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Production Quantity</span>
                    <p className="font-semibold text-foreground mt-0.5">
                      {selectedRequest.target_quantity} {selectedRequest.uom}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Required Date</span>
                    <p className="font-semibold text-foreground mt-0.5">
                      {selectedRequest.required_date ? new Date(selectedRequest.required_date).toLocaleDateString() : "—"}
                    </p>
                  </div>
                </div>

                {selectedRequest.material_issue && (
                  <div className="p-3 rounded-lg border border-blue-500/30 bg-blue-500/5 text-xs space-y-1">
                    <div className="flex items-center justify-between font-semibold text-blue-700 dark:text-blue-300">
                      <span className="flex items-center gap-1.5">
                        <Warehouse className="h-4 w-4" />
                        Warehouse Issue: {selectedRequest.material_issue.issue_number}
                      </span>
                      <span>{new Date(selectedRequest.material_issue.issued_at).toLocaleString()}</span>
                    </div>
                    <p className="text-muted-foreground text-[11px]">
                      Issued by: <strong className="text-foreground">{selectedRequest.material_issue.issued_by}</strong> · Destination: Assembly Staging
                    </p>
                  </div>
                )}

                {selectedRequest.material_received_at && (
                  <div className="p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 text-xs space-y-1">
                    <div className="flex items-center justify-between font-semibold text-emerald-700 dark:text-emerald-300">
                      <span className="flex items-center gap-1.5">
                        <CheckCircle2 className="h-4 w-4" />
                        Materials Confirmed Received in Assembly
                      </span>
                      <span>{new Date(selectedRequest.material_received_at).toLocaleString()}</span>
                    </div>
                    <p className="text-muted-foreground text-[11px]">
                      Received by: <strong className="text-foreground">{selectedRequest.material_received_by || "Assembly Operator"}</strong>
                    </p>
                  </div>
                )}

                {selectedRequest.remarks && (
                  <div className="p-3 rounded-lg border border-border bg-card text-xs">
                    <span className="text-muted-foreground block mb-1 font-medium">Remarks / Instructions</span>
                    <p className="text-foreground">{selectedRequest.remarks}</p>
                  </div>
                )}

                <div>
                  <h4 className="text-xs font-semibold text-foreground mb-2 flex items-center justify-between">
                    <span>Required BOM Items ({selectedRequest.items?.length || 0})</span>
                    <span className="text-[11px] text-muted-foreground font-normal">Destination: Warehouse Requisition</span>
                  </h4>

                  <div className="overflow-x-auto rounded-lg border border-border bg-card">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-border bg-muted/40 text-[11px] font-semibold text-muted-foreground">
                          <th className="py-2.5 px-3">Material Code</th>
                          <th className="py-2.5 px-3">Material Name</th>
                          <th className="py-2.5 px-3 text-right">Required Quantity</th>
                          <th className="py-2.5 px-3 text-center">UOM</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/40">
                        {selectedRequest.items?.map((item, idx) => (
                          <tr key={idx}>
                            <td className="py-2.5 px-3 font-mono font-medium text-foreground">
                              {item.material_code}
                            </td>
                            <td className="py-2.5 px-3 text-foreground">
                              {item.material_name}
                            </td>
                            <td className="py-2.5 px-3 text-right font-bold text-foreground">
                              {item.quantity}
                            </td>
                            <td className="py-2.5 px-3 text-center text-muted-foreground">
                              {item.uom}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <DialogFooter className="border-t border-border/60 pt-3 mt-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedRequest(null)}
                >
                  Close
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {/* ========================================================================= */}
        {/* CONFIRM MATERIAL RECEIPT MODAL */}
        {/* ========================================================================= */}
        <Dialog open={isReceiptOpen} onOpenChange={setIsReceiptOpen}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto p-6">
            <DialogHeader className="border-b border-border/60 pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <DialogTitle className="text-lg font-bold text-foreground flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                    Confirm Material Receipt
                  </DialogTitle>
                  <DialogDescription className="text-xs text-muted-foreground mt-1">
                    Verify physical materials issued by Warehouse and confirm receipt into Assembly.
                  </DialogDescription>
                </div>
                {receiptRequest && (
                  <Badge className="bg-blue-500/15 text-blue-700 border-blue-500/30 dark:text-blue-300">
                    {receiptRequest.order_number}
                  </Badge>
                )}
              </div>
            </DialogHeader>

            {receiptRequest && (
              <div className="space-y-4 pt-3">
                {/* Reference card */}
                <div className="grid grid-cols-3 gap-3 p-3 rounded-lg bg-muted/40 border border-border text-xs">
                  <div>
                    <span className="text-muted-foreground">Product to Manufacture</span>
                    <p className="font-semibold text-foreground mt-0.5">{receiptRequest.product_name}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Production Target</span>
                    <p className="font-semibold text-foreground mt-0.5">
                      {receiptRequest.target_quantity} {receiptRequest.uom}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Warehouse Issue Ref</span>
                    <p className="font-semibold text-foreground mt-0.5 font-mono">
                      {receiptRequest.material_issue?.issue_number || "ISSUE CONFIRMED"}
                    </p>
                  </div>
                </div>

                {/* Items receipt table */}
                <div>
                  <h4 className="text-xs font-semibold text-foreground mb-2 flex items-center justify-between">
                    <span>Issued Components ({receiptItems.length})</span>
                    <span className="text-[11px] text-muted-foreground font-normal">
                      Verify physical count matches issued quantities
                    </span>
                  </h4>

                  <div className="overflow-x-auto rounded-lg border border-border bg-card">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-border bg-muted/40 text-[11px] font-semibold text-muted-foreground">
                          <th className="py-2.5 px-3">Material Code</th>
                          <th className="py-2.5 px-3">Component Description</th>
                          <th className="py-2.5 px-3 text-right">Issued Qty</th>
                          <th className="py-2.5 px-3 text-right w-32">Received Qty</th>
                          <th className="py-2.5 px-3 text-center">UOM</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/40">
                        {receiptItems.map((item, idx) => (
                          <tr key={idx}>
                            <td className="py-2.5 px-3 font-mono font-medium text-foreground">
                              {item.material_code}
                            </td>
                            <td className="py-2.5 px-3 text-foreground">
                              {item.material_name}
                            </td>
                            <td className="py-2.5 px-3 text-right font-medium text-muted-foreground">
                              {item.issued_quantity}
                            </td>
                            <td className="py-1.5 px-3 text-right">
                              <Input
                                type="number"
                                min="0"
                                step="any"
                                value={item.received_quantity}
                                onChange={(e) => {
                                  const val = Number(e.target.value);
                                  const updated = [...receiptItems];
                                  updated[idx].received_quantity = val;
                                  setReceiptItems(updated);
                                }}
                                className="h-8 text-right font-bold text-foreground text-xs"
                              />
                            </td>
                            <td className="py-2.5 px-3 text-center text-muted-foreground">
                              {item.uom}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Remarks */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">Receipt Remarks / Verification Notes</label>
                  <Textarea
                    placeholder="Physical verification notes (e.g. all 5 boxes verified sealed and in good condition)..."
                    value={receiptRemarks}
                    onChange={(e) => setReceiptRemarks(e.target.value)}
                    rows={2}
                    className="text-xs resize-none"
                  />
                </div>

                <DialogFooter className="border-t border-border/60 pt-3 mt-4">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setIsReceiptOpen(false)}
                    disabled={confirmingReceipt}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold gap-1.5"
                    onClick={handleConfirmReceipt}
                    disabled={confirmingReceipt}
                  >
                    {confirmingReceipt ? (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    )}
                    Confirm Physical Receipt
                  </Button>
                </DialogFooter>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
