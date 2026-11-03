import type { Uuid, Won } from '@/contracts/common';

/**
 * 묶음 2(로그인·계좌·주문 흐름)의 임시 타입.
 *
 * 이 영역은 서버 계약이 아직 없고 계좌·주문 정책도 일부 미결정이다. 아래 타입은 Mock과 화면을 이어 주기 위한
 * 임시 모양이며 합의된 계약이 아니다. 필드를 늘리거나 굳히지 말고, 계약이 나오면 `src/contracts/`의 타입으로 바꾼다.
 * 근거: 개발 명세 AUTH-002·003, DB-003, ORD-003~011, TRF-005~008.
 * 계좌번호 원문은 어떤 타입에도 넣지 않는다. 은행명과 끝 4자리만 쓴다.
 */

/* ---------- 인증 ---------- */

export type SignInInput = { email: string; password: string };

/** 로그인 실패는 인증 오류와 네트워크 오류를 구분한다 (AUTH-002) */
export type AuthFailureCode = 'INVALID_CREDENTIALS' | 'NETWORK_UNAVAILABLE' | 'EMAIL_ALREADY_REGISTERED' | 'SESSION_NOT_CREATED' | 'AUTH_UNAVAILABLE' | 'AUTH_FAILED';

export interface AuthService {
  signIn(input: SignInInput): Promise<{ userId: string }>;
  signUp(input: SignInInput): Promise<{ userId: string }>;
  signOut(): Promise<void>;
  /** 앱을 켤 때 저장된 세션을 복원한다. 세션이 없거나 복원하지 못하면 Guest로 둔다(던지지 않는다) */
  restore(): Promise<void>;
  /** 사용자가 로그아웃하지 않았는데 세션을 잃었을 때(토큰 만료·무효) 알린다. 해제 함수를 돌려준다 */
  onForcedSignOut(listener: () => void): () => void;
}

/* ---------- 계좌 (DB-003) ---------- */

export type MockBank = { bankCode: string; bankName: string };

/** 화면에 보여주는 값만 담는다. 전체 번호·잔액은 없다 */
export type MockDestinationAccount = {
  id: string;
  revision: number;
  bankCode: string;
  bankName: string;
  last4: string;
};

export type RegisterAccountInput = {
  bankCode: string;
  bankName: string;
  /** 입력 직후 서버로 보내고 앱에는 남기지 않는다. Mock은 끝 4자리만 쓰고 버린다 */
  accountNumber: string;
  mode: 'register' | 'change';
};

export interface AccountService {
  listBanks(): MockBank[];
  registerDestinationAccount(input: RegisterAccountInput): Promise<MockDestinationAccount>;
  deleteDestinationAccount(accountId: string): Promise<void>;
}

/* ---------- 주문 (ORD-004 · 007 · 011) ---------- */

export type MockOrderStatus = 'PENDING' | 'USER_CONFIRMED' | 'CANCELLED';

export type CreateOrderRequest = {
  idempotencyKey: string;
  requestVersion: number;
  storeId: Uuid;
  /** 돈이 갈 계좌의 비민감 참조(AccountVault의 destinationRef). 계좌 값은 서버에 보내지 않는다. 요청 v2 (혜지 합의 2026-11) */
  destinationRef: string;
  items: { menuId: Uuid; optionIds: Uuid[]; quantity: number; approvedUnitPrice: Won; approvedCatalogRevision: number }[];
  approvedTotalAmount: Won;
  disclosureVersion: string;
  disclosureAcknowledged: true;
};

/** 주문 당시 값. 이후 가게·메뉴·계좌가 바뀌어도 그대로 보여준다 (ORD-007) */
export type MockOrderSnapshot = {
  storeId: Uuid;
  storeName: string;
  storeImageRef: string | null;
  /** 주문 당시 카테고리 이름 (이번 달 요약의 "가장 많이 고른 음식") */
  categoryName: string;
  items: {
    menuId: Uuid;
    menuName: string;
    menuImageRef: string | null;
    unitPrice: Won;
    quantity: number;
    lineTotal: Won;
    options: { groupName: string; optionName: string; additionalPrice: Won }[];
  }[];
  destination: { bankName: string; last4: string };
};

export type MockOrder = {
  orderId: string;
  idempotencyKey: string;
  status: MockOrderStatus;
  statusRevision: number;
  createdAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  approvedTotalAmount: Won;
  snapshot: MockOrderSnapshot;
};

/**
 * 서버가 명확히 거절한 경우와 결과를 모르는 경우를 구분한다 (ORD-006 · 011).
 * 서버가 내는 거절: PRICE_CHANGED · ITEM_UNAVAILABLE · STORE_CLOSED · INVALID_OPTIONS (items · approvedUnitPrice · approvedTotalAmount를 카탈로그와 대조).
 * 항목별 상세는 오지 않고 코드만 온다. 앱이 장바구니 검증으로 다시 조회한다.
 * IDEMPOTENCY_CONFLICT: 같은 키에 다른 내용이면 서버는 오류만 주고 새 주문을 만들지 않는다. 앱은 키로 조회해 기존 주문을 보여 준다.
 * QUANTITY_LIMIT_EXCEEDED: 같은 메뉴·옵션 조합의 합산이 10을 넘으면 서버가 거절한다. 장바구니는 기기에만 있어 CART_REVISION_CONFLICT는 쓰지 않는다.
 * ACCOUNT_REQUIRED · ACCOUNT_REVISION_CONFLICT는 서버가 계좌를 몰라서 앱이 주문 전에 로컬에서 판단하는 코드다.
 */
export type OrderFailureCode =
  | 'PRICE_CHANGED'
  | 'ITEM_UNAVAILABLE'
  | 'STORE_CLOSED'
  | 'INVALID_OPTIONS'
  | 'QUANTITY_LIMIT_EXCEEDED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'ACCOUNT_REQUIRED'
  | 'ACCOUNT_REVISION_CONFLICT'
  | 'NETWORK_UNAVAILABLE'
  | 'REQUEST_TIMEOUT';

export interface OrderService {
  createOrder(request: CreateOrderRequest): Promise<MockOrder>;
  getOrderByRequestKey(idempotencyKey: string): Promise<MockOrder | null>;
  getOrderStatus(orderId: string): Promise<MockOrder>;
  confirmOrder(orderId: string, operationId: string): Promise<MockOrder>;
  cancelOrder(orderId: string, operationId: string): Promise<MockOrder>;
}

/* ---------- 송금 이어가기 (TRF-005~008) ---------- */

export interface TransferService {
  /**
   * 실행 직전에 원격 설정을 조회한다. 앱 시작 때의 값을 재사용하지 않는다 (TRF-005).
   * input의 은행이 이 플랫폼에서 사전입력이 검증된 조합이 아니면 tossDeepLinkEnabled는 false다.
   */
  getTransferConfig(input?: { bankName: string }): Promise<{ tossDeepLinkEnabled: boolean }>;
  /** 사용자가 버튼을 눌렀을 때만 호출한다. 실행만 하며 송금 성공을 뜻하지 않는다 (TRF-006) */
  openToss(input: { orderId: string; prefill: boolean }): Promise<void>;
  /** 인증 후 계좌 원문을 확인한다. 실패하면 마스킹 번호로 대신하지 않는다 (TRF-007) */
  resolveDestinationAccountNumber(orderId: string): Promise<string>;
}
