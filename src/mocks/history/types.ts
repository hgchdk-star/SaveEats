import type { Uuid, Won } from '@/contracts/common';
import type { MockOrder, MockOrderStatus } from '@/mocks/order/types';

/**
 * 묶음 3(내역·리뷰)의 임시 타입.
 *
 * 이 영역은 서버 계약이 아직 없다. 아래 타입은 Mock과 화면을 이어 주기 위한 임시 모양이며 합의된 계약이 아니다.
 * 필드를 늘리거나 굳히지 말고, 계약이 나오면 `src/contracts/`의 타입으로 바꾼다.
 * 근거: 개발 명세 HIST-002~008, REV-001~009, IMG-001~002, DB-007~009.
 * 금액·상태·작성 가능 여부의 최종 판단은 서버가 한다. 화면은 서버가 알려준 값을 보여준다.
 */

/* ---------- 내역 ---------- */

/** 확인하지 않은 주문 상태 업데이트 한 건 (DB-007) */
export type MockStatusUpdate = { eventId: string; revision: number; createdAt: string };

export type ReviewEligibilityKind = 'CAN_WRITE' | 'HAS_ACTIVE_REVIEW' | 'DEADLINE_EXCEEDED' | 'NOT_COMPLETED';

/** 리뷰 작성 자격 (REV-002). 최종 판정은 서버. 값 이름은 기술안 */
export type MockReviewEligibility = {
  serverNow: string;
  completedAt: string | null;
  reviewDeadline: string | null;
  activeReviewId: string | null;
  eligibility: ReviewEligibilityKind;
};

/** 내역 한 줄 = 주문 + 읽지 않은 업데이트 + 리뷰 자격 + 지금도 볼 수 있는 메뉴 (HIST-002) */
export type MockHistoryRow = MockOrder & {
  unreadUpdates: MockStatusUpdate[];
  reviewEligibility: MockReviewEligibility;
  validCurrentMenuRefs: Uuid[];
};

export type HistoryPage = { rows: MockHistoryRow[]; nextCursor: string | null; hasMore: boolean };

/** 내역 탭 점의 기준: 모든 본인 주문의 읽지 않은 이벤트. revision 1은 처음 만든 PENDING 이벤트(NULL→PENDING)다 */
export type MockUnreadSummary = {
  unreadEvents: { eventId: string; orderId: string; revision: number }[];
  unreadOrderCount: number;
  asOf: string;
};

/** 이번 달 요약 (DB-009). 주문 완료(USER_CONFIRMED)만, 완료 시각의 KST 월 기준 */
export type MockMonthlySummary = {
  monthKey: string;
  orderCount: number;
  deliveredAmount: Won;
  topCategoryName: string | null;
  largestOrderAmount: Won;
};

/** 내역 조회 실패는 첫 페이지면 전체 오류, 다음 페이지면 기존 목록 유지 + 다시 시도 */
export type HistoryFailureCode = 'NETWORK_UNAVAILABLE' | 'RESOURCE_NOT_FOUND' | 'INVALID_INPUT';

export interface HistoryService {
  listMyOrders(input: { cursor: string | null; pageSize: number }): Promise<HistoryPage>;
  getMyOrder(orderId: string): Promise<MockHistoryRow>;
  getHistoryUnreadSummary(): Promise<MockUnreadSummary>;
  /** 읽은 이벤트만 정확히 보낸다. 주문 전체나 탭 전체를 읽음 처리하지 않는다 (HIST-007) */
  markStatusUpdatesViewed(eventIds: string[]): Promise<{ acknowledgedEventIds: string[] }>;
  getMonthlySummary(monthKey: string): Promise<MockMonthlySummary>;
}

/* ---------- 리뷰 ---------- */

export type ReviewSort = 'LATEST' | 'HELPFUL' | 'RATING_DESC' | 'RATING_ASC';

export type ReviewScope = { type: 'store' | 'menu'; id: Uuid };

/** 공개 리뷰 (REV-008). 이름은 마스킹된 표시명만, 계좌·내부 ID는 없다 */
export type MockReview = {
  reviewId: string;
  orderId: string;
  storeId: Uuid;
  menuIds: Uuid[];
  maskedAuthorName: string;
  /** 로그인한 사용자 본인의 리뷰인지. Guest에게는 항상 false */
  isMine: boolean;
  /** 땡김도 1~5 (맛 평가가 아니다) */
  rating: number;
  body: string;
  revision: number;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  images: { imageId: string; imageRef: string }[];
  helpfulCount: number;
  /** 내가 도움돼요를 눌렀는지. Guest에게는 항상 false */
  myHelpful: boolean;
  orderAmount: Won;
  menuNamesSnapshot: string[];
  storeNameSnapshot: string;
};

export type ReviewSummary = { average: number | null; count: number };

export type ReviewPage = { reviews: MockReview[]; nextCursor: string | null; hasMore: boolean };

export type PublicReviewPage = ReviewPage & { summary: ReviewSummary };

export type ImageAction = 'KEEP' | 'REMOVE' | 'REPLACE';

/** 리뷰 관련 실패 (REV-009). 요청이 time out이면 성공 여부를 모르므로 같은 operationId로 다시 시도한다 */
export type ReviewFailureCode =
  | 'AUTH_REQUIRED'
  | 'RESOURCE_NOT_FOUND'
  | 'REVIEW_DEADLINE_EXCEEDED'
  | 'REVIEW_REVISION_CONFLICT'
  | 'INVALID_REVIEW_INPUT'
  | 'ACTIVE_REVIEW_EXISTS'
  | 'SELF_HELPFUL_NOT_ALLOWED'
  | 'UPLOAD_FAILED'
  | 'INVALID_IMAGE'
  | 'NETWORK_UNAVAILABLE'
  | 'REQUEST_TIMEOUT';

export interface ReviewService {
  getReviewEligibility(orderId: string): Promise<MockReviewEligibility>;
  listPublicReviews(input: { scope: ReviewScope; sort: ReviewSort; photoOnly: boolean; cursor: string | null; pageSize: number }): Promise<PublicReviewPage>;
  listMyReviews(input: { cursor: string | null; pageSize: number }): Promise<ReviewPage>;
  /** 준비 → 업로드 → 서버 검증(READY)까지. 글과 땡김도는 여기에 포함되지 않는다 (IMG-002) */
  uploadReviewImage(input: { target: { orderId: string } | { reviewId: string }; localUri: string; operationId: string }): Promise<{ uploadId: string; imageRef: string }>;
  createReview(input: { orderId: string; operationId: string; rating: number; body: string; uploadId?: string }): Promise<MockReview>;
  updateReview(input: {
    reviewId: string;
    operationId: string;
    expectedRevision: number;
    rating: number;
    body: string;
    imageAction: ImageAction;
    uploadId?: string;
  }): Promise<MockReview>;
  deleteReview(input: { reviewId: string; operationId: string; expectedRevision: number }): Promise<{ reviewId: string; deletedAt: string }>;
  setHelpful(input: { reviewId: string; operationId: string; desired: boolean }): Promise<{ reviewId: string; helpful: boolean; helpfulCount: number }>;
}

export type { MockOrderStatus };
