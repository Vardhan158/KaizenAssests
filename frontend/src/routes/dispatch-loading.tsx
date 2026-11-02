import { InformationTooltip } from "@/components/ui/information-tooltip";
import { hasRole } from "@/lib/auth-utils";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Navigation,
  RefreshCw,
  Loader2,
  CheckCircle2,
  Box,
  Barcode,
  ShieldCheck,
  ScanLine,
  Truck,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { isValidUpload } from "@/lib/input-validation";
import { AppShell, StatusBadge } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { api } from "@/lib/api-client";
import jsQR from "jsqr";

export const Route = createFileRoute("/dispatch-loading")({
  beforeLoad: () => {
    if (hasRole(["ASSEMBLY", "ASSEMBLY_MANAGER"])) throw redirect({ to: "/assembly/dispatch" });
  },
  component: DispatchLoadingPage,
});

function DispatchLoadingPage() {
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [orders, setOrders] = useState<any[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [isScanModalOpen, setIsScanModalOpen] = useState(false);
  const [loadingBays, setLoadingBays] = useState<any[]>([]);
  const [selectedBay, setSelectedBay] = useState("");
  const [packageQr, setPackageQr] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [scanMessage, setScanMessage] = useState("");
  const [scannedPackages, setScannedPackages] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [res, bays] = await Promise.all([
        api.getDispatches(),
        // Normalize legacy Dock Master records locally; older records may not
        // include direction and the API has used multiple bay-code fields.
        api.getDocks({ status: "AVAILABLE" }),
      ]);
      setOrders(
        res.items?.filter((o: any) =>
          [
            "PACKED",
            "ROUTE_ASSIGNED",
            "VEHICLE_ALLOCATED",
            "DRIVER_ALLOCATED",
            "LOADING_STARTED",
          ].includes(o.status),
        ) ||
          res.items ||
          [],
      );
      const availableBays = (Array.isArray(bays) ? bays : []).filter((bay: any) => {
        const status = String(bay.status || "AVAILABLE")
          .trim()
          .toUpperCase();
        const allocationStatus = String(
          bay.allocation_status || bay.current_allocation?.status || "",
        )
          .trim()
          .toUpperCase();
        const direction = String(bay.direction || "BOTH")
          .trim()
          .toUpperCase();
        return (
          bay.is_active !== false &&
          status === "AVAILABLE" &&
          ["OUTBOUND", "BOTH"].includes(direction) &&
          !["RESERVED", "OCCUPIED", "DOCK_ASSIGNED"].includes(allocationStatus)
        );
      });
      setLoadingBays(availableBays);
    } catch (e) {
      toast.error("Failed to load loading stage orders", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleOpenScan = (order: any) => {
    setSelectedOrder(order);
    setSelectedBay(order.loading_bay || order.loadingBay || order.bay_number || "");
    setPackageQr("");
    setScannedPackages([]);
    setScanMessage("");
    setIsScanModalOpen(true);
  };

  const validatePackage = async (value: string) => {
    if (!selectedOrder || !selectedBay || !value.trim()) return;
    try {
      const updated = await api.scanDispatchPackage(selectedOrder.id, value.trim());
      setSelectedOrder(updated);
      setOrders((current) => current.map((order) => (order.id === updated.id ? updated : order)));
      setScannedPackages((current) => [...new Set([...current, value.trim()])]);
      setPackageQr("");
      setScanMessage("Package verified and loaded.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Finished-goods QR validation failed";
      setScanMessage(message);
      toast.error("Unable to validate finished-goods QR", { description: message });
    }
  };

  const decodeImage = async (file: File) => {
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      context?.drawImage(bitmap, 0, 0);
      const image = context?.getImageData(0, 0, canvas.width, canvas.height);
      const decoded = image ? jsQR(image.data, image.width, image.height)?.data : undefined;
      if (!decoded) throw new Error("No QR code could be decoded from the image");
      setPackageQr(decoded);
      await validatePackage(decoded);
    } catch (error) {
      setScanMessage(error instanceof Error ? error.message : "Unable to decode QR image");
    }
  };

  useEffect(() => {
    if (!cameraOpen) return;
    let cancelled = false;
    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        cameraStreamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch {
        setScanMessage("Camera permission was denied or is unavailable.");
        setCameraOpen(false);
      }
    };
    void start();
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || video.videoWidth === 0) return;
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d");
      context?.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = context?.getImageData(0, 0, canvas.width, canvas.height);
      const decoded = image ? jsQR(image.data, image.width, image.height)?.data : undefined;
      if (decoded) {
        setCameraOpen(false);
        void validatePackage(decoded);
      }
    }, 400);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
    };
  }, [cameraOpen, selectedOrder, selectedBay]);

  const handleAssignBay = () => {
    if (!selectedOrder || !selectedBay) return;
    const updated = { ...selectedOrder, loading_bay: selectedBay };
    setSelectedOrder(updated);
    setOrders((current) => current.map((order) => (order.id === updated.id ? updated : order)));
    toast.success(`Loading bay ${selectedBay} assigned`, {
      description: `Dispatch ${updated.dispatch_number} is ready for package scanning.`,
    });
  };

  const handleCompleteLoading = async () => {
    if (!selectedOrder || !selectedBay) {
      toast.error("Assign a loading bay before loading packages");
      return;
    }
    const packed = (selectedOrder.items || []).reduce(
      (total: number, item: any) => total + Number(item.quantity_packed || 0),
      0,
    );
    const loaded = (selectedOrder.items || []).reduce(
      (total: number, item: any) => total + Number(item.quantity_loaded || 0),
      0,
    );
    if (loaded !== packed) {
      toast.error("Verify every package QR before completing loading");
      return;
    }
    try {
      await api.startDispatchLoading(selectedOrder.id);
      await api.verifyDispatchLoading(selectedOrder.id);
      await api.verifyDispatchFinal(selectedOrder.id);
      toast.success("Loading complete and verified. Order ready for Gate Exit.");
      setIsScanModalOpen(false);
      setSelectedOrder(null);
      void loadData();
    } catch (err) {
      toast.error("Failed to complete loading verification", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const visibleOrders = orders.filter(
    (order) =>
      !search.trim() ||
      [
        order.dispatch_number,
        order.vehicle_number,
        order.vehicleNumber,
        order.driver_name,
        order.driverName,
        order.loading_bay,
        order.bay_number,
        order.status,
      ].some((value) =>
        String(value || "")
          .toLowerCase()
          .includes(search.trim().toLowerCase()),
      ),
  );

  return (
    <AppShell
      title="Dispatch Loading Bay & Package Scanning"
      subtitle="Verify the supplier vehicle, loading bay, and package scanning before gate exit"
      actions={
        <Button data-refresh-control="true" size="icon" aria-label="Refresh" title="Refresh" variant="outline" className="rounded-xl" onClick={() => void loadData()}>
          <RefreshCw className="size-4" /></Button>
      }
    >
      {loading ? (
        <div className="grid h-64 place-items-center">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : (
        <Card className="rounded-2xl overflow-hidden shadow-sm">
          <div className="p-4 border-b font-semibold flex flex-wrap items-center justify-between gap-3">
            <span>Loading Bay Active Queue ({orders.length})</span>
            <span className="text-xs text-muted-foreground">
              Supplier vehicles awaiting package scanning & loading
            </span>
          </div>
          <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              Select dispatch &rarr; Verify bay and vehicle &rarr; Scan packages &rarr; Confirm
              loading
            </p>
            <input
              aria-label="Search loading queue"
              placeholder="Search dispatch, vehicle or driver..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-9 w-full rounded-xl border border-input bg-background px-3 text-xs sm:max-w-xs"
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/50 text-[10px] uppercase text-muted-foreground font-bold">
                <tr>
                  <th className="px-4 py-3">Dispatch</th>
                  <th className="px-4 py-3">Bay</th>
                  <th className="px-4 py-3">Vehicle</th>
                  <th className="px-4 py-3">Driver</th>
                  <th className="px-4 py-3">Status<InformationTooltip help="loading" /></th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleOrders.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-12 text-muted-foreground">
                      {search.trim()
                        ? "No loading orders match your search."
                        : "No orders pending loading. Complete packing tasks first."}
                    </td>
                  </tr>
                ) : (
                  visibleOrders.map((order) => {
                    const bayNo =
                      order.loading_bay || order.loadingBay || order.bay_number || "Not assigned";
                    const vehNo =
                      order.vehicle_number ||
                      order.vehicleNumber ||
                      order.vehicle_id ||
                      "Not assigned";
                    const drvName =
                      order.driver_name || order.driverName || order.driver_id || "Not assigned";
                    return (
                      <tr key={order.id} className="border-t hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-mono font-bold text-primary">
                          {order.dispatch_number || "Not available"}
                        </td>
                        <td className="px-4 py-3 font-bold font-mono text-amber-600">{bayNo}</td>
                        <td className="px-4 py-3 font-mono font-semibold">{vehNo}</td>
                        <td className="px-4 py-3 font-semibold flex items-center gap-1.5">
                          <User className="size-3.5 text-muted-foreground" /> {drvName}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center rounded-lg bg-purple-500/10 px-2.5 py-1 text-xs font-semibold text-purple-600">
                            {order.status === "LOADING_STARTED" ? "Loading" : "Packed / Ready"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            size="sm"
                            className="rounded-lg text-xs font-bold shadow-glow"
                            onClick={() => handleOpenScan(order)}
                          >
                            <ScanLine className="size-3.5 mr-1.5" />{" "}
                            {bayNo === "Not assigned"
                              ? "Assign Loading Bay"
                              : "Scan Packages & Load"}
                          </Button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Package Scanning & Verification Modal matching user specification */}
      <Dialog open={isScanModalOpen} onOpenChange={setIsScanModalOpen}>
        <DialogContent className="rounded-2xl max-w-xl">
          <DialogHeader>
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <DialogTitle className="text-xl font-bold">
                  Vehicle Loading & Package Scanning
                </DialogTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Scan packages before loading into vehicle and verify quantities
                </p>
              </div>
              {selectedOrder && (
                <div className="text-right font-mono text-sm font-bold text-primary">
                  {selectedOrder.dispatch_number || "Not available"}
                </div>
              )}
            </div>
          </DialogHeader>

          {selectedOrder && (
            <div className="space-y-4 py-2 text-sm">
              <div className="p-3 rounded-xl border bg-muted/30 space-y-2">
                <label className="text-xs font-bold uppercase text-muted-foreground">
                  Loading Bay *
                </label>
                <div className="flex gap-2">
                  <select
                    value={selectedBay}
                    onChange={(e) => setSelectedBay(e.target.value)}
                    className="flex-1 rounded-xl border border-input bg-background px-3 py-2 text-xs font-semibold"
                  >
                    <option value="">-- Assign Loading Bay --</option>
                    {loadingBays.map((bay: any) => (
                      <option
                        key={bay.id || bay.dock_code || bay.dock_number || bay.code}
                        value={bay.dock_code || bay.dock_number || bay.code}
                      >
                        {bay.dock_code || bay.dock_number || bay.code} —{" "}
                        {bay.dock_name || bay.name || "Available bay"}
                      </option>
                    ))}
                  </select>
                  <Button type="button" size="sm" disabled={!selectedBay} onClick={handleAssignBay}>
                    Assign Bay
                  </Button>
                </div>
                {!loadingBays.length && (
                  <p className="text-[11px] text-amber-600">
                    No available loading bays found in the dock master.
                  </p>
                )}
              </div>
              <div className="p-3 rounded-xl border bg-muted/30 space-y-2">
                <label className="text-xs font-bold uppercase text-muted-foreground">
                  Finished Goods QR *
                </label>
                <div className="flex gap-2">
                  <input
                    value={packageQr}
                    onChange={(e) => setPackageQr(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void validatePackage(packageQr);
                      }
                    }}
                    disabled={!selectedBay}
                    placeholder={
                      selectedBay
                        ? "Upload or enter finished-goods QR"
                        : "Assign a loading bay first"
                    }
                    className="flex-1 rounded-xl border border-input bg-background px-3 py-2 text-xs font-mono disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!selectedBay}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Upload QR
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!selectedBay}
                    onClick={() => setCameraOpen(true)}
                  >
                    Scan Camera
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file && isValidUpload(file, ["image/png", "image/jpeg"]))
                        void decodeImage(file);
                      else if (file) toast.error("Upload a PNG or JPEG image up to 5 MB.");
                      e.currentTarget.value = "";
                    }}
                  />
                </div>
                {scanMessage && (
                  <p className="text-[11px] font-semibold text-amber-700">{scanMessage}</p>
                )}
                {cameraOpen && (
                  <div className="rounded-xl overflow-hidden border">
                    <video
                      ref={videoRef}
                      muted
                      playsInline
                      className="w-full aspect-video bg-black"
                    />
                    <p className="p-2 text-[11px] text-center">
                      Point the camera at a finished-goods QR code.
                    </p>
                  </div>
                )}
              </div>
              <div className="p-4 rounded-xl bg-muted/40 border grid grid-cols-3 gap-3 text-center">
                <div>
                  <span className="text-[10px] uppercase text-muted-foreground font-bold block">
                    Expected Items
                  </span>
                  <span className="font-mono font-bold text-base">
                    {(selectedOrder.items || []).reduce(
                      (total: number, item: any) => total + Number(item.quantity_ordered || 0),
                      0,
                    )}{" "}
                    Units
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase text-muted-foreground font-bold block">
                    Picked Items
                  </span>
                  <span className="font-mono font-bold text-base text-amber-600">
                    {(selectedOrder.items || []).reduce(
                      (total: number, item: any) => total + Number(item.quantity_picked || 0),
                      0,
                    )}{" "}
                    Units
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase text-muted-foreground font-bold block">
                    Packed Items
                  </span>
                  <span className="font-mono font-bold text-base text-emerald-600">
                    {(selectedOrder.items || []).reduce(
                      (total: number, item: any) => total + Number(item.quantity_packed || 0),
                      0,
                    )}{" "}
                    Units
                  </span>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                  Package Scanning Checklist
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  {(selectedOrder.items || []).map((item: any, idx: number) => (
                    <div
                      key={item.id || idx}
                      className="p-3 rounded-xl border bg-card/50 flex items-center justify-between"
                    >
                      <div className="font-mono font-bold text-primary text-xs flex items-center gap-1.5">
                        <Box className="size-3.5" />{" "}
                        {item.material_code || item.material_name || `Package ${idx + 1}`} (
                        {item.quantity_packed || 0} {item.uom || "Units"})
                      </div>
                      <span
                        className={`inline-flex items-center rounded-lg px-2 py-0.5 text-xs font-bold ${Number(item.quantity_loaded || 0) > 0 ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600"}`}
                      >
                        {Number(item.quantity_loaded || 0) > 0 ? "Scanned" : "Pending"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Quantity Comparison Card */}
              <div className="p-4 rounded-xl bg-primary/5 border border-primary/20 space-y-2">
                <div className="text-xs font-bold uppercase tracking-wider text-primary">
                  Quantity Comparison Verification
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm font-mono font-bold">
                  <div>
                    Packed Quantity ={" "}
                    {(selectedOrder.items || []).reduce(
                      (total: number, item: any) => total + Number(item.quantity_packed || 0),
                      0,
                    )}
                  </div>
                  <div className="text-emerald-600">
                    Loaded Quantity ={" "}
                    {(selectedOrder.items || []).reduce(
                      (total: number, item: any) => total + Number(item.quantity_loaded || 0),
                      0,
                    )}
                  </div>
                </div>
                <p className="text-[11px] text-emerald-700 font-semibold flex items-center gap-1 mt-1">
                  <CheckCircle2 className="size-4" /> Backend quantities loaded for verification.
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => setIsScanModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              className="rounded-xl font-bold shadow-glow"
              disabled={
                !selectedBay ||
                !selectedOrder ||
                !(selectedOrder.items || []).length ||
                (selectedOrder.items || []).some(
                  (item: any) =>
                    Number(item.quantity_loaded || 0) !== Number(item.quantity_packed || 0),
                )
              }
              onClick={() => void handleCompleteLoading()}
            >
              Verify & Complete Loading
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
