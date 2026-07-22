import React from 'react';
import { View, Pressable, Text, Modal, Dimensions } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { Home, Bell, Plus, MessageCircle, User, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Notification, Conversation } from '@/lib/types';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withDelay,
} from 'react-native-reanimated';
import { usePathStore } from '@/lib/store';
import SleepScreen from '@/app/sleep-screen';
import { useSession } from '@/lib/auth/use-session';
import { usePushNotifications } from '@/lib/use-push-notifications';

const BASE_MOMENT_TYPES = [
  { type: 'thought', emoji: '💭', label: 'Thought', color: '#0A1F44' },
  { type: 'location', emoji: '📍', label: 'Check In', color: '#EF4444' },
];

const toRad = (deg: number) => (deg * Math.PI) / 180;

function getArcPositions(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const angle = toRad(20 + i * 40);
    return {
      dx: Math.round(110 * Math.cos(angle)),
      dy: Math.round(-110 * Math.sin(angle)),
    };
  });
}

type MomentItem = { type: string; emoji: string; label: string; color: string };

function RadialItem({
  item,
  delay,
  style,
  onPress,
}: {
  item: MomentItem;
  delay: number;
  style: object;
  onPress: () => void;
}) {
  const scale = useSharedValue(0);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  React.useEffect(() => {
    scale.value = withDelay(delay, withSpring(1, { damping: 12, stiffness: 220 }));
  }, []);

  return (
    <Animated.View style={[style, animStyle]}>
      <Pressable onPress={onPress} testID={`radial-${item.type}`} style={{ alignItems: 'center' }}>
        <View
          style={{
            width: 50,
            height: 50,
            borderRadius: 25,
            backgroundColor: item.color,
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: item.color,
            shadowOffset: { width: 0, height: 3 },
            shadowOpacity: 0.4,
            shadowRadius: 6,
            elevation: 6,
          }}
        >
          <Text style={{ fontSize: 22 }}>{item.emoji}</Text>
        </View>
        <Text
          style={{
            fontSize: 10,
            fontWeight: '700',
            color: '#FFFFFF',
            marginTop: 3,
            textShadowColor: 'rgba(0,0,0,0.6)',
            textShadowOffset: { width: 0, height: 1 },
            textShadowRadius: 4,
          }}
        >
          {item.label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

function FloatingTabBar({ state, descriptors, navigation }: any) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { data: notifications = [] } = useQuery({ queryKey: ['notifications'], queryFn: () => api.get<Notification[]>('/api/notifications') });
  const { data: conversations = [] } = useQuery({ queryKey: ['conversations'], queryFn: () => api.get<Conversation[]>('/api/conversations') });
  const unreadNotifications = notifications.filter((n: Notification) => !n.read).length;
  const totalUnread = conversations.reduce((sum: number, c: Conversation) => sum + c.unreadCount, 0);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const { width: SCREEN_W } = Dimensions.get('window');
  const isSleeping = usePathStore((s) => s.isSleeping);
  const setIsSleeping = usePathStore((s) => s.setIsSleeping);

  const sleepItem: MomentItem = isSleeping
    ? { type: 'wakeup', emoji: '☀️', label: 'Wake Up', color: '#F59E0B' }
    : { type: 'sleep', emoji: '😴', label: 'Sleep', color: '#6366F1' };
  const MOMENT_TYPES: MomentItem[] = [...BASE_MOMENT_TYPES, sleepItem];
  const ARC_POSITIONS = getArcPositions(MOMENT_TYPES.length);

  const tabs = [
    { icon: Home, label: 'Home', route: 'index' },
    { icon: Bell, label: 'Alerts', route: 'notifications', badge: unreadNotifications },
    { icon: Plus, label: 'Create', route: 'create', isCenter: true },
    { icon: MessageCircle, label: 'Chat', route: 'messages', badge: totalUnread },
    { icon: User, label: 'Profile', route: 'profile' },
  ];

  return (
    <>
      <View
        style={{
          position: 'absolute',
          bottom: insets.bottom + 8,
          left: 16,
          right: 16,
          height: 64,
          backgroundColor: '#0A1F44',
          borderRadius: 32,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-around',
          paddingHorizontal: 8,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.25,
          shadowRadius: 16,
          elevation: 12,
        }}
        testID="floating-tab-bar"
      >
        {tabs.map((tab, index) => {
          const isCreate = tab.isCenter;
          const realTabIndex = index > 2 ? index - 1 : index;
          const isActive = !isCreate && state.index === realTabIndex;
          const IconComponent = tab.icon;

          return (
            <Pressable
              key={tab.route}
              testID={`tab-${tab.route}`}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                if (isCreate) {
                  setMenuOpen(true);
                } else {
                  const event = navigation.emit({
                    type: 'tabPress',
                    target: state.routes[realTabIndex]?.key,
                    canPreventDefault: true,
                  });
                  if (!event.defaultPrevented) {
                    navigation.navigate(state.routes[realTabIndex]?.name);
                  }
                }
              }}
              style={{
                alignItems: 'center',
                justifyContent: 'center',
                width: isCreate ? 48 : 56,
                height: isCreate ? 48 : 56,
                ...(isCreate
                  ? {
                      backgroundColor: '#FFFFFF',
                      borderRadius: 24,
                      shadowColor: '#FFFFFF',
                      shadowOffset: { width: 0, height: 4 },
                      shadowOpacity: 0.4,
                      shadowRadius: 8,
                      elevation: 6,
                    }
                  : {}),
              }}
            >
              {isCreate ? (
                menuOpen ? (
                  <X size={24} color="#0A1F44" strokeWidth={2.5} />
                ) : (
                  <Plus size={24} color="#0A1F44" strokeWidth={2.5} />
                )
              ) : (
                <IconComponent
                  size={22}
                  color={isActive ? '#FFFFFF' : '#8B8B8B'}
                  strokeWidth={isActive ? 2.5 : 1.5}
                />
              )}
              {!isCreate ? (
                <Text
                  style={{
                    fontSize: 10,
                    marginTop: 2,
                    color: isActive ? '#FFFFFF' : '#8B8B8B',
                    fontWeight: isActive ? '600' : '400',
                  }}
                >
                  {tab.label}
                </Text>
              ) : null}
              {tab.badge && tab.badge > 0 ? (
                <View
                  style={{
                    position: 'absolute',
                    top: 2,
                    right: 4,
                    backgroundColor: '#FFFFFF',
                    borderRadius: 8,
                    minWidth: 16,
                    height: 16,
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingHorizontal: 4,
                  }}
                >
                  <Text style={{ fontSize: 10, fontWeight: '700', color: '#0A1F44' }}>
                    {tab.badge > 9 ? '9+' : tab.badge}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      <Modal
        visible={menuOpen}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setMenuOpen(false)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' }}
          onPress={() => setMenuOpen(false)}
        >
          {MOMENT_TYPES.map((item, i) => {
            const pos = ARC_POSITIONS[i];
            const itemLeft = SCREEN_W / 2 + pos.dx - 25;
            const itemBottom = insets.bottom + 8 + 32 + (-pos.dy) - 25;
            return (
              <RadialItem
                key={item.type}
                item={item}
                delay={i * 25}
                style={{ position: 'absolute', left: itemLeft, bottom: itemBottom }}
                onPress={() => {
                  setMenuOpen(false);
                  if (item.type === 'wakeup') {
                    setIsSleeping(false);
                  }
                  setTimeout(() => router.push(`/create-moment?type=${item.type}` as any), 50);
                }}
              />
            );
          })}
        </Pressable>
      </Modal>
    </>
  );
}

export default function TabLayout() {
  const isSleeping = usePathStore((s) => s.isSleeping);
  const { data: session } = useSession();
  usePushNotifications(!!session?.user?.id);

  return (
    <>
      <Tabs
        tabBar={(props) => <FloatingTabBar {...props} />}
        screenOptions={{
          headerShown: false,
        }}
      >
        <Tabs.Screen name="index" options={{ title: 'Home' }} />
        <Tabs.Screen name="notifications" options={{ title: 'Notifications' }} />
        <Tabs.Screen name="messages" options={{ title: 'Messages' }} />
        <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
        <Tabs.Screen name="two" options={{ href: null }} />
        <Tabs.Screen name="create" options={{ href: null }} />
      </Tabs>

      <Modal visible={isSleeping} animationType="fade" statusBarTranslucent>
        <SleepScreen />
      </Modal>
    </>
  );
}
