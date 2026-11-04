import { dataSource } from '@/config/data-source';
import { isPrefillVerified, TOSS_CAPABILITY } from '@/config/toss-capability';
import { mockSearch } from '@/mocks/home/mock-search';
import { createAccountVault, type AccountVault } from '@/infrastructure/local/account-vault';
import { deviceSecureStore } from '@/infrastructure/local/secure-store';
import { createMockAuthService } from '@/mocks/auth/mock-auth';
import { createMockCatalogRepository } from '@/mocks/catalog/mock-catalog-repository';
import { createMockStoreSourceProvider } from '@/mocks/catalog/mock-store-sources';
import { createMockHistoryService } from '@/mocks/history/mock-history';
import { createMockReviewService } from '@/mocks/history/mock-review';
import type { HistoryService, ReviewService } from '@/mocks/history/types';
import { mockValidateCart } from '@/mocks/cart/mock-cart-validation';
import { createMockMyService } from '@/mocks/my/mock-my';
import type { MyService } from '@/mocks/my/types';
import { createMockOrderService } from '@/mocks/order/mock-order';
import { createMockTransferService } from '@/mocks/order/mock-transfer';
import type { AccountService, AuthService, OrderService, TransferService } from '@/mocks/order/types';

import { withLocalDestination, withLocalDestinationHistory } from './order/with-local-destination';
import { createDestinationResolver } from './transfer/destination-resolver';
import { createRealTransferService, createTossLauncher } from './transfer/real-transfer-service';
import { createCatalogCartValidator } from './cart/validate-cart';
import { createSupabaseAuthService } from './auth/supabase-auth-service';
import { createSupabaseOrderService } from './order/supabase-order-service';
import { createSupabaseMyService } from './profile/supabase-profile';
import { createVaultAccountService, loadAccountFromVault } from './account/vault-account-service';
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
// 로그인: supabase 모드에서는 실제 Supabase Auth(이메일+비밀번호), mock 모드에서는 Mock. 주문·내역 등 나머지는 각자의 데이터 소스를 따른다.
export const authService: AuthService = dataSource === 'supabase' ? createSupabaseAuthService() : createMockAuthService();
// 계좌는 서버에 저장하지 않는다. 데이터 소스와 상관없이 항상 이 기기의 보안 저장소(AccountVault)를 쓴다.
export const accountVault: AccountVault = createAccountVault(deviceSecureStore);
export const accountService: AccountService = createVaultAccountService(accountVault);
/** 로그인 직후 이 기기에 저장된 계좌를 세션에 올린다 */
export const loadDeviceAccountIntoSession = (): Promise<void> => loadAccountFromVault(accountVault);
// 주문: supabase 모드에서는 실서버(create_order · get_order_by_request_key · get_my_order · confirm_order · cancel_order), mock 모드에서는 Mock.
// 서버는 계좌를 몰라서 응답에 목적지가 없다. 어느 쪽이든 기기에 저장한 은행명·끝 4자리를 서비스 경계에서 합친다(withLocalDestination).
export const orderService: OrderService = withLocalDestination(dataSource === 'supabase' ? createSupabaseOrderService() : createMockOrderService());
// 장바구니 가격·품절 확인: supabase 모드에서는 서버 카탈로그(get_menu)로 다시 읽어 판단하고, mock 모드에서는 시나리오가 있는 Mock이다.
export const validateCart = dataSource === 'supabase' ? createCatalogCartValidator(catalogRepository) : mockValidateCart;
// 계좌 원문은 데이터 소스와 상관없이 기기 보안 저장소에서 꺼낸다. 토스 실행·원격 설정은 supabase 모드에서만 실제 구현(현재 fail-closed)이다.
const resolveDestination = createDestinationResolver(accountVault);
const transferDeps = { resolveDestinationAccountNumber: resolveDestination, getOrder: (orderId: string) => orderService.getOrderStatus(orderId) };
// [미연결] 주문 API는 아직 Mock이다. 서버가 정해지면 orderService를 실제 구현으로 바꾼다. supabase 모드의 원격 설정은 get_public_feature_config를 부른다(실패하면 꺼짐).
// mock 모드: 원격 설정과 시나리오는 Mock 그대로. 검증된 조합(EXPO_PUBLIC_TOSS_PREFILL_VERIFIED)이 설정된 빌드에서만 토스를 실제로 연다.
// 이때도 Mock 원격 설정이 ON이고 주문의 은행이 검증된 조합일 때만 토스 이어가기가 보인다. 사용자가 토스에서 승인하기 전에는 송금되지 않는다.
export const transferService: TransferService =
  dataSource === 'supabase'
    ? createRealTransferService(transferDeps)
    : {
        ...createMockTransferService(),
        resolveDestinationAccountNumber: resolveDestination,
        ...(TOSS_CAPABILITY.prefillValidated
          ? {
              openToss: createTossLauncher(transferDeps),
              getTransferConfig: async (input?: { bankName: string }) => {
                const mock = await createMockTransferService().getTransferConfig();
                return { tossDeepLinkEnabled: mock.tossDeepLinkEnabled && !!input && isPrefillVerified(input.bankName) };
              },
            }
          : {}),
      };
export const historyService: HistoryService = withLocalDestinationHistory(createMockHistoryService());
export const reviewService: ReviewService = createMockReviewService();
// 프로필(닉네임)만 supabase 모드에서 서버(get_my_profile · set_my_nickname)를 쓴다. 알림 설정·누적 기록은 아직 Mock이다.
export const myService: MyService = dataSource === 'supabase' ? createSupabaseMyService(createMockMyService()) : createMockMyService();
// 검색: 서버 모드에서는 가게 검색만 서버(search_stores)다. 인기 검색어는 서버 함수가 아직 없고 Mock 목록은 서버 데이터에서
// 결과가 나오지 않을 수 있어서, 서버 모드에서는 비워 섹션을 숨긴다.
export const searchService = dataSource === 'supabase' ? { ...mockSearch, searchStores: searchStoresFromServer, listPopularSearchTerms: async () => [] } : mockSearch;
