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
  /** 로그인한 사용자 id. Guest면 null. 기기에 저장하는 개인 기록의 키를 사용자별로 나누는 데 쓴다 (AUTH-004) */
  userId: string | null;
  /** 로그인에 쓴 이메일(원문). 화면에는 마스킹해서만 보여준다 */
  email: string | null;
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

/** 시나리오가 처음부터 로그인 상태일 때의 가상 사용자 */
export const PRESET_USER = { userId: 'mock-user-1', email: 'saveeats.test@example.com' };

export const useMockSession = create<MockSessionState>(() => ({
  isMember: mockScenario.auth !== 'guest',
  userId: mockScenario.auth !== 'guest' ? PRESET_USER.userId : null,
  email: mockScenario.auth !== 'guest' ? PRESET_USER.email : null,
  destinationAccount: mockScenario.auth === 'member' ? PRESET_ACCOUNT : null,
}));
