import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  activeMembership,
  clearSession,
  isPlatformSession,
  isPrivilegedSession,
  landingForSession,
  loadSession,
  roleForSession,
  type Session,
} from '@/lib/auth';
import { Brand, Button, Card, ErrorText, MutedText, Title } from '@/components/ui';
import { space, text, useTheme } from '@/theme';

const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL ?? 'http://localhost:3000';

function displayRole(role: string | undefined): string {
  if (!role) return 'No active member workspace';
  return role.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function contextFor(session: Session): string {
  if (isPlatformSession(session)) return 'Platform administrator';
  const membership = activeMembership(session);
  const role = displayRole(roleForSession(session));
  return membership ? `${membership.tenantName} · ${role}` : role;
}

function dashboardUrl(session: Session): string {
  return `${WEB_URL}${isPlatformSession(session) ? '/platform' : '/admin'}`;
}

/** A deliberate holding surface for privileged mobile sessions until native admin tools exist. */
export default function PrivilegedScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [openingWeb, setOpeningWeb] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void loadSession()
      .then((current) => {
        if (!active) return;
        if (!current) {
          router.replace('/login');
          return;
        }
        const landing = landingForSession(current);
        if (landing === '/mfa-setup' || landing === '/(tabs)') {
          router.replace(landing);
          return;
        }
        if (!isPrivilegedSession(current) && !activeMembership(current)) {
          setError('This account has no active mobile workspace. Contact an administrator for access.');
        }
        setSession(current);
        setChecking(false);
      })
      .catch(() => {
        if (active) router.replace('/login');
      });
    return () => {
      active = false;
    };
  }, [router]);

  async function openWebDashboard() {
    if (!session) return;
    setOpeningWeb(true);
    setError('');
    try {
      const url = dashboardUrl(session);
      if (!(await Linking.canOpenURL(url))) throw new Error('unavailable');
      await Linking.openURL(url);
    } catch {
      setError('Could not open the web dashboard. Check your connection and try again.');
    } finally {
      setOpeningWeb(false);
    }
  }

  async function logout() {
    await clearSession();
    router.replace('/login');
  }

  if (checking || !session) {
    return (
      <View
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg0 }}
        accessibilityLiveRegion="polite"
      >
        <ActivityIndicator color={colors.primary} accessibilityLabel="Checking account access" />
      </View>
    );
  }

  const privileged = isPrivilegedSession(session);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg0 }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        flexGrow: 1,
        justifyContent: 'center',
        padding: space.s4,
        paddingTop: Math.max(space.s6, insets.top + space.s4),
        paddingBottom: Math.max(space.s6, insets.bottom + space.s4),
      }}
    >
      <Brand size="sm" style={{ alignSelf: 'center', marginBottom: space.s5 }} />
      <Title
        eyebrow={privileged ? 'Secure mobile access' : 'Account access'}
        title={privileged ? 'Use the web dashboard' : 'Mobile access unavailable'}
        sub={contextFor(session)}
      />

      <Card glow>
        <Text style={{ color: colors.text, fontSize: text.lg, fontWeight: '750' as never, marginBottom: space.s2 }}>
          {privileged ? 'This account is kept out of the member workspace.' : 'This account has no active member workspace.'}
        </Text>
        <MutedText size={text.md}>
          {privileged
            ? 'Platform and tenant administration are not available in the mobile app yet. Open the web dashboard to manage this role.'
            : 'Contact an administrator for a workspace assignment, then sign in again.'}
        </MutedText>

        <View style={{ gap: space.s3, marginTop: space.s5 }}>
          {privileged ? (
            <Button title={openingWeb ? 'Opening web dashboard…' : 'Open web dashboard'} onPress={openWebDashboard} busy={openingWeb} />
          ) : null}
          <Button title="Sign out" onPress={logout} variant="ghost" />
        </View>

        {error ? (
          <View accessibilityLiveRegion="polite" accessibilityRole="alert" style={{ marginTop: space.s2 }}>
            <ErrorText>{error}</ErrorText>
          </View>
        ) : null}
      </Card>
    </ScrollView>
  );
}
