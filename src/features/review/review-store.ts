import { create } from 'zustand';

import { draftCopy } from '@/config/draft-copy';
import { goLogin } from '@/features/order/flow-routes';
import { showToast } from '@/features/toast/toast-store';
import type { MockReview } from '@/mocks/history/types';
import { reviewService } from '@/services';
import { getSession } from '@/services/session';
import { createLocalId } from '@/utils/id';

/**
 * 리뷰 화면들이 같이 쓰는 상태.
 * - byId: 지금까지 받은 리뷰. 도움돼요 개수처럼 화면 사이에 같아야 하는 값을 둔다
 * - helpfulOverlay: 내가 방금 누른 도움돼요. 서버 응답이 오기 전에 화면에 먼저 보여준다
 * - mutationVersion: 리뷰를 만들거나 고치거나 지우면 올라간다. 목록 화면이 다시 불러올 때를 안다
 */
type ReviewState = {
  byId: Record<string, MockReview>;
  helpfulOverlay: Record<string, boolean>;
  inflight: Record<string, true>;
  mutationVersion: number;
  merge: (reviews: MockReview[]) => void;
  upsert: (review: MockReview) => void;
  markDeleted: (reviewId: string, deletedAt: string) => void;
  bumpMutation: () => void;
  /** 로그아웃·계정 전환: 내 리뷰 표시와 도움돼요 상태를 지운다 (AUTH-004) */
  reset: () => void;
  toggleHelpful: (review: MockReview, next: boolean) => Promise<void>;
};

export const useReviewStore = create<ReviewState>((set, get) => ({
  byId: {},
  helpfulOverlay: {},
  inflight: {},
  mutationVersion: 0,

  merge: (reviews) => set((s) => ({ byId: { ...s.byId, ...Object.fromEntries(reviews.map((r) => [r.reviewId, r])) } })),
  upsert: (review) => set((s) => ({ byId: { ...s.byId, [review.reviewId]: review } })),
  markDeleted: (reviewId, deletedAt) => set((s) => (s.byId[reviewId] ? { byId: { ...s.byId, [reviewId]: { ...s.byId[reviewId], deletedAt } } } : s)),
  bumpMutation: () => set((s) => ({ mutationVersion: s.mutationVersion + 1 })),
  reset: () => set((s) => ({ byId: {}, helpfulOverlay: {}, inflight: {}, mutationVersion: s.mutationVersion + 1 })),

  /**
   * 도움돼요 (REV-007). 로그인이 필요하고, 리뷰당 한 번이며, 다시 누르면 취소된다. 내 리뷰는 누를 수 없다.
   * 화면을 먼저 바꾸고 서버에 "목표값"을 보낸다. 같은 값을 두 번 보내도 결과가 같다.
   * 실패하면 내가 누르기 전 값으로 되돌리고 알린다. 같은 리뷰에 요청이 진행 중이면 다음 누름은 기다린다.
   */
  toggleHelpful: async (review, next) => {
    if (!getSession().isMember) {
      goLogin({ action: 'HELPFUL', reviewId: review.reviewId });
      return;
    }
    if (review.isMine || get().inflight[review.reviewId]) return;
    set((s) => ({ helpfulOverlay: { ...s.helpfulOverlay, [review.reviewId]: next }, inflight: { ...s.inflight, [review.reviewId]: true } }));
    try {
      const result = await reviewService.setHelpful({ reviewId: review.reviewId, operationId: createLocalId(), desired: next });
      set((s) => {
        const overlay = { ...s.helpfulOverlay };
        delete overlay[review.reviewId];
        const inflight = { ...s.inflight };
        delete inflight[review.reviewId];
        const current = s.byId[review.reviewId] ?? review;
        return { helpfulOverlay: overlay, inflight, byId: { ...s.byId, [review.reviewId]: { ...current, helpfulCount: result.helpfulCount, myHelpful: result.helpful } } };
      });
    } catch {
      set((s) => {
        const overlay = { ...s.helpfulOverlay };
        delete overlay[review.reviewId];
        const inflight = { ...s.inflight };
        delete inflight[review.reviewId];
        return { helpfulOverlay: overlay, inflight };
      });
      showToast({ message: draftCopy.review.helpfulFailed, tone: 'error' });
    }
  },
}));
