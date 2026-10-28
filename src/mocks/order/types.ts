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
export type AuthFailureCode = 'INVALID_CREDENTIALS' | 'NETWORK_UNAVAILABLE';

export interface AuthService {
  signIn(input: SignInInput): Promise<{ userId: string }>;
  signUp(input: SignInInput): Promise<{ userId: string }>;
  signOut(): Promise<void>;
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
  cartId: string;
  expectedCartRevision: number;
  storeId: Uuid;
  accountId: string;
  expectedAccountRevision: number;
  items: { menuId: Uuid; optionIds: Uuid[]; quantity: number; approvedUnitPrice: Won; approvedCatalogRevision: number }[];
  approvedTotalAmount: Won;
  disclosureVersion: string;
  disclosureAcknowledged: true;
};

/** 주문 당시 값. 이후 가게·메뉴·계좌가 바뀌어도 그대로 보여준다 (ORD-007) */
export type MockOrderSnapshot = {
  storeName: string;
  storeImageRef: string | null;
  items: {
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

/** 서버가 명확히 거절한 경우와 결과를 모르는 경우를 구분한다 (ORD-006 · 011) */
export type OrderFailureCode =
  | 'PRICE_CHANGED'
  | 'ITEM_UNAVAILABLE'
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
  /** 실행 직전에 원격 설정을 조회한다. 앱 시작 때의 값을 재사용하지 않는다 (TRF-005) */
  getTransferConfig(): Promise<{ tossDeepLinkEnabled: boolean }>;
  /** 사용자가 버튼을 눌렀을 때만 호출한다. 실행만 하며 송금 성공을 뜻하지 않는다 (TRF-006) */
  openToss(input: { orderId: string; prefill: boolean }): Promise<void>;
  /** 인증 후 계좌 원문을 확인한다. 실패하면 마스킹 번호로 대신하지 않는다 (TRF-007) */
  resolveDestinationAccountNumber(orderId: string): Promise<string>;
}
