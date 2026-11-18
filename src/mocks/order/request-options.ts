import type { Uuid } from '@/contracts/common';

import type { CreateOrderItem } from './types';

/**
 * 주문 요청 항목의 옵션을 (옵션 id, 수량) 목록으로 푼다. requestVersion 2의 optionIds는 옵션마다 1개, 3의 options는 그대로다.
 * 같은 옵션이 두 번 나오거나 두 모양이 섞여 있으면 null이다(서버의 INVALID_INPUT과 같다).
 */
export function requestItemOptions(item: CreateOrderItem): { optionId: Uuid; quantity: number }[] | null {
  const hasIds = 'optionIds' in item;
  const hasOptions = 'options' in item;
  if (hasIds === hasOptions) return null;
  const list = hasIds ? (item as { optionIds: Uuid[] }).optionIds.map((optionId) => ({ optionId, quantity: 1 })) : (item as { options: { optionId: Uuid; quantity: number }[] }).options;
  if (new Set(list.map((o) => o.optionId.toLowerCase())).size !== list.length) return null;
  if (list.some((o) => !Number.isInteger(o.quantity) || o.quantity < 1)) return null;
  return list;
}
