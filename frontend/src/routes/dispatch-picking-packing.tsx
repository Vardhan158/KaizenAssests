import { hasRole } from "@/lib/auth-utils";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Package,
  Box,
  RefreshCw,
  Loader2,
  CheckCircle2,
  ScanLine,
  ArrowRight,
  Navigation,
} from "lucide-react";
import { toast } from "sonner";
import { isValidUpload } from "@/lib/input-validation";
import { AppShell } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api-client";
import QRCode from "qrcode";
import jsQR from "jsqr";

export const Route = createFileRoute("/dispatch-picking-packing")({
  beforeLoad: () => {
    if (hasRole(["ASSEMBLY", "ASSEMBLY_MANAGER"])) throw redirect({ to: "/assembly/dispatch" });
  },
  component: DispatchPickingPackingPage,
});

function DispatchPickingPackingPage() {
  const [loading, setLoading] = useState(true);
  const [dispatchSearch, setDispatchSearch] = useState("");
  const [dispatches, setDispatches] = useState<any[]>([]);
  const [selectedDispatchId, setSelectedDispatchId] = useState<string>("");
  const [selectedDispatch, setSelectedDispatch] = useState<any | null>(null);
  const [workflowCompleted, setWorkflowCompleted] = useState(false);
  const [pickedQuantities, setPickedQuantities] = useState<Record<string, string>>({});
  const [packedQuantity, setPackedQuantity] = useState("");
  const [packageType, setPackageType] = useState("");
  const [packageCount, setPackageCount] = useState("");
  const [packageWeight, setPackageWeight] = useState("");
  const [packageNumber, setPackageNumber] = useState("");
  const [finishedGoodsQr, setFinishedGoodsQr] = useState("");
  const [scanQuantity, setScanQuantity] = useState("");
  const finishedGoodsQrInputRef = useRef<HTMLInputElement>(null);

  // Packing Form State matching wireframe
  const [submitting, setSubmitting] = useState(false);
  const isWorkflowCompleted = [
    "PACKED",
    "DISPATCH_READY",
    "DRIVER_ALLOCATED",
    "VEHICLE_ALLOCATED",
    "LOADING",
    "LOADED",
    "READY_FOR_GATE_EXIT",
    "DISPATCHED",
    "IN_TRANSIT",
    "DELIVERED",
    "CLOSED",
  ].includes(String(selectedDispatch?.status || "").toUpperCase());
  const createPackageNumber = () =>
    `PKG-${new Date().getFullYear()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const supplierRequests = await api.getSupplierFinishedGoodsDispatchRequests();
      await Promise.all(
        (supplierRequests || [])
          .filter((request: any) => request.status === "ALLOCATED")
          .map((request: any) =>
            api.allocateSupplierFinishedGoodsFifo(request.id).catch(() => null),
          ),
      );
      const res = await api.getDispatches();
      const items = res.items || [];
      setDispatches(items);
      if (items.length > 0 && !selectedDispatchId) {
        setSelectedDispatchId(items[0].id);
        setSelectedDispatch(items[0]);
        setPickedQuantities(
          Object.fromEntries(
            (items[0].items || []).map((item: any) => [
              item.id,
              String(item.quantity_picked || item.quantity_reserved || item.quantity_ordered || 0),
            ]),
          ),
        );
        setPackedQuantity(
          String(
            (items[0].items || []).reduce(
              (sum: number, item: any) => sum + Number(item.quantity_packed || 0),
              0,
            ) || "",
          ),
        );
        setPackageCount(
          String(
            (items[0].items || []).find((item: any) => item.package_count != null)?.package_count ||
              "",
          ),
        );
        setPackageNumber(
          (items[0].items || []).find((item: any) => item.package_number)?.package_number ||
            createPackageNumber(),
        );
        setWorkflowCompleted(
          [
            "PACKED",
            "DISPATCH_READY",
            "DRIVER_ALLOCATED",
            "VEHICLE_ALLOCATED",
            "LOADING",
            "LOADED",
            "READY_FOR_GATE_EXIT",
            "DISPATCHED",
            "IN_TRANSIT",
            "DELIVERED",
            "CLOSED",
          ].includes(String(items[0].status || "").toUpperCase()),
        );
      }
    } catch (e) {
      toast.error("Failed to load dispatches", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, [selectedDispatchId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleSelectDispatch = (id: string) => {
    setSelectedDispatchId(id);
    const found = dispatches.find((d) => d.id === id);
    setSelectedDispatch(found || null);
    setWorkflowCompleted(
      [
        "PACKED",
        "DISPATCH_READY",
        "DRIVER_ALLOCATED",
        "VEHICLE_ALLOCATED",
        "LOADING",
        "LOADED",
        "READY_FOR_GATE_EXIT",
        "DISPATCHED",
        "IN_TRANSIT",
        "DELIVERED",
        "CLOSED",
      ].includes(String(found?.status || "").toUpperCase()),
    );
    setPickedQuantities(
      Object.fromEntries(
        (found?.items || []).map((item: any) => [
          item.id,
          String(item.quantity_picked || item.quantity_reserved || item.quantity_ordered || 0),
        ]),
      ),
    );
    setPackedQuantity(
      String(
        (found?.items || []).reduce(
          (sum: number, item: any) => sum + Number(item.quantity_packed || 0),
          0,
        ) || "",
      ),
    );
    setPackageCount(
      String(
        (found?.items || []).find((item: any) => item.package_count != null)?.package_count || "",
      ),
    );
    setPackageNumber(
      (found?.items || []).find((item: any) => item.package_number)?.package_number ||
        createPackageNumber(),
    );
  };

  const handleDownloadPackageQr = async () => {
    if (!packageNumber) return;
    const dataUrl = await QRCode.toDataURL(packageNumber, {
      width: 600,
      margin: 2,
      errorCorrectionLevel: "H",
    });
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `${packageNumber}.png`;
    link.click();
  };

  const handleUploadFinishedGoodsQr = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        if (!context) return toast.error("Could not read uploaded QR image");
        context.drawImage(image, 0, 0);
        const result = jsQR(
          context.getImageData(0, 0, canvas.width, canvas.height).data,
          canvas.width,
          canvas.height,
        );
        if (!result?.data) return toast.error("No QR code found in the uploaded image");
        setFinishedGoodsQr(result.data);
        toast.success("Finished-goods QR loaded");
      };
      image.src = String(reader.result || "");
    };
    reader.readAsDataURL(file);
  };

  const productRows = selectedDispatch?.items || [];
  const requiredQuantity = productRows.reduce(
    (sum: number, item: any) => sum + Number(item.quantity_ordered || 0),
    0,
  );
  const pickedTotal = productRows.reduce(
    (sum: number, item: any) =>
      sum + Number(pickedQuantities[item.id] || item.quantity_picked || 0),
    0,
  );
  const packedTotal = Number(
    packedQuantity ||
      productRows.reduce((sum: number, item: any) => sum + Number(item.quantity_packed || 0), 0),
  );
  const isPickingConfirmed =
    String(selectedDispatch?.status || "").toUpperCase() === "PICKED" ||
    (productRows.length > 0 &&
      productRows.every(
        (item: any) =>
          Number(item.quantity_picked || 0) >=
          Number(item.quantity_reserved || item.quantity_ordered || 0),
      ));

  const handleConfirmPicking = async () => {
    if (!selectedDispatch || pickedTotal !== requiredQuantity) return;
    setSubmitting(true);
    try {
      if (["PENDING", "STOCK_RESERVED"].includes(String(selectedDispatch.status).toUpperCase()))
        await api.startDispatchPicking(selectedDispatch.id);
      const updated = await api.pickDispatchItems(
        selectedDispatch.id,
        productRows.map((item: any) => ({
          id: item.id,
          material_code: item.material_code,
          quantity_picked: Number(pickedQuantities[item.id] || 0),
        })),
      );
      setSelectedDispatch(updated);
      setDispatches((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      toast.success("Picking confirmed from Assembly Storage");
    } catch (err) {
      toast.error("Unable to confirm picking", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmPacking = async () => {
    if (
      !selectedDispatch ||
      !isPickingConfirmed ||
      packedTotal !== requiredQuantity ||
      !packageType ||
      Number(packageCount) < 1
    )
      return;
    setSubmitting(true);
    try {
      const persistedPackageNumber = packageNumber || createPackageNumber();
      setPackageNumber(persistedPackageNumber);
      if (selectedDispatch.status !== "PACKING_IN_PROGRESS")
        await api.startDispatchPacking(selectedDispatch.id);
      const updated = await api.packDispatchItems(
        selectedDispatch.id,
        productRows.map((item: any) => ({
          id: item.id,
          material_code: item.material_code,
          quantity_packed: Number(packedQuantity) || Number(item.quantity_picked || 0),
          package_number: persistedPackageNumber,
          package_type: packageType,
          package_count: Number(packageCount),
          package_weight: Number(packageWeight) || undefined,
        })),
      );
      setSelectedDispatch(updated);
      setDispatches((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      setWorkflowCompleted(true);
      toast.success("Packing confirmed", {
        description: `Package ${persistedPackageNumber} recorded`,
      });
    } catch (err) {
      toast.error("Unable to confirm packing", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  };

  /* Completion is intentionally split into explicit picking and packing confirmations. */
  const handleCompleteWorkflow = async () => {
    if (!selectedDispatch) {
      toast.error("Please select a dispatch order");
      return;
    }
    if (isWorkflowCompleted) {
      setWorkflowCompleted(true);
      toast.info("Workflow already completed", {
        description: `Dispatch ${selectedDispatch.dispatch_number} is already ${selectedDispatch.status}.`,
      });
      return;
    }
    setSubmitting(true);
    try {
      const items = (selectedDispatch.items || []).map((i: any) => ({
        id: i.id,
        material_code: i.material_code,
        quantity_picked: Number(i.quantity_reserved ?? i.quantity_ordered ?? 0),
        quantity_packed: Number(i.quantity_reserved ?? i.quantity_ordered ?? 0),
      }));
      if (!items.length) throw new Error("This dispatch has no items to pick or pack");
      if (selectedDispatch.status === "STOCK_RESERVED")
        await api.startDispatchPicking(selectedDispatch.id);
      else if (selectedDispatch.status !== "PICKING_IN_PROGRESS")
        throw new Error(
          `Dispatch must be stock reserved before picking (current status: ${selectedDispatch.status})`,
        );
      await api.pickDispatchItems(selectedDispatch.id, items);
      await api.startDispatchPacking(selectedDispatch.id);
      await api.packDispatchItems(selectedDispatch.id, items);

      setWorkflowCompleted(true);
      toast.success("Picking & Packing Completed!", {
        description: `Dispatch ${selectedDispatch.dispatch_number} successfully moved to Packed / Dispatch Ready.`,
      });
      void loadData();
    } catch (err) {
      toast.error("Failed to complete workflow", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const totalItems = productRows.reduce(
    (acc: number, i: any) => acc + Number(i.quantity_ordered ?? i.quantity ?? 0),
    0,
  );

  return (
    <AppShell
      title="Picking & Packing"
      subtitle="Integrated warehouse execution screen for product picking, barcode scan verification, and cartonization"
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
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Main Card matching wireframe */}
          <Card className="rounded-2xl p-6 shadow-sm border-border/80 bg-card space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
                  <Package className="size-6" />
                </div>
                <div>
                  <h2 className="text-lg font-bold tracking-tight">PICKING & PACKING</h2>
                  <p className="text-xs text-muted-foreground font-mono">
                    Select dispatch, pick materials, then record packing
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Label className="text-xs font-bold uppercase text-muted-foreground">
                  Select Dispatch:
                </Label>
                <Input
                  aria-label="Search dispatch selector"
                  placeholder="Search dispatch or customer..."
                  value={dispatchSearch}
                  onChange={(event) => setDispatchSearch(event.target.value)}
                  className="h-9 w-full rounded-xl text-xs sm:w-52"
                />
                <select
                  aria-label="Select dispatch for picking and packing"
                  value={selectedDispatchId}
                  onChange={(e) => handleSelectDispatch(e.target.value)}
                  className="rounded-xl border border-input bg-background px-3 py-2 text-xs font-bold shadow-sm focus:ring-2 focus:ring-primary text-primary font-mono"
                >
                  <option value="">-- Choose Dispatch --</option>
                  {dispatches
                    .filter(
                      (d) =>
                        d.id === selectedDispatchId ||
                        [d.dispatch_number, d.customer_name].some((value) =>
                          String(value || "")
                            .toLowerCase()
                            .includes(dispatchSearch.trim().toLowerCase()),
                        ),
                    )
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.dispatch_number} - {d.customer_name}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            {selectedDispatch && (
              <div className="p-3 rounded-xl bg-muted/30 border font-mono text-xs font-bold text-primary flex items-center justify-between">
                <span>
                  Dispatch No: {selectedDispatch.dispatch_number} | Customer:{" "}
                  {selectedDispatch.customer_name}
                </span>
                <span className="text-muted-foreground">Status: {selectedDispatch.status}</span>
              </div>
            )}

            {workflowCompleted && (
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 space-y-3">
                <div className="flex items-center gap-2 text-emerald-700 font-bold text-sm">
                  <CheckCircle2 className="size-5" /> Picking & Packing Completed Successfully!
                </div>
                <p className="text-xs text-muted-foreground">
                  The order is now Packed and Ready for Loading. Supplier vehicle details will be
                  verified at loading and gate exit:
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Link to="/dispatch-loading">
                    <Button size="sm" variant="outline" className="rounded-xl text-xs font-bold">
                      <Navigation className="size-3.5 mr-1.5" /> Go to Loading Stage{" "}
                      <ArrowRight className="size-3.5 ml-1.5" />
                    </Button>
                  </Link>
                </div>
              </div>
            )}

            {/* 1. PRODUCT TABLE SECTION */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Product Verification
              </h3>
              <div className="border rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/50 uppercase text-[10px] text-muted-foreground font-bold">
                    <tr>
                      <th className="px-4 py-2.5">Product</th>
                      <th className="px-4 py-2.5 text-right">Required</th>
                      <th className="px-4 py-2.5 text-right">Picked</th>
                      <th className="px-4 py-2.5 text-right">Packed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productRows.map((item: any, idx: number) => (
                      <tr key={idx} className="border-t font-medium">
                        <td className="px-4 py-3 font-semibold text-foreground">
                          {item.material_name || item.material_code || "—"}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          {item.quantity_ordered ?? 0}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-amber-600 font-bold">
                          {pickedQuantities[item.id] ?? item.quantity_picked ?? 0}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-emerald-600 font-bold">
                          {item.quantity_packed ?? 0}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 2. PICKING SECTION */}
            <div className="p-4 rounded-xl border bg-muted/20 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                <ScanLine className="size-4" /> Picking Execution
              </h3>
              <div className="flex flex-wrap items-center gap-3">
                <Input
                  value={finishedGoodsQr}
                  onChange={(e) => setFinishedGoodsQr(e.target.value)}
                  placeholder="QC-approved batch QR"
                  className="w-56 rounded-xl text-xs font-mono"
                  disabled={isWorkflowCompleted}
                />
                <Input
                  type="number"
                  min="0.01"
                  value={scanQuantity}
                  onChange={(e) => setScanQuantity(e.target.value)}
                  placeholder="Qty"
                  className="w-24 rounded-xl text-xs"
                  disabled={isWorkflowCompleted}
                />
                <input
                  ref={finishedGoodsQrInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file && isValidUpload(file, ["image/png", "image/jpeg", "image/webp"]))
                      handleUploadFinishedGoodsQr(file);
                    else if (file) toast.error("Upload a PNG, JPEG, or WebP image up to 5 MB.");
                    e.currentTarget.value = "";
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-xl text-xs"
                  disabled={isWorkflowCompleted}
                  onClick={() => finishedGoodsQrInputRef.current?.click()}
                >
                  Upload QR
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-xl text-xs"
                  disabled={
                    !selectedDispatch ||
                    !finishedGoodsQr ||
                    finishedGoodsQr.trim().toUpperCase().startsWith("PKG-") ||
                    !scanQuantity
                  }
                  onClick={async () => {
                    try {
                      const result = await api.scanAllocatedFinishedGoods(
                        selectedDispatch.id,
                        finishedGoodsQr.trim(),
                        Number(scanQuantity),
                      );
                      toast.success(`QR verified: ${result.batch_number}`);
                      setFinishedGoodsQr("");
                      setScanQuantity("");
                    } catch (error) {
                      toast.error(
                        error instanceof Error
                          ? error.message
                          : "Finished-goods QR validation failed",
                      );
                    }
                  }}
                >
                  Verify QR
                </Button>
                <span className="text-xs text-muted-foreground">
                  Source: Assembly Storage ·{" "}
                  {Array.from(
                    new Set(productRows.map((item: any) => item.bin).filter(Boolean)),
                  ).join(", ") || "Not specified"}
                </span>
                {productRows.map((item: any) => (
                  <Input
                    key={item.id}
                    type="number"
                    min="0"
                    max={item.quantity_ordered}
                    value={pickedQuantities[item.id] ?? item.quantity_picked ?? ""}
                    onChange={(e) =>
                      setPickedQuantities((current) => ({ ...current, [item.id]: e.target.value }))
                    }
                    placeholder={`Pick ${item.quantity_ordered}`}
                    className="w-32 rounded-xl text-xs"
                    disabled={isWorkflowCompleted}
                  />
                ))}
                <Button
                  type="button"
                  size="sm"
                  className="rounded-xl text-xs"
                  disabled={
                    submitting ||
                    isWorkflowCompleted ||
                    isPickingConfirmed ||
                    pickedTotal !== requiredQuantity
                  }
                  onClick={() => void handleConfirmPicking()}
                >
                  <CheckCircle2 className="size-3.5 mr-1.5" /> Confirm Picking
                </Button>
                <span className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-600">
                  {isPickingConfirmed
                    ? "PICKING_COMPLETED"
                    : selectedDispatch?.status || "No dispatch selected"}
                </span>
              </div>
            </div>

            {/* 3. PACKING SECTION */}
            <div className="p-4 rounded-xl border bg-muted/20 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                <Box className="size-4" /> Packing & Cartonization
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <Label className="text-[10px] font-bold uppercase text-muted-foreground">
                    Package No
                  </Label>
                  <Input
                    value={packageNumber}
                    readOnly
                    className="mt-1 rounded-xl text-xs font-mono font-bold"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-1 rounded-lg text-[10px]"
                    disabled={!packageNumber}
                    onClick={() => void handleDownloadPackageQr()}
                  >
                    Download QR
                  </Button>
                </div>
                <div>
                  <Label className="text-[10px] font-bold uppercase text-muted-foreground">
                    Package Type
                  </Label>
                  <Input
                    value={packageType}
                    onChange={(e) => setPackageType(e.target.value)}
                    placeholder="Carton / Crate / Pallet"
                    className="mt-1 rounded-xl text-xs font-semibold"
                    disabled={isWorkflowCompleted}
                  />
                </div>
                <div>
                  <Label className="text-[10px] font-bold uppercase text-muted-foreground">
                    Package Count
                  </Label>
                  <Input
                    type="number"
                    min="1"
                    value={packageCount}
                    onChange={(e) => setPackageCount(e.target.value)}
                    placeholder="Number of packages"
                    className="mt-1 rounded-xl text-xs font-bold"
                    disabled={isWorkflowCompleted}
                  />
                </div>
                <div>
                  <Label className="text-[10px] font-bold uppercase text-muted-foreground">
                    Weight (KG)
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={packageWeight}
                    onChange={(e) => setPackageWeight(e.target.value)}
                    placeholder="Total package weight"
                    className="mt-1 rounded-xl text-xs font-bold"
                    disabled={isWorkflowCompleted}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min="0"
                    max={requiredQuantity}
                    value={packedQuantity}
                    onChange={(e) => setPackedQuantity(e.target.value)}
                    placeholder={`Packed quantity (${requiredQuantity})`}
                    className="w-48 rounded-xl text-xs"
                    disabled={isWorkflowCompleted || !isPickingConfirmed}
                  />
                  <Button
                    type="button"
                    size="sm"
                    className="rounded-xl text-xs"
                    disabled={
                      submitting ||
                      isWorkflowCompleted ||
                      !isPickingConfirmed ||
                      pickedTotal !== requiredQuantity ||
                      packedTotal !== requiredQuantity ||
                      !packageType ||
                      Number(packageCount) < 1
                    }
                    onClick={() => void handleConfirmPacking()}
                  >
                    <CheckCircle2 className="size-3.5 mr-1.5" /> Confirm Packing
                  </Button>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-600">
                  {selectedDispatch?.status || "No dispatch selected"}
                </span>
              </div>
            </div>

            {/* Summary & Footer Actions */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-4 border-t">
              <div className="flex items-center gap-6 text-xs font-mono font-bold">
                <div>
                  Total Items: <span className="text-primary text-base">{totalItems}</span>
                </div>
                <div>
                  Total Packages:{" "}
                  <span className="text-purple-600 text-base">
                    {packageCount ? `${packageCount} Packages` : "—"}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  disabled={
                    submitting ||
                    isWorkflowCompleted ||
                    pickedTotal !== requiredQuantity ||
                    packedTotal !== requiredQuantity ||
                    !packageType ||
                    Number(packageCount) < 1
                  }
                  onClick={() => void handleConfirmPacking()}
                  className="rounded-xl text-xs font-bold px-6 shadow-glow"
                >
                  {submitting ? (
                    <Loader2 className="size-4 animate-spin mr-2" />
                  ) : (
                    <CheckCircle2 className="size-4 mr-2" />
                  )}
                  Complete Workflow
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </AppShell>
  );
}
