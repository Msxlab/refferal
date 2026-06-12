import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { colors } from '@/theme';
import { t } from '@/lib/i18n';

function Icon({ glyph, color }: { glyph: string; color: string }) {
  return <Text style={{ fontSize: 17, color }}>{glyph}</Text>;
}

export default function TabsLayout() {
  return (
    <Tabs
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
      <Tabs.Screen
        name="index"
        options={{ title: t('tab.home'), tabBarIcon: ({ color }) => <Icon glyph="◈" color={color} /> }}
      />
      <Tabs.Screen
        name="wallet"
        options={{ title: t('tab.wallet'), tabBarIcon: ({ color }) => <Icon glyph="◇" color={color} /> }}
      />
      <Tabs.Screen
        name="team"
        options={{ title: t('tab.team'), tabBarIcon: ({ color }) => <Icon glyph="⬡" color={color} /> }}
      />
      <Tabs.Screen
        name="invite"
        options={{ title: t('tab.invite'), tabBarIcon: ({ color }) => <Icon glyph="✦" color={color} /> }}
      />
    </Tabs>
  );
}
