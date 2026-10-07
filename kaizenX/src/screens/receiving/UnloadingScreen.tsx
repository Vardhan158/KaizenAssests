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

interface UnloadingScreenProps {
  dockRecord: any;
  onUnloadingComplete: (record: any) => void;
  onCancel: () => void;
}

export function UnloadingScreen({
  dockRecord,
  onUnloadingComplete,
  onCancel,
}: UnloadingScreenProps) {
  const [receivedQty, setReceivedQty] = useState("500");
  const [damagedQty, setDamagedQty] = useState("0");
  const [handlingUnitsCount, setHandlingUnitsCount] = useState("2");
  const [damageNotes, setDamageNotes] = useState("");
  const [damagePhotoUri, setDamagePhotoUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleCaptureDamagePhoto = async () => {
    try {
      const response = await launchCamera({
        mediaType: "photo",
        cameraType: "back",
        quality: 0.8,
        saveToPhotos: false,
      });

      if (response.assets && response.assets.length > 0) {
        setDamagePhotoUri(response.assets[0].uri || null);
        Alert.alert("Damage Photo Attached ✓", "Photograph of damaged material attached for quality inspection review.");
      }
    } catch {
      Alert.alert("Camera Error", "Could not capture photograph.");
    }
  };

  const handleCompleteUnloading = () => {
    if (!receivedQty || Number(receivedQty) <= 0) {
      Alert.alert("Required", "Please enter valid received material quantity.");
      return;
    }

    setSubmitting(true);

    const completedRecord = {
      ...dockRecord,
      status: "UNLOADING_COMPLETED",
      received_quantity: Number(receivedQty),
      damaged_quantity: Number(damagedQty),
      handling_units_count: Number(handlingUnitsCount),
      damage_notes: damageNotes.trim(),
      damage_photo_uri: damagePhotoUri,
      unloaded_at: new Date().toISOString(),
    };

    setTimeout(() => {
      setSubmitting(false);
      Alert.alert(
        "Unloading Completed ✓",
        `Unloading completed for ${completedRecord.vehicle_number} at ${completedRecord.dock_number || "Dock D-04"}.\n\nReceived Qty: ${receivedQty} KG (Damaged: ${damagedQty} KG)\nHU Pallets: ${handlingUnitsCount}\n\nSubmitted to Quality Inspection queue.`
      );
      onUnloadingComplete(completedRecord);
    }, 600);
  };

  return (
    <ScrollView style={tw`flex-1 bg-slate-900`} contentContainerStyle={tw`p-4 pb-10`}>
      {/* Header */}
      <View style={tw`flex-row justify-between items-center mb-4`}>
        <View>
          <Text style={tw`text-white text-base font-black tracking-wider`}>MATERIAL UNLOADING & COUNT</Text>
          <Text style={tw`text-sky-400 text-xs font-bold mt-0.5`}>Dock Operations • Operator Desk</Text>
        </View>
        <TouchableOpacity style={tw`bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700`} onPress={onCancel}>
          <Text style={tw`text-slate-300 text-xs font-bold`}>✕ CANCEL</Text>
        </TouchableOpacity>
      </View>

      {/* Dock & Vehicle Summary Banner */}
      <View style={tw`bg-slate-800 rounded-2xl p-4 mb-4 border border-sky-500/30 shadow-lg`}>
        <View style={tw`flex-row justify-between items-center mb-2`}>
          <Text style={tw`text-sky-400 text-sm font-black`}>
            {formatVehiclePlate(dockRecord?.vehicle_number || "KA 01 AB 4582")}
          </Text>
          <View style={tw`bg-sky-600 px-2.5 py-0.5 rounded`}>
            <Text style={tw`text-white text-[10px] font-black`}>
              📍 {dockRecord?.dock_number || "Dock D-04"}
            </Text>
          </View>
        </View>

        <Text style={tw`text-white text-xs font-bold mb-1`}>
          {dockRecord?.supplier_name || "Bharat Electronics Components Pvt. Ltd."}
        </Text>
        <Text style={tw`text-slate-400 text-[11px]`}>
          PO: {dockRecord?.po_number || "PO-2026-008741"} • ASN: {dockRecord?.asn_number || "ASN-2026-004582"}
        </Text>
      </View>

      {/* Unloading Form Card */}
      <View style={tw`bg-slate-800 rounded-2xl p-4 mb-4 border border-white/10 shadow-xl`}>
        <Text style={tw`text-sky-400 text-xs font-black tracking-wider uppercase mb-3`}>
          PIECE COUNTING & CONTAINER RECEIVING
        </Text>

        {/* Expected Material Code */}
        <View style={tw`bg-slate-900 p-3 rounded-xl mb-3 border border-slate-700`}>
          <Text style={tw`text-slate-400 text-[10px] font-bold uppercase`}>EXPECTED MATERIAL</Text>
          <Text style={tw`text-sky-400 text-xs font-bold mt-0.5`}>Stainless Steel Sheet 304 (MAT-SS-304-001)</Text>
          <Text style={tw`text-emerald-400 text-xs font-black mt-0.5`}>Expected Quantity: 500 KG</Text>
        </View>

        {/* Received Quantity Input */}
        <View style={tw`mb-3`}>
          <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mb-1 uppercase`}>
            RECEIVED QUANTITY (KG / UNITS) *
          </Text>
          <TextInput
            style={tw`bg-slate-900 rounded-xl text-emerald-400 text-base font-black px-3.5 py-2.5 border border-slate-700`}
            value={receivedQty}
            onChangeText={setReceivedQty}
            keyboardType="numeric"
          />
        </View>

        {/* Damaged Quantity Input */}
        <View style={tw`mb-3`}>
          <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mb-1 uppercase`}>
            DAMAGED QUANTITY (IF ANY)
          </Text>
          <TextInput
            style={tw`bg-slate-900 rounded-xl text-amber-400 text-sm font-bold px-3.5 py-2.5 border border-slate-700`}
            value={damagedQty}
            onChangeText={setDamagedQty}
            keyboardType="numeric"
          />
        </View>

        {/* Handling Units / Pallets Count */}
        <View style={tw`mb-3`}>
          <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mb-1 uppercase`}>
            PALLETS / HANDLING UNITS COUNT
          </Text>
          <TextInput
            style={tw`bg-slate-900 rounded-xl text-white text-sm font-bold px-3.5 py-2.5 border border-slate-700`}
            value={handlingUnitsCount}
            onChangeText={setHandlingUnitsCount}
            keyboardType="numeric"
          />
        </View>

        {/* Damaged Material Notes & Photo */}
        <View style={tw`mb-3`}>
          <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mb-1 uppercase`}>
            DAMAGE / DISCREPANCY NOTES
          </Text>
          <TextInput
            style={tw`bg-slate-900 rounded-xl text-white px-3.5 py-2.5 text-xs border border-slate-700`}
            placeholder="e.g. Outer cardboard wet, corner scratch"
            placeholderTextColor="#64748b"
            value={damageNotes}
            onChangeText={setDamageNotes}
          />
        </View>

        <TouchableOpacity
          style={tw`bg-slate-900 py-3 rounded-xl border border-slate-700 items-center flex-row justify-center gap-2 mb-2`}
          onPress={handleCaptureDamagePhoto}
        >
          <Text style={tw`text-amber-400 text-sm`}>📷</Text>
          <Text style={tw`text-amber-400 text-xs font-black`}>
            {damagePhotoUri ? "✓ RETAKE DAMAGE PHOTO" : "CAPTURE DAMAGED MATERIAL PHOTO"}
          </Text>
        </TouchableOpacity>

        {damagePhotoUri && (
          <View style={tw`mt-2 bg-slate-900 p-2 rounded-xl border border-amber-500/40 items-center mb-2`}>
            <Image source={{ uri: damagePhotoUri }} style={tw`w-24 h-24 rounded-lg`} />
            <Text style={tw`text-amber-400 text-[10px] font-bold mt-1`}>Damage Photo Attached ✓</Text>
          </View>
        )}
      </View>

      {/* Complete Unloading CTA */}
      <TouchableOpacity
        style={tw`bg-emerald-600 py-4 rounded-2xl items-center shadow-lg ${
          submitting ? "opacity-60" : ""
        }`}
        onPress={handleCompleteUnloading}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={tw`text-white font-black text-xs tracking-wider`}>
            [ COMPLETE UNLOADING & SUBMIT TO QC ] ✓
          </Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}
