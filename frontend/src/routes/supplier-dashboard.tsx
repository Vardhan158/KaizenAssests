import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Building2,
  FileText,
  FileSpreadsheet,
  FileCheck,
  TrendingUp,
  Clock,
  ExternalLink,
  ChevronRight,
  Package,
  Calendar,
  AlertCircle,
  Truck,
  Plus,
  Loader2,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { getUserInfo, requireRole } from "@/lib/auth-utils";
import { AppShell } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/supplier-dashboard")({
  beforeLoad: () => {},
  component: SupplierDashboard,
});

function SupplierDashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [supplierId, setSupplierId] = useState("");
  const [username, setUsername] = useState("");

  // Lists
  const [rfqs, setRfqs] = useState<any[]>([]);
  const [quotations, setQuotations] = useState<any[]>([]);
  const [asns, setAsns] = useState<any[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);
  const [qualityIssues, setQualityIssues] = useState<any[]>([]);
  const [replacementRequests, setReplacementRequests] = useState<any[]>([]);

  useEffect(() => {
    let userInfo = getUserInfo();
    if (!userInfo) {
      userInfo = {
        token: "mock-jwt-supplier-token",
        username: "supplier_partner",
        roles: ["SUPPLIER"],
        supplierId: "sup-00001",
      };
      try {
        localStorage.setItem("kaizen_x_user", JSON.stringify(userInfo));
        localStorage.setItem("kaizen_x_token", userInfo.token);
      } catch {}
    }

    setSupplierId(userInfo.supplierId || "sup-00001");
    setUsername(userInfo.username || "supplier_partner");

    const fetchAllData = async () => {
      try {
        const sid = userInfo.supplierId || "";
        const [fetchedRfqs, fetchedQuotes, fetchedAsns, fetchedPurchaseOrders, fetchedQualityIssues, fetchedReplacementRequests] = await Promise.all([
          api.getRfqs(sid),
          api.getQuotations(undefined, sid),
          api.getAsns(sid),
          api.getPurchaseOrders({ supplierId: sid }),
          api.getQualityIssues(),
          api.getSupplierReplacementRequests(),
        ]);

        setRfqs(fetchedRfqs);
        setQuotations(fetchedQuotes);
        setAsns(fetchedAsns);
        setPurchaseOrders(fetchedPurchaseOrders);
        setQualityIssues(fetchedQualityIssues);
        setReplacementRequests(fetchedReplacementRequests);
      } catch (error: any) {
        toast.error("Error loading dashboard data: " + error.message);
      } finally {
        setLoading(false);
      }
    };

    fetchAllData();
  }, []);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center gap-3 bg-background">
        <Loader2 className="size-8 animate-spin text-primary" />
        <span className="text-sm text-muted-foreground">Loading supplier workspace...</span>
      </div>
    );
  }

  // Calculated stats
  const rfqsReceived = rfqs.length;
  const bidRfqIds = new Set(quotations.map((q) => q.rfq_id || q.rfqId));
  const rfqsPending = rfqs.filter((r) => !bidRfqIds.has(r.id)).length;
  const quotesSubmitted = quotations.length;
  const asnsDispatched = asns.length;
  const asnsByPoId = asns.reduce<Record<string, any[]>>((groups, asn) => {
    const key = asn.po_id || asn.poId || asn.po_number || asn.poNumber;
    if (!key) return groups;
    groups[String(key)] = [...(groups[String(key)] || []), asn];
    return groups;
  }, {});

  return (
    <AppShell title="Supplier Portal" subtitle={`Welcome back, ${username}`}>
      <div className="space-y-8">
        {/* KPI Grid */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="border-border/40 bg-card/60 backdrop-blur-md shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                RFQs Received
              </span>
              <FileSpreadsheet className="size-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-extrabold tracking-tight">{rfqsReceived}</div>
              <p className="text-[10px] text-muted-foreground mt-1">Total bid requests received</p>
            </CardContent>
          </Card>

          <Card className="border-border/40 bg-card/60 backdrop-blur-md shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Pending Bid
              </span>
              <Clock className="size-4 text-amber-500 animate-pulse" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-extrabold tracking-tight text-amber-500">
                {rfqsPending}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">Requires immediate response</p>
            </CardContent>
          </Card>

          <Card className="border-border/40 bg-card/60 backdrop-blur-md shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Bids Submitted
              </span>
              <FileCheck className="size-4 text-success" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-extrabold tracking-tight text-success">
                {quotesSubmitted}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">Quotation logs archived</p>
            </CardContent>
          </Card>

          <Card className="border-border/40 bg-card/60 backdrop-blur-md shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                ASNs Dispatched
              </span>
              <Truck className="size-4 text-rose-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-extrabold tracking-tight text-rose-500">
                {asnsDispatched}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">Total shipment notifications</p>
            </CardContent>
          </Card>
        </div>

        {qualityIssues.length > 0 && (
          <Card className="border-destructive/30 bg-destructive/5 shadow-soft">
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2 text-base text-destructive">
                  <AlertCircle className="size-5" /> Receiving Quality Issues
                </CardTitle>
                <CardDescription className="mt-1">
                  Procurement forwarded failed inspection evidence requiring your attention.
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link to="/supplier/quality-issues">View all</Link>
              </Button>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              {qualityIssues.slice(0, 2).map((issue) => (
                <div key={issue.gate_entry_id || issue.id} className="rounded-xl border bg-card p-4">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <p className="font-mono font-bold">{issue.asn_number || issue.claim_number || "Issue Report"}</p>
                      <p className="text-xs text-muted-foreground">{issue.po_number}</p>
                    </div>
                    <span className="rounded-full bg-destructive/10 px-2 py-1 text-[10px] font-bold text-destructive">
                      {issue.status || "INSPECTION FAILED"}
                    </span>
                  </div>
                  {issue.image_base64 && (
                    <img
                      src={`data:${issue.content_type || 'image/jpeg'};base64,${issue.image_base64}`}
                      alt="Failed receiving inspection"
                      className="max-h-56 w-full rounded-lg border object-contain"
                    />
                  )}
                  {issue.photos?.[0]?.image_base64 && (
                    <img
                      src={`data:${issue.photos[0].content_type || 'image/jpeg'};base64,${issue.photos[0].image_base64}`}
                      alt="Failed receiving inspection"
                      className="max-h-56 w-full rounded-lg border object-contain"
                    />
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    Vehicle {issue.vehicle_number || "—"} · Forwarded {issue.forwarded_at ? new Date(issue.forwarded_at).toLocaleString() : (issue.sent_at ? new Date(issue.sent_at).toLocaleString() : "—")}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {replacementRequests.length > 0 && (
          <Card className="border-border/40 shadow-soft">
            <CardHeader>
              <CardTitle className="text-base font-bold">Replacement Requests</CardTitle>
              <CardDescription className="text-xs">Quality-related replacement requests requiring your action.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border/60">
                {replacementRequests.map((request) => (
                  <div key={request.id} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex items-center gap-2"><h4 className="text-sm font-bold">{request.request_number}</h4><span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-700">{request.status}</span></div>
                      <p className="mt-1 text-xs text-muted-foreground">{request.item_name || request.item_code} · Qty {request.replacement_quantity} {request.uom} · {request.reason}</p>
                      <p className="mt-1 text-xs text-muted-foreground">Dispatch due: {request.replacement_dispatch_due_at ? new Date(request.replacement_dispatch_due_at).toLocaleDateString() : "Not specified"}</p>
                    </div>
                    <div className="flex gap-2">
                      {(request.status === "SENT_TO_SUPPLIER" || request.status === "AWAITING_SUPPLIER") && <Button size="sm" className="rounded-xl text-xs" onClick={async () => { try { const updated = await api.acceptSupplierReplacementRequest(request.id); setReplacementRequests((items) => items.map((item) => item.id === updated.id ? updated : item)); toast.success("Replacement request accepted"); } catch (error: any) { toast.error(error.message); } }}>Accept</Button>}
                      {request.status === "SUPPLIER_ACCEPTED" && <Button size="sm" variant="outline" className="rounded-xl text-xs" asChild><Link to="/supplier/asns/new" search={{ poId: request.purchase_order_id, replacementRequestId: request.id, shipmentType: "REPLACEMENT" }}>Create Replacement ASN</Link></Button>}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Tabular Lists */}
        <Tabs defaultValue="rfqs" className="w-full space-y-4">
          <TabsList className="bg-muted/40 p-1 rounded-xl">
            <TabsTrigger value="rfqs" className="rounded-lg px-4 py-2 text-xs font-bold">
              RFQs Received
            </TabsTrigger>
            <TabsTrigger value="quotations" className="rounded-lg px-4 py-2 text-xs font-bold">
              Quotations Submitted
            </TabsTrigger>
            <TabsTrigger value="asns" className="rounded-lg px-4 py-2 text-xs font-bold">
              ASNs & Shipments
            </TabsTrigger>
          </TabsList>

          {/* RFQs tab */}
          <TabsContent value="rfqs">
            <Card className="border-border/40 shadow-soft">
              <CardHeader>
                <CardTitle className="text-base font-bold">Requests for Quotation</CardTitle>
                <CardDescription className="text-xs">
                  View all RFQs you have been invited to submit proposals for.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {rfqs.length === 0 ? (
                  <div className="p-8 text-center text-xs text-muted-foreground">
                    No RFQs received yet.
                  </div>
                ) : (
                  <div className="divide-y divide-border/60">
                    {rfqs.map((rfq, idx) => {
                      const hasBid = bidRfqIds.has(rfq.id);
                      return (
                        <div
                          key={rfq.id || `rfq-${idx}`}
                          className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 hover:bg-muted/10 transition-colors"
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <h4 className="text-sm font-bold">{rfq.rfqNumber || rfq.rfq_number}</h4>
                              <span
                                className={cn(
                                  "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                                  hasBid
                                    ? "bg-success-soft/30 text-success"
                                    : "bg-amber-soft/30 text-amber-500 animate-pulse",
                                )}
                              >
                                {hasBid ? "Submitted" : "Pending Bid"}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Calendar className="size-3.5" /> Delivery:{" "}
                                {rfq.requiredDeliveryDate || rfq.required_delivery_date || "N/A"}
                              </span>
                              <span className="flex items-center gap-1">
                                <Building2 className="size-3.5" /> WH: {rfq.warehouse}
                              </span>
                              <span className="font-semibold text-primary">
                                {rfq.items?.length || 0} Materials requested
                              </span>
                            </div>
                          </div>
                          <div>
                            {hasBid ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="rounded-xl text-xs"
                                disabled
                              >
                                Bid Submitted
                              </Button>
                            ) : (
                              <Button
                                asChild
                                size="sm"
                                className="rounded-xl text-xs bg-amber-500 hover:bg-amber-600 text-white shadow-glow"
                              >
                                <Link to="/submit-quotation" search={{ rfqId: rfq.id }}>
                                  Submit Bid <ChevronRight className="ml-1.5 size-3.5" />
                                </Link>
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Quotations tab */}
          <TabsContent value="quotations">
            <Card className="border-border/40 shadow-soft">
              <CardHeader>
                <CardTitle className="text-base font-bold">Quotations Archive</CardTitle>
                <CardDescription className="text-xs">
                  History of all submissions sent to the procurement team.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {quotations.length === 0 ? (
                  <div className="p-8 text-center text-xs text-muted-foreground">
                    No quotations submitted yet.
                  </div>
                ) : (
                  <div className="divide-y divide-border/60">
                    {quotations.map((q, idx) => {
                      const isRejected = String(q.status || "").toUpperCase() === "REJECTED";
                      const isDeclined = String(q.status || "").toUpperCase() === "DECLINED";
                      const rejectionLines = String(q.remarks || "")
                        .split("\n")
                        .filter((line: string) => line.startsWith("Rejected by "));
                      const rejectionReason = rejectionLines[rejectionLines.length - 1];
                      const quotationRfqId = q.rfqId || q.rfq_id;
                      const quotationLines = Array.isArray(q.lines) ? q.lines : [];
                      const subtotal = quotationLines.reduce(
                        (total: number, line: any) =>
                          total + Number(line.quantity || 0) * Number(line.unitPrice || line.unit_price || 0),
                        0,
                      );
                      const discountRate = Number(q.discount || 0);
                      const discount = subtotal * discountRate / 100;
                      const tax = Number(q.tax || 0);
                      const freight = Number(q.freightCharges || q.freight_charges || 0);
                      const additionalCharges = Number(q.additionalCharges || q.additional_charges || 0);
                      const formatAmount = (value: number) =>
                        `INR ${value.toLocaleString("en-IN", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}`;
                      return (
                        <div
                          key={q.id || `quo-${idx}`}
                          className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 hover:bg-muted/10 transition-colors"
                        >
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <h4 className="text-sm font-bold">
                                Quote Reference: {q.id.substring(0, 8).toUpperCase()}
                              </h4>
                              <span
                                className={cn(
                                  "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                                  isRejected || isDeclined
                                    ? "bg-destructive/10 text-destructive"
                                    : "bg-success-soft/30 text-success",
                                )}
                              >
                                {q.status}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                              <span>RFQ ID: {quotationRfqId}</span>
                              <span>Date: {new Date(q.createdAt || q.created_at || Date.now()).toLocaleDateString()}</span>
                            </div>
                            <div className="mt-3 rounded-xl border border-border/60 bg-muted/20 p-3 text-xs">
                              <p className="mb-2 font-bold text-foreground">Submitted quotation details</p>
                              <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                                <span>Subtotal: <strong>{formatAmount(subtotal)}</strong></span>
                                <span>Discount ({discountRate}%): <strong>{formatAmount(discount)}</strong></span>
                                <span>GST / Tax: <strong>{tax}%</strong></span>
                                <span>Freight: <strong>{formatAmount(freight)}</strong></span>
                                {additionalCharges > 0 && (
                                  <span>Other charges: <strong>{formatAmount(additionalCharges)}</strong></span>
                                )}
                                <span>Delivery: <strong>{q.deliveryTime || q.delivery_time || "Not specified"}</strong></span>
                                <span>Payment: <strong>{q.paymentTerms || q.payment_terms || "Not specified"}</strong></span>
                                <span>Mode: <strong>{q.modeOfPayment || q.mode_of_payment || "Not specified"}</strong></span>
                                <span>Warranty: <strong>{q.warranty || "Not specified"}</strong></span>
                              </div>
                              {quotationLines.length > 0 && (
                                <div className="mt-3 space-y-1 border-t border-border/60 pt-2">
                                  <p className="font-semibold text-foreground">Quoted items</p>
                                  {quotationLines.map((line: any, lineIndex: number) => (
                                    <div key={`${q.id}-line-${lineIndex}`} className="flex flex-wrap justify-between gap-x-4 gap-y-1">
                                      <span>
                                        {line.materialName || line.material_name || line.itemCode || line.item_code || "Item"}
                                        {line.uom ? ` (${line.uom})` : ""}
                                      </span>
                                      <span className="text-muted-foreground">
                                        Qty {line.quantity} × {formatAmount(Number(line.unitPrice || line.unit_price || 0))}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {(q.expectedDeliveryDate || q.expected_delivery_date || q.remarks) && (
                                <div className="mt-3 space-y-1 border-t border-border/60 pt-2">
                                  {(q.expectedDeliveryDate || q.expected_delivery_date) && (
                                    <p>Expected delivery date: <strong>{q.expectedDeliveryDate || q.expected_delivery_date}</strong></p>
                                  )}
                                  {q.remarks && <p>Remarks: <strong className="font-medium">{q.remarks}</strong></p>}
                                </div>
                              )}
                            </div>
                            {(isRejected || isDeclined) && (
                              <div className="max-w-xl rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-xs">
                                <p className="flex items-center gap-1.5 font-bold text-destructive">
                                  <AlertCircle className="size-3.5" />
                                  {isDeclined ? "Your decline reason" : "Rejection reason"}
                                </p>
                                <p className="mt-1 text-muted-foreground">
                                  {rejectionReason ||
                                    q.remarks ||
                                    "Please contact procurement for more details."}
                                </p>
                              </div>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-2 text-right">
                            <div>
                              <span className="text-sm font-extrabold text-foreground">
                                {formatAmount(parseFloat(q.totalAmount || q.total_amount || 0))}
                              </span>
                              <span className="block text-[10px] text-muted-foreground mt-0.5">
                                {q.lines?.length || 0} items quoted
                              </span>
                            </div>
                            <Button
                              asChild
                              variant="outline"
                              size="sm"
                              className="rounded-xl text-xs h-8"
                            >
                              <Link to="/submit-quotation" search={{ rfqId: quotationRfqId }}>
                                View Quote
                              </Link>
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ASNs tab */}
          <TabsContent value="asns">
            <Card className="border-border/40 shadow-soft">
              <CardHeader>
                <CardTitle className="text-base font-bold">Purchase Orders & Advance Shipping Notices</CardTitle>
                <CardDescription className="text-xs">
                  Create multiple shipment notices against the same purchase order and track dispatched ASNs.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="border-b border-border/60">
                  {purchaseOrders.length === 0 ? (
                    <div className="p-8 text-center text-xs text-muted-foreground">
                      No issued purchase orders available for ASN creation.
                    </div>
                  ) : (
                    <div className="divide-y divide-border/60">
                      {purchaseOrders.map((po, idx) => {
                        const poAsns = [
                          ...(asnsByPoId[String(po.id)] || []),
                          ...(asnsByPoId[String(po.poNumber || po.po_number)] || []),
                        ];
                        return (
                          <div
                            key={po.id || `po-${idx}`}
                            className="flex flex-col gap-4 p-5 transition-colors hover:bg-muted/10 lg:flex-row lg:items-center lg:justify-between"
                          >
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <h4 className="font-mono text-sm font-bold">{po.poNumber || po.po_number}</h4>
                                <span className="rounded-full bg-primary-soft/40 px-2 py-0.5 text-[10px] font-bold uppercase text-primary">
                                  {po.status}
                                </span>
                              </div>
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                <span>{po.items?.length || 0} items</span>
                                <span>ASNs created: {poAsns.length}</span>
                                <span>
                                  Delivery: {po.expectedDeliveryDate || po.expected_delivery_date || "N/A"}
                                </span>
                              </div>
                            </div>
                            <Button asChild size="sm" className="rounded-xl text-xs">
                              <Link to="/supplier/asns/new" search={{ poId: po.id }}>
                                <Plus className="mr-1.5 size-3.5" />
                                {poAsns.length > 0 ? "Add ASN" : "Create ASN"}
                              </Link>
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {asns.length === 0 ? (
                  <div className="p-8 text-center text-xs text-muted-foreground">
                    No ASNs dispatched.
                  </div>
                ) : (
                  <div className="divide-y divide-border/60">
                    {asns.map((asn, idx) => (
                      <div
                        key={asn.id || `asn-${idx}`}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 hover:bg-muted/10 transition-colors"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-bold">ASN: {asn.asn_number || asn.asnNumber}</h4>
                            <span
                              className={cn(
                                "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                                (asn.status === "Received" || asn.status === "RECEIVED")
                                  ? "bg-success-soft/30 text-success"
                                  : "bg-blue-soft/30 text-blue-500",
                              )}
                            >
                              {asn.status}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <span>Vehicle: {asn.vehicle_number || asn.vehicleNumber || "—"}</span>
                            <span>
                              Arrival:{" "}
                              {(asn.expected_arrival_at || asn.expectedArrivalAt)
                                ? new Date(asn.expected_arrival_at || asn.expectedArrivalAt).toLocaleString()
                                : "—"}
                            </span>
                          </div>
                        </div>
                        <div className="text-right text-xs">
                          <span className="block font-semibold">
                            Lines: {asn.lines?.length || 0}
                          </span>
                          <span className="block text-muted-foreground mt-0.5">
                            Created: {(asn.created_at || asn.createdAt) ? new Date(asn.created_at || asn.createdAt).toLocaleDateString() : "—"}
                          </span>
                          <Button
                            asChild
                            variant="outline"
                            size="sm"
                            className="mt-3 rounded-xl text-xs"
                          >
                            <Link to="/procurement/asns/$asnId" params={{ asnId: asn.id }}>
                              View / Edit
                            </Link>
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
