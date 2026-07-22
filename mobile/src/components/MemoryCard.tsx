import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { BlurView } from 'expo-blur';
import { Calendar } from 'lucide-react-native';
import { Memory } from '@/lib/types';

interface MemoryCardProps {
  memory: Memory;
}

export default function MemoryCard({ memory }: MemoryCardProps) {
  const hasImage = !!memory.post.image;

  return (
    <View
      testID={`memory-card-${memory.id}`}
      style={{
        borderRadius: 16,
        overflow: 'hidden',
        marginHorizontal: 16,
        marginBottom: 16,
        height: 220,
      }}
    >
      {/* Background image or gradient */}
      {hasImage ? (
        <Image
          source={{ uri: memory.post.image }}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
          }}
          contentFit="cover"
          blurRadius={8}
        />
      ) : (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: '#0A1F44',
          }}
        />
      )}

      {/* Dark overlay */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: hasImage ? 'rgba(6, 15, 34, 0.55)' : 'transparent',
        }}
      />

      {/* Content */}
      <View style={{ flex: 1, padding: 20, justifyContent: 'space-between' }}>
        {/* Header */}
        <View>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
            <Calendar size={16} color="#FFFFFF" />
            <Text
              style={{
                fontSize: 13,
                fontWeight: '700',
                color: '#FFFFFF',
                marginLeft: 6,
                letterSpacing: 0.5,
                textTransform: 'uppercase',
              }}
            >
              On This Day
            </Text>
          </View>
          <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>
            {memory.yearsAgo} {memory.yearsAgo === 1 ? 'year' : 'years'} ago
          </Text>
        </View>

        {/* Post content */}
        <Text
          numberOfLines={3}
          style={{
            fontSize: 16,
            fontWeight: '500',
            color: '#FFFFFF',
            lineHeight: 22,
          }}
        >
          {memory.post.content}
        </Text>

        {/* Share button */}
        <View style={{ flexDirection: 'row' }}>
          <Pressable
            testID={`memory-share-${memory.id}`}
            style={{
              backgroundColor: '#FFFFFF',
              borderRadius: 20,
              paddingHorizontal: 20,
              paddingVertical: 10,
            }}
          >
            <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 13 }}>
              Share to Path+
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
