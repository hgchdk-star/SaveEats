import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ConfirmSheet } from '@/components/ui/bottom-sheet';
import { TextButton } from '@/components/ui/button';
import { CtaBar } from '@/components/ui/cta-bar';
import { ErrorState, Skeleton } from '@/components/ui/feedback-states';
import { KeyValueCard } from '@/components/ui/order-info';
import { ReviewWriteButton } from '@/components/ui/review-write-button';
import { Screen } from '@/components/ui/screen';
import { TopNavigation } from '@/components/ui/top-navigation';
import { draftCopy } from '@/config/draft-copy';
import { goMyReviews, goReviewWrite } from '@/features/order/flow-routes';
import { resumeOrderFromHistory } from '@/features/order/order-actions';
import { showToast } from '@/features/toast/toast-store';
import { useAsync } from '@/hooks/use-async';
import { historyService } from '@/services';
import { ServiceError, errorCode } from '@/services/service-error';
import { colors, spacing, text } from '@/theme';
import { createLocalId } from '@/utils/id';
import { formatDateTime } from '@/utils/date';
import { formatWon } from '@/utils/format';
import { router } from 'expo-router';

import { isCorrectedOrder, orderMenuLabel, reviewButtonOf } from './history-model';
import { useHistoryStore } from './history-store';

const copy = draftCopy.history;

/**
 * 내역 상세. 열 때마다 서버의 최신 상태를 읽는다. 열었다고 읽음 처리하지 않는다(읽음은 목록에서 행이 보일 때만).
 * 주문 당시 이름·금액을 그대로 보여주므로 지금은 사라진 메뉴여도 문제없이 열린다.
 */
export function OrderDetailScreen({ orderId }: { orderId: string }) {
  const state = useAsync(`order:${orderId}`, () => historyService.getMyOrder(orderId));
  const [busy, setBusy] = useState(false);
  const correctedIds = useHistoryStore((s) => s.correctedIds);
  const [hideSheet, setHideSheet] = useState(false);
  const [correctStep, setCorrectStep] = useState<0 | 1 | 2>(0);
  // 정정 요청 번호. 결과를 모르는 실패의 재시도에는 같은 번호를 쓴다
  const correctOp = useRef<string | null>(null);
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
    { label: done ? copy.detailDestinationDone : copy.detailDestinationPending, value: snapshot.destination ? `${snapshot.destination.bankName} •••• ${snapshot.destination.last4}` : draftCopy.transfer.rawUnavailable },
    { label: copy.detailStatus, value: done ? copy.detailStatusDone : cancelled ? `${copy.detailStatusCancelled}${isCorrectedOrder(row, correctedIds) ? ` · ${copy.correctedTag}` : ''}` : copy.detailStatusPending },
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

  // 취소된 주문만 지울 수 있다. 이미 지워진 주문(RESOURCE_NOT_FOUND)은 지운 것으로 본다. 진행 중 주문은 먼저 취소한 뒤에 지운다
  const hide = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await historyService.hideCancelledOrder(row.orderId);
    } catch (error) {
      if (errorCode(error) !== 'RESOURCE_NOT_FOUND') {
        setBusy(false);
        showToast({ message: errorCode(error) === 'ORDER_NOT_HIDEABLE' ? copy.hideNotHideable : copy.hideFailed, tone: 'error' });
        return;
      }
    }
    useHistoryStore.getState().removeRow(row.orderId);
    void useHistoryStore.getState().refreshUnread();
    setBusy(false);
    showToast({ message: copy.hideDone });
    router.back();
  };

  // 정정: 수령 확인(USER_CONFIRMED)을 되돌려 취소로 만든다. 송금 취소·환불이 아니라 기록의 정정이다
  const correct = async () => {
    if (busy) return;
    setBusy(true);
    correctOp.current ??= createLocalId();
    try {
      const { order } = await historyService.correctOrderCompletion(row.orderId, correctOp.current);
      correctOp.current = null;
      useHistoryStore.getState().markCorrected(row.orderId);
      useHistoryStore.getState().replaceRow({ ...row, ...order });
      void useHistoryStore.getState().loadFirst({ refresh: true });
      void useHistoryStore.getState().loadSummary();
      showToast({ message: copy.correctDone });
      state.reload();
    } catch (error) {
      const code = errorCode(error);
      const unknown = error instanceof ServiceError && error.outcomeUnknown;
      if (!unknown) correctOp.current = null; // 적용되지 않았다고 확실하면 다음에는 새 번호
      if (code === 'INVALID_ORDER_TRANSITION' || code === 'RESOURCE_NOT_FOUND') {
        showToast({ message: copy.correctNotDone, tone: 'error' });
        state.reload();
      } else {
        showToast({ message: code === 'ORDER_HAS_REVIEW' ? copy.correctHasReview : copy.correctFailed, tone: 'error' });
        if (code === 'ORDER_HAS_REVIEW') state.reload();
      }
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
              onPress={() => (review === 'written' && row.reviewEligibility?.activeReviewId ? goMyReviews(row.reviewEligibility.activeReviewId) : goReviewWrite(row.orderId))}
            />
          </View>
        ) : null}

        {done ? (
          <View style={styles.hide}>
            {row.reviewEligibility?.activeReviewId ? (
              <Text style={styles.reviewHelp}>{copy.correctHasReview}</Text>
            ) : (
              <TextButton size="sm" disabled={busy} onPress={() => setCorrectStep(1)}>
                {copy.correctEntry}
              </TextButton>
            )}
          </View>
        ) : null}

        {cancelled ? (
          <View style={styles.hide}>
            <TextButton size="sm" disabled={busy} onPress={() => setHideSheet(true)}>
              {copy.hideEntry}
            </TextButton>
          </View>
        ) : null}
      </ScrollView>
      <ConfirmSheet
        visible={correctStep === 1}
        onClose={() => setCorrectStep(0)}
        title={copy.correctStep1Title}
        descriptions={[copy.correctStep1Desc]}
        secondary={{ label: copy.correctBack, onPress: () => setCorrectStep(0) }}
        primary={{ label: copy.correctNext, onPress: () => setCorrectStep(2) }}
      />
      <ConfirmSheet
        visible={correctStep === 2}
        onClose={() => setCorrectStep(0)}
        title={copy.correctStep2Title}
        descriptions={[copy.correctStep2Desc]}
        secondary={{ label: copy.correctBack, onPress: () => setCorrectStep(0) }}
        primary={{
          label: copy.correctConfirm,
          onPress: () => {
            setCorrectStep(0);
            void correct();
          },
        }}
      />
      <ConfirmSheet
        visible={hideSheet}
        onClose={() => setHideSheet(false)}
        title={copy.hideSheetTitle}
        descriptions={[copy.hideSheetDesc]}
        secondary={{ label: copy.hideSheetBack, onPress: () => setHideSheet(false) }}
        primary={{
          label: copy.hideSheetConfirm,
          onPress: () => {
            setHideSheet(false);
            void hide();
          },
        }}
      />
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
  hide: {
    alignItems: 'center',
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
