import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRef } from "react";
import jsQR from "jsqr";
import { Boxes, Camera, ClipboardList, FileUp, PackageCheck, QrCode, RefreshCw, Truck, Upload, Warehouse } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/wms/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api-client";

export const Route = createFileRoute("/warehouse/finished-goods-store")({ component: FinishedGoodsStore });
type Tab = "putaway" | "pickup" | "inventory";

function FinishedGoodsStore() {
  const [tab, setTab] = useState<Tab>("putaway");
  const [store, setStore] = useState<any>(null);
  const [putaways, setPutaways] = useState<any[]>([]);
  const [pickups, setPickups] = useState<any[]>([]);
  const [inventory, setInventory] = useState<any[]>([]);
  const [zones, setZones] = useState<any[]>([]);
  const [bins, setBins] = useState<any[]>([]);
  const [zoneName, setZoneName] = useState("");
  const [binName, setBinName] = useState("");
  const [qr, setQr] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [stores, putawayRows, pickupRows, balances] = await Promise.all([
      api.getStores().catch(() => []), api.getPutawayTasks().catch(() => []),
      api.getPickupTasks().catch(() => []), api.getInventoryLocationBalances().catch(() => []),
    ]);
    const fg = (stores || []).find((s: any) => String(s.store_type || "").toUpperCase() === "FINISHED_GOODS" || String(s.store_name || "").toUpperCase().includes("FINISHED GOODS"));
    setStore(fg || null);
    setPutaways((putawayRows || []).filter((t: any) => t.is_finished_goods || t.finished_goods_id));
    setPickups((pickupRows || []).filter((t: any) => String(t.store_name || "").toUpperCase().includes("FINISHED GOODS")));
    setInventory((balances || []).filter((b: any) => fg && (b.store_id === fg.id || b.store_code === fg.store_code)));
    if (fg?.id) {
      const zoneRows = await api.getStoreZones(fg.id, "ACTIVE").catch(() => []);
      setZones(zoneRows || []);
      const binRows = await api.getStoreBins(fg.id, "ACTIVE").catch(() => []);
      setBins(binRows || []);
    }
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const pendingPutaways = useMemo(() => putaways.filter((t) => !["COMPLETED", "STORED", "PUTAWAY_COMPLETED"].includes(String(t.status).toUpperCase())), [putaways]);
  const pendingPickups = useMemo(() => pickups.filter((t) => !["COMPLETED", "CANCELLED"].includes(String(t.status).toUpperCase())), [pickups]);
  const storedUnits = inventory.reduce((sum, row) => sum + Number(row.available_quantity || row.quantity || 0), 0);

  async function scanAndStore(code: string) {
    if (!code.trim()) return; setBusy(true); setQr(code);
    try {
      const resolved = await api.resolveFinishedGoodsQr(code.trim());
      const task = putaways.find((t) => t.id === resolved.putaway_task_id) || resolved;
      if (!resolved.putaway_task_id) throw new Error("No active finished-goods putaway task found for this QR.");
      if (String(task.status || "").toUpperCase() !== "PUTAWAY_IN_PROGRESS") await api.startPutaway(resolved.putaway_task_id);
      const destination = resolved.destination_bin_code || resolved.destination_bin || task.destination_bin_code || task.destination_bin;
      if (!destination) throw new Error("This putaway task has no destination bin configured.");
      const taskQuantity = Number(task.quantity || 1);
      const availableQuantity = Number(resolved.available_quantity || taskQuantity);
      await api.completePutaway(resolved.putaway_task_id, { material_scan: code.trim(), location_scan: destination, quantity: Math.min(taskQuantity, availableQuantity) });
      setQr(""); toast.success("Finished good stored in FG Store"); await load();
    } catch (error: any) { toast.error("Unable to store finished good", { description: error?.message }); }
    finally { setBusy(false); }
  }

  async function addZone(event: FormEvent) {
    event.preventDefault();
    if (!store?.id || !zoneName.trim()) return;
    try { await api.createZone(store.id, { zone_name: zoneName.trim() }); setZoneName(""); toast.success("FG Store zone added"); await load(); }
    catch (error: any) { toast.error("Unable to add zone", { description: error?.message }); }
  }

  async function addBin(event: FormEvent) {
    event.preventDefault();
    if (!zones[0]?.id || !binName.trim()) return;
    try { await api.createBin(zones[0].id, { bin_name: binName.trim(), capacity: 10000 }); setBinName(""); toast.success("FG Store bin added"); await load(); }
    catch (error: any) { toast.error("Unable to add bin", { description: error?.message }); }
  }

  return <AppShell title="Finished Goods Store" subtitle="Assembly finished-goods receiving, storage, pickup, and dispatch control">
    <div className="space-y-5">
      <Card className="rounded-2xl border-primary/20 bg-gradient-to-r from-primary/10 to-card p-5"><div className="flex flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-4"><div className="grid size-14 place-items-center rounded-2xl bg-primary/15 text-primary"><Warehouse className="size-7" /></div><div><h1 className="text-xl font-bold">{store?.store_name || "Finished Goods Store"}</h1><p className="text-sm text-muted-foreground">{store?.store_code || "Store not configured"} · Dedicated Assembly finished-goods inventory</p></div></div><div className="flex items-center gap-2"><Link to="/warehouse/dispatch-tracking" className="rounded-xl border bg-background px-3 py-2 text-xs font-semibold hover:bg-muted">Dispatch Dashboard</Link><Link to="/inventory" className="rounded-xl border bg-background px-3 py-2 text-xs font-semibold hover:bg-muted">Inventory</Link><div className="rounded-xl border bg-background/70 px-4 py-3 text-right"><p className="text-[10px] font-bold uppercase text-muted-foreground">Store Authority</p><p className="text-sm font-bold">Warehouse Operations</p><Badge className="mt-1 bg-emerald-500/15 text-emerald-700">{store?.status || "NOT CONFIGURED"}</Badge></div></div></div></Card>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric icon={PackageCheck} label="Putaway Pending" value={loading ? "..." : pendingPutaways.length} /><Metric icon={Truck} label="Pickup / Dispatch" value={loading ? "..." : pendingPickups.length} /><Metric icon={Boxes} label="Stored Units" value={loading ? "..." : storedUnits} /><Metric icon={ClipboardList} label="Inventory Lines" value={loading ? "..." : inventory.length} /></div>
      <Card className="rounded-2xl p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold">Zones & Bins</h2><p className="text-sm text-muted-foreground">Manage the physical storage layout of the Finished Goods Store.</p></div><Badge variant="secondary">{zones.length} zones · {bins.length} bins</Badge></div><div className="mt-4 grid gap-3 lg:grid-cols-2"><div className="rounded-xl border p-4"><p className="text-xs font-bold uppercase text-muted-foreground">Active zones</p><div className="mt-2 space-y-2">{zones.map((zone) => <div key={zone.id} className="rounded-lg bg-muted/50 px-3 py-2"><p className="font-semibold">{zone.zone_name}</p><p className="font-mono text-xs text-muted-foreground">{zone.zone_code}</p></div>)}{!zones.length && <p className="text-sm text-muted-foreground">No zones configured.</p>}</div><form onSubmit={addZone} className="mt-3 flex gap-2"><input value={zoneName} onChange={(e) => setZoneName(e.target.value)} placeholder="New zone name" className="h-9 min-w-0 flex-1 rounded-lg border px-3 text-sm" /><Button size="sm" type="submit" className="rounded-lg">Add Zone</Button></form></div><div className="rounded-xl border p-4"><p className="text-xs font-bold uppercase text-muted-foreground">Active bins</p><div className="mt-2 grid gap-2 sm:grid-cols-2">{bins.map((bin) => <div key={bin.id} className="rounded-lg bg-muted/50 px-3 py-2"><p className="font-semibold">{bin.bin_name}</p><p className="font-mono text-xs text-muted-foreground">{bin.bin_code}</p></div>)}{!bins.length && <p className="text-sm text-muted-foreground">No bins configured.</p>}</div><form onSubmit={addBin} className="mt-3 flex gap-2"><input value={binName} onChange={(e) => setBinName(e.target.value)} placeholder="New bin name" className="h-9 min-w-0 flex-1 rounded-lg border px-3 text-sm" /><Button size="sm" type="submit" disabled={!zones.length} className="rounded-lg">Add Bin</Button></form></div></div></Card>
      <div className="flex gap-2 overflow-x-auto rounded-2xl border bg-card p-2">{([["putaway", "Putaway Tasks", PackageCheck], ["pickup", "Pickup & Dispatch", Truck], ["inventory", "Store Inventory", Boxes]] as const).map(([value, label, Icon]) => <Button key={value} variant={tab === value ? "default" : "ghost"} className="shrink-0 rounded-xl" onClick={() => setTab(value)}><Icon className="mr-2 size-4" />{label}</Button>)}<Button variant="ghost" className="ml-auto shrink-0 rounded-xl" onClick={() => void load()}><RefreshCw className={loading ? "mr-2 size-4 animate-spin" : "mr-2 size-4"} />Refresh</Button></div>
      {tab === "putaway" && <Card className="rounded-2xl p-5"><h2 className="text-lg font-bold">Assembly Finished Goods Putaway</h2><p className="text-sm text-muted-foreground">Scan the finished-product QR after Assembly completes production.</p><QrScanWidget onDetected={(code) => void scanAndStore(code)} disabled={busy} /><TaskList tasks={pendingPutaways} empty="No Assembly finished-goods are waiting for putaway." /></Card>}
      {tab === "pickup" && <Card className="rounded-2xl p-5"><h2 className="text-lg font-bold">Finished Goods Pickup & Dispatch</h2><p className="text-sm text-muted-foreground">Monitor finished goods issued from this store for dispatch.</p><TaskList tasks={pickups} empty="No finished-goods pickup tasks." /></Card>}
      {tab === "inventory" && <Card className="rounded-2xl p-5"><h2 className="text-lg font-bold">Finished Goods Inventory</h2><p className="text-sm text-muted-foreground">Current quantity stored by material and location.</p><div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b text-xs uppercase text-muted-foreground"><tr><th className="p-3">Material</th><th className="p-3">Location</th><th className="p-3">Available</th><th className="p-3">Total</th></tr></thead><tbody>{inventory.map((row, i) => <tr key={row.id || i} className="border-b last:border-0"><td className="p-3 font-semibold">{row.material_name || row.material_code}</td><td className="p-3 text-muted-foreground">{row.zone_code || row.location_code || "FG-ZONE-01"} · {row.bin_code || "BIN-FG-01"}</td><td className="p-3 font-bold text-emerald-600">{row.available_quantity ?? 0}</td><td className="p-3">{row.quantity ?? row.total_quantity ?? 0}</td></tr>)}</tbody></table>{!loading && inventory.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No finished goods stored yet.</p>}</div></Card>}
    </div>
  </AppShell>;
}

function QrScanWidget({ onDetected, disabled }: { onDetected: (code: string) => void; disabled: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState("");
  const [uploadMode, setUploadMode] = useState(false);
  const [manual, setManual] = useState("");

  useEffect(() => {
    let frame = 0;
    const scan = () => {
      const video = videoRef.current, canvas = canvasRef.current;
      if (video && canvas && video.readyState >= 2) {
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (ctx) { ctx.drawImage(video, 0, 0, canvas.width, canvas.height); const result = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height); if (result?.data) { onDetected(result.data.trim()); return; } }
      }
      frame = requestAnimationFrame(scan);
    };
    if (!uploadMode && !disabled) navigator.mediaDevices?.getUserMedia({ video: { facingMode: { ideal: "environment" } } }).then((stream) => { streamRef.current = stream; if (videoRef.current) { videoRef.current.srcObject = stream; void videoRef.current.play(); frame = requestAnimationFrame(scan); } }).catch((e) => setError(e.message || "Camera unavailable"));
    return () => { cancelAnimationFrame(frame); streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null; };
  }, [disabled, onDetected, uploadMode]);

  const upload = (event: React.ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { const img = new Image(); img.onload = () => { const canvas = document.createElement("canvas"); canvas.width = img.width; canvas.height = img.height; const ctx = canvas.getContext("2d"); if (ctx) { ctx.drawImage(img, 0, 0); const result = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height); if (result?.data) onDetected(result.data.trim()); else setError("No QR code found in image"); } }; img.src = String(reader.result); }; reader.readAsDataURL(file); };
  return <div className="mt-4 space-y-3 rounded-2xl border bg-card p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2 text-xs font-bold"><QrCode className="size-4 text-primary" /> Scan finished-product QR</div><div className="flex gap-1"><Button type="button" size="sm" variant={!uploadMode ? "default" : "outline"} className="h-7 rounded-lg text-[11px]" onClick={() => { setUploadMode(false); setError(""); }}><Camera className="mr-1 size-3" /> Camera</Button><Button type="button" size="sm" variant={uploadMode ? "default" : "outline"} className="h-7 rounded-lg text-[11px]" onClick={() => setUploadMode(true)}><Upload className="mr-1 size-3" /> Upload</Button></div></div>{uploadMode ? <label className="flex cursor-pointer flex-col items-center rounded-xl border border-dashed p-6 text-center"><FileUp className="mb-2 size-6 text-primary" /><span className="text-xs font-semibold">Upload QR image</span><input type="file" accept="image/*" className="hidden" onChange={upload} /></label> : <div className="relative aspect-video overflow-hidden rounded-xl bg-black"><video ref={videoRef} className="size-full object-cover" playsInline muted /><canvas ref={canvasRef} className="hidden" /><div className="pointer-events-none absolute inset-0 grid place-items-center"><div className="size-44 rounded-xl border-2 border-dashed border-emerald-400" /></div>{error && <div className="absolute inset-0 grid place-items-center bg-background/90 p-4 text-center text-xs text-destructive">{error}<Button type="button" size="sm" variant="outline" className="ml-2" onClick={() => setUploadMode(true)}>Use Upload</Button></div>}</div>}<div className="flex gap-2"><input value={manual} onChange={(e) => setManual(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onDetected(manual)} placeholder="Use scanner device if camera is unavailable" className="h-9 flex-1 rounded-xl border px-3 text-xs font-mono" /><Button type="button" size="sm" disabled={!manual.trim() || disabled} onClick={() => onDetected(manual)} className="rounded-xl">Verify</Button></div></div>;
}

function TaskList({ tasks, empty }: { tasks: any[]; empty: string }) { return <div className="mt-5 space-y-2">{tasks.map((task) => <div key={task.id} className="flex items-center justify-between gap-3 rounded-xl border p-4"><div><p className="font-semibold">{task.material_name || task.material_code || task.item_code}</p><p className="text-xs text-muted-foreground">{task.task_number} · Qty {task.remaining_quantity ?? task.quantity ?? task.requested_quantity} {task.uom || "PCS"}</p></div><Badge variant="outline">{String(task.status || "PENDING").replaceAll("_", " ")}</Badge></div>)}{tasks.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">{empty}</p>}</div>; }
function Metric({ icon: Icon, label, value }: { icon: any; label: string; value: number | string }) { return <Card className="rounded-2xl border p-4"><div className="flex items-center gap-2 text-primary"><Icon className="size-4" /><span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span></div><p className="mt-3 text-2xl font-black">{value}</p></Card>; }
