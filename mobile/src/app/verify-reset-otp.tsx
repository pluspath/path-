import React, { useState } from 'react';
import {
  View, Text, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { OtpInput } from 'react-native-otp-entry';
import * as Haptics from 'expo-haptics';
import { supabase } from '../lib/supabase';

export default function VerifyResetOTPScreen() {
  const { email } = useLocalSearchParams<{ email: string }>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);

  const handleVerify = async (otp: string) => {
    if (otp.length < 6) return;
    setLoading(true);
    setError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: email ?? '',
      token: otp,
      type: 'recovery',
    });

    setLoading(false);
    if (verifyError) {
      const msg = verifyError.message ?? '';
      if (msg.toLowerCase().includes('expired')) {
        setError('Code has expired. Please request a new one.');
      } else {
        setError('Invalid code. Please try again.');
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.push({ pathname: '/reset-password' as any, params: { email: email ?? '' } });
    }
  };

  const handleResend = async () => {
    setResending(true);
    setError(null);
    try {
      await supabase.auth.resetPasswordForEmail(email ?? '');
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
            onFilled={handleVerify}
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
