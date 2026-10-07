import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  FileCheck2,
  Search,
  Filter,
  Loader2,
  Calendar,
  Eye,
  Building2,
  Clock,
  ArrowRight,
  ShieldCheck,
  History,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { AppShell, StatusBadge } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { requireRole } from "@/lib/auth-utils";

export const Route = createFileRoute("/finance/approvals/")({
  beforeLoad: () => requireRole("FINANCE"),
  component: FinanceApprovals,
});

function FinanceApprovals() {
  const getOrderTotal = (po: any) => Number(po.quotation?.totalAmount ?? po.quotation?.total_amount ?? po.totalAmount ?? po.total_amount ?? 0);
  const formatCurrency = (po: any) => `₹${getOrderTotal(po).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const [approvals, setApprovals] = useState<any[]>([]);
  const [allOrders, setAllOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"PENDING" | "HISTORY">("PENDING");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  const fetchData = async () => {
    try {
      setLoading(true);
      const [pendingData, allData] = await Promise.all([
        api.getFinanceApprovals().catch(() => []),
        api.getPurchaseOrders().catch(() => []),
      ]);
      setApprovals(pendingData);
      setAllOrders(allData);
    } catch (error) {
      console.error("Failed to fetch approvals:", error);
      toast.error("Failed to load pending approvals");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Filter pending approvals
  const filteredPending = approvals.filter((po) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      po.poNumber?.toLowerCase().includes(q) ||
      po.supplierName?.toLowerCase().includes(q) ||
      po.procurementOfficer?.toLowerCase().includes(q)
    );
  });

  // Filter history orders
  const filteredHistory = allOrders.filter((po) => {
    const q = search.trim().toLowerCase();
    const matchesSearch =
      !q ||
      po.poNumber?.toLowerCase().includes(q) ||
      po.supplierName?.toLowerCase().includes(q) ||
      po.procurementOfficer?.toLowerCase().includes(q);

    const status = String(po.status || "").toUpperCase();
    const matchesStatus =
      statusFilter === "ALL" ||
      (statusFilter === "APPROVED" && (status.includes("APPROV") || status.includes("APPROVED"))) ||
      (statusFilter === "REJECTED" && status.includes("REJECT")) ||
      (statusFilter === "PENDING" && (status.includes("PENDING") || status.includes("PROPOSAL"))) ||
      (statusFilter === "DRAFT" && status.includes("DRAFT"));

    return matchesSearch && matchesStatus;
  });

  return (
    <AppShell
      title="Finance Approvals & History"
      subtitle="Review pending purchase order proposals and inspect PO approval audit history"
    >
      {/* Top Header & Tab Controls */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2 p-1 bg-muted/30 rounded-2xl border border-border/40">
          <button
            type="button"
            onClick={() => setActiveTab("PENDING")}
            className={cn(
              "px-5 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2",
              activeTab === "PENDING"
                ? "bg-primary text-primary-foreground shadow-md"
                : "text-muted-foreground hover:bg-muted/50",
            )}
          >
            <Clock className="size-4" /> Pending Approvals
            <span className="ml-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-background/20">
              {approvals.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("HISTORY")}
            className={cn(
              "px-5 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2",
              activeTab === "HISTORY"
                ? "bg-primary text-primary-foreground shadow-md"
                : "text-muted-foreground hover:bg-muted/50",
            )}
          >
            <History className="size-4" /> PO Approval History
            <span className="ml-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-background/20">
              {allOrders.length}
            </span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              placeholder="Search PO or supplier..."
              className="h-10 w-full rounded-xl border border-border bg-card pl-10 pr-4 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {activeTab === "HISTORY" && (
            <select
              className="h-10 rounded-xl border border-border bg-card px-3 text-xs font-semibold outline-none focus:ring-2 focus:ring-primary/20"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="ALL">All Statuses</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
              <option value="PENDING">Pending Approval</option>
              <option value="DRAFT">Draft</option>
            </select>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : activeTab === "PENDING" ? (
        filteredPending.length === 0 ? (
          <Card className="flex h-64 flex-col items-center justify-center p-6 text-center border-dashed border-border/50 bg-muted/20">
            <ShieldCheck className="size-12 text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-semibold text-muted-foreground">Pending Queue Empty</h3>
            <p className="text-sm text-muted-foreground/70">
              There are no pending purchase order proposals awaiting your approval.
            </p>
          </Card>
        ) : (
          <div className="grid gap-4">
            {filteredPending.map((po) => (
              <Card
                key={po.id}
                className="overflow-hidden border-border/50 transition-all hover:border-primary/30 hover:shadow-soft"
              >
                <div className="flex flex-col p-5 md:flex-row md:items-center">
                  <div className="mb-4 flex flex-1 items-start gap-4 md:mb-0">
                    <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary-soft/30 text-primary">
                      <FileCheck2 className="size-6" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-foreground tracking-tight">
                          {po.poNumber}
                        </h3>
                        <StatusBadge status="Pending Approval" />
                      </div>
                      <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground font-medium">
                        <span className="flex items-center gap-1">
                          <Building2 className="size-3.5" /> {po.supplierName}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="size-3.5" /> Proposed by {po.procurementOfficer}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="text-[10px] text-primary-soft-foreground bg-primary-soft/20 px-2 py-0.5 rounded-md border border-primary/20 uppercase font-bold">
                          ₹ {parseFloat(po.totalAmount || 0).toLocaleString()}
                        </span>
                        <span className="text-[10px] text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-md border border-border/50">
                          {po.items?.length || 0} Line Items
                        </span>
                        {po.rfqNumber && (
                          <span className="text-[10px] text-primary bg-primary/10 px-2 py-0.5 rounded-md border border-primary/20 uppercase font-bold">
                            RFQ: {po.rfqNumber}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between border-t border-border/40 pt-4 md:border-0 md:pt-0">
                    <div className="mr-8 text-right hidden md:block">
                      <div className="flex flex-col items-end gap-1">
                        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                          <Calendar className="size-3" /> Submission Date
                        </div>
                        <p className="text-sm font-semibold">
                          {new Date(po.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button className="rounded-xl h-9 shadow-glow" asChild>
                        <Link
                          to="/finance/approvals/$approvalId"
                          params={{ approvalId: po.id }}
                        >
                          Review Proposal <ArrowRight className="ml-1.5 size-3.5" />
                        </Link>
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )
      ) : (
        /* History Tab */
        filteredHistory.length === 0 ? (
          <Card className="flex h-64 flex-col items-center justify-center p-6 text-center border-dashed border-border/50 bg-muted/20">
            <History className="size-12 text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-semibold text-muted-foreground">No History Found</h3>
            <p className="text-sm text-muted-foreground/70">
              No purchase orders match your search or filter criteria.
            </p>
          </Card>
        ) : (
          <div className="rounded-2xl border border-border/50 bg-card overflow-hidden shadow-soft">
            <div className="p-4 bg-muted/20 border-b border-border/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <History className="size-5 text-primary" />
                <h3 className="font-bold text-sm text-foreground uppercase tracking-wider">
                  PO Approval Audit Log
                </h3>
              </div>
              <span className="text-xs font-bold text-muted-foreground">
                Showing {filteredHistory.length} of {allOrders.length} Purchase Orders
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-muted/40 border-b border-border/50 text-[10px] uppercase tracking-wider text-muted-foreground font-black">
                    <th className="p-4">PO Number</th>
                    <th className="p-4">Supplier</th>
                    <th className="p-4">Officer</th>
                    <th className="p-4">Amount</th>
                    <th className="p-4">Current Status</th>
                    <th className="p-4">Latest Decision / Comment</th>
                    <th className="p-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {filteredHistory.map((po) => {
                    const historyList = po.history || [];
                    const latestEvent = historyList[historyList.length - 1] || historyList[0];

                    return (
                      <tr key={po.id} className="hover:bg-muted/5 transition-colors">
                        <td className="p-4 font-mono font-bold text-primary">{po.poNumber}</td>
                        <td className="p-4">
                          <p className="font-bold text-foreground">{po.supplierName}</p>
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {po.supplierCode || "—"}
                          </span>
                        </td>
                        <td className="p-4 font-medium text-muted-foreground">
                          {po.procurementOfficer || "—"}
                        </td>
                        <td className="p-4 font-mono font-bold text-foreground">
                          ₹ {parseFloat(po.totalAmount || 0).toLocaleString()}
                        </td>
                        <td className="p-4">
                          <StatusBadge status={po.status} />
                        </td>
                        <td className="p-4 max-w-xs">
                          {latestEvent ? (
                            <div>
                              <p className="text-[10px] font-bold text-foreground flex items-center gap-1">
                                <span className="text-primary">{latestEvent.actorName || latestEvent.actor_name || "Officer"}:</span>
                                <span className="text-muted-foreground font-normal italic truncate max-w-[200px] inline-block">
                                  "{latestEvent.comments || "No comment"}"
                                </span>
                              </p>
                              <p className="text-[9px] font-mono text-muted-foreground mt-0.5">
                                {new Date(latestEvent.createdAt || latestEvent.created_at).toLocaleString()}
                              </p>
                            </div>
                          ) : (
                            <span className="text-muted-foreground italic text-[10px]">
                              {po.createdAt ? new Date(po.createdAt).toLocaleDateString() : "—"}
                            </span>
                          )}
                        </td>
                        <td className="p-4 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            className="rounded-xl h-8 px-3 font-bold text-xs"
                            asChild
                          >
                            <Link
                              to="/finance/approvals/$approvalId"
                              params={{ approvalId: po.id }}
                            >
                              <Eye className="size-3.5 mr-1" /> View Trail
                            </Link>
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}
    </AppShell>
  );
}
