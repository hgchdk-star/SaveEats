import type { Uuid, Won } from '@/contracts/common';
import { mockCatalog } from '@/mocks/catalog/mock-catalog-repository';
import { mockDelay, mockScenario } from '@/mocks/scenario';

/**
 * 장바구니 서버 확인(개발 명세 CART-008) Mock.
 *
 * 장바구니 서버 계약은 아직 없다. 아래 타입은 이 폴더 안에서만 쓰는 임시 타입이며 합의된 계약이 아니다.
 * 값 이름은 명세 CART-008의 validation 표를 따랐다. 계약이 나오면 `src/contracts/`의 타입으로 바꾼다.
 * 금액과 주문 가능 여부의 최종 판단은 서버 몫이다. 여기 로직은 화면 상태를 보기 위한 흉내다.
 */
export type MockCartItemStatus =
  | 'VALID'
  | 'PRICE_CHANGED'
  | 'MENU_SOLD_OUT'
  | 'OPTION_SOLD_OUT'
  | 'INACTIVE_ENTITY'
  | 'OPTIONS_INVALID';

export type MockCartItemValidation = {
  status: MockCartItemStatus;
  /** 서버가 본 현재 단가. PRICE_CHANGED일 때 화면이 이전 가격과 나란히 보여준다 */
  currentUnitPrice: Won;
  currentCatalogRevision: number;
  /** OPTION_SOLD_OUT일 때 품절된 옵션 이름 */
  soldOutOptionName?: string;
};

export type MockCartValidationResult = {
  /** 키는 장바구니 항목의 clientItemId */
  items: Record<string, MockCartItemValidation>;
  /** 가게 영업 상태. false면 영업 종료 */
  storeIsOpen: boolean;
};

export type MockCartValidationFailure = 'VALIDATION_UNAVAILABLE' | 'NETWORK_UNAVAILABLE';

export class MockCartValidationError extends Error {
  readonly code: MockCartValidationFailure;

  constructor(code: MockCartValidationFailure) {
    super(code);
    this.name = 'MockCartValidationError';
    this.code = code;
  }
}

type ValidationInput = {
  storeId: Uuid | null;
  items: { clientItemId: string; menuId: Uuid; optionIds: Uuid[]; acknowledgedUnitPrice: Won }[];
};

/** 시나리오가 지정한 상태를 첫 항목에 입힌다. 나머지는 가상 카탈로그의 현재 값으로 판단한다 */
export async function mockValidateCart(input: ValidationInput): Promise<MockCartValidationResult> {
  await mockDelay();
  if (mockScenario.cartValidation === 'offline') throw new MockCartValidationError('NETWORK_UNAVAILABLE');
  if (mockScenario.cartValidation === 'unavailable') throw new MockCartValidationError('VALIDATION_UNAVAILABLE');

  const items: Record<string, MockCartItemValidation> = {};
  input.items.forEach((item, index) => {
    const menu = mockCatalog.anyMenu(item.menuId);
    const options = (menu?.optionGroups ?? []).flatMap((g) => g.options);
    const selected = item.optionIds.map((optionId) => options.find((o) => o.id === optionId));
    const currentUnitPrice = (menu?.price ?? 0) + selected.reduce((sum, o) => sum + (o?.additionalPrice ?? 0), 0);
    const base = { currentUnitPrice, currentCatalogRevision: menu?.catalogRevision ?? 0 };
    const soldOutOption = selected.find((o) => o?.isSoldOut);

    let result: MockCartItemValidation;
    if (!menu || !menu.isActive) result = { ...base, status: 'INACTIVE_ENTITY' };
    else if (selected.some((o) => !o)) result = { ...base, status: 'OPTIONS_INVALID' };
    else if (menu.isSoldOut) result = { ...base, status: 'MENU_SOLD_OUT' };
    else if (soldOutOption) result = { ...base, status: 'OPTION_SOLD_OUT', soldOutOptionName: soldOutOption.name };
    else if (currentUnitPrice !== item.acknowledgedUnitPrice) result = { ...base, status: 'PRICE_CHANGED' };
    else result = { ...base, status: 'VALID' };

    if (index === 0 && result.status === 'VALID') {
      switch (mockScenario.cartValidation) {
        case 'priceChanged':
          result = { status: 'PRICE_CHANGED', currentUnitPrice: currentUnitPrice + 1000, currentCatalogRevision: base.currentCatalogRevision + 1 };
          break;
        case 'menuSoldOut':
          result = { ...base, status: 'MENU_SOLD_OUT' };
          break;
        case 'optionSoldOut':
          result = { ...base, status: 'OPTION_SOLD_OUT', soldOutOptionName: selected[0]?.name ?? '선택한 옵션' };
          break;
        case 'inactive':
          result = { ...base, status: 'INACTIVE_ENTITY' };
          break;
        case 'optionsInvalid':
          result = { ...base, status: 'OPTIONS_INVALID' };
          break;
        default:
          break;
      }
    }
    items[item.clientItemId] = result;
  });

  const store = input.storeId ? mockCatalog.store(input.storeId) : null;
  return { items, storeIsOpen: store?.isOpen ?? true };
}
