/**
 * FE/BE 공통 계약 타입 (개발 명세 API-001, REC-003)
 *
 * 수정 규칙: 지우·혜지 합의 후 지우가 수정하고 혜지가 PR에서 검수한다 (CLAUDE.md 담당 영역).
 */

/** UUID 문자열 */
export type Uuid = string;

/** 원 단위 정수 금액 (KRW). JS 안전 정수 범위를 넘는 값은 조용히 변환하지 않는다 */
export type Won = number;

/** UTC RFC3339 문자열. KST 표시는 앱 util에서 변환한다 */
export type IsoTimestamp = string;

/** 공통 목록 응답 */
export interface Page<T> {
  items: T[];
  /** 다음 페이지 요청에 그대로 넘기는 opaque 문자열. 마지막 페이지면 null */
  nextCursor: string | null;
  hasMore: boolean;
}

export type ApiErrorCategory = 'AUTH' | 'VALIDATION' | 'CONFLICT' | 'NETWORK' | 'LOCAL' | 'INTERNAL';

/**
 * repository가 SDK/PostgREST 오류를 정규화한 실패 결과.
 * raw SQL·JWT·계좌·딥링크·signed URL을 safeDetails에 넣지 않는다.
 */
export interface ApiFailure<Code extends string = string> {
  code: Code;
  category: ApiErrorCategory;
  retryable: boolean;
  /** 요청이 서버에서 적용됐는지 알 수 없음 (응답 유실 등) */
  outcomeUnknown: boolean;
  correlationId: string | null;
  safeDetails?: Record<string, unknown>;
}
