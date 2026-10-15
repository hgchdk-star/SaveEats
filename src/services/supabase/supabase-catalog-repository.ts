import { CATALOG_RPC } from '@/contracts/catalog';
import { LIMITS } from '@/config/limits';
import { RepositoryError, type CatalogRepository } from '@/services/catalog/catalog-repository';

import { getSupabaseClient } from './client';
import { parseCategories, parseMenuDetail, parseStoreCardPage, parseStoreDetail, toRepositoryError } from './rpc-result';

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
