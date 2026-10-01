/**
 * 카탈로그 조회 계약 (가게 목록 · 가게 상세 · 메뉴 상세)
 *
 * 상태: 초안 — 지우 검토·합의 전. 합의 후 한 사람만 수정한다 (CLAUDE.md 담당 영역).
 * 근거: 개발 명세 API-001, API-003, SEC-002, DB-004
 * 서버 구현: supabase/migrations/20261001000000_catalog_read.sql
 *
 * - 서버 RPC는 아래 DTO와 같은 camelCase JSON을 반환한다. repository는 키 변환이 필요 없다.
 * - Guest(anon)와 로그인 사용자 모두 호출 가능. 활성 항목(활성 상위 항목 포함)만 반환한다.
 * - 품절(isSoldOut)은 숨기지 않고 표시용으로 내려준다. 담기 가능 여부는 앱이 판단한다.
 * - 아직 포함하지 않은 필드: 리뷰 요약(땡김도·리뷰 수), 찜 상태, 대표/매칭 메뉴. (PR 설명 참고)
 */

export const CATALOG_CONTRACT_VERSION = 'catalog-0.1-draft';

/** UUID 문자열 */
export type Uuid = string;

/** 원 단위 정수 금액 (KRW). DB CHECK로 JS 안전 정수 범위가 보장된다. */
export type Won = number;

export interface CategoryRef {
  id: Uuid;
  code: string;
  name: string;
}

export interface CategoryDto extends CategoryRef {
  sortOrder: number;
}

export interface StoreCardDto {
  id: Uuid;
  name: string;
  /** 이미지 참조. 없거나 로딩 실패 시 앱이 중립 Placeholder를 표시 (FR-STORE-003) */
  imageRef: string | null;
  /** Seed 영업 상태. 영업시간 자동 계산 결과가 아님 */
  isOpen: boolean;
  isRecommended: boolean;
  category: CategoryRef;
}

export interface MenuSummaryDto {
  id: Uuid;
  name: string;
  description: string | null;
  imageRef: string | null;
  price: Won;
  isSoldOut: boolean;
}

export interface StoreDetailDto {
  id: Uuid;
  name: string;
  description: string | null;
  imageRef: string | null;
  isOpen: boolean;
  isRecommended: boolean;
  category: CategoryRef;
  /** 활성 메뉴만, 정렬 순서대로. 품절 메뉴 포함 */
  menus: MenuSummaryDto[];
}

export interface MenuOptionDto {
  id: Uuid;
  name: string;
  additionalPrice: Won;
  isSoldOut: boolean;
}

export interface MenuOptionGroupDto {
  id: Uuid;
  name: string;
  /** 0이면 선택 그룹, 1 이상이면 필수 그룹 */
  minSelect: number;
  maxSelect: number;
  /** 활성 옵션만, 정렬 순서대로. 품절 옵션 포함 */
  options: MenuOptionDto[];
}

export interface MenuDetailDto {
  id: Uuid;
  storeId: Uuid;
  name: string;
  description: string | null;
  imageRef: string | null;
  /** 기본 가격 */
  price: Won;
  /** Cart에 담을 때 가격과 함께 저장하는 카탈로그 revision (CART-008) */
  catalogRevision: number;
  isSoldOut: boolean;
  /** 활성 그룹만, 정렬 순서대로. 옵션 없는 메뉴는 빈 배열 */
  optionGroups: MenuOptionGroupDto[];
}

/** 공통 목록 응답 (API-001) */
export interface Page<T> {
  items: T[];
  /** 다음 페이지 요청에 그대로 넘기는 opaque 문자열. 마지막 페이지면 null */
  nextCursor: string | null;
  hasMore: boolean;
}

export const STORE_LIST_PAGE_SIZE_DEFAULT = 20;
export const STORE_LIST_PAGE_SIZE_MAX = 50;

/**
 * RPC 이름과 인자. `supabase.rpc(CATALOG_RPC.listStores, args)` 형태로 호출한다.
 * 인자 이름은 SQL 함수 파라미터 이름과 같아야 한다.
 */
export const CATALOG_RPC = {
  listCategories: 'list_categories',
  listStores: 'list_stores',
  getStore: 'get_store',
  getMenu: 'get_menu',
} as const;

export interface ListStoresRpcArgs {
  /** null/생략 = 전체. 비활성·없는 카테고리는 빈 목록 */
  p_category_id?: Uuid | null;
  p_cursor?: string | null;
  /** 1~50, 기본 20. 범위 밖이면 INVALID_INPUT */
  p_page_size?: number;
}

export interface GetStoreRpcArgs {
  p_store_id: Uuid;
}

export interface GetMenuRpcArgs {
  p_menu_id: Uuid;
}

export interface CatalogRpcResults {
  list_categories: CategoryDto[];
  list_stores: Page<StoreCardDto>;
  get_store: StoreDetailDto;
  get_menu: MenuDetailDto;
}

/**
 * 서버 업무 오류 코드 (SEC-008).
 * PostgREST 응답의 `code === 'P0001'`일 때 `message`에 이 값이 들어온다.
 * - RESOURCE_NOT_FOUND: 없거나 비활성(상위 항목 비활성 포함). 둘을 구분하지 않는다.
 * - INVALID_INPUT: pageSize 범위 밖, 잘못된 cursor. UUID 형식 오류는 PostgREST `22P02`로 오며
 *   repository에서 INVALID_INPUT으로 정규화한다.
 */
export type CatalogErrorCode = 'INVALID_INPUT' | 'RESOURCE_NOT_FOUND';
