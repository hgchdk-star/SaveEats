import { create } from 'zustand';

import { MockCartValidationError, mockValidateCart } from '@/mocks/cart/mock-cart-validation';

import {
  acknowledgePrices,
  addToCart,
  clearCart,
  createEmptyCart,
  removeItem,
  setQuantity,
  type AddToCartInput,
  type CartEnvelope,
  type CartValidation,
} from './cart-model';
import { loadGuestCart, saveGuestCart } from './cart-storage';

/**
 * 장바구니 상태 (개발 명세 CART-003).
 * - 편집은 한 줄로 세운 작업 큐에서 순서대로 처리한다
 * - 기기 저장에 성공한 뒤에만 새 상태를 화면에 내보낸다. 실패하면 마지막 저장 상태를 그대로 둔다
 * - 서버 확인 상태(validation)는 저장 상태(status)와 따로 둔다
 */
export type CartStatus =
  /** 기기에서 읽는 중 */
  | 'HYDRATING'
  | 'LOCAL_READY'
  /** 저장된 장바구니를 읽을 수 없다. 조용히 초기화하지 않고 사용자가 비우기를 고른다 */
  | 'STORAGE_ERROR';

export type CartEditResult = { ok: true } | { ok: false; reason: 'OTHER_STORE' | 'OVER_LIMIT' | 'SAVE_FAILED' | 'NOT_READY' };

type CartState = {
  status: CartStatus;
  cart: CartEnvelope;
  validation: CartValidation;
  hydrate: () => Promise<void>;
  add: (input: AddToCartInput, options?: { replaceOtherStore?: boolean }) => Promise<CartEditResult>;
  setQuantity: (clientItemId: string, quantity: number) => Promise<CartEditResult>;
  remove: (clientItemId: string) => Promise<CartEditResult>;
  clear: () => Promise<CartEditResult>;
  acknowledgePrices: () => Promise<CartEditResult>;
  /** 읽을 수 없는 저장 값을 버리고 빈 장바구니로 다시 시작한다 */
  resetStorage: () => Promise<CartEditResult>;
  /** 서버 확인 (CART-008). 담긴 내용은 그대로 두고 주문 가능 여부만 바꾼다 */
  validate: () => Promise<void>;
};

let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}

let validationTicket = 0;

export const useCartStore = create<CartState>((set, get) => {
  /** 최신 장바구니에 편집을 적용하고, 저장에 성공하면 내보낸다 */
  const commit = (
    edit: (cart: CartEnvelope) => CartEnvelope | { reason: 'OTHER_STORE' | 'OVER_LIMIT' },
    /** 새 항목이 생기거나 장바구니가 통째로 바뀌면 이전 서버 확인 결과를 버린다. 수량 변경·삭제는 그대로 둔다 */
    { resetValidation = false, allowWhenBroken = false } = {},
  ) =>
    enqueue<CartEditResult>(async () => {
      const { status, cart } = get();
      if (status === 'HYDRATING' || (status === 'STORAGE_ERROR' && !allowWhenBroken)) return { ok: false, reason: 'NOT_READY' };
      const next = edit(cart);
      if ('reason' in next) return { ok: false, reason: next.reason };
      try {
        await saveGuestCart(next);
      } catch {
        return { ok: false, reason: 'SAVE_FAILED' };
      }
      set(resetValidation ? { cart: next, status: 'LOCAL_READY', validation: { phase: 'IDLE' } } : { cart: next, status: 'LOCAL_READY' });
      return { ok: true };
    });

  return {
    status: 'HYDRATING',
    cart: createEmptyCart(),
    validation: { phase: 'IDLE' },

    hydrate: () =>
      enqueue(async () => {
        if (get().status !== 'HYDRATING') return;
        const stored = await loadGuestCart();
        if (stored.kind === 'unreadable') set({ status: 'STORAGE_ERROR' });
        else set({ status: 'LOCAL_READY', cart: stored.kind === 'ok' ? stored.cart : get().cart });
      }),

    add: (input, options) =>
      commit(
        (cart) => {
          const result = addToCart(cart, input, options);
          return result.ok ? result.cart : { reason: result.reason };
        },
        { resetValidation: true },
      ),
    setQuantity: (clientItemId, quantity) => commit((cart) => setQuantity(cart, clientItemId, quantity)),
    remove: (clientItemId) => commit((cart) => removeItem(cart, clientItemId)),
    clear: () => commit((cart) => clearCart(cart), { resetValidation: true }),
    acknowledgePrices: () => commit((cart) => acknowledgePrices(cart, get().validation)),
    resetStorage: () => commit(() => clearCart(createEmptyCart()), { resetValidation: true, allowWhenBroken: true }),

    validate: async () => {
      const { cart, status } = get();
      if (status !== 'LOCAL_READY' || cart.items.length === 0) return;
      const ticket = ++validationTicket;
      set({ validation: { phase: 'VALIDATING' } });
      try {
        const result = await mockValidateCart({ storeId: cart.storeId, items: cart.items });
        // 더 늦게 시작한 확인이 있으면 이 결과는 버린다
        if (ticket === validationTicket) set({ validation: { phase: 'DONE', result } });
      } catch (error) {
        if (ticket !== validationTicket) return;
        set({ validation: { phase: error instanceof MockCartValidationError ? error.code : 'VALIDATION_UNAVAILABLE' } });
      }
    },
  };
});
