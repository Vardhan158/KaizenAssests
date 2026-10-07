/**
 * KaizenX Mobile - Gate Entry & Scanner Android Application
 * Kaizentrix Global Solutions
 */

import React, { useState } from "react";
import { StatusBar, StyleSheet } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { LoginScreen } from "./src/screens/LoginScreen";
import { GateEntryScannerScreen } from "./src/screens/GateEntryScannerScreen";
import { GateEntrySuccessScreen } from "./src/screens/GateEntrySuccessScreen";
import { RecentEntriesScreen } from "./src/screens/RecentEntriesScreen";

export default function App() {
  const [user, setUser] = useState<any | null>(null);
  const [currentScreen, setCurrentScreen] = useState<"scanner" | "success" | "history">("scanner");
  const [lastEntryResult, setLastEntryResult] = useState<any | null>(null);

  const handleLoginSuccess = (authenticatedUser: any) => {
    setUser(authenticatedUser);
    setCurrentScreen("scanner");
  };

  const handleLogout = () => {
    setUser(null);
    setCurrentScreen("scanner");
    setLastEntryResult(null);
  };

  const handleScanSuccess = (entryResult: any) => {
    setLastEntryResult(entryResult);
    setCurrentScreen("success");
  };

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#0f172a" />
      <SafeAreaView style={styles.safeArea}>
        {!user ? (
          <LoginScreen onLoginSuccess={handleLoginSuccess} />
        ) : currentScreen === "success" ? (
          <GateEntrySuccessScreen
            entryResult={lastEntryResult}
            onNewScan={() => setCurrentScreen("scanner")}
            onViewHistory={() => setCurrentScreen("history")}
          />
        ) : currentScreen === "history" ? (
          <RecentEntriesScreen onBackToScan={() => setCurrentScreen("scanner")} />
        ) : (
          <GateEntryScannerScreen
            onSuccess={handleScanSuccess}
            onLogout={handleLogout}
          />
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
});
