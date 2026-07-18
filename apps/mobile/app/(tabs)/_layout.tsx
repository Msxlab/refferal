import type { ComponentType, PropsWithChildren } from 'react';
import { useEffect, useState } from 'react';
import { Tabs, useRouter } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { landingForSession, loadSession } from '@/lib/auth';
import { useTheme } from '@/theme';
import { t } from '@/lib/i18n';

const TabsNavigator = Tabs as unknown as ComponentType<PropsWithChildren<Record<string, unknown>>>;
const TabsScreen = Tabs.Screen as unknown as ComponentType<Record<string, unknown>>;

export default function TabsLayout() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void loadSession()
      .then((session) => {
        if (!active) return;
        if (!session) {
          router.replace('/login');
          return;
        }
        const landing = landingForSession(session);
        if (landing !== '/(tabs)') {
          router.replace(landing);
          return;
        }
        setReady(true);
      })
      .catch(() => {
        if (active) router.replace('/login');
      });
    return () => {
      active = false;
    };
  }, [router]);

  if (!ready) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg0 }} edges={['top', 'left', 'right']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }} accessibilityLiveRegion="polite">
          <ActivityIndicator color={colors.primary} accessibilityLabel="Checking account access" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg0 }} edges={['top', 'left', 'right']}>
      <TabsNavigator
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: colors.bg0 },
          tabBarStyle: {
            backgroundColor: colors.panelSolid,
            borderTopColor: colors.border,
            height: 62 + Math.max(0, insets.bottom - 8),
            paddingTop: 6,
            paddingBottom: Math.max(8, insets.bottom),
          },
          tabBarShowIcon: false,
          tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.faint,
        }}
      >
        <TabsScreen
          name="index"
          options={{ title: t('tab.home') }}
        />
        <TabsScreen
          name="wallet"
          options={{ title: t('tab.wallet') }}
        />
        <TabsScreen
          name="team"
          options={{ title: t('tab.team') }}
        />
        <TabsScreen
          name="invite"
          options={{ title: t('tab.invite') }}
        />
      </TabsNavigator>
    </SafeAreaView>
  );
}
