import { dataSource } from '@/config/data-source';
import { TOSS_CAPABILITY } from '@/config/toss-capability';
import { mockSearch } from '@/mocks/home/mock-search';
import { createAccountVault, type AccountVault } from '@/infrastructure/local/account-vault';
import { deviceSecureStore } from '@/infrastructure/local/secure-store';
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

import { createDestinationResolver } from './transfer/destination-resolver';
import { createRealTransferService, createTossLauncher } from './transfer/real-transfer-service';
import { createVaultAccountService, loadAccountFromVault } from './account/vault-account-service';
import type { CatalogRepository } from './catalog/catalog-repository';
import { createSupabaseCatalogRepository, searchStoresFromServer } from './supabase/supabase-catalog-repository';

/**
 * 화면이 쓰는 서비스. 기본은 Mock이다.
 * EXPO_PUBLIC_DATA_SOURCE=supabase 이면 서버로 연결된 부분(카테고리·가게 목록·가게 상세·메뉴 상세·가게 검색. 홈 추천 가게는 features/home/home-data.ts에서 쓴다)만 Supabase를 쓰고 나머지는 Mock이다.
 * 화면 코드는 어느 쪽이 붙었는지 모른다.
 */
const mockCatalog = createMockCatalogRepository();
export const catalogRepository: CatalogRepository = dataSource === 'supabase' ? createSupabaseCatalogRepository(mockCatalog) : mockCatalog;
export const authService: AuthService = createMockAuthService();
// 계좌는 서버에 저장하지 않는다. 데이터 소스와 상관없이 항상 이 기기의 보안 저장소(AccountVault)를 쓴다.
export const accountVault: AccountVault = createAccountVault(deviceSecureStore);
export const accountService: AccountService = createVaultAccountService(accountVault);
/** 로그인 직후 이 기기에 저장된 계좌를 세션에 올린다 */
export const loadDeviceAccountIntoSession = (): Promise<void> => loadAccountFromVault(accountVault);
// TODO(혜지·지우 합의 전): 주문 생성·조회·완료 확인 API와 오류 응답 계약이 없어 orderService는 아직 Mock이다. 계약이 확정되면 여기서 교체한다.
export const orderService: OrderService = createMockOrderService();
// 계좌 원문은 데이터 소스와 상관없이 기기 보안 저장소에서 꺼낸다. 토스 실행·원격 설정은 supabase 모드에서만 실제 구현(현재 fail-closed)이다.
const resolveDestination = createDestinationResolver(accountVault, (orderId) => orderService.getOrderStatus(orderId));
const transferDeps = { resolveDestinationAccountNumber: resolveDestination, getOrder: (orderId: string) => orderService.getOrderStatus(orderId) };
// mock 모드: 원격 설정과 시나리오는 Mock 그대로. 사전입력이 재검증된 빌드(EXPO_PUBLIC_TOSS_PREFILL_VALIDATED=true)에서만 토스를 실제로 연다.
// 이때도 Mock의 원격 설정이 ON(기본)일 때만 토스 이어가기가 보이고, 실제 송금은 하지 않는다(사용자가 토스에서 승인하지 않으면 송금되지 않음).
export const transferService: TransferService =
  dataSource === 'supabase'
    ? createRealTransferService(transferDeps)
    : {
        ...createMockTransferService(),
        resolveDestinationAccountNumber: resolveDestination,
        ...(TOSS_CAPABILITY.prefillValidated ? { openToss: createTossLauncher(transferDeps) } : {}),
      };
export const historyService: HistoryService = createMockHistoryService();
export const reviewService: ReviewService = createMockReviewService();
export const myService: MyService = createMockMyService();
// 검색: 서버 모드에서는 가게 검색만 서버(search_stores)다. 인기 검색어는 서버 함수가 아직 없고 Mock 목록은 서버 데이터에서
// 결과가 나오지 않을 수 있어서, 서버 모드에서는 비워 섹션을 숨긴다.
export const searchService = dataSource === 'supabase' ? { ...mockSearch, searchStores: searchStoresFromServer, listPopularSearchTerms: async () => [] } : mockSearch;
