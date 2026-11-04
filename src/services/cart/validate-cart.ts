import type { Uuid, Won } from '@/contracts/common';
import type { MenuDetailDto } from '@/contracts/catalog';
import { MockCartValidationError, type MockCartItemValidation, type MockCartValidationResult } from '@/mocks/cart/mock-cart-validation';
import { isRepositoryError, type CatalogRepository } from '@/services/catalog/catalog-repository';

export type CartValidationInput = {
  storeId: Uuid | null;
  items: { clientItemId: string; menuId: Uuid; optionIds: Uuid[]; acknowledgedUnitPrice: Won }[];
};

/**
 * supabase 모드의 장바구니 가격·품절 확인. 서버에 장바구니 검증 함수가 없어서(주문 생성이 가격·품절을 다시 검증한다)
 * 담긴 메뉴를 서버 카탈로그(get_menu)로 다시 읽어 화면에 보여 줄 상태를 만든다. 최종 판단은 주문 생성(create_order)이 한다.
 * - 메뉴가 없거나 비활성이면 RESOURCE_NOT_FOUND라서 INACTIVE_ENTITY, 선택한 옵션이 없거나 필수 그룹을 채우지 못하면 OPTIONS_INVALID
 * - 메뉴·옵션 품절은 MENU_SOLD_OUT · OPTION_SOLD_OUT, 현재 단가가 확인한 가격과 다르면 PRICE_CHANGED
 * - 가게 영업 상태는 메뉴 응답의 storeIsOpen이다(담긴 메뉴 중 하나라도 닫혀 있으면 닫힘)
 * 네트워크 문제는 NETWORK_UNAVAILABLE, 그 밖의 읽기 실패는 VALIDATION_UNAVAILABLE이다.
 */
export function createCatalogCartValidator(catalog: Pick<CatalogRepository, 'getMenu'>) {
  return async function validateCart(input: CartValidationInput): Promise<MockCartValidationResult> {
    const menuIds = [...new Set(input.items.map((item) => item.menuId))];
    const menus = new Map<Uuid, MenuDetailDto | null>();
    try {
      await Promise.all(
        menuIds.map(async (menuId) => {
          try {
            menus.set(menuId, await catalog.getMenu(menuId));
          } catch (error) {
            if (isRepositoryError(error) && error.failure.code === 'RESOURCE_NOT_FOUND') menus.set(menuId, null);
            else throw error;
          }
        }),
      );
    } catch (error) {
      const network = isRepositoryError(error) && (error.failure.code === 'NETWORK_UNAVAILABLE' || error.failure.code === 'REQUEST_TIMEOUT');
      throw new MockCartValidationError(network ? 'NETWORK_UNAVAILABLE' : 'VALIDATION_UNAVAILABLE');
    }

    const items: Record<string, MockCartItemValidation> = {};
    for (const item of input.items) {
      const menu = menus.get(item.menuId) ?? null;
      if (!menu || (input.storeId !== null && menu.storeId !== input.storeId)) {
        items[item.clientItemId] = { status: 'INACTIVE_ENTITY', currentUnitPrice: 0, currentCatalogRevision: 1 };
        continue;
      }
      const allOptions = menu.optionGroups.flatMap((g) => g.options);
      const selected = item.optionIds.map((optionId) => allOptions.find((o) => o.id === optionId));
      const currentUnitPrice = menu.price + selected.reduce((sum, o) => sum + (o?.additionalPrice ?? 0), 0);
      const base = { currentUnitPrice, currentCatalogRevision: menu.catalogRevision };
      const soldOutOption = selected.find((o) => o?.isSoldOut);
      const groupsOk = menu.optionGroups.every((g) => {
        const count = g.options.filter((o) => item.optionIds.includes(o.id)).length;
        return count >= g.minSelect && count <= g.maxSelect;
      });

      if (selected.some((o) => !o) || !groupsOk) items[item.clientItemId] = { ...base, status: 'OPTIONS_INVALID' };
      else if (menu.isSoldOut) items[item.clientItemId] = { ...base, status: 'MENU_SOLD_OUT' };
      else if (soldOutOption) items[item.clientItemId] = { ...base, status: 'OPTION_SOLD_OUT', soldOutOptionName: soldOutOption.name };
      else if (currentUnitPrice !== item.acknowledgedUnitPrice) items[item.clientItemId] = { ...base, status: 'PRICE_CHANGED' };
      else items[item.clientItemId] = { ...base, status: 'VALID' };
    }
    const storeIsOpen = [...menus.values()].every((menu) => menu === null || menu.storeIsOpen);
    return { items, storeIsOpen };
  };
}
