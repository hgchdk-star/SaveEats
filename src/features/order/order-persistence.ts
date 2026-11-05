import AsyncStorage from '@react-native-async-storage/async-storage';

import type { CreateOrderRequest } from '@/mocks/order/types';
import { failOnce, mockScenario } from '@/mocks/scenario';
import { userScopedKey } from '@/services/session';

/**
 * 주문 생성 시도 (ORD-004 #4): 전송하기 전에 idempotencyKey와 요청을 기기에 저장한다. 계좌번호 원문·딥링크 원문·비밀번호는 담지 않는다.
 * 응답이 유실돼도 같은 키로 다시 확인할 수 있게 하려는 것이다. 저장에 실패하면 전송하지 않는다.
 * 완료 확인 큐(ORD-010)는 services/order/confirm-queue.ts에 있다.
 *
 * 로그인 사용자별로 키를 나눠 저장한다 (AUTH-004, userScopedKey).
 */
const ATTEMPT_BASE = 'saveeats.order.attempt.v2';
/** 로그인한 사용자별로 나눠 저장한다 (AUTH-004). 키는 읽고 쓰는 순간의 로그인 사용자로 정한다 */
const ATTEMPT_KEY = () => userScopedKey(ATTEMPT_BASE);

/**
 * cartRevision: 요청을 만들 때의 로컬 장바구니 revision. 서버로는 보내지 않고, 주문이 만들어졌을 때
 * 현재 장바구니가 아직 그 revision일 때만 비우는 데 쓴다 (그사이 더 담은 것을 지우지 않기 위해).
 */
export type CreateAttempt = { request: CreateOrderRequest; via: 'TOSS' | 'DIRECT'; cartRevision: number };

export async function saveAttempt(attempt: CreateAttempt): Promise<void> {
  // 개발용 실패 시나리오: 전송 전 기기 저장이 실패하는 경우를 화면에서 볼 수 있게 한다
  if (mockScenario.order === 'localSaveFailOnce' && failOnce('order:localSave')) throw new Error('Mock: 주문 요청 저장 실패');
  await AsyncStorage.setItem(ATTEMPT_KEY(), JSON.stringify(attempt));
}

export async function clearAttempt(): Promise<void> {
  // 정리에 실패해도 주문 흐름은 막지 않는다. 다음 주문 때 덮어쓴다
  await AsyncStorage.removeItem(ATTEMPT_KEY()).catch(() => undefined);
}

/** 앱을 다시 켰을 때 결과를 모르는 주문 생성 시도가 남아 있는지 읽는다. 읽지 못하거나 모양이 다르면 없는 것으로 본다 */
export async function loadAttempt(): Promise<CreateAttempt | null> {
  try {
    const raw = await AsyncStorage.getItem(ATTEMPT_KEY());
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CreateAttempt;
    // 요청 v2(destinationRef)가 아닌 예전 형식은 서버가 받지 않으므로 없는 것으로 본다
    const valid = parsed?.request?.idempotencyKey && typeof parsed.request.destinationRef === 'string' && typeof parsed.cartRevision === 'number' && (parsed.via === 'TOSS' || parsed.via === 'DIRECT');
    return valid ? parsed : null;
  } catch {
    return null;
  }
}
