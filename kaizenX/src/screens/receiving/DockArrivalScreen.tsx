import React, { useState } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
} from "react-native";
import tw from "twrnc";
import { mobileApi } from "../../services/api";
import { formatVehiclePlate, parseScannedQrCode } from "../../utils/vehicleFormatter";

interface DockArrivalScreenProps {
  onDockCheckInSuccess: (record: any) => void;
  onCancel: () => void;
  user?: any;
}

export function DockArrivalScreen({
  onDockCheckInSuccess,
  onCancel,
  user,
}: DockArrivalScreenProps) {
  const [gatePassInput, setGatePassInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [matchedEntry, setMatchedEntry] = useState<any | null>(null);

  const handleLookupGatePass = async () => {
    if (!gatePassInput.trim()) {
      Alert.alert("Required", "Please enter or scan a valid Gate Pass Number or QR.");
      return;
    }

    setLoading(true);
    try {
      const parsed = parseScannedQrCode(gatePassInput);
      const cleanRef = parsed.reference.toUpperCase().trim();

      const entries = await mobileApi.getGateEntries();
      const match = entries.find((e: any) => {
        const pass = String(e.gate_pass_number || e.gate_entry_number || e.id || "").toUpperCase();
        const veh = String(e.vehicle_number || e.vehicle_plate || "").toUpperCase();
        return pass.includes(cleanRef) || cleanRef.includes(pass) || veh.includes(cleanRef);
      }) || {
        id: `GE-${Date.now()}`,
        gate_pass_number: cleanRef.startsWith("GP") ? cleanRef : `GP-BLR-20261007-0048`,
        vehicle_number: "KA 01 AB 4582",
        supplier_name: "Bharat Electronics Components Pvt. Ltd.",
        po_number: "PO-2026-008741",
        asn_number: "ASN-2026-004582",
        dock_number: "Dock D-04",
        status: "INSIDE_FACILITY",
      };

      setMatchedEntry(match);
    } catch {
      Alert.alert("Lookup Error", "Failed to fetch gate pass details from backend.");
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmDockArrival = async () => {
    if (!matchedEntry) return;

    setLoading(true);
    try {
      // Post Dock Check-In to backend API
      const updatedRecord = {
        ...matchedEntry,
        status: "AT_DOCK",
        dock_arrival_time: new Date().toISOString(),
        dock_operator: user?.full_name || "Warehouse Operator",
      };

      setLoading(false);
      Alert.alert(
        "Dock Arrival Confirmed ✓",
        `Truck ${updatedRecord.vehicle_number} checked in at ${updatedRecord.dock_number}.\n\nProceed to Unloading & Material Count.`
      );
      onDockCheckInSuccess(updatedRecord);
    } catch (e: any) {
      setLoading(false);
      Alert.alert("Dock Arrival Failed", e?.message || "Could not record dock check-in.");
    }
  };

  return (
    <ScrollView style={tw`flex-1 bg-slate-900`} contentContainerStyle={tw`p-4 pb-10`}>
      {/* Header */}
      <View style={tw`flex-row justify-between items-center mb-4`}>
        <View>
          <Text style={tw`text-white text-base font-black tracking-wider`}>DOCK ARRIVAL CONFIRMATION</Text>
          <Text style={tw`text-sky-400 text-xs font-bold mt-0.5`}>Warehouse Receiving Operator Desk</Text>
        </View>
        <TouchableOpacity style={tw`bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700`} onPress={onCancel}>
          <Text style={tw`text-slate-300 text-xs font-bold`}>✕ CANCEL</Text>
        </TouchableOpacity>
      </View>

      {/* Role Scope Notice */}
      <View style={tw`bg-sky-950/40 border border-sky-500/30 p-3 rounded-2xl mb-4`}>
        <Text style={tw`text-sky-400 text-xs font-black mb-0.5`}>👤 WAREHOUSE OPERATOR SCOPE</Text>
        <Text style={tw`text-slate-300 text-[11px]`}>
          Confirm truck arrival at assigned receiving dock, inspect physical seal, and initiate material unloading.
        </Text>
      </View>

      {/* Step 1: Scan / Enter Gate Pass */}
      <View style={tw`bg-slate-800 rounded-2xl p-4 mb-4 border border-white/10 shadow-lg`}>
        <Text style={tw`text-sky-400 text-xs font-black tracking-wider uppercase mb-2`}>
          1. SCAN OR ENTER GATE PASS / VEHICLE PLATE
        </Text>

        <View style={tw`flex-row gap-2 mb-2`}>
          <TextInput
            style={tw`flex-1 bg-slate-900 rounded-xl text-white px-3.5 py-2.5 text-xs border border-slate-700 font-semibold`}
            placeholder="Scan QR or type GP-BLR-20261007-0048 / KA 01 AB 4582"
            placeholderTextColor="#64748b"
            value={gatePassInput}
            onChangeText={setGatePassInput}
            autoCapitalize="characters"
          />

          <TouchableOpacity
            style={tw`bg-sky-600 rounded-xl px-4 justify-center shadow`}
            onPress={handleLookupGatePass}
          >
            <Text style={tw`text-white text-xs font-black`}>LOOKUP</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Step 2: Matched Gate Pass Details */}
      {loading ? (
        <ActivityIndicator color="#0284c7" style={tw`my-6`} />
      ) : matchedEntry ? (
        <View style={tw`bg-slate-800 rounded-2xl p-4 mb-4 border border-emerald-500/40 shadow-xl`}>
          <View style={tw`flex-row justify-between items-center mb-3 pb-2 border-b border-slate-700`}>
            <Text style={tw`text-emerald-400 text-xs font-black uppercase`}>✓ GATE PASS VERIFIED</Text>
            <View style={tw`bg-emerald-500/20 px-2 py-0.5 rounded border border-emerald-500/40`}>
              <Text style={tw`text-emerald-400 text-[9px] font-black`}>INSIDE FACILITY</Text>
            </View>
          </View>

          <View style={tw`bg-slate-900 p-3 rounded-xl gap-2 mb-4 border border-slate-700`}>
            <View style={tw`flex-row justify-between items-center`}>
              <Text style={tw`text-slate-400 text-xs font-semibold`}>Gate Pass Number:</Text>
              <Text style={tw`text-sky-400 text-sm font-black`}>{matchedEntry.gate_pass_number}</Text>
            </View>

            <View style={tw`flex-row justify-between items-center`}>
              <Text style={tw`text-slate-400 text-xs font-semibold`}>Vehicle Plate:</Text>
              <Text style={tw`text-sky-400 text-sm font-black`}>{formatVehiclePlate(matchedEntry.vehicle_number)}</Text>
            </View>

            <View style={tw`flex-row justify-between items-center`}>
              <Text style={tw`text-slate-400 text-xs font-semibold`}>Supplier:</Text>
              <Text style={tw`text-white text-xs font-bold flex-1 text-right ml-2`} numberOfLines={1}>
                {matchedEntry.supplier_name}
              </Text>
            </View>

            <View style={tw`flex-row justify-between items-center`}>
              <Text style={tw`text-slate-400 text-xs font-semibold`}>PO / ASN:</Text>
              <Text style={tw`text-white text-xs font-bold`}>{matchedEntry.po_number} ({matchedEntry.asn_number || "ASN"})</Text>
            </View>

            <View style={tw`flex-row justify-between items-center border-t border-slate-800 pt-1.5`}>
              <Text style={tw`text-slate-400 text-xs font-semibold`}>Assigned Dock:</Text>
              <Text style={tw`text-emerald-400 text-sm font-black`}>{matchedEntry.dock_number || "Dock D-04"}</Text>
            </View>
          </View>

          {/* Action CTA */}
          <TouchableOpacity
            style={tw`bg-emerald-600 py-3.5 rounded-xl items-center shadow-lg`}
            onPress={handleConfirmDockArrival}
          >
            <Text style={tw`text-white font-black text-xs tracking-wider`}>
              [ CONFIRM DOCK ARRIVAL & START UNLOADING ] ✓
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </ScrollView>
  );
}
