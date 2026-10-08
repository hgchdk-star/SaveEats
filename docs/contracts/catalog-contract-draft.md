# 카탈로그 API 계약 catalog@0.1 (합의본, 혜지 검수 대기)

범위: 카테고리 · 가게 목록 · 가게 상세 · 메뉴 상세 · 찜 (조회는 Guest 가능).
근거: 개발 명세 DB-004, DB-009, API-001~004, SEC-008 / PRD 8·9·10·11.
TS 계약: `src/contracts/catalog.ts`, `src/contracts/common.ts` — 지우 작성, 혜지 검수.
서버 구현: `supabase/migrations/20261001000000_catalog_read.sql`, `20261001000100_profiles_favorites.sql`, `20261001000200_catalog_contract_0_1.sql` (혜지 브랜치 `feat/store-menu-read-api`).

**수정 이력**

- **2026-10-01 수정 (혜지):** 3절의 추가 필드 3개를 서버에 반영하고 검수 결과를 적었다. 가게 상세 메뉴 목록 정렬을 대표 메뉴 규칙과 같게 맞췄다.

## 1. 합의 결과 (지우 질문 11개)

| # | 항목 | 합의 |
|---|---|---|
| 1 | 조회 방식 | RPC. 서버가 활성 상위 항목 필터와 응답 모양을 고정하고 camelCase JSON을 반환한다. 앱 키 변환 없음 |
| 2 | 페이지네이션 | cursor 방식, 이름 → id 오름차순. `추천 가게 우선` 정렬은 정책 변경이라 넣지 않음 |
| 3 | Guest 찜 | `isFavorite: null` |
| 4 | 비활성 상세 요청 | `RESOURCE_NOT_FOUND`로 통일. 없는 것과 숨겨진 것을 구분하지 않음. Cart에 남은 비활성 메뉴 표시는 Cart 계약(T04)에서 정함 |
| 5 | 이미지 | 서버는 `imageRef` 키만 반환, URL 변환은 앱. 권리 검토 전이라 현재 이미지 없음 |
| 6 | 리뷰 요약 | 리뷰 기능(T09) 전에는 `{count: 0, averageCravingRating: null}` 고정, 이후 실제 집계로 교체 (서정 확인) |
| 7 | 대표 메뉴 | 판매 가능한 활성 메뉴 중 sort_order → 이름 → ID 첫 메뉴. 모두 품절이면 첫 활성 메뉴(품절 표시), 활성 메뉴 없으면 null (서정 확인) |
| 8 | 오류 코드 | SEC-008 기준: `RESOURCE_NOT_FOUND`, `INVALID_INPUT`, `AUTH_REQUIRED` |
| 9 | 계약 버전 | `catalog@0.1` |
| 10 | `src/contracts/` 담당 | 지우가 TS 작성, 혜지가 검수·승인 |
| 11 | 영업 종료 서버 검증 | Cart 검증·주문 생성에서도 거절, 값 이름 `STORE_CLOSED`. T04·T06에서 구현 |

## 2. 호출

| 계약 | RPC | 인자 | 응답 | 실패 |
|---|---|---|---|---|
| listCategories | `list_categories` | 없음 | `CategoryDto[]` | |
| listStores | `list_stores` | `p_category_id?`, `p_cursor?`, `p_page_size?` (1~50, 기본 20) | `Page<StoreCardDto>` | INVALID_INPUT |
| getStore | `get_store` | `p_store_id` | `StoreDetailDto` | RESOURCE_NOT_FOUND |
| getMenu | `get_menu` | `p_menu_id` | `MenuDetailDto` | RESOURCE_NOT_FOUND |
| setFavorite | `set_favorite` | `p_store_id`, `p_desired` | `SetFavoriteResultDto` | AUTH_REQUIRED, RESOURCE_NOT_FOUND |
| listMyFavorites | `list_my_favorites` | `p_cursor?`, `p_page_size?` | `Page<FavoriteStoreCardDto>` | AUTH_REQUIRED |
| ensureMyProfile | `ensure_my_profile` | 없음 | `MyProfileDto` | AUTH_REQUIRED |

- `p_category_id` 없음 = `전체` (`전체`는 DB 카테고리 행이 아님, DB-004).
- 업무 오류는 PostgREST `P0001`의 `message`로 온다. UUID 형식 오류(`22P02`)는 INVALID_INPUT, Guest의 실행 권한 오류(`42501`)는 AUTH_REQUIRED로 repository가 정규화한다.
- 공통 실패 결과(`ApiFailure`)와 `Page`는 `src/contracts/common.ts` (API-001).
- **API-001과의 차이:** 카탈로그 조회 RPC는 성공 응답을 `{data, contractVersion, correlationId}`로 감싸지 않고 DTO를 바로 반환한다. Guest 읽기 전용이라 correlationId 이득이 작고, 버전은 앱의 `CATALOG_CONTRACT_VERSION`으로 맞춘다. 장바구니·주문 등 명령 RPC의 응답 형식은 해당 계약(T04·T06)에서 다시 정한다.
- 메뉴 목록 항목(`MenuSummaryDto`)에는 `isPopular`를 넣지 않는다. 홈 "지금 많이 찾는 메뉴"는 getHome 계약에서 정한다.
- Mock adapter와 Supabase adapter는 같은 interface를 구현한다 (API-004).

## 3. 혜지 브랜치 대비 추가된 필드 (서버 반영 완료, 2026-10-01)

아래 3개 필드는 `20261001000200_catalog_contract_0_1.sql`에서 반영했다. 로컬 대체 DB(PGlite) 검증만 통과했고 실제 Supabase 환경 검증은 아직 하지 않았다.

- `storeIsOpen` 검수 의견(혜지): 동의. 가게 조회 없이 메뉴 상세만으로 담기를 막을 수 있다. 서버는 메뉴가 속한 가게의 `is_open`을 그대로 내려준다.
- 가게 상세의 `menus`는 `sort_order → name → id` 순이다. 대표 메뉴 규칙과 같은 정렬이라, 판매 가능한 첫 메뉴가 곧 대표 메뉴다.
- `reviewSummary`는 서버가 고정값을 만든다. T09에서 같은 필드를 실제 집계로 바꾼다.

| DTO | 필드 | 내용 |
|---|---|---|
| StoreCardDto (목록·찜 목록) | `representativeMenu: {id, name, price, isSoldOut} \| null` | 1절 #7 규칙 |
| StoreCardDto, StoreDetailDto | `reviewSummary: {count, averageCravingRating}` | 1절 #6, 현재 고정값 |
| MenuDetailDto | `storeIsOpen: boolean` | 검색·배너·최근 본 항목에서 메뉴로 바로 들어와도 영업 종료 담기를 막기 위함 |

`CATALOG_CONTRACT_VERSION`은 `catalog-0.2-draft` → `catalog@0.1`로 바꿨다.

## 4. 확정된 제품 정책 (2026-10-01, 기획서·PRD·개발 명세 반영)

1. **영업 종료**
   - 새 메뉴 담기 불가. 이미 담긴 Cart는 유지하되 신규 주문 불가.
   - 안내: `지금은 영업이 종료됐어요`
   - 서버도 Cart 검증·주문 생성에서 확인하고 `STORE_CLOSED` 사용.
   - 이미 생성된 PENDING 주문의 이어가기·완료 확인은 막지 않음.
2. **수량**
   - 같은 메뉴·옵션 조합의 합산 최대 10개. 담기·옵션 변경으로 초과하면 그 동작을 거절.
   - 기존 Cart를 유지하고 수량을 자동으로 줄이지 않음.
   - 안내: `한 메뉴는 최대 10개까지 담을 수 있어요.`
3. **리뷰 요약:** 실제 리뷰 전에는 `count: 0`, `averageCravingRating: null`. 리뷰 도입 후 실제 집계로 교체. 조회 실패를 리뷰 0개로 표시하지 않음.
4. **대표 메뉴:** 1절 #7 규칙. 대표 메뉴를 실제 인기 메뉴처럼 표현하지 않음.
