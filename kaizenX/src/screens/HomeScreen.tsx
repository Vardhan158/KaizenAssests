import React, { useState, useEffect } from 'react';
import {
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  TextInput,
  Modal,
  Image,
} from 'react-native';
import tw from 'twrnc';
import { mobileApi } from '../services/api';

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
  const [notifications, setNotifications] = useState<any[]>([]);
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);
  const [stats, setStats] = useState({
    expectedToday: 0,
    waitingAtGate: 0,
    insideFacility: 0,
    exitedToday: 0,
  });
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadDashboardData();
  }, []);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 18) return 'Good Afternoon';
    return 'Good Evening';
  };

  const getFormattedDate = () => {
    const d = new Date();
    const day = String(d.getDate()).padStart(2, '0');
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    const month = months[d.getMonth()];
    const year = d.getFullYear();
    return `${day} ${month} ${year}`;
  };

  const loadDashboardData = async () => {
    setLoading(true);
    try {
      const [pos, asns, entries, notifs] = await Promise.all([
        mobileApi.getPurchaseOrders(),
        mobileApi.getAsns(),
        mobileApi.getGateEntries(),
        mobileApi.getNotifications(),
      ]);

      setNotifications(notifs || []);

      const inside = entries.filter(
        e =>
          e.status === 'INSIDE_FACILITY' ||
          e.status === 'APPROVED' ||
          e.status === 'PO_VERIFIED',
      );

      const waiting = entries.filter(
        e => e.status === 'PENDING' || e.status === 'WAITING',
      );

      const exited = entries.filter(
        e => e.status === 'VEHICLE_EXITED' || e.status === 'EXITED',
      );

      // Construct Expected Deliveries list from POs & ASNs & Entries
      const expectedList: any[] = [];

      pos.forEach((po: any, idx: number) => {
        expectedList.push({
          id: po.id || `exp-po-${idx}`,
          vehicle_number: po.vehicle_number || po.vehicleNumber || '',
          supplier_name: po.supplier_name || po.supplierName || '',
          asn_number: po.asn_number || po.asnNumber || '',
          po_number: po.po_number || po.poNumber || '',
          expected_time: po.expected_time || '',
          dock_number: po.dock_number || po.dockNumber || '',
          status: 'EXPECTED',
        });
      });

      asns.forEach((asn: any, idx: number) => {
        if (
          !expectedList.some(
            e => e.po_number === (asn.po_number || asn.poNumber),
          )
        ) {
          expectedList.push({
            id: asn.id || `exp-asn-${idx}`,
            vehicle_number: asn.vehicle_number || asn.vehicleNumber || '',
            supplier_name: asn.supplier_name || asn.supplierName || '',
            asn_number: asn.asn_number || asn.asnNumber || '',
            po_number: asn.po_number || asn.poNumber || '',
            expected_time: asn.expected_time || '',
            dock_number: asn.dock_number || '',
            status: 'EXPECTED',
          });
        }
      });

      setExpectedVehicles(expectedList);

      setStats({
        expectedToday: expectedList.length,
        waitingAtGate: waiting.length,
        insideFacility: inside.length,
        exitedToday: exited.length,
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

  const filteredVehicles = expectedVehicles.filter(item => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const veh = String(item.vehicle_number || '').toLowerCase();
    const po = String(item.po_number || '').toLowerCase();
    const asn = String(item.asn_number || '').toLowerCase();
    const sup = String(item.supplier_name || '').toLowerCase();
    return (
      veh.includes(q) || po.includes(q) || asn.includes(q) || sup.includes(q)
    );
  });

  const firstName = user?.full_name ? user.full_name.split(' ')[0] : 'Rajesh';

  return (
    <ScrollView
      style={tw`flex-1 bg-[#f7fbff]`}
      contentContainerStyle={tw`pb-10`}
    >
      {/* Header */}
      <View
        style={tw`bg-[#f7fbff] px-5 pt-5 pb-4 flex-row justify-between items-start`}
      >
        <View>
          <Text style={tw`text-slate-950 text-2xl font-black tracking-tight`}>
            {getGreeting()}, {firstName}
          </Text>
          <Text style={tw`text-slate-500 text-sm font-semibold mt-1`}>
            {user?.gate_location || 'Main Gate – 01'}
          </Text>
        </View>

        <View style={tw`items-end`}>
          <View style={tw`flex-row items-center gap-2 mb-1`}>
            <Text style={tw`text-slate-300 text-xs font-mono font-bold`}>
              {getFormattedDate()}
            </Text>

            {/* Notification Bell Icon */}
            <TouchableOpacity
              style={tw`bg-white p-1.5 rounded-xl border border-slate-200 relative`}
              onPress={() => setShowNotificationsModal(true)}
            >
              <Text style={tw`text-sky-400 text-xs`}>🔔</Text>
              {notifications.length > 0 ? (
                <View
                  style={tw`absolute -top-1 -right-1 w-3.5 h-3.5 bg-red-500 rounded-full items-center justify-center`}
                >
                  <Text style={tw`text-white text-[8px] font-black`}>
                    {notifications.length}
                  </Text>
                </View>
              ) : null}
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={tw`bg-white px-2.5 py-1 rounded-xl border border-slate-200`}
            onPress={loadDashboardData}
          >
            <Text style={tw`text-sky-400 text-[10px] font-bold`}>
              ↻ REFRESH
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={tw`h-52 rounded-b-3xl overflow-hidden relative mx-4`}>
        <Image
          source={require('../assests/home-gate-hero.png')}
          style={tw`w-full h-full`}
          resizeMode="cover"
        />
        <View style={tw`absolute left-5 bottom-5`}>
          <Text style={tw`text-white text-xl font-black`}>Secure Entry</Text>
          <Text style={tw`text-white text-sm font-bold mt-1`}>
            Safe Logistics. Smooth Operations.
          </Text>
        </View>
        <View style={tw`absolute right-5 bottom-5 flex-row gap-2`}>
          <View style={tw`w-4 h-4 rounded-full bg-cyan-400`} />
          <View style={tw`w-4 h-4 rounded-full bg-white/70`} />
          <View style={tw`w-4 h-4 rounded-full bg-white/70`} />
        </View>
      </View>

      {/* Primary CTA: + NEW GATE ENTRY */}
      <TouchableOpacity
        style={tw`bg-slate-950 rounded-3xl p-5 mx-5 mt-5 flex-row items-center justify-between mb-7 shadow-lg`}
        onPress={onNewEntry}
        activeOpacity={0.85}
      >
        <View style={tw`flex-row items-center gap-3`}>
          <View
            style={tw`w-11 h-11 rounded-full bg-white/20 items-center justify-center`}
          >
            <Text style={tw`text-white text-2xl font-black -mt-0.5`}>+</Text>
          </View>
          <View>
            <Text style={tw`text-white text-base font-black tracking-wide`}>
              NEW GATE ENTRY
            </Text>
            <Text style={tw`text-sky-200 text-xs font-medium mt-0.5`}>
              Scan PO / ASN or Register Vehicle
            </Text>
          </View>
        </View>
        <Text style={tw`text-white text-2xl font-black`}>→</Text>
      </TouchableOpacity>

      {/* Dashboard KPI Cards Grid */}
      <Text
        style={tw`text-slate-700 text-base font-black tracking-wide mb-3 mx-5`}
      >
        DASHBOARD OVERVIEW
      </Text>
      <View style={tw`flex-row flex-wrap gap-3 mb-6 mx-5`}>
        <View
          style={tw`flex-1 min-w-[45%] bg-white rounded-2xl p-4 border border-sky-100 shadow-sm`}
        >
          <Text style={tw`text-sky-500 text-4xl font-black`}>
            {stats.expectedToday}
          </Text>
          <Text
            style={tw`text-slate-400 text-[10px] font-bold tracking-wider mt-1`}
          >
            EXPECTED TODAY
          </Text>
        </View>

        <View
          style={tw`flex-1 min-w-[45%] bg-white rounded-2xl p-4 border border-amber-100 shadow-sm`}
        >
          <Text style={tw`text-orange-500 text-4xl font-black`}>
            {stats.waitingAtGate}
          </Text>
          <Text
            style={tw`text-slate-400 text-[10px] font-bold tracking-wider mt-1`}
          >
            WAITING AT GATE
          </Text>
        </View>

        <View
          style={tw`flex-1 min-w-[45%] bg-white rounded-2xl p-4 border border-emerald-100 shadow-sm`}
        >
          <Text style={tw`text-emerald-500 text-4xl font-black`}>
            {stats.insideFacility}
          </Text>
          <Text
            style={tw`text-slate-400 text-[10px] font-bold tracking-wider mt-1`}
          >
            INSIDE FACILITY
          </Text>
        </View>

        <View
          style={tw`flex-1 min-w-[45%] bg-white rounded-2xl p-4 border border-violet-100 shadow-sm`}
        >
          <Text style={tw`text-violet-600 text-4xl font-black`}>
            {stats.exitedToday}
          </Text>
          <Text
            style={tw`text-slate-400 text-[10px] font-bold tracking-wider mt-1`}
          >
            EXITED TODAY
          </Text>
        </View>
      </View>

      {false && (
        <>
          {/* Search Filter */}
          <View style={tw`mb-6 mx-5`}>
            <View
              style={tw`bg-white rounded-xl flex-row items-center px-3 border border-slate-200`}
            >
              <Text style={tw`text-sm mr-2`}>🔍</Text>
              <TextInput
                style={tw`flex-1 text-slate-900 text-xs py-2.5`}
                placeholder="Search expected vehicle, PO, ASN, or supplier..."
                placeholderTextColor="#64748b"
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
              {searchQuery ? (
                <TouchableOpacity onPress={() => setSearchQuery('')}>
                  <Text style={tw`text-slate-400 text-sm font-black p-1`}>
                    ✕
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

          {/* Expected Vehicles Section */}
          <View style={tw`flex-row justify-between items-center mb-2.5`}>
            <Text style={tw`text-slate-700 text-base font-black tracking-wide`}>
              EXPECTED VEHICLES ({filteredVehicles.length})
            </Text>
            <TouchableOpacity onPress={onViewVehicles}>
              <Text style={tw`text-sky-400 text-xs font-black`}>
                VIEW ALL →
              </Text>
            </TouchableOpacity>
          </View>

          {loading ? (
            <ActivityIndicator color="#0284c7" style={tw`my-5`} />
          ) : filteredVehicles.length === 0 ? (
            <View style={tw`bg-white rounded-3xl p-8 items-center shadow mx-5`}>
              <Text style={tw`text-6xl opacity-30`}>🚚</Text>
              <Text style={tw`text-slate-950 text-lg font-black mt-4`}>
                No expected vehicles
              </Text>
              <Text style={tw`text-slate-400 text-xs mt-1`}>
                Tap "+ NEW GATE ENTRY" to process unscheduled arrival
              </Text>
            </View>
          ) : (
            filteredVehicles.map((item, idx) => (
              <View
                key={item.id || idx}
                style={tw`bg-slate-800 rounded-2xl p-4 mb-3 border border-white/10 shadow-md`}
              >
                {/* Top Row: Vehicle Number & Status Badge */}
                <View style={tw`flex-row justify-between items-center mb-2`}>
                  <Text
                    style={tw`text-sky-400 text-base font-black tracking-wide`}
                  >
                    {item.vehicle_number}
                  </Text>
                  <View
                    style={tw`bg-sky-500/15 border border-sky-500/40 px-2 py-0.5 rounded-lg`}
                  >
                    <Text style={tw`text-sky-400 text-[10px] font-black`}>
                      {item.status}
                    </Text>
                  </View>
                </View>

                {/* Details Grid */}
                <View style={tw`gap-1 mb-3`}>
                  <Text style={tw`text-white text-xs font-semibold`}>
                    <Text style={tw`text-slate-400`}>Supplier: </Text>
                    {item.supplier_name}
                  </Text>

                  <View
                    style={tw`flex-row justify-between items-center mt-0.5`}
                  >
                    <Text style={tw`text-white text-xs font-semibold`}>
                      <Text style={tw`text-slate-400`}>ASN: </Text>
                      {item.asn_number}
                    </Text>

                    <Text style={tw`text-white text-xs font-semibold`}>
                      <Text style={tw`text-slate-400`}>PO: </Text>
                      {item.po_number}
                    </Text>
                  </View>

                  <View
                    style={tw`flex-row justify-between items-center mt-0.5 pt-1 border-t border-slate-700/60`}
                  >
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
                  onPress={() =>
                    onStartEntry(
                      item.po_number || item.asn_number || item.vehicle_number,
                    )
                  }
                >
                  <Text
                    style={tw`text-white font-black text-xs tracking-wider`}
                  >
                    [Start Entry]
                  </Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </>
      )}

      {/* Section 25 - Push / In-App Notifications Modal */}
      <Modal visible={showNotificationsModal} animationType="slide" transparent>
        <View style={tw`flex-1 bg-black/80 justify-end`}>
          <View
            style={tw`bg-slate-800 rounded-t-3xl p-5 max-h-[80%] border-t border-sky-500/50 shadow-2xl`}
          >
            <View
              style={tw`flex-row justify-between items-center mb-3 pb-3 border-b border-slate-700`}
            >
              <View style={tw`flex-row items-center gap-2`}>
                <Text style={tw`text-sky-400 text-sm font-black`}>
                  🔔 GATE PUSH NOTIFICATIONS (SECTION 25)
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowNotificationsModal(false)}
              >
                <Text style={tw`text-red-400 text-xs font-bold`}>✕ CLOSE</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={tw`mb-3`}>
              {notifications.map((notif, idx) => (
                <View
                  key={notif.id || idx}
                  style={tw`bg-slate-900 rounded-2xl p-3.5 mb-2.5 border border-slate-700`}
                >
                  <View style={tw`flex-row justify-between items-center mb-1`}>
                    <Text style={tw`text-sky-400 text-xs font-black`}>
                      {notif.type === 'DOCK_ASSIGNED'
                        ? '📍 DOCK ASSIGNED'
                        : notif.type === 'DOCK_CHANGED'
                        ? '🔄 DOCK CHANGED'
                        : notif.type === 'SUPERVISOR_APPROVED'
                        ? '✓ ENTRY APPROVED BY SUPERVISOR'
                        : '🚛 VEHICLE READY FOR EXIT'}
                    </Text>
                    <Text style={tw`text-slate-500 text-[10px]`}>
                      {notif.time}
                    </Text>
                  </View>
                  <Text style={tw`text-white text-xs font-semibold mt-0.5`}>
                    {notif.message}
                  </Text>
                </View>
              ))}
            </ScrollView>

            <TouchableOpacity
              style={tw`bg-sky-600 py-3 rounded-xl items-center`}
              onPress={() => setShowNotificationsModal(false)}
            >
              <Text style={tw`text-white text-xs font-black`}>
                ACKNOWLEDGE & DISMISS
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}
