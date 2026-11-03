import { draftCopy } from '@/config/draft-copy';
import { errorCode } from '@/services/service-error';
import type { NicknameProblem } from '@/utils/nickname';

const copy = draftCopy.nickname;

/** 입력 규칙을 어겼을 때 입력칸 아래에 보여줄 문구 */
export function nicknameProblemText(problem: NicknameProblem): string {
  return problem === 'EMPTY' ? copy.errorEmpty : problem === 'LENGTH' ? copy.errorLength : copy.errorChars;
}

/** 저장 실패를 사용자용 문구로 바꾼다. 서버 오류 원문은 쓰지 않는다 */
export function saveFailureKind(error: unknown): 'invalid' | 'network' | 'unexpected' {
  const code = errorCode(error);
  return code === 'NICKNAME_INVALID' ? 'invalid' : code === 'NETWORK_UNAVAILABLE' ? 'network' : 'unexpected';
}
