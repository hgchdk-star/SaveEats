import type {
  CatalogErrorCode,
  CategoryDto,
  FavoriteStoreCardDto,
  MenuDetailDto,
  SetFavoriteResultDto,
  StoreCardDto,
  StoreDetailDto,
} from '@/contracts/catalog';
import type { ApiFailure, Page, Uuid } from '@/contracts/common';

/**
 * 카탈로그 조회·찜 저장소 (계약 catalog@0.1).
 * Mock과 Supabase 연결 코드가 이 interface를 똑같이 구현한다 (개발 명세 API-004).
 * 화면은 이 interface만 알고, 어느 구현이 붙었는지 모른다.
 */
export interface CatalogRepository {
  listCategories(): Promise<CategoryDto[]>;
  listStores(args: { categoryId?: Uuid | null; cursor?: string | null; pageSize?: number }): Promise<Page<StoreCardDto>>;
  getStore(storeId: Uuid): Promise<StoreDetailDto>;
  getMenu(menuId: Uuid): Promise<MenuDetailDto>;
  setFavorite(storeId: Uuid, desired: boolean): Promise<SetFavoriteResultDto>;
  listMyFavorites(args: { cursor?: string | null; pageSize?: number }): Promise<Page<FavoriteStoreCardDto>>;
}

/** 서버가 응답하지 못한 경우의 코드. 서버 업무 오류 코드(CatalogErrorCode)와 구분한다 */
export type TransportErrorCode = 'NETWORK_UNAVAILABLE' | 'REQUEST_TIMEOUT' | 'INTERNAL_ERROR';

export type CatalogFailureCode = CatalogErrorCode | TransportErrorCode;

/** 저장소가 던지는 오류. SDK·PostgREST 오류를 ApiFailure로 정규화해서 담는다 */
export class RepositoryError<Code extends string = string> extends Error {
  readonly failure: ApiFailure<Code>;

  constructor(failure: ApiFailure<Code>) {
    super(failure.code);
    this.name = 'RepositoryError';
    this.failure = failure;
  }
}

export function isRepositoryError(error: unknown): error is RepositoryError {
  return error instanceof RepositoryError;
}
