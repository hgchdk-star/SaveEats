import { cartQuantity } from './cart-model';
import { useCartStore } from './cart-store';

/** 장바구니 아이콘 배지에 쓰는 담긴 수량의 합. 0이면 배지를 숨긴다 */
export function useCartQuantity(): number {
  return useCartStore((s) => cartQuantity(s.cart));
}
