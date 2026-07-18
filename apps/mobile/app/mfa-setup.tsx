import type { ComponentType } from 'react';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, ApiError } from '@/lib/api';
import { clearSession, landingForSession, loadSession, requiresMfaSetup } from '@/lib/auth';
import { Brand, Button, Card, ErrorText, Field, MutedText, Title } from '@/components/ui';
import { radius, space, text, useTheme } from '@/theme';

interface MfaStatus {
  enabled: boolean;
  recoveryCodeCount: number;
}

interface MfaSetup {
  secret: string;
  otpauthUrl: string;
}

interface MfaEnable {
  enabled: true;
  recoveryCodes: string[];
}

const QRCodeView = QRCode as unknown as ComponentType<{ value: string; size: number }>;

async function clearUnauthorizedSession(cause: unknown): Promise<boolean> {
  if (!(cause instanceof ApiError) || cause.status !== 401) return false;
  try {
    await clearSession();
  } catch {
    // The API has already invalidated the session; navigation must not be blocked by local storage.
  }
  return true;
}

/** Required 2FA enrollment for privileged sessions. Recovery codes remain in memory only. */
export default function MfaSetupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const [checking, setChecking] = useState(true);
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [recoveryAcknowledged, setRecoveryAcknowledged] = useState(false);
  const [busy, setBusy] = useState<'setup' | 'enable' | 'finish' | ''>('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void (async () => {
      const current = await loadSession();
      if (!active) return;
      if (!current) {
        router.replace('/login');
        return;
      }
      if (!requiresMfaSetup(current)) {
        router.replace(landingForSession(current));
        return;
      }

      const nextStatus = await api.get<MfaStatus>('/auth/2fa/status');
      if (!active) return;
      if (nextStatus.enabled) {
        // Enabling MFA revokes existing refresh sessions; a fresh MFA-verified login is required.
        await clearSession();
        if (active) router.replace('/login');
        return;
      }
      setStatus(nextStatus);
      setChecking(false);
    })().catch(async (cause: unknown) => {
      if (!active) return;
      if (await clearUnauthorizedSession(cause)) {
        if (active) router.replace('/login');
        return;
      }
      setError(cause instanceof Error ? cause.message : 'Could not load two-factor authentication status.');
      setChecking(false);
    });

    return () => {
      active = false;
    };
  }, [router]);

  async function startSetup() {
    setBusy('setup');
    setError('');
    try {
      setSetup(await api.post<MfaSetup>('/auth/2fa/setup'));
    } catch (cause) {
      if (await clearUnauthorizedSession(cause)) {
        router.replace('/login');
        return;
      }
      setError(cause instanceof Error ? cause.message : 'Could not start two-factor authentication setup.');
    } finally {
      setBusy('');
    }
  }

  async function enable() {
    const value = code.trim();
    if (!value) {
      setError('Enter the current code from your authenticator app.');
      return;
    }
    setBusy('enable');
    setError('');
    try {
      const result = await api.post<MfaEnable>('/auth/2fa/enable', { code: value });
      setRecoveryCodes(result.recoveryCodes);
      setRecoveryAcknowledged(false);
      setSetup(null);
      setCode('');
    } catch (cause) {
      if (await clearUnauthorizedSession(cause)) {
        router.replace('/login');
        return;
      }
      setError(cause instanceof Error ? cause.message : 'Could not enable two-factor authentication.');
    } finally {
      setBusy('');
    }
  }

  async function finishRecoveryCodes() {
    if (!recoveryAcknowledged) {
      setError('Confirm that you stored the recovery codes before continuing.');
      return;
    }
    setBusy('finish');
    setError('');
    try {
      // These values are intentionally never persisted or sent anywhere after the enable response.
      await clearSession();
      setRecoveryCodes([]);
      router.replace('/login');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not finish the security setup.');
      setBusy('');
    }
  }

  if (checking) {
    return (
      <View
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg0 }}
        accessibilityLiveRegion="polite"
      >
        <ActivityIndicator color={colors.primary} accessibilityLabel="Checking two-factor authentication status" />
      </View>
    );
  }

  const showingRecoveryCodes = recoveryCodes.length > 0;

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
      keyboardShouldPersistTaps="handled"
    >
      <Brand size="sm" style={{ alignSelf: 'center', marginBottom: space.s5 }} />
      <Title eyebrow="Required security step" title="Enable two-factor authentication" />

      <Card glow>
        {!showingRecoveryCodes ? (
          <>
            <MutedText size={text.md}>
              Your role requires two-factor authentication before you can open a secure workspace. Add this account to an authenticator app, then enter its current code.
            </MutedText>

            {status ? (
              <View accessibilityLiveRegion="polite" style={{ marginTop: space.s3 }}>
                <MutedText size={text.sm}>
                  {status.enabled ? 'Two-factor authentication is active.' : 'Two-factor authentication is not enabled yet.'}
                </MutedText>
              </View>
            ) : null}

            {!setup ? (
              <View style={{ marginTop: space.s5 }}>
                <Button title={busy === 'setup' ? 'Preparing…' : 'Start setup'} onPress={startSetup} busy={busy === 'setup'} />
              </View>
            ) : (
              <View style={{ marginTop: space.s5 }}>
                <View style={{ alignItems: 'center', marginBottom: space.s4 }}>
                  <View style={{ backgroundColor: colors.qrSurface, padding: space.s3, borderRadius: radius.md }}>
                    <QRCodeView value={setup.otpauthUrl} size={180} />
                  </View>
                </View>
                <Text style={{ color: colors.text, fontSize: text.md, fontWeight: '700', marginBottom: space.s2 }}>Authenticator secret</Text>
                <Text selectable style={{ color: colors.primary, fontFamily: 'monospace', fontSize: text.md, marginBottom: space.s3 }}>
                  {setup.secret}
                </Text>
                <MutedText size={text.sm}>Scan the QR code or enter the secret manually. Keep the secret private.</MutedText>
                <Field
                  label="Authenticator code"
                  value={code}
                  onChangeText={setCode}
                  autoCapitalize="none"
                  autoComplete="one-time-code"
                  keyboardType="number-pad"
                  maxLength={6}
                  secureTextEntry
                  textContentType="oneTimeCode"
                  placeholder="123456"
                />
                <Button title={busy === 'enable' ? 'Enabling…' : 'Enable 2FA'} onPress={enable} busy={busy === 'enable'} disabled={!code.trim()} />
              </View>
            )}
          </>
        ) : (
          <>
            <Text style={{ color: colors.text, fontSize: text.lg, fontWeight: '750' as never }}>2FA is enabled</Text>
            <MutedText size={text.md}>
              Store these recovery codes now. They are shown only once and can be used if you lose your authenticator app.
            </MutedText>

            <View
              style={{ marginTop: space.s4, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.s3, gap: space.s2 }}
            >
              {recoveryCodes.map((recoveryCode) => (
                <Text
                  key={recoveryCode}
                  selectable
                  accessibilityLabel={`Recovery code ${recoveryCode}`}
                  style={{ color: colors.text, fontFamily: 'monospace', fontSize: text.md }}
                >
                  {recoveryCode}
                </Text>
              ))}
            </View>

            <Pressable
              accessibilityRole="checkbox"
              accessibilityLabel="I stored my recovery codes"
              accessibilityState={{ checked: recoveryAcknowledged }}
              onPress={() => setRecoveryAcknowledged((value) => !value)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'flex-start',
                gap: space.s2,
                marginTop: space.s4,
                minHeight: 44,
                paddingVertical: 6,
                opacity: pressed ? 0.78 : 1,
              })}
            >
              <View
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: recoveryAcknowledged ? colors.primary : colors.borderStrong,
                  backgroundColor: recoveryAcknowledged ? colors.primary : 'transparent',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {recoveryAcknowledged ? <Text style={{ color: colors.onPrimary, fontWeight: '900' }}>✓</Text> : null}
              </View>
              <MutedText size={text.sm}>I stored these recovery codes somewhere safe.</MutedText>
            </Pressable>

            <View style={{ marginTop: space.s5 }}>
              <Button
                title={busy === 'finish' ? 'Finishing…' : 'Continue to sign in'}
                onPress={finishRecoveryCodes}
                busy={busy === 'finish'}
                disabled={!recoveryAcknowledged}
              />
            </View>
          </>
        )}

        {error ? (
          <View accessibilityLiveRegion="polite" accessibilityRole="alert" style={{ marginTop: space.s2 }}>
            <ErrorText>{error}</ErrorText>
          </View>
        ) : null}
      </Card>
    </ScrollView>
  );
}
