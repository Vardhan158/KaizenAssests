import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import tw from "twrnc";
import { mobileApi } from "../services/api";

const activeStatuses = new Set(["READY", "IN_PROGRESS", "ON_HOLD", "MATERIAL_SHORTAGE"]);

export function AssemblyScreen() {
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({});
  const [selected, setSelected] = useState<any | null>(null);
  const [quantity, setQuantity] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [dashboard, orderList] = await Promise.all([mobileApi.getAssemblyDashboard(), mobileApi.getAssemblyOrders()]);
      setStats(dashboard?.stats || {});
      setOrders(orderList);
    } catch (error) {
      Alert.alert("Assembly unavailable", error instanceof Error ? error.message : "Unable to load production work orders.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openOrder = async (order: any) => {
    setSelected(order);
    setQuantity(String(order.completed_quantity || 0));
    try {
      const operations = await mobileApi.getAssemblyOperations(order.id);
      setSelected((current) => current?.id === order.id ? { ...current, production_operations: operations } : current);
    } catch {
      // Legacy orders continue to render their preserved JSON step history.
    }
  };

  const perform = async (task: () => Promise<any>) => {
    if (!selected) return;
    setSaving(true);
    try {
      await task();
      const updated = await mobileApi.getAssemblyOrder(selected.id);
      const operations = await mobileApi.getAssemblyOperations(selected.id);
      setSelected({ ...updated, production_operations: operations });
      setOrders((previous) => previous.map((order) => order.id === updated.id ? updated : order));
      await load();
    } catch (error) {
      Alert.alert("Action not saved", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const statusStyle = (status: string) => {
    if (status === "IN_PROGRESS") return "bg-sky-500/15 border-sky-500/40 text-sky-300";
    if (status === "READY") return "bg-emerald-500/15 border-emerald-500/40 text-emerald-300";
    if (status === "ON_HOLD" || status === "MATERIAL_SHORTAGE") return "bg-amber-500/15 border-amber-500/40 text-amber-300";
    return "bg-slate-700 border-slate-600 text-slate-300";
  };

  const active = orders.filter((order) => activeStatuses.has(String(order.status || "").toUpperCase()));
  return (
    <ScrollView style={tw`flex-1 bg-slate-900`} contentContainerStyle={tw`p-4 pb-8`}>
      <View style={tw`flex-row items-center justify-between mb-4`}>
        <View>
          <Text style={tw`text-white text-xl font-black`}>ASSEMBLY FLOOR</Text>
          <Text style={tw`text-sky-400 text-xs font-bold mt-0.5`}>Live work orders and WIP updates</Text>
        </View>
        <TouchableOpacity style={tw`bg-sky-600 px-3 py-2 rounded-xl`} onPress={() => void load()}>
          <Text style={tw`text-white text-xs font-black`}>REFRESH</Text>
        </TouchableOpacity>
      </View>

      <View style={tw`flex-row gap-2 mb-5`}>
        <Metric value={stats.ready ?? 0} label="READY" tone="text-emerald-400" />
        <Metric value={stats.in_progress ?? 0} label="IN PROGRESS" tone="text-sky-400" />
        <Metric value={stats.today_output ?? 0} label="TODAY OUTPUT" tone="text-violet-400" />
      </View>

      <Text style={tw`text-slate-400 text-xs font-black tracking-wider mb-2 uppercase`}>My production queue ({active.length})</Text>
      {loading ? <ActivityIndicator color="#38bdf8" style={tw`my-10`} /> : active.length === 0 ? (
        <View style={tw`bg-slate-800 border border-slate-700 rounded-2xl p-7 items-center`}>
          <Text style={tw`text-white font-bold`}>No active production work</Text>
          <Text style={tw`text-slate-400 text-xs mt-1 text-center`}>Issued material orders will appear here when they are ready for assembly.</Text>
        </View>
      ) : active.map((order) => {
        const target = Number(order.planned_quantity || 0);
        const completed = Number(order.completed_quantity || 0);
        const percent = target ? Math.min(100, Math.round((completed / target) * 100)) : 0;
        return <TouchableOpacity key={order.id} activeOpacity={0.85} onPress={() => void openOrder(order)} style={tw`bg-slate-800 border border-slate-700 rounded-2xl p-4 mb-3`}>
          <View style={tw`flex-row justify-between items-start`}>
            <View style={tw`flex-1 mr-2`}><Text style={tw`text-sky-400 text-xs font-black`}>{order.order_number}</Text><Text style={tw`text-white text-base font-black mt-1`}>{order.product_name}</Text></View>
            <View style={tw`border px-2 py-1 rounded-lg ${statusStyle(order.status)}`}><Text style={tw`text-[9px] font-black`}>{String(order.status).replaceAll("_", " ")}</Text></View>
          </View>
          <View style={tw`mt-4`}><View style={tw`h-2 bg-slate-700 rounded-full overflow-hidden`}><View style={[tw`h-2 bg-sky-500 rounded-full`, { width: `${percent}%` }]} /></View><View style={tw`flex-row justify-between mt-1.5`}><Text style={tw`text-slate-400 text-[10px]`}>{completed} / {target} units completed</Text><Text style={tw`text-sky-400 text-[10px] font-black`}>{percent}%</Text></View></View>
        </TouchableOpacity>;
      })}

      <Modal visible={!!selected} animationType="slide" onRequestClose={() => setSelected(null)}>
        <ScrollView style={tw`flex-1 bg-slate-900`} contentContainerStyle={tw`p-5 pb-10`}>
          {selected && <><View style={tw`flex-row justify-between items-start mb-5`}><View style={tw`flex-1`}><Text style={tw`text-sky-400 text-xs font-black`}>{selected.order_number}</Text><Text style={tw`text-white text-xl font-black mt-1`}>{selected.product_name}</Text></View><TouchableOpacity onPress={() => setSelected(null)}><Text style={tw`text-red-400 font-black text-xs`}>CLOSE</Text></TouchableOpacity></View>
          <Text style={tw`text-slate-400 text-xs font-black uppercase mb-2`}>WIP output</Text><View style={tw`flex-row gap-2 mb-5`}><TextInput keyboardType="decimal-pad" value={quantity} onChangeText={setQuantity} style={tw`flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-3 text-white`} placeholderTextColor="#64748b" placeholder="Completed quantity" /><TouchableOpacity disabled={saving} onPress={() => void perform(() => mobileApi.updateAssemblyProgress(selected.id, Number(quantity)))} style={tw`bg-sky-600 rounded-xl px-4 justify-center`}><Text style={tw`text-white text-xs font-black`}>SAVE</Text></TouchableOpacity></View>
          {selected.status === "READY" && <Action label="START ASSEMBLY" saving={saving} onPress={() => perform(() => mobileApi.updateAssemblyOrderStatus(selected.id, "IN_PROGRESS"))} />}
          {selected.status === "ON_HOLD" && <Action label="RESUME ASSEMBLY" saving={saving} onPress={() => perform(() => mobileApi.updateAssemblyOrderStatus(selected.id, "IN_PROGRESS"))} />}
          {selected.status === "IN_PROGRESS" && <Action label="PLACE ON HOLD" saving={saving} subtle onPress={() => perform(() => mobileApi.updateAssemblyOrderStatus(selected.id, "ON_HOLD"))} />}
          <Text style={tw`text-slate-400 text-xs font-black uppercase mt-5 mb-2`}>Routing steps</Text>
          {(selected.production_operations || selected.assembly_steps || []).map((step: any) => { const pending = step.status === "PENDING" || step.status === "NOT_STARTED"; return <View key={step.id} style={tw`bg-slate-800 border border-slate-700 rounded-xl p-3 mb-2`}><View style={tw`flex-row justify-between items-center`}><View style={tw`flex-1 mr-2`}><Text style={tw`text-white text-sm font-bold`}>{step.sequence}. {step.operation_name || step.name}</Text><Text style={tw`text-slate-400 text-[10px] mt-1`}>{String(step.status || "NOT_STARTED").replaceAll("_", " ")}</Text></View>{pending ? <SmallAction label="START" disabled={saving || selected.status !== "IN_PROGRESS"} onPress={() => perform(() => mobileApi.updateAssemblyStep(selected.id, String(step.id), "IN_PROGRESS"))} /> : step.status === "IN_PROGRESS" ? <SmallAction label="COMPLETE" disabled={saving} onPress={() => perform(() => mobileApi.updateAssemblyStep(selected.id, String(step.id), "COMPLETED"))} /> : <Text style={tw`text-emerald-400 text-xs font-black`}>DONE</Text>}</View></View>; })}
          </>}
        </ScrollView>
      </Modal>
    </ScrollView>
  );
}

function Metric({ value, label, tone }: { value: number; label: string; tone: string }) { return <View style={tw`flex-1 bg-slate-800 border border-slate-700 rounded-xl p-3`}><Text style={tw`${tone} text-xl font-black`}>{value}</Text><Text style={tw`text-slate-400 text-[9px] font-black mt-1`}>{label}</Text></View>; }
function Action({ label, onPress, saving, subtle = false }: { label: string; onPress: () => void; saving: boolean; subtle?: boolean }) { return <TouchableOpacity disabled={saving} onPress={onPress} style={tw`${subtle ? "bg-slate-700 border border-slate-600" : "bg-sky-600"} rounded-xl py-3 items-center mb-2`}><Text style={tw`text-white text-xs font-black`}>{saving ? "SAVING..." : label}</Text></TouchableOpacity>; }
function SmallAction({ label, onPress, disabled }: { label: string; onPress: () => void; disabled: boolean }) { return <TouchableOpacity disabled={disabled} onPress={onPress} style={tw`${disabled ? "bg-slate-700" : "bg-sky-600"} rounded-lg px-2.5 py-2`}><Text style={tw`text-white text-[10px] font-black`}>{label}</Text></TouchableOpacity>; }
