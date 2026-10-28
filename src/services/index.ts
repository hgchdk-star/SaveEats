import { createMockAccountService } from '@/mocks/account/mock-account';
import { createMockAuthService } from '@/mocks/auth/mock-auth';
import { createMockCatalogRepository } from '@/mocks/catalog/mock-catalog-repository';
import { createMockOrderService } from '@/mocks/order/mock-order';
import { createMockTransferService } from '@/mocks/order/mock-transfer';
import type { AccountService, AuthService, OrderService, TransferService } from '@/mocks/order/types';

import type { CatalogRepository } from './catalog/catalog-repository';

/**
 * 화면이 쓰는 서비스. 지금은 모두 Mock이 연결돼 있다.
 * Supabase 구현(`src/services/supabase/`)이 생기면 여기에서 바꿔 끼운다. 화면 코드는 바뀌지 않는다.
 */
export const catalogRepository: CatalogRepository = createMockCatalogRepository();
export const authService: AuthService = createMockAuthService();
export const accountService: AccountService = createMockAccountService();
export const orderService: OrderService = createMockOrderService();
export const transferService: TransferService = createMockTransferService();
