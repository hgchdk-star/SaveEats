import { LIMITS } from '@/config/limits';

/**
 * 닉네임 규칙 (서정 확정 2026-11-02, OPEN-DB-004). 서버도 같은 규칙으로 검증한다.
 * - 앞뒤 공백을 지운 뒤 2~12자
 * - 완성형 한글(가-힣) · 영문 · 숫자만. 내부 공백 · 특수문자 · 이모지 · 자음/모음 단독은 안 된다
 * - 중복은 허용한다(중복 확인 없음)
 * 금칙어 · 사칭 대응의 운영 기준은 미결정이라 여기서 다루지 않는다.
 */
export type NicknameProblem = 'EMPTY' | 'LENGTH' | 'CHARS';

export type NicknameCheck = { ok: true; value: string } | { ok: false; problem: NicknameProblem };

const ALLOWED = /^[가-힣A-Za-z0-9]+$/;

export function checkNickname(raw: string): NicknameCheck {
  const value = raw.trim();
  if (value.length === 0) return { ok: false, problem: 'EMPTY' };
  // 허용 문자만 남기면 모두 한 글자가 한 칸이라 length가 곧 글자 수다. 이모지 같은 짝 문자는 아래 CHARS에서 걸린다
  if (!ALLOWED.test(value)) return { ok: false, problem: 'CHARS' };
  if (value.length < LIMITS.nicknameMinLength || value.length > LIMITS.nicknameMaxLength) return { ok: false, problem: 'LENGTH' };
  return { ok: true, value };
}
