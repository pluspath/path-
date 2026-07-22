import React from 'react';
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { X, Camera, MapPin, Moon, Brain, Sun } from 'lucide-react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import { MomentType, Post, NearbyPlace } from '@/lib/types';
import { MOMENT_CONFIG } from '@/lib/mock-data';
import { usePathStore } from '@/lib/store';
import { useSession } from '@/lib/auth/use-session';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { supabase } from '@/lib/supabase';

const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50 MB

function getPlaceEmoji(types: string[]): string {
  if (types.includes('restaurant') || types.includes('food')) return '🍽️';
  if (types.includes('cafe') || types.includes('coffee_shop')) return '☕';
  if (types.includes('bar') || types.includes('night_club')) return '🍸';
  if (types.includes('gym') || types.includes('fitness_center')) return '🏋️';
  if (types.includes('park') || types.includes('natural_feature')) return '🌳';
  if (types.includes('shopping_mall') || types.includes('store')) return '🛍️';
  if (types.includes('airport')) return '✈️';
  if (types.includes('hotel') || types.includes('lodging')) return '🏨';
  if (types.includes('school') || types.includes('university')) return '🎓';
  if (types.includes('hospital') || types.includes('doctor')) return '🏥';
  if (types.includes('gas_station')) return '⛽';
  if (types.includes('bank') || types.includes('atm')) return '🏦';
  return '📍';
}

export default function CreateMomentScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ type: string }>();
  const momentType = (params.type || 'thought') as MomentType;
  const lastSleepTimestamp = usePathStore((s) => s.lastSleepTimestamp);
  const setLastSleepTimestamp = usePathStore((s) => s.setLastSleepTimestamp);
  const setIsSleeping = usePathStore((s) => s.setIsSleeping);
  const config = MOMENT_CONFIG[momentType] ?? MOMENT_CONFIG['thought'];
  const { data: session } = useSession();
  const queryClient = useQueryClient();

  const { mutate: createPost, isPending: isPosting } = useMutation({
    mutationFn: (post: Partial<Post>) => api.post<Post>('/api/posts', post),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['posts'] });
      queryClient.invalidateQueries({ queryKey: ['posts', 'me'] });
      if (variables.type === 'sleep' && variables.sleepAction === 'sleeping') {
        setIsSleeping(true);
        router.replace('/sleep-screen' as any);
      } else {
        if (router.canGoBack()) router.back(); else router.replace('/(tabs)');
      }
    },
  });

  // Determine sleepAction from type
  const isSleepOrWakeup = momentType === 'sleep' || momentType === 'wakeup';
  const defaultSleepAction: 'sleeping' | 'woke_up' = momentType === 'wakeup' ? 'woke_up' : 'sleeping';

  const [content, setContent] = React.useState('');
  const [locationName, setLocationName] = React.useState('');
  const [sleepAction] = React.useState<'sleeping' | 'woke_up'>(defaultSleepAction);
  const [locationLat, setLocationLat] = React.useState<number | null>(null);
  const [locationLng, setLocationLng] = React.useState<number | null>(null);
  const [isGettingLocation, setIsGettingLocation] = React.useState(false);
  const [locationPermissionError, setLocationPermissionError] = React.useState<string | null>(null);
  const [locationDebugError, setLocationDebugError] = React.useState<string | null>(null);
  const [selectedImage, setSelectedImage] = React.useState<string | null>(null);
  const [isVideo, setIsVideo] = React.useState(false);
  const [uploadingMedia, setUploadingMedia] = React.useState(false);
  const [uploadProgress, setUploadProgress] = React.useState(0);
  const [mediaError, setMediaError] = React.useState<string | null>(null);

  // Google Places state
  const [nearbyPlaces, setNearbyPlaces] = React.useState<NearbyPlace[]>([]);
  const [loadingPlaces, setLoadingPlaces] = React.useState(false);
  const [selectedPlace, setSelectedPlace] = React.useState<NearbyPlace | null>(null);

  // Progress bar animation
  const progressWidth = useSharedValue(0);
  const progressStyle = useAnimatedStyle(() => ({
    width: `${progressWidth.value}%` as any,
  }));

  React.useEffect(() => {
    progressWidth.value = withTiming(uploadProgress, { duration: 300 });
  }, [uploadProgress]);

  const handleGetGPSLocation = async () => {
    setIsGettingLocation(true);
    setLocationPermissionError(null);
    setLocationDebugError(null);
    setNearbyPlaces([]);
    setSelectedPlace(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationPermissionError('Location permission denied. Please enable it in Settings.');
        setIsGettingLocation(false);
        return;
      }

      // Try last-known position first for speed, fall back to fresh fix with 10s timeout
      let loc = await Location.getLastKnownPositionAsync({ maxAge: 60000 });
      if (!loc) {
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Location timed out after 10 seconds')), 10000)
        );
        loc = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
          timeout,
        ]);
      }

      const lat = loc.coords.latitude;
      const lng = loc.coords.longitude;
      setLocationLat(lat);
      setLocationLng(lng);

      // Reverse geocode — non-fatal: if it fails we keep the raw coords
      try {
        const [geo] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
        if (geo) {
          const parts: string[] = [];
          if (geo.name) parts.push(geo.name);
          if (geo.city) parts.push(geo.city);
          if (geo.region) parts.push(geo.region);
          const readable = parts.join(', ');
          if (readable) setLocationName(readable);
        }
      } catch (geoErr) {
        console.error('[Location] reverseGeocode failed (non-fatal):', geoErr);
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Fetch nearby places directly from Google Places API
      setLoadingPlaces(true);
      try {
        const googleKey = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY!;
        const placesResp = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': googleKey,
            'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.types,places.rating',
            'X-Ios-Bundle-Identifier': 'host.exp.Exponent',
          },
          body: JSON.stringify({
            locationRestriction: {
              circle: {
                center: { latitude: lat, longitude: lng },
                radius: 500,
              },
            },
            maxResultCount: 20,
          }),
        });
        if (placesResp.ok) {
          const placesData = await placesResp.json() as { places?: any[] };
          const mapped = (placesData.places ?? []).map((p: any) => ({
            name: p.displayName?.text ?? 'Unknown Place',
            address: p.formattedAddress ?? '',
            types: p.types ?? [],
            rating: p.rating ?? null,
          }));
          setNearbyPlaces(mapped);
        }
      } catch (placesErr) {
        console.error('[Location] Google Places fetch failed (non-fatal):', placesErr);
      } finally {
        setLoadingPlaces(false);
      }
    } catch (err) {
      console.error('[Location] GPS location failed:', err);
      setLocationPermissionError('Could not get location. Please try again.');
      setLocationDebugError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsGettingLocation(false);
    }
  };

  const handleSelectPlace = (place: NearbyPlace) => {
    setSelectedPlace(place);
    setLocationName(place.name);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handlePickImage = async () => {
    setMediaError(null);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    const uri = asset.uri;
    const type = asset.type ?? 'image';

    setUploadingMedia(true);
    setUploadProgress(0);
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const userId = authSession?.user?.id ?? 'anon';
      const ext = uri.split('.').pop()?.toLowerCase() ?? (type === 'video' ? 'mp4' : 'jpg');
      const contentType = type === 'video'
        ? (ext === 'mov' ? 'video/quicktime' : 'video/mp4')
        : (ext === 'png' ? 'image/png' : 'image/jpeg');
      const fileName = `${userId}/${Date.now()}.${ext}`;

      // Simulate progress to 80% during upload
      const progressTimer = setInterval(() => {
        setUploadProgress(prev => {
          if (prev >= 80) { clearInterval(progressTimer); return 80; }
          return prev + 10;
        });
      }, 200);

      const response = await fetch(uri);
      const blob = await response.blob();

      const { error: uploadError } = await supabase.storage
        .from('Posts')
        .upload(fileName, blob, { contentType, upsert: true });

      clearInterval(progressTimer);

      if (uploadError) throw new Error(uploadError.message);

      setUploadProgress(100);
      const { data: urlData } = supabase.storage.from('Posts').getPublicUrl(fileName);
      setSelectedImage(urlData.publicUrl);
      setIsVideo(type === 'video');
    } catch (err: any) {
      setMediaError(err?.message ?? 'Upload failed. Please try again.');
      setUploadProgress(0);
    } finally {
      setUploadingMedia(false);
    }
  };

  const getMomentIcon = () => {
    switch (momentType) {
      case 'location': return <MapPin size={20} color={config.color} />;
      case 'sleep': return <Moon size={20} color={config.color} />;
      case 'wakeup': return <Sun size={20} color={config.color} />;
      case 'thought': return <Brain size={20} color={config.color} />;
      default: return <Camera size={20} color={config.color} />;
    }
  };

  const isSubmitEnabled = (): boolean => {
    if (uploadingMedia || isPosting) return false;
    if (isSleepOrWakeup) return true;
    if (momentType === 'location') return locationName.trim().length > 0;
    return content.trim().length > 0 || selectedImage !== null;
  };

  const handleSubmit = () => {
    if (!isSubmitEnabled() || isPosting) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    let sleepDuration: string | undefined;
    if (isSleepOrWakeup) {
      if (sleepAction === 'sleeping') {
        setLastSleepTimestamp(new Date().toISOString());
      } else if (sleepAction === 'woke_up' && lastSleepTimestamp) {
        const sleptMs = Date.now() - new Date(lastSleepTimestamp).getTime();
        const sleptHours = Math.floor(sleptMs / 3600000);
        const sleptMins = Math.floor((sleptMs % 3600000) / 60000);
        sleepDuration = `${sleptHours}h ${sleptMins}m`;
        setLastSleepTimestamp(null);
      }
    }

    const newPost: Partial<Post> = {
      userId: session?.user?.id ?? '',
      type: isSleepOrWakeup ? 'sleep' : momentType,
      content: content.trim() || undefined,
      reactions: [],
      commentCount: 0,
      createdAt: new Date().toISOString(),
      ...(locationName ? { locationName } : {}),
      ...(locationLat !== null ? { locationLat } : {}),
      ...(locationLng !== null ? { locationLng } : {}),
      ...(isSleepOrWakeup ? { sleepAction } : {}),
      ...(sleepDuration ? { sleepDuration } : {}),
      ...(selectedImage ? { image: selectedImage } : {}),
    };

    createPost(newPost);
  };

  return (
    <View className="flex-1 bg-[#F8F6F2]" testID="create-moment-screen">
      <SafeAreaView edges={['top']} style={{ backgroundColor: '#F8F6F2' }}>
        <View className="flex-row items-center justify-between px-5 py-3">
          <Pressable testID="create-close" onPress={() => { if (router.canGoBack()) router.back(); else router.replace('/(tabs)'); }} hitSlop={12}>
            <X size={24} color="#0A1F44" />
          </Pressable>
          <View className="flex-row items-center">
            {getMomentIcon()}
            <Text className="text-base font-semibold ml-2" style={{ color: '#0A1F44' }}>{config.label}</Text>
          </View>
          <View style={{ width: 24 }} />
        </View>
      </SafeAreaView>

      <ScrollView className="flex-1 px-5" keyboardShouldPersistTaps="handled">

        {/* Sleep/Wakeup: Show status card */}
        {isSleepOrWakeup ? (
          <View className="mt-4">
            <View
              style={{
                borderRadius: 16,
                paddingVertical: 24,
                paddingHorizontal: 20,
                alignItems: 'center',
                backgroundColor: sleepAction === 'sleeping' ? '#6366F1' : '#F59E0B',
                shadowColor: sleepAction === 'sleeping' ? '#6366F1' : '#F59E0B',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.3,
                shadowRadius: 8,
                elevation: 6,
              }}
            >
              <Text style={{ fontSize: 48, marginBottom: 10 }}>{sleepAction === 'sleeping' ? '🌙' : '☀️'}</Text>
              <Text style={{ fontSize: 18, fontWeight: '700', color: '#FFFFFF' }}>
                {sleepAction === 'sleeping' ? 'Going to Sleep' : 'Just Woke Up'}
              </Text>
              <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', marginTop: 4 }}>
                {sleepAction === 'sleeping' ? 'Sweet dreams 💫' : 'Good morning! ☀️'}
              </Text>
            </View>
          </View>
        ) : null}

        {/* Main content input */}
        <TextInput
          testID="create-content-input"
          value={content}
          onChangeText={setContent}
          placeholder={isSleepOrWakeup ? 'Add a note... (optional)' : "What's on your mind?"}
          placeholderTextColor="#8B8B8B"
          multiline
          className="text-base mt-4"
          style={{
            color: '#0A1F44',
            minHeight: isSleepOrWakeup ? 80 : 120,
            textAlignVertical: 'top',
            backgroundColor: '#fff',
            borderRadius: 16,
            padding: 16,
          }}
        />

        {/* Photo picker for thought type */}
        {momentType === 'thought' ? (
          <View className="mt-4">
            {/* Upload progress bar */}
            {uploadingMedia ? (
              <View style={{ marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Text style={{ fontSize: 12, color: '#8B8B8B' }}>
                    {isVideo ? 'Uploading video...' : 'Uploading photo...'}
                  </Text>
                  <Text style={{ fontSize: 12, color: '#8B8B8B' }}>{Math.round(uploadProgress)}%</Text>
                </View>
                <View style={{ height: 4, backgroundColor: '#E5E7EB', borderRadius: 2, overflow: 'hidden' }}>
                  <Animated.View
                    style={[{
                      height: 4,
                      backgroundColor: '#0A1F44',
                      borderRadius: 2,
                    }, progressStyle]}
                  />
                </View>
              </View>
            ) : null}

            <Pressable
              testID="create-image-picker"
              onPress={handlePickImage}
              disabled={uploadingMedia}
              className="flex-row items-center justify-center rounded-xl py-3"
              style={{ backgroundColor: '#fff', borderWidth: 1, borderColor: '#E5E7EB', borderStyle: 'dashed', opacity: uploadingMedia ? 0.6 : 1 }}
            >
              {uploadingMedia ? (
                <>
                  <ActivityIndicator size="small" color="#8B8B8B" />
                  <Text className="text-sm ml-2" style={{ color: '#8B8B8B' }}>Uploading...</Text>
                </>
              ) : (
                <>
                  <Camera size={20} color="#8B8B8B" />
                  <Text className="text-sm ml-2" style={{ color: '#8B8B8B' }}>Add a photo</Text>
                </>
              )}
            </Pressable>
            {mediaError ? (
              <Text style={{ color: '#EF4444', fontSize: 12, marginTop: 6, marginLeft: 2 }}>{mediaError}</Text>
            ) : null}
            {selectedImage ? (
              <View style={{ marginTop: 10, borderRadius: 14, overflow: 'hidden', position: 'relative' }}>
                <Image
                  source={{ uri: selectedImage }}
                  style={{ width: '100%', height: 220, borderRadius: 14 }}
                  contentFit="cover"
                />
                {isVideo ? (
                  <View style={{
                    position: 'absolute', top: 8, left: 8,
                    backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 6,
                    paddingHorizontal: 8, paddingVertical: 4,
                  }}>
                    <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>VIDEO</Text>
                  </View>
                ) : null}
                <Pressable
                  testID="remove-image-button"
                  onPress={() => { setSelectedImage(null); setIsVideo(false); setMediaError(null); setUploadProgress(0); }}
                  style={{
                    position: 'absolute', top: 8, right: 8,
                    width: 28, height: 28, borderRadius: 14,
                    backgroundColor: 'rgba(0,0,0,0.6)',
                    alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <X size={14} color="#FFFFFF" />
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Location: nearby places + venue name */}
        {momentType === 'location' ? (
          <View className="mt-4">
            <Text className="text-xs font-semibold uppercase mb-2" style={{ color: '#8B8B8B' }}>Location</Text>

            {/* Loading state */}
            {(isGettingLocation || loadingPlaces) ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 16, gap: 10, justifyContent: 'center' }}>
                <ActivityIndicator size="small" color="#0A1F44" />
                <Text style={{ fontSize: 14, color: '#8B8B8B' }}>
                  {isGettingLocation ? 'Getting your location...' : 'Finding nearby places...'}
                </Text>
              </View>
            ) : null}

            {locationPermissionError ? (
              <Text style={{ color: '#EF4444', fontSize: 12, marginBottom: locationDebugError ? 2 : 8 }}>{locationPermissionError}</Text>
            ) : null}
            {locationDebugError ? (
              <Text style={{ color: '#9CA3AF', fontSize: 11, marginBottom: 8 }}>{locationDebugError}</Text>
            ) : null}

            {/* Retry button - only shown after loading completes */}
            {!isGettingLocation && !loadingPlaces ? (
              <Pressable
                testID="gps-location-button"
                onPress={handleGetGPSLocation}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: locationLat !== null ? '#E8F5E9' : '#0A1F44',
                  borderRadius: 12,
                  paddingVertical: 10,
                  paddingHorizontal: 16,
                  marginBottom: 10,
                  gap: 8,
                  borderWidth: 1,
                  borderColor: locationLat !== null ? '#22C55E' : '#1E3A5F',
                }}
              >
                <MapPin size={16} color={locationLat !== null ? '#22C55E' : '#FFFFFF'} />
                <Text style={{ color: locationLat !== null ? '#22C55E' : '#FFFFFF', fontWeight: '600', fontSize: 14 }}>
                  {locationLat !== null ? '↻ Refresh Location' : 'Use My GPS Location'}
                </Text>
              </Pressable>
            ) : null}

            {/* Google Places Nearby Results */}
            {nearbyPlaces.length > 0 ? (
              <View style={{ marginBottom: 12 }}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: '#8B8B8B', textTransform: 'uppercase', marginBottom: 8 }}>
                  Nearby Places
                </Text>
                <ScrollView
                  horizontal={false}
                  style={{ maxHeight: 260 }}
                  nestedScrollEnabled
                  showsVerticalScrollIndicator={false}
                >
                  {nearbyPlaces.map((place, index) => {
                    const isSelected = selectedPlace?.name === place.name;
                    return (
                      <Pressable
                        key={index}
                        testID={`nearby-place-${index}`}
                        onPress={() => handleSelectPlace(place)}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          paddingHorizontal: 12,
                          paddingVertical: 10,
                          marginBottom: 6,
                          borderRadius: 12,
                          backgroundColor: isSelected ? '#E8F5E9' : '#FFFFFF',
                          borderWidth: 1.5,
                          borderColor: isSelected ? '#22C55E' : '#E5E7EB',
                        }}
                      >
                        <Text style={{ fontSize: 20, marginRight: 10 }}>{getPlaceEmoji(place.types)}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 14, fontWeight: '600', color: '#0A1F44' }} numberOfLines={1}>
                            {place.name}
                          </Text>
                          {place.address ? (
                            <Text style={{ fontSize: 12, color: '#8B8B8B', marginTop: 1 }} numberOfLines={1}>
                              {place.address}
                            </Text>
                          ) : null}
                        </View>
                        {place.rating ? (
                          <Text style={{ fontSize: 12, color: '#F59E0B', fontWeight: '600', marginLeft: 8 }}>
                            ⭐ {place.rating.toFixed(1)}
                          </Text>
                        ) : null}
                        {isSelected ? (
                          <Text style={{ fontSize: 16, marginLeft: 8 }}>✓</Text>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            ) : locationLat !== null && !loadingPlaces && !isGettingLocation ? (
              <View style={{ alignItems: 'center', paddingVertical: 16, marginBottom: 8 }}>
                <Text style={{ fontSize: 14, color: '#8B8B8B', fontWeight: '600' }}>No places found nearby</Text>
                <Text style={{ fontSize: 12, color: '#B0B0B0', marginTop: 4 }}>Type your location below</Text>
              </View>
            ) : null}

            {/* Manual venue name input */}
            <TextInput
              testID="create-location-input"
              value={locationName}
              onChangeText={(v) => { setLocationName(v); if (selectedPlace && v !== selectedPlace.name) setSelectedPlace(null); }}
              placeholder="Or type venue name manually"
              placeholderTextColor="#8B8B8B"
              className="rounded-xl px-4 py-3 text-sm"
              style={{ backgroundColor: '#fff', color: '#0A1F44' }}
            />
          </View>
        ) : null}

        <View style={{ height: 40 }} />
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={{ backgroundColor: '#F8F6F2' }}>
        <View className="px-5 pb-2">
          <Pressable
            testID="create-submit"
            onPress={handleSubmit}
            disabled={!isSubmitEnabled()}
            className="items-center justify-center rounded-xl py-4"
            style={{ backgroundColor: isSubmitEnabled() ? '#0A1F44' : '#E5E7EB' }}
          >
            {isPosting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text className="text-base font-semibold" style={{ color: isSubmitEnabled() ? '#FFFFFF' : '#8B8B8B' }}>
                Share Moment
              </Text>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}
