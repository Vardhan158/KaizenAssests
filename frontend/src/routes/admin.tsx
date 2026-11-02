import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Boxes,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Clock3,
  FileText,
  LayoutDashboard,
  PackageCheck,
  RefreshCw,
  Search,
  ShieldCheck,
  Truck,
  Users,
  Warehouse,
  XCircle,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import adminDashboardHero from "@/assets/admin-dashboard-hero.png";
import { api } from "@/lib/api-client";
import { requireRole } from "@/lib/auth-utils";
import { toast } from "sonner";

export const Route = createFileRoute("/admin")({
  beforeLoad: () => requireRole(["ADMIN", "SUPERUSER", "SUPER_ADMIN"]),
  component: AdminRoute,
});

type OverviewUser = {
  id: string;
  employee_id?: string | null;
  full_name?: string | null;
  username?: string | null;
  role?: string | null;
  status?: string | null;
  kpis?: { work_items?: number; pages?: number };
};

type AdminModule = {
  key: string;
  name: string;
  route?: string | null;
  description?: string | null;
  users: OverviewUser[];
  assembly_units?: Array<{
    id?: string;
    name?: string;
    code?: string;
    route?: string;
    status?: string;
    users?: OverviewUser[];
  }>;
};

type Overview = {
  users: { total: number; active: number; inactive: number };
  operations: { gate_entries: number; grns: number; assembly_orders: number; warehouses: number; active_warehouses: number };
  modules: AdminModule[];
};

type AuditEvent = {
  id: string;
  occurred_at?: string;
  actor_username?: string;
  module?: string;
  action?: string;
  description?: string;
  target?: string;
  target_reference?: string | null;
  request_path?: string;
  result?: string;
};

const BLUE = "#0874c4";
const PIE_COLORS = ["#0874c4", "#10a56b", "#f59e0b", "#8b5cf6", "#ef4444", "#14b8a6"];

function timestampOf(event: AuditEvent): Date | null {
  const value = event.occurred_at;
  if (!value) return null;
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function eventLabel(event: AuditEvent) {
  const method = (event.action || "").toUpperCase();
  const httpMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
  if (event.description && !httpMethods.has(event.description.trim().toUpperCase())) return event.description;
  if (method === "LOGIN" || method === "LOGOUT") return method === "LOGIN" ? "Login" : "Logout";
  if (!httpMethods.has(method)) return event.action || event.description || "Application activity";

  const targetReference = String(event.target_reference || event.target || "");
  const isIdentifier = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(targetReference)
    || /^[\da-f]{24,}$/i.test(targetReference)
    || /^\d+$/.test(targetReference);
  const routeTarget = (event.request_path || "").split("/").filter((part) => part
    && !["api", "v1"].includes(part.toLowerCase())
    && !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(part)
    && !/^\d+$/.test(part)).at(-1);
  const rawTarget = isIdentifier || !targetReference ? routeTarget || event.module || "Record" : targetReference;
  const target = rawTarget.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const targetLower = target.toLowerCase();
  if (targetLower.includes("assembly unit")) return `${method === "POST" ? "Create" : "Update"} Assembly Unit`;
  if (targetLower.includes("user")) return `${method === "POST" ? "Create" : "Update"} User`;
  const verb = method === "POST" ? "Create" : method === "DELETE" ? "Remove" : method === "GET" ? "View" : "Update";
  return `${verb} ${target}`;
}

function isActive(user: OverviewUser) {
  return !user.status || ["active", "enabled"].includes(user.status.toLowerCase());
}

function initials(name?: string | null) {
  return (name || "U").trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

function AdminRoute() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [expandedModuleKey, setExpandedModuleKey] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [summary, audit] = await Promise.all([
        api.getAdminOverview(),
        api.getAdminAuditLogs({ limit: 500, offset: 0 }),
      ]);
      setOverview(summary as Overview);
      const rows = audit.items ?? [];
      setEvents(rows.slice().sort((a, b) => (timestampOf(b)?.getTime() ?? 0) - (timestampOf(a)?.getTime() ?? 0)));
      setRefreshedAt(new Date());
    } catch (error: any) {
      toast.error(error.message || "Could not load administration overview");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const modules = overview?.modules ?? [];
  const allUsers = useMemo(() => {
    const users = new Map<string, OverviewUser>();
    modules.forEach((module) => {
      [...(module.users ?? []), ...(module.assembly_units ?? []).flatMap((unit) => unit.users ?? [])]
        .forEach((member) => users.set(member.id, member));
    });
    return [...users.values()];
  }, [modules]);
  const activeCount = overview?.users.active ?? allUsers.filter(isActive).length;
  const inactiveCount = overview?.users.inactive ?? Math.max(0, (overview?.users.total ?? allUsers.length) - activeCount);

  const activityByDay = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(now);
      date.setDate(now.getDate() - (6 - index));
      const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      const count = events.filter((event) => {
        const stamp = timestampOf(event);
        return stamp && `${stamp.getFullYear()}-${stamp.getMonth()}-${stamp.getDate()}` === key;
      }).length;
      return { key, day: date.toLocaleDateString(undefined, { weekday: "short" }), events: count };
    });
  }, [events]);

  const moduleActivity = useMemo(() => {
    const totals = new Map<string, number>();
    events.forEach((event) => {
      const name = event.module || "Other";
      totals.set(name, (totals.get(name) ?? 0) + 1);
    });
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, value]) => ({ name, value }));
  }, [events]);

  const visibleModules = modules.filter((module) => {
    const moduleUsers = [...(module.users ?? []), ...(module.assembly_units ?? []).flatMap((unit) => unit.users ?? [])];
    const units = (module.assembly_units ?? []).map((unit) => `${unit.name ?? ""} ${unit.code ?? ""}`).join(" ");
    const text = `${module.name} ${module.description ?? ""} ${units} ${moduleUsers.map((member) => `${member.full_name ?? ""} ${member.username ?? ""}`).join(" ")}`.toLowerCase();
    return text.includes(query.toLowerCase());
  });

  const stats = [
    { label: "Total users", value: overview?.users.total ?? allUsers.length, detail: `${activeCount} active accounts`, icon: Users, color: "blue" },
    { label: "Active users", value: activeCount, detail: `${inactiveCount} inactive accounts`, icon: CheckCircle2, color: "green" },
    { label: "Gate entries", value: overview?.operations.gate_entries ?? 0, detail: "Recorded operations", icon: Truck, color: "violet" },
    { label: "Goods receipts", value: overview?.operations.grns ?? 0, detail: "GRN records", icon: PackageCheck, color: "amber" },
    { label: "Assembly orders", value: overview?.operations.assembly_orders ?? 0, detail: "Assembly workflow", icon: Boxes, color: "cyan" },
    { label: "Warehouses", value: overview?.operations.warehouses ?? 0, detail: `${overview?.operations.active_warehouses ?? 0} active locations`, icon: Warehouse, color: "rose" },
  ];

  const workspaceCards = [
    {
      title: "User management",
      description: "Maintain staff accounts, roles, and page access.",
      icon: Users,
      tone: "bg-blue-50 text-blue-700",
      actions: [{ label: "Manage user accounts", to: "/admin/users" }],
    },
    {
      title: "Audit and security",
      description: "Review sign-ins and changes made across the application.",
      icon: ShieldCheck,
      tone: "bg-violet-50 text-violet-700",
      actions: [
        { label: "Audit log", to: "/admin/audit" },
        { label: "Activity monitoring", to: "/admin/operations" },
      ],
    },
    {
      title: "Supplier management",
      description: "Review supplier profiles, accounts, and operational activity.",
      icon: Building2,
      tone: "bg-emerald-50 text-emerald-700",
      actions: [
        { label: "Supplier directory", to: "/admin/suppliers" },
        { label: "Supplier access", to: "/admin/users" },
      ],
    },
    {
      title: "Operational monitoring",
      description: "See workload and activity across the operating teams.",
      icon: Activity,
      tone: "bg-amber-50 text-amber-700",
      actions: [
        { label: "Monitoring overview", to: "/admin/operations" },
        { label: "Gate dashboard", to: "/gate-dashboard" },
        { label: "GRN dashboard", to: "/grn?tab=dashboard" },
        { label: "Warehouse dashboard", to: "/inventory?tab=dashboard" },
      ],
    },
  ];

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="relative min-h-[270px] overflow-hidden rounded-2xl border border-white/70 bg-white/35 shadow-sm backdrop-blur-sm sm:min-h-[300px]">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0">
            <img src={adminDashboardHero} alt="" className="h-full w-full object-cover object-center opacity-100" style={{ filter: "brightness(0.82) contrast(1.18) saturate(1.08)" }} />
            <div className="absolute inset-0 bg-gradient-to-r from-white/55 via-white/15 to-transparent" />
          </div>
          <div className="relative flex min-h-[270px] flex-col gap-5 p-6 sm:min-h-[300px] sm:p-8 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/50 bg-blue-700/65 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-white">
                <ShieldCheck className="h-4 w-4 text-white" /> System administration
              </div>
              <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Administration overview</h1>
              <p className="mt-2 max-w-xl text-sm leading-6 text-[#111111] sm:text-base">A live view of people, operational workspaces, and activity across your organization.</p>
              <p className="mt-4 flex items-center gap-2 text-xs text-[#111111]"><Clock3 className="h-3.5 w-3.5 text-[#111111]" />{refreshedAt ? `Updated ${refreshedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Loading current data"}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="h-10 w-10 border-white/50 bg-slate-900/35 px-0 text-white hover:bg-slate-900/55 hover:text-white" aria-label="Reload administration data" title="Reload administration data" onClick={() => void load(true)} disabled={loading}><RefreshCw className={`h-4 w-4 text-white ${loading ? "animate-spin" : ""}`} /></Button>
              <Button asChild variant="outline" className="border-white/50 bg-slate-900/35 text-white hover:bg-slate-900/55 hover:text-white"><Link to="/admin/audit"><FileText className="mr-2 h-4 w-4 text-white" />Audit log</Link></Button>
              <Button asChild><Link to="/admin/users"><Users className="mr-2 h-4 w-4" />Manage users<ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
            </div>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {stats.map(({ label, value, detail, icon: Icon, color }) => (
            <Card key={label} className="group relative overflow-hidden border-slate-200 p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
              <div className={`absolute right-0 top-0 h-24 w-24 -translate-y-8 translate-x-8 rounded-full opacity-50 blur-2xl ${color === "blue" ? "bg-blue-200" : color === "green" ? "bg-emerald-200" : color === "violet" ? "bg-violet-200" : color === "amber" ? "bg-amber-200" : color === "cyan" ? "bg-cyan-200" : "bg-rose-200"}`} />
              <div className="relative grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3">
                <div className="min-w-0"><p className="text-sm font-medium text-slate-500">{label}</p><p className="mt-1.5 text-2xl font-bold tracking-tight text-slate-900">{loading ? "—" : value.toLocaleString()}</p><p className="mt-1 text-[11px] text-slate-500">{detail}</p></div>
                <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${color === "blue" ? "bg-blue-50 text-blue-700" : color === "green" ? "bg-emerald-50 text-emerald-700" : color === "violet" ? "bg-violet-50 text-violet-700" : color === "amber" ? "bg-amber-50 text-amber-700" : color === "cyan" ? "bg-cyan-50 text-cyan-700" : "bg-rose-50 text-rose-700"}`}><Icon className="h-4 w-4" /></div>
                <div className="flex h-12 items-end justify-end gap-1 text-blue-600" role="img" aria-label={`${label} activity over the last seven days`}>
                  {activityByDay.map((day, index) => {
                    const category = label === "Total users" || label === "Active users" ? /user|auth|access/i : label === "Gate entries" ? /gate/i : label === "Goods receipts" ? /grn|receiv/i : label === "Assembly orders" ? /assembly/i : /warehouse|inventory/i;
                    const count = events.filter((event) => {
                      const stamp = timestampOf(event);
                      return stamp && `${stamp.getFullYear()}-${stamp.getMonth()}-${stamp.getDate()}` === day.key && (!category || category.test(`${event.module || ""} ${event.action || ""} ${event.target || ""}`));
                    }).length;
                    const series = activityByDay.map((item) => events.filter((event) => {
                      const stamp = timestampOf(event);
                      return stamp && `${stamp.getFullYear()}-${stamp.getMonth()}-${stamp.getDate()}` === item.key && (!category || category.test(`${event.module || ""} ${event.action || ""} ${event.target || ""}`));
                    }).length);
                    const maxEvents = Math.max(1, ...series);
                    return <span key={day.key} title={`${day.day}: ${count} events`} className="w-1.5 rounded-t-sm bg-current transition-opacity" style={{ height: `${count ? Math.max(5, count / maxEvents * 40) : 3}px`, opacity: count ? 0.45 + index * 0.07 : 0.16 }} />;
                  })}
                </div>
              </div>
            </Card>
          ))}
        </section>

        <section className="space-y-3 rounded-2xl border border-white/70 bg-white/30 p-4 shadow-sm backdrop-blur-sm sm:p-5">
          <div className="flex flex-wrap items-end justify-between gap-2"><div><h2 className="text-lg font-semibold text-slate-900">Administration workspaces</h2><p className="mt-1 text-sm text-slate-500">Open a management area; its full page loads in this application.</p></div><span className="text-xs text-slate-500">4 workspaces</span></div>
          <div className="grid items-stretch gap-3 sm:grid-cols-2 2xl:grid-cols-4">
            {workspaceCards.map(({ title, description, icon: Icon, tone, actions }) => <Card key={title} className="flex h-full flex-col border-white/80 bg-white/45 p-3.5 shadow-sm backdrop-blur-sm transition hover:-translate-y-0.5 hover:bg-white/65 hover:shadow-md">
              <div className="flex items-start gap-2.5"><span className={`rounded-lg p-2 ${tone}`}><Icon className="h-4 w-4" /></span><div className="min-w-0"><h3 className="text-sm font-semibold text-slate-900">{title}</h3><p className="mt-1 min-h-9 text-[11px] leading-4 text-slate-500">{description}</p></div></div>
              <div className="mt-3 grid grid-cols-1 gap-1.5">
                {actions.map(({ label, to }) => <Button key={`${label}-${to}`} asChild size="sm" variant="outline" className="w-full justify-between border-white/80 bg-white/45 text-left hover:border-blue-200 hover:bg-blue-50"><Link to={to as any}>{label}<ArrowUpRight className="h-4 w-4" /></Link></Button>)}
              </div>
            </Card>)}
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(340px,1fr)]">
          <Card className="min-w-0 border-slate-200 p-5 shadow-sm sm:p-6">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
              <div><h2 className="text-lg font-semibold text-slate-900">Application activity</h2><p className="mt-1 text-sm text-slate-500">Audit events recorded over the last seven days</p></div>
              <Link to="/admin/audit" className="inline-flex items-center gap-1 text-sm font-semibold text-blue-700 hover:text-blue-800">Open audit log<ArrowRight className="h-4 w-4" /></Link>
            </div>
            <div className="h-[260px] w-full" aria-label="Audit events in the last seven days">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={activityByDay} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                  <defs><linearGradient id="adminActivityFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={BLUE} stopOpacity={0.24} /><stop offset="95%" stopColor={BLUE} stopOpacity={0.01} /></linearGradient></defs>
                  <CartesianGrid stroke="#e7edf5" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: "#64748b", fontSize: 12 }} dy={8} />
                  <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: "#64748b", fontSize: 12 }} />
                  <Tooltip contentStyle={{ borderRadius: 12, borderColor: "#dbe4ef", boxShadow: "0 8px 24px rgba(15, 23, 42, .08)" }} />
                  <Area type="monotone" dataKey="events" name="Events" stroke={BLUE} strokeWidth={2.5} fill="url(#adminActivityFill)" activeDot={{ r: 5, strokeWidth: 0 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-4 text-sm"><span className="text-slate-500">Events in the selected period</span><span className="font-semibold text-slate-900">{activityByDay.reduce((sum, day) => sum + day.events, 0).toLocaleString()}</span></div>
          </Card>

          <Card className="border-slate-200 p-5 shadow-sm sm:p-6">
            <div className="mb-2"><h2 className="text-lg font-semibold text-slate-900">Activity by module</h2><p className="mt-1 text-sm text-slate-500">Where audit events are being recorded</p></div>
            {moduleActivity.length ? <div className="grid grid-cols-[minmax(130px,0.9fr)_minmax(0,1fr)] items-center gap-1">
              <div className="h-[210px]"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={moduleActivity} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="82%" paddingAngle={3} stroke="none">{moduleActivity.map((entry, index) => <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />)}</Pie><Tooltip contentStyle={{ borderRadius: 12, borderColor: "#dbe4ef" }} /></PieChart></ResponsiveContainer></div>
              <div className="space-y-3">{moduleActivity.map((item, index) => <div key={item.name} className="flex items-center gap-2 text-sm"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }} /><span className="min-w-0 flex-1 truncate text-slate-600">{item.name}</span><span className="font-semibold text-slate-900">{item.value}</span></div>)}</div>
            </div> : <div className="flex h-[220px] flex-col items-center justify-center text-center"><div className="rounded-full bg-slate-100 p-3 text-slate-400"><Activity className="h-5 w-5" /></div><p className="mt-3 text-sm font-medium text-slate-700">No activity data yet</p><p className="mt-1 text-xs text-slate-500">Events will appear here as users work.</p></div>}
            <div className="mt-1 rounded-xl bg-slate-50 px-4 py-3"><p className="text-xs font-medium uppercase tracking-wide text-slate-500">User accounts</p><div className="mt-2 flex items-center justify-between"><span className="text-sm text-slate-600">Active</span><span className="text-sm font-semibold text-slate-900">{activeCount} <span className="font-normal text-slate-400">/ {overview?.users.total ?? allUsers.length}</span></span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${(overview?.users.total ?? allUsers.length) ? activeCount / (overview?.users.total ?? allUsers.length) * 100 : 0}%` }} /></div></div>
          </Card>
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(350px,1fr)]">
          <Card className="min-w-0 overflow-hidden border-slate-200 shadow-sm">
            <div className="flex flex-col gap-4 border-b border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
              <div><h2 className="text-lg font-semibold text-slate-900">Module access</h2><p className="mt-1 text-sm text-slate-500">Teams and workspaces across the application</p></div>
              <label className="relative block w-full sm:max-w-xs"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search modules or users" className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100" /></label>
            </div>
            <div className="grid items-stretch gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
              {visibleModules.map((module) => {
                const unitMembers = (module.assembly_units ?? []).flatMap((unit) => unit.users ?? []);
                const members = [...new Map([...(module.users ?? []), ...unitMembers].map((member) => [member.id, member])).values()];
                const activeMembers = members.filter(isActive).length;
                const workItems = members.reduce((total, member) => total + (member.kpis?.work_items ?? 0), 0);
                const isExpanded = expandedModuleKey === module.key;
                return <Card key={module.key} className="flex h-full flex-col border-slate-200 p-3.5 shadow-sm transition hover:border-blue-200 hover:shadow-md">
                  <div className="flex items-start gap-2.5"><div className="rounded-lg bg-blue-50 p-2 text-blue-700"><LayoutDashboard className="h-4 w-4" /></div><div className="min-w-0 flex-1"><h3 className="text-sm font-semibold text-slate-900">{module.name}</h3><p className="mt-1 line-clamp-2 min-h-8 text-xs leading-4 text-slate-500">{module.description || "Operational workspace and access assignments"}</p></div><span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-600">{members.length} members</span></div>
                  {isExpanded && <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
                    <div className="grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-2.5 text-center"><div><p className="text-base font-bold text-slate-900">{members.length}</p><p className="text-[10px] text-slate-500">Members</p></div><div><p className="text-base font-bold text-emerald-700">{activeMembers}</p><p className="text-[10px] text-slate-500">Active</p></div><div><p className="text-base font-bold text-slate-900">{workItems}</p><p className="text-[10px] text-slate-500">Work items</p></div></div>
                    {!!module.assembly_units?.length && <div className="space-y-1.5"><p className="text-[11px] font-semibold text-slate-600">Assembly units</p>{module.assembly_units.map((unit) => <Link key={unit.code || unit.id || unit.name} to={(unit.route || module.route || "/admin/users") as any} className="flex items-center justify-between gap-2 rounded-md border border-slate-100 px-2.5 py-1.5 text-[11px] hover:border-blue-200 hover:bg-blue-50"><span className="min-w-0 truncate font-medium text-slate-700">{unit.name || unit.code}</span><span className="shrink-0 text-slate-500">{unit.status || "Active"}<ArrowUpRight className="ml-1 inline h-3 w-3" /></span></Link>)}</div>}
                    <div><div className="mb-1.5 flex items-center justify-between"><p className="text-[11px] font-semibold text-slate-600">Team members</p><span className="text-[10px] text-slate-400">{members.length}</span></div>{members.length ? <div className="flex flex-wrap gap-1">{members.map((member) => <span key={member.id} title={`${member.full_name || member.username} · ${member.role || "User"}`} className="inline-flex max-w-full items-center gap-1 rounded-full border border-slate-200 bg-white py-0.5 pl-0.5 pr-1.5 text-[10px] text-slate-700"><span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[8px] font-bold text-blue-700">{initials(member.full_name || member.username)}</span><span className="max-w-28 truncate">{member.full_name || member.username || "User"}</span></span>)}</div> : <p className="text-[11px] text-slate-400">No members assigned</p>}</div>
                  </div>}
                  <div className="mt-auto grid grid-cols-2 gap-2 pt-3"><Button variant="outline" size="sm" className="w-full px-2" aria-expanded={isExpanded} onClick={() => setExpandedModuleKey(isExpanded ? null : module.key)}>{isExpanded ? "Hide details" : "View details"}{isExpanded ? <ChevronUp className="ml-1 h-3.5 w-3.5" /> : <ChevronDown className="ml-1 h-3.5 w-3.5" />}</Button><Button asChild variant="default" size="sm" className="w-full px-2"><Link to={(module.route || "/admin/users") as any}>Open page<ArrowUpRight className="ml-1 h-3.5 w-3.5" /></Link></Button></div>
                </Card>;
              })}
              {!visibleModules.length && <div className="col-span-full px-6 py-12 text-center"><div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400"><Search className="h-5 w-5" /></div><p className="mt-3 text-sm font-medium text-slate-800">No matching modules</p><p className="mt-1 text-sm text-slate-500">Try another module or user name.</p></div>}
            </div>
            <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50/70 px-5 py-3 text-xs text-slate-500 sm:px-6"><span>{visibleModules.length} of {modules.length} modules</span><Link to="/admin/users" className="font-semibold text-blue-700 hover:text-blue-800">Configure access <ArrowRight className="ml-1 inline h-3.5 w-3.5" /></Link></div>
          </Card>

          <Card className="min-w-0 border-slate-200 p-5 shadow-sm sm:p-6">
            <div className="mb-5 flex items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-slate-900">Recent activity</h2><p className="mt-1 text-sm text-slate-500">Latest actions from all users</p></div><Link to="/admin/audit" aria-label="View all audit activity" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-blue-700"><ArrowUpRight className="h-4 w-4" /></Link></div>
            <div className="space-y-0">
              {events.slice(0, 6).map((event, index) => {
                const stamp = timestampOf(event);
                const failed = (event.result || "").toLowerCase() === "failed" || (event.result || "").toLowerCase() === "failure";
                const target = event.target || event.target_reference || event.request_path;
                return <div key={event.id || `${event.action}-${index}`} className="relative flex gap-3 pb-5 last:pb-0"><div className="relative flex w-9 shrink-0 justify-center"><span className={`z-10 flex h-8 w-8 items-center justify-center rounded-full ${failed ? "bg-red-50 text-red-600" : "bg-blue-50 text-blue-700"}`}>{failed ? <XCircle className="h-4 w-4" /> : <Activity className="h-4 w-4" />}</span>{index < Math.min(events.length, 6) - 1 && <span className="absolute top-8 h-full w-px bg-slate-200" />}</div><div className="min-w-0 flex-1 pt-0.5"><div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1"><p className="truncate text-sm font-semibold text-slate-800">{eventLabel(event)}</p><span className="shrink-0 text-[11px] text-slate-400">{stamp ? stamp.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""}</span></div><p className="mt-1 truncate text-xs text-slate-500">{event.actor_username || "System"}<span className="mx-1.5 text-slate-300">·</span>{event.module || "Application"}{target ? <><span className="mx-1.5 text-slate-300">·</span>{target}</> : null}</p></div></div>;
              })}
              {!events.length && !loading && <div className="flex min-h-48 flex-col items-center justify-center text-center"><div className="rounded-full bg-slate-100 p-3 text-slate-400"><ClipboardList className="h-5 w-5" /></div><p className="mt-3 text-sm font-medium text-slate-700">No audit events available</p><p className="mt-1 max-w-xs text-xs text-slate-500">User sign-ins and actions will appear here when recorded.</p></div>}
              {loading && !events.length && <div className="space-y-4 py-2">{Array.from({ length: 4 }, (_, index) => <div key={index} className="flex animate-pulse gap-3"><span className="h-8 w-8 rounded-full bg-slate-100" /><span className="flex-1"><span className="block h-3 w-3/4 rounded bg-slate-100" /><span className="mt-2 block h-2.5 w-1/2 rounded bg-slate-100" /></span></div>)}</div>}
            </div>
            {!!events.length && <Link to="/admin/audit" className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700">View all activity<ArrowRight className="h-4 w-4" /></Link>}
          </Card>
        </section>

        <footer className="flex flex-col gap-2 border-t border-slate-200 py-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between"><span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />System administration overview</span></footer>
      </main>
    </AppShell>
  );
}
