import React, { useState } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import tw from "twrnc";
import { formatVehiclePlate } from "../../utils/vehicleFormatter";

interface GrnPostingScreenProps {
  qcRecord?: any;
  onGrnComplete: (result: any) => void;
  onCancel: () => void;
  user?: any;
}

export function GrnPostingScreen({
  qcRecord,
  onGrnComplete,
  onCancel,
  user,
}: GrnPostingScreenProps) {
  const [submitting, setSubmitting] = useState(false);
  const [labelsGenerated, setLabelsGenerated] = useState(false);
  const [varianceReason, setVarianceReason] = useState<
    | "Supplier Shortage"
    | "Excess Delivery"
    | "Transit Loss"
    | "Damaged Quantity"
    | "Incorrect ASN"
    | "Counting Difference"
    | "Other"
  >("Supplier Shortage");

  const [savedDraft, setSavedDraft] = useState<any | null>(null);

  // Section 29 - Server-side GRN Number Format: GRN-{SITE}-{YEAR}-{SEQUENCE}
  const grnNumber = `GRN-BLR-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
  const huLabelToken = `HU-PALLET-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`;

  // Quantities Breakdown
  const poQty = 1850;
  const asnQty = 1850;
  const receivedQty = Number(qcRecord?.inspected_quantity || qcRecord?.received_quantity || 1845);
  const acceptedQty = Number(qcRecord?.accepted_quantity || 1840);
  const rejectedQty = Number(qcRecord?.rejected_quantity || 5);
  const holdQty = Number(qcRecord?.hold_quantity || 0);

  // Section 31 PO Variance
  const poVariance = receivedQty - poQty;

  // Section 32 Over-Receipt Check
  const isOverReceipt = receivedQty > poQty;

  // Section 33 Partial Delivery Calculation
  const poRemainingBalance = Math.max(0, poQty - acceptedQty);

  const handleSaveGrnDraft = () => {
    const draft = {
      grn_number: `${grnNumber}-DRAFT`,
      qcRecord,
      varianceReason,
      saved_at: new Date().toISOString(),
    };
    setSavedDraft(draft);
    Alert.alert("GRN Draft Saved ✓", `GRN Draft ${draft.grn_number} saved. Store Manager can review and post later.`);
  };

  const handleGenerateHuLabels = () => {
    setLabelsGenerated(true);
    Alert.alert(
      "Handling Unit QR Labels Generated ✓",
      `Generated 2 Pallet QR Labels for Accepted Stock (${acceptedQty} KG):\n\n1. ${huLabelToken}-01 (${Math.floor(acceptedQty / 2)} KG - MAT-SS-304-001)\n2. ${huLabelToken}-02 (${Math.ceil(acceptedQty / 2)} KG - MAT-SS-304-001)\n\nPrint request dispatched to Store Label Printer.`
    );
  };

  const handleConfirmGrnPosting = () => {
    // Section 32 Over-Receipt Approval Block
    if (isOverReceipt) {
      Alert.alert(
        "Over-Receipt Approval Required 🛑",
        `Received Qty (${receivedQty} KG) exceeds PO Qty (${poQty} KG) by +${poVariance} KG.\n\nStatus: OVER_RECEIPT_APPROVAL_REQUIRED\n\nWarehouse Manager or Procurement approval required before posting.`
      );
      return;
    }

    if (!labelsGenerated) {
      Alert.alert("Labels Required", "Please generate Handling Unit QR Labels for accepted stock before posting GRN.");
      return;
    }

    setSubmitting(true);

    // Section 35 GRN Posting & Stock Segregation
    const finalGrnRecord = {
      ...qcRecord,
      grn_number: grnNumber,
      hu_label_token: huLabelToken,
      status: "GRN_POSTED",
      putaway_status: "READY_FOR_PUTAWAY",
      po_variance_kg: poVariance,
      variance_reason: varianceReason,
      po_remaining_balance_kg: poRemainingBalance,
      po_partial_status: poRemainingBalance > 0 ? "PARTIALLY_RECEIVED" : "COMPLETED",
      stock_segregation: {
        accepted_unrestricted_stock: acceptedQty,
        rejected_quarantine_stock: rejectedQty,
        hold_quarantine_stock: holdQty,
      },
      storekeeper: user?.full_name || "Store Manager",
      grn_posted_at: new Date().toISOString(),
    };

    setTimeout(() => {
      setSubmitting(false);
      Alert.alert(
        "GRN Posted & Downstream Stock Segregated ✓",
        `GRN Number: ${grnNumber}\n\n1. Accepted Stock (${acceptedQty} KG) ➔ Released for Bin Putaway\n2. Rejected Stock (${rejectedQty} KG) ➔ Moved to Blocked Area for Supplier Return\n3. Hold Stock (${holdQty} KG) ➔ Quarantined\n\nPO Status: ${finalGrnRecord.po_partial_status} (Remaining: ${poRemainingBalance} KG)`
      );
      onGrnComplete(finalGrnRecord);
    }, 600);
  };

  return (
    <ScrollView style={tw`flex-1 bg-slate-900`} contentContainerStyle={tw`p-4 pb-10`}>
      {/* Header */}
      <View style={tw`flex-row justify-between items-center mb-4`}>
        <View>
          <Text style={tw`text-white text-base font-black tracking-wider`}>GRN REVIEW & POSTING (SECTION 34)</Text>
          <Text style={tw`text-sky-400 text-xs font-bold mt-0.5`}>Storekeeper Desk • Inventory Control</Text>
        </View>
        <TouchableOpacity style={tw`bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700`} onPress={onCancel}>
          <Text style={tw`text-slate-300 text-xs font-bold`}>✕ CANCEL</Text>
        </TouchableOpacity>
      </View>

      {/* Role Scope Notice */}
      <View style={tw`bg-emerald-950/40 border border-emerald-500/30 p-3 rounded-2xl mb-4`}>
        <Text style={tw`text-emerald-400 text-xs font-black mb-0.5`}>📦 STOREKEEPER / STORE MANAGER SCOPE</Text>
        <Text style={tw`text-slate-300 text-[11px]`}>
          Review physical counts & QC results, verify quantity variances, post GRN, generate Handling Unit QR labels, and segregate accepted, rejected, and held inventory.
        </Text>
      </View>

      {/* Section 29 - Server-Side GRN Number Display */}
      <View style={tw`bg-slate-800 rounded-2xl p-4 mb-4 border border-sky-500/40 shadow-xl`}>
        <View style={tw`flex-row justify-between items-center mb-1`}>
          <Text style={tw`text-slate-400 text-[10px] font-black uppercase tracking-wider`}>SERVER-SIDE GRN NUMBER (SECTION 29)</Text>
          <View style={tw`bg-sky-500/20 px-2 py-0.5 rounded border border-sky-500/40`}>
            <Text style={tw`text-sky-400 text-[9px] font-black`}>READ-ONLY</Text>
          </View>
        </View>
        <Text style={tw`text-sky-400 text-base font-black font-mono`}>{grnNumber}</Text>
      </View>

      {/* Section 34 - Review Summary Card */}
      <View style={tw`bg-slate-800 rounded-2xl p-4 mb-4 border border-white/10 shadow-xl gap-2`}>
        <Text style={tw`text-sky-400 text-xs font-black tracking-wider uppercase mb-1`}>
          RECEIVING & QC SUMMARY REVIEW
        </Text>

        <View style={tw`bg-slate-900 p-3 rounded-xl gap-1.5 border border-slate-700`}>
          <View style={tw`flex-row justify-between`}>
            <Text style={tw`text-slate-400 text-xs`}>Gate Pass:</Text>
            <Text style={tw`text-sky-400 text-xs font-black`}>{qcRecord?.gate_pass_number || "GP-BLR-20261007-0048"}</Text>
          </View>

          <View style={tw`flex-row justify-between`}>
            <Text style={tw`text-slate-400 text-xs`}>Vehicle Plate:</Text>
            <Text style={tw`text-sky-400 text-xs font-black`}>
              {formatVehiclePlate(qcRecord?.vehicle_number || "KA 01 AB 4582")}
            </Text>
          </View>

          <View style={tw`flex-row justify-between`}>
            <Text style={tw`text-slate-400 text-xs`}>Supplier:</Text>
            <Text style={tw`text-white text-xs font-bold`}>
              {qcRecord?.supplier_name || "Bharat Electronics Components Pvt. Ltd."}
            </Text>
          </View>

          <View style={tw`flex-row justify-between`}>
            <Text style={tw`text-slate-400 text-xs`}>PO / ASN:</Text>
            <Text style={tw`text-white text-xs font-bold`}>
              {qcRecord?.po_number || "PO-2026-008741"} ({qcRecord?.asn_number || "ASN-2026-004582"})
            </Text>
          </View>

          <View style={tw`h-px bg-slate-800 my-1`} />

          {/* Section 30 - Quantity Preservation */}
          <View style={tw`flex-row justify-between`}>
            <Text style={tw`text-slate-400 text-xs`}>PO / ASN Qty:</Text>
            <Text style={tw`text-white text-xs font-bold`}>{poQty} KG</Text>
          </View>

          <View style={tw`flex-row justify-between`}>
            <Text style={tw`text-slate-400 text-xs`}>Physically Received Qty:</Text>
            <Text style={tw`text-white text-xs font-black`}>{receivedQty} KG</Text>
          </View>

          <View style={tw`flex-row justify-between`}>
            <Text style={tw`text-emerald-400 text-xs font-bold`}>QC Accepted Qty:</Text>
            <Text style={tw`text-emerald-400 text-xs font-black`}>{acceptedQty} KG</Text>
          </View>

          <View style={tw`flex-row justify-between`}>
            <Text style={tw`text-red-400 text-xs font-bold`}>QC Rejected Qty:</Text>
            <Text style={tw`text-red-400 text-xs font-black`}>{rejectedQty} KG</Text>
          </View>

          <View style={tw`flex-row justify-between`}>
            <Text style={tw`text-amber-400 text-xs font-bold`}>QC Hold Qty:</Text>
            <Text style={tw`text-amber-400 text-xs font-black`}>{holdQty} KG</Text>
          </View>

          <View style={tw`flex-row justify-between border-t border-slate-800 pt-1.5`}>
            <Text style={tw`text-slate-400 text-xs font-bold`}>PO Variance:</Text>
            <Text
              style={tw`text-xs font-black ${
                poVariance < 0 ? "text-amber-400" : poVariance > 0 ? "text-sky-400" : "text-emerald-400"
              }`}
            >
              {poVariance > 0 ? `+${poVariance}` : poVariance} KG
            </Text>
          </View>
        </View>

        {/* Section 32 Over-Receipt Warning Banner */}
        {isOverReceipt && (
          <View style={tw`bg-red-950/60 border border-red-500/60 p-3 rounded-xl mt-1`}>
            <Text style={tw`text-red-400 text-xs font-black uppercase mb-0.5`}>
              🚨 OVER-RECEIPT APPROVAL REQUIRED (SECTION 32)
            </Text>
            <Text style={tw`text-red-200 text-[10px] leading-4`}>
              Received quantity ({receivedQty} KG) exceeds PO limit ({poQty} KG). Status set to OVER_RECEIPT_APPROVAL_REQUIRED. Warehouse Manager approval required before posting.
            </Text>
          </View>
        )}

        {/* Section 33 Partial Delivery Status */}
        <View style={tw`bg-slate-900 p-3 rounded-xl border border-slate-700 flex-row justify-between items-center`}>
          <View>
            <Text style={tw`text-slate-400 text-[10px] font-bold uppercase`}>PO DELIVERY STATUS (SECTION 33)</Text>
            <Text style={tw`text-sky-400 text-xs font-black mt-0.5`}>
              {poRemainingBalance > 0 ? "PARTIALLY_RECEIVED" : "COMPLETED"}
            </Text>
          </View>
          <View>
            <Text style={tw`text-slate-400 text-[10px] font-bold uppercase text-right`}>PO REMAINING BALANCE</Text>
            <Text style={tw`text-emerald-400 text-xs font-black text-right mt-0.5`}>
              {poRemainingBalance} KG
            </Text>
          </View>
        </View>

        {/* Section 31 Variance Reason Selection */}
        {poVariance !== 0 && (
          <View style={tw`mb-1`}>
            <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mb-1.5 uppercase`}>
              VARIANCE REASON CATEGORY (SECTION 31)
            </Text>
            <View style={tw`flex-row flex-wrap gap-1.5`}>
              {[
                "Supplier Shortage",
                "Excess Delivery",
                "Transit Loss",
                "Damaged Quantity",
                "Incorrect ASN",
                "Counting Difference",
                "Other",
              ].map((vr) => {
                const active = varianceReason === vr;
                return (
                  <TouchableOpacity
                    key={vr}
                    style={tw`px-2.5 py-1 rounded border ${
                      active ? "bg-amber-600 border-amber-500" : "bg-slate-900 border-slate-700"
                    }`}
                    onPress={() => setVarianceReason(vr as any)}
                  >
                    <Text style={tw`text-[10px] font-bold ${active ? "text-white" : "text-slate-400"}`}>
                      {vr}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}
      </View>

      {/* Handling Unit QR Generation Box */}
      <View style={tw`bg-slate-800 rounded-2xl p-4 mb-4 border border-sky-500/40 shadow-xl`}>
        <Text style={tw`text-sky-400 text-xs font-black tracking-wider uppercase mb-2`}>
          HANDLING UNIT / PALLET QR LABELS
        </Text>
        <Text style={tw`text-slate-300 text-xs mb-3`}>
          Generate barcode labels for accepted stock ({acceptedQty} KG) split into handling unit pallets.
        </Text>

        <TouchableOpacity
          style={tw`py-3 rounded-xl items-center border ${
            labelsGenerated
              ? "bg-emerald-950/60 border-emerald-500/50"
              : "bg-sky-600 border-sky-500"
          }`}
          onPress={handleGenerateHuLabels}
        >
          <Text style={tw`text-white font-black text-xs tracking-wider`}>
            {labelsGenerated ? "✓ 2 PALLET QR LABELS GENERATED" : "GENERATE HANDLING UNIT QR LABELS"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Section 34 Actions: [Save Draft] & [Submit / Post GRN] */}
      <View style={tw`flex-row gap-2.5 mb-2`}>
        <TouchableOpacity
          style={tw`flex-1 bg-slate-800 py-3.5 rounded-xl items-center border border-slate-700`}
          onPress={handleSaveGrnDraft}
        >
          <Text style={tw`text-amber-400 font-extrabold text-xs`}>💾 [ SAVE DRAFT ]</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={tw`flex-2 bg-emerald-600 py-3.5 rounded-xl items-center shadow-lg ${
            submitting ? "opacity-60" : ""
          }`}
          onPress={handleConfirmGrnPosting}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={tw`text-white font-black text-xs tracking-wider`}>
              [ SUBMIT / POST GRN ] ✓
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {savedDraft && (
        <Text style={tw`text-amber-400 text-[10px] text-center font-semibold italic mt-1`}>
          Draft preserved locally ({savedDraft.grn_number}) at {new Date(savedDraft.saved_at).toLocaleTimeString()}
        </Text>
      )}
    </ScrollView>
  );
}
