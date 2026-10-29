import type { MenuCardDto, StoreCardDto } from '@/contracts/catalog';
import { dataSource } from '@/config/data-source';
import { mockHome } from '@/mocks/home/mock-home';
import {
  listMenuCardsByIdsFromServer,
  listPopularMenusFromServer,
  listRecommendedStoresFromServer,
  listStoresByIdsFromServer,
} from '@/services/supabase/supabase-catalog-repository';

/**
 * 서버 데이터를 쓰는 중인지. 서버에는 아직 홈 배너 조회 함수가 없다(catalog@0.2의 list_banners).
 * 배너는 Mock id를 쓰기 때문에 서버 id와 섞이면 없는 가게로 연결된다. 그래서 서버 모드에서는 숨긴다.
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

/**
 * 홈 "지금 많이 찾는 메뉴".
 * - mock: Mock 데이터
 * - supabase: 서버 `list_popular_menus` (품절·영업 종료 가게 메뉴는 서버가 뺀다). 없으면 빈 배열이고 섹션은 숨겨진다
 */
export function listHomePopularMenus(): Promise<MenuCardDto[]> {
  return homeUsesServer ? listPopularMenusFromServer() : mockHome.listPopularMenus();
}

/**
 * 홈 "최근 본" 가게. 요청한 순서를 유지하고, 없는 id·비활성 가게는 빠진다(앱이 로컬 기록에서 지운다).
 * - mock: Mock 데이터
 * - supabase: 서버 `list_stores_by_ids` (최대 10개). 영업 종료 가게도 isOpen=false로 포함된다
 */
export function listHomeStoresByIds(storeIds: string[]): Promise<StoreCardDto[]> {
  return homeUsesServer ? listStoresByIdsFromServer(storeIds) : mockHome.listStoresByIds(storeIds);
}

/**
 * 홈 "최근 본" 메뉴. 규칙은 가게와 같다.
 * - mock: Mock 데이터
 * - supabase: 서버 `list_menu_cards_by_ids` (최대 10개). 품절 메뉴·영업 종료 가게의 메뉴도 포함된다
 */
export function listHomeMenusByIds(menuIds: string[]): Promise<MenuCardDto[]> {
  return homeUsesServer ? listMenuCardsByIdsFromServer(menuIds) : mockHome.listMenusByIds(menuIds);
}
