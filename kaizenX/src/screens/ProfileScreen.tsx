import React, { useState, useEffect } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import tw from "twrnc";
import { getServerBaseUrl, setServerBaseUrl, mobileApi } from "../services/api";

interface ProfileScreenProps {
  user: any;
  onLogout: () => void;
}

export function ProfileScreen({ user, onLogout }: ProfileScreenProps) {
  const [serverUrl, setServerUrlText] = useState(getServerBaseUrl());
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [isOnline, setIsOnline] = useState<boolean | null>(null);

  useEffect(() => {
    checkConnection();
  }, []);

  const checkConnection = async () => {
    setCheckingHealth(true);
    const health = await mobileApi.checkHealth();
    setIsOnline(health);
    setCheckingHealth(false);
  };

  const handleSaveServerUrl = () => {
    if (!serverUrl.trim()) {
      Alert.alert("Invalid URL", "Please enter a valid backend server IP or URL.");
      return;
    }
    setServerBaseUrl(serverUrl.trim());
    Alert.alert("Server URL Updated", `Configured backend target: ${serverUrl.trim()}`);
    checkConnection();
  };

  return (
    <ScrollView style={tw`flex-1 bg-slate-900`} contentContainerStyle={tw`p-4 pb-10`}>
      <Text style={tw`text-white text-lg font-black tracking-wider mb-4`}>SECURITY OFFICER PROFILE</Text>

      {/* User Info & Assignment Card */}
      <View style={tw`bg-slate-800 rounded-2xl p-5 mb-5 border border-white/10 shadow-xl`}>
        <View style={tw`w-16 h-16 rounded-full bg-sky-600 justify-center items-center self-center mb-2.5`}>
          <Text style={tw`text-white text-2xl font-black`}>
            {user?.full_name ? user.full_name.charAt(0).toUpperCase() : "R"}
          </Text>
        </View>

        <Text style={tw`text-white text-lg font-black text-center`}>
          {user?.full_name || "Rajesh Kumar"}
        </Text>
        <Text style={tw`text-sky-400 text-xs font-bold text-center mt-0.5`}>
          {user?.role || "Security Officer"}
        </Text>

        <View style={tw`h-px bg-slate-700 my-4`} />

        {/* Assigned Officer Parameters */}
        <Text style={tw`text-slate-400 text-[10px] font-extrabold tracking-wider uppercase mb-3`}>
          ASSIGNED SITE & DUTY METADATA
        </Text>

        <View style={tw`flex-row justify-between items-center mb-2.5`}>
          <Text style={tw`text-slate-400 text-xs font-semibold`}>Company</Text>
          <Text style={tw`text-white text-xs font-bold`}>
            {user?.company || "Kaizentrix Global Manufacturing Ltd"}
          </Text>
        </View>

        <View style={tw`flex-row justify-between items-center mb-2.5`}>
          <Text style={tw`text-slate-400 text-xs font-semibold`}>Site / Facility</Text>
          <Text style={tw`text-white text-xs font-bold`}>
            {user?.site || "Bengaluru Manufacturing Plant"}
          </Text>
        </View>

        <View style={tw`flex-row justify-between items-center mb-2.5`}>
          <Text style={tw`text-slate-400 text-xs font-semibold`}>Warehouse</Text>
          <Text style={tw`text-white text-xs font-bold`}>
            {user?.warehouse || "Central Inbound Warehouse"}
          </Text>
        </View>

        <View style={tw`flex-row justify-between items-center mb-2.5`}>
          <Text style={tw`text-slate-400 text-xs font-semibold`}>Gate Assignment</Text>
          <Text style={tw`text-sky-400 text-xs font-black`}>
            {user?.gate_location || "Main Gate – 01"}
          </Text>
        </View>

        <View style={tw`flex-row justify-between items-center mb-2.5`}>
          <Text style={tw`text-slate-400 text-xs font-semibold`}>Active Shift</Text>
          <Text style={tw`text-emerald-400 text-xs font-bold`}>
            {user?.shift || "Morning Shift (06:00 AM - 02:00 PM)"}
          </Text>
        </View>

        <View style={tw`flex-row justify-between items-center mt-1`}>
          <Text style={tw`text-slate-400 text-xs font-semibold`}>Employee ID</Text>
          <Text style={tw`text-slate-300 text-xs font-mono font-bold`}>
            {user?.username || "EMP-8042"}
          </Text>
        </View>
      </View>

      {/* Section 30 - Security Officer Role Scope & Permissions */}
      <Text style={tw`text-slate-400 text-xs font-black tracking-wider mb-2.5 uppercase`}>
        ROLE PERMISSIONS SCOPE (SECTION 30)
      </Text>
      <View style={tw`bg-slate-800 rounded-2xl p-4 mb-5 border border-white/10 shadow-xl`}>
        <Text style={tw`text-emerald-400 text-xs font-black mb-2 uppercase`}>
          ✓ ALLOWED SECURITY ACTIONS
        </Text>
        <View style={tw`gap-1 mb-3 bg-slate-900 p-3 rounded-xl`}>
          <Text style={tw`text-slate-300 text-[11px]`}>• View expected vehicles & active inbound queue</Text>
          <Text style={tw`text-slate-300 text-[11px]`}>• Start Gate Entry & scan ASN/PO/Pass QR</Text>
          <Text style={tw`text-slate-300 text-[11px]`}>• Capture vehicle plate & driver details</Text>
          <Text style={tw`text-slate-300 text-[11px]`}>• Upload invoice, transport documents & photos</Text>
          <Text style={tw`text-slate-300 text-[11px]`}>• Verify 8-point document checklist & view assigned dock</Text>
          <Text style={tw`text-slate-300 text-[11px]`}>• Generate Gate Pass & confirm vehicle entrance</Text>
        </View>

        <Text style={tw`text-red-400 text-xs font-black mb-2 uppercase`}>
          🚫 RESTRICTED WMS / PROCUREMENT ACTIONS
        </Text>
        <View style={tw`gap-1 bg-slate-900 p-3 rounded-xl`}>
          <Text style={tw`text-slate-400 text-[11px]`}>× Create or modify PO / ASN commercial information</Text>
          <Text style={tw`text-slate-400 text-[11px]`}>× Allocate or reassign warehouse docks</Text>
          <Text style={tw`text-slate-400 text-[11px]`}>× Perform quality inspection or generate GRN</Text>
          <Text style={tw`text-slate-400 text-[11px]`}>× Change inventory stock or assign rack/bin putaway</Text>
        </View>
      </View>

      {/* Server & Connectivity Settings */}
      <Text style={tw`text-slate-400 text-xs font-black tracking-wider mb-2.5 uppercase`}>
        BACKEND API CONFIGURATION
      </Text>
      <View style={tw`bg-slate-800 rounded-2xl p-5 mb-5 border border-white/10`}>
        <Text style={tw`text-slate-300 text-xs font-bold mb-1.5`}>FastAPI Server Address</Text>
        <TextInput
          style={tw`bg-slate-900 rounded-xl text-sky-400 px-3 py-2.5 border border-slate-700 text-xs font-mono`}
          value={serverUrl}
          onChangeText={setServerUrlText}
          placeholder="http://192.168.1.175:8000"
          placeholderTextColor="#64748b"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <View style={tw`flex-row items-center justify-between my-3`}>
          <Text style={tw`text-slate-400 text-xs`}>Backend Connection:</Text>
          {checkingHealth ? (
            <ActivityIndicator size="small" color="#0284c7" />
          ) : isOnline ? (
            <View style={tw`bg-emerald-500/15 px-2 py-1 rounded`}>
              <Text style={tw`text-emerald-400 text-[10px] font-black`}>● ONLINE (PORT 8000)</Text>
            </View>
          ) : (
            <View style={tw`bg-red-500/15 px-2 py-1 rounded`}>
              <Text style={tw`text-red-400 text-[10px] font-black`}>● UNREACHABLE / OFFLINE</Text>
            </View>
          )}
        </View>

        <View style={tw`flex-row gap-2.5`}>
          <TouchableOpacity
            style={tw`flex-1 bg-slate-900 py-3 rounded-xl items-center border border-slate-700`}
            onPress={checkConnection}
          >
            <Text style={tw`text-sky-400 text-xs font-bold`}>TEST CONNECTION</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={tw`flex-1 bg-sky-600 py-3 rounded-xl items-center`}
            onPress={handleSaveServerUrl}
          >
            <Text style={tw`text-white text-xs font-black`}>SAVE URL</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Logout Action */}
      <TouchableOpacity
        style={tw`bg-red-950/60 border border-red-500/50 py-3.5 rounded-2xl items-center`}
        onPress={onLogout}
      >
        <Text style={tw`text-red-300 text-xs font-black tracking-wider`}>LOGOUT SECURITY SESSION</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}
