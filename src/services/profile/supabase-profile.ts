import { LIMITS } from '@/config/limits';
import { CATALOG_RPC, type ProfileErrorCode, type SetMyNicknameRpcArgs } from '@/contracts/catalog';
import type { MockProfile, MyService } from '@/mocks/my/types';
import { ServiceError } from '@/services/service-error';
import { getSession } from '@/services/session';
import { getSupabaseClient } from '@/services/supabase/client';
import { maskEmail } from '@/utils/mask';

/**
 * 닉네임 저장·프로필 조회 (혜지와 합의 2026-11-03, 서버 배포 전이다). 모양은 src/contracts/catalog.ts.
 * - set_my_nickname({ p_nickname }) → { nickname }. 가입 직후 저장과 설정에서 변경에 같이 쓴다. 같은 값을 다시 보내도 같은 결과다.
 *   오류는 NICKNAME_INVALID와 AUTH_REQUIRED다. 서버는 앞뒤 일반 공백만 지우고 탭·줄바꿈·전각 공백은 거절하지만, 앱은 먼저 trim()한다.
 * - get_my_profile() → { nickname: null | 문자열 }. profiles 테이블을 select *로 읽지 않는다. name은 받지 않는다.
 * 서버 오류 원문은 화면에 올리지 않고 코드만 던진다.
 */
const SET_MY_NICKNAME = CATALOG_RPC.setMyNickname;
const GET_MY_PROFILE = CATALOG_RPC.getMyProfile;

async function call(name: string, args?: SetMyNicknameRpcArgs): Promise<unknown> {
  const client = getSupabaseClient();
  if (!client) throw new ServiceError('AUTH_UNAVAILABLE');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIMITS.serverRequestTimeoutMs);
  try {
    const { data, error } = await client.rpc(name, args).abortSignal(controller.signal);
    if (error) {
      if (error.code === 'P0001' && (error.message as ProfileErrorCode) === 'NICKNAME_INVALID') throw new ServiceError('NICKNAME_INVALID');
      if (error.code === 'P0001' && (error.message as ProfileErrorCode) === 'AUTH_REQUIRED') throw new ServiceError('AUTH_REQUIRED');
      if (error.code === '42501') throw new ServiceError('AUTH_REQUIRED');
      // 서버가 응답한 오류는 code가 있다. 없으면 응답을 받지 못한 것이다
      throw new ServiceError(error.code ? 'PROFILE_FAILED' : 'NETWORK_UNAVAILABLE');
    }
    return data;
  } catch (e) {
    if (e instanceof ServiceError) throw e;
    // AbortError(시간 초과)나 연결 실패
    throw new ServiceError('NETWORK_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
  }
}

function parseNickname(data: unknown): string | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data) || !('nickname' in data)) throw new ServiceError('PROFILE_FAILED');
  const value = (data as { nickname: unknown }).nickname;
  if (value === null || typeof value === 'string') return value;
  throw new ServiceError('PROFILE_FAILED');
}

/** 닉네임 · 프로필 부분만 서버로 바꾼다. 알림·누적 기록은 base(Mock) 그대로다 */
export function createSupabaseMyService(base: MyService): MyService {
  return {
    ...base,
    async getProfile(): Promise<MockProfile> {
      const nickname = parseNickname(await call(GET_MY_PROFILE));
      return { nickname, maskedEmail: maskEmail(getSession().email ?? '') };
    },
    async saveNickname(nickname) {
      parseNickname(await call(SET_MY_NICKNAME, { p_nickname: nickname } satisfies SetMyNicknameRpcArgs));
    },
  };
}
