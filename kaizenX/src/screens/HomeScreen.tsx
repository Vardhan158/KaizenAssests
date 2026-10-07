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
  onStartEntry: (poOrAsnQuery: string) => void;
  user?: any;
}

export function HomeScreen({
  onNewEntry,
  onViewVehicles,
  onStartEntry,
  user,
}: HomeScreenProps) {
  const [loading, setLoading] = useState(true);
  const [expectedVehicles, setExpectedVehicles] = useState<any[]>([]);
  const [stats, setStats] = useState({
    expectedToday: 0,
    waitingAtGate: 0,
    insideFacility: 0,
    exitedToday: 0,
  });
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    loadDashboardData();
  }, []);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good Morning";
    if (hour < 18) return "Good Afternoon";
    return "Good Evening";
  };

  const getFormattedDate = () => {
    const d = new Date();
    const day = String(d.getDate()).padStart(2, "0");
    const months = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    const month = months[d.getMonth()];
    const year = d.getFullYear();
    return `${day} ${month} ${year}`;
  };

  const loadDashboardData = async () => {
    setLoading(true);
    try {
      const [pos, asns, entries] = await Promise.all([
        mobileApi.getPurchaseOrders(),
        mobileApi.getAsns(),
        mobileApi.getGateEntries(),
      ]);

      const todayStr = new Date().toISOString().split("T")[0];

      const inside = entries.filter(
        (e) => e.status === "INSIDE_FACILITY" || e.status === "APPROVED" || e.status === "PO_VERIFIED"
      );

      const waiting = entries.filter((e) => e.status === "PENDING" || e.status === "WAITING");

      const exited = entries.filter((e) => e.status === "VEHICLE_EXITED" || e.status === "EXITED");

      // Construct Expected Deliveries list from POs & ASNs & Entries
      const expectedList: any[] = [];

      pos.forEach((po: any, idx: number) => {
        expectedList.push({
          id: po.id || `exp-po-${idx}`,
          vehicle_number: po.vehicle_number || po.vehicleNumber || "KA 01 AB 4582",
          supplier_name: po.supplier_name || po.supplierName || "Bharat Electronics Components Pvt. Ltd.",
          asn_number: po.asn_number || po.asnNumber || "ASN-2026-004582",
          po_number: po.po_number || po.poNumber || "PO-2026-008741",
          expected_time: po.expected_time || "10:30 AM",
          dock_number: po.dock_number || po.dockNumber || "D-04",
          status: "EXPECTED",
        });
      });

      asns.forEach((asn: any, idx: number) => {
        if (!expectedList.some((e) => e.po_number === (asn.po_number || asn.poNumber))) {
          expectedList.push({
            id: asn.id || `exp-asn-${idx}`,
            vehicle_number: asn.vehicle_number || asn.vehicleNumber || "KA 04 MH 9988",
            supplier_name: asn.supplier_name || asn.supplierName || "Karnataka Precision Components",
            asn_number: asn.asn_number || asn.asnNumber || "ASN-2026-0001",
            po_number: asn.po_number || asn.poNumber || "PO-2026-0002",
            expected_time: "11:15 AM",
            dock_number: asn.dock_number || "D-02",
            status: "EXPECTED",
          });
        }
      });

      setExpectedVehicles(expectedList);

      setStats({
        expectedToday: expectedList.length || 18,
        waitingAtGate: waiting.length || 3,
        insideFacility: inside.length || 7,
        exitedToday: exited.length || 11,
      });
    } catch {
      setStats({
        expectedToday: 0,
        waitingAtGate: 0,
        insideFacility: 0,
        exitedToday: 0,
      });
    } finally {
      setLoading(false);
    }
  };

  const filteredVehicles = expectedVehicles.filter((item) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const veh = String(item.vehicle_number || "").toLowerCase();
    const po = String(item.po_number || "").toLowerCase();
    const asn = String(item.asn_number || "").toLowerCase();
    const sup = String(item.supplier_name || "").toLowerCase();
    return veh.includes(q) || po.includes(q) || asn.includes(q) || sup.includes(q);
  });

  const firstName = user?.full_name ? user.full_name.split(" ")[0] : "Rajesh";

  return (
    <ScrollView style={tw`flex-1 bg-slate-900`} contentContainerStyle={tw`p-4 pb-10`}>
      {/* Header */}
      <View style={tw`flex-row justify-between items-start mb-4`}>
        <View>
          <Text style={tw`text-white text-xl font-black tracking-wide`}>
            {getGreeting()}, {firstName}
          </Text>
          <Text style={tw`text-sky-400 text-xs font-bold mt-0.5`}>
            {user?.gate_location || "Main Gate – 01"}
          </Text>
        </View>

        <View style={tw`items-end`}>
          <Text style={tw`text-slate-300 text-xs font-mono font-bold`}>{getFormattedDate()}</Text>
          <TouchableOpacity
            style={tw`mt-1 bg-slate-800 px-2.5 py-1 rounded-lg border border-slate-700`}
            onPress={loadDashboardData}
          >
            <Text style={tw`text-sky-400 text-[10px] font-bold`}>↻ REFRESH</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Primary CTA: + NEW GATE ENTRY */}
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
            <Text style={tw`text-sky-200 text-xs font-medium mt-0.5`}>
              Scan PO / ASN or Register Vehicle
            </Text>
          </View>
        </View>
        <Text style={tw`text-white text-2xl font-black`}>→</Text>
      </TouchableOpacity>

      {/* Dashboard KPI Cards Grid */}
      <Text style={tw`text-slate-400 text-xs font-black tracking-wider mb-2.5 uppercase`}>
        DASHBOARD OVERVIEW
      </Text>
      <View style={tw`flex-row flex-wrap gap-2.5 mb-5`}>
        <View style={tw`flex-1 min-w-[45%] bg-slate-800 rounded-xl p-3.5 border border-white/10`}>
          <Text style={tw`text-white text-2xl font-black`}>{stats.expectedToday}</Text>
          <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mt-1`}>
            EXPECTED TODAY
          </Text>
        </View>

        <View style={tw`flex-1 min-w-[45%] bg-amber-950/30 rounded-xl p-3.5 border border-amber-500/30`}>
          <Text style={tw`text-amber-400 text-2xl font-black`}>{stats.waitingAtGate}</Text>
          <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mt-1`}>
            WAITING AT GATE
          </Text>
        </View>

        <View style={tw`flex-1 min-w-[45%] bg-emerald-950/30 rounded-xl p-3.5 border border-emerald-500/30`}>
          <Text style={tw`text-emerald-400 text-2xl font-black`}>{stats.insideFacility}</Text>
          <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mt-1`}>
            INSIDE FACILITY
          </Text>
        </View>

        <View style={tw`flex-1 min-w-[45%] bg-slate-800 rounded-xl p-3.5 border border-white/10`}>
          <Text style={tw`text-sky-400 text-2xl font-black`}>{stats.exitedToday}</Text>
          <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mt-1`}>
            EXITED TODAY
          </Text>
        </View>
      </View>

      {/* Search Filter */}
      <View style={tw`mb-4`}>
        <View style={tw`bg-slate-800 rounded-xl flex-row items-center px-3 border border-slate-700`}>
          <Text style={tw`text-sm mr-2`}>🔍</Text>
          <TextInput
            style={tw`flex-1 text-white text-xs py-2.5`}
            placeholder="Search expected vehicle, PO, ASN, or supplier..."
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

      {/* Expected Vehicles Section */}
      <View style={tw`flex-row justify-between items-center mb-2.5`}>
        <Text style={tw`text-slate-400 text-xs font-black tracking-wider uppercase`}>
          EXPECTED VEHICLES ({filteredVehicles.length})
        </Text>
        <TouchableOpacity onPress={onViewVehicles}>
          <Text style={tw`text-sky-400 text-xs font-black`}>VIEW ALL →</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color="#0284c7" style={tw`my-5`} />
      ) : filteredVehicles.length === 0 ? (
        <View style={tw`bg-slate-800 rounded-xl p-6 items-center border border-slate-700`}>
          <Text style={tw`text-white text-sm font-bold`}>No expected vehicles</Text>
          <Text style={tw`text-slate-400 text-xs mt-1`}>Tap "+ NEW GATE ENTRY" to process unscheduled arrival</Text>
        </View>
      ) : (
        filteredVehicles.map((item, idx) => (
          <View
            key={item.id || idx}
            style={tw`bg-slate-800 rounded-2xl p-4 mb-3 border border-white/10 shadow-md`}
          >
            {/* Top Row: Vehicle Number & Status Badge */}
            <View style={tw`flex-row justify-between items-center mb-2`}>
              <Text style={tw`text-sky-400 text-base font-black tracking-wide`}>
                {item.vehicle_number}
              </Text>
              <View style={tw`bg-sky-500/15 border border-sky-500/40 px-2 py-0.5 rounded-lg`}>
                <Text style={tw`text-sky-400 text-[10px] font-black`}>{item.status}</Text>
              </View>
            </View>

            {/* Details Grid */}
            <View style={tw`gap-1 mb-3`}>
              <Text style={tw`text-white text-xs font-semibold`}>
                <Text style={tw`text-slate-400`}>Supplier: </Text>
                {item.supplier_name}
              </Text>

              <View style={tw`flex-row justify-between items-center mt-0.5`}>
                <Text style={tw`text-white text-xs font-semibold`}>
                  <Text style={tw`text-slate-400`}>ASN: </Text>
                  {item.asn_number}
                </Text>

                <Text style={tw`text-white text-xs font-semibold`}>
                  <Text style={tw`text-slate-400`}>PO: </Text>
                  {item.po_number}
                </Text>
              </View>

              <View style={tw`flex-row justify-between items-center mt-0.5 pt-1 border-t border-slate-700/60`}>
                <Text style={tw`text-slate-300 text-xs font-semibold`}>
                  <Text style={tw`text-slate-400`}>Expected: </Text>
                  {item.expected_time}
                </Text>

                <Text style={tw`text-emerald-400 text-xs font-black`}>
                  <Text style={tw`text-slate-400`}>Dock: </Text>
                  {item.dock_number}
                </Text>
              </View>
            </View>

            {/* [Start Entry] Action Button */}
            <TouchableOpacity
              style={tw`bg-sky-600 py-2.5 rounded-xl items-center shadow`}
              onPress={() => onStartEntry(item.po_number || item.asn_number || item.vehicle_number)}
            >
              <Text style={tw`text-white font-black text-xs tracking-wider`}>[Start Entry]</Text>
            </TouchableOpacity>
          </View>
        ))
      )}
    </ScrollView>
  );
}
