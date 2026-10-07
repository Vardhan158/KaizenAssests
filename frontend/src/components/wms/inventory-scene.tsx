import { Component, useMemo, useState, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { Boxes, RotateCcw, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";

type Stock = {
  material_code: string; material_name: string; store_id?: string;
  store_name?: string; store_code?: string; zone_code?: string;
  bin_code?: string; location_code?: string; total_quantity: number;
  available_quantity: number; allocated_quantity?: number;
  quarantined_quantity?: number; status: string; uom?: string;
};
type Bin = { key: string; label: string; store: string; zone: string; items: Stock[] };
const colour = (items: Stock[]) => items.some(i => Number(i.quarantined_quantity) > 0) ? "#fb7185"
  : items.some(i => i.status === "LOW_STOCK" || i.status === "OUT_OF_STOCK") ? "#fbbf24" : "#34d399";

class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override render() { return this.state.failed ? <div className="p-12 text-center text-slate-300">3D is unavailable on this device. Use Stock by Location to view your inventory.</div> : this.props.children; }
}

function Beam({ at, size, color }: { at: [number, number, number]; size: [number, number, number]; color: string }) {
  return <mesh position={at} castShadow receiveShadow><boxGeometry args={size} /><meshStandardMaterial color={color} roughness={0.55} metalness={0.35} /></mesh>;
}

function Rack({ bin, index, selected, onSelect }: { bin: Bin; index: number; selected: boolean; onSelect: () => void }) {
  const [hovered, hover] = useState(false);
  const x = (index % 4 - 1.5) * 3.4;
  const z = Math.floor(index / 4) * 4.3 - 3;
  const total = bin.items.reduce((sum, i) => sum + Number(i.total_quantity || 0), 0);
  const tint = colour(bin.items);
  return <group position={[x, 0, z]}>
    {[-1.2, 1.2].flatMap(a => [-0.55, 0.55].map(b => <Beam key={`${a}-${b}`} at={[a, 1.6, b]} size={[0.1, 3.2, 0.1]} color="#687c93" />))}
    {[0.25, 1.35, 2.45].map((y, shelf) => <group key={y}>
      <Beam at={[0, y, 0]} size={[2.6, 0.1, 1.4]} color={selected || hovered ? "#38bdf8" : "#d88e43"} />
      {total > 0 && [-0.66, 0.05, 0.75].map((a, box) => <group key={a}>
        <Beam at={[a, y + 0.09, 0]} size={[0.62, 0.08, 0.85]} color="#78634b" />
        <mesh position={[a, y + 0.46, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.6, shelf === 2 ? 0.53 : 0.65, 0.72]} />
          <meshStandardMaterial color={box === 1 ? "#b99169" : "#d5b28a"} roughness={0.9} />
        </mesh>
        <Beam at={[a, y + 0.42, 0.367]} size={[0.3, 0.13, 0.01]} color={tint} />
      </group>)}
    </group>)}
    <mesh position={[0, 1.8, 0]} onClick={e => { e.stopPropagation(); onSelect(); }} onPointerOver={e => { e.stopPropagation(); hover(true); }} onPointerOut={() => hover(false)}>
      <boxGeometry args={[2.8, 3.8, 1.6]} /><meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
    <Html position={[0, 3.65, 0]} center distanceFactor={16}>
      <button onClick={onSelect} className={`w-36 rounded-lg border px-3 py-2 text-left shadow-lg ${selected ? "border-sky-400 bg-sky-950" : "border-slate-600 bg-slate-900/95"}`}>
        <span className="block truncate text-[10px] text-slate-400">{bin.store}</span>
        <span className="block truncate text-xs font-semibold text-white">{bin.label}</span>
        <span className="text-[10px]" style={{ color: tint }}>{bin.items.length} material{bin.items.length === 1 ? "" : "s"}</span>
      </button>
    </Html>
  </group>;
}

export default function InventoryScene({ items, onInspect, lastUpdatedAt }: { items: Stock[]; onInspect: (item: Stock) => void; lastUpdatedAt?: Date | null }) {
  const [selected, select] = useState<string>();
  const [page, setPage] = useState(0);
  const [cameraKey, resetCamera] = useState(0);
  const bins = useMemo(() => {
    const grouped = new Map<string, Bin>();
    items.forEach(item => {
      const key = JSON.stringify([item.store_id || item.store_code || item.store_name, item.zone_code, item.bin_code || item.location_code]);
      if (!grouped.has(key)) grouped.set(key, { key, label: item.bin_code || item.location_code || "Unassigned location", store: item.store_name || item.store_code || "Unassigned store", zone: item.zone_code || "Unassigned zone", items: [] });
      grouped.get(key)!.items.push(item);
    });
    return [...grouped.values()];
  }, [items]);
  const maxPage = Math.max(0, Math.ceil(bins.length / 12) - 1);
  const currentPage = Math.min(page, maxPage);
  const visible = bins.slice(currentPage * 12, currentPage * 12 + 12);
  const active = bins.find(b => b.key === selected);
  return <section className="overflow-hidden rounded-2xl border border-slate-700 bg-[#101a29] text-slate-100 shadow-xl">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700/70 px-5 py-4">
      <div><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.25em] text-sky-400"><span className="size-2 animate-pulse rounded-full bg-emerald-400" /> Live warehouse explorer</div><h2 className="mt-1 text-lg font-semibold">Inventory in three dimensions</h2>{lastUpdatedAt && <p className="mt-1 text-[11px] text-slate-400">Synced {lastUpdatedAt.toLocaleTimeString()}</p>}</div>
      <Button variant="outline" className="border-slate-600 bg-slate-800 text-slate-100 hover:bg-slate-700" onClick={() => resetCamera(k => k + 1)}><RotateCcw className="mr-2 size-4" />Reset view</Button>
    </div>
    <div className="grid lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="relative h-[540px] min-w-0 bg-[radial-gradient(ellipse_at_top,#26384e,#101a29)]">
        {bins.length ? <SceneBoundary><Canvas key={cameraKey} shadows dpr={[1, 1.5]} camera={{ position: [15, 14, 19], fov: 43 }} fallback={<p className="p-8">WebGL is unavailable. Use the inventory table.</p>}>
          <fog attach="fog" args={["#101a29", 32, 70]} />
          <ambientLight intensity={0.9} /><hemisphereLight args={["#cceeff", "#343144", 1.2]} />
          <directionalLight position={[8, 16, 7]} intensity={2.8} castShadow shadow-mapSize={[1024, 1024]} shadow-camera-left={-15} shadow-camera-right={15} shadow-camera-top={15} shadow-camera-bottom={-15} />
          <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, -0.04, 2]}><planeGeometry args={[32, 28]} /><meshStandardMaterial color="#263547" roughness={0.9} /></mesh>
          <gridHelper args={[32, 32, "#536b80", "#35465a"]} position={[0, 0, 2]} />
          {[-5.2, -0.9, 3.4, 7.7].map(z => <Beam key={z} at={[0, 0.012, z]} size={[15, 0.015, 0.06]} color="#bd9649" />)}
          {visible.map((bin, i) => <Rack key={bin.key} bin={bin} index={i} selected={selected === bin.key} onSelect={() => select(bin.key)} />)}
          <OrbitControls makeDefault target={[0, 1, 1]} minDistance={7} maxDistance={38} maxPolarAngle={Math.PI / 2.1} />
        </Canvas></SceneBoundary> : <div className="grid h-full place-content-center text-center text-slate-400"><Boxes className="mx-auto mb-3 size-10" /><p>No inventory matches these filters.</p></div>}
        <div className="pointer-events-none absolute bottom-4 left-4 rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-[11px] text-slate-300">Drag to orbit · Scroll to zoom · Right-drag to pan</div>
      </div>
      <aside className="max-h-[540px] overflow-y-auto border-t border-slate-700 bg-slate-900/70 p-5 lg:border-l lg:border-t-0">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Location inspector</p>
        {active ? <><h3 className="mt-3 break-words text-lg font-semibold">{active.label}</h3><p className="mt-1 text-xs text-slate-400">{active.store} / {active.zone}</p>
          {active.items.map((item, i) => <div key={`${item.material_code}-${i}`} className="mt-4 rounded-xl border border-slate-700 bg-slate-800/70 p-3">
            <p className="text-sm font-semibold">{item.material_name}</p><p className="mt-1 text-xs text-slate-400">{item.material_code}</p>
            <div className="mt-3 grid grid-cols-2 gap-3 text-xs"><div><p className="text-slate-400">On hand</p><p className="mt-1 text-lg">{Number(item.total_quantity || 0).toLocaleString()} <span className="text-xs">{item.uom}</span></p></div><div><p className="text-slate-400">Available</p><p className="mt-1 text-lg text-emerald-300">{Number(item.available_quantity || 0).toLocaleString()}</p></div></div>
            <p className="mt-2 text-[11px] text-slate-400">Allocated: {Number(item.allocated_quantity || 0)} · Quarantined: {Number(item.quarantined_quantity || 0)}</p>
            <p className="mt-2 text-xs" style={{ color: colour([item]) }}>{item.status?.replaceAll("_", " ")}</p>
            <button onClick={() => onInspect(item)} className="mt-3 flex items-center gap-1 text-xs font-semibold text-sky-300 hover:underline">Movement history <ArrowUpRight className="size-3" /></button>
          </div>)}</> : <div className="py-12"><Boxes className="mb-4 size-8 text-sky-400" /><h3 className="font-semibold">Explore your stock</h3><p className="mt-2 text-sm leading-relaxed text-slate-400">Select a rack or its label to inspect the materials stored at that location.</p></div>}
        <div className="mt-6 space-y-2 border-t border-slate-700 pt-4 text-xs text-slate-400">{[["#34d399", "In stock"], ["#fbbf24", "Low / out of stock"], ["#fb7185", "Quarantined stock"]].map(([c, label]) => <div key={c} className="flex items-center gap-2"><span className="size-2 rounded-full" style={{ background: c }} />{label}</div>)}</div>
      </aside>
    </div>
    <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-700 px-5 py-3 text-[11px] text-slate-400"><span>Illustrative layout · Boxes represent stock, not individual units · {bins.length} locations</span><div className="flex items-center gap-3"><button disabled={currentPage === 0} className="disabled:opacity-30" onClick={() => setPage(currentPage - 1)}>Previous</button><span>{currentPage + 1} / {maxPage + 1}</span><button disabled={currentPage >= maxPage} className="disabled:opacity-30" onClick={() => setPage(currentPage + 1)}>Next</button></div></footer>
  </section>;
}
