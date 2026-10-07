import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Boxes, Eye, Loader2, RefreshCw, ShieldCheck, Truck, Warehouse } from "lucide-react";
import { AppShell, StatusBadge } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api-client";

export const Route = createFileRoute("/vehicle-queue")({
  head: () => ({ meta: [{ title: "Inbound Arrivals · KaizenX" }] }),
  component: InboundArrivals,
});

type Arrival = {
  id: string;
  gate_entry_number: string;
  asn_id: string;
  asn_number: string;
  po_number: string;
  supplier_name: string;
  vehicle_number: string;
  driver_name: string;
  driver_contact?: string | null;
  arrival_time: string;
  expected_arrival_at?: string | null;
  status: string;
  exited_at?: string | null;
  exited_by?: string | null;
  assigned_dock_id?: string | null;
  po_id?: string | null;
  assigned_by?: string | null;
  assigned_at?: string | null;
  movement_started_by?: string | null;
  movement_started_at?: string | null;
  dock_checked_in_by?: string | null;
  dock_arrival_at?: string | null;
  shipment: {
    transporter?: string;
    number_of_packages?: number;
    package_type?: string;
    shipping_method?: string;
  };
  expected_materials: Array<{
    item_code: string;
    material_name?: string;
    quantity: number;
    uom?: string;
  }>;
};

type Dock = {
  id: string;
  zone: string;
  type: string;
  status: "AVAILABLE" | "OCCUPIED";
  vehicle_number?: string;
};

function InboundArrivals() {
  const [arrivals, setArrivals] = useState<Arrival[]>([]);
  const [docks, setDocks] = useState<Dock[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selectedDock, setSelectedDock] = useState<Record<string, string>>({});
  const [assigning, setAssigning] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [arrivalRows, dockRows] = await Promise.all([api.getInboundArrivals(), api.getDocks()]);
      setArrivals(arrivalRows);
      setDocks(dockRows);
    } catch (error) {
      if (!quiet)
        toast.error("Unable to load inbound arrivals", {
          description: error instanceof Error ? error.message : undefined,
        });
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function assignDock(arrival: Arrival) {
    const dockId = selectedDock[arrival.id];
    if (!dockId) {
      toast.error("Select an available dock");
      return;
    }
    setAssigning(arrival.id);
    try {
      await api.assignDock(arrival.id, dockId);
      toast.success(`${dockId} assigned`, {
        description: `${arrival.vehicle_number} can proceed to the dock.`,
      });
      await load(true);
    } catch (error) {
      toast.error("Dock assignment failed", {
        description: error instanceof Error ? error.message : undefined,
      });
      await load(true);
    } finally {
      setAssigning(null);
    }
  }

  async function startMovement(arrival: Arrival) {
    setAssigning(arrival.id);
    try {
      await api.startDockMovement(arrival.id);
      toast.success("Vehicle instructed to move", {
        description: `${arrival.vehicle_number} is moving to ${arrival.assigned_dock_id}.`,
      });
      await load(true);
    } catch (error) {
      toast.error("Unable to start dock movement", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setAssigning(null);
    }
  }

  async function confirmDockArrival(arrival: Arrival) {
    setAssigning(arrival.id);
    try {
      await api.confirmDockCheckIn(arrival.id);
      toast.success("Vehicle arrived", {
        description: `${arrival.vehicle_number} checked in at ${arrival.assigned_dock_id}.`,
      });
      await load(true);
    } catch (error) {
      toast.error("Dock check-in failed", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setAssigning(null);
    }
  }

  const isEligibleForInboundExit = (statusStr: string) => {
    const upper = (statusStr || "").toUpperCase().trim();
    return [
      "RECEIVING_COMPLETED",
      "COMPLETED",
      "RELEASED",
      "DOCK_RELEASED",
      "GRN_POSTED",
      "QUALITY_PASSED",
      "UNLOADED",
    ].includes(upper);
  };

  async function approveGateExit(arrival: Arrival) {
    const vehName = arrival.vehicle_number || "this vehicle";
    if (!confirm(`Confirm gate exit approval for ${vehName}? Confirm that vehicle has completed unloading/receiving and is cleared to leave.`)) return;
    setAssigning(arrival.id);
    try {
      const updated = await api.markInboundVehicleExited(arrival.id);
      toast.success(`Gate exit approved for ${vehName}`, {
        description: `Status updated to VEHICLE_EXITED by ${updated.exited_by || "Security"}.`,
      });
      await load(true);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("gate-entries:refresh"));
      }
    } catch (error: any) {
      toast.error("Gate exit approval failed", {
        description: error?.message || "Ensure receiving/unloading is complete before approving vehicle exit.",
      });
    } finally {
      setAssigning(null);
    }
  }

  return (
    <AppShell
      title="Inbound arrivals"
      subtitle="Approved gate entries awaiting warehouse dock assignment"
      actions={
        <Button variant="outline" className="rounded-xl" onClick={() => void load()}>
          <RefreshCw className="size-4" /> Refresh
        </Button>
      }
    >
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Summary label="Arrivals in queue" value={arrivals.length} />
        <Summary
          label="Awaiting dock"
          value={arrivals.filter((a) => a.status === "AWAITING_DOCK").length}
        />
        <Summary
          label="Moving to dock"
          value={arrivals.filter((a) => a.status === "MOVING_TO_DOCK").length}
        />
        <Summary
          label="Available docks"
          value={docks.filter((d) => d.status === "AVAILABLE").length}
        />
      </div>

      <Card className="rounded-2xl p-0 shadow-soft overflow-hidden">
        {loading ? (
          <div className="grid h-64 place-items-center">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : arrivals.length === 0 ? (
          <div className="grid min-h-64 place-items-center p-8 text-center text-muted-foreground">
            <Truck className="size-10 stroke-1" />
            <p className="mt-2 font-medium">No inbound vehicles in queue</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">ASN Number</th>
                  <th className="px-4 py-3">PO Number</th>
                  <th className="px-4 py-3">Supplier</th>
                  <th className="px-4 py-3">Vehicle / Driver</th>
                  <th className="px-4 py-3">Arrival Time</th>
                  <th className="px-4 py-3">Status / Dock</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {arrivals.map((arrival) => (
                  <ArrivalRows
                    key={arrival.id}
                    arrival={arrival}
                    expanded={expanded === arrival.id}
                    onToggle={() => setExpanded(expanded === arrival.id ? null : arrival.id)}
                    docks={docks}
                    selected={selectedDock[arrival.id] || ""}
                    onSelect={(dockId) => setSelectedDock((v) => ({ ...v, [arrival.id]: dockId }))}
                    onAssign={() => void assignDock(arrival)}
                    onMove={() => void startMovement(arrival)}
                    onCheckIn={() => void confirmDockArrival(arrival)}
                    onApproveExit={() => void approveGateExit(arrival)}
                    isEligibleForInboundExit={isEligibleForInboundExit}
                    busy={assigning === arrival.id}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </AppShell>
  );
}

function ArrivalRows({
  arrival,
  expanded,
  onToggle,
  docks,
  selected,
  onSelect,
  onAssign,
  onMove,
  onCheckIn,
  onApproveExit,
  isEligibleForInboundExit,
  busy,
}: {
  arrival: Arrival;
  expanded: boolean;
  onToggle: () => void;
  docks: Dock[];
  selected: string;
  onSelect: (id: string) => void;
  onAssign: () => void;
  onMove: () => void;
  onCheckIn: () => void;
  onApproveExit: (arrival: Arrival) => void;
  isEligibleForInboundExit: (status: string) => boolean;
  busy: boolean;
}) {
  const isExited = arrival.status === "VEHICLE_EXITED" || !!arrival.exited_at;

  return (
    <>
      <tr className="hover:bg-muted/20">
        <td className="px-4 py-4">
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onToggle();
            }}
            aria-expanded={expanded}
            className="font-mono font-semibold text-primary hover:underline"
          >
            {arrival.asn_number}
          </button>
        </td>
        <td className="px-4 py-4">
          <span className="font-mono">{arrival.po_number}</span>
        </td>
        <td className="px-4 py-4 font-medium">{arrival.supplier_name || "—"}</td>
        <td className="px-4 py-4">
          <p className="font-mono font-semibold">{arrival.vehicle_number}</p>
          <p className="text-xs text-muted-foreground">{arrival.driver_name || "—"}</p>
        </td>
        <td className="px-4 py-4">
          {new Date(arrival.arrival_time).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </td>
        <td className="px-4 py-4">
          <StatusBadge status={arrival.status} />
          {arrival.assigned_dock_id && (
            <p className="mt-1 text-xs font-semibold">{arrival.assigned_dock_id}</p>
          )}
          {isExited && (
            <p className="mt-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
              Approved exit
            </p>
          )}
        </td>
        <td className="px-4 py-4">
          <div className="flex flex-wrap items-center gap-2">
            {!isExited && isEligibleForInboundExit(arrival.status) && (
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg shadow-sm gap-1.5 text-xs px-3"
                disabled={busy}
                onClick={() => onApproveExit(arrival)}
              >
                <ShieldCheck className="size-3.5" /> Approve Gate Exit
              </Button>
            )}
            <Button size="sm" variant="outline" className="rounded-lg" onClick={onToggle}>
              <Eye className="size-3.5" /> Details
            </Button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7} className="bg-muted/20 px-4 py-5">
            <ArrivalDetails
              arrival={arrival}
              docks={docks}
              selected={selected}
              onSelect={onSelect}
              onAssign={onAssign}
              onMove={onMove}
              onCheckIn={onCheckIn}
              busy={busy}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return (
    <Card className="rounded-2xl p-4">
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </Card>
  );
}

function ArrivalDetails({
  arrival,
  docks,
  selected,
  onSelect,
  onAssign,
  onMove,
  onCheckIn,
  busy,
}: {
  arrival: Arrival;
  docks: Dock[];
  selected: string;
  onSelect: (id: string) => void;
  onAssign: () => void;
  onMove: () => void;
  onCheckIn: () => void;
  busy: boolean;
}) {
  return (
    <div className="space-y-5">
      <div className="rounded-xl border bg-card p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Inbound arrival details
            </p>
            <h3 className="mt-1 font-mono text-lg font-bold text-primary">{arrival.asn_number}</h3>
          </div>
          <StatusBadge status={arrival.status} />
        </div>
        <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Detail label="ASN number" value={arrival.asn_number} mono />
          <Detail label="PO number" value={arrival.po_number} mono />
          <Detail label="Supplier" value={arrival.supplier_name} />
          <Detail label="Current status" value={arrival.status.replaceAll("_", " ")} />
          <Detail label="Vehicle number" value={arrival.vehicle_number} mono />
          <Detail label="Driver" value={arrival.driver_name} />
          <Detail label="Driver contact" value={arrival.driver_contact} />
          <Detail label="Arrival time" value={new Date(arrival.arrival_time).toLocaleString()} />
        </dl>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <h3 className="mb-3 flex items-center gap-2 font-semibold">
            <Boxes className="size-4 text-primary" /> Gate entry information
          </h3>
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <dt className="text-muted-foreground">Gate entry</dt>
            <dd className="font-mono">{arrival.gate_entry_number}</dd>
            <dt className="text-muted-foreground">Entry time</dt>
            <dd>{new Date(arrival.arrival_time).toLocaleString()}</dd>
            <dt className="text-muted-foreground">Transporter</dt>
            <dd>{arrival.shipment.transporter || "—"}</dd>
            <dt className="text-muted-foreground">Packages</dt>
            <dd>
              {arrival.shipment.number_of_packages ?? "—"} {arrival.shipment.package_type || ""}
            </dd>
            <dt className="text-muted-foreground">Expected arrival</dt>
            <dd>
              {arrival.expected_arrival_at
                ? new Date(arrival.expected_arrival_at).toLocaleString()
                : "—"}
            </dd>
          </dl>
        </div>
        <div>
          <h3 className="mb-3 font-semibold">Expected materials</h3>
          <div className="space-y-2">
            {arrival.expected_materials.map((m) => (
              <div
                key={m.item_code}
                className="flex justify-between rounded-lg border bg-card px-3 py-2 text-xs"
              >
                <span>
                  <b>{m.item_code}</b>
                  <br />
                  {m.material_name}
                </span>
                <span className="font-semibold">
                  {m.quantity} {m.uom}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Detail({
  label,
  value,
  mono = false,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-1 font-semibold ${mono ? "font-mono" : ""}`}>{value || "—"}</dd>
    </div>
  );
}
