import { Pressable, StyleSheet, Text, View } from 'react-native';

import { draftCopy } from '@/config/draft-copy';
import type { MockMonthlySummary } from '@/mocks/history/types';
import { colors, font, radius, spacing, tabularNums, text } from '@/theme';
import { formatWon } from '@/utils/format';

import { TextButton } from './button';
import { EmptyState, ErrorState, Skeleton } from './feedback-states';
import { Icon } from './icon';

type Load = 'idle' | 'loading' | 'ok' | 'error';

type MonthlySummaryProps = {
  /** compact: 내역 상단 카드(누르면 이번 달 요약) / full: 이번 달 요약 화면 */
  variant: 'compact' | 'full';
  load: Load;
  summary: MockMonthlySummary | null;
  /** full의 제목 ("10월의 SaveEats") */
  title?: string;
  onOpen?: () => void;
  onRetry: () => void;
};

const copy = draftCopy.history;

/**
 * 월간 요약. 내역 상단 카드와 이번 달 요약 화면이 같은 컴포넌트다 (미결정 묶음3 #5).
 * 사실만 보여준다: 주문 완료 횟수, 내 계좌로 배달된 금액, 가장 많이 고른 음식, 가장 큰 주문.
 * 칭찬·죄책감 문구와 "절약·모으기·저축하기" 같은 말, 그래프를 쓰지 않는다 (PRD 41).
 * 이 요약이 실패해도 주문 내역은 그대로 쓸 수 있도록, 실패는 요약 자리만 바꾼다.
 */
export function MonthlySummary({ variant, load, summary, title, onOpen, onRetry }: MonthlySummaryProps) {
  if (variant === 'compact') {
    if (load === 'error') {
      return (
        <View accessibilityRole="alert" style={[styles.card, styles.compact, styles.compactError]}>
          <View style={styles.errorText}>
            <Icon name="alert" size={16} color={colors.danger} />
            <Text style={styles.errorLabel}>{copy.summaryError}</Text>
          </View>
          <TextButton size="sm" onPress={onRetry}>
            다시 시도
          </TextButton>
        </View>
      );
    }
    if (load !== 'ok' || !summary) {
      return (
        <View accessibilityLabel="불러오는 중" style={[styles.card, styles.compact, styles.compactLoading]}>
          <Skeleton width="45%" height={16} />
          <Skeleton width="70%" height={20} />
        </View>
      );
    }
    return (
      <Pressable accessibilityRole="button" onPress={onOpen} style={({ pressed }) => [styles.card, styles.compact, pressed && styles.pressed]}>
        <View style={styles.compactText}>
          <Text style={styles.kicker}>{`${copy.summaryThisMonth} ${copy.summaryOrders(summary.orderCount)}`}</Text>
          <Text style={styles.line}>{summary.orderCount > 0 ? copy.summaryDelivered(formatWon(summary.deliveredAmount)) : copy.summaryNone}</Text>
        </View>
        <Icon name="chevronRight" size={20} color={colors.inkTertiary} />
      </Pressable>
    );
  }

  if (load === 'error') {
    return (
      <View style={[styles.card, styles.full]}>
        <ErrorState title={copy.monthlyErrorTitle} description={copy.monthlyErrorDesc} onRetry={onRetry} />
      </View>
    );
  }
  if (load !== 'ok' || !summary) {
    return (
      <View accessibilityLabel="불러오는 중" style={[styles.card, styles.full]}>
        <Skeleton width="50%" height={28} />
        <View style={styles.grid}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={styles.skeletonCell} />
          ))}
        </View>
      </View>
    );
  }
  if (summary.orderCount === 0) {
    return (
      <View style={[styles.card, styles.full]}>
        <Text accessibilityRole="header" style={styles.head}>
          {title}
        </Text>
        <EmptyState icon="receipt" title={copy.monthlyEmpty} />
      </View>
    );
  }
  return (
    <View style={[styles.card, styles.full]}>
      <Text accessibilityRole="header" style={styles.head}>
        {title}
      </Text>
      <View style={styles.grid}>
        <Cell label={copy.monthlyOrders} value={copy.summaryOrders(summary.orderCount)} />
        <Cell label={copy.monthlyDelivered} value={formatWon(summary.deliveredAmount)} />
        <Cell label={copy.monthlyTopFood} value={summary.topCategoryName ?? '-'} />
        <Cell label={copy.monthlyLargest} value={formatWon(summary.largestOrderAmount)} />
      </View>
    </View>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.cell}>
      <Text style={styles.cellLabel}>{label}</Text>
      <Text style={styles.cellValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  pressed: {
    backgroundColor: colors.surfaceMuted,
  },
  compact: {
    minHeight: 72,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[3],
  },
  compactLoading: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: 6,
  },
  compactError: {
    minHeight: 56,
  },
  compactText: {
    flex: 1,
    gap: 2,
  },
  kicker: {
    ...text.body2,
    fontSize: 13,
    lineHeight: 18,
    color: colors.inkTertiary,
  },
  line: {
    ...font('700'),
    ...tabularNums,
    fontSize: 16,
    lineHeight: 24,
    color: colors.ink,
  },
  errorText: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  errorLabel: {
    ...text.label,
    color: colors.ink,
    flexShrink: 1,
  },
  full: {
    paddingVertical: spacing[5],
    paddingHorizontal: spacing[4],
    gap: spacing[4],
  },
  head: {
    ...text.h2,
    color: colors.ink,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[3],
  },
  cell: {
    width: '47.5%',
    flexGrow: 1,
    padding: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    gap: 2,
  },
  cellLabel: {
    ...text.caption,
    color: colors.inkTertiary,
  },
  cellValue: {
    ...font('700'),
    ...tabularNums,
    fontSize: 17,
    lineHeight: 24,
    color: colors.ink,
  },
  skeletonCell: {
    width: '47.5%',
    flexGrow: 1,
    height: 64,
    borderRadius: radius.md,
    backgroundColor: colors.foodPlaceholder,
  },
});
