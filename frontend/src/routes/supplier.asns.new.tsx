import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, FileText, Loader2, Package, Truck, Headphones, Trash2 } from "lucide-react";
import { AppShell } from "@/components/wms/app-shell";
import { SectionCard } from "@/components/wms/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api-client";

export const Route = createFileRoute("/supplier/asns/new")({
  beforeLoad: () => {},
  component: NewAsn,
});
const inputClass = "mt-1.5 h-11 rounded-xl border-border/80 bg-background";

function NewAsn() {
  const search = useSearch({ strict: false }) as any;
  const poId = search.po_id || search.poId || "";
  const draftKey = `supplier-asn-draft:${poId || "new"}`;
  const hydrated = useRef(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [po, setPo] = useState<any>(null);
  const [asnNumber, setAsnNumber] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [driverName, setDriverName] = useState("");
  const [driverMobile, setDriverMobile] = useState("");
  const [lines, setLines] = useState<any[]>([]);

  useEffect(() => {
    async function load() {
      try {
        const saved = localStorage.getItem(draftKey);
        const draft = saved ? JSON.parse(saved) : null;
        const next = await api.getNextAsnNumber();
        setAsnNumber(next.asnNumber);
        if (draft) {
          setDeliveryDate(draft.deliveryDate || "");
          setVehicleNumber(draft.vehicleNumber || "");
          setDriverName(draft.driverName || "");
          setDriverMobile(draft.driverMobile || "");
          if (!poId) setLines(draft.lines || []);
        }
        if (poId) {
          const poData = await api.getPurchaseOrder(poId);
          setPo(poData);
          const previousAsns = await api.getAsns();
          const shippedByCode = new Map<string, number>();
          previousAsns
            .filter(
              (asn: any) =>
                String(asn.po_number || "").toUpperCase() ===
                String(poData.poNumber || poData.po_number || "").toUpperCase(),
            )
            .forEach((asn: any) =>
              (asn.lines || []).forEach((line: any) => {
                const code = String(line.item_code || line.material_code || "").toUpperCase();
                shippedByCode.set(
                  code,
                  (shippedByCode.get(code) || 0) + (Number(line.shipped_quantity ?? line.quantity) || 0),
                );
              }),
            );
          const remainingByCode = new Map<string, number>();
          const poLines = (poData.items || poData.lines || []).map((item: any) => {
            const itemCode =
              item.variantCode ||
              item.variant_code ||
              item.itemCode ||
              item.materialCode ||
              item.material_code ||
              "ITEM";
            const materialCode = item.material_code || item.materialCode || "";
            const alreadyShipped =
              shippedByCode.get(String(itemCode).toUpperCase()) ||
              shippedByCode.get(String(materialCode).toUpperCase()) ||
              0;
            const orderedQuantity = Number(item.quantity) || 0;
            const remainingQuantity = Math.max(0, orderedQuantity - alreadyShipped);
            remainingByCode.set(String(itemCode).toUpperCase(), remainingQuantity);
            if (materialCode) remainingByCode.set(String(materialCode).toUpperCase(), remainingQuantity);
            return {
              item_code: itemCode,
              material_name: item.materialName || item.material_name || "",
              ordered_quantity: orderedQuantity,
              remaining_quantity: remainingQuantity,
              shipped_quantity: remainingQuantity,
              uom: item.uom || "PCS",
            };
          });
          setLines(
            draft?.lines
              ? draft.lines.map((line: any) => {
                  const remaining = remainingByCode.get(String(line.item_code || "").toUpperCase());
                  return remaining === undefined ? line : { ...line, remaining_quantity: remaining };
                })
              : poLines,
          );
        } else if (!draft?.lines) {
          setLines([{ item_code: "", material_name: "", shipped_quantity: "", uom: "" }]);
        }
      } catch (error: any) {
        toast.error("Unable to prepare ASN", { description: error.message });
      } finally {
        hydrated.current = true;
        setLoading(false);
      }
    }
    void load();
  }, [draftKey, poId]);

  useEffect(() => {
    if (hydrated.current)
      localStorage.setItem(
        draftKey,
        JSON.stringify({ deliveryDate, vehicleNumber, driverName, driverMobile, lines }),
      );
  }, [draftKey, deliveryDate, vehicleNumber, driverName, driverMobile, lines]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!deliveryDate || !vehicleNumber || !driverName || !driverMobile)
      return toast.error("Complete delivery and driver details");
    if (
      !lines.length ||
      lines.some((line) => !line.material_name || !line.shipped_quantity || !line.uom)
    )
      return toast.error("Complete every material row");
    if (lines.some((line) => !Number.isFinite(Number(line.shipped_quantity)) || Number(line.shipped_quantity) < 0))
      return toast.error("Enter a valid non-negative quantity for every material row");
    if (
      lines.some(
        (line) =>
          line.ordered_quantity !== undefined &&
          Number(line.shipped_quantity) > Number(line.remaining_quantity ?? line.ordered_quantity),
      )
    )
      return toast.error("Shipped quantity cannot exceed the remaining purchase-order quantity");
    setSubmitting(true);
    try {
      await api.createAsn({
        po_id: poId || null,
        po_number: String(po?.poNumber || ""),
        asn_number: asnNumber,
        shipment_date: new Date().toISOString().slice(0, 10),
        expected_arrival_at: `${deliveryDate}T00:00:00`,
        vehicle_number: vehicleNumber.toUpperCase(),
        driver_name: driverName.trim(),
        driver_contact: driverMobile.trim(),
        status: "SUBMITTED",
        lines: lines.map((line) => ({
          item_code: line.item_code,
          material_name: line.material_name,
          shipped_quantity: Number(line.shipped_quantity) || 0,
          uom: line.uom,
        })),
      });
      localStorage.removeItem(draftKey);
      toast.success(`ASN ${asnNumber} submitted successfully`);
      window.history.back();
    } catch (error: any) {
      toast.error("Failed to submit ASN", { description: error.message });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading)
    return (
      <div className="flex h-screen items-center justify-center gap-3">
        <Loader2 className="size-8 animate-spin text-primary" />
        Loading ASN...
      </div>
    );

  return (
    <AppShell
      title="Create ASN"
      subtitle="Supplier shipment details"
      actions={
        <Button variant="outline" className="rounded-xl" onClick={() => window.history.back()}>
          <ArrowLeft className="mr-2 size-4" />
          Back
        </Button>
      }
    >
      <form onSubmit={submit} className="mx-auto grid max-w-7xl gap-5 pb-20 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-5">
        <SectionCard title="ASN Details" icon={FileText}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>ASN Number</Label>
              <div className="mt-1.5 flex h-11 items-center rounded-xl border bg-muted/50 px-4 font-mono font-bold text-primary">
                {asnNumber}
              </div>
            </div>
            <div>
              <Label htmlFor="delivery-date">Delivery Date</Label>
                <Input
                id="delivery-date"
                type="date"
                placeholder="Select delivery date"
                className={inputClass}
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
                required
              />
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Materials" icon={Package}>
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-3 text-left">Material</th>
                  <th className="p-3 text-right">Quantity</th>
                  <th className="p-3 text-left">UOM</th>
                  <th className="p-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {lines.map((line, index) => (
                  <tr key={index}>
                    <td className="p-3">
                <Input
                        placeholder="Material name"
                        value={line.material_name}
                        onChange={(e) =>
                          setLines((current) =>
                            current.map((item, i) =>
                              i === index
                                ? {
                                    ...item,
                                    material_name: e.target.value,
                                    item_code:
                                      item.ordered_quantity !== undefined
                                        ? item.item_code
                                        : e.target.value,
                                  }
                                : item,
                            ),
                          )
                        }
                        required
                      />
                    </td>
                    <td className="p-3">
                      <Input
                        type="number"
                        placeholder="Enter quantity"
                        min="0"
                        max={line.remaining_quantity ?? line.ordered_quantity}
                        step="0.01"
                        className="ml-auto h-9 w-32 text-right"
                        value={line.shipped_quantity}
                        onChange={(e) =>
                          setLines((current) =>
                            current.map((item, i) =>
                              i === index ? { ...item, shipped_quantity: e.target.value } : item,
                            ),
                          )
                        }
                        required
                      />
                    </td>
                    <td className="p-3">
                      <select
                        className="h-11 w-full rounded-xl border border-border/80 bg-background px-3 text-sm"
                        value={line.uom}
                        onChange={(e) =>
                          setLines((current) =>
                            current.map((item, i) =>
                              i === index ? { ...item, uom: e.target.value } : item,
                            ),
                          )
                        }
                        required
                      >
                        <option value="">Select UOM</option>
                        <option value="PCS">PCS</option>
                        <option value="KG">KG</option>
                        <option value="LITRE">LITRE</option>
                        <option value="METER">METER</option>
                        <option value="BOX">BOX</option>
                        <option value="PALLET">PALLET</option>
                      </select>
                    </td>
                    <td className="p-3 text-center">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label={`Delete material ${index + 1}`}
                        disabled={lines.length === 1}
                        className="border-red-200 text-red-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                        onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-8 text-center text-muted-foreground">
                      Add a material to this ASN.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Button
            type="button"
            variant="outline"
            className="mt-4 rounded-xl"
            onClick={() =>
              setLines((current) => [
                ...current,
                { item_code: "", material_name: "", shipped_quantity: "", uom: "" },
              ])
            }
          >
            Add Material
          </Button>
        </SectionCard>

        <SectionCard title="Vehicle and Driver" icon={Truck}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="vehicle-number">Vehicle Number</Label>
              <Input
                id="vehicle-number"
                placeholder="Enter vehicle number"
                className={inputClass}
                value={vehicleNumber}
                onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())}
                required
              />
            </div>
            <div>
              <Label htmlFor="driver-name">Driver Name</Label>
              <Input
                id="driver-name"
                placeholder="Enter driver name"
                className={inputClass}
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="driver-mobile">Driver Mobile Number</Label>
              <Input
                id="driver-mobile"
                type="tel"
                placeholder="Enter driver mobile number"
                className={inputClass}
                value={driverMobile}
                onChange={(e) => setDriverMobile(e.target.value)}
                required
              />
            </div>
          </div>
        </SectionCard>
        <Button
          type="submit"
          className="h-12 w-full rounded-xl"
          disabled={submitting || !lines.length}
        >
          {submitting ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <CheckCircle2 className="mr-2 size-4" />
          )}
          Submit ASN
        </Button>
        </div>
        <aside className="h-fit space-y-5 lg:sticky lg:top-5">
          <div className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-black text-slate-900">ASN Creation</h2>
            <div className="mt-5 space-y-5">
              {[['1', 'ASN Details', 'Basic shipment information'], ['2', 'Materials', 'Add materials and quantities'], ['3', 'Vehicle and Driver', 'Transport details'], ['4', 'Review & Submit', 'Verify and submit ASN']].map(([step, title, description], index) => <div key={step} className="relative flex gap-3">{index < 3 && <span className="absolute left-4 top-9 h-8 border-l border-slate-200" />}<span className={`z-10 grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold ${index === 0 ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-600'}`}>{step}</span><div><p className="text-sm font-bold text-slate-900">{title}</p><p className="text-xs text-slate-500">{description}</p></div></div>)}
            </div>
          </div>
          <div className="rounded-2xl bg-blue-50 p-5"><div className="flex items-center gap-3"><Headphones className="size-8 text-blue-600" /><div><p className="font-bold text-slate-900">Need Help?</p><p className="text-xs text-slate-500">Contact your warehouse team for support.</p></div></div></div>
        </aside>
      </form>
    </AppShell>
  );
}
