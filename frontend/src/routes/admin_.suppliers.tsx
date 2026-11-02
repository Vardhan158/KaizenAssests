import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, Building2, Check, ClipboardList, Eye, Grid2X2, List, Loader2,
  PackageCheck, Pencil, Plus, RotateCcw, Search, Shield, Truck, Users, X,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/wms/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api-client";
import { requireRole } from "@/lib/auth-utils";
import { ROLE_PAGES } from "@/lib/page-permissions";
import { AdminTablePagination } from "@/components/admin/admin-table-pagination";
import { PasswordInput } from "@/components/admin/password-input";

const ADMIN_PAGE_SIZE = 10;
const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export const Route = createFileRoute("/admin_/suppliers")({
  beforeLoad: () => requireRole(["ADMIN", "SUPERUSER", "SUPER_ADMIN"]),
  component: AdminSuppliersPage,
});

type SupplierSummary = {
  id: string;
  supplier_code?: string;
  supplier_name: string;
  registered_company_name: string;
  username?: string;
  user_id?: string | null;
  user_status?: string | null;
  page_permissions?: Record<string, string>;
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  vendor_type?: string;
  industry?: string;
  category?: string[];
  main_materials?: string[];
  gstin?: string;
  status: string;
  rating: number;
  performance_score: number;
  asn_count: number;
  dispatch_count: number;
  damage_claim_count?: number;
  created_at?: string;
};
type ManagedAccount = { id: string; username: string; email: string };

type AuditEvent = { id: string; action: string; module: string; request_path: string; result: string; occurred_at: string };
type SupplierForm = { supplier_name: string; username: string; email: string; password: string };
const EMPTY_FORM: SupplierForm = { supplier_name: "", username: "", email: "", password: "" };
const displayDate = (value?: string) => value ? new Date(value).toLocaleString() : "—";
const colorFor = (name: string) => {
  const colors = ["bg-sky-500", "bg-emerald-600", "bg-violet-600", "bg-amber-500", "bg-rose-500", "bg-blue-600"];
  return colors[[...name].reduce((sum, character) => sum + character.charCodeAt(0), 0) % colors.length];
};

function AdminSuppliersPage() {
  const [suppliers, setSuppliers] = useState<SupplierSummary[]>([]);
  const [managedAccounts, setManagedAccounts] = useState<ManagedAccount[]>([]);
  const [selected, setSelected] = useState<SupplierSummary | null>(null);
  const [activities, setActivities] = useState<AuditEvent[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [tab, setTab] = useState("overview");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<SupplierSummary | null>(null);
  const [passwordTarget, setPasswordTarget] = useState<SupplierSummary | null>(null);
  const [form, setForm] = useState<SupplierForm>(EMPTY_FORM);
  const [editForm, setEditForm] = useState({ supplier_name: "", username: "", email: "" });
  const [newPassword, setNewPassword] = useState("");
  const [page, setPage] = useState(1);

  const loadSuppliers = useCallback(async () => {
    setLoading(true);
    try {
      const [supplierRows, accounts] = await Promise.all([api.getAdminSuppliers(), api.getAdminUsers()]);
      setSuppliers(supplierRows);
      setManagedAccounts(accounts);
    } catch (error: any) {
      toast.error(error.message || "Unable to load suppliers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadSuppliers(); }, [loadSuppliers]);

  useEffect(() => {
    if (!selected?.username) {
      setActivities([]);
      return;
    }
    let active = true;
    void api.getAdminAuditLogs({ actor: selected.username, limit: 100 })
      .then((data) => { if (active) setActivities(data.items || []); })
      .catch(() => { if (active) setActivities([]); });
    return () => { active = false; };
  }, [selected?.username]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return suppliers.filter((supplier) => {
      const matchesText = !term || [supplier.supplier_name, supplier.registered_company_name, supplier.supplier_code, supplier.username, supplier.contact_name, supplier.email, supplier.industry].some((value) => value?.toLowerCase().includes(term));
      const matchesStatus = statusFilter === "ALL" || supplier.status.toLowerCase() === statusFilter.toLowerCase();
      return matchesText && matchesStatus;
    });
  }, [search, statusFilter, suppliers]);
  const pageSuppliers = filtered.slice((page - 1) * ADMIN_PAGE_SIZE, page * ADMIN_PAGE_SIZE);
  useEffect(() => { setPage(1); }, [search, statusFilter, layout]);
  useEffect(() => { setPage((current) => Math.min(current, Math.max(1, Math.ceil(filtered.length / ADMIN_PAGE_SIZE)))); }, [filtered.length]);

  const activeCount = suppliers.filter((supplier) => supplier.status?.toLowerCase() === "active").length;
  const totalAsns = suppliers.reduce((total, supplier) => total + supplier.asn_count, 0);
  const totalDispatches = suppliers.reduce((total, supplier) => total + supplier.dispatch_count, 0);

  const createSupplier = async (event: React.FormEvent) => {
    event.preventDefault();
    const supplierName = form.supplier_name.trim();
    const username = form.username.trim();
    const email = form.email.trim().toLowerCase();
    if (supplierName.length < 2 || supplierName.length > 128) return toast.error("Supplier name must be 2–128 characters");
    if (username.length < 3 || username.length > 64) return toast.error("Username must be 3–64 characters");
    if (email.length < 3 || email.length > 128 || !isValidEmail(email)) return toast.error("Enter a valid email address (up to 128 characters)");
    if (form.password.trim().length === 0 || form.password.length < 8 || form.password.length > 128) return toast.error("Password must be 8–128 characters and cannot be blank");
    if (managedAccounts.some((account) => account.username.toLowerCase() === username.toLowerCase() || account.email.toLowerCase() === email)) return toast.error("That username or email is already in use");
    setSaving(true);
    try {
      await api.createAdminUser({
        username, full_name: supplierName, email, password: form.password,
        role: "SUPPLIER", shift_name: null,
        page_permissions: Object.fromEntries(ROLE_PAGES.SUPPLIER.map((page) => [page.key, "WRITE"])),
      });
      toast.success("Supplier account created");
      setShowCreate(false);
      setForm(EMPTY_FORM);
      await loadSuppliers();
    } catch (error: any) {
      toast.error(error.message || "Unable to create supplier");
    } finally { setSaving(false); }
  };

  const beginEdit = (supplier: SupplierSummary) => {
    setEditTarget(supplier);
    setEditForm({ supplier_name: supplier.supplier_name, username: supplier.username || "", email: supplier.email || "" });
  };

  const saveSupplier = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editTarget?.user_id) return;
    const supplierName = editForm.supplier_name.trim();
    const username = editForm.username.trim();
    const email = editForm.email.trim().toLowerCase();
    if (supplierName.length < 2 || supplierName.length > 128) return toast.error("Supplier name must be 2–128 characters");
    if (username.length < 3 || username.length > 64) return toast.error("Username must be 3–64 characters");
    if (email.length < 3 || email.length > 128 || !isValidEmail(email)) return toast.error("Enter a valid email address (up to 128 characters)");
    if (managedAccounts.some((account) => account.id !== editTarget.user_id && (account.username.toLowerCase() === username.toLowerCase() || account.email.toLowerCase() === email))) return toast.error("That username or email is already in use");
    setSaving(true);
    try {
      await api.updateAdminUser(editTarget.user_id, { full_name: supplierName, username, email });
      toast.success("Supplier details updated");
      setEditTarget(null);
      await loadSuppliers();
      setSelected((current) => current?.id === editTarget.id ? { ...current, supplier_name: supplierName, username, email } : current);
    } catch (error: any) {
      toast.error(error.message || "Unable to update supplier");
    } finally { setSaving(false); }
  };

  const resetPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!passwordTarget?.user_id) return;
    if (newPassword.trim().length === 0 || newPassword.length < 8 || newPassword.length > 128) return toast.error("Password must be 8–128 characters and cannot be blank");
    setSaving(true);
    try {
      await api.updateAdminUser(passwordTarget.user_id, { password: newPassword });
      toast.success("Supplier password reset");
      setPasswordTarget(null);
      setNewPassword("");
    } catch (error: any) {
      toast.error(error.message || "Unable to reset password");
    } finally { setSaving(false); }
  };

  const toggleStatus = async (supplier: SupplierSummary) => {
    if (!supplier.user_id) return;
    const nextStatus = supplier.user_status?.toUpperCase() === "INACTIVE" ? "ACTIVE" : "INACTIVE";
    const verb = nextStatus === "ACTIVE" ? "reactivate" : "deactivate";
    if (!window.confirm(`Are you sure you want to ${verb} ${supplier.supplier_name}?`)) return;
    try {
      await api.updateAdminUser(supplier.user_id, { status: nextStatus });
      toast.success(`Supplier ${nextStatus === "ACTIVE" ? "reactivated" : "deactivated"}`);
      await loadSuppliers();
      setSelected((current) => current?.id === supplier.id ? { ...current, status: nextStatus === "ACTIVE" ? "Active" : "Inactive", user_status: nextStatus } : current);
    } catch (error: any) {
      toast.error(error.message || `Unable to ${verb} supplier`);
    }
  };

  const stats = [
    { label: "Total suppliers", value: suppliers.length, icon: Users, tone: "text-primary bg-blue-50" },
    { label: "Active suppliers", value: activeCount, icon: Building2, tone: "text-emerald-700 bg-emerald-50" },
    { label: "Total ASNs", value: totalAsns, icon: Truck, tone: "text-sky-700 bg-sky-50" },
    { label: "FG dispatch requests", value: totalDispatches, icon: PackageCheck, tone: "text-violet-700 bg-violet-50" },
  ];

  const supplierCard = (supplier: SupplierSummary) => <Card key={supplier.id} className="border-slate-200 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md"><CardContent className="p-4"><div className="flex items-center gap-3"><span className={`flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${colorFor(supplier.supplier_name)}`}>{supplier.supplier_name.slice(0, 1).toUpperCase()}</span><div className="min-w-0 flex-1"><p className="truncate font-semibold text-slate-900">{supplier.supplier_name}</p><p className="truncate text-xs text-muted-foreground">{supplier.supplier_code || supplier.registered_company_name}</p></div><Badge variant="outline" className={supplier.status.toLowerCase() === "active" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}>{supplier.status}</Badge></div><div className="mt-4 grid grid-cols-2 gap-3 border-y border-slate-100 py-3 text-sm"><div className="flex items-center gap-2"><ClipboardList className="size-4 text-primary" /><div><span className="font-semibold">{supplier.asn_count}</span><span className="ml-1 text-xs text-muted-foreground">ASNs</span></div></div><div className="flex items-center gap-2"><Truck className="size-4 text-primary" /><div><span className="font-semibold">{supplier.dispatch_count}</span><span className="ml-1 text-xs text-muted-foreground">Dispatches</span></div></div></div><Button variant="outline" className="mt-3 h-9 w-full justify-center bg-blue-50/50 text-xs text-primary hover:bg-blue-50" onClick={() => { setSelected(supplier); setTab("overview"); }}>View details <Eye className="size-3.5" /></Button></CardContent></Card>;

  return (
    <AppShell title="Suppliers" subtitle="Overview of registered suppliers and their operational activity." actions={<Button className="rounded-lg" onClick={() => setShowCreate(true)}><Plus /> Add supplier</Button>}>
        <div className="space-y-5 py-2 md:py-3">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{stats.map(({ label, value, icon: Icon, tone }) => <Card key={label} className="rounded-xl border-slate-200 shadow-sm transition-shadow hover:shadow-md"><CardContent className="flex min-h-24 items-center justify-between p-4"><div><p className="text-sm font-medium text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-bold tracking-tight text-slate-900">{value.toLocaleString()}</p></div><span className={`flex size-10 items-center justify-center rounded-xl ${tone}`}><Icon className="size-5" /></span></CardContent></Card>)}</div>

        <Card className="overflow-hidden rounded-2xl border-slate-200 shadow-sm"><CardHeader className="gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between"><CardTitle className="text-base font-semibold">All suppliers</CardTitle><div className="flex w-full flex-wrap items-center gap-2 sm:w-auto"><label className="relative min-w-56 flex-1 sm:w-72"><Search className="absolute left-3 top-3 size-4 text-muted-foreground" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, code or contact..." className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm" /></label><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-10 rounded-lg border bg-background px-3 text-sm"><option value="ALL">All statuses</option><option value="Active">Active</option><option value="Inactive">Inactive</option></select><div className="flex rounded-lg border p-1"><Button size="icon" variant={layout === "grid" ? "default" : "ghost"} className="size-8" aria-label="Grid view" onClick={() => setLayout("grid")}><Grid2X2 className="size-4" /></Button><Button size="icon" variant={layout === "list" ? "default" : "ghost"} className="size-8" aria-label="List view" onClick={() => setLayout("list")}><List className="size-4" /></Button></div></div></CardHeader><CardContent className="p-5 sm:p-6">
          {loading ? <div className="flex h-40 items-center justify-center text-primary"><Loader2 className="animate-spin" /></div> : filtered.length ? layout === "grid" ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{pageSuppliers.map(supplierCard)}</div> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b bg-blue-50 text-xs text-slate-600"><tr><th className="px-3 py-3">Supplier</th><th className="px-3">Code</th><th className="px-3">Status</th><th className="px-3">ASNs</th><th className="px-3">Dispatches</th><th className="px-3 text-right">Details</th></tr></thead><tbody>{pageSuppliers.map((supplier) => <tr key={supplier.id} className="border-b last:border-0 hover:bg-blue-50/40"><td className="px-3 py-3"><div className="font-semibold">{supplier.supplier_name}</div><div className="text-xs text-muted-foreground">{supplier.contact_name || supplier.username || "—"}</div></td><td className="px-3 text-xs">{supplier.supplier_code || "—"}</td><td className="px-3"><Badge variant="outline">{supplier.status}</Badge></td><td className="px-3">{supplier.asn_count}</td><td className="px-3">{supplier.dispatch_count}</td><td className="px-3 text-right"><Button size="sm" variant="outline" onClick={() => { setSelected(supplier); setTab("overview"); }}>View</Button></td></tr>)}</tbody></table></div> : <div className="py-16 text-center"><Building2 className="mx-auto mb-2 size-8 text-muted-foreground/50" /><p className="font-medium">No suppliers found</p><p className="mt-1 text-sm text-muted-foreground">Try a different search or add a supplier account.</p></div>}
          {!loading && filtered.length > 0 && <AdminTablePagination page={page} total={filtered.length} itemLabel="suppliers" onPageChange={setPage} />}
        </CardContent></Card>
      </div>

      <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-hidden border-slate-200 bg-background p-0 sm:max-w-[480px]">
          {selected && <>
            <SheetHeader className="shrink-0 border-b bg-white p-5 pr-14 text-left"><div className="text-xs font-semibold uppercase tracking-wide text-primary">Supplier profile</div><SheetTitle className="text-xl">Supplier details</SheetTitle><SheetDescription className="sr-only">Overview, activities and account access for this supplier.</SheetDescription><div className="mt-3 flex items-center gap-3"><span className={`flex size-12 items-center justify-center rounded-full text-lg font-bold text-white ${colorFor(selected.supplier_name)}`}>{selected.supplier_name.slice(0, 1).toUpperCase()}</span><div className="min-w-0 flex-1"><p className="truncate font-semibold text-slate-900">{selected.supplier_name}</p><p className="text-xs text-muted-foreground">{selected.supplier_code || selected.registered_company_name}</p></div><Badge variant="outline">{selected.status}</Badge></div></SheetHeader>
            <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
              <TabsList className="grid h-11 w-full shrink-0 grid-cols-3 rounded-none border-b bg-white p-0"><TabsTrigger value="overview" className="h-full rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">Overview</TabsTrigger><TabsTrigger value="activities" className="h-full rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">Activities</TabsTrigger><TabsTrigger value="access" className="h-full rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none">Users &amp; Access</TabsTrigger></TabsList>
              <TabsContent value="overview" className="m-0 flex-1 space-y-4 overflow-y-auto p-4">
                <section className="rounded-xl border bg-white p-4"><div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-bold">Basic information</h3><Button size="sm" variant="outline" onClick={() => beginEdit(selected)} disabled={!selected.user_id}><Pencil className="size-3.5" /> Edit</Button></div><dl className="divide-y text-xs">{[["Supplier code", selected.supplier_code], ["Supplier name", selected.supplier_name], ["Company", selected.registered_company_name], ["Contact person", selected.contact_name], ["Email", selected.email], ["Phone", selected.phone], ["Address", selected.address], ["Industry", selected.industry], ["Vendor type", selected.vendor_type], ["GSTIN", selected.gstin], ["Account status", selected.user_status || selected.status], ["Created on", displayDate(selected.created_at)]].map(([label, value]) => <div key={label} className="grid grid-cols-[120px_minmax(0,1fr)] gap-2 py-2"><dt className="text-muted-foreground">{label}</dt><dd className="break-words font-medium text-slate-800">{value || "—"}</dd></div>)}</dl></section>
                <section className="rounded-xl border bg-white p-4"><div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-bold">Activity summary</h3><span className="text-xs text-muted-foreground">All recorded</span></div><div className="grid grid-cols-2 gap-2">{[{ label: "ASNs", value: selected.asn_count, icon: Truck }, { label: "Dispatches", value: selected.dispatch_count, icon: PackageCheck }, { label: "Damage claims", value: selected.damage_claim_count || 0, icon: Activity }, { label: "Recent activities", value: activities.length, icon: ClipboardList }].map(({ label, value, icon: Icon }) => <div key={label} className="flex items-center gap-2 rounded-lg bg-blue-50/60 p-3"><span className="rounded-md bg-white p-2 text-primary"><Icon className="size-4" /></span><div><p className="text-lg font-bold leading-none">{value}</p><p className="mt-1 text-[11px] text-muted-foreground">{label}</p></div></div>)}</div></section>
                <section className="rounded-xl border bg-white p-4"><h3 className="mb-3 text-sm font-bold">Quick actions</h3><div className="grid grid-cols-2 gap-2"><Button size="sm" variant="outline" onClick={() => beginEdit(selected)} disabled={!selected.user_id}><Pencil className="size-3.5" /> Edit supplier</Button><Button size="sm" variant="outline" onClick={() => setPasswordTarget(selected)} disabled={!selected.user_id}><RotateCcw className="size-3.5" /> Reset password</Button><Button size="sm" variant="outline" className={selected.user_status?.toUpperCase() === "INACTIVE" ? "text-emerald-700" : "text-destructive"} onClick={() => void toggleStatus(selected)} disabled={!selected.user_id}>{selected.user_status?.toUpperCase() === "INACTIVE" ? <Check className="size-3.5" /> : <X className="size-3.5" />}{selected.user_status?.toUpperCase() === "INACTIVE" ? "Reactivate" : "Deactivate"}</Button></div></section>
              </TabsContent>
              <TabsContent value="activities" className="m-0 flex-1 overflow-y-auto p-4"><div className="space-y-3">{activities.length ? activities.map((activity) => <div key={activity.id} className="rounded-lg border bg-white p-3"><div className="flex items-center justify-between gap-2"><p className="text-sm font-semibold">{activity.action === "LOGIN" ? "Login" : activity.action === "LOGOUT" ? "Logout" : `${activity.action} · ${activity.module}`}</p><Badge variant="outline" className={activity.result === "SUCCESS" ? "text-emerald-700" : "text-red-700"}>{activity.result}</Badge></div><p className="mt-1 break-all text-xs text-muted-foreground">{activity.request_path}</p><p className="mt-2 text-[11px] text-muted-foreground">{displayDate(activity.occurred_at)}</p></div>) : <div className="py-16 text-center text-sm text-muted-foreground"><Activity className="mx-auto mb-2 size-7 opacity-50" />No recorded activity for this supplier account.</div>}</div></TabsContent>
              <TabsContent value="access" className="m-0 flex-1 space-y-3 overflow-y-auto p-4"><section className="rounded-xl border bg-white p-4"><h3 className="mb-3 text-sm font-bold">Supplier account</h3><dl className="space-y-3 text-sm">{[["Username", selected.username], ["Email", selected.email], ["Role", "Supplier"], ["Status", selected.user_status || selected.status]].map(([label, value]) => <div key={label} className="flex justify-between gap-4"><dt className="text-muted-foreground">{label}</dt><dd className="text-right font-medium">{value || "—"}</dd></div>)}</dl></section><section className="rounded-xl border bg-white p-4"><div className="mb-3 flex items-center gap-2"><Shield className="size-4 text-primary" /><h3 className="text-sm font-bold">Page permissions</h3></div><div className="space-y-2">{ROLE_PAGES.SUPPLIER.map((page) => <div key={page.key} className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 text-xs"><span>{page.label}</span><Badge variant="outline">{selected.page_permissions?.[page.key] || "Not set"}</Badge></div>)}</div></section></TabsContent>
            </Tabs>
          </>}
        </SheetContent>
      </Sheet>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add supplier</DialogTitle><DialogDescription>Create a supplier login and its supplier profile.</DialogDescription></DialogHeader>
          <form onSubmit={createSupplier} className="space-y-3">
            <label className="block space-y-1 text-sm font-medium">Supplier name<input required minLength={2} maxLength={128} value={form.supplier_name} onChange={(event) => setForm({ ...form, supplier_name: event.target.value })} className="mt-1 h-10 w-full rounded-md border bg-background px-3 font-normal" /></label>
            <label className="block space-y-1 text-sm font-medium">Username<input required minLength={3} maxLength={64} value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} className="mt-1 h-10 w-full rounded-md border bg-background px-3 font-normal" /></label>
            <label className="block space-y-1 text-sm font-medium">Email<input required type="email" minLength={3} maxLength={128} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="mt-1 h-10 w-full rounded-md border bg-background px-3 font-normal" /></label>
            <PasswordInput label="Temporary password" required minLength={8} maxLength={128} value={form.password} onChange={(password) => setForm({ ...form, password })} />
            <DialogFooter><Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button><Button type="submit" disabled={saving}>{saving && <Loader2 className="animate-spin" />}Create supplier</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editTarget)} onOpenChange={(open) => !open && setEditTarget(null)}><DialogContent><DialogHeader><DialogTitle>Edit supplier</DialogTitle><DialogDescription>Update the supplier profile and linked login details.</DialogDescription></DialogHeader><form onSubmit={saveSupplier} className="space-y-3">{([["supplier_name", "Supplier name", "text"], ["username", "Username", "text"], ["email", "Email", "email"]] as const).map(([key, label, type]) => <label key={key} className="block space-y-1 text-sm font-medium">{label}<input required minLength={key === "username" || key === "email" ? 3 : 2} maxLength={key === "username" ? 64 : 128} type={type} value={editForm[key]} onChange={(event) => setEditForm({ ...editForm, [key]: event.target.value })} className="mt-1 h-10 w-full rounded-md border bg-background px-3 font-normal" /></label>)}<DialogFooter><Button type="button" variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button><Button type="submit" disabled={saving}>{saving && <Loader2 className="animate-spin" />}Save changes</Button></DialogFooter></form></DialogContent></Dialog>

      <Dialog open={Boolean(passwordTarget)} onOpenChange={(open) => !open && setPasswordTarget(null)}><DialogContent><DialogHeader><DialogTitle>Reset supplier password</DialogTitle><DialogDescription>Set a new password for {passwordTarget?.supplier_name}.</DialogDescription></DialogHeader><form onSubmit={resetPassword} className="space-y-4"><PasswordInput label="New password" required minLength={8} maxLength={128} value={newPassword} onChange={setNewPassword} /><DialogFooter><Button type="button" variant="outline" onClick={() => setPasswordTarget(null)}>Cancel</Button><Button type="submit" disabled={saving}>{saving && <Loader2 className="animate-spin" />}Reset password</Button></DialogFooter></form></DialogContent></Dialog>
    </AppShell>
  );
}
