import type { HistoryService, MockHistoryRow } from '@/mocks/history/types';
import type { MockOrder, OrderService } from '@/mocks/order/types';
import { loadOrderDestinationLink } from '@/services/transfer/order-destination-link';

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

export function withLocalDestination(service: OrderService): OrderService {
  return {
    createOrder: async (request) => attach(await service.createOrder(request)),
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
