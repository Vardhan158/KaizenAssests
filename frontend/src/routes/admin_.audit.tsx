import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, CalendarDays, CheckCircle2, ClipboardList, Download, Eye, FileClock, Loader2, RefreshCw, Search, Settings2, ShieldCheck, TriangleAlert, UserRound, Users, X } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/api-client";
import { requireRole } from "@/lib/auth-utils";

export const Route = createFileRoute("/admin_/audit")({
  beforeLoad: () => requireRole(["ADMIN", "SUPERUSER", "SUPER_ADMIN"]),
  component: AdminAuditPage,
});

type AuditRow = {
  id: string; actor_username: string; actor_employee_id?: string | null; actor_roles?: string | null;
  module: string; action: string; request_path: string; target_reference?: string | null;
  status_code: number; result: string; request_id?: string | null; ip_address?: string | null; occurred_at: string;
};

const PAGE_SIZE = 10;
const EMPTY_FILTERS = { search: "", module: "", action: "", user: "", result: "", from: "", to: "" };
const titleCase = (value: string) => value.replace(/[_-]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
// SQLite drops timezone metadata from DateTime(timezone=True) values. Those
// naive timestamps are stored as UTC, so mark them UTC before browser parsing.
const parseAuditDate = (value: string) => new Date(/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`);
const displayModule = (row: AuditRow) => row.request_path.includes("/admin/users") ? "User Management" : titleCase(row.module || "System");
const displayAction = (row: AuditRow) => {
  if (row.action === "LOGIN") return "Login";
  if (row.action === "LOGOUT") return "Logout";
  const targetReference = String(row.target_reference || "");
  const isIdentifier = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(targetReference) || /^[\da-f]{24,}$/i.test(targetReference);
  const routeTarget = row.request_path.split("/").filter((part) => part && !["api", "v1"].includes(part.toLowerCase()) && !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(part) && !/^\d+$/.test(part)).at(-1);
  const target = String(isIdentifier || !targetReference ? routeTarget || row.module : targetReference).toLowerCase();
  if (target.includes("assembly-unit")) return `${row.action === "POST" ? "Create" : "Update"} Assembly Unit`;
  if (target.includes("users")) return `${row.action === "POST" ? "Create" : "Update"} User`;
  const operation = row.action === "POST" ? "Create" : row.action === "DELETE" ? "Remove" : row.action === "GET" ? "View" : "Update";
  return `${operation} ${titleCase(row.target_reference || row.module || "Record")}`;
};
const shortDate = (value: string) => parseAuditDate(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const shortTime = (value: string) => parseAuditDate(value).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

function AdminAuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<AuditRow | null>(null);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState(EMPTY_FILTERS);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const firstPage = await api.getAdminAuditLogs({ limit: 500, offset: 0 });
      const offsets = Array.from(
        { length: Math.ceil(Math.max(0, firstPage.total - (firstPage.items || []).length) / 500) },
        (_, index) => (index + 1) * 500,
      );
      const remainingPages = await Promise.all(offsets.map((offset) => api.getAdminAuditLogs({ limit: 500, offset })));
      setRows([...(firstPage.items || []), ...remainingPages.flatMap((page) => page.items || [])]);
    } catch (error: any) {
      toast.error(error.message || "Unable to load audit log");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const modules = useMemo(() => Array.from(new Set(rows.map(displayModule))).sort(), [rows]);
  const actions = useMemo(() => Array.from(new Set(rows.map(displayAction))).sort(), [rows]);
  const userOptions = useMemo(() => Array.from(new Set(rows.map((row) => row.actor_username).filter(Boolean))).sort(), [rows]);
  const filteredRows = useMemo(() => rows.filter((row) => {
    const query = filters.search.trim().toLowerCase();
    const searchable = [row.actor_username, row.actor_employee_id, displayModule(row), displayAction(row), row.target_reference, row.request_path].join(" ").toLowerCase();
    const occurred = parseAuditDate(row.occurred_at);
    const from = filters.from ? new Date(`${filters.from}T00:00:00`) : null;
    const to = filters.to ? new Date(`${filters.to}T23:59:59`) : null;
    return (!query || searchable.includes(query)) && (!filters.module || displayModule(row) === filters.module)
      && (!filters.action || displayAction(row) === filters.action) && (!filters.user || row.actor_username === filters.user)
      && (!filters.result || row.result === filters.result) && (!from || occurred >= from) && (!to || occurred <= to);
  }), [filters, rows]);
  useEffect(() => { setPage(1); }, [filters]);

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const pageRows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const successful = rows.filter((row) => row.result === "SUCCESS").length;
  const failed = rows.length - successful;

  const exportCsv = () => {
    const headings = ["Date & Time", "User", "Employee ID", "Module", "Action", "Target", "Result", "HTTP Status", "IP Address", "Request ID"];
    const values = filteredRows.map((row) => [parseAuditDate(row.occurred_at).toLocaleString(), row.actor_username, row.actor_employee_id || "", displayModule(row), displayAction(row), row.target_reference || "", row.result, row.status_code, row.ip_address || "", row.request_id || ""]);
    const csv = [headings, ...values].map((line) => line.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const detailSections = selected ? [
    { title: "User information", icon: UserRound, details: [["Name", selected.actor_username], ["Employee ID", selected.actor_employee_id || "—"], ["Role", selected.actor_roles || "—"]] },
    { title: "Action information", icon: Settings2, details: [["Module", displayModule(selected)], ["Action", displayAction(selected)], ["Target", selected.target_reference || "—"]] },
    { title: "Result information", icon: CheckCircle2, details: [["Result", selected.result], ["HTTP status", selected.status_code], ["Date & time", parseAuditDate(selected.occurred_at).toLocaleString()]] },
    { title: "Request information", icon: ClipboardList, details: [["Request ID", selected.request_id || "—"], ["IP address", selected.ip_address || "—"], ["Endpoint", selected.request_path]] },
  ] : [];

  const updateFilter = (key: keyof typeof EMPTY_FILTERS, value: string) => {
    if (key === "from" && value && filters.to && value > filters.to) {
      toast.error("Start date cannot be after end date");
      return;
    }
    if (key === "to" && value && filters.from && value < filters.from) {
      toast.error("End date cannot be before start date");
      return;
    }
    setFilters((current) => ({ ...current, [key]: value }));
  };
  const selectClass = "h-10 min-w-0 rounded-lg border border-border bg-white px-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10";
  const statusClass = (result: string) => result === "SUCCESS" ? "bg-success-soft text-success-foreground" : "bg-danger-soft text-destructive";

  return (
    <AppShell title="Audit Log" subtitle="Administrator record of operational changes across every module." actions={<div className="flex gap-2"><Button variant="outline" className="h-10 w-10 rounded-lg bg-white px-0" aria-label="Reload audit data" title="Reload audit data" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} /></Button><Button variant="outline" className="rounded-lg bg-white shadow-sm" onClick={exportCsv}><Download /> Export Logs</Button></div>}>
      <div className={`grid items-start gap-4 ${selected ? "xl:grid-cols-[minmax(0,1fr)_340px]" : ""}`}>
        <div className="min-w-0 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "Total activities", value: rows.length, icon: Activity, tone: "border-blue-200 bg-blue-50/70 text-primary" },
              { label: "Successful actions", value: successful, icon: ShieldCheck, tone: "border-green-200 bg-green-50/70 text-green-700" },
              { label: "Failed actions", value: failed, icon: TriangleAlert, tone: "border-red-200 bg-red-50/70 text-red-600" },
              { label: "Unique users", value: userOptions.length, icon: Users, tone: "border-sky-200 bg-sky-50/70 text-sky-700" },
            ].map(({ label, value, icon: Icon, tone }) => <Card key={label} className={`rounded-xl border shadow-sm ${tone}`}><CardContent className="flex min-h-[82px] items-center gap-3 p-4"><span className="rounded-xl bg-white/80 p-2.5 shadow-sm"><Icon className="size-5" /></span><div><p className="text-xs font-medium opacity-80">{label}</p><p className="mt-0.5 text-2xl font-bold leading-none text-foreground">{value}</p></div></CardContent></Card>)}
          </div>

          <Card className="overflow-hidden rounded-xl border-border bg-white shadow-sm"><CardContent className="p-0">
            <div className="space-y-3 border-b border-border p-4">
              <div className="grid gap-2.5 lg:grid-cols-[minmax(240px,1fr)_160px_160px]">
                <label className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><input value={filters.search} onChange={(event) => updateFilter("search", event.target.value)} placeholder="Search user, action, module, or target..." className="h-10 w-full rounded-lg border border-border bg-white pl-9 pr-3 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/10" /></label>
                <label className="relative"><CalendarDays className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><input type="date" max={filters.to || undefined} value={filters.from} onChange={(event) => updateFilter("from", event.target.value)} className="h-10 w-full rounded-lg border border-border bg-white pl-9 pr-2 text-sm outline-none focus:border-primary" aria-label="From date" /></label>
                <label className="relative"><CalendarDays className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><input type="date" min={filters.from || undefined} value={filters.to} onChange={(event) => updateFilter("to", event.target.value)} className="h-10 w-full rounded-lg border border-border bg-white pl-9 pr-2 text-sm outline-none focus:border-primary" aria-label="To date" /></label>
              </div>
              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto_auto]">
                <select value={filters.module} onChange={(event) => updateFilter("module", event.target.value)} className={selectClass}><option value="">All modules</option>{modules.map((module) => <option key={module}>{module}</option>)}</select>
                <select value={filters.action} onChange={(event) => updateFilter("action", event.target.value)} className={selectClass}><option value="">All actions</option>{actions.map((action) => <option key={action}>{action}</option>)}</select>
                <select value={filters.user} onChange={(event) => updateFilter("user", event.target.value)} className={selectClass}><option value="">All users</option>{userOptions.map((user) => <option key={user}>{user}</option>)}</select>
                <select value={filters.result} onChange={(event) => updateFilter("result", event.target.value)} className={selectClass}><option value="">All results</option><option>SUCCESS</option><option>FAILED</option></select>
                <Button variant="outline" className="rounded-lg" onClick={() => setFilters(EMPTY_FILTERS)}>Clear</Button>
                <Button className="rounded-lg" onClick={() => setPage(1)}><Search /> Search</Button>
              </div>
            </div>

            {loading ? <div className="flex h-64 items-center justify-center text-primary"><Loader2 className="animate-spin" /></div> : <div className="overflow-x-auto">
              <table className="w-full min-w-[930px] text-left text-sm"><thead className="border-b border-border bg-blue-50 text-xs font-semibold text-foreground"><tr><th className="px-3 py-3">Date &amp; time</th><th className="px-3">User</th><th className="px-3">Module</th><th className="px-3">Action</th><th className="px-3">Target</th><th className="px-3">Result</th><th className="px-3">IP address</th><th className="px-3 text-right">Actions</th></tr></thead>
                <tbody>{pageRows.map((row) => <tr key={row.id} className="border-b border-border/70 transition-colors last:border-0 hover:bg-blue-50/50"><td className="whitespace-nowrap px-3 py-2.5"><div className="text-xs font-medium">{shortDate(row.occurred_at)}</div><div className="text-[11px] text-muted-foreground">{shortTime(row.occurred_at)}</div></td><td className="px-3"><div className="flex items-center gap-2"><span className="rounded-md bg-blue-50 p-1.5 text-primary"><UserRound className="size-3.5" /></span><div className="min-w-0"><div className="font-semibold">{row.actor_username}</div><div className="text-[11px] text-muted-foreground">{row.actor_employee_id || row.actor_roles || "—"}</div></div></div></td><td className="px-3 text-xs font-medium">{displayModule(row)}</td><td className="px-3 text-xs">{displayAction(row)}</td><td className="max-w-40 truncate px-3 text-xs text-muted-foreground" title={row.target_reference || row.request_path}>{row.target_reference || "—"}</td><td className="px-3"><span className={`inline-flex rounded-md px-2 py-1 text-[10px] font-bold ${statusClass(row.result)}`}>{row.result}</span></td><td className="px-3 text-xs text-muted-foreground">{row.ip_address || "—"}</td><td className="px-3 text-right"><Button size="sm" variant="outline" className="h-8 rounded-md border-blue-200 px-2.5 text-primary hover:bg-blue-50" onClick={() => setSelected(row)}><Eye className="size-3.5" /> View</Button></td></tr>)}</tbody>
              </table>{!pageRows.length && <div className="flex flex-col items-center gap-2 py-14 text-center"><FileClock className="size-8 text-muted-foreground/50" /><p className="text-sm text-muted-foreground">No audit events match these filters.</p></div>}
            </div>}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-white px-4 py-3 text-xs text-muted-foreground"><span>Showing {filteredRows.length ? (page - 1) * PAGE_SIZE + 1 : 0}–{Math.min(page * PAGE_SIZE, filteredRows.length)} of {filteredRows.length} logs</span><div className="flex gap-1"><Button size="sm" variant="outline" className="h-8" disabled={page === 1} onClick={() => setPage((current) => current - 1)}>Previous</Button>{Array.from({ length: pageCount }, (_, index) => index + 1).slice(Math.max(0, page - 3), Math.max(5, page + 2)).map((number) => <Button key={number} size="sm" className="h-8 min-w-8" variant={number === page ? "default" : "outline"} onClick={() => setPage(number)}>{number}</Button>)}<Button size="sm" variant="outline" className="h-8" disabled={page === pageCount} onClick={() => setPage((current) => current + 1)}>Next</Button></div></div>
          </CardContent></Card>
        </div>

        {selected && <Card className="overflow-hidden rounded-xl border-border bg-white shadow-sm xl:sticky xl:top-5"><CardContent className="p-0">
          <div className="flex items-start justify-between border-b border-border bg-blue-50/70 p-4"><div><div className="mb-1 flex items-center gap-2 text-primary"><ShieldCheck className="size-4" /><span className="text-[11px] font-semibold uppercase tracking-wide">Activity record</span></div><h2 className="text-lg font-bold text-foreground">Audit log details</h2><span className={`mt-2 inline-flex rounded-md px-2.5 py-1 text-[10px] font-bold ${statusClass(selected.result)}`}>{selected.result}</span></div><button aria-label="Close audit details" onClick={() => setSelected(null)} className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-white hover:text-foreground"><X className="size-4" /></button></div>
          <div className="max-h-[calc(100vh-210px)] space-y-4 overflow-y-auto p-4">{detailSections.map(({ title, icon: Icon, details }) => <section key={title}><h3 className="mb-2 flex items-center gap-2 text-xs font-bold text-foreground"><span className="rounded-md bg-blue-50 p-1.5 text-primary"><Icon className="size-3.5" /></span>{title}</h3><dl className="overflow-hidden rounded-lg border border-border bg-white">{details.map(([label, value]) => <div key={label} className="grid grid-cols-[100px_minmax(0,1fr)] gap-2 border-b border-border/70 px-3 py-2 text-xs last:border-0"><dt className="text-muted-foreground">{label}</dt><dd className="min-w-0 break-all font-medium text-foreground">{String(value)}</dd></div>)}</dl></section>)}</div>
        </CardContent></Card>}
      </div>
    </AppShell>
  );
}
