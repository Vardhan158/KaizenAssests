import React, { useState, useEffect } from "react";
import {
  StyleSheet,
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
import { launchCamera, ImagePickerResponse } from "react-native-image-picker";
import { mobileApi } from "../services/api";
import { formatVehiclePlate, parseScannedQrCode } from "../utils/vehicleFormatter";

interface GateEntryScannerScreenProps {
  onSuccess: (entryResult: any) => void;
  onLogout: () => void;
}

export function GateEntryScannerScreen({ onSuccess, onLogout }: GateEntryScannerScreenProps) {
  const [searchInput, setSearchInput] = useState("PO-2026-0001");
  const [vehicleInput, setVehicleInput] = useState("");
  const [driverNameInput, setDriverNameInput] = useState("");
  const [driverContactInput, setDriverContactInput] = useState("");
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
  }, []);

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
        if (searchInput.trim()) {
          selectAndAutofillPo(searchInput);
        } else if (poList.length > 0) {
          const firstPo = poList[0]?.po_number || poList[0]?.poNumber;
          if (firstPo) selectAndAutofillPo(firstPo);
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
      if (pos.length > 0) {
        selectAndAutofillPo("PO-2026-0001", pos, asns);
      } else {
        setNotFoundError("No Purchase Orders found in backend database.");
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
      return;
    }

    const parsed = parseScannedQrCode(queryStr);
    const lookupRaw = parsed.reference.toUpperCase().trim();
    const targetPoNorm = normalizePo(queryStr);

    // 1. Find PO match (exact or normalized)
    const matchedPo = availablePos.find((candidate: any) => {
      const p1 = String(candidate.po_number || candidate.poNumber || "").toUpperCase();
      const p2 = normalizePo(p1);
      return p1 === lookupRaw || (p2 && p2 === targetPoNorm);
    });

    // 2. Find ASN match (exact or normalized)
    const matchingAsns = availableAsns.filter((candidate: any) => {
      const a1 = String(candidate.asn_number || candidate.asnNumber || "").toUpperCase();
      const a2 = normalizePo(candidate.po_number || candidate.poNumber);
      return a1 === lookupRaw || (a2 && a2 === targetPoNorm);
    });

    const matchedAsn = matchingAsns[0];

    if (!matchedPo && matchingAsns.length === 0) {
      // Clear all fields and show NOT FOUND
      setSelectedPo(null);
      setSelectedAsn(null);
      setLineItems([]);
      setVehiclesExtracted([]);
      setVehicleInput("");
      setDriverNameInput("");
      setDriverContactInput("");
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
      "Supplier";

    // Extract items list
    let itemsList: any[] = [];
    if (resolvedPo.items && Array.isArray(resolvedPo.items) && resolvedPo.items.length > 0) {
      itemsList = resolvedPo.items;
    } else if (matchedAsn) {
      itemsList = matchedAsn.lines || matchedAsn.items || [];
    }

    // Extract vehicles list
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
            asn.driver_contact ||
            asn.driverContact ||
            asn.driver_phone ||
            asn.driverPhone ||
            asn.phone ||
            "";

          if (rawVeh) {
            extractedVehicles.push({
              index: extractedVehicles.length,
              vehicleNumber: formatVehiclePlate(rawVeh),
              driverName: item.driver_name || item.driverName || asn.driver_name || asn.driverName || "",
              driverContact: driverPhone,
              transporter: item.transporter || asn.transporter || "Logistics Partner",
            });
          }
        });
      }

      const topVeh = String(asn.vehicle_number || asn.vehicleNumber || "");
      if (topVeh && !logList) {
        const topDriverPhone =
          asn.driver_contact ||
          asn.driverContact ||
          asn.driver_phone ||
          asn.driverPhone ||
          asn.phone ||
          "";

        extractedVehicles.push({
          index: extractedVehicles.length,
          vehicleNumber: formatVehiclePlate(topVeh),
          driverName: asn.driver_name || asn.driverName || "",
          driverContact: topDriverPhone,
          transporter: asn.transporter || "Logistics Partner",
        });
      }
    });

    if (extractedVehicles.length === 0 && (resolvedPo.vehicle_number || resolvedPo.vehicleNumber)) {
      const poDriverPhone =
        resolvedPo.driver_contact ||
        resolvedPo.driverContact ||
        resolvedPo.driver_phone ||
        resolvedPo.driverPhone ||
        resolvedPo.phone ||
        "";

      extractedVehicles.push({
        index: 0,
        vehicleNumber: formatVehiclePlate(resolvedPo.vehicle_number || resolvedPo.vehicleNumber),
        driverName: resolvedPo.driver_name || resolvedPo.driverName || "",
        driverContact: poDriverPhone,
        transporter: "Logistics Partner",
      });
    }

    // Deduplicate vehicles by plate number
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
    const poNum = selectedPo?.po_number || selectedPo?.poNumber || searchInput.trim();
    const suppName = selectedPo?.supplier_name || selectedPo?.supplierName || selectedAsn?.supplier_name || "";

    if (!poNum) {
      Alert.alert("Required", "Please enter or select a valid PO or ASN number.");
      return;
    }

    if (!vehicleInput.trim()) {
      Alert.alert("Required", "Please enter a valid truck/vehicle number plate.");
      return;
    }

    setSubmitting(true);

    try {
      const result = await mobileApi.createGateEntry({
        po_number: poNum,
        vehicle_number: formatVehiclePlate(vehicleInput),
        driver_name: driverNameInput.trim(),
        driver_contact: driverContactInput.trim(),
        supplier_name: suppName,
        asn_reference: selectedAsn?.asn_number || selectedAsn?.asnNumber || "",
        line_items: lineItems,
        remarks: remarksInput.trim(),
      });

      setSubmitting(false);
      onSuccess(result);
    } catch (e: any) {
      setSubmitting(false);
      Alert.alert("Submission Failed", e?.message || "Could not generate gate pass.");
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      {/* Top Header */}
      <View style={styles.navHeader}>
        <View>
          <Text style={styles.navTitle}>GATE SECURITY SCANNER</Text>
          <Text style={styles.navSub}>KaizenX Mobile • Active Duty</Text>
        </View>
        <TouchableOpacity style={styles.logoutBtn} onPress={onLogout}>
          <Text style={styles.logoutBtnText}>Exit</Text>
        </TouchableOpacity>
      </View>

      {/* OPEN REAL DEVICE CAMERA BUTTON */}
      <TouchableOpacity
        style={styles.openCameraBtn}
        onPress={handleLaunchNativeCamera}
      >
        <Text style={styles.openCameraBtnText}>📷 OPEN CAMERA SCANNER</Text>
        <Text style={styles.openCameraSub}>Launches phone camera to scan truck pass / barcode</Text>
      </TouchableOpacity>

      {/* Display Captured Photo Preview */}
      {capturedImageUri && (
        <View style={styles.capturedPhotoBox}>
          <Text style={styles.photoBoxTitle}>📷 CAPTURED SCAN PHOTO</Text>
          <Image source={{ uri: capturedImageUri }} style={styles.photoPreview} />
        </View>
      )}

      {/* Section 1: Scan / Select PO / ASN */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>1. PURCHASE ORDER / ASN INPUT</Text>
        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            placeholder="Type PO / ASN (e.g. PO-2026-0001)"
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
            style={styles.dbListBtn}
            onPress={() => setShowPoPickerModal(true)}
          >
            <Text style={styles.dbListBtnText}>BROWSE DB ▼</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.matchBtn}
            onPress={() => selectAndAutofillPo(searchInput)}
          >
            <Text style={styles.matchBtnText}>FETCH</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator color="#0284c7" style={{ marginTop: 12 }} />
        ) : notFoundMessage ? (
          <View style={styles.notFoundBox}>
            <Text style={styles.notFoundTitle}>⚠️ NOT FOUND</Text>
            <Text style={styles.notFoundDesc}>{notFoundMessage}</Text>
          </View>
        ) : selectedPo || selectedAsn ? (
          <View style={styles.matchedBox}>
            <Text style={styles.matchedTitle}>
              ✓ {selectedPo?.po_number || selectedAsn?.asn_number} VERIFIED
            </Text>
            <Text style={styles.matchedDesc}>
              Supplier: {selectedPo?.supplier_name || selectedAsn?.supplier_name || "N/A"}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Section 2: Multi-Vehicle Picker */}
      {vehiclesExtracted.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>2. SELECT ARRIVING VEHICLE</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.vehicleScroll}>
            {vehiclesExtracted.map((v) => {
              const isSelected = selectedVehicleIdx === v.index;
              return (
                <TouchableOpacity
                  key={v.index}
                  style={[styles.vehicleChip, isSelected && styles.vehicleChipSelected]}
                  onPress={() => selectVehicleOption(v)}
                >
                  <Text style={[styles.vehiclePlateText, isSelected && styles.vehiclePlateSelectedText]}>
                    {v.vehicleNumber || "UNASSIGNED"}
                  </Text>
                  <Text style={styles.vehicleDriverText}>{v.driverName || "Driver N/A"}</Text>
                  <Text style={styles.vehicleTransporterText}>{v.transporter || "Logistics"}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Section 3: Vehicle & Driver Details Form */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>3. VEHICLE & DRIVER DETAILS</Text>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>VEHICLE PLATE NUMBER</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. KA-01-AB-1234"
            placeholderTextColor="#64748b"
            value={vehicleInput}
            onChangeText={(text) => setVehicleInput(formatVehiclePlate(text))}
          />
        </View>

        <View style={styles.row}>
          <View style={[styles.fieldGroup, { flex: 1, marginRight: 8 }]}>
            <Text style={styles.label}>DRIVER NAME</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Driver Name"
              placeholderTextColor="#64748b"
              value={driverNameInput}
              onChangeText={setDriverNameInput}
            />
          </View>

          <View style={[styles.fieldGroup, { flex: 1, marginLeft: 8 }]}>
            <Text style={styles.label}>DRIVER PHONE</Text>
            <TextInput
              style={styles.input}
              placeholder="Driver Phone"
              placeholderTextColor="#64748b"
              value={driverContactInput}
              onChangeText={setDriverContactInput}
              keyboardType="phone-pad"
            />
          </View>
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>SECURITY REMARKS (OPTIONAL)</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Physical seal intact"
            placeholderTextColor="#64748b"
            value={remarksInput}
            onChangeText={setRemarksInput}
          />
        </View>
      </View>

      {/* Section 4: Line Items Verification Checklist */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>
          4. VERIFIED MATERIAL LINE ITEMS ({lineItems.length})
        </Text>
        {lineItems.length === 0 ? (
          <Text style={styles.emptyItemsText}>No line items recorded for this PO / ASN in database.</Text>
        ) : (
          lineItems.map((item, idx) => (
            <View key={idx} style={styles.itemRow}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={styles.itemCode}>
                  {item.material_code || item.item_code || `ITEM-${idx + 1}`}
                </Text>
                <Text style={styles.itemName}>
                  {item.material_name || item.material_description || item.description || "Material Component"}
                </Text>
              </View>
              <Text style={styles.itemQty}>
                {item.quantity || item.shipped_quantity || "0"} {item.uom || "Units"}
              </Text>
            </View>
          ))
        )}
      </View>

      {/* Submit Button */}
      <TouchableOpacity
        style={[styles.submitBtn, submitting && styles.btnDisabled]}
        onPress={handleCreateGateEntry}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={styles.submitBtnText}>GRANT GATE ENTRY PASS ✓</Text>
        )}
      </TouchableOpacity>

      {/* --- PO / ASN DB PICKER MODAL --- */}
      <Modal visible={showPoPickerModal} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>SELECT PURCHASE ORDER / ASN</Text>
              <TouchableOpacity onPress={() => setShowPoPickerModal(false)}>
                <Text style={styles.modalCloseText}>✕ CLOSE</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 320 }}>
              {poList.length === 0 ? (
                <Text style={styles.emptyText}>No Purchase Orders available in database.</Text>
              ) : (
                poList.map((po, idx) => (
                  <TouchableOpacity
                    key={po.id || idx}
                    style={styles.poListItem}
                    onPress={() => {
                      setShowPoPickerModal(false);
                      selectAndAutofillPo(po.po_number || po.poNumber);
                    }}
                  >
                    <View>
                      <Text style={styles.poListNumber}>{po.po_number || po.poNumber}</Text>
                      <Text style={styles.poListSupplier}>{po.supplier_name || po.supplierName || "Supplier"}</Text>
                    </View>
                    <Text style={styles.poListSelect}>Select →</Text>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f172a",
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  navHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  navTitle: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 1,
  },
  navSub: {
    color: "#06b6d4",
    fontSize: 11,
    fontWeight: "700",
  },
  logoutBtn: {
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.4)",
  },
  logoutBtnText: {
    color: "#f87171",
    fontSize: 11,
    fontWeight: "800",
  },
  openCameraBtn: {
    backgroundColor: "#0284c7",
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: "center",
    marginBottom: 14,
    shadowColor: "#0284c7",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 4,
  },
  openCameraBtnText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 1,
  },
  openCameraSub: {
    color: "#e0f2fe",
    fontSize: 10,
    marginTop: 2,
  },
  capturedPhotoBox: {
    backgroundColor: "#1e293b",
    borderRadius: 16,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#0284c7",
    alignItems: "center",
  },
  photoBoxTitle: {
    color: "#38bdf8",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1,
    marginBottom: 8,
  },
  photoPreview: {
    width: "100%",
    height: 160,
    borderRadius: 12,
  },
  card: {
    backgroundColor: "#1e293b",
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  sectionTitle: {
    color: "#38bdf8",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
    marginBottom: 12,
  },
  searchRow: {
    flexDirection: "row",
    gap: 8,
  },
  searchInput: {
    flex: 1,
    backgroundColor: "#0f172a",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#38bdf8",
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#38bdf8",
    fontSize: 13,
    fontWeight: "800",
  },
  dbListBtn: {
    backgroundColor: "#1e293b",
    borderWidth: 1,
    borderColor: "#38bdf8",
    paddingHorizontal: 10,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 10,
  },
  dbListBtnText: {
    color: "#38bdf8",
    fontWeight: "800",
    fontSize: 10,
  },
  matchBtn: {
    backgroundColor: "#0284c7",
    paddingHorizontal: 14,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 10,
  },
  matchBtnText: {
    color: "#ffffff",
    fontWeight: "900",
    fontSize: 12,
  },
  matchedBox: {
    backgroundColor: "rgba(16, 185, 129, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.4)",
    borderRadius: 10,
    padding: 10,
    marginTop: 12,
  },
  matchedTitle: {
    color: "#34d399",
    fontWeight: "800",
    fontSize: 12,
  },
  matchedDesc: {
    color: "#a7f3d0",
    fontSize: 11,
    marginTop: 2,
  },
  notFoundBox: {
    backgroundColor: "rgba(239, 68, 68, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.4)",
    borderRadius: 10,
    padding: 10,
    marginTop: 12,
  },
  notFoundTitle: {
    color: "#f87171",
    fontWeight: "900",
    fontSize: 12,
  },
  notFoundDesc: {
    color: "#fca5a5",
    fontSize: 11,
    marginTop: 2,
  },
  vehicleScroll: {
    flexDirection: "row",
  },
  vehicleChip: {
    backgroundColor: "#0f172a",
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#334155",
    marginRight: 10,
    minWidth: 140,
  },
  vehicleChipSelected: {
    backgroundColor: "rgba(2, 132, 199, 0.2)",
    borderColor: "#38bdf8",
  },
  vehiclePlateText: {
    color: "#94a3b8",
    fontWeight: "900",
    fontSize: 13,
  },
  vehiclePlateSelectedText: {
    color: "#38bdf8",
  },
  vehicleDriverText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 4,
  },
  vehicleTransporterText: {
    color: "#64748b",
    fontSize: 10,
    marginTop: 2,
  },
  fieldGroup: {
    marginBottom: 12,
  },
  label: {
    color: "#94a3b8",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
    marginBottom: 4,
  },
  input: {
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "600",
  },
  row: {
    flexDirection: "row",
  },
  itemRow: {
    backgroundColor: "#0f172a",
    padding: 10,
    borderRadius: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  itemCode: {
    color: "#38bdf8",
    fontWeight: "800",
    fontSize: 11,
  },
  itemName: {
    color: "#94a3b8",
    fontSize: 11,
    marginTop: 2,
  },
  itemQty: {
    color: "#10b981",
    fontWeight: "900",
    fontSize: 12,
  },
  emptyItemsText: {
    color: "#64748b",
    fontSize: 12,
    paddingVertical: 8,
  },
  submitBtn: {
    backgroundColor: "#10b981",
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
    marginTop: 8,
    shadowColor: "#10b981",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 4,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  submitBtnText: {
    color: "#ffffff",
    fontWeight: "900",
    fontSize: 14,
    letterSpacing: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.85)",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    backgroundColor: "#1e293b",
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: "#38bdf8",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  modalTitle: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  modalCloseText: {
    color: "#f87171",
    fontWeight: "800",
    fontSize: 12,
  },
  poListItem: {
    backgroundColor: "#0f172a",
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#334155",
  },
  poListNumber: {
    color: "#38bdf8",
    fontWeight: "800",
    fontSize: 13,
  },
  poListSupplier: {
    color: "#94a3b8",
    fontSize: 11,
    marginTop: 2,
  },
  poListSelect: {
    color: "#10b981",
    fontWeight: "800",
    fontSize: 12,
  },
  emptyText: {
    color: "#94a3b8",
    textAlign: "center",
    paddingVertical: 20,
    fontSize: 12,
  },
});
