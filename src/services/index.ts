import { dataSource } from '@/config/data-source';
import { createMockCatalogRepository } from '@/mocks/catalog/mock-catalog-repository';

import type { CatalogRepository } from './catalog/catalog-repository';
import { createSupabaseCatalogRepository } from './supabase/supabase-catalog-repository';

/**
 * 화면이 쓰는 저장소. 기본은 Mock이다.
 * EXPO_PUBLIC_DATA_SOURCE=supabase 이면 서버로 연결된 부분(카테고리·가게 목록·가게 상세·메뉴 상세. 홈 추천 가게는 features/home/home-data.ts에서 이 목록을 쓴다)만 Supabase를 쓰고 나머지는 Mock이다.
 * 화면 코드는 어느 쪽이 붙었는지 모른다.
 */
const mockCatalog = createMockCatalogRepository();
export const catalogRepository: CatalogRepository = dataSource === 'supabase' ? createSupabaseCatalogRepository(mockCatalog) : mockCatalog;
