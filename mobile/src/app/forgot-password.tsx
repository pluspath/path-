import React, { useState } from 'react';
import {
  View, Text, TextInput, Pressable, KeyboardAvoidingView,
  Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { supabase } from '../lib/supabase';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSendCode = async () => {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setError('Enter a valid email address');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    setLoading(true);
    setError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(trimmedEmail);

    setLoading(false);
    if (resetError) {
      setError(resetError.message ?? 'Failed to send reset code. Please try again.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.push({ pathname: '/verify-reset-otp' as any, params: { email: trimmedEmail } });
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#0A1F44' }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flex: 1, paddingHorizontal: 32 }}>
          <Pressable
            testID="back-button"
            onPress={() => router.back()}
            style={{ paddingTop: 16, paddingBottom: 8, alignSelf: 'flex-start' }}
          >
            <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '600' }}>← Back</Text>
          </Pressable>

          <View style={{ flex: 1, justifyContent: 'center' }}>
            <Text style={{ fontSize: 28, fontWeight: '700', color: '#FFFFFF', marginBottom: 10 }}>
              Forgot Password
            </Text>
            <Text style={{ fontSize: 14, color: '#94A3B8', marginBottom: 32, lineHeight: 20 }}>
              Enter your email and we'll send you a reset code.
            </Text>

            <Text style={{ fontSize: 13, fontWeight: '600', color: '#94A3B8', marginBottom: 8 }}>EMAIL</Text>
            <TextInput
              testID="forgot-password-email-input"
              value={email}
              onChangeText={(t) => { setEmail(t); setError(null); }}
              placeholder="you@example.com"
              placeholderTextColor="rgba(148,163,184,0.5)"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              style={{
                backgroundColor: 'rgba(255,255,255,0.08)',
                borderRadius: 14,
                paddingHorizontal: 18,
                paddingVertical: 16,
                fontSize: 16,
                color: '#FFFFFF',
                borderWidth: 1,
                borderColor: error ? '#EF4444' : 'rgba(255,255,255,0.12)',
              }}
            />

            {error ? (
              <Text style={{ color: '#EF4444', fontSize: 13, marginTop: 6 }}>{error}</Text>
            ) : null}

            <Pressable
              testID="send-reset-code-button"
              onPress={handleSendCode}
              disabled={loading}
              style={{
                backgroundColor: '#FFFFFF',
                borderRadius: 14,
                paddingVertical: 16,
                alignItems: 'center',
                marginTop: 24,
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading
                ? <ActivityIndicator color="#0A1F44" />
                : <Text style={{ fontSize: 16, fontWeight: '700', color: '#0A1F44' }}>Send Reset Code →</Text>}
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}
