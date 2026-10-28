import { CATALOG_RPC, type MenuCardDto, type SearchStoreCardDto, type StoreCardDto } from '@/contracts/catalog';
import type { Page } from '@/contracts/common';
import { LIMITS } from '@/config/limits';
import { RepositoryError, type CatalogRepository } from '@/services/catalog/catalog-repository';

import { getSupabaseClient } from './client';
import { parseCategories, parseMenuCardList, parseMenuDetail, parseSearchStoreCardPage, parseStoreCardList, parseStoreCardPage, parseStoreDetail, toRepositoryError } from './rpc-result';

/**
 * RPC 하나를 부르고 계약 모양으로 바꿔 돌려준다. 오류는 모두 RepositoryError로 정규화한다.
 * 제한 시간(LIMITS.serverRequestTimeoutMs)을 넘으면 실패로 본다. 응답을 못 받은 채 로딩에 머물지 않게 한다.
 */
async function call<T>(name: string, args: Record<string, unknown> | undefined, parse: (data: unknown) => T): Promise<T> {
  const client = getSupabaseClient();
  if (!client) {
    // 서버 설정(EXPO_PUBLIC_SUPABASE_URL · PUBLISHABLE_KEY)이 없다. 없는 데이터처럼 보이지 않게 오류로 알린다
    if (__DEV__) console.error('[supabase] EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY가 비어 있어요. .env를 확인하세요.');
    throw new RepositoryError({ code: 'INTERNAL_ERROR', category: 'INTERNAL', retryable: false, outcomeUnknown: false, correlationId: null });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIMITS.serverRequestTimeoutMs);
  try {
    const { data, error } = await client.rpc(name, args).abortSignal(controller.signal);
    if (error) throw toRepositoryError(error);
    return parse(data);
  } catch (error) {
    if (error instanceof RepositoryError) throw error;
    throw toRepositoryError(error as { name?: string; message?: string });
  } finally {
    clearTimeout(timer);
  }
}

/** 홈 추천 가게 RPC. 계약 catalog@0.2의 이름이라 아직 CATALOG_RPC(catalog@0.1)에 없다. 계약이 합쳐지면 그쪽으로 옮긴다 */
const LIST_RECOMMENDED_STORES = 'list_recommended_stores';

/**
 * 홈 추천 가게 (계약 4.2절). is_recommended인 활성 가게를 이름 → id 순으로 `limit`곳(1~20, 서버 기본 10).
 * 영업 종료 가게도 isOpen=false로 포함된다. 범위 밖이면 서버가 INVALID_INPUT을 낸다.
 * 홈 화면이 CatalogRepository가 아니라 이 함수를 직접 쓴다(홈 계약은 catalog@0.2라 저장소 인터페이스에 아직 넣지 않았다).
 */
export function listRecommendedStoresFromServer(limit?: number): Promise<StoreCardDto[]> {
  return call(LIST_RECOMMENDED_STORES, { p_limit: limit ?? null }, parseStoreCardList);
}

/** 홈 인기 메뉴 RPC. 계약 catalog@0.2의 이름이라 아직 CATALOG_RPC(catalog@0.1)에 없다 */
const LIST_POPULAR_MENUS = 'list_popular_menus';

/**
 * 홈 "지금 많이 찾는 메뉴" (계약 4.4절). 서버가 정한 순서 그대로 `limit`개(1~20, 서버 기본 10).
 * 품절 메뉴와 영업 종료 가게의 메뉴는 서버가 뺀다(서정 확인 2026-10-14). 점수·순위 숫자는 오지 않는다. 없으면 빈 배열.
 */
export function listPopularMenusFromServer(limit?: number): Promise<MenuCardDto[]> {
  return call(LIST_POPULAR_MENUS, { p_limit: limit ?? null }, parseMenuCardList);
}

/** 가게 검색 RPC. 계약 catalog@0.2의 이름이라 아직 CATALOG_RPC(catalog@0.1)에 없다 */
const SEARCH_STORES = 'search_stores';

/**
 * 가게 검색 (계약 3.1절). 검색 대상은 가게 이름 · 메뉴 이름 · 카테고리 이름이고, 같은 가게는 한 번, 가게 이름 → id 순이다.
 * 메뉴 이름으로 걸리면 matchingMenu가 있다. 품절 메뉴도 검색된다. 결과가 없으면 items: [] (오류 아님).
 * 앞뒤 공백을 지운 1~50자가 아니면 서버가 INVALID_INPUT을 낸다.
 */
export function searchStoresFromServer(args: { query: string; cursor?: string | null; pageSize?: number }): Promise<Page<SearchStoreCardDto>> {
  return call(SEARCH_STORES, { p_query: args.query.trim(), p_cursor: args.cursor ?? null, p_page_size: args.pageSize ?? 20 }, parseSearchStoreCardPage);
}

/**
 * Supabase 카탈로그 저장소 (계약 catalog@0.1).
 *
 * 서버로 연결된 것: 카테고리 목록 · 가게 목록 · 가게 상세 · 메뉴 상세. 조회는 Guest(anon)도 부를 수 있어 로그인 없이 동작한다.
 * 아직 연결하지 않은 것(찜 저장·찜 목록)은 `fallback`(Mock)에 맡긴다. 로그인(Supabase Auth)을 연결할 때 이어서 바꾼다.
 * 영업 종료 가게는 목록에서 빠지지 않고 isOpen=false로 온다. "준비 중" 배지는 화면이 그린다.
 */
export function createSupabaseCatalogRepository(fallback: CatalogRepository): CatalogRepository {
  return {
    ...fallback,

    listCategories: () => call(CATALOG_RPC.listCategories, undefined, parseCategories),

    listStores: ({ categoryId, cursor, pageSize }) =>
      call(CATALOG_RPC.listStores, { p_category_id: categoryId ?? null, p_cursor: cursor ?? null, p_page_size: pageSize ?? 20 }, parseStoreCardPage),

    getStore: (storeId) => call(CATALOG_RPC.getStore, { p_store_id: storeId }, parseStoreDetail),

    getMenu: (menuId) => call(CATALOG_RPC.getMenu, { p_menu_id: menuId }, parseMenuDetail),
  };
}
