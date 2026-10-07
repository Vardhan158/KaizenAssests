import React, { useEffect, useRef } from "react";
import { StyleSheet, View, Text, Animated } from "react-native";

interface ScannerOverlayProps {
  title?: string;
  subtitle?: string;
}

export function ScannerOverlay({
  title = "KAIZENX CAMERA SCANNER",
  subtitle = "Align barcode or PO/ASN QR code within frame",
}: ScannerOverlayProps) {
  const laserAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(laserAnim, {
          toValue: 1,
          duration: 1800,
          useNativeDriver: true,
        }),
        Animated.timing(laserAnim, {
          toValue: 0,
          duration: 1800,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [laserAnim]);

  const translateY = laserAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 180],
  });

  return (
    <View style={styles.overlayContainer}>
      <Text style={styles.scannerHeaderTitle}>{title}</Text>
      <Text style={styles.scannerHeaderSub}>{subtitle}</Text>

      {/* Target Framing Box */}
      <View style={styles.targetFrame}>
        {/* Four Corner Accents */}
        <View style={[styles.corner, styles.topLeft]} />
        <View style={[styles.corner, styles.topRight]} />
        <View style={[styles.corner, styles.bottomLeft]} />
        <View style={[styles.corner, styles.bottomRight]} />

        {/* Animated Sweeping Laser Beam */}
        <Animated.View style={[styles.laserBeam, { transform: [{ translateY }] }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlayContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  scannerHeaderTitle: {
    color: "#38bdf8",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.5,
    textAlign: "center",
  },
  scannerHeaderSub: {
    color: "#94a3b8",
    fontSize: 11,
    textAlign: "center",
    marginTop: 2,
    marginBottom: 12,
  },
  targetFrame: {
    width: 240,
    height: 190,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.3)",
    backgroundColor: "rgba(15, 23, 42, 0.6)",
    overflow: "hidden",
    position: "relative",
    justifyContent: "flex-start",
  },
  corner: {
    position: "absolute",
    width: 20,
    height: 20,
    borderColor: "#38bdf8",
  },
  topLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderTopLeftRadius: 12,
  },
  topRight: {
    top: 0,
    right: 0,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderTopRightRadius: 12,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderBottomLeftRadius: 12,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderBottomRightRadius: 12,
  },
  laserBeam: {
    width: "100%",
    height: 3,
    backgroundColor: "#06b6d4",
    shadowColor: "#06b6d4",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 8,
    elevation: 6,
  },
});
