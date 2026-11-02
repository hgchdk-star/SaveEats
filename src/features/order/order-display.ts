import type { MockOrder } from '@/mocks/order/types';
import { draftCopy } from '@/config/draft-copy';
import { formatWon } from '@/utils/format';

/**
 * 주문 후 화면(이어가기·완료 확인·완료·취소)에 보여줄 값.
 * 주문 당시의 Snapshot에서만 만든다. 현재 가게·메뉴·계좌 값으로 바꿔 보여주지 않는다 (ORD-007).
 */
export function displayOf(order: MockOrder) {
  const { snapshot } = order;
  return {
    storeName: snapshot.storeName,
    menuLine: snapshot.items.map((item) => `${item.menuName}${item.quantity > 1 ? ` ×${item.quantity}` : ''}`).join(' · '),
    total: order.approvedTotalAmount,
    totalLabel: formatWon(order.approvedTotalAmount),
    // 목적지는 이 기기에 저장한 값이다. 없으면 현재 계좌로 대신하지 않고 안내 문구를 보여준다
    bankName: snapshot.destination?.bankName,
    last4: snapshot.destination?.last4,
    accountLabel: snapshot.destination ? `${snapshot.destination.bankName} •••• ${snapshot.destination.last4}` : draftCopy.transfer.rawUnavailable,
  };
}
