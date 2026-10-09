import type { RepresentativeMenuDto, StoreCardDto } from '@/contracts/catalog';
import type { Page, Uuid } from '@/contracts/common';
import { mockCatalog } from '@/mocks/catalog/mock-catalog-repository';
import { mockCategories, mockMenus, mockStores } from '@/mocks/catalog/data';
import { failOnce, mockDelay, mockScenario } from '@/mocks/scenario';
import { RepositoryError } from '@/services/catalog/catalog-repository';

/**
 * 검색 Mock (계약 초안 catalog@0.2, docs/contracts/home-search-contract-draft.md — 아직 합의 전).
 *
 * 아래 타입은 이 폴더 안에서만 쓰는 임시 타입이며 합의된 계약이 아니다. 합의되면 `src/contracts/`의 타입으로 바꾼다.
 * 규칙은 초안 3절을 따른다: 앞뒤 공백을 지운 1~50자, 대소문자 무시 부분 일치(가게 이름 · 메뉴 이름 · 카테고리 이름),
 * 같은 가게는 한 번, 가게 이름 → id 순, 메뉴 이름으로 걸리면 판매 가능한 매칭 메뉴 우선. 초성·오타 보정은 하지 않는다.
 */

/** 임시 타입: 검색 결과 카드. 메뉴 이름으로 걸렸을 때만 matchingMenu가 있다 (FR-SRCH-005) */
export type MockSearchStoreCard = StoreCardDto & { matchingMenu: RepresentativeMenuDto | null };

/** 임시 타입: 인기 검색어. 검색 횟수·순위 숫자는 내려주지 않는다 (FR-HOME-005, FR-DATA-024) */
export type MockPopularSearchTerm = { id: Uuid; term: string };

const SEARCH_MIN = 1;
const SEARCH_MAX = 50;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/** Seed 인기 검색어. 모두 Seed 가게·메뉴·카테고리에서 실제로 결과가 나오는 단어만 넣는다 (계약 초안 6.3) */
const POPULAR_TERMS: MockPopularSearchTerm[] = ['치킨', '떡볶이', '비빔밥', '피자', '마늘', '디저트', '로제'].map((term, i) => ({
  id: `00000000-0000-4000-8000-0000000009${String(i + 1).padStart(2, '0')}`,
  term,
}));

function fail(code: 'NETWORK_UNAVAILABLE' | 'INTERNAL_ERROR' | 'INVALID_INPUT'): never {
  const network = code === 'NETWORK_UNAVAILABLE';
  throw new RepositoryError({
    code,
    category: network ? 'NETWORK' : code === 'INVALID_INPUT' ? 'VALIDATION' : 'INTERNAL',
    retryable: code !== 'INVALID_INPUT',
    outcomeUnknown: false,
    correlationId: null,
  });
}

async function request(): Promise<void> {
  await mockDelay();
  if (mockScenario.network === 'offline') fail('NETWORK_UNAVAILABLE');
  if (mockScenario.network === 'error') fail('INTERNAL_ERROR');
}

const norm = (value: string) => value.toLowerCase();
const byName = (a: { name: string; id: string }, b: { name: string; id: string }) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1);

export const mockSearch = {
  async searchStores(args: { query: string; cursor?: string | null; pageSize?: number }): Promise<Page<MockSearchStoreCard>> {
    await request();
    if (mockScenario.search === 'failOnce' && !args.cursor && failOnce('search:first')) fail('NETWORK_UNAVAILABLE');

    const query = args.query.trim();
    const length = Array.from(query).length;
    if (length < SEARCH_MIN || length > SEARCH_MAX) fail('INVALID_INPUT');
    const size = args.pageSize ?? DEFAULT_PAGE_SIZE;
    const start = args.cursor ? Number(args.cursor) : 0;
    if (!Number.isInteger(size) || size < 1 || size > MAX_PAGE_SIZE || !Number.isInteger(start) || start < 0) fail('INVALID_INPUT');

    const q = norm(query);
    const hits: MockSearchStoreCard[] = [];
    for (const store of mockStores.filter((s) => s.isActive).sort(byName)) {
      const card = mockCatalog.storeCard(store.id);
      if (!card) continue;
      const category = mockCategories.find((c) => c.code === store.categoryCode);
      // 판매 가능한 매칭 메뉴 → sort_order → 이름 → id. 모두 품절이면 같은 정렬의 첫 매칭 메뉴 (초안 3.2)
      const matched = mockMenus
        .filter((m) => m.storeId === store.id && m.isActive && norm(m.name).includes(q))
        .sort((a, b) => Number(a.isSoldOut) - Number(b.isSoldOut) || a.sortOrder - b.sortOrder || byName(a, b))[0];
      const byStore = norm(store.name).includes(q);
      const byCategory = !!category && norm(category.name).includes(q);
      if (!matched && !byStore && !byCategory) continue;
      hits.push({ ...card, matchingMenu: matched ? { id: matched.id, name: matched.name, price: matched.price, isSoldOut: matched.isSoldOut } : null });
    }
    const items = hits.slice(start, start + size);
    const next = start + size;
    return { items, nextCursor: next < hits.length ? String(next) : null, hasMore: next < hits.length };
  },

  /** Seed 목록을 정렬 순서대로. empty는 Seed가 비어 있는 경우, failOnce는 이 섹션만 실패 */
  async listPopularSearchTerms(): Promise<MockPopularSearchTerm[]> {
    await request();
    if (mockScenario.popular === 'failOnce' && failOnce('popular:first')) fail('NETWORK_UNAVAILABLE');
    return mockScenario.popular === 'empty' ? [] : POPULAR_TERMS;
  },
};
