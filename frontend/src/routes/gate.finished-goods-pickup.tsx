import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Loader2, LogOut, Plus, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/gate/finished-goods-pickup")({
  component: FinishedGoodsPickupGatePage,
});
const eligibleStatuses = ["ALLOCATED", "APPROVED", "READY_FOR_PICKUP"];
const vehiclePattern = /^[A-Z]{2}\s?\d{1,2}\s?[A-Z]{1,3}\s?\d{3,4}$/;
const statusLabel = (status: string) => status.replaceAll("_", " ");
const normalizeVehicle = (value: unknown) => String(value || "").replace(/[\s-]/g, "").toUpperCase();

function FinishedGoodsPickupGatePage() {
  const [entryOpen, setEntryOpen] = useState(false);
  const [requests, setRequests] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [selectedTransportIndex, setSelectedTransportIndex] = useState(-1);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [driverName, setDriverName] = useState("");
  const [driverContact, setDriverContact] = useState("");
  const [mismatchReason, setMismatchReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<any | null>(null);
  const [exitOpen, setExitOpen] = useState(false);
  const [exitPass, setExitPass] = useState("");
  const [exitDetails, setExitDetails] = useState<any | null>(null);
  const [exitDocs, setExitDocs] = useState(false);
  const [exitBusy, setExitBusy] = useState(false);

  const lookupExitPass = async () => {
    const normalized = exitPass.trim().toUpperCase();
    setExitPass(normalized);
    if (!/^[A-Z0-9]{6}$/.test(normalized)) {
      toast.error("Enter or scan a valid six-character gate pass.");
      return;
    }
    try {
      const result = await api.getFinishedGoodsPickupGatePass(normalized);
      setExitDetails(result);
      setExitDocs(false);
    } catch (err) {
      setExitDetails(null);
      toast.error(err instanceof Error ? err.message : "Gate pass not found.");
    }
  };

  const confirmExit = async () => {
    if (!exitDetails || !exitDocs) return;
    setExitBusy(true);
    try {
      const result = await api.completeFinishedGoodsPickupGateExit(exitPass, {
        vehicle_number: exitDetails.vehicle_number,
        driver_name: exitDetails.driver_name,
        documents_verified: true,
      });
      toast.success(`${result.request_number} exited successfully`, {
        description: `Exit recorded at ${new Date(result.exited_at).toLocaleString()}.`,
      });
      setExitOpen(false);
      setExitPass("");
      setExitDetails(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gate exit failed.");
    } finally {
      setExitBusy(false);
    }
  };

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await api.getSupplierFinishedGoodsDispatchRequests();
      setRequests(rows);
      return rows;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load pickup requests.");
      return [];
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const filteredRequests = useMemo(
    () =>
      requests.filter((request) => {
        const text =
          `${request.request_number} ${request.supplier_name ?? ""} ${request.vehicle_number ?? ""} ${request.driver_name ?? ""}`.toLowerCase();
        return (
          (!query.trim() || text.includes(query.trim().toLowerCase())) &&
          (statusFilter === "ALL" ||
            request.status === statusFilter ||
            request.gate_pass_status === statusFilter)
        );
      }),
    [requests, query, statusFilter],
  );
  const vehicle = vehicleNumber.trim().toUpperCase().replace(/\s+/g, " ");
  const contact = driverContact.replace(/\D/g, "");
  const selectedTransport = selected?.transport_entries?.[selectedTransportIndex];
  const expectedVehicleNumber = selectedTransport?.vehicle_number || selected?.vehicle_number;
  const expectedDriverName = selectedTransport?.driver_name || selected?.driver_name;
  const vehicleMismatch = Boolean(
    expectedVehicleNumber &&
    vehicle &&
    normalizeVehicle(expectedVehicleNumber) !== normalizeVehicle(vehicle),
  );
  const driverMismatch = Boolean(
    expectedDriverName &&
    driverName.trim() &&
    expectedDriverName.trim().toLowerCase() !== driverName.trim().toLowerCase(),
  );
  const hasMismatch = vehicleMismatch || driverMismatch;
  const transportValid =
    vehiclePattern.test(vehicle) &&
    /^[A-Z .-]+$/i.test(driverName.trim()) &&
    /^[6-9]\d{9}$/.test(contact);

  const chooseRequest = (request: any, preserveSuccess = false) => {
    const sourceEntries = Array.isArray(request.transport_entries) && request.transport_entries.length
      ? request.transport_entries
      : request.vehicle_number && request.driver_name && request.driver_contact
        ? [{ vehicle_number: request.vehicle_number, driver_name: request.driver_name, driver_contact: request.driver_contact }]
        : [];
    const existingPasses = Array.isArray(request.gate_passes) ? [...request.gate_passes] : [];
    if (!existingPasses.length && request.gate_pass_number) {
      existingPasses.push({ vehicle_number: request.vehicle_number });
    }
    const usedVehicles = new Set(existingPasses.map((pass: any) => normalizeVehicle(pass.vehicle_number)));
    const transportEntries = sourceEntries.map((entry: any) => ({
      ...entry,
      has_gate_pass: usedVehicles.has(normalizeVehicle(entry.vehicle_number)),
    }));
    const nextIndex = transportEntries.findIndex((entry: any) => !entry.has_gate_pass);
    const nextTransport = transportEntries[nextIndex];
    setSelected({
      ...request,
      vehicle_number: nextTransport?.vehicle_number || request.vehicle_number,
      driver_name: nextTransport?.driver_name || request.driver_name,
      transport_entries: transportEntries,
    });
    setSelectedTransportIndex(nextIndex);
    setVehicleNumber(nextTransport?.vehicle_number || "");
    setDriverName(nextTransport?.driver_name || "");
    setDriverContact(nextTransport?.driver_contact || "");
    setMismatchReason("");
    if (!preserveSuccess) setSuccess(null);
    if (transportEntries.length && nextIndex < 0 && !preserveSuccess) {
      toast.error("Every assigned vehicle already has a gate pass for this dispatch.");
    }
  };
  const lookupRequest = () => {
    const requestNumber = query.trim().toLowerCase();
    if (!requestNumber) return;
    const match = requests.find(
      (request) => String(request.request_number || "").toLowerCase() === requestNumber,
    );
    if (match) chooseRequest(match);
    else if (requestNumber.includes("-") || requestNumber.length > 5)
      toast.error("Dispatch request not found", {
        description: "Enter an existing dispatch request number.",
      });
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) {
      toast.error("Select an eligible dispatch request.");
      return;
    }
    if (!eligibleStatuses.includes(selected.status)) {
      toast.error("This dispatch request is not approved.");
      return;
    }
    if (!transportValid) {
      toast.error("Enter a valid vehicle number, driver name and 10-digit Indian mobile number.");
      return;
    }
    if (hasMismatch && !mismatchReason.trim()) {
      toast.error("Enter a reason for the vehicle or driver mismatch.");
      return;
    }
    setBusy(true);
    try {
      const result = await api.createFinishedGoodsPickupGateEntry({
        request_number: selected.request_number,
        vehicle_number: vehicle,
        driver_name: driverName.trim().replace(/\s+/g, " "),
        driver_contact: contact,
      });
      setSuccess(result);
      toast.success(`Gate pass ${result.gate_pass_number} generated`);
      const refreshedRequests = await load();
      const refreshedRequest = refreshedRequests.find((request: any) => request.id === selected.id);
      if (refreshedRequest) {
        chooseRequest(refreshedRequest, true);
        setSuccess(result);
      }
      window.setTimeout(() => setEntryOpen(false), 1800);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create pickup gate entry");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell
      title="Finished Goods Pickup Entry & Exit"
      subtitle="Create pickup gate entries, generate gate passes, and securely manage finished-goods vehicle exits."
      actions={
        <div className="flex items-center gap-2">
          <Button onClick={() => setEntryOpen(true)}>
            <Plus className="mr-2 size-4" /> FG Entry
          </Button>
          <Button variant="outline" onClick={() => setExitOpen(true)}>
            <LogOut className="mr-2 size-4" /> Exit Vehicle
          </Button>
          <Button variant="outline" onClick={() => void load()}>
            <RefreshCw className="mr-2 size-4" /> Refresh
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <Dialog open={exitOpen} onOpenChange={setExitOpen}>
          <DialogContent className="w-[min(92vw,520px)] rounded-2xl">
            <DialogHeader>
              <DialogTitle>FG Pickup Vehicle Exit</DialogTitle>
              <DialogDescription>Enter or scan the original gate pass. Exit is enabled only after the pass and required documents are verified.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="fg-exit-pass">Gate Pass Number</Label>
                <div className="flex gap-2">
                  <Input id="fg-exit-pass" autoFocus className="font-mono uppercase" value={exitPass} onChange={(e) => setExitPass(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void lookupExitPass(); } }} placeholder="Scan or enter pass" />
                  <Button type="button" variant="outline" onClick={() => void lookupExitPass()}>Verify</Button>
                </div>
              </div>
              {exitDetails && (
                <Card className="grid gap-2 border bg-muted/20 p-4 text-sm sm:grid-cols-2">
                  <p><span className="text-muted-foreground">Request:</span> {exitDetails.request_number}</p>
                  <p><span className="text-muted-foreground">Status:</span> {exitDetails.status}</p>
                  <p><span className="text-muted-foreground">Vehicle:</span> {exitDetails.vehicle_number}</p>
                  <p><span className="text-muted-foreground">Driver:</span> {exitDetails.driver_name}</p>
                  <p className="sm:col-span-2"><span className="text-muted-foreground">Entry:</span> {exitDetails.entered_at ? new Date(exitDetails.entered_at).toLocaleString() : "—"}</p>
                </Card>
              )}
              {exitDetails?.fg_id && (
                <div className="space-y-2">
                  {exitDetails.status !== "READY_FOR_GATE_EXIT" && exitDetails.status !== "CLOSED" && (
                    <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                      Assembly must confirm loading before Gate Exit.
                    </p>
                  )}
                  {exitDetails.loaded_sections && exitDetails.loaded_sections.length > 0 && (
                    <div className="rounded-xl border border-border/60 bg-muted/10 p-3 text-xs space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-muted-foreground uppercase tracking-wider text-[11px]">
                          Loaded Transport Sections ({exitDetails.loaded_sections.length})
                        </span>
                        <span className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium">
                          ✓ Verified at loading dock
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {exitDetails.loaded_sections.map((s: any) => (
                          <span
                            key={s.sub_id}
                            className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-mono font-medium text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                          >
                            ✓ {s.sub_id}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {exitDetails && (
                <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={exitDocs}
                    onChange={(e) => setExitDocs(e.target.checked)}
                    className="size-4 rounded accent-primary"
                  />
                  Packing list and dispatch documents verified
                </label>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setExitOpen(false)}>Cancel</Button>
              <Button disabled={!exitDetails || !exitDocs || exitBusy || (Boolean(exitDetails?.fg_id) && exitDetails.status !== "READY_FOR_GATE_EXIT")} onClick={() => void confirmExit()}>{exitBusy ? "Recording exit…" : "Confirm Exit"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={entryOpen} onOpenChange={setEntryOpen}>
          <DialogContent className="w-[min(92vw,620px)] max-w-[620px] max-h-[90vh] overflow-y-auto rounded-2xl">
            {success && (
              <Card className="border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
                <div className="flex items-center justify-between gap-2 font-semibold">
                  <CheckCircle2 className="size-5" /> Pickup gate pass generated: {success.gate_pass_number}
                  <Button size="sm" variant="outline" onClick={() => { setExitPass(success.gate_pass_number); setExitOpen(true); }}>
                    Exit Vehicle
                  </Button>
                </div>
                <p className="mt-1 text-sm">
                  Request {success.request_number} is now {statusLabel(success.status || "INSIDE_FACILITY")}.
                </p>
              </Card>
            )}
            <Card className="border-0 p-1 shadow-none">
              <form onSubmit={submit} className="space-y-5">
        <div className="grid gap-4">
                  <div>
                    <Label htmlFor="pickup-request">Dispatch Number *</Label>
                    <Input
                      id="pickup-request"
                      value={query}
                      onChange={(e) => {
                        const value = e.target.value;
                        setQuery(value);
                        if (
                          selected &&
                          value.trim().toLowerCase() !==
                            String(selected.request_number || "").toLowerCase()
                        ) {
                          setSelected(null);
                          setSelectedTransportIndex(-1);
                          setVehicleNumber("");
                          setDriverName("");
                          setDriverContact("");
                        }
                      }}
                      onBlur={lookupRequest}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          lookupRequest();
                        }
                      }}
                      placeholder="Enter dispatch request number"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      Enter the request number and press Enter to auto-fill the details.
                    </p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <div>
                          <Label htmlFor="finished-goods">Finished goods</Label>
                          <Input
                            id="finished-goods"
                            readOnly
                            value={selected ? `${selected.product_name || "—"} · ${selected.quantity || 0} ${selected.uom || "PCS"}` : ""}
                            placeholder="Auto-filled from dispatch"
                          />
                        </div>
                        <div>
                          <Label htmlFor="expected-pickup">Expected pickup</Label>
                          <Input
                            id="expected-pickup"
                            readOnly
                            value={selected?.expected_pickup_date || ""}
                            placeholder="Auto-filled from dispatch"
                          />
                        </div>
                    </div>
                    <div className="hidden">
                      {filteredRequests
                        .filter((r) => !r.gate_pass_number && eligibleStatuses.includes(r.status))
                        .map((request) => (
                          <button
                            type="button"
                            key={request.id}
                            onClick={() => {
                              setQuery(request.request_number);
                              chooseRequest(request);
                            }}
                            className={`block w-full border-b p-3 text-left last:border-0 hover:bg-muted/50 ${selected?.id === request.id ? "bg-primary/10" : ""}`}
                          >
                            <span className="font-mono font-semibold text-primary">
                              {request.request_number}
                            </span>
                            <span className="ml-2 text-sm">
                              {request.supplier_name || "Supplier not specified"}
                            </span>
                            <span className="mt-1 block text-xs text-muted-foreground">
                              {request.product_name} · {request.quantity} {request.uom} ·{" "}
                              {request.vehicle_number || "Vehicle pending"} ·{" "}
                              {statusLabel(request.status)}
                            </span>
                          </button>
                        ))}
                      {!loading &&
                        filteredRequests.filter(
                          (r) => !r.gate_pass_number && eligibleStatuses.includes(r.status),
                        ).length === 0 && (
                          <p className="p-4 text-sm text-muted-foreground">
                            No eligible dispatch requests found.
                          </p>
                        )}
                    </div>
                  </div>
                  <div className="hidden">
                    <h2 className="font-bold">Selected request summary</h2>
                    {selected ? (
                      <div className="mt-3 grid gap-2 sm:grid-cols-2 [&>p]:rounded-lg [&>p]:border [&>p]:bg-background [&>p]:p-2.5">
                        <p>
                          <span className="text-muted-foreground">Supplier:</span>{" "}
                          {selected.supplier_name || "—"}
                        </p>
                        <p>
                          <span className="text-muted-foreground">Finished goods:</span>{" "}
                          {selected.product_name} · {selected.quantity} {selected.uom}
                        </p>
                        <p>
                          <span className="text-muted-foreground">Expected pickup:</span>{" "}
                          {selected.expected_pickup_date || "—"}
                        </p>
                        <p>
                          <span className="text-muted-foreground">Expected vehicle:</span>{" "}
                          {selected.vehicle_number || "—"}
                        </p>
                        <p>
                          <span className="text-muted-foreground">Expected driver:</span>{" "}
                          {selected.driver_name || "—"}
                        </p>
                        <p>
                          <span className="text-muted-foreground">Approval:</span>{" "}
                          {statusLabel(selected.status)}
                        </p>
                        <p>
                          <span className="text-muted-foreground">Gate pass:</span>{" "}
                          {selected.gate_pass_number || "None"}
                        </p>
                      </div>
                    ) : (
                      <p className="mt-3 text-muted-foreground">
                        Choose an eligible request to verify its details.
                      </p>
                    )}
                  </div>
                </div>
                {selected?.transport_entries?.length > 1 && (
                  <div>
                    <Label htmlFor="pickup-transport">Assigned vehicle and driver</Label>
                    <select
                      id="pickup-transport"
                      value={selectedTransportIndex}
                      onChange={(event) => {
                        const index = Number(event.target.value);
                        const entry = selected.transport_entries[index];
                        if (!entry || entry.has_gate_pass) return;
                        setSelectedTransportIndex(index);
                        setSelected({ ...selected, vehicle_number: entry.vehicle_number, driver_name: entry.driver_name });
                        setVehicleNumber(entry.vehicle_number || "");
                        setDriverName(entry.driver_name || "");
                        setDriverContact(entry.driver_contact || "");
                      }}
                      className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                    >
                      {selectedTransportIndex < 0 && (
                        <option value={-1}>No assigned vehicle remains available</option>
                      )}
                      {selected.transport_entries.map((entry: any, index: number) => (
                        <option key={`${entry.vehicle_number}-${index}`} value={index} disabled={entry.has_gate_pass}>
                          {entry.vehicle_number} · {entry.driver_name}
                          {entry.has_gate_pass ? " · Gate pass generated" : " · Available"}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-muted-foreground">
                      The next supplier-assigned truck without a gate pass is selected automatically.
                    </p>
                  </div>
                )}
                {selected?.transport_entries?.length > 0 && selected.transport_entries.every((entry: any) => entry.has_gate_pass) && (
                  <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
                    Every assigned vehicle already has a gate pass for this dispatch.
                  </p>
                )}
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <Label htmlFor="actual-vehicle">Actual vehicle number *</Label>
                    <Input
                      id="actual-vehicle"
                      readOnly={Boolean(selected)}
                      value={vehicleNumber}
                      onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())}
                      aria-invalid={Boolean(vehicleNumber && !vehiclePattern.test(vehicle))}
                      placeholder="Auto-filled from dispatch request"
                    />
                    {vehicleNumber && !vehiclePattern.test(vehicle) && (
                      <p className="mt-1 text-xs text-destructive">
                        Enter a valid Indian vehicle number.
                      </p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="pickup-driver">Driver name *</Label>
                    <Input
                      id="pickup-driver"
                      readOnly={Boolean(selected)}
                      value={driverName}
                      onChange={(e) => setDriverName(e.target.value)}
                      placeholder="Auto-filled from dispatch request"
                    />
                  </div>
                  <div>
                    <Label htmlFor="pickup-contact">Driver contact *</Label>
                    <Input
                      id="pickup-contact"
                      readOnly={Boolean(selected)}
                      type="tel"
                      inputMode="numeric"
                      value={driverContact}
                      onChange={(e) =>
                        setDriverContact(e.target.value.replace(/\D/g, "").slice(0, 10))
                      }
                      aria-invalid={Boolean(driverContact && !/^[6-9]\d{9}$/.test(contact))}
                      placeholder="Auto-filled from dispatch request"
                    />
                  </div>
                </div>
                {hasMismatch && (
                  <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                    <div className="flex items-center gap-2 font-semibold">
                      <AlertTriangle className="size-4" /> Details differ from the dispatch request
                    </div>
                    <p className="mt-1">
                      Expected: {selected?.vehicle_number || "—"} / {selected?.driver_name || "—"} ·
                      Actual: {vehicle || "—"} / {driverName || "—"}
                    </p>
                    <Input
                      className="mt-2 bg-white"
                      value={mismatchReason}
                      onChange={(e) => setMismatchReason(e.target.value)}
                      placeholder="Mismatch reason required"
                      aria-label="Mismatch reason"
                    />
                  </div>
                )}
                <Button type="submit" disabled={busy || !selected || !transportValid || selectedTransportIndex < 0}>
                  {busy ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" /> Generating...
                    </>
                  ) : (
                    "Generate Pickup Gate Pass"
                  )}
                </Button>
              </form>
            </Card>
          </DialogContent>
        </Dialog>
        {success && (
          <Card className="border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
            <div className="flex items-center gap-2 font-semibold">
              <CheckCircle2 className="size-5" /> Pickup gate pass generated:{" "}
              {success.gate_pass_number}
            </div>
            <p className="mt-1 text-sm">
              Request {success.request_number} is now{" "}
              {statusLabel(success.status || "INSIDE_FACILITY")}.
            </p>
          </Card>
        )}
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
            <h2 className="font-bold">Pickup Requests</h2>
            <div className="flex gap-2">
              <Input
                className="w-56"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search requests…"
                aria-label="Search pickup requests"
              />
              <select
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="Filter pickup request status"
              >
                <option value="ALL">All statuses</option>
                {[
                  "ALLOCATED",
                  "APPROVED",
                  "INSIDE_FACILITY",
                  "ON_HOLD",
                  "DISPATCHED",
                  "CANCELLED",
                ].map((status) => (
                  <option key={status} value={status}>
                    {statusLabel(status)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {loading ? (
            <div className="p-8 text-center">
              <Loader2 className="mx-auto size-6 animate-spin" />
            </div>
          ) : error ? (
            <div className="p-8 text-center text-destructive">
              {error}
              <br />
              <Button className="mt-2" variant="outline" onClick={() => void load()}>
                Retry
              </Button>
            </div>
          ) : filteredRequests.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <p>No pickup requests are available.</p>
              <p className="text-sm">Approved finished-goods dispatch requests will appear here.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm [&_th:nth-child(2)]:hidden [&_td:nth-child(2)]:hidden">
                <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    {[
                      "Request Number",
                      "Supplier",
                      "Finished Goods",
                      "Quantity",
                      "Expected Pickup",
                      "Vehicle",
                      "Driver",
                      "Status",
                      "Gate Pass",
                    ].map((heading) => (
                      <th key={heading} className="whitespace-nowrap px-4 py-3">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredRequests.map((request) => (
                    <tr key={request.id}>
                      <td className="px-4 py-3 font-mono font-semibold text-primary">
                        {request.request_number}
                      </td>
                      <td className="px-4 py-3">{request.supplier_name || "—"}</td>
                      <td className="px-4 py-3">{request.product_name || "—"}</td>
                      <td className="px-4 py-3">
                        {request.quantity} {request.uom}
                      </td>
                      <td className="px-4 py-3">{request.expected_pickup_date || "—"}</td>
                      <td className="px-4 py-3">{request.vehicle_number || "—"}</td>
                      <td className="px-4 py-3">{request.driver_name || "—"}</td>
                      <td className="px-4 py-3">
                        {statusLabel(request.gate_pass_status || request.status)}
                      </td>
                      <td className="px-4 py-3">{request.gate_pass_number || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
