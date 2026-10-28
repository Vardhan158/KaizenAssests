import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ClipboardList, Loader2, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api-client";
import { requireRole } from "@/lib/auth-utils";

export const Route = createFileRoute("/admin_/audit")({
  beforeLoad: () => requireRole(["ADMIN", "SUPERUSER", "SUPER_ADMIN"]),
  component: AdminAuditPage,
});

type AuditRow = {
  id: string;
  actor_username: string;
  actor_employee_id?: string | null;
  actor_roles?: string | null;
  module: string;
  action: string;
  request_path: string;
  target_reference?: string | null;
  status_code: number;
  result: string;
  request_id?: string | null;
  ip_address?: string | null;
  occurred_at: string;
};

function AdminAuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ module: "", actor: "", action: "", result: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getAdminAuditLogs({ ...filters, limit: 250 });
      setRows(data.items || []);
      setTotal(data.total || 0);
    } catch (error: any) {
      toast.error(error.message || "Unable to load audit log");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { void load(); }, [load]);

  return (
    <AppShell title="Audit Log" subtitle="Administrator record of operational changes across every module">
      <div className="space-y-5 p-4 md:p-6">
        <Card>
          <CardHeader className="gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div><CardTitle className="flex items-center gap-2"><ClipboardList className="text-primary" /> System audit log</CardTitle><p className="mt-1 text-sm text-muted-foreground">{total} recorded actions</p></div>
            <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} /> Refresh</Button>
          </CardHeader>
          <CardContent>
            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <label className="relative lg:col-span-2"><Search className="absolute left-3 top-3 size-4 text-muted-foreground" /><input value={filters.actor} onChange={(e) => setFilters({ ...filters, actor: e.target.value })} placeholder="Search user..." className="h-10 w-full rounded-md border bg-background pl-9 pr-3 text-sm" /></label>
              <input value={filters.module} onChange={(e) => setFilters({ ...filters, module: e.target.value.toUpperCase() })} placeholder="Module" className="h-10 rounded-md border bg-background px-3 text-sm" />
              <select value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })} className="h-10 rounded-md border bg-background px-3 text-sm"><option value="">All actions</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option></select>
              <select value={filters.result} onChange={(e) => setFilters({ ...filters, result: e.target.value })} className="h-10 rounded-md border bg-background px-3 text-sm"><option value="">All results</option><option>SUCCESS</option><option>FAILED</option></select>
            </div>
            {loading ? <div className="flex h-48 items-center justify-center"><Loader2 className="animate-spin" /></div> : (
              <div className="overflow-x-auto"><table className="w-full min-w-[950px] text-left text-sm"><thead className="border-b text-xs uppercase text-muted-foreground"><tr><th className="py-3">Time</th><th>User</th><th>Module</th><th>Action</th><th>Target</th><th>Result</th><th>Request</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-b last:border-0"><td className="whitespace-nowrap py-3">{new Date(row.occurred_at).toLocaleString()}</td><td><div className="font-semibold">{row.actor_username}</div><div className="text-xs text-muted-foreground">{row.actor_employee_id || row.actor_roles || "—"}</div></td><td>{row.module}</td><td className="font-mono text-xs">{row.action}</td><td><div>{row.target_reference || "—"}</div><div className="max-w-72 truncate text-xs text-muted-foreground" title={row.request_path}>{row.request_path}</div></td><td><span className={row.result === "SUCCESS" ? "font-semibold text-emerald-600" : "font-semibold text-destructive"}>{row.result}</span><div className="text-xs text-muted-foreground">HTTP {row.status_code}</div></td><td><div className="font-mono text-xs">{row.request_id?.slice(0, 8) || "—"}</div><div className="text-xs text-muted-foreground">{row.ip_address || ""}</div></td></tr>)}</tbody></table>{!rows.length && <p className="py-12 text-center text-muted-foreground">No audit events match these filters.</p>}</div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
