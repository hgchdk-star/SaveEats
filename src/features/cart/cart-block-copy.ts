import type React from 'react';

import type { Notice } from '@/components/ui/notice';
import { draftCopy } from '@/config/draft-copy';

import type { CheckoutBlock } from './cart-model';

type NoticeProps = React.ComponentProps<typeof Notice>;
type Blocked = Extract<CheckoutBlock, { blocked: true }>;

/** 주문이 막힌 이유를 화면 위에 알린다. 한 번에 하나만, 가장 먼저 풀어야 할 것을 보여준다 */
export function noticeFor(block: CheckoutBlock, handlers: { acknowledge: () => void; retry: () => void }): NoticeProps | null {
  if (!block.blocked) return null;
  switch (block.reason) {
    case 'VALIDATION_UNAVAILABLE':
      // 개발 명세 CART-008 · FR-MENU-008 원문
      return { tone: 'danger', title: '옵션 정보를 불러오지 못했어요. 다시 불러와주세요.', action: { label: '다시 시도', onPress: handlers.retry } };
    case 'STORE_CLOSED':
      return { tone: 'danger', title: draftCopy.cart.storeClosedTitle, description: draftCopy.cart.storeClosedDesc };
    case 'PRICE_CHANGED':
      return {
        icon: 'refresh',
        title: draftCopy.cart.priceChangedTitle(block.count ?? 0),
        description: draftCopy.cart.priceChangedDesc,
        action: { label: draftCopy.cart.priceChangedAction, onPress: handlers.acknowledge },
      };
    case 'SOLD_OUT':
      return { tone: 'danger', title: draftCopy.cart.soldOutTitle, description: draftCopy.cart.soldOutDesc };
    case 'INACTIVE_ENTITY':
      return { tone: 'danger', title: draftCopy.cart.inactiveTitle, description: draftCopy.cart.inactiveDesc };
    case 'OPTIONS_INVALID':
      return { tone: 'danger', title: draftCopy.cart.optionsInvalidTitle, description: draftCopy.cart.optionsInvalidDesc };
    default:
      return null;
  }
}

/** CTA 바 위 한 줄. 주문하기가 왜 막혔는지 알린다 */
export function ctaNoteFor(block: CheckoutBlock): string | undefined {
  if (!block.blocked) return undefined;
  switch ((block as Blocked).reason) {
    case 'NETWORK_UNAVAILABLE':
      return '주문하려면 인터넷 연결이 필요해요.'; // 개발 명세 CART-009 카피 제안
    case 'VALIDATION_UNAVAILABLE':
      return draftCopy.cart.noteValidationUnavailable;
    case 'VALIDATING':
      return draftCopy.cart.noteValidating;
    case 'STORE_CLOSED':
      return draftCopy.menu.noteStoreClosed;
    case 'PRICE_CHANGED':
      return '바뀐 가격을 확인해야 주문할 수 있어요.';
    case 'SOLD_OUT':
    case 'INACTIVE_ENTITY':
      return draftCopy.cart.soldOutDesc;
    case 'OPTIONS_INVALID':
      return draftCopy.cart.optionsInvalidDesc;
    default:
      return undefined;
  }
}
