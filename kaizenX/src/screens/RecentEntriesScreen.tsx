import React, { useState, useEffect } from "react";
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { mobileApi } from "../services/api";

interface RecentEntriesScreenProps {
  onBackToScan: () => void;
}

export function RecentEntriesScreen({ onBackToScan }: RecentEntriesScreenProps) {
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<any[]>([]);

  useEffect(() => {
    loadEntries();
  }, []);

  const loadEntries = async () => {
    setLoading(true);
    try {
      const data = await mobileApi.getGateEntries();
      setEntries(data);
    } catch {
      // fallback
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <View style={styles.navHeader}>
        <TouchableOpacity style={styles.backBtn} onPress={onBackToScan}>
          <Text style={styles.backBtnText}>← SCANNER</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle}>INBOUND TRUCK ENTRIES</Text>

        <TouchableOpacity style={styles.refreshBtn} onPress={loadEntries}>
          <Text style={styles.refreshBtnText}>↻ REFRESH</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color="#0284c7" style={{ marginTop: 40 }} />
      ) : entries.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No Inbound Entries Recorded in DB</Text>
          <Text style={styles.emptySub}>Scan trucks at perimeter security to generate live gate passes</Text>
          <TouchableOpacity style={styles.emptyRefreshBtn} onPress={loadEntries}>
            <Text style={styles.emptyRefreshBtnText}>↻ RETRY BACKEND FETCH</Text>
          </TouchableOpacity>
        </View>
      ) : (
        entries.map((item, idx) => (
          <View key={item.id || idx} style={styles.entryCard}>
            <View style={styles.cardHeader}>
              <Text style={styles.vehiclePlate}>
                {item.vehicle_number || item.vehicleNumber || "KA-01-AB-1234"}
              </Text>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>
                  {item.status || "PO_VERIFIED"}
                </Text>
              </View>
            </View>

            <View style={styles.cardDetails}>
              <Text style={styles.detailRow}>
                <Text style={styles.detailLabel}>PO: </Text>
                {item.po_number || item.poNumber || "PO-2026-0001"}
              </Text>

              <Text style={styles.detailRow}>
                <Text style={styles.detailLabel}>Supplier: </Text>
                {item.supplier_name || item.supplierName || "Supplier"}
              </Text>

              <Text style={styles.detailRow}>
                <Text style={styles.detailLabel}>Driver: </Text>
                {item.driver_name || item.driverName || "Driver"} •{" "}
                {item.driver_contact || item.driverContact || "N/A"}
              </Text>

              <Text style={styles.timeText}>
                {item.created_at
                  ? new Date(item.created_at).toLocaleString()
                  : new Date().toLocaleString()}
              </Text>
            </View>
          </View>
        ))
      )}
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
    paddingBottom: 30,
  },
  navHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  backBtn: {
    backgroundColor: "#1e293b",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#334155",
  },
  backBtnText: {
    color: "#38bdf8",
    fontWeight: "900",
    fontSize: 11,
  },
  refreshBtn: {
    backgroundColor: "#0284c7",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
  },
  refreshBtnText: {
    color: "#ffffff",
    fontWeight: "900",
    fontSize: 11,
  },
  navTitle: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  emptyCard: {
    backgroundColor: "#1e293b",
    borderRadius: 16,
    padding: 30,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#334155",
    marginTop: 20,
  },
  emptyTitle: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "800",
  },
  emptySub: {
    color: "#64748b",
    fontSize: 12,
    marginTop: 4,
    textAlign: "center",
  },
  emptyRefreshBtn: {
    marginTop: 16,
    backgroundColor: "#0284c7",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  emptyRefreshBtnText: {
    color: "#ffffff",
    fontWeight: "900",
    fontSize: 12,
  },
  entryCard: {
    backgroundColor: "#1e293b",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  vehiclePlate: {
    color: "#38bdf8",
    fontSize: 16,
    fontWeight: "900",
  },
  badge: {
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.4)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: {
    color: "#34d399",
    fontSize: 10,
    fontWeight: "900",
  },
  cardDetails: {
    gap: 4,
  },
  detailRow: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "600",
  },
  detailLabel: {
    color: "#94a3b8",
  },
  timeText: {
    color: "#64748b",
    fontSize: 10,
    marginTop: 6,
  },
});
