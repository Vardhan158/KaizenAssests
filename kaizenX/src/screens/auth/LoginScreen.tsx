import React, { useState } from "react";
import {
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import tw from "twrnc";
import { mobileApi, getServerBaseUrl, setServerBaseUrl } from "../../services/api";

interface LoginScreenProps {
  onLoginSuccess: (user: any) => void;
}

export function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [serverIp, setServerIp] = useState(getServerBaseUrl());
  const [showConfig, setShowConfig] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      Alert.alert("Required", "Please enter Employee ID / Username and Password.");
      return;
    }

    setLoading(true);
    setServerBaseUrl(serverIp);

    try {
      const user = await mobileApi.loginStaff(username.trim(), password.trim());
      setLoading(false);
      onLoginSuccess(user);
    } catch (e: any) {
      setLoading(false);
      Alert.alert("Login Failed", e?.message || "Invalid credentials or backend unreachable.");
    }
  };

  const handleForgotPassword = () => {
    Alert.alert(
      "Reset Security Password",
      "Please contact your Facility IT Administrator or Security Chief to reset your AMS/WMS Gate Officer credentials.\n\nSupport Desk: +91 (80) 4567-8900\nEmail: security-it@kaizentrix.com"
    );
  };

  const handleBiometricLogin = () => {
    Alert.alert(
      "Biometric Login",
      "Scanning fingerprint / face ID sensor...\n\nBiometric authentication will load your assigned gate session automatically once hardware sensor is verified."
    );
  };

  const handlePinLogin = () => {
    Alert.alert(
      "Security PIN Login",
      "Please enter your 4-digit Security Officer Quick Access PIN configured in Profile Settings."
    );
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={tw`flex-1 bg-slate-900`}
    >
      <ScrollView contentContainerStyle={tw`p-6 justify-center min-h-full`} keyboardShouldPersistTaps="handled">
        {/* Top Branding Banner */}
        <View style={tw`items-center mb-6`}>
          <View style={tw`w-16 h-12 rounded-2xl bg-cyan-500/20 border border-cyan-500/50 justify-center items-center mb-3`}>
            <Text style={tw`text-sky-400 font-black text-xl tracking-wider`}>KGS</Text>
          </View>
          <Text style={tw`text-white text-3xl font-black tracking-wide`}>KaizenX Mobile</Text>
          <Text style={tw`text-cyan-400 text-xs font-bold tracking-widest mt-0.5 uppercase`}>
            Operations Management OS
          </Text>
        </View>

        {/* Login Card Form */}
        <View style={tw`bg-slate-800 rounded-3xl p-5 border border-white/10 shadow-2xl`}>
          <Text style={tw`text-white text-lg font-black`}>Employee Login</Text>
          <Text style={tw`text-slate-400 text-xs mb-5 mt-0.5`}>
            Sign in to access the tools assigned to your role
          </Text>

          {/* Employee ID / Username Field */}
          <View style={tw`mb-4`}>
            <Text style={tw`text-sky-400 text-[10px] font-black tracking-wider mb-1.5`}>
              EMPLOYEE ID / USERNAME
            </Text>
            <TextInput
              style={tw`bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-3 text-white text-sm font-semibold`}
              placeholder="e.g. EMP-8042 or gate_security"
              placeholderTextColor="#94a3b8"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
            />
          </View>

          {/* Password Field */}
          <View style={tw`mb-2`}>
            <Text style={tw`text-sky-400 text-[10px] font-black tracking-wider mb-1.5`}>PASSWORD</Text>
            <TextInput
              style={tw`bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-3 text-white text-sm font-semibold`}
              placeholder="••••••••"
              placeholderTextColor="#94a3b8"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
          </View>

          {/* Forgot Password Action */}
          <TouchableOpacity style={tw`align-self-end mb-4`} onPress={handleForgotPassword}>
            <Text style={tw`text-sky-400 text-xs font-bold text-right`}>Forgot Password?</Text>
          </TouchableOpacity>

          {/* Server Settings Toggle */}
          <TouchableOpacity style={tw`mb-3`} onPress={() => setShowConfig(!showConfig)}>
            <Text style={tw`text-slate-400 text-xs font-bold`}>
              {showConfig ? "▲ Hide Server Settings" : "⚙ Backend Server Config"}
            </Text>
          </TouchableOpacity>

          {showConfig && (
            <View style={tw`bg-slate-900 p-3 rounded-xl mb-4 border border-slate-700`}>
              <Text style={tw`text-sky-400 text-[10px] font-black tracking-wider mb-1`}>
                BACKEND SERVER URL
              </Text>
              <TextInput
                style={tw`bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs font-mono`}
                placeholder="http://192.168.1.175:8000"
                placeholderTextColor="#94a3b8"
                value={serverIp}
                onChangeText={setServerIp}
                autoCapitalize="none"
              />
            </View>
          )}

          {/* Main Login Button */}
          <TouchableOpacity
            style={tw`bg-sky-600 py-3.5 rounded-xl items-center shadow-lg ${
              loading ? "opacity-60" : ""
            }`}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={tw`text-white font-black text-xs tracking-wider`}>SIGN IN →</Text>
            )}
          </TouchableOpacity>

          {/* Optional Future Capabilities Section */}
          <View style={tw`mt-5 pt-4 border-t border-slate-700`}>
            <Text style={tw`text-slate-500 text-[10px] font-extrabold tracking-wider uppercase mb-2.5 text-center`}>
              QUICK SECURITY ACCESS OPTIONS
            </Text>
            <View style={tw`flex-row gap-2.5`}>
              <TouchableOpacity
                style={tw`flex-1 bg-slate-900 py-2.5 rounded-xl items-center border border-slate-700`}
                onPress={handlePinLogin}
              >
                <Text style={tw`text-sky-400 text-[11px] font-bold`}>🔢 PIN Login</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={tw`flex-1 bg-slate-900 py-2.5 rounded-xl items-center border border-slate-700`}
                onPress={handleBiometricLogin}
              >
                <Text style={tw`text-sky-400 text-[11px] font-bold`}>👆 Biometric</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <Text style={tw`text-slate-600 text-[11px] text-center mt-7`}>
          © 2026 Kaizentrix Global Solutions • KaizenX Mobile
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
