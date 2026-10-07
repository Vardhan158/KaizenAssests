import React, { useState, useEffect } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  TextInput,
} from "react-native";
import tw from "twrnc";
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
        e.created_at ? e.created_at.startsWith(today) : false
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
        todayTotal: todayEntries.length,
        insideFacility: inside.length,
        pendingVerification: data.filter((e) => e.status === "PENDING").length,
        docksAssigned: docks.length,
      });
    } catch {
      setStats({
        todayTotal: 0,
        insideFacility: 0,
        pendingVerification: 0,
        docksAssigned: 0,
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
    <ScrollView style={tw`flex-1 bg-slate-900`} contentContainerStyle={tw`p-4 pb-10`}>
      {/* Top Header */}
      <View style={tw`flex-row justify-between items-center mb-4`}>
        <View>
          <Text style={tw`text-white text-lg font-black tracking-wider`}>KAIZENX GATEKEEPER</Text>
          <Text style={tw`text-slate-400 text-xs font-semibold mt-0.5`}>
            Main Perimeter Gate 01 • {user?.full_name || user?.username || "Security Officer"}
          </Text>
        </View>
        <TouchableOpacity
          style={tw`bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700`}
          onPress={loadHomeData}
        >
          <Text style={tw`text-sky-400 text-xs font-bold`}>↻ SYNC</Text>
        </TouchableOpacity>
      </View>

      {/* Prominent + New Entry Action Banner */}
      <TouchableOpacity
        style={tw`bg-sky-600 rounded-2xl p-4 flex-row items-center justify-between mb-5 shadow-lg`}
        onPress={onNewEntry}
        activeOpacity={0.85}
      >
        <View style={tw`flex-row items-center gap-3`}>
          <View style={tw`w-11 h-11 rounded-full bg-white/20 items-center justify-center`}>
            <Text style={tw`text-white text-2xl font-black -mt-0.5`}>+</Text>
          </View>
          <View>
            <Text style={tw`text-white text-base font-black tracking-wide`}>NEW GATE ENTRY</Text>
            <Text style={tw`text-sky-200 text-xs font-medium mt-0.5`}>Scan PO / ASN or Register Vehicle</Text>
          </View>
        </View>
        <Text style={tw`text-white text-2xl font-black`}>→</Text>
      </TouchableOpacity>

      {/* Dashboard KPI Grid */}
      <Text style={tw`text-slate-400 text-xs font-black tracking-wider mb-2.5 uppercase`}>
        TODAY'S GATE OVERVIEW
      </Text>
      <View style={tw`flex-row flex-wrap gap-2.5 mb-5`}>
        <View style={tw`flex-1 min-w-[45%] bg-slate-800 rounded-xl p-3.5 border border-white/10`}>
          <Text style={tw`text-white text-2xl font-black`}>{stats.todayTotal}</Text>
          <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mt-1`}>TOTAL INBOUND</Text>
        </View>

        <View style={tw`flex-1 min-w-[45%] bg-emerald-950/40 rounded-xl p-3.5 border border-emerald-500/30`}>
          <Text style={tw`text-emerald-400 text-2xl font-black`}>{stats.insideFacility}</Text>
          <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mt-1`}>INSIDE FACILITY</Text>
        </View>

        <View style={tw`flex-1 min-w-[45%] bg-slate-800 rounded-xl p-3.5 border border-white/10`}>
          <Text style={tw`text-amber-400 text-2xl font-black`}>{stats.pendingVerification}</Text>
          <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mt-1`}>PENDING VERIFY</Text>
        </View>

        <View style={tw`flex-1 min-w-[45%] bg-slate-800 rounded-xl p-3.5 border border-white/10`}>
          <Text style={tw`text-sky-400 text-2xl font-black`}>{stats.docksAssigned}</Text>
          <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mt-1`}>DOCKS ALLOCATED</Text>
        </View>
      </View>

      {/* Quick Search */}
      <View style={tw`mb-4`}>
        <View style={tw`bg-slate-800 rounded-xl flex-row items-center px-3 border border-slate-700`}>
          <Text style={tw`text-sm mr-2`}>🔍</Text>
          <TextInput
            style={tw`flex-1 text-white text-xs py-2.5`}
            placeholder="Search active vehicle, PO, or supplier..."
            placeholderTextColor="#64748b"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery("")}>
              <Text style={tw`text-slate-400 text-sm font-black p-1`}>✕</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* Recent Entries Header */}
      <View style={tw`flex-row justify-between items-center mb-2.5`}>
        <Text style={tw`text-slate-400 text-xs font-black tracking-wider uppercase`}>RECENT GATE PASSES</Text>
        <TouchableOpacity onPress={onViewVehicles}>
          <Text style={tw`text-sky-400 text-xs font-black`}>VIEW ALL →</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color="#0284c7" style={tw`my-5`} />
      ) : filteredEntries.length === 0 ? (
        <View style={tw`bg-slate-800 rounded-xl p-6 items-center border border-slate-700`}>
          <Text style={tw`text-white text-sm font-bold`}>No active entries found</Text>
          <Text style={tw`text-slate-400 text-xs mt-1`}>Tap "+ NEW GATE ENTRY" to scan incoming vehicles</Text>
        </View>
      ) : (
        filteredEntries.slice(0, 5).map((item, idx) => (
          <View key={item.id || idx} style={tw`bg-slate-800 rounded-xl p-3.5 mb-2.5 border border-white/10`}>
            <View style={tw`flex-row justify-between items-start mb-1.5`}>
              <View>
                <Text style={tw`text-sky-400 text-sm font-black`}>
                  {item.vehicle_number || item.vehicleNumber || "UNASSIGNED"}
                </Text>
                <Text style={tw`text-slate-400 text-xs font-bold mt-0.5`}>
                  PO: {item.po_number || item.poNumber || "N/A"}
                </Text>
              </View>
              <View style={tw`bg-emerald-500/15 border border-emerald-500/40 px-2 py-0.5 rounded`}>
                <Text style={tw`text-emerald-400 text-[10px] font-black`}>
                  {item.status || "INSIDE_FACILITY"}
                </Text>
              </View>
            </View>

            <Text style={tw`text-slate-200 text-xs font-medium my-1`} numberOfLines={1}>
              🏢 {item.supplier_name || item.supplierName || "Supplier"}
            </Text>

            <View style={tw`flex-row justify-between items-center mt-1.5 pt-1.5 border-t border-slate-700`}>
              <Text style={tw`text-slate-400 text-xs`}>
                👤 {item.driver_name || "Driver"} ({item.driver_contact || "N/A"})
              </Text>
              <Text style={tw`text-slate-500 text-[10px]`}>
                {item.created_at
                  ? new Date(item.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                  : ""}
              </Text>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}
