import type { ComponentType } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from '@/theme';

const StackNavigator = Stack as unknown as ComponentType<Record<string, unknown>>;

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ThemedNavigator />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function ThemedNavigator() {
  const { colors, statusBarStyle } = useTheme();
  return (
    <>
      <StatusBar style={statusBarStyle} backgroundColor={colors.bg0} />
      <StackNavigator
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg0 },
        }}
      />
    </>
  );
}
