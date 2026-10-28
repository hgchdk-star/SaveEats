import { useCartStore } from '@/features/cart/cart-store';
import { useHistoryStore } from '@/features/history/history-store';
import { orderService } from '@/services';
import { getSession } from '@/services/session';
import { errorCode } from '@/services/service-error';

import { clearAttempt, clearConfirmQueue, loadAttempt, loadConfirmQueue, saveConfirmQueue } from './order-persistence';
import { useOrderFlowStore } from './order-flow-store';

/**
 * 앱을 켤 때 기기에 남은 주문 흐름 기록을 정리한다 (ORD-006 · ORD-010).
 *
 * 1) 완료 확인 큐: 서버 상태를 먼저 읽는다. 이미 완료로 저장돼 있으면 큐를 지우고, 아직 PENDING이면 같은 operationId로
 *    한 번만 조용히 다시 보낸다. 그래도 안 되면 큐를 남겨 내역에 "상태 저장 다시 시도"로 보이게 한다.
 *    취소된 주문이면 사용자 의도와 서버 상태가 어긋나므로 지우지 않고 남겨 사용자가 내역에서 확인하게 한다.
 * 2) 결과를 모르는 주문 생성 시도: 같은 idempotencyKey로 조회만 한다. 있으면 그 주문을 이어가고(새 주문을 만들지 않는다),
 *    없으면 CREATE_UNKNOWN으로 남겨 최종 주문 확인에서 사용자가 '다시 확인'하게 한다. 새 키를 만들지 않는다.
 * 3) 읽음 처리 대기 목록을 서버에 보내고 내역 탭의 점을 맞춘다.
 *
 * Guest는 서버 기록이 없으므로 로컬 대기 목록만 읽고 서버에는 묻지 않는다.
 * 로그인 사용자별 격리는 실제 인증이 붙을 때 저장 키에 사용자 id를 넣어 처리한다.
 */
export async function recoverOnStart(): Promise<void> {
  const history = useHistoryStore.getState();
  await history.hydrateLocal();
  if (!getSession().isMember) return;

  const flow = useOrderFlowStore.getState();

  // 1) 완료 확인 큐
  const queue = await loadConfirmQueue();
  if (queue) {
    try {
      const latest = await orderService.getOrderStatus(queue.orderId);
      if (latest.status === 'USER_CONFIRMED') {
        await clearConfirmQueue();
      } else if (latest.status === 'PENDING') {
        try {
          await orderService.confirmOrder(queue.orderId, queue.operationId);
          await clearConfirmQueue();
        } catch (error) {
          // 이미 취소된 경우는 다시 보내도 같은 답이 온다. 큐는 그대로 두고 상태만 기록한다
          await saveConfirmQueue({ ...queue, phase: 'SAVE_FAILED', attemptCount: queue.attemptCount + 1, lastErrorCode: errorCode(error) ?? 'UNKNOWN' }).catch(() => undefined);
        }
      }
    } catch {
      // 서버 상태를 확인하지 못했다. 큐를 지우지 않는다
    }
    void useHistoryStore.getState().refreshQueue();
  }

  // 2) 결과를 모르는 주문 생성 시도
  const attempt = await loadAttempt();
  if (attempt && flow.work !== 'CREATE_SAVING') {
    try {
      const found = await orderService.getOrderByRequestKey(attempt.request.idempotencyKey);
      if (found) {
        // 주문은 만들어져 있었다. 시도 기록을 지우고, 만들 때 쓴 장바구니 버전만 비운다
        await clearAttempt();
        await useCartStore.getState().clearIfRevision(attempt.request.expectedCartRevision);
      } else {
        useOrderFlowStore.getState().set({ attempt, work: 'CREATE_UNKNOWN' });
      }
    } catch {
      useOrderFlowStore.getState().set({ attempt, work: 'CREATE_UNKNOWN' });
    }
  }

  // 3) 내역 탭의 점
  await useHistoryStore.getState().refreshUnread();
}
