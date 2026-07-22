import React, { useState, useCallback } from 'react';
import {
  View, Text, TextInput, Pressable, KeyboardAvoidingView,
  Platform, ActivityIndicator, ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL!;

export default function SignUpScreen() {
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle');
  const [usernameTimer, setUsernameTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const checkUsername = useCallback((value: string) => {
    if (usernameTimer) clearTimeout(usernameTimer);
    const trimmed = value.toLowerCase().trim();
    if (!trimmed || trimmed.length < 3) {
      setUsernameStatus(trimmed.length > 0 ? 'invalid' : 'idle');
      return;
    }
    if (!/^[a-z0-9_]+$/.test(trimmed)) {
      setUsernameStatus('invalid');
      return;
    }
    setUsernameStatus('checking');
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/username-check/${trimmed}`);
        const json = await res.json();
        setUsernameStatus(json.data?.available ? 'available' : 'taken');
      } catch {
        setUsernameStatus('idle');
      }
    }, 500);
    setUsernameTimer(timer);
  }, [usernameTimer]);

  const handleSignUp = async () => {
    setError(null);
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedUsername = username.toLowerCase().trim();
    const trimmedName = fullName.trim();

    if (!trimmedName) { setError('Enter your full name'); return; }
    if (trimmedUsername.length < 3) { setError('Username must be at least 3 characters'); return; }
    if (usernameStatus === 'taken') { setError('That username is already taken'); return; }
    if (usernameStatus === 'invalid') { setError('Username: letters, numbers, underscores only'); return; }
    if (!trimmedEmail.includes('@')) { setError('Enter a valid email address'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters'); return; }

    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: trimmedEmail,
          password,
          username: trimmedUsername,
          fullName: trimmedName,
        }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        setError(json.error?.message ?? 'Sign up failed. Try again.');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setLoading(false);
        return;
      }
    } catch {
      setError('Network error. Please try again.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setLoading(false);
      return;
    }

    setLoading(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.push({
      pathname: '/verify-otp',
      params: {
        email: trimmedEmail,
        password,
        mode: 'signup',
        fullName: trimmedName,
        username: trimmedUsername,
      },
    });
  };

  const usernameColor = () => {
    if (usernameStatus === 'available') return '#22C55E';
    if (usernameStatus === 'taken' || usernameStatus === 'invalid') return '#EF4444';
    return 'rgba(255,255,255,0.12)';
  };

  const usernameHint = () => {
    if (usernameStatus === 'checking') return '⏳ Checking...';
    if (usernameStatus === 'available') return '✓ Available';
    if (usernameStatus === 'taken') return '✗ Already taken';
    if (usernameStatus === 'invalid') return '✗ Letters, numbers, underscores only';
    return null;
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#0A1F44' }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 32, paddingVertical: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Back */}
        <Pressable testID="back-button" onPress={() => router.back()} style={{ marginBottom: 24 }}>
          <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '600' }}>← Back</Text>
        </Pressable>

        <Text style={{ fontSize: 28, fontWeight: '700', color: '#FFFFFF', marginBottom: 6 }}>Create account</Text>
        <Text style={{ fontSize: 15, color: '#94A3B8', marginBottom: 32 }}>Join Path+ and share life's moments</Text>

        {/* Full Name */}
        <Text style={labelStyle}>FULL NAME</Text>
        <TextInput
          testID="full-name-input"
          value={fullName}
          onChangeText={(t) => { setFullName(t); setError(null); }}
          placeholder="Your full name"
          placeholderTextColor="rgba(148,163,184,0.5)"
          autoCapitalize="words"
          style={[inputStyle, { marginBottom: 16 }]}
        />

        {/* Username */}
        <Text style={labelStyle}>USERNAME</Text>
        <TextInput
          testID="username-input"
          value={username}
          onChangeText={(t) => {
            const clean = t.toLowerCase().replace(/[^a-z0-9_]/g, '');
            setUsername(clean);
            setError(null);
            checkUsername(clean);
          }}
          placeholder="your_username"
          placeholderTextColor="rgba(148,163,184,0.5)"
          autoCapitalize="none"
          autoCorrect={false}
          style={[inputStyle, { borderColor: usernameColor(), marginBottom: 4 }]}
        />
        {usernameHint() ? (
          <Text style={{
            fontSize: 12, marginBottom: 12,
            color: usernameStatus === 'available' ? '#22C55E' : usernameStatus === 'checking' ? '#94A3B8' : '#EF4444',
          }}>
            {usernameHint()}
          </Text>
        ) : <View style={{ height: 16 }} />}

        {/* Email */}
        <Text style={labelStyle}>EMAIL</Text>
        <TextInput
          testID="email-input"
          value={email}
          onChangeText={(t) => { setEmail(t); setError(null); }}
          placeholder="you@example.com"
          placeholderTextColor="rgba(148,163,184,0.5)"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          style={[inputStyle, { marginBottom: 16 }]}
        />

        {/* Password */}
        <Text style={labelStyle}>PASSWORD</Text>
        <TextInput
          testID="password-input"
          value={password}
          onChangeText={(t) => { setPassword(t); setError(null); }}
          placeholder="Min. 6 characters"
          placeholderTextColor="rgba(148,163,184,0.5)"
          secureTextEntry
          style={[inputStyle, { marginBottom: 8 }]}
        />

        {error ? <Text style={{ color: '#EF4444', fontSize: 13, marginBottom: 12 }}>{error}</Text> : null}

        <Pressable
          testID="sign-up-button"
          onPress={handleSignUp}
          disabled={loading || usernameStatus === 'taken' || usernameStatus === 'invalid'}
          style={{
            backgroundColor: '#FFFFFF', borderRadius: 14, paddingVertical: 16,
            alignItems: 'center', marginTop: 8,
            opacity: (loading || usernameStatus === 'taken' || usernameStatus === 'invalid') ? 0.7 : 1,
          }}
        >
          {loading ? <ActivityIndicator color="#0A1F44" /> : <Text style={{ fontSize: 16, fontWeight: '700', color: '#0A1F44' }}>Create Account →</Text>}
        </Pressable>

        <Text style={{ color: '#64748B', fontSize: 13, textAlign: 'center', marginTop: 20 }}>
          We'll email a 6-digit code to verify your account
        </Text>

        <Text style={{ color: '#64748B', fontSize: 12, textAlign: 'center', marginTop: 12 }}>
          By creating an account, you agree to our{' '}
          <Text
            testID="terms-link"
            style={{ color: '#FFFFFF', textDecorationLine: 'underline' }}
            onPress={() => router.push('/terms' as any)}
          >
            Terms &amp; Conditions
          </Text>
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const labelStyle = { fontSize: 13, fontWeight: '600' as const, color: '#94A3B8', marginBottom: 8 };
const inputStyle = {
  backgroundColor: 'rgba(255,255,255,0.08)',
  borderRadius: 14,
  paddingHorizontal: 18,
  paddingVertical: 16,
  fontSize: 16,
  color: '#FFFFFF',
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.12)',
} as const;
