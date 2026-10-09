import { LIMITS } from '@/config/limits';

/** 입력한 글자에서 검색에 쓰는 값: 앞뒤 공백을 지운다 */
export function normalizeQuery(value: string): string {
  return value.trim();
}

/** 검색할 수 있는 길이인가 (trim 후 1자 이상). 상한 50자는 입력창이 막는다 */
export function isSearchable(value: string): boolean {
  const length = Array.from(normalizeQuery(value)).length;
  return length >= LIMITS.searchMinLength && length <= LIMITS.searchMaxLength;
}

/** 최근 검색어: 새 검색어가 맨 앞, 같은 검색어는 하나만, 최대 개수까지 */
export function addRecentSearch(list: readonly string[], term: string): string[] {
  const t = normalizeQuery(term);
  if (!t) return [...list];
  return [t, ...list.filter((x) => x !== t)].slice(0, LIMITS.recentSearchMax);
}

export function removeRecentSearch(list: readonly string[], term: string): string[] {
  return list.filter((x) => x !== term);
}
