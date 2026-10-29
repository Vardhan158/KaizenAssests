import { InformationTooltip } from "@/components/ui/information-tooltip";
import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";
import { Eye, Loader2, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { AppShell, StatusBadge } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api-client";
import {
  localDateInput,
  pickupDateError,
  isValidAsnDriverMobileNumber,
  isValidAsnDriverName,
  isValidAsnVehicleNumber,
  normalizeAsnVehicleNumber,
  parsePositiveNumber,
  requiredText,
  sanitizeAsnDriverName,
  sanitizeMobileNumber,
  sanitizeVehicleNumber,
} from "@/lib/input-validation";
import { toast } from "sonner";

type TransportEntry = {
  id: string;
  vehicleNumber: string;
  driverName: string;
  driverContact: string;
  touched: boolean;
};

let nextTransportEntryId = 0;

function createTransportEntry(): TransportEntry {
  nextTransportEntryId += 1;
  return {
    id: `transport-${nextTransportEntryId}`,
    vehicleNumber: "",
    driverName: "",
    driverContact: "",
    touched: false,
  };
}

export const Route = createFileRoute("/supplier/dispatch")({
  component: SupplierDispatchPage,
});

function SupplierDispatchPage() {
  const [open, setOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [transportEntries, setTransportEntries] = React.useState([createTransportEntry()]);
  const [expectedPickupDate, setExpectedPickupDate] = React.useState("");
  const [pickupDateTouched, setPickupDateTouched] = React.useState(false);
  const [finishedGoods, setFinishedGoods] = React.useState<
    Array<{ id: string; mainId: string; code: string; name: string; quantity: number; uom: string; eligible: boolean; reason?: string }>
  >([]);
  const [finishedGoodsLoading, setFinishedGoodsLoading] = React.useState(false);
  const [finishedGoodsError, setFinishedGoodsError] = React.useState<string>();
  const [goods, setGoods] = React.useState([{ name: "", quantity: "", custom: false }]);
  const [dispatchHistory, setDispatchHistory] = React.useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = React.useState(true);
  const [historyError, setHistoryError] = React.useState<string>();
  const [selectedDispatch, setSelectedDispatch] = React.useState<any | null>(null);
  const dispatchDetailsKey = "kaizen-supplier-dispatch-details";

  const loadAssemblyFinishedGoods = React.useCallback(async () => {
    setFinishedGoodsLoading(true);
    setFinishedGoodsError(undefined);
    try {
      const rows = await api.getSupplierPickupFinishedGoods();
      if (!Array.isArray(rows)) {
        throw new Error("Finished goods response was invalid.");
      }
      const available = rows.map((row: any) => ({
        id: row.id, mainId: row.main_fg_id || row.batch_number || row.id, code: row.product_code,
        name: `${row.product_name} - ${row.main_fg_id}`,
        quantity: Number(row.remaining_sections), uom: row.uom, eligible: row.dispatch_eligible !== false, reason: row.eligibility_reason,
      }));
      setFinishedGoods(available);
    } catch (error) {
      setFinishedGoods([]);
      const message =
        error instanceof Error ? error.message : "Unable to load finished goods from Assembly";
      setFinishedGoodsError(message);
      toast.error("Could not load finished goods", { description: message });
    } finally {
      setFinishedGoodsLoading(false);
    }
  }, []);

  const loadDispatchHistory = React.useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(undefined);
    try {
      const response = await api.getSupplierFinishedGoodsDispatchRequests();
      if (!Array.isArray(response)) {
        throw new Error("Dispatch history response was invalid.");
      }
      setDispatchHistory(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load dispatch history";
      setHistoryError(message);
      toast.error("Could not load dispatch history", {
        description: message,
      });
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadDispatchHistory();
  }, [loadDispatchHistory]);

  React.useEffect(() => {
    void loadAssemblyFinishedGoods();
  }, [loadAssemblyFinishedGoods]);

  const submitDispatch = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const names = goods
      .map((item) => requiredText(item.name))
      .filter((value): value is string => Boolean(value));
    const firstQuantity = parsePositiveNumber(goods[0]?.quantity);
    const validTransportEntries = transportEntries.map((entry) => ({
      vehicle_number: normalizeAsnVehicleNumber(entry.vehicleNumber),
      driver_name: entry.driverName.trim().replace(/\s+/g, " "),
      driver_contact: entry.driverContact.trim(),
    }));
    const firstTransport = validTransportEntries[0];
    if (!names.length || firstQuantity === null || !firstTransport) {
      toast.error("Enter a finished good, positive quantity, vehicle, driver, and contact");
      return;
    }
    if (
      transportEntries.some(
        (entry, index) =>
          !isValidAsnVehicleNumber(entry.vehicleNumber) ||
          !isValidAsnDriverName(entry.driverName) ||
          !isValidAsnDriverMobileNumber(entry.driverContact) ||
          !validTransportEntries[index]?.vehicle_number ||
          !validTransportEntries[index]?.driver_name ||
          !validTransportEntries[index]?.driver_contact,
      )
    ) {
      setTransportEntries((entries) => entries.map((entry) => ({ ...entry, touched: true })));
      toast.error(
        "Enter valid Indian vehicle numbers, driver names without digits, and 10-digit Indian mobile numbers for every vehicle and driver.",
      );
      return;
    }
    if (pickupDateError(expectedPickupDate)) {
      setPickupDateTouched(true);
      document.getElementById("pickup-date")?.focus();
      return;
    }
    const selectedGood = finishedGoods.find(
      (good) => good.name === names[0] || good.code === names[0],
    );
    if (!selectedGood) { toast.error("Select a QC-approved finished product"); return; }
    if (!selectedGood.eligible) { toast.error(selectedGood.reason || "This FG is not ready for section dispatch"); return; }
    if (selectedGood && firstQuantity > selectedGood.quantity) {
      toast.error("Quantity exceeds available finished goods stock");
      return;
    }
    const vehicle = firstTransport.vehicle_number;
    const driver = firstTransport.driver_name;
    const contact = firstTransport.driver_contact;
    setSubmitting(true);
    try {
      const createdDispatch = await api.createSupplierFinishedGoodsDispatchRequest({
        finished_goods_id: selectedGood?.id,
        product_code: selectedGood?.code || names[0] || "FINISHED-GOOD",
        product_name: names[0] || "Finished Good",
        quantity: firstQuantity,
        vehicle_number: vehicle,
        driver_name: driver,
        driver_contact: contact,
        transport_entries: validTransportEntries,
        expected_pickup_date: expectedPickupDate,
        /* request metadata is persisted by the supplier request endpoint */
        /* legacy dispatch fields below are intentionally ignored */
        order_number: `SUP-DISPATCH-${Date.now()}`,
        customer_name: "Warehouse",
        dispatch_type: "Finished Goods",
        warehouse_id: "WH-01",
        contact_person: driver,
        contact_phone: contact,
        transporter: vehicle,
        notes: validTransportEntries
          .map(
            (entry) =>
              `Vehicle: ${entry.vehicle_number}\nDriver: ${entry.driver_name}\nDriver contact: ${entry.driver_contact}`,
          )
          .join("\n\n"),
        items: goods.map((item) => ({
          material_code: item.name.trim().toUpperCase().replace(/\s+/g, "-") || "FINISHED-GOOD",
          material_name: item.name.trim(),
          quantity_ordered: parsePositiveNumber(item.quantity) ?? 0,
          quantity_available: parsePositiveNumber(item.quantity) ?? 0,
          quantity_pending: parsePositiveNumber(item.quantity) ?? 0,
          uom: "PCS",
        })),
      } as any);
      const dispatchKey = String(
        createdDispatch?.dispatch_number ||
          createdDispatch?.order_number ||
          createdDispatch?.id ||
          "",
      );
      if (dispatchKey) {
        const savedDetails = JSON.parse(window.localStorage.getItem(dispatchDetailsKey) || "{}");
        savedDetails[dispatchKey] = {
          vehicle_number: vehicle,
          driver_name: driver,
          driver_contact: contact,
          transport_entries: validTransportEntries,
        };
        window.localStorage.setItem(dispatchDetailsKey, JSON.stringify(savedDetails));
      }
      toast.success("Vehicle registered for FG pickup", { description: "Complete FG Gate Entry first. Assembly loads after entry, and Gate Exit uses the same Gate Pass." });
      setOpen(false);
      setTransportEntries([createTransportEntry()]);
      setGoods([{ name: "", quantity: "", custom: false }]);
      setExpectedPickupDate("");
      void loadDispatchHistory();
    } catch (error) {
      toast.error("Could not create dispatch", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppShell
      title="Supplier Dispatch"
      subtitle="Prepare and submit advance shipment notifications for warehouse arrival."
      actions={
        <Button
          type="button"
          className="h-10 rounded-lg"
          onClick={() => {
            void loadAssemblyFinishedGoods();
            setPickupDateTouched(false);
            setTransportEntries([createTransportEntry()]);
            setOpen(true);
          }}
        >
          <Plus className="mr-2 size-4" /> Create Dispatch
        </Button>
      }
    >
      <Card className="overflow-hidden rounded-xl border-border bg-card shadow-sm">
        <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Dispatch history</CardTitle>
            <CardDescription>
              Track dispatches created by the supplier.
              {!historyLoading && !historyError && (
                <>
                  {" "}
                  {dispatchHistory.length} dispatch{dispatchHistory.length === 1 ? "" : "es"}.
                </>
              )}
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-10 rounded-lg"
            disabled={historyLoading}
            onClick={() => void loadDispatchHistory()}
          >
            {historyLoading ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 size-4" />
            )}
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {historyLoading ? (
            <div
              className="flex min-h-48 items-center justify-center text-sm text-muted-foreground"
              role="status"
            >
              <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
              Loading dispatch history…
            </div>
          ) : historyError ? (
            <div className="p-6 text-center sm:p-8" role="alert">
              <p className="font-medium text-destructive">Dispatch history could not be loaded.</p>
              <p className="mt-2 text-sm text-muted-foreground">{historyError}</p>
              <Button
                type="button"
                className="mt-4 h-10 rounded-lg"
                onClick={() => void loadDispatchHistory()}
              >
                Try again
              </Button>
            </div>
          ) : dispatchHistory.length === 0 ? (
            <div className="p-8 text-center">
              <h3 className="text-base font-semibold">No dispatches yet</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Dispatches you create will appear here.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-y bg-muted/30 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="whitespace-nowrap px-5 py-3">Dispatch</th>
                    <th className="whitespace-nowrap px-5 py-3">Finished goods</th>
                    <th className="whitespace-nowrap px-5 py-3">Vehicle</th>
                    <th className="whitespace-nowrap px-5 py-3">Driver</th>
                    <th className="whitespace-nowrap px-5 py-3">Status</th>
                    <th className="whitespace-nowrap px-5 py-3">Created</th>
                    <th className="whitespace-nowrap px-5 py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {dispatchHistory.map((dispatch) => (
                    <tr key={dispatch.id} className="transition-colors hover:bg-muted/20">
                      <td className="px-5 py-3 font-mono font-semibold text-primary">
                        {dispatch.dispatch_number || dispatch.order_number || "—"}
                      </td>
                      <td className="px-5 py-3">
                        {(dispatch.items || [])
                          .map(
                            (item: any) =>
                              `${item.material_name || item.material_code || "Finished good"} (${item.quantity_ordered ?? "—"}${item.uom ? ` ${item.uom}` : ""})`,
                          )
                          .join(", ") || "—"}
                      </td>
                      <td className="px-5 py-3">
                        {dispatch.vehicle_number || dispatch.transporter || "—"}
                      </td>
                      <td className="px-5 py-3">
                        {dispatch.driver_name || dispatch.contact_person || "—"}
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge status={dispatch.status || "—"} />
                      </td>
                      <td className="px-5 py-3">
                        {dispatch.created_at
                          ? new Date(dispatch.created_at).toLocaleDateString()
                          : "—"}
                      </td>
                      <td className="px-5 py-3">
                        <Button
                          type="button"
                          variant="outline"
                          className="h-9 rounded-lg"
                          onClick={() => setSelectedDispatch(dispatch)}
                        >
                          <Eye className="mr-1.5 size-4" />
                          View
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Create Dispatch</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitDispatch} className="space-y-5" noValidate>
            <div className="space-y-1.5">
              <span className="inline-flex items-center">
                <Label htmlFor="pickup-date">Expected pickup date *</Label>
                <InformationTooltip help="pickupDate" />
              </span>
              <Input
                id="pickup-date"
                className="h-10 rounded-lg"
                required
                type="date"
                min={localDateInput()}
                max="9999-12-31"
                value={expectedPickupDate}
                onChange={(e) => setExpectedPickupDate(e.target.value)}
                onBlur={() => setPickupDateTouched(true)}
                aria-invalid={pickupDateTouched && !!pickupDateError(expectedPickupDate)}
                aria-describedby="pickup-date-error"
              />
              {pickupDateTouched && pickupDateError(expectedPickupDate) && (
                <p id="pickup-date-error" role="alert" className="text-xs text-rose-600">
                  {pickupDateError(expectedPickupDate)}
                </p>
              )}
            </div>
            <div className="space-y-3">
              {transportEntries.map((entry, index) => {
                const vehicleValid = isValidAsnVehicleNumber(entry.vehicleNumber);
                const driverValid = isValidAsnDriverName(entry.driverName);
                const contactValid = isValidAsnDriverMobileNumber(entry.driverContact);

                return (
                  <div
                    key={entry.id}
                    className={
                      transportEntries.length > 1
                        ? "space-y-3 rounded-lg border border-border p-3"
                        : "space-y-3"
                    }
                  >
                    {transportEntries.length > 1 && (
                      <div className="flex items-center justify-between border-b border-border pb-2">
                        <span className="text-sm font-semibold">
                          Vehicle &amp; Driver #{index + 1}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`Remove vehicle and driver ${index + 1}`}
                          onClick={() =>
                            setTransportEntries((entries) =>
                              entries.filter((candidate) => candidate.id !== entry.id),
                            )
                          }
                        >
                          <Trash2 className="mr-1.5 size-4" />
                          Remove
                        </Button>
                      </div>
                    )}
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label htmlFor={`vehicle-number-${entry.id}`}>Vehicle number *</Label>
                        <Input
                          id={`vehicle-number-${entry.id}`}
                          className="h-10 rounded-lg"
                          required
                          placeholder="e.g. KA01AB1234"
                          value={entry.vehicleNumber}
                          aria-invalid={entry.touched && !vehicleValid}
                          aria-describedby={`vehicle-number-${entry.id}-error`}
                          onChange={(e) =>
                            setTransportEntries((entries) =>
                              entries.map((candidate) =>
                                candidate.id === entry.id
                                  ? {
                                      ...candidate,
                                      vehicleNumber: sanitizeVehicleNumber(
                                        e.target.value,
                                      ).toUpperCase(),
                                    }
                                  : candidate,
                              ),
                            )
                          }
                          onBlur={() =>
                            setTransportEntries((entries) =>
                              entries.map((candidate) =>
                                candidate.id === entry.id
                                  ? {
                                      ...candidate,
                                      vehicleNumber: normalizeAsnVehicleNumber(
                                        candidate.vehicleNumber,
                                      ),
                                      touched: true,
                                    }
                                  : candidate,
                              ),
                            )
                          }
                        />
                        {entry.touched && !vehicleValid && (
                          <p
                            id={`vehicle-number-${entry.id}-error`}
                            role="alert"
                            className="text-xs text-rose-600"
                          >
                            Enter a valid registration, such as KA01AB1234 or 22BH1234AA.
                          </p>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`driver-name-${entry.id}`}>Driver name *</Label>
                        <Input
                          id={`driver-name-${entry.id}`}
                          className="h-10 rounded-lg"
                          required
                          placeholder="Enter driver name"
                          value={entry.driverName}
                          aria-invalid={entry.touched && !driverValid}
                          aria-describedby={`driver-name-${entry.id}-error`}
                          onChange={(e) =>
                            setTransportEntries((entries) =>
                              entries.map((candidate) =>
                                candidate.id === entry.id
                                  ? {
                                      ...candidate,
                                      driverName: sanitizeAsnDriverName(e.target.value),
                                    }
                                  : candidate,
                              ),
                            )
                          }
                          onBlur={() =>
                            setTransportEntries((entries) =>
                              entries.map((candidate) =>
                                candidate.id === entry.id
                                  ? {
                                      ...candidate,
                                      driverName: candidate.driverName.trim().replace(/ +/g, " "),
                                      touched: true,
                                    }
                                  : candidate,
                              ),
                            )
                          }
                        />
                        {entry.touched && !driverValid && (
                          <p
                            id={`driver-name-${entry.id}-error`}
                            role="alert"
                            className="text-xs text-rose-600"
                          >
                            Enter a 2–100 character driver name using letters and standard name
                            punctuation.
                          </p>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`driver-contact-${entry.id}`}>Driver contact *</Label>
                        <Input
                          id={`driver-contact-${entry.id}`}
                          className="h-10 rounded-lg"
                          required
                          type="tel"
                          inputMode="numeric"
                          maxLength={10}
                          placeholder="10-digit mobile number"
                          value={entry.driverContact}
                          aria-invalid={entry.touched && !contactValid}
                          aria-describedby={`driver-contact-${entry.id}-error`}
                          onChange={(e) =>
                            setTransportEntries((entries) =>
                              entries.map((candidate) =>
                                candidate.id === entry.id
                                  ? {
                                      ...candidate,
                                      driverContact: sanitizeMobileNumber(e.target.value),
                                    }
                                  : candidate,
                              ),
                            )
                          }
                          onBlur={() =>
                            setTransportEntries((entries) =>
                              entries.map((candidate) =>
                                candidate.id === entry.id
                                  ? { ...candidate, touched: true }
                                  : candidate,
                              ),
                            )
                          }
                        />
                        {entry.touched && !contactValid && (
                          <p
                            id={`driver-contact-${entry.id}-error`}
                            role="alert"
                            className="text-xs text-rose-600"
                          >
                            Enter a 10-digit Indian mobile number starting with 6–9.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-lg"
                onClick={() =>
                  setTransportEntries((entries) => [...entries, createTransportEntry()])
                }
              >
                <Plus className="mr-1.5 size-4" />
                Add Vehicle &amp; Driver
              </Button>
            </div>
            <div className="space-y-3">
              <div>
                <h3 className="font-semibold">Finished goods</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  All finished goods are listed. Products awaiting QC or transport sections are shown but cannot be dispatched yet. Assembly selects the sections for loading.
                </p>
              </div>
              {finishedGoodsError && (
                <div
                  className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 sm:flex-row sm:items-center sm:justify-between"
                  role="alert"
                >
                  <p className="text-sm text-destructive">
                    Finished goods could not be loaded. {finishedGoodsError}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 rounded-lg"
                    disabled={finishedGoodsLoading}
                    onClick={() => void loadAssemblyFinishedGoods()}
                  >
                    {finishedGoodsLoading && <Loader2 className="mr-2 size-4 animate-spin" />}
                    Retry
                  </Button>
                </div>
              )}
              {!finishedGoodsLoading && !finishedGoodsError && finishedGoods.length === 0 && (
                <p className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
                  No finished goods records are currently available in Assembly.
                </p>
              )}
              <p className="text-sm">{(() => { const selected = finishedGoods.find(g => g.name === goods[0]?.name || g.code === goods[0]?.name); return selected ? `FG ID: ${selected.mainId} - Remaining sections: ${selected.quantity}` : "Select a finished product to see its FG ID and remaining sections."; })()}</p>
              {goods.map((item, index) => (

                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_auto]" key={index}>
                  <div className="space-y-1.5">
                    <Label htmlFor={`finished-good-${index}`}>Finished good *</Label>
                    <select
                      id={`finished-good-${index}`}
                      required
                      disabled={finishedGoodsLoading || finishedGoods.length === 0}
                      className="h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                      value={item.name}
                      onChange={(e) =>
                        setGoods((rows) =>
                          rows.map((row, i) =>
                            i === index ? { ...row, name: e.target.value, quantity: "1", custom: false } : row,
                          ),
                        )
                      }
                    >
                      <option value="">
                        {finishedGoodsLoading
                          ? "Loading finished goods…"
                          : finishedGoodsError
                            ? "Finished goods unavailable"
                            : finishedGoods.length
                              ? "Select a finished good"
                              : "No finished goods available"}
                      </option>
                      {finishedGoods.map((good) => (
                        <option key={good.id} value={good.name} disabled={!good.eligible}>
                          {good.name} - {good.eligible ? `${good.quantity} sections available` : good.reason || "Not ready for dispatch"}
                        </option>
                      ))}
                    </select>
                  </div>
                  {goods.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="mt-auto rounded-lg"
                      aria-label={`Remove finished good ${index + 1}`}
                      onClick={() => setGoods((rows) => rows.filter((_, i) => i !== index))}
                    >
                      <X className="size-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
            <div className="flex flex-col-reverse justify-end gap-2 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                className="h-10 rounded-lg"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="h-10 rounded-lg"
                disabled={
                  submitting ||
                  finishedGoodsLoading ||
                  finishedGoods.length === 0 ||
                  !!pickupDateError(expectedPickupDate)
                }
              >
                {submitting && <Loader2 className="mr-2 size-4 animate-spin" />}
                {submitting ? "Creating…" : "Create Dispatch"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(selectedDispatch)}
        onOpenChange={(value) => !value && setSelectedDispatch(null)}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Dispatch details</DialogTitle>
          </DialogHeader>
          {selectedDispatch && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-muted/20 p-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-muted-foreground">Dispatch number</p>
                  <p className="font-mono font-semibold">
                    {selectedDispatch.dispatch_number || selectedDispatch.order_number || "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <StatusBadge status={selectedDispatch.status || "—"} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Vehicle number</p>
                  <p>{selectedDispatch.vehicle_number || selectedDispatch.transporter || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Driver name</p>
                  <p>{selectedDispatch.driver_name || selectedDispatch.contact_person || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Driver contact</p>
                  <p>{selectedDispatch.driver_contact || selectedDispatch.contact_phone || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Created</p>
                  <p>
                    {selectedDispatch.created_at
                      ? new Date(selectedDispatch.created_at).toLocaleString()
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Expected pickup</p>
                  <p>
                    {selectedDispatch.expected_pickup_date
                      ? new Date(selectedDispatch.expected_pickup_date).toLocaleDateString()
                      : "—"}
                  </p>
                </div>
              </div>
              {(selectedDispatch.transport_entries || []).length > 1 && (
                <div>
                  <h3 className="mb-2 font-semibold">Assigned vehicles and drivers</h3>
                  <div className="space-y-2">
                    {selectedDispatch.transport_entries.map((entry: any, index: number) => (
                      <div
                        key={`${entry.vehicle_number}-${index}`}
                        className="rounded-lg border border-border p-3"
                      >
                        <p className="font-medium">
                          {entry.vehicle_number} · {entry.driver_name}
                        </p>
                        <p className="text-xs text-muted-foreground">{entry.driver_contact}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <h3 className="mb-2 font-semibold">Finished goods</h3>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full min-w-[420px] text-left text-sm">
                    <thead className="bg-muted/30 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">Material</th>
                        <th className="px-3 py-2 text-right">Quantity</th>
                        <th className="px-3 py-2">UOM</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {(selectedDispatch.items || []).map((item: any, index: number) => (
                        <tr key={item.id || index}>
                          <td className="px-3 py-2">
                            {item.material_name || item.material_code || "—"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {item.quantity_ordered ?? "—"}
                          </td>
                          <td className="px-3 py-2">{item.uom || "—"}</td>
                        </tr>
                      ))}
                      {!selectedDispatch.items?.length && (
                        <tr>
                          <td colSpan={3} className="px-3 py-4 text-center text-muted-foreground">
                            No finished goods listed for this dispatch.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
