import { InformationTooltip } from "@/components/ui/information-tooltip";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { PackageQrActions } from "@/components/wms/package-qr-actions";
import { toast } from "sonner";
import { AppShell } from "@/components/wms/app-shell";
import { FgQrInput } from "@/components/wms/fg-qr-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api-client";
import { requireRole } from "@/lib/auth-utils";

type Batch = {
  finished_goods_id: string;
  batch_number?: string;
  quantity: number;
  status: string;
  qr_code?: string;
};
type Section = {
  sub_id: string;
  qr_identity: string;
  status: string;
  gate_visit_id?: string | null;
  loaded_by?: string | null;
  loaded_at?: string | null;
  dispatched_by?: string | null;
  dispatched_at?: string | null;
};
type Pickup = {
  id: string;
  request_number: string;
  supplier_name?: string;
  product_name: string;
  product_code: string;
  quantity: number;
  uom: string;
  expected_pickup_date?: string;
  status: string;
  dispatch_id?: string;
  dispatch_status?: string;
  requested_on?: string;
  priority_rank?: number | null;
  workflow_status?: string;
  processing_group?: "0" | "1" | "2" | "COMPLETE";
  gate_exit_confirmed?: boolean;
  next_to_process?: boolean;
  allocation_eligible?: boolean;
  priority_reason?: string | null;
  vehicle_number?: string;
  driver_name?: string;
  driver_contact?: string;
  gate_pass_number?: string;
  gate_pass_status?: string;
  allocated_batches?: Batch[];
  fg_id?: string | null;
  section_fg_id?: string | null;
  main_fg_id?: string | null;
  sections?: Section[];
  dispatched_sections?: number;
  remaining_sections?: number;
};
const legacySteps = ["Dispatch Verification", "Picking & Packing", "Loading"];
const sectionalSteps = ["Vehicle Arrival", "Section Loading", "Gate Exit"];
const steps = legacySteps;
const loadingStatuses = [
  "PACKED",
  "DISPATCH_READY",
  "ROUTE_ASSIGNED",
  "VEHICLE_ALLOCATED",
  "DRIVER_ALLOCATED",
  "LOADING_STARTED",
  "LOADING_VERIFIED",
  "LOADED",
  "READY_FOR_GATE_EXIT",
];
const terminalStatuses = [
  "DISPATCHED",
  "GATE_OUT",
  "EXIT_COMPLETED",
  "COMPLETED",
  "CLOSED",
  "CANCELLED",
  "DELIVERED",
];
function fgDispatchStep(request: Pickup, status = request.dispatch_status): number {
  if (request.fg_id || (request as any).section_fg_id) {
    if (
      request.gate_pass_status === "CLOSED" ||
      request.status === "COMPLETED" ||
      request.status === "DISPATCHED" ||
      request.dispatch_status === "FULLY_DISPATCHED" ||
      terminalStatuses.includes(status || request.status)
    )
      return 2;
    if (request.gate_pass_status === "READY_FOR_GATE_EXIT") return 2;
    if (request.gate_pass_status === "INSIDE_FACILITY") return 1;
    return 0;
  }
  if (request.processing_group)
    return request.processing_group === "COMPLETE" ? 2 : Number(request.processing_group);
  if (terminalStatuses.includes(status || request.status)) return 2;
  if (!request.dispatch_id || ["PENDING_ASSEMBLY", "APPROVED"].includes(request.status)) return 0;
  return loadingStatuses.includes(status || "") ||
    terminalStatuses.includes(status || request.status)
    ? 2
    : 1;
}
function dispatchAction(request: Pickup): "Process" | "View" {
  if (request.fg_id || (request as any).section_fg_id) {
    if (
      request.gate_pass_status === "CLOSED" ||
      request.status === "COMPLETED" ||
      request.status === "CANCELLED" ||
      request.dispatch_status === "FULLY_DISPATCHED"
    ) {
      return "View";
    }
    return "Process";
  }
  const status = request.dispatch_status || request.status;
  const closed =
    request.gate_exit_confirmed === true ||
    terminalStatuses.includes(request.status) ||
    terminalStatuses.includes(status);
  return closed ||
    status === "READY_FOR_GATE_EXIT" ||
    (fgDispatchStep(request) === 0 && request.next_to_process === false)
    ? "View"
    : "Process";
}

function dispatchStatusColor(status: string) {
  if (["CANCELLED", "REJECTED"].includes(status))
    return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300";
  if (terminalStatuses.includes(status))
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300";
  if (loadingStatuses.includes(status))
    return "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900 dark:bg-teal-950/30 dark:text-teal-300";
  if (
    [
      "ALLOCATED",
      "STOCK_RESERVED",
      "PICKING_IN_PROGRESS",
      "PICKED",
      "PACKING_IN_PROGRESS",
    ].includes(status)
  )
    return "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300";
  return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300";
}

export const Route = createFileRoute("/assembly/dispatch")({
  beforeLoad: () => requireRole(["ASSEMBLY_MANAGER", "ASSEMBLY", "ADMIN", "SUPERUSER"]),
  component: AssemblyDispatchPage,
});

function AssemblyDispatchPage() {
  const [requests, setRequests] = useState<Pickup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [page, setPage] = useState(1);
  useEffect(() => {
    setPage(1);
  }, [search, filter]);
  const [selectedId, setSelectedId] = useState("");
  const [dispatch, setDispatch] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [vehicleConfirmed, setVehicleConfirmed] = useState(false);
  const [qr, setQr] = useState("");
  const [verified, setVerified] = useState<string[]>([]);
  const [packageType, setPackageType] = useState("");
  const [packageCount, setPackageCount] = useState("");
  const [selectedSectionQrs, setSelectedSectionQrs] = useState<string[]>([]);
  const [sectionScan, setSectionScan] = useState("");
  const selected = requests.find((request) => request.id === selectedId);
  const isSectional = Boolean(
    selected &&
      (selected.fg_id ||
        (selected as any).section_fg_id ||
        (selected.sections && selected.sections.length > 0)),
  );
  const availableSections = (selected?.sections || []).filter((s) => s.status === "AVAILABLE");
  const load = useCallback(async (isCurrent: () => boolean = () => true) => {
    const result = await api.getSupplierFinishedGoodsDispatchRequests();
    if (!isCurrent()) return (result || []) as Pickup[];
    setRequests(
      [...(result || [])].sort(
        (a: Pickup, b: Pickup) =>
          (a.priority_rank ?? Infinity) - (b.priority_rank ?? Infinity) ||
          (a.requested_on || "").localeCompare(b.requested_on || "") ||
          a.id.localeCompare(b.id),
      ),
    );
    setError("");
    return (result || []) as Pickup[];
  }, []);
  useEffect(() => {
    void load()
      .catch((error) => setError(error.message || "Unable to load pickup requests"))
      .finally(() => setLoading(false));
  }, [load]);
  useEffect(() => {
    let cancelled = false;
    setDispatch(null);
    setVerified([]);
    setQr("");
    setConfirmed(false);
    setVehicleConfirmed(false);
    setPackageType("");
    setPackageCount("");
    setSelectedSectionQrs([]);
    setSectionScan("");
    if (selected?.dispatch_id) {
      setDetailLoading(true);
      void api
        .getDispatch(selected.dispatch_id)
        .then((result) => {
          if (!cancelled) setDispatch(result);
        })
        .catch((error) => {
          if (!cancelled) setError(error.message || "Unable to load selected dispatch");
        })
        .finally(() => {
          if (!cancelled) setDetailLoading(false);
        });
    } else setDetailLoading(false);
    return () => {
      cancelled = true;
    };
  }, [selectedId, selected?.dispatch_id]);
  const refresh = async () => {
    const rows = await load();
    const current = rows.find((row) => row.id === selectedId);
    if (current?.dispatch_id) setDispatch(await api.getDispatch(current.dispatch_id));
  };
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const sync = async () => {
      if (busy || document.visibilityState === "hidden" || inFlight) return;
      inFlight = true;
      try {
        const rows = await load(() => !cancelled);
        const current = rows.find((row) => row.id === selectedId);
        if (current?.dispatch_id && !cancelled) {
          const latest = await api.getDispatch(current.dispatch_id);
          if (!cancelled) setDispatch(latest);
        }
      } catch {
        // Preserve the current view on transient background failures.
      } finally {
        inFlight = false;
      }
    };
    const timer = window.setInterval(() => void sync(), 15000);
    const onFocus = () => void sync();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [load, selectedId, busy]);
  const act = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action failed");
      try {
        await refresh();
      } catch {
        setError("Unable to refresh the latest dispatch state. Use Refresh before retrying.");
      }
    } finally {
      setBusy(false);
    }
  };
  const status = dispatch?.status || selected?.dispatch_status || "";
  const step = selected ? fgDispatchStep(selected, status) : 0;
  const sectionalCompleted =
    isSectional &&
    (selected?.gate_pass_status === "CLOSED" ||
      selected?.status === "COMPLETED" ||
      selected?.status === "DISPATCHED" ||
      selected?.dispatch_status === "FULLY_DISPATCHED" ||
      selected?.gate_exit_confirmed === true);
  const sectionalReady = isSectional && selected?.gate_pass_status === "READY_FOR_GATE_EXIT";
  const completed =
    !!selected &&
    (selected.gate_exit_confirmed === true ||
      selected.status === "CANCELLED" ||
      selected.workflow_status === "CANCELLED" ||
      sectionalCompleted);
  const ready =
    status === "READY_FOR_GATE_EXIT" ||
    (!completed && terminalStatuses.includes(status)) ||
    sectionalReady;
  const items: any[] = dispatch?.items || [];
  const batches = (selected?.allocated_batches || []).filter((batch) =>
    ["ALLOCATED", "LOADED"].includes(batch.status),
  );
  const picked =
    items.length > 0 &&
    items.every((item) => Number(item.quantity_picked) === Number(item.quantity_ordered));
  const allVerified =
    batches.length > 0 && batches.every((batch) => verified.includes(batch.finished_goods_id));
  const packed = items.reduce((sum, item) => sum + Number(item.quantity_packed || 0), 0);
  const loaded = items.reduce((sum, item) => sum + Number(item.quantity_loaded || 0), 0);
  const inside = selected?.gate_pass_status === "INSIDE_FACILITY";
  const packValid =
    !!packageType.trim() &&
    Number.isInteger(Number(packageCount)) &&
    Number(packageCount) > 0 &&
    picked &&
    items.reduce((sum, item) => sum + Number(item.quantity_picked || 0), 0) ===
      Number(selected?.quantity);
  const visible = requests.filter((request) => {
    const done =
      request.processing_group === "COMPLETE" ||
      request.gate_exit_confirmed === true ||
      request.status === "CANCELLED" ||
      request.workflow_status === "CANCELLED";
    const matches =
      filter === "ALL" ||
      (filter === "COMPLETE" ? done : !done && String(fgDispatchStep(request)) === filter);
    return (
      matches &&
      [
        request.request_number,
        request.supplier_name,
        request.product_name,
        request.product_code,
        request.vehicle_number,
        request.driver_name,
      ].some((value) =>
        String(value || "")
          .toLowerCase()
          .includes(search.trim().toLowerCase()),
      )
    );
  });
  const pageCount = Math.max(1, Math.ceil(visible.length / 10));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * 10;
  const pageRequests = visible.slice(pageStart, pageStart + 10);
  return (
    <AppShell
      title="FG Dispatch"
      subtitle="Supplier pickup verification, picking, packing and loading from the Assembly FG Area"
      actions={
        <Button
          variant="outline"
          size="sm"
          className="rounded-xl gap-2"
          disabled={busy || loading}
          onClick={() => void act(async () => {})}
        >
          <RefreshCw className="size-4" />
          Refresh
        </Button>
      }
    >
      <div className="min-w-0 space-y-5">
        {error && (
          <p
            role="alert"
            className="rounded-xl border border-destructive/30 p-3 text-xs text-destructive"
          >
            {error}
          </p>
        )}
        <section
          className="min-w-0 rounded-2xl border border-border/70 bg-card p-4 sm:p-5 shadow-soft space-y-4"
          aria-label="Supplier pickup requests"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div role="group" aria-label="Dispatch status" className="flex flex-wrap gap-2">
              {[
                ["ALL", "All"],
                ["0", "Awaiting verification"],
                ["1", "Picking & Packing"],
                ["2", "Loading"],
                ["COMPLETE", "Completed / Cancelled"],
              ].map(([key, label]) => (
                <Button
                  key={key}
                  size="sm"
                  variant={filter === key ? "default" : "outline"}
                  className="rounded-xl text-xs"
                  aria-pressed={filter === key}
                  onClick={() => setFilter(key!)}
                >
                  {label}
                </Button>
              ))}
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <Input
                aria-label="Search dispatch requests"
                placeholder="Search request, supplier or vehicle..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="pl-9 rounded-xl text-xs"
              />
            </div>
          </div>
          {loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Loading pickup requests...
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border/70">
              <table className="w-full min-w-[750px] text-left text-xs">
                <thead className="bg-muted/50 text-[11px] uppercase text-muted-foreground">
                  <tr>
                    {[
                      "Priority",
                      "Request / Supplier",
                      "Product",
                      "Quantity",
                      "Pickup Date",
                      "Status",
                      "Actions",
                    ].map((label) => (
                      <th key={label} className="px-4 py-3 last:text-right">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {pageRequests.map((request) => (
                    <tr
                      key={request.id}
                      className={selectedId === request.id ? "bg-primary/5" : "hover:bg-muted/30"}
                    >
                      <td className="px-4 py-3 whitespace-nowrap">
                        {request.priority_rank ? `#${request.priority_rank}` : "-"}
                        {request.next_to_process && (
                          <Badge
                            variant="outline"
                            className="mt-1 block w-fit border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300"
                          >
                            Next to Process
                          </Badge>
                        )}
                        {request.priority_reason && (
                          <span className="mt-1 block text-muted-foreground">
                            {request.priority_reason}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono font-semibold">{request.request_number}</span>
                        <span className="block mt-1 text-muted-foreground">
                          {request.supplier_name}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {request.product_name}
                        <span className="block mt-1 text-muted-foreground font-mono">
                          {request.product_code}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap tabular-nums">
                        {request.quantity} {request.uom}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {request.expected_pickup_date || "Unavailable"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="outline"
                          className={dispatchStatusColor(
                            request.workflow_status || request.dispatch_status || request.status,
                          )}
                        >
                          {(
                            request.workflow_status ||
                            request.dispatch_status ||
                            request.status
                          ).replaceAll("_", " ")}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-xl text-xs"
                          disabled={busy}
                          aria-pressed={selectedId === request.id}
                          onClick={() => setSelectedId(request.id)}
                        >
                          {dispatchAction(request)}
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {!visible.length && (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                        No pickup requests match this view.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          {!loading && visible.length > 0 && (
            <nav
              aria-label="FG Dispatch pagination"
              className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4 text-xs text-muted-foreground"
            >
              <span>
                Showing {pageStart + 1}-{Math.min(pageStart + 10, visible.length)} of{" "}
                {visible.length} requests
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-xl text-xs"
                  disabled={currentPage === 1}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Previous
                </Button>
                <span aria-live="polite">
                  Page {currentPage} of {pageCount}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-xl text-xs"
                  disabled={currentPage === pageCount}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Next
                </Button>
              </div>
            </nav>
          )}
        </section>
        {selected && (
          <section
            className="rounded-2xl border border-border/70 bg-card p-4 sm:p-5 shadow-soft space-y-5"
            aria-label="Selected pickup workflow"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-xl"
                  disabled={busy}
                  onClick={() => setSelectedId("")}
                >
                  Back to Requests
                </Button>
                <h2 className="font-semibold">{selected.request_number}</h2>
              </div>
              <span className="text-xs text-muted-foreground">
                {selected.product_name} / {selected.quantity} {selected.uom}
              </span>
            </div>
            <ol aria-label="FG dispatch steps" className="flex flex-wrap gap-3 text-xs">
              {(isSectional ? sectionalSteps : legacySteps).map((label, index) => (
                <li
                  key={label}
                  aria-current={index === step ? "step" : undefined}
                  className={
                    index === step
                      ? "rounded-xl bg-primary/10 px-3 py-2 font-semibold text-primary"
                      : "px-3 py-2 text-muted-foreground"
                  }
                >
                  {index + 1}. {label}
                </li>
              ))}
            </ol>
            <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-xl border border-border/60 bg-muted/20 p-3 text-xs">
              {[
                ["Supplier Vehicle", selected.vehicle_number],
                ["Supplier Driver", selected.driver_name],
                ["Driver Contact", selected.driver_contact],
                ["Gate Pass", selected.gate_pass_number],
                ["Gate Status", selected.gate_pass_status?.replaceAll("_", " ")],
                ...(isSectional
                  ? [
                      ["Main FG ID", selected.main_fg_id || selected.fg_id],
                      [
                        "Section Status",
                        `${selected.dispatched_sections ?? 0}/8 Dispatched (${selected.dispatch_status || "READY"})`,
                      ],
                    ]
                  : []),
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="mt-1 font-semibold">{value || "Not yet recorded"}</dd>
                </div>
              ))}
            </dl>
            {detailLoading ? (
              <p className="text-sm text-muted-foreground">Loading selected dispatch...</p>
            ) : isSectional ? (
              <div className="space-y-4">
                {sectionalCompleted ? (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-emerald-800 dark:text-emerald-300">
                          Pickup Completed · Gate Exit Recorded
                        </span>
                        <Badge
                          variant="outline"
                          className={
                            selected.dispatched_sections === 8
                              ? "border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                              : "border-blue-300 bg-blue-100 text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300"
                          }
                        >
                          {selected.dispatched_sections === 8
                            ? "FULLY DISPATCHED (8/8)"
                            : `PARTIALLY DISPATCHED (${selected.dispatched_sections || 0}/8)`}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Vehicle {selected.vehicle_number || "assigned vehicle"} (Gate Pass:{" "}
                        {selected.gate_pass_number || "-"}) completed gate exit.
                        {selected.remaining_sections && selected.remaining_sections > 0
                          ? ` Remaining ${selected.remaining_sections} sections are available for subsequent vehicle pickup.`
                          : " All 8 transport sections have exited the facility."}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <span className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
                        Transport Sections Summary ({selected.dispatched_sections || 0}/8 Dispatched)
                      </span>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {(selected.sections || []).map((section) => (
                          <div
                            key={section.sub_id}
                            className="rounded-xl border border-border/70 p-3 bg-card text-xs"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-mono font-semibold">{section.sub_id}</span>
                              <Badge
                                variant="outline"
                                className={`text-[10px] ${
                                  section.status === "DISPATCHED"
                                    ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                                    : section.status === "LOADED"
                                      ? "border-blue-300 bg-blue-50 text-blue-700"
                                      : "border-amber-300 bg-amber-50 text-amber-700"
                                }`}
                              >
                                {section.status}
                              </Badge>
                            </div>
                            <p className="font-mono text-[10px] text-muted-foreground mt-2 truncate">
                              {section.qr_identity}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : sectionalReady ? (
                  <div className="space-y-3">
                    <div
                      role="status"
                      className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 space-y-2"
                    >
                      <div className="flex flex-wrap items-center gap-2 font-semibold text-emerald-700 dark:text-emerald-300">
                        <span>Vehicle Loaded & Ready for Departure</span>
                        <Badge
                          variant="outline"
                          className="border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                        >
                          READY FOR GATE EXIT
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Sections successfully loaded into vehicle {selected.vehicle_number} (Gate Pass:{" "}
                        {selected.gate_pass_number}). Awaiting Gate Security confirmation of Gate Exit at
                        the security gate.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <span className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
                        Loaded Vehicle Sections
                      </span>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {(selected.sections || []).map((section) => (
                          <div
                            key={section.sub_id}
                            className="rounded-xl border border-border/70 p-3 bg-card text-xs"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-mono font-semibold">{section.sub_id}</span>
                              <Badge
                                variant="outline"
                                className={`text-[10px] ${
                                  section.status === "DISPATCHED"
                                    ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                                    : section.status === "LOADED"
                                      ? "border-blue-300 bg-blue-50 text-blue-700"
                                      : "border-amber-300 bg-amber-50 text-amber-700"
                                }`}
                              >
                                {section.status}
                              </Badge>
                            </div>
                            <p className="font-mono text-[10px] text-muted-foreground mt-2 truncate">
                              {section.qr_identity}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : selected.gate_pass_status === "INSIDE_FACILITY" ? (
                  <div className="space-y-4">
                    <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-4 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-200">
                          Vehicle Inside Facility · Ready for Section Loading
                        </h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Vehicle <strong>{selected.vehicle_number}</strong> (Gate Pass:{" "}
                          <strong>{selected.gate_pass_number}</strong>) is parked at the loading dock.
                          Select or scan the sections to load into this vehicle.
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-xl text-xs"
                          disabled={busy || availableSections.length === 0}
                          onClick={() => {
                            setSelectedSectionQrs(availableSections.map((s) => s.qr_identity));
                            toast.info(`Selected all ${availableSections.length} available sections`);
                          }}
                        >
                          Select All Available ({availableSections.length})
                        </Button>
                        {selectedSectionQrs.length > 0 && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="rounded-xl text-xs"
                            disabled={busy}
                            onClick={() => setSelectedSectionQrs([])}
                          >
                            Deselect All
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-muted-foreground uppercase tracking-wider">
                          Transport Sections (8 Sub-IDs)
                        </span>
                        <span className="font-medium">
                          {selectedSectionQrs.length} of {availableSections.length} available selected
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                        {(selected.sections || []).map((section) => {
                          const isAvailable = section.status === "AVAILABLE";
                          const isSelected = selectedSectionQrs.includes(section.qr_identity);
                          return (
                            <label
                              key={section.sub_id}
                              className={`flex flex-col justify-between rounded-xl border p-3 cursor-pointer transition-colors ${
                                !isAvailable
                                  ? "bg-muted/40 border-muted opacity-75 cursor-not-allowed"
                                  : isSelected
                                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                                    : "border-border/70 hover:bg-muted/30"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <span className="font-mono font-semibold text-xs">
                                  {section.sub_id}
                                </span>
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] ${
                                    section.status === "DISPATCHED"
                                      ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                                      : section.status === "LOADED"
                                        ? "border-blue-300 bg-blue-50 text-blue-700"
                                        : "border-amber-300 bg-amber-50 text-amber-700"
                                  }`}
                                >
                                  {section.status}
                                </Badge>
                              </div>
                              <div className="mt-3 flex items-center justify-between">
                                <span className="font-mono text-[10px] text-muted-foreground truncate max-w-[120px]">
                                  {section.qr_identity}
                                </span>
                                <input
                                  type="checkbox"
                                  aria-label={`Select section ${section.sub_id}`}
                                  disabled={!isAvailable || busy}
                                  checked={isSelected}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedSectionQrs((prev) => [
                                        ...new Set([...prev, section.qr_identity]),
                                      ]);
                                    } else {
                                      setSelectedSectionQrs((prev) =>
                                        prev.filter((qr) => qr !== section.qr_identity),
                                      );
                                    }
                                  }}
                                  className="size-4 rounded accent-primary"
                                />
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-end gap-3 pt-2 border-t border-border/60">
                      <div className="flex-1 min-w-[240px]">
                        <FgQrInput
                          value={sectionScan}
                          onChange={setSectionScan}
                          label="Or scan section QR code to select"
                          inputId="dispatch-section-scan"
                          disabled={busy}
                        />
                      </div>
                      <Button
                        variant="outline"
                        className="rounded-xl text-xs h-9"
                        disabled={busy || !sectionScan.trim()}
                        onClick={() => {
                          const query = sectionScan.trim();
                          const found = (selected.sections || []).find(
                            (s) =>
                              s.qr_identity === query ||
                              s.sub_id.toLowerCase() === query.toLowerCase(),
                          );
                          if (!found) {
                            toast.error("QR code does not match any section for this Finished Good");
                            return;
                          }
                          if (found.status !== "AVAILABLE") {
                            toast.error(
                              `Section ${found.sub_id} is already ${found.status.toLowerCase()}`,
                            );
                            return;
                          }
                          if (selectedSectionQrs.includes(found.qr_identity)) {
                            toast.info(`Section ${found.sub_id} is already selected`);
                            setSectionScan("");
                            return;
                          }
                          setSelectedSectionQrs((prev) => [...prev, found.qr_identity]);
                          setSectionScan("");
                          toast.success(`Section ${found.sub_id} added to loading list`);
                        }}
                      >
                        Add Scanned Section
                      </Button>
                    </div>

                    <div className="pt-2">
                      <Button
                        className="rounded-xl px-6"
                        disabled={
                          busy || selectedSectionQrs.length === 0 || !selected.gate_pass_number
                        }
                        onClick={() =>
                          void act(async () => {
                            if (!selected.gate_pass_number) {
                              throw new Error("No active gate pass found for this vehicle");
                            }
                            await api.confirmFgLoading(selected.gate_pass_number, selectedSectionQrs);
                            toast.success(
                              `Loading confirmed for ${selectedSectionQrs.length} section(s)! Vehicle is ready for Gate Exit.`,
                            );
                            setSelectedSectionQrs([]);
                          })
                        }
                      >
                        Confirm Section Loading ({selectedSectionQrs.length} selected)
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div
                      role="status"
                      className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-2"
                    >
                      <div className="flex items-center gap-2 font-semibold text-amber-800 dark:text-amber-300">
                        <span>Awaiting Gate Entry</span>
                        <Badge variant="outline" className="border-amber-300 bg-amber-100 text-amber-800">
                          {selected.gate_pass_status?.replaceAll("_", " ") || "AWAITING ARRIVAL"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Supplier vehicle <strong>{selected.vehicle_number || "Not assigned"}</strong>{" "}
                        has not yet entered the facility. Security must verify the vehicle and issue a
                        Gate Pass at the Security Gate (/vehicle-queue). Once the vehicle is inside the
                        facility, Section Loading will be enabled.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <span className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
                        Transport Section Availability ({availableSections.length}/8 available)
                      </span>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {(selected.sections || []).map((section) => (
                          <div
                            key={section.sub_id}
                            className="rounded-xl border border-border/70 p-3 bg-card text-xs"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-mono font-semibold">{section.sub_id}</span>
                              <Badge
                                variant="outline"
                                className={`text-[10px] ${
                                  section.status === "DISPATCHED"
                                    ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                                    : section.status === "LOADED"
                                      ? "border-blue-300 bg-blue-50 text-blue-700"
                                      : "border-amber-300 bg-amber-50 text-amber-700"
                                }`}
                              >
                                {section.status}
                              </Badge>
                            </div>
                            <p className="font-mono text-[10px] text-muted-foreground mt-2 truncate">
                              {section.qr_identity}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : completed ? (
              <p className="text-sm font-semibold">
                {selected.status === "CANCELLED" || selected.workflow_status === "CANCELLED"
                  ? "Pickup cancelled."
                  : "Pickup completed. Gate Exit has posted the finished-goods stock movement."}
              </p>
            ) : ready ? (
              <p
                role="status"
                className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm"
              >
                Awaiting Gate Security confirmation of Gate Exit. The pickup is completed only after
                Gate Exit is recorded.
              </p>
            ) : (
              <>
                {step === 0 && selected.next_to_process === false && (
                  <p role="status" className="text-xs text-muted-foreground">
                    {selected.priority_reason ||
                      "An older eligible request must be allocated first. Open the request marked Next to Process."}
                  </p>
                )}
                {step === 0 && (
                  <div className="space-y-3">
                    <label className="flex items-start gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={confirmed}
                        onChange={(event) => setConfirmed(event.target.checked)}
                      />
                      Request, quantity and supplier pickup details verified
                    </label>
                    <Button
                      className="rounded-xl"
                      disabled={
                        busy ||
                        !confirmed ||
                        selected.next_to_process === false ||
                        !selected.vehicle_number ||
                        !selected.driver_name ||
                        !selected.driver_contact
                      }
                      onClick={() =>
                        void act(async () => {
                          await api.allocateSupplierFinishedGoodsFifo(selected.id);
                          toast.success("FIFO allocation confirmed");
                        })
                      }
                    >
                      Verify & Allocate
                    </Button>
                  </div>
                )}
                {step === 1 && dispatch && (
                  <div className="space-y-4">
                    <div className="overflow-x-auto rounded-xl border">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="p-3">FIFO Batch</th>
                            <th className="p-3 text-right">Quantity</th>
                            <th className="p-3 text-right">Verification</th>
                          </tr>
                        </thead>
                        <tbody>
                          {batches.map((batch) => (
                            <tr key={batch.finished_goods_id} className="border-t">
                              <td className="p-3 font-mono">
                                {batch.batch_number || batch.finished_goods_id}
                              </td>
                              <td className="p-3 text-right">
                                {batch.quantity} {selected.uom}
                              </td>
                              <td className="p-3 text-right">
                                {picked || verified.includes(batch.finished_goods_id)
                                  ? "Verified"
                                  : "Scan required"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {!picked ? (
                      <>
                        <FgQrInput value={qr} onChange={setQr} disabled={busy} />
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            className="rounded-xl"
                            disabled={busy || !qr.trim()}
                            onClick={() =>
                              void act(async () => {
                                const batch = (selected.allocated_batches || []).find(
                                  (batch: any) => batch.qr_code === qr.trim(),
                                );
                                if (!batch)
                                  throw new Error(
                                    "Scan a finished-goods QR allocated to this request",
                                  );
                                const result = await api.scanAllocatedFinishedGoods(
                                  dispatch.id,
                                  qr.trim(),
                                  batch.quantity,
                                );
                                setVerified((current) => [
                                  ...new Set([...current, result.finished_goods_id]),
                                ]);
                                setQr("");
                                toast.success("FIFO batch verified");
                              })
                            }
                          >
                            Verify FG QR
                          </Button>
                          <Button
                            className="rounded-xl"
                            disabled={busy || !allVerified}
                            onClick={() =>
                              void act(async () => {
                                if (dispatch.status !== "PICKING_IN_PROGRESS")
                                  await api.startDispatchPicking(dispatch.id);
                                await api.pickDispatchItems(
                                  dispatch.id,
                                  items.map((item) => ({
                                    id: item.id,
                                    material_code: item.material_code,
                                    quantity_picked: item.quantity_ordered,
                                  })),
                                );
                              })
                            }
                          >
                            Confirm Picking
                          </Button>
                        </div>
                      </>
                    ) : (
                      <div className="space-y-4">
                        <p className="text-xs font-semibold text-emerald-700">
                          Picking confirmed. Record packing details.
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {[
                            ["Package Type", packageType, setPackageType, "text"],
                            ["Package Count", packageCount, setPackageCount, "number"],
                          ].map(([label, value, setter, type]: any) => (
                            <div key={label} className="space-y-1">
                              <label htmlFor={label} className="text-xs font-semibold">
                                {label}
                              </label>
                              <Input
                                id={label}
                                type={type}
                                min={type === "number" ? 1 : undefined}
                                value={value}
                                onChange={(event) => setter(event.target.value)}
                                className="rounded-xl"
                                disabled={busy}
                              />
                            </div>
                          ))}
                        </div>
                        <Button
                          className="rounded-xl"
                          disabled={busy || !packValid}
                          onClick={() =>
                            void act(async () => {
                              if (dispatch.status !== "PACKING_IN_PROGRESS")
                                await api.startDispatchPacking(dispatch.id);
                              const number =
                                items.find((item) => item.package_number)?.package_number ||
                                `PKG-${crypto.randomUUID()}`;
                              await api.packDispatchItems(
                                dispatch.id,
                                items.map((item) => ({
                                  id: item.id,
                                  material_code: item.material_code,
                                  quantity_packed: item.quantity_picked,
                                  package_number: number,
                                  package_type: packageType.trim(),
                                  package_count: Number(packageCount),
                                })),
                              );
                            })
                          }
                        >
                          Confirm Packing
                        </Button>
                      </div>
                    )}
                  </div>
                )}
                {step === 2 && dispatch && (
                  <div className="space-y-4">
                    {!inside && (
                      <p
                        role="status"
                        className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs"
                      >
                        Awaiting Gate Entry for the supplier vehicle. Loading is blocked until
                        arrival is recorded.
                      </p>
                    )}
                    <span className="inline-flex items-center"><label className="flex items-start gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={vehicleConfirmed}
                        onChange={(event) => setVehicleConfirmed(event.target.checked)}
                        disabled={!inside || busy}
                      />
                      Supplier vehicle and driver physically verified
                    </label><InformationTooltip help="loading" /></span>
                    <p className="text-xs">
                      Packed:{" "}
                      <strong>
                        {packed} {selected.uom}
                      </strong>{" "}
                      / Loaded:{" "}
                      <strong>
                        {loaded} {selected.uom}
                      </strong>
                    </p>
                    <FgQrInput
                      value={qr}
                      onChange={setQr}
                      disabled={busy || !inside || !vehicleConfirmed}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        className="rounded-xl"
                        disabled={
                          busy || !inside || !vehicleConfirmed || !qr.trim() || packed === loaded
                        }
                        onClick={() =>
                          void act(async () => {
                            await api.scanDispatchPackage(dispatch.id, qr.trim());
                            setQr("");
                          })
                        }
                      >
                        Verify & Load QR
                      </Button>
                      <PackageQrActions packageNumber={items.find((item) => item.package_number)?.package_number} />
                      <Button
                        className="rounded-xl"
                        disabled={
                          busy || !inside || !vehicleConfirmed || packed <= 0 || packed !== loaded
                        }
                        onClick={() =>
                          void act(async () => {
                            if (status !== "LOADING_STARTED" && status !== "LOADING_VERIFIED")
                              await api.startDispatchLoading(dispatch.id);
                            if (status !== "LOADING_VERIFIED")
                              await api.verifyDispatchLoading(dispatch.id);
                            await api.verifyDispatchFinal(dispatch.id);
                          })
                        }
                      >
                        Confirm Loading
                      </Button><InformationTooltip help="loading" />
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        )}
      </div>
    </AppShell>
  );
}
