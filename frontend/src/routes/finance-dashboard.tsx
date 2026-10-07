import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  FileCheck2,
  Clock,
  CheckCircle2,
  XCircle,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  ShieldCheck,
  CreditCard,
  Building2,
  Calendar,
  Loader2,
  Table as TableIcon,
} from "lucide-react";
import { AppShell, StatusBadge } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { requireRole } from "@/lib/auth-utils";

export const Route = createFileRoute("/finance-dashboard")({
  beforeLoad: () => requireRole("FINANCE"),
  component: FinanceDashboard,
});

function FinanceDashboard() {
  const formatCurrency = (value: number) =>
    `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const getOrderTotal = (po: any) => Number(po.quotation?.totalAmount ?? po.quotation?.total_amount ?? po.totalAmount ?? po.total_amount ?? 0);
  const [stats, setStats] = useState({
    pending: 0,
    approved: 0,
    rejected: 0,
    totalValue: 0,
  });
  const [approvals, setApprovals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = async (quiet = false) => {
    try {
      if (!quiet) setLoading(true);
      const allPos = await api.getPurchaseOrders();

      const pending = allPos.filter((p: any) => p.status === "PENDING_FINANCE");
      const approved = allPos.filter((p: any) => p.status === "APPROVED" || p.status === "SENT");
      const rejected = allPos.filter((p: any) => p.status === "REJECTED");
      const totalValue = approved.reduce(
        (sum: number, p: any) => sum + getOrderTotal(p),
        0,
      );

      setStats({
        pending: pending.length,
        approved: approved.length,
        rejected: rejected.length,
        totalValue,
      });

      setApprovals(pending);
    } catch (e) {
      if (!quiet) toast.error("Failed to load dashboard data");
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(() => loadData(true), 10000);
    return () => clearInterval(interval);
  }, []);

  // Group pending by RFQ
  const groupedByRfq = approvals.reduce((acc: any, po: any) => {
    const rfqId = po.rfqId || "no-rfq";
    if (!acc[rfqId]) acc[rfqId] = [];
    acc[rfqId].push(po);
    return acc;
  }, {});

  return (
    <AppShell title="Finance Dashboard" subtitle="Overview of procurement financial authorizations">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
        <StatsCard
          title="Pending Approval"
          value={stats.pending}
          icon={Clock}
          color="text-warning"
          bg="bg-warning-soft/20"
          to="/finance/approvals"
        />
        <StatsCard
          title="Total Approved"
          value={stats.approved}
          icon={CheckCircle2}
          color="text-success"
          bg="bg-success-soft/20"
          to="/procurement/purchase-orders"
        />
        <StatsCard
          title="Rejected"
          value={stats.rejected}
          icon={XCircle}
          color="text-destructive"
          bg="bg-destructive-soft/20"
          to="/procurement/purchase-orders"
        />
        <StatsCard
          title="Authorized Spend"
          value={formatCurrency(stats.totalValue)}
          icon={TrendingUp}
          color="text-primary"
          bg="bg-primary-soft/20"
          to="/procurement/purchase-orders"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Approval Queue */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="border-border/40 shadow-soft">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg font-bold tracking-tight">
                  Priority Approvals
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Purchase orders awaiting your signature
                </p>
              </div>
              <Button variant="ghost" size="sm" className="rounded-xl text-primary" asChild>
                <Link to="/finance/approvals">
                  View All <ArrowRight className="ml-2 size-4" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex h-48 items-center justify-center">
                  <Loader2 className="size-8 animate-spin text-primary" />
                </div>
              ) : Object.keys(groupedByRfq).length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center bg-muted/10 rounded-2xl border-dashed border-2">
                  <ShieldCheck className="size-10 text-muted-foreground/30 mb-2" />
                  <p className="text-sm font-medium text-muted-foreground">Your queue is clear</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {Object.entries(groupedByRfq).map(([rfqId, rfqApprovals]: [string, any], index) => (
                    <Link
                      key={rfqId}
                      to="/finance/approvals"
                      className="flex items-center justify-between p-4 rounded-2xl border border-border/60 hover:border-primary/30 hover:shadow-glow transition-all bg-card/50 group"
                    >
                      <div className="flex items-center gap-4">
                        <div className="size-10 rounded-xl bg-primary-soft/20 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-white transition-colors">
                          <TableIcon className="size-5" />
                        </div>
                        <div>
                          <p className="text-sm font-bold uppercase tracking-tight">
                            {rfqId === "no-rfq"
                              ? "Direct Purchase Orders"
                              : `RFQ: ${rfqApprovals[0]?.rfqNumber || `RFQ-${String(index + 1).padStart(4, "0")}`}`}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {rfqApprovals.length} Proposal(s) awaiting signature ·{" "}
                            {rfqApprovals.map((p: any) => p.supplier_name || p.supplierName || "Supplier").join(", ")}
                          </p>
                        </div>
                      </div>
                      <div className="text-right flex items-center gap-6">
                        <div className="hidden sm:block">
                          <p className="text-sm font-black text-primary">
                            ₹
                            {rfqApprovals
                              .reduce(
                                (sum: number, po: any) => sum + getOrderTotal(po),
                                0,
                              )
                              .toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </p>
                          <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">
                            Total Value
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-xl h-8 text-xs font-bold pointer-events-none group-hover:bg-primary group-hover:text-white transition-colors"
                        >
                          View Approvals
                        </Button>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Finance Policy */}
        <Card className="border-border/40 shadow-soft self-start">
          <CardHeader>
            <CardTitle className="text-lg font-bold tracking-tight">Finance Controls</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <PolicyItem
              title="Budget Threshold"
              desc="PO above ₹5.0L requires secondary CFO approval."
              status="Enforced"
            />
            <PolicyItem
              title="Vendor Compliance"
              desc="GST validation is mandatory for all active suppliers."
              status="Enforced"
            />
            <div className="p-4 rounded-2xl bg-primary/5 border border-primary/10">
              <h4 className="text-xs font-black uppercase text-primary mb-2">Quick Actions</h4>
              <div className="grid gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-[11px] h-8 rounded-lg font-bold"
                >
                  <Building2 className="size-3.5 mr-2" /> Vendor Payment Terms
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-[11px] h-8 rounded-lg font-bold"
                >
                  <Calendar className="size-3.5 mr-2" /> Monthly Spend Report
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function StatsCard({ title, value, icon: Icon, color, bg, to }: any) {
  const content = (
    <CardContent className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
            {title}
          </p>
          <h2 className="text-2xl font-black mt-1">{value}</h2>
        </div>
        <div className={cn("size-12 rounded-2xl flex items-center justify-center", bg, color)}>
          <Icon className="size-6" />
        </div>
      </div>
    </CardContent>
  );

  return (
    <Card
      className={cn(
        "border-border/40 shadow-soft overflow-hidden transition-all",
        to && "hover:border-primary/30 hover:shadow-glow cursor-pointer",
      )}
    >
      {to ? <Link to={to}>{content}</Link> : content}
    </Card>
  );
}

function PolicyItem({ title, desc, status }: any) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-foreground">{title}</p>
        <span className="text-[9px] font-black uppercase bg-success-soft/20 text-success px-1.5 py-0.5 rounded border border-success/20">
          {status}
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">{desc}</p>
    </div>
  );
}
