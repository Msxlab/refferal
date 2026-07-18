import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, MutedText } from '@/components/ui';
import { recommendationCopy, t } from '@/lib/i18n';
import { mobileRecommendationPath, type RecommendationItem } from '@/lib/recommendations';
import { space, text, useTheme } from '@/theme';

export function NextActions({ items }: { items: RecommendationItem[] }) {
  const router = useRouter();
  const { colors } = useTheme();

  if (items.length === 0) return null;

  return (
    <View style={{ marginBottom: space.s4 }} accessibilityLabel={t('recommendation.heading')}>
      <Text accessibilityRole="header" style={{ color: colors.text, fontSize: text.lg, fontWeight: '700', marginBottom: space.s1 }}>
        {t('recommendation.heading')}
      </Text>
      <MutedText size={text.sm}>{t('recommendation.sub')}</MutedText>

      <View style={{ marginTop: space.s3 }}>
        {items.map((item) => {
          const copy = recommendationCopy(item.key);
          const path = mobileRecommendationPath(item.action);
          return (
            <Card key={item.key} style={{ marginBottom: space.s3 }}>
              <Text style={{ color: colors.text, fontSize: text.md, fontWeight: '700' }}>{copy.title}</Text>
              <View style={{ marginTop: space.s1 }}>
                <MutedText size={text.sm}>{copy.body}</MutedText>
              </View>
              {path ? (
                <View style={{ marginTop: space.s3 }}>
                  <Button title={copy.action} onPress={() => router.push(path as never)} variant="ghost" />
                </View>
              ) : null}
            </Card>
          );
        })}
      </View>
    </View>
  );
}
