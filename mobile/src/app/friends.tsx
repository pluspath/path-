import React from 'react';
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { ChevronLeft, Search, MapPin, UserPlus, Info } from 'lucide-react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { User, FriendRequest } from '@/lib/types';
import * as Haptics from 'expo-haptics';

function FriendStatusButton({ person }: { person: User; onRefresh?: () => void }) {
  const queryClient = useQueryClient();
  const [localStatus, setLocalStatus] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const status = localStatus ?? person.friendshipStatus ?? 'none';

  const { mutate: sendRequest } = useMutation({
    mutationFn: () => api.post(`/api/friends/request/${person.id}`),
    onMutate: async () => {
      setLocalStatus('pending_sent');
      await queryClient.cancelQueries({ queryKey: ['user-search'] });
      const prevSearchData = queryClient.getQueriesData<User[]>({ queryKey: ['user-search'] });
      queryClient.setQueriesData<User[]>({ queryKey: ['user-search'] }, (old) =>
        old?.map((u) => u.id === person.id ? { ...u, friendshipStatus: 'pending_sent' as const } : u) ?? []
      );
      return { prevSearchData };
    },
    onError: (_err, _vars, context) => {
      setLocalStatus(null);
      context?.prevSearchData?.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },
    onSettled: () => {
      setIsSubmitting(false);
      queryClient.refetchQueries({ queryKey: ['user-search'] });
      queryClient.refetchQueries({ queryKey: ['friends'] });
    },
  });

  const { mutate: acceptFriend } = useMutation({
    mutationFn: () => api.post(`/api/friends/accept/${person.friendshipId}`),
    onMutate: async () => {
      setLocalStatus('friends');
      await queryClient.cancelQueries({ queryKey: ['user-search'] });
      await queryClient.cancelQueries({ queryKey: ['friends'] });
      const prevSearchData = queryClient.getQueriesData<User[]>({ queryKey: ['user-search'] });
      const prevFriends = queryClient.getQueryData(['friends']);
      queryClient.setQueriesData<User[]>({ queryKey: ['user-search'] }, (old) =>
        old?.map((u) => u.id === person.id ? { ...u, friendshipStatus: 'friends' as const } : u) ?? []
      );
      return { prevSearchData, prevFriends };
    },
    onError: (_err, _vars, context) => {
      setLocalStatus(null);
      context?.prevSearchData?.forEach(([key, data]) => queryClient.setQueryData(key, data));
      if (context?.prevFriends) queryClient.setQueryData(['friends'], context.prevFriends);
    },
    onSettled: () => {
      setIsSubmitting(false);
      queryClient.refetchQueries({ queryKey: ['user-search'] });
      queryClient.refetchQueries({ queryKey: ['friends'] });
      queryClient.refetchQueries({ queryKey: ['notifications'] });
    },
  });

  if (status === 'friends') {
    return (
      <View style={{ backgroundColor: '#DCFCE7', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}>
        <Text style={{ fontSize: 12, fontWeight: '600', color: '#16A34A' }}>Friends</Text>
      </View>
    );
  }
  if (status === 'pending_sent') {
    return (
      <View style={{ backgroundColor: '#F3F4F6', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}>
        <Text style={{ fontSize: 12, fontWeight: '600', color: '#9CA3AF' }}>Pending</Text>
      </View>
    );
  }
  if (status === 'pending_received' && person.friendshipId) {
    return (
      <Pressable
        disabled={isSubmitting}
        onPress={() => {
          if (isSubmitting) return;
          setIsSubmitting(true);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          acceptFriend();
        }}
        style={{ backgroundColor: '#0A1F44', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, opacity: isSubmitting ? 0.6 : 1, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        {isSubmitting ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
        <Text style={{ fontSize: 12, fontWeight: '600', color: '#FFFFFF' }}>Accept</Text>
      </Pressable>
    );
  }
  return (
    <Pressable
      disabled={isSubmitting}
      onPress={() => {
        if (isSubmitting) return;
        setIsSubmitting(true);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        sendRequest();
      }}
      style={{ backgroundColor: 'rgba(10,31,68,0.1)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, opacity: isSubmitting ? 0.6 : 1, alignItems: 'center', justifyContent: 'center' }}>
      {isSubmitting ? <ActivityIndicator size="small" color="#0A1F44" /> : <UserPlus size={16} color="#0A1F44" />}
    </Pressable>
  );
}

export default function FriendsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState('');
  const [debouncedSearch, setDebouncedSearch] = React.useState('');
  const [acceptingRequestIds, setAcceptingRequestIds] = React.useState<Set<string>>(new Set());
  const [decliningRequestIds, setDecliningRequestIds] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: friendsData, refetch: refetchFriends } = useQuery({
    queryKey: ['friends'],
    queryFn: () => api.get<{ friends: User[]; requests: FriendRequest[]; suggested: User[] }>('/api/friends'),
  });

  const friends = friendsData?.friends ?? [];
  const friendRequests = friendsData?.requests ?? [];
  const suggested = friendsData?.suggested ?? [];

  const { data: searchResults = [] } = useQuery({
    queryKey: ['user-search', debouncedSearch],
    queryFn: () => api.get<User[]>(`/api/search?q=${encodeURIComponent(debouncedSearch)}`),
    enabled: debouncedSearch.trim().length >= 2,
  });

  const { mutate: acceptRequest } = useMutation({
    mutationFn: (reqId: string) => api.post(`/api/friends/accept/${reqId}`),
    onMutate: async (reqId) => {
      await queryClient.cancelQueries({ queryKey: ['friends'] });
      const prev = queryClient.getQueryData<{ friends: User[]; requests: FriendRequest[]; suggested: User[] }>(['friends']);
      const acceptedReq = prev?.requests?.find((r) => r.id === reqId);
      queryClient.setQueryData(['friends'], {
        ...prev,
        requests: prev?.requests?.filter((r) => r.id !== reqId) ?? [],
        friends: acceptedReq ? [...(prev?.friends ?? []), acceptedReq.user] : (prev?.friends ?? []),
      });
      return { prev };
    },
    onError: (_err, reqId, context) => {
      setAcceptingRequestIds(prev => { const next = new Set(prev); next.delete(reqId); return next; });
      if (context?.prev) queryClient.setQueryData(['friends'], context.prev);
    },
    onSettled: (_data, _error, reqId) => {
      setAcceptingRequestIds(prev => { const next = new Set(prev); next.delete(reqId); return next; });
      queryClient.refetchQueries({ queryKey: ['friends'] });
      queryClient.refetchQueries({ queryKey: ['notifications'] });
    },
  });

  const { mutate: declineRequest } = useMutation({
    mutationFn: (reqId: string) => api.delete(`/api/friends/${reqId}`),
    onMutate: async (reqId) => {
      await queryClient.cancelQueries({ queryKey: ['friends'] });
      const prev = queryClient.getQueryData<{ friends: User[]; requests: FriendRequest[]; suggested: User[] }>(['friends']);
      queryClient.setQueryData(['friends'], {
        ...prev,
        requests: prev?.requests?.filter((r) => r.id !== reqId) ?? [],
      });
      return { prev };
    },
    onError: (_err, reqId, context) => {
      setDecliningRequestIds(prev => { const next = new Set(prev); next.delete(reqId); return next; });
      if (context?.prev) queryClient.setQueryData(['friends'], context.prev);
    },
    onSettled: (_data, _error, reqId) => {
      setDecliningRequestIds(prev => { const next = new Set(prev); next.delete(reqId); return next; });
      queryClient.refetchQueries({ queryKey: ['friends'] });
    },
  });

  const filteredFriends = friends.filter((f: User) =>
    f.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <View className="flex-1 bg-[#F8F6F2]" testID="friends-screen">
      <SafeAreaView edges={['top']} style={{ backgroundColor: '#0A1F44' }}>
        <View className="flex-row items-center px-4 pb-3 pt-1" style={{ backgroundColor: '#0A1F44' }}>
          <Pressable testID="friends-back" onPress={() => { if (router.canGoBack()) router.back(); else router.replace('/(tabs)'); }} hitSlop={12}>
            <ChevronLeft size={28} color="#F8F6F2" />
          </Pressable>
          <Text className="text-lg font-semibold ml-3" style={{ color: '#F8F6F2' }}>Friends</Text>
        </View>
      </SafeAreaView>

      <View className="px-4 pt-3">
        <View className="flex-row items-center rounded-xl px-3" style={{ backgroundColor: '#EEECEA', height: 42 }}>
          <Search size={18} color="#8B8B8B" />
          <TextInput
            testID="friends-search"
            value={search}
            onChangeText={setSearch}
            placeholder="Search friends..."
            placeholderTextColor="#8B8B8B"
            className="flex-1 ml-2 text-sm"
            style={{ color: '#0A1F44' }}
          />
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} testID="friends-scroll">
        {debouncedSearch.trim().length >= 2 ? (
          <View className="mt-4" testID="search-results-section">
            <Text className="px-5 pb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: '#8B8B8B' }}>
              Search Results ({searchResults.length})
            </Text>
            {searchResults.map((person: User) => (
              <Pressable
                key={person.id}
                testID={`search-result-${person.id}`}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push(`/friend-profile/${person.id}` as any);
                }}
                className="flex-row items-center px-5 py-3"
              >
                <Image
                  source={{ uri: person.avatar }}
                  style={{ width: 48, height: 48, borderRadius: 24 }}
                />
                <View className="flex-1 ml-3">
                  <Text className="text-base font-medium" style={{ color: '#0A1F44' }}>{person.name}</Text>
                  {person.location ? (
                    <View className="flex-row items-center mt-0.5">
                      <MapPin size={12} color="#8B8B8B" />
                      <Text className="text-xs ml-1" style={{ color: '#8B8B8B' }}>{person.location}</Text>
                    </View>
                  ) : null}
                </View>
                <FriendStatusButton person={person} onRefresh={refetchFriends} />
              </Pressable>
            ))}
            {searchResults.length === 0 ? (
              <Text className="px-5 py-4 text-sm" style={{ color: '#8B8B8B' }}>No users found</Text>
            ) : null}
          </View>
        ) : (
          <>
            {friendRequests.length > 0 ? (
              <View className="mt-4">
                <Text className="px-5 pb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: '#8B8B8B' }}>
                  Friend Requests
                </Text>
                {friendRequests.map((req: FriendRequest) => (
                  <View
                    key={req.id}
                    className="mx-4 mb-2 rounded-2xl p-4"
                    style={{ backgroundColor: '#fff' }}
                  >
                    <View className="flex-row items-center">
                      <Image
                        source={{ uri: req.user.avatar }}
                        style={{ width: 48, height: 48, borderRadius: 24 }}
                      />
                      <View className="flex-1 ml-3">
                        <Text className="text-base font-semibold" style={{ color: '#0A1F44' }}>{req.user.name}</Text>
                        <Text className="text-xs" style={{ color: '#8B8B8B' }}>{req.mutualFriends} mutual friends</Text>
                      </View>
                    </View>
                    <View className="flex-row mt-3" style={{ gap: 8 }}>
                      <Pressable
                        testID={`accept-request-${req.id}`}
                        disabled={acceptingRequestIds.has(req.id) || decliningRequestIds.has(req.id)}
                        onPress={() => {
                          if (acceptingRequestIds.has(req.id) || decliningRequestIds.has(req.id)) return;
                          setAcceptingRequestIds(prev => new Set([...prev, req.id]));
                          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                          acceptRequest(req.id);
                        }}
                        className="flex-1 items-center justify-center rounded-lg py-2.5"
                        style={{ backgroundColor: '#FFFFFF', opacity: acceptingRequestIds.has(req.id) ? 0.6 : 1, flexDirection: 'row', gap: 6 }}
                      >
                        {acceptingRequestIds.has(req.id) ? <ActivityIndicator size="small" color="#0A1F44" testID={`accept-request-loading-${req.id}`} /> : null}
                        <Text className="text-sm font-semibold" style={{ color: '#0A1F44' }}>Accept</Text>
                      </Pressable>
                      <Pressable
                        testID={`decline-request-${req.id}`}
                        disabled={acceptingRequestIds.has(req.id) || decliningRequestIds.has(req.id)}
                        onPress={() => {
                          if (acceptingRequestIds.has(req.id) || decliningRequestIds.has(req.id)) return;
                          setDecliningRequestIds(prev => new Set([...prev, req.id]));
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                          declineRequest(req.id);
                        }}
                        className="flex-1 items-center justify-center rounded-lg py-2.5"
                        style={{ borderWidth: 1, borderColor: '#E5E7EB', opacity: decliningRequestIds.has(req.id) ? 0.6 : 1, flexDirection: 'row', gap: 6 }}
                      >
                        {decliningRequestIds.has(req.id) ? <ActivityIndicator size="small" color="#9CA3AF" testID={`decline-request-loading-${req.id}`} /> : null}
                        <Text className="text-sm font-medium" style={{ color: '#8B8B8B' }}>Decline</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            <View className="mx-4 mt-4 rounded-2xl p-4 flex-row items-center" style={{ backgroundColor: 'rgba(201,168,76,0.1)' }}>
              <Info size={18} color="#FFFFFF" />
              <Text className="flex-1 text-xs ml-2" style={{ color: '#0A1F44', lineHeight: 16 }}>
                Path+ keeps your circle close -- 150 connections max
              </Text>
            </View>

            <View className="mt-4">
              <Text className="px-5 pb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: '#8B8B8B' }}>
                Your Friends ({filteredFriends.length})
              </Text>
              {filteredFriends.map((friend: User) => (
                <Pressable
                  key={friend.id}
                  testID={`friend-item-${friend.id}`}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    router.push(`/friend-profile/${friend.id}` as any);
                  }}
                  className="flex-row items-center px-5 py-3"
                >
                  <Image
                    source={{ uri: friend.avatar }}
                    style={{ width: 48, height: 48, borderRadius: 24 }}
                  />
                  <View className="flex-1 ml-3">
                    <Text className="text-base font-medium" style={{ color: '#0A1F44' }}>{friend.name}</Text>
                    <View className="flex-row items-center mt-0.5">
                      <MapPin size={12} color="#8B8B8B" />
                      <Text className="text-xs ml-1" style={{ color: '#8B8B8B' }}>{friend.location}</Text>
                    </View>
                  </View>
                </Pressable>
              ))}
            </View>

            {suggested.length > 0 ? (
              <View className="mt-4">
                <Text className="px-5 pb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: '#8B8B8B' }}>
                  Suggested
                </Text>
                {suggested.map((person: User) => (
                  <Pressable
                    key={person.id}
                    testID={`suggested-item-${person.id}`}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      router.push(`/friend-profile/${person.id}` as any);
                    }}
                    className="flex-row items-center px-5 py-3"
                  >
                    <Image
                      source={{ uri: person.avatar }}
                      style={{ width: 48, height: 48, borderRadius: 24 }}
                    />
                    <View className="flex-1 ml-3">
                      <Text className="text-base font-medium" style={{ color: '#0A1F44' }}>{person.name}</Text>
                    </View>
                    <FriendStatusButton person={person} onRefresh={refetchFriends} />
                  </Pressable>
                ))}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}
