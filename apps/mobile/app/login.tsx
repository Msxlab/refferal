import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { isMfaChallenge, login, loginMfa } from '@/lib/api';
import { saveSession } from '@/lib/auth';
import { registerPushToken } from '@/lib/push';
import { Button, Card, ErrorText, Field, MutedText } from '@/components/ui';
import { t } from '@/lib/i18n';
import { colors, space, text } from '@/theme';

export default function LoginScreen() {
  const router = useRouter();
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
      if (session.memberships.length === 0) {
        setError('Bu hesabin aktif uyeligi yok.');
        return;
      }
      await saveSession(session);
      void registerPushToken(); // best-effort, akisi bekletme
      router.replace('/(tabs)');
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
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: space.s6 }}>
        <View style={{ alignItems: 'center', marginBottom: space.s6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: colors.primary }} />
            <Text style={{ color: colors.text, fontSize: text.xl, fontWeight: '800' }}>Refearn</Text>
          </View>
          <MutedText size={text.md}>Referans agini buyut, komisyonu otomatik kazan.</MutedText>
        </View>

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
            placeholder="ornek@firma.com"
          />
          <Field
            label={t('login.password')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="••••••••"
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
