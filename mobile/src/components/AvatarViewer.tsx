import React from 'react';
import { Modal, View, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface AvatarViewerProps {
  uri: string | null;
  onClose: () => void;
}

export function AvatarViewer({ uri, onClose }: AvatarViewerProps) {
  const insets = useSafeAreaInsets();
  if (!uri) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center' }}
        onPress={onClose}
      >
        <Pressable
          style={{ position: 'absolute', top: insets.top + 16, right: 16, padding: 10, backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 22 }}
          onPress={onClose}
        >
          <X size={22} color="#FFFFFF" />
        </Pressable>
        <Pressable onPress={() => {}}>
          <Image
            source={{ uri }}
            style={{ width: 300, height: 300, borderRadius: 150 }}
            contentFit="cover"
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}
