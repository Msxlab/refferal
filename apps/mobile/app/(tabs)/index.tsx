import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import { clearSession } from '@/lib/auth';
import { Button, Card, EmptyState, ErrorText, MutedText, Title } from '@/components/ui';
import { NextActions } from '@/components/NextActions';
import { money } from '@/lib/format';
import { t } from '@/lib/i18n';
import { recommendationItems, type RecommendationItem } from '@/lib/recommendations';
import { space, text, useTheme } from '@/theme';

interface LevelRow {
  level: number;
  pendingCents: string;
  payableCents: string;
  processingCents: string;
  paidCents: string;
}
interface Dashboard {
  month: string;
  currency: string;
  totals: { pendingCents: string; payableCents: string; processingCents: string; paidCents: string };
  levels: LevelRow[];
}

function Chip({ color, label, value }: { color: string; label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexGrow: 1, flexBasis: '45%', minWidth: 0, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: space.s3, backgroundColor: colors.panel2 }}>
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
  const { colors } = useTheme();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [recommendations, setRecommendations] = useState<RecommendationItem[]>([]);

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

  const loadRecommendations = useCallback(async () => {
    try {
      setRecommendations(recommendationItems(await api.get<unknown>('/app/recommendations')));
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 401) {
        await clearSession();
        router.replace('/login');
        return;
      }
      setRecommendations([]);
    }
  }, [router]);

  useEffect(() => {
    void load();
    void loadRecommendations();
  }, [load, loadRecommendations]);

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([load(), loadRecommendations()]);
    setRefreshing(false);
  }

  async function logout() {
    await clearSession();
    router.replace('/login');
  }

  const totalCents = data
    ? sumCents([data.totals.pendingCents, data.totals.payableCents, data.totals.processingCents, data.totals.paidCents])
    : '0';

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg0 }}
      contentContainerStyle={{ padding: space.s4, paddingTop: space.s8, paddingBottom: space.s8 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Title eyebrow={data ? `${t('tab.home')} - ${data.month}` : t('tab.home')} title={t('home.title')} />
        <Button title={t('common.logout')} onPress={logout} variant="ghost" style={{ paddingVertical: 9 }} />
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
          <NextActions items={recommendations} />

          <Card glow>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.s3 }}>
              <MutedText size={text.sm}>{t('home.month')}</MutedText>
              <Text style={{ color: colors.muted, fontSize: text.xs, fontWeight: '700' }}>{data.currency}</Text>
            </View>
            <Text style={{ color: colors.money, fontSize: text.xxl, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
              {money(totalCents, data.currency)}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s3, marginTop: space.s4 }}>
              <Chip color={colors.amber} label={t('home.pending')} value={money(data.totals.pendingCents, data.currency)} />
              <Chip color={colors.sky} label={t('home.payable')} value={money(data.totals.payableCents, data.currency)} />
              <Chip color={colors.amber} label="Processing" value={money(data.totals.processingCents, data.currency)} />
              <Chip color={colors.emerald} label={t('home.paid')} value={money(data.totals.paidCents, data.currency)} />
            </View>
          </Card>

          <Card>
            <Text style={{ color: colors.text, fontWeight: '700', marginBottom: space.s3 }}>{t('home.levels')}</Text>
            {data.levels.length > 0 ? (
              <LevelBreakdown levels={data.levels} currency={data.currency} />
            ) : (
              <EmptyState title="No level activity yet" detail="Approved sales from your network will appear by level." />
            )}
          </Card>

          <MutedText size={text.xs}>{t('me.incomeNote')}</MutedText>
        </>
      )}
    </ScrollView>
  );
}

function LevelBreakdown({ levels, currency }: { levels: LevelRow[]; currency: string }) {
  const { colors } = useTheme();
  const rows = levels.map((level) => ({
    label: `${t('home.level')} ${level.level}`,
    totalCents: sumCents([level.pendingCents, level.payableCents, level.processingCents, level.paidCents]),
  }));
  const max = rows.reduce((largest, row) => (cents(row.totalCents) > largest ? cents(row.totalCents) : largest), 0n);

  return (
    <View style={{ gap: space.s3 }}>
      {rows.map((row) => (
        <View key={row.label}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.s3, marginBottom: 5 }}>
            <MutedText size={text.sm}>{row.label}</MutedText>
            <Text style={{ color: colors.text, fontSize: text.md, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
              {money(row.totalCents, currency)}
            </Text>
          </View>
          <View style={{ height: 9, borderRadius: 6, backgroundColor: colors.panel3, overflow: 'hidden' }}>
            <View style={{ height: '100%', width: percentOf(row.totalCents, max), borderRadius: 6, backgroundColor: colors.primary }} />
          </View>
        </View>
      ))}
    </View>
  );
}

function sumCents(values: readonly string[]): string {
  return values.reduce((total, value) => total + cents(value), 0n).toString();
}

function cents(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function percentOf(value: string, maximum: bigint): `${number}%` {
  if (maximum <= 0n || cents(value) <= 0n) return '0%';
  const hundredths = (cents(value) * 10_000n) / maximum;
  return `${hundredths / 100n}.${(hundredths % 100n).toString().padStart(2, '0')}%` as `${number}%`;
}
