import { callOrderRpc } from '@/services/order/supabase-order-service';
import { ServiceError } from '@/services/service-error';

import { isOpenableUrl, type StoreSource, type StoreSourceProvider } from './store-source-provider';

const bad = () => new ServiceError('INVALID_RESPONSE');

/**
 * 가게별 콘텐츠 출처의 실서버 구현 (혜지 · 서정과 합의, 2026-11-05 개발 프로젝트에 반영).
 * list_store_sources({ p_store_id }) → { items: [{ name, url }] }
 *
 * - 항목이 1개 이상이면 AVAILABLE(출처 확인 버튼과 목록 시트).
 * - 정상 응답인데 items가 []이면 UNCONFIRMED(기존 "출처 확인 중" 안내, 버튼은 숨김). 서버에 아직 출처 데이터가 없는 가게가 이 경우다.
 * - 호출 실패 · INVALID_INPUT · RESOURCE_NOT_FOUND · 응답 형식 오류는 던진다 → 화면은 조회 오류(다시 시도) 상태로 간다.
 *   빈 목록이나 "미확인"으로 바꾸지 않는다.
 * - 형식이 맞지 않는 항목(이름이 비었거나, 열 수 없는 URL)은 걸러서 정상 빈 목록으로 만들지 않고 응답 형식 오류로 던진다.
 *   화면이 항목을 열 때 쓰는 isOpenableUrl(http · https만)과 같은 기준이다.
 */
export function createSupabaseStoreSourceProvider(): StoreSourceProvider {
  return {
    async getStoreSources(storeId) {
      const data = await callOrderRpc('list_store_sources', { p_store_id: storeId });
      if (typeof data !== 'object' || data === null || Array.isArray(data) || !Array.isArray((data as { items?: unknown }).items)) throw bad();
      const items: StoreSource[] = (data as { items: unknown[] }).items.map((raw) => {
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw bad();
        const { name, url } = raw as { name?: unknown; url?: unknown };
        if (typeof name !== 'string' || typeof url !== 'string') throw bad();
        const trimmedName = name.trim();
        const trimmedUrl = url.trim();
        if (!trimmedName || !isOpenableUrl(trimmedUrl)) throw bad();
        return { name: trimmedName, url: trimmedUrl };
      });
      return items.length > 0 ? { status: 'AVAILABLE', items } : { status: 'UNCONFIRMED' };
    },
  };
}
