import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { FileText, Loader2, Printer, RefreshCw, Truck } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api-client";
import { requireRole } from "@/lib/auth-utils";

export const Route = createFileRoute("/unscheduled-arrivals")({
  beforeLoad: () => requireRole("GATE_SECURITY"),
  head: () => ({ meta: [{ title: "Unscheduled Arrivals · KaizenX" }] }),
  component: UnscheduledArrivals,
});

type Entry = Record<string, string | null | undefined> & { id: string };
const read = (entry: Entry, camel: string, snake: string) => entry[camel] || entry[snake];

function openInvoice(base64: string) {
  const binary = window.atob(base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const type = binary.startsWith("%PDF") ? "application/pdf" : "image/jpeg";
  window.open(URL.createObjectURL(new Blob([bytes], { type })), "_blank", "noopener,noreferrer");
}

function UnscheduledArrivals() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [scanningVehicle, setScanningVehicle] = useState(false);
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [orderedBy, setOrderedBy] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setEntries(await api.getGateEntries("UNSCHEDULED_ARRIVAL"));
    } catch (error) {
      toast.error("Unable to load unscheduled arrivals", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function printGatePass(entry: Entry) {
    setPrinting(entry.id);
    try {
      await api.downloadGatePass(entry.id, read(entry, "gateEntryNumber", "gate_entry_number") || entry.id);
    } catch (error) {
      toast.error("Unable to open gate pass", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setPrinting(null);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setSubmitting(true);
    try {
      const entry = await api.createUnscheduledGateEntry(new FormData(form));
      toast.success("Unscheduled gate pass created");
      form.reset();
      setVehicleNumber("");
      setOrderedBy("");
      await load();
      await api.downloadGatePass(
        entry.id,
        entry.gateEntryNumber || entry.gate_entry_number || entry.id,
      );
    } catch (error) {
      toast.error("Unable to create gate pass", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function scanVehiclePhoto(file?: File) {
    if (!file) return;
    setScanningVehicle(true);
    const toastId = toast.loading("Reading vehicle number plate…");
    try {
      const result = await api.scanOcr(file, "vehicle-ocr");
      const fields = result.extraction?.fields || result.fields || {};
      const detected =
        result.vehicle_number ||
        result.extraction?.vehicle_number ||
        fields.vehicle_number ||
        fields.license_plate ||
        fields.plate_number ||
        fields.license_plate_number;
      if (detected && detected !== "NOT_FOUND") {
        const normalized = String(detected).toUpperCase().replace(/[^A-Z0-9]/g, "");
        setVehicleNumber(normalized);
        toast.success("Vehicle number auto-filled", { id: toastId, description: normalized });
      } else {
        toast.warning("Number plate not detected", { id: toastId, description: "Enter it manually." });
      }
    } catch (error) {
      toast.error("Number plate scan failed", {
        id: toastId,
        description: error instanceof Error ? error.message : "Enter it manually.",
      });
    } finally {
      setScanningVehicle(false);
    }
  }

  return (
    <AppShell
      title="Unscheduled Arrivals"
      subtitle="Gate-pass records for vehicles arriving without a schedule"
      actions={
        <Button variant="outline" className="rounded-xl" onClick={() => void load()}>
          <RefreshCw className="size-4" /> Refresh
        </Button>
      }
    >
      <Card className="mb-5 rounded-2xl border-border/70 p-5">
        <form onSubmit={(event) => void submit(event)} className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <div className="space-y-2">
            <Label htmlFor="unscheduled-vehicle-photo">Vehicle photo</Label>
            <Input id="unscheduled-vehicle-photo" name="vehicle_photo" type="file" accept="image/*" capture="environment" required onChange={(event) => void scanVehiclePhoto(event.target.files?.[0])} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="unscheduled-vehicle-number">Vehicle number</Label>
            <div className="relative">
              <Input id="unscheduled-vehicle-number" name="vehicle_number" value={vehicleNumber} onChange={(event) => setVehicleNumber(event.target.value.toUpperCase())} placeholder={scanningVehicle ? "Scanning plate…" : "Auto-filled from photo"} required />
              {scanningVehicle && <Loader2 className="absolute right-3 top-2.5 size-4 animate-spin text-muted-foreground" />}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="unscheduled-invoice">Invoice</Label>
            <Input id="unscheduled-invoice" name="invoice" type="file" accept="image/*,application/pdf" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="unscheduled-ordered-by">Ordered by</Label>
            <Input id="unscheduled-ordered-by" name="ordered_by" value={orderedBy} onChange={(event) => setOrderedBy(event.target.value)} placeholder="Enter customer name" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="unscheduled-phone">Phone number</Label>
            <Input id="unscheduled-phone" name="phone_number" type="tel" placeholder="Phone number" required />
          </div>
          <div className="md:col-span-2 xl:col-span-5">
            <Button type="submit" className="rounded-xl" disabled={submitting}>
              {submitting ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />}
              Create and print gate pass
            </Button>
          </div>
        </form>
      </Card>

      <Card className="overflow-hidden rounded-2xl border-border/70 p-0">
        {loading ? (
          <div className="flex h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-5 animate-spin" /> Loading unscheduled arrivals…
          </div>
        ) : entries.length === 0 ? (
          <div className="grid h-64 place-items-center text-center text-sm text-muted-foreground">
            <div><Truck className="mx-auto mb-3 size-8" />No unscheduled arrivals recorded.</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-left text-sm">
              <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-5 py-3">Vehicle photo</th>
                  <th className="px-5 py-3">Invoice</th>
                  <th className="px-5 py-3">Ordered by</th>
                  <th className="px-5 py-3">Phone number</th>
                  <th className="px-5 py-3">Gate pass</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {entries.map((entry) => {
                  const photo = read(entry, "truckPhotoBase64", "truck_photo_base64");
                  const invoice = read(entry, "documentImageBase64", "document_image_base64");
                  const gatePass = read(entry, "gateEntryNumber", "gate_entry_number");
                  return (
                    <tr key={entry.id} className="hover:bg-muted/20">
                      <td className="px-5 py-4">
                        {photo ? <img src={`data:image/jpeg;base64,${photo}`} alt="Vehicle" className="h-16 w-24 rounded-lg border object-cover" /> : <span className="text-muted-foreground">No photo</span>}
                      </td>
                      <td className="px-5 py-4">
                        {invoice ? <Button variant="outline" size="sm" onClick={() => openInvoice(invoice)}><FileText className="size-4" /> View invoice</Button> : <span className="text-muted-foreground">No invoice</span>}
                      </td>
                      <td className="px-5 py-4 font-medium">{read(entry, "driverName", "driver_name") || "—"}</td>
                      <td className="px-5 py-4">{read(entry, "driverPhone", "driver_phone") || "—"}</td>
                      <td className="px-5 py-4">
                        <Button size="sm" disabled={printing === entry.id} onClick={() => void printGatePass(entry)}>
                          {printing === entry.id ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />}
                          {gatePass || "Gate pass"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </AppShell>
  );
}
