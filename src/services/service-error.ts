/**
 * 서버·기기 기능 호출이 실패했을 때 던지는 오류 (카탈로그 밖 영역 공통).
 * outcomeUnknown이 true면 "요청이 적용됐는지 모른다"는 뜻이다. 실패로 단정하지 않고 같은 요청으로 확인한다.
 */
export class ServiceError<Code extends string = string> extends Error {
  readonly code: Code;
  readonly outcomeUnknown: boolean;

  constructor(code: Code, outcomeUnknown = false) {
    super(code);
    this.name = 'ServiceError';
    this.code = code;
    this.outcomeUnknown = outcomeUnknown;
  }
}

export function errorCode(error: unknown): string | null {
  return error instanceof ServiceError ? error.code : null;
}
