import React from 'react';
import { View, Text, Pressable, ScrollView, Switch, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ChevronLeft, ChevronRight, User, Mail, Eye, Bell, Trash2, Info, LogOut } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { supabase } from '@/lib/supabase';
import { useSession, SESSION_QUERY_KEY } from '@/lib/auth/use-session';
import { useQueryClient } from '@tanstack/react-query';

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mt-5">
      <Text className="px-5 pb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: '#8B8B8B' }}>
        {title}
      </Text>
      <View className="mx-4 rounded-2xl overflow-hidden" style={{ backgroundColor: '#fff' }}>
        {children}
      </View>
    </View>
  );
}

function SettingsRow({
  icon,
  label,
  value,
  onPress,
  isDestructive,
  showChevron = true,
  rightElement,
  testID,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string;
  onPress?: () => void;
  isDestructive?: boolean;
  showChevron?: boolean;
  rightElement?: React.ReactNode;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      className="flex-row items-center px-4 py-3.5"
      style={{ borderBottomWidth: 0.5, borderBottomColor: '#F0F0F0' }}
    >
      <View style={{ width: 28, alignItems: 'center' }}>{icon}</View>
      <Text
        className="flex-1 text-sm ml-3"
        style={{ color: isDestructive ? '#EF4444' : '#0A1F44', fontWeight: isDestructive ? '600' : '400' }}
      >
        {label}
      </Text>
      {rightElement ? rightElement : null}
      {value ? (
        <Text className="text-sm mr-2" style={{ color: '#8B8B8B' }}>{value}</Text>
      ) : null}
      {showChevron && !rightElement ? <ChevronRight size={18} color="#C4C4C4" /> : null}
    </Pressable>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const [pushEnabled, setPushEnabled] = React.useState(true);
  const [emailEnabled, setEmailEnabled] = React.useState(false);
  const [privacySetting, setPrivacySetting] = React.useState<'Everyone' | 'Friends'>('Friends');

  const cyclePrivacy = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const order: Array<'Everyone' | 'Friends'> = ['Everyone', 'Friends'];
    const currentIdx = order.indexOf(privacySetting);
    setPrivacySetting(order[(currentIdx + 1) % order.length]);
  };

  const handleLogout = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Alert.alert(
      'Log Out',
      'Are you sure you want to log out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out',
          style: 'destructive',
          onPress: async () => {
            await supabase.auth.signOut();
            queryClient.setQueryData(SESSION_QUERY_KEY, null);
            queryClient.clear();
            router.replace('/sign-in' as any);
          },
        },
      ]
    );
  };

  return (
    <View className="flex-1 bg-[#F8F6F2]" testID="settings-screen">
      <SafeAreaView edges={['top']} style={{ backgroundColor: '#0A1F44' }}>
        <View className="flex-row items-center px-4 pb-3 pt-1" style={{ backgroundColor: '#0A1F44' }}>
          <Pressable testID="settings-back" onPress={() => { if (router.canGoBack()) router.back(); else router.replace('/(tabs)'); }} hitSlop={12}>
            <ChevronLeft size={28} color="#F8F6F2" />
          </Pressable>
          <Text className="text-lg font-semibold ml-3" style={{ color: '#F8F6F2' }}>Settings</Text>
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <SettingsSection title="Account">
          <SettingsRow
            testID="settings-name"
            icon={<User size={18} color="#0A1F44" />}
            label="Name"
            value={(session?.user?.user_metadata?.['full_name'] as string | undefined) ?? ''}
          />
          <SettingsRow
            testID="settings-email"
            icon={<Mail size={18} color="#0A1F44" />}
            label="Email"
            value={session?.user?.email ?? ''}
          />
        </SettingsSection>

        <SettingsSection title="Privacy">
          <SettingsRow
            testID="settings-privacy"
            icon={<Eye size={18} color="#0A1F44" />}
            label="Who can see posts"
            value={privacySetting}
            onPress={cyclePrivacy}
          />
        </SettingsSection>

        <SettingsSection title="Notifications">
          <SettingsRow
            testID="settings-push"
            icon={<Bell size={18} color="#0A1F44" />}
            label="Push notifications"
            showChevron={false}
            rightElement={
              <Switch
                value={pushEnabled}
                onValueChange={setPushEnabled}
                trackColor={{ false: '#E5E7EB', true: '#FFFFFF' }}
                thumbColor="#fff"
              />
            }
          />
          <SettingsRow
            testID="settings-email-notif"
            icon={<Mail size={18} color="#0A1F44" />}
            label="Email notifications"
            showChevron={false}
            rightElement={
              <Switch
                value={emailEnabled}
                onValueChange={setEmailEnabled}
                trackColor={{ false: '#E5E7EB', true: '#FFFFFF' }}
                thumbColor="#fff"
              />
            }
          />
        </SettingsSection>

        <SettingsSection title="Data & Storage">
          <SettingsRow
            testID="settings-clear-cache"
            icon={<Trash2 size={18} color="#0A1F44" />}
            label="Clear cache"
            onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
          />
        </SettingsSection>

        <SettingsSection title="About">
          <SettingsRow
            testID="settings-version"
            icon={<Info size={18} color="#0A1F44" />}
            label="App version"
            value="1.0.0"
            showChevron={false}
          />
          <SettingsRow
            testID="settings-terms"
            icon={<Info size={18} color="#0A1F44" />}
            label="Terms of Service"
          />
          <SettingsRow
            testID="settings-privacy-policy"
            icon={<Info size={18} color="#0A1F44" />}
            label="Privacy Policy"
          />
        </SettingsSection>

        <View className="mt-5 mx-4">
          <Pressable
            testID="settings-logout"
            onPress={handleLogout}
            className="items-center justify-center rounded-2xl py-3.5"
            style={{ backgroundColor: '#fff' }}
          >
            <View className="flex-row items-center">
              <LogOut size={18} color="#EF4444" />
              <Text className="text-sm font-semibold ml-2" style={{ color: '#EF4444' }}>Log Out</Text>
            </View>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
