import { LIMITS } from '@/config/limits';
import type { MockOrder, OrderService } from '@/mocks/order/types';
import { ServiceError } from '@/services/service-error';
import { getSupabaseClient } from '@/services/supabase/client';

import { parseOrderDto } from './order-dto';

/**
 * 주문 서비스의 실서버 구현 (혜지와 합의 2026-11-04, 개발 프로젝트에서 호출 확인).
 *
 * 호출 모양:
 * - create_order:             rpc('create_order', { p_request: CreateOrderRequest })
 * - 키 조회:                  rpc('get_order_by_request_key', { p_idempotency_key })  → 주문 DTO 또는 JSON null
 * - 주문 한 건 조회:          rpc('get_my_order', { p_order_id })
 * - 완료:                     rpc('confirm_order', { p_order_id, p_operation_id })
 * - 취소:                     rpc('cancel_order', { p_order_id, p_operation_id })
 * 응답은 주문 DTO(create/confirm/cancel은 + replayed). 같은 명령을 다른 번호로 다시 보내면 오류 없이 기존 결과(replayed: true)가 오고 성공으로 받는다.
 *
 * 오류: 서버 업무 오류는 SQLSTATE P0001이고 message가 코드다(앱 오류 목록의 코드만 통과시킨다). 42501은 AUTH_REQUIRED.
 * 서버가 응답한 오류는 code가 있고, 없거나 시간 초과(AbortError)면 응답을 받지 못한 것이다 → 결과를 모르는 오류(outcomeUnknown).
 * 서버 오류 원문과 요청·응답 내용은 오류에 담지 않는다.
 */
const SERVER_CODES: readonly string[] = [
  'AUTH_REQUIRED',
  'INVALID_INPUT',
  'IDEMPOTENCY_CONFLICT',
  'QUANTITY_LIMIT_EXCEEDED',
  'DISCLOSURE_VERSION_UNSUPPORTED',
  'ITEM_UNAVAILABLE',
  'STORE_CLOSED',
  'INVALID_OPTIONS',
  'PRICE_CHANGED',
  'RESOURCE_NOT_FOUND',
  'INVALID_ORDER_TRANSITION',
  'OPERATION_CONFLICT',
  // 리뷰 (혜지, 2026-11-04)
  'ORDER_NOT_COMPLETED',
  'REVIEW_OPERATION_CONFLICT',
  'REVIEW_DEADLINE_EXCEEDED',
  'INVALID_REVIEW_INPUT',
  'ACTIVE_REVIEW_EXISTS',
  'REVIEW_REVISION_CONFLICT',
  'SELF_HELPFUL_NOT_ALLOWED',
];

export async function callOrderRpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  const client = getSupabaseClient();
  if (!client) throw new ServiceError('AUTH_UNAVAILABLE');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIMITS.serverRequestTimeoutMs);
  try {
    const { data, error } = await client.rpc(name, args).abortSignal(controller.signal);
    if (error) {
      if (error.code === 'P0001' && error.message && SERVER_CODES.includes(error.message)) throw new ServiceError(error.message);
      if (error.code === '42501') throw new ServiceError('AUTH_REQUIRED');
      // 서버가 응답한 알 수 없는 오류: 주문이 만들어졌는지 알 수 없는 쪽으로 다룬다
      throw new ServiceError(error.code ? 'ORDER_FAILED' : 'NETWORK_UNAVAILABLE', true);
    }
    return data;
  } catch (e) {
    if (e instanceof ServiceError) throw e;
    // AbortError(시간 초과)나 연결 실패: 응답을 받지 못했다
    throw new ServiceError('REQUEST_TIMEOUT', true);
  } finally {
    clearTimeout(timer);
  }
}

export function createSupabaseOrderService(): OrderService {
  return {
    async createOrder(request) {
      return parseOrderDto(await callOrderRpc('create_order', { p_request: request }), request.idempotencyKey);
    },

    async getOrderByRequestKey(idempotencyKey) {
      const data = await callOrderRpc('get_order_by_request_key', { p_idempotency_key: idempotencyKey });
      return data === null ? null : parseOrderDto(data, idempotencyKey);
    },

    // 주문 한 건 조회에는 생성 키가 오지 않는다. 앱 화면은 이 값을 쓰지 않는다
    async getOrderStatus(orderId): Promise<MockOrder> {
      return parseOrderDto(await callOrderRpc('get_my_order', { p_order_id: orderId }), '');
    },

    async confirmOrder(orderId, operationId) {
      return parseOrderDto(await callOrderRpc('confirm_order', { p_order_id: orderId, p_operation_id: operationId }), '');
    },

    async cancelOrder(orderId, operationId) {
      return parseOrderDto(await callOrderRpc('cancel_order', { p_order_id: orderId, p_operation_id: operationId }), '');
    },
  };
}
