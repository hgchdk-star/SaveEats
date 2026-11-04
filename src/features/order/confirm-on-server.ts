import type { MockOrder } from '@/mocks/order/types';
import { orderService } from '@/services';
import { ServiceError, errorCode } from '@/services/service-error';
import { createLocalId } from '@/utils/id';

/**
 * 완료 확인을 서버에 보낸다. 같은 명령을 다시 보낼 때는 같은 operationId를 쓴다 (혜지 확인 2026-11-04).
 *
 * OPERATION_CONFLICT는 같은 주문에서 이 operationId가 이미 다른 종류의 명령(취소 번호로 완료, 생성 키 재사용 등)에 쓰였을 때만 나온다.
 * 다른 주문에서 쓴 번호는 충돌이 아니다. 같은 명령을 다른 번호로 다시 보내면 오류 없이 기존 결과(replayed: true)가 오고 그것도 성공으로 받는다.
 * 충돌 번호를 같은 번호로 다시 보내면 계속 같은 오류라서 재시도만 반복하게 된다. 그래서 서버 상태를 먼저 읽고 정한다:
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
