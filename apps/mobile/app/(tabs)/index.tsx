import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import { clearSession } from '@/lib/auth';
import { Bars, Button, Card, ErrorText, MoneyCounter, MutedText, Title } from '@/components/ui';
import { money } from '@/lib/format';
import { t } from '@/lib/i18n';
import { colors, space, text } from '@/theme';

interface LevelRow {
  level: number;
  pendingCents: string;
  payableCents: string;
  paidCents: string;
}
interface Dashboard {
  month: string;
  currency: string;
  totals: { pendingCents: string; payableCents: string; paidCents: string };
  levels: LevelRow[];
}

function Chip({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: color }} />
        <MutedText size={text.xs}>{label}</MutedText>
      </View>
      <Text style={{ color: colors.text, fontWeight: '700', marginTop: 3, fontVariant: ['tabular-nums'] }}>{value}</Text>
    </View>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError('');
      setData(await api.get<Dashboard>('/app/dashboard'));
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 401) {
        await clearSession();
        router.replace('/login');
        return;
      }
      setError(String(err.message));
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function logout() {
    await clearSession();
    router.replace('/login');
  }

  const total = data
    ? Number(data.totals.pendingCents) + Number(data.totals.payableCents) + Number(data.totals.paidCents)
    : 0;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg0 }}
      contentContainerStyle={{ padding: space.s4, paddingTop: space.s8 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Title eyebrow={data ? `${t('tab.home')} · ${data.month}` : t('tab.home')} title={t('home.title')} />
        <Button title={t('common.logout')} onPress={logout} variant="ghost" style={{ minHeight: 36, paddingVertical: 7 }} />
      </View>

      {error ? (
        <Card>
          <ErrorText>{error}</ErrorText>
          <Button title={t('common.retry')} onPress={load} variant="ghost" />
        </Card>
      ) : !data ? (
        <Card>
          <MutedText>{t('common.loading')}</MutedText>
        </Card>
      ) : (
        <>
          <Card glow>
            <MutedText size={text.sm}>{t('home.month')}</MutedText>
            <MoneyCounter cents={total} currency={data.currency} />
            <View style={{ flexDirection: 'row', gap: space.s3, marginTop: space.s4 }}>
              <Chip color={colors.amber} label={t('home.pending')} value={money(data.totals.pendingCents, data.currency)} />
              <Chip color={colors.sky} label={t('home.payable')} value={money(data.totals.payableCents, data.currency)} />
              <Chip color={colors.emerald} label={t('home.paid')} value={money(data.totals.paidCents, data.currency)} />
            </View>
          </Card>

          <Card>
            <Text style={{ color: colors.text, fontWeight: '700', marginBottom: space.s3 }}>{t('home.levels')}</Text>
            {data.levels.length > 0 ? (
              <Bars
                data={data.levels.map((l) => ({
                  label: `${t('home.level')} ${l.level}`,
                  value: Number(l.pendingCents) + Number(l.payableCents) + Number(l.paidCents),
                }))}
                format={(v) => money(v, data.currency)}
              />
            ) : (
              <MutedText>{t('me.noData')}</MutedText>
            )}
          </Card>

          <MutedText size={text.xs}>{t('me.incomeNote')}</MutedText>
        </>
      )}
    </ScrollView>
  );
}
