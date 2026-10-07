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
      <Text style={tw`text-white text-lg font-black tracking-wider mb-4`}>GATE OFFICER PROFILE</Text>

      {/* User Info Card */}
      <View style={tw`bg-slate-800 rounded-2xl p-5 mb-5 border border-white/10`}>
        <View style={tw`w-14 h-14 rounded-full bg-sky-600 justify-center items-center self-center mb-2.5`}>
          <Text style={tw`text-white text-2xl font-black`}>
            {user?.full_name ? user.full_name.charAt(0).toUpperCase() : "G"}
          </Text>
        </View>

        <Text style={tw`text-white text-base font-bold text-center`}>
          {user?.full_name || user?.username || "Security Officer"}
        </Text>
        <Text style={tw`text-sky-400 text-xs font-bold text-center mt-0.5`}>
          {user?.roles?.[0] || "GATE_SECURITY"}
        </Text>

        <View style={tw`h-px bg-slate-700 my-4`} />

        <View style={tw`flex-row justify-between mb-2.5`}>
          <Text style={tw`text-slate-400 text-xs font-semibold`}>Username</Text>
          <Text style={tw`text-white text-xs font-bold`}>{user?.username || "N/A"}</Text>
        </View>

        <View style={tw`flex-row justify-between mb-2.5`}>
          <Text style={tw`text-slate-400 text-xs font-semibold`}>Gate Location</Text>
          <Text style={tw`text-white text-xs font-bold`}>Main Gate 01</Text>
        </View>

        <View style={tw`flex-row justify-between`}>
          <Text style={tw`text-slate-400 text-xs font-semibold`}>Status</Text>
          <Text style={tw`text-emerald-400 text-xs font-bold`}>● ACTIVE DUTY</Text>
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
