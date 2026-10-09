import { useState } from 'react';

import { ReviewDeleteSheet } from '@/components/ui/review-sheets';
import { confirmedCopy } from '@/config/confirmed-copy';
import { draftCopy } from '@/config/draft-copy';
import { showToast } from '@/features/toast/toast-store';
import type { MockReview } from '@/mocks/history/types';
import { reviewService } from '@/services';
import { createLocalId } from '@/utils/id';

import { afterReviewChanged } from './review-actions';
import { isPastRewriteWindow } from './review-model';
import { useReviewStore } from './review-store';

/**
 * 리뷰 삭제 흐름 (REV-006). 가게/메뉴 리뷰 목록과 내가 쓴 리뷰 화면이 같이 쓴다.
 *
 * 시트를 열기 전에 작성 자격을 서버에서 다시 확인한다. 화면에 있는 사이 30일 경계를 지났을 수 있어서,
 * 앱 시계로 "다시 쓸 수 있다"고 안내하지 않고 서버 시각으로 경고 여부를 정한다.
 * 삭제 요청이 실패하면 성공으로 보이게 하지 않고 시트를 그대로 둔다.
 */
export function useReviewDelete(onDeleted?: (reviewId: string) => void) {
  const [target, setTarget] = useState<MockReview | null>(null);
  const [pastWindow, setPastWindow] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const request = async (review: MockReview) => {
    let past = true; // 확인하지 못하면 경고를 보여주는 쪽이 안전하다
    try {
      past = isPastRewriteWindow(await reviewService.getReviewEligibility(review.orderId));
    } catch {
      // 위 기본값을 쓴다
    }
    setPastWindow(past);
    setDeleting(false);
    setTarget(review);
  };

  const confirm = async () => {
    if (!target || deleting) return;
    setDeleting(true);
    try {
      const result = await reviewService.deleteReview({ reviewId: target.reviewId, operationId: createLocalId(), expectedRevision: target.revision });
      useReviewStore.getState().markDeleted(target.reviewId, result.deletedAt);
      afterReviewChanged();
      onDeleted?.(target.reviewId);
      setTarget(null);
      showToast({ message: confirmedCopy.reviewDeleted });
    } catch {
      // 실패를 성공으로 단정하지 않는다. 시트는 그대로 두고 다시 시도할 수 있게 한다
      showToast({ message: draftCopy.review.deleteFailed, tone: 'error' });
    } finally {
      setDeleting(false);
    }
  };

  const sheet = <ReviewDeleteSheet visible={!!target} pastWindow={pastWindow} deleting={deleting} onCancel={() => setTarget(null)} onConfirm={() => void confirm()} />;
  return { request, sheet };
}
