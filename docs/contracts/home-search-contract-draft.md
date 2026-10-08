# 홈 · 검색 API 계약 초안 catalog@0.2 (혜지 → 지우 논의용, 미합의)

작성: 2026-10-08 (혜지). 이 문서는 **제안**이며 합의 전에는 서버·`src/contracts/`에 반영하지 않는다.
범위: 검색(`searchStores`, 인기 검색어), 홈(배너, 추천 가게, 최근 본 항목). 홈 "지금 많이 찾는 메뉴"와 홈 계좌 표시·이번 달 기록은 아래 5절처럼 제외한다.
근거: 개발 명세 API-001~004, DB-004, DB-009, OPS-003 / PRD FR-HOME-001~012, FR-SRCH-001~011 / 기획서 11~13장.
기존 계약: `catalog@0.1` (`docs/contracts/catalog-contract-draft.md`). 이 초안은 그 계약에 **필드를 더하기만** 하므로 버전을 `catalog@0.2`로 올리는 것을 제안한다.

**서버 구현 상태: 없음.** 합의 후 새 migration으로 구현하고, `src/contracts/` TS는 지난번처럼 지우가 쓰고 혜지가 검수한다.

## 1. 지우와 합의할 것 (요약)

| # | 항목 | 혜지 제안 |
|---|---|---|
| 1 | 홈 구성 방식 | `getHome` 단일 RPC를 만들지 않는다. 섹션별 작은 RPC를 앱 `HomeRepository`가 조합한다 (2절) |
| 2 | 검색 입력 규칙 | trim 후 1자 이상, 최대 50자, 대소문자 무시 부분 일치. 초성·오타 보정 제외 (3.1절) |
| 3 | 검색 결과 정렬 | 가게 이름 → id 오름차순 (목록과 같음). 관련도 정렬은 하지 않음 |
| 4 | 매칭 메뉴 선정 | 매칭된 메뉴 중 판매 가능 우선, sort_order → 이름 → id 첫 메뉴 (3.2절) |
| 5 | 최근 본 항목 조회 | 앱이 로컬 id(최대 10개)를 서버에 보내 현재 정보를 받는다. 비활성·없는 id는 응답에서 빠진다 (4.3절) |
| 6 | 배너 target | `STORE` / `MENU` / `CATEGORY` + id만 허용. 대상이 비활성이면 배너를 숨긴다 (4.1절) |
| 7 | 추천 가게 | `is_recommended` 활성 가게, 이름순, 기본 10개 (4.2절) |
| 8 | 인기 검색어 | Seed 문구 목록만. 검색 횟수 같은 숫자는 내려주지 않는다 (3.3절) |
| 9 | 계약 버전 | `catalog@0.2` |

제품 결정이 필요해서 서정 확인을 받아야 하는 것은 6절에 따로 모았다.

## 2. 홈을 섹션별 호출로 나누는 이유 (합의 #1)

- 명세 API-002: 모든 섹션 실패가 홈 전체를 막지 않는다. PRD 5.6의 상태에 Partial Error가 있다.
- RPC 하나로 홈을 통째로 내려주면 한 섹션이 실패했을 때 "부분 실패"를 표현하려면 응답에 섹션별 상태를 따로 넣어야 한다.
- 섹션별 RPC를 앱이 동시에 호출하고 `Promise.allSettled`로 섹션마다 성공·실패를 처리하면, 계약이 단순하고 실패 처리가 자연스럽다.
- 논리 계약 이름 `getHome`(API-002)은 **앱 `HomeRepository`의 함수**로 두고, 아래 RPC들을 조합한다.

```ts
// 앱 쪽 (서버 RPC 아님)
type HomeSection<T> = { status: 'ok'; data: T } | { status: 'error'; failure: ApiFailure };

type HomeSections = {
  categories: HomeSection<CategoryDto[]>;        // list_categories (catalog@0.1)
  banners: HomeSection<BannerDto[]>;             // list_banners
  recommendedStores: HomeSection<StoreCardDto[]>; // list_recommended_stores
  // recentItems는 로컬 id를 서버로 풀어야 하므로 4.3절
};
// popularMenus: 5절 보류
```

## 3. 검색

### 3.1 호출

| 계약 | RPC | 인자 | 응답 | 실패 |
|---|---|---|---|---|
| searchStores | `search_stores` | `p_query`, `p_cursor?`, `p_page_size?` (1~50, 기본 20) | `Page<SearchStoreCardDto>` | INVALID_INPUT |
| listPopularSearchTerms | `list_popular_search_terms` | 없음 | `PopularSearchTermDto[]` | |

- Guest와 로그인 사용자 모두 호출할 수 있다. `isFavorite`는 `list_stores`와 같다 (Guest는 null).
- 입력 규칙은 개발 명세 API-002의 기술 초깃값이다. **제품 확정이 아니다** (PRD 7.9가 최소 글자 수·초성·오타 대응을 미결정으로 둠).
  - `p_query`는 앞뒤 공백을 지운 뒤 1자 이상, 최대 50자. 범위 밖이면 `INVALID_INPUT`.
  - 검색 대상: 활성 가게 이름 / 활성 메뉴 이름(활성 가게의 것) / 카테고리 이름. 대소문자를 구분하지 않는 부분 일치.
  - `%`, `_` 같은 문자는 일반 글자로 취급한다 (서버가 이스케이프).
  - 300ms debounce와 최근 검색어(로컬, 최대 개수 미정)는 앱 몫이다.
- 같은 가게가 여러 경로로 걸려도 결과에는 한 번만 나온다 (FR-SRCH-004).
- 정렬: 가게 이름 → id 오름차순. 커서 형식은 `list_stores`와 같다.
- 결과가 없으면 `items: []` (오류 아님, AC-SRCH-003).

```ts
type SearchStoreCardDto = StoreCardDto & {
  /**
   * 메뉴 이름이 검색어와 일치해서 걸린 경우의 매칭 메뉴. 가게 이름·카테고리로만 걸리면 null.
   * 카드에서 "매칭 메뉴 이름·가격"을 보여주기 위한 필드 (FR-SRCH-005).
   */
  matchingMenu: RepresentativeMenuDto | null; // { id, name, price, isSoldOut }
};
```

- `representativeMenu`(catalog@0.1)는 그대로 내려간다. 앱은 `matchingMenu ?? representativeMenu`로 카드에 보여주면 된다.

### 3.2 매칭 메뉴 선정 규칙 (합의 #4)

여러 메뉴가 걸리면 대표 메뉴 규칙과 같게 고른다: **판매 가능한 매칭 메뉴 중 sort_order → 이름 → id 첫 메뉴**, 모두 품절이면 같은 정렬의 첫 매칭 메뉴(품절 표시). 인기·관련도 점수로 고르지 않는다.

### 3.3 인기 검색어 (합의 #8)

```ts
type PopularSearchTermDto = { id: Uuid; term: string };
```

- 서버는 Seed 목록을 정렬 순서대로 내려준다 (`popular_search_terms`, DB-004).
- 개발 명세 DB-004에 따라 "Seed임"을 데이터에 기록한다. 검색 횟수·순위 변동 같은 **숫자를 내려주지 않는다** (FR-HOME-005, FR-DATA-024).
- 향후 실제 검색 데이터 기반으로 바꿀 때도 이 DTO 모양은 그대로 둘 수 있다 (FR-SRCH-010).
- 표시 개수 상한은 정하지 않는다. 필요하면 앱에서 자른다.

## 4. 홈 섹션

### 4.1 배너 (합의 #6)

| 계약 | RPC | 인자 | 응답 |
|---|---|---|---|
| listBanners | `list_banners` | 없음 | `BannerDto[]` |

```ts
type BannerTarget =
  | { type: 'STORE'; id: Uuid }
  | { type: 'MENU'; id: Uuid }
  | { type: 'CATEGORY'; id: Uuid };

type BannerDto = {
  id: Uuid;
  title: string;
  imageRef: string | null;
  target: BannerTarget;
};
```

- 임의 외부 URL 실행을 막기 위해 target은 위 세 종류의 내부 id만 허용한다 (명세 DB-004, API-002). `target_type`은 DB CHECK로 제한한다.
- 대상(가게·메뉴·카테고리)이 비활성이면 그 배너는 응답에서 뺀다. 앱이 열었을 때 "없음"이 뜨지 않게 하려는 것이다.
- 정렬은 `sort_order → id`. Seed 배너 2~3개 (FR-HOME-006).
- 배너 제목에는 `참기`, `저축`, `절약`을 핵심 문구로 쓰지 않는다 (FR-HOME-012). 실제 카피는 서정 확인 전까지 Seed에서 가상 문구를 쓴다.

### 4.2 추천 가게 (합의 #7)

| 계약 | RPC | 인자 | 응답 |
|---|---|---|---|
| listRecommendedStores | `list_recommended_stores` | `p_limit?` (1~20, 기본 10) | `StoreCardDto[]` |

- `is_recommended = true`인 활성 가게(카테고리 활성 포함), 이름 → id 오름차순. 페이지네이션은 하지 않는다.
- 개수 상한은 제안값이며 제품 확정이 아니다.
- `isFavorite`는 `list_stores`와 같다.

### 4.3 최근 본 항목 (합의 #5)

최근 본 가게·메뉴 id는 앱이 로컬에 최대 10개씩 보관한다 (FR-HOME-008~011). 화면에 보여주려면 현재 이름·가격·품절 상태가 필요하므로 id를 서버로 보내 푼다.

| 계약 | RPC | 인자 | 응답 |
|---|---|---|---|
| listStoresByIds | `list_stores_by_ids` | `p_store_ids: Uuid[]` (최대 10개) | `StoreCardDto[]` |
| listMenuCardsByIds | `list_menu_cards_by_ids` | `p_menu_ids: Uuid[]` (최대 10개) | `MenuCardDto[]` |

```ts
type MenuCardDto = {
  id: Uuid;
  name: string;
  imageRef: string | null;
  price: Won;
  isSoldOut: boolean;
  store: { id: Uuid; name: string; isOpen: boolean };
};
```

- 응답은 **요청한 id 순서를 유지**하고, 비활성이거나 없는 id는 빠진다 (RESOURCE_NOT_FOUND를 내지 않는다). 앱은 응답에 없는 id를 로컬 목록에서 지울 수 있다.
- 10개를 넘기면 `INVALID_INPUT`.
- `MenuCardDto`는 나중에 홈 인기 메뉴(5절)에서도 재사용할 수 있다.

## 5. 이번 계약에서 제외하거나 보류하는 것

| 항목 | 상태 | 이유 |
|---|---|---|
| 홈 "지금 많이 찾는 메뉴" | **보류** (지우와 합의: `getHome` 계약 때까지) | 6절 질문 1·2 참고 |
| 홈 계좌 표시 | 제외 | 계좌 정책(T05) 미결정 |
| 이번 달 기록 | 제외 | T10, 완료 주문 조회 계약 이후 |
| 초성·오타 검색 | 제외 | 명세에서 추가 범위로 분류 (미검증) |
| 인기 검색어 실제 집계 | 제외 | Seed 단계 (FR-SRCH-009) |

## 6. 서정(제품) 확인이 필요한 것

1. **홈 인기 메뉴의 문구와 기준.** DB에 `is_popular`, `popularity_score`가 있지만 지금은 공개하지 않는다.
   - "지금 많이 찾는 메뉴"는 실제 이용자 활동처럼 읽힌다. 그런데 Seed 값을 쓰면서 실제 집계처럼 보이게 하면 FR-HOME-005·FR-DATA-024와 대표 메뉴 정책("실제 인기 메뉴처럼 표현하지 않는다")과 충돌할 수 있다.
   - 기준 후보: (A) `is_popular`인 활성 메뉴를 이름순 (B) `popularity_score` 내림차순 → 이름 → id. 어느 쪽이든 점수 숫자를 화면에 표시하지 않는다.
2. **검색 입력 규칙**(최소 글자 수, 최대 길이)은 PRD 7.9가 미결정이다. 3.1절은 기술 초깃값이다.
3. **배너·인기 검색어 문구**(Seed 가상 문구를 쓰고 실제 카피로 교체).

## 7. 합의되면 혜지가 할 일

- 새 migration: `banners`, `popular_search_terms` 테이블(+ 공개 읽기 권한), `search_stores`, `list_popular_search_terms`, `list_banners`, `list_recommended_stores`, `list_stores_by_ids`, `list_menu_cards_by_ids`
- 개발용 Seed: 배너 2~3개, 인기 검색어 몇 개 (모두 가상)
- 로컬 대체 DB 검증 추가: 검색(가게·메뉴·카테고리 일치, 중복 제거, 이스케이프, 매칭 메뉴, 입력 범위), 비활성 숨김, 최근 본 항목의 순서 유지와 누락 처리, 배너 target 숨김
