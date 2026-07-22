import React, { useEffect } from 'react';
import { View, Text, Pressable, Dimensions, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withDelay,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { MomentType } from '@/lib/types';
import { MOMENT_CONFIG } from '@/lib/mock-data';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const MOMENT_TYPES: MomentType[] = ['thought', 'location', 'sleep', 'wakeup'];

const BUTTON_SIZE = 64;
const ARC_RADIUS = 140;
const ARC_START = Math.PI * 1.1;
const ARC_END = Math.PI * 1.9;

interface RadialMenuProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (type: MomentType) => void;
}

function RadialButton({
  type,
  index,
  visible,
  onSelect,
}: {
  type: MomentType;
  index: number;
  visible: boolean;
  onSelect: (type: MomentType) => void;
}) {
  const config = MOMENT_CONFIG[type];
  const totalItems = MOMENT_TYPES.length;
  const angle = totalItems === 1
    ? (ARC_START + ARC_END) / 2
    : ARC_START + (ARC_END - ARC_START) * (index / (totalItems - 1));

  const targetX = Math.cos(angle) * ARC_RADIUS;
  const targetY = Math.sin(angle) * ARC_RADIUS;

  const progress = useSharedValue(0);
  const buttonScale = useSharedValue(1);

  useEffect(() => {
    if (visible) {
      progress.value = withDelay(
        index * 50,
        withSpring(1, { damping: 14, stiffness: 180, mass: 0.8 })
      );
    } else {
      progress.value = withTiming(0, { duration: 150 });
    }
  }, [visible]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: targetX * progress.value },
      { translateY: targetY * progress.value },
      { scale: progress.value * buttonScale.value },
    ],
    opacity: progress.value,
  }));

  const handlePress = () => {
    buttonScale.value = withSpring(0.85, { damping: 10, stiffness: 400 }, () => {
      buttonScale.value = withSpring(1, { damping: 12, stiffness: 200 });
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onSelect(type);
  };

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          alignItems: 'center',
        },
        animatedStyle,
      ]}
    >
      <Pressable onPress={handlePress} testID={`radial-button-${type}`}>
        <View
          style={{
            width: BUTTON_SIZE,
            height: BUTTON_SIZE,
            borderRadius: BUTTON_SIZE / 2,
            backgroundColor: config.color,
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: config.color,
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.4,
            shadowRadius: 8,
            elevation: 6,
          }}
        >
          <Text style={{ fontSize: 28 }}>{config.icon}</Text>
        </View>
        <Text
          style={{
            fontSize: 11,
            fontWeight: '600',
            color: '#FFFFFF',
            marginTop: 6,
            textAlign: 'center',
          }}
        >
          {config.label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

export default function RadialMenu({ visible, onClose, onSelect }: RadialMenuProps) {
  const overlayOpacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      overlayOpacity.value = withTiming(1, { duration: 250 });
    } else {
      overlayOpacity.value = withTiming(0, { duration: 200 });
    }
  }, [visible]);

  const overlayAnimatedStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
  }));

  if (!visible) return null;

  return (
    <View style={StyleSheet.absoluteFill} testID="radial-menu">
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose}>
        <Animated.View style={[StyleSheet.absoluteFill, overlayAnimatedStyle]}>
          <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill}>
            <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(6, 15, 34, 0.75)' }]} />
          </BlurView>
        </Animated.View>
      </Pressable>

      {/* Center anchor for radial buttons */}
      <View
        style={{
          position: 'absolute',
          bottom: 120,
          left: SCREEN_WIDTH / 2,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {MOMENT_TYPES.map((type, index) => (
          <RadialButton
            key={type}
            type={type}
            index={index}
            visible={visible}
            onSelect={onSelect}
          />
        ))}
      </View>

      {/* Close hint */}
      <Animated.View
        style={[
          {
            position: 'absolute',
            bottom: 50,
            left: 0,
            right: 0,
            alignItems: 'center',
          },
          overlayAnimatedStyle,
        ]}
      >
        <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
          Tap anywhere to close
        </Text>
      </Animated.View>
    </View>
  );
}
