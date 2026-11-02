import { InformationTooltip } from "@/components/ui/information-tooltip";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Eye,
  Loader2,
  PackagePlus,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  ToggleLeft,
  ToggleRight,
  MoreHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/wms/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api-client";

export const Route = createFileRoute("/supplier-materials")({ component: SupplierMaterials });
const UOMS = ["PCS", "BUNDLE", "SET", "KG", "LITER", "METER", "BOX"];
const emptyForm = { code: "", name: "", category: "", description: "", uom: "PCS" };


function SupplierMaterials() {
  const [materials, setMaterials] = useState<any[]>([]);
  const [query, setQuery] = useState("");
  const [uomFilter, setUomFilter] = useState("ALL");
  const [materialPage, setMaterialPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [details, setDetails] = useState<any | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [pendingAction, setPendingAction] = useState<{
    type: "status" | "delete";
    material: any;
  } | null>(null);

  const loadMaterials = async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await api.getMaterialComponents("ALL");
      setMaterials(
        (rows || []).map((m: any) => ({
          ...m,
          code: m.code || m.material_code,
          name: m.name || m.material_name,
          uom: m.uom || m.base_uom,
        })),
      );
    } catch (err: any) {
      setError(err?.message || "Unable to load materials");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void loadMaterials();
  }, []);
  const filtered = useMemo(
    () =>
      materials.filter(
        (m) =>
          `${m.code || ""} ${m.name || ""}`.toLowerCase().includes(query.toLowerCase()) &&
          (uomFilter === "ALL" || m.uom === uomFilter),
      ),
    [materials, query, uomFilter],
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / 10));
  const currentPage = Math.min(materialPage, pageCount);
  const pageStart = (currentPage - 1) * 10;
  const pagedMaterials = filtered.slice(pageStart, pageStart + 10);
  useEffect(() => { setMaterialPage(1); }, [query, uomFilter]);
  useEffect(() => { setMaterialPage(page => Math.min(page, pageCount)); }, [pageCount]);
  const uoms = [...new Set([...UOMS, ...materials.map((m) => m.uom).filter(Boolean)])];
  const openAdd = async () => {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };
  const generateMaterialCode = (materialName = form.name) => {
    if (editing || !materialName.trim()) return;
    const prefix =
      materialName
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 4) || "MAT";
    const usedCodes = new Set(
      materials.map((material) => String(material.code || "").toUpperCase()),
    );
    let sequence = materials.length + 1;
    let generated = `MAT-${prefix}-${String(sequence).padStart(3, "0")}`;
    while (usedCodes.has(generated)) {
      sequence += 1;
      generated = `MAT-${prefix}-${String(sequence).padStart(3, "0")}`;
    }
    setForm((current) => ({ ...current, code: generated }));
  };
  const openEdit = (m: any) => {
    setEditing(m);
    setForm({
      code: m.code || "",
      name: m.name || "",
      category: m.category || "",
      description: m.description || "",
      uom: m.uom || "PCS",
    });
    setDialogOpen(true);
  };
  const saveMaterial = async (event: React.FormEvent) => {
    event.preventDefault();
    const next = { ...form, code: form.code.trim().toUpperCase(), name: form.name.trim() };
    if (!next.code || !next.name || !next.uom) {
      toast.error("Complete all required material fields");
      return;
    }
    if (
      materials.some(
        (m) =>
          m.id !== editing?.id &&
          (String(m.code).toUpperCase() === next.code ||
            String(m.name).toLowerCase() === next.name.toLowerCase()),
      )
    ) {
      toast.error("Material code or name already exists");
      return;
    }
    setSaving(true);
    try {
      const saved = editing
        ? await api.updateGateMaterial(editing.id, { material_name: next.name, base_uom: next.uom })
        : await api.createMaterialComponent(next.name, next.uom, next.code);
      setMaterials((rows) =>
        editing
          ? rows.map((row) => (row.id === editing.id ? { ...row, ...saved, ...next } : row))
          : [{ ...saved, ...next }, ...rows],
      );
      setDialogOpen(false);
      toast.success(editing ? "Material updated" : "Material created");
    } catch (err: any) {
      toast.error(err?.message || "Unable to save material");
    } finally {
      setSaving(false);
    }
  };
  const toggleStatus = async (m: any) => {
    const nextStatus = String(m.status).toUpperCase() === "ACTIVE" ? "Inactive" : "Active";
    try {
      const result = await api.updateGateMaterialStatus(m.id, nextStatus);
      setMaterials((rows) =>
        rows.map((row) =>
          row.id === m.id ? { ...row, status: result.status || nextStatus } : row,
        ),
      );
      toast.success(`Material ${nextStatus.toLowerCase()}`);
    } catch (err: any) {
      toast.error(err?.message || "Unable to change material status");
    }
  };
  const deleteMaterial = async (m: any) => {
    try {
      const result = await api.deleteGateMaterial(m.id);
      if (result?.deleted === false) {
        setMaterials((rows) =>
          rows.map((row) => (row.id === m.id ? { ...row, status: "Inactive" } : row)),
        );
        toast.success("Material was deactivated because it is in use");
      } else {
        setMaterials((rows) => rows.filter((row) => row.id !== m.id));
        toast.success("Material deleted");
      }
    } catch (err: any) {
      if (err?.status === 404) {
        setMaterials((rows) => rows.filter((row) => row.id !== m.id));
        toast.info("This material was already removed. The list was refreshed.");
      } else {
        toast.error(err?.message || "Material cannot be deleted because it is in use");
      }
    }
  };
  const confirmPendingAction = async () => {
    if (!pendingAction) return;
    const action = pendingAction;
    setPendingAction(null);
    if (action.type === "status") await toggleStatus(action.material);
    else await deleteMaterial(action.material);
  };
  return (
    <TooltipProvider delayDuration={150}>
      <AppShell
        title={
          <span className="supplier-page-title inline-flex items-center gap-3">
            <span className="supplier-page-title-icon inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-primary">
              <PackagePlus className="size-5" aria-hidden="true" />
            </span>
            Material Master
          </span>
        }
        subtitle="Create and manage the materials available for your ASN submissions."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              data-refresh-control="true"
              aria-label="Refresh material master"
              title="Refresh material master"
              disabled={loading}
              onClick={() => void loadMaterials()}
            >
              {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={openAdd}
                  className="h-10 rounded-lg bg-primary text-sm font-medium text-primary-foreground shadow-none hover:bg-primary/90"
                >
                  <Plus className="size-4" /> Add Material
                </Button>
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                className="rounded-lg border border-border bg-popover text-xs font-medium text-popover-foreground shadow-soft"
              >
                Add a new material to your supplier catalog.
              </TooltipContent>
            </Tooltip>
          </div>
        }
      >
        <Card className="supplier-module-page rounded-xl border-border bg-card shadow-sm">
          <CardHeader className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <PackagePlus className="size-4 text-primary" /> Material catalog
            </CardTitle>
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
              <div className="relative w-full sm:w-64">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search materials"
                  aria-label="Search materials by code or name"
                  className="h-10 rounded-lg pl-9 text-sm"
                />
              </div>
              <Select value={uomFilter} onValueChange={setUomFilter}>
                <SelectTrigger
                  aria-label="Filter materials by unit of measurement"
                  className="h-10 w-28 rounded-lg text-sm"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All UOM</SelectItem>
                  {uoms.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                className="h-10 rounded-lg text-sm"
                onClick={() => {
                  setQuery("");
                  setUomFilter("ALL");
                }}
              >
                Clear Filters
              </Button>
            </div>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {error ? (
              <div
                role="alert"
                className="mx-4 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/25 bg-danger-soft p-4 text-sm text-destructive sm:mx-5"
              >
                <span>{error}</span>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 rounded-lg"
                  onClick={() => void loadMaterials()}
                >
                  Try again
                </Button>
              </div>
            ) : (
              <>
                <div className="mx-4 overflow-x-auto rounded-lg border border-border sm:mx-5">
                  <table className="w-full min-w-[800px] text-left text-sm">
                    <thead className="border-b border-border bg-muted/60 text-xs font-medium text-muted-foreground">
                      <tr>
                        <th scope="col" className="px-4 py-3">
                          <span className="inline-flex items-center gap-1.5">
                            Material Code

                          </span>
                        </th>
                        <th scope="col" className="px-4 py-3">
                          Material name
                        </th>
                        <th scope="col" className="px-4 py-3">
                          <span className="inline-flex items-center gap-1.5">
                            UOM
                            <InformationTooltip help="quantity" />
                          </span>
                        </th>
                        <th scope="col" className="px-4 py-3">
                          Status
                        </th>
                        <th scope="col" className="px-4 py-3 text-right">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/70">
                      {loading ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-4 py-10 text-center text-sm text-muted-foreground"
                          >
                            <span className="inline-flex items-center gap-2" role="status">
                              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                              Loading materials…
                            </span>
                          </td>
                        </tr>
                      ) : !filtered.length ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-4 py-10 text-center text-sm text-muted-foreground"
                          >
                            {materials.length
                              ? "No materials match your search or UOM filter."
                              : "No materials in your catalog yet."}
                          </td>
                        </tr>
                      ) : (
                        pagedMaterials.map((m) => (
                          <tr key={m.id || m.code} className="transition-colors hover:bg-muted/40">
                            <td className="px-4 py-3 font-mono font-medium text-primary">
                              {m.code || "—"}
                            </td>
                            <td className="px-4 py-3 text-foreground">{m.name || "—"}</td>
                            <td className="px-4 py-3 text-foreground">{m.uom || "—"}</td>
                            <td className="px-4 py-3">
                              <Badge
                                variant="outline"
                                className={`rounded-full font-medium ${
                                  String(m.status).toUpperCase() === "ACTIVE"
                                    ? "border-success/30 bg-success-soft text-success"
                                    : String(m.status).toUpperCase() === "INACTIVE"
                                      ? "border-border bg-muted text-muted-foreground"
                                      : "border-border bg-background text-muted-foreground"
                                }`}
                              >
                                {String(m.status).toUpperCase() === "ACTIVE"
                                  ? "Active"
                                  : String(m.status).toUpperCase() === "INACTIVE"
                                    ? "Inactive"
                                    : "—"}
                              </Badge>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <DropdownMenu>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <DropdownMenuTrigger asChild>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        title="Material actions"
                                        aria-label={`Actions for ${m.name}`}
                                      >
                                        <MoreHorizontal className="size-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                  </TooltipTrigger>
                                  <TooltipContent
                                    side="left"
                                    className="rounded-lg border border-border bg-popover text-xs font-medium text-popover-foreground shadow-soft"
                                  >
                                    View or manage this material.
                                  </TooltipContent>
                                </Tooltip>
                                <DropdownMenuContent align="end" className="w-40">
                                  <DropdownMenuItem onClick={() => setDetails(m)}>
                                    <Eye /> View
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() =>
                                      setPendingAction({ type: "status", material: m })
                                    }
                                  >
                                    {String(m.status).toUpperCase() === "ACTIVE" ? (
                                      <ToggleLeft />
                                    ) : (
                                      <ToggleRight />
                                    )}
                                    {String(m.status).toUpperCase() === "ACTIVE"
                                      ? "Deactivate"
                                      : "Activate"}
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="text-destructive focus:text-destructive"
                                    onClick={() =>
                                      setPendingAction({ type: "delete", material: m })
                                    }
                                  >
                                    <Trash2 /> Delete
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
                {!loading && !error && (
                  <div
                    className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm text-muted-foreground sm:px-5"
                    aria-live="polite"
                  >
                    <span>Showing {filtered.length ? pageStart + 1 : 0}–{Math.min(pageStart + 10, filtered.length)} of {filtered.length} materials</span>
                    <nav aria-label="Material catalog pagination" className="flex items-center gap-3">
                      <Button size="sm" variant="outline" disabled={currentPage === 1} onClick={() => setMaterialPage(currentPage - 1)}>Previous</Button>
                      <span>{currentPage} / {pageCount}</span>
                      <Button size="sm" variant="outline" disabled={currentPage === pageCount} onClick={() => setMaterialPage(currentPage + 1)}>Next</Button>
                    </nav>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent id="supplier-material-form-dialog" className="w-[calc(100%-2rem)] max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto rounded-xl p-4 shadow-lg sm:p-6">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit Material" : "Add Material"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={saveMaterial} className="space-y-4">
              <div>
                <Label htmlFor="supplier-material-name">Material name *</Label>
                <Input
                  id="supplier-material-name"
                  value={form.name}
                  onChange={(e) => {
                    setForm({
                      ...form,
                      name: e.target.value,
                      code: editing ? form.code : "",
                    });
                    if (!editing && e.target.value.trim()) generateMaterialCode(e.target.value);
                  }}
                  onBlur={() => generateMaterialCode()}
                  placeholder="Enter material name"
                  className="mt-1.5 h-10 rounded-lg text-sm"
                />
              </div>
              <div>
                <Label htmlFor="supplier-material-code">Material code *</Label>
                <Input
                  id="supplier-material-code"
                  value={form.code}
                  disabled={Boolean(editing)}
                  readOnly={!editing}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  placeholder="Generated after entering material name"
                  className={`mt-1.5 h-10 rounded-lg text-sm ${
                    !editing ? "bg-muted font-mono font-medium text-primary" : ""
                  }`}
                />
                {!editing && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Generated automatically after entering the material name.
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="supplier-material-uom">Base UOM *</Label>
                <Select
                  value={form.uom}
                  onValueChange={(value) => setForm({ ...form, uom: value })}
                >
                  <SelectTrigger id="supplier-material-uom" className="mt-1.5 h-10 rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {uoms.map((v) => (
                      <SelectItem key={v} value={v}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 rounded-lg"
                  onClick={() => setDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="h-10 rounded-lg"
                  disabled={saving || !form.code.trim() || !form.name.trim() || !form.uom}
                >
                  {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
                  {editing ? "Save Changes" : "Save Material"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
        <Dialog open={Boolean(details)} onOpenChange={(open) => !open && setDetails(null)}>
          <DialogContent className="w-[calc(100%-2rem)] max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto rounded-xl p-4 shadow-lg sm:p-6">
            <DialogHeader>
              <DialogTitle>Material Details</DialogTitle>
            </DialogHeader>
            {details && (
              <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                {[
                  ["Material Code", details.code],
                  ["Material Name", details.name],
                  ["UOM", details.uom],
                ].map(([label, value]) => (
                  <div key={String(label)}>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="font-semibold">{String(value)}</p>
                  </div>
                ))}
              </div>
            )}
          </DialogContent>
        </Dialog>
        <AlertDialog
          open={Boolean(pendingAction)}
          onOpenChange={(open) => !open && setPendingAction(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {pendingAction?.type === "delete" ? "Delete material?" : "Change material status?"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {pendingAction?.type === "delete"
                  ? `Delete ${pendingAction.material?.code} from the catalog? This cannot be undone. Existing transaction history will be preserved.`
                  : `Deactivate this material? It will no longer be available for new ASN submissions.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => void confirmPendingAction()}>
                {pendingAction?.type === "delete" ? "Delete" : "Confirm"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </AppShell>
    </TooltipProvider>
  );
}
