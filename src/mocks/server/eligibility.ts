import { LIMITS } from '@/config/limits';
import type { MockReviewEligibility } from '@/mocks/history/types';
import type { MockOrder } from '@/mocks/order/types';

import { CURRENT_USER_ID, type ServerDb } from './db';

const HOUR_MS = 3_600_000;

/**
 * 리뷰 작성 자격 (REV-002). 서버가 판정한다.
 * - 완료되지 않았거나 취소된 주문: 작성 불가
 * - 활성 리뷰가 이미 있음: 작성 완료 (기한과 상관없이 수정·삭제는 가능)
 * - 활성 리뷰가 없고 완료 시각 + 30×24시간 안: 작성 가능 (삭제 후 다시 쓰기 포함)
 * - 그 시각을 넘김: 기간이 지남 (삭제 이력이 있어도 같다)
 * 마감 시각 자체는 아직 작성 가능하다. 날짜(자정)로 올림하지 않는다.
 */
export function eligibilityOf(state: ServerDb, order: MockOrder, now: number): MockReviewEligibility {
  const done = order.status === 'USER_CONFIRMED' && !!order.completedAt;
  const deadline = done && order.completedAt ? Date.parse(order.completedAt) + LIMITS.reviewWindowHours * HOUR_MS : null;
  const active = state.reviews.find((r) => r.orderId === order.orderId && !r.deletedAt && r.authorId === CURRENT_USER_ID);

  let eligibility: MockReviewEligibility['eligibility'];
  if (!done || deadline === null) eligibility = 'NOT_COMPLETED';
  else if (active) eligibility = 'HAS_ACTIVE_REVIEW';
  else eligibility = now <= deadline ? 'CAN_WRITE' : 'DEADLINE_EXCEEDED';

  return {
    serverNow: new Date(now).toISOString(),
    completedAt: order.completedAt,
    reviewDeadline: deadline === null ? null : new Date(deadline).toISOString(),
    activeReviewId: active?.reviewId ?? null,
    eligibility,
  };
}
