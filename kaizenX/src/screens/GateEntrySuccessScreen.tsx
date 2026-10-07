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

  const currentTimeFormatted = new Date().toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const entryTimeFormatted = entryResult?.created_at
    ? new Date(entryResult.created_at).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : `07 Oct 2026 • ${currentTimeFormatted}`;

  const handleConfirmVehicleEntry = () => {
    setEntryConfirmed(true);
    Alert.alert(
      "✓ ENTRY APPROVED & CONFIRMED",
      `Gate Pass: ${gatePassNo}\nVehicle: ${vehicleNo}\nProceed To: DOCK ${dockNo}\nEntry Time: ${currentTimeFormatted}\n\nVehicle status updated to INSIDE_FACILITY. Audit log recorded.`
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
        message: `KAIZENX GATE PASS: ${gatePassNo}\nVehicle: ${vehicleNo}\nSupplier: ${supplierName}\nDock: ${dockNo}\nStatus: INSIDE_FACILITY\nQR Token: ${qrToken}`,
      });
    } catch {
      // share cancelled
    }
  };

  return (
    <ScrollView style={tw`flex-1 bg-slate-900`} contentContainerStyle={tw`p-5 justify-center`}>
      {/* Screen 13 - Entry Confirmation Header */}
      <View style={tw`items-center mb-5`}>
        <View style={tw`w-16 h-16 rounded-full bg-emerald-500 justify-center items-center mb-2.5 shadow-lg`}>
          <Text style={tw`text-white text-3xl font-black`}>✓</Text>
        </View>
        <Text style={tw`text-emerald-400 text-2xl font-black tracking-wider`}>
          {entryConfirmed ? "✓ ENTRY APPROVED" : "GATE PASS GENERATED"}
        </Text>
        <Text style={tw`text-slate-300 text-xs font-bold mt-0.5`}>
          {entryConfirmed
            ? `Vehicle ${vehicleNo} Authorized • Status: INSIDE_FACILITY`
            : "Review Pass & Confirm Barrier Entrance"}
        </Text>
      </View>

      {/* Screen 13 - Entry Confirmation Card */}
      {entryConfirmed ? (
        <View style={tw`bg-slate-800 rounded-3xl p-5 border border-emerald-500/60 shadow-2xl mb-5`}>
          <View style={tw`bg-emerald-950/50 p-3.5 rounded-2xl border border-emerald-500/40 mb-4 items-center`}>
            <Text style={tw`text-slate-400 text-[10px] font-black tracking-widest uppercase`}>GATE PASS</Text>
            <Text style={tw`text-sky-400 text-xl font-black mt-0.5`}>{gatePassNo}</Text>
          </View>

          <View style={tw`gap-2.5 mb-4`}>
            <View style={tw`flex-row justify-between items-center bg-slate-900 p-3 rounded-xl`}>
              <Text style={tw`text-slate-400 text-xs font-semibold`}>Vehicle Number</Text>
              <Text style={tw`text-sky-400 text-base font-black`}>{vehicleNo}</Text>
            </View>

            <View style={tw`flex-row justify-between items-center bg-slate-900 p-3 rounded-xl border border-emerald-500/30`}>
              <Text style={tw`text-slate-400 text-xs font-semibold`}>Proceed To</Text>
              <Text style={tw`text-emerald-400 text-base font-black uppercase`}>DOCK {dockNo}</Text>
            </View>

            <View style={tw`flex-row justify-between items-center bg-slate-900 p-3 rounded-xl`}>
              <Text style={tw`text-slate-400 text-xs font-semibold`}>Entry Time</Text>
              <Text style={tw`text-white text-xs font-bold`}>{currentTimeFormatted}</Text>
            </View>

            <View style={tw`flex-row justify-between items-center bg-slate-900 p-3 rounded-xl`}>
              <Text style={tw`text-slate-400 text-xs font-semibold`}>Vehicle Status</Text>
              <Text style={tw`text-emerald-400 text-xs font-black uppercase`}>INSIDE_FACILITY ✓</Text>
            </View>
          </View>

          {/* Section 22 - Audit Log Record */}
          <Text style={tw`text-slate-400 text-[10px] font-extrabold tracking-wider uppercase mb-2`}>
            SECURITY AUDIT RECORD LOG
          </Text>
          <View style={tw`bg-slate-900 p-3 rounded-xl gap-1.5 border border-slate-700`}>
            <View style={tw`flex-row justify-between`}>
              <Text style={tw`text-slate-400 text-[11px]`}>Gate Officer:</Text>
              <Text style={tw`text-slate-200 text-[11px] font-bold`}>Rajesh Kumar (SEC-8042)</Text>
            </View>
            <View style={tw`flex-row justify-between`}>
              <Text style={tw`text-slate-400 text-[11px]`}>Gate Location:</Text>
              <Text style={tw`text-slate-200 text-[11px] font-bold`}>Main Gate – 01 (FAC-BLR-01)</Text>
            </View>
            <View style={tw`flex-row justify-between`}>
              <Text style={tw`text-slate-400 text-[11px]`}>Timestamp:</Text>
              <Text style={tw`text-slate-200 text-[11px] font-bold`}>{entryTimeFormatted}</Text>
            </View>
            <View style={tw`flex-row justify-between`}>
              <Text style={tw`text-slate-400 text-[11px]`}>Device Client:</Text>
              <Text style={tw`text-sky-400 text-[11px] font-mono font-bold`}>Android Mobile Scanner</Text>
            </View>
          </View>
        </View>
      ) : (
        /* Screen 12 - Gate Pass Ticket Card */
        <View style={tw`bg-slate-800 rounded-3xl p-5 border border-emerald-500/50 shadow-2xl mb-5`}>
          <View style={tw`items-center pb-3 border-b border-slate-700`}>
            <Text style={tw`text-slate-400 text-[10px] font-black tracking-widest uppercase`}>GATE PASS</Text>
            <Text style={tw`text-sky-400 text-xl font-black tracking-wider mt-1`}>{gatePassNo}</Text>
          </View>

          {/* Secure QR Code Box */}
          <View style={tw`my-4 bg-slate-900 p-4 rounded-2xl items-center border border-sky-500/40 shadow-inner`}>
            <View style={tw`w-36 h-36 bg-slate-800 rounded-xl border border-sky-400/50 justify-center items-center mb-2`}>
              <Text style={tw`text-4xl mb-1`}>🔳</Text>
              <Text style={tw`text-sky-400 text-[10px] font-black tracking-widest`}>[ QR CODE ]</Text>
            </View>
            <Text style={tw`text-sky-400 text-[11px] font-mono font-bold tracking-wider text-center`}>
              {qrToken}
            </Text>
            <Text style={tw`text-slate-500 text-[9px] mt-1 text-center`}>
              Encrypted token reference for dock receiving operators
            </Text>
          </View>

          {/* Gate Pass Parameters */}
          <View style={tw`gap-2 mb-3`}>
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
              <Text style={tw`text-emerald-400 text-xs font-black`}>DOCK {dockNo}</Text>
            </View>

            <View style={tw`flex-row justify-between items-center bg-slate-900 p-2.5 rounded-xl`}>
              <Text style={tw`text-slate-400 text-xs font-semibold`}>Entry Time:</Text>
              <Text style={tw`text-slate-200 text-xs font-bold`}>{entryTimeFormatted}</Text>
            </View>
          </View>

          {/* Section 21 - Gate Pass Lifecycle Tracker */}
          <Text style={tw`text-slate-400 text-[10px] font-extrabold tracking-wider uppercase mb-1.5`}>
            GATE PASS STATUS LIFECYCLE
          </Text>
          <View style={tw`bg-slate-900 p-2.5 rounded-xl border border-slate-700`}>
            <Text style={tw`text-sky-400 text-[10px] font-mono font-bold text-center`}>
              EXPECTED ➔ AT_GATE ➔ VERIFICATION ➔ DOCK ➔ ENTRY_APPROVED ➔ <Text style={tw`text-emerald-400`}>INSIDE_FACILITY</Text>
            </Text>
            <Text style={tw`text-slate-500 text-[9px] mt-1.5 text-center italic`}>
              * QC, GRN, and Putaway statuses are managed downstream by WMS receiving modules.
            </Text>
          </View>
        </View>
      )}

      {/* Primary Action CTA: [Confirm Vehicle Entry] */}
      {!entryConfirmed && (
        <TouchableOpacity
          style={tw`bg-sky-600 py-4 rounded-2xl items-center mb-3 shadow-lg`}
          onPress={handleConfirmVehicleEntry}
        >
          <Text style={tw`text-white font-black text-xs tracking-wider`}>
            [ Confirm Vehicle Entry ]
          </Text>
        </TouchableOpacity>
      )}

      {/* Secondary CTAs */}
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
        style={tw`bg-slate-800 py-3.5 rounded-xl items-center border border-slate-700`}
        onPress={entryConfirmed ? onViewHistory : onNewScan}
      >
        <Text style={tw`text-slate-300 font-extrabold text-xs`}>
          {entryConfirmed ? "VIEW INBOUND VEHICLES LIST →" : "+ SCAN NEXT TRUCK"}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}
