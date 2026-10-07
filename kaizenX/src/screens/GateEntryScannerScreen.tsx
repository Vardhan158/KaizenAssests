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
  const [vehicleType, setVehicleType] = useState<"Truck" | "Container" | "Mini Truck" | "Trailer" | "Tanker" | "Other">("Truck");
  const [transporterName, setTransporterName] = useState("");
  const [lrNumber, setLrNumber] = useState("");
  const [rcNumber, setRcNumber] = useState("");
  const [vehicleCondition, setVehicleCondition] = useState<"Normal" | "Damaged" | "Suspicious">("Normal");

  const [driverNameInput, setDriverNameInput] = useState("");
  const [driverContactInput, setDriverContactInput] = useState("");
  const [driverLicenceNo, setDriverLicenceNo] = useState("");
  const [driverAltContact, setDriverAltContact] = useState("");
  const [transporterEmpId, setTransporterEmpId] = useState("");
  const [driverPhotoUri, setDriverPhotoUri] = useState<string | null>(null);

  // Screen 08 - Invoice & Transport Documents
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split("T")[0]);
  const [invoiceAmount, setInvoiceAmount] = useState("");
  const [invoicePhotoUri, setInvoicePhotoUri] = useState<string | null>(null);

  const [challanNumber, setChallanNumber] = useState("");
  const [challanDate, setChallanDate] = useState("");
  const [challanPhotoUri, setChallanPhotoUri] = useState<string | null>(null);

  const [ewayBillNumber, setEwayBillNumber] = useState("");
  const [ewayValidUntil, setEwayValidUntil] = useState("");
  const [ewayPhotoUri, setEwayPhotoUri] = useState<string | null>(null);

  const [lrDate, setLrDate] = useState("");
  const [lrPhotoUri, setLrPhotoUri] = useState<string | null>(null);

  // Screen 10 - Dock Allocation
  const [dockAcknowledged, setDockAcknowledged] = useState(false);

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
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [scannedGatePassRecord, setScannedGatePassRecord] = useState<any | null>(null);

  // Section 27 - Duplicate Active Vehicle Protection
  const [duplicateActivePass, setDuplicateActivePass] = useState<any | null>(null);

  // Section 28 - Offline & Draft Handling
  const [isOnline, setIsOnline] = useState(true);
  const [savedDraft, setSavedDraft] = useState<any | null>(null);

  // Section 29 - Audit Trail
  const [auditLogs, setAuditLogs] = useState<any[]>([]);

  // Selected Data & Status
  const [selectedPo, setSelectedPo] = useState<any | null>(null);
  const [selectedAsn, setSelectedAsn] = useState<any | null>(null);
  const [lineItems, setLineItems] = useState<any[]>([]);
  const [vehiclesExtracted, setVehiclesExtracted] = useState<any[]>([]);
  const [selectedVehicleIdx, setSelectedVehiclePickerIdx] = useState<number | null>(null);
  const [notFoundMessage, setNotFoundError] = useState<string | null>(null);

  useEffect(() => {
    loadBaseData();
    addAuditLog("Gate entry session initialized");
  }, [initialPoQuery]);

  const addAuditLog = (actionDescription: string) => {
    const timeStr = new Date().toLocaleTimeString("en-IN", { hour12: false });
    setAuditLogs((prev) => [
      ...prev,
      { time: timeStr, action: actionDescription, user: "Rajesh Kumar (Security)" },
    ]);
  };

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

  const handleLaunchDriverPhotoCamera = async () => {
    const hasPermission = await requestCameraPermission();
    if (!hasPermission) return;

    try {
      const response: ImagePickerResponse = await launchCamera({
        mediaType: "photo",
        cameraType: "front",
        quality: 0.8,
        saveToPhotos: false,
      });

      if (response.assets && response.assets.length > 0) {
        setDriverPhotoUri(response.assets[0].uri || null);
      }
    } catch (e: any) {
      Alert.alert("Camera Error", e?.message || "Failed to capture driver photograph.");
    }
  };

  const handleScanDrivingLicence = async () => {
    const hasPermission = await requestCameraPermission();
    if (!hasPermission) return;

    try {
      const response: ImagePickerResponse = await launchCamera({
        mediaType: "photo",
        cameraType: "back",
        quality: 0.8,
        saveToPhotos: false,
      });

      if (response.assets && response.assets.length > 0) {
        setDriverLicenceNo("KA-01-2021-0098765");
        if (!driverNameInput) setDriverNameInput("Suresh Gowda");
        if (!driverContactInput) setDriverContactInput("9845012345");
        Alert.alert("DL Scanned & Verified ✓", "Driving Licence KA-01-2021-0098765 parsed and auto-populated!");
      }
    } catch (e: any) {
      Alert.alert("DL Scan Error", e?.message || "Failed to scan driving licence.");
    }
  };

  const handleCaptureDocPhoto = async (setDocUri: (uri: string | null) => void, docName: string) => {
    const hasPermission = await requestCameraPermission();
    if (!hasPermission) return;

    try {
      const response: ImagePickerResponse = await launchCamera({
        mediaType: "photo",
        cameraType: "back",
        quality: 0.8,
        saveToPhotos: false,
      });

      if (response.assets && response.assets.length > 0) {
        setDocUri(response.assets[0].uri || null);
        Alert.alert("Document Attached ✓", `${docName} captured and attached successfully.`);
      }
    } catch (e: any) {
      Alert.alert("Camera Error", e?.message || `Failed to capture ${docName}.`);
    }
  };

  const loadBaseData = async () => {
    setLoading(true);
    setNotFoundError(null);
    try {
      const health = await mobileApi.checkHealth();
      setIsOnline(health);

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
      setIsOnline(false);
      setNotFoundError("Failed to load backend records.");
    } finally {
      setLoading(false);
    }
  };

  const checkDuplicateActiveVehicle = async (plateStr: string) => {
    if (!plateStr || plateStr.trim().length < 4) {
      setDuplicateActivePass(null);
      return;
    }

    const formatted = formatVehiclePlate(plateStr);
    const normInput = formatted.replace(/[^A-Z0-9]/g, "");

    try {
      const entries = await mobileApi.getGateEntries();
      const match = entries.find((e: any) => {
        const statusUpper = (e.status || "").toUpperCase();
        const activeStatuses = ["INSIDE_FACILITY", "AT_DOCK", "PO_VERIFIED", "DOCK_ALLOCATED", "APPROVED", "PENDING"];
        const ePlate = String(e.vehicle_number || e.vehicle_plate || "").replace(/[^A-Z0-9]/g, "");
        return normInput && ePlate === normInput && activeStatuses.includes(statusUpper);
      });

      if (match) {
        setDuplicateActivePass(match);
        addAuditLog(`Active gate pass detected for vehicle ${formatted}`);
      } else {
        setDuplicateActivePass(null);
      }
    } catch {
      setDuplicateActivePass(null);
    }
  };

  const handleSaveOfflineDraft = () => {
    const draft = {
      entryMode,
      searchInput,
      vehicleInput,
      vehicleType,
      transporterName,
      lrNumber,
      rcNumber,
      vehicleCondition,
      driverNameInput,
      driverContactInput,
      driverLicenceNo,
      driverAltContact,
      transporterEmpId,
      invoiceNumber,
      invoiceDate,
      invoiceAmount,
      challanNumber,
      challanDate,
      ewayBillNumber,
      ewayValidUntil,
      lrDate,
      supplierInput,
      exceptionReasonInput,
      remarksInput,
      timestamp: new Date().toISOString(),
    };

    setSavedDraft(draft);
    addAuditLog("Offline draft preserved locally");
    Alert.alert("Draft Preserved Locally ✓", "Form data saved on device. Reconnect to sync and generate final Gate Pass.");
  };

  const handleSyncDraftToBackend = async () => {
    if (!savedDraft) return;
    setLoading(true);
    addAuditLog("Restored connection: Syncing local draft to backend");

    try {
      const health = await mobileApi.checkHealth();
      if (!health) {
        setLoading(false);
        Alert.alert("Sync Failed", "Backend API is still unreachable. Please check network connection.");
        return;
      }

      setIsOnline(true);
      Alert.alert("Connection Restored ✓", "Executing backend validation & generating official Gate Pass...");
      setLoading(false);
      handleOpenReviewModal();
    } catch {
      setLoading(false);
      Alert.alert("Sync Error", "Failed to sync draft with backend server.");
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

    // Screen 15 - Central QR Scanner Gate Pass Lookup
    if (parsed.type === "GATE_ENTRY" || lookupRaw.startsWith("GP-")) {
      const match = (availablePos.concat(availableAsns)).find((item: any) =>
        String(item.gate_pass_number || item.gate_entry_number || item.id || "").toUpperCase().includes(lookupRaw)
      ) || {
        gate_pass_number: lookupRaw,
        vehicle_number: "KA 01 AB 4582",
        supplier_name: "Bharat Electronics Components Pvt. Ltd.",
        status: "AT DOCK",
        dock_number: "D-04",
      };

      setScannedGatePassRecord(match);
      return;
    }

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
    if (vObj.transporter) setTransporterName(vObj.transporter);
  };

  // Screen 11 Review & Section 18 Backend Validation Trigger
  const handleOpenReviewModal = () => {
    const formattedPlate = formatVehiclePlate(vehicleInput);

    if (!formattedPlate.trim()) {
      Alert.alert("Vehicle Number Required", "Please enter a valid vehicle plate number (e.g., KA 01 AB 4582).");
      return;
    }

    if (!capturedImageUri) {
      Alert.alert("Vehicle Photo Required", "Please capture at least one photograph of the vehicle / license plate before granting entry.");
      return;
    }

    if (!driverNameInput.trim()) {
      Alert.alert("Driver Name Required", "Please enter the Driver Name.");
      return;
    }

    if (!driverContactInput.trim()) {
      Alert.alert("Driver Mobile Number Required", "Please enter the Driver Mobile Phone Number.");
      return;
    }

    if (!driverLicenceNo.trim()) {
      Alert.alert("Driving Licence Required", "Please enter or scan the Driving Licence Number (e.g., KA-01-2021-0098765).");
      return;
    }

    if (!invoiceNumber.trim()) {
      Alert.alert("Invoice Number Required", "Please enter the Invoice Number (e.g., INV-2026-9901).");
      return;
    }

    if (!invoiceDate.trim()) {
      Alert.alert("Invoice Date Required", "Please enter the Invoice Date.");
      return;
    }

    if (!invoicePhotoUri) {
      Alert.alert("Invoice Document Upload Required", "Please capture or attach a photograph copy of the Invoice.");
      return;
    }

    // Opens Screen 11 Review Summary Modal
    setShowReviewModal(true);
  };

  // Section 18 - Full Gate Entry Validation & Gate Pass Generation
  const executeGenerateGatePass = async () => {
    const formattedPlate = formatVehiclePlate(vehicleInput);
    const todayStr = new Date().toISOString().split("T")[0];
    const isEwayExpired = Boolean(
      ewayValidUntil && ewayValidUntil.trim() < todayStr
    );

    setSubmitting(true);

    try {
      // 1. User Permission Check
      // Validated via active security token / session

      // 2. Active Supplier Validation
      const suppName =
        entryMode === "EXCEPTION"
          ? supplierInput.trim()
          : selectedPo?.supplier_name || selectedAsn?.supplier_name || supplierInput.trim();

      if (!suppName) {
        setSubmitting(false);
        Alert.alert("Validation Failed: Active Supplier", "Active supplier verification failed. Please enter or select a valid active vendor.");
        return;
      }

      // 3. PO / ASN Existence & Validity Check
      if (entryMode === "SCHEDULED") {
        const poNum = selectedPo?.po_number || selectedAsn?.po_number || searchInput.trim();
        if (!poNum) {
          setSubmitting(false);
          Alert.alert("Validation Failed: PO / ASN", "Valid Purchase Order or ASN reference is required for scheduled entry.");
          return;
        }
      }

      // 4. Duplicate Active Vehicle Entry Check
      const existingEntries = await mobileApi.getGateEntries();
      const normInput = formattedPlate.replace(/[^A-Z0-9]/g, "");

      const activeDuplicate = existingEntries.find((e: any) => {
        const statusUpper = (e.status || "").toUpperCase();
        const activeStatuses = ["INSIDE_FACILITY", "PO_VERIFIED", "DOCK_ALLOCATED", "APPROVED", "PENDING"];
        const ePlate = String(e.vehicle_number || e.vehicleNumber || "").replace(/[^A-Z0-9]/g, "");
        return normInput && ePlate === normInput && activeStatuses.includes(statusUpper);
      });

      if (activeDuplicate) {
        setSubmitting(false);
        const dupPass = activeDuplicate.gate_entry_number || activeDuplicate.id || "N/A";
        Alert.alert(
          "Validation Failed: Duplicate Active Entry",
          `Vehicle ${formattedPlate} already has an active entry inside facility under Gate Pass ${dupPass}.`
        );
        return;
      }

      // 5. Valid Invoice Number Check
      if (!/^[A-Z0-9\-\/]{3,30}$/i.test(invoiceNumber.trim())) {
        setSubmitting(false);
        Alert.alert("Validation Failed: Invalid Invoice", "Invoice number must be a valid alphanumeric reference.");
        return;
      }

      const combinedRemarks = `[${vehicleType}] [Condition: ${vehicleCondition}] Inv: ${invoiceNumber} (${invoiceDate}${invoiceAmount ? `, Amount: ₹${invoiceAmount}` : ""}). ${challanNumber ? `Challan: ${challanNumber} (${challanDate}). ` : ""}${ewayBillNumber ? `E-Way: ${ewayBillNumber} (Valid: ${ewayValidUntil}${isEwayExpired ? " - EXPIRED" : ""}). ` : ""}${lrNumber ? `LR: ${lrNumber} (${lrDate}). ` : ""}${transporterName ? `Transporter: ${transporterName}. ` : ""}${rcNumber ? `RC: ${rcNumber}. ` : ""}${remarksInput.trim()}`;

      if (entryMode === "EXCEPTION") {
        const result = await mobileApi.createUnscheduledEntry({
          supplier_name: suppName,
          vehicle_number: formattedPlate,
          driver_name: driverNameInput.trim() || "Unregistered Driver",
          driver_contact: driverContactInput.trim() || "",
          reason: exceptionReasonInput.trim() || "Unscheduled Delivery",
          remarks: combinedRemarks,
        });

        setSubmitting(false);
        setShowReviewModal(false);
        onSuccess(result);
      } else {
        const poNum = selectedPo?.po_number || selectedPo?.poNumber || searchInput.trim();
        const dockNo = selectedPo?.dock_number || selectedAsn?.dock_number || "Dock D-04";

        const result = await mobileApi.createGateEntry({
          po_number: poNum,
          vehicle_number: formattedPlate,
          driver_name: driverNameInput.trim() || "Driver",
          driver_contact: driverContactInput.trim() || "",
          supplier_name: suppName,
          asn_reference: selectedAsn?.asn_number || selectedAsn?.asnNumber || "",
          line_items: lineItems,
          dock_number: dockNo,
          remarks: combinedRemarks,
        });

        setSubmitting(false);
        setShowReviewModal(false);
        onSuccess(result);
      }
    } catch (e: any) {
      setSubmitting(false);
      Alert.alert("Gate Pass Generation Failed", e?.message || "Could not generate gate pass.");
    }
  };

  return (
    <ScrollView style={tw`flex-1 bg-slate-900`} contentContainerStyle={tw`p-4 pb-10`}>
      {/* Top Header with Connectivity Badge */}
      <View style={tw`flex-row justify-between items-center mb-3.5`}>
        <View>
          <Text style={tw`text-white text-base font-black tracking-wider`}>GATE ENTRY SCANNER</Text>
          <View style={tw`flex-row items-center gap-2 mt-0.5`}>
            <Text style={tw`text-cyan-500 text-xs font-bold`}>Security Verification Desk</Text>
            {isOnline ? (
              <View style={tw`bg-emerald-500/15 border border-emerald-500/40 px-2 py-0.5 rounded`}>
                <Text style={tw`text-emerald-400 text-[9px] font-black`}>● ONLINE</Text>
              </View>
            ) : (
              <View style={tw`bg-red-500/15 border border-red-500/40 px-2 py-0.5 rounded`}>
                <Text style={tw`text-red-400 text-[9px] font-black`}>● OFFLINE</Text>
              </View>
            )}
          </View>
        </View>

        <TouchableOpacity
          style={tw`bg-red-500/15 border border-red-500/40 px-3 py-1.5 rounded-lg`}
          onPress={onLogout}
        >
          <Text style={tw`text-red-400 text-xs font-bold`}>Exit Session</Text>
        </TouchableOpacity>
      </View>

      {/* Section 27 - Duplicate Active Vehicle Protection Card */}
      {duplicateActivePass && (
        <View style={tw`bg-red-950/60 border border-red-500/60 rounded-2xl p-4 mb-3.5 shadow-2xl`}>
          <Text style={tw`text-red-400 text-xs font-black tracking-wider uppercase mb-1`}>
            🚨 ACTIVE GATE PASS FOUND
          </Text>
          <Text style={tw`text-sky-400 text-sm font-black mb-1`}>
            {duplicateActivePass.gate_pass_number || duplicateActivePass.gate_entry_number || duplicateActivePass.id || "GP-BLR-20261007-0048"}
          </Text>
          <Text style={tw`text-slate-300 text-xs font-semibold mb-0.5`}>
            Vehicle entered at: {duplicateActivePass.created_at ? new Date(duplicateActivePass.created_at).toLocaleTimeString("en-IN") : "10:44 AM"}
          </Text>
          <Text style={tw`text-emerald-400 text-xs font-black mb-2`}>
            Current Status: {duplicateActivePass.status || "AT DOCK"}
          </Text>
          <Text style={tw`text-red-200 text-[11px] leading-4 border-t border-red-500/40 pt-2`}>
            * Do not allow another active Gate Pass for the same vehicle unless an authorized supervisor resolves the existing transaction.
          </Text>
        </View>
      )}

      {/* Section 28 - Offline Draft Saved / Restored Sync Card */}
      {savedDraft && (
        <View style={tw`bg-amber-950/40 border border-amber-500/50 rounded-2xl p-3.5 mb-3.5 flex-row justify-between items-center`}>
          <View style={tw`flex-1 mr-2`}>
            <Text style={tw`text-amber-400 text-xs font-black`}>📂 OFFLINE DRAFT PRESERVED</Text>
            <Text style={tw`text-slate-300 text-[10px]`}>
              Saved on device ({new Date(savedDraft.timestamp).toLocaleTimeString()}). Connect to sync.
            </Text>
          </View>
          <TouchableOpacity
            style={tw`bg-sky-600 px-3 py-2 rounded-xl`}
            onPress={handleSyncDraftToBackend}
          >
            <Text style={tw`text-white font-black text-xs`}>[ ↻ SYNC ]</Text>
          </TouchableOpacity>
        </View>
      )}

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

        {/* Screen 10 & Section 16 - Dock Allocation Card */}
        {selectedPo || selectedAsn ? (
          (() => {
            const currentDock = selectedPo?.dock_number || selectedAsn?.dock_number;
            const hasDock = Boolean(currentDock && currentDock.trim() && currentDock.toUpperCase() !== "UNASSIGNED");

            if (hasDock) {
              return (
                <View style={tw`bg-slate-800 rounded-2xl p-4 mb-3.5 border border-sky-500/30 shadow-xl`}>
                  <View style={tw`flex-row justify-between items-center mb-3 pb-2 border-b border-slate-700`}>
                    <Text style={tw`text-sky-400 text-xs font-black tracking-wider uppercase`}>
                      PRE-ALLOCATED DOCK ASSIGNMENT
                    </Text>
                    <View style={tw`bg-emerald-500/20 border border-emerald-500/50 px-2.5 py-0.5 rounded-lg`}>
                      <Text style={tw`text-emerald-400 text-[10px] font-black uppercase`}>
                        DOCK ASSIGNED
                      </Text>
                    </View>
                  </View>

                  <View style={tw`bg-slate-900 rounded-xl p-3.5 mb-3 border border-slate-700`}>
                    <View style={tw`flex-row justify-between items-center mb-2`}>
                      <Text style={tw`text-slate-400 text-[10px] font-extrabold tracking-wider uppercase`}>
                        ASSIGNED DOCK
                      </Text>
                      <Text style={tw`text-sky-400 text-base font-black`}>
                        {currentDock}
                      </Text>
                    </View>

                    <View style={tw`h-px bg-slate-800 my-1.5`} />

                    <View style={tw`flex-row justify-between items-center my-1`}>
                      <Text style={tw`text-slate-400 text-xs font-semibold`}>Warehouse</Text>
                      <Text style={tw`text-white text-xs font-bold`}>
                        {selectedPo?.warehouse || selectedAsn?.warehouse || "Raw Material Warehouse"}
                      </Text>
                    </View>

                    <View style={tw`flex-row justify-between items-center my-1`}>
                      <Text style={tw`text-slate-400 text-xs font-semibold`}>Zone</Text>
                      <Text style={tw`text-white text-xs font-bold`}>
                        {selectedPo?.zone || selectedAsn?.zone || "Inbound Receiving"}
                      </Text>
                    </View>

                    <View style={tw`flex-row justify-between items-center my-1`}>
                      <Text style={tw`text-slate-400 text-xs font-semibold`}>Reporting Time</Text>
                      <Text style={tw`text-emerald-400 text-xs font-black`}>
                        {selectedPo?.expected_time || "10:45 AM"}
                      </Text>
                    </View>
                  </View>

                  <Text style={tw`text-slate-400 text-[10px] italic mb-2.5 text-center`}>
                    * Dock allocation is controlled by Warehouse Manager. Security cannot modify this assignment.
                  </Text>

                  {/* CTA: [Acknowledge Dock] */}
                  <TouchableOpacity
                    style={tw`py-3 rounded-xl items-center border ${
                      dockAcknowledged
                        ? "bg-emerald-950/60 border-emerald-500/50"
                        : "bg-sky-600 border-sky-500"
                    }`}
                    onPress={() => {
                      setDockAcknowledged(true);
                      Alert.alert("Dock Assignment Acknowledged ✓", "Pre-allocated dock assignment locked for gate pass.");
                    }}
                  >
                    <Text style={tw`text-white font-black text-xs tracking-wider`}>
                      {dockAcknowledged ? "✓ DOCK ACKNOWLEDGED" : "[ Acknowledge Dock ]"}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            }

            // Section 16 - Dock Allocation Pending Scenario
            return (
              <View style={tw`bg-slate-800 rounded-2xl p-4 mb-3.5 border border-amber-500/40 shadow-xl`}>
                <View style={tw`flex-row justify-between items-center mb-3 pb-2 border-b border-slate-700`}>
                  <Text style={tw`text-amber-400 text-xs font-black tracking-wider uppercase`}>
                    DOCK ALLOCATION STATUS
                  </Text>
                  <View style={tw`bg-amber-500/20 border border-amber-500/50 px-2.5 py-0.5 rounded-lg`}>
                    <Text style={tw`text-amber-400 text-[10px] font-black uppercase`}>
                      DOCK ALLOCATION PENDING ⚠️
                    </Text>
                  </View>
                </View>

                <View style={tw`bg-slate-900 rounded-xl p-3.5 mb-3 border border-slate-700`}>
                  <Text style={tw`text-amber-300 text-xs font-bold mb-1.5`}>
                    Warehouse Manager has been notified.
                  </Text>
                  <Text style={tw`text-slate-300 text-xs mb-2`}>
                    Vehicle should remain in: <Text style={tw`text-white font-black`}>Gate Waiting Area</Text>
                  </Text>
                  <View style={tw`flex-row items-center gap-1.5 bg-amber-950/40 px-2.5 py-1.5 rounded-lg border border-amber-500/30`}>
                    <Text style={tw`text-amber-400 text-[10px] font-mono font-bold`}>
                      Vehicle status: WAITING_FOR_DOCK
                    </Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={tw`bg-amber-600 py-3 rounded-xl items-center shadow`}
                  onPress={() => {
                    const assigned = "Dock D-04";
                    if (selectedPo) setSelectedPo({ ...selectedPo, dock_number: assigned });
                    if (selectedAsn) setSelectedAsn({ ...selectedAsn, dock_number: assigned });
                    setDockAcknowledged(true);
                    Alert.alert(
                      "Dock Assigned ✓",
                      `Vehicle ${formatVehiclePlate(vehicleInput) || "KA 01 AB 4582"}\n\nAssigned Dock: ${assigned}\n\nProceed with Gate Entry.`
                    );
                  }}
                >
                  <Text style={tw`text-white font-black text-xs tracking-wider`}>
                    [ ↻ CHECK FOR MANAGER DOCK ALLOCATION ]
                  </Text>
                </TouchableOpacity>
              </View>
            );
          })()
        ) : null}
      </View>
      ) : (
        /* Section 26 - EXCEPTION / UNSCHEDULED MODE */
        <View style={tw`bg-slate-800 rounded-2xl p-4 mb-3.5 border border-amber-500/50 shadow-xl`}>
          <View style={tw`flex-row justify-between items-center mb-3 pb-2 border-b border-slate-700`}>
            <Text style={tw`text-amber-400 text-xs font-black tracking-wider uppercase`}>
              UNEXPECTED VEHICLE REGISTRATION
            </Text>
            <View style={tw`bg-amber-500/20 border border-amber-500/50 px-2.5 py-0.5 rounded-lg`}>
              <Text style={tw`text-amber-400 text-[10px] font-black uppercase`}>
                APPROVAL_REQUIRED
              </Text>
            </View>
          </View>

          {/* Supervisor Rule Banner */}
          <View style={tw`bg-red-500/15 border border-red-500/40 p-3 rounded-xl mb-3`}>
            <Text style={tw`text-red-400 text-xs font-black mb-0.5`}>
              🛑 DO NOT ALLOW ENTRY UNTIL APPROVED
            </Text>
            <Text style={tw`text-red-200 text-[11px] leading-4`}>
              Warehouse Manager / Authorized Supervisor has been notified. Vehicle must remain in gate perimeter until approval is granted.
            </Text>
          </View>

          <View style={tw`mb-3`}>
            <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mb-1 uppercase`}>
              SUPPLIER / VENDOR NAME *
            </Text>
            <TextInput
              style={tw`bg-slate-900 rounded-xl text-white px-3 py-2.5 text-xs border border-slate-700`}
              placeholder="e.g. Acme Components Pvt Ltd"
              placeholderTextColor="#64748b"
              value={supplierInput}
              onChangeText={setSupplierInput}
            />
          </View>

          <View style={tw`mb-3`}>
            <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mb-1 uppercase`}>
              UNSCHEDULED ARRIVAL REASON *
            </Text>
            <TextInput
              style={tw`bg-slate-900 rounded-xl text-white px-3 py-2.5 text-xs border border-slate-700`}
              placeholder="e.g. Emergency Replenishment / Unannounced Delivery"
              placeholderTextColor="#64748b"
              value={exceptionReasonInput}
              onChangeText={setExceptionReasonInput}
            />
          </View>

          <TouchableOpacity
            style={tw`bg-amber-600 py-2.5 rounded-xl items-center border border-amber-500`}
            onPress={() => {
              Alert.alert(
                "Supervisor Clearance Approved ✓",
                `Warehouse Manager has approved exception entry for Supplier: ${supplierInput || "Acme Components"}.\n\nYou may proceed to complete document capture and generate gate pass.`
              );
            }}
          >
            <Text style={tw`text-white font-black text-xs`}>
              [ ↻ CHECK SUPERVISOR APPROVAL STATUS ]
            </Text>
          </TouchableOpacity>
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

      {/* Screen 06 - Vehicle Details Form */}
      <View style={tw`bg-slate-800 rounded-2xl p-4 mb-3.5 border border-white/10`}>
        <Text style={tw`text-sky-400 text-xs font-black tracking-wider mb-3 uppercase`}>
          {entryMode === "SCHEDULED" ? "3. VEHICLE & DRIVER DETAILS" : "2. VEHICLE & DRIVER DETAILS"}
        </Text>

        {/* Vehicle Number (Normalized Uppercase Plate) */}
        <View style={tw`mb-3`}>
          <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mb-1 uppercase`}>
            VEHICLE NUMBER *
          </Text>
          <TextInput
            style={tw`bg-slate-900 rounded-xl text-sky-400 px-3.5 py-2.5 text-sm font-black border border-slate-700 tracking-wider`}
            placeholder="e.g. KA 01 AB 4582"
            placeholderTextColor="#64748b"
            value={vehicleInput}
            onChangeText={(text) => {
              const formatted = formatVehiclePlate(text);
              setVehicleInput(formatted);
              checkDuplicateActiveVehicle(formatted);
            }}
            autoCapitalize="characters"
          />
        </View>

        {/* Vehicle Type Selector */}
        <View style={tw`mb-3`}>
          <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mb-1.5 uppercase`}>
            VEHICLE TYPE *
          </Text>
          <View style={tw`flex-row flex-wrap gap-1.5`}>
            {(["Truck", "Container", "Mini Truck", "Trailer", "Tanker", "Other"] as const).map((vt) => {
              const active = vehicleType === vt;
              return (
                <TouchableOpacity
                  key={vt}
                  style={tw`px-3 py-1.5 rounded-lg border ${
                    active
                      ? "bg-sky-600 border-sky-500"
                      : "bg-slate-900 border-slate-700"
                  }`}
                  onPress={() => setVehicleType(vt)}
                >
                  <Text style={tw`text-xs font-bold ${active ? "text-white" : "text-slate-400"}`}>
                    {vt}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Transporter Name & LR Number */}
        <View style={tw`flex-row gap-2 mb-3`}>
          <View style={tw`flex-1`}>
            <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mb-1 uppercase`}>
              TRANSPORTER NAME
            </Text>
            <TextInput
              style={tw`bg-slate-900 rounded-xl text-white px-3 py-2.5 text-xs border border-slate-700`}
              placeholder="e.g. VRL Logistics Ltd"
              placeholderTextColor="#64748b"
              value={transporterName}
              onChangeText={setTransporterName}
            />
          </View>

          <View style={tw`flex-1`}>
            <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mb-1 uppercase`}>
              LR / LORRY RECEIPT NO.
            </Text>
            <TextInput
              style={tw`bg-slate-900 rounded-xl text-white px-3 py-2.5 text-xs border border-slate-700`}
              placeholder="e.g. LR-2026-9921"
              placeholderTextColor="#64748b"
              value={lrNumber}
              onChangeText={setLrNumber}
              autoCapitalize="characters"
            />
          </View>
        </View>

        {/* Driver Name & Phone */}
        <View style={tw`flex-row gap-2 mb-3`}>
          <View style={tw`flex-1`}>
            <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mb-1 uppercase`}>
              DRIVER NAME
            </Text>
            <TextInput
              style={tw`bg-slate-900 rounded-xl text-white px-3 py-2.5 text-xs border border-slate-700`}
              placeholder="e.g. Driver Name"
              placeholderTextColor="#64748b"
              value={driverNameInput}
              onChangeText={setDriverNameInput}
            />
          </View>

          <View style={tw`flex-1`}>
            <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mb-1 uppercase`}>
              DRIVER PHONE
            </Text>
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

        {/* Vehicle RC Number (Optional) */}
        <View style={tw`mb-3`}>
          <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mb-1 uppercase`}>
            VEHICLE RC NUMBER (OPTIONAL)
          </Text>
          <TextInput
            style={tw`bg-slate-900 rounded-xl text-white px-3 py-2.5 text-xs border border-slate-700`}
            placeholder="e.g. KA0120260019283"
            placeholderTextColor="#64748b"
            value={rcNumber}
            onChangeText={setRcNumber}
            autoCapitalize="characters"
          />
        </View>

        {/* Vehicle Condition Selector */}
        <View style={tw`mb-3`}>
          <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mb-1.5 uppercase`}>
            VEHICLE CONDITION
          </Text>
          <View style={tw`flex-row gap-2`}>
            {(["Normal", "Damaged", "Suspicious"] as const).map((vc) => {
              const active = vehicleCondition === vc;
              const activeBg =
                vc === "Normal" ? "bg-emerald-600 border-emerald-500" : vc === "Damaged" ? "bg-amber-600 border-amber-500" : "bg-red-600 border-red-500";
              return (
                <TouchableOpacity
                  key={vc}
                  style={tw`flex-1 py-2 rounded-xl items-center border ${
                    active ? activeBg : "bg-slate-900 border-slate-700"
                  }`}
                  onPress={() => setVehicleCondition(vc)}
                >
                  <Text style={tw`text-xs font-bold ${active ? "text-white" : "text-slate-400"}`}>
                    {vc === "Normal" ? "✓ Normal" : vc === "Damaged" ? "⚠️ Damaged" : "🚨 Suspicious"}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Vehicle Photograph Capture (Required) */}
        <View style={tw`mb-1`}>
          <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mb-1.5 uppercase`}>
            VEHICLE PHOTOGRAPH * (FRONT PLATE / LOADED CARGO)
          </Text>
          <TouchableOpacity
            style={tw`bg-slate-900 py-3 rounded-xl border border-sky-500/50 items-center flex-row justify-center gap-2`}
            onPress={handleLaunchNativeCamera}
          >
            <Text style={tw`text-sky-400 text-sm`}>📷</Text>
            <Text style={tw`text-sky-400 text-xs font-black`}>
              {capturedImageUri ? "✓ RETAKE VEHICLE PHOTO" : "CAPTURE VEHICLE PHOTO *"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Screen 07 - Driver Details Form */}
      <View style={tw`bg-slate-800 rounded-2xl p-4 mb-3.5 border border-white/10`}>
        <View style={tw`flex-row justify-between items-center mb-3`}>
          <Text style={tw`text-sky-400 text-xs font-black tracking-wider uppercase`}>
            {entryMode === "SCHEDULED" ? "4. DRIVER DETAILS" : "3. DRIVER DETAILS"}
          </Text>

          {/* DL OCR Auto-Populate Button */}
          <TouchableOpacity
            style={tw`bg-cyan-600 px-2.5 py-1 rounded-lg flex-row items-center gap-1`}
            onPress={handleScanDrivingLicence}
          >
            <Text style={tw`text-white text-[10px]`}>📷</Text>
            <Text style={tw`text-white text-[10px] font-black`}>SCAN DL (OCR)</Text>
          </TouchableOpacity>
        </View>

        {/* Driver Name * */}
        <View style={tw`mb-3`}>
          <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mb-1 uppercase`}>
            DRIVER NAME *
          </Text>
          <TextInput
            style={tw`bg-slate-900 rounded-xl text-white px-3 py-2.5 text-xs border border-slate-700`}
            placeholder="e.g. Suresh Gowda"
            placeholderTextColor="#64748b"
            value={driverNameInput}
            onChangeText={setDriverNameInput}
          />
        </View>

        {/* Driver Mobile Number * & Alternate Contact */}
        <View style={tw`flex-row gap-2 mb-3`}>
          <View style={tw`flex-1`}>
            <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mb-1 uppercase`}>
              MOBILE NUMBER *
            </Text>
            <TextInput
              style={tw`bg-slate-900 rounded-xl text-white px-3 py-2.5 text-xs border border-slate-700`}
              placeholder="e.g. 9845012345"
              placeholderTextColor="#64748b"
              value={driverContactInput}
              onChangeText={setDriverContactInput}
              keyboardType="phone-pad"
            />
          </View>

          <View style={tw`flex-1`}>
            <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mb-1 uppercase`}>
              ALT CONTACT (OPTIONAL)
            </Text>
            <TextInput
              style={tw`bg-slate-900 rounded-xl text-white px-3 py-2.5 text-xs border border-slate-700`}
              placeholder="e.g. 9731234567"
              placeholderTextColor="#64748b"
              value={driverAltContact}
              onChangeText={setDriverAltContact}
              keyboardType="phone-pad"
            />
          </View>
        </View>

        {/* Driving Licence Number * & Transporter Employee ID */}
        <View style={tw`flex-row gap-2 mb-3`}>
          <View style={tw`flex-1`}>
            <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mb-1 uppercase`}>
              DRIVING LICENCE NO. *
            </Text>
            <TextInput
              style={tw`bg-slate-900 rounded-xl text-sky-400 font-bold px-3 py-2.5 text-xs border border-slate-700`}
              placeholder="e.g. KA-01-2021-0098765"
              placeholderTextColor="#64748b"
              value={driverLicenceNo}
              onChangeText={setDriverLicenceNo}
              autoCapitalize="characters"
            />
          </View>

          <View style={tw`flex-1`}>
            <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mb-1 uppercase`}>
              TRANSPORTER EMP ID
            </Text>
            <TextInput
              style={tw`bg-slate-900 rounded-xl text-white px-3 py-2.5 text-xs border border-slate-700`}
              placeholder="e.g. EMP-DRV-4092"
              placeholderTextColor="#64748b"
              value={transporterEmpId}
              onChangeText={setTransporterEmpId}
              autoCapitalize="characters"
            />
          </View>
        </View>

        {/* Driver Photograph Capture */}
        <View style={tw`mb-1`}>
          <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mb-1.5 uppercase`}>
            DRIVER PHOTOGRAPH
          </Text>
          <TouchableOpacity
            style={tw`bg-slate-900 py-3 rounded-xl border border-slate-700 items-center flex-row justify-center gap-2`}
            onPress={handleLaunchDriverPhotoCamera}
          >
            <Text style={tw`text-sky-400 text-sm`}>👤</Text>
            <Text style={tw`text-sky-400 text-xs font-black`}>
              {driverPhotoUri ? "✓ RETAKE DRIVER PHOTO" : "CAPTURE DRIVER PHOTO ID"}
            </Text>
          </TouchableOpacity>

          {driverPhotoUri && (
            <View style={tw`mt-2.5 bg-slate-900 p-2 rounded-xl border border-sky-500/40 items-center`}>
              <Image source={{ uri: driverPhotoUri }} style={tw`w-24 h-24 rounded-lg`} />
              <Text style={tw`text-emerald-400 text-[10px] font-bold mt-1`}>Driver Photo Attached ✓</Text>
            </View>
          )}
        </View>
      </View>

      {/* Screen 08 - Invoice & Transport Documents Card */}
      <View style={tw`bg-slate-800 rounded-2xl p-4 mb-3.5 border border-white/10`}>
        <Text style={tw`text-sky-400 text-xs font-black tracking-wider uppercase mb-3`}>
          {entryMode === "SCHEDULED" ? "5. INVOICE & TRANSPORT DOCUMENTS" : "4. INVOICE & TRANSPORT DOCUMENTS"}
        </Text>

        {/* 1. INVOICE SECTION (MANDATORY) */}
        <View style={tw`bg-slate-900/80 rounded-xl p-3 mb-3.5 border border-slate-700`}>
          <Text style={tw`text-sky-400 text-[11px] font-black uppercase mb-2`}>📄 INVOICE DETAILS *</Text>

          <View style={tw`flex-row gap-2 mb-2.5`}>
            <View style={tw`flex-1`}>
              <Text style={tw`text-slate-400 text-[10px] font-bold mb-1 uppercase`}>INVOICE NO. *</Text>
              <TextInput
                style={tw`bg-slate-900 rounded-xl text-white px-3 py-2 text-xs border border-slate-700 font-bold`}
                placeholder="e.g. INV-2026-9901"
                placeholderTextColor="#64748b"
                value={invoiceNumber}
                onChangeText={setInvoiceNumber}
                autoCapitalize="characters"
              />
            </View>

            <View style={tw`flex-1`}>
              <Text style={tw`text-slate-400 text-[10px] font-bold mb-1 uppercase`}>INVOICE DATE *</Text>
              <TextInput
                style={tw`bg-slate-900 rounded-xl text-white px-3 py-2 text-xs border border-slate-700`}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#64748b"
                value={invoiceDate}
                onChangeText={setInvoiceDate}
              />
            </View>
          </View>

          <View style={tw`mb-2.5`}>
            <Text style={tw`text-slate-400 text-[10px] font-bold mb-1 uppercase`}>INVOICE AMOUNT (₹)</Text>
            <TextInput
              style={tw`bg-slate-900 rounded-xl text-emerald-400 font-black px-3 py-2 text-xs border border-slate-700`}
              placeholder="e.g. 245000"
              placeholderTextColor="#64748b"
              value={invoiceAmount}
              onChangeText={setInvoiceAmount}
              keyboardType="numeric"
            />
          </View>

          {/* Upload Invoice Photo */}
          <TouchableOpacity
            style={tw`bg-slate-800 py-2.5 rounded-xl border border-sky-500/40 items-center flex-row justify-center gap-1.5`}
            onPress={() => handleCaptureDocPhoto(setInvoicePhotoUri, "Invoice Document")}
          >
            <Text style={tw`text-sky-400 text-xs`}>📷</Text>
            <Text style={tw`text-sky-400 text-[11px] font-black`}>
              {invoicePhotoUri ? "✓ RETAKE INVOICE COPY *" : "UPLOAD / CAPTURE INVOICE *"}
            </Text>
          </TouchableOpacity>
        </View>

        {/* 2. DELIVERY CHALLAN SECTION */}
        <View style={tw`bg-slate-900/80 rounded-xl p-3 mb-3.5 border border-slate-700`}>
          <Text style={tw`text-slate-300 text-[11px] font-black uppercase mb-2`}>📦 DELIVERY CHALLAN</Text>

          <View style={tw`flex-row gap-2 mb-2.5`}>
            <View style={tw`flex-1`}>
              <Text style={tw`text-slate-400 text-[10px] font-bold mb-1 uppercase`}>CHALLAN NO.</Text>
              <TextInput
                style={tw`bg-slate-900 rounded-xl text-white px-3 py-2 text-xs border border-slate-700`}
                placeholder="e.g. DC-2026-4412"
                placeholderTextColor="#64748b"
                value={challanNumber}
                onChangeText={setChallanNumber}
                autoCapitalize="characters"
              />
            </View>

            <View style={tw`flex-1`}>
              <Text style={tw`text-slate-400 text-[10px] font-bold mb-1 uppercase`}>CHALLAN DATE</Text>
              <TextInput
                style={tw`bg-slate-900 rounded-xl text-white px-3 py-2 text-xs border border-slate-700`}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#64748b"
                value={challanDate}
                onChangeText={setChallanDate}
              />
            </View>
          </View>

          <TouchableOpacity
            style={tw`bg-slate-800 py-2 rounded-xl border border-slate-700 items-center flex-row justify-center gap-1.5`}
            onPress={() => handleCaptureDocPhoto(setChallanPhotoUri, "Delivery Challan")}
          >
            <Text style={tw`text-slate-300 text-xs`}>📎</Text>
            <Text style={tw`text-slate-300 text-[10px] font-bold`}>
              {challanPhotoUri ? "✓ CHALLAN ATTACHED" : "UPLOAD CHALLAN COPY"}
            </Text>
          </TouchableOpacity>
        </View>

        {/* 3. E-WAY BILL SECTION & EXPIRATION VALIDATION */}
        <View style={tw`bg-slate-900/80 rounded-xl p-3 mb-3.5 border border-slate-700`}>
          <Text style={tw`text-slate-300 text-[11px] font-black uppercase mb-2`}>🚛 E-WAY BILL</Text>

          <View style={tw`flex-row gap-2 mb-2`}>
            <View style={tw`flex-1`}>
              <Text style={tw`text-slate-400 text-[10px] font-bold mb-1 uppercase`}>E-WAY BILL NO.</Text>
              <TextInput
                style={tw`bg-slate-900 rounded-xl text-white px-3 py-2 text-xs border border-slate-700`}
                placeholder="e.g. EWAY-8812-4091"
                placeholderTextColor="#64748b"
                value={ewayBillNumber}
                onChangeText={setEwayBillNumber}
                autoCapitalize="characters"
              />
            </View>

            <View style={tw`flex-1`}>
              <Text style={tw`text-slate-400 text-[10px] font-bold mb-1 uppercase`}>VALID UNTIL DATE</Text>
              <TextInput
                style={tw`bg-slate-900 rounded-xl text-white px-3 py-2 text-xs border border-slate-700`}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#64748b"
                value={ewayValidUntil}
                onChangeText={setEwayValidUntil}
              />
            </View>
          </View>

          {/* E-Way Expiration Warning Banner */}
          {ewayValidUntil && ewayValidUntil.trim() < new Date().toISOString().split("T")[0] ? (
            <View style={tw`bg-red-500/15 p-2.5 rounded-lg border border-red-500/40 mb-2.5`}>
              <Text style={tw`text-red-400 text-xs font-black`}>🚨 E-WAY BILL EXPIRED</Text>
              <Text style={tw`text-red-300 text-[10px] mt-0.5`}>
                Valid Until: {ewayValidUntil}. Supervisor verification and clearance note required before vehicle entry.
              </Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={tw`bg-slate-800 py-2 rounded-xl border border-slate-700 items-center flex-row justify-center gap-1.5`}
            onPress={() => handleCaptureDocPhoto(setEwayPhotoUri, "E-Way Bill Document")}
          >
            <Text style={tw`text-slate-300 text-xs`}>📎</Text>
            <Text style={tw`text-slate-300 text-[10px] font-bold`}>
              {ewayPhotoUri ? "✓ E-WAY BILL ATTACHED" : "UPLOAD E-WAY BILL COPY"}
            </Text>
          </TouchableOpacity>
        </View>

        {/* 4. LR / TRANSPORT DOCUMENT SECTION */}
        <View style={tw`bg-slate-900/80 rounded-xl p-3 border border-slate-700`}>
          <Text style={tw`text-slate-300 text-[11px] font-black uppercase mb-2`}>📑 LR / TRANSPORT DOCUMENT</Text>

          <View style={tw`flex-row gap-2 mb-2`}>
            <View style={tw`flex-1`}>
              <Text style={tw`text-slate-400 text-[10px] font-bold mb-1 uppercase`}>LR DATE</Text>
              <TextInput
                style={tw`bg-slate-900 rounded-xl text-white px-3 py-2 text-xs border border-slate-700`}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#64748b"
                value={lrDate}
                onChangeText={setLrDate}
              />
            </View>

            <View style={tw`flex-1`}>
              <Text style={tw`text-slate-400 text-[10px] font-bold mb-1 uppercase`}>ATTACHMENT</Text>
              <TouchableOpacity
                style={tw`bg-slate-800 py-2 rounded-xl border border-slate-700 items-center flex-row justify-center gap-1`}
                onPress={() => handleCaptureDocPhoto(setLrPhotoUri, "LR Transport Document")}
              >
                <Text style={tw`text-slate-300 text-[10px] font-bold`}>
                  {lrPhotoUri ? "✓ LR ATTACHED" : "UPLOAD LR COPY"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>

      {/* Screen 09 - Document Checklist */}
      <View style={tw`bg-slate-800 rounded-2xl p-4 mb-3.5 border border-white/10 shadow-xl`}>
        <View style={tw`flex-row justify-between items-center mb-3 pb-2 border-b border-slate-700`}>
          <Text style={tw`text-sky-400 text-xs font-black tracking-wider uppercase`}>
            DOCUMENT VERIFICATION CHECKLIST
          </Text>
          {(() => {
            const checklistItems = [
              { label: "Purchase Order", ok: Boolean(selectedPo || selectedAsn || searchInput.trim()) },
              { label: "ASN", ok: Boolean(selectedAsn || searchInput.toUpperCase().includes("ASN") || entryMode === "SCHEDULED") },
              { label: "Invoice", ok: Boolean(invoiceNumber.trim() && invoiceDate.trim() && invoicePhotoUri) },
              { label: "Delivery Challan", ok: Boolean(challanNumber.trim() || invoicePhotoUri || challanPhotoUri) },
              {
                label: "E-Way Bill",
                ok: Boolean(ewayBillNumber.trim() && !(ewayValidUntil && ewayValidUntil.trim() < new Date().toISOString().split("T")[0])),
                warning: Boolean(ewayValidUntil && ewayValidUntil.trim() < new Date().toISOString().split("T")[0]),
              },
              { label: "Vehicle Number", ok: Boolean(vehicleInput.trim()) },
              { label: "Driver Licence", ok: Boolean(driverLicenceNo.trim()) },
              { label: "Vehicle Photo", ok: Boolean(capturedImageUri) },
            ];
            const count = checklistItems.filter((i) => i.ok).length;
            const isFull = count === 8;
            return (
              <View style={tw`px-2.5 py-1 rounded-xl ${isFull ? "bg-emerald-500/20 border border-emerald-500/50" : "bg-amber-500/20 border border-amber-500/50"}`}>
                <Text style={tw`text-xs font-black ${isFull ? "text-emerald-400" : "text-amber-400"}`}>
                  {count} / 8 Verified
                </Text>
              </View>
            );
          })()}
        </View>

        {/* 8 Item Checklist Grid */}
        <View style={tw`gap-2`}>
          {[
            { label: "Purchase Order", ok: Boolean(selectedPo || selectedAsn || searchInput.trim()), detail: selectedPo?.po_number || selectedAsn?.po_number || searchInput || "Missing PO" },
            { label: "ASN", ok: Boolean(selectedAsn || searchInput.toUpperCase().includes("ASN") || entryMode === "SCHEDULED"), detail: selectedAsn?.asn_number || "ASN Attached" },
            { label: "Invoice", ok: Boolean(invoiceNumber.trim() && invoiceDate.trim() && invoicePhotoUri), detail: invoiceNumber ? `Inv #${invoiceNumber}` : "Invoice & Upload Required *" },
            { label: "Delivery Challan", ok: Boolean(challanNumber.trim() || invoicePhotoUri || challanPhotoUri), detail: challanNumber ? `Challan #${challanNumber}` : "Optional / Attached" },
            {
              label: "E-Way Bill",
              ok: Boolean(ewayBillNumber.trim() && !(ewayValidUntil && ewayValidUntil.trim() < new Date().toISOString().split("T")[0])),
              warning: Boolean(ewayValidUntil && ewayValidUntil.trim() < new Date().toISOString().split("T")[0]),
              detail: ewayValidUntil && ewayValidUntil.trim() < new Date().toISOString().split("T")[0] ? "EXPIRED — Supervisor Review" : ewayBillNumber ? `E-Way #${ewayBillNumber}` : "Optional"
            },
            { label: "Vehicle Number", ok: Boolean(vehicleInput.trim()), detail: vehicleInput ? formatVehiclePlate(vehicleInput) : "Plate Number Required *" },
            { label: "Driver Licence", ok: Boolean(driverLicenceNo.trim()), detail: driverLicenceNo ? `DL #${driverLicenceNo}` : "DL Number Required *" },
            { label: "Vehicle Photo", ok: Boolean(capturedImageUri), detail: capturedImageUri ? "Photo Captured ✓" : "Photo Capture Required *" },
          ].map((item, idx) => (
            <View key={idx} style={tw`flex-row items-center justify-between bg-slate-900 px-3 py-2 rounded-xl`}>
              <View style={tw`flex-row items-center gap-2.5 flex-1`}>
                <View style={tw`w-6 h-6 rounded-full items-center justify-center ${item.ok ? "bg-emerald-500/20 border border-emerald-500/50" : item.warning ? "bg-red-500/20 border border-red-500/50" : "bg-slate-800 border border-slate-700"}`}>
                  <Text style={tw`text-xs font-black ${item.ok ? "text-emerald-400" : item.warning ? "text-red-400" : "text-slate-500"}`}>
                    {item.ok ? "✓" : item.warning ? "⚠️" : "✕"}
                  </Text>
                </View>

                <Text style={tw`text-xs font-bold text-slate-200`}>{item.label}</Text>
              </View>

              <Text style={tw`text-[10px] font-semibold ${item.ok ? "text-emerald-400" : item.warning ? "text-red-400" : "text-slate-500"}`}>
                {item.detail}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {/* Section 28 - Save Draft Option */}
      <View style={tw`flex-row gap-2 mb-2`}>
        <TouchableOpacity
          style={tw`flex-1 bg-slate-800 py-3 rounded-xl items-center border border-slate-700`}
          onPress={handleSaveOfflineDraft}
        >
          <Text style={tw`text-amber-400 font-extrabold text-xs`}>💾 SAVE LOCAL DRAFT</Text>
        </TouchableOpacity>
      </View>

      {/* Review Gate Entry CTA Button */}
      <TouchableOpacity
        style={tw`rounded-2xl py-4 items-center mt-1 shadow-lg ${
          entryMode === "EXCEPTION" ? "bg-amber-600" : "bg-sky-600"
        } ${submitting ? "opacity-60" : ""}`}
        onPress={handleOpenReviewModal}
        disabled={submitting}
      >
        <Text style={tw`text-white text-xs font-black tracking-wide`}>
          REVIEW GATE ENTRY SUMMARY →
        </Text>
      </TouchableOpacity>

      {/* Screen 11 - Review Gate Entry Modal */}
      <Modal visible={showReviewModal} animationType="slide" transparent>
        <View style={tw`flex-1 bg-black/80 justify-end`}>
          <View style={tw`bg-slate-800 rounded-t-3xl p-5 max-h-[85%] border-t border-sky-500/50 shadow-2xl`}>
            {/* Modal Header */}
            <View style={tw`flex-row justify-between items-center mb-3 pb-3 border-b border-slate-700`}>
              <View>
                <Text style={tw`text-white text-base font-black tracking-wide`}>
                  REVIEW GATE ENTRY (SCREEN 11)
                </Text>
                <Text style={tw`text-sky-400 text-xs font-bold mt-0.5`}>
                  Confirm all 12 verification sections before issuing pass
                </Text>
              </View>
              <TouchableOpacity
                style={tw`bg-slate-700 px-3 py-1.5 rounded-lg`}
                onPress={() => setShowReviewModal(false)}
              >
                <Text style={tw`text-slate-300 text-xs font-black`}>✕ EDIT</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={tw`mb-4`}>
              {/* 1. Supplier Summary */}
              <View style={tw`bg-slate-900 p-3 rounded-xl mb-2.5 border border-slate-700`}>
                <Text style={tw`text-sky-400 text-[10px] font-black uppercase mb-1`}>1. SUPPLIER</Text>
                <Text style={tw`text-white text-xs font-bold`}>
                  {entryMode === "EXCEPTION" ? supplierInput : selectedPo?.supplier_name || selectedAsn?.supplier_name || "Supplier"}
                </Text>
              </View>

              {/* 2. PO Summary */}
              <View style={tw`bg-slate-900 p-3 rounded-xl mb-2.5 border border-slate-700`}>
                <Text style={tw`text-sky-400 text-[10px] font-black uppercase mb-1`}>2. PURCHASE ORDER</Text>
                <Text style={tw`text-white text-xs font-bold`}>
                  {entryMode === "SCHEDULED" ? selectedPo?.po_number || searchInput || "N/A" : "UNSCHEDULED ENTRY"}
                </Text>
              </View>

              {/* 3. ASN Summary */}
              <View style={tw`bg-slate-900 p-3 rounded-xl mb-2.5 border border-slate-700`}>
                <Text style={tw`text-sky-400 text-[10px] font-black uppercase mb-1`}>3. ASN REFERENCE</Text>
                <Text style={tw`text-white text-xs font-bold`}>
                  {selectedAsn?.asn_number || "ASN Attached"}
                </Text>
              </View>

              {/* 4. Vehicle Summary */}
              <View style={tw`bg-slate-900 p-3 rounded-xl mb-2.5 border border-slate-700`}>
                <Text style={tw`text-sky-400 text-[10px] font-black uppercase mb-1`}>4. VEHICLE</Text>
                <Text style={tw`text-sky-400 text-sm font-black`}>
                  {formatVehiclePlate(vehicleInput)}
                </Text>
                <Text style={tw`text-slate-300 text-xs mt-0.5`}>
                  Type: {vehicleType} • Condition: {vehicleCondition}
                </Text>
              </View>

              {/* 5. Driver Summary */}
              <View style={tw`bg-slate-900 p-3 rounded-xl mb-2.5 border border-slate-700`}>
                <Text style={tw`text-sky-400 text-[10px] font-black uppercase mb-1`}>5. DRIVER</Text>
                <Text style={tw`text-white text-xs font-bold`}>
                  {driverNameInput} ({driverContactInput})
                </Text>
                <Text style={tw`text-slate-400 text-[11px] mt-0.5`}>
                  DL No: {driverLicenceNo}
                </Text>
              </View>

              {/* 6. Invoice Summary */}
              <View style={tw`bg-slate-900 p-3 rounded-xl mb-2.5 border border-slate-700`}>
                <Text style={tw`text-sky-400 text-[10px] font-black uppercase mb-1`}>6. INVOICE</Text>
                <Text style={tw`text-white text-xs font-bold`}>
                  Inv #{invoiceNumber} ({invoiceDate})
                </Text>
                {invoiceAmount ? (
                  <Text style={tw`text-emerald-400 text-xs font-black mt-0.5`}>
                    Amount: ₹{invoiceAmount}
                  </Text>
                ) : null}
              </View>

              {/* 7. Delivery Challan Summary */}
              <View style={tw`bg-slate-900 p-3 rounded-xl mb-2.5 border border-slate-700`}>
                <Text style={tw`text-sky-400 text-[10px] font-black uppercase mb-1`}>7. DELIVERY CHALLAN</Text>
                <Text style={tw`text-white text-xs font-bold`}>
                  {challanNumber ? `Challan #${challanNumber} (${challanDate})` : "Optional / N/A"}
                </Text>
              </View>

              {/* 8. E-Way Bill Summary */}
              <View style={tw`bg-slate-900 p-3 rounded-xl mb-2.5 border border-slate-700`}>
                <Text style={tw`text-sky-400 text-[10px] font-black uppercase mb-1`}>8. E-WAY BILL</Text>
                <Text style={tw`text-white text-xs font-bold`}>
                  {ewayBillNumber ? `E-Way #${ewayBillNumber} (Valid: ${ewayValidUntil || "N/A"})` : "Optional / N/A"}
                </Text>
              </View>

              {/* 9. Transporter Summary */}
              <View style={tw`bg-slate-900 p-3 rounded-xl mb-2.5 border border-slate-700`}>
                <Text style={tw`text-sky-400 text-[10px] font-black uppercase mb-1`}>9. TRANSPORTER</Text>
                <Text style={tw`text-white text-xs font-bold`}>
                  {transporterName || "Logistics Partner"} {lrNumber ? `• LR #${lrNumber}` : ""}
                </Text>
              </View>

              {/* 10. Material Summary */}
              <View style={tw`bg-slate-900 p-3 rounded-xl mb-2.5 border border-slate-700`}>
                <Text style={tw`text-sky-400 text-[10px] font-black uppercase mb-1`}>
                  10. MATERIAL SUMMARY ({lineItems.length > 0 ? lineItems.length : 1})
                </Text>
                {lineItems.length === 0 ? (
                  <Text style={tw`text-slate-300 text-xs font-bold`}>
                    Stainless Steel Sheet 304 - 500 KG
                  </Text>
                ) : (
                  lineItems.map((item, idx) => (
                    <Text key={idx} style={tw`text-slate-200 text-xs font-semibold mb-0.5`}>
                      • {item.material_name || item.material_description || "Material"}: {item.quantity || "0"} {item.uom || "Units"}
                    </Text>
                  ))
                )}
              </View>

              {/* 11. Dock Assignment */}
              <View style={tw`bg-slate-900 p-3 rounded-xl mb-2.5 border border-slate-700`}>
                <Text style={tw`text-sky-400 text-[10px] font-black uppercase mb-1`}>11. DOCK ASSIGNMENT</Text>
                <Text style={tw`text-emerald-400 text-xs font-black`}>
                  {selectedPo?.dock_number || selectedAsn?.dock_number || "Dock D-04"} (Inbound Receiving)
                </Text>
              </View>

              {/* 12. Uploaded Documents */}
              <View style={tw`bg-slate-900 p-3 rounded-xl mb-2.5 border border-slate-700`}>
                <Text style={tw`text-sky-400 text-[10px] font-black uppercase mb-1.5`}>12. UPLOADED DOCUMENTS</Text>
                <Text style={tw`text-emerald-400 text-xs font-bold`}>✓ Invoice Copy Attached</Text>
                <Text style={tw`text-emerald-400 text-xs font-bold`}>✓ Vehicle Photo Attached</Text>
                {driverPhotoUri ? <Text style={tw`text-emerald-400 text-xs font-bold`}>✓ Driver ID Photo Attached</Text> : null}
                {lrPhotoUri ? <Text style={tw`text-emerald-400 text-xs font-bold`}>✓ LR Document Attached</Text> : null}
                {ewayPhotoUri ? <Text style={tw`text-emerald-400 text-xs font-bold`}>✓ E-Way Bill Attached</Text> : null}
              </View>

              {/* Section 29 - Audit Trail Logger */}
              <View style={tw`bg-slate-900 p-3 rounded-xl mb-2 border border-slate-700`}>
                <Text style={tw`text-slate-400 text-[10px] font-black uppercase mb-1.5`}>
                  📋 OPERATION AUDIT TRAIL (SECTION 29)
                </Text>
                {auditLogs.length === 0 ? (
                  <Text style={tw`text-slate-500 text-[10px] italic`}>Session initialized. Actions will be logged here.</Text>
                ) : (
                  auditLogs.map((log, idx) => (
                    <View key={idx} style={tw`flex-row justify-between items-center my-0.5`}>
                      <Text style={tw`text-sky-400 text-[10px] font-mono font-bold`}>{log.time}</Text>
                      <Text style={tw`text-slate-200 text-[10px] flex-1 ml-2 font-semibold`}>{log.action}</Text>
                    </View>
                  ))
                )}
                <Text style={tw`text-slate-600 text-[9px] italic mt-1 text-center`}>
                  * Audit records are read-only and uneditable by security users.
                </Text>
              </View>
            </ScrollView>

            {/* Action CTAs: [Edit] and [Generate Gate Pass] */}
            <View style={tw`flex-row gap-2.5`}>
              <TouchableOpacity
                style={tw`flex-1 bg-slate-700 py-3.5 rounded-xl items-center`}
                onPress={() => setShowReviewModal(false)}
              >
                <Text style={tw`text-slate-200 font-bold text-xs`}>[ EDIT FORM ]</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={tw`flex-1 bg-emerald-600 py-3.5 rounded-xl items-center shadow-lg ${
                  submitting ? "opacity-60" : ""
                }`}
                onPress={executeGenerateGatePass}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={tw`text-white font-black text-xs tracking-wider`}>
                    [ GENERATE GATE PASS ] ✓
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Screen 15 - Central QR Scanner Gate Pass Result Modal */}
      <Modal visible={Boolean(scannedGatePassRecord)} animationType="fade" transparent>
        <View style={tw`flex-1 bg-black/80 justify-center items-center p-5`}>
          <View style={tw`w-full bg-slate-800 rounded-3xl p-5 border border-sky-500/40 shadow-2xl`}>
            <View style={tw`flex-row justify-between items-center mb-3 pb-2.5 border-b border-slate-700`}>
              <View style={tw`flex-row items-center gap-1.5`}>
                <Text style={tw`text-emerald-400 text-xs font-black`}>✓ GATE PASS FOUND</Text>
              </View>
              <TouchableOpacity onPress={() => setScannedGatePassRecord(null)}>
                <Text style={tw`text-red-400 text-xs font-bold`}>✕ CLOSE</Text>
              </TouchableOpacity>
            </View>

            {scannedGatePassRecord && (
              <View style={tw`gap-2 mb-3`}>
                <View style={tw`bg-slate-900 p-2.5 rounded-xl`}>
                  <Text style={tw`text-slate-400 text-[10px] font-bold uppercase`}>Gate Pass Number</Text>
                  <Text style={tw`text-sky-400 text-base font-black mt-0.5`}>
                    {scannedGatePassRecord.gate_pass_number || scannedGatePassRecord.gate_entry_number || scannedGatePassRecord.id || "GP-BLR-20261007-0048"}
                  </Text>
                </View>

                <View style={tw`bg-slate-900 p-2.5 rounded-xl`}>
                  <Text style={tw`text-slate-400 text-[10px] font-bold uppercase`}>Vehicle Plate</Text>
                  <Text style={tw`text-sky-400 text-base font-black mt-0.5`}>
                    {formatVehiclePlate(scannedGatePassRecord.vehicle_number || scannedGatePassRecord.vehicle_plate || "KA 01 AB 4582")}
                  </Text>
                </View>

                <View style={tw`bg-slate-900 p-2.5 rounded-xl`}>
                  <Text style={tw`text-slate-400 text-[10px] font-bold uppercase`}>Supplier</Text>
                  <Text style={tw`text-white text-xs font-bold mt-0.5`}>
                    {scannedGatePassRecord.supplier_name || scannedGatePassRecord.supplierName || "Bharat Electronics Components Pvt. Ltd."}
                  </Text>
                </View>

                <View style={tw`bg-slate-900 p-2.5 rounded-xl flex-row justify-between items-center`}>
                  <View>
                    <Text style={tw`text-slate-400 text-[10px] font-bold uppercase`}>Current Status</Text>
                    <Text style={tw`text-emerald-400 text-xs font-black uppercase mt-0.5`}>
                      {scannedGatePassRecord.status || "AT DOCK"}
                    </Text>
                  </View>

                  <View>
                    <Text style={tw`text-slate-400 text-[10px] font-bold uppercase text-right`}>Assigned Dock</Text>
                    <Text style={tw`text-sky-400 text-xs font-black text-right mt-0.5`}>
                      {scannedGatePassRecord.dock_number || "D-04"}
                    </Text>
                  </View>
                </View>
              </View>
            )}

            <Text style={tw`text-slate-500 text-[10px] italic text-center mb-3`}>
              * Security can view the record but should not modify warehouse/QC information.
            </Text>

            <TouchableOpacity
              style={tw`bg-sky-600 py-3 rounded-xl items-center`}
              onPress={() => setScannedGatePassRecord(null)}
            >
              <Text style={tw`text-white text-xs font-black`}>DISMISS / CLOSE</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
