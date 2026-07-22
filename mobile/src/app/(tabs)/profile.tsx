import React from 'react';
import { View, Text, Pressable, Animated, Dimensions, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRouter, useFocusEffect } from 'expo-router';
import { AvatarViewer } from '@/components/AvatarViewer';
import { Settings, Edit2, UserPlus, MessageCircle } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/lib/auth/use-session';
import { api } from '@/lib/api';
import { User, Post } from '@/lib/types';
import { MOMENT_CONFIG } from '@/lib/mock-data';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ZODIAC_KEY = 'profile_show_zodiac';

const COVER_HEIGHT = 220;
const AVATAR_SIZE = 88;
const { width } = Dimensions.get('window');

function getZodiacSign(birthday: string): { sign: string; emoji: string } | null {
  if (!birthday) return null;
  const date = new Date(birthday);
  if (isNaN(date.getTime())) return null;
  const month = date.getMonth() + 1;
  const day = date.getDate();
  if ((month === 3 && day >= 21) || (month === 4 && day <= 19)) return { sign: 'Aries', emoji: '♈' };
  if ((month === 4 && day >= 20) || (month === 5 && day <= 20)) return { sign: 'Taurus', emoji: '♉' };
  if ((month === 5 && day >= 21) || (month === 6 && day <= 20)) return { sign: 'Gemini', emoji: '♊' };
  if ((month === 6 && day >= 21) || (month === 7 && day <= 22)) return { sign: 'Cancer', emoji: '♋' };
  if ((month === 7 && day >= 23) || (month === 8 && day <= 22)) return { sign: 'Leo', emoji: '♌' };
  if ((month === 8 && day >= 23) || (month === 9 && day <= 22)) return { sign: 'Virgo', emoji: '♍' };
  if ((month === 9 && day >= 23) || (month === 10 && day <= 22)) return { sign: 'Libra', emoji: '♎' };
  if ((month === 10 && day >= 23) || (month === 11 && day <= 21)) return { sign: 'Scorpio', emoji: '♏' };
  if ((month === 11 && day >= 22) || (month === 12 && day <= 21)) return { sign: 'Sagittarius', emoji: '♐' };
  if ((month === 12 && day >= 22) || (month === 1 && day <= 19)) return { sign: 'Capricorn', emoji: '♑' };
  if ((month === 1 && day >= 20) || (month === 2 && day <= 18)) return { sign: 'Aquarius', emoji: '♒' };
  return { sign: 'Pisces', emoji: '♓' };
}

function nameToHandle(name: string): string {
  return '@' + name.toLowerCase().replace(/\s+/g, '.');
}

export default function ProfileScreen() {
  const { data: session } = useSession();
  const router = useRouter();
  const scrollY = React.useRef(new Animated.Value(0)).current;
  const [viewingAvatar, setViewingAvatar] = React.useState<string | null>(null);
  const [showZodiacPref, setShowZodiacPref] = React.useState(false);

  useFocusEffect(
    React.useCallback(() => {
      AsyncStorage.getItem(ZODIAC_KEY).then((val) => {
        setShowZodiacPref(val === 'true');
      });
    }, [])
  );

  const { data: currentUser, isRefetching: isRefetchingProfile, refetch: refetchProfile } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<User>('/api/me'),
    enabled: !!session?.user,
  });

  const userId = session?.user?.id;
  const { data: myPosts = [], isRefetching: isRefetchingPosts, refetch: refetchPosts } = useQuery({
    queryKey: ['posts', 'me', userId],
    queryFn: () => api.get<Post[]>(`/api/${userId}/posts`),
    enabled: !!userId,
  });

  const { data: friendsData } = useQuery({
    queryKey: ['friends'],
    queryFn: () => api.get<{ friends: any[]; requests: any[]; suggested: any[] }>('/api/friends'),
    enabled: !!session?.user,
  });

  const myPhotoPosts = myPosts.filter((p: Post) => p.image);

  const coverTranslateY = scrollY.interpolate({
    inputRange: [-COVER_HEIGHT, 0, COVER_HEIGHT],
    outputRange: [-COVER_HEIGHT / 2, 0, COVER_HEIGHT / 3],
    extrapolate: 'clamp',
  });

  const coverScale = scrollY.interpolate({
    inputRange: [-COVER_HEIGHT, 0],
    outputRange: [2, 1],
    extrapolate: 'clamp',
  });

  const displayName = currentUser?.name ?? (session?.user?.user_metadata?.['full_name'] as string | undefined) ?? '';
  const handle = displayName ? nameToHandle(displayName) : '';
  const zodiac = currentUser?.birthday ? getZodiacSign(currentUser.birthday) : null;

  return (
    <View className="flex-1 bg-[#F8F6F2]" testID="profile-screen">
      <Animated.ScrollView
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true }
        )}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: 120 }}
        testID="profile-scroll"
        refreshControl={
          <RefreshControl
            refreshing={isRefetchingProfile || isRefetchingPosts}
            onRefresh={() => { refetchProfile(); refetchPosts(); }}
            tintColor="#0A1F44"
          />
        }
      >
        {/* Cover Photo - full width */}
        <Animated.View style={{ height: COVER_HEIGHT, overflow: 'hidden', transform: [{ translateY: coverTranslateY }, { scale: coverScale }] }}>
          <Image
            source={{ uri: currentUser?.coverPhoto ?? 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800' }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
          />
          <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(10,31,68,0.3)' }} />
        </Animated.View>

        {/* Settings button (top right, overlaid on cover) */}
        <SafeAreaView edges={['top']} style={{ position: 'absolute', top: 0, right: 0, zIndex: 10 }}>
          <Pressable
            testID="profile-settings"
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push('/settings' as any);
            }}
            style={{
              backgroundColor: 'rgba(0,0,0,0.35)',
              borderRadius: 20,
              width: 40,
              height: 40,
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: 16,
              marginTop: 4,
            }}
          >
            <Settings size={20} color="#FFFFFF" />
          </Pressable>
        </SafeAreaView>

        {/* Avatar - centered, overlapping the cover photo */}
        <View style={{ alignItems: 'center', marginTop: -(AVATAR_SIZE / 2 + 4), zIndex: 5 }}>
          <Pressable
            onPress={() => setViewingAvatar(currentUser?.avatar ?? `https://api.dicebear.com/7.x/avataaars/svg?seed=${session?.user?.id}`)}
            style={{
              width: AVATAR_SIZE + 6,
              height: AVATAR_SIZE + 6,
              borderRadius: (AVATAR_SIZE + 6) / 2,
              backgroundColor: '#F8F6F2',
              alignItems: 'center',
              justifyContent: 'center',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.15,
              shadowRadius: 8,
              elevation: 6,
            }}
          >
            <Image
              source={{ uri: currentUser?.avatar ?? `https://api.dicebear.com/7.x/avataaars/svg?seed=${session?.user?.id}` }}
              style={{ width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2 }}
            />
          </Pressable>
        </View>
        <AvatarViewer uri={viewingAvatar} onClose={() => setViewingAvatar(null)} />

        {/* Name, handle, bio */}
        <View style={{ alignItems: 'center', paddingHorizontal: 24, marginTop: 10 }}>
          {/* Full name in bold */}
          <Text style={{ fontSize: 22, fontWeight: '800', color: '#0A1F44', letterSpacing: -0.3 }}>
            {displayName}
          </Text>

          {/* @handle */}
          {handle ? (
            <Text style={{ fontSize: 14, color: '#9CA3AF', marginTop: 2, fontWeight: '500' }}>
              {handle}
            </Text>
          ) : null}

          {/* Zodiac sign badge — only shown if user opted in via Edit Profile */}
          {showZodiacPref && zodiac ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                marginTop: 8,
                backgroundColor: '#EEF2FF',
                borderRadius: 12,
                paddingHorizontal: 10,
                paddingVertical: 4,
              }}
            >
              <Text style={{ fontSize: 15 }}>{zodiac.emoji}</Text>
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#6366F1', marginLeft: 4 }}>{zodiac.sign}</Text>
            </View>
          ) : null}

          {/* Bio */}
          {currentUser?.bio ? (
            <Text style={{ fontSize: 14, color: '#4B5563', marginTop: 8, textAlign: 'center', lineHeight: 20 }}>
              {currentUser.bio}
            </Text>
          ) : null}

          {/* Location */}
          {currentUser?.location ? (
            <Text style={{ fontSize: 13, color: '#9CA3AF', marginTop: 4 }}>
              📍 {currentUser.location}
            </Text>
          ) : null}
        </View>

        {/* Stats row: Posts • Friends • Moments */}
        <View style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 20,
          marginHorizontal: 16,
          backgroundColor: '#FFFFFF',
          borderRadius: 16,
          paddingVertical: 16,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.05,
          shadowRadius: 8,
          elevation: 2,
        }}>
          <Pressable testID="profile-posts-stat" style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ fontSize: 20, fontWeight: '800', color: '#0A1F44' }}>{currentUser?.postCount ?? 0}</Text>
            <Text style={{ fontSize: 12, color: '#9CA3AF', marginTop: 2, fontWeight: '500' }}>Posts</Text>
          </Pressable>

          <View style={{ width: 1, height: 32, backgroundColor: '#E5E7EB' }} />

          <Pressable
            testID="profile-friends-stat"
            style={{ flex: 1, alignItems: 'center' }}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push('/friends' as any);
            }}
          >
            <Text style={{ fontSize: 20, fontWeight: '800', color: '#0A1F44' }}>{friendsData?.friends?.length ?? currentUser?.friendCount ?? 0}</Text>
            <Text style={{ fontSize: 12, color: '#9CA3AF', marginTop: 2, fontWeight: '500' }}>Friends</Text>
          </Pressable>

          <View style={{ width: 1, height: 32, backgroundColor: '#E5E7EB' }} />

          <Pressable testID="profile-moments-stat" style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ fontSize: 20, fontWeight: '800', color: '#0A1F44' }}>{currentUser?.momentCount ?? 0}</Text>
            <Text style={{ fontSize: 12, color: '#9CA3AF', marginTop: 2, fontWeight: '500' }}>Moments</Text>
          </Pressable>
        </View>

        {/* Action buttons */}
        <View style={{ flexDirection: 'row', gap: 10, marginHorizontal: 16, marginTop: 12 }}>
          {/* Edit Profile button (own profile) */}
          <Pressable
            testID="edit-profile-button"
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push('/edit-profile' as any);
            }}
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              paddingVertical: 11,
              borderRadius: 12,
              borderWidth: 1.5,
              borderColor: '#0A1F44',
              gap: 6,
            }}
          >
            <Edit2 size={15} color="#0A1F44" />
            <Text style={{ fontSize: 14, fontWeight: '700', color: '#0A1F44' }}>Edit Profile</Text>
          </Pressable>
        </View>

        {/* Photos grid */}
        <View style={{ marginTop: 24, paddingHorizontal: 16 }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: '#0A1F44', marginBottom: 10 }}>Photos</Text>
          {myPhotoPosts.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 24, backgroundColor: '#FFFFFF', borderRadius: 16 }}>
              <Text style={{ fontSize: 32, marginBottom: 8 }}>📷</Text>
              <Text style={{ fontSize: 14, color: '#9CA3AF' }}>No photos shared yet</Text>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 3 }}>
              {myPhotoPosts.map((post: Post) => (
                <View key={post.id} style={{ width: (width - 38) / 3, height: (width - 38) / 3, borderRadius: 8, overflow: 'hidden' }}>
                  <Image
                    source={{ uri: post.image }}
                    style={{ width: '100%', height: '100%' }}
                    contentFit="cover"
                  />
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Timeline of user's moments */}
        <View style={{ marginTop: 24, paddingHorizontal: 16 }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: '#0A1F44', marginBottom: 12 }}>My Moments</Text>

          {myPosts.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 24, backgroundColor: '#FFFFFF', borderRadius: 16 }}>
              <Text style={{ fontSize: 32, marginBottom: 8 }}>✨</Text>
              <Text style={{ fontSize: 14, color: '#9CA3AF' }}>No moments shared yet</Text>
            </View>
          ) : null}

          {myPosts.slice(0, 20).map((post: Post, index: number) => {
            const isLast = index === Math.min(myPosts.length, 20) - 1;
            const config = MOMENT_CONFIG[post.type] ?? { color: '#8B8B8B', icon: '✦', label: post.type };
            return (
              <View key={post.id} style={{ flexDirection: 'row', minHeight: 64 }}>
                {/* Timeline column */}
                <View style={{ width: 28, alignItems: 'center' }}>
                  {/* Dot */}
                  <View
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 6,
                      backgroundColor: config.color,
                      marginTop: 4,
                      zIndex: 2,
                      borderWidth: 2,
                      borderColor: '#F8F6F2',
                    }}
                  />
                  {/* Line */}
                  {!isLast ? (
                    <View style={{ width: 2, flex: 1, backgroundColor: '#E5E7EB', marginTop: -2 }} />
                  ) : null}
                </View>

                {/* Content */}
                <View style={{ flex: 1, marginLeft: 8, paddingBottom: 16 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <Text style={{ fontSize: 10, fontWeight: '600', color: config.color }}>
                      {config.icon} {config.label}
                    </Text>
                    <Text style={{ fontSize: 10, color: '#C4C4C4' }}>
                      {new Date(post.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 14, color: '#374151', lineHeight: 20 }} numberOfLines={2}>
                    {post.content || post.locationName || ''}
                  </Text>
                  {post.image ? (
                    <Image
                      source={{ uri: post.image }}
                      style={{ width: 64, height: 48, borderRadius: 8, marginTop: 6 }}
                      contentFit="cover"
                    />
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      </Animated.ScrollView>
    </View>
  );
}
