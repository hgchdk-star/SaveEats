# 카탈로그 API 계약 초안 (지우 → 혜지 논의용, 미합의)

범위: 가게 목록 · 가게 상세 · 메뉴 상세 (Guest 조회).
근거: 개발 명세 DB-001, DB-004, DB-009, API-001~004, REC-003 / PRD 8·9·10.
이 문서는 제안입니다. 합의 후 한 사람이 `src/contracts/`에 옮깁니다.

## 1. 공통 규칙 (API-001, REC-003 그대로)

```ts
type Uuid = string;          // UUID
type Won = number;           // 원 단위 정수, JS 안전 정수 범위 검사
type IsoTimestamp = string;  // UTC RFC3339

type ApiSuccess<T> = { data: T; contractVersion: string; correlationId: string };

type ApiFailure = {
  code: string;                 // 예: NOT_FOUND, NETWORK_UNAVAILABLE
  category: 'AUTH' | 'VALIDATION' | 'CONFLICT' | 'NETWORK' | 'LOCAL' | 'INTERNAL';
  retryable: boolean;
  outcomeUnknown: boolean;
  correlationId: string | null;
  safeDetails?: Record<string, unknown>;
};

type Page<T> = { items: T[]; nextCursor: string | null; hasMore: boolean }; // pageSize 기본 20, 최대 50
```

- DTO는 camelCase, DB는 snake_case. 변환은 repository에서.
- 공개 응답에는 활성 항목만 (DB-009).

## 2. DTO 제안

```ts
type CategoryRef = { id: Uuid; code: string; name: string };

type ReviewSummary = { count: number; averageCravingRating: number | null }; // 0개면 null, 가짜 값 없음

type MenuPriceRef = { id: Uuid; name: string; price: Won };

// API-003 StoreCard: id/name/category/imageRef/대표 또는 matchingMenu/activeReviewSummary/favorite
type StoreCard = {
  id: Uuid;
  name: string;
  category: CategoryRef;
  imageRef: string | null;         // 없거나 실패 시 앱이 Placeholder
  isOpen: boolean;                 // Seed 값 (FR-STORE-009)
  representativeMenu: MenuPriceRef | null;
  reviewSummary: ReviewSummary;
  isFavorite: boolean | null;      // null = Guest(조회 불가) — 질문 3
};

type StoreMenuItem = {
  id: Uuid;
  name: string;
  description: string | null;
  imageRef: string | null;
  price: Won;                      // base_price
  isSoldOut: boolean;
  isPopular: boolean;
};

type StoreDetail = StoreCard & {
  description: string | null;
  menus: StoreMenuItem[];          // sort_order 순
};

type MenuOption = { id: Uuid; name: string; additionalPrice: Won; isSoldOut: boolean };

type MenuOptionGroup = {
  id: Uuid;
  name: string;
  minSelect: number;               // 0 <= min <= max, max >= 1
  maxSelect: number;
  options: MenuOption[];
};

// API-003 MenuDetail: id/storeId/name/price/catalogRevision/soldOut/groups[min,max,options]/image
type MenuDetail = {
  id: Uuid;
  storeId: Uuid;
  name: string;
  description: string | null;
  imageRef: string | null;
  price: Won;
  catalogRevision: number;         // Cart acknowledgedCatalogRevision에 사용
  isSoldOut: boolean;
  storeIsOpen: boolean;            // 영업 종료 가게 메뉴 담기 차단용 (5절 결정 1). 검색·배너·최근 본 항목에서 메뉴로 바로 들어오는 경우 대비
  optionGroups: MenuOptionGroup[];
};
```

## 3. 호출 제안 (API-002 catalog)

| 논리 계약 | 요청 | 응답 | 주요 실패 |
|---|---|---|---|
| listStores | `{ categoryId?: Uuid; cursor?: string; pageSize?: number }` | `Page<StoreCard>` | NETWORK_UNAVAILABLE, INTERNAL |
| getStore | `{ storeId: Uuid }` | `StoreDetail` | NOT_FOUND(비활성 포함), NETWORK_UNAVAILABLE |
| getMenu | `{ menuId: Uuid }` | `MenuDetail` | NOT_FOUND, NETWORK_UNAVAILABLE |

- `categoryId` 없음 = `전체` (`전체`는 DB 카테고리 행이 아님, DB-004).
- Mock adapter와 Supabase adapter는 같은 interface를 구현 (API-004).

## 4. 혜지와 정할 것

1. **조회 방식:** Data API 직접 select로 할지 RPC로 할지. camelCase 변환은 어디서 할지.
2. **listStores 페이지네이션:** cursor 방식과 정렬 키. 예: `is_recommended DESC, name, id`.
3. **Guest 찜 표현:** `isFavorite: null`로 할지, 필드를 빼고 따로 조회할지.
4. **비활성 가게·메뉴 상세 요청:** `NOT_FOUND`로 처리할지, 비활성 플래그를 응답에 넣을지. 장바구니에 남은 비활성 메뉴를 표시하는 경우와도 관련 있음.
5. **이미지:** `imageRef` → URL 변환을 어디서 할지. 예: Storage public URL.
6. **ReviewSummary:** 계산 위치(view·RPC 등). 리뷰 기능 전에는 `{count: 0, averageCravingRating: null}`로 고정할지.
7. **대표 메뉴 선정 규칙:** `is_popular`인지 `popularity_score`인지 `sort_order`인지.
8. **오류 코드:** 이름 목록. `NOT_FOUND`, `CATALOG_ENTITY_UNAVAILABLE` 중 무엇을 쓸지.
9. **contractVersion:** 형식. 예: `catalog@0.1`.
10. **`src/contracts/` 담당자 (제안):** 지우가 TS 파일을 작성하고 혜지가 PR 리뷰에서 승인합니다. 혜지는 이 계약에 맞춰 SQL·RPC signature를 고정합니다.
11. **영업 종료 서버 검증:** 담기 차단은 앱에서 하지만, 장바구니 검증(`validate_my_cart`)과 주문 생성에서도 영업 종료 가게를 거절할지. 거절한다면 validation 값 이름(예: `STORE_CLOSED`)도 정해야 함.

## 5. 결정된 제품 정책 (2026-10-01 승인, 기획서·PRD·개발 명세 반영 완료)

1. **영업 종료(`isOpen=false`) 가게의 메뉴는 장바구니에 담을 수 없다.**
   - 메뉴 상세의 담기 버튼을 비활성화한다.
   - 이미 장바구니에 있는 항목을 어떻게 처리할지는 4절 질문 11의 서버 검증 결정을 따른다.
2. **같은 메뉴·옵션 조합의 합산 수량이 10을 넘으면 담을 수 없다.**
   - 자동으로 10에 맞춰 자르지 않고, 기존 장바구니를 그대로 둔다(CART-004 기술 최소 규칙과 같음).
   - 메뉴 상세에서 담을 때와 장바구니에서 옵션을 바꿔 같은 조합이 겹칠 때 모두 적용한다.
   - 안내 카피: `한 메뉴는 최대 10개까지 담을 수 있어요.`
