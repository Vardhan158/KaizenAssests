import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, ShieldCheck, AlertTriangle, Clock, ArrowRight } from "lucide-react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/po/$code")({
  component: PoPdfViewer,
});

function PoPdfViewer() {
  const { code } = Route.useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [poData, setPoData] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    async function loadPo() {
      try {
        if (!code) throw new Error("No PO access code provided");
        
        const authData = await api.magicLogin(code);
        const poId = authData?.poId || authData?.po_id || authData?.poId_str || authData?.po_id_str;
        if (!poId) throw new Error("Could not extract PO ID from link");

        const data = await api.getPurchaseOrder(poId);
        setPoData(data);
      } catch (err: any) {
        console.error("Failed to load PO:", err);
        setErrorMsg(err.message || "Failed to load Purchase Order");
      } finally {
        setLoading(false);
      }
    }
    loadPo();
  }, [code]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center p-4">
        <Loader2 className="size-8 animate-spin text-blue-600 mb-4" />
        <p className="text-slate-600 font-medium">Loading Purchase Order...</p>
      </div>
    );
  }

  if (errorMsg || !poData) {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center p-4">
        <div className="bg-white p-8 rounded shadow-lg max-w-md text-center">
          <AlertTriangle className="size-10 text-rose-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold mb-2">Error</h2>
          <p className="text-slate-600 mb-6">{errorMsg}</p>
          <Button onClick={() => navigate({ to: "/login" })}>Return to Login</Button>
        </div>
      </div>
    );
  }

  // Format the values
  const dateStr = poData.createdAt ? new Date(poData.createdAt).toISOString().split('T')[0] : "N/A";
  const items = poData.items || [];
  
  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-8 font-sans flex flex-col items-center">
      
      {/* ACTION BAR (Outside the document) */}
      <div className="w-full max-w-4xl flex justify-end mb-4 print:hidden">
        <Button 
          onClick={() => navigate({ to: `/supplier/asns/new?poId=${poData.id}` })}
          className="bg-blue-600 text-white rounded font-bold shadow-lg hover:bg-blue-700"
        >
          Create ASN <ArrowRight className="ml-2 size-4" />
        </Button>
      </div>

      <div className="w-full max-w-4xl bg-white p-0 md:p-12 shadow-2xl overflow-hidden relative">
        
        {/* HEADER */}
        <div className="bg-[#2563eb] py-8 px-6 text-center">
          <h1 className="text-white text-3xl font-black uppercase tracking-wider mb-2">Purchase Order</h1>
          <p className="text-white/90 text-sm">KaizenX Procurement | {poData.poNumber}</p>
        </div>

        <div className="p-6 md:p-8">
          {/* META INFO GRID */}
          <div className="flex flex-col md:flex-row border-t border-l border-blue-200 text-sm">
            {/* Left Column */}
            <div className="flex-1 flex flex-col border-r border-blue-200">
              <div className="flex border-b border-blue-200">
                <div className="w-1/3 bg-blue-50/70 p-3 font-bold text-slate-600 border-r border-blue-200 text-xs flex items-center">PO NUMBER</div>
                <div className="w-2/3 p-3 font-mono text-slate-800 flex items-center">{poData.poNumber}</div>
              </div>
              <div className="flex border-b border-blue-200">
                <div className="w-1/3 bg-blue-50/70 p-3 font-bold text-slate-600 border-r border-blue-200 text-xs flex items-center">STATUS</div>
                <div className="w-2/3 p-3 font-bold text-slate-800 flex items-center">{poData.status}</div>
              </div>
              <div className="flex border-b border-blue-200">
                <div className="w-1/3 bg-blue-50/70 p-3 font-bold text-slate-600 border-r border-blue-200 text-xs flex items-center">SUPPLIER</div>
                <div className="w-2/3 p-3 text-slate-800 flex items-center">{poData.supplier?.name || poData.supplierName || "—"}</div>
              </div>
              <div className="flex border-b border-blue-200 md:border-b-0">
                <div className="w-1/3 bg-blue-50/70 p-3 font-bold text-slate-600 border-r border-blue-200 text-xs flex items-center">SUPPLIER ADDRESS</div>
                <div className="w-2/3 p-3 text-slate-800 flex items-center">{poData.supplier?.address || poData.supplierAddress || poData.supplier_address || "—"}</div>
              </div>
            </div>
            
            {/* Right Column */}
            <div className="flex-1 flex flex-col border-r border-blue-200 border-b md:border-b-0">
              <div className="flex border-b border-blue-200">
                <div className="w-1/3 bg-blue-50/70 p-3 font-bold text-slate-600 border-r border-blue-200 text-xs flex items-center">DATE</div>
                <div className="w-2/3 p-3 text-slate-800 flex items-center">{dateStr}</div>
              </div>
              <div className="flex border-b border-blue-200">
                <div className="w-1/3 bg-blue-50/70 p-3 font-bold text-slate-600 border-r border-blue-200 text-xs flex items-center">EXPECTED DELIVERY</div>
                <div className="w-2/3 p-3 text-slate-800 flex items-center">{poData.expectedDeliveryDate || "Not Specified"}</div>
              </div>
              <div className="flex border-b border-blue-200">
                <div className="w-1/3 bg-blue-50/70 p-3 font-bold text-slate-600 border-r border-blue-200 text-xs flex items-center">PAYMENT TERMS</div>
                <div className="w-2/3 p-3 text-slate-800 flex items-center">{poData.paymentTerms || "Net 30"}</div>
              </div>
              <div className="flex">
                <div className="w-1/3 bg-blue-50/70 p-3 font-bold text-slate-600 border-r border-blue-200 text-xs flex items-center">DELIVERY ADDRESS</div>
                <div className="w-2/3 p-3 text-slate-800 flex items-center">{poData.deliveryTerms || "Not Specified"}</div>
              </div>
            </div>
          </div>
          {/* Ensure bottom border is there for md sizes if we did border-b-0 on left side */}
          <div className="hidden md:block border-b border-blue-200 w-full" />

          {/* ITEMS TABLE */}
          <div className="mt-8 overflow-x-auto">
            <table className="w-full text-sm border border-slate-300 text-left">
              <thead className="bg-[#0f172a] text-white">
                <tr>
                  <th className="p-3 border-r border-slate-600 w-12 text-center">#</th>
                  <th className="p-3 border-r border-slate-600">Material</th>
                  <th className="p-3 border-r border-slate-600">Description</th>
                  <th className="p-3 border-r border-slate-600 text-right">Qty</th>
                  <th className="p-3 border-r border-slate-600 text-center">UOM</th>
                  <th className="p-3 border-r border-slate-600 text-right">Unit Price</th>
                  <th className="p-3 text-right">Line Total</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-4 text-center text-slate-500">No items found</td>
                  </tr>
                ) : items.map((it: any, i: number) => {
                  const matCode = it.material?.code || it.itemCode || "";
                  const matName = it.material?.name || it.materialName || "";
                  return (
                    <tr key={i} className="border-b border-slate-300 bg-white">
                      <td className="p-3 border-r border-slate-300 text-center text-slate-500">{i + 1}</td>
                      <td className="p-3 border-r border-slate-300 font-mono text-slate-700">{matCode}</td>
                      <td className="p-3 border-r border-slate-300 text-slate-800 font-medium">{matName}</td>
                      <td className="p-3 border-r border-slate-300 text-right text-slate-800">{Number(it.quantity).toFixed(2)}</td>
                      <td className="p-3 border-r border-slate-300 text-center text-slate-600">{it.uom || it.material?.uom || ""}</td>
                      <td className="p-3 border-r border-slate-300 text-right text-slate-800">INR {Number(it.unitPrice).toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                      <td className="p-3 text-right text-slate-900 font-medium">INR {Number(it.lineTotal || (it.quantity * it.unitPrice)).toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* SUMMARY */}
          <div className="flex justify-end mt-8">
            <div className="w-full md:w-1/2 border border-blue-200 text-sm">
              <div className="p-3 bg-blue-50/70 font-bold text-slate-500 border-b border-blue-200 text-xs">ORDER SUMMARY</div>
              <div className="flex justify-between p-3 border-b border-blue-200">
                <span className="text-slate-600">Subtotal</span>
                <span className="text-slate-800 font-medium">INR {Number(poData.subtotal).toLocaleString('en-IN', {minimumFractionDigits: 2})}</span>
              </div>
              <div className="flex justify-between p-3 border-b border-blue-200">
                <span className="text-slate-600">Discount</span>
                <span className="text-slate-800 font-medium">- INR {Number(poData.discountAmount).toLocaleString('en-IN', {minimumFractionDigits: 2})}</span>
              </div>
              <div className="flex justify-between p-3 border-b border-blue-200">
                <span className="text-slate-600">GST (18.0000%)</span>
                <span className="text-slate-800 font-medium">INR {Number(poData.taxAmount).toLocaleString('en-IN', {minimumFractionDigits: 2})}</span>
              </div>
              <div className="flex justify-between p-3 border-b border-blue-200">
                <span className="text-slate-600">Freight charges</span>
                <span className="text-slate-800 font-medium">INR {Number(poData.freightCharges || 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}</span>
              </div>
              <div className="flex justify-between p-3 border-b border-blue-200">
                <span className="text-slate-600">Additional charges</span>
                <span className="text-slate-800 font-medium">INR {Number(poData.additionalCharges || 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}</span>
              </div>
              <div className="flex justify-between p-3 bg-blue-100 font-bold text-slate-900">
                <span>Grand Total</span>
                <span>INR {Number(poData.totalAmount).toLocaleString('en-IN', {minimumFractionDigits: 2})}</span>
              </div>
            </div>
          </div>

          {/* FOOTER */}
          <div className="mt-12 text-center">
            <p className="text-xs text-slate-500">
              This purchase order is generated from backend procurement records. Amounts reflect the approved PO values stored in KaizenX.
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}
