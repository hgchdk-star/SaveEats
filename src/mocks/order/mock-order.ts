import { mockCatalog } from '@/mocks/catalog/mock-catalog-repository';
import { failOnce, mockDelay, mockScenario } from '@/mocks/scenario';
import { useMockSession } from '@/mocks/session/mock-session';
import { ServiceError } from '@/services/service-error';

import type { CreateOrderRequest, MockOrder, MockOrderSnapshot, OrderService } from './types';

/**
 * 주문 Mock. 서버가 하는 일을 흉내 내서 화면의 상태 분기를 볼 수 있게 한다.
 * 금액과 상태를 최종 판단하는 것은 서버이며, 여기 로직은 화면 확인용이다.
 * 이번 실행 동안만 메모리에 보관한다. 같은 idempotencyKey면 같은 주문을 돌려준다 (ORD-006).
 */
const orders = new Map<string, MockOrder>();
const byKey = new Map<string, string>();
const operations = new Map<string, string>();
let seq = 0;

function snapshotOf(request: CreateOrderRequest): { snapshot: MockOrderSnapshot; total: number } {
  const store = mockCatalog.store(request.storeId);
  const account = useMockSession.getState().destinationAccount;
  if (!account) throw new ServiceError('ACCOUNT_REQUIRED');
  if (account.id !== request.accountId || account.revision !== request.expectedAccountRevision) {
    throw new ServiceError('ACCOUNT_REVISION_CONFLICT');
  }

  let total = 0;
  const items = request.items.map((item) => {
    const menu = mockCatalog.activeMenu(item.menuId);
    if (!menu || menu.isSoldOut || menu.storeId !== request.storeId) throw new ServiceError('ITEM_UNAVAILABLE');
    const options = menu.optionGroups.flatMap((g) => g.options.map((o) => ({ groupName: g.name, option: o })));
    const picked = item.optionIds.map((id) => options.find((o) => o.option.id === id));
    if (picked.some((p) => !p || p.option.isSoldOut)) throw new ServiceError('ITEM_UNAVAILABLE');
    const unitPrice = menu.price + picked.reduce((sum, p) => sum + (p?.option.additionalPrice ?? 0), 0);
    if (unitPrice !== item.approvedUnitPrice) throw new ServiceError('PRICE_CHANGED');
    total += unitPrice * item.quantity;
    return {
      menuName: menu.name,
      menuImageRef: menu.imageRef,
      unitPrice,
      quantity: item.quantity,
      lineTotal: unitPrice * item.quantity,
      options: picked.map((p) => ({ groupName: p?.groupName ?? '', optionName: p?.option.name ?? '', additionalPrice: p?.option.additionalPrice ?? 0 })),
    };
  });
  if (total !== request.approvedTotalAmount) throw new ServiceError('PRICE_CHANGED');

  return {
    total,
    snapshot: {
      storeName: store?.name ?? '',
      storeImageRef: store?.imageRef ?? null,
      items,
      destination: { bankName: account.bankName, last4: account.last4 },
    },
  };
}

function find(orderId: string): MockOrder {
  const order = orders.get(orderId);
  if (!order) throw new ServiceError('RESOURCE_NOT_FOUND');
  return order;
}

function store(order: MockOrder): MockOrder {
  orders.set(order.orderId, order);
  return order;
}

export function createMockOrderService(): OrderService {
  return {
    async createOrder(request) {
      await mockDelay();
      const existing = byKey.get(request.idempotencyKey);
      if (existing) return find(existing); // 같은 키 재시도: 같은 주문 (replay)

      if (mockScenario.order === 'priceChangedOnce' && failOnce('order:price')) throw new ServiceError('PRICE_CHANGED');
      if (mockScenario.order === 'itemUnavailableOnce' && failOnce('order:item')) throw new ServiceError('ITEM_UNAVAILABLE');
      // 응답을 못 받았고 서버에는 아무것도 없다. 같은 키로 다시 보내면 성공한다
      if (mockScenario.order === 'unknownLost' && failOnce('order:lost')) throw new ServiceError('REQUEST_TIMEOUT', true);

      const { snapshot, total } = snapshotOf(request);
      seq += 1;
      const order = store({
        orderId: `mock-order-${seq}`,
        idempotencyKey: request.idempotencyKey,
        status: 'PENDING',
        statusRevision: 1,
        createdAt: new Date().toISOString(),
        completedAt: null,
        cancelledAt: null,
        approvedTotalAmount: total,
        snapshot,
      });
      byKey.set(request.idempotencyKey, order.orderId);

      // 서버에는 주문이 만들어졌지만 응답이 유실됐다. 같은 키로 조회하면 찾을 수 있다
      if (mockScenario.order === 'unknownCreated' && failOnce('order:created')) throw new ServiceError('REQUEST_TIMEOUT', true);
      return order;
    },

    async getOrderByRequestKey(idempotencyKey) {
      await mockDelay();
      const id = byKey.get(idempotencyKey);
      return id ? find(id) : null;
    },

    async getOrderStatus(orderId) {
      await mockDelay();
      if (mockScenario.statusQuery === 'failOnce' && failOnce('status:fail')) throw new ServiceError('NETWORK_UNAVAILABLE');
      const order = find(orderId);
      // 다른 기기에서 이미 처리된 경우를 흉내 낸다
      if (order.status === 'PENDING' && mockScenario.statusQuery === 'alreadyConfirmed' && failOnce('status:confirmed')) {
        return store({ ...order, status: 'USER_CONFIRMED', statusRevision: order.statusRevision + 1, completedAt: new Date().toISOString() });
      }
      if (order.status === 'PENDING' && mockScenario.statusQuery === 'alreadyCancelled' && failOnce('status:cancelled')) {
        return store({ ...order, status: 'CANCELLED', statusRevision: order.statusRevision + 1, cancelledAt: new Date().toISOString() });
      }
      return order;
    },

    async confirmOrder(orderId, operationId) {
      await mockDelay();
      // 저장 전에 실패한다 (적용되지 않음). 같은 operationId로 다시 시도하면 성공한다
      if (mockScenario.confirm === 'failOnce' && failOnce('confirm:fail')) throw new ServiceError('NETWORK_UNAVAILABLE', true);
      const order = find(orderId);
      if (operations.has(operationId)) return order; // 같은 명령 재시도: 기존 결과
      if (order.status === 'USER_CONFIRMED') return order;
      if (order.status === 'CANCELLED') throw new ServiceError('INVALID_ORDER_TRANSITION');
      operations.set(operationId, 'CONFIRM');
      // 완료 시각은 서버가 처음 저장한 시각이다 (ORD-008)
      return store({ ...order, status: 'USER_CONFIRMED', statusRevision: order.statusRevision + 1, completedAt: new Date().toISOString() });
    },

    async cancelOrder(orderId, operationId) {
      await mockDelay();
      const order = find(orderId);
      if (operations.has(operationId)) return order;
      if (order.status === 'USER_CONFIRMED') throw new ServiceError('INVALID_ORDER_TRANSITION');
      operations.set(operationId, 'CANCEL');
      const cancelled =
        order.status === 'CANCELLED'
          ? order
          : store({ ...order, status: 'CANCELLED', statusRevision: order.statusRevision + 1, cancelledAt: new Date().toISOString() });
      // 취소는 적용됐는데 응답을 받지 못했다. 취소됐다고 단정하지 않는다
      if (mockScenario.cancel === 'unknownOnce' && failOnce('cancel:unknown')) throw new ServiceError('REQUEST_TIMEOUT', true);
      return cancelled;
    },
  };
}
