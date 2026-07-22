import React, { useState } from 'react';
import {
  View, Text, TextInput, Pressable, KeyboardAvoidingView,
  Platform, ActivityIndicator,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { supabase } from '@/lib/supabase';
import { useInvalidateSession } from '@/lib/auth/use-session';

export default function SignInScreen() {
  const { message } = useLocalSearchParams<{ message?: string }>();
  const [tab, setTab] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invalidateSession = useInvalidateSession();

  const handleSignIn = async () => {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setError('Enter a valid email address');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    setLoading(true);
    setError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const { error: authError } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password,
    });

    setLoading(false);
    if (authError) {
      setError(authError.message ?? 'Sign in failed. Check your credentials.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await invalidateSession();
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#0A1F44' }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 32 }}>
        {/* Logo */}
        <View style={{ alignItems: 'center', marginBottom: 40 }}>
          <Text style={{ fontSize: 52, fontWeight: '700', color: '#FFFFFF', letterSpacing: -1 }}>
            Path<Text style={{ color: '#D4BC72', fontSize: 58, fontWeight: '300' }}>+</Text>
          </Text>
          <Text style={{ fontSize: 16, color: '#94A3B8', marginTop: 8, textAlign: 'center' }}>
            Share life's moments with the people who matter
          </Text>
        </View>

        {/* Success banner */}
        {message ? (
          <View style={{
            backgroundColor: 'rgba(34,197,94,0.15)',
            borderColor: '#22C55E',
            borderWidth: 1,
            borderRadius: 12,
            padding: 12,
            marginBottom: 16,
          }}>
            <Text style={{ color: '#22C55E', fontSize: 14, textAlign: 'center' }}>{message}</Text>
          </View>
        ) : null}

        {/* Tabs */}
        <View style={{ flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 12, padding: 4, marginBottom: 28 }}>
          {(['signin', 'signup'] as const).map((t) => (
            <Pressable
              key={t}
              onPress={() => { setTab(t); setError(null); }}
              style={{
                flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center',
                backgroundColor: tab === t ? '#FFFFFF' : 'transparent',
              }}
            >
              <Text style={{ fontWeight: '700', fontSize: 15, color: tab === t ? '#0A1F44' : '#94A3B8' }}>
                {t === 'signin' ? 'Sign In' : 'Sign Up'}
              </Text>
            </Pressable>
          ))}
        </View>

        {tab === 'signin' ? (
          <>
            <Text style={{ fontSize: 13, fontWeight: '600', color: '#94A3B8', marginBottom: 8 }}>EMAIL</Text>
            <TextInput
              testID="sign-in-email-input"
              value={email}
              onChangeText={(t) => { setEmail(t); setError(null); }}
              placeholder="you@example.com"
              placeholderTextColor="rgba(148,163,184,0.5)"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              style={inputStyle(!!error)}
            />
            <Text style={{ fontSize: 13, fontWeight: '600', color: '#94A3B8', marginBottom: 8, marginTop: 12 }}>PASSWORD</Text>
            <TextInput
              testID="sign-in-password-input"
              value={password}
              onChangeText={(t) => { setPassword(t); setError(null); }}
              placeholder="••••••••"
              placeholderTextColor="rgba(148,163,184,0.5)"
              secureTextEntry
              style={inputStyle(!!error)}
            />
            <Pressable
              testID="forgot-password-link"
              onPress={() => router.push('/forgot-password' as any)}
              style={{ alignSelf: 'flex-end', marginTop: 8, marginBottom: 4 }}
            >
              <Text style={{ color: '#94A3B8', fontSize: 14 }}>Forgot Password?</Text>
            </Pressable>

            {error ? <Text style={{ color: '#EF4444', fontSize: 13, marginTop: 6, marginBottom: 2 }}>{error}</Text> : null}
            <Pressable
              testID="sign-in-button"
              onPress={handleSignIn}
              disabled={loading}
              style={{ backgroundColor: '#FFFFFF', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 20, opacity: loading ? 0.7 : 1 }}
            >
              {loading ? <ActivityIndicator color="#0A1F44" /> : <Text style={{ fontSize: 16, fontWeight: '700', color: '#0A1F44' }}>Sign In →</Text>}
            </Pressable>
          </>
        ) : (
          <Pressable
            onPress={() => router.push('/sign-up')}
            style={{ backgroundColor: '#FFFFFF', borderRadius: 14, paddingVertical: 16, alignItems: 'center' }}
          >
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#0A1F44' }}>Create Account →</Text>
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

function inputStyle(hasError: boolean) {
  return {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 16,
    fontSize: 16,
    color: '#FFFFFF',
    borderWidth: 1,
    borderColor: hasError ? '#EF4444' : 'rgba(255,255,255,0.12)',
  } as const;
}
