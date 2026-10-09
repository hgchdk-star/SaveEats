import { UNDECIDED } from '@/config/undecided';
import type { MockHistoryRow, MockOrderStatus, MockReviewEligibility, MockUnreadSummary } from '@/mocks/history/types';
import type { MockOrder, MockOrderSnapshot } from '@/mocks/order/types';

/**
 * 내역 화면의 계산. 화면과 무관한 순수 함수만 둔다.
 * 금액·상태·작성 가능 여부는 서버가 알려준 값을 보여줄 뿐 여기서 새로 판단하지 않는다.
 */

/** 내역·리뷰 작성 화면의 메뉴 표시: 여러 메뉴면 "대표 메뉴 외 N개" (미결정 묶음3 #3) */
export function orderMenuLabel(snapshot: MockOrderSnapshot): string {
  const names = snapshot.items.map((i) => i.menuName);
  const first = names[0] ?? '';
  if (UNDECIDED.multiMenuOrderLabel === 'firstMenuPlusCount' && names.length > 1) return `${first} 외 ${names.length - 1}개`;
  return first;
}

export type RowStatus = 'pending' | 'saveFailed' | 'delivered' | 'cancelled';

/**
 * 내역 행의 상태 표시 (HIST-004).
 * PENDING인데 이 주문의 완료 확인이 기기에 저장돼 있으면 "완료 확인 저장" 문제를 먼저 보여준다.
 */
export function rowStatus(row: Pick<MockOrder, 'status' | 'orderId'>, queuedConfirmOrderId: string | null): RowStatus {
  if (row.status === 'USER_CONFIRMED') return 'delivered';
  if (row.status === 'CANCELLED') return 'cancelled';
  return queuedConfirmOrderId === row.orderId ? 'saveFailed' : 'pending';
}

/**
 * 읽음 대상으로 칠 수 있는 이벤트인지.
 * 처음 만든 PENDING 이벤트(revision 1)에 점을 달지는 미결정이다 (묶음3 #1). 설정이 false면 점도 읽음 대상도 아니다.
 */
function countsAsUnread(revision: number): boolean {
  return revision > 1 || UNDECIDED.initialPendingEventUnread;
}

/** 이 행에 화면상 남은 읽지 않은 이벤트 id = 서버가 읽지 않았다고 한 것 − 내가 이미 읽음 처리한 것(로컬 overlay) */
export function unreadEventIdsOf(row: MockHistoryRow, pendingReadIds: Readonly<Record<string, true>>): string[] {
  return row.unreadUpdates.filter((u) => countsAsUnread(u.revision) && !pendingReadIds[u.eventId]).map((u) => u.eventId);
}

/**
 * 내역 탭의 점 (FR-NAV-003): 불러온 페이지가 아니라 모든 본인 주문 기준.
 * 값을 아직 모르면(null) 점을 켜지도 끄지도 않고 없는 것으로 둔다. 모르는 값을 0으로 확정하지는 않는다.
 */
export function hasUnreadUpdate(unread: MockUnreadSummary['unreadEvents'] | null, pendingReadIds: Readonly<Record<string, true>>): boolean {
  if (!unread) return false;
  return unread.some((e) => countsAsUnread(e.revision) && !pendingReadIds[e.eventId]);
}

/** 리뷰 버튼 (REV-002). Case A·C = 리뷰 쓰기 / B = 작성 완료 · 보기 / D·E = 기간이 지났어요 / 그 외 = 버튼 없음 */
export type ReviewButton = 'available' | 'written' | 'expired';

export function reviewButtonOf(eligibility: MockReviewEligibility): ReviewButton | null {
  switch (eligibility.eligibility) {
    case 'CAN_WRITE':
      return 'available';
    case 'HAS_ACTIVE_REVIEW':
      return 'written';
    case 'DEADLINE_EXCEEDED':
      return 'expired';
    default:
      return null;
  }
}

/** 내역 행에서 주문 한 건(MockOrder)만 떼어낸다. 주문 이어가기·완료 확인 같은 주문 흐름은 이 값으로 동작한다 */
export function toOrder(row: MockHistoryRow): MockOrder {
  const { unreadUpdates, reviewEligibility, validCurrentMenuRefs, ...order } = row;
  void unreadUpdates;
  void reviewEligibility;
  void validCurrentMenuRefs;
  return order;
}

export type { MockOrderStatus };

/**
 * 가져온 최신 첫 페이지를 이미 불러온 목록에 합친다 (HIST-008의 가벼운 새로고침).
 * 같은 주문은 더 새로운 상태로 바꾸고(오래된 응답으로 되돌리지 않는다), 맨 위에 새 주문이 있으면 앞에 붙인다.
 * 이미 불러온 아래쪽 페이지는 그대로 둔다.
 */
export function mergeLatest(current: MockHistoryRow[], latest: MockHistoryRow[]): MockHistoryRow[] {
  const byId = new Map(current.map((r) => [r.orderId, r]));
  const fresh: MockHistoryRow[] = [];
  for (const row of latest) {
    const existing = byId.get(row.orderId);
    if (!existing) fresh.push(row);
    else if (row.statusRevision >= existing.statusRevision) byId.set(row.orderId, row);
  }
  const merged = current.map((r) => byId.get(r.orderId) ?? r);
  return [...fresh, ...merged].sort((a, b) => (a.createdAt === b.createdAt ? (a.orderId < b.orderId ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1));
}
