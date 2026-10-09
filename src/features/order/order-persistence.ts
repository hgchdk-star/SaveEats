import AsyncStorage from '@react-native-async-storage/async-storage';

import type { CreateOrderRequest } from '@/mocks/order/types';
import { failOnce, mockScenario } from '@/mocks/scenario';

/**
 * 주문 흐름에서 기기에 먼저 저장해 두는 두 가지.
 * 둘 다 계좌번호 원문·딥링크 원문·비밀번호를 담지 않는다 (ORD-004 · ORD-010).
 *
 * 1) 주문 생성 시도 (ORD-004 #4): 전송하기 전에 idempotencyKey와 요청을 저장한다.
 *    응답이 유실돼도 같은 키로 다시 확인할 수 있게 하려는 것이다. 저장에 실패하면 전송하지 않는다.
 * 2) 완료 확인 큐 (ORD-010): '주문 완료했어요'를 누르면 서버로 보내기 전에 저장한다.
 *    서버에 저장하지 못했어도 사용자가 완료했다는 의도가 사라지지 않게 하려는 것이다.
 *
 * 로그인 사용자별 격리(ownerUid)는 실제 인증이 붙을 때 키에 포함한다.
 */
const ATTEMPT_KEY = 'saveeats.order.attempt.v1';
const CONFIRM_QUEUE_KEY = 'saveeats.order.confirmQueue.v1';

export type CreateAttempt = { request: CreateOrderRequest; via: 'TOSS' | 'DIRECT' };

export type ConfirmQueueEntry = {
  version: 1;
  orderId: string;
  operationId: string;
  kind: 'CONFIRM';
  phase: 'QUEUED' | 'SYNCING' | 'SAVE_FAILED';
  createdLocallyAt: string;
  attemptCount: number;
  lastErrorCode: string | null;
};

export async function saveAttempt(attempt: CreateAttempt): Promise<void> {
  // 개발용 실패 시나리오: 전송 전 기기 저장이 실패하는 경우를 화면에서 볼 수 있게 한다
  if (mockScenario.order === 'localSaveFailOnce' && failOnce('order:localSave')) throw new Error('Mock: 주문 요청 저장 실패');
  await AsyncStorage.setItem(ATTEMPT_KEY, JSON.stringify(attempt));
}

export async function clearAttempt(): Promise<void> {
  // 정리에 실패해도 주문 흐름은 막지 않는다. 다음 주문 때 덮어쓴다
  await AsyncStorage.removeItem(ATTEMPT_KEY).catch(() => undefined);
}

export async function saveConfirmQueue(entry: ConfirmQueueEntry): Promise<void> {
  await AsyncStorage.setItem(CONFIRM_QUEUE_KEY, JSON.stringify(entry));
}

export async function clearConfirmQueue(): Promise<void> {
  await AsyncStorage.removeItem(CONFIRM_QUEUE_KEY).catch(() => undefined);
}
