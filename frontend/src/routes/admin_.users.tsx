import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Factory, Loader2, Pencil, Plus, ShieldCheck } from "lucide-react";
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
  const [unitForm, setUnitForm] = useState({ unit_code: "", unit_name: "", description: "" });
  const [search, setSearch] = useState("");
  const [editForm, setEditForm] = useState<EditForm | null>(null);

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
    if (!query) return users;
    return users.filter((user) =>
      [user.full_name, user.username, user.employee_id, user.email, user.role].some((value) =>
        value.toLowerCase().includes(query),
      ),
    );
  }, [search, users]);

  const createUser = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      if (!Object.keys(form.page_permissions).length) {
        toast.error("Select access for at least one page");
        return;
      }
      const created = await api.createAdminUser(form);
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
    setSaving(true);
    try {
      const created = await api.createAdminAssemblyUnit(unitForm);
      setAssemblyUnits((current) => [...current, created].sort((a, b) => a.code.localeCompare(b.code)));
      setUnitForm({ unit_code: "", unit_name: "", description: "" });
      setShowUnitForm(false);
      toast.success(`Assembly unit ${created.code} created`);
    } catch (error: any) {
      toast.error(error.message || "Unable to create assembly unit");
    } finally {
      setSaving(false);
    }
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
      shift_name: user.shift_name || "GENERAL",
      assembly_unit_code: user.assembly_unit_code || "",
      page_permissions: { ...(user.page_permissions || {}) },
    });
  };

  const saveEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editForm) return;
    if (!Object.keys(editForm.page_permissions).length) {
      toast.error("Select access for at least one page");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        username: editForm.username,
        full_name: editForm.full_name,
        email: editForm.email,
        role: editForm.role,
        shift_name: editForm.shift_name,
        assembly_unit_code: editForm.assembly_unit_code,
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
    <AppShell title="User Management" subtitle="Create staff accounts and manage access">
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">User management</h1>
            <p className="text-sm text-muted-foreground">
              Manage warehouse staff roles, shifts, assembly units, and account status.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setShowUnitForm((current) => !current)}>
              <Factory /> Create assembly unit
            </Button>
            <Button onClick={() => setShowForm((current) => !current)}>
              <Plus /> Create user
            </Button>
          </div>
        </div>

        {showUnitForm && (
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Factory className="text-primary" /> Create assembly unit</CardTitle></CardHeader>
            <CardContent>
              <form onSubmit={createAssemblyUnit} className="grid gap-4 md:grid-cols-3">
                <label className="space-y-1.5 text-sm font-medium">Unit code
                  <input required placeholder="UNIT-01" value={unitForm.unit_code} onChange={(event) => setUnitForm({ ...unitForm, unit_code: event.target.value.toUpperCase() })} className="h-10 w-full rounded-md border bg-background px-3 font-normal" />
                </label>
                <label className="space-y-1.5 text-sm font-medium">Unit name
                  <input required placeholder="Pump Assembly Unit 1" value={unitForm.unit_name} onChange={(event) => setUnitForm({ ...unitForm, unit_name: event.target.value })} className="h-10 w-full rounded-md border bg-background px-3 font-normal" />
                </label>
                <label className="space-y-1.5 text-sm font-medium">Description
                  <input placeholder="Optional" value={unitForm.description} onChange={(event) => setUnitForm({ ...unitForm, description: event.target.value })} className="h-10 w-full rounded-md border bg-background px-3 font-normal" />
                </label>
                <div className="flex gap-2 md:col-span-3"><Button type="submit" disabled={saving}>{saving && <Loader2 className="animate-spin" />} Create unit</Button><Button type="button" variant="outline" onClick={() => setShowUnitForm(false)}>Cancel</Button></div>
              </form>
            </CardContent>
          </Card>
        )}

        {showForm && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="text-primary" /> Create staff account
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={createUser} className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {(
                  [
                    ["full_name", "Full name"],
                    ["username", "Username"],
                    ["email", "Email"],
                    ["password", "Password"],
                  ] as const
                ).map(([key, label]) => (
                  <label className="space-y-1.5 text-sm font-medium" key={key}>
                    {label}
                    <input
                      required
                      minLength={key === "password" ? 8 : 2}
                      type={key === "password" ? "password" : key === "email" ? "email" : "text"}
                      value={form[key]}
                      onChange={(event) => setForm({ ...form, [key]: event.target.value })}
                      className="h-10 w-full rounded-md border bg-background px-3 font-normal"
                    />
                  </label>
                ))}
                <label className="space-y-1.5 text-sm font-medium">
                  Role
                  <select
                    value={form.role}
                    onChange={(event) =>
                      setForm({ ...form, role: event.target.value, page_permissions: {} })
                    }
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
                      placeholder="e.g. SHIFT-A"
                      value={form.shift_name}
                      onChange={(event) => setForm({ ...form, shift_name: event.target.value.toUpperCase() })}
                      className="h-10 w-full rounded-md border bg-background px-3 font-normal"
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
                <div className="flex items-end gap-2 md:col-span-2 xl:col-span-3">
                  <Button type="submit" disabled={saving}>
                    {saving && <Loader2 className="animate-spin" />} Create account
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Staff accounts</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Roles determine which workspace each person can access.
              </p>
            </div>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search users..."
              aria-label="Search users"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm sm:w-64"
            />
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {loading ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="animate-spin" />
              </div>
            ) : (
              <>
                <table className="w-full min-w-[850px] text-left text-sm">
                  <thead className="border-b text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="py-3">User</th>
                      <th>Employee ID</th>
                      <th>Role</th>
                      <th>Last login</th>
                      <th>Status</th>
                      <th className="text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((user) => (
                      <tr key={user.id} className="border-b last:border-0">
                        <td className="py-4">
                          <div className="font-semibold">{user.full_name}</div>
                          <div className="text-xs text-muted-foreground">
                            {user.username} · {user.email}
                          </div>
                        </td>
                        <td>{user.employee_id}</td>
                        <td>
                          <div>{roles.find((role) => role.value === user.role)?.label || user.role}</div>
                          <div className="text-xs text-muted-foreground">
                            {user.role === "ASSEMBLY_MANAGER"
                              ? user.assembly_unit_code || "Unit assignment required"
                              : user.shift_name || "General shift"}
                          </div>
                        </td>
                        <td className="text-muted-foreground">
                          {user.last_login ? new Date(user.last_login).toLocaleString() : "Never"}
                        </td>
                        <td>{user.status}</td>
                        <td className="flex justify-end gap-2 py-3">
                          <Button size="sm" variant="outline" onClick={() => openEdit(user)}>
                            <Pencil className="size-4" /> Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              void updateUser(user, {
                                status: user.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
                              })
                            }
                          >
                            {user.status === "ACTIVE" ? "Deactivate" : "Activate"}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!filteredUsers.length && (
                  <p className="py-10 text-center text-muted-foreground">No users found.</p>
                )}
              </>
            )}
          </CardContent>
        </Card>

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
                      ["password", "New password (optional)", "password"],
                    ] as const
                  ).map(([key, label, type]) => (
                    <label className="space-y-1.5 text-sm font-medium" key={key}>
                      {label}
                      <input
                        name={`edit-user-${editForm.user.id}-${key}`}
                        required={key !== "password"}
                        minLength={key === "password" ? 8 : 2}
                        type={type}
                        autoComplete={key === "password" ? "new-password" : "off"}
                        value={editForm[key]}
                        onChange={(event) =>
                          setEditForm({ ...editForm, [key]: event.target.value })
                        }
                        className="h-10 w-full rounded-md border bg-background px-3 font-normal"
                      />
                    </label>
                  ))}
                  <label className="space-y-1.5 text-sm font-medium">
                    Role
                    <select
                      value={editForm.role}
                      onChange={(event) =>
                        setEditForm({
                          ...editForm,
                          role: event.target.value,
                          page_permissions: {},
                        })
                      }
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
                        {assemblyUnits.filter((unit) => unit.status === "ACTIVE").map((unit) => <option key={unit.id} value={unit.code}>{unit.name} ({unit.code})</option>)}
                      </select>
                    </label>
                  ) : (
                    <label className="space-y-1.5 text-sm font-medium">
                      Work shift
                      <input
                        value={editForm.shift_name}
                        onChange={(event) => setEditForm({ ...editForm, shift_name: event.target.value.toUpperCase() })}
                        className="h-10 w-full rounded-md border bg-background px-3 font-normal"
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
