import React from "react";
import { StyleSheet, Text, View, TouchableOpacity, ScrollView, Platform } from "react-native";

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
  const gatePassNo = entryResult?.gate_entry_number || entryResult?.id || "GE-2026-8840";
  const vehicleNo = entryResult?.vehicle_number || "KA-01-AB-1234";
  const poNo = entryResult?.po_number || "PO-2026-0001";
  const supplierName = entryResult?.supplier_name || "ABC Industrial Supplies";
  const driverName = entryResult?.driver_name || "Rajesh Kumar";
  const driverContact = entryResult?.driver_contact || "9876543210";
  const timestamp = entryResult?.created_at
    ? new Date(entryResult.created_at).toLocaleString("en-IN")
    : new Date().toLocaleString("en-IN");

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      {/* Success Badge Banner */}
      <View style={styles.banner}>
        <View style={styles.checkCircle}>
          <Text style={styles.checkMark}>✓</Text>
        </View>
        <Text style={styles.bannerTitle}>GATE ENTRY GRANTED</Text>
        <Text style={styles.bannerSub}>Vehicle Authorized for Warehouse Apron</Text>
      </View>

      {/* Pass Ticket Card */}
      <View style={styles.ticketCard}>
        <View style={styles.ticketHeader}>
          <Text style={styles.passLabel}>GATE PASS NUMBER</Text>
          <Text style={styles.passNumber}>{gatePassNo}</Text>
        </View>

        <View style={styles.divider} />

        <View style={styles.grid}>
          <View style={styles.gridCell}>
            <Text style={styles.cellLabel}>VEHICLE PLATE</Text>
            <Text style={styles.cellValueHighlight}>{vehicleNo}</Text>
          </View>

          <View style={styles.gridCell}>
            <Text style={styles.cellLabel}>PURCHASE ORDER</Text>
            <Text style={styles.cellValue}>{poNo}</Text>
          </View>

          <View style={styles.gridCell}>
            <Text style={styles.cellLabel}>SUPPLIER</Text>
            <Text style={styles.cellValue}>{supplierName}</Text>
          </View>

          <View style={styles.gridCell}>
            <Text style={styles.cellLabel}>DRIVER DETAILS</Text>
            <Text style={styles.cellValue}>
              {driverName} • {driverContact}
            </Text>
          </View>

          <View style={styles.gridCell}>
            <Text style={styles.cellLabel}>TIMESTAMP</Text>
            <Text style={styles.cellValue}>{timestamp}</Text>
          </View>

          <View style={styles.gridCell}>
            <Text style={styles.cellLabel}>STATUS</Text>
            <Text style={styles.statusBadgeText}>ENTRY_APPROVED ✓</Text>
          </View>
        </View>

        {/* QR Code Barcode Representation */}
        <View style={styles.qrContainer}>
          <Text style={styles.qrCodeRef}>KAIZENX:GATE_ENTRY:{gatePassNo}</Text>
          <Text style={styles.qrHint}>Scannable by GRN receiving dock operators</Text>
        </View>
      </View>

      {/* Action Buttons */}
      <TouchableOpacity style={styles.primaryBtn} onPress={onNewScan}>
        <Text style={styles.primaryBtnText}>+ SCAN NEXT TRUCK</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.secondaryBtn} onPress={onViewHistory}>
        <Text style={styles.secondaryBtnText}>VIEW INBOUND ENTRIES HISTORY</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f172a",
  },
  scrollContent: {
    padding: 20,
    justifyContent: "center",
  },
  banner: {
    alignItems: "center",
    marginBottom: 20,
  },
  checkCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#10b981",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
    shadowColor: "#10b981",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 8,
  },
  checkMark: {
    color: "#ffffff",
    fontSize: 32,
    fontWeight: "900",
  },
  bannerTitle: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: 1,
  },
  bannerSub: {
    color: "#34d399",
    fontSize: 12,
    marginTop: 4,
  },
  ticketCard: {
    backgroundColor: "#1e293b",
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.4)",
    marginBottom: 20,
  },
  ticketHeader: {
    alignItems: "center",
  },
  passLabel: {
    color: "#94a3b8",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.5,
  },
  passNumber: {
    color: "#38bdf8",
    fontSize: 22,
    fontWeight: "900",
    marginTop: 4,
    letterSpacing: 1,
  },
  divider: {
    height: 1,
    backgroundColor: "#334155",
    marginVertical: 16,
  },
  grid: {
    gap: 12,
  },
  gridCell: {
    backgroundColor: "#0f172a",
    padding: 10,
    borderRadius: 10,
  },
  cellLabel: {
    color: "#64748b",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1,
  },
  cellValue: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 2,
  },
  cellValueHighlight: {
    color: "#38bdf8",
    fontSize: 16,
    fontWeight: "900",
    marginTop: 2,
  },
  statusBadgeText: {
    color: "#34d399",
    fontWeight: "900",
    fontSize: 12,
    marginTop: 2,
  },
  qrContainer: {
    marginTop: 16,
    backgroundColor: "#0f172a",
    padding: 12,
    borderRadius: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#334155",
  },
  qrCodeRef: {
    color: "#38bdf8",
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
    fontSize: 11,
    fontWeight: "800",
  },
  qrHint: {
    color: "#64748b",
    fontSize: 10,
    marginTop: 4,
  },
  primaryBtn: {
    backgroundColor: "#0284c7",
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
    marginBottom: 10,
  },
  primaryBtnText: {
    color: "#ffffff",
    fontWeight: "900",
    fontSize: 13,
    letterSpacing: 1,
  },
  secondaryBtn: {
    backgroundColor: "#1e293b",
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#334155",
  },
  secondaryBtnText: {
    color: "#94a3b8",
    fontWeight: "800",
    fontSize: 12,
  },
});
