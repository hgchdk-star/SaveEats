import type { MockReview, MockReviewEligibility, PublicReviewPage, ReviewPage, ReviewSummary } from '@/mocks/history/types';
import { ServiceError } from '@/services/service-error';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStrOrNull = (v: unknown): v is string | null => v === null || isStr(v);
const bad = () => new ServiceError('INVALID_RESPONSE');

const ELIGIBILITIES: readonly string[] = ['CAN_WRITE', 'HAS_ACTIVE_REVIEW', 'DEADLINE_EXCEEDED', 'NOT_COMPLETED'];

/** get_review_eligibility: { serverNow, completedAt, reviewDeadline, activeReviewId, eligibility } (혜지, 2026-11-04 실서버 확인) */
export function parseReviewEligibilityDto(data: unknown): MockReviewEligibility {
  if (!isObj(data) || !isStr(data.serverNow) || !isStrOrNull(data.completedAt) || !isStrOrNull(data.reviewDeadline) || !isStrOrNull(data.activeReviewId)) throw bad();
  if (!isStr(data.eligibility) || !ELIGIBILITIES.includes(data.eligibility)) throw bad();
  return {
    serverNow: data.serverNow,
    completedAt: data.completedAt,
    reviewDeadline: data.reviewDeadline,
    activeReviewId: data.activeReviewId,
    eligibility: data.eligibility as MockReviewEligibility['eligibility'],
  };
}

/**
 * 리뷰 한 건. 공개 목록에는 orderId · images · deletedAt 키가 없고, 내가 쓴 리뷰와 작성 · 수정 응답에는 본인 orderId가 있다(혜지, 2026-11-04).
 * 사진은 서버가 받지 않으므로 images는 항상 빈 목록이다. 작성자 닉네임이 없으면 null이고 앱이 "SaveEats 이용자"로 보여 준다.
 */
export function parseReviewDto(raw: unknown): MockReview {
  if (!isObj(raw)) throw bad();
  if (!isStr(raw.reviewId) || !isStr(raw.storeId) || !isNum(raw.rating) || !isStr(raw.body) || !isNum(raw.revision) || !isStr(raw.createdAt)) throw bad();
  if (!isStrOrNull(raw.editedAt ?? null) || !isStrOrNull(raw.authorNickname ?? null) || !isNum(raw.helpfulCount) || !isNum(raw.orderAmount)) throw bad();
  if (typeof raw.isMine !== 'boolean' || typeof raw.myHelpful !== 'boolean' || !isStr(raw.storeNameSnapshot)) throw bad();
  if (!Array.isArray(raw.menuIds) || !raw.menuIds.every(isStr) || !Array.isArray(raw.menuNamesSnapshot) || !raw.menuNamesSnapshot.every(isStr)) throw bad();
  return {
    reviewId: raw.reviewId,
    orderId: isStr(raw.orderId) ? raw.orderId : '',
    storeId: raw.storeId,
    menuIds: raw.menuIds as string[],
    authorNickname: (raw.authorNickname as string | null | undefined) ?? null,
    isMine: raw.isMine,
    rating: raw.rating,
    body: raw.body,
    revision: raw.revision,
    createdAt: raw.createdAt,
    editedAt: (raw.editedAt as string | null | undefined) ?? null,
    deletedAt: null,
    images: [],
    helpfulCount: raw.helpfulCount,
    myHelpful: raw.myHelpful,
    orderAmount: raw.orderAmount,
    menuNamesSnapshot: raw.menuNamesSnapshot as string[],
    storeNameSnapshot: raw.storeNameSnapshot,
  };
}

function pageOf(data: unknown): { reviews: MockReview[]; nextCursor: string | null; hasMore: boolean; raw: Record<string, unknown> } {
  if (!isObj(data) || !Array.isArray(data.items) || typeof data.hasMore !== 'boolean' || !isStrOrNull(data.nextCursor)) throw bad();
  return { reviews: data.items.map(parseReviewDto), nextCursor: data.nextCursor, hasMore: data.hasMore, raw: data };
}

/** list_my_reviews: { items, hasMore, nextCursor } */
export function parseReviewPageDto(data: unknown): ReviewPage {
  const { reviews, nextCursor, hasMore } = pageOf(data);
  return { reviews, nextCursor, hasMore };
}

/** list_public_reviews: { items, hasMore, nextCursor, summary: { average, count } }. 리뷰가 없으면 average는 null */
export function parsePublicReviewPageDto(data: unknown): PublicReviewPage {
  const { reviews, nextCursor, hasMore, raw } = pageOf(data);
  const s = raw.summary;
  if (!isObj(s) || !isNum(s.count) || !(s.average === null || isNum(s.average))) throw bad();
  const summary: ReviewSummary = { average: s.average as number | null, count: s.count };
  return { reviews, nextCursor, hasMore, summary };
}

/** delete_review: { reviewId, deletedAt, replayed } */
export function parseDeletedDto(data: unknown): { reviewId: string; deletedAt: string } {
  if (!isObj(data) || !isStr(data.reviewId) || !isStr(data.deletedAt)) throw bad();
  return { reviewId: data.reviewId, deletedAt: data.deletedAt };
}

/**
 * set_helpful 응답. 실서버 모양은 아직 확인하지 못했다(호출하면 서버 오류가 났다). 앱이 쓰는 값만 받는다:
 * reviewId · helpfulCount · 내가 눌렀는지(helpful 또는 myHelpful).
 */
export function parseHelpfulDto(data: unknown): { reviewId: string; helpful: boolean; helpfulCount: number } {
  if (!isObj(data) || !isStr(data.reviewId) || !isNum(data.helpfulCount)) throw bad();
  const helpful = typeof data.helpful === 'boolean' ? data.helpful : typeof data.myHelpful === 'boolean' ? data.myHelpful : null;
  if (helpful === null) throw bad();
  return { reviewId: data.reviewId, helpful, helpfulCount: data.helpfulCount };
}
