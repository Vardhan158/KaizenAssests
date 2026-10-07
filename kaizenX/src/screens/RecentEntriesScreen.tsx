import React, { useState, useEffect } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import tw from "twrnc";
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
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={tw`flex-1 bg-slate-900`} contentContainerStyle={tw`p-4 pb-8`}>
      <View style={tw`flex-row items-center justify-between mb-5`}>
        <TouchableOpacity
          style={tw`bg-slate-800 px-2.5 py-2 rounded-xl border border-slate-700`}
          onPress={onBackToScan}
        >
          <Text style={tw`text-sky-400 font-black text-xs`}>← SCANNER</Text>
        </TouchableOpacity>
        <Text style={tw`text-white text-xs font-black tracking-wider`}>INBOUND TRUCK ENTRIES</Text>

        <TouchableOpacity style={tw`bg-sky-600 px-2.5 py-2 rounded-xl`} onPress={loadEntries}>
          <Text style={tw`text-white font-black text-xs`}>↻ REFRESH</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color="#0284c7" style={tw`mt-10`} />
      ) : entries.length === 0 ? (
        <View style={tw`bg-slate-800 rounded-2xl p-7 items-center border border-slate-700 mt-5`}>
          <Text style={tw`text-white text-sm font-bold`}>No Inbound Entries Recorded</Text>
          <Text style={tw`text-slate-400 text-xs mt-1 text-center`}>
            Scan trucks at perimeter security to generate live gate passes
          </Text>
          <TouchableOpacity style={tw`mt-4 bg-sky-600 px-4 py-2.5 rounded-xl`} onPress={loadEntries}>
            <Text style={tw`text-white font-black text-xs`}>↻ REFRESH FROM BACKEND</Text>
          </TouchableOpacity>
        </View>
      ) : (
        entries.map((item, idx) => (
          <View key={item.id || idx} style={tw`bg-slate-800 rounded-2xl p-4 mb-3 border border-white/10`}>
            <View style={tw`flex-row justify-between items-center mb-2.5`}>
              <Text style={tw`text-sky-400 text-base font-black`}>
                {item.vehicle_number || item.vehicleNumber || "UNASSIGNED"}
              </Text>
              <View style={tw`bg-emerald-500/15 border border-emerald-500/40 px-2 py-1 rounded-lg`}>
                <Text style={tw`text-emerald-400 text-[10px] font-black`}>
                  {item.status || "INSIDE_FACILITY"}
                </Text>
              </View>
            </View>

            <View style={tw`gap-1`}>
              <Text style={tw`text-white text-xs font-semibold`}>
                <Text style={tw`text-slate-400`}>PO: </Text>
                {item.po_number || item.poNumber || "N/A"}
              </Text>

              <Text style={tw`text-white text-xs font-semibold`}>
                <Text style={tw`text-slate-400`}>Supplier: </Text>
                {item.supplier_name || item.supplierName || "N/A"}
              </Text>

              <Text style={tw`text-white text-xs font-semibold`}>
                <Text style={tw`text-slate-400`}>Driver: </Text>
                {item.driver_name || "N/A"}{" "}
                {item.driver_contact ? `• ${item.driver_contact}` : ""}
              </Text>

              {item.dock_number ? (
                <Text style={tw`text-emerald-400 text-xs font-bold mt-0.5`}>
                  📍 Dock: {item.dock_number}
                </Text>
              ) : null}

              <Text style={tw`text-slate-500 text-[10px] mt-1`}>
                {item.created_at ? new Date(item.created_at).toLocaleString("en-IN") : ""}
              </Text>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}
