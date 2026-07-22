import React from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  TextInput,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Image } from 'expo-image';
import { Camera, Trash2 } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { api } from '@/lib/api';
import { Post } from '@/lib/types';
import * as Haptics from 'expo-haptics';

interface EditMomentModalProps {
  post: Post | null;
  onClose: () => void;
}

export function EditMomentModal({ post, onClose }: EditMomentModalProps) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [editContent, setEditContent] = React.useState<string>('');
  // undefined = unchanged, null = remove, string = new URL
  const [editImage, setEditImage] = React.useState<string | null | undefined>(undefined);
  const [isUploadingImage, setIsUploadingImage] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (post) {
      setEditContent(post.content ?? '');
      setEditImage(undefined);
      setError(null);
    }
  }, [post?.id]);

  const displayImage = editImage === undefined ? post?.image : editImage;

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!post) throw new Error('No post');
      const body: Record<string, string | null | undefined> = {};
      body.content = editContent.trim() || undefined;
      if (editImage !== undefined) body.image = editImage;
      return api.patch<Post>(`/api/posts/${post.id}`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['posts'] });
      queryClient.invalidateQueries({ queryKey: ['friend-posts'] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
    },
    onError: (err: any) => {
      setError(err?.message ?? 'Failed to save changes');
    },
  });

  const handlePickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
    });

    if (result.canceled || !result.assets?.[0]) return;

    const uri = result.assets[0].uri;
    setIsUploadingImage(true);
    setError(null);
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const token = authSession?.access_token;
      const fileResp = await fetch(uri);
      const blob = await fileResp.blob();
      const formData = new FormData();
      formData.append('file', blob as any, 'photo.jpg');

      const baseUrl = process.env.EXPO_PUBLIC_BACKEND_URL!;
      const response = await fetch(`${baseUrl}/api/upload/image`, {
        method: 'POST',
        body: formData,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson?.error?.message ?? 'Upload failed');
      }
      const json = await response.json();
      setEditImage(json.data?.url ?? json.url);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to upload image');
    } finally {
      setIsUploadingImage(false);
    }
  };

  if (!post) return null;

  const isSaving = saveMutation.isPending || isUploadingImage;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}
        onPress={onClose}
      >
        <Pressable onPress={() => {}}>
          <View
            style={{
              backgroundColor: '#F8F6F2',
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              paddingBottom: insets.bottom + 20,
            }}
          >
            {/* Handle */}
            <View style={{ alignItems: 'center', paddingTop: 12, paddingBottom: 4 }}>
              <View style={{ width: 40, height: 4, backgroundColor: '#D1D5DB', borderRadius: 2 }} />
            </View>

            {/* Header */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingHorizontal: 20,
                paddingVertical: 12,
              }}
            >
              <Pressable testID="edit-moment-cancel" onPress={onClose}>
                <Text style={{ fontSize: 16, color: '#6B7280' }}>Cancel</Text>
              </Pressable>
              <Text style={{ fontSize: 17, fontWeight: '700', color: '#0A1F44' }}>Edit Moment</Text>
              <Pressable
                testID="edit-moment-save"
                onPress={() => saveMutation.mutate()}
                disabled={isSaving}
              >
                {saveMutation.isPending ? (
                  <ActivityIndicator size="small" color="#0A1F44" />
                ) : (
                  <Text style={{ fontSize: 16, fontWeight: '700', color: isSaving ? '#9CA3AF' : '#0A1F44' }}>
                    Save
                  </Text>
                )}
              </Pressable>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 8 }}
              style={{ maxHeight: 500 }}
            >
              {/* Caption */}
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: '600',
                  color: '#8B8B8B',
                  textTransform: 'uppercase',
                  marginBottom: 8,
                  marginLeft: 4,
                }}
              >
                Caption
              </Text>
              <TextInput
                testID="edit-moment-content"
                value={editContent}
                onChangeText={setEditContent}
                multiline
                style={{
                  backgroundColor: '#FFFFFF',
                  borderRadius: 16,
                  padding: 16,
                  fontSize: 15,
                  color: '#0A1F44',
                  minHeight: 100,
                  textAlignVertical: 'top',
                  marginBottom: 16,
                }}
                placeholder="What's on your mind?"
                placeholderTextColor="#9CA3AF"
              />

              {/* Photo */}
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: '600',
                  color: '#8B8B8B',
                  textTransform: 'uppercase',
                  marginBottom: 8,
                  marginLeft: 4,
                }}
              >
                Photo
              </Text>

              {displayImage ? (
                <View style={{ position: 'relative', marginBottom: 12 }}>
                  <Image
                    source={{ uri: displayImage }}
                    style={{ width: '100%', height: 200, borderRadius: 16 }}
                    contentFit="cover"
                  />
                  <View
                    style={{
                      position: 'absolute',
                      top: 10,
                      right: 10,
                      flexDirection: 'row',
                      gap: 8,
                    }}
                  >
                    <Pressable
                      onPress={handlePickImage}
                      disabled={isUploadingImage}
                      style={{
                        backgroundColor: 'rgba(0,0,0,0.6)',
                        borderRadius: 20,
                        padding: 8,
                      }}
                    >
                      {isUploadingImage ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <Camera size={18} color="#FFFFFF" />
                      )}
                    </Pressable>
                    <Pressable
                      onPress={() => setEditImage(null)}
                      style={{
                        backgroundColor: 'rgba(239,68,68,0.9)',
                        borderRadius: 20,
                        padding: 8,
                      }}
                    >
                      <Trash2 size={18} color="#FFFFFF" />
                    </Pressable>
                  </View>
                </View>
              ) : (
                <Pressable
                  onPress={handlePickImage}
                  disabled={isUploadingImage}
                  style={{
                    backgroundColor: '#FFFFFF',
                    borderRadius: 16,
                    height: 100,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 2,
                    borderColor: '#E5E7EB',
                    borderStyle: 'dashed',
                    marginBottom: 12,
                    gap: 8,
                  }}
                >
                  {isUploadingImage ? (
                    <ActivityIndicator size="small" color="#0A1F44" />
                  ) : (
                    <>
                      <Camera size={24} color="#9CA3AF" />
                      <Text style={{ fontSize: 14, color: '#9CA3AF' }}>Add a photo</Text>
                    </>
                  )}
                </Pressable>
              )}

              {error ? (
                <Text style={{ fontSize: 13, color: '#EF4444', textAlign: 'center', marginBottom: 8 }}>
                  {error}
                </Text>
              ) : null}
            </ScrollView>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
