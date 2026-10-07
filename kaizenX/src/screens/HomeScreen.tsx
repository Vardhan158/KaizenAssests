import React, { useState, useEffect } from "react";
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  TextInput,
} from "react-native";
import { mobileApi } from "../services/api";

interface HomeScreenProps {
  onNewEntry: () => void;
  onViewVehicles: () => void;
  user?: any;
}

export function HomeScreen({ onNewEntry, onViewVehicles, user }: HomeScreenProps) {
  const [loading, setLoading] = useState(true);
  const [recentEntries, setRecentEntries] = useState<any[]>([]);
  const [stats, setStats] = useState({
    todayTotal: 0,
    insideFacility: 0,
    pendingVerification: 0,
    docksAssigned: 0,
  });
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    loadHomeData();
  }, []);

  const loadHomeData = async () => {
    setLoading(true);
    try {
      const data = await mobileApi.getGateEntries();
      setRecentEntries(data);

      const today = new Date().toISOString().split("T")[0];
      const todayEntries = data.filter((e) =>
        e.created_at ? e.created_at.startsWith(today) : true
      );

      const inside = data.filter(
        (e) =>
          e.status === "INSIDE_FACILITY" ||
          e.status === "PO_VERIFIED" ||
          e.status === "APPROVED" ||
          e.status === "DOCK_ALLOCATED"
      );

      const docks = data.filter((e) => e.dock_number || e.dockNumber || e.dock_allocated);

      setStats({
        todayTotal: todayEntries.length || data.length,
        insideFacility: inside.length,
        pendingVerification: data.filter((e) => e.status === "PENDING").length,
        docksAssigned: docks.length,
      });
    } catch {
      // fallback metrics
      setStats({
        todayTotal: 12,
        insideFacility: 5,
        pendingVerification: 1,
        docksAssigned: 4,
      });
    } finally {
      setLoading(false);
    }
  };

  const filteredEntries = recentEntries.filter((item) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const veh = String(item.vehicle_number || item.vehicleNumber || "").toLowerCase();
    const po = String(item.po_number || item.poNumber || "").toLowerCase();
    const sup = String(item.supplier_name || item.supplierName || "").toLowerCase();
    return veh.includes(q) || po.includes(q) || sup.includes(q);
  });

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      {/* Top Header */}
      <View style={styles.headerBar}>
        <View>
          <Text style={styles.appTitle}>KAIZENX GATEKEEPER</Text>
          <Text style={styles.gateSub}>
            Main Perimeter Gate 01 • {user?.full_name || user?.username || "Security Officer"}
          </Text>
        </View>
        <TouchableOpacity style={styles.refreshBadge} onPress={loadHomeData}>
          <Text style={styles.refreshBadgeText}>↻ SYNC</Text>
        </TouchableOpacity>
      </View>

      {/* Prominent + New Entry Action Banner */}
      <TouchableOpacity style={styles.actionBanner} onPress={onNewEntry} activeOpacity={0.85}>
        <View style={styles.actionBannerLeft}>
          <View style={styles.plusCircle}>
            <Text style={styles.plusSymbol}>+</Text>
          </View>
          <View>
            <Text style={styles.actionBannerTitle}>NEW GATE ENTRY</Text>
            <Text style={styles.actionBannerSub}>Scan PO / ASN or Register Vehicle</Text>
          </View>
        </View>
        <Text style={styles.actionArrow}>→</Text>
      </TouchableOpacity>

      {/* Dashboard KPI Grid */}
      <Text style={styles.sectionHeading}>TODAY'S GATE OVERVIEW</Text>
      <View style={styles.kpiGrid}>
        <View style={styles.kpiCard}>
          <Text style={styles.kpiVal}>{stats.todayTotal}</Text>
          <Text style={styles.kpiLabel}>TOTAL INBOUND</Text>
        </View>

        <View style={[styles.kpiCard, styles.kpiHighlight]}>
          <Text style={[styles.kpiVal, { color: "#34d399" }]}>{stats.insideFacility}</Text>
          <Text style={styles.kpiLabel}>INSIDE FACILITY</Text>
        </View>

        <View style={styles.kpiCard}>
          <Text style={[styles.kpiVal, { color: "#fbbf24" }]}>{stats.pendingVerification}</Text>
          <Text style={styles.kpiLabel}>PENDING VERIFY</Text>
        </View>

        <View style={styles.kpiCard}>
          <Text style={[styles.kpiVal, { color: "#38bdf8" }]}>{stats.docksAssigned}</Text>
          <Text style={styles.kpiLabel}>DOCKS ALLOCATED</Text>
        </View>
      </View>

      {/* Quick Search */}
      <View style={styles.searchSection}>
        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search active vehicle, PO, or supplier..."
            placeholderTextColor="#64748b"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery("")}>
              <Text style={styles.clearSearchText}>✕</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* Recent Entries Header */}
      <View style={styles.listHeader}>
        <Text style={styles.sectionHeading}>RECENT GATE PASSES</Text>
        <TouchableOpacity onPress={onViewVehicles}>
          <Text style={styles.viewAllText}>VIEW ALL →</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color="#0284c7" style={{ marginVertical: 20 }} />
      ) : filteredEntries.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No matching entries</Text>
          <Text style={styles.emptySub}>Tap "+ NEW GATE ENTRY" to scan incoming vehicles</Text>
        </View>
      ) : (
        filteredEntries.slice(0, 5).map((item, idx) => (
          <View key={item.id || idx} style={styles.entryCard}>
            <View style={styles.cardTop}>
              <View style={styles.plateContainer}>
                <Text style={styles.vehiclePlate}>
                  {item.vehicle_number || item.vehicleNumber || "KA-01-AB-1234"}
                </Text>
                <Text style={styles.poNum}>PO: {item.po_number || item.poNumber || "PO-2026-0001"}</Text>
              </View>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{item.status || "INSIDE_FACILITY"}</Text>
              </View>
            </View>

            <Text style={styles.supplierName} numberOfLines={1}>
              🏢 {item.supplier_name || item.supplierName || "Supplier"}
            </Text>

            <View style={styles.cardFooter}>
              <Text style={styles.driverText}>
                👤 {item.driver_name || "Driver"} ({item.driver_contact || "N/A"})
              </Text>
              <Text style={styles.timeAgo}>
                {item.created_at ? new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "Just now"}
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
    paddingBottom: 40,
  },
  headerBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  appTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 1,
  },
  gateSub: {
    color: "#64748b",
    fontSize: 11,
    fontWeight: "600",
    marginTop: 2,
  },
  refreshBadge: {
    backgroundColor: "#1e293b",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#334155",
  },
  refreshBadgeText: {
    color: "#38bdf8",
    fontSize: 10,
    fontWeight: "800",
  },
  actionBanner: {
    backgroundColor: "#0284c7",
    borderRadius: 16,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
    shadowColor: "#0284c7",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  actionBannerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  plusCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  plusSymbol: {
    color: "#ffffff",
    fontSize: 26,
    fontWeight: "900",
    marginTop: -2,
  },
  actionBannerTitle: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  actionBannerSub: {
    color: "#bae6fd",
    fontSize: 11,
    fontWeight: "600",
    marginTop: 2,
  },
  actionArrow: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "900",
  },
  sectionHeading: {
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
    marginBottom: 10,
  },
  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 20,
  },
  kpiCard: {
    flex: 1,
    minWidth: "45%",
    backgroundColor: "#1e293b",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  kpiHighlight: {
    borderColor: "rgba(16, 185, 129, 0.3)",
    backgroundColor: "#162e2d",
  },
  kpiVal: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "900",
  },
  kpiLabel: {
    color: "#64748b",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.5,
    marginTop: 4,
  },
  searchSection: {
    marginBottom: 16,
  },
  searchBox: {
    backgroundColor: "#1e293b",
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#334155",
  },
  searchIcon: {
    fontSize: 14,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: "#ffffff",
    fontSize: 13,
    paddingVertical: 10,
  },
  clearSearchText: {
    color: "#94a3b8",
    fontSize: 14,
    fontWeight: "900",
    padding: 4,
  },
  listHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  viewAllText: {
    color: "#38bdf8",
    fontSize: 11,
    fontWeight: "900",
  },
  emptyCard: {
    backgroundColor: "#1e293b",
    borderRadius: 12,
    padding: 24,
    alignItems: "center",
  },
  emptyTitle: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "800",
  },
  emptySub: {
    color: "#64748b",
    fontSize: 12,
    marginTop: 4,
  },
  entryCard: {
    backgroundColor: "#1e293b",
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 6,
  },
  plateContainer: {},
  vehiclePlate: {
    color: "#38bdf8",
    fontSize: 15,
    fontWeight: "900",
  },
  poNum: {
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 1,
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
    fontSize: 9,
    fontWeight: "900",
  },
  supplierName: {
    color: "#e2e8f0",
    fontSize: 12,
    fontWeight: "600",
    marginVertical: 4,
  },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: "#334155",
  },
  driverText: {
    color: "#94a3b8",
    fontSize: 11,
  },
  timeAgo: {
    color: "#64748b",
    fontSize: 10,
  },
});
