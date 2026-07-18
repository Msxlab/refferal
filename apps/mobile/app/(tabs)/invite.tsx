import type { ComponentType } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Share, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { api, ApiError } from '@/lib/api';
import { Badge, Button, Card, ErrorText, MutedText, Title } from '@/components/ui';
import { APP_NAME } from '@/lib/brand';
import { dateShort } from '@/lib/format';
import { t } from '@/lib/i18n';
import { radius, space, text, useTheme } from '@/theme';

interface InviteItem {
  id: string;
  code: string;
  status: string;
  expiresAt: string;
  createdAt: string;
}

/** Invite links open the web sign-up page; the native app handles the same path as a deep link. */
const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL ?? 'http://localhost:3000';
const linkFor = (code: string) => `${WEB_URL}/i/${code}`;
const QRCodeView = QRCode as unknown as ComponentType<{ value: string; size: number }>;

export default function InviteScreen() {
  const { colors } = useTheme();
  const [invites, setInvites] = useState<InviteItem[] | null>(null);
  const [latest, setLatest] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sharingCode, setSharingCode] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError('');
      setInvites(await api.get<InviteItem[]>('/app/invites'));
    } catch (e) {
      setError(String((e as ApiError).message));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function create() {
    setBusy(true);
    setError('');
    try {
      const inv = await api.post<{ code: string }>('/app/invites', {});
      setLatest(inv.code);
      await load();
    } catch (e) {
      setError(String((e as ApiError).message));
    } finally {
      setBusy(false);
    }
  }

  async function share(code: string) {
    setSharingCode(code);
    setError('');
    try {
      await Share.share({ message: `Join my ${APP_NAME} team: ${linkFor(code)}` });
    } catch {
      setError('Could not open sharing. Please try again.');
    } finally {
      setSharingCode(null);
    }
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg0 }}
      contentContainerStyle={{ padding: space.s4, paddingTop: space.s8, paddingBottom: space.s8 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <Title eyebrow={t('tab.invite')} title={t('invite.title')} />

      <Card glow style={{ alignItems: 'center' }}>
        {latest ? (
          <>
            <View style={{ backgroundColor: colors.qrSurface, padding: space.s3, borderRadius: radius.md }}>
              <QRCodeView value={linkFor(latest)} size={170} />
            </View>
            <Text
              selectable
              style={{ color: colors.primary, fontSize: text.sm, marginTop: space.s3, textAlign: 'center' }}
            >
              {linkFor(latest)}
            </Text>
            <View style={{ flexDirection: 'row', gap: space.s3, marginTop: space.s3 }}>
              <Button title={t('invite.share')} onPress={() => share(latest)} busy={sharingCode === latest} />
              <Button title={t('invite.create')} onPress={create} busy={busy} disabled={sharingCode !== null} variant="ghost" />
            </View>
          </>
        ) : (
          <>
            <Text style={{ fontSize: 36, color: colors.primary, marginBottom: space.s2 }}>Invite</Text>
            <Button title={t('invite.create')} onPress={create} busy={busy} />
          </>
        )}
        {error ? (
          <View accessibilityLiveRegion="polite" accessibilityRole="alert">
            <ErrorText>{error}</ErrorText>
          </View>
        ) : null}
      </Card>

      <Card>
        <Text style={{ color: colors.text, fontWeight: '700', marginBottom: space.s3 }}>{t('invite.mine')}</Text>
        {!invites ? (
          <MutedText>{t('common.loading')}</MutedText>
        ) : invites.length === 0 ? (
          <MutedText>{t('invite.empty')}</MutedText>
        ) : (
          invites.map((i) => (
            <View
              key={i.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingVertical: 10,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
              }}
            >
              <View>
                <Text style={{ color: colors.text, fontFamily: 'monospace' }}>{i.code}</Text>
                <MutedText size={text.xs}>{dateShort(i.expiresAt)}</MutedText>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s3 }}>
                <Badge value={i.status} />
                {i.status === 'active' && (
                  <Button
                    title={t('invite.share')}
                    onPress={() => share(i.code)}
                    busy={sharingCode === i.code}
                    disabled={sharingCode !== null && sharingCode !== i.code}
                    variant="ghost"
                    style={{ paddingVertical: 9 }}
                  />
                )}
              </View>
            </View>
          ))
        )}
      </Card>
    </ScrollView>
  );
}
