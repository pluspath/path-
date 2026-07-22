import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import { usePathStore } from '@/lib/store';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Post } from '@/lib/types';
import { useSession } from '@/lib/auth/use-session';
import * as Haptics from 'expo-haptics';

const STARS = Array.from({ length: 30 }, (_, i) => ({
  id: i,
  top: Math.random() * 85,
  left: Math.random() * 100,
  size: Math.random() * 3 + 1,
  delay: Math.random() * 2000,
}));

function Star({ top, left, size, delay }: { top: number; left: number; size: number; delay: number }) {
  const opacity = useSharedValue(0.2);
  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  React.useEffect(() => {
    opacity.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.2, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        false,
      ),
    );
  }, []);

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          top: `${top}%` as any,
          left: `${left}%` as any,
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: '#FFFFFF',
        },
        animStyle,
      ]}
    />
  );
}

function formatSleepTime(ts: string | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${m} ${ampm}`;
}

export default function SleepScreen() {
  const router = useRouter();
  const setIsSleeping = usePathStore((s) => s.setIsSleeping);
  const setLastSleepTimestamp = usePathStore((s) => s.setLastSleepTimestamp);
  const lastSleepTimestamp = usePathStore((s) => s.lastSleepTimestamp);
  const { data: session } = useSession();
  const queryClient = useQueryClient();

  const moonScale = useSharedValue(1);
  const moonStyle = useAnimatedStyle(() => ({
    transform: [{ scale: moonScale.value }],
  }));

  React.useEffect(() => {
    moonScale.value = withRepeat(
      withSequence(
        withTiming(1.08, { duration: 3000, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 3000, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, []);

  const { mutate: createWakePost, isPending } = useMutation({
    mutationFn: (post: Partial<Post>) => api.post<Post>('/api/posts', post),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['posts'] });
      queryClient.invalidateQueries({ queryKey: ['posts', 'me'] });
      setIsSleeping(false);
      router.replace('/(tabs)' as any);
    },
  });

  const handleWakeUp = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    let sleepDuration: string | undefined;
    if (lastSleepTimestamp) {
      const sleptMs = Date.now() - new Date(lastSleepTimestamp).getTime();
      const sleptHours = Math.floor(sleptMs / 3600000);
      const sleptMins = Math.floor((sleptMs % 3600000) / 60000);
      sleepDuration = `${sleptHours}h ${sleptMins}m`;
      setLastSleepTimestamp(null);
    }

    createWakePost({
      userId: session?.user?.id ?? '',
      type: 'sleep',
      sleepAction: 'woke_up',
      ...(sleepDuration ? { sleepDuration } : {}),
      reactions: [],
      commentCount: 0,
      createdAt: new Date().toISOString(),
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#050A1A' }} testID="sleep-screen">
      {STARS.map((star) => (
        <Star key={star.id} top={star.top} left={star.left} size={star.size} delay={star.delay} />
      ))}

      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View style={moonStyle}>
          <Text style={{ fontSize: 96, textAlign: 'center' }}>🌙</Text>
        </Animated.View>

        <Text style={{ fontSize: 32, fontWeight: '700', color: '#FFFFFF', marginTop: 24, textAlign: 'center' }}>
          I'm sleeping 😴
        </Text>

        {lastSleepTimestamp ? (
          <Text style={{ fontSize: 15, color: '#94A3B8', marginTop: 8, textAlign: 'center' }}>
            Since {formatSleepTime(lastSleepTimestamp)}
          </Text>
        ) : null}

        <Text style={{ fontSize: 14, color: '#475569', marginTop: 16, textAlign: 'center', paddingHorizontal: 40 }}>
          Tap "Wake Up" when you're ready to start your day
        </Text>
      </View>

      <SafeAreaView edges={['bottom']} style={{ backgroundColor: 'transparent' }}>
        <View style={{ paddingHorizontal: 32, paddingBottom: 16 }}>
          <Pressable
            testID="wake-up-button"
            onPress={handleWakeUp}
            disabled={isPending}
            style={{
              backgroundColor: '#FFFFFF',
              borderRadius: 16,
              paddingVertical: 18,
              alignItems: 'center',
              opacity: isPending ? 0.7 : 1,
              shadowColor: '#FFFFFF',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.4,
              shadowRadius: 12,
              elevation: 8,
            }}
          >
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#0A1F44' }}>
              {isPending ? 'Waking up...' : '☀️  Wake Up'}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}
