import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import { saveSession, type Session } from '@/lib/auth';
import { registerPushToken } from '@/lib/push';
import { Badge, Button, Card, ErrorText, Field, MutedText, Title } from '@/components/ui';
import { t } from '@/lib/i18n';
import { colors, space, text } from '@/theme';

interface InviteResolve {
  code: string;
  valid: boolean;
  tenantName: string;
  inviterName: string;
  emailLocked: boolean;
}

/** Davet deep-link hedefi: refearn://i/{code} (web linkiyle ayni yol). SPEC 4.3. */
export default function InviteRegisterScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const router = useRouter();
  const [invite, setInvite] = useState<InviteResolve | null>(null);
  const [loadError, setLoadError] = useState('');

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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
      const session = await api.post<Session>('/auth/register-by-invite', {
        inviteCode: code,
        email: email.trim().toLowerCase(),
        password,
        fullName: fullName.trim(),
      });
      await saveSession(session);
      void registerPushToken();
      router.replace('/(tabs)');
    } catch (e) {
      setError(String((e as ApiError).message));
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
        <Card glow>
          <Title eyebrow={t('reg.title')} title={invite ? `${invite.inviterName} sizi davet etti` : ' '} />

          {loadError || (invite && !invite.valid) ? (
            <ErrorText>{t('reg.invalid')}</ErrorText>
          ) : !invite ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <>
              <Card style={{ backgroundColor: 'rgba(124,139,255,0.08)', padding: space.s3 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View>
                    <MutedText size={text.xs}>{t('reg.tenant')}</MutedText>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>{invite.tenantName}</Text>
                  </View>
                  <Badge value="active" />
                </View>
              </Card>

              <Field label={t('reg.fullName')} value={fullName} onChangeText={setFullName} placeholder="Ad Soyad" />
              <Field
                label={t('login.email')}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="ornek@firma.com"
              />
              <Field
                label={`${t('login.password')} (min 10)`}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                placeholder="••••••••••"
              />
              {error ? <ErrorText>{error}</ErrorText> : null}
              <Button title={busy ? t('common.loading') : t('reg.submit')} onPress={onSubmit} busy={busy} />
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
