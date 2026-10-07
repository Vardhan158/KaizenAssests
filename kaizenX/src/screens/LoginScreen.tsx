import React, { useState } from "react";
import {
  StyleSheet,
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
import { mobileApi, getServerBaseUrl, setServerBaseUrl } from "../services/api";

interface LoginScreenProps {
  onLoginSuccess: (user: any) => void;
}

export function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const [username, setUsername] = useState("gate_security");
  const [password, setPassword] = useState("password123");
  const [serverIp, setServerIp] = useState(getServerBaseUrl());
  const [showConfig, setShowConfig] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      Alert.alert("Required", "Please enter Staff Username and Password.");
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
      // Fallback offline login for physical mobile phone testing
      onLoginSuccess({
        token: "mobile-gate-token",
        username: username.trim() || "gate_security",
        roles: ["GATE_SECURITY"],
        full_name: "Security Officer",
      });
    }
  };

  const handleOfflineQuickLogin = () => {
    onLoginSuccess({
      token: "mobile-gate-token-offline",
      username: "gate_security",
      roles: ["GATE_SECURITY"],
      full_name: "Security Officer (Mobile Offline)",
    });
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {/* Top Branding Banner */}
        <View style={styles.brandHeader}>
          <View style={styles.logoBadge}>
            <Text style={styles.logoText}>KGS</Text>
          </View>
          <Text style={styles.brandTitle}>KaizenX Mobile</Text>
          <Text style={styles.brandSubtitle}>Gate Entry & Scanner OS</Text>
        </View>

        {/* Card Form */}
        <View style={styles.card}>
          <Text style={styles.cardHeaderTitle}>Security Officer Login</Text>
          <Text style={styles.cardHeaderDesc}>
            Enter staff credentials to access gate entry scanning
          </Text>

          {/* Username Input */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>USERNAME</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. gate_security"
              placeholderTextColor="#94a3b8"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
            />
          </View>

          {/* Password Input */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>PASSWORD</Text>
            <TextInput
              style={styles.input}
              placeholder="••••••••"
              placeholderTextColor="#94a3b8"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
          </View>

          {/* Server Config Toggle */}
          <TouchableOpacity
            style={styles.configToggle}
            onPress={() => setShowConfig(!showConfig)}
          >
            <Text style={styles.configToggleText}>
              {showConfig ? "▲ Hide Server Settings" : "⚙ Server Settings (IP Config)"}
            </Text>
          </TouchableOpacity>

          {showConfig && (
            <View style={styles.configBox}>
              <Text style={styles.label}>BACKEND SERVER URL / IP</Text>
              <TextInput
                style={styles.input}
                placeholder="http://192.168.1.175:8000"
                placeholderTextColor="#94a3b8"
                value={serverIp}
                onChangeText={setServerIp}
                autoCapitalize="none"
              />
              <View style={styles.presetRow}>
                <TouchableOpacity
                  style={styles.presetBtn}
                  onPress={() => setServerIp("http://192.168.1.175:8000")}
                >
                  <Text style={styles.presetBtnText}>PC Wi-Fi (192.168.1.175)</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.presetBtn}
                  onPress={() => setServerIp("http://10.0.2.2:8000")}
                >
                  <Text style={styles.presetBtnText}>Emulator (10.0.2.2)</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Login Button */}
          <TouchableOpacity
            style={[styles.loginBtn, loading && styles.btnDisabled]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.loginBtnText}>LAUNCH GATE SCANNER →</Text>
            )}
          </TouchableOpacity>

          {/* Instant Local Offline Login Button */}
          <TouchableOpacity
            style={styles.offlineBtn}
            onPress={handleOfflineQuickLogin}
          >
            <Text style={styles.offlineBtnText}>⚡ OFFLINE / LOCAL TEST LOGIN</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.footerText}>© 2026 Kaizentrix Global Solutions • KaizenX Mobile</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f172a",
  },
  scrollContent: {
    padding: 24,
    justifyContent: "center",
    minHeight: "100%",
  },
  brandHeader: {
    alignItems: "center",
    marginBottom: 24,
  },
  logoBadge: {
    width: 64,
    height: 48,
    borderRadius: 16,
    backgroundColor: "rgba(6, 182, 212, 0.2)",
    borderWidth: 1.5,
    borderColor: "rgba(6, 182, 212, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },
  logoText: {
    color: "#38bdf8",
    fontWeight: "900",
    fontSize: 20,
    letterSpacing: 1.5,
  },
  brandTitle: {
    color: "#ffffff",
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: 1,
  },
  brandSubtitle: {
    color: "#06b6d4",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 2,
    marginTop: 2,
    textTransform: "uppercase",
  },
  card: {
    backgroundColor: "#1e293b",
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 8,
  },
  cardHeaderTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "800",
  },
  cardHeaderDesc: {
    color: "#94a3b8",
    fontSize: 12,
    marginBottom: 20,
    marginTop: 2,
  },
  fieldGroup: {
    marginBottom: 16,
  },
  label: {
    color: "#38bdf8",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
    marginBottom: 6,
  },
  input: {
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
  },
  configToggle: {
    marginVertical: 10,
  },
  configToggleText: {
    color: "#38bdf8",
    fontSize: 12,
    fontWeight: "700",
  },
  configBox: {
    backgroundColor: "#0f172a",
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#334155",
  },
  presetRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
  },
  presetBtn: {
    flex: 1,
    backgroundColor: "#1e293b",
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#334155",
    alignItems: "center",
  },
  presetBtnText: {
    color: "#38bdf8",
    fontSize: 10,
    fontWeight: "800",
  },
  loginBtn: {
    backgroundColor: "#0284c7",
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
    marginTop: 8,
    shadowColor: "#0284c7",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 4,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  loginBtnText: {
    color: "#ffffff",
    fontWeight: "900",
    fontSize: 14,
    letterSpacing: 1,
  },
  offlineBtn: {
    backgroundColor: "#10b981",
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: "center",
    marginTop: 10,
  },
  offlineBtnText: {
    color: "#ffffff",
    fontWeight: "900",
    fontSize: 12,
    letterSpacing: 1,
  },
  footerText: {
    color: "#475569",
    fontSize: 11,
    textAlign: "center",
    marginTop: 28,
  },
});
