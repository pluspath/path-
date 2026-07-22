import React from 'react';
import { View, Text, ScrollView, Pressable, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';

export default function TermsScreen() {
  const [showDeclineModal, setShowDeclineModal] = React.useState(false);

  const handleAccept = async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await AsyncStorage.setItem('terms_accepted', 'true');
    // Navigate based on whether user is already signed in
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      router.replace('/(tabs)' as any);
    } else {
      router.replace('/sign-in' as any);
    }
  };

  const handleDecline = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    setShowDeclineModal(true);
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#0A1F44' }} testID="terms-screen">
      <SafeAreaView edges={['top']} style={{ backgroundColor: '#0A1F44' }}>
        <View style={{ paddingHorizontal: 24, paddingTop: 16, paddingBottom: 12, alignItems: 'center' }}>
          <Text style={{ fontSize: 28, fontWeight: '700', color: '#FFFFFF', letterSpacing: -0.5 }}>
            Welcome to Path<Text style={{ fontWeight: '300' }}>+</Text>
          </Text>
          <Text style={{ fontSize: 14, color: '#94A3B8', marginTop: 6 }}>Please read and accept our terms to continue</Text>
        </View>
      </SafeAreaView>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        testID="terms-scroll"
      >
        <Text style={{ color: '#94A3B8', fontSize: 13, marginBottom: 24 }}>Last updated: January 2025</Text>

        <Section title="1. Age Requirement (13+)">
          Path+ is intended for users who are 13 years of age or older. By using this App, you confirm that you are at least 13 years old. If we become aware that a user is under 13, we will terminate their account immediately.
        </Section>

        <Section title="2. Privacy Policy & Data Usage">
          We are committed to protecting your privacy. When you use Path+, we collect:{'\n\n'}
          {'\u2022'} Email address (for account creation){'\n'}
          {'\u2022'} Full name and profile info{'\n'}
          {'\u2022'} Posts and content you create{'\n'}
          {'\u2022'} Location data only when you share a check-in{'\n\n'}
          We use this information to operate the App and improve your experience. We do not sell your personal data to third parties.
        </Section>

        <Section title="3. Content Rules">
          When using Path+, you agree NOT to:{'\n\n'}
          {'\u2022'} Harass, bully, or intimidate other users{'\n'}
          {'\u2022'} Post spam or misleading content{'\n'}
          {'\u2022'} Share illegal or harmful content{'\n'}
          {'\u2022'} Impersonate others or create fake accounts{'\n'}
          {'\u2022'} Post content that is hateful or sexually explicit{'\n\n'}
          Violation may result in immediate account suspension.
        </Section>

        <Section title="4. User Responsibilities">
          You are solely responsible for the content you post. You retain ownership of your content but grant Path+ a non-exclusive license to display it within the App. You represent that you have all necessary rights to the content you share.
        </Section>

        <Section title="5. Data Deletion">
          You may delete your account at any time from Settings. All personal data will be permanently removed within 30 days.
        </Section>

        <Section title="6. Contact">
          Questions? Email us at support@pathplus.app. We aim to respond within 48 hours.
        </Section>

        <View style={{ height: 16 }} />
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={{ backgroundColor: '#0A1F44' }}>
        <View style={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 8, gap: 10 }}>
          <Pressable
            testID="terms-accept"
            onPress={handleAccept}
            style={{
              backgroundColor: '#FFFFFF',
              borderRadius: 14,
              paddingVertical: 16,
              alignItems: 'center',
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#0A1F44' }}>Accept & Continue</Text>
          </Pressable>
          <Pressable
            testID="terms-decline"
            onPress={handleDecline}
            style={{
              backgroundColor: 'transparent',
              borderRadius: 14,
              paddingVertical: 12,
              alignItems: 'center',
            }}
          >
            <Text style={{ fontSize: 14, fontWeight: '500', color: '#64748B' }}>Decline</Text>
          </Pressable>
        </View>
      </SafeAreaView>

      {/* Decline confirmation modal */}
      <Modal
        visible={showDeclineModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDeclineModal(false)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 }}>
          <View style={{
            backgroundColor: '#FFFFFF',
            borderRadius: 20,
            padding: 24,
            width: '100%',
            alignItems: 'center',
          }}>
            <Text style={{ fontSize: 20, fontWeight: '700', color: '#0A1F44', textAlign: 'center', marginBottom: 8 }}>
              You must accept to use Path+
            </Text>
            <Text style={{ fontSize: 14, color: '#6B7280', textAlign: 'center', marginBottom: 24, lineHeight: 20 }}>
              You need to accept our Terms & Conditions to create an account and use Path+.
            </Text>
            <Pressable
              testID="decline-ok-button"
              onPress={() => setShowDeclineModal(false)}
              style={{
                backgroundColor: '#0A1F44',
                borderRadius: 12,
                paddingVertical: 14,
                paddingHorizontal: 32,
                width: '100%',
                alignItems: 'center',
              }}
            >
              <Text style={{ fontSize: 16, fontWeight: '700', color: '#FFFFFF' }}>OK, take me back</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 24 }}>
      <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFFFFF', marginBottom: 8 }}>
        {title}
      </Text>
      <Text style={{ fontSize: 14, color: '#CBD5E1', lineHeight: 22 }}>
        {children}
      </Text>
    </View>
  );
}
