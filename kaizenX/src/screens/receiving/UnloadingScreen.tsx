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

export type ReceivingMethod = "QUANTITY_ENTRY" | "BARCODE_SCAN" | "SERIAL_SCAN" | "HU_COUNT";

export function UnloadingScreen({
  dockRecord,
  onUnloadingComplete,
  onCancel,
}: UnloadingScreenProps) {
  const [unloadingStarted, setUnloadingStarted] = useState(
    dockRecord?.status === "UNLOADING" || dockRecord?.unloading_started
  );

  const [receivingMethod, setReceivingMethod] = useState<ReceivingMethod>("QUANTITY_ENTRY");

  // Section 14 Material Qty & Variance
  const expectedPoQty = 500;
  const expectedAsnQty = 500;
  const [receivedQtyInput, setReceivedQtyInput] = useState("495");
  const [damagedQty, setDamagedQty] = useState("0");

  // Section 15 Package / Handling Unit Count
  const [packageCount, setPackageCount] = useState("20");
  const [weightPerPackage, setWeightPerPackage] = useState("25");

  // Serial Scan State
  const [scannedSerials, setScannedSerials] = useState<string[]>(["SN-304-8801", "SN-304-8802"]);
  const [newSerialInput, setNewSerialInput] = useState("");

  const [damageNotes, setDamageNotes] = useState("");
  const [damagePhotoUri, setDamagePhotoUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Section 14 Automatic Variance Calculation
  const numericReceived = Number(receivedQtyInput) || 0;
  const calculatedVariance = numericReceived - expectedAsnQty;

  const handleStartUnloading = () => {
    setUnloadingStarted(true);
    Alert.alert(
      "Unloading Initiated ✓",
      `Status updated to UNLOADING for vehicle ${dockRecord?.vehicle_number || "KA 01 AB 4582"} at ${dockRecord?.dock_number || "Dock D-04"}.`
    );
  };

  const handleCalculateHuQuantity = () => {
    const boxes = Number(packageCount) || 0;
    const kgPerBox = Number(weightPerPackage) || 0;
    const totalCalc = boxes * kgPerBox;
    setReceivedQtyInput(String(totalCalc));
    Alert.alert("Handling Unit Qty Calculated ✓", `${boxes} Boxes × ${kgPerBox} KG = ${totalCalc} KG`);
  };

  const handleAddSerial = () => {
    if (!newSerialInput.trim()) return;
    setScannedSerials((prev) => [...prev, newSerialInput.trim().toUpperCase()]);
    setNewSerialInput("");
  };

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
    if (!numericReceived || numericReceived <= 0) {
      Alert.alert("Required", "Please enter valid received material quantity.");
      return;
    }

    setSubmitting(true);

    const completedRecord = {
      ...dockRecord,
      status: "UNLOADING_COMPLETED",
      receiving_method: receivingMethod,
      received_quantity: numericReceived,
      expected_quantity: expectedAsnQty,
      variance_quantity: calculatedVariance,
      damaged_quantity: Number(damagedQty),
      handling_units_count: Number(packageCount),
      scanned_serials: scannedSerials,
      damage_notes: damageNotes.trim(),
      damage_photo_uri: damagePhotoUri,
      unloaded_at: new Date().toISOString(),
    };

    setTimeout(() => {
      setSubmitting(false);
      Alert.alert(
        "Unloading Completed ✓",
        `Unloading completed for ${completedRecord.vehicle_number} at ${completedRecord.dock_number || "Dock D-04"}.\n\nReceived Qty: ${numericReceived} KG (Variance: ${calculatedVariance} KG)\nHandling Units: ${packageCount} Boxes\n\nSubmitted to Quality Inspection queue.`
      );
      onUnloadingComplete(completedRecord);
    }, 600);
  };

  return (
    <ScrollView style={tw`flex-1 bg-slate-900`} contentContainerStyle={tw`p-4 pb-10`}>
      {/* Header */}
      <View style={tw`flex-row justify-between items-center mb-4`}>
        <View>
          <Text style={tw`text-white text-base font-black tracking-wider`}>MATERIAL UNLOADING & RECEIVING</Text>
          <Text style={tw`text-sky-400 text-xs font-bold mt-0.5`}>Dock Operations • Operator Desk</Text>
        </View>
        <TouchableOpacity style={tw`bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700`} onPress={onCancel}>
          <Text style={tw`text-slate-300 text-xs font-bold`}>✕ CANCEL</Text>
        </TouchableOpacity>
      </View>

      {/* Section 13 - Start Unloading Dock Banner */}
      <View style={tw`bg-slate-800 rounded-2xl p-4 mb-4 border border-sky-500/30 shadow-xl`}>
        <View style={tw`flex-row justify-between items-center mb-2`}>
          <Text style={tw`text-sky-400 text-base font-black`}>
            📍 DOCK {dockRecord?.dock_number || "D-04"}
          </Text>
          <View
            style={tw`px-2.5 py-0.5 rounded border ${
              unloadingStarted
                ? "bg-sky-500/20 border-sky-500/50"
                : "bg-amber-500/20 border-amber-500/50"
            }`}
          >
            <Text
              style={tw`text-[10px] font-black uppercase ${
                unloadingStarted ? "text-sky-400" : "text-amber-400"
              }`}
            >
              {unloadingStarted ? "UNLOADING IN PROGRESS" : "AT_DOCK"}
            </Text>
          </View>
        </View>

        <Text style={tw`text-white text-xs font-bold mb-2`}>
          Vehicle: {formatVehiclePlate(dockRecord?.vehicle_number || "KA 01 AB 4582")} • {dockRecord?.supplier_name || "Bharat Electronics Components"}
        </Text>

        <View style={tw`bg-slate-900 p-3 rounded-xl flex-row justify-between items-center border border-slate-700 mb-3`}>
          <View>
            <Text style={tw`text-slate-400 text-[10px] font-bold uppercase`}>Expected Materials</Text>
            <Text style={tw`text-sky-400 text-sm font-black mt-0.5`}>4 Items</Text>
          </View>

          <View>
            <Text style={tw`text-slate-400 text-[10px] font-bold uppercase text-right`}>Expected Quantity</Text>
            <Text style={tw`text-emerald-400 text-sm font-black text-right mt-0.5`}>1,850 KG</Text>
          </View>
        </View>

        {!unloadingStarted && (
          <TouchableOpacity
            style={tw`bg-sky-600 py-3 rounded-xl items-center shadow`}
            onPress={handleStartUnloading}
          >
            <Text style={tw`text-white font-black text-xs tracking-wider`}>[ START UNLOADING ] →</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Section 15 - Receiving Method Selector */}
      {unloadingStarted && (
        <View style={tw`bg-slate-800 rounded-2xl p-4 mb-4 border border-white/10 shadow-xl`}>
          <Text style={tw`text-sky-400 text-xs font-black tracking-wider uppercase mb-2`}>
            1. SELECT RECEIVING METHOD (SECTION 15)
          </Text>

          <View style={tw`flex-row flex-wrap gap-1.5 mb-3`}>
            {[
              { id: "QUANTITY_ENTRY", label: "Quantity Entry" },
              { id: "BARCODE_SCAN", label: "Barcode Scan" },
              { id: "SERIAL_SCAN", label: "Serial Scan" },
              { id: "HU_COUNT", label: "Handling Unit Count" },
            ].map((m) => {
              const active = receivingMethod === m.id;
              return (
                <TouchableOpacity
                  key={m.id}
                  style={tw`px-3 py-1.5 rounded-lg border ${
                    active ? "bg-sky-600 border-sky-500" : "bg-slate-900 border-slate-700"
                  }`}
                  onPress={() => setReceivingMethod(m.id as any)}
                >
                  <Text style={tw`text-xs font-bold ${active ? "text-white" : "text-slate-400"}`}>
                    {m.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Section 14 - Material Receiving & Variance */}
          <Text style={tw`text-sky-400 text-xs font-black tracking-wider uppercase mb-2`}>
            2. MATERIAL QUANTITY & VARIANCE (SECTION 14)
          </Text>

          <View style={tw`bg-slate-900 p-3 rounded-xl mb-3 border border-slate-700 gap-1`}>
            <Text style={tw`text-sky-400 text-xs font-bold`}>MAT-SS-304-001</Text>
            <Text style={tw`text-white text-xs font-bold`}>Stainless Steel Sheet 304 Grade 2mm</Text>

            <View style={tw`flex-row justify-between items-center mt-1 pt-1 border-t border-slate-800`}>
              <Text style={tw`text-slate-400 text-[11px]`}>
                PO Qty: <Text style={tw`text-slate-200 font-bold`}>{expectedPoQty} KG</Text>
              </Text>
              <Text style={tw`text-slate-400 text-[11px]`}>
                ASN Qty: <Text style={tw`text-slate-200 font-bold`}>{expectedAsnQty} KG</Text>
              </Text>
            </View>
          </View>

          {/* Method 1: Quantity Entry */}
          {receivingMethod === "QUANTITY_ENTRY" && (
            <View style={tw`mb-3`}>
              <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mb-1 uppercase`}>
                RECEIVED QUANTITY (KG) *
              </Text>
              <TextInput
                style={tw`bg-slate-900 rounded-xl text-emerald-400 text-base font-black px-3.5 py-2.5 border border-slate-700`}
                value={receivedQtyInput}
                onChangeText={setReceivedQtyInput}
                keyboardType="numeric"
              />
            </View>
          )}

          {/* Method 4: Package / Handling Unit Count */}
          {receivingMethod === "HU_COUNT" && (
            <View style={tw`bg-slate-900 p-3 rounded-xl mb-3 border border-slate-700 gap-2`}>
              <Text style={tw`text-sky-400 text-[10px] font-black uppercase`}>
                PACKAGE / HANDLING UNIT COUNT CALCULATION
              </Text>
              <View style={tw`flex-row gap-2`}>
                <View style={tw`flex-1`}>
                  <Text style={tw`text-slate-400 text-[10px] mb-1`}>Package Boxes</Text>
                  <TextInput
                    style={tw`bg-slate-800 rounded-lg text-white font-bold px-3 py-2 text-xs border border-slate-700`}
                    value={packageCount}
                    onChangeText={setPackageCount}
                    keyboardType="numeric"
                  />
                </View>

                <View style={tw`flex-1`}>
                  <Text style={tw`text-slate-400 text-[10px] mb-1`}>KG per Box</Text>
                  <TextInput
                    style={tw`bg-slate-800 rounded-lg text-white font-bold px-3 py-2 text-xs border border-slate-700`}
                    value={weightPerPackage}
                    onChangeText={setWeightPerPackage}
                    keyboardType="numeric"
                  />
                </View>
              </View>

              <TouchableOpacity
                style={tw`bg-sky-600 py-2 rounded-lg items-center`}
                onPress={handleCalculateHuQuantity}
              >
                <Text style={tw`text-white font-bold text-xs`}>
                  Calculate ({packageCount} Boxes × {weightPerPackage} KG = {Number(packageCount) * Number(weightPerPackage)} KG)
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Method 3: Serial Scan */}
          {receivingMethod === "SERIAL_SCAN" && (
            <View style={tw`bg-slate-900 p-3 rounded-xl mb-3 border border-slate-700 gap-2`}>
              <Text style={tw`text-sky-400 text-[10px] font-black uppercase`}>SERIAL NUMBER CAPTURE</Text>
              <View style={tw`flex-row gap-2`}>
                <TextInput
                  style={tw`flex-1 bg-slate-800 rounded-lg text-white font-mono px-3 py-2 text-xs border border-slate-700`}
                  placeholder="Scan or type Serial No (e.g. SN-304-8803)"
                  placeholderTextColor="#64748b"
                  value={newSerialInput}
                  onChangeText={setNewSerialInput}
                  autoCapitalize="characters"
                />
                <TouchableOpacity style={tw`bg-sky-600 px-3 rounded-lg justify-center`} onPress={handleAddSerial}>
                  <Text style={tw`text-white font-bold text-xs`}>+ ADD</Text>
                </TouchableOpacity>
              </View>

              <Text style={tw`text-slate-400 text-[10px]`}>Scanned Serials ({scannedSerials.length}):</Text>
              <View style={tw`flex-row flex-wrap gap-1`}>
                {scannedSerials.map((s, idx) => (
                  <View key={idx} style={tw`bg-slate-800 px-2 py-0.5 rounded border border-slate-700`}>
                    <Text style={tw`text-sky-400 text-[10px] font-mono`}>{s}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Automatic Variance Display */}
          <View style={tw`bg-slate-900 p-3 rounded-xl mb-3 border border-slate-700 flex-row justify-between items-center`}>
            <Text style={tw`text-slate-400 text-xs font-bold`}>CALCULATED VARIANCE:</Text>
            <Text
              style={tw`text-sm font-black ${
                calculatedVariance < 0
                  ? "text-amber-400"
                  : calculatedVariance > 0
                  ? "text-sky-400"
                  : "text-emerald-400"
              }`}
            >
              {calculatedVariance > 0 ? `+${calculatedVariance}` : calculatedVariance} KG
            </Text>
          </View>

          {/* Damaged Quantity & Photo Capture */}
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

          <View style={tw`mb-3`}>
            <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mb-1 uppercase`}>
              DISCREPANCY / DAMAGE NOTES
            </Text>
            <TextInput
              style={tw`bg-slate-900 rounded-xl text-white px-3.5 py-2.5 text-xs border border-slate-700`}
              placeholder="e.g. Corner scratch on top 2 sheets"
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
            <View style={tw`mt-1 bg-slate-900 p-2 rounded-xl border border-amber-500/40 items-center mb-2`}>
              <Image source={{ uri: damagePhotoUri }} style={tw`w-24 h-24 rounded-lg`} />
              <Text style={tw`text-amber-400 text-[10px] font-bold mt-1`}>Damage Photo Attached ✓</Text>
            </View>
          )}

          {/* Complete Unloading CTA */}
          <TouchableOpacity
            style={tw`bg-emerald-600 py-4 rounded-2xl items-center shadow-lg mt-2 ${
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
        </View>
      )}
    </ScrollView>
  );
}
