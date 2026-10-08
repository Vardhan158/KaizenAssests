import React, { useEffect, useRef } from 'react';
import { Animated, Text, View } from 'react-native';
import tw from 'twrnc';

interface ScannerOverlayProps {
  title?: string;
  subtitle?: string;
}

export function ScannerOverlay({
  title = 'CAMERA SCANNER',
  subtitle = 'Place the QR code inside the frame',
}: ScannerOverlayProps) {
  const laser = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(laser, {
          toValue: 1,
          duration: 1500,
          useNativeDriver: true,
        }),
        Animated.timing(laser, {
          toValue: 0,
          duration: 1500,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [laser]);

  const translateY = laser.interpolate({
    inputRange: [0, 1],
    outputRange: [12, 164],
  });

  return (
    <View style={tw`w-full items-center px-5 py-4`}>
      <View style={tw`w-full max-w-[340px] flex-row items-center mb-4`}>
        <View
          style={tw`w-10 h-10 rounded-full bg-sky-100 items-center justify-center`}
        >
          <Text style={tw`text-sky-600 text-2xl font-bold`}>⌾</Text>
        </View>
        <View style={tw`flex-1 ml-3`}>
          <Text
            style={tw`text-slate-900 text-[15px] font-extrabold tracking-wide`}
          >
            {title}
          </Text>
          <Text style={tw`text-slate-500 text-xs mt-1`}>{subtitle}</Text>
        </View>
      </View>

      <View
        style={tw`w-full max-w-[320px] h-48 rounded-3xl bg-slate-950 border border-sky-200 overflow-hidden relative items-center justify-center`}
      >
        <View
          style={tw`absolute top-3 left-3 w-7 h-7 border-t-[3px] border-l-[3px] border-cyan-400 rounded-tl-lg`}
        />
        <View
          style={tw`absolute top-3 right-3 w-7 h-7 border-t-[3px] border-r-[3px] border-cyan-400 rounded-tr-lg`}
        />
        <View
          style={tw`absolute bottom-3 left-3 w-7 h-7 border-b-[3px] border-l-[3px] border-cyan-400 rounded-bl-lg`}
        />
        <View
          style={tw`absolute bottom-3 right-3 w-7 h-7 border-b-[3px] border-r-[3px] border-cyan-400 rounded-br-lg`}
        />
        <View
          style={tw`w-36 h-28 rounded-xl border border-sky-300/30 items-center justify-center`}
        >
          <Text
            style={tw`text-sky-200 text-[10px] font-extrabold tracking-[1.5px]`}
          >
            ALIGN QR CODE
          </Text>
        </View>
        <Animated.View
          style={[
            tw`absolute left-5 right-5 h-0.5 bg-cyan-400`,
            { transform: [{ translateY }] },
          ]}
        />
      </View>
      <Text style={tw`text-slate-500 text-[11px] mt-3`}>Scanning is ready</Text>
    </View>
  );
}
