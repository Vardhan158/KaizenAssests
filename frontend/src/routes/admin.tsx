import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Activity,
  ArrowRight,
  Boxes,
  Factory,
  FileBarChart,
  Loader2,
  ShieldCheck,
  Truck,
  UserCheck,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AppShell } from "@/components/wms/app-shell";
import { api } from "@/lib/api-client";
import { requireRole } from "@/lib/auth-utils";

export const Route = createFileRoute("/admin")({
  beforeLoad: () => requireRole(["ADMIN", "SUPERUSER", "SUPER_ADMIN"]),
  component: AdminPage,
});

type AdminOverview = {
  users?: { total?: number; active?: number; inactive?: number };
  operations?: {
    gate_entries?: number;
    grns?: number;
    assembly_orders?: number;
    dispatches?: number;
  };
  modules?: AdminModule[];
};

type AdminModuleUser = {
  id: string;
  employee_id: string;
  full_name: string;
  username: string;
  role: string;
  shift_name?: string | null;
  assembly_unit_code?: string | null;
  status: string;
  last_login?: string | null;
  kpis?: { work_items?: number; pages?: number };
};

type AdminModule = {
  key: string;
  name: string;
  route: string;
  description: string;
  users: AdminModuleUser[];
  assembly_units?: Array<{
    code: string;
    name: string;
    route: string;
    users: AdminModuleUser[];
  }>;
};

function userWorkspaceUrl(route: string, user: AdminModuleUser, report = false) {
  const separator = route.includes("?") ? "&" : "?";
  const params = new URLSearchParams({
    admin_user: user.id,
    admin_user_name: user.full_name,
  });
  if (report) params.set("view", "reports");
  return `${route}${separator}${params.toString()}`;
}

function AdminPage() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadOverview = async () => {
      try {
        setOverview(await api.getAdminOverview());
      } catch (error: any) {
        toast.error(error.message || "Unable to load administration data");
      } finally {
        setLoading(false);
      }
    };
    void loadOverview();
  }, []);

  const stats = [
    ["Total users", overview?.users?.total ?? 0, Users, "text-blue-600 bg-blue-50"],
    ["Active users", overview?.users?.active ?? 0, UserCheck, "text-emerald-600 bg-emerald-50"],
    [
      "Gate entries",
      overview?.operations?.gate_entries ?? 0,
      Truck,
      "text-violet-600 bg-violet-50",
    ],
    ["GRNs", overview?.operations?.grns ?? 0, Boxes, "text-amber-600 bg-amber-50"],
    [
      "Assembly orders",
      overview?.operations?.assembly_orders ?? 0,
      Factory,
      "text-cyan-600 bg-cyan-50",
    ],
    ["Dispatches", overview?.operations?.dispatches ?? 0, Activity, "text-rose-600 bg-rose-50"],
  ] as const;

  return (
    <AppShell title="Administration" subtitle="Module teams, KPIs and operational reports">
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Admin dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Monitor every module team and open a user's operational workspace.
            </p>
          </div>
          <Button asChild>
            <Link to="/admin/users">
              <ShieldCheck /> Manage users
            </Link>
          </Button>
        </div>

        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="animate-spin" />
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {stats.map(([label, value, Icon, color]) => (
              <Card key={label}>
                <CardContent className="flex items-center justify-between p-5">
                  <div>
                    <p className="text-sm text-muted-foreground">{label}</p>
                    <p className="mt-1 text-3xl font-bold">{value}</p>
                  </div>
                  <div className={`rounded-xl p-3 ${color}`}>
                    <Icon />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {!loading && (
          <section className="space-y-4" aria-labelledby="module-teams-heading">
            <div>
              <h2 id="module-teams-heading" className="text-xl font-bold">Module teams</h2>
              <p className="text-sm text-muted-foreground">
                Users are grouped by module. KPIs and reports open in that user's context.
              </p>
            </div>
            <div className="grid gap-5 xl:grid-cols-2">
              {(overview?.modules || []).map((module) => (
                <Card key={module.name} className="overflow-hidden">
                  <div className="flex items-start justify-between gap-4 border-b bg-muted/30 p-5">
                    <div>
                      <h3 className="font-bold">{module.name}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">{module.description}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                      {module.users.length + (module.assembly_units || []).reduce((total, unit) => total + unit.users.length, 0)} users
                    </span>
                  </div>
                  <CardContent className="divide-y p-0">
                    {(module.assembly_units || []).map((unit) => (
                      <div key={unit.code} className="bg-muted/10">
                        <a href={unit.route} className="flex items-center justify-between border-b bg-primary/5 px-4 py-3 hover:bg-primary/10">
                          <div>
                            <p className="text-sm font-bold">{unit.name}</p>
                            <p className="text-xs text-muted-foreground">Independent assembly workspace · {unit.code}</p>
                          </div>
                          <span className="text-xs font-medium text-primary">{unit.users.length} users →</span>
                        </a>
                        {unit.users.map((user) => (
                          <div key={user.id} className="border-b p-4 pl-7 transition-colors hover:bg-muted/25">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <a href={userWorkspaceUrl(unit.route, user)} className="group min-w-0">
                                <div className="font-semibold group-hover:text-primary">{user.full_name}</div>
                                <div className="text-xs text-muted-foreground">{user.employee_id} · @{user.username}</div>
                              </a>
                              <div className="flex gap-2 text-xs">
                                <span className="rounded-md border px-2 py-1"><strong>{user.kpis?.work_items ?? 0}</strong> work items</span>
                                <Button asChild size="sm" variant="ghost"><a href={userWorkspaceUrl(unit.route, user, true)}><FileBarChart className="size-4" /> Reports</a></Button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                    {module.users.map((user) => (
                      <div key={user.id} className="p-4 transition-colors hover:bg-muted/25">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <a href={userWorkspaceUrl(module.route, user)} className="group min-w-0">
                            <div className="flex items-center gap-3">
                              <div className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 font-bold text-primary">
                                {user.full_name.slice(0, 1).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="truncate font-semibold group-hover:text-primary">{user.full_name}</span>
                                  <ArrowRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                                </div>
                                <p className="truncate text-xs text-muted-foreground">
                                  {user.employee_id} · @{user.username}
                                </p>
                              </div>
                            </div>
                          </a>
                          <div className="flex items-center gap-2 text-xs">
                            <span className="rounded-md border px-2 py-1">
                              <strong>{user.kpis?.work_items ?? 0}</strong> work items
                            </span>
                            <span className="rounded-md border px-2 py-1">
                              <strong>{user.kpis?.pages ?? 0}</strong> pages
                            </span>
                          </div>
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-2 pl-0 sm:pl-13">
                          <span className={`text-xs font-medium ${user.status === "ACTIVE" ? "text-emerald-600" : "text-muted-foreground"}`}>
                            {user.status}
                            {user.last_login ? ` · Last login ${new Date(user.last_login).toLocaleDateString()}` : " · Never logged in"}
                          </span>
                          <Button asChild size="sm" variant="ghost">
                            <a href={userWorkspaceUrl(module.route, user, true)}>
                              <FileBarChart className="size-4" /> Reports
                            </a>
                          </Button>
                        </div>
                      </div>
                    ))}
                    {!module.users.length && (
                      <p className="p-6 text-center text-sm text-muted-foreground">No users assigned.</p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}
