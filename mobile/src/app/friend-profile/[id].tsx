import React from 'react';
import { View, Text, Pressable, ScrollView, Dimensions, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { AvatarViewer } from '@/components/AvatarViewer';
import { ChevronLeft, MessageCircle, UserMinus, MapPin, UserPlus, Check, X, Lock } from 'lucide-react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Post, Conversation, User, FriendRequest } from '@/lib/types';
import { useToggleReaction } from '@/lib/use-toggle-reaction';
import * as Haptics from 'expo-haptics';
import { useSession } from '@/lib/auth/use-session';
import PostCard from '@/components/PostCard';

const { width } = Dimensions.get('window');
const COVER_HEIGHT = 180;
const AVATAR_SIZE = 76;

interface FriendProfile {
  id: string;
  name: string;
  avatar?: string;
  coverPhoto?: string;
  bio?: string;
  location?: string;
  postCount: number;
  friendCount: number;
  momentCount: number;
}

interface FriendshipStatus {
  status: 'none' | 'pending_sent' | 'pending_received' | 'friends';
  friendshipId: string | null;
  mutualFriends: number;
}

export default function FriendProfileScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const currentUserId = session?.user?.id ?? '';
  const [viewingAvatar, setViewingAvatar] = React.useState<string | null>(null);

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['friend-profile', id],
    queryFn: () => api.get<FriendProfile>(`/api/${id}`),
    enabled: !!id,
    placeholderData: () => {
      const fd = queryClient.getQueryData<{ friends: User[]; requests: FriendRequest[]; suggested: User[] }>(['friends']);
      const fromList = [...(fd?.friends ?? []), ...(fd?.suggested ?? [])].find((u) => u.id === id);
      if (fromList) return fromList as unknown as FriendProfile;
      const posts = queryClient.getQueryData<Post[]>(['posts']);
      const fromPosts = posts?.find((p) => p.userId === id)?.user;
      return fromPosts ? (fromPosts as unknown as FriendProfile) : undefined;
    },
  });

  const { data: friendPosts = [] } = useQuery({
    queryKey: ['friend-posts', id],
    queryFn: () => api.get<Post[]>(`/api/${id}/posts`),
    enabled: !!id,
    placeholderData: () => {
      const posts = queryClient.getQueryData<Post[]>(['posts']);
      return posts?.filter((p) => p.userId === id) ?? [];
    },
  });

  const { data: friendStatus } = useQuery({
    queryKey: ['friendship-status', id],
    queryFn: () => api.get<FriendshipStatus>(`/api/friends/status/${id}`),
    enabled: !!id,
    placeholderData: () => {
      const fd = queryClient.getQueryData<{ friends: User[]; requests: FriendRequest[]; suggested: User[] }>(['friends']);
      const friend = fd?.friends?.find((u) => u.id === id);
      if (friend) return { status: 'friends' as const, friendshipId: friend.friendshipId ?? null, mutualFriends: 0 };
      const suggested = fd?.suggested?.find((u) => u.id === id);
      if (suggested) return { status: (suggested.friendshipStatus ?? 'none') as FriendshipStatus['status'], friendshipId: suggested.friendshipId ?? null, mutualFriends: 0 };
      return undefined;
    },
  });

  const photoPosts = friendPosts.filter((p) => p.image);

  const { mutate: addFriend, isPending: isAdding } = useMutation({
    mutationFn: () => api.post(`/api/friends/request/${id}`),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ['friendship-status', id] });
      queryClient.invalidateQueries({ queryKey: ['friends'] });
    },
  });

  const { mutate: removeFriend, isPending: isRemoving } = useMutation({
    mutationFn: () => api.delete(`/api/friends/${friendStatus?.friendshipId}`),
    onSuccess: () => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      queryClient.invalidateQueries({ queryKey: ['friendship-status', id] });
      queryClient.invalidateQueries({ queryKey: ['friends'] });
    },
  });

  const { mutate: acceptFriend, isPending: isAccepting } = useMutation({
    mutationFn: () => api.post(`/api/friends/accept/${friendStatus?.friendshipId}`),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ['friendship-status', id] });
      queryClient.invalidateQueries({ queryKey: ['friends'] });
    },
  });

  const { mutate: startConversation, isPending: isStartingConversation } = useMutation({
    mutationFn: () => {
      console.log('[Message] Button tapped — calling POST /api/conversations/start/' + id);
      return api.post<Conversation>(`/api/conversations/start/${id}`);
    },
    onSuccess: (conversation) => {
      console.log('[Message] API success — conversation:', JSON.stringify(conversation));
      const route = `/chat/${conversation.id}`;
      console.log('[Message] Navigating to:', route);
      router.push(route as any);
    },
    onError: (err) => {
      console.error('[Message] API error:', err);
    },
  });

  const toggleReaction = useToggleReaction(['friend-posts', id], currentUserId);

  if (profileLoading) {
    return (
      <View className="flex-1 bg-[#F8F6F2] items-center justify-center" testID="friend-profile-screen">
        <ActivityIndicator size="large" color="#FFFFFF" />
      </View>
    );
  }

  if (!profile) {
    return (
      <View className="flex-1 bg-[#F8F6F2] items-center justify-center" testID="friend-profile-screen">
        <Text style={{ color: '#8B8B8B' }}>User not found</Text>
      </View>
    );
  }

  const status = friendStatus?.status ?? 'none';

  const renderActionButtons = () => {
    if (status === 'friends') {
      return (
        <View className="flex-row px-6 mt-4" style={{ gap: 12 }}>
          <Pressable
            testID="friend-message-button"
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              startConversation();
            }}
            disabled={isStartingConversation}
            className="flex-1 flex-row items-center justify-center rounded-xl py-3"
            style={{ backgroundColor: '#FFFFFF', opacity: isStartingConversation ? 0.6 : 1 }}
          >
            <MessageCircle size={18} color="#0A1F44" />
            <Text className="text-sm font-semibold ml-2" style={{ color: '#0A1F44' }}>Message</Text>
          </Pressable>
          <Pressable
            testID="friend-remove-button"
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              removeFriend();
            }}
            disabled={isRemoving}
            className="flex-row items-center justify-center rounded-xl py-3 px-5"
            style={{ borderWidth: 1.5, borderColor: '#EF4444' }}
          >
            <UserMinus size={18} color="#EF4444" />
          </Pressable>
        </View>
      );
    }

    if (status === 'pending_received') {
      return (
        <View className="flex-row px-6 mt-4" style={{ gap: 12 }}>
          <Pressable
            testID="friend-accept-button"
            onPress={() => {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              acceptFriend();
            }}
            disabled={isAccepting}
            className="flex-1 flex-row items-center justify-center rounded-xl py-3"
            style={{ backgroundColor: '#22C55E' }}
          >
            <Check size={18} color="#FFFFFF" />
            <Text className="text-sm font-semibold ml-2" style={{ color: '#FFFFFF' }}>Accept</Text>
          </Pressable>
          <Pressable
            testID="friend-decline-button"
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              removeFriend();
            }}
            disabled={isRemoving}
            className="flex-row items-center justify-center rounded-xl py-3 px-5"
            style={{ borderWidth: 1.5, borderColor: '#EF4444' }}
          >
            <X size={18} color="#EF4444" />
          </Pressable>
        </View>
      );
    }

    if (status === 'pending_sent') {
      return (
        <View className="flex-row px-6 mt-4" style={{ gap: 12 }}>
          <View
            className="flex-1 flex-row items-center justify-center rounded-xl py-3"
            style={{ backgroundColor: '#E5E7EB' }}
          >
            <Text className="text-sm font-semibold" style={{ color: '#8B8B8B' }}>Request Sent</Text>
          </View>
          <Pressable
            testID="friend-cancel-request-button"
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              removeFriend();
            }}
            disabled={isRemoving}
            className="flex-row items-center justify-center rounded-xl py-3 px-5"
            style={{ borderWidth: 1.5, borderColor: '#8B8B8B' }}
          >
            <X size={18} color="#8B8B8B" />
          </Pressable>
        </View>
      );
    }

    // status === 'none'
    return (
      <View className="flex-row px-6 mt-4">
        <Pressable
          testID="friend-add-button"
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            addFriend();
          }}
          disabled={isAdding}
          className="flex-1 flex-row items-center justify-center rounded-xl py-3"
          style={{ backgroundColor: '#FFFFFF' }}
        >
          <UserPlus size={18} color="#0A1F44" />
          <Text className="text-sm font-semibold ml-2" style={{ color: '#0A1F44' }}>Add Friend</Text>
        </Pressable>
      </View>
    );
  };

  return (
    <View className="flex-1 bg-[#F8F6F2]" testID="friend-profile-screen">
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Cover Photo */}
        <View style={{ height: COVER_HEIGHT, overflow: 'hidden' }}>
          <Image
            source={{ uri: profile.coverPhoto }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
          />
          <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(10,31,68,0.25)' }} />
        </View>

        {/* Back button */}
        <SafeAreaView edges={['top']} style={{ position: 'absolute', top: 0, left: 0, zIndex: 10 }}>
          <Pressable
            testID="friend-profile-back"
            onPress={() => { if (router.canGoBack()) router.back(); else router.replace('/(tabs)'); }}
            style={{
              backgroundColor: 'rgba(0,0,0,0.3)',
              borderRadius: 20,
              width: 40,
              height: 40,
              alignItems: 'center',
              justifyContent: 'center',
              marginLeft: 16,
              marginTop: 4,
            }}
          >
            <ChevronLeft size={24} color="#F8F6F2" />
          </Pressable>
        </SafeAreaView>

        {/* Avatar */}
        <View style={{ alignItems: 'center', marginTop: -AVATAR_SIZE / 2, zIndex: 5 }}>
          <Pressable
            onPress={() => setViewingAvatar(profile.avatar ?? null)}
            style={{
              width: AVATAR_SIZE + 4,
              height: AVATAR_SIZE + 4,
              borderRadius: (AVATAR_SIZE + 4) / 2,
              backgroundColor: '#F8F6F2',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Image
              source={{ uri: profile.avatar }}
              style={{ width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2 }}
            />
          </Pressable>
        </View>
        <AvatarViewer uri={viewingAvatar} onClose={() => setViewingAvatar(null)} />

        {/* Name & Bio */}
        <View className="items-center px-6 mt-3">
          <Text className="text-xl font-bold" style={{ color: '#0A1F44' }}>{profile.name}</Text>
          {profile.bio ? (
            <Text className="text-sm mt-1 text-center" style={{ color: '#8B8B8B' }}>{profile.bio}</Text>
          ) : null}
          {profile.location ? (
            <View className="flex-row items-center mt-2">
              <MapPin size={14} color="#8B8B8B" />
              <Text className="text-xs ml-1" style={{ color: '#8B8B8B' }}>{profile.location}</Text>
            </View>
          ) : null}
        </View>

        {/* Stats */}
        <View className="flex-row items-center justify-center mt-4 px-10">
          <View className="flex-1 items-center">
            <Text className="text-lg font-bold" style={{ color: '#0A1F44' }}>{profile.postCount}</Text>
            <Text className="text-xs" style={{ color: '#8B8B8B' }}>Posts</Text>
          </View>
          <View style={{ width: 1, height: 28, backgroundColor: '#E5E7EB' }} />
          <View className="flex-1 items-center">
            <Text className="text-lg font-bold" style={{ color: '#0A1F44' }}>{profile.friendCount}</Text>
            <Text className="text-xs" style={{ color: '#8B8B8B' }}>Friends</Text>
          </View>
          <View style={{ width: 1, height: 28, backgroundColor: '#E5E7EB' }} />
          <View className="flex-1 items-center">
            <Text className="text-lg font-bold" style={{ color: '#0A1F44' }}>{friendStatus?.mutualFriends ?? 0}</Text>
            <Text className="text-xs" style={{ color: '#8B8B8B' }}>Mutual</Text>
          </View>
        </View>

        {/* Action buttons */}
        {renderActionButtons()}

        {/* Photo Grid */}
        {photoPosts.length > 0 ? (
          <View className="mt-6 px-4">
            <Text className="text-base font-bold mb-3" style={{ color: '#0A1F44' }}>Photos</Text>
            <View className="flex-row flex-wrap" style={{ gap: 3 }}>
              {photoPosts.map((post) => (
                <View key={post.id} style={{ width: (width - 38) / 3, height: (width - 38) / 3, borderRadius: 8, overflow: 'hidden' }}>
                  <Image
                    source={{ uri: post.image }}
                    style={{ width: '100%', height: '100%' }}
                    contentFit="cover"
                  />
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* Moments Timeline */}
        <View style={{ marginTop: 24, paddingHorizontal: 16, paddingBottom: 40 }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: '#0A1F44', marginBottom: 12 }}>Moments</Text>

          {status !== 'friends' ? (
            /* Locked state for non-friends */
            <View style={{
              alignItems: 'center',
              paddingVertical: 32,
              backgroundColor: '#FFFFFF',
              borderRadius: 16,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.05,
              shadowRadius: 8,
            }}>
              <View style={{
                width: 52,
                height: 52,
                borderRadius: 26,
                backgroundColor: '#F3F4F6',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 12,
              }}>
                <Lock size={24} color="#9CA3AF" />
              </View>
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#0A1F44', marginBottom: 4 }}>Posts are private</Text>
              <Text style={{ fontSize: 13, color: '#9CA3AF', textAlign: 'center', paddingHorizontal: 24 }}>
                {status === 'pending_sent' ? 'Friend request sent — waiting for acceptance' : 'Add as a friend to see their moments'}
              </Text>
            </View>
          ) : friendPosts.length === 0 ? (
            <View style={{
              alignItems: 'center',
              paddingVertical: 32,
              backgroundColor: '#FFFFFF',
              borderRadius: 16,
            }}>
              <Text style={{ fontSize: 32, marginBottom: 8 }}>✨</Text>
              <Text style={{ fontSize: 14, color: '#9CA3AF' }}>No moments shared yet</Text>
            </View>
          ) : (
            friendPosts.map((post) => (
              <View key={post.id} style={{ marginBottom: 12 }}>
                <PostCard
                  post={post}
                  currentUserId={currentUserId}
                  onReact={(type) => toggleReaction({ postId: post.id, type })}
                />
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}
