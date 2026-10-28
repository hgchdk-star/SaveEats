import { mockSession, type MockSession } from '@/mocks/session/mock-session';

/**
 * 로그인·계좌 상태. 로그인(Supabase Auth)과 계좌 등록은 묶음 2에서 만든다.
 * 그 전까지는 Mock 시나리오(EXPO_PUBLIC_MOCK_SCENARIO)로 고정한 값을 돌려준다.
 * 화면은 이 함수만 읽는다. 실제 인증이 붙으면 이 파일만 바꾼다.
 */
export function getSession(): MockSession {
  return mockSession;
}
