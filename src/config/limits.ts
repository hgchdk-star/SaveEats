/** 한도와 상수. 근거는 기획서·PRD·개발 명세의 항목 번호 */
export const LIMITS = {
  /** 기획서 16 · FR-MENU-002 */
  quantityMin: 1,
  /** 기획서 16 · FR-MENU-003 · FR-CART-012 */
  quantityMax: 10,
  /** 기획서 11.3 · FR-HOME-009 */
  recentViewedMax: 10,
  toastDurationMs: 3000,
  /** 서버(Supabase) 조회 제한 시간. 넘으면 실패로 보고 오류 상태를 보여준다 */
  serverRequestTimeoutMs: 10000,
} as const;
