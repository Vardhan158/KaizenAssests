import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { getServerBaseUrl } from '../services/api';

const artwork = require('../assests/kaizenx-splash-reference-v2.png');
const WIDTH = 941;
const HEIGHT = 1672;
interface SplashScreenProps {
  onSplashFinish: (authenticatedUser: any | null) => void;
}

export function SplashScreen({ onSplashFinish }: SplashScreenProps) {
  const windowSize = useWindowDimensions();
  const [size, setSize] = useState({
    width: windowSize.width,
    height: windowSize.height,
  });
  const [artReady, setArtReady] = useState(false);
  const finish = useRef(onSplashFinish);
  finish.current = onSplashFinish;
  const entrance = useRef(new Animated.Value(0)).current;
  const progress = useRef(new Animated.Value(0)).current;
  const drift = useRef(new Animated.Value(0)).current;
  const exit = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!artReady) {
      return;
    }
    let cancelled = false;
    let timeline: Animated.CompositeAnimation | undefined;
    let waves: Animated.CompositeAnimation | undefined;
    async function start() {
      const reduced = await AccessibilityInfo.isReduceMotionEnabled().catch(
        () => false,
      );
      if (cancelled) {
        return;
      }
      // Preserve the existing local gate-session handoff.
      const session = {
        username: 'gate_security',
        full_name: 'Gate Security Officer',
        roles: ['GATE_SECURITY'],
        gate_location: 'Main Perimeter Gate 01',
        facility_code: 'FAC-BLR-01',
        server_url: getServerBaseUrl(),
      };
      if (!reduced) {
        waves = Animated.loop(
          Animated.sequence([
            Animated.timing(drift, {
              toValue: 1,
              duration: 1800,
              easing: Easing.inOut(Easing.sin),
              useNativeDriver: true,
            }),
            Animated.timing(drift, {
              toValue: 0,
              duration: 1800,
              easing: Easing.inOut(Easing.sin),
              useNativeDriver: true,
            }),
          ]),
        );
        waves.start();
      }
      timeline = Animated.sequence([
        Animated.parallel([
          Animated.timing(entrance, {
            toValue: 1,
            duration: reduced ? 0 : 650,
            useNativeDriver: true,
          }),
          // Launch animation progress, not a network download percentage.
          Animated.timing(progress, {
            toValue: 1,
            duration: reduced ? 150 : 2000,
            easing: Easing.inOut(Easing.cubic),
            useNativeDriver: false,
          }),
        ]),
        Animated.delay(reduced ? 0 : 180),
        Animated.timing(exit, {
          toValue: 0,
          duration: reduced ? 0 : 220,
          useNativeDriver: true,
        }),
      ]);
      timeline.start(({ finished }) => {
        if (finished && !cancelled) {
          finish.current(session);
        }
      });
    }
    start();
    return () => {
      cancelled = true;
      timeline?.stop();
      waves?.stop();
    };
  }, [artReady, drift, entrance, exit, progress]);

  const sx = size.width / WIDTH;
  const sy = size.height / HEIGHT;
  // Lay out at device dimensions; do not transform a 941pt canvas.
  const region = (x: number, y: number, w: number, h: number) => ({
    position: 'absolute' as const,
    left: x * sx,
    top: y * sy,
    width: w * sx,
    height: h * sy,
    overflow: 'hidden' as const,
  });
  const imageStyle = (x: number, y: number) => ({
    position: 'absolute' as const,
    left: -x * sx,
    top: -y * sy,
    width: size.width,
    height: size.height,
  });
  const rise = entrance.interpolate({
    inputRange: [0, 1],
    outputRange: [10, 0],
  });
  return (
    <View
      style={styles.root}
      onLayout={({ nativeEvent: { layout } }) =>
        setSize({ width: layout.width, height: layout.height })
      }
    >
      <Animated.View
        style={[StyleSheet.absoluteFill, { opacity: exit }]}
        pointerEvents="none"
      >
        {/* Decorative strips retain the complete original curves and warehouse. */}
        <View style={region(0, 0, 941, 480)}>
          <Image
            source={artwork}
            style={imageStyle(0, 0)}
            resizeMode="stretch"
            onLoad={() => setArtReady(true)}
            onError={() => setArtReady(true)}
            accessible={false}
          />
        </View>
        <View style={region(0, 480, 250, 550)}>
          <Image
            source={artwork}
            style={imageStyle(0, 480)}
            resizeMode="stretch"
            accessible={false}
          />
        </View>
        <View style={region(700, 480, 241, 550)}>
          <Image
            source={artwork}
            style={imageStyle(700, 480)}
            resizeMode="stretch"
            accessible={false}
          />
        </View>
        <View style={region(0, 1140, 941, 532)}>
          <Image
            source={artwork}
            style={imageStyle(0, 1140)}
            resizeMode="stretch"
            accessible={false}
          />
        </View>
        <Animated.View
          style={[
            region(250, 480, 450, 530),
            {
              opacity: entrance,
              transform: [{ translateY: rise }],
            },
          ]}
          accessible
          accessibilityLabel="KGS. KaizenX. Logistics OS. Gate Management Platform."
        >
          {/* Brand artwork preserves the reference's exact type and gradient logo. */}
          <Image
            source={artwork}
            style={imageStyle(250, 480)}
            resizeMode="stretch"
            accessible={false}
          />
        </Animated.View>
        <View
          style={[
            styles.loading,
            { top: 1010 * sy, width: size.width, height: 130 * sy },
          ]}
        >
          <View
            style={[
              styles.track,
              { width: 311 * sx, height: 16 * sy, marginTop: 50 * sy },
            ]}
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel="Loading workspace"
          >
            <Animated.View
              style={{
                height: '100%',
                overflow: 'hidden',
                width: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0%', '100%'],
                }),
              }}
            >
              {/* Use the reference gradient as a single texture, avoiding visible strip seams. */}
              <View
                style={{ width: 311 * sx, height: 16 * sy, overflow: 'hidden' }}
              >
                <Image
                  source={artwork}
                  resizeMode="stretch"
                  accessible={false}
                  style={{
                    position: 'absolute',
                    width: (size.width * 311) / 248,
                    height: size.height,
                    left: (-320 * sx * 311) / 248,
                    top: -1060 * sy,
                  }}
                />
              </View>
            </Animated.View>
          </View>
          <Text
            allowFontScaling={false}
            style={[
              styles.loadingText,
              {
                fontSize: 21 * sx,
                letterSpacing: 4 * sx,
                marginTop: 29 * sy,
              },
            ]}
          >
            LOADING WORKSPACE
          </Text>
        </View>
      </Animated.View>
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fcfeff', overflow: 'hidden' },
  loading: {
    position: 'absolute',
    left: 0,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0)',
  },
  track: { borderRadius: 20, backgroundColor: '#e7eff7', overflow: 'hidden' },
  loadingText: {
    fontWeight: '700',
    color: '#7589a5',
    includeFontPadding: false,
  },
});
