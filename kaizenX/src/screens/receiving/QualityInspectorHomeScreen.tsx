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
import { mobileApi } from "../../services/api";

interface QualityInspectorHomeScreenProps {
  onStartInspection: (qcAssignment: any) => void;
  user?: any;
}

export function QualityInspectorHomeScreen({
  onStartInspection,
  user,
}: QualityInspectorHomeScreenProps) {
  const [loading, setLoading] = useState(true);
  const [qcAssignments, setQcAssignments] = useState<any[]>([]);
  const [stats, setStats] = useState({
    pendingInspection: 5,
    inProgress: 2,
    completedToday: 11,
    onHold: 1,
  });
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    loadQcAssignments();
  }, []);

  const loadQcAssignments = async () => {
    setLoading(true);
    try {
      const entries = await mobileApi.getGateEntries();

      const mapped = entries.map((e: any, idx: number) => ({
        id: e.id || `qc-assign-${idx}`,
        dock_number: e.dock_number || e.assigned_dock_id || `D-04`,
        vehicle_number: e.vehicle_number || e.vehicle_plate || "KA 01 AB 4582",
        supplier_name: e.supplier_name || "Bharat Electronics Components Pvt. Ltd.",
        po_number: e.po_number || "PO-8741",
        asn_number: e.asn_reference || e.asn_number || "ASN-2026-004582",
        materials_count: 4,
        received_quantity: 495,
        status: "QC_PENDING",
      }));

      setQcAssignments(mapped.length > 0 ? mapped : [
        {
          id: "qc-assign-1",
          dock_number: "D-04",
          vehicle_number: "KA 01 AB 4582",
          supplier_name: "Bharat Electronics Components Pvt. Ltd.",
          po_number: "PO-8741",
          asn_number: "ASN-2026-004582",
          materials_count: 4,
          received_quantity: 495,
          status: "QC_PENDING",
        },
        {
          id: "qc-assign-2",
          dock_number: "D-01",
          vehicle_number: "KA 09 EF 5544",
          supplier_name: "Mysore Electricals Ltd",
          po_number: "PO-8790",
          asn_number: "ASN-2026-003310",
          materials_count: 1,
          received_quantity: 250,
          status: "QC_IN_PROGRESS",
        },
      ]);

      setStats({
        pendingInspection: 5,
        inProgress: 2,
        completedToday: 11,
        onHold: 1,
      });
    } catch {
      // fallback
    } finally {
      setLoading(false);
    }
  };

  const filteredAssignments = qcAssignments.filter((a) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      a.dock_number.toLowerCase().includes(q) ||
      a.vehicle_number.toLowerCase().includes(q) ||
      a.supplier_name.toLowerCase().includes(q) ||
      a.po_number.toLowerCase().includes(q)
    );
  });

  return (
    <ScrollView style={tw`flex-1 bg-slate-900`} contentContainerStyle={tw`p-4 pb-10`}>
      {/* Header */}
      <View style={tw`flex-row justify-between items-center mb-4`}>
        <View>
          <Text style={tw`text-white text-lg font-black tracking-wider`}>INCOMING QUALITY (SECTION 19)</Text>
          <Text style={tw`text-cyan-400 text-xs font-bold mt-0.5`}>
            Inspector: {user?.full_name || "Priya Sharma (QC Inspector)"}
          </Text>
        </View>

        <TouchableOpacity
          style={tw`bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700`}
          onPress={loadQcAssignments}
        >
          <Text style={tw`text-cyan-400 text-xs font-bold`}>↻ REFRESH</Text>
        </TouchableOpacity>
      </View>

      {/* Section 19 - KPI Dashboard */}
      <Text style={tw`text-slate-400 text-xs font-black tracking-wider mb-2.5 uppercase`}>
        QC DASHBOARD
      </Text>
      <View style={tw`flex-row flex-wrap gap-2.5 mb-5`}>
        <View style={tw`flex-1 min-w-[45%] bg-amber-950/40 rounded-xl p-3.5 border border-amber-500/30`}>
          <Text style={tw`text-amber-400 text-2xl font-black`}>{stats.pendingInspection}</Text>
          <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mt-1`}>PENDING INSPECTION</Text>
        </View>

        <View style={tw`flex-1 min-w-[45%] bg-sky-950/40 rounded-xl p-3.5 border border-sky-500/30`}>
          <Text style={tw`text-sky-400 text-2xl font-black`}>{stats.inProgress}</Text>
          <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mt-1`}>IN PROGRESS</Text>
        </View>

        <View style={tw`flex-1 min-w-[45%] bg-emerald-950/40 rounded-xl p-3.5 border border-emerald-500/30`}>
          <Text style={tw`text-emerald-400 text-2xl font-black`}>{stats.completedToday}</Text>
          <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mt-1`}>COMPLETED TODAY</Text>
        </View>

        <View style={tw`flex-1 min-w-[45%] bg-slate-800 rounded-xl p-3.5 border border-white/10`}>
          <Text style={tw`text-red-400 text-2xl font-black`}>{stats.onHold}</Text>
          <Text style={tw`text-slate-400 text-[10px] font-bold tracking-wider mt-1`}>ON HOLD</Text>
        </View>
      </View>

      {/* Search Bar */}
      <View style={tw`mb-4`}>
        <View style={tw`bg-slate-800 rounded-xl flex-row items-center px-3 border border-slate-700`}>
          <Text style={tw`text-sm mr-2`}>🔍</Text>
          <TextInput
            style={tw`flex-1 text-white text-xs py-2.5 font-semibold`}
            placeholder="Search Dock, Supplier, Vehicle, or PO..."
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

      {/* Section 19 - MY QC ASSIGNMENTS List */}
      <Text style={tw`text-slate-400 text-xs font-black tracking-wider mb-2.5 uppercase`}>
        AWAITING QUALITY INSPECTION ({filteredAssignments.length})
      </Text>

      {loading ? (
        <ActivityIndicator color="#06b6d4" style={tw`my-6`} />
      ) : filteredAssignments.length === 0 ? (
        <View style={tw`bg-slate-800 rounded-2xl p-6 items-center border border-slate-700`}>
          <Text style={tw`text-white text-sm font-bold`}>No pending QC assignments</Text>
          <Text style={tw`text-slate-400 text-xs mt-1`}>Unloaded receipts awaiting QC will appear here</Text>
        </View>
      ) : (
        filteredAssignments.map((card, idx) => (
          <View
            key={card.id || idx}
            style={tw`bg-slate-800 rounded-2xl p-4 mb-3 border border-white/10 shadow-xl`}
          >
            <View style={tw`flex-row justify-between items-center mb-2`}>
              <View style={tw`bg-cyan-600 px-3 py-1 rounded-lg`}>
                <Text style={tw`text-white font-black text-xs`}>
                  📍 DOCK {card.dock_number}
                </Text>
              </View>
              <View style={tw`bg-amber-500/20 border border-amber-500/40 px-2 py-0.5 rounded`}>
                <Text style={tw`text-amber-400 text-[10px] font-black`}>{card.status}</Text>
              </View>
            </View>

            <Text style={tw`text-white text-xs font-bold mb-1`} numberOfLines={1}>
              {card.supplier_name}
            </Text>

            <View style={tw`bg-slate-900 p-2.5 rounded-xl mb-3 border border-slate-700 gap-1`}>
              <View style={tw`flex-row justify-between`}>
                <Text style={tw`text-slate-400 text-[11px]`}>Vehicle Plate:</Text>
                <Text style={tw`text-sky-400 text-xs font-black`}>{card.vehicle_number}</Text>
              </View>
              <View style={tw`flex-row justify-between`}>
                <Text style={tw`text-slate-400 text-[11px]`}>Materials Count:</Text>
                <Text style={tw`text-white text-xs font-bold`}>{card.materials_count} Materials</Text>
              </View>
              <View style={tw`flex-row justify-between`}>
                <Text style={tw`text-slate-400 text-[11px]`}>Received Qty:</Text>
                <Text style={tw`text-emerald-400 text-xs font-black`}>{card.received_quantity} KG</Text>
              </View>
            </View>

            {/* Action CTA */}
            <TouchableOpacity
              style={tw`bg-cyan-600 py-3 rounded-xl items-center shadow`}
              onPress={() => onStartInspection(card)}
            >
              <Text style={tw`text-white font-black text-xs tracking-wider`}>[ START INSPECTION ] →</Text>
            </TouchableOpacity>
          </View>
        ))
      )}
    </ScrollView>
  );
}
