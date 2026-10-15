import type { MockDestinationAccount } from '@/mocks/order/types';
import { useMockSession } from '@/mocks/session/mock-session';

/**
 * 로그인·계좌 상태. 지금은 Mock 세션(EXPO_PUBLIC_MOCK_SCENARIO)을 읽는다.
 * 실제 인증과 계좌 조회가 붙으면 이 파일만 바꾼다. 화면은 이 두 함수만 안다.
 */
export type Session = { isMember: boolean; userId: string | null; email: string | null; destinationAccount: MockDestinationAccount | null };

/** 화면 밖(이벤트 핸들러, 저장소)에서 지금 값을 읽을 때 */
export function getSession(): Session {
  const { isMember, userId, email, destinationAccount } = useMockSession.getState();
  return { isMember, userId, email, destinationAccount };
}

/** 화면 안에서 쓴다. 로그인·계좌가 바뀌면 다시 그려진다 */
export function useSession(): Session {
  const isMember = useMockSession((s) => s.isMember);
  const userId = useMockSession((s) => s.userId);
  const email = useMockSession((s) => s.email);
  const destinationAccount = useMockSession((s) => s.destinationAccount);
  return { isMember, userId, email, destinationAccount };
}

/**
 * 기기에 저장하는 개인 기록의 키를 사용자별로 나눈다 (AUTH-004: 미동기화 완료 확인 큐·읽음 대기는 사용자별 격리).
 * 다른 계정으로 로그인하면 이 키가 달라서 이전 계정의 기록을 읽지도, 처리하지도 않는다. Guest는 'guest'.
 */
export function userScopedKey(base: string): string {
  return `${base}:${getSession().userId ?? 'guest'}`;
}
