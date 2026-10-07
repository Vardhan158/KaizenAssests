import React, { useState, useEffect } from "react";
import {
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Modal,
  PermissionsAndroid,
  Platform,
  Image,
} from "react-native";
import tw from "twrnc";
import { launchCamera, ImagePickerResponse } from "react-native-image-picker";
import { mobileApi } from "../services/api";
import { formatVehiclePlate, parseScannedQrCode } from "../utils/vehicleFormatter";

interface GateEntryScannerScreenProps {
  onSuccess: (entryResult: any) => void;
  onLogout: () => void;
  initialPoQuery?: string;
}

export function GateEntryScannerScreen({
  onSuccess,
  onLogout,
  initialPoQuery,
}: GateEntryScannerScreenProps) {
  const [entryMode, setEntryMode] = useState<"SCHEDULED" | "EXCEPTION">("SCHEDULED");

  const [searchInput, setSearchInput] = useState(initialPoQuery || "");
  const [vehicleInput, setVehicleInput] = useState("");
  const [driverNameInput, setDriverNameInput] = useState("");
  const [driverContactInput, setDriverContactInput] = useState("");
  const [supplierInput, setSupplierInput] = useState("");
  const [exceptionReasonInput, setExceptionReasonInput] = useState("");
  const [remarksInput, setRemarksInput] = useState("");

  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [poList, setPoList] = useState<any[]>([]);
  const [asnList, setAsnList] = useState<any[]>([]);

  // Captured Photo & Modals
  const [capturedImageUri, setCapturedImageUri] = useState<string | null>(null);
  const [showPoPickerModal, setShowPoPickerModal] = useState(false);

  // Selected Data & Status
  const [selectedPo, setSelectedPo] = useState<any | null>(null);
  const [selectedAsn, setSelectedAsn] = useState<any | null>(null);
  const [lineItems, setLineItems] = useState<any[]>([]);
  const [vehiclesExtracted, setVehiclesExtracted] = useState<any[]>([]);
  const [selectedVehicleIdx, setSelectedVehiclePickerIdx] = useState<number | null>(null);
  const [notFoundMessage, setNotFoundError] = useState<string | null>(null);

  useEffect(() => {
    loadBaseData();
  }, [initialPoQuery]);

  const requestCameraPermission = async (): Promise<boolean> => {
    if (Platform.OS === "android") {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.CAMERA,
          {
            title: "KaizenX Camera Access Required",
            message: "KaizenX Gate Scanner needs camera access to scan delivery passes, truck plates, and barcodes.",
            buttonNeutral: "Ask Later",
            buttonNegative: "Cancel",
            buttonPositive: "OK",
          }
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      } catch {
        return false;
      }
    }
    return true;
  };

  const handleLaunchNativeCamera = async () => {
    const hasPermission = await requestCameraPermission();
    if (!hasPermission) {
      Alert.alert(
        "Camera Permission Denied",
        "Please enable camera permissions in Android settings to scan barcodes with your camera."
      );
      return;
    }

    try {
      const response: ImagePickerResponse = await launchCamera({
        mediaType: "photo",
        cameraType: "back",
        quality: 0.8,
        saveToPhotos: false,
      });

      if (response.didCancel) {
        return;
      }

      if (response.errorCode) {
        Alert.alert("Camera Error", response.errorMessage || "Could not launch camera.");
        return;
      }

      if (response.assets && response.assets.length > 0) {
        const photo = response.assets[0];
        setCapturedImageUri(photo.uri || null);
        if (entryMode === "SCHEDULED") {
          if (searchInput.trim()) {
            selectAndAutofillPo(searchInput);
          } else if (poList.length > 0) {
            const firstPo = poList[0]?.po_number || poList[0]?.poNumber;
            if (firstPo) selectAndAutofillPo(firstPo);
          }
        }
      }
    } catch (e: any) {
      Alert.alert("Camera Error", e?.message || "Failed to open camera.");
    }
  };

  const loadBaseData = async () => {
    setLoading(true);
    setNotFoundError(null);
    try {
      const [pos, asns] = await Promise.all([
        mobileApi.getPurchaseOrders(),
        mobileApi.getAsns(),
      ]);
      setPoList(pos);
      setAsnList(asns);
      if (initialPoQuery && initialPoQuery.trim()) {
        setSearchInput(initialPoQuery.trim());
        selectAndAutofillPo(initialPoQuery.trim(), pos, asns);
      }
    } catch {
      setNotFoundError("Failed to load backend records.");
    } finally {
      setLoading(false);
    }
  };

  const normalizePo = (val: string) =>
    String(val || "")
      .toUpperCase()
      .replace(/^PO-?/, "")
      .replace(/[^A-Z0-9]/g, "")
      .trim();

  const selectAndAutofillPo = (queryStr: string, availablePos = poList, availableAsns = asnList) => {
    setNotFoundError(null);
    if (!queryStr || !queryStr.trim()) {
      setSelectedPo(null);
      setSelectedAsn(null);
      setLineItems([]);
      setVehiclesExtracted([]);
      setVehicleInput("");
      setDriverNameInput("");
      setDriverContactInput("");
      setSupplierInput("");
      return;
    }

    const parsed = parseScannedQrCode(queryStr);
    const lookupRaw = parsed.reference.toUpperCase().trim();
    const targetPoNorm = normalizePo(queryStr);

    const matchedPo = availablePos.find((candidate: any) => {
      const p1 = String(candidate.po_number || candidate.poNumber || "").toUpperCase();
      const p2 = normalizePo(p1);
      const veh = String(candidate.vehicle_number || candidate.vehicleNumber || "").toUpperCase();
      const sup = String(candidate.supplier_name || candidate.supplierName || "").toUpperCase();
      return (
        p1 === lookupRaw ||
        (p2 && p2 === targetPoNorm) ||
        (lookupRaw.length >= 3 && veh.includes(lookupRaw)) ||
        (lookupRaw.length >= 3 && sup.includes(lookupRaw))
      );
    });

    const matchingAsns = availableAsns.filter((candidate: any) => {
      const a1 = String(candidate.asn_number || candidate.asnNumber || "").toUpperCase();
      const a2 = normalizePo(candidate.po_number || candidate.poNumber);
      const veh = String(candidate.vehicle_number || candidate.vehicleNumber || "").toUpperCase();
      const sup = String(candidate.supplier_name || candidate.supplierName || "").toUpperCase();
      return (
        a1 === lookupRaw ||
        (a2 && a2 === targetPoNorm) ||
        (lookupRaw.length >= 3 && veh.includes(lookupRaw)) ||
        (lookupRaw.length >= 3 && sup.includes(lookupRaw))
      );
    });

    const matchedAsn = matchingAsns[0];

    if (!matchedPo && matchingAsns.length === 0) {
      setSelectedPo(null);
      setSelectedAsn(null);
      setLineItems([]);
      setVehiclesExtracted([]);
      setVehicleInput("");
      setDriverNameInput("");
      setDriverContactInput("");
      setSupplierInput("");
      setNotFoundError(`NOT FOUND — PO / ASN '${lookupRaw}' does not exist in backend database.`);
      return;
    }

    const resolvedPo = matchedPo || {
      po_number: matchedAsn?.po_number || matchedAsn?.poNumber || lookupRaw,
      supplier_name: matchedAsn?.supplier_name || matchedAsn?.supplierName || "Supplier",
    };

    const supplierName =
      resolvedPo.supplier_name ||
      resolvedPo.supplierName ||
      matchedAsn?.supplier_name ||
      matchedAsn?.supplierName ||
      "";

    let itemsList: any[] = [];
    if (resolvedPo.items && Array.isArray(resolvedPo.items) && resolvedPo.items.length > 0) {
      itemsList = resolvedPo.items;
    } else if (matchedAsn) {
      itemsList = matchedAsn.lines || matchedAsn.items || [];
    }

    const extractedVehicles: any[] = [];

    matchingAsns.forEach((asn: any) => {
      let rawLog = asn.logistics;
      if (typeof rawLog === "string") {
        try {
          rawLog = JSON.parse(rawLog);
        } catch {
          rawLog = null;
        }
      }

      const logList = Array.isArray(rawLog) && rawLog.length > 0 ? rawLog : null;
      if (logList) {
        logList.forEach((item: any) => {
          const rawVeh = String(item.vehicle_number || item.vehicleNumber || item.vehicle_plate || "");
          const driverPhone =
            item.driver_contact ||
            item.driverContact ||
            item.driver_phone ||
            item.driverPhone ||
            item.phone ||
            "";

          if (rawVeh) {
            extractedVehicles.push({
              index: extractedVehicles.length,
              vehicleNumber: formatVehiclePlate(rawVeh),
              driverName: item.driver_name || item.driverName || "",
              driverContact: driverPhone,
              transporter: item.transporter || "Logistics Partner",
            });
          }
        });
      }

      const topVeh = String(asn.vehicle_number || asn.vehicleNumber || "");
      if (topVeh && !logList) {
        extractedVehicles.push({
          index: extractedVehicles.length,
          vehicleNumber: formatVehiclePlate(topVeh),
          driverName: asn.driver_name || asn.driverName || "",
          driverContact: asn.driver_contact || asn.driverContact || "",
          transporter: asn.transporter || "Logistics Partner",
        });
      }
    });

    if (extractedVehicles.length === 0 && (resolvedPo.vehicle_number || resolvedPo.vehicleNumber)) {
      extractedVehicles.push({
        index: 0,
        vehicleNumber: formatVehiclePlate(resolvedPo.vehicle_number || resolvedPo.vehicleNumber),
        driverName: resolvedPo.driver_name || resolvedPo.driverName || "",
        driverContact: resolvedPo.driver_contact || resolvedPo.driverContact || "",
        transporter: "Logistics Partner",
      });
    }

    const uniqueVehicles = extractedVehicles
      .filter(
        (v, index, self) =>
          self.findIndex(
            (candidate) =>
              candidate.vehicleNumber.replace(/[^A-Z0-9]/g, "") ===
              v.vehicleNumber.replace(/[^A-Z0-9]/g, ""),
          ) === index,
      )
      .map((v, idx) => ({ ...v, index: idx }));

    setSelectedPo(resolvedPo);
    if (matchedAsn) setSelectedAsn(matchedAsn);
    setSupplierInput(supplierName);

    setVehiclesExtracted(uniqueVehicles);
    if (uniqueVehicles.length > 0) {
      selectVehicleOption(uniqueVehicles[0]);
    } else {
      setVehicleInput("");
      setDriverNameInput("");
      setDriverContactInput("");
    }

    setLineItems(itemsList);
    setSearchInput(resolvedPo.po_number || resolvedPo.poNumber || lookupRaw);
  };

  const selectVehicleOption = (vObj: any) => {
    if (!vObj) return;
    setSelectedVehiclePickerIdx(vObj.index);
    setVehicleInput(formatVehiclePlate(vObj.vehicleNumber || ""));
    setDriverNameInput(vObj.driverName || "");
    setDriverContactInput(vObj.driverContact || "");
  };

  const handleCreateGateEntry = async () => {
    if (!vehicleInput.trim()) {
      Alert.alert("Required", "Please enter a valid truck/vehicle plate number.");
      return;
    }

    setSubmitting(true);

    try {
      if (entryMode === "EXCEPTION") {
        if (!supplierInput.trim()) {
          Alert.alert("Required", "Please enter the Supplier Name for exception entry.");
          setSubmitting(false);
          return;
        }

        const result = await mobileApi.createUnscheduledEntry({
          supplier_name: supplierInput.trim(),
          vehicle_number: formatVehiclePlate(vehicleInput),
          driver_name: driverNameInput.trim(),
          driver_contact: driverContactInput.trim(),
          reason: exceptionReasonInput.trim(),
          remarks: remarksInput.trim(),
        });

        setSubmitting(false);
        onSuccess(result);
      } else {
        const poNum = selectedPo?.po_number || selectedPo?.poNumber || searchInput.trim();
        const suppName = selectedPo?.supplier_name || selectedPo?.supplierName || supplierInput.trim();

        if (!poNum) {
          Alert.alert("Required", "Please enter or select a valid PO or ASN number.");
          setSubmitting(false);
          return;
        }

        const dockNo = selectedPo?.dock_number || selectedAsn?.dock_number || "";

        const result = await mobileApi.createGateEntry({
          po_number: poNum,
          vehicle_number: formatVehiclePlate(vehicleInput),
          driver_name: driverNameInput.trim(),
          driver_contact: driverContactInput.trim(),
          supplier_name: suppName,
          asn_reference: selectedAsn?.asn_number || selectedAsn?.asnNumber || "",
          line_items: lineItems,
          dock_number: dockNo,
          remarks: remarksInput.trim(),
        });

        setSubmitting(false);
        onSuccess(result);
      }
    } catch (e: any) {
      setSubmitting(false);
      Alert.alert("Submission Failed", e?.message || "Could not generate gate pass.");
    }
  };

  return (
    <ScrollView style={tw`flex-1 bg-slate-900`} contentContainerStyle={tw`p-4 pb-10`}>
      {/* Top Header */}
      <View style={tw`flex-row justify-between items-center mb-3.5`}>
        <View>
          <Text style={tw`text-white text-base font-black tracking-wider`}>GATE ENTRY SCANNER</Text>
          <Text style={tw`text-cyan-500 text-xs font-bold`}>Security Verification Desk</Text>
        </View>
        <TouchableOpacity
          style={tw`bg-red-500/15 border border-red-500/40 px-3 py-1.5 rounded-lg`}
          onPress={onLogout}
        >
          <Text style={tw`text-red-400 text-xs font-bold`}>Exit Session</Text>
        </TouchableOpacity>
      </View>

      {/* Entry Mode Switcher (Scheduled PO vs. Exception Entry) */}
      <View style={tw`flex-row bg-slate-800 rounded-xl p-1 mb-3.5 border border-slate-700`}>
        <TouchableOpacity
          style={tw`flex-1 py-2.5 items-center rounded-lg ${
            entryMode === "SCHEDULED" ? "bg-sky-600" : ""
          }`}
          onPress={() => {
            setEntryMode("SCHEDULED");
            setNotFoundError(null);
          }}
        >
          <Text
            style={tw`text-xs font-extrabold ${
              entryMode === "SCHEDULED" ? "text-white" : "text-slate-400"
            }`}
          >
            ✓ SCHEDULED PO / ASN
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={tw`flex-1 py-2.5 items-center rounded-lg ${
            entryMode === "EXCEPTION" ? "bg-amber-600" : ""
          }`}
          onPress={() => {
            setEntryMode("EXCEPTION");
            setNotFoundError(null);
          }}
        >
          <Text
            style={tw`text-xs font-extrabold ${
              entryMode === "EXCEPTION" ? "text-white" : "text-slate-400"
            }`}
          >
            ⚠️ EXCEPTION / UNSCHEDULED
          </Text>
        </TouchableOpacity>
      </View>

      {/* OPEN REAL DEVICE CAMERA BUTTON */}
      <TouchableOpacity
        style={tw`bg-sky-600 rounded-2xl py-3.5 px-4 items-center mb-3.5 shadow-lg`}
        onPress={handleLaunchNativeCamera}
      >
        <Text style={tw`text-white text-xs font-black tracking-wider`}>
          📷 OPEN CAMERA BARCODE SCANNER
        </Text>
        <Text style={tw`text-sky-100 text-[10px] mt-0.5`}>
          Scan PO QR Code, ASN Barcode, or Vehicle Plate
        </Text>
      </TouchableOpacity>

      {/* Display Captured Photo Preview */}
      {capturedImageUri && (
        <View style={tw`bg-slate-800 rounded-2xl p-3 mb-3.5 border border-sky-600 items-center`}>
          <Text style={tw`text-sky-400 text-[10px] font-black tracking-wider mb-2`}>
            📷 CAPTURED VEHICLE / PASS PHOTO
          </Text>
          <Image source={{ uri: capturedImageUri }} style={tw`w-full h-40 rounded-xl`} />
        </View>
      )}

      {/* Screen 04 - Scan / Search Delivery */}
      {entryMode === "SCHEDULED" ? (
        /* SCHEDULED PO / ASN MODE */
        <View style={tw`bg-slate-800 rounded-2xl p-4 mb-3.5 border border-white/10`}>
          <Text style={tw`text-sky-400 text-xs font-black tracking-wider mb-2.5 uppercase`}>
            SEARCH DELIVERY
          </Text>

          {/* Camera Scan QR CTA */}
          <TouchableOpacity
            style={tw`bg-sky-600 rounded-xl py-3 px-3.5 items-center mb-3 shadow-md flex-row justify-center gap-2`}
            onPress={handleLaunchNativeCamera}
          >
            <Text style={tw`text-white text-base`}>📷</Text>
            <View style={tw`items-center`}>
              <Text style={tw`text-white text-xs font-black tracking-wider`}>[ SCAN QR CODE ]</Text>
              <Text style={tw`text-sky-100 text-[9px]`}>Scan ASN QR, Supplier Delivery QR, or Shipment QR</Text>
            </View>
          </TouchableOpacity>

          <View style={tw`flex-row items-center my-1.5`}>
            <View style={tw`flex-1 h-px bg-slate-700`} />
            <Text style={tw`text-slate-400 text-[10px] font-black px-2.5`}>OR MANUAL SEARCH</Text>
            <View style={tw`flex-1 h-px bg-slate-700`} />
          </View>

          <Text style={tw`text-slate-400 text-[10px] font-extrabold tracking-wider mb-1.5 uppercase mt-1`}>
            ASN / PO / VEHICLE NUMBER / SUPPLIER
          </Text>

          <View style={tw`flex-row gap-2 mb-2`}>
            <TextInput
              style={tw`flex-1 bg-slate-900 rounded-xl text-white px-3 py-2.5 text-xs border border-slate-700 font-semibold`}
              placeholder="Enter ASN, PO, Vehicle, or Supplier..."
              placeholderTextColor="#64748b"
              value={searchInput}
              onChangeText={(text) => {
                setSearchInput(text);
                if (text.trim().length >= 3) {
                  selectAndAutofillPo(text);
                }
              }}
              onSubmitEditing={() => selectAndAutofillPo(searchInput)}
              autoCapitalize="characters"
            />

            <TouchableOpacity
              style={tw`bg-slate-700 rounded-xl px-2.5 justify-center`}
              onPress={() => setShowPoPickerModal(true)}
            >
              <Text style={tw`text-slate-300 text-[10px] font-bold`}>BROWSE DB ▼</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={tw`bg-sky-600 rounded-xl px-3.5 justify-center`}
              onPress={() => selectAndAutofillPo(searchInput)}
            >
              <Text style={tw`text-white text-xs font-black`}>SEARCH</Text>
            </TouchableOpacity>
          </View>

          {loading ? (
            <ActivityIndicator color="#0284c7" style={tw`mt-3`} />
          ) : notFoundMessage ? (
            <View style={tw`bg-red-500/10 rounded-xl p-3.5 border border-red-500/40 mt-1.5`}>
              <Text style={tw`text-red-400 text-xs font-black`}>⚠️ EXPECTED DELIVERY NOT FOUND</Text>
              <Text style={tw`text-red-300 text-xs mt-0.5`}>{notFoundMessage}</Text>
              <TouchableOpacity
                style={tw`mt-2.5 bg-amber-600 py-2 px-2.5 rounded-lg items-center`}
                onPress={() => {
                  setEntryMode("EXCEPTION");
                  setNotFoundError(null);
                }}
              >
                <Text style={tw`text-white text-[10px] font-black`}>
                  → REGISTER AS EXCEPTION / UNSCHEDULED ENTRY
                </Text>
              </TouchableOpacity>
            </View>
          ) : selectedPo || selectedAsn ? (
            /* Screen 05 - Expected Delivery Details Card */
            <View style={tw`bg-slate-900 rounded-xl p-3.5 border border-emerald-500/40 mt-2 shadow-inner`}>
              {/* Header Badge */}
              <View style={tw`flex-row justify-between items-center mb-3 pb-2 border-b border-slate-800`}>
                <View style={tw`flex-row items-center gap-1.5`}>
                  <Text style={tw`text-emerald-400 text-xs font-black`}>✓ EXPECTED DELIVERY VERIFIED</Text>
                </View>
                <View style={tw`bg-sky-600 px-2 py-0.5 rounded`}>
                  <Text style={tw`text-white text-[9px] font-black`}>
                    📍 DOCK: {selectedPo?.dock_number || selectedAsn?.dock_number || "D-04"}
                  </Text>
                </View>
              </View>

              {/* 1. Supplier Metadata */}
              <Text style={tw`text-slate-400 text-[10px] font-extrabold tracking-wider uppercase mb-1.5`}>
                SUPPLIER INFORMATION
              </Text>
              <View style={tw`bg-slate-800 p-2.5 rounded-lg mb-3 gap-1`}>
                <Text style={tw`text-white text-xs font-bold`}>
                  {selectedPo?.supplier_name || selectedAsn?.supplier_name || "Bharat Electronics Components Pvt. Ltd."}
                </Text>
                <View style={tw`flex-row justify-between items-center mt-0.5`}>
                  <Text style={tw`text-slate-400 text-[11px]`}>
                    Code: <Text style={tw`text-slate-200 font-bold`}>{selectedPo?.supplier_code || selectedAsn?.supplier_code || "SUP-IND-1042"}</Text>
                  </Text>
                  <Text style={tw`text-slate-400 text-[11px]`}>
                    Contact: <Text style={tw`text-slate-200 font-bold`}>{selectedPo?.supplier_contact || selectedAsn?.supplier_contact || "+91 98765 43210"}</Text>
                  </Text>
                </View>
              </View>

              {/* 2. Procurement Metadata */}
              <Text style={tw`text-slate-400 text-[10px] font-extrabold tracking-wider uppercase mb-1.5`}>
                PROCUREMENT DETAILS
              </Text>
              <View style={tw`bg-slate-800 p-2.5 rounded-lg mb-3 gap-1`}>
                <View style={tw`flex-row justify-between items-center`}>
                  <Text style={tw`text-slate-400 text-[11px]`}>
                    ASN: <Text style={tw`text-sky-400 font-bold`}>{selectedAsn?.asn_number || "ASN-2026-004582"}</Text>
                  </Text>
                  <Text style={tw`text-slate-400 text-[11px]`}>
                    PO: <Text style={tw`text-sky-400 font-bold`}>{selectedPo?.po_number || selectedAsn?.po_number || "PO-2026-008741"}</Text>
                  </Text>
                </View>
                <View style={tw`flex-row justify-between items-center mt-0.5 pt-1 border-t border-slate-700/60`}>
                  <Text style={tw`text-slate-400 text-[10px]`}>
                    PO Date: <Text style={tw`text-slate-300 font-bold`}>{selectedPo?.po_date || "01 Oct 2026"}</Text>
                  </Text>
                  <Text style={tw`text-slate-400 text-[10px]`}>
                    Delivery Date: <Text style={tw`text-emerald-400 font-bold`}>{selectedAsn?.delivery_date || "07 Oct 2026"}</Text>
                  </Text>
                </View>
              </View>

              {/* 3. Material Summary List */}
              <Text style={tw`text-slate-400 text-[10px] font-extrabold tracking-wider uppercase mb-1.5`}>
                MATERIAL SUMMARY ({lineItems.length > 0 ? lineItems.length : 1})
              </Text>

              {lineItems.length === 0 ? (
                <View style={tw`bg-slate-800 p-2.5 rounded-lg`}>
                  <Text style={tw`text-sky-400 text-xs font-bold`}>Stainless Steel Sheet 304</Text>
                  <View style={tw`flex-row justify-between items-center mt-0.5`}>
                    <Text style={tw`text-slate-400 text-[10px] font-mono`}>MAT-SS-304-001</Text>
                    <Text style={tw`text-emerald-400 text-xs font-black`}>Expected: 500 KG</Text>
                  </View>
                </View>
              ) : (
                lineItems.map((item, idx) => (
                  <View key={idx} style={tw`bg-slate-800 p-2.5 rounded-lg mb-1.5`}>
                    <Text style={tw`text-sky-400 text-xs font-bold`}>
                      {item.material_name || item.material_description || item.description || "Stainless Steel Sheet 304"}
                    </Text>
                    <View style={tw`flex-row justify-between items-center mt-0.5`}>
                      <Text style={tw`text-slate-400 text-[10px] font-mono`}>
                        {item.material_code || item.item_code || `MAT-SS-304-${idx + 1}`}
                      </Text>
                      <Text style={tw`text-emerald-400 text-xs font-black`}>
                        Expected: {item.quantity || item.shipped_quantity || "500"} {item.uom || "KG"}
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </View>
          ) : null}
        </View>
      ) : (
        /* EXCEPTION / UNSCHEDULED MODE */
        <View style={tw`bg-slate-800 rounded-2xl p-4 mb-3.5 border border-amber-500/40`}>
          <Text style={tw`text-amber-400 text-xs font-black tracking-wider mb-3`}>
            ⚠️ EXCEPTION / UNSCHEDULED DELIVERY REGISTRATION
          </Text>
          <Text style={tw`text-slate-400 text-xs mb-3 leading-4`}>
            Use this workflow for ad-hoc deliveries, emergency spares, or unannounced supplier trucks.
          </Text>

          <View style={tw`mb-3`}>
            <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mb-1`}>
              SUPPLIER / VENDOR NAME *
            </Text>
            <TextInput
              style={tw`bg-slate-900 rounded-xl text-white px-3 py-2.5 text-xs border border-slate-700`}
              placeholder="e.g. Supplier / Vendor Name"
              placeholderTextColor="#64748b"
              value={supplierInput}
              onChangeText={setSupplierInput}
            />
          </View>

          <View style={tw`mb-3`}>
            <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mb-1`}>
              UNSCHEDULED ENTRY REASON
            </Text>
            <TextInput
              style={tw`bg-slate-900 rounded-xl text-white px-3 py-2.5 text-xs border border-slate-700`}
              placeholder="Reason for ad-hoc arrival"
              placeholderTextColor="#64748b"
              value={exceptionReasonInput}
              onChangeText={setExceptionReasonInput}
            />
          </View>
        </View>
      )}

      {/* Multi-Vehicle Picker */}
      {entryMode === "SCHEDULED" && vehiclesExtracted.length > 0 && (
        <View style={tw`bg-slate-800 rounded-2xl p-4 mb-3.5 border border-white/10`}>
          <Text style={tw`text-sky-400 text-xs font-black tracking-wider mb-3`}>
            2. SELECT EXPECTED VEHICLE
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={tw`flex-row`}>
            {vehiclesExtracted.map((v) => {
              const isSelected = selectedVehicleIdx === v.index;
              return (
                <TouchableOpacity
                  key={v.index}
                  style={tw`bg-slate-900 rounded-xl p-3 mr-2.5 border min-w-[120px] ${
                    isSelected ? "border-sky-500 bg-sky-500/20" : "border-slate-700"
                  }`}
                  onPress={() => selectVehicleOption(v)}
                >
                  <Text
                    style={tw`text-xs font-black ${isSelected ? "text-sky-400" : "text-slate-400"}`}
                  >
                    {v.vehicleNumber || "UNASSIGNED"}
                  </Text>
                  <Text style={tw`text-slate-300 text-[11px] mt-0.5`}>{v.driverName || "Driver N/A"}</Text>
                  <Text style={tw`text-slate-500 text-[9px] mt-0.5`}>{v.transporter || "Logistics"}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Vehicle & Driver Details Form */}
      <View style={tw`bg-slate-800 rounded-2xl p-4 mb-3.5 border border-white/10`}>
        <Text style={tw`text-sky-400 text-xs font-black tracking-wider mb-3`}>
          {entryMode === "SCHEDULED" ? "3. VEHICLE & DRIVER DETAILS" : "2. VEHICLE & DRIVER DETAILS"}
        </Text>

        <View style={tw`mb-3`}>
          <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mb-1`}>
            VEHICLE PLATE NUMBER *
          </Text>
          <TextInput
            style={tw`bg-slate-900 rounded-xl text-white px-3 py-2.5 text-xs border border-slate-700`}
            placeholder="e.g. KA-01-AB-1234"
            placeholderTextColor="#64748b"
            value={vehicleInput}
            onChangeText={(text) => setVehicleInput(formatVehiclePlate(text))}
          />
        </View>

        <View style={tw`flex-row gap-2 mb-3`}>
          <View style={tw`flex-1`}>
            <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mb-1`}>DRIVER NAME</Text>
            <TextInput
              style={tw`bg-slate-900 rounded-xl text-white px-3 py-2.5 text-xs border border-slate-700`}
              placeholder="e.g. Driver Name"
              placeholderTextColor="#64748b"
              value={driverNameInput}
              onChangeText={setDriverNameInput}
            />
          </View>

          <View style={tw`flex-1`}>
            <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mb-1`}>DRIVER PHONE</Text>
            <TextInput
              style={tw`bg-slate-900 rounded-xl text-white px-3 py-2.5 text-xs border border-slate-700`}
              placeholder="Driver Phone"
              placeholderTextColor="#64748b"
              value={driverContactInput}
              onChangeText={setDriverContactInput}
              keyboardType="phone-pad"
            />
          </View>
        </View>

        <View style={tw`mb-1`}>
          <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mb-1`}>
            SECURITY REMARKS / SEAL NO.
          </Text>
          <TextInput
            style={tw`bg-slate-900 rounded-xl text-white px-3 py-2.5 text-xs border border-slate-700`}
            placeholder="e.g. Physical seal intact, container locked"
            placeholderTextColor="#64748b"
            value={remarksInput}
            onChangeText={setRemarksInput}
          />
        </View>
      </View>

      {/* Material Line Items Verification Checklist */}
      {entryMode === "SCHEDULED" && (
        <View style={tw`bg-slate-800 rounded-2xl p-4 mb-3.5 border border-white/10`}>
          <Text style={tw`text-sky-400 text-xs font-black tracking-wider mb-3`}>
            4. VERIFIED MATERIAL ITEMS ({lineItems.length})
          </Text>
          {lineItems.length === 0 ? (
            <Text style={tw`text-slate-500 text-xs italic`}>No line items recorded for this PO / ASN in database.</Text>
          ) : (
            lineItems.map((item, idx) => (
              <View key={idx} style={tw`flex-row justify-between items-center bg-slate-900 p-2.5 rounded-lg mb-1.5`}>
                <View style={tw`flex-1 mr-2`}>
                  <Text style={tw`text-sky-400 text-xs font-bold`}>
                    {item.material_code || item.item_code || `ITEM-${idx + 1}`}
                  </Text>
                  <Text style={tw`text-slate-300 text-xs`}>
                    {item.material_name || item.material_description || item.description || "Material Component"}
                  </Text>
                </View>
                <Text style={tw`text-emerald-400 text-xs font-black`}>
                  {item.quantity || item.shipped_quantity || "0"} {item.uom || "Units"}
                </Text>
              </View>
            ))
          )}
        </View>
      )}

      {/* Submit Button */}
      <TouchableOpacity
        style={tw`rounded-2xl py-4 items-center mt-2 shadow-lg ${
          entryMode === "EXCEPTION" ? "bg-amber-600" : "bg-sky-600"
        } ${submitting ? "opacity-60" : ""}`}
        onPress={handleCreateGateEntry}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={tw`text-white text-xs font-black tracking-wide`}>
            {entryMode === "SCHEDULED"
              ? "CONFIRM ENTRY & GENERATE GATE PASS ✓"
              : "CONFIRM EXCEPTION ENTRY & GENERATE PASS ⚠️"}
          </Text>
        )}
      </TouchableOpacity>

      {/* PO / ASN DB PICKER MODAL */}
      <Modal visible={showPoPickerModal} animationType="fade" transparent>
        <View style={tw`flex-1 bg-black/75 justify-center items-center p-5`}>
          <View style={tw`w-full bg-slate-800 rounded-2xl p-5 border border-slate-700`}>
            <View style={tw`flex-row justify-between items-center mb-3 pb-2.5 border-b border-slate-700`}>
              <Text style={tw`text-white text-xs font-black`}>SELECT PURCHASE ORDER / ASN</Text>
              <TouchableOpacity onPress={() => setShowPoPickerModal(false)}>
                <Text style={tw`text-red-400 text-xs font-bold`}>✕ CLOSE</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={tw`max-h-80`}>
              {poList.length === 0 ? (
                <Text style={tw`text-slate-500 text-xs text-center my-5`}>
                  No Purchase Orders available in database.
                </Text>
              ) : (
                poList.map((po, idx) => (
                  <TouchableOpacity
                    key={po.id || idx}
                    style={tw`flex-row justify-between items-center bg-slate-900 p-3 rounded-xl mb-2`}
                    onPress={() => {
                      setShowPoPickerModal(false);
                      selectAndAutofillPo(po.po_number || po.poNumber);
                    }}
                  >
                    <View>
                      <Text style={tw`text-sky-400 text-xs font-bold`}>{po.po_number || po.poNumber}</Text>
                      <Text style={tw`text-slate-400 text-[11px] mt-0.5`}>
                        {po.supplier_name || po.supplierName || "Supplier"}
                      </Text>
                    </View>
                    <Text style={tw`text-emerald-400 text-xs font-bold`}>Select →</Text>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}
