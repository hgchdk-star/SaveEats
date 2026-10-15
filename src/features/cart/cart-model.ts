import { LIMITS } from '@/config/limits';
import { UNDECIDED } from '@/config/undecided';
import type { Uuid, Won } from '@/contracts/common';
import type { MockCartValidationFailure, MockCartValidationResult } from '@/mocks/cart/mock-cart-validation';
import { createLocalId } from '@/utils/id';

/**
 * 장바구니 로컬 모델과 편집 규칙. 화면과 무관한 순수 함수만 둔다.
 * 근거: 개발 명세 CART-002(저장 형식) · CART-004(편집 규칙) · CART-008(검증 결과 표시).
 * 서버 동기화와 로그인 승격(CART-005 이후)은 아직 만들지 않았다.
 */

export const CART_SCHEMA_VERSION = 1;

export type CartOwner = { kind: 'guest' } | { kind: 'user'; uid: string };

export type CartItem = {
  clientItemId: string;
  menuId: Uuid;
  /** 정렬하고 중복을 없앤 옵션 id */
  optionIds: Uuid[];
  quantity: number;
  /** 사용자가 마지막으로 확인한 단가. 주문 가격의 원장이 아니다 */
  acknowledgedUnitPrice: Won;
  acknowledgedCatalogRevision: number;
  /** 아래 셋은 오프라인 표시 보조용이며 주문 검증값으로 신뢰하지 않는다 */
  menuName: string;
  optionNames: string[];
  imageRef: string | null;
};

/** CART-002 로컬 envelope. 한 덩어리로 통째 저장한다 */
export type CartEnvelope = {
  schemaVersion: typeof CART_SCHEMA_VERSION;
  owner: CartOwner;
  /** 세대 식별. 소비 완료·초기화 때 새 세대가 된다 */
  localCartId: string;
  /** 사용자 편집마다 1씩 늘어난다 */
  localRevision: number;
  /** 새로 만든 빈 장바구니와 사용자가 직접 비운 장바구니를 구별한다 */
  hasUserMutation: boolean;
  /** 빈 장바구니는 null */
  storeId: Uuid | null;
  items: CartItem[];
  baseServerRevision: number | null;
  acknowledgedLocalRevision: number;
  pendingCommand: null;
  promotion: null;
};

export function createEmptyCart(): CartEnvelope {
  return {
    schemaVersion: CART_SCHEMA_VERSION,
    owner: { kind: 'guest' },
    localCartId: createLocalId(),
    localRevision: 0,
    hasUserMutation: false,
    storeId: null,
    items: [],
    baseServerRevision: null,
    acknowledgedLocalRevision: 0,
    pendingCommand: null,
    promotion: null,
  };
}

export function normalizeOptionIds(optionIds: readonly Uuid[]): Uuid[] {
  return [...new Set(optionIds)].sort();
}

/** 같은 메뉴라도 옵션 조합이 다르면 다른 항목이다. 서버 configuration_key와 같은 규칙 (DB-005) */
export function configurationKey(menuId: Uuid, optionIds: readonly Uuid[]): string {
  return `${menuId}|${normalizeOptionIds(optionIds).join(',')}`;
}

export function cartQuantity(cart: CartEnvelope): number {
  return cart.items.reduce((sum, item) => sum + item.quantity, 0);
}

/** 가격 변경을 확인하기 전의 합계는 사용자가 확인한 가격 기준이다 */
export function cartTotal(cart: CartEnvelope): Won {
  return cart.items.reduce((sum, item) => sum + item.acknowledgedUnitPrice * item.quantity, 0);
}

/** 가게 상세의 "장바구니에 N개" 표시용 */
export function quantityByMenu(cart: CartEnvelope, storeId: Uuid): Record<Uuid, number> {
  const result: Record<Uuid, number> = {};
  if (cart.storeId !== storeId) return result;
  for (const item of cart.items) result[item.menuId] = (result[item.menuId] ?? 0) + item.quantity;
  return result;
}

function edited(cart: CartEnvelope, patch: Partial<CartEnvelope>): CartEnvelope {
  return { ...cart, ...patch, hasUserMutation: true, localRevision: cart.localRevision + 1 };
}

export type AddToCartInput = {
  storeId: Uuid;
  menuId: Uuid;
  optionIds: readonly Uuid[];
  quantity: number;
  unitPrice: Won;
  catalogRevision: number;
  menuName: string;
  optionNames: string[];
  imageRef: string | null;
};

export type AddToCartResult =
  | { ok: true; cart: CartEnvelope }
  /** OTHER_STORE: 다른 가게 메뉴가 담겨 있다. OVER_LIMIT: 같은 조합의 합계가 최대 수량을 넘는다 */
  | { ok: false; reason: 'OTHER_STORE' | 'OVER_LIMIT' };

/**
 * 담기 (CART-004).
 * - 같은 가게: 같은 조합이면 수량을 더하고, 아니면 새 항목
 * - 다른 가게: replaceOtherStore가 없으면 거절. 있으면 기존 전체 제거 + 새 항목 추가를 한 번의 변경으로
 * - 같은 조합 합계가 최대를 넘으면 거절한다. 자동으로 줄여 담지 않는다
 */
export function addToCart(cart: CartEnvelope, input: AddToCartInput, options?: { replaceOtherStore?: boolean }): AddToCartResult {
  const otherStore = cart.items.length > 0 && cart.storeId !== input.storeId;
  if (otherStore && !options?.replaceOtherStore) return { ok: false, reason: 'OTHER_STORE' };

  const base = otherStore ? [] : cart.items;
  const optionIds = normalizeOptionIds(input.optionIds);
  const key = configurationKey(input.menuId, optionIds);
  const same = base.find((item) => configurationKey(item.menuId, item.optionIds) === key);

  if (same && same.quantity + input.quantity > LIMITS.quantityMax) return { ok: false, reason: 'OVER_LIMIT' };

  const items = same
    ? base.map((item) => (item === same ? { ...item, quantity: item.quantity + input.quantity } : item))
    : [
        ...base,
        {
          clientItemId: createLocalId(),
          menuId: input.menuId,
          optionIds,
          quantity: input.quantity,
          acknowledgedUnitPrice: input.unitPrice,
          acknowledgedCatalogRevision: input.catalogRevision,
          menuName: input.menuName,
          optionNames: input.optionNames,
          imageRef: input.imageRef,
        },
      ];
  return { ok: true, cart: edited(cart, { storeId: input.storeId, items }) };
}

/** 수량은 1~10. 1에서 더 줄여도 0이 되지 않는다. 삭제는 removeItem으로만 한다 */
export function setQuantity(cart: CartEnvelope, clientItemId: string, quantity: number): CartEnvelope {
  const next = Math.max(LIMITS.quantityMin, Math.min(LIMITS.quantityMax, Math.trunc(quantity)));
  return edited(cart, { items: cart.items.map((item) => (item.clientItemId === clientItemId ? { ...item, quantity: next } : item)) });
}

/** 마지막 항목을 지우면 storeId도 비운다 */
export function removeItem(cart: CartEnvelope, clientItemId: string): CartEnvelope {
  const items = cart.items.filter((item) => item.clientItemId !== clientItemId);
  return edited(cart, { items, storeId: items.length > 0 ? cart.storeId : null });
}

export function clearCart(cart: CartEnvelope): CartEnvelope {
  return edited(cart, { items: [], storeId: null });
}

/* ---------- 서버 확인 결과 (CART-008) ---------- */

export type CartValidation =
  | { phase: 'IDLE' }
  | { phase: 'VALIDATING' }
  | { phase: 'DONE'; result: MockCartValidationResult }
  | { phase: MockCartValidationFailure };

export function validationOf(validation: CartValidation, clientItemId: string) {
  return validation.phase === 'DONE' ? validation.result.items[clientItemId] : undefined;
}

/** 확인한 가격과 서버의 현재 가격이 실제로 다른 항목만 가격 변경으로 본다 */
export function isPriceChanged(item: CartItem, validation: CartValidation): boolean {
  const v = validationOf(validation, item.clientItemId);
  return v?.status === 'PRICE_CHANGED' && v.currentUnitPrice !== item.acknowledgedUnitPrice;
}

/** 가격 변경 일괄 확인. 서버가 준 현재 가격과 catalogRevision을 로컬에 저장한다 */
export function acknowledgePrices(cart: CartEnvelope, validation: CartValidation): CartEnvelope {
  return edited(cart, {
    items: cart.items.map((item) => {
      const v = validationOf(validation, item.clientItemId);
      return v && isPriceChanged(item, validation)
        ? { ...item, acknowledgedUnitPrice: v.currentUnitPrice, acknowledgedCatalogRevision: v.currentCatalogRevision }
        : item;
    }),
  });
}

export type CheckoutBlock =
  | { blocked: false }
  | {
      blocked: true;
      reason:
        | 'EMPTY'
        | 'NETWORK_UNAVAILABLE'
        | 'VALIDATION_UNAVAILABLE'
        | 'VALIDATING'
        | 'STORE_CLOSED'
        | 'PRICE_CHANGED'
        | 'SOLD_OUT'
        | 'INACTIVE_ENTITY'
        | 'OPTIONS_INVALID';
      /** PRICE_CHANGED일 때 가격이 바뀐 항목 수 */
      count?: number;
    };

/** 주문하기를 누를 수 있는지 (FR-CART-014~016 · CART-008 · CART-009). 서버 확인이 끝나기 전에는 막는다 */
export function checkoutBlock(cart: CartEnvelope, validation: CartValidation): CheckoutBlock {
  if (cart.items.length === 0) return { blocked: true, reason: 'EMPTY' };
  if (validation.phase === 'NETWORK_UNAVAILABLE') return { blocked: true, reason: 'NETWORK_UNAVAILABLE' };
  if (validation.phase === 'VALIDATION_UNAVAILABLE') return { blocked: true, reason: 'VALIDATION_UNAVAILABLE' };
  if (validation.phase !== 'DONE') return { blocked: true, reason: 'VALIDATING' };

  if (!UNDECIDED.preparingStoreOrderable && !validation.result.storeIsOpen) return { blocked: true, reason: 'STORE_CLOSED' };

  const priceChanged = cart.items.filter((item) => isPriceChanged(item, validation)).length;
  if (priceChanged > 0) return { blocked: true, reason: 'PRICE_CHANGED', count: priceChanged };

  const statuses = cart.items.map((item) => validationOf(validation, item.clientItemId)?.status);
  if (statuses.includes('MENU_SOLD_OUT') || statuses.includes('OPTION_SOLD_OUT')) return { blocked: true, reason: 'SOLD_OUT' };
  if (statuses.includes('INACTIVE_ENTITY')) return { blocked: true, reason: 'INACTIVE_ENTITY' };
  if (statuses.includes('OPTIONS_INVALID')) return { blocked: true, reason: 'OPTIONS_INVALID' };
  return { blocked: false };
}

/* ---------- 저장된 값 검증 (CART-003) ---------- */

const isSafeInt = (value: unknown, min: number): value is number => Number.isSafeInteger(value) && (value as number) >= min;
const isString = (value: unknown): value is string => typeof value === 'string';

function isCartItem(value: unknown): value is CartItem {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    isString(item.clientItemId) &&
    isString(item.menuId) &&
    Array.isArray(item.optionIds) &&
    item.optionIds.every(isString) &&
    isSafeInt(item.quantity, LIMITS.quantityMin) &&
    item.quantity <= LIMITS.quantityMax &&
    isSafeInt(item.acknowledgedUnitPrice, 0) &&
    isSafeInt(item.acknowledgedCatalogRevision, 0) &&
    isString(item.menuName) &&
    Array.isArray(item.optionNames) &&
    item.optionNames.every(isString) &&
    (item.imageRef === null || isString(item.imageRef))
  );
}

/**
 * 기기에 저장돼 있던 값을 검증한다. 형식·소유자·수량·옵션 배열·금액·버전을 확인한다.
 * 손상됐거나 지원하지 않는 버전이면 null. 호출한 쪽은 조용히 초기화하지 않고 사용자에게 알린다.
 */
export function parseGuestCart(raw: unknown): CartEnvelope | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const cart = raw as Record<string, unknown>;
  const owner = cart.owner as Record<string, unknown> | null | undefined;
  const valid =
    cart.schemaVersion === CART_SCHEMA_VERSION &&
    owner?.kind === 'guest' &&
    isString(cart.localCartId) &&
    isSafeInt(cart.localRevision, 0) &&
    typeof cart.hasUserMutation === 'boolean' &&
    (cart.storeId === null || isString(cart.storeId)) &&
    Array.isArray(cart.items) &&
    cart.items.every(isCartItem) &&
    (cart.items.length === 0) === (cart.storeId === null) &&
    (cart.baseServerRevision === null || isSafeInt(cart.baseServerRevision, 0)) &&
    isSafeInt(cart.acknowledgedLocalRevision, 0);
  return valid ? (raw as CartEnvelope) : null;
}
