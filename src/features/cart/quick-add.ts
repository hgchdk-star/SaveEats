import type { MenuDetailDto } from '@/contracts/catalog';
import type { Uuid } from '@/contracts/common';
import { isRequired, unitPrice } from '@/features/menu/menu-selection';

import type { AddToCartInput } from './cart-model';
import type { CartEditResult } from './cart-store';

/**
 * 가게 메뉴 목록·가게 안 검색 결과에서 상세를 열지 않고 바로 담기.
 *
 * 규칙 (필수 여부는 표시 문구나 그룹 이름이 아니라 서버가 실제로 검증하는 기준으로 정한다)
 * - 서버는 활성 옵션 그룹마다 '고른 옵션 종류 수'가 min_select ~ max_select 안인지 검사한다(INVALID_OPTIONS).
 *   그래서 minSelect >= 1 인 그룹이 하나라도 있으면 필수 옵션이 있는 메뉴다 → 상세로 보내 직접 고르게 한다.
 *   필수 옵션을 임의로 고르거나 기본값으로 확정하지 않는다.
 * - 목록 응답에는 옵션 정보가 없다. 누른 메뉴의 최신 상세(get_menu)를 그때 한 번 조회해 판단한다(목록 전체를 미리 조회하지 않는다).
 *   조회에 실패하면 '필수 옵션 없음'으로 보지 않고 실패로 알린다.
 * - 담기는 상세 화면과 같은 장바구니 추가 로직(add)을 쓴다: 병합·다른 가게 교체 확인·수량 상한·저장 실패 처리가 같다.
 *   최신 가격(unitPrice)과 catalogRevision은 방금 조회한 상세 값이다.
 */
export type QuickAddOutcome =
  | { kind: 'ADDED' }
  /** 필수 옵션이 있어 상세에서 직접 골라야 한다. 아무것도 담지 않았다 */
  | { kind: 'NEEDS_DETAIL' }
  | { kind: 'BLOCKED'; reason: 'SOLD_OUT' | 'STORE_CLOSED' }
  /** 장바구니에 다른 가게 메뉴가 있다. 교체 확인 뒤 replaceOtherStore로 다시 부른다 */
  | { kind: 'OTHER_STORE' }
  | { kind: 'FAILED'; reason: 'LOAD_FAILED' | 'OVER_LIMIT' | 'OVER_KINDS' | 'SAVE_FAILED' | 'NOT_READY' };

export type QuickAddDeps = {
  getMenu: (menuId: Uuid) => Promise<MenuDetailDto>;
  add: (input: AddToCartInput, options?: { replaceOtherStore?: boolean }) => Promise<CartEditResult>;
  /** 준비 중(영업 종료) 가게의 메뉴도 담을 수 있는지(설정값 UNDECIDED.preparingStoreOrderable) */
  preparingStoreOrderable: boolean;
};

/** 필수 옵션 그룹이 하나라도 있으면 true. 판단 기준은 서버 검증과 같은 minSelect >= 1 */
export function hasRequiredOptions(menu: MenuDetailDto): boolean {
  return menu.optionGroups.some(isRequired);
}

export async function quickAddMenu(menuId: Uuid, deps: QuickAddDeps, options: { replaceOtherStore?: boolean } = {}): Promise<QuickAddOutcome> {
  let menu: MenuDetailDto;
  try {
    menu = await deps.getMenu(menuId);
  } catch {
    // 가격·필수 옵션을 믿을 수 없으면 담지 않는다(FR-MENU-007). 실패를 '필수 옵션 없음'으로 보지 않는다
    return { kind: 'FAILED', reason: 'LOAD_FAILED' };
  }

  if (menu.isSoldOut) return { kind: 'BLOCKED', reason: 'SOLD_OUT' };
  if (!deps.preparingStoreOrderable && !menu.storeIsOpen) return { kind: 'BLOCKED', reason: 'STORE_CLOSED' };
  if (hasRequiredOptions(menu)) return { kind: 'NEEDS_DETAIL' };

  const result = await deps.add(
    {
      storeId: menu.storeId,
      menuId: menu.id,
      optionIds: [],
      optionQuantities: {},
      quantity: 1,
      unitPrice: unitPrice(menu, {}, {}),
      catalogRevision: menu.catalogRevision,
      menuName: menu.name,
      optionNames: [],
      imageRef: menu.imageRef,
    },
    { replaceOtherStore: options.replaceOtherStore === true },
  );
  if (result.ok) return { kind: 'ADDED' };
  if (result.reason === 'OTHER_STORE') return { kind: 'OTHER_STORE' };
  return { kind: 'FAILED', reason: result.reason };
}

/**
 * 담기 버튼이 한 번에 하나만 처리되게 하는 잠금. 처리 중에 다시 누르거나 다른 카드의 버튼을 눌러도 무시한다.
 * (React state는 다음 렌더에야 바뀌므로, 같은 프레임의 연속 터치는 이 잠금이 막는다)
 */
export function createSingleFlight() {
  let busyId: string | null = null;
  return {
    /** 시작하면 true, 이미 처리 중이면 false */
    tryStart(id: string): boolean {
      if (busyId !== null) return false;
      busyId = id;
      return true;
    },
    finish(): void {
      busyId = null;
    },
    get current(): string | null {
      return busyId;
    },
  };
}
