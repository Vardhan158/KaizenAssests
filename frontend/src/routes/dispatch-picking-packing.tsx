import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Package, Box, RefreshCw, Loader2, CheckCircle2, ScanLine, ArrowRight, UserCheck, Truck, Navigation } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api-client";

export const Route = createFileRoute("/dispatch-picking-packing")({
  component: DispatchPickingPackingPage,
});

function DispatchPickingPackingPage() {
  const [loading, setLoading] = useState(true);
  const [dispatches, setDispatches] = useState<any[]>([]);
  const [selectedDispatchId, setSelectedDispatchId] = useState<string>("");
  const [selectedDispatch, setSelectedDispatch] = useState<any | null>(null);
  const [workflowCompleted, setWorkflowCompleted] = useState(false);

  // Packing Form State matching wireframe
  const [submitting, setSubmitting] = useState(false);
  const isWorkflowCompleted = ["PACKED", "DISPATCH_READY", "DRIVER_ALLOCATED", "VEHICLE_ALLOCATED", "LOADING", "LOADED", "READY_FOR_GATE_EXIT", "DISPATCHED", "IN_TRANSIT", "DELIVERED", "CLOSED"].includes(String(selectedDispatch?.status || "").toUpperCase());

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getDispatches();
      const items = res.items || [];
      setDispatches(items);
      if (items.length > 0 && !selectedDispatchId) {
        setSelectedDispatchId(items[0].id);
        setSelectedDispatch(items[0]);
        setWorkflowCompleted(["PACKED", "DISPATCH_READY", "DRIVER_ALLOCATED", "VEHICLE_ALLOCATED", "LOADING", "LOADED", "READY_FOR_GATE_EXIT", "DISPATCHED", "IN_TRANSIT", "DELIVERED", "CLOSED"].includes(String(items[0].status || "").toUpperCase()));
      }
    } catch (e) {
      toast.error("Failed to load dispatches", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setLoading(false);
    }
  }, [selectedDispatchId]);

  useEffect(() => { void loadData(); }, [loadData]);

  const handleSelectDispatch = (id: string) => {
    setSelectedDispatchId(id);
    const found = dispatches.find(d => d.id === id);
    setSelectedDispatch(found || null);
    setWorkflowCompleted(["PACKED", "DISPATCH_READY", "DRIVER_ALLOCATED", "VEHICLE_ALLOCATED", "LOADING", "LOADED", "READY_FOR_GATE_EXIT", "DISPATCHED", "IN_TRANSIT", "DELIVERED", "CLOSED"].includes(String(found?.status || "").toUpperCase()));
  };

  const handleCompleteWorkflow = async () => {
    if (!selectedDispatch) {
      toast.error("Please select a dispatch order");
      return;
    }
    if (isWorkflowCompleted) {
      setWorkflowCompleted(true);
      toast.info("Workflow already completed", { description: `Dispatch ${selectedDispatch.dispatch_number} is already ${selectedDispatch.status}.` });
      return;
    }
    setSubmitting(true);
    try {
      const items = (selectedDispatch.items || []).map((i: any) => ({
        id: i.id,
        material_code: i.material_code,
        quantity_picked: Number(i.quantity_reserved ?? i.quantity_ordered ?? 0),
        quantity_packed: Number(i.quantity_reserved ?? i.quantity_ordered ?? 0)
      }));
      if (!items.length) throw new Error("This dispatch has no items to pick or pack");
      if (selectedDispatch.status === "STOCK_RESERVED") await api.startDispatchPicking(selectedDispatch.id);
      else if (selectedDispatch.status !== "PICKING_IN_PROGRESS") throw new Error(`Dispatch must be stock reserved before picking (current status: ${selectedDispatch.status})`);
      await api.pickDispatchItems(selectedDispatch.id, items);
      await api.startDispatchPacking(selectedDispatch.id);
      await api.packDispatchItems(selectedDispatch.id, items);

      setWorkflowCompleted(true);
      toast.success("Picking & Packing Completed!", {
        description: `Dispatch ${selectedDispatch.dispatch_number} successfully moved to Packed / Dispatch Ready.`
      });
      void loadData();
    } catch (err) {
      toast.error("Failed to complete workflow", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setSubmitting(false);
    }
  };

  const productRows = selectedDispatch?.items || [];

  const totalItems = productRows.reduce((acc: number, i: any) => acc + Number(i.quantity_ordered ?? i.quantity ?? 0), 0);

  return (
    <AppShell
      title="Picking & Packing"
      subtitle="Integrated warehouse execution screen for product picking, barcode scan verification, and cartonization"
      actions={
        <Button variant="outline" className="rounded-xl" onClick={() => void loadData()}>
          <RefreshCw className="size-4 mr-2" /> Refresh
        </Button>
      }
    >
      {loading ? (
        <div className="grid h-64 place-items-center"><Loader2 className="size-8 animate-spin text-primary" /></div>
      ) : (
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Main Card matching wireframe */}
          <Card className="rounded-2xl p-6 shadow-sm border-border/80 bg-card space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-4">
              <div className="flex items-center gap-3">
                <div className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
                  <Package className="size-6" />
                </div>
                <div>
                  <h2 className="text-lg font-bold tracking-tight">PICKING & PACKING</h2>
                  <p className="text-xs text-muted-foreground font-mono">Unified Execution Terminal</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Label className="text-xs font-bold uppercase text-muted-foreground">Select Dispatch:</Label>
                <select
                  value={selectedDispatchId}
                  onChange={(e) => handleSelectDispatch(e.target.value)}
                  className="rounded-xl border border-input bg-background px-3 py-2 text-xs font-bold shadow-sm focus:ring-2 focus:ring-primary text-primary font-mono"
                >
                  <option value="">-- Choose Dispatch --</option>
                  {dispatches.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.dispatch_number} - {d.customer_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {selectedDispatch && (
              <div className="p-3 rounded-xl bg-muted/30 border font-mono text-xs font-bold text-primary flex items-center justify-between">
                <span>Dispatch No: {selectedDispatch.dispatch_number} | Customer: {selectedDispatch.customer_name}</span>
                <span className="text-muted-foreground">Status: {selectedDispatch.status}</span>
              </div>
            )}

            {workflowCompleted && (
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 space-y-3">
                <div className="flex items-center gap-2 text-emerald-700 font-bold text-sm">
                  <CheckCircle2 className="size-5" /> Picking & Packing Completed Successfully!
                </div>
                <p className="text-xs text-muted-foreground">
                  The order is now Packed and Ready for Transport Allocation and Loading. Proceed to the next workflow steps below:
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Link to="/dispatch-transport-allocation">
                    <Button size="sm" className="rounded-xl text-xs font-bold">
                      <UserCheck className="size-3.5 mr-1.5" /> Go to Driver Allocation <ArrowRight className="size-3.5 ml-1.5" />
                    </Button>
                  </Link>
                  <Link to="/dispatch-transport-allocation">
                    <Button size="sm" variant="outline" className="rounded-xl text-xs font-bold">
                      <Truck className="size-3.5 mr-1.5" /> Go to Vehicle Allocation <ArrowRight className="size-3.5 ml-1.5" />
                    </Button>
                  </Link>
                  <Link to="/dispatch-loading">
                    <Button size="sm" variant="outline" className="rounded-xl text-xs font-bold">
                      <Navigation className="size-3.5 mr-1.5" /> Go to Loading Stage <ArrowRight className="size-3.5 ml-1.5" />
                    </Button>
                  </Link>
                </div>
              </div>
            )}

            {/* 1. PRODUCT TABLE SECTION */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Product Verification</h3>
              <div className="border rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/50 uppercase text-[10px] text-muted-foreground font-bold">
                    <tr>
                      <th className="px-4 py-2.5">Product</th>
                      <th className="px-4 py-2.5 text-right">Required</th>
                      <th className="px-4 py-2.5 text-right">Picked</th>
                      <th className="px-4 py-2.5 text-right">Packed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productRows.map((item: any, idx: number) => (
                      <tr key={idx} className="border-t font-medium">
                        <td className="px-4 py-3 font-semibold text-foreground">{item.material_name || item.material_code || "—"}</td>
                        <td className="px-4 py-3 text-right font-mono">{item.quantity_ordered ?? 0}</td>
                        <td className="px-4 py-3 text-right font-mono text-amber-600 font-bold">{item.quantity_picked ?? 0}</td>
                        <td className="px-4 py-3 text-right font-mono text-emerald-600 font-bold">{item.quantity_packed ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 2. PICKING SECTION */}
            <div className="p-4 rounded-xl border bg-muted/20 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                <ScanLine className="size-4" /> Picking Execution
              </h3>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs text-muted-foreground">Picking is confirmed through the backend workflow.</span>
                <span className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-600">
                  {selectedDispatch?.status || "No dispatch selected"}
                </span>
              </div>
            </div>

            {/* 3. PACKING SECTION */}
            <div className="p-4 rounded-xl border bg-muted/20 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                <Box className="size-4" /> Packing & Cartonization
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <Label className="text-[10px] font-bold uppercase text-muted-foreground">Package No</Label>
                  <Input value={selectedDispatch?.dispatch_number || ""} readOnly className="mt-1 rounded-xl text-xs font-mono font-bold" />
                </div>
                <div>
                  <Label className="text-[10px] font-bold uppercase text-muted-foreground">Package Type</Label>
                  <Input value="" readOnly placeholder="Not returned by backend" className="mt-1 rounded-xl text-xs font-semibold" />
                </div>
                <div>
                  <Label className="text-[10px] font-bold uppercase text-muted-foreground">Weight</Label>
                  <Input value="" readOnly placeholder="Provided by packing backend" className="mt-1 rounded-xl text-xs font-bold" />
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <span className="text-xs text-muted-foreground">Package details are read from the dispatch backend.</span>
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-600">
                  {selectedDispatch?.status || "No dispatch selected"}
                </span>
              </div>
            </div>

            {/* Summary & Footer Actions */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-4 border-t">
              <div className="flex items-center gap-6 text-xs font-mono font-bold">
                <div>Total Items: <span className="text-primary text-base">{totalItems}</span></div>
                <div>Total Packages: <span className="text-purple-600 text-base">—</span></div>
              </div>
              <div className="flex items-center gap-3">
                <Button type="button" disabled={submitting || !selectedDispatch || isWorkflowCompleted} className="rounded-xl text-xs font-bold px-6 shadow-glow" onClick={() => void handleCompleteWorkflow()}>
                  {submitting ? <Loader2 className="size-4 animate-spin mr-2" /> : <CheckCircle2 className="size-4 mr-2" />}
                  Complete Workflow
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </AppShell>
  );
}
