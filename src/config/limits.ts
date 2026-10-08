/** 한도와 상수. 근거는 기획서·PRD·개발 명세의 항목 번호 */
export const LIMITS = {
  /** 기획서 16 · FR-MENU-002 */
  quantityMin: 1,
  /** 기획서 16 · FR-MENU-003 · FR-CART-012 */
  quantityMax: 10,
  /** 기획서 11.3 · FR-HOME-009 */
  recentViewedMax: 10,
  toastDurationMs: 3000,
} as const;
