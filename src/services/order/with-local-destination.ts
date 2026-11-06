import type { HistoryService, MockHistoryRow } from '@/mocks/history/types';
import type { CreateOrderRequest, MockOrder, OrderService } from '@/mocks/order/types';
import { loadOrderDestinationLink, saveOrderDestinationLink } from '@/services/transfer/order-destination-link';

import { loadMaskedDestination } from './masked-destination-store';

/**
 * 서버 주문 응답에는 목적지(은행·마스킹 번호)가 없다. 서비스 경계에서 이 기기에 저장한 표시값을 합쳐 화면에 넘긴다.
 * 주문 → 기기에 남긴 목적지 참조 → 그 참조의 표시값 순으로 찾고, 없으면 서버가 준 값(Mock이 줄 때)을, 그것도 없으면 null이다.
 * 현재 계좌로 대신 채우지 않는다 (ORD-007).
 */
async function attach<T extends MockOrder>(order: T): Promise<T> {
  const link = await loadOrderDestinationLink(order.orderId).catch(() => null);
  const local = link ? await loadMaskedDestination(link.destinationRef) : null;
  const destination = local ?? order.snapshot.destination ?? null;
  return { ...order, snapshot: { ...order.snapshot, destination } };
}

/**
 * 이 요청으로 만들어진 주문에 목적지 참조를 잇고 표시값을 합친다. 연결을 먼저 저장해야 첫 응답부터 그때의 계좌가 보인다 (FR-ORD-013).
 * 저장에 실패하면 목적지를 모르는 주문으로 남는다(표시 없음, 복사·사전입력 차단). 현재 계좌로 대신 채우지 않는다.
 * 같은 키로 찾은 주문이라도 가게·금액이 요청과 다르면 이번 요청의 주문이 아니므로 잇지 않는다.
 * IDEMPOTENCY_CONFLICT로 찾은 주문은 이 함수를 거치지 않는다.
 */
async function bindCreatedOrder(order: MockOrder, request: CreateOrderRequest): Promise<MockOrder> {
  const sameRequest = order.snapshot.storeId === request.storeId && order.approvedTotalAmount === request.approvedTotalAmount;
  if (sameRequest) await saveOrderDestinationLink(order.orderId, { destinationRef: request.destinationRef }).catch(() => undefined);
  return attach(order);
}

export type LocalOrderService = OrderService & { bindCreatedOrder: typeof bindCreatedOrder };

export function withLocalDestination(service: OrderService): LocalOrderService {
  return {
    bindCreatedOrder,
    createOrder: async (request) => bindCreatedOrder(await service.createOrder(request), request),
    getOrderByRequestKey: async (key) => {
      const order = await service.getOrderByRequestKey(key);
      return order ? attach(order) : null; // 없으면 성공 응답의 null (혜지 합의 2026-11)
    },
    getOrderStatus: async (orderId) => attach(await service.getOrderStatus(orderId)),
    confirmOrder: async (orderId, operationId) => attach(await service.confirmOrder(orderId, operationId)),
    cancelOrder: async (orderId, operationId) => attach(await service.cancelOrder(orderId, operationId)),
  };
}

export function withLocalDestinationHistory(service: HistoryService): HistoryService {
  const row = (r: MockHistoryRow) => attach(r);
  return {
    ...service,
    listMyOrders: async (input) => {
      const page = await service.listMyOrders(input);
      return { ...page, rows: await Promise.all(page.rows.map(row)) };
    },
    getMyOrder: async (orderId) => row(await service.getMyOrder(orderId)),
  };
}
