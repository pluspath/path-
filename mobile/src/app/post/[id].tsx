import React from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react-native';
import { api } from '@/lib/api';
import { Post } from '@/lib/types';
import PostCard from '@/components/PostCard';
import { useSession } from '@/lib/auth/use-session';

export default function PostDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  const { data: post, isLoading, isError } = useQuery({
    queryKey: ['post', id],
    queryFn: () => api.get<Post>(`/api/posts/${id}`),
    retry: 1,
  });

  const { mutate: handleReact } = useMutation({
    mutationFn: (type: string) => api.post(`/api/posts/${id}/reactions`, { type }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['post', id] });
      queryClient.invalidateQueries({ queryKey: ['posts'] });
    },
  });

  const { mutate: handleDelete } = useMutation({
    mutationFn: (postId: string) => api.delete(`/api/posts/${postId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['posts'] });
      router.back();
    },
  });

  return (
    <View style={{ flex: 1, backgroundColor: '#F8F6F2' }} testID="post-detail-screen">
      <SafeAreaView edges={['top']} style={{ backgroundColor: '#0A1F44' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, paddingTop: 4, backgroundColor: '#0A1F44' }}>
          <Pressable onPress={() => router.back()} hitSlop={12} testID="post-detail-back">
            <ChevronLeft size={24} color="#FFFFFF" />
          </Pressable>
          <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '700', marginLeft: 8 }}>Moment</Text>
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }}>
        {isLoading ? (
          <View style={{ alignItems: 'center', paddingTop: 80 }} testID="post-detail-loading">
            <ActivityIndicator size="large" color="#0A1F44" />
          </View>
        ) : isError || !post ? (
          <View style={{ alignItems: 'center', paddingTop: 80 }} testID="post-detail-not-found">
            <Text style={{ fontSize: 40, marginBottom: 12 }}>🔍</Text>
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#0A1F44', textAlign: 'center' }}>
              Content not found
            </Text>
            <Text style={{ fontSize: 14, color: '#8B8B8B', marginTop: 6, textAlign: 'center' }}>
              This moment may have been deleted.
            </Text>
            <Pressable
              onPress={() => router.back()}
              style={{ marginTop: 24, backgroundColor: '#0A1F44', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 }}
            >
              <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>Go back</Text>
            </Pressable>
          </View>
        ) : (
          <PostCard
            post={post}
            currentUserId={session?.user?.id ?? ''}
            onReact={(type) => handleReact(type)}
            onDelete={(postId) => handleDelete(postId)}
          />
        )}
      </ScrollView>
    </View>
  );
}
