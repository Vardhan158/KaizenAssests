import React, { useState, useEffect } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  TextInput,
  Modal,
} from "react-native";
import tw from "twrnc";
import { mobileApi } from "../services/api";
import { formatVehiclePlate } from "../utils/vehicleFormatter";

interface RecentEntriesScreenProps {
  onBackToScan: () => void;
}

export function RecentEntriesScreen({ onBackToScan }: RecentEntriesScreenProps) {
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<any[]>([]);
  const [filterTab, setFilterTab] = useState<"WAITING" | "INSIDE" | "EXITED">("INSIDE");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEntry, setSelectedEntry] = useState<any | null>(null);

  useEffect(() => {
    loadEntries();
  }, []);

  const loadEntries = async () => {
    setLoading(true);
    try {
      const data = await mobileApi.getGateEntries();
      setEntries(data);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };

  const getStatusCategory = (statusStr: string) => {
    const s = String(statusStr || "").toUpperCase();
    if (s.includes("EXIT")) return "EXITED";
    if (s.includes("WAIT") || s.includes("PENDING")) return "WAITING";
    return "INSIDE";
  };

  const filteredEntries = entries.filter((item) => {
    const cat = getStatusCategory(item.status);
    if (cat !== filterTab) return false;

    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const gp = String(item.gate_entry_number || item.gate_pass_number || item.id || "").toLowerCase();
    const veh = String(item.vehicle_number || item.vehicleNumber || "").toLowerCase();
    const sup = String(item.supplier_name || item.supplierName || "").toLowerCase();
    const asn = String(item.asn_reference || item.asn_number || "").toLowerCase();
    const po = String(item.po_number || item.poNumber || "").toLowerCase();

    return gp.includes(q) || veh.includes(q) || sup.includes(q) || asn.includes(q) || po.includes(q);
  });

  return (
    <ScrollView style={tw`flex-1 bg-slate-900`} contentContainerStyle={tw`p-4 pb-8`}>
      {/* Top Header */}
      <View style={tw`flex-row items-center justify-between mb-4`}>
        <TouchableOpacity
          style={tw`bg-slate-800 px-2.5 py-1.5 rounded-xl border border-slate-700`}
          onPress={onBackToScan}
        >
          <Text style={tw`text-sky-400 font-black text-xs`}>← SCANNER</Text>
        </TouchableOpacity>
        <Text style={tw`text-white text-xs font-black tracking-wider uppercase`}>
          ACTIVE VEHICLES (SCREEN 14)
        </Text>

        <TouchableOpacity style={tw`bg-sky-600 px-2.5 py-1.5 rounded-xl`} onPress={loadEntries}>
          <Text style={tw`text-white font-black text-xs`}>↻ REFRESH</Text>
        </TouchableOpacity>
      </View>

      {/* Tabs: WAITING | INSIDE | EXITED */}
      <View style={tw`flex-row bg-slate-800 rounded-xl p-1 mb-4 border border-slate-700`}>
        <TouchableOpacity
          style={tw`flex-1 py-2 items-center rounded-lg ${
            filterTab === "WAITING" ? "bg-amber-600" : ""
          }`}
          onPress={() => setFilterTab("WAITING")}
        >
          <Text
            style={tw`text-xs font-black ${
              filterTab === "WAITING" ? "text-white" : "text-slate-400"
            }`}
          >
            WAITING
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={tw`flex-1 py-2 items-center rounded-lg ${
            filterTab === "INSIDE" ? "bg-emerald-600" : ""
          }`}
          onPress={() => setFilterTab("INSIDE")}
        >
          <Text
            style={tw`text-xs font-black ${
              filterTab === "INSIDE" ? "text-white" : "text-slate-400"
            }`}
          >
            INSIDE
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={tw`flex-1 py-2 items-center rounded-lg ${
            filterTab === "EXITED" ? "bg-slate-700" : ""
          }`}
          onPress={() => setFilterTab("EXITED")}
        >
          <Text
            style={tw`text-xs font-black ${
              filterTab === "EXITED" ? "text-white" : "text-slate-400"
            }`}
          >
            EXITED
          </Text>
        </TouchableOpacity>
      </View>

      {/* Multi-Parameter Search Bar */}
      <View style={tw`mb-4`}>
        <View style={tw`bg-slate-800 rounded-xl flex-row items-center px-3 border border-slate-700`}>
          <Text style={tw`text-sm mr-2`}>🔍</Text>
          <TextInput
            style={tw`flex-1 text-white text-xs py-2.5 font-semibold`}
            placeholder="Search Gate Pass, Vehicle, Supplier, ASN, or PO..."
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

      {/* Entries List */}
      {loading ? (
        <ActivityIndicator color="#0284c7" style={tw`mt-10`} />
      ) : filteredEntries.length === 0 ? (
        <View style={tw`bg-slate-800 rounded-2xl p-7 items-center border border-slate-700 mt-2`}>
          <Text style={tw`text-white text-sm font-bold`}>No vehicles in '{filterTab}' status</Text>
          <Text style={tw`text-slate-400 text-xs mt-1 text-center`}>
            Vehicles in {filterTab} status will appear here automatically
          </Text>
        </View>
      ) : (
        filteredEntries.map((item, idx) => {
          const passNum =
            item.gate_pass_number || item.gate_entry_number || item.id || "GP-BLR-20261007-0048";
          const plateNo = formatVehiclePlate(item.vehicle_number || item.vehicle_plate || "KA 01 AB 4582");
          const suppName = item.supplier_name || item.supplierName || "Bharat Electronics Components Pvt. Ltd.";
          const dockName = item.dock_number || item.assigned_dock_id || "Dock D-04";
          const statusText = item.status || "AT DOCK";
          const insideSince = item.created_at
            ? new Date(item.created_at).toLocaleTimeString("en-IN", {
                hour: "2-digit",
                minute: "2-digit",
              })
            : "10:44 AM";

          return (
            <TouchableOpacity
              key={item.id || idx}
              style={tw`bg-slate-800 rounded-2xl p-4 mb-3 border border-white/10 shadow-md`}
              onPress={() => setSelectedEntry(item)}
              activeOpacity={0.85}
            >
              {/* Top Row: Vehicle Number & Status Badge */}
              <View style={tw`flex-row justify-between items-center mb-1.5`}>
                <Text style={tw`text-sky-400 text-base font-black tracking-wide`}>{plateNo}</Text>
                <View
                  style={tw`px-2.5 py-0.5 rounded-lg border ${
                    filterTab === "INSIDE"
                      ? "bg-emerald-500/15 border-emerald-500/40"
                      : filterTab === "WAITING"
                      ? "bg-amber-500/15 border-amber-500/40"
                      : "bg-slate-700 border-slate-600"
                  }`}
                >
                  <Text
                    style={tw`text-[10px] font-black uppercase ${
                      filterTab === "INSIDE"
                        ? "text-emerald-400"
                        : filterTab === "WAITING"
                        ? "text-amber-400"
                        : "text-slate-300"
                    }`}
                  >
                    {statusText}
                  </Text>
                </View>
              </View>

              {/* Supplier Name */}
              <Text style={tw`text-white text-xs font-bold mb-2`} numberOfLines={1}>
                {suppName}
              </Text>

              <View style={tw`bg-slate-900 p-2.5 rounded-xl gap-1`}>
                <View style={tw`flex-row justify-between items-center`}>
                  <Text style={tw`text-slate-400 text-[11px]`}>Gate Pass:</Text>
                  <Text style={tw`text-sky-400 text-xs font-mono font-bold`}>{passNum}</Text>
                </View>

                <View style={tw`flex-row justify-between items-center`}>
                  <Text style={tw`text-slate-400 text-[11px]`}>Dock:</Text>
                  <Text style={tw`text-emerald-400 text-xs font-bold`}>{dockName}</Text>
                </View>

                <View style={tw`flex-row justify-between items-center`}>
                  <Text style={tw`text-slate-400 text-[11px]`}>Inside Since:</Text>
                  <Text style={tw`text-slate-200 text-xs font-bold`}>{insideSince}</Text>
                </View>
              </View>
            </TouchableOpacity>
          );
        })
      )}

      {/* Read-Only Gate Pass Details Modal */}
      <Modal visible={Boolean(selectedEntry)} animationType="fade" transparent>
        <View style={tw`flex-1 bg-black/80 justify-center items-center p-5`}>
          <View style={tw`w-full bg-slate-800 rounded-3xl p-5 border border-sky-500/40 shadow-2xl`}>
            <View style={tw`flex-row justify-between items-center mb-3 pb-2.5 border-b border-slate-700`}>
              <Text style={tw`text-white text-sm font-black`}>GATE PASS RECORD DETAILS</Text>
              <TouchableOpacity onPress={() => setSelectedEntry(null)}>
                <Text style={tw`text-red-400 text-xs font-bold`}>✕ CLOSE</Text>
              </TouchableOpacity>
            </View>

            {selectedEntry && (
              <View style={tw`gap-2 mb-4`}>
                <View style={tw`bg-slate-900 p-2.5 rounded-xl`}>
                  <Text style={tw`text-slate-400 text-[10px] font-bold uppercase`}>Gate Pass Number</Text>
                  <Text style={tw`text-sky-400 text-sm font-black mt-0.5`}>
                    {selectedEntry.gate_pass_number || selectedEntry.gate_entry_number || selectedEntry.id}
                  </Text>
                </View>

                <View style={tw`bg-slate-900 p-2.5 rounded-xl`}>
                  <Text style={tw`text-slate-400 text-[10px] font-bold uppercase`}>Vehicle Plate</Text>
                  <Text style={tw`text-sky-400 text-sm font-black mt-0.5`}>
                    {formatVehiclePlate(selectedEntry.vehicle_number || selectedEntry.vehicle_plate || "")}
                  </Text>
                </View>

                <View style={tw`bg-slate-900 p-2.5 rounded-xl`}>
                  <Text style={tw`text-slate-400 text-[10px] font-bold uppercase`}>Supplier</Text>
                  <Text style={tw`text-white text-xs font-bold mt-0.5`}>
                    {selectedEntry.supplier_name || selectedEntry.supplierName || "Supplier"}
                  </Text>
                </View>

                <View style={tw`bg-slate-900 p-2.5 rounded-xl`}>
                  <Text style={tw`text-slate-400 text-[10px] font-bold uppercase`}>Assigned Dock</Text>
                  <Text style={tw`text-emerald-400 text-xs font-black mt-0.5`}>
                    {selectedEntry.dock_number || "Dock D-04"}
                  </Text>
                </View>

                <View style={tw`bg-slate-900 p-2.5 rounded-xl`}>
                  <Text style={tw`text-slate-400 text-[10px] font-bold uppercase`}>Current Status</Text>
                  <Text style={tw`text-emerald-400 text-xs font-black uppercase mt-0.5`}>
                    {selectedEntry.status || "AT DOCK"}
                  </Text>
                </View>
              </View>
            )}

            <Text style={tw`text-slate-500 text-[10px] italic text-center mb-3`}>
              * Security can view the record but cannot modify warehouse/QC information.
            </Text>

            <TouchableOpacity
              style={tw`bg-sky-600 py-3 rounded-xl items-center`}
              onPress={() => setSelectedEntry(null)}
            >
              <Text style={tw`text-white text-xs font-black`}>OK / BACK TO LIST</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}
