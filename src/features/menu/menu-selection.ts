import type { MenuDetailDto, MenuOptionGroupDto } from '@/contracts/catalog';
import type { Uuid, Won } from '@/contracts/common';

/** 그룹별로 고른 옵션 id */
export type Selection = Record<Uuid, Uuid[]>;

export const isRequired = (group: MenuOptionGroupDto) => group.minSelect >= 1;
export const isSingle = (group: MenuOptionGroupDto) => group.maxSelect === 1;

/**
 * 옵션 하나를 눌렀을 때의 새 선택.
 * - 최대 1개(라디오): 다른 것을 누르면 바뀐다. 필수가 아니면 같은 것을 다시 눌러 해제할 수 있다
 * - 그 외(체크박스): 토글. 최대 개수에 닿으면 안 고른 나머지는 잠겨서 눌러도 바뀌지 않는다
 * - 품절 옵션은 고를 수 없다
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

/** 선택한 옵션 id를 그룹 순서대로 모은다 */
export function selectedOptionIds(menu: MenuDetailDto, selection: Selection): Uuid[] {
  return menu.optionGroups.flatMap((g) => selection[g.id] ?? []);
}

export function selectedOptionNames(menu: MenuDetailDto, selection: Selection): string[] {
  return menu.optionGroups.flatMap((g) => g.options.filter((o) => (selection[g.id] ?? []).includes(o.id)).map((o) => o.name));
}

/** 기본가격 + 옵션 추가금. 최종 금액은 여기에 수량을 곱한다 (FR-MENU-006). 서버가 주문 때 다시 검증한다 */
export function unitPrice(menu: MenuDetailDto, selection: Selection): Won {
  const extra = menu.optionGroups.flatMap((g) => g.options.filter((o) => (selection[g.id] ?? []).includes(o.id))).reduce((sum, o) => sum + o.additionalPrice, 0);
  return menu.price + extra;
}

/** 필수 옵션을 다 골랐는지. 안 골랐으면 첫 번째 그룹 이름을 돌려준다 */
export function firstMissingRequired(menu: MenuDetailDto, selection: Selection): string | null {
  const missing = menu.optionGroups.find((g) => isRequired(g) && (selection[g.id] ?? []).length < g.minSelect);
  return missing ? missing.name : null;
}
