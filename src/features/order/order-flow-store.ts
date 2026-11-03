import { create } from 'zustand';

import type { MockOrder } from '@/mocks/order/types';

import type { CreateAttempt } from './order-persistence';

/**
 * 주문 흐름의 앱 내부 작업 상태 (ORD-003). 서버의 주문 status와 다르다.
 * 서버 status(PENDING·USER_CONFIRMED·CANCELLED)는 order.status에만 있다.
 */
export type OrderWork =
  | 'READY'
  /** 생성 요청을 기기에 저장하고 서버로 보내는 중. 버튼을 잠근다 */
  | 'CREATE_SAVING'
  /** 응답을 못 받아 주문이 만들어졌는지 모른다. 같은 키로 확인만 한다 */
  | 'CREATE_UNKNOWN'
  /** 전송하기 전에 기기 저장이 실패했다. 주문은 만들어지지 않았다 */
  | 'LOCAL_PERSISTENCE_FAILED'
  /** 서버가 가격·품절 등으로 명확히 거절했다 */
  | 'CREATE_REJECTED'
  /** 같은 키에 다른 내용이라 서버가 거절했다(IDEMPOTENCY_CONFLICT). 새 주문은 만들어지지 않았고, 기존 주문은 이어가지 않고 따로 보여 준다 */
  | 'CREATE_CONFLICT'
  | 'PENDING_READY'
  | 'CONFIRM_SYNCING'
  /** 완료 확인을 서버에 저장하지 못했다. 송금 실패가 아니다 */
  | 'CONFIRM_SAVE_FAILED'
  | 'SERVER_CONFIRMED'
  /** 주문 취소 결과를 받지 못했다. 취소됐다고 단정하지 않는다 */
  | 'CANCEL_UNKNOWN';

/** 주문 생성이 만들어지지 않았다고 확정된 거절. 장바구니 문제(앞의 넷)와 계좌 문제(ACCOUNT_*, 앱이 로컬에서 판단)로 나뉜다 */
export type RejectedReason = 'PRICE_CHANGED' | 'ITEM_UNAVAILABLE' | 'STORE_CLOSED' | 'INVALID_OPTIONS' | 'QUANTITY_LIMIT_EXCEEDED' | 'DISCLOSURE_VERSION_UNSUPPORTED' | 'ACCOUNT_REQUIRED' | 'ACCOUNT_REVISION_CONFLICT';

export type TransferState = {
  /** 이어가기 방식 */
  mode: 'TOSS' | 'DIRECT' | null;
  /** 실행 직전 조회한 원격 설정. false면 직접 이어가기로 시작했다 */
  tossConfigEnabled: boolean;
  /** 토스 실행 요청을 보내는 중 (버튼 잠금) */
  tossBusy: boolean;
  /** 토스를 열지 못해 직접 이어가기로 왔다 */
  tossFailed: boolean;
  /** 계좌 원문을 확인할 수 있는지. 확인하지 못하면 복사를 막는다 */
  rawAvailable: boolean;
  /** 외부 앱으로 보낸 뒤 돌아오기를 기다리는 중 */
  awaitingReturn: boolean;
};

type OrderFlowState = {
  work: OrderWork;
  attempt: CreateAttempt | null;
  rejectedReason: RejectedReason | null;
  order: MockOrder | null;
  /** CREATE_CONFLICT일 때 키로 조회한 기존 주문. 조회하지 못했으면 null. 이 주문은 order에 넣지 않는다(이어가기 대상이 아니다) */
  conflictOrder: MockOrder | null;
  confirmOperationId: string | null;
  cancelOperationId: string | null;
  transfer: TransferState;
  set: (patch: Partial<Omit<OrderFlowState, 'set' | 'setTransfer' | 'reset'>>) => void;
  setTransfer: (patch: Partial<TransferState>) => void;
  /** 새 주문 시도를 시작할 때 이전 시도의 흔적을 지운다 */
  reset: () => void;
};

const INITIAL_TRANSFER: TransferState = {
  mode: null,
  tossConfigEnabled: true,
  tossBusy: false,
  tossFailed: false,
  rawAvailable: true,
  awaitingReturn: false,
};

export const useOrderFlowStore = create<OrderFlowState>((set) => ({
  work: 'READY',
  attempt: null,
  rejectedReason: null,
  order: null,
  conflictOrder: null,
  confirmOperationId: null,
  cancelOperationId: null,
  transfer: INITIAL_TRANSFER,
  set: (patch) => set(patch),
  setTransfer: (patch) => set((s) => ({ transfer: { ...s.transfer, ...patch } })),
  reset: () =>
    set({
      work: 'READY',
      attempt: null,
      rejectedReason: null,
      order: null,
      conflictOrder: null,
      confirmOperationId: null,
      cancelOperationId: null,
      transfer: INITIAL_TRANSFER,
    }),
}));
