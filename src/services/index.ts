import { createMockCatalogRepository } from '@/mocks/catalog/mock-catalog-repository';

import type { CatalogRepository } from './catalog/catalog-repository';

/**
 * 화면이 쓰는 저장소. 지금은 Mock만 연결돼 있다.
 * Supabase 구현(`src/services/supabase/`)이 생기면 여기에서 바꿔 끼운다. 화면 코드는 바뀌지 않는다.
 */
export const catalogRepository: CatalogRepository = createMockCatalogRepository();
