import type { ComponentType, PropsWithChildren } from 'react';
import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { colors } from '@/theme';
import { t } from '@/lib/i18n';

const TabsNavigator = Tabs as unknown as ComponentType<PropsWithChildren<Record<string, unknown>>>;
const TabsScreen = Tabs.Screen as unknown as ComponentType<Record<string, unknown>>;

function Icon({ glyph, color }: { glyph: string; color: string }) {
  return <Text style={{ fontSize: 17, color }}>{glyph}</Text>;
}

export default function TabsLayout() {
  return (
    <TabsNavigator
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg0 },
        tabBarStyle: {
          backgroundColor: colors.panelSolid,
          borderTopColor: colors.border,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.faint,
      }}
    >
      <TabsScreen
        name="index"
        options={{ title: t('tab.home'), tabBarIcon: ({ color }: { color: string }) => <Icon glyph="o" color={color} /> }}
      />
      <TabsScreen
        name="wallet"
        options={{ title: t('tab.wallet'), tabBarIcon: ({ color }: { color: string }) => <Icon glyph="$" color={color} /> }}
      />
      <TabsScreen
        name="team"
        options={{ title: t('tab.team'), tabBarIcon: ({ color }: { color: string }) => <Icon glyph="+" color={color} /> }}
      />
      <TabsScreen
        name="invite"
        options={{ title: t('tab.invite'), tabBarIcon: ({ color }: { color: string }) => <Icon glyph="*" color={color} /> }}
      />
    </TabsNavigator>
  );
}
