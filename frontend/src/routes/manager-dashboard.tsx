import { createFileRoute, Link } from "@tanstack/react-router";
import { Children, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Loader2,
  PackageCheck,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell, StatusBadge } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api-client";
import { requireRole } from "@/lib/auth-utils";

export const Route = createFileRoute("/manager-dashboard")({
  beforeLoad: () => requireRole(["MANAGER", "ADMIN", "SUPERUSER"]),
  component: ManagerDashboard,
});

function ManagerDashboard() {
  const [materialRequests, setMaterialRequests] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // Rejection reason dialog state
  const [rejectDialog, setRejectDialog] = useState<{
    open: boolean;
    type: "material_request" | "supplier";
    item: any;
    reason: string;
  }>({
    open: false,
    type: "material_request",
    item: null,
    reason: "",
  });

  const loadData = async (quiet = false) => {
    try {
      if (!quiet) setLoading(true);
      const [requests, pendingSuppliers] = await Promise.all([
        api.getMaterialRequests(),
        api.getSuppliers(),
      ]);
      setMaterialRequests(Array.isArray(requests) ? requests : []);
      setSuppliers(
        Array.isArray(pendingSuppliers)
          ? pendingSuppliers.filter(
              (supplier) =>
                normalizeStatus(supplier.status || "Pending Approval") === "pending approval",
            )
          : [],
      );
    } catch (error) {
      console.error("Failed to load manager dashboard", error);
      if (!quiet) toast.error("Failed to load manager dashboard");
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();

    const refreshQuietly = () => void loadData(true);
    window.addEventListener("focus", refreshQuietly);
    window.addEventListener("material-requests:changed", refreshQuietly);
    window.addEventListener("suppliers:changed", refreshQuietly);
    return () => {
      window.removeEventListener("focus", refreshQuietly);
      window.removeEventListener("material-requests:changed", refreshQuietly);
      window.removeEventListener("suppliers:changed", refreshQuietly);
    };
  }, []);

  const normalizeStatus = (status: unknown) =>
    String(status || "")
      .trim()
      .toLowerCase();

  const requestId = (request: any) => String(request?.id || request?.requestId || "");
  const supplierIdOf = (supplier: any) => String(supplier?.supplierId || supplier?.supplier_id || supplier?.id || "");

  const requestIdOf = (request: any) =>
    request?.requestNumber ||
    request?.request_number ||
    request?.number ||
    (request?.id ? `Request ${String(request.id).slice(0, 8)}` : "Material Request");

  const pendingRequests = useMemo(
    () =>
      materialRequests.filter((request) =>
        ["submitted", "pending approval"].includes(normalizeStatus(request.status)),
      ),
    [materialRequests],
  );

  const approvedRequests = useMemo(
    () => materialRequests.filter((request) => normalizeStatus(request.status) === "approved"),
    [materialRequests],
  );

  const rejectedRequests = useMemo(
    () => materialRequests.filter((request) => normalizeStatus(request.status) === "rejected"),
    [materialRequests],
  );

  const recentRequests = useMemo(
    () =>
      [...materialRequests]
        .sort((a, b) => {
          const aTime = new Date(
            a.updatedAt || a.updated_at || a.createdAt || a.created_at || 0,
          ).getTime();
          const bTime = new Date(
            b.updatedAt || b.updated_at || b.createdAt || b.created_at || 0,
          ).getTime();
          return bTime - aTime;
        })
        .slice(0, 8),
    [materialRequests],
  );

  const stats = useMemo(
    () => ({
      totalRequests: materialRequests.length,
      pending: pendingRequests.length,
      approved: approvedRequests.length,
      rejected: rejectedRequests.length,
      supplierApprovals: suppliers.length,
    }),
    [
      approvedRequests.length,
      materialRequests.length,
      pendingRequests.length,
      rejectedRequests.length,
      suppliers.length,
    ],
  );

  const updateMaterialRequest = async (request: any, nextStatus: "Approved" | "Rejected") => {
    const id = requestId(request);
    const key = `mr-${id}`;
    try {
      setBusyKey(key);
      await api.updateMaterialRequestStatus(
        id,
        nextStatus,
        nextStatus === "Approved"
          ? "Manager approved material request"
          : "Manager rejected material request",
        "Manager",
      );
      toast.success(
        nextStatus === "Approved"
          ? "Material request approved"
          : "Material request rejected",
      );
      await loadData(true);
      window.dispatchEvent(new Event("material-requests:changed"));
    } catch (error: any) {
      toast.error(error.message || "Failed to update material request");
    } finally {
      setBusyKey(null);
    }
  };

  const updateSupplier = async (supplier: any, nextStatus: "Active" | "Blocked") => {
    const supplierId = supplierIdOf(supplier);
    const key = `supplier-${supplierId}`;
    try {
      setBusyKey(key);
      await api.updateSupplierStatus(
        supplierId,
        nextStatus,
        nextStatus === "Active"
          ? "Manager approved supplier onboarding"
          : "Manager rejected supplier onboarding",
      );
      toast.success(nextStatus === "Active" ? "Supplier approved" : "Supplier rejected");
      await loadData(true);
      window.dispatchEvent(new Event("suppliers:changed"));
    } catch (error: any) {
      toast.error(error.message || "Failed to update supplier");
    } finally {
      setBusyKey(null);
    }
  };

  const handleOpenReject = (item: any, type: "material_request" | "supplier") => {
    setRejectDialog({
      open: true,
      type,
      item,
      reason: "",
    });
  };

  const handleConfirmReject = async () => {
    if (!rejectDialog.item) return;
    const reason = rejectDialog.reason.trim();
    if (!reason) {
      toast.error("Please specify a reason for rejection.");
      return;
    }

    if (rejectDialog.type === "material_request") {
      const id = requestId(rejectDialog.item);
      const reqNum = requestIdOf(rejectDialog.item);
      const key = `mr-${id}`;
      try {
        setBusyKey(key);
        await api.updateMaterialRequestStatus(
          id,
          "Rejected",
          reason,
          "Manager",
        );
        toast.success(`Material request ${reqNum} rejected`, {
          description: `Reason: ${reason}`,
        });
        setRejectDialog((prev) => ({ ...prev, open: false }));
        await loadData(true);
        window.dispatchEvent(new Event("material-requests:changed"));
      } catch (error: any) {
        toast.error(error.message || "Failed to reject material request");
      } finally {
        setBusyKey(null);
      }
    } else {
      const supplierId = supplierIdOf(rejectDialog.item);
      const supplierName =
        rejectDialog.item?.supplierName ||
        rejectDialog.item?.supplier_name ||
        "Supplier";
      const key = `supplier-${supplierId}`;
      try {
        setBusyKey(key);
        await api.updateSupplierStatus(
          supplierId,
          "Blocked",
          reason,
        );
        toast.success(`Supplier "${supplierName}" onboarding rejected`, {
          description: `Reason: ${reason}`,
        });
        setRejectDialog((prev) => ({ ...prev, open: false }));
        await loadData(true);
        window.dispatchEvent(new Event("suppliers:changed"));
      } catch (error: any) {
        toast.error(error.message || "Failed to reject supplier");
      } finally {
        setBusyKey(null);
      }
    }
  };

  return (
    <AppShell
      title="Manager Dashboard"
      subtitle="Approve warehouse material requests and new supplier onboarding"
      actions={
        <Button variant="outline" className="rounded-xl" onClick={() => loadData()}>
          <RefreshCw className="size-4" /> Refresh
        </Button>
      }
    >
      <div className="mb-6 grid gap-4 md:grid-cols-5">
        <MetricCard title="Total Requests" value={stats.totalRequests} icon={ClipboardList} />
        <MetricCard title="Pending" value={stats.pending} icon={PackageCheck} />
        <MetricCard title="Approved" value={stats.approved} icon={CheckCircle2} />
        <MetricCard title="Rejected" value={stats.rejected} icon={XCircle} />
        <MetricCard title="Supplier Approvals" value={stats.supplierApprovals} icon={PackageCheck} />
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-2">
            <ApprovalQueue
              title="Material Request Approvals"
              emptyText="No warehouse material requests are waiting for manager approval."
            >
              {pendingRequests.map((request) => (
                <RequestCard key={requestId(request)} request={request}>
                  <div className="mt-4 flex flex-wrap justify-end gap-2">
                    <Button
                      variant="outline"
                      className="rounded-xl border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-900/50 dark:hover:bg-red-950/30"
                      disabled={busyKey === `mr-${requestId(request)}`}
                      onClick={() => handleOpenReject(request, "material_request")}
                    >
                      <XCircle className="size-4" /> Reject
                    </Button>
                    <Button
                      className="rounded-xl"
                      disabled={busyKey === `mr-${requestId(request)}`}
                      onClick={() => updateMaterialRequest(request, "Approved")}
                    >
                      <CheckCircle2 className="size-4" /> Approve
                    </Button>
                  </div>
                </RequestCard>
              ))}
            </ApprovalQueue>

            <ApprovalQueue
              title="Supplier Onboarding Approvals"
              emptyText="No suppliers are waiting for manager approval."
            >
              {suppliers.map((supplier) => {
                const supplierId = supplierIdOf(supplier);
                const category = supplier.category || supplier.categories || supplier.materialCategories;
                const categoryText = Array.isArray(category)
                  ? category.filter(Boolean).join(", ")
                  : String(category || "").trim();
                return (
                  <div key={supplierId} className="rounded-xl border border-border/60 bg-card p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-black">
                            {supplier.supplierName || supplier.supplier_name || "Supplier"}
                          </p>
                          <StatusBadge status={supplier.status || "Pending Approval"} />
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {supplier.registeredCompanyName ||
                            supplier.registered_company_name ||
                            "Company"}{" "}
                          {" / "}
                          {categoryText || "Category not set"}
                        </p>
                      </div>
                      <Link
                        to="/supplier/$supplierId"
                        params={{ supplierId }}
                        search={{ module: "manager" } as any}
                        className="text-xs font-bold text-primary hover:underline"
                      >
                        View profile
                      </Link>
                    </div>
                    <div className="mt-4 flex flex-wrap justify-end gap-2">
                      <Button
                        variant="outline"
                        className="rounded-xl border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-900/50 dark:hover:bg-red-950/30"
                        disabled={busyKey === `supplier-${supplierId}`}
                        onClick={() => handleOpenReject(supplier, "supplier")}
                      >
                        <XCircle className="size-4" /> Reject
                      </Button>
                      <Button
                        className="rounded-xl"
                        disabled={busyKey === `supplier-${supplierId}`}
                        onClick={() => updateSupplier(supplier, "Active")}
                      >
                        <CheckCircle2 className="size-4" /> Approve Supplier
                      </Button>
                    </div>
                  </div>
                );
              })}
            </ApprovalQueue>
          </div>

          {/* Recent Requests Section in Table Format below Supplier Onboarding Approvals */}
          <RecentRequestsTable requests={recentRequests} />
        </div>
      )}

      {/* Rejection Reason Modal */}
      <Dialog
        open={rejectDialog.open}
        onOpenChange={(open) => !open && setRejectDialog((prev) => ({ ...prev, open: false }))}
      >
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <div className="flex items-center gap-2.5 text-red-600 mb-1">
              <div className="grid size-9 place-items-center rounded-xl bg-red-100 dark:bg-red-950/50 text-red-600">
                <AlertCircle className="size-5" />
              </div>
              <DialogTitle className="text-lg font-bold">
                {rejectDialog.type === "material_request"
                  ? "Reject Material Request"
                  : "Reject Supplier Onboarding"}
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs text-muted-foreground">
              {rejectDialog.type === "material_request" ? (
                <>
                  Specify why request{" "}
                  <strong className="text-foreground font-mono">
                    {requestIdOf(rejectDialog.item)}
                  </strong>{" "}
                  is being rejected. The requester will be notified of this reason.
                </>
              ) : (
                <>
                  Specify why supplier{" "}
                  <strong className="text-foreground">
                    {rejectDialog.item?.supplierName || rejectDialog.item?.supplier_name || "Supplier"}
                  </strong>{" "}
                  is being rejected.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label
                htmlFor="rejection-reason"
                className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Rejection Reason <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="rejection-reason"
                placeholder="Enter detailed reason for rejection..."
                value={rejectDialog.reason}
                onChange={(e) =>
                  setRejectDialog((prev) => ({ ...prev, reason: e.target.value }))
                }
                rows={3}
                className="rounded-xl resize-none text-sm"
                required
              />
            </div>

            {/* Quick Reason Chips */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">
                Quick reasons:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {(rejectDialog.type === "material_request"
                  ? [
                      "Budget limit exceeded",
                      "Invalid specification",
                      "Duplicate request",
                      "Inventory already in stock",
                      "Missing authorization",
                    ]
                  : [
                      "Incomplete compliance documents",
                      "Failed quality check",
                      "Duplicate vendor profile",
                      "Invalid GST/tax credentials",
                    ]
                ).map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() =>
                      setRejectDialog((prev) => ({
                        ...prev,
                        reason: prev.reason ? `${prev.reason}; ${preset}` : preset,
                      }))
                    }
                    className="rounded-lg border bg-muted/40 px-2 py-1 text-[11px] font-medium text-muted-foreground transition hover:bg-primary/10 hover:text-primary hover:border-primary/30"
                  >
                    + {preset}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              onClick={() => setRejectDialog((prev) => ({ ...prev, open: false }))}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="rounded-xl font-bold gap-1.5"
              disabled={!rejectDialog.reason.trim() || !!busyKey}
              onClick={handleConfirmReject}
            >
              <XCircle className="size-4" />
              Confirm Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function RequestCard({ request, children }: any) {
  const id = String(request?.id || request?.requestId || "");
  const requestNumber =
    request?.requestNumber || request?.request_number || request?.number || (id ? `Request ${id.slice(0, 8)}` : "Material Request");
  const warehouse = request?.warehouseId || request?.warehouse_id || request?.warehouseName || request?.warehouse_name || "Warehouse";
  const department = request?.department || request?.departmentName || request?.department_name || "Department";
  const items = Array.isArray(request?.items) ? request.items : [];

  const isRejected = (request?.status || "").toUpperCase() === "REJECTED";
  const history = Array.isArray(request?.approval_history) ? request.approval_history : [];
  const rejectedHistory = history.filter((h: any) => (h.status || "").toUpperCase() === "REJECTED");
  const lastRejection = rejectedHistory[rejectedHistory.length - 1];
  const rejectionComment = lastRejection?.comments || request?.remarks || request?.rejection_reason;

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-mono text-sm font-black">
              {requestNumber}
            </p>
            <StatusBadge status={request?.status || "Unknown"} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {warehouse} {" / "}
            {department} {" / "} {items.length} item(s)
          </p>
        </div>
        <Link
          to="/procurement/material-requests"
          search={{ module: "manager" } as any}
          className="text-xs font-bold text-primary hover:underline"
        >
          View details
        </Link>
      </div>

      {isRejected && rejectionComment && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50/70 p-2.5 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
          <span className="font-bold flex items-center gap-1.5 mb-0.5">
            <XCircle className="size-3.5 text-red-600" />
            Rejection Reason:
          </span>
          <p className="italic">{rejectionComment}</p>
        </div>
      )}

      {children}
    </div>
  );
}

function MetricCard({ title, value, icon: Icon }: any) {
  return (
    <Card className="border-border/40 shadow-soft">
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            {title}
          </p>
          <p className="mt-1 text-2xl font-black tabular-nums">{value}</p>
        </div>
        <div className="grid size-11 place-items-center rounded-xl bg-primary-soft/20 text-primary">
          <Icon className="size-5" />
        </div>
      </CardContent>
    </Card>
  );
}

function ApprovalQueue({ title, emptyText, children }: any) {
  const isEmpty = Children.count(children) === 0;
  return (
    <Card className="border-border/40 shadow-soft">
      <CardHeader>
        <CardTitle className="text-base font-bold tracking-tight">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {isEmpty ? (
          <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-border/60 bg-muted/20 px-6 text-center text-sm text-muted-foreground">
            {emptyText}
          </div>
        ) : (
          <div className="space-y-3">{children}</div>
        )}
      </CardContent>
    </Card>
  );
}

function formatDate(dateValue: any) {
  if (!dateValue) return "—";
  try {
    const d = new Date(dateValue);
    if (isNaN(d.getTime())) return String(dateValue);
    return d.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return String(dateValue);
  }
}

function RecentRequestsTable({ requests }: { requests: any[] }) {
  const [filterQuery, setFilterQuery] = useState("");

  const filtered = useMemo(() => {
    if (!filterQuery.trim()) return requests;
    const q = filterQuery.toLowerCase();
    return requests.filter((r) => {
      const num = String(r?.requestNumber || r?.request_number || r?.number || r?.id || "").toLowerCase();
      const wh = String(r?.warehouseId || r?.warehouse_id || r?.warehouseName || r?.warehouse_name || "").toLowerCase();
      const dept = String(r?.department || r?.departmentName || r?.department_name || "").toLowerCase();
      const by = String(r?.requestedBy || r?.requested_by || r?.createdBy || r?.created_by || "").toLowerCase();
      const status = String(r?.status || "").toLowerCase();
      return num.includes(q) || wh.includes(q) || dept.includes(q) || by.includes(q) || status.includes(q);
    });
  }, [requests, filterQuery]);

  return (
    <Card className="border-border/40 shadow-soft overflow-hidden">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border/40 px-6 py-4">
        <div>
          <div className="flex items-center gap-2.5">
            <CardTitle className="text-base font-bold tracking-tight">Recent Requests</CardTitle>
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
              {requests.length} requests
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Overview of recently submitted, approved, or rejected material requests
          </p>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Search recent requests..."
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            className="h-8 rounded-lg border border-border/60 bg-muted/30 px-3 text-xs focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary w-48 sm:w-60"
          />
          <Link
            to="/procurement/material-requests"
            search={{ module: "manager" } as any}
            className="text-xs font-bold text-primary hover:underline flex items-center gap-1 shrink-0"
          >
            View all in Procurement <ArrowRight className="size-3.5" />
          </Link>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead className="bg-muted/50 border-b border-border/60 text-[11px] uppercase tracking-wider font-bold text-muted-foreground">
              <tr>
                <th className="px-5 py-3.5">Request #</th>
                <th className="px-4 py-3.5">Warehouse / Dept</th>
                <th className="px-4 py-3.5 text-center">Items</th>
                <th className="px-4 py-3.5">Requested By</th>
                <th className="px-4 py-3.5">Date</th>
                <th className="px-4 py-3.5">Status</th>
                <th className="px-4 py-3.5">Rejection / Remarks</th>
                <th className="px-5 py-3.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-muted-foreground">
                    <ClipboardList className="mx-auto size-9 opacity-30 mb-2" />
                    <p className="font-semibold text-sm">
                      {filterQuery ? "No matching requests found" : "No material requests found"}
                    </p>
                    <p className="text-xs mt-0.5">
                      {filterQuery
                        ? "Try clearing your search query."
                        : "Recent requests will appear here once submitted."}
                    </p>
                  </td>
                </tr>
              ) : (
                filtered.map((request) => {
                  const id = String(request?.id || request?.requestId || "");
                  const requestNumber =
                    request?.requestNumber ||
                    request?.request_number ||
                    request?.number ||
                    (id ? `REQ-${id.slice(0, 8)}` : "Material Request");
                  const warehouse =
                    request?.warehouseId ||
                    request?.warehouse_id ||
                    request?.warehouseName ||
                    request?.warehouse_name ||
                    "—";
                  const department =
                    request?.department ||
                    request?.departmentName ||
                    request?.department_name ||
                    "—";
                  const items = Array.isArray(request?.items) ? request.items : [];
                  const requestedBy =
                    request?.requestedBy ||
                    request?.requested_by ||
                    request?.createdBy ||
                    request?.created_by ||
                    "—";
                  const dateVal =
                    request?.requestedDate ||
                    request?.requested_date ||
                    request?.updatedAt ||
                    request?.updated_at ||
                    request?.createdAt ||
                    request?.created_at;

                  const isRejected = (request?.status || "").toUpperCase() === "REJECTED";
                  const history = Array.isArray(request?.approval_history)
                    ? request.approval_history
                    : [];
                  const rejectedHistory = history.filter(
                    (h: any) => (h.status || "").toUpperCase() === "REJECTED",
                  );
                  const lastRejection = rejectedHistory[rejectedHistory.length - 1];
                  const rejectionComment =
                    lastRejection?.comments || request?.remarks || request?.rejection_reason;

                  return (
                    <tr
                      key={id || requestNumber}
                      className="hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-5 py-3.5">
                        <span className="font-mono text-xs font-bold text-primary">
                          {requestNumber}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="font-medium text-foreground text-xs">{warehouse}</div>
                        <div className="text-[11px] text-muted-foreground">{department}</div>
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-muted text-foreground">
                          {items.length} item{items.length === 1 ? "" : "s"}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-xs text-foreground font-medium">
                        {requestedBy}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-muted-foreground whitespace-nowrap">
                        {formatDate(dateVal)}
                      </td>
                      <td className="px-4 py-3.5">
                        <StatusBadge status={request?.status || "Unknown"} />
                      </td>
                      <td className="px-4 py-3.5 max-w-xs">
                        {isRejected && rejectionComment ? (
                          <div className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50/80 px-2.5 py-1 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300 font-medium">
                            <XCircle className="size-3.5 shrink-0 text-red-600" />
                            <span className="truncate max-w-[200px]" title={rejectionComment}>
                              {rejectionComment}
                            </span>
                          </div>
                        ) : request?.remarks ? (
                          <span
                            className="text-xs text-muted-foreground truncate block max-w-[200px]"
                            title={request.remarks}
                          >
                            {request.remarks}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground/60">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-right whitespace-nowrap">
                        <Link
                          to="/procurement/material-requests"
                          search={{ module: "manager" } as any}
                          className="inline-flex items-center text-xs font-semibold text-primary hover:underline gap-1"
                        >
                          View details
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

