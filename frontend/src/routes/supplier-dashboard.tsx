import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { FileText, Plus, Truck } from "lucide-react";
import { AppShell } from "@/components/wms/app-shell";
import { SectionCard } from "@/components/wms/primitives";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";

export const Route = createFileRoute("/supplier-dashboard")({ component: SupplierDashboard });

function SupplierDashboard() {
  const [asns, setAsns] = useState<any[]>([]);
  const [selectedAsn, setSelectedAsn] = useState<any>(null);

  useEffect(() => {
    void api.getAsns().then((remote) => setAsns(remote || [])).catch(() => setAsns([]));
  }, []);

  return <AppShell title="Supplier Dashboard" subtitle="Manage your advance shipping notices">
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4"><div><h2 className="text-xl font-bold">ASN Overview</h2><p className="text-sm text-muted-foreground">Create and track your submitted ASNs.</p></div><Button asChild className="rounded-xl"><Link to="/supplier/asns/new"><Plus className="mr-2 size-4" />Create ASN</Link></Button></div>
      <div className="grid gap-4 md:grid-cols-3"><SectionCard title="Total ASNs" icon={FileText}><div className="text-3xl font-bold">{asns.length}</div></SectionCard><SectionCard title="Submitted" icon={Truck}><div className="text-3xl font-bold">{asns.filter((asn) => asn.status === "SUBMITTED").length}</div></SectionCard><SectionCard title="Vehicles" icon={Truck}><div className="text-3xl font-bold">{new Set(asns.map((asn) => asn.vehicle_number).filter(Boolean)).size}</div></SectionCard></div>
      <SectionCard title="ASN History" icon={FileText}>
        {asns.length === 0 ? <p className="text-sm text-muted-foreground">No ASNs submitted yet.</p> : <div className="divide-y">{asns.slice(0, 20).map((asn) => <div key={asn.id || asn.asn_number}>
          <button type="button" className="grid w-full gap-2 py-4 text-left text-sm md:grid-cols-4" onClick={() => setSelectedAsn(selectedAsn?.asn_number === asn.asn_number ? null : asn)}><span className="font-mono font-semibold">{asn.asn_number}</span><span>{asn.vehicle_number || "—"}</span><span>{asn.status || "SUBMITTED"}</span><span className="text-muted-foreground">{asn.delivery_date || (asn.expected_arrival_at ? new Date(asn.expected_arrival_at).toLocaleDateString() : "—")}</span></button>
          {selectedAsn?.asn_number === asn.asn_number && <div className="mb-4 rounded-xl bg-muted/30 p-4 text-sm"><div className="grid gap-3 md:grid-cols-3"><div><span className="text-muted-foreground">Vehicle</span><p className="font-medium">{asn.vehicle_number || "—"}</p></div><div><span className="text-muted-foreground">Driver</span><p className="font-medium">{asn.driver_name || "—"}</p></div><div><span className="text-muted-foreground">Mobile</span><p className="font-medium">{asn.driver_contact || asn.driver_phone || "—"}</p></div></div><div className="mt-4"><span className="text-muted-foreground">Materials</span>{(asn.lines || []).length ? <div className="mt-2 divide-y rounded-lg border">{asn.lines.map((line: any, index: number) => <div key={index} className="flex justify-between px-3 py-2"><span>{line.material_name || line.item_code}</span><span>{line.shipped_quantity || line.quantity} {line.uom}</span></div>)}</div> : <p className="mt-1">No material details available.</p>}</div></div>}
        </div>)}</div>}
      </SectionCard>
    </div>
  </AppShell>;
}
