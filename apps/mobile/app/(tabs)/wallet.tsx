import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { api, ApiError } from '@/lib/api';
import { Badge, Button, Card, ErrorText, MoneyCounter, MutedText, Title } from '@/components/ui';
import { dateShort, money } from '@/lib/format';
import { t } from '@/lib/i18n';
import { colors, space, text } from '@/theme';

interface LedgerItem {
  id: string;
  level: number;
  amountCents: string;
  type: string;
  status: string;
  createdAt: string;
}
interface Wallet {
  balance: { pendingCents: string; payableCents: string; paidCents: string };
  ledger: { total: number; items: LedgerItem[] };
}
interface PayoutReq {
  id: string;
  totalCents: string;
  status: string;
  period: string;
}

export default function WalletScreen() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [history, setHistory] = useState<PayoutReq[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError('');
      const [w, h] = await Promise.all([api.get<Wallet>('/app/wallet'), api.get<PayoutReq[]>('/app/payout-requests')]);
      setWallet(w);
      setHistory(h);
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

  async function requestPayout() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.post('/app/payout-requests');
      setNotice(t('wallet.requested'));
      await load();
    } catch (e) {
      setError(String((e as ApiError).message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg0 }}
      contentContainerStyle={{ padding: space.s4, paddingTop: space.s8 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <Title eyebrow={t('tab.wallet')} title={t('wallet.title')} />

      {!wallet ? (
        <Card>{error ? <ErrorText>{error}</ErrorText> : <MutedText>{t('common.loading')}</MutedText>}</Card>
      ) : (
        <>
          <Card glow>
            <MutedText size={text.sm}>{t('wallet.balance')}</MutedText>
            <MoneyCounter cents={wallet.balance.payableCents} />
            <MutedText size={text.sm}>
              {t('home.pending')}: {money(wallet.balance.pendingCents)} · {t('home.paid')}: {money(wallet.balance.paidCents)}
            </MutedText>
            <View style={{ marginTop: space.s4 }}>
              <Button title={t('wallet.request')} onPress={requestPayout} busy={busy} variant="success" />
            </View>
            {notice ? <Text style={{ color: colors.emerald, marginTop: space.s2 }}>{notice} ✓</Text> : null}
            {error ? <ErrorText>{error}</ErrorText> : null}
          </Card>

          <Card>
            <Text style={{ color: colors.text, fontWeight: '700', marginBottom: space.s3 }}>{t('wallet.ledger')}</Text>
            {wallet.ledger.items.length === 0 ? (
              <MutedText>{t('me.noData')}</MutedText>
            ) : (
              wallet.ledger.items.map((e) => (
                <View
                  key={e.id}
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
                    <Text style={{ color: colors.text, fontSize: text.md }}>
                      L{e.level} · {e.type}
                    </Text>
                    <MutedText size={text.xs}>{dateShort(e.createdAt)}</MutedText>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Text
                      style={{
                        color: Number(e.amountCents) < 0 ? colors.rose : colors.text,
                        fontWeight: '700',
                        fontVariant: ['tabular-nums'],
                      }}
                    >
                      {money(e.amountCents)}
                    </Text>
                    <Badge value={e.status} />
                  </View>
                </View>
              ))
            )}
          </Card>

          <Card>
            <Text style={{ color: colors.text, fontWeight: '700', marginBottom: space.s3 }}>{t('wallet.history')}</Text>
            {history.length === 0 ? (
              <MutedText>{t('me.noData')}</MutedText>
            ) : (
              history.map((p) => (
                <View
                  key={p.id}
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingVertical: 10,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                  }}
                >
                  <Text style={{ color: colors.text }}>{p.period}</Text>
                  <Text style={{ color: colors.text, fontVariant: ['tabular-nums'] }}>{money(p.totalCents)}</Text>
                  <Badge value={p.status} />
                </View>
              ))
            )}
          </Card>
        </>
      )}
    </ScrollView>
  );
}
