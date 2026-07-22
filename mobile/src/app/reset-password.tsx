import React, { useState } from 'react';
import {
  View, Text, TextInput, Pressable, KeyboardAvoidingView,
  Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { supabase } from '../lib/supabase';

export default function ResetPasswordScreen() {
  const { email } = useLocalSearchParams<{ email: string }>();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUpdatePassword = async () => {
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    setLoading(true);
    setError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });

    if (updateError) {
      setLoading(false);
      setError(updateError.message ?? 'Failed to update password. Please try again.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    await supabase.auth.signOut();
    setLoading(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.replace({ pathname: '/sign-in', params: { message: 'Password updated successfully' } } as any);
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
              Set New Password
            </Text>
            <Text style={{ fontSize: 14, color: '#94A3B8', marginBottom: 32, lineHeight: 20 }}>
              Choose a strong password for your account.
            </Text>

            <Text style={{ fontSize: 13, fontWeight: '600', color: '#94A3B8', marginBottom: 8 }}>NEW PASSWORD</Text>
            <TextInput
              testID="new-password-input"
              value={newPassword}
              onChangeText={(t) => { setNewPassword(t); setError(null); }}
              placeholder="••••••••"
              placeholderTextColor="rgba(148,163,184,0.5)"
              secureTextEntry
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

            <Text style={{ fontSize: 13, fontWeight: '600', color: '#94A3B8', marginBottom: 8, marginTop: 16 }}>CONFIRM PASSWORD</Text>
            <TextInput
              testID="confirm-password-input"
              value={confirmPassword}
              onChangeText={(t) => { setConfirmPassword(t); setError(null); }}
              placeholder="••••••••"
              placeholderTextColor="rgba(148,163,184,0.5)"
              secureTextEntry
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
              testID="update-password-button"
              onPress={handleUpdatePassword}
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
                : <Text style={{ fontSize: 16, fontWeight: '700', color: '#0A1F44' }}>Update Password →</Text>}
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}
