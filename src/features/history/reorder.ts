import type { MenuDetailDto } from '@/contracts/catalog';
import type { Uuid } from '@/contracts/common';
import { LIMITS } from '@/config/limits';
import {
  allowsQuantity,
  isExclusiveOption,
  selectedOptionNames,
  selectedOptionQuantities,
  totalLimitOf,
  unitPrice,
  type OptionQuantities,
  type Selection,
} from '@/features/menu/menu-selection';
import type { MockOrderSnapshot } from '@/mocks/order/types';

import type { AddToCartInput } from '@/features/cart/cart-model';
import type { CartEditResult } from '@/features/cart/cart-store';

/**
 * 내역의 '같은 주문 담기': 지난 주문의 줄(메뉴·옵션·옵션 수량·메뉴 수량)을 지금 메뉴 기준으로 다시 장바구니에 담는다.
 *
 * 원칙
 * - 주문 기록(스냅샷)은 어떤 것도 바꾸지 않는다. 장바구니에는 지금 메뉴(get_menu)의 가격·옵션·revision을 쓴다. 주문 당시 가격은 쓰지 않는다.
 * - 옵션은 주문 당시 옵션 식별자(optionId)로만 현재 옵션과 맞춘다. 이름이나 순서로 추측하지 않는다.
 *   식별자가 없는 주문(옛 서버 응답)에 옵션이 있으면 담지 않고 알린다.
 * - 지금 규칙(그룹 선택 수·단독 옵션·옵션 수량·그룹 수량 합계)을 다시 검사해, 같은 구성을 지금도 만들 수 있을 때만 담는다.
 * - 모든 줄을 먼저 확인하고, 하나라도 담을 수 없으면 아무것도 담지 않는다(일부만 담기지 않는다).
 */
type SnapshotLine = MockOrderSnapshot['items'][number];

export type ReorderFailure =
  /** 메뉴·가게·분류가 지금은 없거나 비활성 */
  | 'MENU_UNAVAILABLE'
  | 'MENU_SOLD_OUT'
  | 'STORE_CLOSED'
  /** 주문 당시 옵션이 지금은 없거나 비활성 */
  | 'OPTION_UNAVAILABLE'
  | 'OPTION_SOLD_OUT'
  /** 옵션은 있지만 지금 규칙으로는 같은 구성을 만들 수 없다(필수 그룹 추가, 최대 개수·수량 변경, 단독 옵션 등) */
  | 'OPTIONS_CHANGED'
  /** 주문 응답에 옵션 식별자가 없어 같은 옵션을 찾을 수 없다 */
  | 'OPTION_INFO_MISSING'
  | 'LOAD_FAILED';

export type RebuiltLine = { input: AddToCartInput; priceChanged: boolean };
export type RebuildResult = { ok: true; line: RebuiltLine } | { ok: false; reason: ReorderFailure };

/** 한 줄을 현재 메뉴에 맞춰 다시 만든다. 순수 함수 */
export function rebuildLine(line: SnapshotLine, menu: MenuDetailDto, preparingStoreOrderable: boolean): RebuildResult {
  if (menu.isSoldOut) return { ok: false, reason: 'MENU_SOLD_OUT' };
  if (!preparingStoreOrderable && !menu.storeIsOpen) return { ok: false, reason: 'STORE_CLOSED' };
  if (line.options.some((o) => !o.optionId)) return { ok: false, reason: 'OPTION_INFO_MISSING' };
  if (!Number.isInteger(line.quantity) || line.quantity < LIMITS.quantityMin || line.quantity > LIMITS.quantityMax) return { ok: false, reason: 'OPTIONS_CHANGED' };

  const selection: Selection = {};
  const quantities: OptionQuantities = {};
  const seen = new Set<Uuid>();
  for (const picked of line.options) {
    const optionId = picked.optionId as Uuid;
    if (seen.has(optionId)) return { ok: false, reason: 'OPTIONS_CHANGED' };
    seen.add(optionId);
    const group = menu.optionGroups.find((g) => g.options.some((o) => o.id === optionId));
    const option = group?.options.find((o) => o.id === optionId);
    // 주문 당시 그룹과 지금 그룹이 다르면(옵션이 다른 그룹으로 옮겨짐) 같은 구성이 아니다
    if (!group || !option || (picked.groupId && picked.groupId !== group.id)) return { ok: false, reason: 'OPTION_UNAVAILABLE' };
    if (option.isSoldOut) return { ok: false, reason: 'OPTION_SOLD_OUT' };
    if (!Number.isInteger(picked.quantity) || picked.quantity < 1) return { ok: false, reason: 'OPTIONS_CHANGED' };
    if (picked.quantity > 1) {
      if (!allowsQuantity(option) || picked.quantity > (option.maxQuantity as number)) return { ok: false, reason: 'OPTIONS_CHANGED' };
      quantities[optionId] = picked.quantity;
    }
    (selection[group.id] ??= []).push(optionId);
  }

  // 지금 규칙으로 다시 검사: 서버가 주문 때 검사하는 것과 같은 기준이다(그룹의 고른 옵션 종류 수, 단독 옵션, 그룹 수량 합계)
  for (const group of menu.optionGroups) {
    const picked = selection[group.id] ?? [];
    if (picked.length < group.minSelect || picked.length > group.maxSelect) return { ok: false, reason: 'OPTIONS_CHANGED' };
    if (picked.length > 1 && group.options.some((o) => picked.includes(o.id) && isExclusiveOption(o))) return { ok: false, reason: 'OPTIONS_CHANGED' };
    const limit = totalLimitOf(group);
    if (limit !== null && picked.reduce((sum, id) => sum + (quantities[id] ?? 1), 0) > limit) return { ok: false, reason: 'OPTIONS_CHANGED' };
  }

  const current = unitPrice(menu, selection, quantities);
  return {
    ok: true,
    line: {
      // 지금 메뉴의 가격·revision·이름을 쓴다. 주문 당시 값은 쓰지 않는다
      priceChanged: current !== line.unitPrice,
      input: {
        storeId: menu.storeId,
        menuId: menu.id,
        optionIds: Object.values(selection).flat(),
        optionQuantities: selectedOptionQuantities(menu, selection, quantities),
        quantity: line.quantity,
        unitPrice: current,
        catalogRevision: menu.catalogRevision,
        menuName: menu.name,
        optionNames: selectedOptionNames(menu, selection, quantities),
        imageRef: menu.imageRef,
      },
    },
  };
}

export type ReorderOutcome =
  | { kind: 'ADDED'; priceChanged: boolean }
  /** 장바구니에 다른 가게 메뉴가 있다. 아무것도 담지 않았다. 교체 확인 뒤 replaceOtherStore로 다시 부른다 */
  | { kind: 'OTHER_STORE' }
  | { kind: 'FAILED'; reason: ReorderFailure | 'OVER_LIMIT' | 'OVER_KINDS' | 'SAVE_FAILED' | 'NOT_READY' };

export type ReorderDeps = {
  getMenu: (menuId: Uuid) => Promise<MenuDetailDto>;
  addMany: (inputs: AddToCartInput[], options?: { replaceOtherStore?: boolean }) => Promise<CartEditResult>;
  preparingStoreOrderable: boolean;
  /** getMenu가 던진 오류가 '없거나 비활성(RESOURCE_NOT_FOUND)'인지. 그 밖의 오류는 불러오기 실패로 본다 */
  isNotFound: (error: unknown) => boolean;
};

export async function reorderLines(lines: readonly SnapshotLine[], deps: ReorderDeps, options: { replaceOtherStore?: boolean } = {}): Promise<ReorderOutcome> {
  if (lines.length === 0) return { kind: 'FAILED', reason: 'MENU_UNAVAILABLE' };
  const menuIds = [...new Set(lines.map((l) => l.menuId))];
  const menus = new Map<Uuid, MenuDetailDto>();
  // 모든 메뉴를 먼저 확인한다. 하나라도 불러오지 못하면 아무것도 담지 않는다
  const loaded = await Promise.all(
    menuIds.map(async (id) => {
      try {
        return { id, menu: await deps.getMenu(id) } as const;
      } catch (error) {
        return { id, error } as const;
      }
    }),
  );
  for (const item of loaded) {
    if ('error' in item) return { kind: 'FAILED', reason: deps.isNotFound(item.error) ? 'MENU_UNAVAILABLE' : 'LOAD_FAILED' };
    menus.set(item.id, item.menu);
  }

  const rebuilt: RebuiltLine[] = [];
  for (const line of lines) {
    const result = rebuildLine(line, menus.get(line.menuId) as MenuDetailDto, deps.preparingStoreOrderable);
    if (!result.ok) return { kind: 'FAILED', reason: result.reason };
    rebuilt.push(result.line);
  }
  // 한 주문의 줄은 모두 같은 가게여야 한다
  if (new Set(rebuilt.map((r) => r.input.storeId)).size !== 1) return { kind: 'FAILED', reason: 'MENU_UNAVAILABLE' };

  let result: CartEditResult;
  try {
    result = await deps.addMany(rebuilt.map((r) => r.input), { replaceOtherStore: options.replaceOtherStore === true });
  } catch {
    return { kind: 'FAILED', reason: 'SAVE_FAILED' }; // 알 수 없는 오류도 성공으로 보지 않는다
  }
  if (result.ok) return { kind: 'ADDED', priceChanged: rebuilt.some((r) => r.priceChanged) };
  if (result.reason === 'OTHER_STORE') return { kind: 'OTHER_STORE' };
  return { kind: 'FAILED', reason: result.reason };
}
