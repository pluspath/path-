import React from 'react';
import { View, Text, TextInput, Pressable, FlatList, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { ChevronLeft, Send } from 'lucide-react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Message, Conversation } from '@/lib/types';
import { getTimeAgo } from '@/lib/mock-data';
import * as Haptics from 'expo-haptics';
import { useSession } from '@/lib/auth/use-session';
import { supabase } from '@/lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePathStore } from '@/lib/store';

export default function ChatScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [text, setText] = React.useState('');
  const flatListRef = React.useRef<FlatList<Message>>(null);

  const { data: session } = useSession();
  const currentUserId = session?.user?.id;
  const clearUnread = usePathStore((s) => s.clearUnread);

  const { data: conversation } = useQuery({
    queryKey: ['conversation', id],
    queryFn: () => api.get<Conversation>(`/api/conversations/${id}`),
    enabled: !!id,
    staleTime: 30_000,
    placeholderData: () => {
      // Show cached data from the conversations list immediately while fresh data loads
      const list = queryClient.getQueryData<Conversation[]>(['conversations']);
      return list?.find((c) => c.id === id);
    },
  });

  const { mutate: sendMessage } = useMutation({
    mutationFn: (messageText: string) =>
      api.post<Message>(`/api/conversations/${id}/messages`, { text: messageText }),
    onMutate: (messageText) => {
      const tempId = `temp-${Date.now()}`;
      const optimistic: Message = {
        id: tempId,
        senderId: currentUserId ?? '',
        text: messageText,
        createdAt: new Date().toISOString(),
      };
      queryClient.setQueryData(['conversation', id], (old: Conversation | undefined) => {
        if (!old) return old;
        return { ...old, messages: [...old.messages, optimistic] };
      });
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
      return { tempId };
    },
    onSuccess: (realMessage, _vars, context) => {
      queryClient.setQueryData(['conversation', id], (old: Conversation | undefined) => {
        if (!old) return old;
        // Remove the temp message
        const withoutTemp = old.messages.filter((m) => m.id !== context?.tempId);
        // Only add the real message if realtime hasn't already added it
        if (withoutTemp.some((m) => m.id === realMessage.id)) {
          return { ...old, messages: withoutTemp };
        }
        return { ...old, messages: [...withoutTemp, realMessage] };
      });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
    onError: (_err, _vars, context) => {
      // Remove the optimistic message on failure
      queryClient.setQueryData(['conversation', id], (old: Conversation | undefined) => {
        if (!old) return old;
        return { ...old, messages: old.messages.filter((m) => m.id !== context?.tempId) };
      });
    },
  });

  const messages = conversation?.messages ?? [];
  const otherUser = conversation?.user;

  // Mark conversation as read when opened
  React.useEffect(() => {
    if (!id) return;
    clearUnread(id);
    AsyncStorage.setItem(`read_at:${id}`, new Date().toISOString());
  }, [id, clearUnread]);

  // Realtime subscription for new messages
  React.useEffect(() => {
    if (!id) return;

    const channel = supabase
      .channel(`messages:${id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${id}` },
        (payload) => {
          const m = payload.new as any;
          const newMsg: Message = {
            id: m.id,
            senderId: m.sender_id,
            text: m.content,
            image: m.image_url ?? undefined,
            createdAt: m.created_at,
          };
          queryClient.setQueryData(['conversation', id], (old: Conversation | undefined) => {
            if (!old) return old;
            if (old.messages.some((msg) => msg.id === newMsg.id)) return old;
            return { ...old, messages: [...old.messages, newMsg] };
          });
          setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, queryClient]);

  // Only block with a spinner on the very first load (no cache, no placeholder data)
  if (!conversation && id) {
    return (
      <View className="flex-1 bg-[#0A1F44] items-center justify-center" testID="chat-screen">
        <Text style={{ color: 'rgba(248,246,242,0.5)' }}>Loading...</Text>
      </View>
    );
  }

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setText(''); // Clear input immediately before the async mutation
    sendMessage(trimmed);
  };

  const renderMessage = ({ item, index }: { item: Message; index: number }) => {
    const isMine = item.senderId === currentUserId;
    const prev = index > 0 ? messages[index - 1] : null;
    const showTimestamp =
      !prev || new Date(item.createdAt).getTime() - new Date(prev.createdAt).getTime() > 3600000;

    return (
      <View>
        {showTimestamp ? (
          <Text className="text-center text-xs my-3" style={{ color: '#8B8B8B' }}>
            {getTimeAgo(item.createdAt)}
          </Text>
        ) : null}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: isMine ? 'flex-end' : 'flex-start',
            paddingHorizontal: 16,
            marginBottom: 4,
          }}
        >
          <View
            style={{
              maxWidth: '78%',
              backgroundColor: isMine ? '#0A1F44' : '#E5E7EB',
              borderRadius: 18,
              paddingHorizontal: 14,
              paddingVertical: 10,
              borderBottomRightRadius: isMine ? 4 : 18,
              borderBottomLeftRadius: isMine ? 18 : 4,
            }}
          >
            <Text
              className="text-sm"
              style={{ color: isMine ? '#F8F6F2' : '#0A1F44', lineHeight: 20 }}
            >
              {item.text}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View className="flex-1 bg-[#F8F6F2]" testID="chat-screen">
      <SafeAreaView edges={['top']} style={{ backgroundColor: '#0A1F44' }}>
        <View className="flex-row items-center px-4 pb-3 pt-1" style={{ backgroundColor: '#0A1F44' }}>
          <Pressable
            testID="chat-back"
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace('/(tabs)');
            }}
            hitSlop={12}
            className="mr-3"
          >
            <ChevronLeft size={28} color="#F8F6F2" />
          </Pressable>
          {otherUser ? (
            <Image
              source={{ uri: otherUser.avatar }}
              style={{ width: 36, height: 36, borderRadius: 18 }}
            />
          ) : null}
          <Text className="text-base font-semibold ml-3" style={{ color: '#F8F6F2' }}>
            {otherUser?.name ?? ''}
          </Text>
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
        keyboardVerticalOffset={0}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: 8 }}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
          testID="chat-messages"
        />

        <SafeAreaView edges={['bottom']} style={{ backgroundColor: '#F8F6F2' }}>
          <View
            className="flex-row items-center px-4 py-2"
            style={{ borderTopWidth: 1, borderTopColor: '#E5E7EB' }}
          >
            <TextInput
              testID="chat-input"
              value={text}
              onChangeText={setText}
              placeholder="Type a message..."
              placeholderTextColor="#8B8B8B"
              className="flex-1 rounded-2xl px-4 py-2.5 text-sm"
              style={{ backgroundColor: '#EEECEA', color: '#0A1F44' }}
              multiline
              onSubmitEditing={handleSend}
            />
            <Pressable
              testID="chat-send"
              onPress={handleSend}
              className="ml-2"
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: text.trim() ? '#FFFFFF' : '#E5E7EB',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Send size={18} color={text.trim() ? '#0A1F44' : '#8B8B8B'} />
            </Pressable>
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </View>
  );
}
