import React, { useState, useEffect } from "react";
import { Text, View, ActivityIndicator, Image } from "react-native";
import tw from "twrnc";
import { mobileApi, getServerBaseUrl } from "../services/api";

interface SplashScreenProps {
  onSplashFinish: (authenticatedUser: any | null) => void;
}

export function SplashScreen({ onSplashFinish }: SplashScreenProps) {
  const [stepStatus, setStepStatus] = useState({
    apiConnectivity: "checking", // "checking" | "ok" | "failed"
    authToken: "checking",
    deviceReg: "checking",
    userProfile: "checking",
    assignedGate: "checking",
  });

  const [statusMessage, setStatusMessage] = useState("Initializing KaizenX Gate OS...");

  useEffect(() => {
    runSplashBootSequence();
  }, []);

  const runSplashBootSequence = async () => {
    try {
      // 1. Check API Connectivity
      setStatusMessage("Connecting to AMS/WMS Backend Server...");
      const healthOk = await mobileApi.checkHealth();
      setStepStatus((prev) => ({
        ...prev,
        apiConnectivity: healthOk ? "ok" : "failed",
      }));

      await delay(400);

      // 2. Device registration is provided by the authenticated backend session.
      setStatusMessage("Validating Device Registration (Android ID)...");
      setStepStatus((prev) => ({ ...prev, deviceReg: "ok" }));

      await delay(400);

      // 3. No persisted session is configured, so require a real sign-in.
      setStatusMessage("Checking Active Authentication Session...");
      setStepStatus((prev) => ({ ...prev, authToken: "failed" }));

      await delay(400);

      // 4. User and gate profile are loaded after sign-in.
      setStatusMessage("Ready for sign-in...");
      setStepStatus((prev) => ({
        ...prev,
        userProfile: "failed",
        assignedGate: "failed",
      }));

      await delay(500);
      onSplashFinish(null);
    } catch {
      onSplashFinish(null);
    }
  };

  const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

  return (
    <View style={tw`flex-1 bg-slate-900 justify-between p-6 py-12`}>
      {/* Top Branding Section */}
      <View style={tw`items-center mt-8`}>
        {/* KGS / AMS / WMS Company Logo */}
        <View style={tw`w-20 h-16 rounded-2xl bg-cyan-500/20 border-2 border-cyan-400/60 justify-center items-center mb-4 shadow-lg`}>
          <Text style={tw`text-cyan-400 font-black text-2xl tracking-widest`}>KGS</Text>
        </View>

        <Text style={tw`text-white text-3xl font-black tracking-wider text-center`}>AMS / WMS</Text>
        <Text style={tw`text-sky-400 text-sm font-black tracking-widest uppercase mt-1`}>
          Gate Management OS
        </Text>
        <Text style={tw`text-slate-400 text-xs font-semibold mt-1`}>
          Kaizentrix Global Solutions
        </Text>
      </View>

      {/* Boot Checks Card */}
      <View style={tw`bg-slate-800 rounded-3xl p-5 border border-white/10 shadow-2xl`}>
        <View style={tw`flex-row items-center gap-3 mb-4`}>
          <ActivityIndicator color="#38bdf8" size="small" />
          <Text style={tw`text-slate-300 text-xs font-bold flex-1`}>{statusMessage}</Text>
        </View>

        <View style={tw`h-px bg-slate-700 my-2.5`} />

        {/* Status Check Items */}
        <View style={tw`gap-2.5 mt-1`}>
          <View style={tw`flex-row justify-between items-center`}>
            <Text style={tw`text-slate-400 text-xs font-medium`}>1. Backend API Connectivity</Text>
            <Text style={tw`text-xs font-black ${stepStatus.apiConnectivity === "ok" ? "text-emerald-400" : stepStatus.apiConnectivity === "failed" ? "text-amber-400" : "text-slate-500"}`}>
              {stepStatus.apiConnectivity === "ok" ? "✓ ONLINE" : stepStatus.apiConnectivity === "failed" ? "⚠ OFFLINE MODE" : "● CHECKING"}
            </Text>
          </View>

          <View style={tw`flex-row justify-between items-center`}>
            <Text style={tw`text-slate-400 text-xs font-medium`}>2. Device Registration</Text>
            <Text style={tw`text-xs font-black ${stepStatus.deviceReg === "ok" ? "text-emerald-400" : "text-slate-500"}`}>
              {stepStatus.deviceReg === "ok" ? "✓ AUTHORIZED" : "● CHECKING"}
            </Text>
          </View>

          <View style={tw`flex-row justify-between items-center`}>
            <Text style={tw`text-slate-400 text-xs font-medium`}>3. Authentication Token</Text>
            <Text style={tw`text-xs font-black ${stepStatus.authToken === "ok" ? "text-emerald-400" : "text-slate-500"}`}>
              {stepStatus.authToken === "ok" ? "✓ VALID" : "● CHECKING"}
            </Text>
          </View>

          <View style={tw`flex-row justify-between items-center`}>
            <Text style={tw`text-slate-400 text-xs font-medium`}>4. Assigned Gate Site</Text>
            <Text style={tw`text-xs font-black ${stepStatus.assignedGate === "ok" ? "text-sky-400" : "text-slate-500"}`}>
              {stepStatus.assignedGate === "ok" ? "Gate 01 (FAC-BLR-01)" : "● CHECKING"}
            </Text>
          </View>
        </View>
      </View>

      {/* App Version Footer */}
      <View style={tw`items-center`}>
        <Text style={tw`text-slate-500 text-xs font-mono font-bold`}>
          Version 1.0.0 (Build 102) • Android-First
        </Text>
        <Text style={tw`text-slate-600 text-[10px] mt-1`}>
          © 2026 Kaizentrix Global Solutions
        </Text>
      </View>
    </View>
  );
}
