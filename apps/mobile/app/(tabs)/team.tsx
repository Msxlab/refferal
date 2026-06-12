import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { api, ApiError } from '@/lib/api';
import { Bars, Card, ErrorText, MutedText, Title } from '@/components/ui';
import { t } from '@/lib/i18n';
import { colors, space, text } from '@/theme';

interface TeamLevel {
  level: number;
  memberCount: number;
  activeCount: number;
}
interface Team {
  totalMembers: number;
  totalActive: number;
  levels: TeamLevel[];
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Card style={{ flex: 1, marginBottom: 0 }}>
      <MutedText size={text.sm}>{label}</MutedText>
      <Text style={{ color, fontSize: text.xxl, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{value}</Text>
    </Card>
  );
}

export default function TeamScreen() {
  const [team, setTeam] = useState<Team | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError('');
      setTeam(await api.get<Team>('/app/team'));
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

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg0 }}
      contentContainerStyle={{ padding: space.s4, paddingTop: space.s8 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <Title eyebrow={t('tab.team')} title={t('team.title')} sub={t('team.privacy')} />

      {!team ? (
        <Card>{error ? <ErrorText>{error}</ErrorText> : <MutedText>{t('common.loading')}</MutedText>}</Card>
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: space.s3, marginBottom: space.s4 }}>
            <Stat label={t('team.members')} value={team.totalMembers} color={colors.primary} />
            <Stat label={t('team.active')} value={team.totalActive} color={colors.emerald} />
          </View>

          <Card>
            {team.levels.length > 0 ? (
              <Bars data={team.levels.map((l) => ({ label: `${t('home.level')} ${l.level}`, value: l.memberCount }))} />
            ) : (
              <MutedText>{t('me.noData')}</MutedText>
            )}
          </Card>
        </>
      )}
    </ScrollView>
  );
}
