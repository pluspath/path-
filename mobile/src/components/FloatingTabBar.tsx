import React, { useCallback, useEffect } from 'react';
import { View, Pressable, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { Home, Bell, Plus, MessageCircle, User } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  interpolateColor,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { usePathStore } from '@/lib/store';
import { Text } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Notification, Conversation } from '@/lib/types';

const INACTIVE_COLOR = '#8B8B8B';
const ACTIVE_COLOR = '#FFFFFF';
const GOLD = '#FFFFFF';
const TAB_BAR_HEIGHT = 70;

const SPRING_CONFIG = {
  damping: 15,
  stiffness: 200,
  mass: 0.8,
};

interface TabItem {
  icon: typeof Home;
  label: string;
  isCreate?: boolean;
}

const TABS: TabItem[] = [
  { icon: Home, label: 'Home' },
  { icon: Bell, label: 'Alerts' },
  { icon: Plus, label: 'Create', isCreate: true },
  { icon: MessageCircle, label: 'Chat' },
  { icon: User, label: 'Profile' },
];

interface FloatingTabBarProps {
  activeTab: number;
  onTabPress: (index: number) => void;
  onCreatePress: () => void;
}

function TabButton({
  item,
  index,
  isActive,
  onPress,
  badge,
}: {
  item: TabItem;
  index: number;
  isActive: boolean;
  onPress: () => void;
  badge?: number;
}) {
  const scale = useSharedValue(1);
  const activeProgress = useSharedValue(isActive ? 1 : 0);

  useEffect(() => {
    activeProgress.value = withSpring(isActive ? 1 : 0, SPRING_CONFIG);
  }, [isActive]);

  const animatedIconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePress = useCallback(() => {
    scale.value = withSpring(0.8, { damping: 10, stiffness: 400 }, () => {
      scale.value = withSpring(1, SPRING_CONFIG);
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  }, [onPress]);

  if (item.isCreate) {
    return (
      <Pressable
        testID="create-tab-button"
        onPress={handlePress}
        style={{
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Animated.View
          style={[
            {
              width: 56,
              height: 56,
              borderRadius: 28,
              backgroundColor: GOLD,
              alignItems: 'center',
              justifyContent: 'center',
              marginTop: -20,
              shadowColor: GOLD,
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.4,
              shadowRadius: 8,
              elevation: 8,
            },
            animatedIconStyle,
          ]}
        >
          <Plus size={28} color="#FFFFFF" strokeWidth={2.5} />
        </Animated.View>
      </Pressable>
    );
  }

  const IconComponent = item.icon;
  const color = isActive ? ACTIVE_COLOR : INACTIVE_COLOR;

  return (
    <Pressable
      testID={`tab-${item.label.toLowerCase()}-button`}
      onPress={handlePress}
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        flex: 1,
        paddingVertical: 8,
      }}
    >
      <Animated.View style={[{ alignItems: 'center' }, animatedIconStyle]}>
        <View>
          <IconComponent size={24} color={color} strokeWidth={isActive ? 2.5 : 1.8} />
          {badge != null && badge > 0 ? (
            <View
              style={{
                position: 'absolute',
                top: -4,
                right: -8,
                backgroundColor: '#EF4444',
                borderRadius: 8,
                minWidth: 16,
                height: 16,
                alignItems: 'center',
                justifyContent: 'center',
                paddingHorizontal: 4,
              }}
            >
              <Text
                style={{
                  color: '#FFFFFF',
                  fontSize: 10,
                  fontWeight: '700',
                }}
              >
                {badge > 99 ? '99+' : badge}
              </Text>
            </View>
          ) : null}
        </View>
      </Animated.View>
    </Pressable>
  );
}

export default function FloatingTabBar({ activeTab, onTabPress, onCreatePress }: FloatingTabBarProps) {
  const insets = useSafeAreaInsets();
  const { data: notificationsData = [] } = useQuery({ queryKey: ['notifications'], queryFn: () => api.get<Notification[]>('/api/notifications') });
  const { data: conversationsData = [] } = useQuery({ queryKey: ['conversations'], queryFn: () => api.get<Conversation[]>('/api/conversations') });
  const unreadNotifications = notificationsData.filter((n: Notification) => !n.read).length;
  const totalUnreadMessages = conversationsData.reduce((sum: number, c: Conversation) => sum + c.unreadCount, 0);

  const getBadge = (index: number): number | undefined => {
    if (index === 1) return unreadNotifications;
    if (index === 3) return totalUnreadMessages;
    return undefined;
  };

  return (
    <View
      testID="floating-tab-bar"
      style={{
        position: 'absolute',
        bottom: insets.bottom + 8,
        left: 20,
        right: 20,
        height: TAB_BAR_HEIGHT,
        borderRadius: TAB_BAR_HEIGHT / 2,
        overflow: 'hidden',
      }}
    >
      <BlurView
        intensity={80}
        tint="dark"
        style={{
          flex: 1,
          borderRadius: TAB_BAR_HEIGHT / 2,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-around',
            paddingHorizontal: 8,
            backgroundColor: 'rgba(10, 31, 68, 0.85)',
            borderRadius: TAB_BAR_HEIGHT / 2,
          }}
        >
          {TABS.map((tab, index) => (
            <TabButton
              key={tab.label}
              item={tab}
              index={index}
              isActive={activeTab === index}
              onPress={() => {
                if (tab.isCreate) {
                  onCreatePress();
                } else {
                  onTabPress(index);
                }
              }}
              badge={getBadge(index)}
            />
          ))}
        </View>
      </BlurView>
    </View>
  );
}
