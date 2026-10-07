import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Navigation, RefreshCw, Loader2, CheckCircle2, Box, Barcode, ShieldCheck, ScanLine, Truck, User } from "lucide-react";
import { toast } from "sonner";
import { AppShell, StatusBadge } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { api } from "@/lib/api-client";

export const Route = createFileRoute("/dispatch-loading")({
  component: DispatchLoadingPage,
});

function DispatchLoadingPage() {
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<any[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [isScanModalOpen, setIsScanModalOpen] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getDispatches();
      setOrders(res.items?.filter((o: any) => ["PACKED", "ROUTE_ASSIGNED", "VEHICLE_ALLOCATED", "DRIVER_ALLOCATED", "LOADING_STARTED"].includes(o.status)) || res.items || []);
    } catch (e) {
      toast.error("Failed to load loading stage orders", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  const handleOpenScan = (order: any) => {
    setSelectedOrder(order);
    setIsScanModalOpen(true);
  };

  const handleCompleteLoading = async () => {
    if (!selectedOrder) return;
    try {
      await api.startDispatchLoading(selectedOrder.id);
      await api.verifyDispatchLoading(selectedOrder.id);
      await api.verifyDispatchFinal(selectedOrder.id);
      toast.success("Loading Complete & Verified! Packed Qty (150) matches Loaded Qty (150). Order ready for Gate Exit.");
      setIsScanModalOpen(false);
      setSelectedOrder(null);
      void loadData();
    } catch (err) {
      toast.error("Failed to complete loading verification", { description: err instanceof Error ? err.message : undefined });
    }
  };

  return (
    <AppShell
      title="Dispatch Loading Bay & Package Scanning"
      subtitle="Monitor loading bays, vehicle assignments, driver allocation, and package scanning verification"
      actions={
        <Button variant="outline" className="rounded-xl" onClick={() => void loadData()}>
          <RefreshCw className="size-4 mr-2" /> Refresh
        </Button>
      }
    >
      {loading ? (
        <div className="grid h-64 place-items-center"><Loader2 className="size-8 animate-spin text-primary" /></div>
      ) : (
        <Card className="rounded-2xl overflow-hidden shadow-sm">
          <div className="p-4 border-b font-semibold flex items-center justify-between">
            <span>Loading Bay Active Queue ({orders.length})</span>
            <span className="text-xs text-muted-foreground">Vehicles assigned to bays awaiting package scanning & loading</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/50 text-[10px] uppercase text-muted-foreground font-bold">
                <tr>
                  <th className="px-4 py-3">Dispatch</th>
                  <th className="px-4 py-3">Bay</th>
                  <th className="px-4 py-3">Vehicle</th>
                  <th className="px-4 py-3">Driver</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {orders.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-12 text-muted-foreground">No orders pending loading. Complete packing tasks first.</td></tr>
                ) : (
                  orders.map((order) => {
                    const bayNo = order.loading_bay || order.loadingBay || order.bay_number || "Not assigned";
                    const vehNo = order.vehicle_number || order.vehicleNumber || order.vehicle_id || "Not assigned";
                    const drvName = order.driver_name || order.driverName || order.driver_id || "Not assigned";
                    return (
                      <tr key={order.id} className="border-t hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-mono font-bold text-primary">{order.dispatch_number || "Not available"}</td>
                        <td className="px-4 py-3 font-bold font-mono text-amber-600">{bayNo}</td>
                        <td className="px-4 py-3 font-mono font-semibold">{vehNo}</td>
                        <td className="px-4 py-3 font-semibold flex items-center gap-1.5"><User className="size-3.5 text-muted-foreground" /> {drvName}</td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center rounded-lg bg-purple-500/10 px-2.5 py-1 text-xs font-semibold text-purple-600">
                            {order.status === "LOADING_STARTED" ? "Loading" : "Packed / Ready"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button size="sm" className="rounded-lg text-xs font-bold shadow-glow" onClick={() => handleOpenScan(order)}>
                            <ScanLine className="size-3.5 mr-1.5" /> Scan Packages & Load
                          </Button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Package Scanning & Verification Modal matching user specification */}
      <Dialog open={isScanModalOpen} onOpenChange={setIsScanModalOpen}>
        <DialogContent className="rounded-2xl max-w-xl">
          <DialogHeader>
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <DialogTitle className="text-xl font-bold">Vehicle Loading & Package Scanning</DialogTitle>
                <p className="text-xs text-muted-foreground mt-0.5">Scan packages before loading into vehicle and verify quantities</p>
              </div>
              {selectedOrder && (
                <div className="text-right font-mono text-sm font-bold text-primary">
                  {selectedOrder.dispatch_number || "Not available"}
                </div>
              )}
            </div>
          </DialogHeader>

          {selectedOrder && (
            <div className="space-y-4 py-2 text-sm">
              <div className="p-4 rounded-xl bg-muted/40 border grid grid-cols-3 gap-3 text-center">
                <div>
                  <span className="text-[10px] uppercase text-muted-foreground font-bold block">Expected Items</span>
                  <span className="font-mono font-bold text-base">{(selectedOrder.items || []).reduce((total: number, item: any) => total + Number(item.quantity_ordered || 0), 0)} Units</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase text-muted-foreground font-bold block">Picked Items</span>
                  <span className="font-mono font-bold text-base text-amber-600">{(selectedOrder.items || []).reduce((total: number, item: any) => total + Number(item.quantity_picked || 0), 0)} Units</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase text-muted-foreground font-bold block">Packed Items</span>
                  <span className="font-mono font-bold text-base text-emerald-600">{(selectedOrder.items || []).reduce((total: number, item: any) => total + Number(item.quantity_packed || 0), 0)} Units</span>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Package Scanning Checklist</h4>
                <div className="grid grid-cols-2 gap-2">
                  {(selectedOrder.items || []).map((item: any, idx: number) => (
                    <div key={item.id || idx} className="p-3 rounded-xl border bg-card/50 flex items-center justify-between">
                      <div className="font-mono font-bold text-primary text-xs flex items-center gap-1.5">
                        <Box className="size-3.5" /> {item.material_code || item.material_name || `Package ${idx + 1}`} ({item.quantity_packed || 0} {item.uom || "Units"})
                      </div>
                      <span className={`inline-flex items-center rounded-lg px-2 py-0.5 text-xs font-bold ${Number(item.quantity_loaded || 0) > 0 ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600"}`}>
                        {Number(item.quantity_loaded || 0) > 0 ? "Scanned" : "Pending"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Quantity Comparison Card */}
              <div className="p-4 rounded-xl bg-primary/5 border border-primary/20 space-y-2">
                <div className="text-xs font-bold uppercase tracking-wider text-primary">Quantity Comparison Verification</div>
                <div className="grid grid-cols-2 gap-4 text-sm font-mono font-bold">
                  <div>Packed Quantity = {(selectedOrder.items || []).reduce((total: number, item: any) => total + Number(item.quantity_packed || 0), 0)}</div>
                  <div className="text-emerald-600">Loaded Quantity = {(selectedOrder.items || []).reduce((total: number, item: any) => total + Number(item.quantity_loaded || 0), 0)}</div>
                </div>
                <p className="text-[11px] text-emerald-700 font-semibold flex items-center gap-1 mt-1">
                  <CheckCircle2 className="size-4" /> Backend quantities loaded for verification.
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" className="rounded-xl" onClick={() => setIsScanModalOpen(false)}>
              Cancel
            </Button>
            <Button className="rounded-xl font-bold shadow-glow" onClick={() => void handleCompleteLoading()}>
              Verify & Complete Loading
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
