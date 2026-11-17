import type { MenuDetailDto, MenuOptionDto, MenuOptionGroupDto } from '@/contracts/catalog';
import type { Uuid, Won } from '@/contracts/common';

/** 그룹별로 고른 옵션 id */
export type Selection = Record<Uuid, Uuid[]>;

/**
 * 옵션별 선택 수량 = 메뉴 한 개에 들어가는 옵션 개수. 메뉴 주문 수량과는 별개다.
 * 2개 이상일 때만 담는다(없으면 1개). 고르지 않은 옵션의 항목은 의미가 없다.
 */
export type OptionQuantities = Record<Uuid, number>;

export const isRequired = (group: MenuOptionGroupDto) => group.minSelect >= 1;
export const isSingle = (group: MenuOptionGroupDto) => group.maxSelect === 1;

/** 수량을 조절할 수 있는 옵션인가. 2개 이상 고를 수 있어야 조절할 의미가 있다 */
export const allowsQuantity = (option: MenuOptionDto): boolean => option.allowQuantity === true && typeof option.maxQuantity === 'number' && option.maxQuantity >= 2;

/** 고른 옵션의 수량. 정하지 않았으면 1개 */
export const quantityOf = (quantities: OptionQuantities, optionId: Uuid): number => quantities[optionId] ?? 1;

/**
 * 옵션 하나를 눌렀을 때의 새 선택.
 * - 최대 1개(라디오): 다른 것을 누르면 바뀐다. 필수가 아니면 같은 것을 다시 눌러 해제할 수 있다
 * - 그 외(체크박스): 토글. 최대 개수에 닿으면 안 고른 나머지는 잠겨서 눌러도 바뀌지 않는다
 * - 품절 옵션은 고를 수 없다
 * 그룹의 최대 개수는 '고른 옵션 종류 수'다. 같은 옵션의 수량은 세지 않는다.
 */
export function toggleOption(selection: Selection, group: MenuOptionGroupDto, optionId: Uuid): Selection {
  const option = group.options.find((o) => o.id === optionId);
  if (!option || option.isSoldOut) return selection;

  const current = selection[group.id] ?? [];
  const on = current.includes(optionId);
  let next: Uuid[];
  if (isSingle(group)) {
    next = on ? (isRequired(group) ? current : []) : [optionId];
  } else if (on) {
    next = current.filter((id) => id !== optionId);
  } else if (current.length >= group.maxSelect) {
    return selection;
  } else {
    next = [...current, optionId];
  }
  return { ...selection, [group.id]: next };
}

/** 선택에서 빠진 옵션의 수량을 지우고, 수량을 허용하지 않거나 상한을 넘는 값은 바로잡는다. 1개짜리는 담지 않는다 */
export function pruneQuantities(menu: MenuDetailDto, selection: Selection, quantities: OptionQuantities): OptionQuantities {
  const next: OptionQuantities = {};
  for (const group of menu.optionGroups) {
    const picked = selection[group.id] ?? [];
    for (const option of group.options) {
      const q = quantities[option.id];
      if (q === undefined || !picked.includes(option.id) || !allowsQuantity(option)) continue;
      const clamped = Math.min(option.maxQuantity as number, Math.max(1, Math.trunc(q)));
      if (clamped >= 2) next[option.id] = clamped;
    }
  }
  return next;
}

/**
 * 고른 옵션의 수량을 바꾼다. 고르지 않았거나 수량을 허용하지 않는 옵션이면 그대로 둔다.
 * 1 ~ 옵션의 maxQuantity 안으로 맞춘다. 상한은 서버가 옵션마다 정한 값이며 앱이 정하지 않는다.
 */
export function setOptionQuantity(menu: MenuDetailDto, selection: Selection, quantities: OptionQuantities, optionId: Uuid, requested: number): OptionQuantities {
  const found = menu.optionGroups.flatMap((g) => g.options.map((o) => ({ group: g, option: o }))).find((x) => x.option.id === optionId);
  if (!found || !allowsQuantity(found.option) || !(selection[found.group.id] ?? []).includes(optionId)) return quantities;
  const next = { ...quantities };
  const clamped = Math.min(found.option.maxQuantity as number, Math.max(1, Math.trunc(requested)));
  if (clamped >= 2) next[optionId] = clamped;
  else delete next[optionId];
  return next;
}

/** 선택한 옵션 id를 그룹 순서대로 모은다 */
export function selectedOptionIds(menu: MenuDetailDto, selection: Selection): Uuid[] {
  return menu.optionGroups.flatMap((g) => selection[g.id] ?? []);
}

/** 옵션 이름. 수량이 2개 이상이면 `이름 ×2`로 보여 준다 */
export function selectedOptionNames(menu: MenuDetailDto, selection: Selection, quantities: OptionQuantities = {}): string[] {
  return menu.optionGroups.flatMap((g) =>
    g.options
      .filter((o) => (selection[g.id] ?? []).includes(o.id))
      .map((o) => {
        const q = quantityOf(quantities, o.id);
        return q > 1 ? `${o.name} ×${q}` : o.name;
      }),
  );
}

/** 장바구니에 담을 옵션 수량(2개 이상인 것만). 수량을 허용하지 않는 옵션은 들어가지 않는다 */
export function selectedOptionQuantities(menu: MenuDetailDto, selection: Selection, quantities: OptionQuantities = {}): OptionQuantities {
  return pruneQuantities(menu, selection, quantities);
}

/** 기본가격 + Σ(옵션 추가금 × 옵션 수량). 최종 금액은 여기에 메뉴 수량을 곱한다 (FR-MENU-006). 서버가 주문 때 다시 검증한다 */
export function unitPrice(menu: MenuDetailDto, selection: Selection, quantities: OptionQuantities = {}): Won {
  const extra = menu.optionGroups
    .flatMap((g) => g.options.filter((o) => (selection[g.id] ?? []).includes(o.id)))
    .reduce((sum, o) => sum + o.additionalPrice * quantityOf(quantities, o.id), 0);
  return menu.price + extra;
}

/** 필수 옵션을 다 골랐는지. 안 골랐으면 첫 번째 그룹 이름을 돌려준다 */
export function firstMissingRequired(menu: MenuDetailDto, selection: Selection): string | null {
  const missing = menu.optionGroups.find((g) => isRequired(g) && (selection[g.id] ?? []).length < g.minSelect);
  return missing ? missing.name : null;
}
