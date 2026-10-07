import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { UserCheck, Plus, RefreshCw, Loader2, Phone, ShieldCheck, Mail, Award, MapPin, CreditCard, Camera, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api-client";
import { DeleteConfirmationDialog } from "@/components/wms/delete-confirmation-dialog";

export const Route = createFileRoute("/dispatch-drivers")({
  component: DispatchDriversPage,
});

function DispatchDriversPage() {
  const [loading, setLoading] = useState(true);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [newDriver, setNewDriver] = useState({
    driver_name: "",
    phone: "",
    email: "",
    license_number: "",
    license_type: "Heavy",
    aadhaar_number: "",
    address: "",
    photo_path: "",
    is_active: true
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getDrivers();
      setDrivers(res || []);
    } catch (e) {
      toast.error("Failed to load driver roster", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingId) {
        await api.updateDriver(editingId, newDriver);
        toast.success("Driver updated successfully");
      } else {
        await api.createDriver(newDriver);
        toast.success("Driver registered successfully", { description: `${newDriver.driver_name}` });
      }
      setIsOpen(false);
      setEditingId(null);
      setNewDriver({
        driver_name: "",
        phone: "",
        email: "",
        license_number: "",
        license_type: "Heavy",
        aadhaar_number: "",
        address: "",
        photo_path: "",
        is_active: true
      });
      void loadData();
    } catch (err) {
      toast.error("Failed to save driver", { description: err instanceof Error ? err.message : undefined });
    }
  };

  const handleOpenEdit = (driver: any) => {
    setEditingId(driver.id);
    setNewDriver({
      driver_name: driver.driver_name || driver.name || "",
      phone: driver.phone || "",
      email: driver.email || "",
      license_number: driver.license_number || "",
      license_type: driver.license_type || "Heavy",
      aadhaar_number: driver.aadhaar_number || "",
      address: driver.address || "",
      photo_path: driver.photo_path || "",
      is_active: driver.is_active !== false
    });
    setIsOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await api.deleteDriver(deleteId);
      setDeleteId(null);
      toast.success("Driver deleted successfully");
      window.location.reload();
    } catch (err) {
      toast.error("Failed to delete driver", { description: err instanceof Error ? err.message : undefined });
    }
  };

  return (
    <AppShell
      title="Driver Master & Roster"
      subtitle="Manage driver fleet in a horizontal table view, verify licenses, Aadhaar identity, and compliance status"
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" className="rounded-xl" onClick={() => void loadData()}>
            <RefreshCw className="size-4 mr-2" /> Refresh
          </Button>
          <Dialog open={isOpen} onOpenChange={(open) => { setIsOpen(open); if (!open) { setEditingId(null); } }}>
            <DialogTrigger asChild>
              <Button className="rounded-xl shadow-glow" onClick={() => { setEditingId(null); setNewDriver({ driver_name: "", phone: "", email: "", license_number: "", license_type: "Heavy", aadhaar_number: "", address: "", photo_path: "", is_active: true }); setIsOpen(true); }}>
                <Plus className="size-4 mr-2" /> Register Driver
              </Button>
            </DialogTrigger>
            <DialogContent className="rounded-2xl max-w-xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="text-xl font-bold">{editingId ? "Edit Driver Details" : "Register New Driver"}</DialogTitle>
                <p className="text-xs text-muted-foreground mt-0.5">Enter driver identity, address, photo upload, and license info</p>
              </DialogHeader>
              <form onSubmit={handleRegister} className="space-y-4 mt-2 text-sm">
                <div>
                  <Label className="text-xs font-semibold uppercase text-muted-foreground">Driver Full Name *</Label>
                  <Input
                    value={newDriver.driver_name}
                    onChange={(e) => setNewDriver({ ...newDriver, driver_name: e.target.value })}
                    placeholder="Rajesh Kumar"
                    required
                    className="mt-1.5 rounded-xl font-semibold"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs font-semibold uppercase text-muted-foreground">Phone Number *</Label>
                    <Input
                      value={newDriver.phone}
                      onChange={(e) => setNewDriver({ ...newDriver, phone: e.target.value })}
                      placeholder="+91 9812345678"
                      required
                      className="mt-1.5 rounded-xl font-mono text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-semibold uppercase text-muted-foreground">Email Address</Label>
                    <Input
                      type="email"
                      value={newDriver.email}
                      onChange={(e) => setNewDriver({ ...newDriver, email: e.target.value })}
                      placeholder="driver@logistics.com"
                      className="mt-1.5 rounded-xl text-xs"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs font-semibold uppercase text-muted-foreground">License Number *</Label>
                    <Input
                      value={newDriver.license_number}
                      onChange={(e) => setNewDriver({ ...newDriver, license_number: e.target.value })}
                      placeholder="KA01XXXXXX"
                      required
                      className="mt-1.5 rounded-xl font-mono text-xs font-bold"
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-semibold uppercase text-muted-foreground">License Type *</Label>
                    <select
                      value={newDriver.license_type}
                      onChange={(e) => setNewDriver({ ...newDriver, license_type: e.target.value })}
                      className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2 text-xs shadow-sm focus:ring-2 focus:ring-primary font-semibold text-amber-600"
                    >
                      <option value="Heavy">Heavy Transport</option>
                      <option value="Commercial">Commercial</option>
                      <option value="Standard">Standard</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs font-semibold uppercase text-muted-foreground">Aadhaar Number *</Label>
                    <Input
                      value={newDriver.aadhaar_number}
                      onChange={(e) => setNewDriver({ ...newDriver, aadhaar_number: e.target.value })}
                      placeholder="XXXX-XXXX-XXXX"
                      required
                      className="mt-1.5 rounded-xl font-mono text-xs font-bold"
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-semibold uppercase text-muted-foreground">Driver Photo Upload</Label>
                    <Input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setNewDriver({ ...newDriver, photo_path: file.name });
                        }
                      }}
                      className="mt-1.5 rounded-xl text-xs file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-[11px] file:font-bold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 cursor-pointer"
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-xs font-semibold uppercase text-muted-foreground">Residential Address *</Label>
                  <Input
                    value={newDriver.address}
                    onChange={(e) => setNewDriver({ ...newDriver, address: e.target.value })}
                    placeholder="#45, Logistics Nagar, Bangalore, KA"
                    required
                    className="mt-1.5 rounded-xl text-xs"
                  />
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <input
                    type="checkbox"
                    id="is_active"
                    checked={newDriver.is_active}
                    onChange={(e) => setNewDriver({ ...newDriver, is_active: e.target.checked })}
                    className="rounded size-4 text-primary"
                  />
                  <Label htmlFor="is_active" className="text-xs font-semibold cursor-pointer">Active Driver (Eligible for dispatch allocation)</Label>
                </div>

                <Button type="submit" className="w-full rounded-xl py-6 font-bold shadow-glow mt-2">
                  {editingId ? "Update Driver Details" : "Register Driver"}
                </Button>
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
            <span>Registered Drivers Roster ({drivers.length})</span>
            <span className="text-xs text-muted-foreground">Horizontal master table view</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/50 text-[10px] uppercase text-muted-foreground font-bold">
                <tr>
                  <th className="px-4 py-3">Driver ID</th>
                  <th className="px-4 py-3">Full Name</th>
                  <th className="px-4 py-3">Contact</th>
                  <th className="px-4 py-3">License & Type</th>
                  <th className="px-4 py-3">Aadhaar</th>
                  <th className="px-4 py-3">Address</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {drivers.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-12 text-muted-foreground">No drivers registered yet. Click "Register Driver" above.</td></tr>
                ) : (
                  drivers.map((driver, idx) => {
                    const name = driver.driver_name || driver.name || "Unknown Driver";
                    const status = driver.status || "AVAILABLE";
                    const licType = driver.license_type || "Heavy";
                    return (
                      <tr key={driver.id || idx} className="border-t hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-mono font-bold text-primary">{driver.id?.substring(0, 8) || `DRV-00${idx + 1}`}</td>
                        <td className="px-4 py-3 font-semibold">{name}</td>
                        <td className="px-4 py-3">
                          <div className="text-xs">{driver.phone || "N/A"}</div>
                          <div className="text-[11px] text-muted-foreground">{driver.email}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-mono font-bold text-xs">{driver.license_number}</div>
                          <div className="text-[11px] font-semibold text-amber-600">{licType}</div>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">{driver.aadhaar_number || "N/A"}</td>
                        <td className="px-4 py-3 text-xs max-w-xs truncate">{driver.address || "N/A"}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-semibold ${status === "ASSIGNED" ? "bg-blue-500/10 text-blue-600" : "bg-emerald-500/10 text-emerald-600"}`}>
                            {status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right space-x-2">
                          <Button size="sm" variant="outline" className="rounded-lg text-xs h-8" onClick={() => handleOpenEdit(driver)}>
                            <Pencil className="size-3.5 mr-1" /> Edit
                          </Button>
                          <Button size="sm" variant="ghost" className="rounded-lg text-xs h-8 text-rose-500 hover:text-rose-600 hover:bg-rose-500/10" onClick={() => setDeleteId(driver.id)}>
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
      <DeleteConfirmationDialog open={Boolean(deleteId)} onOpenChange={(open) => !open && setDeleteId(null)} onConfirm={() => void handleDelete()} itemLabel="this driver" />
    </AppShell>
  );
}
