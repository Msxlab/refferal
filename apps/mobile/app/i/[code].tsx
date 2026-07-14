import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, ApiError, isMfaChallenge, loginMfa, type MfaChallenge } from '@/lib/api';
import { landingForSession, saveSession, type Session } from '@/lib/auth';
import { normalizeRuntimeBrand, type RuntimeBrand } from '@/lib/brand';
import { registerPushToken } from '@/lib/push';
import { Badge, Brand, Button, Card, ErrorText, Field, MutedText, Title } from '@/components/ui';
import { t } from '@/lib/i18n';
import { space, text, useTheme } from '@/theme';

interface InviteResolve {
  code: string;
  valid: boolean;
  tenantName: string;
  emailLocked: boolean;
  brand?: RuntimeBrand;
}

function isExpiredMfaChallenge(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401 && /2FA session is invalid or expired/i.test(error.message);
}

/** Invite deep-link target; the web invite path uses the same route shape. */
export default function InviteRegisterScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const [invite, setInvite] = useState<InviteResolve | null>(null);
  const [loadError, setLoadError] = useState('');

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [challengeToken, setChallengeToken] = useState('');
  const [challengeExpired, setChallengeExpired] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const activeBrand = normalizeRuntimeBrand(invite?.brand ?? (invite ? { name: invite.tenantName } : null));

  useEffect(() => {
    if (!code) return;
    api
      .get<InviteResolve>(`/invites/${encodeURIComponent(code)}`)
      .then(setInvite)
      .catch((e) => setLoadError(String((e as ApiError).message)));
  }, [code]);

  async function onSubmit() {
    setError('');
    setBusy(true);
    try {
      const session = challengeToken
        ? await loginMfa(challengeToken, mfaCode)
        : await api.post<Session | MfaChallenge>('/auth/register-by-invite', {
            inviteCode: code,
            email: email.trim().toLowerCase(),
            password,
            fullName: fullName.trim(),
          });
      if (isMfaChallenge(session)) {
        // Keep the challenge in memory only; deep links and navigation state never contain it.
        setChallengeToken(session.challengeToken);
        setMfaCode('');
        setChallengeExpired(false);
        return;
      }
      await saveSession(session);
      const landing = landingForSession(session);
      if (landing !== '/mfa-setup') void registerPushToken();
      router.replace(landing);
    } catch (e) {
      if (challengeToken && isExpiredMfaChallenge(e)) {
        setChallengeExpired(true);
        setMfaCode('');
      }
      setError(String((e as ApiError).message));
    } finally {
      setBusy(false);
    }
  }

  function restartMfaChallenge() {
    setChallengeToken('');
    setMfaCode('');
    setChallengeExpired(false);
    setError('');
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
        <Card glow>
          <Brand brand={activeBrand} style={{ alignSelf: 'center', marginBottom: space.s5 }} />

          <Title eyebrow={t('reg.title')} title={invite ? `You're invited to join ${invite.tenantName}` : ' '} />

          {loadError || (invite && !invite.valid) ? (
            <ErrorText>{t('reg.invalid')}</ErrorText>
          ) : !invite ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <>
              <Card style={{ backgroundColor: colors.infoSubtle, padding: space.s3 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View>
                    <MutedText size={text.xs}>{t('reg.tenant')}</MutedText>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>{invite.tenantName}</Text>
                  </View>
                  <Badge value="active" />
                </View>
              </Card>

              {challengeToken ? (
                <>
                  <Card style={{ backgroundColor: colors.infoSubtle, padding: space.s3 }}>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>Verify your account</Text>
                    <MutedText size={text.sm}>
                      {challengeExpired
                        ? 'This verification session expired. Start over to request a new one.'
                        : 'Enter your authenticator or recovery code to finish joining this business.'}
                    </MutedText>
                  </Card>
                  <Field
                    label="Authenticator or recovery code"
                    value={mfaCode}
                    onChangeText={setMfaCode}
                    autoCapitalize="characters"
                    autoComplete="one-time-code"
                    placeholder="123456"
                  />
                </>
              ) : (
                <>
                  <Field label={t('reg.fullName')} value={fullName} onChangeText={setFullName} placeholder="Full name" />
                  <Field
                    label={t('login.email')}
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    placeholder="name@company.com"
                  />
                  <Field
                    label={`${t('login.password')} (min 10)`}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                    placeholder="**********"
                  />
                </>
              )}
              {error ? <ErrorText>{error}</ErrorText> : null}
              {challengeExpired ? <Button title="Start over" variant="ghost" onPress={restartMfaChallenge} /> : null}
              <Button
                title={busy ? t('common.loading') : challengeToken ? 'Verify and join' : t('reg.submit')}
                onPress={onSubmit}
                busy={busy}
                disabled={challengeExpired}
              />
            </>
          )}

          <View style={{ marginTop: space.s4 }}>
            <MutedText size={text.xs}>{t('me.incomeNote')}</MutedText>
          </View>
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
