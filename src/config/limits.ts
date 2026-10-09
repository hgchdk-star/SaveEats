/** 한도와 상수. 근거는 기획서·PRD·개발 명세의 항목 번호 */
export const LIMITS = {
  /** 기획서 16 · FR-MENU-002 */
  quantityMin: 1,
  /** 기획서 16 · FR-MENU-003 · FR-CART-012 */
  quantityMax: 10,
  /** 기획서 11.3 · FR-HOME-009 */
  recentViewedMax: 10,
  toastDurationMs: 3000,
  /** 계좌번호 최소 자릿수 (프로토타입 값). 은행별 형식 검증은 서버가 한다 */
  accountNumberMinLength: 10,
  /** 비밀번호 최소 글자 수 (회원가입 도움말 "8자 이상") */
  passwordMinLength: 8,
  /** 토스 실행 직전 원격 설정 조회 제한 시간. 넘으면 직접 흐름 (TRF-005) */
  tossConfigTimeoutMs: 3000,
  /** 외부 앱에서 돌아온 뒤 주문 상태 조회를 기다리는 최대 시간. 넘으면 조회 실패 화면 (TRF-008) */
  statusQueryTimeoutMs: 10000,
  /** 상태 확인 화면이 뜬 뒤 조회를 시작하기까지 기다리는 시간. 화면 전환 애니메이션이 끝나도록 */
  returnCheckSettleMs: 700,
} as const;

/** 최종 주문 확인 고지 버전. 표시한 고지 문구의 버전을 요청에 함께 보낸다 (ORD-004) */
export const ORDER = {
  disclosureVersion: '2026-09-30',
  requestVersion: 1,
} as const;
