import { mockCatalog } from '@/mocks/catalog/mock-catalog-repository';
import { failOnce, mockDelay, mockScenario } from '@/mocks/scenario';
import { getDb, persistDb, type ServerDb } from '@/mocks/server/db';
import { eligibilityOf } from '@/mocks/server/eligibility';
import { buildSnapshot } from '@/mocks/server/snapshot';
import type { MockOrder } from '@/mocks/order/types';
import { ServiceError } from '@/services/service-error';
import { monthKeyOf } from '@/utils/date';

import type { HistoryService, MockHistoryRow, MockMonthlySummary } from './types';

const DAY_MS = 86_400_000;

/** `long` 시나리오: 여러 페이지로 나뉘도록 오래된 완료 주문 40개를 더한다. 저장하지 않고 매번 같은 값으로 만든다 */
function generatedOrders(state: ServerDb): MockOrder[] {
  if (mockScenario.history !== 'long') return [];
  const oldest = Math.min(...state.orders.map((o) => Date.parse(o.createdAt)));
  const stores: [string, string][] = [
    ['00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000201'],
    ['00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000211'],
    ['00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000221'],
  ];
  return Array.from({ length: 40 }, (_, i) => {
    const [storeId, menuId] = stores[i % stores.length];
    const { snapshot, total } = buildSnapshot(storeId, [{ menuId, optionIds: [], quantity: 1 }], { bankName: '토스뱅크', last4: '1234' });
    const createdAt = oldest - (i + 1) * DAY_MS;
    return {
      orderId: `mock-order-gen-${String(i + 1).padStart(2, '0')}`,
      idempotencyKey: `gen-key-${i}`,
      status: 'USER_CONFIRMED' as const,
      statusRevision: 2,
      createdAt: new Date(createdAt).toISOString(),
      completedAt: new Date(createdAt + 10 * 60_000).toISOString(),
      cancelledAt: null,
      approvedTotalAmount: total,
      snapshot,
    };
  });
}

/** 이 사용자에게 보이는 주문 전부. `empty` 시나리오에서는 하나도 없다 */
function visibleOrders(state: ServerDb): MockOrder[] {
  if (mockScenario.history === 'empty') return [];
  return [...state.orders, ...generatedOrders(state)];
}

const byNewest = (a: MockOrder, b: MockOrder) => (a.createdAt === b.createdAt ? (a.orderId < b.orderId ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1);

function toRow(state: ServerDb, order: MockOrder, now: number): MockHistoryRow {
  const unread = state.events.filter((e) => e.orderId === order.orderId && e.viewedAt === null);
  const menuIds = [...new Set(order.snapshot.items.map((i) => i.menuId))];
  return {
    ...order,
    unreadUpdates: unread.map((e) => ({ eventId: e.eventId, revision: e.revision, createdAt: e.createdAt })),
    reviewEligibility: eligibilityOf(state, order, now),
    // 지금도 열 수 있는(판매 중인 활성 메뉴) 것만. 사라진 메뉴는 주문 기록은 그대로 두고 '같은 메뉴 보기'만 숨긴다
    validCurrentMenuRefs: menuIds.filter((id) => mockCatalog.activeMenu(id) !== null),
  };
}

function request(): Promise<void> {
  return mockDelay().then(() => {
    if (mockScenario.network === 'offline') throw new ServiceError('NETWORK_UNAVAILABLE');
    if (mockScenario.network === 'error') throw new ServiceError('NETWORK_UNAVAILABLE');
  });
}

/** 내역은 만든 시각 최신순 고정. 커서는 (시각, id) 키셋이다 (HIST-003) */
function parseCursor(cursor: string): { at: string; id: string } {
  const [at, id] = cursor.split('|');
  if (!at || !id) throw new ServiceError('INVALID_INPUT');
  return { at, id };
}

export function createMockHistoryService(): HistoryService {
  return {
    async listMyOrders({ cursor, pageSize }) {
      await request();
      if (cursor === null && mockScenario.history === 'firstPageFailOnce' && failOnce('history:first')) throw new ServiceError('NETWORK_UNAVAILABLE');
      if (cursor !== null && mockScenario.history === 'nextPageFailOnce' && failOnce('history:next')) throw new ServiceError('NETWORK_UNAVAILABLE');
      if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) throw new ServiceError('INVALID_INPUT');

      const state = await getDb();
      const now = Date.now();
      let sorted = visibleOrders(state).sort(byNewest);
      if (cursor) {
        const c = parseCursor(cursor);
        sorted = sorted.filter((o) => o.createdAt < c.at || (o.createdAt === c.at && o.orderId < c.id));
      }
      const page = sorted.slice(0, pageSize);
      const hasMore = sorted.length > pageSize;
      const last = page[page.length - 1];
      return {
        rows: page.map((o) => toRow(state, o, now)),
        nextCursor: hasMore && last ? `${last.createdAt}|${last.orderId}` : null,
        hasMore,
      };
    },

    async getMyOrder(orderId) {
      await request();
      const state = await getDb();
      const order = visibleOrders(state).find((o) => o.orderId === orderId);
      if (!order) throw new ServiceError('RESOURCE_NOT_FOUND');
      return toRow(state, order, Date.now());
    },

    async getHistoryUnreadSummary() {
      await request();
      const state = await getDb();
      const ids = new Set(visibleOrders(state).map((o) => o.orderId));
      const unread = state.events.filter((e) => e.viewedAt === null && ids.has(e.orderId));
      return {
        unreadEvents: unread.map((e) => ({ eventId: e.eventId, orderId: e.orderId, revision: e.revision })),
        unreadOrderCount: new Set(unread.map((e) => e.orderId)).size,
        asOf: new Date().toISOString(),
      };
    },

    async markStatusUpdatesViewed(eventIds) {
      await mockDelay();
      if (mockScenario.readSave === 'failOnce' && failOnce('read:fail')) throw new ServiceError('NETWORK_UNAVAILABLE', true);
      const state = await getDb();
      const targets = eventIds.map((id) => state.events.find((e) => e.eventId === id));
      // 타인 이벤트가 섞여 있으면 전체를 거절한다. 존재 여부를 알려주지 않는다
      if (targets.some((e) => !e)) throw new ServiceError('RESOURCE_NOT_FOUND');
      const at = new Date().toISOString();
      for (const e of targets) if (e && e.viewedAt === null) e.viewedAt = at; // 최초 읽은 시각만 남긴다
      persistDb();
      return { acknowledgedEventIds: eventIds };
    },

    async getMonthlySummary(monthKey) {
      await request();
      if (mockScenario.monthly === 'failOnce' && failOnce('monthly:fail')) throw new ServiceError('NETWORK_UNAVAILABLE');
      const state = await getDb();
      // 주문 완료(USER_CONFIRMED)만, 완료 시각의 KST 월 기준. 완료가 필요한 주문과 취소한 주문은 세지 않는다
      const done = visibleOrders(state).filter((o) => o.status === 'USER_CONFIRMED' && o.completedAt && monthKeyOf(o.completedAt) === monthKey);
      const categories: Record<string, { n: number; last: number }> = {};
      for (const o of done) {
        const c = (categories[o.snapshot.categoryName] ??= { n: 0, last: 0 });
        c.n += 1;
        c.last = Math.max(c.last, Date.parse(o.completedAt ?? ''));
      }
      // 가장 많이 고른 음식 = 카테고리 기준, 동률이면 최근 주문 쪽 (미결정 묶음3 #8)
      const top = Object.keys(categories).sort((a, b) => categories[b].n - categories[a].n || categories[b].last - categories[a].last)[0] ?? null;
      const summary: MockMonthlySummary = {
        monthKey,
        orderCount: done.length,
        deliveredAmount: done.reduce((sum, o) => sum + o.approvedTotalAmount, 0),
        topCategoryName: top,
        largestOrderAmount: done.reduce((max, o) => Math.max(max, o.approvedTotalAmount), 0),
      };
      return summary;
    },
  };
}
