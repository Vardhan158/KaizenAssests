import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { BarChart3, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api-client";
import { requireRole } from "@/lib/auth-utils";

export const Route = createFileRoute("/assembly-reports")({
  beforeLoad: () => requireRole(["ASSEMBLY_MANAGER", "ADMIN"]), component: AssemblyReports,
});

function AssemblyReports() {
  const [data, setData] = useState<any>(); const [loading, setLoading] = useState(true);
  const load = useCallback(async () => { try { setData(await api.getAssemblyReports()); } catch (error) { toast.error("Unable to load assembly reports", { description: error instanceof Error ? error.message : undefined }); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  const cards = data ? [
    ["Production / Assembly", [["Total orders", data.production.total_orders], ["Completed", data.production.completed_orders], ["Pending", data.production.pending_orders], ["Delayed", data.production.delayed_orders]]],
    ["Material Consumption", [["Planned", data.consumption.planned], ["Actual", data.consumption.actual], ["Variance", data.consumption.variance]]],
    ["Wastage", [["Material wastage", data.wastage.material_wastage], ["Scrap quantity", data.wastage.scrap_quantity], ["Wastage %", `${data.wastage.wastage_percentage}%`]]],
    ["Quality", [["Passed", data.quality.passed], ["Failed", data.quality.failed], ["Rework", data.quality.rework], ["Rejection rate", `${data.quality.rejection_rate}%`]]],
  ] : [];
  return <AppShell title="Assembly Reports" subtitle="Production, consumption, wastage, quality, and team performance" actions={<Button variant="outline" onClick={() => void load()}><RefreshCw className="size-4" />Refresh</Button>}>
    {loading ? <div className="grid h-72 place-items-center"><Loader2 className="size-8 animate-spin text-primary" /></div> : <><div className="grid gap-4 lg:grid-cols-2">{cards.map(([title, metrics]: any) => <Card key={title} className="rounded-2xl p-5"><div className="mb-4 flex items-center gap-2"><BarChart3 className="size-5 text-primary" /><h2 className="font-bold">{title}</h2></div><div className="grid grid-cols-2 gap-3">{metrics.map(([label, value]: any) => <div key={label} className="rounded-xl border bg-muted/20 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="text-2xl font-black">{value}</p></div>)}</div></Card>)}</div><Card className="mt-4 overflow-hidden rounded-2xl p-0"><div className="border-b p-4"><h2 className="font-bold">Team Performance</h2></div><div className="overflow-x-auto"><table className="w-full min-w-[750px] text-left text-sm"><thead className="bg-muted/50"><tr>{["Team", "Output", "Target", "Actual", "Completed orders", "Productivity"].map((h) => <th key={h} className="px-4 py-3 text-[10px] uppercase text-muted-foreground">{h}</th>)}</tr></thead><tbody>{data.team_performance.map((row: any) => <tr key={row.team} className="border-t"><td className="px-4 py-3 font-bold">{row.team}</td><td className="px-4 py-3">{row.team_output}</td><td className="px-4 py-3">{row.target}</td><td className="px-4 py-3">{row.actual}</td><td className="px-4 py-3">{row.completed_orders}</td><td className="px-4 py-3 font-bold text-primary">{row.productivity}%</td></tr>)}</tbody></table></div></Card></>}
  </AppShell>;
}
