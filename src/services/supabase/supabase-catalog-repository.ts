import { CATALOG_RPC, type CategoryDto } from '@/contracts/catalog';
import { LIMITS } from '@/config/limits';
import { RepositoryError, type CatalogRepository } from '@/services/catalog/catalog-repository';

import { getSupabaseClient } from './client';
import { parseCategories, toRepositoryError } from './rpc-result';

/**
 * Supabase 카탈로그 저장소 (계약 catalog@0.1).
 *
 * 지금 서버로 연결된 것은 카테고리 목록(listCategories)뿐이다. 나머지는 `fallback`(Mock)에 맡긴다.
 * 하나씩 서버로 바꿔 갈 때는 이 파일에 구현을 추가하고 fallback 위임을 지운다.
 * 조회는 Guest(anon)도 호출할 수 있어서 로그인 없이 동작한다.
 */
export function createSupabaseCatalogRepository(fallback: CatalogRepository): CatalogRepository {
  return {
    ...fallback,

    async listCategories(): Promise<CategoryDto[]> {
      const client = getSupabaseClient();
      if (!client) {
        // 서버 설정(EXPO_PUBLIC_SUPABASE_URL · PUBLISHABLE_KEY)이 없다. 없는 데이터처럼 보이지 않게 오류로 알린다
        if (__DEV__) console.error('[supabase] EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY가 비어 있어요. .env를 확인하세요.');
        throw new RepositoryError({ code: 'INTERNAL_ERROR', category: 'INTERNAL', retryable: false, outcomeUnknown: false, correlationId: null });
      }
      // 제한 시간을 넘기면 실패로 본다. 응답을 못 받은 채 로딩에 머물지 않게 한다
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), LIMITS.serverRequestTimeoutMs);
      try {
        const { data, error } = await client.rpc(CATALOG_RPC.listCategories).abortSignal(controller.signal);
        if (error) throw toRepositoryError(error);
        return parseCategories(data);
      } catch (error) {
        if (error instanceof RepositoryError) throw error;
        throw toRepositoryError(error as { name?: string; message?: string });
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
