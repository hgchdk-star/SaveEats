import AsyncStorage from '@react-native-async-storage/async-storage';

import { mockScenario } from '@/mocks/scenario';

import { parseGuestCart, type CartEnvelope } from './cart-model';

/** Guest 장바구니 저장 키 (CART-002). 키에 이메일·계좌를 넣지 않는다 */
const GUEST_CART_KEY = 'saveeats.cart.guest.v1';

export type StoredCart =
  /** 저장된 값이 없다 */
  | { kind: 'none' }
  | { kind: 'ok'; cart: CartEnvelope }
  /** 읽지 못했거나, 손상됐거나, 지원하지 않는 버전이다 */
  | { kind: 'unreadable' };

export async function loadGuestCart(): Promise<StoredCart> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(GUEST_CART_KEY);
  } catch {
    return { kind: 'unreadable' };
  }
  if (raw === null) return { kind: 'none' };
  try {
    const cart = parseGuestCart(JSON.parse(raw));
    return cart ? { kind: 'ok', cart } : { kind: 'unreadable' };
  } catch {
    return { kind: 'unreadable' };
  }
}

/** envelope를 통째로 저장한다. 실패하면 던진다 */
export async function saveGuestCart(cart: CartEnvelope): Promise<void> {
  if (mockScenario.cartSaveFails) throw new Error('Mock: 장바구니 저장 실패');
  await AsyncStorage.setItem(GUEST_CART_KEY, JSON.stringify(cart));
}
