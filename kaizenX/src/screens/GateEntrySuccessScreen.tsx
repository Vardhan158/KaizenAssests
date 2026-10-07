import React, { useState } from "react";
import { Text, View, TouchableOpacity, ScrollView, Alert, Share } from "react-native";
import tw from "twrnc";

interface GateEntrySuccessScreenProps {
  entryResult: any;
  onNewScan: () => void;
  onViewHistory: () => void;
}

export function GateEntrySuccessScreen({
  entryResult,
  onNewScan,
  onViewHistory,
}: GateEntrySuccessScreenProps) {
  const [entryConfirmed, setEntryConfirmed] = useState(
    entryResult?.status === "INSIDE_FACILITY" || entryResult?.entry_confirmed
  );

  const gatePassNo =
    entryResult?.gate_pass_number ||
    entryResult?.gate_entry_number ||
    `GP-BLR-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, "0")}${String(new Date().getDate()).padStart(2, "0")}-0048`;

  const vehicleNo = entryResult?.vehicle_number || entryResult?.vehicle_plate || "KA 01 AB 4582";
  const supplierName = entryResult?.supplier_name || "Bharat Electronics Components Pvt. Ltd.";
  const asnNo = entryResult?.asn_reference || entryResult?.asn_number || "ASN-2026-004582";
  const poNo = entryResult?.po_number || "PO-2026-008741";
  const dockNo = entryResult?.dock_number || entryResult?.assigned_dock_id || "D-04";

  const qrToken =
    entryResult?.qr_token ||
    `KAIZENX:GP-TOKEN:${gatePassNo.replace(/[^A-Z0-9]/g, "")}`;

  const entryTimeFormatted = entryResult?.created_at
    ? new Date(entryResult.created_at).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "07 Oct 2026 • 10:42 AM";

  const handleConfirmVehicleEntry = () => {
    setEntryConfirmed(true);
    Alert.alert(
      "Vehicle Entry Confirmed ✓",
      `Vehicle ${vehicleNo} authorized and recorded as INSIDE FACILITY.\n\nGate Pass: ${gatePassNo}\nAllocated Dock: ${dockNo}`,
      [
        { text: "View Inbound Vehicles", onPress: onViewHistory },
        { text: "Scan Next Truck", onPress: onNewScan },
      ]
    );
  };

  const handlePrintPass = () => {
    Alert.alert(
      "Print Gate Pass Receipt",
      `Sending Gate Pass ${gatePassNo} to Gate 01 Network Thermal Printer...\n\nVehicle: ${vehicleNo}\nDock: ${dockNo}`
    );
  };

  const handleSharePass = async () => {
    try {
      await Share.share({
        title: `Gate Pass ${gatePassNo}`,
        message: `KAIZENX GATE PASS: ${gatePassNo}\nVehicle: ${vehicleNo}\nSupplier: ${supplierName}\nDock: ${dockNo}\nEntry Time: ${entryTimeFormatted}\nQR Token: ${qrToken}`,
      });
    } catch {
      // share cancelled
    }
  };

  return (
    <ScrollView style={tw`flex-1 bg-slate-900`} contentContainerStyle={tw`p-5 justify-center`}>
      {/* Success Badge Banner */}
      <View style={tw`items-center mb-5`}>
        <View style={tw`w-16 h-16 rounded-full bg-emerald-500 justify-center items-center mb-2.5 shadow-lg`}>
          <Text style={tw`text-white text-3xl font-black`}>✓</Text>
        </View>
        <Text style={tw`text-white text-2xl font-black tracking-wider`}>GATE PASS GENERATED</Text>
        <Text style={tw`text-emerald-400 text-xs font-bold mt-0.5`}>
          Vehicle Cleared for Entry to Facility
        </Text>
      </View>

      {/* Screen 12 - Gate Pass Ticket Card */}
      <View style={tw`bg-slate-800 rounded-3xl p-5 border border-emerald-500/50 shadow-2xl mb-5`}>
        {/* Pass Header */}
        <View style={tw`items-center pb-3 border-b border-slate-700`}>
          <Text style={tw`text-slate-400 text-[10px] font-black tracking-widest uppercase`}>GATE PASS</Text>
          <Text style={tw`text-sky-400 text-xl font-black tracking-wider mt-1`}>{gatePassNo}</Text>
        </View>

        {/* Secure QR Code Reference Box */}
        <View style={tw`my-4 bg-slate-900 p-4 rounded-2xl items-center border border-sky-500/40 shadow-inner`}>
          <View style={tw`w-36 h-36 bg-slate-800 rounded-xl border border-sky-400/50 justify-center items-center mb-2`}>
            <Text style={tw`text-4xl mb-1`}>🔳</Text>
            <Text style={tw`text-sky-400 text-[10px] font-black tracking-widest`}>[ QR CODE ]</Text>
          </View>
          <Text style={tw`text-sky-400 text-[11px] font-mono font-bold tracking-wider text-center`}>
            {qrToken}
          </Text>
          <Text style={tw`text-slate-500 text-[9px] mt-1 text-center`}>
            Contains secure encrypted token reference for dock receiving
          </Text>
        </View>

        {/* Gate Pass Mapping Fields */}
        <View style={tw`gap-2 mb-2`}>
          <View style={tw`flex-row justify-between items-center bg-slate-900 p-2.5 rounded-xl`}>
            <Text style={tw`text-slate-400 text-xs font-semibold`}>Vehicle:</Text>
            <Text style={tw`text-sky-400 text-sm font-black`}>{vehicleNo}</Text>
          </View>

          <View style={tw`flex-row justify-between items-center bg-slate-900 p-2.5 rounded-xl`}>
            <Text style={tw`text-slate-400 text-xs font-semibold`}>Supplier:</Text>
            <Text style={tw`text-white text-xs font-bold flex-1 text-right ml-2`} numberOfLines={1}>
              {supplierName}
            </Text>
          </View>

          <View style={tw`flex-row justify-between items-center bg-slate-900 p-2.5 rounded-xl`}>
            <Text style={tw`text-slate-400 text-xs font-semibold`}>ASN / PO:</Text>
            <Text style={tw`text-white text-xs font-bold`}>{asnNo} ({poNo})</Text>
          </View>

          <View style={tw`flex-row justify-between items-center bg-slate-900 p-2.5 rounded-xl`}>
            <Text style={tw`text-slate-400 text-xs font-semibold`}>Dock:</Text>
            <Text style={tw`text-emerald-400 text-xs font-black`}>{dockNo}</Text>
          </View>

          <View style={tw`flex-row justify-between items-center bg-slate-900 p-2.5 rounded-xl`}>
            <Text style={tw`text-slate-400 text-xs font-semibold`}>Entry Time:</Text>
            <Text style={tw`text-slate-200 text-xs font-bold`}>{entryTimeFormatted}</Text>
          </View>

          <View style={tw`flex-row justify-between items-center bg-slate-900 p-2.5 rounded-xl`}>
            <Text style={tw`text-slate-400 text-xs font-semibold`}>Status:</Text>
            <Text style={tw`text-emerald-400 text-xs font-black uppercase`}>
              {entryConfirmed ? "✓ INSIDE_FACILITY" : "GATE_APPROVED"}
            </Text>
          </View>
        </View>
      </View>

      {/* Primary CTA: [Confirm Vehicle Entry] */}
      <TouchableOpacity
        style={tw`py-4 rounded-2xl items-center mb-3 shadow-lg ${
          entryConfirmed ? "bg-emerald-600" : "bg-sky-600"
        }`}
        onPress={handleConfirmVehicleEntry}
      >
        <Text style={tw`text-white font-black text-xs tracking-wider`}>
          {entryConfirmed ? "✓ VEHICLE ENTRY CONFIRMED" : "[ Confirm Vehicle Entry ]"}
        </Text>
      </TouchableOpacity>

      {/* Optional Secondary CTAs: [Print] and [Share] */}
      <View style={tw`flex-row gap-2.5 mb-3`}>
        <TouchableOpacity
          style={tw`flex-1 bg-slate-800 py-3 rounded-xl items-center border border-slate-700`}
          onPress={handlePrintPass}
        >
          <Text style={tw`text-sky-400 font-bold text-xs`}>🖨️ [ Print ]</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={tw`flex-1 bg-slate-800 py-3 rounded-xl items-center border border-slate-700`}
          onPress={handleSharePass}
        >
          <Text style={tw`text-sky-400 font-bold text-xs`}>🔗 [ Share ]</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={tw`bg-slate-800 py-3 rounded-xl items-center border border-slate-700`}
        onPress={onNewScan}
      >
        <Text style={tw`text-slate-400 font-bold text-xs`}>+ SCAN NEXT TRUCK</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}
