import type { MockOrder, MockOrderStatus } from '@/mocks/order/types';

import type { ReviewRecord, ServerDb, ServerEvent } from './db';
import { buildSnapshot, type SnapshotLine } from './snapshot';

/**
 * 개발용 가상 주문·리뷰. 가게·메뉴·금액·이름은 모두 가상이다.
 * 시각은 처음 앱을 켠 때를 기준으로 며칠 전/몇 달 전을 계산해서 만든다.
 *
 * 일부러 넣어 둔 경우:
 * - 완료가 필요한 PENDING(읽지 않은 이벤트), 완료됐지만 읽지 않은 주문
 * - 리뷰 상태 Case A(미작성, 30일 안) · B(작성 완료) · C(삭제, 30일 안) · D(삭제, 30일 지남) · E(미작성, 30일 지남)
 * - 지금은 판매하지 않는 메뉴를 주문한 내역(같은 메뉴 보기 숨김), 여러 메뉴 주문, 취소된 주문
 * - 지난달·지지난달 완료 주문(월 이동), 사진 있는 리뷰, 다른 사람의 리뷰, 삭제된 리뷰
 */
const H = 3_600_000;
const D = 24 * H;

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const STORE = { bsm: id(101), rsd: id(102), hgb: id(103), hdp: id(104), dov: id(105), lng: id(106) };
const MENU = { m1: id(201), m2: id(202), m3: id(203), m5: id(205), m9: id(209), r1: id(211), r2: id(212), k1: id(221), p1: id(231), l1: id(251) };
// 메뉴 202 옵션: 부위(필수) 기본 / 순살 +2,000, 소스(선택) 양념 +500
const OPT = { m2Bone: id(20211), m2Boneless: id(20212), m2Sauce: id(20221) };

const iso = (t: number) => new Date(t).toISOString();
const ACCOUNT = { bankName: '토스뱅크', last4: '1234' };

type OrderSpec = {
  key: string;
  storeId: string;
  lines: SnapshotLine[];
  status: MockOrderStatus;
  createdAgo: number;
  /** 주문 후 완료/취소까지 걸린 시간 */
  settledAfter?: number;
  /** 읽지 않은 이벤트가 있는지 */
  unread?: 'initial' | 'settled';
};

export function buildSeed(now: number): ServerDb {
  const orders: MockOrder[] = [];
  const events: ServerEvent[] = [];
  const specs: OrderSpec[] = [
    { key: 's1', storeId: STORE.bsm, lines: [{ menuId: MENU.m2, optionIds: [OPT.m2Boneless, OPT.m2Sauce], quantity: 1 }, { menuId: MENU.m5, optionIds: [], quantity: 2 }], status: 'PENDING', createdAgo: 30 * 60_000, unread: 'initial' },
    { key: 's2', storeId: STORE.rsd, lines: [{ menuId: MENU.r1, optionIds: [], quantity: 1 }], status: 'USER_CONFIRMED', createdAgo: 2 * D, settledAfter: 15 * 60_000, unread: 'settled' },
    { key: 's3', storeId: STORE.bsm, lines: [{ menuId: MENU.m3, optionIds: [], quantity: 1 }], status: 'USER_CONFIRMED', createdAgo: 5 * D, settledAfter: 10 * 60_000 },
    { key: 's6', storeId: STORE.lng, lines: [{ menuId: MENU.l1, optionIds: [], quantity: 1 }], status: 'CANCELLED', createdAgo: 3 * D, settledAfter: 10 * 60_000 },
    { key: 's5', storeId: STORE.bsm, lines: [{ menuId: MENU.m9, optionIds: [], quantity: 1 }], status: 'USER_CONFIRMED', createdAgo: 8 * D, settledAfter: 15 * 60_000 },
    { key: 's10', storeId: STORE.bsm, lines: [{ menuId: MENU.m1, optionIds: [], quantity: 1 }, { menuId: MENU.m5, optionIds: [], quantity: 1 }], status: 'USER_CONFIRMED', createdAgo: 9 * D, settledAfter: 20 * 60_000 },
    { key: 's4', storeId: STORE.hdp, lines: [{ menuId: MENU.p1, optionIds: [], quantity: 1 }], status: 'USER_CONFIRMED', createdAgo: 15 * D, settledAfter: 20 * 60_000 },
    { key: 's9', storeId: STORE.rsd, lines: [{ menuId: MENU.r2, optionIds: [], quantity: 1 }], status: 'USER_CONFIRMED', createdAgo: 20 * D, settledAfter: 5 * 60_000 },
    { key: 's7', storeId: STORE.hgb, lines: [{ menuId: MENU.k1, optionIds: [], quantity: 1 }], status: 'USER_CONFIRMED', createdAgo: 40 * D, settledAfter: 10 * 60_000 },
    { key: 's8', storeId: STORE.dov, lines: [], status: 'USER_CONFIRMED', createdAgo: 50 * D, settledAfter: 10 * 60_000 },
    { key: 's11', storeId: STORE.rsd, lines: [{ menuId: MENU.r1, optionIds: [], quantity: 1 }, { menuId: MENU.r2, optionIds: [], quantity: 1 }], status: 'USER_CONFIRMED', createdAgo: 70 * D, settledAfter: 10 * 60_000 },
    { key: 's12', storeId: STORE.bsm, lines: [{ menuId: MENU.m2, optionIds: [OPT.m2Bone], quantity: 2 }], status: 'USER_CONFIRMED', createdAgo: 100 * D, settledAfter: 10 * 60_000 },
  ];

  for (const spec of specs) {
    const { snapshot, total } = buildSnapshot(spec.storeId, spec.lines, ACCOUNT);
    const createdAt = now - spec.createdAgo;
    const settledAt = createdAt + (spec.settledAfter ?? 0);
    const orderId = `mock-order-seed-${spec.key}`;
    const settled = spec.status !== 'PENDING';
    const order: MockOrder = {
      orderId,
      idempotencyKey: `seed-key-${spec.key}`,
      status: spec.status,
      statusRevision: settled ? 2 : 1,
      createdAt: iso(createdAt),
      completedAt: spec.status === 'USER_CONFIRMED' ? iso(settledAt) : null,
      cancelledAt: spec.status === 'CANCELLED' ? iso(settledAt) : null,
      approvedTotalAmount: total || 6500,
      snapshot,
    };
    orders.push(order);
    events.push({
      eventId: `ev-${orderId}-1`,
      orderId,
      revision: 1,
      fromStatus: null,
      toStatus: 'PENDING',
      createdAt: iso(createdAt),
      viewedAt: spec.unread === 'initial' ? null : iso(createdAt + 60_000),
    });
    if (settled) {
      events.push({
        eventId: `ev-${orderId}-2`,
        orderId,
        revision: 2,
        fromStatus: 'PENDING',
        toStatus: spec.status,
        createdAt: iso(settledAt),
        viewedAt: spec.unread === 'settled' ? null : iso(settledAt + 60_000),
      });
    }
  }

  // 달콤오븐은 판매 중인 메뉴가 없어 금액이 0이 된다. 내역에 보이도록 가상 금액을 넣는다
  const empty = orders.find((o) => o.orderId === 'mock-order-seed-s8');
  if (empty) {
    empty.snapshot.items = [{ menuId: id(301), menuName: '딸기 크림 케이크 조각', menuImageRef: null, unitPrice: 6500, quantity: 1, lineTotal: 6500, options: [] }];
  }

  const reviews = buildReviews(now);

  return { seedVersion: 1, seq: 0, orders, byKey: Object.fromEntries(orders.map((o) => [o.idempotencyKey, o.orderId])), operations: {}, events, reviews, uploads: {} };
}

function reviewFor(orderKey: string, over: Partial<ReviewRecord> & Pick<ReviewRecord, 'reviewId' | 'storeId' | 'menuIds' | 'rating' | 'body' | 'createdAt' | 'authorId' | 'maskedAuthorName' | 'orderAmount' | 'menuNamesSnapshot' | 'storeNameSnapshot'>): ReviewRecord {
  return {
    orderId: orderKey,
    revision: 1,
    editedAt: null,
    deletedAt: null,
    images: [],
    helpfulBase: 0,
    helpfulVoters: [],
    ...over,
  };
}

function buildReviews(now: number): ReviewRecord[] {
  const ME = 'mock-user-1';
  const bsm = '바삭마을 치킨 역삼점';
  return [
    // 다른 사람의 공개 리뷰
    reviewFor('mock-order-other-1', { reviewId: 'mock-review-1', authorId: 'u-a', maskedAuthorName: '김**', storeId: STORE.bsm, menuIds: [MENU.m2, MENU.m5], rating: 5, body: '양념이 너무 달지 않아 보여서 반반으로 골랐어요. 다음에도 이 조합이 땡길 것 같아요.', createdAt: iso(now - 1 * D), images: [{ imageId: 'img-1', imageRef: 'reviews/img-1.jpg' }], helpfulBase: 12, orderAmount: 28500, menuNamesSnapshot: ['양념 반반 치킨', '치즈볼 (5개)'], storeNameSnapshot: bsm }),
    reviewFor('mock-order-other-2', { reviewId: 'mock-review-2', authorId: 'u-b', maskedAuthorName: '이**', storeId: STORE.bsm, menuIds: [MENU.m1], rating: 4, body: '튀김옷이 얇아 보여서 땡겼어요.', createdAt: iso(now - 3 * D), helpfulBase: 3, orderAmount: 18000, menuNamesSnapshot: ['후라이드 치킨'], storeNameSnapshot: bsm }),
    reviewFor('mock-order-other-3', { reviewId: 'mock-review-3', authorId: 'u-c', maskedAuthorName: '박**', storeId: STORE.bsm, menuIds: [MENU.m2], rating: 3, body: '생각보다 평범했지만 양은 넉넉했어요.', createdAt: iso(now - 12 * D), helpfulBase: 1, orderAmount: 19000, menuNamesSnapshot: ['양념 반반 치킨'], storeNameSnapshot: bsm }),
    reviewFor('mock-order-other-4', { reviewId: 'mock-review-4', authorId: 'u-d', maskedAuthorName: '최*', storeId: STORE.rsd, menuIds: [MENU.r1], rating: 5, body: '로제 소스가 진해서 밥까지 비벼 먹고 싶었어요.', createdAt: iso(now - 2 * D), images: [{ imageId: 'img-2', imageRef: 'reviews/img-2.jpg' }], helpfulBase: 7, orderAmount: 15300, menuNamesSnapshot: ['로제 떡볶이 (2인)'], storeNameSnapshot: '빨간솥 떡볶이' }),
    reviewFor('mock-order-other-5', { reviewId: 'mock-review-5', authorId: 'u-e', maskedAuthorName: '정**', storeId: STORE.rsd, menuIds: [MENU.r1, MENU.r2], rating: 4, body: '튀김이랑 같이 시키면 딱이에요.', createdAt: iso(now - 6 * D), helpfulBase: 2, orderAmount: 21300, menuNamesSnapshot: ['로제 떡볶이 (2인)', '모둠 튀김'], storeNameSnapshot: '빨간솥 떡볶이' }),
    reviewFor('mock-order-other-6', { reviewId: 'mock-review-6', authorId: 'u-f', maskedAuthorName: '한*', storeId: STORE.lng, menuIds: [MENU.l1], rating: 4, body: '가마솥 통닭 향이 좋았어요. 구성이 많아서 나눠 먹기 좋아요.', createdAt: iso(now - 20 * D), helpfulBase: 0, orderAmount: 24000, menuNamesSnapshot: ['옛날 가마솥 통닭 한 마리와 매콤 양념 소스, 무 피클 두 개가 함께 나오는 세트'], storeNameSnapshot: '옛날 가마솥 통닭과 매콤 양념 반반 전문 바삭마을 치킨 역삼 본점' }),
    reviewFor('mock-order-other-7', { reviewId: 'mock-review-7', authorId: 'u-g', maskedAuthorName: '오**', storeId: STORE.hdp, menuIds: [MENU.p1], rating: 5, body: '화덕 향이 은은하게 나서 땡겼어요.', createdAt: iso(now - 25 * D), helpfulBase: 4, orderAmount: 19000, menuNamesSnapshot: ['마르게리타 피자'], storeNameSnapshot: '화덕공방 피자' }),
    reviewFor('mock-order-other-8', { reviewId: 'mock-review-8', authorId: 'u-h', maskedAuthorName: '윤*', storeId: STORE.bsm, menuIds: [MENU.m2], rating: 1, body: '삭제된 리뷰입니다. 공개 목록에 나오면 안 돼요.', createdAt: iso(now - 4 * D), deletedAt: iso(now - 3 * D), helpfulBase: 5, orderAmount: 19000, menuNamesSnapshot: ['양념 반반 치킨'], storeNameSnapshot: bsm }),

    // 내 리뷰
    reviewFor('mock-order-seed-s3', { reviewId: 'mock-review-mine-1', authorId: ME, maskedAuthorName: '서*', storeId: STORE.bsm, menuIds: [MENU.m3], rating: 5, body: '간장 소스가 짜지 않고 마늘이 향긋해서 좋았어요.', createdAt: iso(now - 4 * D), helpfulBase: 2, orderAmount: 20000, menuNamesSnapshot: ['간장 마늘 치킨'], storeNameSnapshot: bsm }),
    reviewFor('mock-order-seed-s10', { reviewId: 'mock-review-mine-2', authorId: ME, maskedAuthorName: '서*', storeId: STORE.bsm, menuIds: [MENU.m1, MENU.m5], rating: 4, body: '후라이드는 바삭했고 치즈볼도 쫀득해서 만족했어요.', createdAt: iso(now - 8 * D), editedAt: iso(now - 7 * D), revision: 2, helpfulBase: 1, orderAmount: 22500, menuNamesSnapshot: ['후라이드 치킨', '치즈볼 (5개)'], storeNameSnapshot: bsm }),
    // 내가 삭제한 리뷰: 30일 안(Case C)과 30일 지남(Case D)
    reviewFor('mock-order-seed-s4', { reviewId: 'mock-review-mine-del-1', authorId: ME, maskedAuthorName: '서*', storeId: STORE.hdp, menuIds: [MENU.p1], rating: 3, body: '삭제해서 다시 쓸 수 있는 리뷰예요.', createdAt: iso(now - 14 * D), deletedAt: iso(now - 13 * D), revision: 2, orderAmount: 19000, menuNamesSnapshot: ['마르게리타 피자'], storeNameSnapshot: '화덕공방 피자' }),
    reviewFor('mock-order-seed-s7', { reviewId: 'mock-review-mine-del-2', authorId: ME, maskedAuthorName: '서*', storeId: STORE.hgb, menuIds: [MENU.k1], rating: 4, body: '30일이 지난 뒤 삭제한 리뷰예요.', createdAt: iso(now - 39 * D), deletedAt: iso(now - 35 * D), revision: 2, orderAmount: 9500, menuNamesSnapshot: ['돌솥 비빔밥'], storeNameSnapshot: '한그릇 비빔밥' }),
  ];
}
