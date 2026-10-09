import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, RefreshControl, StyleSheet, Text, View, type ViewToken } from 'react-native';

import { PrimaryButton, SecondaryButton } from '@/components/ui/button';
import { EmptyState, ErrorState } from '@/components/ui/feedback-states';
import { MonthlySummary } from '@/components/ui/monthly-summary';
import { OrderHistoryItem, OrderHistoryItemSkeleton } from '@/components/ui/order-history-item';
import { Screen } from '@/components/ui/screen';
import { TopNavigation } from '@/components/ui/top-navigation';
import { LIMITS } from '@/config/limits';
import { draftCopy } from '@/config/draft-copy';
import { goLogin, goMonthly, goMyReviews, goOrderDetail, goReviewWrite } from '@/features/order/flow-routes';
import { resumeOrderFromHistory, retryQueuedConfirm } from '@/features/order/order-actions';
import type { MockHistoryRow } from '@/mocks/history/types';
import { useSession } from '@/services/session';
import { resolveImageUrl } from '@/services/image';
import { colors, spacing, text } from '@/theme';
import { formatOrderDate } from '@/utils/date';

import { orderMenuLabel, reviewButtonOf, rowStatus, unreadEventIdsOf } from './history-model';
import { useHistoryStore } from './history-store';

const copy = draftCopy.history;

/** 상태 읽음 기준 (HIST-007): 행이 절반 이상 보이는 채로 1초. 값은 config/limits.ts */
const VIEWABILITY = { itemVisiblePercentThreshold: LIMITS.statusReadVisiblePercent, minimumViewTime: LIMITS.statusReadDwellMs } as const;

/**
 * 내역 탭. Guest는 로그인 안내, 회원은 최신순 주문 목록.
 * 화면이 하는 일: 보여주기, 읽음 시점 알리기, 이어가기·리뷰 버튼 연결. 상태·금액·작성 가능 여부는 서버가 알려준 값을 쓴다.
 */
export function HistoryScreen() {
  const { isMember } = useSession();
  const { load, rows, hasMore, pageLoad, summary, summaryLoad, pendingReadIds, queuedConfirmOrderId } = useHistoryStore();
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // 읽음 처리는 화면이 앞에 있고 앱이 켜져 있을 때만 한다. 콜백은 FlatList에 고정해야 해서 ref로 읽는다
  const focusedRef = useRef(false);
  const activeRef = useRef(AppState.currentState === 'active');

  // FlatList는 이 콜백과 설정이 렌더마다 바뀌면 안 되므로 한 번만 만든다
  const [onViewableItemsChanged] = useState(() => ({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (!focusedRef.current || !activeRef.current) return;
    const { pendingReadIds: pending, markRead } = useHistoryStore.getState();
    const ids = viewableItems.flatMap((token) => (token.isViewable && token.item ? unreadEventIdsOf(token.item as MockHistoryRow, pending) : []));
    if (ids.length > 0) markRead(ids); // 보인 행의 이벤트 id만 보낸다
  });

  // 로그인 상태가 바뀌면 처음부터. 로그아웃하면 이전 사용자의 목록을 남기지 않는다
  useEffect(() => {
    const store = useHistoryStore.getState();
    if (!isMember) {
      store.reset();
      return;
    }
    void store.loadFirst();
    void store.loadSummary();
  }, [isMember]);

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      const store = useHistoryStore.getState();
      void store.refreshQueue();
      if (store.load === 'ok') {
        void store.refreshLatest();
        void store.refreshUnread();
      }
      return () => {
        focusedRef.current = false;
      };
    }, []),
  );

  // 앱 전환: 앞으로 올 때 한 번 맞추고, 뒤로 가면 읽음 판단을 멈춘다
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      activeRef.current = next === 'active';
      if (next === 'active' && focusedRef.current) {
        const store = useHistoryStore.getState();
        void store.refreshLatest();
        void store.refreshUnread();
      }
    });
    return () => sub.remove();
  }, []);

  // 화면이 앞에 있는 동안만 주기적으로 상태를 맞춘다 (HIST-008)
  useEffect(() => {
    if (!isMember) return;
    const timer = setInterval(() => {
      if (!focusedRef.current || !activeRef.current) return;
      const store = useHistoryStore.getState();
      void store.refreshLatest();
      void store.refreshUnread();
    }, LIMITS.unreadPollMs);
    return () => clearInterval(timer);
  }, [isMember]);

  const onRefresh = async () => {
    setRefreshing(true);
    const store = useHistoryStore.getState();
    await Promise.all([store.loadFirst({ refresh: true }), store.loadSummary()]);
    setRefreshing(false);
  };

  const resume = async (row: MockHistoryRow) => {
    if (busyId) return;
    setBusyId(row.orderId);
    try {
      await resumeOrderFromHistory(row);
    } finally {
      setBusyId(null);
    }
  };

  const top = <TopNavigation title={copy.title} divider />;

  if (!isMember) {
    return (
      <Screen top={top}>
        <EmptyState icon="receipt" title={copy.guestTitle} description={copy.guestDesc} action={<PrimaryButton onPress={() => goLogin({ action: 'HISTORY' })}>{copy.guestAction}</PrimaryButton>} />
      </Screen>
    );
  }

  if (load === 'idle' || load === 'loading') {
    return (
      <Screen top={top}>
        <View accessibilityLabel={draftCopy.review.loading} style={styles.list}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={i > 0 ? styles.skeletonGap : undefined}>
              <OrderHistoryItemSkeleton />
            </View>
          ))}
        </View>
      </Screen>
    );
  }

  if (load === 'error') {
    // 첫 페이지 실패는 "주문이 없어요"와 다르다
    return (
      <Screen top={top}>
        <ErrorState title={copy.loadErrorTitle} onRetry={() => void useHistoryStore.getState().loadFirst()} />
      </Screen>
    );
  }

  const header = (
    <View style={styles.summary}>
      <MonthlySummary variant="compact" load={summaryLoad} summary={summary} onOpen={() => goMonthly()} onRetry={() => void useHistoryStore.getState().loadSummary()} />
    </View>
  );

  return (
    <Screen top={top}>
      <FlatList
        data={rows}
        keyExtractor={(row) => row.orderId}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={Separator}
        ListHeaderComponent={header}
        ListEmptyComponent={<EmptyState icon="receipt" title={copy.emptyTitle} action={<SecondaryButton onPress={() => router.navigate('/')}>{copy.emptyAction}</SecondaryButton>} />}
        ListFooterComponent={
          rows.length === 0 ? null : (
            <View style={styles.footer}>
              {pageLoad === 'loading' ? (
                <View accessibilityLabel={copy.loadingMore} style={styles.footerRow}>
                  <ActivityIndicator color={colors.inkTertiary} />
                  <Text style={styles.footerText}>{copy.loadingMore}</Text>
                </View>
              ) : pageLoad === 'error' ? (
                // 자동으로 다시 시도하지 않는다. 같은 cursor로 사용자가 다시 요청한다
                <View style={styles.footerRow}>
                  <Text style={styles.footerText}>{copy.pageErrorText}</Text>
                  <SecondaryButton size="sm" icon="refresh" onPress={() => void useHistoryStore.getState().loadMore()}>
                    {copy.pageErrorRetry}
                  </SecondaryButton>
                </View>
              ) : !hasMore ? (
                <Text style={styles.footerText}>{copy.end}</Text>
              ) : null}
            </View>
          )
        }
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          // 오류가 난 뒤에는 자동으로 다시 부르지 않는다
          if (useHistoryStore.getState().pageLoad === 'idle') void useHistoryStore.getState().loadMore();
        }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={VIEWABILITY}
        renderItem={({ item: row }) => {
          const status = rowStatus(row, queuedConfirmOrderId);
          const review = status === 'delivered' ? reviewButtonOf(row.reviewEligibility) : null;
          const sameMenuId = status === 'delivered' ? row.validCurrentMenuRefs[0] : undefined; // 지금 볼 수 없는 메뉴는 링크를 숨긴다
          return (
            <OrderHistoryItem
              date={formatOrderDate(row.createdAt)}
              storeName={row.snapshot.storeName}
              imageUri={resolveImageUrl(row.snapshot.items[0]?.menuImageRef ?? row.snapshot.storeImageRef)}
              menuLabel={orderMenuLabel(row.snapshot)}
              amount={row.approvedTotalAmount}
              status={status}
              unread={unreadEventIdsOf(row, pendingReadIds).length > 0}
              busy={busyId === row.orderId}
              onDetail={() => goOrderDetail(row.orderId)}
              onResume={() => void resume(row)}
              onRetrySave={() => void retryQueuedConfirm(row)}
              reviewStatus={review}
              onReview={() => (review === 'written' && row.reviewEligibility.activeReviewId ? goMyReviews(row.reviewEligibility.activeReviewId) : goReviewWrite(row.orderId))}
              onSameMenu={sameMenuId ? () => router.push({ pathname: '/menu/[menuId]', params: { menuId: sameMenuId } }) : undefined}
            />
          );
        }}
      />
    </Screen>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  list: {
    padding: spacing[5],
  },
  skeletonGap: {
    marginTop: spacing[3],
  },
  summary: {
    marginBottom: spacing[4],
  },
  separator: {
    height: spacing[3],
  },
  footer: {
    paddingVertical: spacing[5],
    alignItems: 'center',
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  footerText: {
    ...text.body2,
    color: colors.inkTertiary,
  },
});
