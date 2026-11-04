import type { HistoryPage, MockHistoryRow, MockReviewEligibility, ReviewEligibilityKind } from '@/mocks/history/types';
import type { MockOrder, MockOrderStatus } from '@/mocks/order/types';
import { ServiceError } from '@/services/service-error';

/**
 * 서버 주문 응답(order@0.1 초안)을 앱의 주문 모양으로 바꾼다.
 * - 합계는 서버 키 totalAmount, 앱 안에서는 approvedTotalAmount로 쓴다.
 * - replayed는 같은 키로 이미 만들어진 주문을 돌려받았다는 표시다.
 * - snapshot에는 목적지(은행·마스킹)가 없다. 목적지는 앱이 기기 보안 저장소에서 합친다(with-local-destination).
 * 모양이 맞지 않으면 ServiceError('INVALID_RESPONSE')를 던진다. 응답 내용은 오류에 담지 않는다.
 * TODO(혜지 서버 구현 후): 주문 API가 만들어지면 실제 주문 서비스가 이 함수를 쓴다. 지금은 서버가 없어 연결하지 않았다.
 */
const STATUSES: readonly string[] = ['PENDING', 'USER_CONFIRMED', 'CANCELLED'];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStrOrNull = (v: unknown): v is string | null => v === null || isStr(v);

export function parseOrderDto(data: unknown, idempotencyKey: string): MockOrder {
  const bad = () => new ServiceError('INVALID_RESPONSE');
  if (!isObj(data) || !isObj(data.snapshot) || !isObj(data.snapshot.store) || !Array.isArray(data.snapshot.items)) throw bad();
  const snap = data.snapshot;
  const store = snap.store as Record<string, unknown>;
  if (!isStr(data.orderId) || !isStr(data.status) || !STATUSES.includes(data.status) || !isNum(data.statusRevision) || !isStr(data.createdAt)) throw bad();
  if (!isStrOrNull(data.completedAt) || !isStrOrNull(data.cancelledAt) || !isNum(data.totalAmount)) throw bad();
  if (!isStr(store.id) || !isStr(store.name) || !isStrOrNull(store.imageRef) || !isStr(store.categoryName)) throw bad();

  const items = (snap.items as unknown[]).map((raw) => {
    if (!isObj(raw) || !Array.isArray(raw.options)) throw bad();
    if (!isStr(raw.menuId) || !isStr(raw.menuName) || !isStrOrNull(raw.menuImageRef) || !isNum(raw.unitPrice) || !isNum(raw.quantity) || !isNum(raw.lineTotal)) throw bad();
    const options = (raw.options as unknown[]).map((o) => {
      if (!isObj(o) || !isStr(o.groupName) || !isStr(o.optionName) || !isNum(o.additionalPrice)) throw bad();
      return { groupName: o.groupName, optionName: o.optionName, additionalPrice: o.additionalPrice };
    });
    return { menuId: raw.menuId, menuName: raw.menuName, menuImageRef: raw.menuImageRef, unitPrice: raw.unitPrice, quantity: raw.quantity, lineTotal: raw.lineTotal, options };
  });

  return {
    orderId: data.orderId,
    idempotencyKey,
    status: data.status as MockOrderStatus,
    statusRevision: data.statusRevision,
    createdAt: data.createdAt,
    completedAt: data.completedAt,
    cancelledAt: data.cancelledAt,
    approvedTotalAmount: data.totalAmount,
    replayed: data.replayed === true,
    snapshot: {
      storeId: store.id,
      storeName: store.name,
      storeImageRef: store.imageRef,
      categoryName: store.categoryName,
      items,
      destination: null,
    },
  };
}

/**
 * 서버 내역 목록 응답 (혜지 제안 2026-11-04, 서버 함수는 아직 없다): { items, hasMore, nextCursor }.
 * 인자는 p_page_size · p_cursor이고 cursor는 불투명 텍스트다(앱은 내용을 해석하지 않고 그대로 되돌려 보낸다).
 * 한 줄 = 주문 DTO + unreadUpdates[{eventId, revision, createdAt}] + validCurrentMenuRefs[menuId] (+ 있으면 reviewEligibility).
 * 첫 버전에는 reviewEligibility가 없다(리뷰 서버가 없음). 없으면 null로 두고 리뷰 작성 버튼을 숨긴다.
 * 목록의 주문에는 생성 키가 없다. 내역 화면은 키를 쓰지 않으므로 빈 문자열로 둔다.
 */
const ELIGIBILITIES: readonly string[] = ['CAN_WRITE', 'HAS_ACTIVE_REVIEW', 'DEADLINE_EXCEEDED', 'NOT_COMPLETED'];

function parseEligibility(value: unknown): MockReviewEligibility | null {
  if (value === undefined || value === null) return null;
  const bad = () => new ServiceError('INVALID_RESPONSE');
  if (!isObj(value) || !isStr(value.serverNow) || !isStrOrNull(value.completedAt) || !isStrOrNull(value.reviewDeadline) || !isStrOrNull(value.activeReviewId)) throw bad();
  if (!isStr(value.eligibility) || !ELIGIBILITIES.includes(value.eligibility)) throw bad();
  return {
    serverNow: value.serverNow,
    completedAt: value.completedAt,
    reviewDeadline: value.reviewDeadline,
    activeReviewId: value.activeReviewId,
    eligibility: value.eligibility as ReviewEligibilityKind,
  };
}

export function parseHistoryPageDto(data: unknown): HistoryPage {
  const bad = () => new ServiceError('INVALID_RESPONSE');
  if (!isObj(data) || !Array.isArray(data.items) || typeof data.hasMore !== 'boolean' || !isStrOrNull(data.nextCursor)) throw bad();
  const rows: MockHistoryRow[] = data.items.map((raw) => {
    if (!isObj(raw) || !Array.isArray(raw.unreadUpdates) || !Array.isArray(raw.validCurrentMenuRefs)) throw bad();
    const unreadUpdates = raw.unreadUpdates.map((u) => {
      if (!isObj(u) || !isStr(u.eventId) || !isNum(u.revision) || !isStr(u.createdAt)) throw bad();
      return { eventId: u.eventId, revision: u.revision, createdAt: u.createdAt };
    });
    if (!raw.validCurrentMenuRefs.every(isStr)) throw bad();
    return {
      ...parseOrderDto(raw, ''),
      unreadUpdates,
      reviewEligibility: parseEligibility(raw.reviewEligibility),
      validCurrentMenuRefs: raw.validCurrentMenuRefs as string[],
    };
  });
  return { rows, nextCursor: data.nextCursor, hasMore: data.hasMore };
}
