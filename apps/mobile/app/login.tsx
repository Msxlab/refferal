import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isMfaChallenge, login, loginMfa } from '@/lib/api';
import { activeMembership, isPrivilegedSession, landingForSession, saveSession } from '@/lib/auth';
import { registerPushToken } from '@/lib/push';
import { Brand, Button, Card, ErrorText, Field, MutedText } from '@/components/ui';
import { t } from '@/lib/i18n';
import { space, text, useTheme } from '@/theme';

export default function LoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [challengeToken, setChallengeToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    setError('');
    setBusy(true);
    try {
      const session = challengeToken
        ? await loginMfa(challengeToken, mfaCode)
        : await login(email.trim().toLowerCase(), password);
      if (isMfaChallenge(session)) {
        setChallengeToken(session.challengeToken);
        setMfaCode('');
        return;
      }
      if (!isPrivilegedSession(session) && !activeMembership(session)) {
        setError('This account has no active membership.');
        return;
      }
      await saveSession(session);
      const landing = landingForSession(session);
      if (landing !== '/mfa-setup') void registerPushToken(); // best-effort; do not use an MFA-setup session for app actions
      router.replace(landing);
    } catch {
      setError(t('login.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg0 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          paddingHorizontal: space.s6,
          paddingTop: Math.max(space.s6, insets.top + space.s4),
          paddingBottom: Math.max(space.s6, insets.bottom + space.s4),
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Brand style={{ alignSelf: 'center', marginBottom: space.s6 }} />

        <Card glow>
          <Text style={{ color: colors.text, fontSize: text.lg, fontWeight: '750' as never, marginBottom: space.s4 }}>
            {t('login.title')}
          </Text>
          <Field
            label={t('login.email')}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            placeholder="name@company.com"
          />
          <Field
            label={t('login.password')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="********"
          />
          {challengeToken ? (
            <Field
              label="Authenticator or recovery code"
              value={mfaCode}
              onChangeText={setMfaCode}
              autoCapitalize="characters"
              placeholder="123456"
            />
          ) : null}
          {error ? <ErrorText>{error}</ErrorText> : null}
          <Button title={busy ? t('common.loading') : t('login.submit')} onPress={onSubmit} busy={busy} />
        </Card>

        <MutedText size={text.xs}>{t('me.incomeNote')}</MutedText>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
