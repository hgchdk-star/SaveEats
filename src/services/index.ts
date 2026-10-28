import { dataSource } from '@/config/data-source';
import { mockSearch } from '@/mocks/home/mock-search';
import { createMockAccountService } from '@/mocks/account/mock-account';
import { createMockAuthService } from '@/mocks/auth/mock-auth';
import { createMockCatalogRepository } from '@/mocks/catalog/mock-catalog-repository';
import { createMockHistoryService } from '@/mocks/history/mock-history';
import { createMockReviewService } from '@/mocks/history/mock-review';
import type { HistoryService, ReviewService } from '@/mocks/history/types';
import { createMockMyService } from '@/mocks/my/mock-my';
import type { MyService } from '@/mocks/my/types';
import { createMockOrderService } from '@/mocks/order/mock-order';
import { createMockTransferService } from '@/mocks/order/mock-transfer';
import type { AccountService, AuthService, OrderService, TransferService } from '@/mocks/order/types';

import type { CatalogRepository } from './catalog/catalog-repository';
import { createSupabaseCatalogRepository } from './supabase/supabase-catalog-repository';

/**
 * 화면이 쓰는 서비스. 기본은 Mock이다.
 * EXPO_PUBLIC_DATA_SOURCE=supabase 이면 서버로 연결된 부분(카테고리·가게 목록·가게 상세·메뉴 상세. 홈 추천 가게는 features/home/home-data.ts에서 이 목록을 쓴다)만 Supabase를 쓰고 나머지는 Mock이다.
 * 화면 코드는 어느 쪽이 붙었는지 모른다.
 */
const mockCatalog = createMockCatalogRepository();
export const catalogRepository: CatalogRepository = dataSource === 'supabase' ? createSupabaseCatalogRepository(mockCatalog) : mockCatalog;
export const authService: AuthService = createMockAuthService();
export const accountService: AccountService = createMockAccountService();
export const orderService: OrderService = createMockOrderService();
export const transferService: TransferService = createMockTransferService();
export const historyService: HistoryService = createMockHistoryService();
export const reviewService: ReviewService = createMockReviewService();
export const myService: MyService = createMockMyService();
export const searchService = mockSearch;
