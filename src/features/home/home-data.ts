import type { StoreCardDto } from '@/contracts/catalog';
import { dataSource } from '@/config/data-source';
import { mockHome } from '@/mocks/home/mock-home';
import { listRecommendedStoresFromServer } from '@/services/supabase/supabase-catalog-repository';

/**
 * 서버 데이터를 쓰는 중인지. 서버에는 아직 홈 배너·최근 본 항목 조회 함수가 없다(catalog@0.2의
 * list_banners · list_stores_by_ids · list_menu_cards_by_ids). 이 섹션들은 Mock id를 쓰기 때문에
 * 서버 id와 섞이면 없는 가게로 연결되거나 최근 본 항목이 지워진다. 그래서 서버 모드에서는 숨긴다.
 */
export const homeUsesServer = dataSource === 'supabase';

/**
 * 홈 추천 가게.
 * - mock: Mock 데이터
 * - supabase: 서버 `list_recommended_stores` (이름순 최대 10곳). 영업 종료 가게도 isOpen=false로 온다. 화면이 "준비 중" 배지를 그린다
 */
export function listHomeRecommendedStores(): Promise<StoreCardDto[]> {
  return homeUsesServer ? listRecommendedStoresFromServer() : mockHome.listRecommendedStores();
}
