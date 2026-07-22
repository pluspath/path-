import React from 'react';
import { View, Text } from 'react-native';
import { DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, router, useRootNavigationState } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { useSession } from '@/lib/auth/use-session';
import AsyncStorage from '@react-native-async-storage/async-storage';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

const PathTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: '#F8F6F2',
    card: '#0A1F44',
    text: '#0A1F44',
    primary: '#FFFFFF',
  },
};

function RootLayoutNav() {
  const { data: session, isLoading } = useSession();
  const [termsChecked, setTermsChecked] = React.useState(false);
  const [shouldGoToTerms, setShouldGoToTerms] = React.useState(false);
  const navigationState = useRootNavigationState();

  // Step 1: once session is loaded, check terms acceptance
  React.useEffect(() => {
    if (isLoading) return;
    SplashScreen.hideAsync();
    AsyncStorage.getItem('terms_accepted')
      .then((accepted) => {
        if (!accepted) setShouldGoToTerms(true);
      })
      .catch(() => {})
      .finally(() => setTermsChecked(true));
  }, [isLoading]);

  // Step 2: navigate to terms only after the Stack is mounted (navigationState.key is set)
  React.useEffect(() => {
    if (shouldGoToTerms && navigationState?.key) {
      router.replace('/terms' as any);
    }
  }, [shouldGoToTerms, navigationState?.key]);

  // Safety net: hide splash after 5 seconds no matter what
  React.useEffect(() => {
    const t = setTimeout(() => SplashScreen.hideAsync(), 5000);
    return () => clearTimeout(t);
  }, []);

  // Show branded loading screen while session and terms are being checked
  if (isLoading || !termsChecked) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0A1F44', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: '#FFFFFF', fontSize: 32, fontWeight: '700' }}>Path+</Text>
      </View>
    );
  }

  return (
    <ThemeProvider value={PathTheme}>
      <Stack>
        <Stack.Protected guard={!!session?.user}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="create-moment" options={{ presentation: 'modal', headerShown: false }} />
          <Stack.Screen name="chat/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="friend-profile/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="settings" options={{ headerShown: false }} />
          <Stack.Screen name="edit-profile" options={{ headerShown: false }} />
          <Stack.Screen name="friends" options={{ headerShown: false }} />
          <Stack.Screen name="sleep-screen" options={{ presentation: 'fullScreenModal', headerShown: false, gestureEnabled: false }} />
          <Stack.Screen name="post/[id]" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={!session?.user}>
          <Stack.Screen name="sign-in" options={{ headerShown: false, gestureEnabled: false }} />
          <Stack.Screen name="sign-up" options={{ headerShown: false }} />
          <Stack.Screen name="verify-otp" options={{ headerShown: false }} />
          <Stack.Screen name="forgot-password" options={{ headerShown: false }} />
          <Stack.Screen name="verify-reset-otp" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Screen name="reset-password" options={{ headerShown: false }} />
        <Stack.Screen name="terms" options={{ headerShown: false }} />
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardProvider>
          <StatusBar style="light" />
          <RootLayoutNav />
        </KeyboardProvider>
      </GestureHandlerRootView>
    </QueryClientProvider>
  );
}
