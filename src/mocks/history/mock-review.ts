import { LIMITS } from '@/config/limits';
import { mockStores } from '@/mocks/catalog/data';
import { failOnce, mockDelay, mockScenario } from '@/mocks/scenario';
import { CURRENT_USER_ID, getDb, nextSeq, persistDb, type ReviewRecord, type ServerDb } from '@/mocks/server/db';
import { eligibilityOf } from '@/mocks/server/eligibility';
import { useMockSession } from '@/mocks/session/mock-session';
import { ServiceError } from '@/services/service-error';
import { reviewBodyLength } from '@/utils/review-text';

import type { MockReview, ReviewService, ReviewSort } from './types';

const DAY_MS = 86_400_000;
const MY_NAME = '서*';

const isMember = () => useMockSession.getState().isMember;

/** 서버에 보관된 리뷰를 화면에 내려줄 모양으로 바꾼다. 본인 여부와 도움돼요는 로그인했을 때만 안다 */
function toDto(rec: ReviewRecord): MockReview {
  const member = isMember();
  const { authorId, helpfulBase, helpfulVoters, ...rest } = rec;
  return {
    ...rest,
    isMine: member && authorId === CURRENT_USER_ID,
    myHelpful: member && helpfulVoters.includes(CURRENT_USER_ID),
    helpfulCount: helpfulBase + helpfulVoters.length,
  };
}

const latest = (a: ReviewRecord, b: ReviewRecord) => (a.createdAt === b.createdAt ? (a.reviewId < b.reviewId ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1);
const helpfulOf = (r: ReviewRecord) => r.helpfulBase + r.helpfulVoters.length;

const SORTS: Record<ReviewSort, (a: ReviewRecord, b: ReviewRecord) => number> = {
  LATEST: latest,
  HELPFUL: (a, b) => helpfulOf(b) - helpfulOf(a) || latest(a, b),
  RATING_DESC: (a, b) => b.rating - a.rating || latest(a, b),
  RATING_ASC: (a, b) => a.rating - b.rating || latest(a, b),
};

/** 커서는 이 Mock에서는 단순한 시작 위치다. 실제 서버는 정렬 기준값을 담은 커서를 쓴다 (REV-008) */
function paginate<T>(all: T[], cursor: string | null, pageSize: number) {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) throw new ServiceError('INVALID_INPUT');
  const start = cursor ? Number(cursor) : 0;
  if (!Number.isInteger(start) || start < 0) throw new ServiceError('INVALID_INPUT');
  const items = all.slice(start, start + pageSize);
  const next = start + pageSize;
  return { items, nextCursor: next < all.length ? String(next) : null, hasMore: next < all.length };
}

function request(): Promise<void> {
  return mockDelay().then(() => {
    if (mockScenario.network === 'offline' || mockScenario.network === 'error') throw new ServiceError('NETWORK_UNAVAILABLE');
  });
}

function requireMember() {
  if (!isMember()) throw new ServiceError('AUTH_REQUIRED');
}

function findActive(state: ServerDb, reviewId: string): ReviewRecord {
  const rec = state.reviews.find((r) => r.reviewId === reviewId && !r.deletedAt && r.authorId === CURRENT_USER_ID);
  if (!rec) throw new ServiceError('RESOURCE_NOT_FOUND');
  return rec;
}

/** `myReviews: long`: 여러 페이지를 보기 위한 읽기 전용 가상 리뷰 25개. 저장하지 않고 매번 같은 값으로 만든다 */
function generatedMine(now: number): ReviewRecord[] {
  return Array.from({ length: 25 }, (_, i) => ({
    reviewId: `mock-review-gen-${String(i + 1).padStart(2, '0')}`,
    orderId: `mock-order-gen-r-${i + 1}`,
    storeId: mockStores[i % 3].id,
    menuIds: [],
    maskedAuthorName: MY_NAME,
    authorId: CURRENT_USER_ID,
    rating: (i % 5) + 1,
    body: `페이지 확인용 가상 리뷰 ${i + 1}번이에요.`,
    revision: 1,
    createdAt: new Date(now - (i + 20) * DAY_MS).toISOString(),
    editedAt: null,
    deletedAt: null,
    images: [],
    helpfulBase: i % 4,
    helpfulVoters: [],
    orderAmount: 10000 + i * 100,
    menuNamesSnapshot: ['가상 메뉴'],
    storeNameSnapshot: mockStores[i % 3].name,
  }));
}

export function createMockReviewService(): ReviewService {
  return {
    async getReviewEligibility(orderId) {
      await request();
      const state = await getDb();
      const order = state.orders.find((o) => o.orderId === orderId);
      if (!order) throw new ServiceError('RESOURCE_NOT_FOUND');
      return eligibilityOf(state, order, Date.now());
    },

    async listPublicReviews({ scope, sort, photoOnly, cursor, pageSize }) {
      await request();
      if (mockScenario.reviewList === 'failOnce' && failOnce('reviews:list')) throw new ServiceError('NETWORK_UNAVAILABLE');
      const state = await getDb();
      const empty = mockScenario.reviewList === 'empty';
      const active = empty ? [] : state.reviews.filter((r) => !r.deletedAt && (scope.type === 'store' ? r.storeId === scope.id : r.menuIds.includes(scope.id)));
      const filtered = active.filter((r) => !photoOnly || r.images.length > 0).sort(SORTS[sort]);

      // 평균은 활성 리뷰만으로 계산하고, 리뷰가 0개면 평균을 만들지 않는다 (FR-REV-025)
      // 가게 요약은 가게 카드의 Seed 집계와 같은 값을 쓴다(홈·가게 상세와 숫자가 일치하게). 목록은 예시 일부다.
      const store = scope.type === 'store' ? mockStores.find((s) => s.id === scope.id) : null;
      const seeded = store && !empty ? { average: store.reviewAverage, count: store.reviewCount } : null;
      const summary = seeded ?? {
        count: active.length,
        average: active.length ? Math.round((active.reduce((sum, r) => sum + r.rating, 0) / active.length) * 10) / 10 : null,
      };

      const page = paginate(filtered, cursor, pageSize);
      return { reviews: page.items.map(toDto), nextCursor: page.nextCursor, hasMore: page.hasMore, summary };
    },

    async listMyReviews({ cursor, pageSize }) {
      await request();
      requireMember();
      if (mockScenario.myReviews === 'failOnce' && failOnce('myReviews:first')) throw new ServiceError('NETWORK_UNAVAILABLE');
      if (cursor !== null && mockScenario.myReviews === 'nextPageFailOnce' && failOnce('myReviews:next')) throw new ServiceError('NETWORK_UNAVAILABLE');
      const state = await getDb();
      const long = mockScenario.myReviews === 'long' || mockScenario.myReviews === 'nextPageFailOnce';
      const all = mockScenario.myReviews === 'empty' ? [] : [...state.reviews, ...(long ? generatedMine(Date.now()) : [])];
      // 내가 쓴 리뷰는 작성 최신순. 수정해도 위로 올리지 않는다 (기획서 29)
      const mine = all.filter((r) => !r.deletedAt && r.authorId === CURRENT_USER_ID).sort(latest);
      const page = paginate(mine, cursor, pageSize);
      return { reviews: page.items.map(toDto), nextCursor: page.nextCursor, hasMore: page.hasMore };
    },

    async uploadReviewImage({ localUri }) {
      await mockDelay();
      if (mockScenario.reviewWrite === 'photoUploadFailOnce' && failOnce('review:photo')) throw new ServiceError('UPLOAD_FAILED');
      const state = await getDb();
      const uploadId = `mock-upload-${nextSeq(state)}`;
      // Mock: 실제 서버라면 서버가 검증·재인코딩한 final 경로를 돌려준다. 여기서는 기기 파일 주소를 그대로 쓴다
      state.uploads[uploadId] = { imageRef: localUri, used: false };
      persistDb();
      return { uploadId, imageRef: localUri };
    },

    async createReview({ orderId, operationId, rating, body, uploadId }) {
      await mockDelay();
      requireMember();
      const state = await getDb();
      const done = state.operations[operationId];
      if (done?.startsWith('CREATE:')) {
        const rec = state.reviews.find((r) => r.reviewId === done.slice(7));
        if (rec) return toDto(rec); // 같은 명령 재시도: 처음 적용한 결과 (새 리뷰를 또 만들지 않는다)
      }
      if (mockScenario.reviewWrite === 'saveFailOnce' && failOnce('review:save')) throw new ServiceError('NETWORK_UNAVAILABLE', true);
      if (mockScenario.reviewWrite === 'deadlineExceeded') throw new ServiceError('REVIEW_DEADLINE_EXCEEDED');

      const order = state.orders.find((o) => o.orderId === orderId);
      if (!order) throw new ServiceError('RESOURCE_NOT_FOUND');
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new ServiceError('INVALID_REVIEW_INPUT');
      const len = reviewBodyLength(body);
      if (len < LIMITS.reviewBodyMin || len > LIMITS.reviewBodyMax) throw new ServiceError('INVALID_REVIEW_INPUT');
      const e = eligibilityOf(state, order, Date.now());
      if (e.eligibility === 'HAS_ACTIVE_REVIEW') throw new ServiceError('ACTIVE_REVIEW_EXISTS');
      if (e.eligibility === 'DEADLINE_EXCEEDED') throw new ServiceError('REVIEW_DEADLINE_EXCEEDED');
      if (e.eligibility === 'NOT_COMPLETED') throw new ServiceError('RESOURCE_NOT_FOUND');

      const upload = uploadId ? state.uploads[uploadId] : undefined;
      if (uploadId && (!upload || upload.used)) throw new ServiceError('INVALID_IMAGE');
      if (upload) upload.used = true;

      const rec: ReviewRecord = {
        reviewId: `mock-review-${nextSeq(state)}`,
        orderId,
        storeId: order.snapshot.storeId,
        menuIds: [...new Set(order.snapshot.items.map((i) => i.menuId))],
        maskedAuthorName: MY_NAME,
        authorId: CURRENT_USER_ID,
        rating,
        body,
        revision: 1,
        createdAt: new Date().toISOString(),
        editedAt: null,
        deletedAt: null,
        images: upload && uploadId ? [{ imageId: `img-${uploadId}`, imageRef: upload.imageRef }] : [],
        helpfulBase: 0,
        helpfulVoters: [],
        orderAmount: order.approvedTotalAmount,
        menuNamesSnapshot: [...new Set(order.snapshot.items.map((i) => i.menuName))],
        storeNameSnapshot: order.snapshot.storeName,
      };
      state.reviews.push(rec);
      state.operations[operationId] = `CREATE:${rec.reviewId}`;
      persistDb();
      return toDto(rec);
    },

    async updateReview({ reviewId, operationId, expectedRevision, rating, body, imageAction, uploadId }) {
      await mockDelay();
      requireMember();
      const state = await getDb();
      if (mockScenario.reviewWrite === 'saveFailOnce' && failOnce('review:save')) throw new ServiceError('NETWORK_UNAVAILABLE', true);
      const rec = findActive(state, reviewId);
      if (state.operations[operationId]) return toDto(rec); // 같은 명령 재시도
      // 다른 곳에서 먼저 바뀐 경우: 최신 내용을 다시 확인하게 한다
      if (mockScenario.reviewWrite === 'revisionConflictOnce' && failOnce('review:conflict')) throw new ServiceError('REVIEW_REVISION_CONFLICT');
      if (rec.revision !== expectedRevision) throw new ServiceError('REVIEW_REVISION_CONFLICT');
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new ServiceError('INVALID_REVIEW_INPUT');
      const len = reviewBodyLength(body);
      if (len < LIMITS.reviewBodyMin || len > LIMITS.reviewBodyMax) throw new ServiceError('INVALID_REVIEW_INPUT');

      let images = rec.images;
      if (imageAction === 'REMOVE') images = [];
      if (imageAction === 'REPLACE') {
        const upload = uploadId ? state.uploads[uploadId] : undefined;
        if (!uploadId || !upload || upload.used) throw new ServiceError('INVALID_IMAGE');
        upload.used = true;
        images = [{ imageId: `img-${uploadId}`, imageRef: upload.imageRef }];
      }
      const changed = rating !== rec.rating || body !== rec.body || JSON.stringify(images) !== JSON.stringify(rec.images);
      state.operations[operationId] = `UPDATE:${rec.reviewId}`;
      if (changed) {
        // 실제로 내용이 바뀐 때만 revision·수정 시각을 올린다. 같은 리뷰이므로 받은 도움돼요는 그대로다 (REV-005)
        Object.assign(rec, { rating, body, images, revision: rec.revision + 1, editedAt: new Date().toISOString() });
      }
      persistDb();
      return toDto(rec);
    },

    async deleteReview({ reviewId, operationId, expectedRevision }) {
      await mockDelay();
      requireMember();
      if (mockScenario.reviewDelete === 'failOnce' && failOnce('review:delete')) throw new ServiceError('NETWORK_UNAVAILABLE', true);
      const state = await getDb();
      const already = state.reviews.find((r) => r.reviewId === reviewId && r.deletedAt && r.authorId === CURRENT_USER_ID);
      if (already?.deletedAt) return { reviewId, deletedAt: already.deletedAt }; // 이미 삭제됨: 기존 결과로 끝낸다
      const rec = findActive(state, reviewId);
      if (rec.revision !== expectedRevision) throw new ServiceError('REVIEW_REVISION_CONFLICT');
      // soft delete: 물리 삭제도 복구도 없다. 기한 안이면 이 주문에는 새 리뷰를 쓸 수 있다
      rec.deletedAt = new Date().toISOString();
      rec.revision += 1;
      state.operations[operationId] = `DELETE:${rec.reviewId}`;
      persistDb();
      return { reviewId, deletedAt: rec.deletedAt };
    },

    async setHelpful({ reviewId, desired }) {
      await mockDelay();
      requireMember();
      if (mockScenario.helpful === 'failOnce' && failOnce('review:helpful')) throw new ServiceError('NETWORK_UNAVAILABLE');
      const state = await getDb();
      const rec = state.reviews.find((r) => r.reviewId === reviewId && !r.deletedAt);
      if (!rec) throw new ServiceError('RESOURCE_NOT_FOUND');
      if (rec.authorId === CURRENT_USER_ID) throw new ServiceError('SELF_HELPFUL_NOT_ALLOWED');
      // 목표값 명령: 두 번 보내도 결과가 같다. 토글 반전을 쓰지 않는다 (REV-007)
      const has = rec.helpfulVoters.includes(CURRENT_USER_ID);
      if (desired && !has) rec.helpfulVoters.push(CURRENT_USER_ID);
      if (!desired && has) rec.helpfulVoters = rec.helpfulVoters.filter((u) => u !== CURRENT_USER_ID);
      persistDb();
      return { reviewId, helpful: desired, helpfulCount: helpfulOf(rec) };
    },
  };
}
