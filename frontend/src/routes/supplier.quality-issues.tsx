import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { AppShell, StatusBadge } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api-client";
import { requireRole } from "@/lib/auth-utils";
export const Route = createFileRoute("/supplier/quality-issues")({ beforeLoad: () => requireRole("SUPPLIER"), component: Page });
function Page() {
  const [issues, setIssues] = useState<any[]>([]), [loading, setLoading] = useState(true);
  const load = useCallback(async () => { setLoading(true); try { setIssues(await api.getQualityIssues()); } catch (e) { toast.error("Unable to load claims", { description: e instanceof Error ? e.message : undefined }); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  return <AppShell title="Damage Claims" subtitle="Inspection evidence and claims sent by Procurement" actions={<Button variant="outline" onClick={() => void load()}><RefreshCw className="size-4" /> Refresh</Button>}>
    {loading ? <div className="grid h-64 place-items-center"><Loader2 className="size-6 animate-spin" /></div> : issues.length === 0 ? <Card className="grid h-64 place-items-center text-muted-foreground"><div className="text-center"><AlertTriangle className="mx-auto mb-2 size-8" />No damage claims.</div></Card> : <div className="grid gap-4 lg:grid-cols-2">{issues.map((issue) => <Card key={issue.id || issue.gate_entry_id} className="rounded-2xl p-5"><div className="mb-3 flex justify-between gap-3"><div><h3 className="font-mono font-bold">{issue.claim_number || issue.asn_number}</h3><p className="text-sm text-muted-foreground">{issue.po_number}</p></div><StatusBadge status={issue.status} /></div>{issue.type === "DAMAGE_REPORT" ? <><dl className="mb-3 grid grid-cols-2 gap-2 text-sm"><dt>Material</dt><dd className="text-right">{issue.material}</dd><dt>Damaged Qty</dt><dd className="text-right font-bold text-destructive">{issue.damaged_quantity} {issue.uom}</dd><dt>Reason</dt><dd className="text-right">{issue.damage_reason}</dd><dt>Photos</dt><dd className="text-right">{issue.photos?.length || 0} attached</dd></dl><div className="grid grid-cols-2 gap-2">{issue.photos?.map((p: any, i: number) => <img key={i} className="max-h-72 w-full rounded-xl border object-contain" src={`data:${p.content_type};base64,${p.image_base64}`} alt={`Claim evidence ${i + 1}`} />)}</div></> : issue.image_base64 && <img className="max-h-96 w-full rounded-xl border object-contain" src={`data:${issue.content_type};base64,${issue.image_base64}`} alt="Inspection evidence" />}</Card>)}</div>}
  </AppShell>;
}
