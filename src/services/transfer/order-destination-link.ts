import AsyncStorage from '@react-native-async-storage/async-storage';

import { userScopedKey } from '@/services/session';

/**
 * 주문과 "그 주문을 만들 때 쓴 목적지"의 기기 안 연결 (TRF-002 · FR-ORD-013).
 * 서버에는 계좌 원문이 없고 비민감 참조(destinationRef)만 간다. 이 참조를 주문 ID와 함께 이 기기에만 남겨 두었다가,
 * 사전입력·계좌번호 복사 때 AccountVault의 현재 계좌가 바로 그 목적지인지 확인하는 데 쓴다.
 * 은행명과 끝 4자리는 다른 계좌도 같을 수 있어서 연결 근거로 쓰지 않는다. 계좌번호 원문·마스킹은 저장하지 않는다.
 * 연결이 없거나 읽지 못하면 없는 것으로 보고 복사·사전입력을 막는다.
 * 사용자(uid)별로 키를 나누고, 오래된 연결부터 지워 최근 MAX개만 둔다.
 */
export type OrderDestinationLink = { destinationRef: string };

const BASE = 'saveeats.order.destinationLinks.v1';
const MAX = 100;
const key = () => userScopedKey(BASE);

async function readAll(): Promise<Record<string, OrderDestinationLink>> {
  try {
    const raw = await AsyncStorage.getItem(key());
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, OrderDestinationLink>) : {};
  } catch {
    return {};
  }
}

async function write(storageKey: string, orderId: string, link: OrderDestinationLink): Promise<void> {
  // 읽기 오류는 던진다. 빈 목록으로 보고 쓰면 다른 주문의 연결이 모두 지워진다. 내용이 깨진 값은 어차피 쓸 수 없어 새로 시작한다
  const raw = await AsyncStorage.getItem(storageKey);
  let all: Record<string, OrderDestinationLink> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object') all = parsed as Record<string, OrderDestinationLink>;
  } catch {
    // 위 주석과 같다
  }
  delete all[orderId];
  const entries = [...Object.entries(all), [orderId, link] as const].slice(-MAX);
  await AsyncStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(entries)));
}

/** 한 목록을 읽고 고쳐 쓰므로 순서대로 처리한다. 사용자 키는 호출하는 순간에 정한다. 실패하면 던진다 */
let writes: Promise<void> = Promise.resolve();
export function saveOrderDestinationLink(orderId: string, link: OrderDestinationLink): Promise<void> {
  const storageKey = key();
  const run = writes.then(() => write(storageKey, orderId, link));
  writes = run.catch(() => undefined);
  return run;
}

export async function loadOrderDestinationLink(orderId: string): Promise<OrderDestinationLink | null> {
  const link = (await readAll())[orderId];
  return link && typeof link.destinationRef === 'string' ? { destinationRef: link.destinationRef } : null;
}
