import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, ArrowUpRight, Boxes, ClipboardList, Factory, FileCheck2, Loader2,
  PackageCheck, RefreshCw, ShieldCheck, Truck, Users, Warehouse,
} from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { toast } from "sonner";

import { AppShell } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api-client";
import { requireRole } from "@/lib/auth-utils";

export const Route = createFileRoute("/admin_/operations")({
  beforeLoad: () => requireRole(["ADMIN", "SUPERUSER", "SUPER_ADMIN"]),
  component: AdminOperationsPage,
});

type Overview = {
  users?: { total?: number; active?: number; inactive?: number };
  operations?: { gate_entries?: number; grns?: number; assembly_orders?: number };
};
type AuditEvent = { id: string; module: string; action: string; result: string; occurred_at: string };

const parseDate = (value: string) => new Date(/(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`);
const chartColors = ["#0866B1", "#83BF41", "#E69B32", "#8B5CF6", "#EF5555", "#3A91C7"];

const quickActions = [
  {
    title: "Gate Security",
    description: "Monitor vehicle arrivals, verification, exits, and pickup activity.",
    icon: ShieldCheck,
    actions: [
      ["Gate dashboard", "/gate-dashboard"],
      ["Vehicle queue", "/vehicle-queue"],
      ["FG pickup entry", "/gate/finished-goods-pickup"],
      ["Gate exceptions", "/dispatch-exceptions"],
    ],
  },
  {
    title: "GRN & Receiving",
    description: "Review receipts, inbound work, dock assignments, and putaway.",
    icon: FileCheck2,
    actions: [
      ["GRN dashboard", "/grn?tab=dashboard"],
      ["Receiving", "/receiving"],
      ["Dock management", "/dock-management"],
      ["Putaway tasks", "/putaway-tasks"],
    ],
  },
  {
    title: "Warehouse",
    description: "Open inventory, warehouse requests, and material records.",
    icon: Warehouse,
    actions: [
      ["Inventory dashboard", "/inventory?tab=dashboard"],
      ["Material requests", "/inventory?tab=requests"],
      ["Warehouse materials", "/warehouse/materials"],
      ["Finished goods requests", "/warehouse/finished-goods-requests"],
    ],
  },
  {
    title: "Assembly & Dispatch",
    description: "Review production, quality, finished goods, and outbound work.",
    icon: Factory,
    actions: [
      ["Assembly dashboard", "/assembly-dashboard"],
      ["Production", "/assembly/production"],
      ["Quality checks", "/assembly/quality"],
      ["Dispatch orders", "/dispatch-orders"],
    ],
  },
];

function AdminOperationsPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [overviewData, firstPage] = await Promise.all([
        api.getAdminOverview(),
        api.getAdminAuditLogs({ limit: 500, offset: 0 }),
      ]);
      const offsets = Array.from(
        { length: Math.ceil(Math.max(0, firstPage.total - (firstPage.items || []).length) / 500) },
        (_, index) => (index + 1) * 500,
      );
      const laterPages = await Promise.all(offsets.map((offset) => api.getAdminAuditLogs({ limit: 500, offset })));
      setOverview(overviewData);
      setEvents([...(firstPage.items || []), ...laterPages.flatMap((page) => page.items || [])]);
    } catch (error: any) {
      toast.error(error.message || "Unable to load operational monitoring data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const recentEvents = useMemo(() => {
    const start = new Date();
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    return events.filter((event) => parseDate(event.occurred_at) >= start);
  }, [events]);

  const activityTrend = useMemo(() => Array.from({ length: 7 }, (_, index) => {
    const day = new Date();
    day.setDate(day.getDate() - (6 - index));
    const key = day.toLocaleDateString();
    const entries = recentEvents.filter((event) => parseDate(event.occurred_at).toLocaleDateString() === key);
    return {
      day: day.toLocaleDateString(undefined, { weekday: "short" }),
      activity: entries.length,
      failed: entries.filter((event) => event.result === "FAILED").length,
    };
  }), [recentEvents]);

  const moduleActivity = useMemo(() => {
    const counts = new Map<string, number>();
    recentEvents.forEach((event) => counts.set(event.module || "SYSTEM", (counts.get(event.module || "SYSTEM") || 0) + 1));
    return [...counts.entries()].map(([module, actions]) => ({ module, actions })).sort((a, b) => b.actions - a.actions);
  }, [recentEvents]);

  const resultSummary = useMemo(() => {
    const successes = recentEvents.filter((event) => event.result === "SUCCESS").length;
    const failed = recentEvents.filter((event) => event.result === "FAILED").length;
    return [{ name: "Successful", value: successes }, { name: "Failed", value: failed }].filter((item) => item.value > 0);
  }, [recentEvents]);

  const stats = [
    { label: "Gate entries", value: overview?.operations?.gate_entries ?? 0, icon: Truck, color: "text-blue-700 bg-blue-50" },
    { label: "Goods receipts", value: overview?.operations?.grns ?? 0, icon: Boxes, color: "text-emerald-700 bg-emerald-50" },
    { label: "Assembly orders", value: overview?.operations?.assembly_orders ?? 0, icon: Factory, color: "text-violet-700 bg-violet-50" },
    { label: "Active users", value: overview?.users?.active ?? 0, icon: Users, color: "text-amber-700 bg-amber-50" },
    { label: "Activity, last 7 days", value: recentEvents.length, icon: Activity, color: "text-sky-700 bg-sky-50" },
  ];

  return (
    <AppShell
      title={<span className="inline-flex items-center gap-3"><span className="inline-flex size-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700 ring-1 ring-blue-100"><Activity className="size-5" aria-hidden="true" /></span><span>Operational Monitoring</span></span>}
      subtitle="Cross-module activity, performance, and shortcuts for daily operations."
      actions={<Button variant="outline" className="h-10 w-10 bg-white px-0" aria-label="Reload operational data" title="Reload operational data" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} /></Button>}
    >
      <div className="space-y-5 p-4 md:p-6">
        {loading ? <div className="flex h-56 items-center justify-center text-primary"><Loader2 className="animate-spin" /></div> : <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {stats.map(({ label, value, icon: Icon, color }) => <Card key={label} className="border-slate-200 shadow-sm"><CardContent className="flex min-h-24 items-center justify-between gap-3 p-4"><div><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-bold text-slate-900">{value.toLocaleString()}</p></div><span className={`rounded-xl p-3 ${color}`}><Icon className="size-5" /></span></CardContent></Card>)}
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="border-slate-200 shadow-sm xl:col-span-2">
              <CardHeader className="pb-1"><CardTitle className="text-base">Application activity</CardTitle><p className="text-xs text-muted-foreground">API activity and failed requests over the last seven days.</p></CardHeader>
              <CardContent className="h-72 pt-4">
                <ResponsiveContainer width="100%" height="100%"><LineChart data={activityTrend} margin={{ top: 8, right: 14, left: -14, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e4ebf3" /><XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#64748b" }} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#64748b" }} /><Tooltip /><Line type="monotone" dataKey="activity" name="All activity" stroke="#0866B1" strokeWidth={3} dot={{ r: 3 }} /><Line type="monotone" dataKey="failed" name="Failed requests" stroke="#EF5555" strokeWidth={2} dot={{ r: 3 }} /></LineChart></ResponsiveContainer>
              </CardContent>
            </Card>
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="pb-1"><CardTitle className="text-base">Activity by module</CardTitle><p className="text-xs text-muted-foreground">Requests grouped by application area.</p></CardHeader>
              <CardContent className="h-72 pt-4">
                {moduleActivity.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={moduleActivity.slice(0, 6)} layout="vertical" margin={{ top: 4, right: 12, left: 10, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e4ebf3" /><XAxis type="number" allowDecimals={false} hide /><YAxis type="category" dataKey="module" width={86} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#475569" }} /><Tooltip /><Bar dataKey="actions" name="Requests" fill="#0866B1" radius={[0, 5, 5, 0]} /></BarChart></ResponsiveContainer> : <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No activity in this period.</div>}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <section className="space-y-3">
              <div><h2 className="text-lg font-semibold text-slate-900">Operational workspaces</h2><p className="text-sm text-muted-foreground">Open the module dashboard or jump directly to common work queues.</p></div>
              <div className="grid gap-3 md:grid-cols-2">
                {quickActions.map(({ title, description, icon: Icon, actions }) => <Card key={title} className="border-slate-200 shadow-sm"><CardHeader className="pb-2"><div className="flex items-center gap-3"><span className="rounded-lg bg-blue-50 p-2 text-primary"><Icon className="size-4" /></span><div><CardTitle className="text-base">{title}</CardTitle><p className="mt-1 text-xs text-muted-foreground">{description}</p></div></div></CardHeader><CardContent className="grid grid-cols-2 gap-2">{actions.map(([label, to]) => <Button key={to} asChild size="sm" variant="outline" className="justify-between"><a href={to}>{label}<ArrowUpRight className="size-3.5" /></a></Button>)}</CardContent></Card>)}
              </div>
            </section>

            <Card className="h-fit border-slate-200 shadow-sm">
              <CardHeader className="pb-0"><CardTitle className="text-base">Request outcomes</CardTitle><p className="text-xs text-muted-foreground">Successful and failed API requests for the last seven days.</p></CardHeader>
              <CardContent className="h-52">
                {resultSummary.length ? <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={resultSummary} dataKey="value" nameKey="name" innerRadius={48} outerRadius={72} paddingAngle={3}>{resultSummary.map((entry, index) => <Cell key={entry.name} fill={index === 0 ? chartColors[1] : "#EF5555"} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer> : <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No request outcomes yet.</div>}
                {resultSummary.length > 0 && <div className="-mt-2 flex justify-center gap-4 text-xs">{resultSummary.map((item, index) => <span key={item.name} className="flex items-center gap-1.5"><i className="size-2 rounded-full" style={{ backgroundColor: index === 0 ? chartColors[1] : "#EF5555" }} />{item.name}: {item.value}</span>)}</div>}
              </CardContent>
            </Card>
          </div>

          <Card className="border-slate-200 shadow-sm"><CardHeader className="flex flex-row items-center justify-between"><div><CardTitle className="text-base">Monitoring actions</CardTitle><p className="mt-1 text-xs text-muted-foreground">Review activity and maintain operational access.</p></div></CardHeader><CardContent className="flex flex-wrap gap-2"><Button asChild variant="outline"><Link to="/admin/audit"><ClipboardList /> Open audit log</Link></Button><Button asChild variant="outline"><Link to="/admin/users"><Users /> Manage users</Link></Button><Button asChild variant="outline"><Link to="/admin/suppliers"><PackageCheck /> View suppliers</Link></Button></CardContent></Card>
        </>}
      </div>
    </AppShell>
  );
}
