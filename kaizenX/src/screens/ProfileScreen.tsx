import React, { useState, useEffect } from "react";
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
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
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.headerTitle}>GATE OFFICER PROFILE</Text>

      {/* User Info Card */}
      <View style={styles.card}>
        <View style={styles.avatarCircle}>
          <Text style={styles.avatarText}>
            {user?.full_name ? user.full_name.charAt(0).toUpperCase() : "G"}
          </Text>
        </View>

        <Text style={styles.userName}>{user?.full_name || "Security Officer"}</Text>
        <Text style={styles.userRole}>{user?.roles?.[0] || "GATE_SECURITY"}</Text>

        <View style={styles.divider} />

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Username</Text>
          <Text style={styles.infoVal}>{user?.username || "gate_security"}</Text>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Gate Location</Text>
          <Text style={styles.infoVal}>Gate 01 (Main Gate)</Text>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Facility Code</Text>
          <Text style={styles.infoVal}>FAC-BLR-01</Text>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Shift Time</Text>
          <Text style={styles.infoVal}>06:00 AM - 02:00 PM</Text>
        </View>
      </View>

      {/* Server & Connectivity Settings */}
      <Text style={styles.sectionHeading}>BACKEND API CONFIGURATION</Text>
      <View style={styles.card}>
        <Text style={styles.inputLabel}>FastAPI Server Address</Text>
        <TextInput
          style={styles.urlInput}
          value={serverUrl}
          onChangeText={setServerUrlText}
          placeholder="http://192.168.1.175:8000"
          placeholderTextColor="#64748b"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <View style={styles.healthRow}>
          <Text style={styles.healthLabel}>Backend Server Health:</Text>
          {checkingHealth ? (
            <ActivityIndicator size="small" color="#0284c7" />
          ) : isOnline ? (
            <View style={styles.onlineTag}>
              <Text style={styles.onlineTagText}>● ONLINE (PORT 8000)</Text>
            </View>
          ) : (
            <View style={styles.offlineTag}>
              <Text style={styles.offlineTagText}>● UNREACHABLE / OFFLINE</Text>
            </View>
          )}
        </View>

        <View style={styles.btnRow}>
          <TouchableOpacity style={styles.testBtn} onPress={checkConnection}>
            <Text style={styles.testBtnText}>TEST CONNECTION</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.saveBtn} onPress={handleSaveServerUrl}>
            <Text style={styles.saveBtnText}>SAVE URL</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Logout Action */}
      <TouchableOpacity style={styles.logoutBtn} onPress={onLogout}>
        <Text style={styles.logoutBtnText}>LOGOUT SECURITY SESSION</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f172a",
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  headerTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 1,
    marginBottom: 16,
  },
  card: {
    backgroundColor: "#1e293b",
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  avatarCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#0284c7",
    justifyContent: "center",
    alignItems: "center",
    alignSelf: "center",
    marginBottom: 10,
  },
  avatarText: {
    color: "#ffffff",
    fontSize: 24,
    fontWeight: "900",
  },
  userName: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "800",
    textAlign: "center",
  },
  userRole: {
    color: "#38bdf8",
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: "#334155",
    marginVertical: 16,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  infoLabel: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "600",
  },
  infoVal: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "800",
  },
  sectionHeading: {
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
    marginBottom: 10,
  },
  inputLabel: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 6,
  },
  urlInput: {
    backgroundColor: "#0f172a",
    borderRadius: 10,
    color: "#38bdf8",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#334155",
    fontFamily: "monospace",
    fontSize: 13,
  },
  healthRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 12,
    marginBottom: 16,
  },
  healthLabel: {
    color: "#94a3b8",
    fontSize: 12,
  },
  onlineTag: {
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  onlineTagText: {
    color: "#34d399",
    fontSize: 10,
    fontWeight: "900",
  },
  offlineTag: {
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  offlineTagText: {
    color: "#f87171",
    fontSize: 10,
    fontWeight: "900",
  },
  btnRow: {
    flexDirection: "row",
    gap: 10,
  },
  testBtn: {
    flex: 1,
    backgroundColor: "#0f172a",
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#334155",
  },
  testBtnText: {
    color: "#38bdf8",
    fontSize: 11,
    fontWeight: "800",
  },
  saveBtn: {
    flex: 1,
    backgroundColor: "#0284c7",
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  saveBtnText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "900",
  },
  logoutBtn: {
    backgroundColor: "#7f1d1d",
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#ef4444",
  },
  logoutBtnText: {
    color: "#fca5a5",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
  },
});
