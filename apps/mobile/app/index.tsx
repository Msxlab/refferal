import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useRouter } from 'expo-router';
import { loadSession } from '@/lib/auth';
import { colors } from '@/theme';

/** Giris noktasi: oturum varsa tab'lere, yoksa login'e. */
export default function Index() {
  const router = useRouter();

  useEffect(() => {
    void loadSession().then((s) => {
      router.replace(s ? '/(tabs)' : '/login');
    });
  }, [router]);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg0 }}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}
