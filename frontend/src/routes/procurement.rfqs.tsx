import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Search,
  Filter,
  Mail,
  MoreHorizontal,
  ArrowRight,
  Loader2,
  Calendar,
  X,
  Send,
  Eye,
  Building2,
  Package,
  Info,
} from "lucide-react";
import { AppShell, StatusBadge } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/lib/api-client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { requireRole } from "@/lib/auth-utils";

export const Route = createFileRoute("/procurement/rfqs")({
  beforeLoad: () => requireRole("PROCUREMENT"),
  component: Rfqs,
});

function Rfqs() {
  const [rfqs, setRfqs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRfq, setSelectedRfq] = useState<any | null>(null);
  const [sendingRfq, setSendingRfq] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      const data = await api.getRfqs();
      setRfqs(data);
    } catch (error) {
      console.error("Failed to fetch RFQs:", error);
      toast.error("Failed to load RFQs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSendRfq = async (rfqId: string) => {
    try {
      setSendingRfq(true);
      const result = await api.sendRfq(rfqId);
      const delivery = result.delivery || {};
      const sent = typeof delivery.sent === "number" ? delivery.sent : (result.sent ?? 0);
      const failed = typeof delivery.failed === "number" ? delivery.failed : (result.failed ?? 0);
      const total = typeof delivery.total === "number" ? delivery.total : (result.total ?? (sent + failed));

      if (failed === 0 && sent > 0) {
        toast.success("RFQ Published", {
          description: `Supplier Email: SENT (${sent} of ${total} accepted by mail server)`,
        });
      } else if (sent > 0 && failed > 0) {
        toast.warning("RFQ Published", {
          description: `Supplier Email: PARTIALLY SENT (${sent} sent, ${failed} failed)`,
        });
      } else if (failed > 0 && sent === 0) {
        toast.error("RFQ Published with Email Delivery Failure", {
          description: `Supplier Email: FAILED (0 of ${total} delivered)`,
        });
      } else {
        toast.success(result.message || "RFQ published successfully.");
      }
      setSelectedRfq(null);
      await fetchData();
    } catch (error: any) {
      toast.error("Failed to send RFQ", { description: error.message });
    } finally {
      setSendingRfq(false);
    }
  };

  const handleCancelRfq = async (rfqId: string) => {
    try {
      setSendingRfq(true);
      await api.cancelRfq(rfqId);
      toast.success("RFQ Cancelled successfully");
      setSelectedRfq(null);
      await fetchData();
    } catch (error: any) {
      toast.error("Failed to cancel RFQ", { description: error.message });
    } finally {
      setSendingRfq(false);
    }
  };

  return (
    <AppShell
      title={
        <div className="flex items-center gap-2">
          <span>Request for Quotations</span>
          <TooltipProvider>
            <Tooltip delayDuration={200}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="RFQs Info"
                  className="inline-flex items-center text-muted-foreground hover:text-foreground transition-colors cursor-help"
                >
                  <Info className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-xs text-xs">
                <p className="font-semibold">Request for Quotation (RFQ)</p>
                <p className="mt-0.5">A request sent to one or more suppliers asking them to provide pricing and commercial terms for required materials.</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      }
      subtitle="Manage and track RFQs sent to various suppliers"
    >
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            placeholder="Search RFQ no, title..."
            className="h-10 w-full rounded-xl border border-border bg-card pl-10 pr-4 text-sm outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <Button variant="outline" className="rounded-xl border-border">
          <Filter className="mr-2 size-4" /> Filter
        </Button>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="grid gap-4">
          {rfqs.map((rfq) => (
            <Card
              key={rfq.id}
              className="overflow-hidden border-border/50 transition-all hover:border-primary/30 hover:shadow-soft"
            >
              <div className="flex flex-col p-5 md:flex-row md:items-center">
                <div className="mb-4 flex flex-1 items-start gap-4 md:mb-0">
                  <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary-soft/30 text-primary">
                    <Mail className="size-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-foreground">{rfq.rfqNumber}</h3>
                      <StatusBadge status={rfq.status} />
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Issued {rfq.rfqDate} · {rfq.warehouse}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {rfq.materialRequestNumber && (
                        <span className="text-[10px] text-primary bg-primary-soft/20 px-2 py-0.5 rounded-md border border-primary/20">
                          Ref: {rfq.materialRequestNumber}
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-md border border-border/50">
                        {rfq.suppliers?.length || 0} Suppliers invited
                      </span>
                      <span className="text-[10px] text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-md border border-border/50 font-mono">
                        {rfq.items?.length || 0} items
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-border/40 pt-4 md:border-0 md:pt-0">
                  <div className="mr-8 text-right hidden md:block">
                    <div className="flex flex-col items-end gap-1">
                      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                        <Package className="size-3" /> Items
                      </div>
                      <p className="text-sm font-medium">{rfq.items?.length || 0}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      className="rounded-xl"
                      onClick={() => setSelectedRfq(rfq)}
                    >
                      {rfq.status === "DRAFT" ? (
                        <>Review & Send</>
                      ) : (
                        <>
                          <Eye className="mr-1.5 size-3.5" /> View Details
                        </>
                      )}
                    </Button>
                    {rfq.status !== "DRAFT" && (
                      <Link to="/procurement/quotations" search={{ rfqId: rfq.id }}>
                        <Button variant="outline" className="rounded-xl group">
                          Compare Bids{" "}
                          <ArrowRight className="ml-2 size-3 transition-transform group-hover:translate-x-1" />
                        </Button>
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Detail & Review Modal */}
      {selectedRfq && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm transition-all duration-200 sm:p-6">
          <Card className="flex max-h-[90vh] w-full max-w-6xl flex-col gap-0 overflow-hidden rounded-2xl border-border/80 bg-card p-0 shadow-2xl animate-in fade-in zoom-in-95">
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between border-b border-border/70 px-6 py-5">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-xl font-semibold tracking-tight">{selectedRfq.rfqNumber}</h2>
                  <StatusBadge status={selectedRfq.status} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Created on {new Date(selectedRfq.createdAt).toLocaleString()}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-xl"
                onClick={() => setSelectedRfq(null)}
              >
                <X className="size-5" />
              </Button>
            </div>

            {/* Content */}
            <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
              {/* Metadata Grid */}
              <div className="grid gap-x-8 gap-y-5 rounded-xl border border-border/70 bg-muted/20 p-5 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Procurement Officer
                  </p>
                  <p className="mt-1 text-sm font-semibold">{selectedRfq.procurementOfficer}</p>
                </div>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Warehouse
                  </p>
                  <p className="mt-1 text-sm font-semibold">{selectedRfq.warehouse}</p>
                </div>
                {selectedRfq.materialRequestNumber && (
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Material Request Ref
                    </p>
                    <p className="mt-1 text-sm font-semibold">
                      {selectedRfq.materialRequestNumber}
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    RFQ Date
                  </p>
                  <p className="mt-1 text-sm font-semibold">{selectedRfq.rfqDate}</p>
                </div>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Required Delivery Date
                  </p>
                  <p className="mt-1 text-sm font-semibold">
                    {selectedRfq.requiredDeliveryDate || "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Supplier Email(s)
                  </p>
                  <p
                    className="mt-1 text-sm font-semibold truncate"
                    title={selectedRfq.supplierEmails?.join(", ")}
                  >
                    {selectedRfq.supplierEmails?.join(", ") || "—"}
                  </p>
                </div>
              </div>

              {/* Items Section */}
              <section className="overflow-hidden rounded-xl border border-border/70">
                <h3 className="flex items-center gap-2 border-b border-border/70 bg-muted/15 px-5 py-4 text-sm font-semibold">
                  <Package className="size-4 text-primary" /> Material Requirements
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[780px] border-collapse text-left text-xs">
                    <thead className="bg-muted/20">
                      <tr className="border-b border-border/70 text-[10px] uppercase tracking-wide text-muted-foreground">
                        <th className="whitespace-nowrap px-4 py-3 font-medium">Material Code</th>
                        <th className="whitespace-nowrap px-4 py-3 font-medium">Variant Code</th>
                        <th className="min-w-56 px-4 py-3 font-medium">Material Name &amp; Specs</th>
                        <th className="whitespace-nowrap px-4 py-3 font-medium">Category</th>
                        <th className="whitespace-nowrap px-4 py-3 text-right font-medium">Quantity</th>
                        <th className="whitespace-nowrap px-4 py-3 font-medium">UOM</th>
                        <th className="whitespace-nowrap px-4 py-3 font-medium">Warehouse</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedRfq.items && selectedRfq.items.length > 0 ? (
                        selectedRfq.items.map((item: any, idx: number) => (
                          <tr key={idx} className="border-b border-border/50 last:border-0 hover:bg-muted/15">
                            <td className="whitespace-nowrap px-4 py-3.5 font-mono font-semibold text-primary">
                              {item.materialCode || item.material_code}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3.5 font-mono font-semibold text-teal-600">
                              {item.variantCode || item.variant_code || "—"}
                            </td>
                            <td className="px-4 py-3.5 font-medium text-foreground">
                              {item.materialName || item.material_name}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3.5 text-muted-foreground">{item.category}</td>
                            <td className="whitespace-nowrap px-4 py-3.5 text-right font-mono font-semibold tabular-nums">
                              {item.quantity}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3.5 font-medium text-muted-foreground">{item.uom}</td>
                            <td className="whitespace-nowrap px-4 py-3.5 text-muted-foreground">
                              {item.warehouse || selectedRfq.warehouse || "—"}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                            No material requirements listed for this RFQ.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Invited Suppliers List */}
              {selectedRfq.suppliers && selectedRfq.suppliers.length > 0 && (
                <section className="overflow-hidden rounded-xl border border-border/70">
                  <h3 className="flex items-center gap-2 border-b border-border/70 bg-muted/15 px-5 py-4 text-sm font-semibold">
                    <Building2 className="size-4 text-primary" /> Invited Suppliers
                  </h3>
                  <div className="flex flex-wrap gap-2 p-4">
                    {selectedRfq.suppliers.map((sup: any) => (
                      <Badge
                        key={sup.supplierId}
                        variant="outline"
                        className="rounded-lg border-border/70 bg-background px-3 py-1.5 font-medium"
                      >
                        <Building2 className="mr-1.5 size-3.5 text-muted-foreground animate-pulse" />
                        {sup.supplierName}
                      </Badge>
                    ))}
                  </div>
                </section>
              )}

              {/* Suppliers count info */}
              <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning-soft/15 p-4">
                <Info className="size-5 text-warning shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-warning-foreground">Invitation Scope</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    This RFQ invitation will be sent to{" "}
                    <strong>{selectedRfq.suppliers?.length || 0}</strong> selected suppliers.
                    Suppliers will be notified immediately to submit bids once published.
                  </p>
                </div>
              </div>

              {selectedRfq.remarks && (
                <div>
                  <h4 className="text-xs uppercase tracking-wider font-bold text-muted-foreground">
                    Remarks / Instructions
                  </h4>
                  <p className="mt-1.5 rounded-lg bg-muted/30 p-3 text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap">
                    {selectedRfq.remarks}
                  </p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border/70 bg-card px-6 py-4">
              <div className="flex items-center gap-2">
                {selectedRfq.status !== "CANCELLED" && selectedRfq.status !== "CLOSED" && (
                  <Button
                    variant="outline"
                    className="rounded-xl border-rose-300 text-rose-700 hover:bg-rose-50 font-bold text-xs"
                    disabled={sendingRfq}
                    onClick={() => handleCancelRfq(selectedRfq.id)}
                  >
                    <X className="mr-1.5 size-3.5" /> Cancel RFQ
                  </Button>
                )}
              </div>

              <div className="flex items-center gap-3">
                <Button variant="outline" className="rounded-xl" onClick={() => setSelectedRfq(null)}>
                  Close
                </Button>
                {(selectedRfq.status === "DRAFT" || selectedRfq.status === "OPEN" || selectedRfq.status === "SENT") && (
                  <Button
                    className="rounded-xl shadow-glow font-bold text-xs"
                    disabled={sendingRfq}
                    onClick={() => handleSendRfq(selectedRfq.id)}
                  >
                    {sendingRfq ? (
                      <>
                        <Loader2 className="mr-2 size-4 animate-spin" /> Sending...
                      </>
                    ) : (
                      <>
                        <Send className="mr-2 size-4" />{" "}
                        {selectedRfq.status === "DRAFT" ? "Approve & Send RFQ" : "Resend RFQ Email"}
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}
    </AppShell>
  );
}