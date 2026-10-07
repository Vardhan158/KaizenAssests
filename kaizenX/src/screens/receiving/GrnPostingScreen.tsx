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

  const grnNumber = `GRN-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;
  const huLabelToken = `HU-PALLET-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`;

  const handleGenerateHuLabels = () => {
    setLabelsGenerated(true);
    Alert.alert(
      "Handling Unit QR Labels Generated ✓",
      `Generated 2 Pallet QR Labels:\n\n1. ${huLabelToken}-01 (240 KG - MAT-SS-304-001)\n2. ${huLabelToken}-02 (240 KG - MAT-SS-304-001)\n\nPrint request sent to Receiving Store Network Label Printer.`
    );
  };

  const handleConfirmGrnPosting = () => {
    if (!labelsGenerated) {
      Alert.alert("Labels Required", "Please generate Handling Unit QR Labels before finalizing GRN posting.");
      return;
    }

    setSubmitting(true);

    const finalGrnRecord = {
      ...qcRecord,
      grn_number: grnNumber,
      hu_label_token: huLabelToken,
      status: "GRN_COMPLETED",
      putaway_status: "READY_FOR_PUTAWAY",
      storekeeper: user?.full_name || "Store Manager",
      grn_posted_at: new Date().toISOString(),
    };

    setTimeout(() => {
      setSubmitting(false);
      Alert.alert(
        "GRN Posted & Released for Putaway ✓",
        `GRN Number: ${grnNumber}\nAccepted Stock: ${qcRecord?.accepted_quantity || 480} KG\n\nStock released to Storekeeper for Bin Putaway.`
      );
      onGrnComplete(finalGrnRecord);
    }, 600);
  };

  return (
    <ScrollView style={tw`flex-1 bg-slate-900`} contentContainerStyle={tw`p-4 pb-10`}>
      {/* Header */}
      <View style={tw`flex-row justify-between items-center mb-4`}>
        <View>
          <Text style={tw`text-white text-base font-black tracking-wider`}>GRN POSTING & LABEL GENERATION</Text>
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
          Review physical counts & QC results, finalize official GRN posting, generate Handling Unit QR labels, and release accepted material for putaway.
        </Text>
      </View>

      {/* Review Summary Card */}
      <View style={tw`bg-slate-800 rounded-2xl p-4 mb-4 border border-white/10 shadow-xl gap-2`}>
        <Text style={tw`text-sky-400 text-xs font-black tracking-wider uppercase mb-1`}>
          RECEIVING & QC SUMMARY REVIEW
        </Text>

        <View style={tw`bg-slate-900 p-3 rounded-xl gap-1.5 border border-slate-700`}>
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
            <Text style={tw`text-slate-400 text-xs`}>PO / Invoice:</Text>
            <Text style={tw`text-white text-xs font-bold`}>
              {qcRecord?.po_number || "PO-2026-008741"} (Inv #{qcRecord?.invoice_number || "INV-9901"})
            </Text>
          </View>

          <View style={tw`flex-row justify-between`}>
            <Text style={tw`text-slate-400 text-xs`}>Inspected Qty:</Text>
            <Text style={tw`text-white text-xs font-black`}>{qcRecord?.inspected_quantity || 500} KG</Text>
          </View>

          <View style={tw`flex-row justify-between`}>
            <Text style={tw`text-emerald-400 text-xs font-bold`}>Accepted Qty:</Text>
            <Text style={tw`text-emerald-400 text-xs font-black`}>{qcRecord?.accepted_quantity || 480} KG</Text>
          </View>

          <View style={tw`flex-row justify-between`}>
            <Text style={tw`text-red-400 text-xs font-bold`}>Rejected Qty:</Text>
            <Text style={tw`text-red-400 text-xs font-black`}>{qcRecord?.rejected_quantity || 20} KG</Text>
          </View>
        </View>
      </View>

      {/* Handling Unit QR Generation Box */}
      <View style={tw`bg-slate-800 rounded-2xl p-4 mb-4 border border-sky-500/40 shadow-xl`}>
        <Text style={tw`text-sky-400 text-xs font-black tracking-wider uppercase mb-2`}>
          HANDLING UNIT / PALLET QR LABELS
        </Text>
        <Text style={tw`text-slate-300 text-xs mb-3`}>
          Generate barcode labels for accepted stock (480 KG) split into handling unit pallets.
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

      {/* Final GRN Posting CTA */}
      <TouchableOpacity
        style={tw`bg-emerald-600 py-4 rounded-2xl items-center shadow-lg ${
          submitting ? "opacity-60" : ""
        }`}
        onPress={handleConfirmGrnPosting}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={tw`text-white font-black text-xs tracking-wider`}>
            [ POST GRN & RELEASE STOCK FOR PUTAWAY ] ✓
          </Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}
