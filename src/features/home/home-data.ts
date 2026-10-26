import type { StoreCardDto } from '@/contracts/catalog';
import { dataSource } from '@/config/data-source';
import { mockHome } from '@/mocks/home/mock-home';
import { catalogRepository } from '@/services';

/** 홈 추천 가게 최대 개수. 계약 catalog@0.2 list_recommended_stores와 같다 (이름순 앞 10곳) */
const RECOMMENDED_LIMIT = 10;
/** 한 번에 가져오는 가게 수와 최대 페이지 수. 서버 가게가 이보다 많아지면 그때 추천 전용 호출(list_recommended_stores)로 바꾼다 */
const PAGE_SIZE = 50;
const MAX_PAGES = 4;

/**
 * 서버 데이터를 쓰는 중인지. 서버에는 아직 홈 배너·최근 본 항목 조회 함수가 없다(catalog@0.2의
 * list_banners · list_stores_by_ids · list_menu_cards_by_ids). 이 섹션들은 Mock id를 쓰기 때문에
 * 서버 id와 섞이면 없는 가게로 연결되거나 최근 본 항목이 지워진다. 그래서 서버 모드에서는 숨긴다.
 */
export const homeUsesServer = dataSource === 'supabase';

/**
 * 홈 추천 가게.
 * - mock: Mock 데이터
 * - supabase: list_stores에서 isRecommended인 가게를 이름순으로 최대 10곳 (list_recommended_stores 규칙과 같게)
 *   영업 종료 가게도 빠지지 않고 isOpen=false로 온다. 화면이 "준비 중" 배지를 그린다
 */
export async function listHomeRecommendedStores(): Promise<StoreCardDto[]> {
  if (!homeUsesServer) return mockHome.listRecommendedStores();

  const picked: StoreCardDto[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES && picked.length < RECOMMENDED_LIMIT; page += 1) {
    const result = await catalogRepository.listStores({ cursor, pageSize: PAGE_SIZE });
    picked.push(...result.items.filter((store) => store.isRecommended));
    if (!result.hasMore) break;
    cursor = result.nextCursor;
  }
  return picked.slice(0, RECOMMENDED_LIMIT);
}
