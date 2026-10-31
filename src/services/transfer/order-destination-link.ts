import AsyncStorage from '@react-native-async-storage/async-storage';

import { userScopedKey } from '@/services/session';

/**
 * 주문과 "그 주문을 만들 때 쓴 목적지"의 기기 안 연결 (TRF-002 · FR-ORD-013).
 * 서버에는 계좌 원문이 없고 비민감 참조(destinationRef · revision)만 간다. 이 참조를 주문 ID와 함께 이 기기에만 남겨 두었다가,
 * 사전입력·계좌번호 복사 때 AccountVault의 현재 계좌가 바로 그 목적지인지 확인하는 데 쓴다.
 * 은행명과 끝 4자리는 다른 계좌도 같을 수 있어서 연결 근거로 쓰지 않는다. 계좌번호 원문·마스킹은 저장하지 않는다.
 * 연결이 없거나 읽지 못하면 없는 것으로 보고 복사·사전입력을 막는다.
 * 사용자(uid)별로 키를 나누고, 오래된 연결부터 지워 최근 MAX개만 둔다.
 */
export type OrderDestinationLink = { destinationRef: string; revision: number };

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

export async function saveOrderDestinationLink(orderId: string, link: OrderDestinationLink): Promise<void> {
  const all = await readAll();
  delete all[orderId];
  const entries = [...Object.entries(all), [orderId, link] as const].slice(-MAX);
  await AsyncStorage.setItem(key(), JSON.stringify(Object.fromEntries(entries)));
}

export async function loadOrderDestinationLink(orderId: string): Promise<OrderDestinationLink | null> {
  const link = (await readAll())[orderId];
  return link && typeof link.destinationRef === 'string' && typeof link.revision === 'number' ? link : null;
}
