import { create } from 'zustand';

import { mockScenario } from '@/mocks/scenario';
import type { MockDestinationAccount } from '@/mocks/order/types';

/**
 * 로그인·계좌 상태 Mock.
 *
 * 실제 인증(Supabase Auth)과 계좌 저장이 붙으면 `src/services/session.ts`가 이것을 대신한다.
 * 계좌번호 원문은 Mock에도 두지 않는다. 은행명과 끝 4자리만 쓴다.
 */
type MockSessionState = {
  isMember: boolean;
  destinationAccount: MockDestinationAccount | null;
};

/** 시나리오가 "계좌 등록된 회원"일 때 처음부터 들어 있는 가상 계좌 */
export const PRESET_ACCOUNT: MockDestinationAccount = {
  id: 'mock-account-1',
  revision: 1,
  bankCode: 'TOSS',
  bankName: '토스뱅크',
  last4: '1234',
};

export const useMockSession = create<MockSessionState>(() => ({
  isMember: mockScenario.auth !== 'guest',
  destinationAccount: mockScenario.auth === 'member' ? PRESET_ACCOUNT : null,
}));
