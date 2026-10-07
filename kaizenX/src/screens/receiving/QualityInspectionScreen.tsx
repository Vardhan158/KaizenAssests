import React, { useState } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  Image,
  ActivityIndicator,
} from "react-native";
import tw from "twrnc";
import { launchCamera } from "react-native-image-picker";
import { formatVehiclePlate } from "../../utils/vehicleFormatter";

interface QualityInspectionScreenProps {
  unloadedRecord?: any;
  onQcDecisionSubmit: (result: any) => void;
  onCancel: () => void;
  user?: any;
}

export function QualityInspectionScreen({
  unloadedRecord,
  onQcDecisionSubmit,
  onCancel,
  user,
}: QualityInspectionScreenProps) {
  const [inspectedQty, setInspectedQty] = useState(
    String(unloadedRecord?.received_quantity || "500")
  );
  const [acceptedQty, setAcceptedQty] = useState("480");
  const [rejectedQty, setRejectedQty] = useState("20");
  const [holdQty, setHoldQty] = useState("0");
  const [defectReason, setDefectReason] = useState<
    "Dimension Tolerance Exceeded" | "Surface Scratch / Dent" | "Moisture Damage" | "Wrong Material / Grade" | "Packaging Damage" | "Other"
  >("Surface Scratch / Dent");
  const [qcNotes, setQcNotes] = useState("");
  const [qcPhotoUri, setQcPhotoUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleCaptureQcPhoto = async () => {
    try {
      const response = await launchCamera({
        mediaType: "photo",
        cameraType: "back",
        quality: 0.8,
        saveToPhotos: false,
      });

      if (response.assets && response.assets.length > 0) {
        setQcPhotoUri(response.assets[0].uri || null);
        Alert.alert("QC Defect Photo Attached ✓", "Photograph of material defect attached to inspection record.");
      }
    } catch {
      Alert.alert("Camera Error", "Could not capture photograph.");
    }
  };

  const handleSubmitQcDecision = () => {
    const insp = Number(inspectedQty) || 0;
    const acc = Number(acceptedQty) || 0;
    const rej = Number(rejectedQty) || 0;
    const hld = Number(holdQty) || 0;

    if (acc + rej + hld !== insp) {
      Alert.alert(
        "Quantity Mismatch",
        `Accepted (${acc}) + Rejected (${rej}) + Hold (${hld}) = ${acc + rej + hld} KG, which does not equal Inspected Qty (${insp} KG).`
      );
      return;
    }

    setSubmitting(true);

    const isPassed = rej === 0 && hld === 0;
    const isRejected = acc === 0;
    const qcStatus = isPassed ? "QUALITY_PASSED" : isRejected ? "QUALITY_REJECTED" : "QUALITY_PARTIAL_HOLD";

    const qcRecord = {
      ...unloadedRecord,
      status: qcStatus,
      inspected_by: user?.full_name || "Quality Inspector",
      inspected_quantity: insp,
      accepted_quantity: acc,
      rejected_quantity: rej,
      hold_quantity: hld,
      defect_reason: defectReason,
      qc_notes: qcNotes.trim(),
      qc_photo_uri: qcPhotoUri,
      inspected_at: new Date().toISOString(),
    };

    setTimeout(() => {
      setSubmitting(false);
      Alert.alert(
        `QC Decision Submitted: ${qcStatus} ✓`,
        `Inspection for ${qcRecord.vehicle_number || "KA 01 AB 4582"} completed.\n\nAccepted: ${acc} KG\nRejected: ${rej} KG\nHold: ${hld} KG\n\nSubmitted to Storekeeper for GRN posting.`
      );
      onQcDecisionSubmit(qcRecord);
    }, 600);
  };

  return (
    <ScrollView style={tw`flex-1 bg-slate-900`} contentContainerStyle={tw`p-4 pb-10`}>
      {/* Header */}
      <View style={tw`flex-row justify-between items-center mb-4`}>
        <View>
          <Text style={tw`text-white text-base font-black tracking-wider`}>QUALITY INSPECTION (QC)</Text>
          <Text style={tw`text-sky-400 text-xs font-bold mt-0.5`}>Quality Control Desk • Inspector App</Text>
        </View>
        <TouchableOpacity style={tw`bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700`} onPress={onCancel}>
          <Text style={tw`text-slate-300 text-xs font-bold`}>✕ CANCEL</Text>
        </TouchableOpacity>
      </View>

      {/* Role Scope Notice */}
      <View style={tw`bg-cyan-950/40 border border-cyan-500/30 p-3 rounded-2xl mb-4`}>
        <Text style={tw`text-cyan-400 text-xs font-black mb-0.5`}>🔬 QUALITY INSPECTOR SCOPE</Text>
        <Text style={tw`text-slate-300 text-[11px]`}>
          Inspect received material, record Accepted, Rejected, and Hold quantities, log defect reasons, and attach defect photographs.
        </Text>
      </View>

      {/* Section 20 - Material Summary Banner */}
      <View style={tw`bg-slate-800 rounded-2xl p-4 mb-4 border border-sky-500/30 shadow-lg`}>
        <View style={tw`flex-row justify-between items-center mb-1`}>
          <Text style={tw`text-sky-400 text-xs font-black tracking-wider uppercase`}>
            QC MATERIAL INSPECTION (SECTION 20)
          </Text>
          <View style={tw`bg-emerald-500/20 px-2 py-0.5 rounded border border-emerald-500/40`}>
            <Text style={tw`text-emerald-400 text-[9px] font-black`}>INSPECTION REQUIRED: YES</Text>
          </View>
        </View>

        <Text style={tw`text-white text-base font-black`}>
          Stainless Steel Sheet 304
        </Text>
        <Text style={tw`text-sky-400 text-xs font-mono font-bold mt-0.5`}>
          Material Code: MAT-SS-304-001
        </Text>

        <View style={tw`bg-slate-900 p-3 rounded-xl mt-3 border border-slate-700 gap-1.5`}>
          <View style={tw`flex-row justify-between`}>
            <Text style={tw`text-slate-400 text-xs`}>PO Quantity:</Text>
            <Text style={tw`text-white text-xs font-bold`}>500 KG</Text>
          </View>

          <View style={tw`flex-row justify-between`}>
            <Text style={tw`text-slate-400 text-xs`}>Physically Received Qty:</Text>
            <Text style={tw`text-emerald-400 text-xs font-black`}>
              {unloadedRecord?.received_quantity || 495} KG
            </Text>
          </View>

          <View style={tw`flex-row justify-between border-t border-slate-800 pt-1`}>
            <Text style={tw`text-slate-400 text-xs`}>Supplier Batch Number:</Text>
            <Text style={tw`text-sky-400 text-xs font-mono font-bold`}>
              {unloadedRecord?.supplier_batch || "BATCH-SS-1045"}
            </Text>
          </View>
        </View>
      </View>

      {/* Inspection Quantities Form */}
      <View style={tw`bg-slate-800 rounded-2xl p-4 mb-4 border border-white/10 shadow-xl`}>
        <Text style={tw`text-sky-400 text-xs font-black tracking-wider uppercase mb-3`}>
          INSPECTION QUANTITY DISPOSITION (KG)
        </Text>

        <View style={tw`mb-3`}>
          <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mb-1 uppercase`}>
            TOTAL INSPECTED QUANTITY *
          </Text>
          <TextInput
            style={tw`bg-slate-900 rounded-xl text-white text-sm font-black px-3.5 py-2.5 border border-slate-700`}
            value={inspectedQty}
            onChangeText={setInspectedQty}
            keyboardType="numeric"
          />
        </View>

        <View style={tw`flex-row gap-2 mb-3`}>
          <View style={tw`flex-1`}>
            <Text style={tw`text-emerald-400 text-[10px] font-black tracking-wider mb-1 uppercase`}>
              ACCEPTED QTY *
            </Text>
            <TextInput
              style={tw`bg-slate-900 rounded-xl text-emerald-400 text-sm font-black px-3 py-2.5 border border-slate-700`}
              value={acceptedQty}
              onChangeText={setAcceptedQty}
              keyboardType="numeric"
            />
          </View>

          <View style={tw`flex-1`}>
            <Text style={tw`text-red-400 text-[10px] font-black tracking-wider mb-1 uppercase`}>
              REJECTED QTY *
            </Text>
            <TextInput
              style={tw`bg-slate-900 rounded-xl text-red-400 text-sm font-black px-3 py-2.5 border border-slate-700`}
              value={rejectedQty}
              onChangeText={setRejectedQty}
              keyboardType="numeric"
            />
          </View>

          <View style={tw`flex-1`}>
            <Text style={tw`text-amber-400 text-[10px] font-black tracking-wider mb-1 uppercase`}>
              HOLD QTY
            </Text>
            <TextInput
              style={tw`bg-slate-900 rounded-xl text-amber-400 text-sm font-black px-3 py-2.5 border border-slate-700`}
              value={holdQty}
              onChangeText={setHoldQty}
              keyboardType="numeric"
            />
          </View>
        </View>

        {/* Defect Reason Selector */}
        {Number(rejectedQty) > 0 || Number(holdQty) > 0 ? (
          <View style={tw`mb-3`}>
            <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mb-1.5 uppercase`}>
              DEFECT REASON *
            </Text>
            <View style={tw`flex-row flex-wrap gap-1.5`}>
              {[
                "Surface Scratch / Dent",
                "Dimension Tolerance Exceeded",
                "Moisture Damage",
                "Wrong Material / Grade",
                "Packaging Damage",
                "Other",
              ].map((dr) => {
                const active = defectReason === dr;
                return (
                  <TouchableOpacity
                    key={dr}
                    style={tw`px-2.5 py-1.5 rounded-lg border ${
                      active
                        ? "bg-red-600 border-red-500"
                        : "bg-slate-900 border-slate-700"
                    }`}
                    onPress={() => setDefectReason(dr as any)}
                  >
                    <Text style={tw`text-[11px] font-bold ${active ? "text-white" : "text-slate-400"}`}>
                      {dr}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ) : null}

        {/* QC Notes & Defect Photograph */}
        <View style={tw`mb-3`}>
          <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mb-1 uppercase`}>
            QUALITY INSPECTION NOTES
          </Text>
          <TextInput
            style={tw`bg-slate-900 rounded-xl text-white px-3.5 py-2.5 text-xs border border-slate-700`}
            placeholder="e.g. Minor corner burr on 20 sheets, grade certificate verified"
            placeholderTextColor="#64748b"
            value={qcNotes}
            onChangeText={setQcNotes}
          />
        </View>

        <TouchableOpacity
          style={tw`bg-slate-900 py-3 rounded-xl border border-slate-700 items-center flex-row justify-center gap-2 mb-2`}
          onPress={handleCaptureQcPhoto}
        >
          <Text style={tw`text-cyan-400 text-sm`}>📷</Text>
          <Text style={tw`text-cyan-400 text-xs font-black`}>
            {qcPhotoUri ? "✓ RETAKE QC DEFECT PHOTO" : "CAPTURE DEFECT PHOTOGRAPH"}
          </Text>
        </TouchableOpacity>

        {qcPhotoUri && (
          <View style={tw`mt-2 bg-slate-900 p-2 rounded-xl border border-cyan-500/40 items-center mb-2`}>
            <Image source={{ uri: qcPhotoUri }} style={tw`w-24 h-24 rounded-lg`} />
            <Text style={tw`text-cyan-400 text-[10px] font-bold mt-1`}>QC Defect Photo Attached ✓</Text>
          </View>
        )}
      </View>

      {/* Submit QC Decision CTA */}
      <TouchableOpacity
        style={tw`bg-cyan-600 py-4 rounded-2xl items-center shadow-lg ${
          submitting ? "opacity-60" : ""
        }`}
        onPress={handleSubmitQcDecision}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={tw`text-white font-black text-xs tracking-wider`}>
            [ SUBMIT QUALITY INSPECTION DECISION ] ✓
          </Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}
