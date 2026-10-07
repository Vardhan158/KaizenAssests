import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertOctagon,
  AlertTriangle,
  Camera,
  CheckCircle2,
  CheckSquare,
  Clock3,
  FileText,
  Filter,
  Loader2,
  LogOut,
  MapPin,
  Maximize2,
  Package,
  PlusCircle,
  RefreshCw,
  Scale,
  Search,
  ShieldAlert,
  ShieldCheck,
  Tag,
  Trash2,
  Truck,
  Upload,
  UserCheck,
  UserCheck2,
  Wrench,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell, StatusBadge } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api-client";
import { requireRole } from "@/lib/auth-utils";

export const Route = createFileRoute("/vehicle-exit")({
  // This screen is linked from the gate-security sidebar, which is also
  // available to gate operators and warehouse managers. Keep the route guard
  // consistent with that navigation visibility so clicking the item does not
  // immediately redirect the user away.
  beforeLoad: () =>
    requireRole(["WAREHOUSE", "WAREHOUSE_MANAGER", "GATE_SECURITY", "GATE_OPERATOR", "ADMIN", "SUPERUSER"]),
  head: () => ({ meta: [{ title: "Vehicle Exit · Outbound Gate Security · KaizenX" }] }),
  component: VehicleExit,
});

export interface OutboundGateExitException {
  id: string;
  dispatch_id: string;
  dispatch_number: string;
  expected_vehicle: string;
  expected_driver: string;
  actual_vehicle?: string;
  actual_driver?: string;
  verification_result: string;
  mismatch_reason: string;
  security_officer_id: string;
  status: string;
  resolution_action?: string;
  resolution_notes?: string;
  resolved_by?: string;
  resolved_at?: string;
  created_at: string;
  updated_at: string;
}

export interface OutboundDispatch {
  id: string;
  dispatch_number: string;
  customer_name: string;
  order_reference: string;
  vehicle_number: string;
  driver_name: string;
  driver_phone?: string;
  loading_status: string;
  status: string;
  items_summary?: string;
  destination_address?: string;
  seal_number?: string;
  eway_bill?: string;
  transporter?: string;
  gross_weight?: string;
  dock_bay?: string;
  warehouse_id: string;
  ready_time?: string;
  created_at: string;
  updated_at: string;
  gate_exit?: {
    id: string;
    dispatch_id: string;
    security_officer_id: string;
    vehicle_verified: boolean;
    driver_verified: boolean;
    remarks?: string;
    status: string;
    exit_completed_at: string;
    created_at: string;
  };
  active_exception?: OutboundGateExitException;
}

function VehicleExit() {
  const [dispatches, setDispatches] = useState<OutboundDispatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("READY_FOR_GATE_EXIT");

  // Selected dispatch for security verification modal
  const [selectedDispatch, setSelectedDispatch] = useState<OutboundDispatch | null>(null);
  const [vehicleVerified, setVehicleVerified] = useState(false);
  const [driverVerified, setDriverVerified] = useState(false);
  const [remarks, setRemarks] = useState("");

  // Report Mismatch modal state
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [mismatchResult, setMismatchResult] = useState<"VEHICLE_MISMATCH" | "DRIVER_MISMATCH" | "BOTH_MISMATCH">("VEHICLE_MISMATCH");
  const [actualVehicleInput, setActualVehicleInput] = useState("");
  const [actualDriverInput, setActualDriverInput] = useState("");
  const [mismatchReason, setMismatchReason] = useState("");
  const [reportingMismatch, setReportingMismatch] = useState(false);

  // Resolve Exception modal state
  const [resolveModalOpen, setResolveModalOpen] = useState(false);
  const [resolutionAction, setResolutionAction] = useState<"UPDATE_MANIFEST" | "CONFIRM_CLEARED">("UPDATE_MANIFEST");
  const [newVehicleInput, setNewVehicleInput] = useState("");
  const [newDriverInput, setNewDriverInput] = useState("");
  const [newDriverPhoneInput, setNewDriverPhoneInput] = useState("");
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [resolvingMismatch, setResolvingMismatch] = useState(false);

  // Vehicle Proof Camera Photo state
  const [exitVehiclePhotoPreview, setExitVehiclePhotoPreview] = useState<string | null>(null);
  const [showExitCamera, setShowExitCamera] = useState(false);
  const [showPhotoZoom, setShowPhotoZoom] = useState(false);

  const loadQueue = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const data = await api.getOutboundDispatchQueue("ALL", searchTerm);
      // The queue is persisted in the business service. Normalize its dispatch
      // response here so the gate-exit view does not depend on seed/local data.
      setDispatches(
        (data || []).map((dispatch: any) => ({
          ...dispatch,
          order_reference: dispatch.order_reference ?? dispatch.order_number ?? "",
          destination_address: dispatch.destination_address ?? dispatch.delivery_address ?? dispatch.destination,
          loading_status: dispatch.loading_status ?? (dispatch.status === "READY_FOR_GATE_EXIT" ? "LOADING_COMPLETED" : dispatch.status),
          vehicle_number: dispatch.vehicle_number ?? "",
          driver_name: dispatch.driver_name ?? "",
          customer_name: dispatch.customer_name ?? "",
        })),
      );
    } catch (error) {
      if (!quiet) {
        toast.error("Unable to load outbound vehicle exit queue", {
          description: error instanceof Error ? error.message : undefined,
        });
      }
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [searchTerm]);

  useEffect(() => {
    void loadQueue();
    const timer = window.setInterval(() => void loadQueue(true), 4000);
    return () => window.clearInterval(timer);
  }, [loadQueue]);

  const filteredDispatches = useMemo(() => {
    return dispatches.filter((d) => {
      const matchesSearch =
        !searchTerm.trim() ||
        String(d.dispatch_number ?? "").toLowerCase().includes(searchTerm.toLowerCase()) ||
        String(d.customer_name ?? "").toLowerCase().includes(searchTerm.toLowerCase()) ||
        String(d.order_reference ?? "").toLowerCase().includes(searchTerm.toLowerCase()) ||
        String(d.vehicle_number ?? "").toLowerCase().includes(searchTerm.toLowerCase()) ||
        String(d.driver_name ?? "").toLowerCase().includes(searchTerm.toLowerCase());

      const matchesStatus =
        statusFilter === "ALL" ||
        (statusFilter === "READY_FOR_GATE_EXIT" && d.status === "READY_FOR_GATE_EXIT") ||
        (statusFilter === "GATE_EXIT_MISMATCH" && d.status === "GATE_EXIT_MISMATCH") ||
        (statusFilter === "GATE_OUT" && ["GATE_OUT", "EXIT_COMPLETED", "DISPATCHED"].includes(d.status));

      return matchesSearch && matchesStatus;
    });
  }, [dispatches, searchTerm, statusFilter]);

  const awaitingCount = useMemo(
    () => dispatches.filter((d) => d.status === "READY_FOR_GATE_EXIT").length,
    [dispatches],
  );

  const mismatchCount = useMemo(
    () => dispatches.filter((d) => d.status === "GATE_EXIT_MISMATCH").length,
    [dispatches],
  );

  const completedCount = useMemo(
    () => dispatches.filter((d) => ["GATE_OUT", "EXIT_COMPLETED", "DISPATCHED"].includes(d.status)).length,
    [dispatches],
  );

  const allCount = useMemo(() => dispatches.length, [dispatches]);

  function openVerificationModal(dispatch: OutboundDispatch) {
    setSelectedDispatch(dispatch);
    setVehicleVerified(false);
    setDriverVerified(false);
    setRemarks("");
    const storedProof = localStorage.getItem(`gate_exit_proof_${dispatch.id}`);
    setExitVehiclePhotoPreview(storedProof || null);
  }

  function openReportMismatchModal(dispatch: OutboundDispatch) {
    setSelectedDispatch(dispatch);
    setMismatchResult("VEHICLE_MISMATCH");
    setActualVehicleInput("");
    setActualDriverInput("");
    setMismatchReason("");
    setReportModalOpen(true);
  }

  function openResolveMismatchModal(dispatch: OutboundDispatch) {
    setSelectedDispatch(dispatch);
    const exc = dispatch.active_exception;
    setResolutionAction("UPDATE_MANIFEST");
    setNewVehicleInput(exc?.actual_vehicle || dispatch.vehicle_number);
    setNewDriverInput(exc?.actual_driver || dispatch.driver_name);
    setNewDriverPhoneInput(dispatch.driver_phone || "");
    setResolutionNotes("");
    setResolveModalOpen(true);
  }

  async function handleConfirmExit() {
    if (!selectedDispatch) return;

    if (!vehicleVerified || !driverVerified) {
      toast.error("Security verification required", {
        description: "Both Vehicle Verified and Driver Verified checks must be confirmed before Gate Exit.",
      });
      return;
    }

    try {
      setSubmitting(true);
      if (exitVehiclePhotoPreview) {
        localStorage.setItem(`gate_exit_proof_${selectedDispatch.id}`, exitVehiclePhotoPreview);
      }
      const res = await api.confirmOutboundGateExit(selectedDispatch.id, {
        vehicle_verified: vehicleVerified,
        driver_verified: driverVerified,
        remarks: remarks.trim() || undefined,
        vehicle_photo_base64: exitVehiclePhotoPreview || undefined,
      });

      toast.success("Gate Exit Approved", {
        description: `Vehicle ${res.vehicle_number} cleared for exit. Dispatch ${res.dispatch_number} status updated to GATE_OUT.`,
      });

      setSelectedDispatch(null);
      await loadQueue(true);
    } catch (error: any) {
      console.error("Gate exit confirmation error:", error);
      toast.error("Gate Exit confirmation failed", {
        description: error.message || "Ensure dispatch status is READY_FOR_GATE_EXIT.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReportMismatchSubmit() {
    if (!selectedDispatch) return;
    if (!mismatchReason.trim()) {
      toast.error("Mismatch reason required", {
        description: "Please enter detailed observations explaining why verification failed.",
      });
      return;
    }

    try {
      setReportingMismatch(true);
      const res = await api.reportOutboundGateExitMismatch(selectedDispatch.id, {
        verification_result: mismatchResult,
        mismatch_reason: mismatchReason.trim(),
        actual_vehicle: actualVehicleInput.trim() || undefined,
        actual_driver: actualDriverInput.trim() || undefined,
      });

      toast.warning("Gate Exit Mismatch Flagged", {
        description: `Dispatch ${res.dispatch_number} status set to GATE_EXIT_MISMATCH. In-app notification sent to Dispatch team.`,
      });

      setReportModalOpen(false);
      setSelectedDispatch(null);
      await loadQueue(true);
    } catch (error: any) {
      toast.error("Failed to report mismatch", {
        description: error.message || "An error occurred.",
      });
    } finally {
      setReportingMismatch(false);
    }
  }

  async function handleResolveMismatchSubmit() {
    if (!selectedDispatch) return;
    if (!resolutionNotes.trim()) {
      toast.error("Resolution notes required", {
        description: "Please provide resolution notes explaining how the mismatch was addressed.",
      });
      return;
    }

    try {
      setResolvingMismatch(true);
      const res = await api.resolveOutboundGateExitMismatch(selectedDispatch.id, {
        resolution_action: resolutionAction,
        resolution_notes: resolutionNotes.trim(),
        new_vehicle_number: resolutionAction === "UPDATE_MANIFEST" ? newVehicleInput.trim() : undefined,
        new_driver_name: resolutionAction === "UPDATE_MANIFEST" ? newDriverInput.trim() : undefined,
        new_driver_phone: resolutionAction === "UPDATE_MANIFEST" ? newDriverPhoneInput.trim() : undefined,
      });

      toast.success("Exception Resolved", {
        description: `Dispatch ${res.dispatch_number} status restored to READY_FOR_GATE_EXIT. Gate Security notified for re-verification.`,
      });

      setResolveModalOpen(false);
      setSelectedDispatch(null);
      await loadQueue(true);
    } catch (error: any) {
      toast.error("Failed to resolve exception", {
        description: error.message || "An error occurred.",
      });
    } finally {
      setResolvingMismatch(false);
    }
  }

  async function handleSeedTestData() {
    try {
      setLoading(true);
      const res = await api.seedSampleDispatches(true);
      toast.success("Test dispatches generated", {
        description: `Generated ${res.count || 3} sample READY_FOR_GATE_EXIT dispatches with complete manifest details.`,
      });
      await loadQueue(true);
    } catch (error: any) {
      toast.error("Failed to seed test dispatches", {
        description: error.message || "Ensure server is running.",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppShell
      title="Outbound Vehicle Exit"
      subtitle="Security verification and gate exit confirmation for outbound vehicles (Warehouse → Customer)"
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" className="rounded-xl shadow-sm border-primary/30 text-primary hover:bg-primary-soft/50" onClick={() => void handleSeedTestData()}>
            <PlusCircle className="size-4 text-primary" /> Seed Test Data
          </Button>
          <Button variant="outline" className="rounded-xl shadow-sm" onClick={() => void loadQueue()}>
            <RefreshCw className="size-4" /> Refresh Queue
          </Button>
        </div>
      }
    >
      {/* Overview Banner */}
      <Card className="mb-6 rounded-2xl border-primary/20 bg-primary-soft/30 p-4 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
              <LogOut className="size-5" />
            </span>
            <div>
              <p className="font-semibold text-foreground">Outbound Finished Goods Gate Exit</p>
              <p className="text-xs text-muted-foreground">
                Verify outbound vehicles & drivers physically against dispatch manifest before releasing to customer.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-warning/30 bg-warning-soft px-3 py-1 text-xs font-semibold text-warning">
              <Clock3 className="size-3.5" /> {awaitingCount} Awaiting Gate Exit
            </span>
            {mismatchCount > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-1 text-xs font-semibold text-destructive">
                <AlertTriangle className="size-3.5" /> {mismatchCount} Action Required
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-success/30 bg-success-soft px-3 py-1 text-xs font-semibold text-success">
              <CheckCircle2 className="size-3.5" /> {completedCount} Exit Completed
            </span>
          </div>
        </div>
      </Card>

      {/* Filter & Search Bar */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="relative min-w-[260px] flex-1 max-w-md">
          <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search Dispatch #, Customer, Vehicle, Driver..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="rounded-xl pl-9"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="size-4 text-muted-foreground" />
          <Button
            variant={statusFilter === "READY_FOR_GATE_EXIT" ? "default" : "outline"}
            size="sm"
            className="rounded-xl"
            onClick={() => setStatusFilter("READY_FOR_GATE_EXIT")}
          >
            Awaiting Exit ({awaitingCount})
          </Button>
          <Button
            variant={statusFilter === "GATE_EXIT_MISMATCH" ? "destructive" : "outline"}
            size="sm"
            className="rounded-xl"
            onClick={() => setStatusFilter("GATE_EXIT_MISMATCH")}
          >
            <AlertOctagon className="mr-1.5 size-3.5" />
            Mismatch ({mismatchCount})
          </Button>
          <Button
            variant={statusFilter === "GATE_OUT" ? "default" : "outline"}
            size="sm"
            className="rounded-xl"
            onClick={() => setStatusFilter("GATE_OUT")}
          >
            Completed Exits ({completedCount})
          </Button>
          <Button
            variant={statusFilter === "ALL" ? "default" : "outline"}
            size="sm"
            className="rounded-xl"
            onClick={() => setStatusFilter("ALL")}
          >
            All ({allCount})
          </Button>
        </div>
      </div>

      {/* Queue Listing */}
      <Card className="rounded-2xl border-border/60 shadow-soft">
        <CardHeader>
          <CardTitle className="text-base">Outbound Dispatches Queue</CardTitle>
          <CardDescription>
            Outbound finished-goods dispatches ready for security verification & gate exit
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="grid h-48 place-items-center">
              <Loader2 className="size-7 animate-spin text-primary" />
            </div>
          ) : filteredDispatches.length === 0 ? (
            <div className="grid min-h-48 place-items-center rounded-xl border border-dashed py-10 text-center">
              <div>
                <CheckCircle2 className="mx-auto mb-2 size-8 text-success/80" />
                <p className="font-semibold">No outbound dispatches match your filter</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Dispatches appear here when loading is completed and status is set to READY_FOR_GATE_EXIT.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredDispatches.map((dispatch) => {
                const isReady = dispatch.status === "READY_FOR_GATE_EXIT";
                const isMismatch = dispatch.status === "GATE_EXIT_MISMATCH";
                const isCompleted = ["GATE_OUT", "EXIT_COMPLETED", "DISPATCHED"].includes(dispatch.status);

                return (
                  <div
                    key={dispatch.id}
                    className={`flex flex-col gap-4 rounded-xl border p-4 transition-all sm:flex-row sm:items-center sm:justify-between ${
                      isMismatch
                        ? "border-destructive/40 bg-destructive/5"
                        : "border-border/80 bg-card hover:border-primary/30"
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-bold text-primary">
                          {dispatch.dispatch_number}
                        </span>
                        <StatusBadge status={dispatch.status} />
                        <span className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 font-mono text-xs font-medium">
                          {dispatch.loading_status || "LOADING_COMPLETED"}
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-foreground">
                        {dispatch.customer_name} <span className="font-mono text-xs font-normal text-muted-foreground">({dispatch.order_reference})</span>
                      </p>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground pt-1">
                        <span className="inline-flex items-center gap-1">
                          <Truck className="size-3.5 text-primary" />
                          <strong className="font-mono text-foreground">{dispatch.vehicle_number}</strong>
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <UserCheck className="size-3.5 text-primary" />
                          {dispatch.driver_name} {dispatch.driver_phone ? `(${dispatch.driver_phone})` : ""}
                        </span>
                        {dispatch.dock_bay && (
                          <span className="inline-flex items-center gap-1 rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                            {dispatch.dock_bay}
                          </span>
                        )}
                        {dispatch.seal_number && (
                          <span className="inline-flex items-center gap-1 rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                            <Tag className="size-3 text-muted-foreground" />
                            Seal: {dispatch.seal_number}
                          </span>
                        )}
                        {dispatch.eway_bill && (
                          <span className="inline-flex items-center gap-1 rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                            E-Way Bill: {dispatch.eway_bill}
                          </span>
                        )}
                        {dispatch.gross_weight && (
                          <span className="inline-flex items-center gap-1 text-muted-foreground font-mono text-[11px]">
                            <Scale className="size-3" />
                            {dispatch.gross_weight}
                          </span>
                        )}
                        {dispatch.destination_address && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="size-3.5 text-muted-foreground" />
                            {dispatch.destination_address.slice(0, 32)}...
                          </span>
                        )}
                      </div>

                      {/* Mismatch Alert Notice on Card */}
                      {isMismatch && dispatch.active_exception && (
                        <div className="mt-2.5 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
                          <div className="flex items-center gap-1.5 font-bold">
                            <AlertTriangle className="size-4 shrink-0" />
                            Security Mismatch Flagged: {dispatch.active_exception.verification_result}
                          </div>
                          <p className="mt-0.5 text-foreground/90 font-medium">
                            Reason: {dispatch.active_exception.mismatch_reason}
                          </p>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            Reported by Officer <strong>{dispatch.active_exception.security_officer_id}</strong> on {new Date(dispatch.active_exception.created_at).toLocaleString()}
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {isCompleted ? (
                        <div className="text-right text-xs">
                          <span className="font-semibold text-success">Exit Approved</span>
                          <p className="text-muted-foreground">
                            {dispatch.gate_exit?.security_officer_id ? `By ${dispatch.gate_exit.security_officer_id}` : "Gate Out"}
                          </p>
                        </div>
                      ) : null}

                      {isMismatch ? (
                        <>
                          <Button
                            variant="destructive"
                            size="sm"
                            className="rounded-xl shadow-sm"
                            onClick={() => openResolveMismatchModal(dispatch)}
                          >
                            <Wrench className="size-3.5 mr-1" />
                            Resolve Exception
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="rounded-xl"
                            onClick={() => openVerificationModal(dispatch)}
                          >
                            View Details
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant={isReady ? "default" : "outline"}
                          className="rounded-xl shadow-glow"
                          onClick={() => openVerificationModal(dispatch)}
                        >
                          <ShieldCheck className="size-4" />
                          {isReady ? "Verify & Exit" : "View Exit Details"}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Security Verification & Gate Exit Modal */}
      <Dialog open={Boolean(selectedDispatch && !reportModalOpen && !resolveModalOpen)} onOpenChange={(open) => !open && setSelectedDispatch(null)}>
        {selectedDispatch && (
          <DialogContent className="max-w-xl rounded-2xl p-6">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-lg font-bold">
                <ShieldCheck className="size-5 text-primary" />
                Security Verification & Gate Exit
              </DialogTitle>
              <DialogDescription>
                Physically verify the vehicle plate and driver identity against the dispatch manifest before authorizing gate exit.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              {/* Read-Only Dispatch Manifest Details */}
              <div className="rounded-xl border border-border/80 bg-muted/20 p-4 text-xs space-y-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-muted-foreground uppercase tracking-wide">Dispatch Number</span>
                    <p className="font-mono font-bold text-sm text-primary">{selectedDispatch.dispatch_number}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground uppercase tracking-wide">Sales Order</span>
                    <p className="font-mono font-bold text-sm text-foreground">{selectedDispatch.order_reference}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 border-t pt-2">
                  <div>
                    <span className="text-muted-foreground uppercase tracking-wide">Customer</span>
                    <p className="font-semibold text-foreground">{selectedDispatch.customer_name}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground uppercase tracking-wide">Dispatch Status</span>
                    <div className="mt-0.5"><StatusBadge status={selectedDispatch.status} /></div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 border-t pt-2">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground uppercase tracking-wide">Expected Vehicle</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-6 px-1.5 text-[10px] font-semibold text-primary border-primary/30 hover:bg-primary-soft/60 rounded-lg flex items-center gap-1 shadow-xs"
                        onClick={() => setShowExitCamera(true)}
                        title="Capture Vehicle Photo Proof"
                      >
                        <Camera className="size-3 text-primary" /> Capture Photo Proof
                      </Button>
                    </div>
                    <p className="font-mono font-bold text-sm text-foreground flex items-center gap-1 mt-0.5">
                      <Truck className="size-3.5 text-primary" /> {selectedDispatch.vehicle_number}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground uppercase tracking-wide">Expected Driver</span>
                    <p className="font-semibold text-foreground flex items-center gap-1 mt-0.5">
                      <UserCheck2 className="size-3.5 text-primary" /> {selectedDispatch.driver_name} {selectedDispatch.driver_phone ? `(${selectedDispatch.driver_phone})` : ""}
                    </p>
                  </div>
                </div>

                {(selectedDispatch.seal_number || selectedDispatch.eway_bill || selectedDispatch.transporter || selectedDispatch.dock_bay || selectedDispatch.gross_weight) && (
                  <div className="grid grid-cols-2 gap-2 border-t pt-2">
                    {selectedDispatch.seal_number && (
                      <div>
                        <span className="text-muted-foreground uppercase tracking-wide">Container Seal Number</span>
                        <p className="font-mono font-semibold text-foreground mt-0.5">{selectedDispatch.seal_number}</p>
                      </div>
                    )}
                    {selectedDispatch.eway_bill && (
                      <div>
                        <span className="text-muted-foreground uppercase tracking-wide">E-Way Bill Number</span>
                        <p className="font-mono font-semibold text-foreground mt-0.5">{selectedDispatch.eway_bill}</p>
                      </div>
                    )}
                    {selectedDispatch.transporter && (
                      <div>
                        <span className="text-muted-foreground uppercase tracking-wide">Transporter Name</span>
                        <p className="font-semibold text-foreground mt-0.5">{selectedDispatch.transporter}</p>
                      </div>
                    )}
                    {selectedDispatch.gross_weight && (
                      <div>
                        <span className="text-muted-foreground uppercase tracking-wide">Cargo Gross Weight</span>
                        <p className="font-mono font-semibold text-foreground mt-0.5">{selectedDispatch.gross_weight}</p>
                      </div>
                    )}
                    {selectedDispatch.dock_bay && (
                      <div>
                        <span className="text-muted-foreground uppercase tracking-wide">Warehouse Bay</span>
                        <p className="font-mono font-semibold text-foreground mt-0.5">{selectedDispatch.dock_bay}</p>
                      </div>
                    )}
                  </div>
                )}

                {selectedDispatch.items_summary && (
                  <div className="border-t pt-2">
                    <span className="text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                      <Package className="size-3" /> Goods Summary
                    </span>
                    <p className="font-medium text-foreground mt-0.5">{selectedDispatch.items_summary}</p>
                  </div>
                )}

                {selectedDispatch.destination_address && (
                  <div className="border-t pt-2">
                    <span className="text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                      <MapPin className="size-3" /> Destination Address
                    </span>
                    <p className="text-muted-foreground mt-0.5">{selectedDispatch.destination_address}</p>
                  </div>
                )}
              </div>

              {/* ACTIVE MISMATCH EXCEPTION BANNER */}
              {selectedDispatch.status === "GATE_EXIT_MISMATCH" && selectedDispatch.active_exception && (
                <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-xs space-y-2">
                  <div className="flex items-center justify-between text-destructive">
                    <span className="font-bold flex items-center gap-1.5 text-sm">
                      <AlertOctagon className="size-4" /> GATE EXIT MISMATCH EXCEPTION (ACTION REQUIRED)
                    </span>
                    <span className="font-mono rounded bg-destructive/20 px-2 py-0.5 text-[11px] font-bold">
                      {selectedDispatch.active_exception.status}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-foreground pt-1 border-t border-destructive/20">
                    <div>
                      <span className="text-muted-foreground uppercase">Verification Result</span>
                      <p className="font-bold text-destructive">{selectedDispatch.active_exception.verification_result}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground uppercase">Reported By</span>
                      <p className="font-semibold">{selectedDispatch.active_exception.security_officer_id}</p>
                    </div>
                  </div>
                  {selectedDispatch.active_exception.actual_vehicle && (
                    <div>
                      <span className="text-muted-foreground uppercase">Observed Vehicle</span>
                      <p className="font-mono font-bold text-foreground">{selectedDispatch.active_exception.actual_vehicle}</p>
                    </div>
                  )}
                  {selectedDispatch.active_exception.actual_driver && (
                    <div>
                      <span className="text-muted-foreground uppercase">Observed Driver</span>
                      <p className="font-semibold text-foreground">{selectedDispatch.active_exception.actual_driver}</p>
                    </div>
                  )}
                  <div>
                    <span className="text-muted-foreground uppercase">Security Mismatch Reason</span>
                    <p className="font-medium text-foreground bg-background/50 p-2 rounded border border-destructive/20 mt-0.5">
                      {selectedDispatch.active_exception.mismatch_reason}
                    </p>
                  </div>
                  <p className="text-muted-foreground italic pt-1 text-[11px]">
                    ⚠️ Gate Exit confirmation is blocked. Dispatch/Warehouse team must resolve this exception before Security can authorize vehicle exit.
                  </p>
                </div>
              )}

              {/* Already Completed Notice */}
              {selectedDispatch.status === "GATE_OUT" || selectedDispatch.status === "EXIT_COMPLETED" ? (
                <div className="rounded-xl border border-success/30 bg-success-soft p-3 text-xs text-success font-medium flex items-center gap-2">
                  <CheckCircle2 className="size-4 shrink-0" />
                  <span>
                    Gate Exit already completed on {selectedDispatch.gate_exit?.exit_completed_at ? new Date(selectedDispatch.gate_exit.exit_completed_at).toLocaleString() : "record"} by {selectedDispatch.gate_exit?.security_officer_id || "Security"}.
                  </span>
                </div>
              ) : selectedDispatch.status === "GATE_EXIT_MISMATCH" ? (
                <div className="flex justify-end pt-2">
                  <Button
                    variant="destructive"
                    className="rounded-xl"
                    onClick={() => openResolveMismatchModal(selectedDispatch)}
                  >
                    <Wrench className="size-4 mr-1.5" /> Resolve Exception (Dispatch Team)
                  </Button>
                </div>
              ) : (
                /* Security Verification Checklist */
                <div className="space-y-3 rounded-xl border p-4 bg-card">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Required Security Physical Verification
                    </h4>
                    <div className="flex items-center gap-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs font-semibold text-primary border-primary/40 hover:bg-primary-soft rounded-lg flex items-center gap-1 shadow-xs"
                        onClick={() => setShowExitCamera(true)}
                        title="Capture Vehicle Photo Proof"
                      >
                        <Camera className="size-3.5 text-primary" /> Vehicle Photo Proof
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-destructive hover:bg-destructive/10"
                        onClick={() => openReportMismatchModal(selectedDispatch)}
                      >
                        <AlertTriangle className="size-3.5 mr-1" /> Report Mismatch
                      </Button>
                    </div>
                  </div>

                  {/* Captured Photo Proof Preview Box */}
                  {exitVehiclePhotoPreview ? (
                    <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary-soft/40 p-2.5 shadow-xs">
                      <div className="relative group shrink-0">
                        <img
                          src={exitVehiclePhotoPreview}
                          alt="Vehicle Proof Photo"
                          className="size-14 rounded-lg border border-primary/20 object-cover cursor-zoom-in shadow-xs transition-transform hover:scale-105"
                          onClick={() => setShowPhotoZoom(true)}
                        />
                        <button
                          type="button"
                          className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-card border text-muted-foreground shadow-sm hover:text-foreground"
                          onClick={() => setShowPhotoZoom(true)}
                          title="Zoom photo"
                        >
                          <Maximize2 className="size-2.5" />
                        </button>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-primary flex items-center gap-1">
                          <CheckCircle2 className="size-3.5 text-success" /> Vehicle Photo Proof Attached
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                          Captured photo proof stored with exit manifest details
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-[10px] text-primary border-primary/30 rounded-lg"
                          onClick={() => setShowExitCamera(true)}
                        >
                          <Camera className="size-3 mr-1" /> Retake
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-[10px] text-destructive hover:bg-destructive/10 rounded-lg"
                          onClick={() => {
                            setExitVehiclePhotoPreview(null);
                            if (selectedDispatch) {
                              localStorage.removeItem(`gate_exit_proof_${selectedDispatch.id}`);
                            }
                          }}
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between rounded-xl border border-dashed border-border/80 bg-muted/20 p-2.5 text-xs text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <Camera className="size-4 text-muted-foreground shrink-0" />
                        <span>Vehicle Photo Proof (Attach photo for security proof)</span>
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="h-7 px-2.5 text-xs font-semibold rounded-lg shadow-xs"
                        onClick={() => setShowExitCamera(true)}
                      >
                        <Camera className="size-3.5 mr-1" /> Capture Photo
                      </Button>
                    </div>
                  )}

                  <Label className="flex cursor-pointer items-center gap-3 rounded-xl border p-3 font-medium transition-colors hover:bg-muted/30">
                    <Checkbox
                      checked={vehicleVerified}
                      onCheckedChange={(checked) => setVehicleVerified(checked === true)}
                    />
                    <Truck className="size-4 text-primary" />
                    <span>
                      <strong>Vehicle Verified</strong> — Physical vehicle plate matches assigned manifest ({selectedDispatch.vehicle_number})
                    </span>
                  </Label>

                  <Label className="flex cursor-pointer items-center gap-3 rounded-xl border p-3 font-medium transition-colors hover:bg-muted/30">
                    <Checkbox
                      checked={driverVerified}
                      onCheckedChange={(checked) => setDriverVerified(checked === true)}
                    />
                    <UserCheck className="size-4 text-primary" />
                    <span>
                      <strong>Driver Verified</strong> — Driver identity & authorization matches manifest ({selectedDispatch.driver_name})
                    </span>
                  </Label>

                  <div className="pt-1">
                    <Label htmlFor="remarks" className="text-xs font-medium">
                      Security Remarks (Optional)
                    </Label>
                    <Textarea
                      id="remarks"
                      placeholder="e.g. Seal #SL-8841 verified intact. Vehicle cleared for gate exit."
                      value={remarks}
                      onChange={(e) => setRemarks(e.target.value)}
                      className="mt-1 rounded-xl text-xs"
                      rows={2}
                    />
                  </div>
                </div>
              )}
            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" className="rounded-xl" onClick={() => setSelectedDispatch(null)}>
                Close
              </Button>
              {selectedDispatch.status === "READY_FOR_GATE_EXIT" && (
                <Button
                  className="rounded-xl shadow-glow"
                  disabled={!vehicleVerified || !driverVerified || submitting}
                  onClick={() => void handleConfirmExit()}
                >
                  {submitting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="size-4" />
                  )}
                  Confirm Gate Exit
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      {/* REPORT MISMATCH SUB-MODAL */}
      <Dialog open={reportModalOpen} onOpenChange={setReportModalOpen}>
        <DialogContent className="max-w-lg rounded-2xl p-6 border-destructive/30">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold text-destructive">
              <AlertTriangle className="size-5" />
              Report Vehicle / Driver Mismatch Exception
            </DialogTitle>
            <DialogDescription>
              Security Officer report for physical mismatch against dispatch manifest ({selectedDispatch?.dispatch_number}). Gate Exit will be blocked and Dispatch team notified.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-xs">
            <div>
              <Label className="font-semibold text-foreground">Mismatch Category</Label>
              <RadioGroup
                value={mismatchResult}
                onValueChange={(val: any) => setMismatchResult(val)}
                className="mt-2 grid grid-cols-3 gap-2"
              >
                <Label className="flex cursor-pointer items-center gap-2 rounded-xl border p-2.5 font-medium hover:bg-muted/30">
                  <RadioGroupItem value="VEHICLE_MISMATCH" /> Vehicle Only
                </Label>
                <Label className="flex cursor-pointer items-center gap-2 rounded-xl border p-2.5 font-medium hover:bg-muted/30">
                  <RadioGroupItem value="DRIVER_MISMATCH" /> Driver Only
                </Label>
                <Label className="flex cursor-pointer items-center gap-2 rounded-xl border p-2.5 font-medium hover:bg-muted/30">
                  <RadioGroupItem value="BOTH_MISMATCH" /> Both Mismatch
                </Label>
              </RadioGroup>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="actual_vehicle" className="text-muted-foreground">
                  Observed Actual Vehicle Plate (Optional)
                </Label>
                <Input
                  id="actual_vehicle"
                  placeholder={selectedDispatch?.vehicle_number || "e.g. MH-12-XY-9999"}
                  value={actualVehicleInput}
                  onChange={(e) => setActualVehicleInput(e.target.value)}
                  className="mt-1 rounded-xl text-xs font-mono"
                />
              </div>
              <div>
                <Label htmlFor="actual_driver" className="text-muted-foreground">
                  Observed Actual Driver Name (Optional)
                </Label>
                <Input
                  id="actual_driver"
                  placeholder={selectedDispatch?.driver_name || "e.g. Suresh Kumar"}
                  value={actualDriverInput}
                  onChange={(e) => setActualDriverInput(e.target.value)}
                  className="mt-1 rounded-xl text-xs"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="mismatch_reason" className="font-semibold text-foreground">
                Detailed Security Mismatch Reason (Required)
              </Label>
              <Textarea
                id="mismatch_reason"
                placeholder="e.g. Arriving vehicle plate MH-12-XY-9999 does not match manifest MH-12-AB-5678. Driver states transport vendor substituted vehicle."
                value={mismatchReason}
                onChange={(e) => setMismatchReason(e.target.value)}
                className="mt-1.5 rounded-xl text-xs"
                rows={3}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" className="rounded-xl" onClick={() => setReportModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="rounded-xl"
              disabled={!mismatchReason.trim() || reportingMismatch}
              onClick={() => void handleReportMismatchSubmit()}
            >
              {reportingMismatch ? <Loader2 className="size-4 animate-spin" /> : <AlertOctagon className="size-4" />}
              Report Gate Exit Mismatch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* RESOLVE EXCEPTION SUB-MODAL */}
      <Dialog open={resolveModalOpen} onOpenChange={setResolveModalOpen}>
        <DialogContent className="max-w-lg rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold">
              <Wrench className="size-5 text-primary" />
              Resolve Gate Exit Mismatch Exception
            </DialogTitle>
            <DialogDescription>
              Authorized Dispatch / Warehouse manager resolution for Dispatch {selectedDispatch?.dispatch_number}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-xs">
            <div>
              <Label className="font-semibold text-foreground">Resolution Action</Label>
              <RadioGroup
                value={resolutionAction}
                onValueChange={(val: any) => setResolutionAction(val)}
                className="mt-2 space-y-2"
              >
                <Label className="flex cursor-pointer items-start gap-3 rounded-xl border p-3 font-medium hover:bg-muted/30">
                  <RadioGroupItem value="UPDATE_MANIFEST" className="mt-0.5" />
                  <div>
                    <span className="font-bold text-foreground">1. UPDATE_MANIFEST</span>
                    <p className="text-muted-foreground text-[11px]">
                      Update assigned vehicle plate / driver credentials on the dispatch manifest to match actual arrival.
                    </p>
                  </div>
                </Label>
                <Label className="flex cursor-pointer items-start gap-3 rounded-xl border p-3 font-medium hover:bg-muted/30">
                  <RadioGroupItem value="CONFIRM_CLEARED" className="mt-0.5" />
                  <div>
                    <span className="font-bold text-foreground">2. CONFIRM_CLEARED</span>
                    <p className="text-muted-foreground text-[11px]">
                      Keep original manifest unchanged and clear mismatch exception after manager authorization.
                    </p>
                  </div>
                </Label>
              </RadioGroup>
            </div>

            {resolutionAction === "UPDATE_MANIFEST" && (
              <div className="space-y-3 rounded-xl border p-3 bg-muted/20">
                <p className="font-semibold text-foreground uppercase tracking-wide text-[11px]">
                  Updated Manifest Credentials
                </p>
                <div>
                  <Label htmlFor="new_vehicle" className="text-muted-foreground">Assigned Vehicle Number</Label>
                  <Input
                    id="new_vehicle"
                    value={newVehicleInput}
                    onChange={(e) => setNewVehicleInput(e.target.value)}
                    className="mt-1 rounded-xl text-xs font-mono font-bold"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor="new_driver" className="text-muted-foreground">Assigned Driver Name</Label>
                    <Input
                      id="new_driver"
                      value={newDriverInput}
                      onChange={(e) => setNewDriverInput(e.target.value)}
                      className="mt-1 rounded-xl text-xs font-semibold"
                    />
                  </div>
                  <div>
                    <Label htmlFor="new_phone" className="text-muted-foreground">Driver Phone Number</Label>
                    <Input
                      id="new_phone"
                      value={newDriverPhoneInput}
                      onChange={(e) => setNewDriverPhoneInput(e.target.value)}
                      className="mt-1 rounded-xl text-xs"
                    />
                  </div>
                </div>
              </div>
            )}

            <div>
              <Label htmlFor="resolution_notes" className="font-semibold text-foreground">
                Resolution Notes (Required)
              </Label>
              <Textarea
                id="resolution_notes"
                placeholder="e.g. Transporter confirmed driver Ramesh Kumar was assigned to MH-12-XY-9999 due to breakdown. Updated manifest. Cleared for Security re-verification."
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value)}
                className="mt-1.5 rounded-xl text-xs"
                rows={3}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" className="rounded-xl" onClick={() => setResolveModalOpen(false)}>
              Cancel
            </Button>
            <Button
              className="rounded-xl shadow-glow"
              disabled={!resolutionNotes.trim() || resolvingMismatch}
              onClick={() => void handleResolveMismatchSubmit()}
            >
              {resolvingMismatch ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
              Submit Exception Resolution
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* FULL PHOTO ZOOM MODAL */}
      <Dialog open={showPhotoZoom} onOpenChange={setShowPhotoZoom}>
        <DialogContent className="max-w-2xl rounded-2xl p-5">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold">
              <Camera className="size-5 text-primary" /> Vehicle Photo Proof — {selectedDispatch?.vehicle_number}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {selectedDispatch?.dispatch_number} · Captured for security gate exit physical verification proof
            </DialogDescription>
          </DialogHeader>
          {exitVehiclePhotoPreview && (
            <div className="flex justify-center p-3 bg-slate-950 rounded-xl overflow-hidden shadow-inner">
              <img
                src={exitVehiclePhotoPreview}
                alt="Vehicle Proof Full Size"
                className="max-h-[75vh] w-auto object-contain rounded-lg shadow-2xl"
              />
            </div>
          )}
          <DialogFooter>
            <Button size="sm" className="rounded-xl w-full" onClick={() => setShowPhotoZoom(false)}>
              Close Proof Photo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* LIVE CAMERA CAPTURE MODAL */}
      {showExitCamera && (
        <ExitCameraModal
          onClose={() => setShowExitCamera(false)}
          onCapture={(dataUrl) => {
            setExitVehiclePhotoPreview(dataUrl);
            if (selectedDispatch) {
              localStorage.setItem(`gate_exit_proof_${selectedDispatch.id}`, dataUrl);
            }
            toast.success("Vehicle photo proof captured", {
              description: "Photo proof attached to gate exit verification record.",
            });
          }}
        />
      )}
    </AppShell>
  );
}

function ExitCameraModal({
  onClose,
  onCapture,
}: {
  onClose: () => void;
  onCapture: (dataUrl: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    if (navigator.mediaDevices?.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
        .then((activeStream) => {
          if (mounted) {
            streamRef.current = activeStream;
            if (videoRef.current) {
              videoRef.current.srcObject = activeStream;
            }
          } else {
            activeStream.getTracks().forEach((track) => track.stop());
          }
        })
        .catch((err) => {
          console.error("Camera access error:", err);
          if (mounted) setError("Camera access blocked. Use file upload option below.");
        });
    } else {
      setError("Camera API not supported on this browser device.");
    }

    return () => {
      mounted = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  function handleSnap() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      toast.error("Camera feed loading... please try again in a second");
      return;
    }

    const canvas = document.createElement("canvas");
    const maxDim = 1200;
    let width = video.videoWidth;
    let height = video.videoHeight;
    if (width > maxDim) {
      height = Math.round((height * maxDim) / width);
      width = maxDim;
    }
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx?.drawImage(video, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    onCapture(dataUrl);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          onCapture(reader.result);
        }
      };
      reader.readAsDataURL(file);
    }
  }

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-md rounded-2xl p-5 border-primary/30">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <Camera className="size-5 text-primary" /> Capture Vehicle Photo Proof
          </DialogTitle>
          <DialogDescription className="text-xs">
            Frame the vehicle plate & vehicle front/rear to attach photo proof for gate exit clearance.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {!error ? (
            <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-slate-950 border border-border shadow-inner flex items-center justify-center">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="h-full w-full object-cover"
              />
              <div className="absolute inset-0 pointer-events-none border-2 border-primary/40 rounded-xl m-3 border-dashed flex items-center justify-center">
                <span className="bg-slate-900/80 text-primary text-[10px] font-mono px-2 py-0.5 rounded border border-primary/30 backdrop-blur">
                  ALIGN VEHICLE / PLATE IN FRAME
                </span>
              </div>
            </div>
          ) : (
            <div className="rounded-xl bg-muted/50 p-4 text-center text-xs text-muted-foreground border border-dashed border-border">
              <Camera className="size-6 text-muted-foreground mx-auto mb-1.5" />
              {error}
            </div>
          )}

          <input
            type="file"
            ref={fileInputRef}
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>

        <DialogFooter className="gap-2 sm:justify-between flex-wrap">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-xl text-xs"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="size-3.5 mr-1" /> Upload Image File
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-xl text-xs"
              onClick={onClose}
            >
              Cancel
            </Button>
            {!error && (
              <Button
                type="button"
                size="sm"
                className="rounded-xl text-xs shadow-glow"
                onClick={handleSnap}
              >
                <Camera className="size-3.5 mr-1" /> Snap Photo Proof
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
