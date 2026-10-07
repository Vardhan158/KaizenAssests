import React from "react";
import { Text, View, TouchableOpacity, ScrollView, Platform } from "react-native";
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
  const gatePassNo = entryResult?.gate_entry_number || entryResult?.id || "N/A";
  const vehicleNo = entryResult?.vehicle_number || "UNASSIGNED";
  const poNo = entryResult?.po_number || "N/A";
  const supplierName = entryResult?.supplier_name || "Supplier N/A";
  const driverName = entryResult?.driver_name || "Driver";
  const driverContact = entryResult?.driver_contact || "N/A";
  const dockNo = entryResult?.dock_number || "DOCK-01";
  const timestamp = entryResult?.created_at
    ? new Date(entryResult.created_at).toLocaleString("en-IN")
    : new Date().toLocaleString("en-IN");

  return (
    <ScrollView style={tw`flex-1 bg-slate-900`} contentContainerStyle={tw`p-5 justify-center`}>
      {/* Success Badge Banner */}
      <View style={tw`items-center mb-5`}>
        <View style={tw`w-16 h-16 rounded-full bg-emerald-500 justify-center items-center mb-3 shadow-lg`}>
          <Text style={tw`text-white text-3xl font-black`}>✓</Text>
        </View>
        <Text style={tw`text-white text-xl font-black tracking-wider`}>GATE ENTRY GRANTED</Text>
        <Text style={tw`text-emerald-400 text-xs mt-1 font-semibold`}>Vehicle Authorized for Warehouse Apron</Text>
      </View>

      {/* Pass Ticket Card */}
      <View style={tw`bg-slate-800 rounded-2xl p-5 border border-emerald-500/40 mb-5`}>
        <View style={tw`items-center`}>
          <Text style={tw`text-slate-400 text-[10px] font-extrabold tracking-widest`}>GATE PASS NUMBER</Text>
          <Text style={tw`text-sky-400 text-xl font-black mt-1 tracking-wider`}>{gatePassNo}</Text>
        </View>

        <View style={tw`h-px bg-slate-700 my-4`} />

        <View style={tw`gap-3`}>
          <View style={tw`bg-slate-900 p-2.5 rounded-xl`}>
            <Text style={tw`text-slate-500 text-[9px] font-extrabold tracking-wider`}>VEHICLE PLATE</Text>
            <Text style={tw`text-sky-400 text-base font-black mt-0.5`}>{vehicleNo}</Text>
          </View>

          <View style={tw`bg-slate-900 p-2.5 rounded-xl`}>
            <Text style={tw`text-slate-500 text-[9px] font-extrabold tracking-wider`}>PURCHASE ORDER / ASN</Text>
            <Text style={tw`text-white text-xs font-bold mt-0.5`}>{poNo}</Text>
          </View>

          <View style={tw`bg-slate-900 p-2.5 rounded-xl`}>
            <Text style={tw`text-slate-500 text-[9px] font-extrabold tracking-wider`}>SUPPLIER</Text>
            <Text style={tw`text-white text-xs font-bold mt-0.5`}>{supplierName}</Text>
          </View>

          <View style={tw`bg-slate-900 p-2.5 rounded-xl`}>
            <Text style={tw`text-slate-500 text-[9px] font-extrabold tracking-wider`}>DRIVER DETAILS</Text>
            <Text style={tw`text-white text-xs font-bold mt-0.5`}>
              {driverName} {driverContact ? `• ${driverContact}` : ""}
            </Text>
          </View>

          <View style={tw`bg-slate-900 p-2.5 rounded-xl`}>
            <Text style={tw`text-slate-500 text-[9px] font-extrabold tracking-wider`}>ALLOCATED DOCK</Text>
            <Text style={tw`text-emerald-400 text-xs font-black mt-0.5`}>{dockNo}</Text>
          </View>

          <View style={tw`bg-slate-900 p-2.5 rounded-xl`}>
            <Text style={tw`text-slate-500 text-[9px] font-extrabold tracking-wider`}>TIMESTAMP</Text>
            <Text style={tw`text-white text-xs font-bold mt-0.5`}>{timestamp}</Text>
          </View>
        </View>

        {/* QR Code Ref */}
        <View style={tw`mt-4 bg-slate-900 p-3 rounded-xl items-center border border-slate-700`}>
          <Text style={tw`text-sky-400 text-xs font-mono font-bold`}>
            KAIZENX:GATE_ENTRY:{gatePassNo}
          </Text>
          <Text style={tw`text-slate-500 text-[10px] mt-1`}>Scannable by GRN receiving dock operators</Text>
        </View>
      </View>

      {/* Action Buttons */}
      <TouchableOpacity
        style={tw`bg-sky-600 py-3.5 rounded-xl items-center mb-2.5`}
        onPress={onNewScan}
      >
        <Text style={tw`text-white font-black text-xs tracking-wider`}>+ SCAN NEXT TRUCK</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={tw`bg-slate-800 py-3.5 rounded-xl items-center border border-slate-700`}
        onPress={onViewHistory}
      >
        <Text style={tw`text-slate-400 font-bold text-xs`}>VIEW INBOUND ENTRIES HISTORY</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}
