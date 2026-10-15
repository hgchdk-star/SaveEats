import { confirmedCopy } from '@/config/confirmed-copy';
import type { MockReview, ReviewSort } from '@/mocks/history/types';

/** 리뷰 정렬 선택지. "별점"이라고 부르지 않는다 (기획서 27) */
export const REVIEW_SORT_OPTIONS = [
  { id: 'LATEST', label: confirmedCopy.reviewSortLatest },
  { id: 'HELPFUL', label: confirmedCopy.reviewSortHelpful },
  { id: 'RATING_DESC', label: confirmedCopy.reviewSortRatingDesc },
  { id: 'RATING_ASC', label: confirmedCopy.reviewSortRatingAsc },
] as const satisfies readonly { id: ReviewSort; label: string }[];

export function sortLabel(sort: ReviewSort): string {
  return REVIEW_SORT_OPTIONS.find((o) => o.id === sort)?.label ?? confirmedCopy.reviewSortLatest;
}

/**
 * 도움돼요 표시: 서버 값 위에 내가 방금 누른 값(낙관적 overlay)을 얹어서 보여준다.
 * 서버가 알려준 개수에 내 선택이 달라진 만큼만 더하거나 뺀다.
 */
export function helpfulView(review: Pick<MockReview, 'helpfulCount' | 'myHelpful'>, overlay: boolean | undefined): { active: boolean; count: number } {
  const mine = overlay ?? review.myHelpful;
  return { active: mine, count: review.helpfulCount + (mine === review.myHelpful ? 0 : mine ? 1 : -1) };
}

/** 리뷰 삭제 확인에서 "30일이 지났어요" 경고를 보여줄지. 서버가 알려준 시각만으로 판단한다. 모르면 경고를 보여주는 쪽이 안전하다 */
export function isPastRewriteWindow(eligibility: { serverNow: string; reviewDeadline: string | null }): boolean {
  if (!eligibility.reviewDeadline) return true;
  return Date.parse(eligibility.serverNow) > Date.parse(eligibility.reviewDeadline);
}
