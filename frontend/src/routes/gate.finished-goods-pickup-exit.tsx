import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import { LogOut } from "lucide-react";
import { isValidPersonName, isValidVehicleNumber, sanitizePersonName, sanitizeVehicleNumber } from "@/lib/input-validation";

export const Route = createFileRoute("/gate/finished-goods-pickup-exit")({
  component: PickupExitPage,
});
function PickupExitPage() {
  const [pass, setPass] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [driver, setDriver] = useState("");
  const [docs, setDocs] = useState(false);
  const [details, setDetails] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const lookup = async () => {
    const normalized = pass.trim().toUpperCase();
    setPass(normalized);
    if (!/^[A-Z0-9]{6}$/.test(normalized)) {
      toast.error("Enter a valid six-character gate pass.");
      return;
    }
    try {
      const result = await api.getFinishedGoodsPickupGatePass(normalized);
      setDetails(result);
      setVehicle(result.vehicle_number || "");
      setDriver(result.driver_name || "");
    } catch (err) {
      setDetails(null);
      toast.error(err instanceof Error ? err.message : "Gate pass not found.");
    }
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidVehicleNumber(vehicle) || !isValidPersonName(driver)) {
      toast.error("Use letters, numbers and spaces for vehicle and letters and spaces for driver name");
      return;
    }
    setBusy(true);
    try {
      const r = await api.completeFinishedGoodsPickupGateExit(pass, {
        vehicle_number: vehicle,
        driver_name: driver,
        documents_verified: docs,
      });
      toast.success(`${r.request_number} closed and marked dispatched`);
      setPass("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gate exit failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <AppShell
      title={
        <span className="gate-entry-title inline-flex items-center gap-3">
          <span className="gate-entry-title-icon inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-primary">
            <LogOut className="size-5" aria-hidden="true" />
          </span>
          <span>Finished-Goods Pickup Gate Exit</span>
        </span>
      }
      subtitle="Verify the original pickup pass and close the outbound vehicle visit."
    >
      <form
        onSubmit={submit}
        className="mx-auto max-w-xl space-y-4 rounded-2xl border bg-card p-5 shadow-sm"
      >
        <div>
          <Label>Original six-character gate pass</Label>
          <Input
            required
            minLength={6}
            maxLength={6}
            className="font-mono uppercase"
            value={pass}
            onChange={(e) => setPass(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void lookup(); } }}
          />
          <Button type="button" variant="outline" className="mt-2" onClick={() => void lookup()}>Verify Gate Pass</Button>
        </div>
        {details && (
          <div className="grid gap-3 rounded-xl border bg-muted/20 p-4 text-sm sm:grid-cols-2">
            <p><span className="text-muted-foreground">Dispatch request:</span> {details.request_number}</p>
            <p><span className="text-muted-foreground">Status:</span> {details.status}</p>
            <p><span className="text-muted-foreground">Finished goods:</span> {details.product_name} · {details.quantity} {details.uom}</p>
            <p><span className="text-muted-foreground">Expected pickup:</span> {details.expected_pickup_date || "—"}</p>
            <p><span className="text-muted-foreground">Gate entry:</span> {details.entered_at ? new Date(details.entered_at).toLocaleString() : "—"}</p>
            <p><span className="text-muted-foreground">Officer:</span> {details.security_officer || "—"}</p>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Vehicle number</Label>
          <Input required readOnly={!details} value={vehicle} onChange={(e) => setVehicle(sanitizeVehicleNumber(e.target.value))} />
          </div>
          <div>
            <Label>Driver name</Label>
          <Input required readOnly={!details} value={driver} onChange={(e) => setDriver(sanitizePersonName(e.target.value))} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={docs} onChange={(e) => setDocs(e.target.checked)} />{" "}
          Packing list and dispatch documents verified
        </label>
        <Button disabled={busy || !docs || !details}>{busy ? "Closing visit…" : "Approve Gate Exit"}</Button>
      </form>
    </AppShell>
  );
}
