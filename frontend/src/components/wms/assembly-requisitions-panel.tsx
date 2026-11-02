import { InformationTooltip } from "@/components/ui/information-tooltip";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import { ClipboardList, Loader2, RefreshCw } from "lucide-react";

export function AssemblyRequisitionsPanel({ onUpdated, refreshKey = 0, showRefresh = true, pickupTasks = [], onConfirmPick }: { onUpdated?: () => void | Promise<void>; refreshKey?: number; showRefresh?: boolean; pickupTasks?: any[]; onConfirmPick?: (task: any) => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [requests, materialRequests, warehouseRows] = await Promise.all([
        api.getAssemblyRequisitions("Assembly"),
        api.getAssemblyMaterialRequests(),
        api.getWarehouses().catch(() => []),
      ]);
      const requisitionRows = Array.isArray(requests) ? requests : [];
      const existingIds = new Set(requisitionRows.map((request: any) => String(request.id)));
      const legacyRows = (Array.isArray(materialRequests) ? materialRequests : [])
        .filter((request: any) => !existingIds.has(String(request.id)))
        .map((request: any) => ({
          ...request,
          id: String(request.id),
          requisition_number: request.request_number,
          requested_by: request.requested_by || "Assembly",
          priority: request.priority || "NORMAL",
          items: (request.items || []).map((item: any) => ({
            ...item,
            requested_quantity: item.requested_quantity ?? item.quantity ?? 0,
            available_quantity: item.available_quantity ?? 0,
            reserved_quantity: item.reserved_quantity ?? 0,
          })),
          legacy_material_request: true,
        }));
      setRows([...requisitionRows, ...legacyRows]);
      setWarehouses(
        Array.isArray(warehouseRows)
          ? warehouseRows.filter((warehouse: any) => String(warehouse.status).toUpperCase() === "ACTIVE")
          : [],
      );
    } catch (error: any) {
      toast.error(error?.message || "Unable to load Assembly requisitions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh, refreshKey]);

  const runAction = async (id: string, action: () => Promise<unknown>, message: string) => {
    setBusyId(id);
    try {
      await action();
      toast.success(message);
      await refresh();
      await onUpdated?.();
    } catch (error: any) {
      toast.error(error?.message || "Action failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="assembly-requisitions-panel space-y-4" aria-label="Assembly requisitions">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-transparent px-5 py-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-lg font-bold"><ClipboardList className="size-5" />Assembly Requisitions</h2>
        {showRefresh && <Button data-refresh-control="true" size="icon" variant="outline" onClick={() => void refresh()} aria-label="Refresh Assembly requisitions">
          <RefreshCw className="size-4" /></Button>}
      </div>
      {loading ? (
        <div className="grid min-h-64 place-items-center">
          <Loader2 className="size-6 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <Card className="rounded-lg border-slate-300 bg-white shadow-none dark:border-slate-700 dark:bg-slate-900">
          <CardContent className="p-10 text-center text-muted-foreground">
            No Assembly requisitions have been submitted.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((request) => {
            const id = String(request.id);
            const status = String(request.status || "").toUpperCase();
            const statusPillTone = ["ISSUED", "ASSEMBLY_RECEIVED", "COMPLETED", "RECEIVED"].includes(status)
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200"
              : ["REJECTED", "CANCELLED"].includes(status)
                ? "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200"
                : ["APPROVED", "RESERVED", "PARTIALLY_RESERVED"].includes(status)
                  ? "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-200"
                  : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200";
            const approvalRequired = status === "PENDING_WAREHOUSE_APPROVAL";
            const canReview =
              approvalRequired || ["PENDING", "SUBMITTED", "PARTIALLY_RESERVED"].includes(status);
            const hasReservation = (request.reservations || []).some(
              (reservation: any) => Number(reservation.reserved_quantity) > 0,
            );
            const selectedWarehouse =
              request.assigned_warehouse_ref_id ||
              request.suggested_warehouse_ref_id ||
              request.reservations?.find((r: any) => r.warehouse_ref_id)?.warehouse_ref_id ||
              warehouses[0]?.id || "";
            const isBusy = busyId === id;
            const requestNumber = String(request.requisition_number || request.request_number || "").trim().toUpperCase();
            const relatedPickupTasks = pickupTasks.filter((task) =>
              String(task.assembly_order_number || task.request_number || "").trim().toUpperCase() === requestNumber,
            );
            const productionQuantity = Number(
              request.target_quantity || request.planned_quantity || 0,
            );
            const firstItem = request.items?.[0];
            const bomQuantityPerUnit =
              productionQuantity > 0 && firstItem
                ? Number(firstItem.requested_quantity || firstItem.quantity || 0) /
                  productionQuantity
                : 0;
            return (
              <Card key={id} className="rounded-lg border-border/60 bg-white shadow-none dark:border-slate-700 dark:bg-slate-900">
                <CardContent className="space-y-3 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="font-semibold text-slate-900 dark:text-slate-100">{request.requisition_number}</h2>
                      <p className="text-xs text-muted-foreground">
                        {[request.department, request.requested_by ? `Requested by ${request.requested_by}` : "", request.required_date].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <span className={`inline-flex items-center rounded-md border px-2.5 py-1 text-[11px] font-semibold tracking-wide ${statusPillTone}`}>
                      {status || ""}
                    </span>
                  </div>
                  {productionQuantity > 0 && firstItem && (
                    <div className="text-xs leading-relaxed text-muted-foreground">
                      <span className="font-semibold text-blue-900 dark:text-blue-200">BOM calculation: </span>
                      {request.product_name || "Finished good"} × {productionQuantity}{" "}
                      {request.uom || "PCS"}
                      {" → "}
                      {firstItem.material_name || firstItem.material_code} × {bomQuantityPerUnit}{" "}
                      {firstItem.uom || ""}/{request.uom || "PCS"}
                      {" → Required "}
                      {firstItem.requested_quantity ?? firstItem.quantity ?? 0}{" "}
                      {firstItem.uom || ""}
                    </div>
                  )}
                  {status === "ISSUED" && !request.issue_transaction_exists && (
                    <p className="text-xs text-amber-600">
                      Issue status requires a persisted warehouse issue transaction; this request is
                      awaiting verification.
                    </p>
                  )}
                  {status === "ISSUED" && request.issue_transaction && (
                    <p className="text-xs text-emerald-700">
                      Issued under {request.issue_transaction.issue_number} by{" "}
                      {request.issue_transaction.issued_by || "Warehouse"}
                      {request.issue_transaction.issued_at
                        ? ` on ${new Date(request.issue_transaction.issued_at).toLocaleString()}`
                        : ""}
                      . Reserved quantity is 0 because the reservation was consumed by issue.
                    </p>
                  )}
                  {(request.items || []).length > 0 &&
                    (request.items || []).every(
                      (item: any) =>
                        Number(item.received_quantity || 0) >=
                        Number(
                          item.required_quantity ?? item.requested_quantity ?? item.quantity ?? 0,
                        ),
                    ) && (
                      <p className="text-xs font-semibold text-emerald-700">
                        Materials Received — Ready for Production. Warehouse stock is tracked
                        separately.
                      </p>
                    )}
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[650px] table-fixed text-left text-sm">
                      <colgroup><col className="w-[40%]" /><col className="w-[16%]" /><col className="w-[16%]" /><col className="w-[16%]" /><col className="w-[12%]" /></colgroup>
                      <thead>
                        <tr className="border-b bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:bg-slate-800/70 dark:text-slate-300">
                          <th className="px-3 py-2">Material</th>
                          <th className="px-3 py-2">Requested</th>
                          <th className="px-3 py-2">Available<InformationTooltip help="inventory" /></th>
                          <th className="px-3 py-2">Reserved<InformationTooltip help="reserved" /></th>
                          <th className="px-3 py-2">Unit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(request.items || []).map((item: any) => (
                          <tr
                            key={item.id || item.material_code}
                            className="border-b border-slate-100 text-slate-700 transition-colors hover:bg-blue-50/50 last:border-0 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-blue-950/20"
                          >
                            <td className="px-3 py-2.5 font-medium">
                              <span className="block font-semibold text-primary">{item.material_code}</span>
                              <span className="mt-0.5 block text-sm">{item.material_name}</span>
                            </td>
                            <td className="px-3 py-2.5 tabular-nums">{item.requested_quantity}</td>
                            <td className="px-3 py-2.5 tabular-nums">{item.available_quantity}</td>
                            <td className="px-3 py-2.5 tabular-nums font-medium text-blue-800 dark:text-blue-300">{item.reserved_quantity}</td>
                            <td className="px-3 py-2.5 text-slate-500">{item.uom || ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {request.availability_message && (
                    <p className="text-xs text-muted-foreground">{request.availability_message}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    {canReview && (
                      <>
                        <Button
                          disabled={isBusy}
                          onClick={() =>
                            void runAction(
                              id,
                              () =>
                                request.legacy_material_request || approvalRequired
                                  ? api.approveAssemblyMaterialRequest(id)
                                  : api.reserveAssemblyRequisitionStock(id),
                              approvalRequired
                                ? "Material request approved"
                                : "Stock approved and request released for picking",
                            )
                          }
                        >
                          {isBusy && <Loader2 className="mr-2 size-4 animate-spin" />}
                          {approvalRequired ? "Approve Request" : "Approve &amp; Reserve Stock"}
                        </Button>
                        <Button
                          variant="outline"
                          disabled={isBusy}
                          onClick={() => {
                            const reason = window
                              .prompt("Reason for rejecting this requisition:")
                              ?.trim();
                            if (reason)
                              void runAction(
                                id,
                                () =>
                                  request.legacy_material_request || approvalRequired
                                    ? api.rejectAssemblyMaterialRequest(id, reason)
                                    : api.rejectAssemblyRequisition(id, reason),
                                "Requisition rejected",
                              );
                          }}
                        >
                          Reject
                        </Button>
                      </>
                    )}
                    {(hasReservation || request.assigned_warehouse_ref_id) &&
                      !["REJECTED", "ASSEMBLY_RECEIVED"].includes(status) && (
                        <>

                          <Button
                            variant="secondary"
                            disabled={isBusy || !selectedWarehouse}
                            onClick={() =>
                              void runAction(
                                id,
                                () => api.assignAssemblyRequisitionWarehouse(id, selectedWarehouse),
                                "Warehouse picking task created",
                              )
                            }
                          >
                            Create warehouse pick task
                          </Button>
                        </>
                      )}
                  </div>
                  {relatedPickupTasks.length > 0 && (
                    <div className="space-y-2 rounded-lg border border-indigo-200 bg-indigo-50/50 p-3 dark:border-indigo-900/60 dark:bg-indigo-950/20">
                      <p className="text-xs font-semibold text-indigo-950 dark:text-indigo-100">Related warehouse pickup</p>
                      {relatedPickupTasks.map((task) => (
                        <div key={task.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-white px-3 py-2 dark:bg-slate-900">
                          <div className="min-w-0 text-xs">
                            <span className="font-semibold">{task.task_number || "Pick task"}</span>
                            <span className="mx-2 text-muted-foreground">·</span>
                            <span>{task.material_name || task.material_code}</span>
                            <span className="mx-2 text-muted-foreground">·</span>
                            <span>{task.quantity ?? "—"} {task.uom || ""}</span>
                            <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-700 dark:bg-slate-800 dark:text-slate-200">{task.status || "PENDING"}</span>
                          </div>
                          {String(task.status || "").toUpperCase() === "COMPLETED" ? (
                            <span className="text-xs font-semibold text-emerald-700">Pickup confirmed</span>
                          ) : (
                            <Button size="sm" className="h-8" disabled={!onConfirmPick} onClick={() => onConfirmPick?.(task)}>Confirm pickup</Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
