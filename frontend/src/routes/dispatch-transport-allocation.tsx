import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  UserCheck,
  Truck,
  RefreshCw,
  Loader2,
  ShieldCheck,
  User,
  Phone,
  CheckCircle2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell, StatusBadge } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api-client";
import { DeleteConfirmationDialog } from "@/components/wms/delete-confirmation-dialog";

export const Route = createFileRoute("/dispatch-transport-allocation")({
  component: DispatchTransportAllocationPage,
});

function DispatchTransportAllocationPage() {
  const [loading, setLoading] = useState(true);
  const [dispatches, setDispatches] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);

  const [selectedDispatchId, setSelectedDispatchId] = useState<string>("");
  const [selectedDriverId, setSelectedDriverId] = useState<string>("");
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    type: "driver" | "vehicle";
    item: any;
  } | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [dispatchRes, driverRes, vehicleRes] = await Promise.all([
        api.getDispatches(),
        api.getDrivers(),
        api.getVehicles(),
      ]);
      setDispatches(dispatchRes.items || []);

      if (driverRes) {
        setDrivers(
          driverRes.map((d: any) => ({
            ...d,
            driver_name: d.driver_name || d.name,
            phone: d.phone,
            status: d.status,
            is_active: d.is_active,
            license_type: d.license_type,
          })),
        );
      }

      if (vehicleRes) {
        setVehicles(
          vehicleRes.map((v: any) => ({
            ...v,
            vehicle_number: v.vehicle_number || v.number,
            vehicle_type: v.vehicle_type,
            capacity_tons: Number(v.capacity_tons),
            status: v.status,
            is_active: v.is_active,
          })),
        );
      }
    } catch (e) {
      toast.error("Failed to load transport allocation data", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleDeleteDriver = async (driver: any) => {
    if (!driver.id) return;
    try {
      await api.deleteDriver(driver.id);
      setDrivers((current) => current.filter((item) => item.id !== driver.id));
      if (selectedDriverId === driver.id) setSelectedDriverId("");
      toast.success("Driver deleted successfully");
      window.location.reload();
    } catch (err) {
      toast.error("Failed to delete driver", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const handleDeleteVehicle = async (vehicle: any) => {
    if (!vehicle.id) return;
    try {
      await api.deleteVehicle(vehicle.id);
      setVehicles((current) => current.filter((item) => item.id !== vehicle.id));
      if (selectedVehicleId === vehicle.id) setSelectedVehicleId("");
      toast.success("Vehicle deleted successfully");
      window.location.reload();
    } catch (err) {
      toast.error("Failed to delete vehicle", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const selectedDispatch = dispatches.find((d) => d.id === selectedDispatchId);
  const assignedDriver = drivers.find(
    (d) => d.id === selectedDispatch?.driver_id || d.id === selectedDriverId,
  );
  const assignedVehicle = vehicles.find(
    (v) => v.id === selectedDispatch?.vehicle_id || v.id === selectedVehicleId,
  );

  const calculateDispatchTons = (dispatch: any) => {
    if (!dispatch?.items) return 0;
    const totalQty = dispatch.items.reduce(
      (acc: number, item: any) => acc + (item.quantity_ordered || item.quantity || 0),
      0,
    );
    return Math.max(0.5, Number((totalQty / 100).toFixed(2)));
  };

  const dispatchTons = selectedDispatch ? calculateDispatchTons(selectedDispatch) : 0;

  const eligibleDrivers = drivers.filter((drv) => {
    const isActive = drv.is_active !== false;
    const isAvailable = String(drv.status || "").toUpperCase() === "AVAILABLE";
    const hasValidLicense = Boolean(drv.license_number);
    return isActive && isAvailable && hasValidLicense;
  });

  const eligibleVehicles = vehicles.filter((veh) => {
    const isActive = veh.is_active !== false;
    const isAvailable = String(veh.status || "").toUpperCase() === "AVAILABLE";
    const hasSufficientCapacity = Number(veh.capacity_tons) >= dispatchTons;
    return isActive && isAvailable && hasSufficientCapacity;
  });

  const handleAllocateBoth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDispatchId) {
      toast.error("Validation Error", { description: "Please select a dispatch order." });
      return;
    }
    if (!selectedDriverId && !selectedVehicleId) {
      toast.error("Validation Error", {
        description: "Please select at least a driver or vehicle to allocate.",
      });
      return;
    }

    setSubmitting(true);
    try {
      if (selectedDriverId) {
        await api.allocateDispatchDriver(selectedDispatchId, selectedDriverId);
      }
      if (selectedVehicleId) {
        await api.allocateDispatchVehicle(selectedDispatchId, selectedVehicleId);
      }
      toast.success("Transport Allocation Successful!", {
        description: `Dispatch ${selectedDispatch?.dispatch_number} updated: Driver Assigned & Vehicle Assigned from Master.`,
      });
      setSelectedDriverId("");
      setSelectedVehicleId("");
      void loadData();
    } catch (err) {
      toast.error("Transport allocation failed", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppShell
      title="Transport Allocation (Driver & Vehicle)"
      subtitle="Unified transport coordinator portal pulling live master data from Driver and Vehicle modules"
      actions={
        <Button variant="outline" className="rounded-xl" onClick={() => void loadData()}>
          <RefreshCw className="size-4 mr-2" /> Refresh
        </Button>
      }
    >
      {loading ? (
        <div className="grid h-64 place-items-center">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Top: Select Dispatch Order */}
          <Card className="rounded-2xl p-6 shadow-sm border-border/80 bg-card">
            <h3 className="text-base font-bold mb-3">1. Select Outbound Dispatch Order</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
              <div>
                <Label className="text-xs font-semibold uppercase text-muted-foreground">
                  Select Dispatch *
                </Label>
                <select
                  value={selectedDispatchId}
                  onChange={(e) => {
                    setSelectedDispatchId(e.target.value);
                    setSelectedDriverId("");
                    setSelectedVehicleId("");
                  }}
                  className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm shadow-sm focus:ring-2 focus:ring-primary font-bold text-primary"
                >
                  <option value="">-- Choose Dispatch Order --</option>
                  {dispatches.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.dispatch_number} - {d.customer_name} ({d.status})
                    </option>
                  ))}
                </select>
              </div>

              {selectedDispatch && (
                <div className="p-3 rounded-xl bg-muted/40 border text-xs flex items-center justify-between">
                  <div>
                    <span className="text-muted-foreground block">Customer & Destination:</span>
                    <strong className="text-foreground">
                      {selectedDispatch.customer_name || "—"} →{" "}
                      {selectedDispatch.destination || "—"}
                    </strong>
                  </div>
                  <div>
                    <span className="text-muted-foreground block">Required Tonnage:</span>
                    <strong className="text-amber-600 font-mono">{dispatchTons} Tons</strong>
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* Allocation Action & Live Summary Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="rounded-2xl p-6 shadow-sm border-border/80">
              <h3 className="text-base font-bold mb-4">2. Allocate Driver & Vehicle from Master</h3>
              <form onSubmit={handleAllocateBoth} className="space-y-4">
                <div>
                  <Label className="text-xs font-semibold uppercase text-muted-foreground">
                    Select Master Driver
                  </Label>
                  <select
                    value={selectedDriverId}
                    onChange={(e) => setSelectedDriverId(e.target.value)}
                    disabled={!selectedDispatchId}
                    className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2 text-xs shadow-sm focus:ring-2 focus:ring-primary font-semibold disabled:opacity-50"
                  >
                    <option value="">-- Choose Driver --</option>
                    {eligibleDrivers.map((drv) => (
                      <option key={drv.id} value={drv.id}>
                        {drv.driver_name || drv.name} (Mobile: {drv.phone || "—"})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <Label className="text-xs font-semibold uppercase text-muted-foreground">
                    Select Master Vehicle
                  </Label>
                  <select
                    value={selectedVehicleId}
                    onChange={(e) => setSelectedVehicleId(e.target.value)}
                    disabled={!selectedDispatchId}
                    className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2 text-xs shadow-sm focus:ring-2 focus:ring-primary font-semibold disabled:opacity-50"
                  >
                    <option value="">-- Choose Vehicle --</option>
                    {eligibleVehicles.map((veh) => (
                      <option key={veh.id} value={veh.id}>
                        {veh.vehicle_number} - {veh.vehicle_type} ({veh.capacity_tons} Tons)
                      </option>
                    ))}
                  </select>
                </div>

                <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-xs text-emerald-800 space-y-1">
                  <p className="font-bold flex items-center gap-1">
                    <ShieldCheck className="size-4" /> Master Data Integration:
                  </p>
                  <p className="text-[11px] font-semibold text-foreground">
                    Vehicles and drivers are pulled live from Vehicle & Driver Master.
                  </p>
                </div>

                <Button
                  type="submit"
                  disabled={
                    submitting || !selectedDispatchId || (!selectedDriverId && !selectedVehicleId)
                  }
                  className="w-full rounded-xl py-6 font-bold shadow-glow"
                >
                  {submitting ? (
                    <Loader2 className="size-4 animate-spin mr-2" />
                  ) : (
                    <UserCheck className="size-4 mr-2" />
                  )}
                  Confirm Master Transport Allocation
                </Button>
              </form>
            </Card>

            {/* Combined Live Summary Card matching exact user specification */}
            <Card className="rounded-2xl p-6 shadow-sm border-border/80 bg-card/60">
              <h3 className="text-base font-bold mb-3 uppercase tracking-wider text-primary">
                Live Transport Summary
              </h3>
              {selectedDispatch ? (
                <div className="space-y-4 text-sm">
                  <div className="p-3 rounded-xl bg-primary/5 border border-primary/20 font-mono font-bold text-base text-primary flex items-center justify-between">
                    <span>{selectedDispatch.dispatch_number || "—"}</span>
                    <StatusBadge status={selectedDispatch.status} />
                  </div>

                  <div className="space-y-2 border-t pt-3">
                    <div className="text-xs font-bold uppercase text-muted-foreground tracking-wider">
                      Vehicle Details (From Master)
                    </div>
                    <div className="p-3 rounded-xl bg-muted/40 border space-y-1 font-mono text-xs">
                      <div>
                        Vehicle:{" "}
                        <strong className="text-primary font-bold text-sm">
                          {assignedVehicle?.vehicle_number || "Not assigned"}
                        </strong>
                      </div>
                      <div>
                        Vehicle Type: <strong>{assignedVehicle?.vehicle_type || "—"}</strong>
                      </div>
                      <div>
                        Capacity:{" "}
                        <strong className="text-amber-600">
                          {assignedVehicle?.capacity_tons
                            ? `${assignedVehicle.capacity_tons} Tons`
                            : "—"}
                        </strong>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2 border-t pt-3">
                    <div className="text-xs font-bold uppercase text-muted-foreground tracking-wider">
                      Driver Details (From Master)
                    </div>
                    <div className="p-3 rounded-xl bg-muted/40 border space-y-1 text-xs">
                      <div>
                        Driver:{" "}
                        <strong className="text-foreground font-bold text-sm">
                          {assignedDriver?.driver_name || assignedDriver?.name || "Not assigned"}
                        </strong>
                      </div>
                      <div>
                        Mobile:{" "}
                        <span className="font-mono text-primary font-bold">
                          {assignedDriver?.phone || "—"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="border-t pt-3 text-xs">
                    <span className="text-muted-foreground uppercase font-bold block">
                      Route & Delivery:
                    </span>
                    <span className="font-mono font-bold text-foreground">
                      {selectedDispatch.origin || "—"} → {selectedDispatch.destination || "—"}
                      {selectedDispatch.expected_delivery_date
                        ? ` (Expected: ${selectedDispatch.expected_delivery_date})`
                        : ""}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="text-center py-16 text-muted-foreground text-xs">
                  Select a dispatch order above to view the live transport summary card.
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
      <DeleteConfirmationDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        itemLabel={
          deleteTarget?.type === "driver"
            ? `driver "${deleteTarget.item.driver_name || deleteTarget.item.name}"`
            : `vehicle "${deleteTarget?.item.vehicle_number}"`
        }
        onConfirm={() => {
          const target = deleteTarget;
          setDeleteTarget(null);
          if (target?.type === "driver") void handleDeleteDriver(target.item);
          if (target?.type === "vehicle") void handleDeleteVehicle(target.item);
        }}
      />
    </AppShell>
  );
}
