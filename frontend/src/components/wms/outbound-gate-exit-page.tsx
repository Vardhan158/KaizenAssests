import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, ShieldCheck, Truck, XCircle } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api-client";

export function OutboundGateExitPage({ title = "Gate Exit", subtitle = "Verify outbound vehicles and authorize dispatch exit" }: { title?: string; subtitle?: string }) {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // The queue itself is the source of truth. Auxiliary master-data calls
      // must not prevent persisted ready dispatches from appearing.
      const readyOrders = await api.getDispatchesReadyForGateExit();
      const [driversResult, vehiclesResult] = await Promise.allSettled([
        api.getDrivers(),
        api.getVehicles(),
      ]);
      const drivers = driversResult.status === "fulfilled" ? driversResult.value : [];
      const vehicles = vehiclesResult.status === "fulfilled" ? vehiclesResult.value : [];
      const driverById = new Map((drivers || []).map((driver: any) => [String(driver.id), driver]));
      const vehicleById = new Map((vehicles || []).map((vehicle: any) => [String(vehicle.id), vehicle]));
      setOrders((readyOrders || []).map((order: any) => ({
        ...order,
        driver_name: order.driver_name || driverById.get(String(order.driver_id))?.driver_name,
        vehicle_number: order.vehicle_number || vehicleById.get(String(order.vehicle_id))?.vehicle_number,
      })));
    }
    catch (error) { toast.error("Unable to load gate exit queue", { description: error instanceof Error ? error.message : undefined }); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const approve = async (order: any) => {
    setBusy(order.id);
    try {
      await api.confirmOutboundGateExit(order.id, { vehicle_verified: true, driver_verified: true, remarks: remarks[order.id] });
      toast.success(`Gate exit approved for ${order.dispatch_number || order.order_number || "dispatch"}`);
      await load();
    } catch (error) { toast.error("Gate exit approval failed", { description: error instanceof Error ? error.message : undefined }); }
    finally { setBusy(null); }
  };

  return <AppShell title={title} subtitle={subtitle} actions={<Button variant="outline" className="rounded-xl" onClick={() => void load()}><RefreshCw className="size-4 mr-2" />Refresh</Button>}>
    <div className="grid gap-4 sm:grid-cols-3 mb-6">
      <Card className="rounded-2xl p-5"><p className="text-xs uppercase font-bold text-muted-foreground">Ready for verification</p><p className="text-3xl font-bold mt-2">{orders.length}</p></Card>
      <Card className="rounded-2xl p-5"><p className="text-xs uppercase font-bold text-muted-foreground">Control point</p><p className="text-lg font-bold mt-2 flex items-center gap-2"><ShieldCheck className="size-5 text-emerald-600" />Outbound Gate</p></Card>
      <Card className="rounded-2xl p-5"><p className="text-xs uppercase font-bold text-muted-foreground">Verification rule</p><p className="text-sm font-semibold mt-2">Vehicle + driver must match allocation</p></Card>
    </div>
    <Card className="rounded-2xl overflow-hidden">
      <div className="p-4 border-b flex items-center justify-between"><div><h2 className="font-bold">Outbound Gate Queue</h2><p className="text-xs text-muted-foreground mt-1">Only loaded dispatches appear here.</p></div><Truck className="size-5 text-primary" /></div>
      {loading ? <div className="grid h-56 place-items-center"><Loader2 className="size-8 animate-spin text-primary" /></div> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-muted/50 text-[10px] uppercase text-muted-foreground font-bold"><tr><th className="px-4 py-3">Dispatch / Order</th><th className="px-4 py-3">Customer & Destination</th><th className="px-4 py-3">Vehicle / Driver</th><th className="px-4 py-3">Gate remarks</th><th className="px-4 py-3 text-right">Action</th></tr></thead><tbody>{orders.length === 0 ? <tr><td colSpan={5} className="py-12 text-center text-muted-foreground">No dispatches are waiting for gate exit.</td></tr> : orders.map((order) => <tr key={order.id} className="border-t"><td className="px-4 py-4"><p className="font-bold text-primary font-mono">{order.dispatch_number || order.id?.slice(0, 8)}</p><p className="text-xs text-muted-foreground">SO: {order.order_number || "—"}</p></td><td className="px-4 py-4"><p className="font-semibold">{order.customer_name || "—"}</p><p className="text-xs text-muted-foreground">{order.destination || order.delivery_address || "—"}</p></td><td className="px-4 py-4 text-xs"><p className="font-semibold">{order.vehicle_number || order.vehicle?.vehicle_number || order.vehicle_id || "—"}</p><p className="text-muted-foreground">{order.driver_name || order.driver?.name || order.driver_id || "—"}</p></td><td className="px-4 py-4"><Input value={remarks[order.id] || ""} onChange={(e) => setRemarks((current) => ({ ...current, [order.id]: e.target.value }))} placeholder="Optional note" className="h-9 rounded-lg text-xs min-w-40" /></td><td className="px-4 py-4 text-right"><Button className="rounded-lg text-xs" disabled={busy === order.id} onClick={() => void approve(order)}>{busy === order.id ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <CheckCircle2 className="size-3.5 mr-1.5" />}Approve Exit</Button></td></tr>)}</tbody></table></div>}
    </Card>
  </AppShell>;
}
