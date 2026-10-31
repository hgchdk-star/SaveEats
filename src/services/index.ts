import { dataSource } from '@/config/data-source';
import { mockSearch } from '@/mocks/home/mock-search';
import { createMockAccountService } from '@/mocks/account/mock-account';
import { createMockAuthService } from '@/mocks/auth/mock-auth';
import { createMockCatalogRepository } from '@/mocks/catalog/mock-catalog-repository';
import { createMockStoreSourceProvider } from '@/mocks/catalog/mock-store-sources';
import { createMockHistoryService } from '@/mocks/history/mock-history';
import { createMockReviewService } from '@/mocks/history/mock-review';
import type { HistoryService, ReviewService } from '@/mocks/history/types';
import { createMockMyService } from '@/mocks/my/mock-my';
import type { MyService } from '@/mocks/my/types';
import { createMockOrderService } from '@/mocks/order/mock-order';
import { createMockTransferService } from '@/mocks/order/mock-transfer';
import type { AccountService, AuthService, OrderService, TransferService } from '@/mocks/order/types';

import type { CatalogRepository } from './catalog/catalog-repository';
import { createUnconfirmedStoreSourceProvider, type StoreSourceProvider } from './store-source/store-source-provider';
import { createSupabaseCatalogRepository, searchStoresFromServer } from './supabase/supabase-catalog-repository';

/**
 * 화면이 쓰는 서비스. 기본은 Mock이다.
 * EXPO_PUBLIC_DATA_SOURCE=supabase 이면 서버로 연결된 부분(카테고리·가게 목록·가게 상세·메뉴 상세·가게 검색. 홈 추천 가게는 features/home/home-data.ts에서 쓴다)만 Supabase를 쓰고 나머지는 Mock이다.
 * 화면 코드는 어느 쪽이 붙었는지 모른다.
 */
const mockCatalog = createMockCatalogRepository();
export const catalogRepository: CatalogRepository = dataSource === 'supabase' ? createSupabaseCatalogRepository(mockCatalog) : mockCatalog;
// 가게별 콘텐츠 출처. 공급 계약(OPEN-SRC-001)이 없어 서버 모드에서는 출처를 확인하지 못한 것으로 답하고, Mock 모드에서만 개발용 시나리오 목록이 나온다.
export const storeSourceProvider: StoreSourceProvider = dataSource === 'supabase' ? createUnconfirmedStoreSourceProvider() : createMockStoreSourceProvider();
export const authService: AuthService = createMockAuthService();
export const accountService: AccountService = createMockAccountService();
export const orderService: OrderService = createMockOrderService();
export const transferService: TransferService = createMockTransferService();
export const historyService: HistoryService = createMockHistoryService();
export const reviewService: ReviewService = createMockReviewService();
export const myService: MyService = createMockMyService();
// 검색: 서버 모드에서는 가게 검색만 서버(search_stores)다. 인기 검색어는 서버 함수가 아직 없고 Mock 목록은 서버 데이터에서
// 결과가 나오지 않을 수 있어서, 서버 모드에서는 비워 섹션을 숨긴다.
export const searchService = dataSource === 'supabase' ? { ...mockSearch, searchStores: searchStoresFromServer, listPopularSearchTerms: async () => [] } : mockSearch;
