import type { StoreCardDto } from '@/contracts/catalog';
import type { Uuid, Won } from '@/contracts/common';
import { mockCatalog } from '@/mocks/catalog/mock-catalog-repository';
import { mockDelay, mockScenario } from '@/mocks/scenario';
import { RepositoryError } from '@/services/catalog/catalog-repository';

/**
 * 홈 섹션 Mock.
 *
 * 홈·검색 계약(catalog@0.2)은 아직 합의 전이다. 아래 타입은 이 폴더 안에서만 쓰는 임시 타입이며
 * 합의된 계약이 아니다. 계약이 나오면 `src/contracts/`의 타입으로 바꾸고 이 파일을 계약에 맞춘다.
 * 홈 "지금 많이 찾는 메뉴"는 노출 기준과 문구가 정해질 때까지 만들지 않는다.
 */

/** 임시 타입: 배너. 문구·내용이 미결정이라 화면은 자리만 그린다 */
export type MockBanner = { id: string };

/** 임시 타입: 최근 본 메뉴를 그리기 위한 최소 정보 */
export type MockRecentMenu = {
  id: Uuid;
  name: string;
  imageRef: string | null;
  price: Won;
  isSoldOut: boolean;
};

async function request(): Promise<void> {
  await mockDelay();
  if (mockScenario.network === 'online') return;
  const offline = mockScenario.network === 'offline';
  throw new RepositoryError({
    code: offline ? 'NETWORK_UNAVAILABLE' : 'INTERNAL_ERROR',
    category: offline ? 'NETWORK' : 'INTERNAL',
    retryable: true,
    outcomeUnknown: false,
    correlationId: null,
  });
}

export const mockHome = {
  /** Seed 배너 2~3개 (FR-HOME-006) */
  async listBanners(): Promise<MockBanner[]> {
    await request();
    return [{ id: 'banner-1' }, { id: 'banner-2' }, { id: 'banner-3' }];
  },

  /** 추천 가게: is_recommended인 활성 가게, 이름순 */
  async listRecommendedStores(): Promise<StoreCardDto[]> {
    await request();
    if (mockScenario.homeRecommended === 'error') {
      throw new RepositoryError({ code: 'INTERNAL_ERROR', category: 'INTERNAL', retryable: true, outcomeUnknown: false, correlationId: null });
    }
    if (mockScenario.homeRecommended === 'empty') return [];
    return mockCatalog.recommendedStoreCards();
  },

  /** 최근 본 가게: 요청한 id 순서를 유지하고, 비활성·없는 id는 빠진다 */
  async listStoresByIds(storeIds: Uuid[]): Promise<StoreCardDto[]> {
    await request();
    return storeIds.map((storeId) => mockCatalog.storeCard(storeId)).filter((card): card is StoreCardDto => card !== null);
  },

  /** 최근 본 메뉴: 요청한 id 순서를 유지하고, 비활성·없는 id는 빠진다 */
  async listMenusByIds(menuIds: Uuid[]): Promise<MockRecentMenu[]> {
    await request();
    return menuIds
      .map((menuId) => mockCatalog.activeMenu(menuId))
      .filter((menu) => menu !== null)
      .map((menu) => ({ id: menu.id, name: menu.name, imageRef: menu.imageRef, price: menu.price, isSoldOut: menu.isSoldOut }));
  },
};
