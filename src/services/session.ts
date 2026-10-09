import type { MockDestinationAccount } from '@/mocks/order/types';
import { useMockSession } from '@/mocks/session/mock-session';

/**
 * 로그인·계좌 상태. 지금은 Mock 세션(EXPO_PUBLIC_MOCK_SCENARIO)을 읽는다.
 * 실제 인증과 계좌 조회가 붙으면 이 파일만 바꾼다. 화면은 이 두 함수만 안다.
 */
export type Session = { isMember: boolean; destinationAccount: MockDestinationAccount | null };

/** 화면 밖(이벤트 핸들러, 저장소)에서 지금 값을 읽을 때 */
export function getSession(): Session {
  const { isMember, destinationAccount } = useMockSession.getState();
  return { isMember, destinationAccount };
}

/** 화면 안에서 쓴다. 로그인·계좌가 바뀌면 다시 그려진다 */
export function useSession(): Session {
  const isMember = useMockSession((s) => s.isMember);
  const destinationAccount = useMockSession((s) => s.destinationAccount);
  return { isMember, destinationAccount };
}
