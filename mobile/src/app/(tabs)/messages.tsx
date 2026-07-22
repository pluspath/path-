import React from 'react';
import { View, Text, Pressable, TextInput, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Search } from 'lucide-react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Conversation } from '@/lib/types';
import { getTimeAgo } from '@/lib/mock-data';
import * as Haptics from 'expo-haptics';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/auth/use-session';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePathStore } from '@/lib/store';

export default function MessagesScreen() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const currentUserId = session?.user?.id;

  const unreadCounts = usePathStore((s) => s.unreadCounts);
  const setUnreadCounts = usePathStore((s) => s.setUnreadCounts);
  const incrementUnread = usePathStore((s) => s.incrementUnread);

  const { data: conversations = [] } = useQuery({
    queryKey: ['conversations'],
    queryFn: () => api.get<Conversation[]>('/api/conversations'),
  });

  const router = useRouter();
  const [search, setSearch] = React.useState('');

  const initialFetched = React.useRef(false);
  const conversationIdsRef = React.useRef<Set<string>>(new Set());

  // Keep conversation IDs ref in sync
  React.useEffect(() => {
    conversationIdsRef.current = new Set(conversations.map((c: Conversation) => c.id));
  }, [conversations]);

  // Load initial unread counts from backend using AsyncStorage timestamps
  React.useEffect(() => {
    if (!conversations.length || !currentUserId || initialFetched.current) return;
    initialFetched.current = true;

    (async () => {
      const readTimestamps: Record<string, string> = {};
      const now = new Date().toISOString();

      for (const conv of conversations) {
        const stored = await AsyncStorage.getItem(`read_at:${conv.id}`);
        if (stored) {
          readTimestamps[conv.id] = stored;
        } else {
          await AsyncStorage.setItem(`read_at:${conv.id}`, now);
          readTimestamps[conv.id] = now;
        }
      }

      try {
        const counts = await api.post<Record<string, number>>(
          '/api/conversations/unread-counts',
          { readTimestamps }
        );
        setUnreadCounts(counts);
      } catch (e) {
        console.error('[unread] Failed to fetch unread counts:', e);
      }
    })();
  }, [conversations.length, currentUserId]);

  // Realtime subscription: update unread counts and conversation previews
  React.useEffect(() => {
    if (!currentUserId) return;

    const channel = supabase
      .channel('messages-list-updates')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const m = payload.new as any;
          if (!conversationIdsRef.current.has(m.conversation_id)) return;
          if (m.sender_id !== currentUserId) {
            incrementUnread(m.conversation_id);
          }
          queryClient.invalidateQueries({ queryKey: ['conversations'] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId, queryClient, incrementUnread]);

  const filtered = conversations.filter((c: Conversation) =>
    c.user.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <View className="flex-1 bg-[#F8F6F2]" testID="messages-screen">
      <SafeAreaView edges={['top']} style={{ backgroundColor: '#0A1F44' }}>
        <View className="px-5 pb-3 pt-1" style={{ backgroundColor: '#0A1F44' }}>
          <Text className="text-2xl font-bold" style={{ color: '#F8F6F2' }}>Messages</Text>
        </View>
      </SafeAreaView>

      <View className="px-4 pt-3">
        <View
          className="flex-row items-center rounded-xl px-3"
          style={{ backgroundColor: '#EEECEA', height: 42 }}
        >
          <Search size={18} color="#8B8B8B" />
          <TextInput
            testID="messages-search"
            value={search}
            onChangeText={setSearch}
            placeholder="Search conversations..."
            placeholderTextColor="#8B8B8B"
            className="flex-1 ml-2 text-sm"
            style={{ color: '#0A1F44' }}
          />
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 120 }} testID="messages-scroll">
        {filtered.map((conv: Conversation) => {
          const unread = unreadCounts[conv.id] ?? 0;
          return (
            <Pressable
              key={conv.id}
              testID={`conversation-${conv.id}`}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push(`/chat/${conv.id}` as any);
              }}
              className="flex-row items-center px-5 py-3"
            >
              <Image
                source={{ uri: conv.user.avatar }}
                style={{ width: 52, height: 52, borderRadius: 26 }}
              />
              <View className="flex-1 ml-3">
                <View className="flex-row items-center justify-between">
                  <Text className="text-base font-semibold" style={{ color: '#0A1F44' }}>
                    {conv.user.name}
                  </Text>
                  <Text className="text-xs" style={{ color: '#8B8B8B' }}>
                    {getTimeAgo(conv.lastMessageTime)}
                  </Text>
                </View>
                <View className="flex-row items-center justify-between mt-0.5">
                  <Text
                    className="text-sm flex-1 mr-2"
                    style={{ color: unread > 0 ? '#0A1F44' : '#8B8B8B' }}
                    numberOfLines={1}
                  >
                    {conv.lastMessage}
                  </Text>
                  {unread > 0 ? (
                    <View
                      style={{
                        backgroundColor: '#0A1F44',
                        borderRadius: 10,
                        minWidth: 20,
                        height: 20,
                        alignItems: 'center',
                        justifyContent: 'center',
                        paddingHorizontal: 6,
                      }}
                    >
                      <Text style={{ fontSize: 11, fontWeight: '700', color: '#F8F6F2' }}>
                        {unread}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </Pressable>
          );
        })}

        {filtered.length === 0 ? (
          <View className="items-center py-20">
            <Text className="text-lg font-semibold" style={{ color: '#0A1F44' }}>No conversations</Text>
            <Text className="text-sm mt-1" style={{ color: '#8B8B8B' }}>Start chatting with friends</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
