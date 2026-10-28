import type {
  FavoriteStoreCardDto,
  MenuDetailDto,
  MenuSummaryDto,
  RepresentativeMenuDto,
  StoreCardDto,
  StoreDetailDto,
} from '@/contracts/catalog';
import { STORE_LIST_PAGE_SIZE_DEFAULT, STORE_LIST_PAGE_SIZE_MAX } from '@/contracts/catalog';
import type { IsoTimestamp, Page, Uuid } from '@/contracts/common';
import { mockDelay, mockScenario } from '@/mocks/scenario';
import { useMockSession } from '@/mocks/session/mock-session';
import { RepositoryError, type CatalogFailureCode, type CatalogRepository } from '@/services/catalog/catalog-repository';

import { mockCategories, mockMenus, mockStores, type MockMenu, type MockStore } from './data';

function fail(code: CatalogFailureCode): never {
  const network = code === 'NETWORK_UNAVAILABLE' || code === 'REQUEST_TIMEOUT';
  throw new RepositoryError({
    code,
    category: network ? 'NETWORK' : code === 'AUTH_REQUIRED' ? 'AUTH' : code === 'INTERNAL_ERROR' ? 'INTERNAL' : 'VALIDATION',
    retryable: network || code === 'INTERNAL_ERROR',
    outcomeUnknown: false,
    correlationId: null,
  });
}

/** 시나리오에 따라 지연·실패를 흉내 낸다 */
async function request(): Promise<void> {
  await mockDelay();
  if (mockScenario.network === 'offline') fail('NETWORK_UNAVAILABLE');
  if (mockScenario.network === 'error') fail('INTERNAL_ERROR');
}

const isMember = () => useMockSession.getState().isMember;

/** 이번 실행 동안만 유지되는 찜 상태 */
const favorites = new Map<Uuid, IsoTimestamp>();

const byName = (a: { name: string; id: string }, b: { name: string; id: string }) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1;

const bySortOrder = (a: MockMenu, b: MockMenu) => a.sortOrder - b.sortOrder || byName(a, b);

function activeMenusOf(storeId: Uuid): MockMenu[] {
  return mockMenus.filter((m) => m.storeId === storeId && m.isActive).sort(bySortOrder);
}

function activeStores(): MockStore[] {
  return mockStores.filter((s) => s.isActive);
}

/** 대표 메뉴: 판매 가능한 활성 메뉴 중 첫 메뉴. 모두 품절이면 첫 활성 메뉴를 품절로 (FR-STORE-012) */
function representativeMenu(storeId: Uuid): RepresentativeMenuDto | null {
  const menus = activeMenusOf(storeId);
  const pick = menus.find((m) => !m.isSoldOut) ?? menus[0];
  return pick ? { id: pick.id, name: pick.name, price: pick.price, isSoldOut: pick.isSoldOut } : null;
}

function categoryOf(store: MockStore) {
  const category = mockCategories.find((c) => c.code === store.categoryCode);
  if (!category) throw new Error(`Mock 데이터 오류: 카테고리 없음 ${store.categoryCode}`);
  return { id: category.id, code: category.code, name: category.name };
}

function toStoreCard(store: MockStore): StoreCardDto {
  return {
    id: store.id,
    name: store.name,
    imageRef: store.imageRef,
    isOpen: store.isOpen,
    isRecommended: store.isRecommended,
    category: categoryOf(store),
    representativeMenu: representativeMenu(store.id),
    reviewSummary: { count: store.reviewCount, averageCravingRating: store.reviewAverage },
    isFavorite: isMember() ? favorites.has(store.id) : null,
  };
}

function toMenuSummary(menu: MockMenu): MenuSummaryDto {
  return { id: menu.id, name: menu.name, description: menu.description, imageRef: menu.imageRef, price: menu.price, isSoldOut: menu.isSoldOut };
}

function paginate<T>(all: T[], cursor: string | null | undefined, pageSize: number | undefined): Page<T> {
  const size = pageSize ?? STORE_LIST_PAGE_SIZE_DEFAULT;
  if (!Number.isInteger(size) || size < 1 || size > STORE_LIST_PAGE_SIZE_MAX) fail('INVALID_INPUT');
  const start = cursor ? Number(cursor) : 0;
  if (!Number.isInteger(start) || start < 0) fail('INVALID_INPUT');
  const items = all.slice(start, start + size);
  const next = start + size;
  return { items, nextCursor: next < all.length ? String(next) : null, hasMore: next < all.length };
}

/** 다른 Mock(홈·장바구니)이 같은 가상 카탈로그를 읽을 때 쓴다 */
export const mockCatalog = {
  storeCard: (storeId: Uuid): StoreCardDto | null => {
    const store = activeStores().find((s) => s.id === storeId);
    return store ? toStoreCard(store) : null;
  },
  recommendedStoreCards: (): StoreCardDto[] =>
    activeStores()
      .filter((s) => s.isRecommended)
      .sort(byName)
      .map(toStoreCard),
  activeMenu: (menuId: Uuid): MockMenu | null => {
    const menu = mockMenus.find((m) => m.id === menuId && m.isActive);
    return menu && activeStores().some((s) => s.id === menu.storeId) ? menu : null;
  },
  anyMenu: (menuId: Uuid): MockMenu | null => mockMenus.find((m) => m.id === menuId) ?? null,
  store: (storeId: Uuid): MockStore | null => mockStores.find((s) => s.id === storeId) ?? null,
};

export function createMockCatalogRepository(): CatalogRepository {
  return {
    async listCategories() {
      await request();
      return [...mockCategories].sort((a, b) => a.sortOrder - b.sortOrder);
    },

    async listStores({ categoryId, cursor, pageSize }) {
      await request();
      const code = categoryId ? mockCategories.find((c) => c.id === categoryId)?.code : undefined;
      const stores = activeStores()
        .filter((s) => (categoryId ? s.categoryCode === code : true))
        .sort(byName)
        .map(toStoreCard);
      return paginate(stores, cursor, pageSize);
    },

    async getStore(storeId) {
      await request();
      const store = activeStores().find((s) => s.id === storeId);
      if (!store) fail('RESOURCE_NOT_FOUND');
      const detail: StoreDetailDto = {
        id: store.id,
        name: store.name,
        description: store.description,
        imageRef: store.imageRef,
        isOpen: store.isOpen,
        isRecommended: store.isRecommended,
        category: categoryOf(store),
        reviewSummary: { count: store.reviewCount, averageCravingRating: store.reviewAverage },
        isFavorite: isMember() ? favorites.has(store.id) : null,
        menus: activeMenusOf(store.id).map(toMenuSummary),
      };
      return detail;
    },

    async getMenu(menuId) {
      await request();
      const menu = mockCatalog.activeMenu(menuId);
      const store = menu ? mockCatalog.store(menu.storeId) : null;
      if (!menu || !store) fail('RESOURCE_NOT_FOUND');
      const detail: MenuDetailDto = {
        id: menu.id,
        storeId: menu.storeId,
        storeIsOpen: store.isOpen,
        name: menu.name,
        description: menu.description,
        imageRef: menu.imageRef,
        price: menu.price,
        catalogRevision: menu.catalogRevision,
        isSoldOut: menu.isSoldOut,
        optionGroups: menu.optionGroups,
      };
      return detail;
    },

    async setFavorite(storeId, desired) {
      await request();
      if (!isMember()) fail('AUTH_REQUIRED');
      if (desired) {
        if (!activeStores().some((s) => s.id === storeId)) fail('RESOURCE_NOT_FOUND');
        if (!favorites.has(storeId)) favorites.set(storeId, new Date().toISOString());
      } else {
        favorites.delete(storeId);
      }
      return { storeId, isFavorite: desired };
    },

    async listMyFavorites({ cursor, pageSize }) {
      await request();
      if (!isMember()) fail('AUTH_REQUIRED');
      const items: FavoriteStoreCardDto[] = activeStores()
        .filter((s) => favorites.has(s.id))
        .map((s) => ({ ...toStoreCard(s), isFavorite: true as const, favoritedAt: favorites.get(s.id) as IsoTimestamp }))
        .sort((a, b) => (a.favoritedAt < b.favoritedAt ? 1 : -1));
      return paginate(items, cursor, pageSize);
    },
  };
}
