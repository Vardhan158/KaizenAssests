import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RefreshCw, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api-client";

export const Route = createFileRoute("/dispatch-exceptions")({
  component: DispatchExceptionsPage,
});

function DispatchExceptionsPage() {
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<any[]>([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getDispatches();
      setOrders(res.items?.filter((o: any) => ["CANCELLED", "DELAYED", "RETURNED"].includes(o.status)) || res.items || []);
    } catch (e) {
      toast.error("Failed to load dispatch exceptions", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  const handleReturn = async (id: string) => {
    try {
      await api.returnDispatch(id);
      toast.success("Order return processed successfully");
      void loadData();
    } catch (err) {
      toast.error("Failed to process return", { description: err instanceof Error ? err.message : undefined });
    }
  };

  return (
    <AppShell
      title="Dispatch Exceptions & Returns"
      subtitle="Handle dispatch cancellations, delivery exceptions, customer returns, and inventory restocking"
      actions={
        <Button variant="outline" className="rounded-xl" onClick={() => void loadData()}>
          <RefreshCw className="size-4" /> Refresh
        </Button>
      }
    >
      {loading ? (
        <div className="grid h-64 place-items-center"><Loader2 className="size-8 animate-spin text-primary" /></div>
      ) : (
        <Card className="rounded-2xl overflow-hidden">
          <div className="p-4 border-b font-semibold">Exceptions & Returns Queue ({orders.length})</div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/50 text-[10px] uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Order #</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Destination</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {orders.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-8 text-muted-foreground">No dispatch exceptions or returns found.</td></tr>
                ) : (
                  orders.map((order) => (
                    <tr key={order.id} className="border-t">
                      <td className="px-4 py-3 font-bold">{order.order_number || order.id?.substring(0,8)}</td>
                      <td className="px-4 py-3">{order.customer_name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{order.destination}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-lg bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-600">
                          {order.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" variant="outline" className="rounded-lg text-xs" onClick={() => void handleReturn(order.id)}>
                          <RotateCcw className="size-3.5 mr-1.5" /> Process Return
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </AppShell>
  );
}
