import React from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { api } from '@/lib/api';
import { getTimeAgo } from '@/lib/mock-data';
import { Notification } from '@/lib/types';
import { X } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';

function getNotificationDisplay(n: Notification): { emoji: string; text: string } {
  const msg = n.message ?? '';
  switch (n.type) {
    case 'reaction':
      if (msg.toLowerCase().includes('loved') || msg.includes('❤️')) {
        return { emoji: '❤️', text: 'loved your moment' };
      }
      if (msg.toLowerCase().includes('smil') || msg.includes('😊')) {
        return { emoji: '😊', text: 'smiled at your photo' };
      }
      if (msg.toLowerCase().includes('wow') || msg.includes('😮')) {
        return { emoji: '😮', text: 'reacted to your moment' };
      }
      return { emoji: '❤️', text: 'loved your moment' };
    case 'comment': {
      const preview = msg.length > 30 ? msg.slice(0, 30) + '...' : msg;
      return { emoji: '💬', text: `commented: ${preview}` };
    }
    case 'friend_request':
      return { emoji: '👤', text: 'sent you a friend request' };
    case 'friend_accepted':
      return { emoji: '🤝', text: 'accepted your friend request' };
    case 'sleep':
      return { emoji: '🌙', text: msg || 'is going to sleep' };
    case 'ping':
      return { emoji: '👋', text: 'sent you a ping' };
    case 'memory':
      return { emoji: '📸', text: msg || 'has a memory for you' };
    default:
      return { emoji: '🔔', text: msg };
  }
}

const TYPE_LABELS: Record<string, string> = {
  reaction: 'Reactions',
  comment: 'Comments',
  friend_request: 'Friend Requests',
  friend_accepted: 'Friend Activity',
  sleep: 'Sleep',
  memory: 'Memories',
  ping: 'Pings',
};

// Colored thumbnail by notification type when no post image
const TYPE_COLORS: Record<string, string> = {
  reaction: '#FEE2E2',
  comment: '#DBEAFE',
  friend_request: '#F3E8FF',
  friend_accepted: '#DCFCE7',
  sleep: '#E0E7FF',
  memory: '#DCFCE7',
  ping: '#FEF9C3',
};

export default function NotificationsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<Notification[]>('/api/notifications'),
  });

  const { mutate: markRead } = useMutation({
    mutationFn: (id: string) => api.post(`/api/notifications/${id}/read`),
    onSuccess: (_, id) => {
      queryClient.setQueryData<Notification[]>(['notifications'], (old) =>
        old?.map((n) => (n.id === id ? { ...n, read: true } : n)) ?? []
      );
    },
  });

  const [dismissed, setDismissed] = React.useState<string[]>([]);
  const [acceptedFriends, setAcceptedFriends] = React.useState<Set<string>>(new Set());
  const [acceptingIds, setAcceptingIds] = React.useState<Set<string>>(new Set());
  const acceptingRef = React.useRef<Set<string>>(new Set());

  const { mutate: acceptFriendRequest } = useMutation({
    mutationFn: ({ friendshipId }: { notifId: string; friendshipId: string }) =>
      api.post(`/api/friends/accept/${friendshipId}`),
    onMutate: async ({ notifId }) => {
      acceptingRef.current.add(notifId);
      setAcceptingIds(prev => new Set([...prev, notifId]));
      setAcceptedFriends(prev => new Set([...prev, notifId]));
      await queryClient.cancelQueries({ queryKey: ['friends'] });
      await queryClient.cancelQueries({ queryKey: ['notifications'] });
      const prevFriends = queryClient.getQueryData(['friends']);
      const prevNotifications = queryClient.getQueryData(['notifications']);
      return { notifId, prevFriends, prevNotifications };
    },
    onError: (_err, _vars, context) => {
      if (!context) return;
      setAcceptingIds(prev => { const next = new Set(prev); next.delete(context.notifId); return next; });
      setAcceptedFriends(prev => { const next = new Set(prev); next.delete(context.notifId); return next; });
      if (context.prevFriends) queryClient.setQueryData(['friends'], context.prevFriends);
      if (context.prevNotifications) queryClient.setQueryData(['notifications'], context.prevNotifications);
    },
    onSettled: (_data, _error, vars) => {
      acceptingRef.current.delete(vars.notifId);
      setAcceptingIds(prev => { const next = new Set(prev); next.delete(vars.notifId); return next; });
      queryClient.refetchQueries({ queryKey: ['friends'] });
      queryClient.refetchQueries({ queryKey: ['notifications'] });
    },
  });

  const visibleNotifications = notifications.filter((n: Notification) => !dismissed.includes(n.id));

  const handleTap = (n: Notification) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    markRead(n.id);
    if (n.type === 'friend_request' || n.type === 'friend_accepted') {
      router.push(`/friend-profile/${n.user.id}` as any);
    } else if ((n.type === 'sleep' || n.type === 'reaction' || n.type === 'comment') && n.postId) {
      router.push(`/post/${n.postId}` as any);
    }
  };

  const handleAvatarTap = (n: Notification) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/friend-profile/${n.user.id}` as any);
  };

  const handleDismiss = (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setDismissed((prev) => [...prev, id]);
  };

  const typeGroups = React.useMemo(() => {
    const groups: Record<string, Notification[]> = {};
    visibleNotifications.forEach((n: Notification) => {
      const label = TYPE_LABELS[n.type] ?? 'Other';
      if (!groups[label]) groups[label] = [];
      groups[label].push(n);
    });
    return groups;
  }, [visibleNotifications]);

  return (
    <View className="flex-1 bg-[#F8F6F2]" testID="notifications-screen">
      <SafeAreaView edges={['top']} style={{ backgroundColor: '#0A1F44' }}>
        <View className="px-5 pb-3 pt-1" style={{ backgroundColor: '#0A1F44' }}>
          <Text className="text-2xl font-bold" style={{ color: '#F8F6F2' }}>Notifications</Text>
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ paddingBottom: 120 }} testID="notifications-scroll">
        {Object.entries(typeGroups).map(([label, items]) => (
          <View key={label} className="mt-4">
            <Text className="px-5 pb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: '#8B8B8B' }}>
              {label}
            </Text>
            {items.map((n: Notification) => {
              const { emoji, text } = getNotificationDisplay(n);
              const bgColor = TYPE_COLORS[n.type] ?? '#F3F4F6';
              return (
                <React.Fragment key={n.id}>
                <Pressable
                  testID={`notification-${n.id}`}
                  onPress={() => handleTap(n)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                    backgroundColor: n.read ? 'transparent' : 'rgba(201,168,76,0.06)',
                    gap: 10,
                  }}
                >
                  {/* Unread dot */}
                  <View style={{ width: 8 }}>
                    {!n.read ? (
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#C9A84C' }} />
                    ) : null}
                  </View>

                  {/* User avatar */}
                  <Pressable
                    testID={`avatar-${n.id}`}
                    onPress={() => handleAvatarTap(n)}
                    style={{ position: 'relative' }}
                  >
                    <Image
                      source={{ uri: n.user.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${n.user.id}` }}
                      style={{ width: 46, height: 46, borderRadius: 23 }}
                    />
                    {/* Emoji badge */}
                    <View style={{
                      position: 'absolute',
                      bottom: -2,
                      right: -4,
                      width: 20,
                      height: 20,
                      borderRadius: 10,
                      backgroundColor: '#FFFFFF',
                      alignItems: 'center',
                      justifyContent: 'center',
                      shadowColor: '#000',
                      shadowOffset: { width: 0, height: 1 },
                      shadowOpacity: 0.1,
                      shadowRadius: 2,
                    }}>
                      <Text style={{ fontSize: 11 }}>{emoji}</Text>
                    </View>
                  </Pressable>

                  {/* Text content */}
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, color: '#0A1F44', lineHeight: 19 }}>
                      <Text style={{ fontWeight: '700' }}>{n.user.name}</Text>
                      {' '}
                      <Text style={{ color: '#374151' }}>{text}</Text>
                    </Text>
                    <Text style={{ fontSize: 12, color: '#9CA3AF', marginTop: 2 }}>
                      {getTimeAgo(n.createdAt)}
                    </Text>
                  </View>

                  {/* Post thumbnail if available */}
                  {n.postImage ? (
                    <Image
                      source={{ uri: n.postImage }}
                      style={{ width: 48, height: 48, borderRadius: 8 }}
                      contentFit="cover"
                    />
                  ) : n.postId ? (
                    <View style={{
                      width: 48,
                      height: 48,
                      borderRadius: 8,
                      backgroundColor: bgColor,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                      <Text style={{ fontSize: 22 }}>{emoji}</Text>
                    </View>
                  ) : null}

                  {/* Dismiss button */}
                  <Pressable
                    testID={`dismiss-${n.id}`}
                    onPress={() => handleDismiss(n.id)}
                    hitSlop={12}
                    style={{ padding: 4 }}
                  >
                    <X size={16} color="#C4C4C4" />
                  </Pressable>
                </Pressable>

                {/* Accept/Decline for friend requests */}
                {n.type === 'friend_request' && n.friendshipId ? (
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, marginLeft: 8 + 8 + 46, marginBottom: 4 }}>
                    {acceptedFriends.has(n.id) && !acceptingIds.has(n.id) ? (
                      <View style={{ backgroundColor: '#E8F5E9', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 }}>
                        <Text style={{ color: '#2E7D32', fontSize: 13, fontWeight: '600' }}>Friends ✓</Text>
                      </View>
                    ) : (
                      <Pressable
                        testID={`accept-friend-${n.id}`}
                        disabled={acceptingIds.has(n.id)}
                        onPress={() => {
                          if (acceptingRef.current.has(n.id)) return;
                          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                          markRead(n.id);
                          acceptFriendRequest({ notifId: n.id, friendshipId: n.friendshipId! });
                        }}
                        style={{ backgroundColor: '#0A1F44', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7, opacity: acceptingIds.has(n.id) ? 0.6 : 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        {acceptingIds.has(n.id) ? (
                          <ActivityIndicator size="small" color="#FFFFFF" testID={`accept-loading-${n.id}`} />
                        ) : null}
                        <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '600' }}>Accept</Text>
                      </Pressable>
                    )}
                    <Pressable
                      testID={`decline-friend-${n.id}`}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                        api.delete(`/api/friends/${n.friendshipId}`).then(() => {
                          queryClient.invalidateQueries({ queryKey: ['notifications'] });
                        });
                        handleDismiss(n.id);
                      }}
                      style={{ backgroundColor: '#F3F4F6', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 }}>
                      <Text style={{ color: '#6B7280', fontSize: 13, fontWeight: '600' }}>Decline</Text>
                    </Pressable>
                  </View>
                ) : null}
                </React.Fragment>
              );
            })}
          </View>
        ))}

        {visibleNotifications.length === 0 ? (
          <View className="items-center py-20">
            <Text style={{ fontSize: 40, marginBottom: 12 }}>🔔</Text>
            <Text className="text-lg font-semibold" style={{ color: '#0A1F44' }}>All caught up</Text>
            <Text className="text-sm mt-1" style={{ color: '#8B8B8B' }}>No new notifications</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
