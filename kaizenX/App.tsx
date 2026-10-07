/**
 * KaizenX Mobile - Gate Entry & Scanner Android Application
 * Kaizentrix Global Solutions
 */

import React, { useState } from "react";
import { StatusBar, StyleSheet, View, Text, TouchableOpacity } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { LoginScreen } from "./src/screens/LoginScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { GateEntryScannerScreen } from "./src/screens/GateEntryScannerScreen";
import { GateEntrySuccessScreen } from "./src/screens/GateEntrySuccessScreen";
import { RecentEntriesScreen } from "./src/screens/RecentEntriesScreen";
import { ProfileScreen } from "./src/screens/ProfileScreen";

export type TabType = "HOME" | "SCAN" | "VEHICLES" | "PROFILE";

export default function App() {
  const [user, setUser] = useState<any | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>("HOME");
  const [currentScreenOverride, setCurrentScreenOverride] = useState<"success" | null>(null);
  const [lastEntryResult, setLastEntryResult] = useState<any | null>(null);

  const handleLoginSuccess = (authenticatedUser: any) => {
    setUser(authenticatedUser);
    setActiveTab("HOME");
    setCurrentScreenOverride(null);
  };

  const handleLogout = () => {
    setUser(null);
    setActiveTab("HOME");
    setCurrentScreenOverride(null);
    setLastEntryResult(null);
  };

  const handleScanSuccess = (entryResult: any) => {
    setLastEntryResult(entryResult);
    setCurrentScreenOverride("success");
  };

  const handleNewScanFromSuccess = () => {
    setCurrentScreenOverride(null);
    setActiveTab("SCAN");
  };

  const handleViewHistoryFromSuccess = () => {
    setCurrentScreenOverride(null);
    setActiveTab("VEHICLES");
  };

  const handleTabPress = (tab: TabType) => {
    setCurrentScreenOverride(null);
    setActiveTab(tab);
  };

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#0f172a" />
      <SafeAreaView style={styles.safeArea}>
        {!user ? (
          <LoginScreen onLoginSuccess={handleLoginSuccess} />
        ) : (
          <View style={styles.mainContainer}>
            {/* Screen Content Container */}
            <View style={styles.contentContainer}>
              {currentScreenOverride === "success" ? (
                <GateEntrySuccessScreen
                  entryResult={lastEntryResult}
                  onNewScan={handleNewScanFromSuccess}
                  onViewHistory={handleViewHistoryFromSuccess}
                />
              ) : activeTab === "HOME" ? (
                <HomeScreen
                  user={user}
                  onNewEntry={() => handleTabPress("SCAN")}
                  onViewVehicles={() => handleTabPress("VEHICLES")}
                />
              ) : activeTab === "SCAN" ? (
                <GateEntryScannerScreen
                  onSuccess={handleScanSuccess}
                  onLogout={handleLogout}
                />
              ) : activeTab === "VEHICLES" ? (
                <RecentEntriesScreen
                  onBackToScan={() => handleTabPress("SCAN")}
                />
              ) : (
                <ProfileScreen
                  user={user}
                  onLogout={handleLogout}
                />
              )}
            </View>

            {/* Bottom Tab Navigation Bar */}
            <View style={styles.bottomTabBar}>
              <TouchableOpacity
                style={[styles.tabItem, activeTab === "HOME" && !currentScreenOverride && styles.tabItemActive]}
                onPress={() => handleTabPress("HOME")}
              >
                <Text style={[styles.tabIcon, activeTab === "HOME" && !currentScreenOverride && styles.tabIconActive]}>
                  🏠
                </Text>
                <Text style={[styles.tabLabel, activeTab === "HOME" && !currentScreenOverride && styles.tabLabelActive]}>
                  HOME
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.tabItem, activeTab === "SCAN" && !currentScreenOverride && styles.tabItemActive]}
                onPress={() => handleTabPress("SCAN")}
              >
                <Text style={[styles.tabIcon, activeTab === "SCAN" && !currentScreenOverride && styles.tabIconActive]}>
                  📷
                </Text>
                <Text style={[styles.tabLabel, activeTab === "SCAN" && !currentScreenOverride && styles.tabLabelActive]}>
                  SCAN
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.tabItem, activeTab === "VEHICLES" && !currentScreenOverride && styles.tabItemActive]}
                onPress={() => handleTabPress("VEHICLES")}
              >
                <Text style={[styles.tabIcon, activeTab === "VEHICLES" && !currentScreenOverride && styles.tabIconActive]}>
                  🚛
                </Text>
                <Text style={[styles.tabLabel, activeTab === "VEHICLES" && !currentScreenOverride && styles.tabLabelActive]}>
                  VEHICLES
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.tabItem, activeTab === "PROFILE" && !currentScreenOverride && styles.tabItemActive]}
                onPress={() => handleTabPress("PROFILE")}
              >
                <Text style={[styles.tabIcon, activeTab === "PROFILE" && !currentScreenOverride && styles.tabIconActive]}>
                  👤
                </Text>
                <Text style={[styles.tabLabel, activeTab === "PROFILE" && !currentScreenOverride && styles.tabLabelActive]}>
                  PROFILE
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#0f172a",
  },
  mainContainer: {
    flex: 1,
  },
  contentContainer: {
    flex: 1,
  },
  bottomTabBar: {
    flexDirection: "row",
    backgroundColor: "#1e293b",
    borderTopWidth: 1,
    borderTopColor: "#334155",
    paddingVertical: 8,
    paddingHorizontal: 10,
    justifyContent: "space-around",
    alignItems: "center",
  },
  tabItem: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  tabItemActive: {
    backgroundColor: "rgba(56, 189, 248, 0.12)",
  },
  tabIcon: {
    fontSize: 18,
    marginBottom: 2,
    opacity: 0.6,
  },
  tabIconActive: {
    opacity: 1,
  },
  tabLabel: {
    color: "#64748b",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  tabLabelActive: {
    color: "#38bdf8",
    fontWeight: "900",
  },
});
