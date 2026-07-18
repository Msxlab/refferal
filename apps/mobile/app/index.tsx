import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useRouter } from 'expo-router';
import { landingForSession, loadSession } from '@/lib/auth';
import { useTheme } from '@/theme';

/** Entry point: restore a session to its role- and MFA-aware mobile destination. */
export default function Index() {
  const router = useRouter();
  const { colors } = useTheme();

  useEffect(() => {
    void loadSession()
      .then((s) => {
        router.replace(s ? landingForSession(s) : '/login');
      })
      .catch(() => {
        router.replace('/login');
      });
  }, [router]);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg0 }}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}
