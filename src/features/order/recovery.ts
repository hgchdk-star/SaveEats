import { useCartStore } from '@/features/cart/cart-store';
import { useHistoryStore } from '@/features/history/history-store';
import { orderService } from '@/services';
import { getSession } from '@/services/session';
import { confirmQueueOwner, listConfirmEntries, removeConfirmEntry, saveConfirmEntry, type ConfirmQueueEntry } from '@/services/order/confirm-queue';
import { errorCode } from '@/services/service-error';
import { createLocalId } from '@/utils/id';

import { confirmOnServer } from './confirm-on-server';
import { clearAttempt, loadAttempt } from './order-persistence';
import { useOrderFlowStore } from './order-flow-store';

/**
 * 앱을 켤 때 기기에 남은 주문 흐름 기록을 정리한다 (ORD-006 · ORD-010).
 *
 * 1) 완료 확인 큐: 주문마다 서버 상태를 먼저 읽는다. 이미 완료로 저장돼 있으면 큐를 지우고, 아직 PENDING이면 같은 operationId로
 *    한 번만 조용히 다시 보낸다. 그래도 안 되면 큐를 남겨 내역에 "상태 저장 다시 시도"로 보이게 한다.
 *    취소된 주문이면 큐를 지운다. 기록을 읽지 못하면 아무것도 지우지 않는다. 이 복구는 토스를 열거나 새 주문을 만들지 않는다.
 * 2) 결과를 모르는 주문 생성 시도: 같은 idempotencyKey로 조회만 한다. 있으면 그 주문을 이어가고(새 주문을 만들지 않는다),
 *    없으면 CREATE_UNKNOWN으로 남겨 최종 주문 확인에서 사용자가 '다시 확인'하게 한다. 새 키를 만들지 않는다.
 * 3) 읽음 처리 대기 목록을 서버에 보내고 내역 탭의 점을 맞춘다.
 *
 * Guest는 서버 기록이 없으므로 로컬 대기 목록만 읽고 서버에는 묻지 않는다.
 * 기기 기록은 로그인 사용자별 키로 격리돼 있다 (AUTH-004).
 */
const recoveringOwners = new Set<string>();

async function recoverConfirmEntry(entry: ConfirmQueueEntry, owner: string): Promise<void> {
  try {
    const latest = await orderService.getOrderStatus(entry.orderId);
    if (confirmQueueOwner() !== owner) return;
    if (latest.status === 'USER_CONFIRMED' || latest.status === 'CANCELLED') {
      // 취소된 주문은 완료 확인을 할 수 없다. 같은 확인을 반복해서 보내지 않도록 큐를 지운다(서정 확정 2026-11-04)
      await removeConfirmEntry(entry.orderId, owner);
      return;
    }
    try {
      await confirmOnServer(entry.orderId, entry.operationId ?? createLocalId());
      await removeConfirmEntry(entry.orderId, owner);
    } catch (error) {
      // 읽은 뒤 사이에 취소된 경우(INVALID_ORDER_TRANSITION)는 다시 보내도 같은 답이 오므로 큐를 지운다. 그 밖의 실패는 상태만 기록한다
      if (errorCode(error) === 'INVALID_ORDER_TRANSITION') await removeConfirmEntry(entry.orderId, owner);
      else await saveConfirmEntry({ ...entry, phase: 'SAVE_FAILED', attemptCount: entry.attemptCount + 1, lastErrorCode: errorCode(error) ?? 'UNKNOWN' }, owner).catch(() => undefined);
    }
  } catch {
    // 서버 상태를 확인하지 못했다. 큐를 지우지 않는다
  }
}

/** 주문마다 따로 처리한다. 한 주문의 실패가 다른 주문의 대기에 영향을 주지 않는다. 계정이 바뀌면 멈추고, 원래 계정으로 돌아왔을 때 이어서 한다 */
async function recoverConfirmQueue(): Promise<void> {
  const owner = confirmQueueOwner();
  if (recoveringOwners.has(owner)) return; // 앱 시작과 로그인 직후가 겹칠 때 같은 확인을 두 번 보내지 않는다
  recoveringOwners.add(owner);
  try {
    const listed = await listConfirmEntries(owner);
    if (listed.status === 'UNREADABLE' || listed.entries.length === 0) return;
    for (const entry of listed.entries) {
      if (confirmQueueOwner() !== owner) return;
      await recoverConfirmEntry(entry, owner);
    }
    if (confirmQueueOwner() === owner) void useHistoryStore.getState().refreshQueue();
  } finally {
    recoveringOwners.delete(owner);
  }
}

export async function recoverOnStart(): Promise<void> {
  const history = useHistoryStore.getState();
  await history.hydrateLocal();
  if (!getSession().isMember) return;

  const flow = useOrderFlowStore.getState();

  // 1) 완료 확인 큐
  await recoverConfirmQueue();

  // 2) 결과를 모르는 주문 생성 시도
  const attempt = await loadAttempt();
  if (attempt && flow.work !== 'CREATE_SAVING') {
    try {
      const found = await orderService.getOrderByRequestKey(attempt.request.idempotencyKey);
      if (found) {
        // 주문은 만들어져 있었다. 시도 기록을 지우고, 만들 때 쓴 장바구니 버전만 비운다
        // 만들 때 쓴 목적지 참조도 남긴다(응답을 못 받아 화면 흐름에서 못 남겼을 수 있다). 못 남기면 복사·사전입력이 막힐 뿐이다
        await orderService.bindCreatedOrder(found, attempt.request);
        await clearAttempt();
        await useCartStore.getState().clearIfRevision(attempt.cartRevision);
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
