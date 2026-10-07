import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { AppShell, StatusBadge } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api-client";
import { getUserInfo, requireRole } from "@/lib/auth-utils";

export const Route = createFileRoute("/damage-claims")({ beforeLoad: () => requireRole(["SUPPLIER","PROCUREMENT","WAREHOUSE","GATE_SECURITY","ADMIN"]), component: Page });
const resolutions = ["REPLACEMENT","REPAIR_REWORK","CREDIT_NOTE","REFUND","RETURN_REPLACEMENT"];
function Page() {
  const [claims,setClaims]=useState<any[]>([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState<string>();
  const [forms,setForms]=useState<Record<string,any>>({});
  const roles: string[] = getUserInfo()?.roles || [];
  const has=(role:string)=>roles.includes(role)||roles.includes("ADMIN");
  const load=useCallback(async()=>{setLoading(true);try{setClaims(await api.getDamageClaims());}catch(e){toast.error("Unable to load damage claims",{description:e instanceof Error?e.message:undefined});}finally{setLoading(false);}},[]);
  useEffect(()=>{void load();},[load]);
  const run=async(key:string,action:()=>Promise<any>,success:string)=>{setBusy(key);try{await action();toast.success(success);await load();}catch(e){toast.error("Workflow action failed",{description:e instanceof Error?e.message:undefined});}finally{setBusy(undefined);}};
  const patch=(id:string,data:any)=>setForms(all=>({...all,[id]:{...all[id],...data}}));
  return <AppShell title="Damage Claims" subtitle="Supplier response, replacement receipt, quarantine return, and closure" actions={<Button variant="outline" onClick={()=>void load()}><RefreshCw className="size-4"/>Refresh</Button>}>
    {loading?<div className="grid h-64 place-items-center"><Loader2 className="size-6 animate-spin"/></div>:<div className="space-y-4">{claims.map(c=>{const f=forms[c.id]||{};const s=c.shipment;return <Card key={c.id} className="rounded-2xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-mono text-lg font-bold">{c.claim_number}</h3><p className="text-sm text-muted-foreground">{c.po_number} · {c.material} · {c.damaged_quantity} {c.uom}</p></div><StatusBadge status={c.status}/></div>
      <div className="mt-4 grid gap-2 text-sm sm:grid-cols-4"><div><span className="text-muted-foreground">Original GRN</span><p className="font-medium">{c.grn_number||"Pending"}</p></div><div><span className="text-muted-foreground">Response</span><p className="font-medium">{c.response?.replaceAll("_"," ")||"Awaiting supplier"}</p></div><div><span className="text-muted-foreground">Resolution</span><p className="font-medium">{c.resolution?.replaceAll("_"," ")||"—"}</p></div><div><span className="text-muted-foreground">Quarantine</span><p className="font-medium text-orange-600">Original goods retained</p></div></div>
      {has("SUPPLIER")&&!c.response&&<div className="mt-4 grid gap-3 rounded-xl border p-4 md:grid-cols-2"><select className="h-10 rounded-md border bg-background px-3" value={f.response||""} onChange={e=>patch(c.id,{response:e.target.value})}><option value="">Select response</option><option value="ACCEPT">Accept</option><option value="REJECT">Reject</option><option value="PARTIALLY_ACCEPT">Partially Accept</option><option value="REQUEST_MORE_INFORMATION">Request More Information</option></select><select className="h-10 rounded-md border bg-background px-3" value={f.resolution||""} onChange={e=>patch(c.id,{resolution:e.target.value})}><option value="">Select resolution</option>{resolutions.map(r=><option key={r} value={r}>{r.replaceAll("_"," ")}</option>)}</select><Input placeholder="Supplier remarks" value={f.remarks||""} onChange={e=>patch(c.id,{remarks:e.target.value})}/><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.return_required} onChange={e=>patch(c.id,{return_required:e.target.checked})}/>Original damaged goods must be returned</label><Button disabled={busy===c.id} onClick={()=>void run(c.id,()=>api.respondToDamageClaim(c.id,f),"Claim response submitted")}>Submit Response</Button></div>}
      {has("SUPPLIER")&&["REPLACEMENT","RETURN_REPLACEMENT"].includes(c.resolution)&&!s&&<div className="mt-4 flex gap-3 rounded-xl border p-4"><Input placeholder="Replacement vehicle number" value={f.vehicle||""} onChange={e=>patch(c.id,{vehicle:e.target.value})}/><Button onClick={()=>void run(c.id,()=>api.createReplacementShipment(c.id,{vehicle_number:f.vehicle}),"Replacement shipment created")}>Send Replacement</Button></div>}
      {s&&<div className="mt-4 rounded-xl border p-4"><div className="flex justify-between"><strong>{s.shipment_number}</strong><StatusBadge status={s.status}/></div><p className="mt-1 text-sm text-muted-foreground">Vehicle {s.vehicle_number} · Expected {s.expected_quantity} {c.uom} · Gate {s.gate_entry_number||"pending"} · RGRN {s.replacement_grn_number||"pending"}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {has("GATE_SECURITY")&&s.status==="IN_TRANSIT"&&<Button onClick={()=>void run(s.id,()=>api.replacementGateEntry(s.id,s.vehicle_number),"Replacement gate entry recorded")}>Record Gate Entry</Button>}
          {has("WAREHOUSE")&&s.status==="AT_RECEIVING"&&<Button onClick={()=>void run(s.id,()=>api.receiveReplacement(s.id,s.expected_quantity),"Replacement GRN created")}>Receive {s.expected_quantity} & Create RGRN</Button>}
          {has("WAREHOUSE")&&s.status==="AWAITING_INSPECTION"&&<Button onClick={()=>void run(s.id,()=>api.inspectReplacement(s.id,s.received_quantity,0),"Replacement inspection passed")}>Accept All {s.received_quantity}</Button>}
          {has("WAREHOUSE")&&s.status==="INSPECTION_PASSED"&&<><Input className="max-w-52" placeholder="Storage location" value={f.location||""} onChange={e=>patch(c.id,{location:e.target.value})}/><Button onClick={()=>void run(s.id,()=>api.putawayReplacement(s.id,f.location),"Replacement put away")}>Complete Putaway</Button></>}
          {has("WAREHOUSE")&&s.status==="PUTAWAY_COMPLETED"&&<Button onClick={()=>void run(s.id,()=>api.postReplacementInventory(s.id),"Replacement added to available inventory")}>Post to Inventory</Button>}
        </div></div>}
      {c.return_required&&has("WAREHOUSE")&&!c.return&&<div className="mt-4 flex gap-3"><Input placeholder="Return vehicle number" value={f.returnVehicle||""} onChange={e=>patch(c.id,{returnVehicle:e.target.value})}/><Button variant="destructive" onClick={()=>void run(c.id,()=>api.createSupplierReturn(c.id,f.returnVehicle),"Supplier return created")}>Create Supplier Return</Button></div>}
      {c.return&&<div className="mt-4 flex items-center justify-between rounded-xl border p-4"><span>{c.return.return_number} · {c.return.status.replaceAll("_"," ")}</span>{has("GATE_SECURITY")&&c.return.status==="AWAITING_GATE_EXIT"&&<Button onClick={()=>void run(c.return.id,()=>api.completeSupplierReturn(c.return.id),"Damaged goods returned to supplier")}>Complete Gate Exit</Button>}</div>}
      {has("PROCUREMENT")&&c.status!=="CLOSED"&&<Button className="mt-4" variant="outline" onClick={()=>void run(c.id,()=>api.closeDamageClaim(c.id),"Damage claim closed")}>Close Claim</Button>}
    </Card>})}</div>}
  </AppShell>;
}

// Trigger update
