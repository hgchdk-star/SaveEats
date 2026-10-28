import type { Uuid } from '@/contracts/common';
import { mockCategories, mockMenus, mockStores } from '@/mocks/catalog/data';
import type { MockDestinationAccount, MockOrderSnapshot } from '@/mocks/order/types';

export type SnapshotLine = { menuId: Uuid; optionIds: Uuid[]; quantity: number };

/**
 * 주문 당시의 이름·가격·옵션·계좌(마스킹)를 굳힌 값 (ORD-007).
 * 이후 가게나 메뉴가 바뀌거나 사라져도 이 값은 그대로 남는다. 비활성 메뉴도 이름을 찾을 수 있다.
 */
export function buildSnapshot(storeId: Uuid, lines: SnapshotLine[], account: Pick<MockDestinationAccount, 'bankName' | 'last4'>): { snapshot: MockOrderSnapshot; total: number } {
  const store = mockStores.find((s) => s.id === storeId);
  const category = mockCategories.find((c) => c.code === store?.categoryCode);
  let total = 0;
  const items = lines.map((line) => {
    const menu = mockMenus.find((m) => m.id === line.menuId);
    const options = (menu?.optionGroups ?? []).flatMap((g) => g.options.map((o) => ({ groupName: g.name, option: o })));
    const picked = line.optionIds.map((id) => options.find((o) => o.option.id === id)).filter((o): o is NonNullable<typeof o> => !!o);
    const unitPrice = (menu?.price ?? 0) + picked.reduce((sum, p) => sum + p.option.additionalPrice, 0);
    total += unitPrice * line.quantity;
    return {
      menuId: line.menuId,
      menuName: menu?.name ?? '',
      menuImageRef: menu?.imageRef ?? null,
      unitPrice,
      quantity: line.quantity,
      lineTotal: unitPrice * line.quantity,
      options: picked.map((p) => ({ groupName: p.groupName, optionName: p.option.name, additionalPrice: p.option.additionalPrice })),
    };
  });
  return {
    total,
    snapshot: {
      storeId,
      storeName: store?.name ?? '',
      storeImageRef: store?.imageRef ?? null,
      categoryName: category?.name ?? '',
      items,
      destination: { bankName: account.bankName, last4: account.last4 },
    },
  };
}
