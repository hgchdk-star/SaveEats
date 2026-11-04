import type { MockOrder } from '@/mocks/order/types';
import { orderService } from '@/services';
import { ServiceError, errorCode } from '@/services/service-error';
import { createLocalId } from '@/utils/id';

/**
 * 완료 확인을 서버에 보낸다. 같은 명령을 다시 보낼 때는 같은 operationId를 쓴다 (혜지 확인 2026-11-05).
 *
 * OPERATION_CONFLICT는 이 operationId가 이미 다른 명령(다른 주문이거나 취소 등)에 쓰였다는 뜻이다.
 * 같은 번호로 다시 보내면 계속 같은 오류라서 재시도만 반복하게 된다. 그래서 서버 상태를 먼저 읽고 정한다:
 *   이미 완료됨 → 그 주문을 성공으로 돌려준다 / 이미 취소됨 → INVALID_ORDER_TRANSITION / 아직 PENDING → 새 operationId로 한 번 더 보낸다.
 * 상태를 읽지 못하면 그 오류를 그대로 던진다(결과를 모르는 상태로 둔다).
 */
export async function confirmOnServer(orderId: string, operationId: string): Promise<MockOrder> {
  try {
    return await orderService.confirmOrder(orderId, operationId);
  } catch (error) {
    if (errorCode(error) !== 'OPERATION_CONFLICT') throw error;
    const latest = await orderService.getOrderStatus(orderId);
    if (latest.status === 'USER_CONFIRMED') return latest;
    if (latest.status === 'CANCELLED') throw new ServiceError('INVALID_ORDER_TRANSITION');
    return await orderService.confirmOrder(orderId, createLocalId());
  }
}
