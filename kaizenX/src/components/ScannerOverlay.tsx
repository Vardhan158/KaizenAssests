import React, { useEffect, useRef } from "react";
import { View, Text, Animated } from "react-native";
import tw from "twrnc";

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
    <View style={tw`items-center justify-center py-3`}>
      <Text style={tw`text-sky-400 text-xs font-black tracking-widest text-center`}>{title}</Text>
      <Text style={tw`text-slate-400 text-xs text-center mt-0.5 mb-3`}>{subtitle}</Text>

      {/* Target Framing Box */}
      <View style={tw`w-[240px] h-[190px] rounded-2xl border border-sky-400/30 bg-slate-900/60 overflow-hidden relative justify-start`}>
        {/* Four Corner Accents */}
        <View style={tw`absolute top-0 left-0 w-5 h-5 border-t-2 border-l-2 border-sky-400 rounded-tl-xl`} />
        <View style={tw`absolute top-0 right-0 w-5 h-5 border-t-2 border-r-2 border-sky-400 rounded-tr-xl`} />
        <View style={tw`absolute bottom-0 left-0 w-5 h-5 border-b-2 border-l-2 border-sky-400 rounded-bl-xl`} />
        <View style={tw`absolute bottom-0 right-0 w-5 h-5 border-b-2 border-r-2 border-sky-400 rounded-br-xl`} />

        {/* Animated Sweeping Laser Beam */}
        <Animated.View style={[tw`w-full h-1 bg-cyan-400 shadow-md`, { transform: [{ translateY }] }]} />
      </View>
    </View>
  );
}
