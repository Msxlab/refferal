import type { ComponentType } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { colors } from '@/theme';

const StackNavigator = Stack as unknown as ComponentType<Record<string, unknown>>;

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <StackNavigator
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg0 },
        }}
      />
    </>
  );
}
