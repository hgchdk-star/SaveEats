import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { TextButton } from '@/components/ui/button';
import { CravingRating } from '@/components/ui/craving-rating';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/feedback-states';
import { draftCopy } from '@/config/draft-copy';
import { goReviews } from '@/features/order/flow-routes';
import type { ReviewSummary } from '@/mocks/history/types';
import { reviewService } from '@/services';
import { colors, font, spacing, tabularNums, text } from '@/theme';
import { formatCount } from '@/utils/format';

import { useReviewStore } from './review-store';

type Line = { key: string; status: 'ok'; summary: ReviewSummary } | { key: string; status: 'error' };

/**
 * 메뉴 상세의 SaveEats 리뷰 줄 (땡김도 평균 · 리뷰 수 → 메뉴 리뷰 목록).
 * 불러오는 중에는 자리만, 실패하면 "리뷰 0개"가 아니라 실패와 다시 시도를 보여준다.
 * 리뷰가 0개(평균 null)이면 점수와 별을 만들지 않고 줄을 숨긴다 (FR-REV-025).
 */
export function MenuReviewLine({ menuId }: { menuId: string }) {
  const mutationVersion = useReviewStore((s) => s.mutationVersion);
  const [retry, setRetry] = useState(0);
  const [line, setLine] = useState<Line | null>(null);
  const key = `${menuId}:${mutationVersion}:${retry}`;

  useEffect(() => {
    let cancelled = false;
    // 요약만 필요해서 1건만 받는다
    reviewService.listPublicReviews({ scope: { type: 'menu', id: menuId }, sort: 'LATEST', photoOnly: false, cursor: null, pageSize: 1 }).then(
      (page) => {
        if (!cancelled) setLine({ key, status: 'ok', summary: page.summary });
      },
      () => {
        if (!cancelled) setLine({ key, status: 'error' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, menuId]);

  const current = line && line.key === key ? line : null;

  if (!current) {
    return (
      <View accessibilityLabel="불러오는 중" style={styles.row}>
        <Skeleton width={160} height={20} />
      </View>
    );
  }
  if (current.status === 'error') {
    return (
      <View style={styles.row}>
        <Text style={styles.error}>{draftCopy.review.menuLineLoadFailed}</Text>
        <TextButton size="sm" onPress={() => setRetry((n) => n + 1)}>
          {draftCopy.review.menuLineRetry}
        </TextButton>
      </View>
    );
  }
  const { average, count } = current.summary;
  if (count === 0 || average === null) return null;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`SaveEats 리뷰 ${formatCount(count)}개 보기`} onPress={() => goReviews({ type: 'menu', id: menuId })} style={styles.row}>
      <Text style={styles.label}>땡김도</Text>
      <Text style={styles.average}>{average.toFixed(1)}</Text>
      <CravingRating value={average} />
      <Text style={styles.count}>· SaveEats 리뷰 {formatCount(count)}</Text>
      <Icon name="chevronRight" size={16} color={colors.inkTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    minHeight: 32,
    marginTop: spacing[2],
  },
  label: { ...text.label, color: colors.ink },
  average: { ...font('700'), ...tabularNums, fontSize: 15, lineHeight: 22, color: colors.ink },
  count: { ...text.body2, color: colors.inkSecondary },
  error: { ...text.body2, color: colors.inkSecondary },
});
