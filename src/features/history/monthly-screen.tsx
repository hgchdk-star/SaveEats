import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { IconButton } from '@/components/ui/icon-button';
import { MonthlySummary } from '@/components/ui/monthly-summary';
import { Screen } from '@/components/ui/screen';
import { TopNavigation } from '@/components/ui/top-navigation';
import { draftCopy } from '@/config/draft-copy';
import type { MockMonthlySummary } from '@/mocks/history/types';
import { historyService } from '@/services';
import { colors, spacing, text } from '@/theme';
import { monthKeyOf, monthLabel, shiftMonth } from '@/utils/date';

const copy = draftCopy.history;

type Result = { month: string; summary: MockMonthlySummary | null };

/**
 * 이번 달 요약. 주문 완료(USER_CONFIRMED)만 완료 시각의 KST 월 기준으로 센다.
 * 이전 달로 옮겨 볼 수 있고, 다음 달은 이번 달까지만 간다. 가장 많이 고른 음식은 카테고리 기준(미결정 묶음3 #9).
 */
export function MonthlyScreen({ initialMonth }: { initialMonth?: string }) {
  const [current] = useState(() => monthKeyOf(Date.now()));
  const [month, setMonth] = useState(initialMonth && /^\d{4}-\d{2}$/.test(initialMonth) && initialMonth <= current ? initialMonth : current);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const key = `${month}#${retry}`;

  useEffect(() => {
    let cancelled = false;
    historyService.getMonthlySummary(month).then(
      (summary) => {
        if (!cancelled) setResult({ month: key, summary });
      },
      () => {
        if (!cancelled) setResult({ month: key, summary: null });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [month, key]);

  const settled = result && result.month === key ? result : null;
  const load = !settled ? 'loading' : settled.summary ? 'ok' : 'error';

  return (
    <Screen top={<TopNavigation title={copy.monthlyTitle} onBack={() => router.back()} />}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.nav}>
          <IconButton icon="back" label={copy.prevMonth} onPress={() => setMonth(shiftMonth(month, -1))} />
          <Text accessibilityLiveRegion="polite" style={styles.month}>
            {monthLabel(month)}
          </Text>
          <IconButton icon="chevronRight" label={copy.nextMonth} disabled={month >= current} onPress={() => setMonth(shiftMonth(month, 1))} />
        </View>
        <MonthlySummary
          variant="full"
          load={load}
          summary={settled?.summary ?? null}
          title={copy.monthlyHeading(Number(month.slice(5)))}
          onRetry={() => setRetry((n) => n + 1)}
        />
        <Text style={styles.help}>{copy.monthlyHelp}</Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing[5],
    gap: spacing[4],
  },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  month: {
    ...text.title,
    color: colors.ink,
  },
  help: {
    ...text.body2,
    color: colors.inkTertiary,
  },
});
