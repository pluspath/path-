import React from 'react';
import { View, Text, TextInput, Pressable, Animated, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Camera, Users, ChevronRight } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const TOTAL_STEPS = 4;

export default function OnboardingScreen() {
  const router = useRouter();
  const [step, setStep] = React.useState(0);
  const slideAnim = React.useRef(new Animated.Value(0)).current;

  // Step 1 state
  const pulseAnim = React.useRef(new Animated.Value(1)).current;

  // Step 2 state
  const [phone, setPhone] = React.useState('');
  const [otp, setOtp] = React.useState('');
  const [showOtp, setShowOtp] = React.useState(false);

  // Step 3 state
  const [name, setName] = React.useState('');
  const [bio, setBio] = React.useState('');

  React.useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 1200, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1200, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  const animateToStep = (nextStep: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Animated.timing(slideAnim, {
      toValue: -nextStep * SCREEN_WIDTH,
      duration: 350,
      useNativeDriver: true,
    }).start();
    setStep(nextStep);
  };

  const handleComplete = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.replace('/(tabs)' as any);
  };

  return (
    <View className="flex-1" style={{ backgroundColor: '#060F22' }} testID="onboarding-screen">
      {/* Progress bar */}
      {step > 0 ? (
        <SafeAreaView edges={['top']} style={{ backgroundColor: 'transparent' }}>
          <View className="flex-row px-6 pt-2" style={{ gap: 6 }}>
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
              <View
                key={i}
                style={{
                  flex: 1,
                  height: 3,
                  borderRadius: 1.5,
                  backgroundColor: i <= step ? '#FFFFFF' : 'rgba(248,246,242,0.15)',
                }}
              />
            ))}
          </View>
        </SafeAreaView>
      ) : null}

      <Animated.View
        style={{
          flexDirection: 'row',
          width: SCREEN_WIDTH * TOTAL_STEPS,
          flex: 1,
          transform: [{ translateX: slideAnim }],
        }}
      >
        {/* Step 1: Welcome */}
        <View style={{ width: SCREEN_WIDTH, flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 }}>
          <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
            <Text style={{ fontSize: 56, fontWeight: '700', color: '#FFFFFF', letterSpacing: -1 }}>
              Path<Text style={{ color: '#D4BC72', fontWeight: '300', fontSize: 64 }}>+</Text>
            </Text>
          </Animated.View>
          <Text className="text-base text-center mt-4" style={{ color: 'rgba(248,246,242,0.6)', lineHeight: 22 }}>
            Your intimate social circle.{'\n'}Share moments that matter.
          </Text>
          <Pressable
            testID="onboarding-get-started"
            onPress={() => animateToStep(1)}
            className="mt-10 items-center justify-center rounded-xl py-4 px-8"
            style={{ backgroundColor: '#FFFFFF', width: '100%' }}
          >
            <Text className="text-base font-semibold" style={{ color: '#0A1F44' }}>Get Started</Text>
          </Pressable>
        </View>

        {/* Step 2: Phone */}
        <View style={{ width: SCREEN_WIDTH, flex: 1, paddingHorizontal: 32, paddingTop: 60 }}>
          <Text className="text-2xl font-bold" style={{ color: '#F8F6F2' }}>Your phone number</Text>
          <Text className="text-sm mt-2" style={{ color: 'rgba(248,246,242,0.5)' }}>
            We will send you a verification code
          </Text>
          <View className="flex-row items-center mt-6 rounded-xl px-4" style={{ backgroundColor: 'rgba(248,246,242,0.08)', height: 52 }}>
            <Text style={{ color: '#F8F6F2', fontSize: 16 }}>+1</Text>
            <TextInput
              testID="onboarding-phone-input"
              value={phone}
              onChangeText={setPhone}
              placeholder="(555) 000-0000"
              placeholderTextColor="rgba(248,246,242,0.3)"
              keyboardType="phone-pad"
              className="flex-1 ml-2 text-base"
              style={{ color: '#F8F6F2' }}
            />
          </View>

          {showOtp ? (
            <View className="mt-4">
              <Text className="text-sm mb-2" style={{ color: 'rgba(248,246,242,0.5)' }}>Enter 6-digit code</Text>
              <TextInput
                testID="onboarding-otp-input"
                value={otp}
                onChangeText={setOtp}
                placeholder="000000"
                placeholderTextColor="rgba(248,246,242,0.3)"
                keyboardType="number-pad"
                maxLength={6}
                className="rounded-xl px-4 text-center text-xl tracking-widest"
                style={{ backgroundColor: 'rgba(248,246,242,0.08)', height: 52, color: '#F8F6F2' }}
              />
            </View>
          ) : null}

          <Pressable
            testID="onboarding-phone-next"
            onPress={() => {
              if (!showOtp) {
                setShowOtp(true);
              } else if (otp.length === 6) {
                animateToStep(2);
              }
            }}
            className="mt-6 items-center justify-center rounded-xl py-4"
            style={{ backgroundColor: (showOtp ? otp.length === 6 : phone.length > 0) ? '#FFFFFF' : 'rgba(248,246,242,0.1)' }}
          >
            <Text className="text-base font-semibold" style={{ color: (showOtp ? otp.length === 6 : phone.length > 0) ? '#0A1F44' : 'rgba(248,246,242,0.3)' }}>
              {showOtp ? 'Verify' : 'Send Code'}
            </Text>
          </Pressable>
        </View>

        {/* Step 3: Profile Setup */}
        <View style={{ width: SCREEN_WIDTH, flex: 1, paddingHorizontal: 32, paddingTop: 60 }}>
          <Text className="text-2xl font-bold" style={{ color: '#F8F6F2' }}>Set up your profile</Text>
          <Text className="text-sm mt-2" style={{ color: 'rgba(248,246,242,0.5)' }}>
            Tell your friends who you are
          </Text>

          <View className="items-center mt-6">
            <Pressable testID="onboarding-pick-photo">
              <View
                style={{
                  width: 88,
                  height: 88,
                  borderRadius: 44,
                  backgroundColor: 'rgba(248,246,242,0.08)',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 2,
                  borderColor: '#FFFFFF',
                  borderStyle: 'dashed',
                }}
              >
                <Camera size={28} color="#FFFFFF" />
              </View>
            </Pressable>
            <Text className="text-xs mt-2" style={{ color: '#FFFFFF' }}>Add photo</Text>
          </View>

          <View style={{ gap: 12, marginTop: 20 }}>
            <TextInput
              testID="onboarding-name-input"
              value={name}
              onChangeText={setName}
              placeholder="Your name"
              placeholderTextColor="rgba(248,246,242,0.3)"
              className="rounded-xl px-4 text-base"
              style={{ backgroundColor: 'rgba(248,246,242,0.08)', height: 50, color: '#F8F6F2' }}
            />
            <TextInput
              testID="onboarding-bio-input"
              value={bio}
              onChangeText={setBio}
              placeholder="Short bio"
              placeholderTextColor="rgba(248,246,242,0.3)"
              multiline
              className="rounded-xl px-4 pt-3 text-base"
              style={{ backgroundColor: 'rgba(248,246,242,0.08)', minHeight: 80, color: '#F8F6F2', textAlignVertical: 'top' }}
            />
          </View>

          <Pressable
            testID="onboarding-profile-next"
            onPress={() => name.trim() && animateToStep(3)}
            className="mt-6 items-center justify-center rounded-xl py-4"
            style={{ backgroundColor: name.trim() ? '#FFFFFF' : 'rgba(248,246,242,0.1)' }}
          >
            <Text className="text-base font-semibold" style={{ color: name.trim() ? '#0A1F44' : 'rgba(248,246,242,0.3)' }}>
              Continue
            </Text>
          </Pressable>
        </View>

        {/* Step 4: Contact Sync */}
        <View style={{ width: SCREEN_WIDTH, flex: 1, paddingHorizontal: 32, justifyContent: 'center', alignItems: 'center' }}>
          <View
            style={{
              width: 100,
              height: 100,
              borderRadius: 50,
              backgroundColor: 'rgba(201,168,76,0.15)',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 24,
            }}
          >
            <Users size={44} color="#FFFFFF" />
          </View>
          <Text className="text-2xl font-bold text-center" style={{ color: '#F8F6F2' }}>Find your people</Text>
          <Text className="text-sm mt-3 text-center" style={{ color: 'rgba(248,246,242,0.5)', lineHeight: 20 }}>
            Sync your contacts to find friends already on Path+. We will never spam your contacts.
          </Text>

          <Pressable
            testID="onboarding-allow-contacts"
            onPress={handleComplete}
            className="mt-8 items-center justify-center rounded-xl py-4"
            style={{ backgroundColor: '#FFFFFF', width: '100%' }}
          >
            <Text className="text-base font-semibold" style={{ color: '#0A1F44' }}>Allow Access</Text>
          </Pressable>

          <Pressable
            testID="onboarding-skip-contacts"
            onPress={handleComplete}
            className="mt-3 items-center justify-center py-3"
          >
            <Text className="text-sm" style={{ color: 'rgba(248,246,242,0.5)' }}>Skip for now</Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}
