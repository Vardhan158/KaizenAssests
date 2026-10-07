import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, CheckCircle2, ChevronRight, ClipboardCheck, ClipboardList, Factory, Gauge, GitFork, ListChecks, Loader2, PackageCheck, Pencil, Play, RefreshCw, Search, Trash2, Users, Wrench } from "lucide-react";
import { toast } from "sonner";

import { AppShell, StatusBadge } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { GenealogyModal } from "@/components/assembly/genealogy-modal";
import { api } from "@/lib/api-client";
import { getUserInfo, requireRole } from "@/lib/auth-utils";
import { cn } from "@/lib/utils";


export const Route = createFileRoute("/assembly-orders")({
  beforeLoad: () => requireRole(["ASSEMBLY_MANAGER", "ASSEMBLY", "ASSEMBLY_OPERATOR", "ADMIN", "SUPERUSER"]),
  head: () => ({ meta: [{ title: "Assembly Orders · KaizenX" }] }),
  component: AssemblyOrders,
});

const nextStatus: Record<string, { label: string; status: string }[]> = {
  DRAFT: [{ label: "Accept issued materials", status: "READY" }],
  RELEASED: [{ label: "Start material check", status: "MATERIAL_CHECK" }],
  MATERIAL_CHECK: [{ label: "Materials ready", status: "READY" }, { label: "Report shortage", status: "MATERIAL_SHORTAGE" }],
  MATERIAL_SHORTAGE: [{ label: "Recheck materials", status: "MATERIAL_CHECK" }],
  READY: [{ label: "Start assembly", status: "IN_PROGRESS" }],
  IN_PROGRESS: [{ label: "Complete assembly", status: "COMPLETED" }, { label: "Put on hold", status: "ON_HOLD" }],
  ON_HOLD: [{ label: "Resume assembly", status: "IN_PROGRESS" }],
  COMPLETED: [{ label: "Send to quality", status: "QUALITY_CHECK" }],
  QUALITY_CHECK: [],
  CLOSED: [],
};

const statusClass: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700", RELEASED: "bg-indigo-100 text-indigo-700",
  MATERIAL_CHECK: "bg-amber-100 text-amber-700", READY: "bg-cyan-100 text-cyan-700",
  IN_PROGRESS: "bg-blue-100 text-blue-700", COMPLETED: "bg-emerald-100 text-emerald-700",
  QUALITY_CHECK: "bg-violet-100 text-violet-700", CLOSED: "bg-green-100 text-green-700",
  ON_HOLD: "bg-orange-100 text-orange-700", MATERIAL_SHORTAGE: "bg-red-100 text-red-700",
  PUTAWAY_COMPLETED: "bg-green-100 text-green-700", PUTAWAY_IN_PROGRESS: "bg-amber-100 text-amber-700",
};

function AssemblyOrders() {
  const [orders, setOrders] = useState<any[]>([]);
  const [finishedGoodsRequests, setFinishedGoodsRequests] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [loadingTeams, setLoadingTeams] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [editing, setEditing] = useState<any>();
  const [form, setForm] = useState<any>({});
  const [requirements, setRequirements] = useState<any>();
  const [materialIssue, setMaterialIssue] = useState<any>();
  const [workOrder, setWorkOrder] = useState<any>();
  const [workTeam, setWorkTeam] = useState("");
  const [progressQuantity, setProgressQuantity] = useState(0);
  const [consumption, setConsumption] = useState<any>();
  const [consumptionDrafts, setConsumptionDrafts] = useState<Record<string, any>>({});
  const [scrap, setScrap] = useState<any>();
  const [scrapForm, setScrapForm] = useState<any>({ material_code: "", quantity: "", reason: "", employee_team: "", approval_required: true, uom: "PCS" });
  const [quality, setQuality] = useState<any>();
  const [qualityForm, setQualityForm] = useState<any>({ produced_quantity: 0, passed_quantity: 0, failed_quantity: 0, rework_quantity: 0, status: "PASSED", inspected_by: "", notes: "", product_code: "", warehouse_id: "WH-01", location_code: "FG-A-03" });
  const [rework, setRework] = useState<any>();
  const [reworkForm, setReworkForm] = useState<any>({ assigned_team: "", assigned_worker: "", reason_for_failure: "", notes: "" });
  const [genealogyTarget, setGenealogyTarget] = useState<string | null>(null);
  const [loadingReqs, setLoadingReqs] = useState(false);

  const refreshTeams = useCallback(async (showError = false) => {
    setLoadingTeams(true);
    try {
      const teamRows = await api.getAssemblyTeams();
      setTeams(teamRows.filter((team: any) => team.active));
    } catch (error) {
      if (showError) {
        toast.error("Unable to load assembly teams", {
          description: error instanceof Error ? error.message : undefined,
        });
      }
    } finally {
      setLoadingTeams(false);
    }
  }, []);

  const load = useCallback(async () => {
    // The order endpoint performs an idempotent legacy-data backfill. Load it
    // first so the other reads do not contend with that write transaction.
    const ordersResult = await Promise.race([
      api.getAssemblyOrders().then((value) => ({ status: "fulfilled" as const, value }))
        .catch((reason) => ({ status: "rejected" as const, reason })),
      new Promise<{ status: "rejected"; reason: Error }>((resolve) =>
        window.setTimeout(() => resolve({ status: "rejected", reason: new Error("Assembly Orders request timed out") }), 10000)
      ),
    ]);
    const auxiliaryResults = await Promise.race([
      Promise.allSettled([api.getAssemblyTeams(), api.getFinishedGoodsRequests()]),
      new Promise<PromiseSettledResult<any>[]>((resolve) => window.setTimeout(() => resolve([
        { status: "rejected", reason: new Error("Auxiliary assembly data request timed out") },
        { status: "rejected", reason: new Error("Auxiliary assembly data request timed out") },
      ]), 5000)),
    ]);
    const [teamsResult, finishedGoodsResult] = auxiliaryResults;

    if (ordersResult.status === "fulfilled") {
      setOrders(Array.isArray(ordersResult.value) ? ordersResult.value : []);
    } else {
      toast.error("Unable to load assembly orders", {
        description: ordersResult.reason instanceof Error ? ordersResult.reason.message : undefined,
      });
    }

    if (teamsResult.status === "fulfilled") {
      setTeams(Array.isArray(teamsResult.value) ? teamsResult.value.filter((team: any) => team.active) : []);
    }
    if (finishedGoodsResult.status === "fulfilled") {
      setFinishedGoodsRequests(Array.isArray(finishedGoodsResult.value) ? finishedGoodsResult.value : []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 10000);
    return () => window.clearInterval(timer);
  }, [load]);
  useEffect(() => {
    if (!workOrder?.id || !["IN_PROGRESS", "ON_HOLD"].includes(workOrder.status)) return;
    const refresh = async () => { try { const updated = await api.getAssemblyOrder(workOrder.id); setWorkOrder(updated); setProgressQuantity(updated.completed_quantity); } catch { /* next poll retries */ } };
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [workOrder?.id, workOrder?.status]);

  const filtered = useMemo(() => orders.filter((order) => {
    if (filter !== "ALL" && order.status !== filter) return false;
    const text = `${order.order_number} ${order.product_name} ${order.assigned_team || ""} ${order.request_number}`.toLowerCase();
    return text.includes(query.toLowerCase());
  }), [orders, query, filter]);

  const incomingFinishedGoodsRequests = useMemo(() => finishedGoodsRequests.filter((request) =>
    ["SENT_TO_ASSEMBLY", "IN_PROGRESS", "PENDING", "SUBMITTED", "READY", "DRAFT"].includes(String(request.status || "").toUpperCase())
  ), [finishedGoodsRequests]);

  async function transition(order: any, status: string) {
    if (status === "IN_PROGRESS" && !order.assigned_team) {
      openWorkOrder(order);
      toast.info("Assign an assembly team before starting the work order");
      return;
    }
    setBusy(order.id);
    try {
      let updated = await api.updateAssemblyOrder(order.id, { status });
      if (status === "COMPLETED") {
        updated = await api.updateAssemblyOrder(order.id, { status: "QUALITY_CHECK" });
      }
      toast.success(
        `${order.order_number} moved to ${updated.status.replaceAll("_", " ").toLowerCase()}`,
        updated.reservation ? { description: `${updated.reservation.materials_count} component${updated.reservation.materials_count === 1 ? "" : "s"} protected from other departments.` } : undefined,
      );
      await load();
    } catch (error) { toast.error("Status update failed", { description: error instanceof Error ? error.message : undefined }); }
    finally { setBusy(undefined); }
  }

  function openEdit(order: any) {
    setEditing(order);
    setForm({ product_name: order.product_name, planned_quantity: order.planned_quantity, priority: order.priority,
      required_date: order.required_date || "", assigned_team: order.assigned_team || "", notes: order.notes || "" });
  }

  async function save() {
    setBusy(editing.id);
    try {
      await api.updateAssemblyOrderDetails(editing.id, { ...form, planned_quantity: Number(form.planned_quantity), required_date: form.required_date || null });
      toast.success("Assembly order updated"); setEditing(undefined); await load();
    } catch (error) { toast.error("Unable to update order", { description: error instanceof Error ? error.message : undefined }); }
    finally { setBusy(undefined); }
  }

  async function openRequirements(order: any) {
    setLoadingReqs(true);
    try {
      const data = await api.getOrderRequirements(order.id);
      setRequirements({ ...data, order_id: order.id });
    } catch (error) {
      toast.error("Unable to load material requirements", {
        description: error instanceof Error ? error.message : undefined
      });
    } finally {
      setLoadingReqs(false);
    }
  }

  async function requestShortages() {
    if (!requirements?.order_id) return;
    setBusy(`shortage:${requirements.order_id}`);
    try {
      await api.requestShortageMaterials(requirements.order_id);
      toast.success("Material request sent to Warehouse Manager");
      setRequirements(undefined);
      await load();
    } catch (error) {
      toast.error("Failed to send material request", {
        description: error instanceof Error ? error.message : undefined
      });
    } finally {
      setBusy(undefined);
    }
  }

  async function openMaterialIssue(order: any) {
    setLoadingReqs(true);
    try { setMaterialIssue(await api.getAssemblyMaterialIssue(order.id)); }
    catch (error) { toast.error("Unable to load material issue", { description: error instanceof Error ? error.message : undefined }); }
    finally { setLoadingReqs(false); }
  }

  async function openConsumption(order: any) {
    setLoadingReqs(true);
    try {
      const data = await api.getAssemblyConsumption(order.id);
      setConsumption({ ...data, order_id: order.id });
      setConsumptionDrafts(Object.fromEntries(data.materials.map((line: any) => [line.material_code, {
        expected_per_unit: line.expected_per_unit, assembled_quantity: line.assembled_quantity,
        actual_consumed: line.actual_consumption ?? "", uom: line.uom,
      }])));
    } catch (error) { toast.error("Unable to load material consumption", { description: error instanceof Error ? error.message : undefined }); }
    finally { setLoadingReqs(false); }
  }

  async function saveConsumption(line: any) {
    const draft = consumptionDrafts[line.material_code];
    setBusy(`consumption:${line.material_code}`);
    try {
      await api.recordAssemblyConsumption(consumption.order_id, { material_code: line.material_code, ...draft,
        expected_per_unit: Number(draft.expected_per_unit), assembled_quantity: Number(draft.assembled_quantity), actual_consumed: Number(draft.actual_consumed) });
      toast.success(`${line.material_name} consumption recorded`); await openConsumption({ id: consumption.order_id });
    } catch (error) { toast.error("Unable to record consumption", { description: error instanceof Error ? error.message : undefined }); }
    finally { setBusy(undefined); }
  }

  async function openScrap(order: any) {
    setLoadingReqs(true);
    try {
      const data = await api.getAssemblyScrap(order.id);
      setScrap({ ...data, order_id: order.id, materials: order.items || scrap?.materials || [] });
      setScrapForm((current: any) => ({ ...current, employee_team: current.employee_team || order.assigned_team || "", material_code: current.material_code || order.items?.[0]?.material_code || "", uom: current.uom || order.items?.[0]?.uom || "PCS" }));
    } catch (error) { toast.error("Unable to load scrap records", { description: error instanceof Error ? error.message : undefined }); }
    finally { setLoadingReqs(false); }
  }

  async function saveScrap() {
    setBusy("scrap:create");
    try {
      await api.createAssemblyScrap(scrap.order_id, { ...scrapForm, quantity: Number(scrapForm.quantity) });
      toast.success("Scrap record created");
      const order = orders.find((row) => row.id === scrap.order_id); setScrapForm({ material_code: order?.items?.[0]?.material_code || "", quantity: "", reason: "", employee_team: order?.assigned_team || "", approval_required: true, uom: order?.items?.[0]?.uom || "PCS" }); await openScrap(order);
    } catch (error) { toast.error("Unable to record scrap", { description: error instanceof Error ? error.message : undefined }); }
    finally { setBusy(undefined); }
  }

  async function approveScrap(record: any) {
    const user = getUserInfo();
    const approvedBy = user?.full_name || user?.username || "Assembly Manager";
    setBusy(`scrap:${record.id}`);
    try { await api.approveAssemblyScrap(scrap.order_id, record.id, approvedBy); toast.success("Scrap approved"); const order = orders.find((row) => row.id === scrap.order_id); await openScrap(order); }
    catch (error) { toast.error("Unable to approve scrap", { description: error instanceof Error ? error.message : undefined }); }
    finally { setBusy(undefined); }
  }

  async function openQuality(order: any) {
    setLoadingReqs(true);
    try {
      const data = await api.getAssemblyQualityInspection(order.id);
      const user = getUserInfo();
      const username = user?.full_name || user?.username || "Quality Inspector";
      setQuality(data);
      setQualityForm({ produced_quantity: data.produced_quantity, passed_quantity: data.status === "PENDING_INSPECTION" ? data.produced_quantity : data.passed_quantity,
        failed_quantity: data.failed_quantity, rework_quantity: data.rework_quantity, status: data.status === "PENDING_INSPECTION" ? "PASSED" : data.status,
        inspected_by: data.inspected_by || username, notes: data.notes || "", product_code: data.finished_goods?.product_code || "",
        warehouse_id: data.finished_goods?.warehouse || "WH-01", location_code: data.finished_goods?.location || "FG-A-03" });
    } catch (error) { toast.error("Unable to load quality inspection", { description: error instanceof Error ? error.message : undefined }); }
    finally { setLoadingReqs(false); }
  }

  async function saveQuality() {
    setBusy("quality:save");
    try {
      const updated = await api.recordAssemblyQualityInspection(quality.assembly_order_id, {
        ...qualityForm, produced_quantity: Number(qualityForm.produced_quantity), passed_quantity: Number(qualityForm.passed_quantity),
        failed_quantity: Number(qualityForm.failed_quantity), rework_quantity: Number(qualityForm.rework_quantity),
      });
      setQuality(updated); setQualityForm({ ...qualityForm, ...updated }); toast.success("Quality inspection recorded"); await load();
    } catch (error) { toast.error("Unable to record quality inspection", { description: error instanceof Error ? error.message : undefined }); }
    finally { setBusy(undefined); }
  }

  async function openRework(order: any) {
    setLoadingReqs(true);
    try {
      const data = await api.getAssemblyRework(order.id); setRework(data);
      setReworkForm((current: any) => ({ ...current, assigned_team: current.assigned_team || order.assigned_team || "" }));
    } catch (error) { toast.error("Unable to load rework orders", { description: error instanceof Error ? error.message : undefined }); }
    finally { setLoadingReqs(false); }
  }

  async function createRework() {
    setBusy("rework:create");
    try {
      await api.createAssemblyRework(rework.assembly_order_id, reworkForm);
      await api.updateAssemblyOrder(rework.assembly_order_id, { status: "IN_PROGRESS" });
      toast.success("Rework order created and returned to the assembly team");
      setReworkForm({ assigned_team: "", assigned_worker: "", reason_for_failure: "", notes: "" });
      const order = (await api.getAssemblyOrder(rework.assembly_order_id)); await openRework(order); await load();
    } catch (error) { toast.error("Unable to create rework order", { description: error instanceof Error ? error.message : undefined }); }
    finally { setBusy(undefined); }
  }

  async function advanceRework(record: any) {
    const status = record.status === "PENDING" ? "IN_PROGRESS" : "COMPLETED";
    setBusy(`rework:${record.id}`);
    try {
      await api.updateAssemblyRework(rework.assembly_order_id, record.id, { status });
      toast.success(status === "IN_PROGRESS" ? "Rework started" : "Rework completed; send the assembly to quality again");
      const order = await api.getAssemblyOrder(rework.assembly_order_id); await openRework(order); await load();
    } catch (error) { toast.error("Unable to update rework", { description: error instanceof Error ? error.message : undefined }); }
    finally { setBusy(undefined); }
  }

  function openWorkOrder(order: any) {
    setWorkOrder(order);
    setWorkTeam(order.assigned_team || "");
    setProgressQuantity(order.completed_quantity || 0);
    void refreshTeams(true);
  }

  async function saveWorkTeam() {
    if (!workOrder || !workTeam.trim()) return;
    setBusy(workOrder.id);
    try {
      const updated = await api.updateAssemblyOrderDetails(workOrder.id, { assigned_team: workTeam.trim() });
      setWorkOrder(updated); toast.success("Assembly team assigned"); await load();
    } catch (error) { toast.error("Unable to assign team", { description: error instanceof Error ? error.message : undefined }); }
    finally { setBusy(undefined); }
  }

  async function startWorkOrder() {
    setBusy(workOrder.id);
    try {
      const updated = await api.updateAssemblyOrder(workOrder.id, { status: "IN_PROGRESS" });
      setWorkOrder(updated); toast.success("Assembly work started"); await load();
    } catch (error) { toast.error("Unable to start assembly", { description: error instanceof Error ? error.message : undefined }); }
    finally { setBusy(undefined); }
  }

  async function updateStep(step: any) {
    const status = step.status === "NOT_STARTED" ? "IN_PROGRESS" : "COMPLETED";
    setBusy(`${workOrder.id}:${step.id}`);
    try {
      const updated = await api.updateAssemblyStep(workOrder.id, step.id, status);
      setWorkOrder(updated); toast.success(`${step.name} ${status === "COMPLETED" ? "completed" : "started"}`); await load();
    } catch (error) { toast.error("Unable to update assembly step", { description: error instanceof Error ? error.message : undefined }); }
    finally { setBusy(undefined); }
  }

  async function updateProgress() {
    setBusy(`${workOrder.id}:progress`);
    try {
      const updated = await api.updateAssemblyProgress(workOrder.id, Number(progressQuantity));
      setWorkOrder(updated); setProgressQuantity(updated.completed_quantity); toast.success("Assembly progress updated"); await load();
    } catch (error) { toast.error("Unable to update progress", { description: error instanceof Error ? error.message : undefined }); }
    finally { setBusy(undefined); }
  }

  async function updateWorkStatus(status: "ON_HOLD" | "IN_PROGRESS") {
    setBusy(workOrder.id);
    try { const updated = await api.updateAssemblyOrder(workOrder.id, { status }); setWorkOrder(updated); toast.success(status === "ON_HOLD" ? "Assembly paused" : "Assembly resumed"); await load(); }
    catch (error) { toast.error("Unable to update work order", { description: error instanceof Error ? error.message : undefined }); }
    finally { setBusy(undefined); }
  }

  return <AppShell
 title="Assembly Orders" subtitle="Plan, assign and control assembly work from material readiness through final closure"
    actions={<Button variant="outline" className="rounded-xl" onClick={() => void load()}><RefreshCw className="size-4" /> Refresh</Button>}>
    <Card className="mb-4 gap-3 rounded-2xl p-4 shadow-soft">
      <div className="flex flex-col gap-3 md:flex-row">
        <div className="relative flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Search order, product, request or team..." value={query} onChange={(e) => setQuery(e.target.value)} /></div>
        <select className="h-10 rounded-md border bg-background px-3 text-sm" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="ALL">All statuses</option>{Object.keys(nextStatus).map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}
        </select>
      </div>
    </Card>

    {!loading && incomingFinishedGoodsRequests.length > 0 && <Card className="mb-5 border-blue-200 bg-blue-50/50 shadow-soft dark:border-blue-900/60 dark:bg-blue-950/20">
      <div className="flex items-center justify-between border-b border-blue-200/70 px-5 py-4 dark:border-blue-900/60">
        <div><h2 className="flex items-center gap-2 text-sm font-bold text-blue-900 dark:text-blue-100"><ClipboardList className="size-4" /> Finished Goods Requests from Procurement</h2><p className="mt-1 text-xs text-blue-700/80 dark:text-blue-300/80">Incoming production demand shown alongside Assembly Orders.</p></div>
        <Badge className="bg-blue-600 text-white">{incomingFinishedGoodsRequests.length} open</Badge>
      </div>
      <div className="grid gap-3 p-4 md:grid-cols-2">{incomingFinishedGoodsRequests.map((request: any) => {
        const requested = Number(request.quantity || request.requested_quantity || 0);
        const available = Number(request.fg_store_available ?? request.available_quantity ?? 0);
        const shortage = Math.max(0, requested - available);
        return <div key={request.id || request.request_number} className="rounded-xl border border-blue-200 bg-white p-4 dark:border-blue-900/60 dark:bg-slate-950/40">
          <div className="flex items-start justify-between gap-3"><div><p className="font-mono text-xs font-bold text-blue-700 dark:text-blue-300">{request.request_number}</p><p className="mt-1 font-semibold">{request.product_name || request.finished_goods_name || request.product_code}</p></div><StatusBadge status={request.status} /></div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs"><div><p className="text-muted-foreground">Requested</p><p className="mt-1 font-bold">{requested} {request.uom || "PCS"}</p></div><div><p className="text-muted-foreground">FG available</p><p className="mt-1 font-bold">{available} {request.uom || "PCS"}</p></div><div><p className="text-muted-foreground">Shortage</p><p className={cn("mt-1 font-bold", shortage > 0 ? "text-red-600" : "text-emerald-600")}>{shortage} {request.uom || "PCS"}</p></div></div>
        </div>;
      })}</div>
    </Card>}

    {loading ? <div className="grid h-64 place-items-center"><Loader2 className="size-8 animate-spin text-primary" /></div>
      : filtered.length === 0 ? <Card className="grid h-64 place-items-center text-center text-muted-foreground"><div><Factory className="mx-auto mb-2 size-9 opacity-40" /><p>No assembly orders found.</p></div></Card>
      : <div className="grid gap-4 xl:grid-cols-2">{filtered.map((order) => <Card key={order.id} className="gap-4 rounded-2xl p-5 shadow-soft">
        <div className="flex items-start justify-between gap-4"><div><p className="font-mono text-sm font-bold text-primary">{order.order_number}</p><h2 className="mt-1 text-xl font-bold">{order.product_name}</h2><p className="text-xs text-muted-foreground">From {order.request_number}</p></div><div className="flex flex-wrap justify-end gap-2"><Badge className={statusClass[order.status] || "bg-slate-100 text-slate-700"}>{String(order.status || "UNKNOWN").replaceAll("_", " ")}</Badge>{order.putaway_status && order.putaway_status !== "PUTAWAY_PENDING" && <Badge className={statusClass[order.putaway_status] || "bg-slate-100 text-slate-700"}>FG {String(order.putaway_status).replace("PUTAWAY_", "").replaceAll("_", " ")}</Badge>}</div></div>
        <div className="grid grid-cols-2 gap-3 rounded-xl border bg-muted/30 p-4 sm:grid-cols-3">
          <Field label="Quantity" value={String(order.planned_quantity)} />
          <Field label="Priority" value={order.priority} highlight={order.priority === "HIGH" || order.priority === "URGENT"} />
          <Field label="Required date" value={order.required_date ? new Date(`${order.required_date}T00:00:00`).toLocaleDateString() : "Not set"} />
          <Field label="Assigned team" value={order.assigned_team || "Not assigned"} />
          <Field label="Materials" value={`${order.materials_count} components`} />
          <Field label="Department" value={order.department} />
        </div>
        <div className="flex flex-wrap gap-2">{(order.items || []).map((item: any) => <span key={item.material_code} className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground">{item.material_name || item.material_code} · {item.quantity} {item.uom}</span>)}</div>
        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          <Button size="sm" variant="outline" onClick={() => openRequirements(order)} disabled={loadingReqs}><ClipboardList className="size-3.5" /> Requirements</Button>
          <Button size="sm" variant="outline" onClick={() => openMaterialIssue(order)} disabled={loadingReqs}><PackageCheck className="size-3.5" /> Material issue</Button>
          <Button size="sm" variant="outline" onClick={() => openConsumption(order)} disabled={loadingReqs}><Gauge className="size-3.5" /> Consumption</Button>
          <Button size="sm" variant="outline" onClick={() => openScrap(order)} disabled={loadingReqs}><Trash2 className="size-3.5" /> Scrap</Button>
          {['COMPLETED', 'QUALITY_CHECK', 'CLOSED'].includes(order.status) && <Button size="sm" variant="outline" onClick={() => openQuality(order)} disabled={loadingReqs}><ClipboardCheck className="size-3.5" /> Quality</Button>}
          {['COMPLETED', 'QUALITY_CHECK', 'IN_PROGRESS', 'CLOSED'].includes(order.status) && <Button size="sm" variant="outline" onClick={() => openRework(order)} disabled={loadingReqs}><Wrench className="size-3.5" /> Rework</Button>}
          <Button size="sm" variant="outline" onClick={() => setGenealogyTarget(order.order_number)}><GitFork className="size-3.5" /> Genealogy</Button>
          <Button size="sm" variant="outline" onClick={() => openWorkOrder(order)}><ListChecks className="size-3.5" /> Work order</Button>
          {!["IN_PROGRESS", "COMPLETED", "QUALITY_CHECK", "CLOSED", "ON_HOLD"].includes(order.status) && <Button size="sm" variant="outline" onClick={() => openEdit(order)}><Pencil className="size-3.5" /> Edit details</Button>}
          {order.status === "QUALITY_CHECK" && order.quality_status === "PENDING_INSPECTION" && (
            <Button size="sm" className="ml-auto" onClick={() => void openQuality(order)}>
              <ClipboardCheck className="size-3.5" /> Record quality result
            </Button>
          )}
          {order.status === "QUALITY_CHECK" && order.quality_status === "PASSED" && (
            <Button size="sm" className="ml-auto" disabled={busy === order.id} onClick={() => void transition(order, "CLOSED")}>
              <ChevronRight className="size-3.5" /> Close order
            </Button>
          )}
          {order.status === "QUALITY_CHECK" && ["FAILED", "REWORK_REQUIRED"].includes(order.quality_status) && (
            <Button size="sm" className="ml-auto" onClick={() => void openRework(order)}>
              <Wrench className="size-3.5" /> Create rework order
            </Button>
          )}
          <div className="ml-auto flex flex-wrap gap-2">
            {(nextStatus[order.status] || []).map((action, index) => {
              const needsTeam = action.status === "IN_PROGRESS" && !order.assigned_team;
              return (
                <Button
                  key={action.status}
                  size="sm"
                  variant={index === 0 ? "default" : "outline"}
                  disabled={busy === order.id}
                  onClick={() => void transition(order, action.status)}
                >
                  {busy === order.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : needsTeam ? (
                    <Users className="size-3.5" />
                  ) : (
                    <ChevronRight className="size-3.5" />
                  )}
                  {needsTeam ? "Assign team to start" : action.label}
                </Button>
              );
            })}
          </div>
        </div>
      </Card>)}</div>}

    <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(undefined)}><DialogContent className="max-w-xl">
      <DialogHeader><DialogTitle>Edit assembly order</DialogTitle><DialogDescription>Set the production target, priority, due date, and responsible team before assembly begins.</DialogDescription></DialogHeader>
      <div className="grid gap-4 py-2 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2"><Label>Product</Label><Input value={form.product_name || ""} onChange={(e) => setForm({ ...form, product_name: e.target.value })} /></div>
        <div className="space-y-2"><Label>Quantity</Label><Input type="number" min="1" value={form.planned_quantity || ""} onChange={(e) => setForm({ ...form, planned_quantity: e.target.value })} /></div>
        <div className="space-y-2"><Label>Priority</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.priority || "MEDIUM"} onChange={(e) => setForm({ ...form, priority: e.target.value })}>{["LOW", "MEDIUM", "HIGH", "URGENT"].map((p) => <option key={p}>{p}</option>)}</select></div>
        <div className="space-y-2"><Label><CalendarDays className="mr-1 inline size-3.5" />Required date</Label><Input type="date" value={form.required_date || ""} onChange={(e) => setForm({ ...form, required_date: e.target.value })} /></div>
        <div className="space-y-2"><Label><Users className="mr-1 inline size-3.5" />Assigned team</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.assigned_team || ""} onChange={(e) => setForm({ ...form, assigned_team: e.target.value })}><option value="">Not assigned</option>{teams.map((team) => <option key={team.id} value={team.name}>{team.name} · {team.shift} · {team.workstation}</option>)}</select></div>
        <div className="space-y-2 sm:col-span-2"><Label>Notes</Label><Input value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
      </div>
      <Button onClick={() => void save()} disabled={!form.product_name?.trim() || Number(form.planned_quantity) <= 0 || busy === editing?.id}>{busy === editing?.id && <Loader2 className="size-4 animate-spin" />} Save order</Button>
    </DialogContent></Dialog>

    <Dialog open={Boolean(requirements)} onOpenChange={(open) => !open && setRequirements(undefined)}><DialogContent className="max-w-2xl rounded-2xl">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <ClipboardList className="size-5 text-primary" />
          Material Requirements: {requirements?.order_number}
        </DialogTitle>
        <DialogDescription>Required components checked automatically against current warehouse stock.</DialogDescription>
      </DialogHeader>

      <div className="grid grid-cols-3 gap-3 text-center text-sm">
        <div className="rounded-xl border bg-emerald-50 p-3 text-emerald-700"><b className="text-xl">{requirements?.summary?.available || 0}</b><div>Available</div></div>
        <div className="rounded-xl border bg-blue-50 p-3 text-blue-700"><b className="text-xl">{requirements?.summary?.reserved || 0}</b><div>Reserved</div></div>
        <div className="rounded-xl border bg-red-50 p-3 text-red-700"><b className="text-xl">{requirements?.summary?.shortage || 0}</b><div>Shortage</div></div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border/60 shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/50 text-[10px] uppercase font-black tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Component</th>
              <th className="px-4 py-3 text-right">Required</th>
              <th className="px-4 py-3 text-right">Available</th>
              <th className="px-4 py-3 text-right">Reserved</th>
              <th className="px-4 py-3 text-right">Free stock</th>
              <th className="px-4 py-3 text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {requirements?.requirements.map((req: any, idx: number) => (
              <tr key={idx} className="hover:bg-muted/20 transition-colors">
                <td className="px-4 py-3">
                  <div className="font-bold text-foreground">{req.component}</div>
                  <div className="font-mono text-[10px] text-muted-foreground uppercase">{req.material_code}</div>
                </td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums">{req.required} <span className="text-[10px] text-muted-foreground uppercase">{req.uom}</span></td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums">{req.available} <span className="text-[10px] text-muted-foreground uppercase">{req.uom}</span></td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums text-amber-700">{req.reserved} <span className="text-[10px] text-muted-foreground uppercase">{req.uom}</span></td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums">{req.free_stock} <span className="text-[10px] text-muted-foreground uppercase">{req.uom}</span></td>
                <td className="px-4 py-3 text-center">
                  <span className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold",
                    req.status === "SHORTAGE" ? "bg-red-50 text-red-600 border border-red-100" : req.status === "RESERVED" ? "bg-blue-50 text-blue-700 border border-blue-100" : "bg-emerald-50 text-emerald-600 border border-emerald-100"
                  )}>
                    {req.status_label}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-between items-center pt-2">
        {requirements?.summary?.shortage > 0 && (
          <Button
            variant="default"
            className="rounded-xl bg-red-600 hover:bg-red-700 text-white"
            onClick={() => void requestShortages()}
            disabled={busy === `shortage:${requirements.order_id}`}
          >
            {busy === `shortage:${requirements.order_id}` ? <Loader2 className="size-4 animate-spin mr-2" /> : <RefreshCw className="size-4 mr-2" />}
            Request Missing Materials from Warehouse
          </Button>
        )}
        <div className="flex-1"></div>
        <Button variant="outline" className="rounded-xl px-8" onClick={() => setRequirements(undefined)}>Dismiss</Button>
      </div>
    </DialogContent></Dialog>

    <Dialog open={Boolean(materialIssue)} onOpenChange={(open) => !open && setMaterialIssue(undefined)}><DialogContent className="max-w-5xl rounded-2xl">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><PackageCheck className="size-5 text-primary" />Material Issue: {materialIssue?.issue_number}</DialogTitle>
        <DialogDescription>
          {materialIssue?.warehouse} → {materialIssue?.destination} · Issued {materialIssue?.issue_date ? new Date(materialIssue.issue_date).toLocaleString() : "—"}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-3 rounded-xl border bg-muted/20 p-4 text-sm sm:grid-cols-4">
        <Field label="Request" value={materialIssue?.request_number || "—"} />
        <Field label="Warehouse" value={materialIssue?.warehouse || "—"} />
        <Field label="Issued by" value={materialIssue?.issued_by || "—"} />
        <Field label="Received by" value={materialIssue?.received_by || "—"} />
      </div>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-muted/50 text-[10px] font-black uppercase tracking-wider text-muted-foreground"><tr>
            <th className="px-3 py-3">Material</th><th className="px-3 py-3 text-right">Requested</th>
            <th className="px-3 py-3 text-right">Issued</th><th className="px-3 py-3 text-right">Pending</th>
            <th className="px-3 py-3">Batch / lot</th><th className="px-3 py-3">Storage location</th><th className="px-3 py-3">Status</th>
          </tr></thead>
          <tbody className="divide-y">{materialIssue?.materials.map((line: any) => <tr key={line.material_code}>
            <td className="px-3 py-3"><b>{line.material_name}</b><div className="font-mono text-xs text-muted-foreground">{line.material_code}</div></td>
            <td className="px-3 py-3 text-right tabular-nums">{line.requested_quantity} {line.uom}</td>
            <td className="px-3 py-3 text-right font-bold tabular-nums text-emerald-700">{line.issued_quantity} {line.uom}</td>
            <td className="px-3 py-3 text-right font-bold tabular-nums text-amber-700">{line.pending_quantity} {line.uom}</td>
            <td className="px-3 py-3">{line.batch_lot.length ? line.batch_lot.join(", ") : "Not recorded"}</td>
            <td className="px-3 py-3 font-mono text-xs">{line.storage_locations.length ? line.storage_locations.join(", ") : "—"}</td>
            <td className="px-3 py-3"><Badge className={line.status === "ISSUED" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}>{line.status.replaceAll("_", " ")}</Badge></td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="flex justify-end"><Button variant="outline" onClick={() => setMaterialIssue(undefined)}>Dismiss</Button></div>
    </DialogContent></Dialog>
    <Dialog open={Boolean(workOrder)} onOpenChange={(open) => !open && setWorkOrder(undefined)}><DialogContent className="max-w-3xl rounded-2xl">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><ListChecks className="size-5 text-primary" />Assembly Work Order {workOrder?.order_number}</DialogTitle>
        <DialogDescription>{workOrder?.product_name} · {workOrder?.planned_quantity} units · {workOrder?.status?.replaceAll("_", " ")}</DialogDescription>
      </DialogHeader>
      <div className="rounded-xl border bg-muted/20 p-4">
        <div className="mb-3 flex items-center justify-between"><div><p className="text-xs font-bold uppercase text-muted-foreground">Live assembly progress</p><p className="text-xl font-black">{workOrder?.completed || 0} / {workOrder?.target || workOrder?.planned_quantity || 0} Units Completed</p></div><Badge className={workOrder?.progress_status === "COMPLETED" ? "bg-emerald-100 text-emerald-700" : workOrder?.progress_status === "PAUSED" ? "bg-amber-100 text-amber-700" : workOrder?.progress_status === "IN_PROGRESS" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-700"}>{workOrder?.progress_status?.replaceAll("_", " ") || "NOT STARTED"}</Badge></div>
        <Progress value={workOrder?.progress_percent || 0} className="h-3" />
        <div className="mt-2 flex justify-between text-sm"><span>Remaining: <b>{workOrder?.remaining ?? workOrder?.planned_quantity} units</b></span><span><b>{workOrder?.progress_percent || 0}%</b></span></div>
        {["IN_PROGRESS", "ON_HOLD"].includes(workOrder?.status) && <div className="mt-4 flex flex-wrap gap-2">
          <Input className="max-w-48" type="number" min={workOrder?.completed_quantity || 0} max={workOrder?.planned_quantity || 0} value={progressQuantity} onChange={(event) => setProgressQuantity(Number(event.target.value))} />
          <Button variant="outline" disabled={busy === `${workOrder.id}:progress` || progressQuantity < workOrder.completed_quantity || progressQuantity > workOrder.planned_quantity} onClick={() => void updateProgress()}>Update completed units</Button>
          {workOrder.status === "IN_PROGRESS" ? <Button className="ml-auto" variant="outline" onClick={() => void updateWorkStatus("ON_HOLD")}>Pause</Button> : <Button className="ml-auto" onClick={() => void updateWorkStatus("IN_PROGRESS")}><Play className="size-4" /> Resume</Button>}
        </div>}
      </div>
      <div className="grid gap-3 rounded-xl border bg-muted/20 p-4 sm:grid-cols-[1fr_auto]">
        <div className="space-y-2"><Label>Assembly team</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={workTeam} disabled={loadingTeams || ["IN_PROGRESS", "COMPLETED", "QUALITY_CHECK", "CLOSED"].includes(workOrder?.status)} onChange={(event) => setWorkTeam(event.target.value)}><option value="">{loadingTeams ? "Loading teams..." : teams.length ? "Select team" : "No active teams found"}</option>{teams.map((team) => <option key={team.id} value={team.name}>{team.name} · {team.workers_count} workers · {team.workstation}</option>)}</select></div>
        <Button className="self-end" variant="outline" disabled={loadingTeams || !workTeam.trim() || busy === workOrder?.id || ["IN_PROGRESS", "COMPLETED", "QUALITY_CHECK", "CLOSED"].includes(workOrder?.status)} onClick={() => void saveWorkTeam()}><Users className="size-4" /> Assign team</Button>
      </div>
      {workOrder?.status === "READY" && <Button disabled={!workOrder.assigned_team || busy === workOrder.id} onClick={() => void startWorkOrder()}><Play className="size-4" /> Start assembly</Button>}
      {workOrder?.status !== "READY" && workOrder?.status !== "IN_PROGRESS" && <p className="rounded-xl border bg-muted/30 p-3 text-sm text-muted-foreground">Assembly can start after materials are checked and the order reaches READY status.</p>}
    </DialogContent></Dialog>

    <Dialog open={Boolean(consumption)} onOpenChange={(open) => !open && setConsumption(undefined)}><DialogContent className="max-w-6xl rounded-2xl">
      <DialogHeader><DialogTitle className="flex items-center gap-2"><Gauge className="size-5 text-primary" />Material Consumption · {consumption?.order_number}</DialogTitle><DialogDescription>Compare expected usage with actual material consumed to identify wastage and variance.</DialogDescription></DialogHeader>
      <div className="grid grid-cols-3 gap-3 text-center text-sm">
        <div className="rounded-xl border bg-muted/20 p-3"><b className="text-xl">{consumption?.summary?.materials || 0}</b><div>Materials</div></div>
        <div className="rounded-xl border bg-blue-50 p-3 text-blue-700"><b className="text-xl">{consumption?.summary?.recorded || 0}</b><div>Recorded</div></div>
        <div className="rounded-xl border bg-red-50 p-3 text-red-700"><b className="text-xl">{consumption?.summary?.over_consumed_materials || 0}</b><div>Over consumed</div></div>
      </div>
      <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[1050px] text-left text-sm">
        <thead className="bg-muted/50 text-[10px] font-black uppercase tracking-wider text-muted-foreground"><tr><th className="px-3 py-3">Material</th><th className="px-3 py-3">Per unit</th><th className="px-3 py-3">Assembled</th><th className="px-3 py-3 text-right">Expected</th><th className="px-3 py-3">Actual</th><th className="px-3 py-3 text-right">Variance</th><th className="px-3 py-3">Status</th><th className="px-3 py-3"></th></tr></thead>
        <tbody className="divide-y">{consumption?.materials.map((line: any) => { const draft = consumptionDrafts[line.material_code] || {}; const expected = Number(draft.expected_per_unit || 0) * Number(draft.assembled_quantity || 0); return <tr key={line.material_code}>
          <td className="px-3 py-3"><b>{line.material_name}</b><div className="font-mono text-xs text-muted-foreground">{line.material_code}</div></td>
          <td className="px-3 py-3"><Input className="w-24" type="number" min="0.0001" step="0.0001" value={draft.expected_per_unit} onChange={(e) => setConsumptionDrafts({ ...consumptionDrafts, [line.material_code]: { ...draft, expected_per_unit: e.target.value } })} /></td>
          <td className="px-3 py-3"><Input className="w-24" type="number" min="0" max={consumption.target_quantity} value={draft.assembled_quantity} onChange={(e) => setConsumptionDrafts({ ...consumptionDrafts, [line.material_code]: { ...draft, assembled_quantity: e.target.value } })} /></td>
          <td className="px-3 py-3 text-right font-bold tabular-nums">{expected.toLocaleString()} {line.uom}</td>
          <td className="px-3 py-3"><Input className="w-28" type="number" min="0" step="0.0001" value={draft.actual_consumed} onChange={(e) => setConsumptionDrafts({ ...consumptionDrafts, [line.material_code]: { ...draft, actual_consumed: e.target.value } })} /></td>
          <td className={cn("px-3 py-3 text-right font-bold tabular-nums", line.variance_quantity > 0 ? "text-red-600" : line.variance_quantity < 0 ? "text-emerald-700" : "")}>{line.variance_quantity == null ? "—" : `${line.variance_quantity > 0 ? "+" : ""}${line.variance_quantity} (${line.variance_percent}%)`}</td>
          <td className="px-3 py-3"><Badge className={line.status === "OVER_CONSUMPTION" ? "bg-red-100 text-red-700" : line.status === "UNDER_CONSUMPTION" ? "bg-emerald-100 text-emerald-700" : line.status === "ON_TARGET" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"}>{line.status.replaceAll("_", " ")}</Badge></td>
          <td className="px-3 py-3"><Button size="sm" disabled={!['IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'QUALITY_CHECK'].includes(consumption.order_status) || draft.actual_consumed === "" || Number(draft.expected_per_unit) <= 0 || busy === `consumption:${line.material_code}`} onClick={() => void saveConsumption(line)}>{busy === `consumption:${line.material_code}` && <Loader2 className="size-3.5 animate-spin" />} Save</Button></td>
        </tr>; })}</tbody>
      </table></div>
    </DialogContent></Dialog>

    <Dialog open={Boolean(scrap)} onOpenChange={(open) => !open && setScrap(undefined)}><DialogContent className="max-w-5xl rounded-2xl">
      <DialogHeader><DialogTitle className="flex items-center gap-2"><Trash2 className="size-5 text-destructive" />Scrap / Wastage · {scrap?.order_number}</DialogTitle><DialogDescription>Record damaged components and route significant losses for approval.</DialogDescription></DialogHeader>
      <div className="grid gap-3 rounded-xl border bg-muted/20 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-2"><Label>Material</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={scrapForm.material_code} onChange={(e) => { const item = scrap.materials.find((row: any) => row.material_code === e.target.value); setScrapForm({ ...scrapForm, material_code: e.target.value, uom: item?.uom || "PCS" }); }}><option value="">Select material</option>{scrap?.materials.map((item: any) => <option key={item.material_code} value={item.material_code}>{item.material_name || item.material_code}</option>)}</select></div>
        <div className="space-y-2"><Label>Damaged quantity</Label><Input type="number" min="0.0001" step="0.0001" value={scrapForm.quantity} onChange={(e) => setScrapForm({ ...scrapForm, quantity: e.target.value })} /></div>
        <div className="space-y-2"><Label>Employee / team</Label><Input value={scrapForm.employee_team} onChange={(e) => setScrapForm({ ...scrapForm, employee_team: e.target.value })} /></div>
        <label className="flex items-end gap-2 pb-3 text-sm"><input type="checkbox" checked={scrapForm.approval_required} onChange={(e) => setScrapForm({ ...scrapForm, approval_required: e.target.checked })} /> Approval required</label>
        <div className="space-y-2 sm:col-span-2 lg:col-span-3"><Label>Reason</Label><Textarea value={scrapForm.reason} onChange={(e) => setScrapForm({ ...scrapForm, reason: e.target.value })} placeholder="Damaged during cable termination" /></div>
        <Button className="self-end" disabled={!['IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'QUALITY_CHECK'].includes(scrap?.order_status) || !scrapForm.material_code || Number(scrapForm.quantity) <= 0 || !scrapForm.reason.trim() || !scrapForm.employee_team.trim() || busy === "scrap:create"} onClick={() => void saveScrap()}>{busy === "scrap:create" && <Loader2 className="size-4 animate-spin" />} Record scrap</Button>
      </div>
      <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[900px] text-left text-sm">
        <thead className="bg-muted/50 text-[10px] font-black uppercase tracking-wider text-muted-foreground"><tr><th className="px-3 py-3">Material</th><th className="px-3 py-3 text-right">Planned</th><th className="px-3 py-3 text-right">Used</th><th className="px-3 py-3 text-right">Damaged</th><th className="px-3 py-3">Reason</th><th className="px-3 py-3">Employee / team</th><th className="px-3 py-3">Date</th><th className="px-3 py-3">Approval</th></tr></thead>
        <tbody className="divide-y">{scrap?.records.length ? scrap.records.map((record: any) => <tr key={record.id}>
          <td className="px-3 py-3"><b>{record.material_name}</b><div className="font-mono text-xs text-muted-foreground">{record.material_code}</div></td>
          <td className="px-3 py-3 text-right">{record.planned_quantity} {record.uom}</td><td className="px-3 py-3 text-right">{record.used_quantity} {record.uom}</td><td className="px-3 py-3 text-right font-bold text-red-600">{record.damaged_quantity} {record.uom}</td>
          <td className="max-w-56 px-3 py-3">{record.reason}</td><td className="px-3 py-3">{record.employee_team}</td><td className="px-3 py-3">{new Date(record.date).toLocaleString()}</td>
          <td className="px-3 py-3">{record.status === "PENDING_APPROVAL" ? <Button size="sm" variant="outline" disabled={busy === `scrap:${record.id}`} onClick={() => void approveScrap(record)}>Approve</Button> : <div><Badge className={record.status === "APPROVED" ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"}>{record.status}</Badge>{record.approved_by && <p className="mt-1 text-xs text-muted-foreground">by {record.approved_by}</p>}</div>}</td>
        </tr>) : <tr><td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">No scrap recorded for this work order.</td></tr>}</tbody>
      </table></div>
    </DialogContent></Dialog>

    <Dialog open={Boolean(quality)} onOpenChange={(open) => !open && setQuality(undefined)}><DialogContent className="max-w-3xl rounded-2xl">
      <DialogHeader><DialogTitle className="flex items-center gap-2"><ClipboardCheck className="size-5 text-violet-600" />Quality Inspection · {quality?.order_number}</DialogTitle><DialogDescription>{quality?.product_name} · Reconcile every produced unit as passed, failed, or requiring rework.</DialogDescription></DialogHeader>
      <div className="grid grid-cols-2 gap-3 text-center text-sm sm:grid-cols-4">
        {[['Produced', qualityForm.produced_quantity, 'bg-slate-50 text-slate-700'], ['Passed', qualityForm.passed_quantity, 'bg-emerald-50 text-emerald-700'], ['Failed', qualityForm.failed_quantity, 'bg-red-50 text-red-700'], ['Rework', qualityForm.rework_quantity, 'bg-amber-50 text-amber-700']].map(([label, value, color]) => <div key={String(label)} className={cn('rounded-xl border p-3', color)}><b className="text-2xl">{String(value)}</b><div>{label}</div></div>)}
      </div>
      <div className="grid gap-4 rounded-xl border bg-muted/20 p-4 sm:grid-cols-2">
        <div className="space-y-2"><Label>Passed quantity</Label><Input type="number" min="0" max={qualityForm.produced_quantity} value={qualityForm.passed_quantity} onChange={(e) => setQualityForm({ ...qualityForm, passed_quantity: e.target.value })} /></div>
        <div className="space-y-2"><Label>Failed quantity</Label><Input type="number" min="0" max={qualityForm.produced_quantity} value={qualityForm.failed_quantity} onChange={(e) => setQualityForm({ ...qualityForm, failed_quantity: e.target.value })} /></div>
        <div className="space-y-2"><Label>Rework quantity</Label><Input type="number" min="0" max={qualityForm.produced_quantity} value={qualityForm.rework_quantity} onChange={(e) => setQualityForm({ ...qualityForm, rework_quantity: e.target.value })} /></div>
        <div className="space-y-2"><Label>Inspection result</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={qualityForm.status} onChange={(e) => setQualityForm({ ...qualityForm, status: e.target.value })}><option value="PASSED">Passed</option><option value="FAILED">Failed</option><option value="REWORK_REQUIRED">Rework Required</option></select></div>
        <div className="space-y-2 sm:col-span-2"><Label>Inspected by</Label><Input value={qualityForm.inspected_by} onChange={(e) => setQualityForm({ ...qualityForm, inspected_by: e.target.value })} /></div>
        <div className="space-y-2 sm:col-span-2"><Label>Inspection notes</Label><Textarea value={qualityForm.notes} onChange={(e) => setQualityForm({ ...qualityForm, notes: e.target.value })} placeholder="Inspection observations, defects, and rework instructions" /></div>
        <div className="space-y-2"><Label>Finished product code</Label><Input value={qualityForm.product_code} onChange={(e) => setQualityForm({ ...qualityForm, product_code: e.target.value })} placeholder="Generated automatically if blank" disabled={Boolean(quality?.finished_goods)} /></div>
        <div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label>Warehouse</Label><Input value={qualityForm.warehouse_id} onChange={(e) => setQualityForm({ ...qualityForm, warehouse_id: e.target.value })} disabled={Boolean(quality?.finished_goods)} /></div><div className="space-y-2"><Label>FG location</Label><Input value={qualityForm.location_code} onChange={(e) => setQualityForm({ ...qualityForm, location_code: e.target.value })} disabled={Boolean(quality?.finished_goods)} /></div></div>
      </div>
      {quality?.finished_goods && <div className="grid gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 sm:grid-cols-5"><div className="sm:col-span-2"><p className="text-xs font-bold uppercase text-emerald-700">Finished product</p><p className="font-bold">{quality.finished_goods.product_name}</p><p className="font-mono text-xs">{quality.finished_goods.product_code}</p></div><Field label="Available quantity" value={`${quality.finished_goods.quantity} ${quality.finished_goods.uom}`} /><Field label="Warehouse" value={quality.finished_goods.warehouse} /><Field label="Location" value={quality.finished_goods.location} /></div>}
      {Number(qualityForm.passed_quantity) + Number(qualityForm.failed_quantity) + Number(qualityForm.rework_quantity) !== Number(qualityForm.produced_quantity) && <p className="rounded-lg bg-amber-50 p-3 text-sm font-medium text-amber-800">Passed + failed + rework must equal {qualityForm.produced_quantity} produced units.</p>}
      <div className="flex items-center justify-between"><Badge className={quality?.status === 'PASSED' ? 'bg-emerald-100 text-emerald-700' : quality?.status === 'FAILED' ? 'bg-red-100 text-red-700' : quality?.status === 'REWORK_REQUIRED' ? 'bg-amber-100 text-amber-700' : 'bg-violet-100 text-violet-700'}>{quality?.status?.replaceAll('_', ' ')}</Badge><Button disabled={quality?.order_status !== 'QUALITY_CHECK' || !qualityForm.inspected_by.trim() || Number(qualityForm.passed_quantity) + Number(qualityForm.failed_quantity) + Number(qualityForm.rework_quantity) !== Number(qualityForm.produced_quantity) || busy === 'quality:save'} onClick={() => void saveQuality()}>{busy === 'quality:save' && <Loader2 className="size-4 animate-spin" />}Save inspection</Button></div>
    </DialogContent></Dialog>

    <Dialog open={Boolean(rework)} onOpenChange={(open) => !open && setRework(undefined)}><DialogContent className="max-w-5xl rounded-2xl">
      <DialogHeader><DialogTitle className="flex items-center gap-2"><Wrench className="size-5 text-amber-600" />Rework Orders · {rework?.order_number}</DialogTitle><DialogDescription>Assign failed assemblies for correction, track rework execution, and review the final quality result.</DialogDescription></DialogHeader>
      {rework?.order_status === 'QUALITY_CHECK' && ['FAILED', 'REWORK_REQUIRED'].includes(rework?.quality_status) && !rework?.records?.some((row: any) => ['PENDING', 'IN_PROGRESS'].includes(row.status)) && <div className="grid gap-3 rounded-xl border bg-amber-50/40 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-2"><Label>Assigned team</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={reworkForm.assigned_team} onChange={(e) => setReworkForm({ ...reworkForm, assigned_team: e.target.value })}><option value="">Select team</option>{teams.map((team) => <option key={team.id} value={team.name}>{team.name} · {team.workstation}</option>)}</select></div>
        <div className="space-y-2"><Label>Assigned worker</Label><Input value={reworkForm.assigned_worker} onChange={(e) => setReworkForm({ ...reworkForm, assigned_worker: e.target.value })} placeholder="Worker name (optional)" /></div>
        <div className="space-y-2 sm:col-span-2"><Label>Reason for failure</Label><Input value={reworkForm.reason_for_failure} onChange={(e) => setReworkForm({ ...reworkForm, reason_for_failure: e.target.value })} placeholder="Defaults to quality inspection notes" /></div>
        <div className="space-y-2 sm:col-span-2 lg:col-span-3"><Label>Rework instructions</Label><Textarea value={reworkForm.notes} onChange={(e) => setReworkForm({ ...reworkForm, notes: e.target.value })} /></div>
        <Button className="self-end" disabled={!reworkForm.assigned_team || busy === 'rework:create'} onClick={() => void createRework()}>{busy === 'rework:create' && <Loader2 className="size-4 animate-spin" />}Create rework order</Button>
      </div>}
      <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[950px] text-left text-sm"><thead className="bg-muted/50 text-[10px] font-black uppercase tracking-wider text-muted-foreground"><tr><th className="px-3 py-3">Rework order</th><th className="px-3 py-3">Failure reason</th><th className="px-3 py-3 text-right">Failed qty</th><th className="px-3 py-3">Team / worker</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Final result</th><th className="px-3 py-3">Action</th></tr></thead>
        <tbody className="divide-y">{rework?.records?.length ? rework.records.map((record: any) => <tr key={record.id}><td className="px-3 py-3 font-mono font-bold text-primary">{record.rework_number}</td><td className="max-w-64 px-3 py-3"><p>{record.reason_for_failure}</p>{record.notes && <p className="mt-1 text-xs text-muted-foreground">{record.notes}</p>}</td><td className="px-3 py-3 text-right font-bold text-red-600">{record.failed_quantity}</td><td className="px-3 py-3"><b>{record.assigned_team}</b><div className="text-xs text-muted-foreground">{record.assigned_worker || 'Team assignment'}</div></td><td className="px-3 py-3"><Badge className={record.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' : record.status === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}>{record.status.replaceAll('_', ' ')}</Badge></td><td className="px-3 py-3"><Badge className={record.final_result === 'PASSED' ? 'bg-emerald-100 text-emerald-700' : record.final_result === 'FAILED' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700'}>{record.final_result.replaceAll('_', ' ')}</Badge></td><td className="px-3 py-3">{record.status !== 'COMPLETED' && <Button size="sm" disabled={busy === `rework:${record.id}`} onClick={() => void advanceRework(record)}>{record.status === 'PENDING' ? 'Start rework' : 'Complete rework'}</Button>}</td></tr>) : <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">No rework orders recorded.</td></tr>}</tbody>
      </table></div>
    </DialogContent></Dialog>
    <GenealogyModal
      identifier={genealogyTarget}
      open={Boolean(genealogyTarget)}
      onOpenChange={(open) => !open && setGenealogyTarget(null)}
    />
  </AppShell>;
}

function Field({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return <div><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p><p className={highlight ? "mt-1 text-sm font-bold text-destructive" : "mt-1 text-sm font-semibold"}>{value}</p></div>;
}
