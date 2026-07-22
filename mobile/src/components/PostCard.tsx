import React, { useCallback, useRef, useEffect } from 'react';
import { View, Text, Pressable, Modal, TextInput, ActivityIndicator, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { WebView } from 'react-native-webview';
import { Image } from 'expo-image';
import { MapPin, Moon, Sun, Pin, Play } from 'lucide-react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withRepeat,
  withSequence,
  withDelay,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Post, MomentType, VenueCategory } from '@/lib/types';
import { AvatarViewer } from '@/components/AvatarViewer';
import { EditMomentModal } from '@/components/EditMomentModal';
import { MOMENT_CONFIG, getTimeAgo } from '@/lib/mock-data';
import { api } from '@/lib/api';

const REACTION_TYPES = ['❤️', '😊', '😮', '😢'] as const;
const MAX_VISIBLE_COMMENTS = 2;

const VENUE_CATEGORY_MAP: Record<VenueCategory, { emoji: string; label: string }> = {
  coffee: { emoji: '☕', label: 'Coffee Shop' },
  restaurant: { emoji: '🍽️', label: 'Restaurant' },
  bar: { emoji: '🍸', label: 'Bar' },
  gym: { emoji: '💪', label: 'Gym' },
  park: { emoji: '🌳', label: 'Park' },
  home: { emoji: '🏠', label: 'Home' },
  work: { emoji: '💼', label: 'Work' },
  airport: { emoji: '✈️', label: 'Airport' },
  hotel: { emoji: '🏨', label: 'Hotel' },
  store: { emoji: '🛍️', label: 'Store' },
};

interface Comment {
  id: string;
  postId: string;
  userId: string;
  content: string;
  createdAt: string;
  user: { id: string; name: string; avatar: string };
}

interface PostCardProps {
  post: Post;
  onReact?: (type: string) => void;
  onDelete?: (postId: string) => void;
  onComment?: (postId: string, text: string) => Promise<void> | void;
  onDeleteComment?: (postId: string, commentId: string) => void;
  currentUserId?: string;
  isVisible?: boolean;
}

function MomentBadge({ type }: { type: MomentType }) {
  const config = MOMENT_CONFIG[type] ?? { color: '#8B8B8B', icon: '✦', label: type };
  return (
    <View
      style={{ backgroundColor: config.color + '20', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3 }}
    >
      <Text style={{ fontSize: 11, color: config.color, fontWeight: '600' }}>
        {config.icon} {config.label}
      </Text>
    </View>
  );
}

function EqualizerBars() {
  const bar1 = useSharedValue(0.4);
  const bar2 = useSharedValue(0.7);
  const bar3 = useSharedValue(0.5);

  React.useEffect(() => {
    bar1.value = withRepeat(
      withSequence(
        withSpring(1, { damping: 4, stiffness: 120 }),
        withSpring(0.3, { damping: 4, stiffness: 120 }),
      ),
      -1,
      true,
    );
    bar2.value = withRepeat(
      withSequence(
        withSpring(0.4, { damping: 3, stiffness: 100 }),
        withSpring(1, { damping: 3, stiffness: 100 }),
      ),
      -1,
      true,
    );
    bar3.value = withRepeat(
      withSequence(
        withSpring(0.8, { damping: 5, stiffness: 130 }),
        withSpring(0.2, { damping: 5, stiffness: 130 }),
      ),
      -1,
      true,
    );
  }, []);

  const bar1Style = useAnimatedStyle(() => ({
    height: bar1.value * 18,
    opacity: 0.9,
  }));
  const bar2Style = useAnimatedStyle(() => ({
    height: bar2.value * 18,
    opacity: 0.9,
  }));
  const bar3Style = useAnimatedStyle(() => ({
    height: bar3.value * 18,
    opacity: 0.9,
  }));

  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 18 }}>
      <Animated.View style={[{ width: 3, borderRadius: 2, backgroundColor: '#A78BFA' }, bar1Style]} />
      <Animated.View style={[{ width: 3, borderRadius: 2, backgroundColor: '#A78BFA' }, bar2Style]} />
      <Animated.View style={[{ width: 3, borderRadius: 2, backgroundColor: '#A78BFA' }, bar3Style]} />
    </View>
  );
}

function LocationBadge({ name, venueCategory }: { name: string; venueCategory?: VenueCategory }) {
  if (!venueCategory) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
        <MapPin size={14} color="#EF4444" />
        <Text style={{ fontSize: 14, fontWeight: '700', color: '#0A1F44', marginLeft: 4 }}>{name}</Text>
      </View>
    );
  }

  const cat = VENUE_CATEGORY_MAP[venueCategory];
  return (
    <View
      style={{
        backgroundColor: '#FFF1F2',
        borderRadius: 14,
        marginTop: 12,
        overflow: 'hidden',
        flexDirection: 'row',
      }}
    >
      <View style={{ flex: 1, padding: 12, flexDirection: 'row', alignItems: 'center' }}>
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: 24,
            backgroundColor: '#EF4444',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Text style={{ fontSize: 24 }}>{cat.emoji}</Text>
        </View>
        <View style={{ marginLeft: 12, flex: 1 }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: '#0A1F44' }} numberOfLines={1}>{name}</Text>
          <Text style={{ fontSize: 12, color: '#9CA3AF', marginTop: 1 }}>{cat.label}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
            <Pin size={11} color="#EF4444" />
            <Text style={{ fontSize: 11, fontWeight: '600', color: '#EF4444', marginLeft: 3 }}>Checked in</Text>
          </View>
        </View>
      </View>

      <View style={{ width: 80, backgroundColor: '#E2F0D9', alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.5 }}>
          <View style={{ position: 'absolute', left: 20, top: 0, bottom: 0, width: 1, backgroundColor: '#B7D1A8' }} />
          <View style={{ position: 'absolute', left: 50, top: 0, bottom: 0, width: 1, backgroundColor: '#B7D1A8' }} />
          <View style={{ position: 'absolute', top: 20, left: 0, right: 0, height: 1, backgroundColor: '#B7D1A8' }} />
          <View style={{ position: 'absolute', top: 45, left: 0, right: 0, height: 1, backgroundColor: '#B7D1A8' }} />
        </View>
        <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: '#EF4444', alignItems: 'center', justifyContent: 'center', zIndex: 1 }}>
          <MapPin size={14} color="#FFFFFF" />
        </View>
      </View>
    </View>
  );
}

function TwinkleStars() {
  const o0 = useSharedValue(0.2); const a0 = useAnimatedStyle(() => ({ opacity: o0.value }));
  const o1 = useSharedValue(0.2); const a1 = useAnimatedStyle(() => ({ opacity: o1.value }));
  const o2 = useSharedValue(0.2); const a2 = useAnimatedStyle(() => ({ opacity: o2.value }));
  const o3 = useSharedValue(0.2); const a3 = useAnimatedStyle(() => ({ opacity: o3.value }));
  const o4 = useSharedValue(0.2); const a4 = useAnimatedStyle(() => ({ opacity: o4.value }));

  React.useEffect(() => {
    const delays = [0, 400, 200, 600, 800];
    [o0, o1, o2, o3, o4].forEach((o, i) => {
      o.value = withDelay(delays[i], withRepeat(withSequence(
        withSpring(0.9, { damping: 8, stiffness: 60 }),
        withSpring(0.1, { damping: 8, stiffness: 60 }),
      ), -1, true));
    });
  }, []);

  const STAR_POSITIONS = [
    { left: 20, top: 12 }, { left: 60, top: 5 }, { left: 90, top: 18 },
    { left: 130, top: 8 }, { left: 45, top: 30 },
  ];
  const styles = [a0, a1, a2, a3, a4];

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} pointerEvents="none">
      {STAR_POSITIONS.map((pos, i) => (
        <Animated.View key={i} style={[{
          position: 'absolute', left: pos.left, top: pos.top,
          width: 4, height: 4, borderRadius: 2, backgroundColor: '#E0E7FF',
        }, styles[i]]} />
      ))}
    </View>
  );
}

function SleepBadge({ action, duration }: { action: 'sleeping' | 'woke_up'; duration?: string }) {
  const isSleeping = action === 'sleeping';
  return (
    <View
      style={{
        borderRadius: 16,
        overflow: 'hidden',
        marginTop: 12,
        backgroundColor: isSleeping ? '#0A1F44' : '#FFFBEB',
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
      }}
    >
      {isSleeping ? <TwinkleStars /> : null}

      <View
        style={{
          width: 52,
          height: 52,
          borderRadius: 26,
          backgroundColor: isSleeping ? '#6366F1' : '#F59E0B',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          zIndex: 1,
        }}
      >
        <Text style={{ fontSize: 28 }}>{isSleeping ? '🌙' : '☀️'}</Text>
      </View>

      <View style={{ marginLeft: 14, flex: 1, zIndex: 1 }}>
        <Text style={{ fontSize: 16, fontWeight: '700', color: isSleeping ? '#FFFFFF' : '#92400E' }}>
          {isSleeping ? 'Going to sleep' : 'Just woke up'}
        </Text>
        <Text style={{ fontSize: 12, color: isSleeping ? '#A5B4FC' : '#D97706', marginTop: 2 }}>
          {isSleeping ? 'Sweet dreams 💫' : 'Good morning! ☀️'}
        </Text>
      </View>

      {!isSleeping && duration ? (
        <View style={{ backgroundColor: '#FDE68A', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, zIndex: 1 }}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: '#92400E' }}>😴 {duration}</Text>
        </View>
      ) : null}
    </View>
  );
}

function isVideoUrl(url: string): boolean {
  return /\.(mp4|mov|avi|mkv|webm)$/i.test(url) || url.includes('/videos/');
}

function InlineVideo({ uri, isVisible }: { uri: string; isVisible?: boolean }) {
  const webViewRef = useRef<WebView>(null);

  useEffect(() => {
    const script = isVisible
      ? 'var v=document.querySelector("video"); if(v){v.play();} true;'
      : 'var v=document.querySelector("video"); if(v){v.pause();} true;';
    webViewRef.current?.injectJavaScript(script);
  }, [isVisible]);

  const videoHtml = `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{background:#000;overflow:hidden;}
video{width:100vw;height:100vh;object-fit:cover;display:block;}
</style>
</head>
<body>
<video src="${uri.replace(/"/g, '&quot;')}" loop muted playsinline autoplay webkit-playsinline></video>
</body>
</html>`;

  return (
    <View style={{ position: 'relative', height: 280, borderRadius: 16, overflow: 'hidden', marginTop: 12, backgroundColor: '#000' }}>
      <WebView
        ref={webViewRef}
        source={{ html: videoHtml }}
        style={{ flex: 1, backgroundColor: '#000' }}
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback={true}
        javaScriptEnabled
        scrollEnabled={false}
        allowsFullscreenVideo={false}
      />
      {/* Path+ watermark */}
      <View style={{
        position: 'absolute',
        bottom: 12,
        left: 12,
        backgroundColor: 'rgba(10,31,68,0.72)',
        borderRadius: 8,
        paddingHorizontal: 9,
        paddingVertical: 4,
      }}>
        <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '800', letterSpacing: 0.4 }}>Path+</Text>
      </View>
    </View>
  );
}

function ReactionButton({
  emoji,
  count,
  isActive,
  onPress,
}: {
  emoji: string;
  count: number;
  isActive: boolean;
  onPress: () => void;
}) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePress = useCallback(() => {
    scale.value = withSpring(1.3, { damping: 8, stiffness: 400 }, () => {
      scale.value = withSpring(1, { damping: 12, stiffness: 200 });
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  }, [onPress]);

  return (
    <Pressable onPress={handlePress}>
      <Animated.View
        style={[
          {
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 20,
            backgroundColor: isActive ? '#00000015' : 'transparent',
            borderWidth: isActive ? 1 : 0,
            borderColor: isActive ? '#00000040' : 'transparent',
          },
          animatedStyle,
        ]}
      >
        <Text style={{ fontSize: 18 }}>{emoji}</Text>
        {count > 0 ? (
          <Text
            style={{
              fontSize: 12,
              marginLeft: 4,
              fontWeight: '600',
              color: isActive ? '#0A1F44' : '#8B8B8B',
            }}
          >
            {count}
          </Text>
        ) : null}
      </Animated.View>
    </Pressable>
  );
}

function ReactorAvatars({ reactions }: { reactions: Post['reactions'] }) {
  if (reactions.length === 0) return null;

  // Get unique reactors (keep first reaction per user to preserve avatar)
  const seen = new Set<string>();
  const uniqueReactions: Post['reactions'] = [];
  for (const r of reactions) {
    if (!seen.has(r.userId)) {
      seen.add(r.userId);
      uniqueReactions.push(r);
    }
  }
  const visibleReactions = uniqueReactions.slice(0, 5);
  const extraCount = uniqueReactions.length - visibleReactions.length;

  // Emoji summary: show which emojis were used
  const usedEmojis = Array.from(new Set(reactions.map(r => r.type)));

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 6 }}>
      {/* Overlapping avatars */}
      <View style={{ flexDirection: 'row' }}>
        {visibleReactions.map((reaction, i) => (
          <View
            key={reaction.userId}
            style={{
              marginLeft: i === 0 ? 0 : -8,
              borderWidth: 2,
              borderColor: '#FFFFFF',
              borderRadius: 11,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.15,
              shadowRadius: 2,
            }}
          >
            <Image
              source={{ uri: reaction.userAvatar ?? `https://api.dicebear.com/7.x/avataaars/svg?seed=${reaction.userId}` }}
              style={{ width: 22, height: 22, borderRadius: 11 }}
            />
          </View>
        ))}
      </View>

      {/* Extra count */}
      {extraCount > 0 ? (
        <Text style={{ fontSize: 11, color: '#8B8B8B', fontWeight: '600' }}>+{extraCount}</Text>
      ) : null}

      {/* Emoji reaction summary */}
      <View style={{ flexDirection: 'row', gap: 2, marginLeft: 2 }}>
        {usedEmojis.map(emoji => (
          <Text key={emoji} style={{ fontSize: 14 }}>{emoji}</Text>
        ))}
      </View>
    </View>
  );
}

export default function PostCard({ post, onReact, onDelete, onComment, onDeleteComment, currentUserId = '', isVisible }: PostCardProps) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const scale = useSharedValue(1);
  const [showMenu, setShowMenu] = React.useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);
  const [showEditModal, setShowEditModal] = React.useState(false);
  const [viewingAvatarUri, setViewingAvatarUri] = React.useState<string | null>(null);
  const [commentText, setCommentText] = React.useState('');
  const [isSubmittingComment, setIsSubmittingComment] = React.useState(false);
  const [commentError, setCommentError] = React.useState<string | null>(null);
  const [showAllComments, setShowAllComments] = React.useState(false);

  const { data: comments = [], isLoading: isLoadingComments } = useQuery({
    queryKey: ['comments', post.id],
    queryFn: () => api.get<Comment[]>(`/api/posts/${post.id}/comments`),
    staleTime: 60_000,
  });

  const animatedCardStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const getReactionCount = (emoji: string) =>
    post.reactions.filter((r) => r.type === emoji).length;

  const isReactionActive = (emoji: string) =>
    post.reactions.some((r) => r.userId === (currentUserId ?? '') && r.type === emoji);

  const handleSubmitComment = async () => {
    if (!commentText.trim()) return;
    setIsSubmittingComment(true);
    setCommentError(null);
    try {
      const newComment = await api.post<Comment>(`/api/posts/${post.id}/comments`, { content: commentText.trim() });
      queryClient.setQueryData<Comment[]>(['comments', post.id], (prev) => [...(prev ?? []), newComment]);
      setCommentText('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      setCommentError(err?.message ?? 'Failed to post comment');
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const isOwner = post.userId === currentUserId && currentUserId !== '';

  const hasMoreComments = comments.length > MAX_VISIBLE_COMMENTS;
  const visibleComments = showAllComments ? comments : comments.slice(0, MAX_VISIBLE_COMMENTS);

  // Build the subtitle text: "2h ago • Riyadh Park"
  const timeText = getTimeAgo(post.createdAt);
  const subtitleParts: string[] = [timeText];
  if (post.locationName && post.type !== 'location') {
    subtitleParts.push(post.locationName);
  }

  return (
    <>
      <Pressable
        testID={`post-card-${post.id}`}
        onPressIn={() => {
          scale.value = withSpring(0.97, { damping: 15, stiffness: 300 });
        }}
        onPressOut={() => {
          scale.value = withSpring(1, { damping: 15, stiffness: 300 });
        }}
      >
        <Animated.View
          style={[
            {
              borderRadius: 16,
              padding: 16,
              backgroundColor: '#FFFFFF',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.06,
              shadowRadius: 8,
              elevation: 3,
              borderLeftWidth: 3,
              borderLeftColor: MOMENT_CONFIG[post.type]?.color ?? '#8B8B8B',
            },
            animatedCardStyle,
          ]}
        >
          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Pressable onPress={() => setViewingAvatarUri(post.user.avatar)}>
              <Image
                source={{ uri: post.user.avatar }}
                style={{ width: 44, height: 44, borderRadius: 22 }}
                contentFit="cover"
              />
            </Pressable>
            <View style={{ marginLeft: 12, flex: 1 }}>
              <Pressable
                testID={`post-author-name-${post.id}`}
                onPress={() => {
                  if (post.userId === currentUserId) return;
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push(`/friend-profile/${post.userId}` as any);
                }}
              >
                <Text style={{ fontSize: 16, fontWeight: '600', color: '#0A1F44' }}>
                  {post.user.name}
                </Text>
              </Pressable>
              <Text style={{ fontSize: 12, color: '#8B8B8B' }}>
                {timeText}
                {post.locationName && post.type !== 'location' ? (
                  <Text>
                    {' • '}
                    <Text style={{ fontWeight: '700', color: '#6B7280' }}>{post.locationName}</Text>
                  </Text>
                ) : null}
              </Text>
            </View>
            <MomentBadge type={post.type} />
            {isOwner ? (
              <Pressable
                testID={`post-menu-${post.id}`}
                onPress={() => setShowMenu(true)}
                style={{ marginLeft: 8, paddingHorizontal: 6, paddingVertical: 2 }}
              >
                <Text style={{ fontSize: 20, color: '#8B8B8B', letterSpacing: 1 }}>{'···'}</Text>
              </Pressable>
            ) : null}
          </View>

          {/* Content text */}
          {post.content ? (
            <Text style={{ fontSize: 16, color: '#0A1F44', marginTop: 12, lineHeight: 22 }}>
              {post.content}
            </Text>
          ) : null}

          {/* Type-specific content */}
          {post.type === 'location' && post.locationName ? (
            <LocationBadge name={post.locationName} venueCategory={post.venueCategory} />
          ) : null}
          {post.type === 'sleep' && post.sleepAction ? (
            <SleepBadge action={post.sleepAction} duration={post.sleepDuration} />
          ) : null}

          {/* Image or Video */}
          {post.image ? (
            isVideoUrl(post.image) ? (
              <InlineVideo uri={post.image} isVisible={isVisible} />
            ) : (
              <Image
                source={{ uri: post.image }}
                style={{
                  width: '100%',
                  height: 240,
                  borderRadius: 16,
                  marginTop: 12,
                }}
                contentFit="cover"
              />
            )
          ) : null}

          {/* Reactor avatars */}
          <ReactorAvatars reactions={post.reactions} />

          {/* Reaction buttons */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: post.reactions.length > 0 ? 8 : 12, gap: 2 }}>
            {REACTION_TYPES.map((emoji) => (
              <ReactionButton
                key={emoji}
                emoji={emoji}
                count={getReactionCount(emoji)}
                isActive={isReactionActive(emoji)}
                onPress={() => onReact?.(emoji)}
              />
            ))}
          </View>

          {/* Comments section - inline, always visible */}
          <View style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#F3F4F6' }}>
            {/* Loading state */}
            {isLoadingComments ? (
              <View style={{ paddingVertical: 8 }}>
                <ActivityIndicator size="small" color="#8B8B8B" />
              </View>
            ) : null}

            {/* "Read all X comments" link shown at top if collapsed */}
            {!showAllComments && hasMoreComments ? (
              <Pressable onPress={() => setShowAllComments(true)} style={{ marginBottom: 8 }}>
                <Text style={{ fontSize: 13, fontWeight: '600', color: '#6B7280' }}>
                  Read all {comments.length} comments...
                </Text>
              </Pressable>
            ) : null}

            {/* Comments list */}
            {visibleComments.map((comment) => (
              <View key={comment.id} style={{ flexDirection: 'row', marginBottom: 10, alignItems: 'flex-start' }}>
                <Pressable onPress={() => setViewingAvatarUri(comment.user.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${comment.userId}`)}>
                  <Image
                    source={{ uri: comment.user.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${comment.userId}` }}
                    style={{ width: 28, height: 28, borderRadius: 14, flexShrink: 0 }}
                    contentFit="cover"
                  />
                </Pressable>
                <View style={{ marginLeft: 8, flex: 1 }}>
                  <Text style={{ fontSize: 13, color: '#374151', lineHeight: 19 }}>
                    <Text style={{ fontWeight: '700', color: '#0A1F44' }}>{comment.user.name} </Text>
                    {comment.content}
                  </Text>
                </View>
              </View>
            ))}

            {/* Collapse link if expanded */}
            {showAllComments && hasMoreComments ? (
              <Pressable onPress={() => setShowAllComments(false)} style={{ marginBottom: 8 }}>
                <Text style={{ fontSize: 13, fontWeight: '600', color: '#9CA3AF' }}>Show less</Text>
              </Pressable>
            ) : null}

            {/* Error message */}
            {commentError ? (
              <Text style={{ fontSize: 12, color: '#EF4444', marginBottom: 8 }}>{commentError}</Text>
            ) : null}

            {/* Comment input */}
            <View
              onStartShouldSetResponder={() => true}
              onTouchStart={(e) => e.stopPropagation()}
              style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 8 }}
            >
              <TextInput
                testID={`comment-input-${post.id}`}
                value={commentText}
                onChangeText={setCommentText}
                placeholder="Add a comment..."
                placeholderTextColor="#8B8B8B"
                style={{
                  flex: 1,
                  fontSize: 14,
                  color: '#0A1F44',
                  paddingVertical: 0,
                }}
                multiline={false}
                returnKeyType="send"
                onSubmitEditing={handleSubmitComment}
              />
              {commentText.trim() ? (
                <Pressable
                  testID={`comment-send-button-${post.id}`}
                  onPress={handleSubmitComment}
                  disabled={isSubmittingComment}
                >
                  {isSubmittingComment ? (
                    <ActivityIndicator size="small" color="#0A1F44" />
                  ) : (
                    <Text style={{ fontSize: 14, fontWeight: '700', color: '#0A1F44' }}>Post</Text>
                  )}
                </Pressable>
              ) : null}
            </View>
          </View>
        </Animated.View>
      </Pressable>

      {/* Menu Modal */}
      <Modal
        visible={showMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowMenu(false)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}
          onPress={() => setShowMenu(false)}
        >
          <View style={{
            backgroundColor: '#FFFFFF',
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            padding: 20,
            paddingBottom: 36,
          }}>
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: '#E5E7EB', alignSelf: 'center', marginBottom: 16 }} />
            <Pressable
              testID={`edit-post-option-${post.id}`}
              onPress={() => {
                setShowMenu(false);
                setShowEditModal(true);
              }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: 14,
                paddingHorizontal: 8,
                borderRadius: 12,
              }}
            >
              <Text style={{ fontSize: 18, marginRight: 12 }}>✏️</Text>
              <Text style={{ fontSize: 16, fontWeight: '600', color: '#0A1F44' }}>Edit Moment</Text>
            </Pressable>
            <Pressable
              testID={`delete-post-option-${post.id}`}
              onPress={() => {
                setShowMenu(false);
                setShowDeleteConfirm(true);
              }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: 14,
                paddingHorizontal: 8,
                borderRadius: 12,
              }}
            >
              <Text style={{ fontSize: 18, marginRight: 12 }}>🗑️</Text>
              <Text style={{ fontSize: 16, fontWeight: '600', color: '#EF4444' }}>Delete Moment</Text>
            </Pressable>
            <Pressable
              onPress={() => setShowMenu(false)}
              style={{
                alignItems: 'center',
                paddingVertical: 14,
                borderRadius: 12,
                backgroundColor: '#F3F4F6',
                marginTop: 8,
              }}
            >
              <Text style={{ fontSize: 16, fontWeight: '600', color: '#6B7280' }}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Delete Confirm Modal */}
      <Modal
        visible={showDeleteConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDeleteConfirm(false)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 }}>
          <View style={{
            backgroundColor: '#FFFFFF',
            borderRadius: 20,
            padding: 24,
            width: '100%',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.15,
            shadowRadius: 20,
            elevation: 10,
          }}>
            <Text style={{ fontSize: 20, fontWeight: '700', color: '#0A1F44', textAlign: 'center', marginBottom: 8 }}>
              Delete this moment?
            </Text>
            <Text style={{ fontSize: 15, color: '#6B7280', textAlign: 'center', marginBottom: 24 }}>
              This cannot be undone.
            </Text>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Pressable
                testID="delete-cancel-button"
                onPress={() => setShowDeleteConfirm(false)}
                style={{
                  flex: 1,
                  paddingVertical: 14,
                  borderRadius: 12,
                  backgroundColor: '#F3F4F6',
                  alignItems: 'center',
                }}
              >
                <Text style={{ fontSize: 16, fontWeight: '600', color: '#6B7280' }}>Cancel</Text>
              </Pressable>
              <Pressable
                testID="delete-confirm-button"
                onPress={() => {
                  setShowDeleteConfirm(false);
                  onDelete?.(post.id);
                }}
                style={{
                  flex: 1,
                  paddingVertical: 14,
                  borderRadius: 12,
                  backgroundColor: '#EF4444',
                  alignItems: 'center',
                }}
              >
                <Text style={{ fontSize: 16, fontWeight: '600', color: '#FFFFFF' }}>Delete</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <AvatarViewer uri={viewingAvatarUri} onClose={() => setViewingAvatarUri(null)} />
      <EditMomentModal post={showEditModal ? post : null} onClose={() => setShowEditModal(false)} />
    </>
  );
}
