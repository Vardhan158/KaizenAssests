import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Truck, Plus, RefreshCw, Loader2, Weight, ShieldCheck, Pencil, Trash2, Calendar, FileText, Upload } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api-client";
import { DeleteConfirmationDialog } from "@/components/wms/delete-confirmation-dialog";

export const Route = createFileRoute("/dispatch-vehicles")({
  component: DispatchVehiclesPage,
});

function DispatchVehiclesPage() {
  const [loading, setLoading] = useState(true);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [newVehicle, setNewVehicle] = useState({
    vehicle_number: "",
    vehicle_type: "Truck",
    ownership_type: "Owned",
    capacity_tons: 10,
    rc_number: "",
    chassis_number: "",
    insurance_valid: true,
    insurance_doc: "",
    fitness_valid: true,
    fitness_doc: "",
    permit_valid: true,
    permit_doc: "",
    gps_available: true,
    is_active: true
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getVehicles();
      setVehicles(res || []);
    } catch (e) {
      toast.error("Failed to load vehicle fleet", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingId) {
        await api.updateVehicle(editingId, newVehicle);
        toast.success("Vehicle updated successfully");
      } else {
        await api.createVehicle(newVehicle);
        toast.success("Vehicle registered successfully", { description: `${newVehicle.vehicle_number} (${newVehicle.capacity_tons}T)` });
      }
      setIsOpen(false);
      setEditingId(null);
      setNewVehicle({
        vehicle_number: "",
        vehicle_type: "Truck",
        ownership_type: "Owned",
        capacity_tons: 10,
        rc_number: "",
        chassis_number: "",
        insurance_valid: true,
        insurance_doc: "",
        fitness_valid: true,
        fitness_doc: "",
        permit_valid: true,
        permit_doc: "",
        gps_available: true,
        is_active: true
      });
      void loadData();
    } catch (err) {
      toast.error("Failed to save vehicle", { description: err instanceof Error ? err.message : undefined });
    }
  };

  const handleOpenEdit = (v: any) => {
    setEditingId(v.id);
    setNewVehicle({
      vehicle_number: v.vehicle_number || "",
      vehicle_type: v.vehicle_type || "Truck",
      ownership_type: v.ownership_type || "Owned",
      capacity_tons: Number(v.capacity_tons || 10),
      rc_number: v.rc_number || "",
      chassis_number: v.chassis_number || "",
      insurance_valid: v.insurance_valid !== false,
      insurance_doc: v.insurance_doc || "",
      fitness_valid: v.fitness_valid !== false,
      fitness_doc: v.fitness_doc || "",
      permit_valid: v.permit_valid !== false,
      permit_doc: v.permit_doc || "",
      gps_available: v.gps_available !== false,
      is_active: v.is_active !== false
    });
    setIsOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await api.deleteVehicle(deleteId);
      setDeleteId(null);
      toast.success("Vehicle deleted successfully");
      window.location.reload();
    } catch (err) {
      toast.error("Failed to delete vehicle", { description: err instanceof Error ? err.message : undefined });
    }
  };

  return (
    <AppShell
      title="Vehicle Master & Fleet"
      subtitle="Manage outbound transport fleet, RC identification, compliance document uploads, and capacity"
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" className="rounded-xl" onClick={() => void loadData()}>
            <RefreshCw className="size-4 mr-2" /> Refresh
          </Button>
          <Dialog open={isOpen} onOpenChange={(open) => { setIsOpen(open); if (!open) setEditingId(null); }}>
            <DialogTrigger asChild>
              <Button className="rounded-xl shadow-glow" onClick={() => { setEditingId(null); setNewVehicle({ vehicle_number: "", vehicle_type: "Truck", ownership_type: "Owned", capacity_tons: 10, rc_number: "", chassis_number: "", insurance_valid: true, insurance_doc: "", fitness_valid: true, fitness_doc: "", permit_valid: true, permit_doc: "", gps_available: true, is_active: true }); setIsOpen(true); }}>
                <Plus className="size-4 mr-2" /> Register Vehicle
              </Button>
            </DialogTrigger>
            <DialogContent className="rounded-2xl max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="text-xl font-bold tracking-tight">REGISTER NEW VEHICLE</DialogTitle>
                <p className="text-xs text-muted-foreground mt-0.5">Enterprise vehicle master intake with document uploads & compliance checks</p>
              </DialogHeader>
              <form onSubmit={handleRegister} className="space-y-6 mt-4 text-sm">
                {/* 1. Vehicle Information & Capacity */}
                <div className="p-4 rounded-2xl border bg-muted/20 space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-primary">Vehicle Information & Capacity</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <Label className="text-xs font-semibold uppercase text-muted-foreground">Vehicle Number / Plate *</Label>
                      <Input
                        value={newVehicle.vehicle_number}
                        onChange={(e) => setNewVehicle({ ...newVehicle, vehicle_number: e.target.value })}
                        placeholder="KA01AB1234"
                        required
                        className="mt-1.5 rounded-xl font-mono font-bold text-xs"
                      />
                    </div>
                    <div>
                      <Label className="text-xs font-semibold uppercase text-muted-foreground">Vehicle Type *</Label>
                      <select
                        value={newVehicle.vehicle_type}
                        onChange={(e) => setNewVehicle({ ...newVehicle, vehicle_type: e.target.value })}
                        className="mt-1.5 h-10 w-full rounded-xl border border-input bg-background px-3 text-xs shadow-sm font-semibold"
                      >
                        <option value="Truck">Truck</option>
                        <option value="Container">Container</option>
                        <option value="Mini Truck">Mini Truck</option>
                        <option value="Trailer">Trailer</option>
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs font-semibold uppercase text-muted-foreground">Ownership Type</Label>
                      <select
                        value={newVehicle.ownership_type}
                        onChange={(e) => setNewVehicle({ ...newVehicle, ownership_type: e.target.value })}
                        className="mt-1.5 h-10 w-full rounded-xl border border-input bg-background px-3 text-xs shadow-sm font-semibold"
                      >
                        <option value="Owned">Company Owned</option>
                        <option value="Leased">Leased</option>
                        <option value="Contract">Contract Vendor</option>
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs font-semibold uppercase text-muted-foreground">Capacity (Tons) *</Label>
                      <Input
                        type="number"
                        value={newVehicle.capacity_tons}
                        onChange={(e) => setNewVehicle({ ...newVehicle, capacity_tons: Number(e.target.value) })}
                        placeholder="10"
                        required
                        className="mt-1.5 rounded-xl font-mono font-bold text-amber-600 text-xs"
                      />
                    </div>
                  </div>
                </div>

                {/* 2. Vehicle Identification (RC & Chassis) */}
                <div className="p-4 rounded-2xl border bg-muted/20 space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-primary">Vehicle Identification</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <Label className="text-xs font-semibold uppercase text-muted-foreground">RC Number</Label>
                      <Input
                        value={newVehicle.rc_number}
                        onChange={(e) => setNewVehicle({ ...newVehicle, rc_number: e.target.value })}
                        placeholder="KA-01-RC-9921"
                        className="mt-1.5 rounded-xl font-mono text-xs"
                      />
                    </div>
                    <div>
                      <Label className="text-xs font-semibold uppercase text-muted-foreground">Chassis Number</Label>
                      <Input
                        value={newVehicle.chassis_number}
                        onChange={(e) => setNewVehicle({ ...newVehicle, chassis_number: e.target.value })}
                        placeholder="MA3EXXXXXXXXXX"
                        className="mt-1.5 rounded-xl font-mono text-xs"
                      />
                    </div>
                  </div>
                </div>

                {/* 3. Compliance & Document Uploads */}
                <div className="p-4 rounded-2xl border bg-muted/20 space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-primary">Compliance & Document Uploads</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="p-3 rounded-xl border bg-card space-y-2">
                      <label className="flex items-center gap-2 cursor-pointer font-semibold text-xs">
                        <input type="checkbox" checked={newVehicle.insurance_valid} onChange={(e) => setNewVehicle({...newVehicle, insurance_valid: e.target.checked})} className="rounded size-4 text-primary" />
                        <span>Insurance Valid</span>
                      </label>
                      <Input
                        type="file"
                        accept="image/*,.pdf"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) setNewVehicle({...newVehicle, insurance_doc: file.name});
                        }}
                        className="rounded-xl text-xs file:mr-2 file:py-1 file:px-2 file:rounded-lg file:border-0 file:text-[10px] file:font-bold file:bg-primary file:text-primary-foreground cursor-pointer"
                      />
                    </div>

                    <div className="p-3 rounded-xl border bg-card space-y-2">
                      <label className="flex items-center gap-2 cursor-pointer font-semibold text-xs">
                        <input type="checkbox" checked={newVehicle.fitness_valid} onChange={(e) => setNewVehicle({...newVehicle, fitness_valid: e.target.checked})} className="rounded size-4 text-primary" />
                        <span>Fitness Certificate Valid</span>
                      </label>
                      <Input
                        type="file"
                        accept="image/*,.pdf"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) setNewVehicle({...newVehicle, fitness_doc: file.name});
                        }}
                        className="rounded-xl text-xs file:mr-2 file:py-1 file:px-2 file:rounded-lg file:border-0 file:text-[10px] file:font-bold file:bg-primary file:text-primary-foreground cursor-pointer"
                      />
                    </div>

                    <div className="p-3 rounded-xl border bg-card space-y-2">
                      <label className="flex items-center gap-2 cursor-pointer font-semibold text-xs">
                        <input type="checkbox" checked={newVehicle.permit_valid} onChange={(e) => setNewVehicle({...newVehicle, permit_valid: e.target.checked})} className="rounded size-4 text-primary" />
                        <span>Permit Valid</span>
                      </label>
                      <Input
                        type="file"
                        accept="image/*,.pdf"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) setNewVehicle({...newVehicle, permit_doc: file.name});
                        }}
                        className="rounded-xl text-xs file:mr-2 file:py-1 file:px-2 file:rounded-lg file:border-0 file:text-[10px] file:font-bold file:bg-primary file:text-primary-foreground cursor-pointer"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <Button type="button" variant="outline" className="rounded-xl text-xs" onClick={() => setIsOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" className="rounded-xl px-6 text-xs font-bold shadow-glow">
                    {editingId ? "Update Vehicle Details" : "Register Vehicle"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      }
    >
      {loading ? (
        <div className="grid h-64 place-items-center"><Loader2 className="size-8 animate-spin text-primary" /></div>
      ) : (
        <Card className="rounded-2xl overflow-hidden shadow-sm">
          <div className="p-4 border-b font-semibold flex items-center justify-between">
            <span>Registered Vehicles Fleet ({vehicles.length})</span>
            <span className="text-xs text-muted-foreground">Horizontal master table view</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/50 text-[10px] uppercase text-muted-foreground font-bold">
                <tr>
                  <th className="px-4 py-3">Vehicle No</th>
                  <th className="px-4 py-3">Type & Ownership</th>
                  <th className="px-4 py-3">Capacity</th>
                  <th className="px-4 py-3">RC / Chassis</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {vehicles.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-12 text-muted-foreground">No vehicles registered yet. Click "Register Vehicle" above.</td></tr>
                ) : (
                  vehicles.map((v, idx) => {
                    const status = v.status || "AVAILABLE";
                    return (
                      <tr key={v.id || idx} className="border-t hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-mono font-bold text-primary">{v.vehicle_number}</td>
                        <td className="px-4 py-3">
                          <div className="font-semibold">{v.vehicle_type}</div>
                          <div className="text-[11px] text-muted-foreground">{v.ownership_type || "Owned"}</div>
                        </td>
                        <td className="px-4 py-3 font-mono font-bold text-amber-600">{v.capacity_tons} Ton</td>
                        <td className="px-4 py-3 font-mono text-xs">
                          <div>RC: {v.rc_number || v.rc_book_number || "N/A"}</div>
                          <div className="text-[11px] text-muted-foreground truncate max-w-[140px]">Chassis: {v.chassis_number || "N/A"}</div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-semibold ${status === "ASSIGNED" ? "bg-blue-500/10 text-blue-600" : "bg-emerald-500/10 text-emerald-600"}`}>
                            {status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right space-x-2">
                          <Button size="sm" variant="outline" className="rounded-lg text-xs h-8" onClick={() => handleOpenEdit(v)}>
                            <Pencil className="size-3.5 mr-1" /> Edit
                          </Button>
                          <Button size="sm" variant="ghost" className="rounded-lg text-xs h-8 text-rose-500 hover:text-rose-600 hover:bg-rose-500/10" onClick={() => setDeleteId(v.id)}>
                            <Trash2 className="size-3.5 mr-1" /> Delete
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
      <DeleteConfirmationDialog open={Boolean(deleteId)} onOpenChange={(open) => !open && setDeleteId(null)} onConfirm={() => void handleDelete()} itemLabel="this vehicle" />
    </AppShell>
  );
}
