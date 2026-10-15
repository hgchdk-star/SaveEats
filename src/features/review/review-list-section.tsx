import { router } from 'expo-router';
import { useCallback, useEffect, useReducer, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { SecondaryButton } from '@/components/ui/button';
import { EmptyState, ErrorState, Spinner } from '@/components/ui/feedback-states';
import { OptionSheet } from '@/components/ui/option-sheet';
import { ReviewCard } from '@/components/ui/review-card';
import { ReviewActionSheet, ReviewSortSheet } from '@/components/ui/review-sheets';
import { ReviewSummary } from '@/components/ui/review-summary';
import { LIMITS } from '@/config/limits';
import { draftCopy } from '@/config/draft-copy';
import { goReviewEdit } from '@/features/order/flow-routes';
import type { MockReview, ReviewScope, ReviewSort, ReviewSummary as Summary } from '@/mocks/history/types';
import { reviewService } from '@/services';
import { useSession } from '@/services/session';
import { colors, spacing, text } from '@/theme';
import { formatReviewDate } from '@/utils/date';

import { REVIEW_SORT_OPTIONS, helpfulView, sortLabel } from './review-model';
import { useReviewStore } from './review-store';
import { useReviewDelete } from './use-review-delete';

const copy = draftCopy.review;

/**
 * 리뷰 목록 상태. 조회 실패(error)와 리뷰가 하나도 없는 성공 응답(ok, count 0)은 서로 다른 상태다.
 * 실패했을 때는 요약(평균·개수)을 보여주지 않는다. "리뷰 0개"처럼 보이면 안 되기 때문이다.
 */
type ListState = {
  /** 이 상태가 어떤 조건(범위·정렬·필터·로그인·변경 횟수)에서 받은 것인지 */
  key: string;
  status: 'ok' | 'error';
  reviews: MockReview[];
  summary: Summary;
  nextCursor: string | null;
  hasMore: boolean;
  more: 'idle' | 'loading' | 'error';
};

type Action =
  | { type: 'first'; key: string; reviews: MockReview[]; summary: Summary; nextCursor: string | null; hasMore: boolean }
  | { type: 'firstFailed'; key: string }
  | { type: 'moreStart'; key: string }
  | { type: 'moreDone'; key: string; reviews: MockReview[]; nextCursor: string | null; hasMore: boolean }
  | { type: 'moreFailed'; key: string }
  | { type: 'remove'; reviewId: string };

const EMPTY_SUMMARY: Summary = { average: null, count: 0 };

function reduce(state: ListState | null, action: Action): ListState | null {
  switch (action.type) {
    case 'first':
      return { key: action.key, status: 'ok', reviews: action.reviews, summary: action.summary, nextCursor: action.nextCursor, hasMore: action.hasMore, more: 'idle' };
    case 'firstFailed':
      return { key: action.key, status: 'error', reviews: [], summary: EMPTY_SUMMARY, nextCursor: null, hasMore: false, more: 'idle' };
    case 'moreStart':
      return state && state.key === action.key ? { ...state, more: 'loading' } : state;
    case 'moreDone': {
      if (!state || state.key !== action.key) return state;
      const seen = new Set(state.reviews.map((r) => r.reviewId));
      return { ...state, reviews: [...state.reviews, ...action.reviews.filter((r) => !seen.has(r.reviewId))], nextCursor: action.nextCursor, hasMore: action.hasMore, more: 'idle' };
    }
    case 'moreFailed':
      return state && state.key === action.key ? { ...state, more: 'error' } : state;
    case 'remove':
      return state ? { ...state, reviews: state.reviews.filter((r) => r.reviewId !== action.reviewId) } : state;
  }
}

type Props = {
  scope: ReviewScope;
  /** 다른 사람 리뷰의 ⋮ → 신고 시트를 보여줄지 (미결정 묶음3 #4) */
  reportEnabled: boolean;
  /** 조회 실패 안내의 설명 (가게 상세 안에서는 "메뉴는 그대로 볼 수 있어요.") */
  errorDescription?: string;
};

/**
 * SaveEats 리뷰 목록 한 벌. 가게 상세의 리뷰 탭(storeId)과 SaveEats 리뷰 화면(menuId·storeId)이 같이 쓴다.
 * 범위만 다르고 모양은 같다. 정렬 4가지, 사진 리뷰 필터, 도움돼요, 내 리뷰 수정·삭제, 다른 사람 리뷰 신고.
 */
export function ReviewListSection({ scope, reportEnabled, errorDescription }: Props) {
  const { isMember } = useSession();
  const mutationVersion = useReviewStore((s) => s.mutationVersion);
  const overlay = useReviewStore((s) => s.helpfulOverlay);
  const [sort, setSort] = useState<ReviewSort>('LATEST');
  const [photoOnly, setPhotoOnly] = useState(false);
  const [retry, setRetry] = useState(0);
  // 렌더 중에 시계를 읽지 않도록 목록을 받은 시점의 시각을 쓴다
  const [now] = useState(() => Date.now());
  const [state, dispatch] = useReducer(reduce, null);
  const [sortOpen, setSortOpen] = useState(false);
  const [manageTarget, setManageTarget] = useState<MockReview | null>(null);
  const [reportTarget, setReportTarget] = useState<MockReview | null>(null);
  const deletion = useReviewDelete((reviewId) => dispatch({ type: 'remove', reviewId }));

  const key = `${scope.type}:${scope.id}:${sort}:${photoOnly}:${isMember}:${mutationVersion}:${retry}`;

  useEffect(() => {
    let cancelled = false;
    reviewService.listPublicReviews({ scope, sort, photoOnly, cursor: null, pageSize: LIMITS.reviewPageSize }).then(
      (page) => {
        if (cancelled) return;
        useReviewStore.getState().merge(page.reviews);
        dispatch({ type: 'first', key, reviews: page.reviews, summary: page.summary, nextCursor: page.nextCursor, hasMore: page.hasMore });
      },
      () => {
        if (!cancelled) dispatch({ type: 'firstFailed', key });
      },
    );
    return () => {
      cancelled = true;
    };
    // 조건이 바뀔 때만 다시 불러온다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const loadMore = useCallback(async () => {
    if (!state || state.key !== key || !state.hasMore || state.more === 'loading') return;
    dispatch({ type: 'moreStart', key });
    try {
      const page = await reviewService.listPublicReviews({ scope, sort, photoOnly, cursor: state.nextCursor, pageSize: LIMITS.reviewPageSize });
      useReviewStore.getState().merge(page.reviews);
      dispatch({ type: 'moreDone', key, reviews: page.reviews, nextCursor: page.nextCursor, hasMore: page.hasMore });
    } catch {
      // 기존 목록은 그대로 두고 같은 cursor로 다시 시도하게 한다
      dispatch({ type: 'moreFailed', key });
    }
  }, [state, key, scope, sort, photoOnly]);

  // 조건이 바뀌어 아직 새 응답이 없으면 불러오는 중
  const current = state && state.key === key ? state : null;

  if (!current) {
    return (
      <View style={styles.wrap}>
        <Spinner label={copy.loading} />
      </View>
    );
  }
  if (current.status === 'error') {
    return (
      <View style={styles.wrap}>
        <ErrorState title={copy.loadErrorTitle} description={errorDescription} onRetry={() => setRetry((n) => n + 1)} />
      </View>
    );
  }

  const openManage = (review: MockReview) => setManageTarget(review);

  return (
    <View style={styles.wrap}>
      <ReviewSummary
        average={current.summary.average}
        count={current.summary.count}
        photoOnly={photoOnly}
        onTogglePhotoOnly={() => setPhotoOnly((v) => !v)}
        sortLabel={sortLabel(sort)}
        onOpenSort={() => setSortOpen(true)}
      />

      {current.reviews.length === 0 && photoOnly && current.summary.count > 0 ? <EmptyState icon="review" title={copy.noPhotoReviews} /> : null}

      <View>
        {current.reviews.map((review) => {
          const helpful = helpfulView(review, overlay[review.reviewId]);
          const showReport = reportEnabled && !review.isMine;
          return (
            <ReviewCard
              key={review.reviewId}
              author={review.maskedAuthorName}
              isMine={review.isMine}
              rating={review.rating}
              date={formatReviewDate(review.createdAt, now)}
              edited={!!review.editedAt}
              menus={review.menuNamesSnapshot}
              photoUri={null}
              hasPhoto={review.images.length > 0}
              body={review.body}
              amount={review.orderAmount}
              helpful={{ count: helpful.count, active: helpful.active, readOnly: review.isMine, onToggle: (next) => void useReviewStore.getState().toggleHelpful(review, next) }}
              more={review.isMine ? { label: copy.moreOpen, onPress: () => openManage(review) } : showReport ? { label: copy.reportOpen, onPress: () => setReportTarget(review) } : undefined}
            />
          );
        })}
      </View>

      {current.hasMore ? (
        <View style={styles.more}>
          <SecondaryButton block loading={current.more === 'loading'} icon={current.more === 'error' ? 'refresh' : undefined} onPress={() => void loadMore()}>
            {current.more === 'error' ? `${copy.loadMoreFailed} · ${copy.loadMoreRetry}` : copy.loadMore}
          </SecondaryButton>
        </View>
      ) : null}

      <ReviewSortSheet
        visible={sortOpen}
        value={sort}
        options={REVIEW_SORT_OPTIONS}
        onSelect={(id) => {
          setSortOpen(false);
          setSort(id);
        }}
        onClose={() => setSortOpen(false)}
      />

      <ReviewActionSheet
        visible={!!manageTarget}
        onEdit={() => {
          const target = manageTarget;
          setManageTarget(null);
          if (target) goReviewEdit(target.reviewId);
        }}
        onDelete={() => {
          const target = manageTarget;
          setManageTarget(null);
          if (target) void deletion.request(target);
        }}
        onClose={() => setManageTarget(null)}
      />

      {/* 신고(SHOULD): 항목만 고르고, 신고 접수 화면은 아직 없어서 "준비 중" 화면으로 간다 (미결정 묶음3 #4) */}
      <OptionSheet
        visible={!!reportTarget}
        title={copy.reportSheetTitle}
        options={copy.reportReasons.map((reason) => ({
          title: reason,
          onPress: () => {
            setReportTarget(null);
            router.push('/review-report');
          },
        }))}
        onClose={() => setReportTarget(null)}
      />

      {deletion.sheet}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing[5],
    paddingTop: spacing[5],
    paddingBottom: spacing[6],
    gap: spacing[2],
    backgroundColor: colors.bg,
  },
  more: {
    paddingTop: spacing[4],
  },
  note: {
    ...text.body2,
    color: colors.inkSecondary,
  },
});
