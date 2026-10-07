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

export type QcResultType = "ACCEPTED" | "PARTIALLY_ACCEPTED" | "REJECTED" | "ON_HOLD";

export function QualityInspectionScreen({
  unloadedRecord,
  onQcDecisionSubmit,
  onCancel,
  user,
}: QualityInspectionScreenProps) {
  // Section 22 Quantities
  const [inspectedQty, setInspectedQty] = useState(
    String(unloadedRecord?.received_quantity || "495")
  );
  const [acceptedQty, setAcceptedQty] = useState("490");
  const [rejectedQty, setRejectedQty] = useState("5");
  const [holdQty, setHoldQty] = useState("0");

  // Section 23 Disposition Result
  const [qcResult, setQcResult] = useState<QcResultType>("PARTIALLY_ACCEPTED");

  // Section 21 Inspection Parameters
  const [thicknessMeasured, setThicknessMeasured] = useState("2.02");
  const [surfaceCondition, setSurfaceCondition] = useState<"PASS" | "FAIL">("PASS");
  const [dimensions, setDimensions] = useState<"PASS" | "FAIL">("PASS");
  const [materialGrade, setMaterialGrade] = useState<"PASS" | "FAIL">("PASS");
  const [certVerification, setCertVerification] = useState<"PASS" | "FAIL">("PASS");
  const [packagingStatus, setPackagingStatus] = useState<"PASS" | "FAIL">("PASS");

  // Section 24 Rejection Reason Categories
  const [rejectionReason, setRejectionReason] = useState<
    | "Damaged"
    | "Wrong Material"
    | "Wrong Specification"
    | "Dimensional Failure"
    | "Quality Failure"
    | "Expired Material"
    | "Packaging Failure"
    | "Quantity Mismatch"
    | "Contamination"
    | "Other"
  >("Dimensional Failure");

  // Section 25 Hold Reasons
  const [holdReason, setHoldReason] = useState<
    | "Lab Test Required"
    | "Certificate Pending"
    | "Specification Verification"
    | "Manager Review"
    | "Supplier Clarification"
  >("Specification Verification");

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

    // Section 22 Rule Check: Accepted + Rejected + Hold == Inspected
    if (acc + rej + hld !== insp) {
      Alert.alert(
        "Section 22 Rule Error",
        `Accepted (${acc}) + Rejected (${rej}) + Hold (${hld}) = ${acc + rej + hld} KG, which does not equal Total Inspected Qty (${insp} KG).`
      );
      return;
    }

    setSubmitting(true);

    const qcRecord = {
      ...unloadedRecord,
      qc_result: qcResult,
      status: `QC_${qcResult}`,
      inspected_by: user?.full_name || "Priya Sharma (QC Inspector)",
      inspected_quantity: insp,
      accepted_quantity: acc,
      rejected_quantity: rej,
      hold_quantity: hld,
      rejection_reason: rej > 0 ? rejectionReason : null,
      hold_reason: hld > 0 ? holdReason : null,
      inspection_plan: {
        thickness_measured: thicknessMeasured,
        thickness_pass: Number(thicknessMeasured) >= 1.95 && Number(thicknessMeasured) <= 2.05,
        surface_condition: surfaceCondition,
        dimensions,
        material_grade: materialGrade,
        certificate_verification: certVerification,
        packaging_status: packagingStatus,
      },
      qc_notes: qcNotes.trim(),
      qc_photo_uri: qcPhotoUri,
      inspected_at: new Date().toISOString(),
    };

    setTimeout(() => {
      setSubmitting(false);
      Alert.alert(
        `QC Decision Submitted: ${qcResult} ✓`,
        `Inspection for ${qcRecord.vehicle_number || "KA 01 AB 4582"} finalized.\n\nAccepted: ${acc} KG\nRejected (Quarantined): ${rej} KG\nHold: ${hld} KG\n\nRecord released to Storekeeper for GRN posting.`
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
          <Text style={tw`text-cyan-400 text-xs font-bold mt-0.5`}>Quality Control Desk • Inspector App</Text>
        </View>
        <TouchableOpacity style={tw`bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700`} onPress={onCancel}>
          <Text style={tw`text-slate-300 text-xs font-bold`}>✕ CANCEL</Text>
        </TouchableOpacity>
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

      {/* Section 21 - Inspection Parameters (Quality Plan) */}
      <View style={tw`bg-slate-800 rounded-2xl p-4 mb-4 border border-white/10 shadow-xl`}>
        <Text style={tw`text-sky-400 text-xs font-black tracking-wider uppercase mb-3`}>
          1. QUALITY PLAN INSPECTION PARAMETERS (SECTION 21)
        </Text>

        {/* Thickness Param */}
        <View style={tw`bg-slate-900 p-3 rounded-xl mb-2.5 border border-slate-700`}>
          <View style={tw`flex-row justify-between items-center mb-1`}>
            <Text style={tw`text-slate-300 text-xs font-bold`}>Thickness (Required: 2.00 ± 0.05 mm)</Text>
            <Text style={tw`text-emerald-400 text-xs font-black`}>✓ PASS</Text>
          </View>
          <View style={tw`flex-row items-center gap-2 mt-1`}>
            <Text style={tw`text-slate-400 text-[10px]`}>Measured Value:</Text>
            <TextInput
              style={tw`flex-1 bg-slate-800 text-white font-mono px-3 py-1.5 rounded text-xs border border-slate-700`}
              value={thicknessMeasured}
              onChangeText={setThicknessMeasured}
              keyboardType="numeric"
            />
          </View>
        </View>

        {/* Parameter Checklist */}
        <View style={tw`gap-1.5`}>
          {[
            { label: "Surface Condition", state: surfaceCondition, setFn: setSurfaceCondition },
            { label: "Dimensions", state: dimensions, setFn: setDimensions },
            { label: "Material Grade", state: materialGrade, setFn: setMaterialGrade },
            { label: "Certificate Verification", state: certVerification, setFn: setCertVerification },
            { label: "Packaging Condition", state: packagingStatus, setFn: setPackagingStatus },
          ].map((param, idx) => (
            <View key={idx} style={tw`flex-row justify-between items-center bg-slate-900 px-3 py-2 rounded-xl`}>
              <Text style={tw`text-slate-300 text-xs font-semibold`}>{param.label}</Text>
              <View style={tw`flex-row gap-1`}>
                <TouchableOpacity
                  style={tw`px-2.5 py-1 rounded ${
                    param.state === "PASS" ? "bg-emerald-600" : "bg-slate-800"
                  }`}
                  onPress={() => param.setFn("PASS")}
                >
                  <Text style={tw`text-white text-[10px] font-black`}>PASS</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={tw`px-2.5 py-1 rounded ${
                    param.state === "FAIL" ? "bg-red-600" : "bg-slate-800"
                  }`}
                  onPress={() => param.setFn("FAIL")}
                >
                  <Text style={tw`text-white text-[10px] font-black`}>FAIL</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      </View>

      {/* Section 22 & 23 - QC Disposition & Quantity Rule */}
      <View style={tw`bg-slate-800 rounded-2xl p-4 mb-4 border border-white/10 shadow-xl`}>
        <Text style={tw`text-sky-400 text-xs font-black tracking-wider uppercase mb-2`}>
          2. QC DISPOSITION RESULT (SECTION 23)
        </Text>

        <View style={tw`flex-row flex-wrap gap-1.5 mb-3`}>
          {[
            { id: "ACCEPTED", label: "ACCEPTED" },
            { id: "PARTIALLY_ACCEPTED", label: "PARTIALLY ACCEPTED" },
            { id: "REJECTED", label: "REJECTED" },
            { id: "ON_HOLD", label: "ON HOLD" },
          ].map((r) => {
            const active = qcResult === r.id;
            return (
              <TouchableOpacity
                key={r.id}
                style={tw`px-3 py-1.5 rounded-lg border ${
                  active
                    ? r.id === "ACCEPTED"
                      ? "bg-emerald-600 border-emerald-500"
                      : r.id === "REJECTED"
                      ? "bg-red-600 border-red-500"
                      : "bg-amber-600 border-amber-500"
                    : "bg-slate-900 border-slate-700"
                }`}
                onPress={() => setQcResult(r.id as any)}
              >
                <Text style={tw`text-xs font-bold ${active ? "text-white" : "text-slate-400"}`}>
                  {r.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Section 22 Quantity Rule */}
        <Text style={tw`text-sky-400 text-xs font-black tracking-wider uppercase mb-2`}>
          3. DISPOSITION QUANTITIES (SECTION 22)
        </Text>

        <View style={tw`mb-2.5`}>
          <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mb-1 uppercase`}>
            TOTAL INSPECTED QTY (KG) *
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
              ACCEPTED *
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
              REJECTED *
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

        <Text style={tw`text-slate-500 text-[10px] italic text-center mb-2`}>
          * Enforced Rule: Accepted ({acceptedQty}) + Rejected ({rejectedQty}) + Hold ({holdQty}) = Total Inspected ({inspectedQty})
        </Text>

        {/* Section 24 - Rejected Material Reason & Quarantine Rule */}
        {Number(rejectedQty) > 0 && (
          <View style={tw`bg-red-950/40 border border-red-500/50 p-3 rounded-xl mb-3`}>
            <Text style={tw`text-red-400 text-xs font-black uppercase mb-1`}>
              ⚠️ REJECTED MATERIAL CATEGORY (SECTION 24)
            </Text>
            <Text style={tw`text-red-200 text-[10px] mb-2`}>
              * Rejected material will be quarantined and NOT become unrestricted available inventory.
            </Text>

            <View style={tw`flex-row flex-wrap gap-1.5`}>
              {[
                "Damaged",
                "Wrong Material",
                "Wrong Specification",
                "Dimensional Failure",
                "Quality Failure",
                "Expired Material",
                "Packaging Failure",
                "Quantity Mismatch",
                "Contamination",
                "Other",
              ].map((rr) => {
                const active = rejectionReason === rr;
                return (
                  <TouchableOpacity
                    key={rr}
                    style={tw`px-2 py-1 rounded border ${
                      active ? "bg-red-600 border-red-500" : "bg-slate-900 border-slate-700"
                    }`}
                    onPress={() => setRejectionReason(rr as any)}
                  >
                    <Text style={tw`text-[10px] font-bold ${active ? "text-white" : "text-slate-400"}`}>
                      {rr}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {/* Section 25 - Hold / Quarantine Reason */}
        {Number(holdQty) > 0 && (
          <View style={tw`bg-amber-950/40 border border-amber-500/50 p-3 rounded-xl mb-3`}>
            <Text style={tw`text-amber-400 text-xs font-black uppercase mb-1`}>
              ⚠️ QC HOLD / QUARANTINE REASON (SECTION 25)
            </Text>
            <Text style={tw`text-slate-300 text-[10px] mb-2`}>
              * Held material remains blocked in quarantine until final disposition.
            </Text>

            <View style={tw`flex-row flex-wrap gap-1.5`}>
              {[
                "Lab Test Required",
                "Certificate Pending",
                "Specification Verification",
                "Manager Review",
                "Supplier Clarification",
              ].map((hr) => {
                const active = holdReason === hr;
                return (
                  <TouchableOpacity
                    key={hr}
                    style={tw`px-2 py-1 rounded border ${
                      active ? "bg-amber-600 border-amber-500" : "bg-slate-900 border-slate-700"
                    }`}
                    onPress={() => setHoldReason(hr as any)}
                  >
                    <Text style={tw`text-[10px] font-bold ${active ? "text-white" : "text-slate-400"}`}>
                      {hr}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {/* QC Notes & Defect Photograph */}
        <View style={tw`mb-3`}>
          <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mb-1 uppercase`}>
            QUALITY INSPECTION NOTES
          </Text>
          <TextInput
            style={tw`bg-slate-900 rounded-xl text-white px-3.5 py-2.5 text-xs border border-slate-700`}
            placeholder="e.g. Thickness measured 2.02mm, minor scratch on 5 KG"
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
