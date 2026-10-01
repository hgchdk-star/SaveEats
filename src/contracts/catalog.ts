/**
 * 카탈로그 조회 · 찜 계약 (가게 목록 · 가게 상세 · 메뉴 상세 · 찜)
 *
 * 상태: catalog@0.1 합의본 — 혜지 검수 대기.
 * 설명 문서: docs/contracts/catalog-contract-draft.md
 * 근거: 개발 명세 API-001, API-003, DB-004, DB-009, SEC-002, SEC-005, SEC-008
 * 서버 구현: supabase/migrations/20261001000000_catalog_read.sql
 *           supabase/migrations/20261001000100_profiles_favorites.sql
 *
 * - 조회는 RPC. 서버가 아래 DTO와 같은 camelCase JSON을 반환하므로 repository는 키 변환이 필요 없다.
 * - 조회는 Guest(anon)와 로그인 사용자 모두 호출 가능. 활성 항목(활성 상위 항목 포함)만 반환한다.
 * - 찜/프로필 명령은 로그인 사용자만 호출 가능 (Guest 호출은 권한 오류 → AUTH_REQUIRED로 정규화).
 * - 품절(isSoldOut)은 숨기지 않고 표시용으로 내려준다. 담기 가능 여부는 앱이 판단한다.
 * - 이미지는 imageRef 키만 내려주고 URL 변환은 앱에서 한다.
 */

import type { IsoTimestamp, Page, Uuid, Won } from './common';

export const CATALOG_CONTRACT_VERSION = 'catalog@0.1';

export interface CategoryRef {
  id: Uuid;
  code: string;
  name: string;
}

export interface CategoryDto extends CategoryRef {
  sortOrder: number;
}

/**
 * 리뷰 요약 (FR-STORE-013).
 * 리뷰 기능(T09) 전에는 항상 { count: 0, averageCravingRating: null }. T09에서 실제 집계로 교체한다.
 * 앱은 조회 실패를 이 값(리뷰 0개)으로 대신 표시하지 않는다.
 */
export interface ReviewSummaryDto {
  count: number;
  /** 활성 리뷰가 0개면 null */
  averageCravingRating: number | null;
}

/**
 * 대표 메뉴 (FR-STORE-012).
 * 판매 가능한 활성 메뉴 중 sort_order → name → id 오름차순 첫 메뉴.
 * 모두 품절이면 첫 활성 메뉴를 isSoldOut=true로 반환한다. 실제 인기 메뉴로 표현하지 않는다.
 */
export interface RepresentativeMenuDto {
  id: Uuid;
  name: string;
  price: Won;
  isSoldOut: boolean;
}

export interface StoreCardDto {
  id: Uuid;
  name: string;
  /** 이미지 참조. 없거나 로딩 실패 시 앱이 중립 Placeholder를 표시 (FR-STORE-003) */
  imageRef: string | null;
  /** Seed 영업 상태. 영업시간 자동 계산 결과가 아님. false면 새 메뉴 담기 불가 (FR-MENU-010) */
  isOpen: boolean;
  isRecommended: boolean;
  category: CategoryRef;
  /** 활성 메뉴가 없으면 null */
  representativeMenu: RepresentativeMenuDto | null;
  reviewSummary: ReviewSummaryDto;
  /** 로그인 전(Guest)이면 null — 찜 여부를 알 수 없음. 로그인 사용자는 true/false */
  isFavorite: boolean | null;
}

/** 내 찜 목록 항목. 최근 찜 순으로 정렬된다 */
export interface FavoriteStoreCardDto extends StoreCardDto {
  isFavorite: true;
  favoritedAt: IsoTimestamp;
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
  /** false면 새 메뉴 담기 불가 (FR-MENU-010) */
  isOpen: boolean;
  isRecommended: boolean;
  category: CategoryRef;
  reviewSummary: ReviewSummaryDto;
  /** 로그인 전(Guest)이면 null, 로그인 사용자는 true/false */
  isFavorite: boolean | null;
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
  /**
   * 메뉴가 속한 가게의 영업 상태. false면 담기 불가 (FR-MENU-010).
   * 검색·배너·최근 본 항목에서 메뉴 상세로 바로 들어오는 경우를 위해 포함한다.
   */
  storeIsOpen: boolean;
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
  setFavorite: 'set_favorite',
  listMyFavorites: 'list_my_favorites',
  ensureMyProfile: 'ensure_my_profile',
} as const;

/** 가게 목록은 이름 → id 오름차순 */
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

/**
 * 찜 목표값 설정 (로그인 필요). 같은 값으로 다시 호출해도 결과가 같다.
 * - desired=true: 현재 조회 가능한 가게만. 아니면 RESOURCE_NOT_FOUND
 * - desired=false: 비활성 가게에 남은 찜도 해제 가능
 * 프로필이 없으면 서버가 먼저 만든다.
 */
export interface SetFavoriteRpcArgs {
  p_store_id: Uuid;
  p_desired: boolean;
}

export interface SetFavoriteResultDto {
  storeId: Uuid;
  isFavorite: boolean;
}

/** 내 찜 목록 (로그인 필요). 비활성 가게는 숨겨진다 */
export interface ListMyFavoritesRpcArgs {
  p_cursor?: string | null;
  /** 1~50, 기본 20 */
  p_page_size?: number;
}

/** 로그인 사용자 본인 프로필 최소 레코드. name은 수집 정책 미결정(OPEN-DB-004)이라 null일 수 있다 */
export interface MyProfileDto {
  id: Uuid;
  name: string | null;
}

export interface CatalogRpcResults {
  list_categories: CategoryDto[];
  list_stores: Page<StoreCardDto>;
  get_store: StoreDetailDto;
  get_menu: MenuDetailDto;
  set_favorite: SetFavoriteResultDto;
  list_my_favorites: Page<FavoriteStoreCardDto>;
  ensure_my_profile: MyProfileDto;
}

/**
 * 서버 업무 오류 코드 (SEC-008).
 * PostgREST 응답의 `code === 'P0001'`일 때 `message`에 이 값이 들어온다.
 * - RESOURCE_NOT_FOUND: 없거나 비활성(상위 항목 비활성 포함). 둘을 구분하지 않는다.
 * - INVALID_INPUT: pageSize 범위 밖, 잘못된 cursor. UUID 형식 오류는 PostgREST `22P02`로 오며
 *   repository에서 INVALID_INPUT으로 정규화한다.
 * - AUTH_REQUIRED: 로그인 필요. Guest가 찜/프로필 RPC를 호출하면 실행 권한 오류(`42501`)가 오며
 *   repository에서 AUTH_REQUIRED로 정규화한다.
 *
 * STORE_CLOSED는 Cart 검증·주문 생성 계약(T04·T06)에서 정의한다.
 */
export type CatalogErrorCode = 'INVALID_INPUT' | 'RESOURCE_NOT_FOUND' | 'AUTH_REQUIRED';
