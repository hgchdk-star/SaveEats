/**
 * 날짜·시각 표시. 서버는 UTC로 저장하고, 화면 표시와 월 경계는 한국 시간(KST, UTC+9)이다 (기획서 41 · DB-009).
 * 기기의 시간대 설정에 따라 월 경계나 날짜가 달라지지 않도록 직접 더해서 계산한다.
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const;

type Instant = number | string;

const ms = (t: Instant) => (typeof t === 'number' ? t : Date.parse(t));

function kst(t: Instant) {
  const d = new Date(ms(t) + KST_OFFSET_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), w: d.getUTCDay() };
}

const pad = (n: number) => (n < 10 ? `0${n}` : String(n));

/** "2026-10" (KST 기준 월) */
export function monthKeyOf(t: Instant): string {
  const k = kst(t);
  return `${k.y}-${pad(k.m)}`;
}

/** 월 키를 n개월 옮긴다. shiftMonth('2026-01', -1) → '2025-12' */
export function shiftMonth(key: string, n: number): string {
  let y = Number(key.slice(0, 4));
  let m = Number(key.slice(5)) - 1 + n;
  y += Math.floor(m / 12);
  m = ((m % 12) + 12) % 12;
  return `${y}-${pad(m + 1)}`;
}

/** "2026년 10월" */
export function monthLabel(key: string): string {
  return `${Number(key.slice(0, 4))}년 ${Number(key.slice(5))}월`;
}

/** "10월 8일 (목)" — 내역 행 날짜 */
export function formatOrderDate(t: Instant): string {
  const k = kst(t);
  return `${k.m}월 ${k.d}일 (${WEEKDAYS[k.w]})`;
}

/** "2026년 10월 8일 오후 7:30" */
export function formatDateTime(t: Instant): string {
  const k = kst(t);
  const hour = k.h % 12 || 12;
  return `${k.y}년 ${k.m}월 ${k.d}일 ${k.h < 12 ? '오전' : '오후'} ${hour}:${pad(k.mi)}`;
}

/** 리뷰 작성일: 오늘 · 어제 · N일 전(6일까지) · M월 D일 (KST 날짜 기준) */
export function formatReviewDate(t: Instant, now: Instant): string {
  const a = kst(t);
  const b = kst(now);
  const days = Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / DAY_MS);
  if (days <= 0) return '오늘';
  if (days === 1) return '어제';
  if (days < 7) return `${days}일 전`;
  return `${a.y !== b.y ? `${a.y}년 ` : ''}${a.m}월 ${a.d}일`;
}
