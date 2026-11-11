/** 은행 선택 시트의 목록 구성과 검색. 화면 없이 계산만 한다 (tests/account/bank-list.test.cjs). */

export type BankKind = 'bank' | 'securities';

export type BankItem = {
  /** 기관 코드. 앞자리 0이 있는 문자열이다 (예: '004') */
  bankCode: string;
  /** 표시 이름. 토스 사전입력의 bank= 값으로도 쓰인다 */
  bankName: string;
  kind: BankKind;
  /** 주요 은행 노출 순서(1부터). 없으면 주요 은행이 아니다. 이용량이 아니라 노출 우선순위다 */
  featuredOrder?: number;
  /** 검색 별칭. 같은 기관을 가리키는 이름만 둔다 */
  aliases?: readonly string[];
};

export type BankSection = { key: string; title: string | null; items: BankItem[] };

/** 공백을 없애고 소문자로 맞춘다 */
export function normalizeQuery(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase();
}

// 한글 음절은 코드 순서가 가나다 순서와 같다. 기기 언어 설정과 상관없이 같은 순서가 나오게 직접 비교한다
function byName(a: BankItem, b: BankItem): number {
  if (a.bankName < b.bankName) return -1;
  if (a.bankName > b.bankName) return 1;
  return a.bankCode < b.bankCode ? -1 : a.bankCode > b.bankCode ? 1 : 0;
}

export function featuredBanks(banks: readonly BankItem[]): BankItem[] {
  return banks
    .filter((b) => b.kind === 'bank' && b.featuredOrder !== undefined)
    .sort((a, b) => (a.featuredOrder ?? 0) - (b.featuredOrder ?? 0));
}

export function otherBanks(banks: readonly BankItem[]): BankItem[] {
  return banks.filter((b) => b.kind === 'bank' && b.featuredOrder === undefined).sort(byName);
}

export function securitiesList(banks: readonly BankItem[]): BankItem[] {
  return banks.filter((b) => b.kind === 'securities').sort(byName);
}

/** 탭별 섹션. 은행·상호금융 탭은 주요 은행 + 그 외, 증권사 탭은 한 덩어리다 */
export function buildSections(banks: readonly BankItem[], tab: BankKind): BankSection[] {
  if (tab === 'securities') return [{ key: 'securities', title: null, items: securitiesList(banks) }];
  return [
    { key: 'featured', title: '주요 은행', items: featuredBanks(banks) },
    { key: 'others', title: '그 외 은행·상호금융', items: otherBanks(banks) },
  ];
}

/** 이름·별칭에 검색어가 들어 있으면 찾는다. 공백·대소문자는 무시한다. 결과는 이름순이다 */
export function searchBanks(banks: readonly BankItem[], query: string): BankItem[] {
  const q = normalizeQuery(query);
  if (!q) return [];
  return banks
    .filter((b) => normalizeQuery(b.bankName).includes(q) || (b.aliases ?? []).some((a) => normalizeQuery(a).includes(q)))
    .sort(byName);
}
