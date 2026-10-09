import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { CtaBar } from '@/components/ui/cta-bar';
import { ErrorState, Skeleton } from '@/components/ui/feedback-states';
import { KeyValueCard } from '@/components/ui/order-info';
import { ReviewWriteButton } from '@/components/ui/review-write-button';
import { Screen } from '@/components/ui/screen';
import { TopNavigation } from '@/components/ui/top-navigation';
import { draftCopy } from '@/config/draft-copy';
import { goMyReviews, goReviewWrite } from '@/features/order/flow-routes';
import { resumeOrderFromHistory } from '@/features/order/order-actions';
import { useAsync } from '@/hooks/use-async';
import { historyService } from '@/services';
import { colors, spacing, text } from '@/theme';
import { formatDateTime } from '@/utils/date';
import { formatWon } from '@/utils/format';
import { router } from 'expo-router';

import { orderMenuLabel, reviewButtonOf } from './history-model';

const copy = draftCopy.history;

/**
 * 내역 상세. 열 때마다 서버의 최신 상태를 읽는다. 열었다고 읽음 처리하지 않는다(읽음은 목록에서 행이 보일 때만).
 * 주문 당시 이름·금액을 그대로 보여주므로 지금은 사라진 메뉴여도 문제없이 열린다.
 */
export function OrderDetailScreen({ orderId }: { orderId: string }) {
  const state = useAsync(`order:${orderId}`, () => historyService.getMyOrder(orderId));
  const [busy, setBusy] = useState(false);
  const top = <TopNavigation title={copy.detailTitle} onBack={() => router.back()} />;

  if (state.status === 'loading') {
    return (
      <Screen top={top}>
        <View accessibilityLabel="불러오는 중" style={styles.content}>
          <Skeleton height={28} width="50%" />
          <Skeleton height={120} />
          <Skeleton height={80} />
        </View>
      </Screen>
    );
  }
  if (state.status === 'error') {
    return (
      <Screen top={top}>
        <ErrorState title={copy.detailLoadErrorTitle} onRetry={state.reload} />
      </Screen>
    );
  }

  const row = state.data;
  const { snapshot } = row;
  const done = row.status === 'USER_CONFIRMED';
  const cancelled = row.status === 'CANCELLED';
  const review = done ? reviewButtonOf(row.reviewEligibility) : null;

  const rows = [
    { label: '가게', value: snapshot.storeName },
    { label: copy.detailItemsLabel, value: snapshot.items.map((i) => `${i.menuName} × ${i.quantity}`).join('\n') || orderMenuLabel(snapshot) },
    { label: copy.detailAmount, value: formatWon(row.approvedTotalAmount) },
    { label: done ? copy.detailDestinationDone : copy.detailDestinationPending, value: `${snapshot.destination.bankName} •••• ${snapshot.destination.last4}` },
    { label: copy.detailStatus, value: done ? copy.detailStatusDone : cancelled ? copy.detailStatusCancelled : copy.detailStatusPending },
    { label: copy.detailOrderedAt, value: formatDateTime(row.createdAt) },
    ...(row.completedAt ? [{ label: copy.detailDoneAt, value: formatDateTime(row.completedAt) }] : []),
    ...(row.cancelledAt ? [{ label: copy.detailCancelledAt, value: formatDateTime(row.cancelledAt) }] : []),
  ];

  const resume = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await resumeOrderFromHistory(row);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen top={top} bottom={row.status === 'PENDING' ? <CtaBar label={copy.resume} loading={busy} onPress={() => void resume()} /> : undefined}>
      <ScrollView contentContainerStyle={styles.content}>
        <KeyValueCard rows={rows} />

        {done && review ? (
          <View style={styles.review}>
            <Text accessibilityRole="header" style={styles.reviewHeading}>
              {copy.detailReviewHeading}
            </Text>
            <Text style={styles.reviewHelp}>{copy.detailReviewHelp}</Text>
            <ReviewWriteButton
              status={review}
              onPress={() => (review === 'written' && row.reviewEligibility.activeReviewId ? goMyReviews(row.reviewEligibility.activeReviewId) : goReviewWrite(row.orderId))}
            />
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing[5],
    gap: spacing[5],
  },
  review: {
    gap: spacing[2],
    alignItems: 'flex-start',
  },
  reviewHeading: {
    ...text.h2,
    color: colors.ink,
  },
  reviewHelp: {
    ...text.body2,
    color: colors.inkSecondary,
  },
});
