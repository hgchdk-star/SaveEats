import type { AuthError, Session } from '@supabase/supabase-js';
import { AppState } from 'react-native';

import type { AuthService, SignInInput } from '@/mocks/order/types';
import { ServiceError } from '@/services/service-error';
import { clearSessionUser, setSessionUser } from '@/services/session';
import { getSupabaseClient } from '@/services/supabase/client';

/**
 * Supabase Auth로 가입·로그인·세션 유지를 한다 (개발 명세 AUTH-001 ~ 005).
 *
 * - 이메일 + 비밀번호만 쓴다. 이메일 인증은 요구하지 않는다(서버 설정이 꺼져 있다). 닉네임은 정해지기 전이라 받지 않는다.
 * - 가입·로그인에 성공하면 ensure_my_profile을 부른다. 그 호출이 실패해도 가입·로그인 실패로 보지 않는다.
 *   같은 계정으로 프로필 만들기만 다시 시도한다(앱이 앞으로 올 때, 다음 실행 때).
 * - 비밀번호·토큰은 로그와 오류에 담지 않는다. 오류는 코드만 던진다.
 * - Guest를 위한 익명 로그인은 쓰지 않는다 (AUTH-001).
 * - 서버 권한은 서버가 JWT로 판단한다. 앱의 userId는 화면 분기와 기기 기록의 키로만 쓴다.
 */
let bound = false;
let explicitSignOut = false;
let profilePending = false;
const forcedListeners = new Set<() => void>();

function client() {
  const c = getSupabaseClient();
  if (!c) throw new ServiceError('AUTH_UNAVAILABLE');
  return c;
}

function toServiceError(error: AuthError): ServiceError {
  // 네트워크 문제와 자격 증명 문제를 구분한다 (AUTH-002)
  if (error.name === 'AuthRetryableFetchError' || error.status === 0) return new ServiceError('NETWORK_UNAVAILABLE', true);
  switch (error.code) {
    case 'invalid_credentials':
      return new ServiceError('INVALID_CREDENTIALS');
    case 'user_already_exists':
    case 'email_exists':
      return new ServiceError('EMAIL_ALREADY_REGISTERED');
    default:
      return new ServiceError('AUTH_FAILED');
  }
}

function apply(session: Session): void {
  setSessionUser({ userId: session.user.id, email: session.user.email ?? null });
}

/** 본인 최소 프로필을 만든다(이미 있으면 그대로). 실패는 던지지 않고 다시 시도할 일로 남긴다 */
async function ensureProfile(): Promise<void> {
  try {
    const { error } = await client().rpc('ensure_my_profile');
    profilePending = !!error;
  } catch {
    profilePending = true;
  }
}

/** 한 번만 연결한다: 세션 변화 구독, 앱이 앞뒤로 갈 때 토큰 갱신 시작·중지 */
function bind(): void {
  if (bound) return;
  bound = true;
  const c = client();

  c.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      // 사용자가 로그아웃한 경우는 logout()이 정리한다. 그 밖에(토큰 무효·다른 곳에서의 로그아웃)는 알린다
      if (!explicitSignOut) {
        clearSessionUser();
        forcedListeners.forEach((listener) => listener());
      }
      return;
    }
    if (session) apply(session);
  });

  const refresh = (state: string) => {
    if (state === 'active') {
      void c.auth.startAutoRefresh();
      if (profilePending) setTimeout(() => void ensureProfile(), 0);
    } else {
      void c.auth.stopAutoRefresh();
    }
  };
  AppState.addEventListener('change', refresh);
  refresh(AppState.currentState ?? 'active');
}

async function afterAuth(session: Session): Promise<void> {
  apply(session);
  await ensureProfile();
}

export function createSupabaseAuthService(): AuthService {
  return {
    async signIn({ email, password }: SignInInput) {
      bind();
      const { data, error } = await client().auth.signInWithPassword({ email, password });
      if (error) throw toServiceError(error);
      if (!data.session) throw new ServiceError('SESSION_NOT_CREATED');
      await afterAuth(data.session);
      return { userId: data.session.user.id };
    },

    async signUp({ email, password }: SignInInput) {
      bind();
      const { data, error } = await client().auth.signUp({ email, password });
      if (error) throw toServiceError(error);
      // 이미 가입된 이메일은 오류 대신 identities가 빈 사용자로 올 수 있다
      if (data.user && data.user.identities?.length === 0) throw new ServiceError('EMAIL_ALREADY_REGISTERED');
      // 이메일 인증을 끈 서버는 가입 직후 세션을 준다. 세션이 없으면 서버 설정이 다른 것이다
      if (!data.session) throw new ServiceError('SESSION_NOT_CREATED');
      await afterAuth(data.session);
      return { userId: data.session.user.id };
    },

    async signOut() {
      explicitSignOut = true;
      try {
        // 이 기기의 세션만 지운다. 이미 발급된 토큰이 서버에서 바로 무효가 된다고 가정하지 않는다 (AUTH-004)
        await client().auth.signOut({ scope: 'local' });
      } finally {
        explicitSignOut = false;
        clearSessionUser();
      }
    },

    async restore() {
      try {
        bind();
        const { data } = await client().auth.getSession();
        if (data.session) await afterAuth(data.session);
      } catch {
        // 복원하지 못하면 Guest로 둔다. 저장된 세션은 지우지 않아 다음에 다시 시도한다
      }
    },

    onForcedSignOut(listener) {
      forcedListeners.add(listener);
      return () => forcedListeners.delete(listener);
    },
  };
}
