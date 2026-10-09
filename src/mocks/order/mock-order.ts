import { mockCatalog } from '@/mocks/catalog/mock-catalog-repository';
import { failOnce, mockDelay, mockScenario } from '@/mocks/scenario';
import { getDb, nextSeq, persistDb, recordEvent, type ServerDb } from '@/mocks/server/db';
import { buildSnapshot } from '@/mocks/server/snapshot';
import { useMockSession } from '@/mocks/session/mock-session';
import { ServiceError } from '@/services/service-error';

import type { CreateOrderRequest, MockOrder, OrderService } from './types';

/**
 * 주문 Mock. 서버가 하는 일을 흉내 내서 화면의 상태 분기를 볼 수 있게 한다.
 * 금액과 상태를 최종 판단하는 것은 서버이며, 여기 로직은 화면 확인용이다.
 * 주문과 상태 이력은 Mock 서버 저장소(db)에 남아서 내역·이번 달 요약과 앱 재시작 복구에도 쓰인다.
 * 같은 idempotencyKey면 같은 주문을 돌려준다 (ORD-006).
 */

/** 요청을 서버가 다시 검증한다: 계좌 버전, 메뉴·옵션 판매 여부, 승인한 가격, 합계 */
function verify(request: CreateOrderRequest) {
  const account = useMockSession.getState().destinationAccount;
  if (!account) throw new ServiceError('ACCOUNT_REQUIRED');
  if (account.id !== request.accountId || account.revision !== request.expectedAccountRevision) {
    throw new ServiceError('ACCOUNT_REVISION_CONFLICT');
  }

  for (const item of request.items) {
    const menu = mockCatalog.activeMenu(item.menuId);
    if (!menu || menu.isSoldOut || menu.storeId !== request.storeId) throw new ServiceError('ITEM_UNAVAILABLE');
    const options = menu.optionGroups.flatMap((g) => g.options);
    const picked = item.optionIds.map((id) => options.find((o) => o.id === id));
    if (picked.some((p) => !p || p.isSoldOut)) throw new ServiceError('ITEM_UNAVAILABLE');
    const unitPrice = menu.price + picked.reduce((sum, p) => sum + (p?.additionalPrice ?? 0), 0);
    if (unitPrice !== item.approvedUnitPrice) throw new ServiceError('PRICE_CHANGED');
  }

  const { snapshot, total } = buildSnapshot(
    request.storeId,
    request.items.map((i) => ({ menuId: i.menuId, optionIds: i.optionIds, quantity: i.quantity })),
    account,
  );
  if (total !== request.approvedTotalAmount) throw new ServiceError('PRICE_CHANGED');
  return { snapshot, total };
}

function find(state: ServerDb, orderId: string): MockOrder {
  const order = state.orders.find((o) => o.orderId === orderId);
  if (!order) throw new ServiceError('RESOURCE_NOT_FOUND');
  return order;
}

/** 상태를 바꾸고 이력을 남긴다. 이력은 실제로 상태가 바뀔 때만 만든다 (ORD-012) */
function transition(state: ServerDb, order: MockOrder, to: 'USER_CONFIRMED' | 'CANCELLED'): MockOrder {
  const at = new Date().toISOString();
  const from = order.status;
  const next: MockOrder = {
    ...order,
    status: to,
    statusRevision: order.statusRevision + 1,
    completedAt: to === 'USER_CONFIRMED' ? at : order.completedAt,
    cancelledAt: to === 'CANCELLED' ? at : order.cancelledAt,
  };
  state.orders[state.orders.findIndex((o) => o.orderId === order.orderId)] = next;
  recordEvent(state, next, from, at);
  persistDb();
  return next;
}

export function createMockOrderService(): OrderService {
  return {
    async createOrder(request) {
      await mockDelay();
      const state = await getDb();
      const existing = state.byKey[request.idempotencyKey];
      if (existing) return find(state, existing); // 같은 키 재시도: 같은 주문 (replay)

      if (mockScenario.order === 'priceChangedOnce' && failOnce('order:price')) throw new ServiceError('PRICE_CHANGED');
      if (mockScenario.order === 'itemUnavailableOnce' && failOnce('order:item')) throw new ServiceError('ITEM_UNAVAILABLE');
      // 응답을 못 받았고 서버에는 아무것도 없다. 같은 키로 다시 보내면 성공한다
      if (mockScenario.order === 'unknownLost' && failOnce('order:lost')) throw new ServiceError('REQUEST_TIMEOUT', true);

      const { snapshot, total } = verify(request);
      const at = new Date().toISOString();
      const order: MockOrder = {
        orderId: `mock-order-${nextSeq(state)}`,
        idempotencyKey: request.idempotencyKey,
        status: 'PENDING',
        statusRevision: 1,
        createdAt: at,
        completedAt: null,
        cancelledAt: null,
        approvedTotalAmount: total,
        snapshot,
      };
      state.orders.push(order);
      state.byKey[request.idempotencyKey] = order.orderId;
      recordEvent(state, order, null, at);
      persistDb();

      // 서버에는 주문이 만들어졌지만 응답이 유실됐다. 같은 키로 조회하면 찾을 수 있다
      if (mockScenario.order === 'unknownCreated' && failOnce('order:created')) throw new ServiceError('REQUEST_TIMEOUT', true);
      return order;
    },

    async getOrderByRequestKey(idempotencyKey) {
      await mockDelay();
      const state = await getDb();
      const id = state.byKey[idempotencyKey];
      return id ? find(state, id) : null;
    },

    async getOrderStatus(orderId) {
      await mockDelay();
      const state = await getDb();
      if (mockScenario.statusQuery === 'failOnce' && failOnce('status:fail')) throw new ServiceError('NETWORK_UNAVAILABLE');
      const order = find(state, orderId);
      // 다른 기기에서 이미 처리된 경우를 흉내 낸다
      if (order.status === 'PENDING' && mockScenario.statusQuery === 'alreadyConfirmed' && failOnce('status:confirmed')) {
        return transition(state, order, 'USER_CONFIRMED');
      }
      if (order.status === 'PENDING' && mockScenario.statusQuery === 'alreadyCancelled' && failOnce('status:cancelled')) {
        return transition(state, order, 'CANCELLED');
      }
      return order;
    },

    async confirmOrder(orderId, operationId) {
      await mockDelay();
      const state = await getDb();
      // 저장 전에 실패한다 (적용되지 않음). 같은 operationId로 다시 시도하면 성공한다
      if (mockScenario.confirm === 'failOnce' && failOnce('confirm:fail')) throw new ServiceError('NETWORK_UNAVAILABLE', true);
      const order = find(state, orderId);
      if (state.operations[operationId]) return order; // 같은 명령 재시도: 기존 결과
      if (order.status === 'USER_CONFIRMED') return order;
      if (order.status === 'CANCELLED') throw new ServiceError('INVALID_ORDER_TRANSITION');
      state.operations[operationId] = 'CONFIRM';
      // 완료 시각은 서버가 처음 저장한 시각이다 (ORD-008)
      return transition(state, order, 'USER_CONFIRMED');
    },

    async cancelOrder(orderId, operationId) {
      await mockDelay();
      const state = await getDb();
      const order = find(state, orderId);
      if (state.operations[operationId]) return order;
      if (order.status === 'USER_CONFIRMED') throw new ServiceError('INVALID_ORDER_TRANSITION');
      state.operations[operationId] = 'CANCEL';
      const cancelled = order.status === 'CANCELLED' ? order : transition(state, order, 'CANCELLED');
      // 취소는 적용됐는데 응답을 받지 못했다. 취소됐다고 단정하지 않는다
      if (mockScenario.cancel === 'unknownOnce' && failOnce('cancel:unknown')) throw new ServiceError('REQUEST_TIMEOUT', true);
      return cancelled;
    },
  };
}
