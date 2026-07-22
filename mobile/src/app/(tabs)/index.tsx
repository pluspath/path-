import React from 'react';
import { View, Text, Pressable, RefreshControl, ActivityIndicator } from 'react-native';
import { FlashList, ViewToken } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToggleReaction } from '@/lib/use-toggle-reaction';
import { Post, User } from '@/lib/types';
import { api } from '@/lib/api';
import PostCard from '@/components/PostCard';
import { useSession } from '@/lib/auth/use-session';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { MOMENT_CONFIG } from '@/lib/mock-data';

function formatTimelineDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface TimelinePostRowProps {
  post: Post;
  index: number;
  total: number;
  currentUserId: string;
  onReact: (type: string) => void;
  onDelete: (postId: string) => void;
  isVisible: boolean;
}

function TimelinePostRow({ post, index, total, currentUserId, onReact, onDelete, isVisible }: TimelinePostRowProps) {
  const isFirst = index === 0;
  const isLast = index === total - 1;
  const typeColor = MOMENT_CONFIG[post.type]?.color ?? '#0A1F44';
  const lineColor = typeColor + '40';

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 60).springify()}
      style={{ flexDirection: 'row', paddingLeft: 12 }}
    >
      {/* Timeline column */}
      <View style={{ width: 36, alignItems: 'center' }}>
        {/* Line above dot */}
        <View
          style={{
            width: 2,
            flex: isFirst ? 0 : 1,
            minHeight: isFirst ? 0 : 16,
            backgroundColor: isFirst ? 'transparent' : lineColor,
          }}
        />
        {/* Dot */}
        <View
          style={{
            width: 10,
            height: 10,
            borderRadius: 5,
            backgroundColor: typeColor,
            borderWidth: 2,
            borderColor: '#F8F6F2',
            shadowColor: typeColor,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.3,
            shadowRadius: 3,
          }}
        />
        {/* Line below dot */}
        <View
          style={{
            width: 2,
            flex: 1,
            minHeight: isLast ? 0 : 16,
            backgroundColor: isLast ? 'transparent' : lineColor,
          }}
        />
      </View>

      {/* Content column */}
      <View style={{ flex: 1, paddingRight: 12, paddingBottom: 4 }}>
        {/* Timestamp on timeline */}
        <Text
          style={{
            fontSize: 10,
            color: '#94A3B8',
            fontWeight: '600',
            marginBottom: 4,
            marginTop: 0,
            letterSpacing: 0.3,
            textTransform: 'uppercase',
          }}
        >
          {formatTimelineDate(post.createdAt)}
        </Text>
        <PostCard
          post={post}
          currentUserId={currentUserId}
          onReact={onReact}
          onDelete={onDelete}
          isVisible={isVisible}
        />
        <View style={{ height: 8 }} />
      </View>
    </Animated.View>
  );
}

export default function HomeFeed() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();

  const { data: myProfile } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<User>('/api/me'),
    enabled: !!session?.user?.id,
    staleTime: 0,
  });

  const { data: posts = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['posts'],
    queryFn: () => api.get<Post[]>('/api/posts'),
    enabled: !!session?.user?.id,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const toggleReaction = useToggleReaction(['posts'], session?.user?.id ?? '');

  const { mutate: deletePost } = useMutation({
    mutationFn: (postId: string) => api.delete(`/api/posts/${postId}`),
    onSuccess: (_, postId) => {
      queryClient.setQueryData<Post[]>(['posts'], (old) => old?.filter(p => p.id !== postId) ?? []);
    },
  });

  const [visibleIds, setVisibleIds] = React.useState<Set<string>>(new Set());

  const viewabilityConfig = React.useRef({ itemVisiblePercentThreshold: 50 });
  const onViewableItemsChanged = React.useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<Post>[] }) => {
      setVisibleIds(new Set(viewableItems.map((v) => v.item.id)));
    },
    []
  );

  const renderItem = React.useCallback(
    ({ item, index }: { item: Post; index: number }) => (
      <TimelinePostRow
        post={item}
        index={index}
        total={posts.length}
        currentUserId={session?.user?.id ?? ''}
        onReact={(type) => toggleReaction({ postId: item.id, type })}
        onDelete={(postId) => deletePost(postId)}
        isVisible={visibleIds.has(item.id)}
      />
    ),
    [session, toggleReaction, deletePost, posts.length, visibleIds]
  );

  return (
    <View className="flex-1 bg-[#F8F6F2]" testID="home-feed-screen">
      <SafeAreaView edges={['top']} style={{ backgroundColor: '#0A1F44' }}>
        <View className="flex-row items-center justify-between px-5 pb-3 pt-1" style={{ backgroundColor: '#0A1F44' }}>
          <Text style={{ fontFamily: 'System', fontSize: 28, fontWeight: '700', color: '#FFFFFF', letterSpacing: -0.5 }}>
            Path<Text style={{ color: '#FFFFFF', fontSize: 32, fontWeight: '300' }}>+</Text>
          </Text>
          <Pressable testID="home-avatar">
            <Image
              source={{ uri: myProfile?.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${session?.user?.id}` }}
              style={{ width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: '#FFFFFF' }}
            />
          </Pressable>
        </View>
      </SafeAreaView>

      <FlashList
        data={posts}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 120 }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor="#0A1F44"
            colors={['#0A1F44']}
          />
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 }}>
              <ActivityIndicator size="large" color="#0A1F44" />
              <Text style={{ color: '#94A3B8', fontSize: 14, marginTop: 12 }}>Loading your feed...</Text>
            </View>
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 }}>
              <Text style={{ fontSize: 40, marginBottom: 12 }}>✨</Text>
              <Text style={{ fontSize: 18, fontWeight: '700', color: '#0A1F44', marginBottom: 6 }}>No moments yet</Text>
              <Text style={{ fontSize: 14, color: '#8B8B8B' }}>Share your first moment!</Text>
            </View>
          )
        }
        testID="home-feed-list"
      />
    </View>
  );
}
