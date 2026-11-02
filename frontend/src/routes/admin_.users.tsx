import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { CircleCheck, Factory, Loader2, LockKeyhole, Pencil, Plus, Search, ShieldCheck, UserX, Users } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AppShell } from "@/components/wms/app-shell";
import { api } from "@/lib/api-client";
import { requireRole } from "@/lib/auth-utils";
import { ROLE_PAGES, type PageAccess } from "@/lib/page-permissions";
import { AdminTablePagination } from "@/components/admin/admin-table-pagination";
import { PasswordInput } from "@/components/admin/password-input";

const ADMIN_PAGE_SIZE = 10;
const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const hasValidPageAccess = (role: string, permissions: Record<string, PageAccess>) => {
  const allowedPages = new Set((ROLE_PAGES[role] || []).map((page) => page.key));
  const entries = Object.entries(permissions);
  return entries.length > 0 && entries.every(([key, access]) =>
    allowedPages.has(key) && (access === "READ" || access === "WRITE"),
  );
};

export const Route = createFileRoute("/admin_/users")({
  beforeLoad: () => requireRole(["ADMIN", "SUPERUSER", "SUPER_ADMIN"]),
  component: AdminUsersPage,
});

type ManagedUser = {
  id: string;
  employee_id: string;
  username: string;
  full_name: string;
  email: string;
  role: string;
  status: string;
  last_login?: string | null;
  page_permissions?: Record<string, PageAccess>;
  shift_name?: string | null;
  assembly_unit_code?: string | null;
};

type RoleOption = { value: string; label: string };
type AssemblyUnit = { id: string; code: string; name: string; description?: string | null; status: string };

const emptyForm = {
  username: "",
  full_name: "",
  email: "",
  password: "",
  role: "WAREHOUSE_MANAGER",
  shift_name: "GENERAL",
  assembly_unit_code: "",
  page_permissions: {} as Record<string, PageAccess>,
};

type EditForm = {
  user: ManagedUser;
  username: string;
  full_name: string;
  email: string;
  password: string;
  role: string;
  shift_name: string;
  assembly_unit_code: string;
  page_permissions: Record<string, PageAccess>;
};

function AdminUsersPage() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [assemblyUnits, setAssemblyUnits] = useState<AssemblyUnit[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showUnitForm, setShowUnitForm] = useState(false);
  const [unitForm, setUnitForm] = useState({ unit_name: "", description: "" });
  const [search, setSearch] = useState("");
  const [unitSearch, setUnitSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"staff" | "units" | "deactivated">("staff");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [shiftFilter, setShiftFilter] = useState("ALL");
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [editUnit, setEditUnit] = useState<{ unit: AssemblyUnit; name: string; description: string } | null>(null);
  const [userPage, setUserPage] = useState(1);
  const [activeUnitPage, setActiveUnitPage] = useState(1);
  const [inactiveUnitPage, setInactiveUnitPage] = useState(1);

  const load = async () => {
    setLoading(true);
    try {
      const [userData, roleData, unitData] = await Promise.all([
        api.getAdminUsers(),
        api.getAdminRoles(),
        api.getAdminAssemblyUnits(),
      ]);
      setUsers(userData);
      setRoles(roleData);
      setAssemblyUnits(unitData);
    } catch (error: any) {
      toast.error(error.message || "Unable to load users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return users.filter((user) => {
      const matchesAccountView = activeTab === "deactivated"
        ? user.status === "INACTIVE"
        : activeTab === "staff"
          ? user.status !== "INACTIVE"
          : true;
      const matchesSearch = !query || [user.full_name, user.username, user.employee_id, user.email, user.role]
        .some((value) => value.toLowerCase().includes(query));
      const matchesRole = roleFilter === "ALL" || user.role === roleFilter;
      const matchesStatus = statusFilter === "ALL" || user.status === statusFilter;
      const matchesShift = shiftFilter === "ALL" || (user.shift_name || "GENERAL") === shiftFilter;
      return matchesAccountView && matchesSearch && matchesRole && matchesStatus && matchesShift;
    }).sort((left, right) => {
      const isAdmin = (user: ManagedUser) => ["ADMIN", "SUPERUSER", "SUPER_ADMIN"].includes(user.role.trim().toUpperCase().replace(/[\s-]+/g, "_"));
      return Number(!isAdmin(left)) - Number(!isAdmin(right));
    });
  }, [activeTab, roleFilter, search, shiftFilter, statusFilter, users]);

  const activeUsers = users.filter((user) => user.status === "ACTIVE").length;
  const inactiveUsers = users.length - activeUsers;
  const activeAssemblyUnits = assemblyUnits.filter((unit) => unit.status === "ACTIVE");
  const inactiveAssemblyUnits = assemblyUnits.filter((unit) => unit.status === "INACTIVE");
  const hasAssignedUser = (unit: AssemblyUnit) => users.some((user) =>
    user.assembly_unit_code?.trim().toUpperCase() === unit.code.trim().toUpperCase(),
  );
  const unitDisplayStatus = (unit: AssemblyUnit) => {
    if (unit.status !== "ACTIVE") return unit.status;
    return hasAssignedUser(unit) ? "USER CREATED" : "USER NOT CREATED";
  };
  const normalizedUnitSearch = unitSearch.trim().toLowerCase();
  const matchesUnitSearch = (unit: AssemblyUnit) => !normalizedUnitSearch || [unit.code, unit.name, unit.description || "", unit.status, unitDisplayStatus(unit)]
    .some((value) => value.toLowerCase().includes(normalizedUnitSearch));
  const visibleActiveAssemblyUnits = activeAssemblyUnits.filter(matchesUnitSearch);
  const visibleInactiveAssemblyUnits = inactiveAssemblyUnits.filter(matchesUnitSearch);
  const pageUsers = filteredUsers.slice((userPage - 1) * ADMIN_PAGE_SIZE, userPage * ADMIN_PAGE_SIZE);
  const pageActiveAssemblyUnits = visibleActiveAssemblyUnits.slice((activeUnitPage - 1) * ADMIN_PAGE_SIZE, activeUnitPage * ADMIN_PAGE_SIZE);
  const pageInactiveAssemblyUnits = visibleInactiveAssemblyUnits.slice((inactiveUnitPage - 1) * ADMIN_PAGE_SIZE, inactiveUnitPage * ADMIN_PAGE_SIZE);
  const shifts = Array.from(new Set(users.map((user) => user.shift_name || "GENERAL"))).sort();

  useEffect(() => { setUserPage(1); }, [activeTab, roleFilter, search, shiftFilter, statusFilter]);
  useEffect(() => { setActiveUnitPage(1); setInactiveUnitPage(1); }, [unitSearch]);
  useEffect(() => { setUserPage((current) => Math.min(current, Math.max(1, Math.ceil(filteredUsers.length / ADMIN_PAGE_SIZE)))); }, [filteredUsers.length]);
  useEffect(() => { setActiveUnitPage((current) => Math.min(current, Math.max(1, Math.ceil(visibleActiveAssemblyUnits.length / ADMIN_PAGE_SIZE)))); }, [visibleActiveAssemblyUnits.length]);
  useEffect(() => { setInactiveUnitPage((current) => Math.min(current, Math.max(1, Math.ceil(visibleInactiveAssemblyUnits.length / ADMIN_PAGE_SIZE)))); }, [visibleInactiveAssemblyUnits.length]);

  const createUser = async (event: React.FormEvent) => {
    event.preventDefault();
    const username = form.username.trim();
    const fullName = form.full_name.trim();
    const email = form.email.trim().toLowerCase();
    if (fullName.length < 2 || fullName.length > 128) return toast.error("Full name must be 2–128 characters");
    if (username.length < 3 || username.length > 64) return toast.error("Username must be 3–64 characters");
    if (email.length < 3 || email.length > 128 || !isValidEmail(email)) return toast.error("Enter a valid email address (up to 128 characters)");
    if (form.password.trim().length === 0 || form.password.length < 8 || form.password.length > 128) return toast.error("Password must be 8–128 characters and cannot be blank");
    if (!roles.some((role) => role.value === form.role)) return toast.error("Select a valid role");
    if (form.shift_name.trim().length > 64) return toast.error("Work shift must be 64 characters or fewer");
    if (form.assembly_unit_code.length > 64) return toast.error("Assembly unit code must be 64 characters or fewer");
    if (form.role === "ASSEMBLY_MANAGER" && !activeAssemblyUnits.some((unit) => unit.code === form.assembly_unit_code)) return toast.error("Select an active assembly unit for this role");
    if (users.some((user) => user.username.toLowerCase() === username.toLowerCase() || user.email.toLowerCase() === email)) return toast.error("That username or email is already in use");
    if (!hasValidPageAccess(form.role, form.page_permissions)) return toast.error("Choose valid page access for at least one page");
    setSaving(true);
    try {
      const created = await api.createAdminUser({
        ...form,
        username,
        full_name: fullName,
        email,
        shift_name: form.role === "SUPPLIER" ? null : form.shift_name.trim(),
        assembly_unit_code: form.role === "ASSEMBLY_MANAGER" ? form.assembly_unit_code.trim().toUpperCase() : null,
      });
      toast.success(`User account created · Employee ID: ${created.employee_id}`);
      setForm(emptyForm);
      setShowForm(false);
      await load();
    } catch (error: any) {
      toast.error(error.message || "Unable to create user");
    } finally {
      setSaving(false);
    }
  };

  const createAssemblyUnit = async (event: React.FormEvent) => {
    event.preventDefault();
    const unitName = unitForm.unit_name.trim();
    const description = unitForm.description.trim();
    if (unitName.length < 2 || unitName.length > 128) return toast.error("Unit name must be 2–128 characters");
    if (description.length > 255) return toast.error("Unit description must be 255 characters or fewer");
    setSaving(true);
    try {
      const created = await api.createAdminAssemblyUnit({ unit_name: unitName, description });
      setAssemblyUnits((current) => [...current, created].sort((a, b) => a.code.localeCompare(b.code)));
      setUnitForm({ unit_name: "", description: "" });
      setShowUnitForm(false);
      setForm({
        ...emptyForm,
        role: "ASSEMBLY_MANAGER",
        assembly_unit_code: created.code,
      });
      setShowForm(true);
      toast.success(`Assembly unit ${created.code} created`);
    } catch (error: any) {
      toast.error(error.message || "Unable to create assembly unit");
    } finally {
      setSaving(false);
    }
  };

  const updateAssemblyUnit = async (unit: AssemblyUnit, payload: { unit_name?: string; description?: string; status?: string }) => {
    setSaving(true);
    try {
      const updated = await api.updateAdminAssemblyUnit(unit.id, payload);
      setAssemblyUnits((current) => current.map((candidate) => candidate.id === unit.id ? updated : candidate));
      setEditUnit(null);
      toast.success(`Assembly unit ${unit.code} updated`);
    } catch (error: any) {
      toast.error(error.message || "Unable to update assembly unit");
    } finally {
      setSaving(false);
    }
  };

  const saveAssemblyUnit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editUnit) return;
    const name = editUnit.name.trim();
    const description = editUnit.description.trim();
    if (name.length < 2 || name.length > 128) return toast.error("Unit name must be 2–128 characters");
    if (description.length > 255) return toast.error("Unit description must be 255 characters or fewer");
    await updateAssemblyUnit(editUnit.unit, {
      unit_name: name,
      description,
    });
  };

  const permissionPages = ROLE_PAGES[form.role] || [];

  const setPageAccess = (pageKey: string, access: PageAccess) => {
    setForm((current) => ({
      ...current,
      page_permissions: { ...current.page_permissions, [pageKey]: access },
    }));
  };

  const updateUser = async (user: ManagedUser, payload: Record<string, unknown>) => {
    try {
      const updated = await api.updateAdminUser(user.id, payload);
      setUsers((current) =>
        current.map((candidate) => (candidate.id === user.id ? updated : candidate)),
      );
      toast.success("User access updated");
    } catch (error: any) {
      toast.error(error.message || "Unable to update user");
    }
  };

  const openEdit = (user: ManagedUser) => {
    setEditForm({
      user,
      username: user.username,
      full_name: user.full_name,
      email: user.email,
      password: "",
      role: user.role,
      shift_name: user.role === "SUPPLIER" ? "" : user.shift_name || "GENERAL",
      assembly_unit_code: user.assembly_unit_code || "",
      page_permissions: { ...(user.page_permissions || {}) },
    });
  };

  const saveEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editForm) return;
    const username = editForm.username.trim();
    const fullName = editForm.full_name.trim();
    const email = editForm.email.trim().toLowerCase();
    if (fullName.length < 2 || fullName.length > 128) return toast.error("Full name must be 2–128 characters");
    if (username.length < 3 || username.length > 64) return toast.error("Username must be 3–64 characters");
    if (email.length < 3 || email.length > 128 || !isValidEmail(email)) return toast.error("Enter a valid email address (up to 128 characters)");
    if (editForm.password && (editForm.password.trim().length === 0 || editForm.password.length < 8 || editForm.password.length > 128)) return toast.error("New password must be 8–128 characters and cannot be blank");
    if (!roles.some((role) => role.value === editForm.role)) return toast.error("Select a valid role");
    if (editForm.shift_name.trim().length > 64) return toast.error("Work shift must be 64 characters or fewer");
    if (editForm.assembly_unit_code.length > 64) return toast.error("Assembly unit code must be 64 characters or fewer");
    if (editForm.role === "ASSEMBLY_MANAGER" && !assemblyUnits.some((unit) => unit.code === editForm.assembly_unit_code)) return toast.error("Select an existing assembly unit for this role");
    if (users.some((user) => user.id !== editForm.user.id && (user.username.toLowerCase() === username.toLowerCase() || user.email.toLowerCase() === email))) return toast.error("That username or email is already in use");
    if (!hasValidPageAccess(editForm.role, editForm.page_permissions)) return toast.error("Choose valid page access for at least one page");
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        username,
        full_name: fullName,
        email,
        role: editForm.role,
        shift_name: editForm.role === "SUPPLIER" ? null : editForm.shift_name.trim(),
        assembly_unit_code: editForm.role === "ASSEMBLY_MANAGER" ? editForm.assembly_unit_code.trim().toUpperCase() : null,
        page_permissions: editForm.page_permissions,
      };
      if (editForm.password) payload.password = editForm.password;
      const updated = await api.updateAdminUser(editForm.user.id, payload);
      setUsers((current) =>
        current.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
      );
      setEditForm(null);
      toast.success("User details updated");
    } catch (error: any) {
      toast.error(error.message || "Unable to update user");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell
      title="User Management"
      subtitle="Manage staff accounts, roles, assembly units and access permissions."
      actions={<>
        <Button className="rounded-xl bg-white shadow-sm" variant="outline" onClick={() => {
              setShowForm(false);
              setActiveTab("units");
              setShowUnitForm((current) => !current);
            }}>
          <Factory /> Create assembly unit
        </Button>
        <Button className="rounded-xl shadow-sm" onClick={() => {
              setShowUnitForm(false);
              setActiveTab("staff");
              setShowForm((current) => !current);
            }}>
          <Plus /> Create user
        </Button>
      </>}
    >
      <div className="space-y-5">

        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="rounded-2xl border-border/80 bg-white shadow-sm transition-shadow hover:shadow-md">
            <CardContent className="flex min-h-28 items-center gap-4 p-5">
              <span className="rounded-xl bg-blue-50 p-3 text-blue-600"><Users className="size-6" /></span>
              <div><p className="text-sm font-semibold text-muted-foreground">Total Users</p><p className="mt-1 text-2xl font-bold tracking-tight">{users.length}</p></div>
            </CardContent>
          </Card>
          <Card className="rounded-2xl border-border/80 bg-white shadow-sm transition-shadow hover:shadow-md">
            <CardContent className="flex min-h-28 items-center gap-4 p-5">
              <span className="rounded-xl bg-emerald-50 p-3 text-emerald-600"><CircleCheck className="size-6" /></span>
              <div><p className="text-sm font-semibold text-muted-foreground">Active Users</p><p className="mt-1 text-2xl font-bold tracking-tight">{activeUsers}</p></div>
            </CardContent>
          </Card>
          <Card className="rounded-2xl border-border/80 bg-white shadow-sm transition-shadow hover:shadow-md">
            <CardContent className="flex min-h-28 items-center gap-4 p-5">
              <span className="rounded-xl bg-violet-50 p-3 text-violet-600"><LockKeyhole className="size-6" /></span>
              <div><p className="text-sm font-semibold text-muted-foreground">Inactive Users</p><p className="mt-1 text-2xl font-bold tracking-tight">{inactiveUsers}</p></div>
            </CardContent>
          </Card>
        </div>

        <Dialog open={showForm} onOpenChange={setShowForm}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><ShieldCheck className="text-primary" /> Create staff account</DialogTitle>
              <DialogDescription>Create a user, assign their operational role, and configure page access.</DialogDescription>
            </DialogHeader>
              <form onSubmit={createUser} className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {(
                  [
                    ["full_name", "Full name"],
                    ["username", "Username"],
                    ["email", "Email"],
                  ] as const
                ).map(([key, label]) => (
                  <label className="space-y-1.5 text-sm font-medium" key={key}>
                    {label}
                    <input
                      required
                      minLength={key === "username" || key === "email" ? 3 : 2}
                      maxLength={key === "username" ? 64 : 128}
                      type={key === "email" ? "email" : "text"}
                      value={form[key]}
                      onChange={(event) => setForm({ ...form, [key]: event.target.value })}
                      className="h-10 w-full rounded-md border bg-background px-3 font-normal"
                    />
                  </label>
                ))}
                <PasswordInput
                  label="Password"
                  required
                  minLength={8}
                  maxLength={128}
                  value={form.password}
                  onChange={(password) => setForm({ ...form, password })}
                />
                <label className="space-y-1.5 text-sm font-medium">
                  Role
                  <select
                    required
                    value={form.role}
                    onChange={(event) => {
                      const role = event.target.value;
                      setForm({ ...form, role, shift_name: role === "SUPPLIER" ? "" : form.shift_name || "GENERAL", page_permissions: {} });
                    }}
                    className="h-10 w-full rounded-md border bg-background px-3 font-normal"
                  >
                    {roles.map((role) => (
                      <option key={role.value} value={role.value}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                </label>
                {form.role === "ASSEMBLY_MANAGER" ? (
                  <label className="space-y-1.5 text-sm font-medium">
                    Assembly unit code
                    <select
                      required
                      value={form.assembly_unit_code}
                      onChange={(event) => setForm({ ...form, assembly_unit_code: event.target.value.toUpperCase() })}
                      className="h-10 w-full rounded-md border bg-background px-3 font-normal"
                    >
                      <option value="">Select assembly unit</option>
                      {assemblyUnits.filter((unit) => unit.status === "ACTIVE").map((unit) => <option key={unit.id} value={unit.code}>{unit.name} ({unit.code})</option>)}
                    </select>
                  </label>
                ) : (
                  <label className="space-y-1.5 text-sm font-medium">
                    Work shift
                      <input
                        maxLength={64}
                      value={form.shift_name}
                      onChange={(event) => setForm({ ...form, shift_name: event.target.value.toUpperCase() })}
                      disabled={form.role === "SUPPLIER"}
                      placeholder={form.role === "SUPPLIER" ? "Not applicable for suppliers" : "e.g. SHIFT-A"}
                      className="h-10 w-full rounded-md border bg-background px-3 font-normal disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
                    />
                  </label>
                )}
                <div className="md:col-span-2 xl:col-span-3">
                  <div className="mb-2">
                    <p className="text-sm font-semibold">Page access</p>
                    <p className="text-xs text-muted-foreground">
                      Choose whether this user can only view or can perform actions on each page.
                    </p>
                  </div>
                  <div className="overflow-hidden rounded-lg border">
                    <div className="grid grid-cols-[1fr_110px_120px] bg-muted/50 px-4 py-2 text-xs font-semibold uppercase text-muted-foreground">
                      <span>Page</span>
                      <span className="text-center">Read only</span>
                      <span className="text-center">Can perform</span>
                    </div>
                    {permissionPages.map((page) => (
                      <div
                        key={page.key}
                        className="grid grid-cols-[1fr_110px_120px] items-center border-t px-4 py-3 text-sm"
                      >
                        <span className="font-medium">{page.label}</span>
                        {(["READ", "WRITE"] as const).map((access) => (
                          <label key={access} className="flex justify-center">
                            <input
                              type="checkbox"
                              checked={form.page_permissions[page.key] === access}
                              onChange={() => setPageAccess(page.key, access)}
                              aria-label={`${page.label} ${access === "READ" ? "read only" : "can perform"}`}
                              className="size-4 accent-primary"
                            />
                          </label>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
                <DialogFooter className="md:col-span-2 xl:col-span-3">
                  <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={saving}>
                    {saving && <Loader2 className="animate-spin" />} Create account
                  </Button>
                </DialogFooter>
              </form>
          </DialogContent>
        </Dialog>

        <Dialog open={showUnitForm} onOpenChange={setShowUnitForm}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><Factory className="text-primary" /> Create assembly unit</DialogTitle>
              <DialogDescription>Create an assembly unit with an automatically generated unit code.</DialogDescription>
            </DialogHeader>
              <form onSubmit={createAssemblyUnit} className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1.5 text-sm font-medium">Unit code
                  <input readOnly value="Generated automatically" className="h-10 w-full cursor-not-allowed rounded-md border bg-muted px-3 font-normal text-muted-foreground" />
                </label>
                <label className="space-y-1.5 text-sm font-medium">Unit name
                  <input required minLength={2} maxLength={128} placeholder="Pump Assembly Unit 1" value={unitForm.unit_name} onChange={(event) => setUnitForm({ ...unitForm, unit_name: event.target.value })} className="h-10 w-full rounded-md border bg-background px-3 font-normal" />
                </label>
                <label className="space-y-1.5 text-sm font-medium sm:col-span-2">Description
                  <input maxLength={255} placeholder="Optional" value={unitForm.description} onChange={(event) => setUnitForm({ ...unitForm, description: event.target.value })} className="h-10 w-full rounded-md border bg-background px-3 font-normal" />
                </label>
                <DialogFooter className="sm:col-span-2"><Button type="button" variant="outline" onClick={() => setShowUnitForm(false)}>Cancel</Button><Button type="submit" disabled={saving}>{saving && <Loader2 className="animate-spin" />} Create unit</Button></DialogFooter>
              </form>
          </DialogContent>
        </Dialog>

        <div className="flex w-fit flex-wrap rounded-xl border bg-white p-1 shadow-sm">
          <button
            type="button"
            onClick={() => {
              setStatusFilter("ALL");
              setActiveTab("staff");
            }}
            className={`flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors ${activeTab === "staff" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted"}`}
          >
            <Users className="size-4" /> Staff Accounts
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("units")}
            className={`flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors ${activeTab === "units" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted"}`}
          >
            <Factory className="size-4" /> Assembly Units
          </button>
          <button
            type="button"
            onClick={() => {
              setStatusFilter("ALL");
              setActiveTab("deactivated");
            }}
            className={`flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors ${activeTab === "deactivated" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted"}`}
          >
            <UserX className="size-4" /> Deactivated Accounts
            {inactiveUsers + inactiveAssemblyUnits.length > 0 && <span className={`rounded-full px-2 py-0.5 text-xs ${activeTab === "deactivated" ? "bg-white/20" : "bg-muted"}`}>{inactiveUsers + inactiveAssemblyUnits.length}</span>}
          </button>
        </div>

        {activeTab === "units" && <Card className="rounded-2xl shadow-sm">
          <CardHeader className="gap-4 border-b sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Factory className="text-primary" /> Assembly units
                <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">{activeAssemblyUnits.length}</span>
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">Units available when assigning an Assembly Manager.</p>
            </div>
            <label className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input value={unitSearch} onChange={(event) => setUnitSearch(event.target.value)} placeholder="Search unit code or name..." aria-label="Search assembly units" className="h-10 w-full rounded-xl border bg-muted/30 pl-9 pr-3 text-sm outline-none transition focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/10" />
            </label>
          </CardHeader>
          <CardContent>
            {visibleActiveAssemblyUnits.length ? (
              <div className="overflow-hidden rounded-lg border">
                <table className="w-full min-w-[600px] text-left text-sm">
                  <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">Unit code</th>
                      <th className="px-4 py-3">Unit name</th>
                      <th className="px-4 py-3">Description</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {pageActiveAssemblyUnits.map((unit) => (
                      <tr key={unit.id} className="transition-colors hover:bg-muted/30">
                        <td className="px-4 py-3 font-mono font-semibold text-primary">{unit.code}</td>
                        <td className="px-4 py-3 font-medium">{unit.name}</td>
                        <td className="px-4 py-3 text-muted-foreground">{unit.description || "—"}</td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${unitDisplayStatus(unit) === "USER NOT CREATED" ? "bg-amber-50 text-amber-700" : unitDisplayStatus(unit) === "USER CREATED" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                            {unitDisplayStatus(unit)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="outline" onClick={() => setEditUnit({ unit, name: unit.name, description: unit.description || "" })}>
                              <Pencil className="size-4" /> Edit
                            </Button>
                            <Button size="sm" variant="outline" className={unit.status === "ACTIVE" ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100 hover:text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800"} onClick={() => void updateAssemblyUnit(unit, { status: unit.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" })}>
                              {unit.status === "ACTIVE" ? "Deactivate" : "Activate"}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                {unitSearch ? "No assembly units match your search." : "No active assembly units."}
              </p>
            )}
            {visibleActiveAssemblyUnits.length > 0 && <AdminTablePagination page={activeUnitPage} total={visibleActiveAssemblyUnits.length} itemLabel="assembly units" onPageChange={setActiveUnitPage} />}
          </CardContent>
        </Card>}

        {activeTab === "deactivated" && inactiveAssemblyUnits.length > 0 && <Card className="rounded-2xl shadow-sm">
          <CardHeader className="gap-4 border-b sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2"><Factory className="text-primary" /> Deactivated assembly units <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{inactiveAssemblyUnits.length}</span></CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">Inactive units can be edited or activated again.</p>
            </div>
            <label className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input value={unitSearch} onChange={(event) => setUnitSearch(event.target.value)} placeholder="Search deactivated units..." aria-label="Search deactivated assembly units" className="h-10 w-full rounded-xl border bg-muted/30 pl-9 pr-3 text-sm outline-none transition focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/10" />
            </label>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full min-w-[700px] text-left text-sm">
                <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground"><tr>
                  <th className="px-4 py-3">Unit code</th><th className="px-4">Unit name</th><th className="px-4">Description</th><th className="px-4">Status</th><th className="px-4 text-right">Actions</th>
                </tr></thead>
                <tbody className="divide-y">{pageInactiveAssemblyUnits.map((unit) => <tr key={unit.id} className="transition-colors hover:bg-muted/30">
                  <td className="px-4 py-3 font-mono font-semibold text-primary">{unit.code}</td>
                  <td className="px-4 py-3 font-medium">{unit.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{unit.description || "—"}</td>
                  <td className="px-4 py-3"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">INACTIVE</span></td>
                  <td className="px-4 py-3"><div className="flex justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditUnit({ unit, name: unit.name, description: unit.description || "" })}><Pencil className="size-4" /> Edit</Button>
                    <Button size="sm" variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800" onClick={() => void updateAssemblyUnit(unit, { status: "ACTIVE" })}>Activate</Button>
                  </div></td>
                </tr>)}</tbody>
              </table>
            </div>
            {!visibleInactiveAssemblyUnits.length && <p className="py-8 text-center text-sm text-muted-foreground">No deactivated units match your search.</p>}
            {visibleInactiveAssemblyUnits.length > 0 && <AdminTablePagination page={inactiveUnitPage} total={visibleInactiveAssemblyUnits.length} itemLabel="assembly units" onPageChange={setInactiveUnitPage} />}
          </CardContent>
        </Card>}

        {activeTab === "deactivated" && inactiveAssemblyUnits.length === 0 && inactiveUsers === 0 && (
          <p className="rounded-lg border border-dashed bg-background p-8 text-center text-sm text-muted-foreground">No deactivated accounts or assembly units.</p>
        )}

        {(activeTab === "staff" || (activeTab === "deactivated" && inactiveUsers > 0)) && <Card className="overflow-hidden rounded-2xl shadow-sm">
          <CardHeader className="border-b p-4">
            <CardTitle className="sr-only">{activeTab === "deactivated" ? "Deactivated user accounts" : "Staff accounts"}</CardTitle>
            <div className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_180px_160px_160px]">
              <label className="relative">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search users by name, employee ID or email..." aria-label="Search users" className="h-10 w-full rounded-md border bg-background pl-9 pr-3 text-sm" />
              </label>
              <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} className="h-10 rounded-md border bg-background px-3 text-sm">
                <option value="ALL">All Roles</option>
                {roles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
              </select>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-10 rounded-md border bg-background px-3 text-sm">
                <option value="ALL">All Status</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option>
              </select>
              <select value={shiftFilter} onChange={(event) => setShiftFilter(event.target.value)} className="h-10 rounded-md border bg-background px-3 text-sm">
                <option value="ALL">All Shifts</option>
                {shifts.map((shift) => <option key={shift} value={shift}>{shift}</option>)}
              </select>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            {loading ? <div className="flex h-40 items-center justify-center"><Loader2 className="animate-spin" /></div> : <>
              <table className="w-full min-w-[950px] text-left text-sm">
                <thead className="border-b bg-muted/50 text-xs text-muted-foreground"><tr>
                  <th className="px-4 py-3">User</th><th className="px-4">Employee ID</th><th className="px-4">Role</th><th className="px-4">Shift / Unit</th><th className="px-4">Last Login</th><th className="px-4">Status</th><th className="px-4 text-right">Actions</th>
                </tr></thead>
                <tbody>{pageUsers.map((user) => (
                  <tr key={user.id} className="border-b last:border-0">
                    <td className="px-4 py-4"><div className="font-semibold">{user.full_name}</div><div className="text-xs text-muted-foreground">{user.email}</div></td>
                    <td className="px-4 font-mono text-xs">{user.employee_id}</td>
                    <td className="px-4">{roles.find((role) => role.value === user.role)?.label || user.role}</td>
                    <td className="px-4 text-muted-foreground">{user.role === "ASSEMBLY_MANAGER" ? user.assembly_unit_code || "Unassigned" : user.shift_name || "GENERAL"}</td>
                    <td className="px-4 text-muted-foreground">{user.last_login ? new Date(user.last_login).toLocaleString() : "Never"}</td>
                    <td className="px-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${user.status === "ACTIVE" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{user.status === "ACTIVE" ? "Active" : "Inactive"}</span></td>
                    <td className="flex justify-end gap-2 px-4 py-3">
                      <Button size="sm" variant="outline" onClick={() => openEdit(user)}><Pencil className="size-4" /> Edit</Button>
                      <Button size="sm" variant="outline" className={user.status === "ACTIVE" ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100 hover:text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800"} onClick={() => void updateUser(user, { status: user.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" })}>{user.status === "ACTIVE" ? "Deactivate account" : "Activate account"}</Button>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
              {!filteredUsers.length && <p className="py-10 text-center text-muted-foreground">No users found.</p>}
              <AdminTablePagination page={userPage} total={filteredUsers.length} itemLabel="users" onPageChange={setUserPage} />
            </>}
          </CardContent>
        </Card>}

        <Dialog open={Boolean(editUnit)} onOpenChange={(open) => !open && setEditUnit(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Edit assembly unit</DialogTitle>
              <DialogDescription>Update the name and description for {editUnit?.unit.code}. The unit code cannot be changed.</DialogDescription>
            </DialogHeader>
            {editUnit && <form onSubmit={saveAssemblyUnit} className="space-y-4">
              <label className="block space-y-1.5 text-sm font-medium">Unit name
                <input required minLength={2} maxLength={128} value={editUnit.name} onChange={(event) => setEditUnit({ ...editUnit, name: event.target.value })} className="h-10 w-full rounded-md border bg-background px-3 font-normal" />
              </label>
              <label className="block space-y-1.5 text-sm font-medium">Description
                <input maxLength={255} value={editUnit.description} onChange={(event) => setEditUnit({ ...editUnit, description: event.target.value })} placeholder="Optional" className="h-10 w-full rounded-md border bg-background px-3 font-normal" />
              </label>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditUnit(null)}>Cancel</Button>
                <Button type="submit" disabled={saving}>{saving && <Loader2 className="animate-spin" />} Save changes</Button>
              </DialogFooter>
            </form>}
          </DialogContent>
        </Dialog>

        <Dialog open={Boolean(editForm)} onOpenChange={(open) => !open && setEditForm(null)}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Edit user</DialogTitle>
              <DialogDescription>
                Update account details and access. Employee ID {editForm?.user.employee_id} cannot
                be changed.
              </DialogDescription>
            </DialogHeader>
            {editForm && (
              <form onSubmit={saveEdit} autoComplete="off" className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  {(
                    [
                      ["full_name", "Full name", "text"],
                      ["username", "Username", "text"],
                      ["email", "Email", "email"],
                    ] as const
                  ).map(([key, label, type]) => (
                    <label className="space-y-1.5 text-sm font-medium" key={key}>
                      {label}
                      <input
                        name={`edit-user-${editForm.user.id}-${key}`}
                        required
                        minLength={key === "username" || key === "email" ? 3 : 2}
                        maxLength={key === "username" ? 64 : 128}
                        type={type}
                        autoComplete="off"
                        value={editForm[key]}
                        onChange={(event) =>
                          setEditForm({ ...editForm, [key]: event.target.value })
                        }
                        className="h-10 w-full rounded-md border bg-background px-3 font-normal"
                      />
                    </label>
                  ))}
                  <PasswordInput
                    label="New password (optional)"
                    minLength={8}
                    maxLength={128}
                    name={`edit-user-${editForm.user.id}-password`}
                    autoComplete="new-password"
                    value={editForm.password}
                    onChange={(password) => setEditForm({ ...editForm, password })}
                  />
                  <label className="space-y-1.5 text-sm font-medium">
                    Role
                    <select
                      required
                      value={editForm.role}
                      onChange={(event) => {
                        const role = event.target.value;
                        setEditForm({
                          ...editForm,
                          role,
                          shift_name: role === "SUPPLIER" ? "" : editForm.shift_name || "GENERAL",
                          page_permissions: {},
                        });
                      }}
                      className="h-10 w-full rounded-md border bg-background px-3 font-normal"
                    >
                      {roles.map((role) => (
                        <option key={role.value} value={role.value}>
                          {role.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {editForm.role === "ASSEMBLY_MANAGER" ? (
                    <label className="space-y-1.5 text-sm font-medium">
                      Assembly unit code
                      <select
                        required
                        value={editForm.assembly_unit_code}
                        onChange={(event) => setEditForm({ ...editForm, assembly_unit_code: event.target.value.toUpperCase() })}
                        className="h-10 w-full rounded-md border bg-background px-3 font-normal"
                      >
                        <option value="">Select assembly unit</option>
                        {assemblyUnits.filter((unit) => unit.status === "ACTIVE" || unit.code === editForm.assembly_unit_code).map((unit) => <option key={unit.id} value={unit.code}>{unit.name} ({unit.code}){unit.status !== "ACTIVE" ? " · Inactive" : ""}</option>)}
                      </select>
                    </label>
                  ) : (
                    <label className="space-y-1.5 text-sm font-medium">
                      Work shift
                      <input
                        maxLength={64}
                        value={editForm.shift_name}
                        onChange={(event) => setEditForm({ ...editForm, shift_name: event.target.value.toUpperCase() })}
                        disabled={editForm.role === "SUPPLIER"}
                        placeholder={editForm.role === "SUPPLIER" ? "Not applicable for suppliers" : "e.g. SHIFT-A"}
                        className="h-10 w-full rounded-md border bg-background px-3 font-normal disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
                      />
                    </label>
                  )}
                </div>

                <div>
                  <p className="mb-2 text-sm font-semibold">Page access</p>
                  <div className="overflow-hidden rounded-lg border">
                    {(ROLE_PAGES[editForm.role] || []).map((page) => (
                      <div
                        key={page.key}
                        className="grid grid-cols-[1fr_100px_110px] items-center border-b px-4 py-3 text-sm last:border-0"
                      >
                        <span className="font-medium">{page.label}</span>
                        {(["READ", "WRITE"] as const).map((access) => (
                          <label key={access} className="flex items-center justify-center gap-2">
                            <input
                              type="radio"
                              name={`edit-${page.key}`}
                              checked={editForm.page_permissions[page.key] === access}
                              onChange={() =>
                                setEditForm({
                                  ...editForm,
                                  page_permissions: {
                                    ...editForm.page_permissions,
                                    [page.key]: access,
                                  },
                                })
                              }
                              className="size-4 accent-primary"
                            />
                            {access === "READ" ? "Read" : "Write"}
                          </label>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setEditForm(null)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={saving}>
                    {saving && <Loader2 className="animate-spin" />} Save changes
                  </Button>
                </DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
