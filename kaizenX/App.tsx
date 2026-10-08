/**
 * KaizenX Mobile - Gate Entry & Scanner Android Application
 * Kaizentrix Global Solutions
 */

import React, { useState } from "react";
import { StatusBar, View, Text, TouchableOpacity } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import tw from "twrnc";

import { SplashScreen } from "./src/screens/SplashScreen";
import { LoginScreen } from "./src/screens/auth/LoginScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { GateEntryScannerScreen } from "./src/screens/GateEntryScannerScreen";
import { GateEntrySuccessScreen } from "./src/screens/GateEntrySuccessScreen";
import { RecentEntriesScreen } from "./src/screens/RecentEntriesScreen";
import { ProfileScreen } from "./src/screens/ProfileScreen";
import { PutawayTasksScreen } from "./src/screens/PutawayTasksScreen";
import { WarehouseLocationsScreen } from "./src/screens/WarehouseLocationsScreen";
import { setMobileAuthToken } from "./src/services/api";

export type TabType = "HOME" | "SCAN" | "VEHICLES" | "LOCATIONS" | "PUTAWAY" | "PROFILE";

export default function App() {
  const [isBooting, setIsBooting] = useState(true);
  const [user, setUser] = useState<any | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>("HOME");
  const [currentScreenOverride, setCurrentScreenOverride] = useState<"success" | null>(null);
  const [lastEntryResult, setLastEntryResult] = useState<any | null>(null);
  const [scannerPoQuery, setScannerPoQuery] = useState<string>("");

  const handleSplashFinish = (authenticatedUser: any | null) => {
    setUser(authenticatedUser);
    setIsBooting(false);
    setActiveTab("HOME");
  };

  const handleLoginSuccess = (authenticatedUser: any) => {
    setUser(authenticatedUser);
    setActiveTab("HOME");
    setCurrentScreenOverride(null);
  };

  const handleLogout = () => {
    setMobileAuthToken(null);
    setUser(null);
    setActiveTab("HOME");
    setCurrentScreenOverride(null);
    setLastEntryResult(null);
    setScannerPoQuery("");
  };

  const handleScanSuccess = (entryResult: any) => {
    setLastEntryResult(entryResult);
    setCurrentScreenOverride("success");
  };

  const handleNewScanFromSuccess = () => {
    setCurrentScreenOverride(null);
    setScannerPoQuery("");
    setActiveTab("SCAN");
  };

  const handleStartEntryFromDashboard = (poOrAsnQuery: string) => {
    setScannerPoQuery(poOrAsnQuery);
    setCurrentScreenOverride(null);
    setActiveTab("SCAN");
  };

  const handleViewHistoryFromSuccess = () => {
    setCurrentScreenOverride(null);
    setActiveTab("VEHICLES");
  };

  const handleTabPress = (tab: TabType) => {
    if (tab !== "SCAN") {
      setScannerPoQuery("");
    }
    setCurrentScreenOverride(null);
    setActiveTab(tab);
  };

  const roleNames = [
    ...(Array.isArray(user?.roles) ? user.roles : []),
    user?.role,
  ].filter(Boolean).map((role: string) => role.toUpperCase());
  const canAccessPutaway = roleNames.some((role: string) =>
    ["STORE_MANAGER", "STORE_KEEPER", "WAREHOUSE", "WAREHOUSE_MANAGER", "ADMIN", "SUPERUSER"].includes(role),
  );

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#0f172a" />
      <SafeAreaView style={tw`flex-1 bg-slate-900`}>
        {isBooting ? (
          <SplashScreen onSplashFinish={handleSplashFinish} />
        ) : !user ? (
          <LoginScreen onLoginSuccess={handleLoginSuccess} />
        ) : (
          <View style={tw`flex-1`}>
            {/* Screen Content Container */}
            <View style={tw`flex-1`}>
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
                  onStartEntry={handleStartEntryFromDashboard}
                />
              ) : activeTab === "SCAN" ? (
                <GateEntryScannerScreen
                  onSuccess={handleScanSuccess}
                  onLogout={handleLogout}
                  initialPoQuery={scannerPoQuery}
                />
              ) : activeTab === "VEHICLES" ? (
                <RecentEntriesScreen
                  onBackToScan={() => handleTabPress("SCAN")}
                />
              ) : activeTab === "PUTAWAY" ? (
                <PutawayTasksScreen user={user} />
              ) : activeTab === "LOCATIONS" ? (
                <WarehouseLocationsScreen />
              ) : (
                <ProfileScreen
                  user={user}
                  onLogout={handleLogout}
                />
              )}
            </View>

            {/* Bottom Tab Navigation Bar */}
            <View style={tw`flex-row bg-slate-800 border-t border-slate-700 py-2 px-2.5 justify-around items-center`}>
              <TouchableOpacity
                style={tw`items-center justify-center py-1 px-3 rounded-lg ${
                  activeTab === "HOME" && !currentScreenOverride ? "bg-sky-500/15" : ""
                }`}
                onPress={() => handleTabPress("HOME")}
              >
                <Text style={tw`text-lg mb-0.5 ${activeTab === "HOME" && !currentScreenOverride ? "opacity-100" : "opacity-60"}`}>
                  🏠
                </Text>
                <Text style={tw`text-[10px] tracking-wider ${activeTab === "HOME" && !currentScreenOverride ? "text-sky-400 font-black" : "text-slate-400 font-extrabold"}`}>
                  HOME
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={tw`items-center justify-center py-1 px-3 rounded-lg ${
                  activeTab === "SCAN" && !currentScreenOverride ? "bg-sky-500/15" : ""
                }`}
                onPress={() => handleTabPress("SCAN")}
              >
                <Text style={tw`text-lg mb-0.5 ${activeTab === "SCAN" && !currentScreenOverride ? "opacity-100" : "opacity-60"}`}>
                  📷
                </Text>
                <Text style={tw`text-[10px] tracking-wider ${activeTab === "SCAN" && !currentScreenOverride ? "text-sky-400 font-black" : "text-slate-400 font-extrabold"}`}>
                  SCAN
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={tw`items-center justify-center py-1 px-3 rounded-lg ${
                  activeTab === "VEHICLES" && !currentScreenOverride ? "bg-sky-500/15" : ""
                }`}
                onPress={() => handleTabPress("VEHICLES")}
              >
                <Text style={tw`text-lg mb-0.5 ${activeTab === "VEHICLES" && !currentScreenOverride ? "opacity-100" : "opacity-60"}`}>
                  🚛
                </Text>
                <Text style={tw`text-[10px] tracking-wider ${activeTab === "VEHICLES" && !currentScreenOverride ? "text-sky-400 font-black" : "text-slate-400 font-extrabold"}`}>
                  VEHICLES
                </Text>
              </TouchableOpacity>

              {canAccessPutaway && (
                <TouchableOpacity
                  style={tw`items-center justify-center py-1 px-3 rounded-lg ${activeTab === "LOCATIONS" && !currentScreenOverride ? "bg-sky-500/15" : ""}`}
                  onPress={() => handleTabPress("LOCATIONS")}
                >
                  <Text style={tw`text-lg mb-0.5 ${activeTab === "LOCATIONS" && !currentScreenOverride ? "opacity-100" : "opacity-60"}`}>📍</Text>
                  <Text style={tw`text-[10px] tracking-wider ${activeTab === "LOCATIONS" && !currentScreenOverride ? "text-sky-400 font-black" : "text-slate-400 font-extrabold"}`}>LOCATIONS</Text>
                </TouchableOpacity>
              )}

              {canAccessPutaway && (
                <TouchableOpacity
                  style={tw`items-center justify-center py-1 px-3 rounded-lg ${
                    activeTab === "PUTAWAY" && !currentScreenOverride ? "bg-sky-500/15" : ""
                  }`}
                  onPress={() => handleTabPress("PUTAWAY")}
                >
                  <Text style={tw`text-lg mb-0.5 ${activeTab === "PUTAWAY" && !currentScreenOverride ? "opacity-100" : "opacity-60"}`}>
                    📦
                  </Text>
                  <Text style={tw`text-[10px] tracking-wider ${activeTab === "PUTAWAY" && !currentScreenOverride ? "text-sky-400 font-black" : "text-slate-400 font-extrabold"}`}>
                    PUTAWAY
                  </Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={tw`items-center justify-center py-1 px-3 rounded-lg ${
                  activeTab === "PROFILE" && !currentScreenOverride ? "bg-sky-500/15" : ""
                }`}
                onPress={() => handleTabPress("PROFILE")}
              >
                <Text style={tw`text-lg mb-0.5 ${activeTab === "PROFILE" && !currentScreenOverride ? "opacity-100" : "opacity-60"}`}>
                  👤
                </Text>
                <Text style={tw`text-[10px] tracking-wider ${activeTab === "PROFILE" && !currentScreenOverride ? "text-sky-400 font-black" : "text-slate-400 font-extrabold"}`}>
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
