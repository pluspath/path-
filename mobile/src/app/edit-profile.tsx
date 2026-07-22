import React from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Camera, AlertCircle, CheckCircle, XCircle } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';

const ZODIAC_KEY = 'profile_show_zodiac';
const USERNAME_CHANGED_KEY = 'profile_username_changed';

interface UserProfile {
  id: string;
  name: string;
  username?: string;
  avatar?: string;
  coverPhoto?: string;
  bio?: string;
  location?: string;
  birthday?: string;
}

type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'error';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const YEARS = Array.from({ length: 29 }, (_, i) => 1980 + i); // 1980–2008
const PICKER_ITEM_H = 48;
const TODAY = new Date();
const MAX_BIRTHDAY = new Date(TODAY.getFullYear() - 18, TODAY.getMonth(), TODAY.getDate());

// PickerRef exposes the current scroll position independent of React state
interface PickerRef {
  getIndex: () => number;
  scrollToIndex: (index: number, animated?: boolean) => void;
}

const PickerColumn = React.forwardRef<PickerRef, {
  items: string[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}>(function PickerColumnInner({ items, selectedIndex, onSelect }, ref) {
  const scrollRef = React.useRef<ScrollView>(null);
  // Track latest scroll offset via onScroll — never stale, unlike React state
  const latestOffset = React.useRef(selectedIndex * PICKER_ITEM_H);
  const prevSelected = React.useRef(selectedIndex);

  React.useImperativeHandle(ref, () => ({
    getIndex: () => {
      const idx = Math.round(latestOffset.current / PICKER_ITEM_H);
      return Math.max(0, Math.min(idx, items.length - 1));
    },
    scrollToIndex: (index: number, animated = true) => {
      const y = index * PICKER_ITEM_H;
      latestOffset.current = y;
      prevSelected.current = index;
      scrollRef.current?.scrollTo({ y, animated });
    },
  }), [items.length]);

  // Initial scroll on mount
  React.useEffect(() => {
    const t = setTimeout(() => {
      const y = selectedIndex * PICKER_ITEM_H;
      latestOffset.current = y;
      scrollRef.current?.scrollTo({ y, animated: false });
    }, 80);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync when selectedIndex changes externally (e.g. modal reset)
  React.useEffect(() => {
    if (selectedIndex !== prevSelected.current) {
      prevSelected.current = selectedIndex;
      latestOffset.current = selectedIndex * PICKER_ITEM_H;
      scrollRef.current?.scrollTo({ y: selectedIndex * PICKER_ITEM_H, animated: true });
    }
  }, [selectedIndex]);

  // Clamp scroll when items shrink (fewer days in month)
  React.useEffect(() => {
    const maxOffset = Math.max(0, (items.length - 1) * PICKER_ITEM_H);
    if (latestOffset.current > maxOffset) {
      latestOffset.current = maxOffset;
      scrollRef.current?.scrollTo({ y: maxOffset, animated: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  const handleScroll = React.useCallback((e: any) => {
    latestOffset.current = e.nativeEvent.contentOffset.y;
  }, []);

  const handleEnd = React.useCallback((e: any) => {
    const offset = e.nativeEvent.contentOffset.y;
    latestOffset.current = offset;
    const idx = Math.max(0, Math.min(Math.round(offset / PICKER_ITEM_H), items.length - 1));
    const snappedY = idx * PICKER_ITEM_H;
    latestOffset.current = snappedY;
    prevSelected.current = idx;
    scrollRef.current?.scrollTo({ y: snappedY, animated: true });
    onSelect(idx);
  }, [items.length, onSelect]);

  return (
    <View style={{ flex: 1, height: PICKER_ITEM_H * 5, overflow: 'hidden' }}>
      <View
        style={{
          position: 'absolute',
          top: PICKER_ITEM_H * 2,
          left: 4,
          right: 4,
          height: PICKER_ITEM_H,
          backgroundColor: '#F0EDE8',
          borderRadius: 10,
        }}
        pointerEvents="none"
      />
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        snapToInterval={PICKER_ITEM_H}
        decelerationRate="fast"
        contentContainerStyle={{ paddingVertical: PICKER_ITEM_H * 2 }}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        onMomentumScrollEnd={handleEnd}
        onScrollEndDrag={handleEnd}
      >
        {items.map((item, i) => (
          <Pressable
            key={i}
            style={{ height: PICKER_ITEM_H, justifyContent: 'center', alignItems: 'center' }}
            onPress={() => {
              const y = i * PICKER_ITEM_H;
              latestOffset.current = y;
              prevSelected.current = i;
              scrollRef.current?.scrollTo({ y, animated: true });
              onSelect(i);
            }}
          >
            <Text style={{ fontSize: 15, color: '#0A1F44' }}>{item}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
});

function BirthdayPickerModal({
  visible,
  currentBirthday,
  onDone,
  onCancel,
}: {
  visible: boolean;
  currentBirthday: string;
  onDone: (birthday: string) => void;
  onCancel: () => void;
}) {
  const getInitial = () => {
    if (currentBirthday) {
      const d = new Date(currentBirthday + 'T12:00:00');
      if (!isNaN(d.getTime())) {
        return {
          m: d.getMonth(),
          d: d.getDate(),
          y: Math.min(Math.max(d.getFullYear(), 1980), 2008),
        };
      }
    }
    return { m: 5, d: 15, y: 1990 };
  };

  const [selMonth, setSelMonth] = React.useState(() => getInitial().m);
  const [selDay, setSelDay] = React.useState(() => getInitial().d);
  const [selYear, setSelYear] = React.useState(() => getInitial().y);

  const monthRef = React.useRef<PickerRef>(null);
  const dayRef = React.useRef<PickerRef>(null);
  const yearRef = React.useRef<PickerRef>(null);

  React.useEffect(() => {
    if (visible) {
      const { m, d, y } = getInitial();
      setSelMonth(m);
      setSelDay(d);
      setSelYear(y);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const daysInMonth = new Date(selYear, selMonth + 1, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => String(i + 1));

  React.useEffect(() => {
    if (selDay > daysInMonth) setSelDay(daysInMonth);
  }, [selMonth, selYear, daysInMonth]);

  const handleDone = () => {
    // Read from refs — these are always current regardless of React state batching
    const m = monthRef.current?.getIndex() ?? selMonth;
    const rawDayIdx = dayRef.current?.getIndex() ?? Math.min(selDay - 1, daysInMonth - 1);
    const yearIdx = yearRef.current?.getIndex() ?? YEARS.indexOf(selYear);

    const y = YEARS[Math.max(0, Math.min(yearIdx, YEARS.length - 1))];
    const actualDaysInMonth = new Date(y, m + 1, 0).getDate();
    const d = Math.min(rawDayIdx + 1, actualDaysInMonth);

    let fy = y, fm = m, fd = d;
    const chosen = new Date(y, m, d);
    if (chosen > MAX_BIRTHDAY) {
      fy = MAX_BIRTHDAY.getFullYear();
      fm = MAX_BIRTHDAY.getMonth();
      fd = MAX_BIRTHDAY.getDate();
    }

    const mStr = String(fm + 1).padStart(2, '0');
    const dStr = String(fd).padStart(2, '0');
    onDone(`${fy}-${mStr}-${dStr}`);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}
        onPress={onCancel}
      >
        <Pressable onPress={() => {}}>
          <View
            style={{
              backgroundColor: '#FFFFFF',
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              paddingBottom: 36,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingHorizontal: 20,
                paddingVertical: 16,
                borderBottomWidth: 1,
                borderBottomColor: '#F3F4F6',
              }}
            >
              <Pressable onPress={onCancel}>
                <Text style={{ fontSize: 16, color: '#6B7280' }}>Cancel</Text>
              </Pressable>
              <Text style={{ fontSize: 16, fontWeight: '700', color: '#0A1F44' }}>Birthday</Text>
              <Pressable testID="birthday-done" onPress={handleDone}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: '#0A1F44' }}>Done</Text>
              </Pressable>
            </View>

            <View style={{ flexDirection: 'row', paddingHorizontal: 12, paddingTop: 8 }}>
              <PickerColumn
                ref={monthRef}
                items={MONTHS}
                selectedIndex={selMonth}
                onSelect={setSelMonth}
              />
              <PickerColumn
                ref={dayRef}
                items={days}
                selectedIndex={Math.min(selDay - 1, days.length - 1)}
                onSelect={(i) => setSelDay(i + 1)}
              />
              <PickerColumn
                ref={yearRef}
                items={YEARS.map(String)}
                selectedIndex={YEARS.indexOf(selYear)}
                onSelect={(i) => setSelYear(YEARS[i])}
              />
            </View>

            <Text style={{ textAlign: 'center', fontSize: 12, color: '#9CA3AF', marginTop: 8 }}>
              Must be 18+ · 1980–2008
            </Text>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function getZodiacSign(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const m = d.getMonth() + 1;
  const day = d.getDate();
  if ((m === 3 && day >= 21) || (m === 4 && day <= 19)) return '♈ Aries';
  if ((m === 4 && day >= 20) || (m === 5 && day <= 20)) return '♉ Taurus';
  if ((m === 5 && day >= 21) || (m === 6 && day <= 20)) return '♊ Gemini';
  if ((m === 6 && day >= 21) || (m === 7 && day <= 22)) return '♋ Cancer';
  if ((m === 7 && day >= 23) || (m === 8 && day <= 22)) return '♌ Leo';
  if ((m === 8 && day >= 23) || (m === 9 && day <= 22)) return '♍ Virgo';
  if ((m === 9 && day >= 23) || (m === 10 && day <= 22)) return '♎ Libra';
  if ((m === 10 && day >= 23) || (m === 11 && day <= 21)) return '♏ Scorpio';
  if ((m === 11 && day >= 22) || (m === 12 && day <= 21)) return '♐ Sagittarius';
  if ((m === 12 && day >= 22) || (m === 1 && day <= 19)) return '♑ Capricorn';
  if ((m === 1 && day >= 20) || (m === 2 && day <= 18)) return '♒ Aquarius';
  return '♓ Pisces';
}

export default function EditProfileScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [name, setName] = React.useState<string>('');
  const [username, setUsername] = React.useState<string>('');
  const [bio, setBio] = React.useState<string>('');
  const [location, setLocation] = React.useState<string>('');
  const [birthday, setBirthday] = React.useState<string>('');
  const [showZodiac, setShowZodiac] = React.useState<boolean>(false);
  const [usernameChanged, setUsernameChanged] = React.useState<boolean>(false);
  const [avatarUri, setAvatarUri] = React.useState<string | null>(null);
  const [coverUri, setCoverUri] = React.useState<string | null>(null);
  const [originalUsername, setOriginalUsername] = React.useState<string>('');
  const [usernameStatus, setUsernameStatus] = React.useState<UsernameStatus>('idle');
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = React.useState<boolean>(false);
  const [uploadingCover, setUploadingCover] = React.useState<boolean>(false);
  const [showDatePicker, setShowDatePicker] = React.useState<boolean>(false);

  const usernameCheckTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load persisted preferences from AsyncStorage on mount
  React.useEffect(() => {
    AsyncStorage.multiGet([ZODIAC_KEY, USERNAME_CHANGED_KEY]).then((pairs) => {
      const zodiacVal = pairs[0][1];
      const usernameChangedVal = pairs[1][1];
      if (zodiacVal !== null) setShowZodiac(zodiacVal === 'true');
      if (usernameChangedVal !== null) setUsernameChanged(usernameChangedVal === 'true');
    });
  }, []);

  const profileQuery = useQuery<UserProfile>({
    queryKey: ['me'],
    queryFn: () => api.get<UserProfile>('/api/me'),
    staleTime: 60_000,
  });

  const profileLoading = profileQuery.isLoading;
  const profileError = profileQuery.error;

  React.useEffect(() => {
    if (profileQuery.data) {
      const p = profileQuery.data;
      setName(p.name ?? '');
      setUsername(p.username ?? '');
      setOriginalUsername(p.username ?? '');
      setBio(p.bio ?? '');
      setLocation(p.location ?? '');
      setBirthday(p.birthday ?? '');
      if (p.avatar) setAvatarUri(p.avatar);
      if (p.coverPhoto) setCoverUri(p.coverPhoto);
    }
  }, [profileQuery.data]);

  const checkUsername = React.useCallback((value: string) => {
    if (!value || value === originalUsername) {
      setUsernameStatus('idle');
      return;
    }
    setUsernameStatus('checking');
    if (usernameCheckTimer.current) clearTimeout(usernameCheckTimer.current);
    usernameCheckTimer.current = setTimeout(async () => {
      try {
        const result = await api.get<{ available: boolean }>(`/api/username-check/${encodeURIComponent(value)}`);
        setUsernameStatus(result.available ? 'available' : 'taken');
      } catch {
        setUsernameStatus('error');
      }
    }, 500);
  }, [originalUsername]);

  const handleUsernameChange = (value: string) => {
    const cleaned = value.toLowerCase().replace(/\s/g, '');
    setUsername(cleaned);
    checkUsername(cleaned);
  };

  const handleZodiacToggle = () => {
    const newVal = !showZodiac;
    setShowZodiac(newVal);
    AsyncStorage.setItem(ZODIAC_KEY, newVal.toString());
  };

  const handlePickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    const uri = asset.uri;
    setUploadingAvatar(true);
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const token = authSession?.access_token;
      const fileResp = await fetch(uri);
      const blob = await fileResp.blob();

      const formData = new FormData();
      formData.append('file', blob as any, 'photo.jpg');

      const baseUrl = process.env.EXPO_PUBLIC_BACKEND_URL!;
      const response = await fetch(`${baseUrl}/api/upload/avatar`, {
        method: 'POST',
        body: formData,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson?.error?.message ?? 'Upload failed');
      }
      const json = await response.json();
      setAvatarUri(json.data?.url ?? json.url);
    } catch (err: any) {
      setSaveError(err?.message ?? 'Failed to upload photo');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handlePickCover = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [3, 1],
      quality: 0.8,
    });

    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    const uri = asset.uri;
    setUploadingCover(true);
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const token = authSession?.access_token;
      const fileResp = await fetch(uri);
      const blob = await fileResp.blob();

      const formData = new FormData();
      formData.append('file', blob as any, 'cover.jpg');

      const baseUrl = process.env.EXPO_PUBLIC_BACKEND_URL!;
      const response = await fetch(`${baseUrl}/api/upload/cover`, {
        method: 'POST',
        body: formData,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson?.error?.message ?? 'Upload failed');
      }
      const json = await response.json();
      setCoverUri(json.data?.url ?? json.url);
    } catch (err: any) {
      setSaveError(err?.message ?? 'Failed to upload cover photo');
    } finally {
      setUploadingCover(false);
    }
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload: Record<string, string | undefined> = {
        name: name.trim() || undefined,
        username: username.trim() || undefined,
        bio: bio.trim() || undefined,
        location: location.trim() || undefined,
        birthday: birthday.trim() || undefined,
        avatar: avatarUri ?? undefined,
        coverPhoto: coverUri ?? undefined,
      };
      return api.put<UserProfile>('/api/me', payload);
    },
    onSuccess: () => {
      // Persist zodiac pref to AsyncStorage
      AsyncStorage.setItem(ZODIAC_KEY, showZodiac.toString());
      // Mark username as changed (once-only lock)
      if (username.trim() && username.trim() !== originalUsername) {
        AsyncStorage.setItem(USERNAME_CHANGED_KEY, 'true');
        setUsernameChanged(true);
      }
      queryClient.invalidateQueries({ queryKey: ['me'] });
      queryClient.invalidateQueries({ queryKey: ['user', 'me'] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (router.canGoBack()) router.back(); else router.replace('/(tabs)');
    },
    onError: (err: any) => {
      setSaveError(err?.message ?? 'Failed to save changes');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    },
  });

  const canSave =
    !saveMutation.isPending &&
    !uploadingAvatar &&
    !uploadingCover &&
    usernameStatus !== 'checking' &&
    (usernameChanged || usernameStatus !== 'taken');

  const handleSave = () => {
    if (!canSave) return;
    setSaveError(null);
    saveMutation.mutate();
  };

  const displayAvatar = avatarUri ?? profileQuery.data?.avatar;
  const displayCover = coverUri ?? profileQuery.data?.coverPhoto;

  if (profileLoading) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: '#F8F6F2' }} testID="edit-profile-loading">
        <ActivityIndicator size="large" color="#0A1F44" />
      </View>
    );
  }

  if (profileError) {
    return (
      <View className="flex-1 items-center justify-center px-8" style={{ backgroundColor: '#F8F6F2' }} testID="edit-profile-error">
        <AlertCircle size={40} color="#FFFFFF" />
        <Text className="text-base mt-3 text-center" style={{ color: '#0A1F44' }}>
          Could not load profile. Please try again.
        </Text>
        <Pressable
          className="mt-4 px-6 py-3 rounded-xl"
          style={{ backgroundColor: '#0A1F44' }}
          onPress={() => profileQuery.refetch()}
        >
          <Text style={{ color: '#F8F6F2' }}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-1" style={{ backgroundColor: '#F8F6F2' }} testID="edit-profile-screen">
      <SafeAreaView edges={['top']} style={{ backgroundColor: '#0A1F44' }}>
        <View
          className="flex-row items-center justify-between px-4 pb-3 pt-1"
          style={{ backgroundColor: '#0A1F44' }}
        >
          <Pressable testID="edit-cancel" onPress={() => { if (router.canGoBack()) router.back(); else router.replace('/(tabs)'); }}>
            <Text className="text-base" style={{ color: '#F8F6F2' }}>Cancel</Text>
          </Pressable>
          <Text className="text-lg font-semibold" style={{ color: '#F8F6F2' }}>Edit Profile</Text>
          <Pressable testID="edit-save" onPress={handleSave} disabled={!canSave}>
            {saveMutation.isPending ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text
                className="text-base font-semibold"
                style={{ color: canSave ? '#FFFFFF' : '#8B8B8B' }}
              >
                Save
              </Text>
            )}
          </Pressable>
        </View>
      </SafeAreaView>

      <ScrollView
        className="flex-1"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {/* Avatar */}
        <View className="items-center mt-6">
          <Pressable testID="edit-change-photo" onPress={handlePickImage} disabled={uploadingAvatar}>
            {displayAvatar ? (
              <Image
                source={{ uri: displayAvatar }}
                style={{ width: 96, height: 96, borderRadius: 48 }}
                contentFit="cover"
              />
            ) : (
              <View
                style={{
                  width: 96,
                  height: 96,
                  borderRadius: 48,
                  backgroundColor: '#D9D5CE',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              />
            )}
            <View
              style={{
                position: 'absolute',
                bottom: 0,
                right: 0,
                width: 32,
                height: 32,
                borderRadius: 16,
                backgroundColor: uploadingAvatar ? '#8B8B8B' : '#FFFFFF',
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 2,
                borderColor: '#F8F6F2',
              }}
            >
              {uploadingAvatar ? (
                <ActivityIndicator size="small" color="#F8F6F2" />
              ) : (
                <Camera size={16} color="#0A1F44" />
              )}
            </View>
          </Pressable>
          <Text className="text-sm mt-2" style={{ color: '#FFFFFF' }}>
            {uploadingAvatar ? 'Uploading...' : 'Change Photo'}
          </Text>
        </View>

        {/* Cover Photo */}
        <View style={{ width: '100%', marginTop: 16 }}>
          <Text style={{ fontSize: 11, fontWeight: '600', color: '#8B8B8B', textTransform: 'uppercase', marginBottom: 8, marginLeft: 16 }}>Cover Photo</Text>
          <Pressable testID="edit-change-cover" onPress={handlePickCover} disabled={uploadingCover}>
            <View
              style={{
                marginHorizontal: 16,
                height: 100,
                borderRadius: 12,
                overflow: 'hidden',
                backgroundColor: '#1E3A5F',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {displayCover ? (
                <Image
                  source={{ uri: displayCover }}
                  style={{ width: '100%', height: '100%' }}
                  contentFit="cover"
                />
              ) : (
                <Camera size={28} color="#FFFFFF" />
              )}
              <View
                style={{
                  position: 'absolute',
                  bottom: 8,
                  right: 8,
                  backgroundColor: uploadingCover ? '#8B8B8B' : '#FFFFFF',
                  borderRadius: 14,
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                {uploadingCover ? (
                  <ActivityIndicator size="small" color="#F8F6F2" />
                ) : (
                  <Camera size={12} color="#0A1F44" />
                )}
                <Text style={{ fontSize: 11, fontWeight: '600', color: uploadingCover ? '#F8F6F2' : '#0A1F44' }}>
                  {uploadingCover ? 'Uploading...' : 'Change Cover'}
                </Text>
              </View>
            </View>
          </Pressable>
        </View>

        {/* Error banner */}
        {saveError ? (
          <View
            className="mx-4 mt-4 flex-row items-center px-4 py-3 rounded-xl"
            style={{ backgroundColor: '#FFF0F0', gap: 8 }}
            testID="edit-save-error"
          >
            <AlertCircle size={16} color="#C0392B" />
            <Text className="text-sm flex-1" style={{ color: '#C0392B' }}>{saveError}</Text>
          </View>
        ) : null}

        {/* Fields */}
        <View className="mx-4 mt-6" style={{ gap: 16 }}>
          {/* Full Name */}
          <View>
            <Text className="text-xs font-semibold uppercase mb-1.5 ml-1" style={{ color: '#8B8B8B' }}>
              Full Name
            </Text>
            <TextInput
              testID="edit-name-input"
              value={name}
              onChangeText={setName}
              className="rounded-xl px-4 py-3 text-sm"
              style={{ backgroundColor: '#fff', color: '#0A1F44' }}
              placeholder="Your name"
              placeholderTextColor="#8B8B8B"
            />
          </View>

          {/* Username */}
          <View>
            <Text className="text-xs font-semibold uppercase mb-1.5 ml-1" style={{ color: '#8B8B8B' }}>
              Username <Text style={{ fontWeight: '400', textTransform: 'none' }}>— your unique @handle, separate from your display name</Text>
            </Text>
            {usernameChanged ? (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#F3F4F6', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12 }}>
                  <Text style={{ fontSize: 14, color: '#6B7280', fontWeight: '600', marginRight: 2 }}>@</Text>
                  <Text testID="edit-username-input" style={{ fontSize: 14, color: '#6B7280', flex: 1 }}>{username}</Text>
                </View>
                <Text className="text-xs mt-1 ml-1" style={{ color: '#9CA3AF' }}>
                  Username can only be changed once and cannot be edited again.
                </Text>
              </>
            ) : (
              <>
                <View style={{ position: 'relative', flexDirection: 'row', alignItems: 'center' }}>
                  <View
                    style={{
                      backgroundColor: '#E9E7E3',
                      borderTopLeftRadius: 12,
                      borderBottomLeftRadius: 12,
                      paddingHorizontal: 12,
                      paddingVertical: 12,
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ fontSize: 14, color: '#6B7280', fontWeight: '600' }}>@</Text>
                  </View>
                  <TextInput
                    testID="edit-username-input"
                    value={username}
                    onChangeText={handleUsernameChange}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={{
                      flex: 1,
                      backgroundColor: '#fff',
                      color: '#0A1F44',
                      borderTopRightRadius: 12,
                      borderBottomRightRadius: 12,
                      paddingHorizontal: 12,
                      paddingVertical: 12,
                      paddingRight: 40,
                      fontSize: 14,
                      borderWidth: usernameStatus === 'taken' ? 1 : 0,
                      borderColor: usernameStatus === 'taken' ? '#C0392B' : 'transparent',
                    }}
                    placeholder="yourhandle"
                    placeholderTextColor="#8B8B8B"
                  />
                  <View
                    style={{
                      position: 'absolute',
                      right: 12,
                      top: 0,
                      bottom: 0,
                      justifyContent: 'center',
                    }}
                  >
                    {usernameStatus === 'checking' ? (
                      <ActivityIndicator size="small" color="#8B8B8B" />
                    ) : usernameStatus === 'available' ? (
                      <CheckCircle size={18} color="#27AE60" />
                    ) : usernameStatus === 'taken' ? (
                      <XCircle size={18} color="#C0392B" />
                    ) : null}
                  </View>
                </View>
                {usernameStatus === 'taken' ? (
                  <Text className="text-xs mt-1 ml-1" style={{ color: '#C0392B' }} testID="edit-username-taken">
                    Username is already taken
                  </Text>
                ) : usernameStatus === 'available' ? (
                  <Text className="text-xs mt-1 ml-1" style={{ color: '#27AE60' }} testID="edit-username-available">
                    Username is available
                  </Text>
                ) : (
                  <Text className="text-xs mt-1 ml-1" style={{ color: '#9CA3AF' }}>
                    Lowercase letters and numbers only. You can only change this once.
                  </Text>
                )}
              </>
            )}
          </View>

          {/* Bio */}
          <View>
            <Text className="text-xs font-semibold uppercase mb-1.5 ml-1" style={{ color: '#8B8B8B' }}>
              Bio
            </Text>
            <TextInput
              testID="edit-bio-input"
              value={bio}
              onChangeText={setBio}
              multiline
              className="rounded-xl px-4 py-3 text-sm"
              style={{
                backgroundColor: '#fff',
                color: '#0A1F44',
                minHeight: 80,
                textAlignVertical: 'top',
              }}
              placeholder="Tell people about yourself"
              placeholderTextColor="#8B8B8B"
            />
          </View>

          {/* Location */}
          <View>
            <Text className="text-xs font-semibold uppercase mb-1.5 ml-1" style={{ color: '#8B8B8B' }}>
              Location
            </Text>
            <TextInput
              testID="edit-location-input"
              value={location}
              onChangeText={setLocation}
              className="rounded-xl px-4 py-3 text-sm"
              style={{ backgroundColor: '#fff', color: '#0A1F44' }}
              placeholder="Where are you based?"
              placeholderTextColor="#8B8B8B"
            />
          </View>

          {/* Birthday */}
          <View>
            <Text className="text-xs font-semibold uppercase mb-1.5 ml-1" style={{ color: '#8B8B8B' }}>
              Birthday
            </Text>
            <Pressable
              testID="edit-birthday-input"
              onPress={() => setShowDatePicker(true)}
              style={{ backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14 }}
            >
              <Text style={{ fontSize: 14, color: birthday ? '#0A1F44' : '#8B8B8B' }}>
                {birthday
                  ? new Date(birthday + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
                  : 'Select your birthday'}
              </Text>
            </Pressable>
            {birthday ? (
              <Pressable
                testID="show-zodiac-toggle"
                onPress={handleZodiacToggle}
                style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 10 }}
              >
                <View style={{
                  width: 44, height: 24, borderRadius: 12,
                  backgroundColor: showZodiac ? '#6366F1' : '#D1D5DB',
                  justifyContent: 'center',
                  paddingHorizontal: 2,
                }}>
                  <View style={{
                    width: 20, height: 20, borderRadius: 10, backgroundColor: '#FFFFFF',
                    transform: [{ translateX: showZodiac ? 20 : 0 }],
                  }} />
                </View>
                <Text style={{ fontSize: 13, color: '#6B7280' }}>
                  Show zodiac on profile{showZodiac ? ` · ${getZodiacSign(birthday)}` : ''}
                </Text>
              </Pressable>
            ) : null}
            <BirthdayPickerModal
              visible={showDatePicker}
              currentBirthday={birthday}
              onDone={(val) => { setBirthday(val); setShowDatePicker(false); }}
              onCancel={() => setShowDatePicker(false)}
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
