import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  KeyRound,
  MoreVertical,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  UserCog,
  UserMinus,
  Users,
} from "lucide-react";
import { AppShell } from "@/components/wms/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api-client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/users")({
  head: () => ({
    meta: [
      { title: "User Management · KaizenX" },
      {
        name: "description",
        content:
          "Admin user management dashboard for roles, access, passwords, and activity review.",
      },
    ],
  }),
  component: UserManagementPage,
});

const statusOptions = ["All Status", "Active", "Inactive"];

type LiveUser = {
  id: string;
  name: string;
  email: string;
  employeeId: string;
  role: string;
  applications: string[];
  status: string;
  lastActivity: string;
};

function UserManagementPage() {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("All Roles");
  const [statusFilter, setStatusFilter] = useState("All Status");
  const [users, setUsers] = useState<LiveUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<LiveUser | null>(null);
  const [selectedAction, setSelectedAction] = useState<"view" | "access" | "activity" | null>(null);

  const loadUsers = async () => {
    setIsLoading(true);
    try {
      const managers = await api.getStoreManagers();
      setUsers(
        managers.map((user) => ({
          id: user.id,
          name: user.full_name,
          email: user.email,
          employeeId: user.employee_id,
          role: user.role || "Store Manager",
          applications: user.applications || ["WMS"],
          status: user.status === "ACTIVE" ? "Active" : "Inactive",
          lastActivity: user.updated_at ? new Date(user.updated_at).toLocaleString() : "Never",
        })),
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadUsers();
  }, []);

  const roleOptions = useMemo(
    () => ["All Roles", ...Array.from(new Set(users.map((user) => user.role)))],
    [users],
  );

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return users.filter((user) => {
      const matchesSearch =
        !query ||
        user.name.toLowerCase().includes(query) ||
        user.email.toLowerCase().includes(query) ||
        user.employeeId.toLowerCase().includes(query);
      const matchesRole = roleFilter === "All Roles" || user.role === roleFilter;
      const matchesStatus = statusFilter === "All Status" || user.status === statusFilter;
      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [roleFilter, search, statusFilter, users]);

  const changeUserStatus = async (user: LiveUser, nextStatus: string) => {
    try {
      await api.updateStoreManagerStatus(user.id, nextStatus);
      await loadUsers();
      toast.success(`User ${nextStatus.toLowerCase()} successfully`);
    } catch (error: any) {
      toast.error(error?.message || "Unable to update user status");
    }
  };

  return (
    <AppShell
      title="User Management"
      subtitle="Create users, assign roles, manage access, and review admin activity."
      actions={
        <Button
          size="sm"
          className="rounded-xl text-xs font-semibold shadow-glow"
          onClick={() => setIsAddOpen(true)}
        >
          <Plus className="mr-1.5 size-3.5" /> Add User
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[1fr_180px_160px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, email, employee ID..."
              className="h-10 rounded-xl border-border/50 bg-card pl-9 text-sm"
            />
          </div>
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="h-10 rounded-xl border-border/50 bg-card text-sm">
              <SelectValue placeholder="Role" />
            </SelectTrigger>
            <SelectContent>
              {roleOptions.map((role) => (
                <SelectItem key={role} value={role}>
                  {role}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-10 rounded-xl border-border/50 bg-card text-sm">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((status) => (
                <SelectItem key={status} value={status}>
                  {status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-soft">
          {isLoading && (
            <div className="border-b border-border/40 px-4 py-3 text-xs text-muted-foreground">
              Loading users...
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-border/60 bg-muted/30 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Employee ID</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Last Activity</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center">
                      <Users className="mx-auto mb-2 size-8 text-muted-foreground/50" />
                      <p className="text-sm font-semibold text-foreground">No users found</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Adjust search, role, or status filters to view users.
                      </p>
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((user) => (
                    <tr key={user.id} className="transition-colors hover:bg-muted/20">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-xs font-black text-primary">
                            {user.name
                              .split(" ")
                              .map((part) => part[0])
                              .join("")
                              .slice(0, 2)}
                          </div>
                          <div>
                            <p className="font-bold text-foreground">{user.name}</p>
                            <p className="text-xs text-muted-foreground">{user.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs font-bold text-foreground">
                        {user.employeeId}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="rounded-lg px-2 py-0.5 text-xs">
                          {user.role}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold",
                            user.status === "Active"
                              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {user.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {user.lastActivity}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="size-8 rounded-xl p-0">
                              <MoreVertical className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuItem
                              onClick={() => {
                                setSelectedUser(user);
                                setSelectedAction("view");
                              }}
                            >
                              <Users className="mr-2 size-4" /> View User
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setIsAddOpen(true)}>
                              <UserCog className="mr-2 size-4" /> Edit User
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => {
                                setSelectedUser(user);
                                setSelectedAction("access");
                              }}
                            >
                              <SlidersHorizontal className="mr-2 size-4" /> Manage Access
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                toast.info(
                                  "Password reset API is not available for this user type yet",
                                )
                              }
                            >
                              <KeyRound className="mr-2 size-4" /> Reset Password
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {user.status === "Active" ? (
                              <DropdownMenuItem
                                className="text-rose-600 focus:text-rose-600"
                                onClick={() => void changeUserStatus(user, "INACTIVE")}
                              >
                                <UserMinus className="mr-2 size-4" /> Deactivate
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                onClick={() => void changeUserStatus(user, "ACTIVE")}
                              >
                                <UserCog className="mr-2 size-4" /> Activate
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              onClick={() => {
                                setSelectedUser(user);
                                setSelectedAction("activity");
                              }}
                            >
                              <Activity className="mr-2 size-4" /> View Activity
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5 text-primary" />
          <span>User accounts are loaded from the live user service.</span>
        </div>
      </div>
      <AddUserDialog open={isAddOpen} onOpenChange={setIsAddOpen} onCreated={loadUsers} />
      <UserActionDialog
        user={selectedUser}
        action={selectedAction}
        onClose={() => {
          setSelectedUser(null);
          setSelectedAction(null);
        }}
      />
    </AppShell>
  );
}

function UserActionDialog({
  user,
  action,
  onClose,
}: {
  user: LiveUser | null;
  action: "view" | "access" | "activity" | null;
  onClose: () => void;
}) {
  if (!user || !action) return null;
  const title =
    action === "view" ? "User Details" : action === "access" ? "Manage Access" : "User Activity";
  return (
    <Dialog open={Boolean(user && action)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg rounded-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {action === "view" && (
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                ["Name", user.name],
                ["Employee ID", user.employeeId],
                ["Email", user.email],
                ["Role", user.role],
                ["Status", user.status],
                ["Last Activity", user.lastActivity],
              ].map(([label, value]) => (
                <div key={label}>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="mt-1 text-sm font-semibold">{value}</p>
                </div>
              ))}
            </div>
          )}
          {action === "access" && (
            <div className="space-y-3">
              <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
                <p className="font-semibold">{user.role}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Access is inherited from the assigned role. Advanced permission overrides require
                  the admin permissions API.
                </p>
              </div>
              <p className="text-sm text-muted-foreground">
                Current live account: {user.name} ({user.employeeId})
              </p>
            </div>
          )}
          {action === "activity" && (
            <div className="rounded-xl border border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground">
              Activity history API is not available for this user type yet.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const emptyUserForm = {
  full_name: "",
  employee_id: "",
  username: "",
  email: "",
  password: "",
  role: "Store Manager",
  application: "WMS",
  scope: "Store",
  store_id: "",
  status: "ACTIVE",
  sendInvitation: true,
  advancedPermissions: false,
};

function AddUserDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => Promise<void>;
}) {
  const [form, setForm] = useState(emptyUserForm);
  const [stores, setStores] = useState<any[]>([]);
  const [existingUsers, setExistingUsers] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  useEffect(() => {
    if (open) {
      void api.getStores({ status: "ACTIVE" }).then(setStores);
      void api.getStoreManagers().then(setExistingUsers);
    }
  }, [open]);
  const update = (key: keyof typeof form, value: string | boolean) => {
    setErrorMessage("");
    setForm((current) => ({ ...current, [key]: value }));
  };
  const updateName = (name: string) => {
    const prefix = name
      .trim()
      .split(/\s+/)[0]
      ?.replace(/[^a-z]/gi, "")
      .slice(0, 3)
      .toUpperCase();
    if (!prefix) {
      update("full_name", name);
      update("employee_id", "");
      return;
    }
    const usedIds = new Set(
      existingUsers.map((user) => String(user.employee_id || "").toUpperCase()),
    );
    let sequence = 1;
    let employeeId = `EMP-${prefix}-${String(sequence).padStart(3, "0")}`;
    while (usedIds.has(employeeId)) {
      sequence += 1;
      employeeId = `EMP-${prefix}-${String(sequence).padStart(3, "0")}`;
    }
    update("full_name", name);
    update("employee_id", employeeId);
  };
  const canSave = Boolean(
    form.full_name.trim() &&
    form.employee_id.trim() &&
    form.username.trim() &&
    form.password.length >= 4 &&
    form.store_id,
  );
  const normalizedEmail = (
    form.email.trim() || `${form.username.trim().toLowerCase()}@kaizenx.local`
  ).toLowerCase();
  const duplicateField = existingUsers.find(
    (user) =>
      String(user.employee_id || "").toUpperCase() === form.employee_id.trim().toUpperCase() ||
      String(user.username || "").toLowerCase() === form.username.trim().toLowerCase() ||
      String(user.email || "").toLowerCase() === normalizedEmail,
  );
  const save = async () => {
    if (!canSave) return;
    if (duplicateField) {
      setErrorMessage("A user with this Employee ID, username, or email already exists.");
      return;
    }
    setSaving(true);
    try {
      await api.createStoreManager({
        full_name: form.full_name,
        employee_id: form.employee_id,
        username: form.username,
        email: form.email.trim() || `${form.username.trim().toLowerCase()}@kaizenx.local`,
        password: form.password,
        store_id: form.store_id,
        status: form.status,
        role: form.role,
        applications: form.application === "WMS + AMS" ? ["WMS", "AMS"] : [form.application],
      });
      await onCreated();
      onOpenChange(false);
      setForm(emptyUserForm);
      setErrorMessage("");
    } catch (error: any) {
      setErrorMessage(error?.message || "Unable to create user. Please try again.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl rounded-2xl">
        <DialogHeader>
          <DialogTitle>Add New User</DialogTitle>
        </DialogHeader>
        <div className="max-h-[72vh] space-y-5 overflow-y-auto pr-1">
          {errorMessage && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {errorMessage}
            </div>
          )}
          <FormSection
            title="User Information"
            description="Basic identity and contact details for the user."
          >
            {(
              [
                ["full_name", "Full Name *"],
                ["employee_id", "Employee ID *"],
                ["username", "Username *"],
                ["email", "Email Address"],
                ["password", "Temporary Password *"],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="space-y-1.5">
                <Label>{label}</Label>
                <Input
                  type={key === "password" ? "password" : "text"}
                  value={form[key]}
                  readOnly={key === "employee_id"}
                  onChange={(event) =>
                    key === "full_name"
                      ? updateName(event.target.value)
                      : update(key, event.target.value)
                  }
                  placeholder={key === "employee_id" ? "Generated from full name" : undefined}
                  className={key === "employee_id" ? "bg-muted/40 font-mono" : undefined}
                />
              </div>
            ))}
          </FormSection>
          <FormSection
            title="Role & Access"
            description="Permissions are inherited from the selected role."
          >
            <div className="space-y-1.5">
              <Label>Role *</Label>
              <Select value={form.role} onValueChange={(value) => update("role", value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Store Manager">Store Manager</SelectItem>
                  <SelectItem value="Warehouse Manager">Warehouse Manager</SelectItem>
                  <SelectItem value="Procurement Officer">Procurement Officer</SelectItem>
                  <SelectItem value="Admin Officer">Admin Officer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.advancedPermissions}
                onCheckedChange={(checked) => update("advancedPermissions", checked === true)}
              />{" "}
              Enable Advanced Permissions overrides
            </label>
          </FormSection>
          <FormSection
            title="Application Access"
            description="Choose the application context for this account."
          >
            <div className="space-y-1.5">
              <Label>Application</Label>
              <Select
                value={form.application}
                onValueChange={(value) => update("application", value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="WMS">WMS</SelectItem>
                  <SelectItem value="AMS">AMS</SelectItem>
                  <SelectItem value="WMS + AMS">WMS + AMS</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </FormSection>
          <FormSection
            title="Location Scope"
            description="Limit access to the relevant operational location."
          >
            <div className="space-y-1.5">
              <Label>Scope</Label>
              <Select value={form.scope} onValueChange={(value) => update("scope", value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Company">Company</SelectItem>
                  <SelectItem value="Warehouse">Warehouse</SelectItem>
                  <SelectItem value="Store">Store</SelectItem>
                  <SelectItem value="Zone">Zone</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </FormSection>
          <div className="space-y-1.5">
            <Label>Assigned Store *</Label>
            <Select value={form.store_id} onValueChange={(value) => update("store_id", value)}>
              <SelectTrigger>
                <SelectValue placeholder="Select store" />
              </SelectTrigger>
              <SelectContent>
                {stores.map((store) => (
                  <SelectItem key={store.id} value={store.id}>
                    {store.store_name || store.store_code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <FormSection
            title="Account Settings"
            description="Control account availability and onboarding."
          >
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(value) => update("status", value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="SUSPENDED">Suspended</SelectItem>
                  <SelectItem value="INACTIVE">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.sendInvitation}
                onCheckedChange={(checked) => update("sendInvitation", checked === true)}
              />{" "}
              Send invitation email
            </label>
          </FormSection>
          <FormSection
            title="Audit Information"
            description="Creation details are recorded automatically by the system."
          >
            <p className="text-xs text-muted-foreground">
              Created by the signed-in administrator with timestamp and account history.
            </p>
          </FormSection>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={!canSave || saving} onClick={() => void save()}>
              {saving ? "Creating..." : "Create User"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border/60 bg-muted/10 p-4">
      <div className="mb-3">
        <h3 className="text-sm font-bold text-foreground">{title}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}
