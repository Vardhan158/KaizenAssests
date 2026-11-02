import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { ArrowLeft, Download, Eye, Loader2, Printer, Trash2 } from "lucide-react";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";

type RackCapacity = {
  id: string; rack_code: string; maximum_capacity: number; occupied_quantity: number;
  available_capacity: number; occupancy_percentage: number; occupancy_status: string;
};
type RackBin = {
  id: string; zone_id: string; rack: string; bin_code: string; position?: string;
  qr_identifier?: string; rack_capacity?: RackCapacity;
};
type ZoneInfo = { zone_code?: string; zone_name?: string };
type Material = { balance_id: string; material_name: string; material_code: string; batch_number: string;
  quantity: number; uom: string; material_qr?: string; rack_qr?: string; grn_number?: string };
type Details = RackCapacity & { materials: Material[] };
type HistoryEvent = { id: number; quantity_delta: number; reason: string; actor: string; created_at: string; balance_id?: string };
type Mode = "details" | "pick" | "transfer" | "empty" | "capacity";
const actionTitles: Record<Mode, string> = {
  details: "Rack Details", pick: "Pick / Remove Material", transfer: "Transfer Material", empty: "Empty Rack", capacity: "Edit Capacity",
};
const capacityWarning = "Rack capacity is unavailable or not configured. Refresh or contact your warehouse administrator before adding material.";
function hasCapacity(value: RackCapacity | null | undefined): value is RackCapacity {
  return !!value && [value.maximum_capacity, value.occupied_quantity, value.available_capacity, value.occupancy_percentage].every(n => typeof n === "number" && Number.isFinite(n))
    && value.maximum_capacity > 0 && value.occupied_quantity >= 0 && value.occupied_quantity <= value.maximum_capacity
    && value.available_capacity >= 0 && value.occupancy_percentage >= 0 && value.occupancy_percentage <= 100
    && Math.abs(value.maximum_capacity - value.occupied_quantity - value.available_capacity) < 0.0001
    && ["Empty", "Partially Occupied", "Full"].includes(value.occupancy_status);
}
function CapacitySummary({ rack, label }: { rack: RackCapacity; label: string }) {
  return <div className="space-y-3">
    <div className="grid grid-cols-2 gap-4 text-sm">
      <div><p className="text-xs text-muted-foreground">Capacity (Occupied / Maximum)</p><p className="mt-1 font-semibold tabular-nums">{rack.occupied_quantity.toLocaleString()} / {rack.maximum_capacity.toLocaleString()} PCS</p></div>
      <div><p className="text-xs text-muted-foreground">Available Capacity</p><p className="mt-1 font-semibold tabular-nums">{rack.available_capacity.toLocaleString()} PCS</p></div>
    </div>
    <div className="flex justify-between text-xs text-muted-foreground"><span>Occupancy</span><span className="tabular-nums">{rack.occupancy_percentage}%</span></div>
    <div role="progressbar" aria-label={`${label} occupancy`} aria-valuemin={0} aria-valuemax={rack.maximum_capacity} aria-valuenow={rack.occupied_quantity}
      className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
      <div className={`h-full rounded-full ${rack.available_capacity === 0 ? "bg-amber-500" : "bg-indigo-600"}`} style={{ width: `${rack.occupancy_percentage}%` }} />
    </div>
  </div>;
}
function RackQrTools({ bin, zone }: { bin: RackBin; zone?: ZoneInfo }) {
  const [image, setImage] = useState<{ value: string; url: string } | null>(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const value = bin.qr_identifier;
  useEffect(() => {
    let active = true; setImage(null); setError(""); setExpanded(false);
    if (value) void QRCode.toDataURL(value, { width: 512, margin: 4 })
      .then(url => { if (active) setImage({ value, url }); })
      .catch(() => { if (active) setError("Unable to load this rack QR. Try opening the details again."); });
    return () => { active = false; };
  }, [value]);
  const ready = !!image && image.value === value;
  function download() {
    if (!ready || !image) return;
    const link = document.createElement("a"); link.href = image.url; link.download = `${bin.rack}-${bin.bin_code}.png`; link.click();
  }
  function print() {
    if (!ready || !image) return;
    const popup = window.open("", "_blank", "width=700,height=700");
    if (!popup) { setError("Allow pop-ups to print the rack QR."); return; }
    const doc = popup.document; doc.title = `Rack QR - ${bin.rack}`;
    const style = doc.createElement("style"); style.textContent = "@page { margin: 15mm; } body { font: 16px Arial; text-align: center; color: #000; } img { width: 280px; height: 280px; } p { overflow-wrap: anywhere; }"; doc.head.appendChild(style);
    const title = doc.createElement("h1"); title.textContent = bin.rack;
    const label = doc.createElement("p"); label.textContent = [zone?.zone_code, zone?.zone_name, bin.bin_code, bin.position, value].filter(Boolean).join(" / ");
    const qr = doc.createElement("img"); qr.alt = `QR for rack ${bin.rack}`;
    qr.onload = () => { popup.focus(); popup.print(); };
    qr.onerror = () => { popup.close(); setError("Unable to load rack QR for printing."); };
    doc.body.append(title, qr, label); qr.src = image.url;
  }
  return <div className="space-y-3">
    {!value ? <p role="status" className="text-sm text-amber-700">No saved QR reference is configured for this rack location.</p> : <>
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        {ready && <img src={image!.url} alt={`QR for rack ${bin.rack}`} className={`rounded-lg border bg-white ${expanded ? "w-full max-w-xs" : "size-28"}`} />}
        <div className="min-w-0 space-y-3"><p className="break-all font-mono text-xs text-muted-foreground">{value}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={!ready} aria-expanded={expanded} onClick={() => setExpanded(v => !v)}><Eye />{expanded ? "Reduce QR" : "View QR"}</Button>
            <Button size="sm" variant="outline" disabled={!ready} onClick={download}><Download />Download QR</Button>
            <Button size="sm" variant="outline" disabled={!ready} onClick={print}><Printer />Print QR</Button>
          </div>{!ready && !error && <p role="status" className="text-xs text-muted-foreground">Loading saved rack QR...</p>}
        </div>
      </div>
    </>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}

export function RackOccupancyCards({ bins, allBins, zone, onAddMaterial, onUpdated }: {
  bins: RackBin[]; allBins: RackBin[]; zone?: ZoneInfo; onAddMaterial: () => void; onUpdated: () => Promise<unknown>;
}) {
  const [selection, setSelection] = useState<{ bin: RackBin; mode: Mode } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RackBin | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  async function confirmDelete() {
    if (!deleteTarget?.rack_capacity?.id || deleting) return;
    setDeleting(true); setDeleteError("");
    try {
      await api.deleteRack(deleteTarget.zone_id, deleteTarget.rack_capacity.id);
      setDeleteTarget(null);
      toast.success("Rack deleted");
      try { await onUpdated(); } catch { toast.error("Rack deleted. Refresh to update the rack list."); }
    } catch (err: any) { setDeleteError(err.message || "Unable to delete this rack."); }
    finally { setDeleting(false); }
  }
  const [content, setContent] = useState<Details | null>(null);
  const [history, setHistory] = useState<HistoryEvent[] | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [qrBinId, setQrBinId] = useState("");
  const sequence = useRef(0);
  const [form, setForm] = useState({ rackScan: "", materialScan: "", quantity: "", reason: "", confirmed: false, destination: "", destinationScan: "" });
  const groups = [...new Map(bins.map(bin => [bin.rack_capacity?.id || bin.rack || bin.id, bin])).values()];
  useEffect(() => () => { sequence.current++; }, []);
  async function openDetails(bin: RackBin) {
    const request = ++sequence.current;
    setSelection({ bin, mode: "details" }); setContent(null); setHistory(null); setHistoryError(""); setError(""); setLoading(true); setQrBinId(bin.id);
    if (!bin.rack_capacity?.id) { setError(capacityWarning); setHistoryError("Transaction history is unavailable until this rack is configured."); setLoading(false); return; }
    await Promise.allSettled([
      api.getRackMaterials(bin.zone_id, bin.rack_capacity.id).then(data => {
        if (request !== sequence.current) return;
        setContent(data);
        if (!hasCapacity(data)) setError(capacityWarning);
      }).catch((err: Error) => { if (request === sequence.current) setError(err.message || "Rack details could not be loaded. Please try again."); })
        .finally(() => { if (request === sequence.current) setLoading(false); }),
      api.getRackHistory(bin.zone_id, bin.rack_capacity.id).then(rows => {
        if (request !== sequence.current) return;
        if (!Array.isArray(rows)) throw new Error("Transaction history is unavailable.");
        setHistory(rows);
      }).catch((err: Error) => { if (request === sequence.current) setHistoryError(err.message || "Transaction history could not be loaded. Please try again."); }),
    ]);
  }
  function manage(mode: Mode) {
    if (!selection) return;
    setSelection({ ...selection, mode }); setError("");
    setForm({ rackScan: "", materialScan: "", quantity: mode === "capacity" && hasCapacity(content) ? String(content.maximum_capacity) : "", reason: "", confirmed: false, destination: "", destinationScan: "" });
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!selection?.bin.rack_capacity || !hasCapacity(content)) return;
    const { bin, mode } = selection;
    setError("");
    const quantity = Number(form.quantity);
    if (["pick", "transfer", "capacity"].includes(mode) && (!Number.isSafeInteger(quantity) || quantity <= 0)) {
      setError("Enter a positive whole number of PCS."); return;
    }
    if (["empty", "transfer", "pick"].includes(mode) && form.reason.trim().length < 3) {
      setError("Enter a reason of at least 3 characters."); return;
    }
    if (mode === "empty" && !form.confirmed) { setError("Confirm the audited stock adjustment."); return; }
    if (mode === "capacity" && quantity < content.occupied_quantity) { setError("Maximum capacity cannot be less than current occupancy."); return; }
    if (["pick", "transfer"].includes(mode)) {
      const rackBins = bins.filter(b => b.rack_capacity?.id === bin.rack_capacity?.id);
      if (!rackBins.some(b => b.qr_identifier === form.rackScan.trim())) {
        setError("Scan the QR for this rack."); return;
      }
      if (!form.materialScan.trim()) { setError("Scan the material QR."); return; }
    }
    if (mode === "transfer") {
      const destination = allBins.find(b => b.id === form.destination);
      if (!destination || destination.qr_identifier !== form.destinationScan.trim()) {
        setError("Select and scan the destination rack QR."); return;
      }
    }
    setSaving(true);
    try {
      if (mode === "capacity") await api.updateRackCapacity(bin.zone_id, bin.rack_capacity!.id, quantity);
      if (mode === "empty") await api.emptyRack(bin.zone_id, bin.rack_capacity!.id, form.reason.trim());
      if (mode === "pick" || mode === "transfer") {
        await api.moveRackMaterial(bin.zone_id, bin.rack_capacity!.id, {
          source_scan: form.rackScan.trim(), material_scan: form.materialScan.trim(), quantity,
          reason: form.reason.trim(), ...(mode === "transfer" ? { destination_scan: form.destinationScan.trim() } : {}),
        });
      }
      toast.success("Rack inventory updated");
      const [cardsRefresh] = await Promise.allSettled([Promise.resolve().then(onUpdated), openDetails(bin)]);
      if (cardsRefresh.status === "rejected") toast.error("Stock was saved. Refresh the page to update the rack cards.");
    } catch (err: any) { setError(err.message || "Unable to update the rack. Refresh and try again."); }
    finally { setSaving(false); }
  }

  const selectedBins = selection ? bins.filter(b => selection.bin.rack_capacity?.id ? b.rack_capacity?.id === selection.bin.rack_capacity.id : b.rack === selection.bin.rack) : [];
  const qrBin = selectedBins.find(b => b.id === qrBinId) || selection?.bin;
  const ready = hasCapacity(content);
  return <>
    <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open && !deleting) setDeleteTarget(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {deleteTarget?.rack}?</AlertDialogTitle>
          <AlertDialogDescription>This removes the empty rack and its bin locations. This cannot be undone. Racks referenced by warehouse tasks cannot be deleted.</AlertDialogDescription>
        </AlertDialogHeader>
        {deleteError && <p role="alert" className="text-sm text-destructive">{deleteError}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={event => { event.preventDefault(); void confirmDelete(); }}>{deleting ? "Deleting…" : "Delete Rack"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <div className="grid gap-4 p-4 xl:grid-cols-2">
      {groups.map(bin => {
        const rack = bin.rack_capacity;
        const configured = hasCapacity(rack);
        return <article key={rack?.id || bin.id} aria-label={`Rack ${bin.rack || bin.bin_code}`} className="flex flex-col gap-4 rounded-xl border border-indigo-100 bg-white/80 p-5 shadow-sm dark:border-indigo-900 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold">{bin.rack || bin.bin_code}</h4><Badge variant="outline" className={configured && rack.occupancy_status === "Full" ? "border-amber-200 text-amber-700" : "text-indigo-700 dark:text-indigo-300"}>{configured ? rack.occupancy_status : "Capacity unavailable"}</Badge></div>
          {configured ? <CapacitySummary rack={rack} label={bin.rack} /> : <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">{capacityWarning}</p>}
          <div className="mt-auto flex flex-wrap justify-end gap-2 border-t border-indigo-100 pt-4 dark:border-indigo-900">
            <Button size="sm" disabled={!configured} onClick={onAddMaterial}>Add Material</Button>
            <Button size="sm" variant="outline" onClick={() => void openDetails(bin)}>View Details</Button>
            <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" disabled={!configured || rack.occupied_quantity > 0} onClick={() => { setDeleteError(""); setDeleteTarget(bin); }}><Trash2 className="size-4" />Delete Rack</Button>
          </div>
        </article>;
      })}
    </div>
    <Dialog open={!!selection} onOpenChange={open => { if (!open && !saving) { sequence.current++; setSelection(null); } }}>
      <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-4xl overflow-y-auto p-0">
        <DialogHeader className="border-b bg-slate-50/70 px-6 py-5 pr-12 dark:bg-slate-900">
          <DialogTitle className="text-xl">{selection?.bin.rack} / {actionTitles[selection?.mode || "details"]}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            <span>{zone?.zone_code || selection?.bin.zone_id}</span>
            {zone?.zone_name && <><span>/</span><span>{zone.zone_name}</span></>}
            {selectedBins.some(b => b.position) && [...new Set(selectedBins.map(b => b.position).filter(Boolean))].map(pos => <span key={pos} className="block text-xs text-muted-foreground">{pos}</span>)}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6 px-6 pb-6">
          {selection?.mode !== "details" && <Button size="sm" variant="ghost" disabled={saving} onClick={() => manage("details")}><ArrowLeft />Back to Details</Button>}
          {error && <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
          {loading && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading persisted rack inventory...</p>}
          {selection?.mode === "details" && <>
            <section aria-label="Rack capacity" className="rounded-xl bg-muted/20 p-4">
              <div>{ready ? <><div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold">Capacity</h3><Badge variant="outline">{content.occupancy_status}</Badge></div><CapacitySummary rack={content} label={selection.bin.rack} /></> : !loading && <p className="text-sm text-amber-700">Capacity information is unavailable.</p>}</div>
            </section>
            <section aria-label="Stored materials" className="space-y-3"><h3 className="text-sm font-semibold">Stored Materials</h3>
              {Array.isArray(content?.materials) ? <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[600px] table-fixed text-left text-sm"><colgroup><col className="w-[20%]"/><col className="w-[28%]"/><col className="w-[14%]"/><col className="w-[18%]"/><col className="w-[20%]"/></colgroup><thead className="bg-muted/50 text-muted-foreground"><tr><th className="p-3">Material</th><th className="p-3">Batch</th><th className="p-3 text-right">Quantity</th><th className="p-3">Source GRN</th><th className="p-3">QR Reference</th></tr></thead><tbody>
                {content.materials.map(item => <tr key={item.balance_id} className="border-t"><td className="p-3"><p className="font-medium">{item.material_name}</p><p className="mt-1 text-muted-foreground">{item.material_code}</p></td><td className="break-all p-3 font-mono text-xs">{item.batch_number}</td><td className="whitespace-nowrap p-3 text-right font-medium tabular-nums">{typeof item.quantity === "number" ? item.quantity.toLocaleString() : "Unavailable"} {item.uom}</td><td className="p-3">{item.grn_number || "Not recorded"}</td><td className="max-w-52 break-all p-3 font-mono text-xs">{item.material_qr || "No saved batch QR"}</td></tr>)}
                {!content.materials.length && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Rack is empty. Use Add Material to start QR-based putaway.</td></tr>}
              </tbody></table></div> : <p className="text-sm text-muted-foreground">{loading ? "Loading stored materials..." : "Stored materials could not be loaded."}</p>}
            </section>
            <section aria-label="Rack QR" className="space-y-3 rounded-xl border p-4"><h3 className="text-sm font-semibold">Rack QR</h3>
              {selectedBins.length > 1 && <div className="space-y-2"><Label htmlFor="rack-qr-location">Storage location</Label><select id="rack-qr-location" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={qrBinId} onChange={e => setQrBinId(e.target.value)}>{selectedBins.map(b => <option key={b.id} value={b.id}>{b.bin_code}{b.position ? ` / ${b.position}` : ""}</option>)}</select></div>}
              {qrBin && <RackQrTools bin={qrBin} zone={zone} />}
            </section>
            <details className="space-y-3" open><summary className="cursor-pointer text-sm font-semibold">Material transaction history</summary>
              {historyError ? <p role="alert" className="text-sm text-destructive">{historyError}</p> : history ? <div className="max-h-64 overflow-y-auto rounded-xl border divide-y">{history.map(row => <div key={row.id} className="flex flex-wrap justify-between gap-2 p-3 text-xs"><div className="min-w-0 flex-1"><p className="break-words font-medium">{row.reason}</p><p className="mt-1 text-muted-foreground">{row.actor} / {new Date(row.created_at).toLocaleString()}</p></div><span className="font-semibold tabular-nums">{row.quantity_delta > 0 ? "+" : ""}{row.quantity_delta} PCS</span></div>)}{!history.length && <p className="p-4 text-sm text-muted-foreground">No rack transactions have been recorded.</p>}</div> : <p role="status" className="text-sm text-muted-foreground">Loading transaction history...</p>}
            </details>
            <section aria-label="Rack management" className="space-y-3 border-t pt-5"><h3 className="text-sm font-semibold">Management</h3><div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={!ready || loading} onClick={() => manage("capacity")}>Edit Capacity</Button>
            </div></section>
          </>}
          {selection && selection.mode !== "details" && ready && <form onSubmit={submit} className="space-y-4">
            {["pick", "transfer"].includes(selection.mode) && <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="rack-scan">Rack QR scan *</Label><Input id="rack-scan" required value={form.rackScan} onChange={e => setForm({ ...form, rackScan: e.target.value })} /></div>
              <div className="space-y-2"><Label htmlFor="rack-material-scan">Material QR scan *</Label><Input id="rack-material-scan" required value={form.materialScan} onChange={e => setForm({ ...form, materialScan: e.target.value })} /></div>
            </div>}
            {selection.mode === "transfer" && <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="rack-destination">Destination rack *</Label><select id="rack-destination" className="h-10 w-full rounded-md border bg-background px-3" required value={form.destination} onChange={e => setForm({ ...form, destination: e.target.value })}><option value="">Select another rack</option>{allBins.filter(b => b.rack_capacity?.id !== selection.bin.rack_capacity?.id).map(b => <option key={b.id} value={b.id}>{b.rack} / {b.bin_code} / {hasCapacity(b.rack_capacity) ? `${b.rack_capacity.available_capacity} PCS available` : "Capacity unavailable"}</option>)}</select></div>
              <div className="space-y-2"><Label htmlFor="destination-rack-scan">Destination rack QR scan *</Label><Input id="destination-rack-scan" required value={form.destinationScan} onChange={e => setForm({ ...form, destinationScan: e.target.value })} /></div>
            </div>}
            {selection.mode !== "empty" && <div className="space-y-2"><Label htmlFor="rack-quantity">{selection.mode === "capacity" ? "Maximum Capacity (PCS)" : "Quantity (PCS)"} *</Label><Input id="rack-quantity" type="number" min={1} step={1} required value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} /></div>}
            {selection.mode !== "capacity" && <div className="space-y-2"><Label htmlFor="rack-reason">Reason *</Label><Input id="rack-reason" minLength={3} maxLength={1000} required value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} /></div>}
            {selection.mode === "empty" && <div className="space-y-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><p>This records an authorized inventory removal adjustment for every available batch in the rack. Inventory records and audit history are retained. Reserved stock must be released first. To relocate stock instead, use Transfer.</p><label className="flex items-start gap-2"><input className="mt-1" type="checkbox" required checked={form.confirmed} onChange={e => setForm({ ...form, confirmed: e.target.checked })} />I confirm the physical stock removal and authorize this adjustment.</label></div>}
            <div className="flex justify-end gap-2 border-t pt-4"><Button type="button" variant="outline" disabled={saving} onClick={() => manage("details")}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? "Saving..." : selection.mode === "empty" ? "Confirm Audited Adjustment" : "Confirm"}</Button></div>
          </form>}
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
