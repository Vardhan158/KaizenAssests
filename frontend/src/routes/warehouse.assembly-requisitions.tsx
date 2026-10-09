import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/api-client";
import { requireRole } from "@/lib/auth-utils";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/warehouse/assembly-requisitions")({
  beforeLoad: () => requireRole(["WAREHOUSE", "WAREHOUSE_MANAGER", "ADMIN", "SUPERUSER"]),
  component: WarehouseAssemblyRequisitionsPage,
});

function WarehouseAssemblyRequisitionsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [stores, setStores] = useState<any[]>([]);
  const [storeChoice, setStoreChoice] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [requests, materialRequests, storeRows] = await Promise.all([
        api.getAssemblyRequisitions("Assembly"),
        api.getAssemblyMaterialRequests(),
        api.getStores(),
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
      setStores(Array.isArray(storeRows) ? storeRows.filter((store: any) => String(store.status).toUpperCase() === "ACTIVE") : []);
    } catch (error: any) {
      toast.error(error?.message || "Unable to load Assembly requisitions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const stop = api.subscribeNotifications("WAREHOUSE", () => void refresh());
    return stop;
  }, [refresh]);

  const runAction = async (id: string, action: () => Promise<unknown>, message: string) => {
    setBusyId(id);
    try {
      await action();
      toast.success(message);
      await refresh();
    } catch (error: any) {
      toast.error(error?.message || "Action failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AppShell title="Assembly Requisitions" subtitle="Review persisted material requests, reserve stock, and create store picking work.">
      <div className="mb-4 flex justify-end">
        <Button variant="outline" onClick={() => void refresh()}><RefreshCw className="mr-2 size-4" />Refresh</Button>
      </div>
      {loading ? <div className="grid min-h-64 place-items-center"><Loader2 className="size-6 animate-spin" /></div> : rows.length === 0 ? (
        <Card><CardContent className="p-10 text-center text-muted-foreground">No Assembly requisitions have been submitted.</CardContent></Card>
      ) : <div className="space-y-3">{rows.map((request) => {
        const id = String(request.id);
        const status = String(request.status || "").toUpperCase();
        const canReview = !request.legacy_material_request && ["PENDING", "SUBMITTED", "PARTIALLY_RESERVED"].includes(status);
        const hasReservation = (request.reservations || []).some((reservation: any) => Number(reservation.reserved_quantity) > 0);
        const selectedStore = storeChoice[id] || request.assigned_store_id || request.suggested_store_id || request.reservations?.find((r: any) => r.store_id)?.store_id || "";
        const isBusy = busyId === id;
        return <Card key={id}><CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="font-semibold">{request.requisition_number}</h2><p className="text-xs text-muted-foreground">{request.department} · Requested by {request.requested_by} · {request.required_date}</p></div>
            <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold">{status || ""}</span>
          </div>
          <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-xs text-muted-foreground"><th className="py-2">Material</th><th>Requested</th><th>Available</th><th>Reserved</th><th>Unit</th></tr></thead><tbody>
            {(request.items || []).map((item: any) => <tr key={item.id || item.material_code} className="border-b last:border-0"><td className="py-2">{item.material_code} · {item.material_name}</td><td>{item.requested_quantity}</td><td>{item.available_quantity}</td><td>{item.reserved_quantity}</td><td>{item.uom || ""}</td></tr>)}
          </tbody></table></div>
          {request.availability_message && <p className="text-xs text-muted-foreground">{request.availability_message}</p>}
          <div className="flex flex-wrap items-center gap-2">
            {canReview && <>
              <Button disabled={isBusy} onClick={() => void runAction(id, () => api.reserveAssemblyRequisitionStock(id), "Stock review saved")}>{isBusy && <Loader2 className="mr-2 size-4 animate-spin" />}Approve and reserve available stock</Button>
              <Button variant="outline" disabled={isBusy} onClick={() => {
                const reason = window.prompt("Reason for rejecting this requisition:")?.trim();
                if (reason) void runAction(id, () => api.rejectAssemblyRequisition(id, reason), "Requisition rejected");
              }}>Reject</Button>
            </>}
            {(hasReservation || request.assigned_store_id) && !["REJECTED", "ASSEMBLY_RECEIVED"].includes(status) && <>
              <select className="h-9 min-w-56 rounded-md border bg-background px-3 text-sm" value={selectedStore} onChange={(event) => setStoreChoice((current) => ({ ...current, [id]: event.target.value }))}>
                <option value="">Select fulfilling store</option>
                {stores.map((store: any) => <option key={store.id} value={store.id}>{store.store_code} · {store.store_name}</option>)}
              </select>
              <Button variant="secondary" disabled={isBusy || !selectedStore} onClick={() => void runAction(id, () => api.assignAssemblyRequisitionStore(id, selectedStore), "Store picking task created")}>Assign store and create pick task</Button>
            </>}
          </div>
        </CardContent></Card>;
      })}</div>}
    </AppShell>
  );
}
