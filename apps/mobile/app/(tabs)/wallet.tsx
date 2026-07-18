import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { api, ApiError } from '@/lib/api';
import { Badge, Button, Card, EmptyState, ErrorText, MutedText, Title } from '@/components/ui';
import { dateShort, money } from '@/lib/format';
import { t } from '@/lib/i18n';
import { space, text, useTheme } from '@/theme';

interface LedgerItem {
  id: string;
  level: number;
  amountCents: string;
  type: string;
  status: string;
  createdAt: string;
}
interface Wallet {
  currency: string;
  payoutMinCents: string;
  payoutEligibility: {
    requestable: boolean;
    reason: string;
    message: string;
    activePayout: { id: string; status: 'requested' | 'processing' } | null;
  };
  balance: { pendingCents: string; payableCents: string; processingCents: string; paidCents: string };
  ledger: { total: number; items: LedgerItem[] };
}
interface PayoutReq {
  id: string;
  batchId: string | null;
  totalCents: string;
  currency?: string;
  status: string;
  period: string;
  processingStartedAt?: string | null;
  paidAt?: string | null;
  settledAt?: string | null;
}

export default function WalletScreen() {
  const { colors } = useTheme();
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

  const payoutEligibility = wallet?.payoutEligibility;
  const activePayout = payoutEligibility?.activePayout ?? null;
  const activePayoutDetails = activePayout ? history.find((payout) => payout.id === activePayout.id) ?? null : null;

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
      contentContainerStyle={{ padding: space.s4, paddingTop: space.s8, paddingBottom: space.s8 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <Title eyebrow={t('tab.wallet')} title={t('wallet.title')} />

      {!wallet ? (
        <Card>{error ? <ErrorText>{error}</ErrorText> : <MutedText>{t('common.loading')}</MutedText>}</Card>
      ) : (
        <>
          <Card glow>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.s3 }}>
              <MutedText size={text.sm}>{t('wallet.balance')}</MutedText>
              <Text style={{ color: colors.muted, fontSize: text.xs, fontWeight: '700' }}>{wallet.currency}</Text>
            </View>
            <Text style={{ color: colors.money, fontSize: text.xxl, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
              {money(wallet.balance.payableCents, wallet.currency)}
            </Text>
            <View style={{ gap: space.s2, marginTop: space.s3 }}>
              <BalanceLine label={t('home.pending')} value={money(wallet.balance.pendingCents, wallet.currency)} color={colors.amber} />
              <BalanceLine label="Processing" value={money(wallet.balance.processingCents, wallet.currency)} color={colors.amber} />
              <BalanceLine label={t('home.paid')} value={money(wallet.balance.paidCents, wallet.currency)} color={colors.emerald} />
            </View>
            <View style={{ marginTop: space.s4 }}>
              <Button
                title={activePayout ? (activePayout.status === 'processing' ? 'Payout processing' : 'Payout request open') : t('wallet.request')}
                onPress={requestPayout}
                busy={busy}
                disabled={!payoutEligibility?.requestable}
                variant="success"
              />
            </View>
            {!payoutEligibility ? (
              <View accessibilityLiveRegion="polite" style={{ marginTop: space.s2 }}>
                <MutedText size={text.sm}>Payout availability is unavailable. Refresh and try again.</MutedText>
              </View>
            ) : !payoutEligibility.requestable ? (
              <View accessibilityLiveRegion="polite" style={{ marginTop: space.s2 }}>
                <MutedText size={text.sm}>
                  {payoutEligibilityNotice(payoutEligibility, activePayoutDetails, wallet.currency, wallet.payoutMinCents)}
                </MutedText>
              </View>
            ) : null}
            {notice ? <Text style={{ color: colors.emerald, marginTop: space.s2 }}>{notice}</Text> : null}
            {error ? <ErrorText>{error}</ErrorText> : null}
          </Card>

          <Card>
            <Text style={{ color: colors.text, fontWeight: '700', marginBottom: space.s3 }}>{t('wallet.ledger')}</Text>
            {wallet.ledger.items.length === 0 ? (
              <EmptyState title="No wallet activity yet" detail="Approved commissions will create activity here." />
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
                  <View style={{ flex: 1, minWidth: 0, paddingRight: space.s3 }}>
                    <Text numberOfLines={1} style={{ color: colors.text, fontSize: text.md }}>
                      L{e.level} - {e.type}
                    </Text>
                    <MutedText size={text.xs}>{dateShort(e.createdAt)}</MutedText>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Text
                      style={{
                        color: e.amountCents.startsWith('-') ? colors.rose : colors.text,
                        fontWeight: '700',
                        fontVariant: ['tabular-nums'],
                      }}
                    >
                      {money(e.amountCents, wallet.currency)}
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
              <EmptyState title="No payout requests yet" detail="Request a payout when your payable balance is ready." />
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
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ color: colors.text }}>{p.period}</Text>
                    <MutedText size={text.xs}>Run period</MutedText>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
                      {money(p.totalCents, p.currency ?? wallet.currency)}
                    </Text>
                    <Badge value={p.status} />
                  </View>
                </View>
              ))
            )}
          </Card>
        </>
      )}
    </ScrollView>
  );
}

function BalanceLine({ label, value, color }: { label: string; value: string; color: string }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: space.s3,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 12,
        paddingHorizontal: space.s3,
        paddingVertical: space.s2,
        backgroundColor: colors.panel2,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <View style={{ width: 8, height: 8, borderRadius: 3, backgroundColor: color }} />
        <MutedText size={text.sm}>{label}</MutedText>
      </View>
      <Text style={{ color: colors.text, fontSize: text.sm, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{value}</Text>
    </View>
  );
}

function payoutEligibilityNotice(
  eligibility: Wallet['payoutEligibility'],
  activePayout: PayoutReq | null,
  currency: string,
  payoutMinCents: string,
): string {
  if (eligibility.reason === 'processing' && activePayout) {
    return `${money(activePayout.totalCents, activePayout.currency ?? currency)} is reserved for payout processing. It is not paid until settlement.`;
  }
  if (eligibility.reason === 'requested' && activePayout) {
    return `${money(activePayout.totalCents, activePayout.currency ?? currency)} already has an open payout request.`;
  }
  if (eligibility.reason === 'below_threshold') {
    return `${eligibility.message} Payout requests become available at ${money(payoutMinCents, currency)}.`;
  }
  return eligibility.message || 'Payout requests are unavailable right now. Please refresh and try again.';
}
