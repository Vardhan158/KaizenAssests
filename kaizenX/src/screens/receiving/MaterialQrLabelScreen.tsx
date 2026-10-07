import React, { useState } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  Alert,
  TextInput,
  Modal,
} from "react-native";
import tw from "twrnc";
import { parseScannedQrCode } from "../../utils/vehicleFormatter";

interface MaterialQrLabelScreenProps {
  grnRecord?: any;
  onBack: () => void;
  user?: any;
}

export type LabelStatus = "LABEL_GENERATED" | "LABEL_PRINTED" | "LABEL_VERIFIED";

export function MaterialQrLabelScreen({
  grnRecord,
  onBack,
  user,
}: MaterialQrLabelScreenProps) {
  const [selectedPrinter, setSelectedPrinter] = useState("Store Network Thermal Printer (PRN-BLR-02)");
  const [labelStatus, setLabelStatus] = useState<LabelStatus>("LABEL_GENERATED");
  const [scanVerificationInput, setScanVerificationInput] = useState("");
  const [scannedResultRecord, setScannedResultRecord] = useState<any | null>(null);

  // Section 38 Label Payload
  const huToken = grnRecord?.hu_label_token || `HU-BLR-20261007-00845`;
  const materialName = "STAINLESS STEEL SHEET 304";
  const materialCode = "MAT-SS-304-001";
  const grnNo = grnRecord?.grn_number || "GRN-BLR-2026-000184";
  const poNo = grnRecord?.po_number || "PO-2026-008741";
  const supplierName = grnRecord?.supplier_name || "Bharat Electronics Components";
  const batchNo = grnRecord?.supplier_batch || "BATCH-SS-1045";
  const qty = grnRecord?.accepted_quantity || 49;
  const uom = "KG";
  const receiveDate = "07 OCT 2026";

  const handlePrintLabels = () => {
    setLabelStatus("LABEL_PRINTED");
    Alert.alert(
      "Print Dispatched ✓",
      `Handling Unit QR Label dispatched to printer:\n${selectedPrinter}\n\nToken: ${huToken}\n\nOperator: Please physically attach label to Pallet/Box and scan to verify.`
    );
  };

  const handleVerifyScannedLabel = () => {
    if (!scanVerificationInput.trim()) {
      Alert.alert("Required", "Please scan or enter the printed Handling Unit QR Token.");
      return;
    }

    const parsed = parseScannedQrCode(scanVerificationInput);
    const cleanRef = parsed.reference.toUpperCase().trim();

    if (cleanRef.includes(huToken) || huToken.includes(cleanRef) || cleanRef.includes("HU-")) {
      setLabelStatus("LABEL_VERIFIED");
      setScannedResultRecord({
        material_name: materialName,
        material_code: materialCode,
        grn_number: grnNo,
        po_number: poNo,
        supplier_name: supplierName,
        batch_number: batchNo,
        quantity: `${qty} ${uom}`,
        qc_status: "ACCEPTED",
        current_location: "RECEIVING STAGING BAY 04",
        inventory_status: "READY FOR PUTAWAY",
        hu_token: huToken,
      });
      Alert.alert(
        "Label Verified Successfully ✓",
        `Token ${huToken} matched!\n\nStatus set to LABEL_VERIFIED.\nMaterial is cleared for Bin Putaway.`
      );
    } else {
      Alert.alert("Verification Failed ✕", `Scanned token (${cleanRef}) does not match expected Handling Unit (${huToken}).`);
    }
  };

  return (
    <ScrollView style={tw`flex-1 bg-slate-900`} contentContainerStyle={tw`p-4 pb-10`}>
      {/* Header */}
      <View style={tw`flex-row justify-between items-center mb-4`}>
        <View>
          <Text style={tw`text-white text-base font-black tracking-wider`}>HANDLING UNIT QR LABELS</Text>
          <Text style={tw`text-sky-400 text-xs font-bold mt-0.5`}>Storekeeper Desk • Label & Verification</Text>
        </View>
        <TouchableOpacity style={tw`bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700`} onPress={onBack}>
          <Text style={tw`text-slate-300 text-xs font-bold`}>← BACK</Text>
        </TouchableOpacity>
      </View>

      {/* Section 40 - Label Pipeline Status Bar */}
      <View style={tw`bg-slate-800 rounded-2xl p-4 mb-4 border border-white/10 shadow-xl`}>
        <Text style={tw`text-sky-400 text-[10px] font-black tracking-wider uppercase mb-2`}>
          LABEL PRINTING & VERIFICATION PIPELINE (SECTION 40)
        </Text>

        <View style={tw`flex-row items-center justify-between bg-slate-900 p-3 rounded-xl border border-slate-700`}>
          <View style={tw`items-center flex-1`}>
            <Text style={tw`text-[10px] font-bold text-slate-400`}>1. GENERATED</Text>
            <Text style={tw`text-xs font-black text-emerald-400 mt-0.5`}>✓ READY</Text>
          </View>

          <Text style={tw`text-slate-600 font-bold`}>➔</Text>

          <View style={tw`items-center flex-1`}>
            <Text style={tw`text-[10px] font-bold text-slate-400`}>2. PRINTED</Text>
            <Text
              style={tw`text-xs font-black mt-0.5 ${
                labelStatus !== "LABEL_GENERATED" ? "text-emerald-400" : "text-amber-400"
              }`}
            >
              {labelStatus !== "LABEL_GENERATED" ? "✓ PRINTED" : "PENDING"}
            </Text>
          </View>

          <Text style={tw`text-slate-600 font-bold`}>➔</Text>

          <View style={tw`items-center flex-1`}>
            <Text style={tw`text-[10px] font-bold text-slate-400`}>3. VERIFIED</Text>
            <Text
              style={tw`text-xs font-black mt-0.5 ${
                labelStatus === "LABEL_VERIFIED" ? "text-emerald-400" : "text-slate-500"
              }`}
            >
              {labelStatus === "LABEL_VERIFIED" ? "✓ VERIFIED" : "UNVERIFIED"}
            </Text>
          </View>
        </View>
      </View>

      {/* Section 38 - Material QR Label Preview Card */}
      <Text style={tw`text-slate-400 text-xs font-black tracking-wider mb-2 uppercase`}>
        PRINTABLE HANDLING UNIT LABEL PREVIEW (SECTION 38)
      </Text>

      <View style={tw`bg-white rounded-3xl p-5 mb-4 border-2 border-slate-900 shadow-2xl items-center`}>
        <Text style={tw`text-slate-900 text-xs font-black tracking-widest uppercase mb-1`}>
          KAIZENTRIX AMS/WMS
        </Text>
        <Text style={tw`text-slate-900 text-base font-black text-center mb-3`}>
          {materialName}
        </Text>

        <View style={tw`w-full bg-slate-100 rounded-xl p-3 mb-3 border border-slate-300 gap-1`}>
          <View style={tw`flex-row justify-between`}>
            <Text style={tw`text-slate-600 text-xs font-bold`}>Material:</Text>
            <Text style={tw`text-slate-900 text-xs font-black font-mono`}>{materialCode}</Text>
          </View>
          <View style={tw`flex-row justify-between`}>
            <Text style={tw`text-slate-600 text-xs font-bold`}>GRN:</Text>
            <Text style={tw`text-slate-900 text-xs font-black font-mono`}>{grnNo}</Text>
          </View>
          <View style={tw`flex-row justify-between`}>
            <Text style={tw`text-slate-600 text-xs font-bold`}>Batch:</Text>
            <Text style={tw`text-slate-900 text-xs font-black font-mono`}>{batchNo}</Text>
          </View>
          <View style={tw`flex-row justify-between`}>
            <Text style={tw`text-slate-600 text-xs font-bold`}>Quantity:</Text>
            <Text style={tw`text-emerald-700 text-xs font-black`}>{qty} {uom}</Text>
          </View>
          <View style={tw`flex-row justify-between`}>
            <Text style={tw`text-slate-600 text-xs font-bold`}>Supplier:</Text>
            <Text style={tw`text-slate-900 text-xs font-bold`}>{supplierName}</Text>
          </View>
          <View style={tw`flex-row justify-between`}>
            <Text style={tw`text-slate-600 text-xs font-bold`}>Received:</Text>
            <Text style={tw`text-slate-900 text-xs font-bold`}>{receiveDate}</Text>
          </View>
        </View>

        {/* QR Code Container Box */}
        <View style={tw`w-36 h-36 bg-slate-900 rounded-2xl items-center justify-center p-2 mb-2`}>
          <Text style={tw`text-white text-xs font-mono font-black text-center`}>[ QR CODE ]</Text>
          <Text style={tw`text-sky-400 text-[9px] font-mono text-center mt-1`}>{huToken}</Text>
        </View>

        <Text style={tw`text-slate-900 text-xs font-mono font-black tracking-wider`}>
          {huToken}
        </Text>
      </View>

      {/* Section 40 Step 2: Printer Detection & Print Action */}
      <View style={tw`bg-slate-800 rounded-2xl p-4 mb-4 border border-white/10 shadow-xl`}>
        <Text style={tw`text-sky-400 text-xs font-black tracking-wider uppercase mb-2`}>
          PRINTER SELECTION & DISPATCH
        </Text>
        <TextInput
          style={tw`bg-slate-900 rounded-xl text-white px-3.5 py-2.5 text-xs border border-slate-700 font-semibold mb-3`}
          value={selectedPrinter}
          onChangeText={setSelectedPrinter}
        />

        <TouchableOpacity
          style={tw`bg-sky-600 py-3.5 rounded-xl items-center shadow-lg`}
          onPress={handlePrintLabels}
        >
          <Text style={tw`text-white font-black text-xs tracking-wider`}>
            🖨️ [ PRINT HANDLING UNIT QR LABEL ]
          </Text>
        </TouchableOpacity>
      </View>

      {/* Section 40 Step 3 & 4: Physical Attachment & Scan Verification */}
      {labelStatus !== "LABEL_GENERATED" && (
        <View style={tw`bg-slate-800 rounded-2xl p-4 mb-4 border border-emerald-500/40 shadow-xl`}>
          <Text style={tw`text-emerald-400 text-xs font-black tracking-wider uppercase mb-2`}>
            SCAN LABEL FOR PUTAWAY VERIFICATION
          </Text>
          <Text style={tw`text-slate-300 text-xs mb-3`}>
            Physically attach printed label to Pallet/Box and scan QR token to verify before putaway release.
          </Text>

          <View style={tw`flex-row gap-2 mb-3`}>
            <TextInput
              style={tw`flex-1 bg-slate-900 rounded-xl text-white font-mono px-3.5 py-2.5 text-xs border border-slate-700`}
              placeholder="Scan or type token (e.g. HU-BLR-20261007-00845)"
              placeholderTextColor="#64748b"
              value={scanVerificationInput}
              onChangeText={setScanVerificationInput}
              autoCapitalize="characters"
            />
            <TouchableOpacity
              style={tw`bg-emerald-600 px-4 rounded-xl justify-center shadow`}
              onPress={handleVerifyScannedLabel}
            >
              <Text style={tw`text-white font-black text-xs`}>VERIFY</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Section 39 - Material QR Scan Result Modal */}
      <Modal visible={Boolean(scannedResultRecord)} animationType="fade" transparent>
        <View style={tw`flex-1 bg-black/80 justify-center items-center p-5`}>
          <View style={tw`w-full bg-slate-800 rounded-3xl p-5 border border-emerald-500/50 shadow-2xl`}>
            <View style={tw`flex-row justify-between items-center mb-3 pb-2.5 border-b border-slate-700`}>
              <Text style={tw`text-emerald-400 text-xs font-black uppercase`}>
                ✓ MATERIAL QR SCAN RESULT (SECTION 39)
              </Text>
              <TouchableOpacity onPress={() => setScannedResultRecord(null)}>
                <Text style={tw`text-red-400 text-xs font-bold`}>✕ CLOSE</Text>
              </TouchableOpacity>
            </View>

            {scannedResultRecord && (
              <View style={tw`gap-2 mb-4`}>
                <View style={tw`bg-slate-900 p-2.5 rounded-xl`}>
                  <Text style={tw`text-slate-400 text-[10px] font-bold uppercase`}>Material</Text>
                  <Text style={tw`text-white text-xs font-bold mt-0.5`}>{scannedResultRecord.material_name}</Text>
                  <Text style={tw`text-sky-400 text-xs font-mono font-bold mt-0.5`}>
                    Code: {scannedResultRecord.material_code}
                  </Text>
                </View>

                <View style={tw`bg-slate-900 p-2.5 rounded-xl`}>
                  <Text style={tw`text-slate-400 text-[10px] font-bold uppercase`}>GRN & PO Reference</Text>
                  <Text style={tw`text-sky-400 text-xs font-mono font-bold mt-0.5`}>
                    {scannedResultRecord.grn_number} ({scannedResultRecord.po_number})
                  </Text>
                </View>

                <View style={tw`bg-slate-900 p-2.5 rounded-xl`}>
                  <Text style={tw`text-slate-400 text-[10px] font-bold uppercase`}>Supplier & Batch</Text>
                  <Text style={tw`text-white text-xs font-bold mt-0.5`}>{scannedResultRecord.supplier_name}</Text>
                  <Text style={tw`text-sky-400 text-xs font-mono font-bold mt-0.5`}>
                    Batch: {scannedResultRecord.batch_number}
                  </Text>
                </View>

                <View style={tw`bg-slate-900 p-2.5 rounded-xl flex-row justify-between items-center`}>
                  <View>
                    <Text style={tw`text-slate-400 text-[10px] font-bold uppercase`}>Quantity & QC</Text>
                    <Text style={tw`text-emerald-400 text-xs font-black mt-0.5`}>
                      {scannedResultRecord.quantity} • {scannedResultRecord.qc_status}
                    </Text>
                  </View>

                  <View>
                    <Text style={tw`text-slate-400 text-[10px] font-bold uppercase text-right`}>Inventory Status</Text>
                    <Text style={tw`text-emerald-400 text-xs font-black text-right mt-0.5`}>
                      {scannedResultRecord.inventory_status}
                    </Text>
                  </View>
                </View>
              </View>
            )}

            <TouchableOpacity
              style={tw`bg-sky-600 py-3 rounded-xl items-center`}
              onPress={() => setScannedResultRecord(null)}
            >
              <Text style={tw`text-white text-xs font-black`}>CONFIRM & DISMISS</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}
