/** 1234567 → "1,234,567" */
export function formatCount(value: number): string {
  return String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 금액 표기는 항상 "27,000원" */
export function formatWon(amount: number): string {
  return `${formatCount(amount)}원`;
}
