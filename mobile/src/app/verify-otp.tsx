import React, { useState } from 'react';
import {
  View, Text, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { OtpInput } from 'react-native-otp-entry';
import * as Haptics from 'expo-haptics';
import { supabase } from '@/lib/supabase';
import { useInvalidateSession } from '@/lib/auth/use-session';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL!;

export default function VerifyOTPScreen() {
  const { email, password, mode, fullName, username } = useLocalSearchParams<{
    email: string;
    password?: string;
    mode?: string;
    fullName?: string;
    username?: string;
  }>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const invalidateSession = useInvalidateSession();

  const handleVerifyOTP = async (otp: string) => {
    if (otp.length < 6) return;
    setLoading(true);
    setError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    // Verify OTP via backend
    let verifyJson: any;
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email?.trim() ?? '', otp }),
      });
      verifyJson = await res.json();
      if (!res.ok || verifyJson.error) {
        setLoading(false);
        setError(verifyJson.error?.message ?? 'Invalid code. Please try again.');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }
    } catch {
      setLoading(false);
      setError('Network error. Please try again.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    // OTP verified — use session returned by backend
    const sessionData = verifyJson.data?.session as { access_token: string; refresh_token: string } | undefined;
    if (!sessionData?.access_token) {
      setLoading(false);
      setError('Sign in failed. Please try again.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    const { error: setSessionError } = await supabase.auth.setSession({
      access_token: sessionData.access_token,
      refresh_token: sessionData.refresh_token,
    });

    if (setSessionError) {
      setLoading(false);
      setError(setSessionError.message ?? 'Sign in failed. Please try again.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    // For signup mode: create profile record
    if (mode === 'signup') {
      try {
        const res = await fetch(`${BACKEND_URL}/api/setup-profile`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${sessionData.access_token}`,
          },
          body: JSON.stringify({
            username: username ?? '',
            name: fullName ?? '',
            email: email?.trim() ?? '',
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          console.error('[VerifyOTP] setup-profile failed:', res.status, JSON.stringify(body));
        }
      } catch (e) {
        console.warn('[VerifyOTP] Profile setup failed:', e);
      }
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await invalidateSession();
  };

  const handleResend = async () => {
    setResending(true);
    setError(null);
    try {
      await fetch(`${BACKEND_URL}/api/auth/resend-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email?.trim() ?? '' }),
      });
    } catch {
      // ignore
    }
    setResending(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#0A1F44' }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 32 }}>
        <Pressable
          testID="back-button"
          onPress={() => router.back()}
          style={{ position: 'absolute', top: 60, left: 32 }}
        >
          <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '600' }}>← Back</Text>
        </Pressable>

        <View style={{ alignItems: 'center', marginBottom: 40 }}>
          <Text style={{ fontSize: 28, fontWeight: '700', color: '#FFFFFF', marginBottom: 8 }}>
            Check your email
          </Text>
          <Text style={{ fontSize: 15, color: '#94A3B8', textAlign: 'center', lineHeight: 22 }}>
            We sent a 6-digit code to{'\n'}
            <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>{email}</Text>
          </Text>
        </View>

        <View testID="otp-input">
          <OtpInput
            numberOfDigits={6}
            onFilled={handleVerifyOTP}
            type="numeric"
            focusColor="#FFFFFF"
            theme={{
              containerStyle: { marginBottom: 24 },
              pinCodeContainerStyle: {
                backgroundColor: 'rgba(255,255,255,0.08)',
                borderRadius: 14,
                borderWidth: 1.5,
                borderColor: 'rgba(255,255,255,0.15)',
                width: 48,
                height: 56,
              },
              pinCodeTextStyle: { color: '#FFFFFF', fontSize: 22, fontWeight: '700' },
              focusedPinCodeContainerStyle: { borderColor: '#FFFFFF' },
            }}
          />
        </View>

        {error ? (
          <Text style={{ color: '#EF4444', fontSize: 14, textAlign: 'center', marginBottom: 16 }}>{error}</Text>
        ) : null}

        {loading ? (
          <View style={{ alignItems: 'center', marginBottom: 16 }}>
            <ActivityIndicator color="#FFFFFF" />
            <Text style={{ color: '#94A3B8', fontSize: 13, marginTop: 8 }}>Verifying...</Text>
          </View>
        ) : null}

        <Pressable
          testID="resend-button"
          onPress={handleResend}
          disabled={resending}
          style={{ alignItems: 'center' }}
        >
          <Text style={{ color: resending ? '#64748B' : '#FFFFFF', fontSize: 14, fontWeight: '600' }}>
            {resending ? 'Sending...' : 'Resend code'}
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
