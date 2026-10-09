import { router } from 'expo-router';
import { useCallback, useEffect, useReducer, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';

import { SecondaryButton } from '@/components/ui/button';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback-states';
import { MyReviewCard } from '@/components/ui/review-card';
import { Screen } from '@/components/ui/screen';
import { TopNavigation } from '@/components/ui/top-navigation';
import { confirmedCopy } from '@/config/confirmed-copy';
import { draftCopy } from '@/config/draft-copy';
import { LIMITS } from '@/config/limits';
import { goReviewEdit } from '@/features/order/flow-routes';
import { reviewService } from '@/services';
import { colors, spacing, text } from '@/theme';
import { formatReviewDate } from '@/utils/date';

import { useReviewStore } from './review-store';
import { useReviewDelete } from './use-review-delete';

const copy = draftCopy.review;

type State = {
  key: string;
  load: 'loading' | 'ok' | 'error';
  ids: string[];
  nextCursor: string | null;
  hasMore: boolean;
  more: 'idle' | 'loading' | 'error';
};

type Action =
  | { type: 'first'; key: string; ids: string[]; nextCursor: string | null; hasMore: boolean }
  | { type: 'firstFailed'; key: string }
  | { type: 'moreStart'; key: string }
  | { type: 'moreDone'; key: string; ids: string[]; nextCursor: string | null; hasMore: boolean }
  | { type: 'moreFailed'; key: string }
  | { type: 'restart' }
  | { type: 'remove'; id: string };

function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'first':
      return { key: action.key, load: 'ok', ids: action.ids, nextCursor: action.nextCursor, hasMore: action.hasMore, more: 'idle' };
    case 'firstFailed':
      return { key: action.key, load: 'error', ids: [], nextCursor: null, hasMore: false, more: 'idle' };
    case 'moreStart':
      return state.key === action.key ? { ...state, more: 'loading' } : state;
    case 'moreDone':
      return state.key === action.key
        ? { ...state, ids: [...state.ids, ...action.ids.filter((id) => !state.ids.includes(id))], nextCursor: action.nextCursor, hasMore: action.hasMore, more: 'idle' }
        : state;
    case 'moreFailed':
      return state.key === action.key ? { ...state, more: 'error' } : state;
    case 'restart':
      return { ...state, load: 'loading' };
    case 'remove':
      return { ...state, ids: state.ids.filter((id) => id !== action.id) };
  }
}

/**
 * 마이 › 내가 쓴 리뷰. 작성 최신순, 수정해도 순서는 그대로다.
 * 첫 페이지 실패는 "리뷰가 없어요"와 다른 화면, 다음 페이지 실패는 기존 목록을 두고 같은 cursor로 다시 시도한다.
 * 카드는 review-store의 최신 값으로 그려서 수정·삭제 결과가 바로 보인다.
 */
export function MyReviewsScreen({ focusReviewId }: { focusReviewId?: string }) {
  const byId = useReviewStore((s) => s.byId);
  const mutationVersion = useReviewStore((s) => s.mutationVersion);
  const [state, dispatch] = useReducer(reduce, { key: '', load: 'loading', ids: [], nextCursor: null, hasMore: false, more: 'idle' });
  const deletion = useReviewDelete((id) => dispatch({ type: 'remove', id }));
  const [retry, setRetry] = useState(0);
  const [now] = useState(() => Date.now());
  const key = `${mutationVersion}:${retry}`;

  const loadFirst = useCallback(() => {
    let cancelled = false;
    reviewService.listMyReviews({ cursor: null, pageSize: LIMITS.reviewPageSize }).then(
      (page) => {
        if (cancelled) return;
        useReviewStore.getState().merge(page.reviews);
        dispatch({ type: 'first', key, ids: page.reviews.map((r) => r.reviewId), nextCursor: page.nextCursor, hasMore: page.hasMore });
      },
      () => {
        if (!cancelled) dispatch({ type: 'firstFailed', key });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key]);

  useEffect(() => loadFirst(), [loadFirst]);

  const loadMore = async () => {
    if (state.load !== 'ok' || !state.hasMore || state.more === 'loading') return;
    dispatch({ type: 'moreStart', key: state.key });
    try {
      const page = await reviewService.listMyReviews({ cursor: state.nextCursor, pageSize: LIMITS.reviewPageSize });
      useReviewStore.getState().merge(page.reviews);
      dispatch({ type: 'moreDone', key: state.key, ids: page.reviews.map((r) => r.reviewId), nextCursor: page.nextCursor, hasMore: page.hasMore });
    } catch {
      dispatch({ type: 'moreFailed', key: state.key });
    }
  };

  const top = <TopNavigation title={copy.mineTitle} onBack={() => router.back()} />;

  // 키가 바뀐 직후(수정·삭제 뒤)에는 새 응답이 올 때까지 이전 목록을 그대로 둔다
  if (state.load === 'loading') {
    return (
      <Screen top={top}>
        <View accessibilityLabel={copy.mineLoading} style={styles.skeleton}>
          <Skeleton height={140} radius={16} />
          <Skeleton height={140} radius={16} />
        </View>
      </Screen>
    );
  }
  if (state.load === 'error') {
    return (
      <Screen top={top}>
        <ErrorState title={copy.mineLoadErrorTitle} onRetry={() => {
            dispatch({ type: 'restart' });
            setRetry((n) => n + 1);
          }} />
      </Screen>
    );
  }

  const reviews = state.ids.map((id) => byId[id]).filter((r) => r && !r.deletedAt);

  return (
    <Screen top={top}>
      <FlatList
        data={reviews}
        keyExtractor={(r) => r.reviewId}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={Separator}
        ListEmptyComponent={<EmptyState icon="review" title={confirmedCopy.myReviewsEmpty} />}
        ListFooterComponent={
          state.hasMore ? (
            <View style={styles.footer}>
              {state.more === 'loading' ? (
                <ActivityIndicator color={colors.inkTertiary} />
              ) : (
                <>
                  {state.more === 'error' ? <Text style={styles.footerText}>{copy.loadMoreFailed}</Text> : null}
                  <SecondaryButton size="sm" icon={state.more === 'error' ? 'refresh' : undefined} onPress={() => void loadMore()}>
                    {state.more === 'error' ? copy.loadMoreRetry : copy.loadMore}
                  </SecondaryButton>
                </>
              )}
            </View>
          ) : null
        }
        renderItem={({ item: r }) => (
          <MyReviewCard
            storeName={r.storeNameSnapshot}
            storeImageUri={null}
            rating={r.rating}
            date={formatReviewDate(r.createdAt, now)}
            edited={!!r.editedAt}
            menus={r.menuNamesSnapshot}
            photoUri={null}
            hasPhoto={r.images.length > 0}
            body={r.body}
            amount={r.orderAmount}
            helpfulCount={r.helpfulCount}
            focused={r.reviewId === focusReviewId}
            onStorePress={() => router.push({ pathname: '/store/[storeId]', params: { storeId: r.storeId } })}
            onEdit={() => goReviewEdit(r.reviewId)}
            onDelete={() => void deletion.request(r)}
          />
        )}
      />
      {deletion.sheet}
    </Screen>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  list: { padding: spacing[5] },
  skeleton: { padding: spacing[5], gap: spacing[3] },
  separator: { height: spacing[3] },
  footer: { paddingVertical: spacing[5], alignItems: 'center', gap: spacing[2] },
  footerText: { ...text.body2, color: colors.inkTertiary },
});
