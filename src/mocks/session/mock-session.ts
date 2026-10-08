import { mockScenario } from '@/mocks/scenario';

/**
 * 로그인·계좌 상태 Mock.
 *
 * 로그인과 계좌 등록은 묶음 2에서 만든다. 그 전까지 홈 계좌 줄과 장바구니 '주문하기'의 분기를
 * 확인할 수 있도록 시나리오에서 상태를 고정해 준다. 아래 타입은 임시 타입이며 합의된 계약이 아니다.
 * 계좌번호 원문은 Mock에도 두지 않는다. 은행명과 끝 4자리만 쓴다.
 */
export type MockDestinationAccount = {
  bankName: string;
  last4: string;
};

export type MockSession = {
  isMember: boolean;
  destinationAccount: MockDestinationAccount | null;
};

export const mockSession: MockSession = {
  isMember: mockScenario.auth !== 'guest',
  destinationAccount: mockScenario.auth === 'member' ? { bankName: '토스뱅크', last4: '1234' } : null,
};
