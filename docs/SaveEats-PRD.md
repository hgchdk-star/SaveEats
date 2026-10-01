# SaveEats PRD

> **Version:** 1.0 Draft  
> **기준일:** 2026-09-30  
> **상위 기준 문서:** `SaveEats 최종 서비스 기획서 v1.1`  
> **문서 목적:** 확정된 SaveEats 제품 정책을 실제 개발 가능한 수준의 요구사항으로 구체화한다.  
> **주의:** 본 PRD는 새로운 제품 방향을 정하는 문서가 아니다. 상위 기획서와 충돌할 경우 최신 최종 서비스 기획서를 우선한다.

---

# 0. PRD 공통 기준

## 0.1 제품 핵심 원칙

> **저축 앱에 음식 UI를 입히는 것이 아니라, 배달앱인데 돈의 목적지만 바뀐다.**

탐색 구간의 중심 정보는 음식, 가게, 메뉴, 가격, 옵션, SaveEats 리뷰, 땡김도다.

`참기`, `저축`, `절약`, `모으기`를 핵심 탐색 카피로 반복하지 않는다.

실제 음식이 주문되지 않고 주문금액이 사용자의 계좌로 이동한다는 사실은 최초 온보딩과 최종 주문 확인에서 명확히 안내한다.

---

## 0.2 우선순위

- **MUST**: 졸업작품 MVP에서 반드시 구현
- **SHOULD**: 설계에 포함하되 일정에 따라 MVP 구현 여부 조정 가능
- **LATER**: MVP에서는 구현하지 않으나 향후 확장 고려

> **MVP에서 구현하지 않는다 ≠ 설계에서 고려하지 않는다.**

---

## 0.3 사용자 상태

### Guest
로그인하지 않은 사용자.

사용 가능:
- 온보딩
- 홈
- 검색
- 카테고리
- 가게 상세
- 메뉴 상세
- 장바구니

### Authenticated User
Guest 기능에 더해:
- 찜
- 계좌 등록/변경/삭제
- 주문 진행
- 내역
- 리뷰
- 마이

Guest가 인증 필요 행동을 수행하려는 경우 로그인 완료 후 원래 행동 또는 화면으로 복귀한다.

---

## 0.4 공통 시간 기준

- DB Timestamp: UTC
- 사용자 표시 기준: KST (`Asia/Seoul`)
- 월간 통계 경계: KST
- 리뷰 작성 마감: `completedAt + 30 × 24h`

---

## 0.5 공통 화면 상태

필요한 경우 다음 상태를 구분한다.

- Initial Loading
- Success
- Empty
- Error
- Partial Error
- Retry
- Disabled

한 Section 실패로 전체 화면을 막지 않는 방향을 우선한다.

---

# Part 1. 탐색 및 주문 준비

## 1. Splash

### 1.1 기능 목적
앱 실행 시 최초 온보딩 완료 여부를 확인하고 적절한 첫 화면으로 이동한다.

### 1.2 User Story
- **US-SPL-001** 사용자는 앱 실행 시 필요한 첫 화면으로 자연스럽게 이동하고 싶다.

### 1.3 우선순위
**MUST**

### 1.4 선행조건 / 의존성
- 앱 로컬 저장소
- 최초 온보딩 완료 여부
- Navigation

### 1.5 기능 요구사항
- **FR-SPL-001** 앱 실행 시 최초 온보딩 완료 여부를 확인한다.
- **FR-SPL-002** 미완료 사용자는 Onboarding으로 이동한다.
- **FR-SPL-003** 완료 사용자는 Home으로 이동한다.
- **FR-SPL-004** Splash 단계에서 로그인이나 계좌 등록을 강제하지 않는다.

### 1.6 상태 / 예외
- 로컬 상태 확인 실패 시 복구 방식은 개발 명세에서 정의한다.

### 1.7 데이터 매핑
- `hasCompletedOnboarding`

### 1.8 Acceptance Criteria
- **AC-SPL-001** 최초 설치 후 실행하면 Onboarding으로 진입한다.
- **AC-SPL-002** 완료/Skip 이후 재실행하면 Home으로 진입한다.
- **AC-SPL-003** 로그인하지 않아도 Home에 진입할 수 있다.

### 1.9 미결정 / 기술 검증 필요
- Splash 최소 표시 시간
- Local Storage 라이브러리

---

## 2. 최초 온보딩

### 2.1 기능 목적
SaveEats의 핵심 경험과 실제 결과를 최초 사용자에게 짧게 설명한다.

### 2.2 User Story
- **US-ONB-001** 처음 사용하는 사용자는 서비스의 주문 경험과 실제 결과를 빠르게 이해하고 바로 탐색하고 싶다.

### 2.3 우선순위
**MUST**

### 2.4 선행조건 / 의존성
없음.

### 2.5 기능 요구사항
- **FR-ONB-001** 최초 실행 시 1회 노출한다.
- **FR-ONB-002** 총 3페이지로 구성한다.
- **FR-ONB-003** 메시지 방향:
  1. `먹고 싶은 메뉴를 평소처럼 골라보세요`
  2. `음식 대신 주문금액이 내 계좌로 배달돼요`
  3. `주문하듯, 내 계좌로`
- **FR-ONB-004** 마지막 페이지에 `[SaveEats 시작하기]` CTA를 제공한다.
- **FR-ONB-005** Skip할 수 있다.
- **FR-ONB-006** 완료/Skip 시 상태 저장 후 Home으로 이동한다.
- **FR-ONB-007** 로그인/계좌 등록을 강제하지 않는다.
- **FR-ONB-008** Skip 여부와 관계없이 Checkout에서 실제 음식 미주문 고지를 다시 제공한다.

### 2.6 상태 / 예외
- Page 이동
- Skip
- 완료

### 2.7 데이터 매핑
- `hasCompletedOnboarding`

### 2.8 Acceptance Criteria
- **AC-ONB-001** 3페이지 온보딩을 확인할 수 있다.
- **AC-ONB-002** 진행 중 Skip할 수 있다.
- **AC-ONB-003** Skip 후 로그인 없이 Home에 진입한다.
- **AC-ONB-004** `SaveEats 시작하기` 선택 시 Home으로 이동한다.
- **AC-ONB-005** 완료/Skip 이후 강제 재노출하지 않는다.

### 2.9 미결정
- 최종 이미지/일러스트
- Skip 위치

---

## 3. 인증 및 Guest Mode

### 3.1 기능 목적
로그인 없이 탐색과 Cart를 허용하고 개인 데이터가 필요한 시점에만 인증한다.

### 3.2 User Story
- **US-AUTH-001** Guest는 회원가입 전에도 충분히 탐색하고 싶다.
- **US-AUTH-002** 인증 후 원래 하려던 행동을 계속하고 싶다.

### 3.3 우선순위
**MUST**

### 3.4 선행조건 / 의존성
- Supabase Auth 예정
- Navigation Return Context
- Guest Cart

### 3.5 기능 요구사항
- **FR-AUTH-001** MVP 인증은 이메일 + 비밀번호를 기본으로 한다.
- **FR-AUTH-002** Guest는 Home/Search/Category/Store/Menu/Cart를 사용할 수 있다.
- **FR-AUTH-003** 찜/계좌/주문/내역/리뷰/마이는 인증이 필요하다.
- **FR-AUTH-004** 인증 필요 행동 시 Login Flow로 이동한다.
- **FR-AUTH-005** 로그인 성공 후 원래 행동/화면으로 복귀한다.
- **FR-AUTH-006** 로그인 실패/취소 시 Guest Cart를 유지한다.
- **FR-AUTH-007** 회원가입 이후에도 원래 행동으로 복귀하는 방향을 따른다.

### 3.6 상태 / 예외
- Guest
- Login Required
- Processing
- Success
- Failure
- Cancel

### 3.7 데이터 매핑
- User
  - `id`
  - 인증 식별 정보
  - `createdAt`

### 3.8 Acceptance Criteria
- **AC-AUTH-001** Guest도 탐색 및 Cart 사용 가능.
- **AC-AUTH-002** Guest가 찜을 시도하면 로그인 Flow 진입.
- **AC-AUTH-003** 로그인 성공 후 원래 찜 행동 지속 가능.
- **AC-AUTH-004** 로그인 취소 후 Guest Cart 유지.
- **AC-AUTH-005** Guest가 주문 진행 시 Checkout 전에 인증 요구.

### 3.9 미결정 / 기술 검증 필요
- 이메일 verification 필수 여부
- 비밀번호 재설정 UX
- Session 만료 후 복귀 정책

---

## 4. Bottom Navigation

### 4.1 기능 목적
주요 기능으로 빠르게 이동할 수 있는 5개 탭 Navigation을 제공한다.

### 4.2 User Story
- **US-NAV-001** 사용자는 익숙한 하단 Navigation으로 주요 기능 간 빠르게 이동하고 싶다.

### 4.3 우선순위
**MUST**

### 4.4 선행조건 / 의존성
- Navigation Architecture
- 인증 상태
- History unread

### 4.5 기능 요구사항
- **FR-NAV-001** Bottom Navigation은 `홈 / 검색 / 찜 / 내역 / 마이`.
- **FR-NAV-002** 선택 탭은 Tomato 계열 선택 상태를 사용한다.
- **FR-NAV-003** 내역 탭에 unread indicator를 표시할 수 있어야 한다.
- **FR-NAV-004** Guest가 인증 필요 탭에 진입하면 인증 정책을 적용한다.

### 4.8 Acceptance Criteria
- **AC-NAV-001** 정확히 5개 탭이 표시된다.
- **AC-NAV-002** 현재 탭이 시각적으로 구분된다.

### 4.9 미결정
- 탭 재선택 시 Scroll-to-top
- 탭별 Stack 보존 정책

---

## 5. Home

### 5.1 기능 목적
금융정보보다 음식 탐색을 먼저 보여준다.

### 5.2 User Story
- **US-HOME-001** 사용자는 앱을 열었을 때 음식과 메뉴 추천을 먼저 보고 싶다.

### 5.3 우선순위
**MUST**

### 5.4 선행조건 / 의존성
- Store/Menu Seed Data
- Category
- DestinationAccount
- 최근 본 항목

### 5.5 기능 요구사항
- **FR-HOME-001** 기본 순서:
  1. 돈이 배달될 현재 계좌
  2. 검색창
  3. 음식 카테고리
  4. 프로모션/콘텐츠 배너
  5. 지금 많이 찾는 메뉴
  6. 추천 가게
  7. 최근 본 가게/메뉴
  8. 필요한 경우 가벼운 이번 달 기록
- **FR-HOME-002** 계좌 미등록이어도 Home 탐색 가능.
- **FR-HOME-003** 검색창 카피: `오늘은 뭐가 먹고 싶으세요?`
- **FR-HOME-004** Seed의 `isPopular`, `isRecommended`, `popularityScore` 등을 사용할 수 있다.
- **FR-HOME-005** 실제 집계가 없을 때 가짜 사용자 활동 숫자를 표시하지 않는다.
- **FR-HOME-006** Seed Banner 2~3개.
- **FR-HOME-007** 자동 롤링보다 직접 Swipe 우선.
- **FR-HOME-008** 최근 본 항목은 Store/Menu 모두 포함 가능.
- **FR-HOME-009** 최대 10개 유지.
- **FR-HOME-010** 재조회 시 앞으로 이동.
- **FR-HOME-011** Guest 최근 본 항목은 Local 저장 가능.
- **FR-HOME-012** `참기`, `저축`, `절약`을 핵심 반복 카피로 사용하지 않는다.

### 5.6 상태 / 예외
- Initial Loading
- Success
- Section Empty
- Partial Error
- 전체 핵심 탐색 오류

### 5.8 Acceptance Criteria
- **AC-HOME-001** Guest도 Home 탐색 가능.
- **AC-HOME-002** 계좌가 없어도 탐색 가능.
- **AC-HOME-003** 시각적 중심은 음식/가게/메뉴.
- **AC-HOME-004** 허위 집계 숫자를 표시하지 않는다.
- **AC-HOME-005** 최근 본 항목은 최대 10개.

---

## 6. 음식 카테고리

### 6.1 기능 목적
음식 종류 기준으로 가게를 빠르게 탐색한다.

### 6.2 User Story
- **US-CAT-001** 사용자는 먹고 싶은 음식 종류를 선택해 관련 가게를 보고 싶다.

### 6.3 우선순위
**MUST**

### 6.5 기능 요구사항
- **FR-CAT-001** 후보: 전체 / 치킨 / 분식 / 피자 / 한식 / 중식 / 일식 / 버거 / 카페·디저트
- **FR-CAT-002** 데이터 기반 관리.
- **FR-CAT-003** 추가/삭제/순서 변경 가능.
- **FR-CAT-004** Single Select.
- **FR-CAT-005** `전체`도 상호 배타적 선택 상태.

### 6.8 Acceptance Criteria
- **AC-CAT-001** 동시에 둘 이상의 Category가 선택되지 않는다.
- **AC-CAT-002** 전체 선택 시 다른 선택 해제.
- **AC-CAT-003** 데이터 기준으로 순서 변경 가능.

---

## 7. Search

### 7.1 기능 목적
가게명, 메뉴명, Category를 통해 원하는 음식을 찾는다.

### 7.2 User Story
- **US-SRCH-001** 사용자는 특정 가게/메뉴를 검색해 관련 가게를 찾고 싶다.

### 7.3 우선순위
**MUST**

### 7.5 기능 요구사항
- **FR-SRCH-001** Home SearchBar와 Search 탭은 동일 경험으로 연결.
- **FR-SRCH-002** 대상: Store Name / Menu Name / Category.
- **FR-SRCH-003** 결과 UI는 StoreCard List only.
- **FR-SRCH-004** Menu 검색 시 해당 StoreCard 표시.
- **FR-SRCH-005** 매칭 Menu Name/Price 등 관련 정보를 카드에서 표시.
- **FR-SRCH-006** SaveEats 리뷰 수 표시 가능.
- **FR-SRCH-007** 최근 검색어 제공.
- **FR-SRCH-008** 최근 검색어 개별/전체 삭제.
- **FR-SRCH-009** 인기 검색어는 MVP Seed 가능.
- **FR-SRCH-010** 향후 실제 검색 데이터 기반으로 교체 가능.
- **FR-SRCH-011** 배달비/최소주문금액/배달예상시간을 임의로 만들지 않는다.

### 7.6 상태 / 예외
- Initial
- Searching
- Result
- Empty
- Error

### 7.8 Acceptance Criteria
- **AC-SRCH-001** MenuCard 별도 결과 섹션 없음.
- **AC-SRCH-002** Menu Match 시 Store가 결과에 표시됨.
- **AC-SRCH-003** 결과 없음 Empty State 제공.
- **AC-SRCH-004** 최근 검색어 개별/전체 삭제 가능.

### 7.9 미결정
- 최소 글자 수
- Debounce
- 초성/오타 대응
- 최근 검색어 최대 수

---

## 8. StoreCard / Store List

### 8.1 기능 목적
음식 이미지와 핵심 정보를 통해 가게를 비교/선택한다.

### 8.5 기능 요구사항
- **FR-STORE-001** 후보 정보:
  - 대표 이미지
  - 가게명
  - Category
  - 대표/검색 매칭 메뉴
  - 필요한 가격 정보
  - 땡김도
  - SaveEats 리뷰 수
  - 찜 상태
- **FR-STORE-002** 예: `땡김도 4.8 · SaveEats 리뷰 1,284`
- **FR-STORE-003** 이미지 실패 시 중립적 음식 Placeholder.
- **FR-STORE-004** 정보 밀도/순서는 디자인 단계 조정 가능.
- **FR-STORE-005** 존재하지 않는 배송 정보를 추가하지 않는다.

### 8.8 Acceptance Criteria
- **AC-STORE-001** 선택 시 Store Detail 이동.
- **AC-STORE-002** 이미지 오류가 Card 전체 오류가 되지 않는다.
- **AC-STORE-003** 존재하지 않는 배송정보 미표시.

---

## 9. Store Detail

### 9.1 기능 목적
가게의 메뉴와 SaveEats 리뷰를 배달앱 정보 구조로 탐색한다.

### 9.5 기능 요구사항
- **FR-STORE-006** 기본 정보:
  - 가게명
  - 대표 이미지
  - Category
  - 소개
  - 땡김도
  - SaveEats 리뷰 수
  - 메뉴/가격/설명/옵션
  - 품절 여부
  - 찜 상태
- **FR-STORE-007** 탭: 메뉴 / SaveEats 리뷰 / 가게정보.
- **FR-STORE-008** 리뷰 탭은 `storeId` 기준 Review List.
- **FR-STORE-009** 영업 상태는 Seed 값 사용 가능.
- **FR-STORE-010** 가게정보는 MVP 최소 수준.
- **FR-STORE-011** 실제 집계 없는 활동 지표를 생성하지 않는다.

### 9.8 Acceptance Criteria
- **AC-STORE-004** 3개 탭 접근 가능.
- **AC-STORE-005** Review 오류가 Menu 탐색을 막지 않는다.

---

## 10. Menu Detail / Option / Quantity

### 10.1 기능 목적
메뉴/옵션/수량을 선택하고 최종 금액 확인 후 Cart에 담는다.

### 10.5 기능 요구사항
- **FR-MENU-001** 메뉴명/이미지/설명/기본가격/옵션/수량/품절/최종 금액/담기 CTA 제공.
- **FR-MENU-002** 수량 최소 1.
- **FR-MENU-003** 수량 최대 10.
- **FR-MENU-004** 수량 0으로 자동 삭제하지 않는다.
- **FR-MENU-005** 필수 옵션 미선택 시 담기 불가.
- **FR-MENU-006** 기본가격 + 옵션 + 수량으로 최종 금액 계산.
- **FR-MENU-007** 가격/필수 옵션 신뢰 불가 시 담기 차단.
- **FR-MENU-008** 오류 문구: `옵션 정보를 불러오지 못했어요. 다시 불러와주세요.` + `[다시 시도]`
- **FR-MENU-009** 품절 메뉴는 신규 추가 불가.

### 10.8 Acceptance Criteria
- **AC-MENU-001** 1 미만 불가.
- **AC-MENU-002** 10 초과 불가.
- **AC-MENU-003** 필수 옵션 미선택 시 Cart Item 생성 불가.
- **AC-MENU-004** 옵션 오류 상태에서 담기 불가.
- **AC-MENU-005** 선택 변경 시 최종 금액 갱신.

---

## 11. Store Favorite

### 11.1 기능 목적
관심 가게를 저장한다.

### 11.5 기능 요구사항
- **FR-FAV-001** MVP Favorite 대상은 Store only.
- **FR-FAV-002** Menu Favorite 미제공.
- **FR-FAV-003** Guest 찜 시 Login Flow.
- **FR-FAV-004** 로그인 후 원래 Store로 복귀해 찜 계속.
- **FR-FAV-005** Toggle 추가/해제.
- **FR-FAV-006** 삭제/비활성 Store는 찜 목록에서 숨김.

### 11.8 Acceptance Criteria
- **AC-FAV-001** Menu Favorite 없음.
- **AC-FAV-002** 로그인 전 서버 Favorite 생성 없음.
- **AC-FAV-003** 비활성 Store 미표시.

---

## 12. Cart

### 12.1 기능 목적
선택 Menu/Option/Quantity/금액을 확인하고 Checkout을 시작한다.

### 12.2 User Story
- **US-CART-001** 사용자는 장바구니에서 주문 내용을 확인하고 주문하고 싶다.
- **US-CART-002** Guest도 로그인 전 Cart를 유지하고 싶다.

### 12.5 기능 요구사항
- **FR-CART-001** Guest Cart 허용.
- **FR-CART-002** Local 임시 저장.
- **FR-CART-003** 로그인 성공 시 User Cart로 승격.
- **FR-CART-004** 로그인 실패/취소 시 Cart 유지.
- **FR-CART-005** 복잡한 Merge 미구현.
- **FR-CART-006** 충돌 시 최신 Local Cart 우선.
- **FR-CART-007** Single-Store Cart.
- **FR-CART-008** One Order = One Store.
- **FR-CART-009** 다른 Store Menu 추가 시 기존 Cart 비움 확인.
- **FR-CART-010** 확인 시 기존 Cart 비우고 새 Menu 추가.
- **FR-CART-011** 취소 시 기존 Cart 유지.
- **FR-CART-012** Quantity 1~10.
- **FR-CART-013** Item 삭제는 별도 Action.
- **FR-CART-014** 가격 변경을 조용히 반영하지 않는다.
- **FR-CART-015** 변경 전/후 명시 후 사용자 확인 필요.
- **FR-CART-016** 품절 문제 해결 전 `주문하기` 비활성.
- **FR-CART-017** Main CTA: `주문하기`
- **FR-CART-018** Empty Cart State 제공.

### 12.8 Acceptance Criteria
- **AC-CART-001** 인증 Flow 이후에도 Guest Cart 유지.
- **AC-CART-002** 서로 다른 Store Menu 동시 존재 불가.
- **AC-CART-003** 다른 Store 추가 전 기존 Cart 삭제 가능성 고지.
- **AC-CART-004** 가격 변경 미확인 상태에서 주문 불가.
- **AC-CART-005** 품절 해결 전 주문 불가.
- **AC-CART-006** 수량 0 삭제 불가.
- **AC-CART-007** Empty Cart는 Checkout 진입 불가.

---

## 13. Destination Account

### 13.1 기능 목적
주문금액이 도착할 계좌를 등록하고 표시한다.

### 13.5 기능 요구사항
- **FR-ACC-001** Home 상단에 현재 목적지 계좌 표시.
- **FR-ACC-002** 미등록 카피:
  - `계좌를 등록해주세요 ⌄`
  - `아낀 주문금액이 배달될 곳이에요.`
- **FR-ACC-003** 계좌 등록은 탐색/Cart의 선행조건 아님.
- **FR-ACC-004** 주문 시 계좌 없으면 등록 요구.
- **FR-ACC-005** 등록 완료 후 Cart 유지하고 주문 Flow 복귀.
- **FR-ACC-006** 사용자당 활성 계좌 1개.
- **FR-ACC-007** 변경/교체 가능.
- **FR-ACC-008** 삭제 가능.
- **FR-ACC-009** 삭제 시 미등록 상태.
- **FR-ACC-010** Masked Format 예: `토스뱅크 •••• 1234`
- **FR-ACC-011** 과거 Order는 당시 계좌 Snapshot 유지.
- **FR-ACC-012** 복수계좌 UI 미리 구현하지 않음.
- **FR-ACC-013** 입력 행위는 `등록`, 실제 금융 API 전에는 `연결` 표현 금지.

### 13.8 Acceptance Criteria
- **AC-ACC-001** 계좌 없어도 Cart까지 사용 가능.
- **AC-ACC-002** 실제 주문 진행 시 계좌 등록 요구.
- **AC-ACC-003** 주문 중 등록 후 Cart 유지.
- **AC-ACC-004** 활성 목적지 계좌는 1개.
- **AC-ACC-005** 삭제 후 미등록 상태 UI.
- **AC-ACC-006** 실제 API 연동 없이는 `연결된 계좌` 표현 금지.

### 13.9 기술 검증 필요
- 계좌번호 저장 범위
- 암호화 방식
- Supabase RLS
- 로그 Masking
- Bank 식별 구조

---

# Part 2. 주문 및 송금 / 완료

## 14. Order Confirm

### 14.1 기능 목적
실제 돈을 이동하기 전 메뉴/계좌/주문금액과 결과를 최종 확인한다.

### 14.2 User Story
- **US-ORD-001** 사용자는 송금 전에 주문 내용과 실제 결과를 명확히 확인하고 싶다.

### 14.3 우선순위
**MUST**

### 14.5 기능 요구사항
- **FR-ORD-001** 로그인/Cart/계좌/품절/가격변경/필수옵션 유효성 검증.
- **FR-ORD-002** 계좌 미등록 시 등록 Flow 선행.
- **FR-ORD-003** 등록 완료 후 기존 Cart 유지.
- **FR-ORD-004** 주문 메뉴 / 돈이 배달될 곳 / 주문금액 표시.
- **FR-ORD-005** `음식은 주문되지 않아요. 주문금액 27,000원이 등록한 계좌로 이동합니다.`
- **FR-ORD-006** Main CTA: `[27,000원 내 계좌로 주문하기]`
- **FR-ORD-007** 보조 Action: `다른 방법으로 주문하기`
- **FR-ORD-008** 온보딩 여부와 무관하게 최종 고지 필수.
- **FR-ORD-009** 명확성을 우선한다.

### 14.8 Acceptance Criteria
- **AC-ORD-001** 로그인 전 유효 Order 생성 불가.
- **AC-ORD-002** 계좌 등록 후 동일 Cart로 복귀.
- **AC-ORD-003** 실제 음식 미주문 안내 표시.
- **AC-ORD-004** CTA에 현재 주문금액 포함.
- **AC-ORD-005** 가격/품절 문제 해결 전 주문 불가.

---

## 15. Order 생성 및 PENDING 선생성

### 15.1 기능 목적
외부 금융앱 이동 전 주문 시작 사실과 당시 데이터를 저장한다.

### 15.5 기능 요구사항
- **FR-ORD-010** 최종 CTA 직후 외부 앱 이동 전에 Order 생성.
- **FR-ORD-011** 초기 상태 `PENDING`.
- **FR-ORD-012** Order 생성 성공 전 외부 앱 자동 실행 금지.
- **FR-ORD-013** Snapshot 저장:
  - Store
  - Menu
  - Selected Options
  - Quantity
  - 가격
  - 총 주문금액
  - 계좌 Masked Snapshot
- **FR-ORD-014** 현재 Entity 변경/삭제와 무관하게 과거 Order 유지.
- **FR-ORD-015** Order 생성 실패 시 송금 Flow 시작 금지.
- **FR-ORD-016** 반복 Tap 중복 Order 방지.
- **FR-ORD-017** 동일 `orderId`를 이후 Flow에서 유지.
- **FR-ORD-018** `PENDING`은 실패 상태가 아님.

### 15.8 Acceptance Criteria
- **AC-ORD-006** 외부 앱 열기 전에 DB Order 존재.
- **AC-ORD-007** 최초 상태 PENDING.
- **AC-ORD-008** 생성 실패 시 외부 앱 미실행.
- **AC-ORD-009** 현재 Entity 변경 후에도 Snapshot 유지.
- **AC-ORD-010** 동일 주문 의도에서 중복 Order 방지.

### 15.9 기술 설계 필요
- Idempotency
- Snapshot 상세 Field
- PENDING 자동 만료는 미결정

---

## 16. Order Status Model

### 16.1 상태
| Status | 의미 |
|---|---|
| `PENDING` | 주문 시작 후 완료 확인 필요 |
| `USER_CONFIRMED` | 사용자가 완료 확인, 자동 검증은 없음 |
| `VERIFIED` | 향후 공식 연동으로 시스템 검증 |
| `FAILED` | 검증 가능한 과정에서 실패 확인 |
| `CANCELLED` | 사용자 명시 취소 |

### 16.5 기능 요구사항
- **FR-ORD-020** 위 상태 모델 지원.
- **FR-ORD-021** MVP 일반 Flow: `PENDING → USER_CONFIRMED`.
- **FR-ORD-022** 자동 검증 없이는 `VERIFIED` 금지.
- **FR-ORD-023** `아직이에요`는 PENDING 유지.
- **FR-ORD-024** 명시 취소에서만 CANCELLED.
- **FR-ORD-025** 상태 변경 시 OrderStatusUpdate 이력 보존.
- **FR-ORD-026** 사용자 UI에는 기술 상태명을 반복 노출하지 않는다.

### 16.8 Acceptance Criteria
- **AC-ORD-011** 완료 확인 시 USER_CONFIRMED.
- **AC-ORD-012** 자동 검증 없는 주문은 VERIFIED 아님.
- **AC-ORD-013** 아직이에요 → PENDING 유지.
- **AC-ORD-014** 아직이에요와 취소를 동일 처리하지 않음.

---

## 17. Toss 주문 이어가기

### 17.1 기능 목적
PoC가 통과한 범위에서 Toss를 편의 경로로 제공한다.

### 17.3 우선순위
**MUST — PoC 통과 시 활성화**

### 17.5 기능 요구사항
- **FR-TRF-001** PENDING Order 생성 후에만 실행.
- **FR-TRF-002** 사용자 명칭: `토스로 주문 이어가기`
- **FR-TRF-003** 은행/계좌/금액 사전입력은 실기기 PoC 통과 시에만 활성화.
- **FR-TRF-004** 검증되지 않은 Parameter는 사용하지 않는다.
- **FR-TRF-005** `toss_deeplink_attempted` 이벤트 기록 가능.
- **FR-TRF-006** Deep Link 실행 자체를 송금 성공으로 처리하지 않는다.
- **FR-TRF-007** 외부 앱 이동으로 USER_CONFIRMED/VERIFIED 자동 전환 금지.
- **FR-TRF-008** `tossDeepLinkEnabled` Kill Switch 적용.
- **FR-TRF-009** OFF 시 직접 주문 이어가기 사용.
- **FR-TRF-010** 미설치/실패 시 Manual Flow 제공.
- **FR-TRF-011** Order Domain을 Toss에 종속시키지 않는다.

### 17.9 기술 검증 필요
- URL Scheme 공식 지원 범위
- 은행/계좌/금액 사전입력
- Android/iOS
- Toss 버전
- 외부 앱 복귀
- 미설치 처리

---

## 18. 직접 주문 이어가기

### 18.1 기능 목적
Toss Deep Link와 무관하게 안전한 대체 경로를 제공한다.

### 18.5 기능 요구사항
- **FR-TRF-020** `다른 방법으로 주문하기` / `직접 주문 이어가기`
- **FR-TRF-021** 은행/계좌/주문금액 표시.
- **FR-TRF-022** 계좌번호와 금액을 별도 Copy Action으로 제공.
- **FR-TRF-023** 사용자 Action 없는 자동 Clipboard 금지.
- **FR-TRF-024** 계좌번호 Copy Feedback.
- **FR-TRF-025** 금액 Copy Feedback.
- **FR-TRF-026** `[토스 열기]` 제공 가능.
- **FR-TRF-027** 자동 입력 보장 금지.
- **FR-TRF-028** 기존 PENDING `orderId` 유지.
- **FR-TRF-029** `manual_transfer_selected` 이벤트 가능.

### 18.8 Acceptance Criteria
- **AC-TRF-005** 자동 계좌번호 복사 없음.
- **AC-TRF-006** 자동 금액 복사 없음.
- **AC-TRF-007** Kill Switch OFF여도 Manual Flow 존재.
- **AC-TRF-008** 오류 중에도 기존 Order 유지.

---

## 19. 외부 앱 복귀 및 완료 확인

### 19.1 기능 목적
자동 송금 검증이 없는 MVP에서 사용자가 직접 완료 여부를 확인한다.

### 19.5 기능 요구사항
- **FR-ORD-030** 복귀 후 `PENDING` Order 완료 여부 확인.
- **FR-ORD-031** `주문을 완료하셨나요?`
  - `[아직이에요]`
  - `[주문 완료했어요]`
- **FR-ORD-032** 아직이에요 → PENDING 유지.
- **FR-ORD-033** 아직이에요는 실패/취소가 아님.
- **FR-ORD-034** 주문 완료했어요 → USER_CONFIRMED.
- **FR-ORD-035** 전환 시 `completedAt` 기록.
- **FR-ORD-036** completedAt은 리뷰 마감/월간 기록 기준.
- **FR-ORD-037** 사용자 확인만으로 VERIFIED 금지.
- **FR-ORD-038** 복귀 감지 실패/앱 종료 시에도 History에서 PENDING 이어가기 가능.

### 19.8 Acceptance Criteria
- **AC-ORD-015** 아직이에요 → PENDING.
- **AC-ORD-016** 주문 완료했어요 → USER_CONFIRMED.
- **AC-ORD-017** completedAt 저장.
- **AC-ORD-018** 외부 앱 실행 자체로 completedAt 생성 금지.
- **AC-ORD-019** 앱 종료 후에도 PENDING Order 조회 가능.

---

## 20. 주문 상태 저장 실패 복구

### 20.1 기능 목적
실제 송금 후 SaveEats 상태 저장 실패가 중복 송금으로 이어지지 않도록 한다.

### 20.5 기능 요구사항
- **FR-ORD-040** USER_CONFIRMED 저장 실패를 별도 처리.
- **FR-ORD-041** 이를 송금 실패라고 표현하지 않는다.
- **FR-ORD-042** `송금을 이미 완료했다면 다시 송금하지 마세요.` 안내.
- **FR-ORD-043** Retry는 동일 Order ID의 상태 저장만 재시도.
- **FR-ORD-044** Retry 중 외부 금융앱 자동 재실행 금지.
- **FR-ORD-045** 앱 재실행 후 복구 가능 구조 고려.
- **FR-ORD-046** 중복 송금 방지를 편의성보다 우선.

### 20.8 Acceptance Criteria
- **AC-ORD-020** 상태 저장 실패 시 재송금 유도 금지.
- **AC-ORD-021** Retry로 외부 앱 재실행 금지.
- **AC-ORD-022** 동일 orderId 재시도.
- **AC-ORD-023** 저장 성공 후에만 서버 USER_CONFIRMED.

### 20.9 기술 검증 필요
- Local Recovery Queue
- 앱 강제 종료 복구
- Offline 처리

---

## 21. 주문 취소

### 21.5 기능 요구사항
- **FR-ORD-050** PENDING Order에 명시적 취소 경로 제공 가능.
- **FR-ORD-051** 취소 확정 시 CANCELLED.
- **FR-ORD-052** 아직이에요와 취소는 별도 Action.
- **FR-ORD-053** CANCELLED를 완료처럼 표현하지 않는다.
- **FR-ORD-054** 취소 전 의미를 명확히 안내.

### 21.8 Acceptance Criteria
- **AC-ORD-024** 아직이에요로 취소되지 않는다.
- **AC-ORD-025** 명시 취소 후에만 CANCELLED.
- **AC-ORD-026** 저장 실패 시 취소 성공으로 단정 표시 금지.

---

## 22. PENDING 주문 이어하기

### 22.5 기능 요구사항
- **FR-ORD-060** `주문 완료가 필요해요` + `[주문 이어하기]`
- **FR-ORD-061** 새 Order 생성 금지.
- **FR-ORD-062** 기존 Snapshot 사용.
- **FR-ORD-063** 현재 가격으로 조용히 변경 금지.
- **FR-ORD-064** Toss OFF면 Manual Flow.
- **FR-ORD-065** PENDING 자동 만료를 임의 적용하지 않는다.

### 22.8 Acceptance Criteria
- **AC-ORD-027** 새 Order ID 생성 금지.
- **AC-ORD-028** Snapshot 금액 유지.
- **AC-ORD-029** Toss OFF에서도 이어가기 가능.

---

## 23. Order Complete

### 23.1 기능 목적
USER_CONFIRMED 기반으로 SaveEats만의 완료 경험을 제공한다.

### 23.5 기능 요구사항
- **FR-ORD-070** MVP 완료 화면은 USER_CONFIRMED 기반.
- **FR-ORD-071** 기술 상태명 노출 금지.
- **FR-ORD-072** Header: `주문 완료 🎉`
- **FR-ORD-073** 핵심 메시지: `27,000원이 내 계좌로 배달됐어요`
- **FR-ORD-074** 계좌 Snapshot / Store / Menu Summary / 주문금액 표시.
- **FR-ORD-075** `[내역 보기] [SaveEats 리뷰 남기기]`
- **FR-ORD-076** 리뷰 CTA는 Part 3 정책 적용.
- **FR-ORD-077** `송금 검증 완료`, `은행 확인 완료` 등 과장 금지.

### 23.8 Acceptance Criteria
- **AC-ORD-030** USER_CONFIRMED 저장 후 완료 화면 표시.
- **AC-ORD-031** VERIFIED 표현 미사용.
- **AC-ORD-032** 당시 Snapshot 표시.
- **AC-ORD-033** 내역/리뷰 Flow 이동 가능.

---

## 24. OrderStatusUpdate

### 24.5 기능 요구사항
- **FR-ORD-080** 상태 변경 시 OrderStatusUpdate 생성.
- **FR-ORD-081** 최소 데이터:
  - orderId
  - fromStatus
  - toStatus
  - createdAt
  - viewedAt/read
- **FR-ORD-082** 읽었다고 삭제하지 않는다.
- **FR-ORD-083** read는 조회 상태만 변경.
- **FR-ORD-084** unread/read 상세는 Part 3.

### 24.8 Acceptance Criteria
- **AC-ORD-034** 상태 변경 이력 보존.
- **AC-ORD-035** read 후에도 Record 유지.

---

# Part 3. 내역 및 SaveEats 리뷰

## 25. 주문 내역

### 25.1 기능 목적
과거/미완료 주문을 배달앱 주문내역처럼 조회한다.

### 25.5 기능 요구사항
- **FR-HIST-001** 인증 사용자만 접근.
- **FR-HIST-002** 최신순 `createdAt DESC`.
- **FR-HIST-003** 무한스크롤.
- **FR-HIST-004** Snapshot 기준 표시.
- **FR-HIST-005** PENDING: `주문 완료가 필요해요` + `[주문 이어하기]`
- **FR-HIST-006** USER_CONFIRMED: `내 계좌로 27,000원 배달`
- **FR-HIST-007** 현재 Menu 유효 시에만 `같은 메뉴 보기`.
- **FR-HIST-008** Menu 삭제 시 과거 Order 유지.
- **FR-HIST-009** 월간 요약 제공 가능.
- **FR-HIST-010** 금융 거래내역처럼 디자인하지 않는다.
- **FR-HIST-011** 현재 이미지/Entity 삭제에도 Order 주요 기록 유지.

### 25.6 상태 / 예외
- Initial Loading
- Success
- Empty
- Initial Load Error
- Pagination Loading
- Pagination Error

### 25.8 Acceptance Criteria
- **AC-HIST-001** 최신순.
- **AC-HIST-002** 첫 페이지 실패 시 전체 Error.
- **AC-HIST-003** 다음 페이지 실패 시 기존 목록 유지.
- **AC-HIST-004** PENDING에서 주문 이어가기 가능.
- **AC-HIST-005** Menu 삭제돼도 과거 Order 유지.
- **AC-HIST-006** 금융 거래 UI가 아닌 주문 중심 구조.

---

## 26. History의 PENDING 주문 이어가기

### 26.5 기능 요구사항
- **FR-HIST-020** PENDING은 완료 Order와 구분.
- **FR-HIST-021** 새 Order 생성 금지.
- **FR-HIST-022** 기존 orderId/Snapshot 사용.
- **FR-HIST-023** Toss OFF면 Manual Flow.
- **FR-HIST-024** 자동 만료 미확정이므로 임의 숨김/삭제 금지.
- **FR-HIST-025** CANCELLED는 이어가기 대상 아님.

### 26.8 Acceptance Criteria
- **AC-HIST-007** 새 Order ID 생성 없음.
- **AC-HIST-008** 현재 가격으로 변경 없음.
- **AC-HIST-009** Kill Switch OFF여도 이어가기 가능.

---

## 27. 주문 상태 unread/read

### 27.1 기능 목적
미확인 주문 상태 변경을 History와 Bottom Navigation에서 알린다.

### 27.5 기능 요구사항
- **FR-HIST-030** 빨간 점 = 미확인 Order Status Update.
- **FR-HIST-031** 리뷰 미작성과 무관.
- **FR-HIST-032** unread OrderHistoryItem에 표시.
- **FR-HIST-033** 하나 이상이면 Bottom Navigation `내역`에도 표시.
- **FR-HIST-034** 탭 진입만으로 전체 read 금지.
- **FR-HIST-035** Row가 50% 이상 약 1초 노출 시 read.
- **FR-HIST-036** 일부 노출은 read 금지.
- **FR-HIST-037** 화면 체류 중 새 Update도 먼저 unread 생성.
- **FR-HIST-038** 새 Update에도 동일 read 조건 적용.
- **FR-HIST-039** read 저장 실패 사용자 오류 미노출.
- **FR-HIST-040** UI에서는 read 처리 후 silent retry.
- **FR-HIST-041** read 후에도 Update 삭제 금지.
- **FR-HIST-042** 상태 이력 유지.

### 27.8 Acceptance Criteria
- **AC-HIST-010** 탭 진입만으로 빨간 점 일괄 삭제 없음.
- **AC-HIST-011** 50%+약1초 후 read.
- **AC-HIST-012** 스쳐 지나간 Row는 unread 유지 가능.
- **AC-HIST-013** Read API 실패 사용자 오류 미노출.
- **AC-HIST-014** read 이후 이력 유지.
- **AC-HIST-015** 리뷰 작성 여부와 무관.

---

## 28. SaveEats 리뷰 조회

### 28.1 기능 목적
같은 가게/메뉴를 고민했던 사용자 경험을 배달앱 리뷰처럼 제공한다.

### 28.5 기능 요구사항
- **FR-REV-001** 화면 제목은 항상 `SaveEats 리뷰`.
- **FR-REV-002** `가게 전체 리뷰`, `뿌링클 리뷰` 등으로 제목 변경하지 않는다.
- **FR-REV-003** UI는 공통, Query Scope만 다르게.
- **FR-REV-004** Store 진입: `storeId` 기준.
- **FR-REV-005** Menu 진입: `menuId` 기준.
- **FR-REV-006** 기본 정렬 최신순.
- **FR-REV-007** 정렬:
  - 최신순
  - 도움순
  - 땡김도 높은 순
  - 땡김도 낮은 순
- **FR-REV-008** 추천순은 LATER.
- **FR-REV-009** 다량 Review는 Pagination/무한스크롤 가능 구조.

### 28.8 Acceptance Criteria
- **AC-REV-001** Store 진입 시 해당 Store Review.
- **AC-REV-002** Menu 진입 시 해당 Menu Review.
- **AC-REV-003** 화면 제목 동일.
- **AC-REV-004** 기본 최신순.

---

## 29. ReviewSummary / 땡김도

### 29.5 기능 요구사항
- **FR-REV-020** 맛 별점 미사용.
- **FR-REV-021** 평가 = 땡김도.
- **FR-REV-022** 1~5.
- **FR-REV-023** 예: `땡김도 4.8 ★★★★★ / SaveEats 리뷰 1,284`
- **FR-REV-024** Active Review 기준 집계.
- **FR-REV-025** Review 없을 때 가짜 평균/수 생성 금지.

### 29.8 Acceptance Criteria
- **AC-REV-005** Review 0개면 임의 평균 미표시.
- **AC-REV-006** Deleted Review 집계 제외.
- **AC-REV-007** 땡김도 1~5.

---

## 30. ReviewCard

### 30.5 기능 요구사항
- **FR-REV-030** 기본 순서:
  1. 작성자 표시명
  2. 땡김도/작성일
  3. 메뉴명
  4. 사진
  5. 본문
  6. `27,000원 · 주문 완료`
  7. 도움돼요
- **FR-REV-031** 작성자는 마스킹된 이름.
- **FR-REV-032** 공개 닉네임 LATER.
- **FR-REV-033** Order 주문금액 표시 가능.
- **FR-REV-034** 실제 음식 맛/배달 경험 평가 미표시.
- **FR-REV-035** Soft Deleted Review 공개 목록 미표시.
- **FR-REV-036** 필요 시 `수정됨` 표시.

### 30.8 Acceptance Criteria
- **AC-REV-008** 사진 없는 Review도 정상 표시.
- **AC-REV-009** 삭제 Review 공개 목록 미표시.
- **AC-REV-010** 실제 맛 평가 정보 미노출.

---

## 31. 도움돼요

### 31.5 기능 요구사항
- **FR-REV-040** 로그인 사용자만 가능.
- **FR-REV-041** Guest 선택 시 Login Flow.
- **FR-REV-042** 사용자당 Review당 1개 Active Helpful.
- **FR-REV-043** Toggle 취소 가능.
- **FR-REV-044** 자기 Review 불가.
- **FR-REV-045** `(userId, reviewId)` Unique 권장.
- **FR-REV-046** Review 수정 시 Helpful 유지.
- **FR-REV-047** 삭제 Review Helpful은 새 Review에 승계 안 함.
- **FR-REV-048** 재작성 Review는 0부터 시작.

### 31.8 Acceptance Criteria
- **AC-REV-011** 중복 Helpful Record 불가.
- **AC-REV-012** Toggle 취소 가능.
- **AC-REV-013** 자기 Review 불가.
- **AC-REV-014** 수정 후 Count 유지.
- **AC-REV-015** 재작성 시 이전 Count 미승계.

---

## 32. Review 작성 가능 여부 / 30일 정책

### 32.5 기능 요구사항
- **FR-REV-050** `completedAt` 있는 정상 완료 Order만 대상.
- **FR-REV-051** PENDING은 대상 아님.
- **FR-REV-052** CANCELLED 대상 아님.
- **FR-REV-053** MVP 완료 기준 USER_CONFIRMED.
- **FR-REV-054** `reviewDeadline = completedAt + 30 days`
- **FR-REV-055** 정확히 30×24시간.
- **FR-REV-056** 마감 시각까지 작성 가능, 초과 시 불가.
- **FR-REV-057** `리뷰는 주문 완료 후 30일 동안 작성할 수 있어요.`
- **FR-REV-058** Order Timestamp 기준으로 검증.

### 32.6 상태 규칙
- Case A: Review 없음 + 30일 이내 → `리뷰 쓰기`
- Case B: Active Review 존재 → `✓ 리뷰 작성 완료 · 보기`
- Case C: 삭제 + 30일 이내 → `리뷰 쓰기`
- Case D: 삭제 + 30일 초과 → `리뷰 작성 기간이 지났어요`
- Case E: 미작성 + 30일 초과 → `리뷰 작성 기간이 지났어요`

### 32.8 Acceptance Criteria
- **AC-REV-016** completedAt 없으면 작성 불가.
- **AC-REV-017** 마감 시각까지 작성 가능.
- **AC-REV-018** 마감 초과 후 생성 불가.
- **AC-REV-019** 30일 내 삭제 후 재작성 가능.
- **AC-REV-020** 30일 초과 후 삭제 시 재작성 불가.
- **AC-REV-021** Active Review 동시 2개 불가.

---

## 33. Review 작성

### 33.5 기능 요구사항
- **FR-REV-060** 땡김도 필수.
- **FR-REV-061** 범위 1~5.
- **FR-REV-062** 본문 필수 5~500자.
- **FR-REV-063** 사진 선택.
- **FR-REV-064** MVP 최대 1장.
- **FR-REV-065** 구조는 Review 1 : ReviewImage N.
- **FR-REV-066** 기본 공개 Review.
- **FR-REV-067** 공개/비공개 선택 미제공.
- **FR-REV-068** Order/Store/Menu/금액/작성자 변경 불가.
- **FR-REV-069** Active Review 있으면 새 Review 생성 불가.
- **FR-REV-070** 서버에서도 Deadline 검증.
- **FR-REV-071** 생성 성공 후 작성 완료 상태 반영.

### 33.8 Acceptance Criteria
- **AC-REV-022** 땡김도 미입력 제출 불가.
- **AC-REV-023** 5자 미만 불가.
- **AC-REV-024** 500자 초과 불가.
- **AC-REV-025** 사진 2장 이상 업로드 불가.
- **AC-REV-026** 사진 없이 작성 가능.
- **AC-REV-027** 기한 지난 Order 생성 실패.
- **AC-REV-028** Active Review 동시 2개 불가.

---

## 34. Review 수정

### 34.5 기능 요구사항
- **FR-REV-080** 작성자만 수정.
- **FR-REV-081** 수정 가능: 땡김도/본문/사진.
- **FR-REV-082** 수정 불가: Order/Store/Menu/금액/작성자.
- **FR-REV-083** 기존 Review Record 갱신.
- **FR-REV-084** 새 Review 생성 금지.
- **FR-REV-085** Helpful 유지.
- **FR-REV-086** 30일 이후에도 Active Review 수정 가능.
- **FR-REV-087** updatedAt 갱신.

### 34.8 Acceptance Criteria
- **AC-REV-029** Review ID 유지.
- **AC-REV-030** Helpful 유지.
- **AC-REV-031** 30일 이후 수정 가능.
- **AC-REV-032** Order/Menu/금액 변경 불가.

---

## 35. Review 삭제

### 35.5 기능 요구사항
- **FR-REV-090** 작성자만 삭제.
- **FR-REV-091** Soft Delete.
- **FR-REV-092** deletedAt 기록.
- **FR-REV-093** 삭제 확인 Modal.
- **FR-REV-094** Deadline 전 삭제 후 재작성 가능.
- **FR-REV-095** Deadline 후 삭제 전 `삭제하면 이 주문에는 리뷰를 다시 작성할 수 없어요.` 경고.
- **FR-REV-096** 삭제 후 Active Review 아님.
- **FR-REV-097** 공개/My Active List에서 숨김.
- **FR-REV-098** 물리 삭제 정책은 개발/운영 명세.

### 35.8 Acceptance Criteria
- **AC-REV-033** 즉시 물리 삭제하지 않고 deletedAt 기록.
- **AC-REV-034** 마감 후 삭제 전 경고.
- **AC-REV-035** 삭제 실패 시 성공으로 단정하지 않는다.

---

## 36. Review 삭제 후 재작성

### 36.5 기능 요구사항
- **FR-REV-100** 30일 내면 새 Review 생성 가능.
- **FR-REV-101** 기존 Review 복구가 아니라 새 Record.
- **FR-REV-102** Helpful 0부터 시작.
- **FR-REV-103** 이전 Helpful 미승계.
- **FR-REV-104** Deadline 초과 후 새 Review 불가.
- **FR-REV-105** Active Review 최대 1.
- **FR-REV-106** 과거 Deleted Review 존재 가능.
- **FR-REV-107** `한 주문당 평생 1번` 정책 사용 금지.

### 36.8 Acceptance Criteria
- **AC-REV-036** 30일 내 삭제 후 리뷰 쓰기 활성.
- **AC-REV-037** 새 Review ID 생성.
- **AC-REV-038** Helpful 0.
- **AC-REV-039** 30일 초과 후 재작성 불가.

---

## 37. 내가 쓴 리뷰

### 37.5 기능 요구사항
- **FR-MYREV-001** 마이에서 접근.
- **FR-MYREV-002** `createdAt DESC`.
- **FR-MYREV-003** 수정해도 최상단 이동하지 않음.
- **FR-MYREV-004** 가게명/땡김도/작성일/메뉴/사진/본문/금액/완료/Helpful/수정됨/수정/삭제 제공.
- **FR-MYREV-005** 필요 시 무한스크롤.
- **FR-MYREV-006** Empty: `아직 작성한 SaveEats 리뷰가 없어요.`
- **FR-MYREV-007** Deleted Review는 Active처럼 표시하지 않음.

### 37.8 Acceptance Criteria
- **AC-MYREV-001** createdAt 최신순.
- **AC-MYREV-002** 수정으로 최상단 이동 없음.
- **AC-MYREV-003** Empty State 제공.
- **AC-MYREV-004** 수정/삭제 진입 가능.

---

## 38. Review 신고

### 38.3 우선순위
**SHOULD**

### 38.5 기능 요구사항
- **FR-REV-110** 신고 구조를 설계에 포함.
- **FR-REV-111** MVP 실제 UI는 일정에 따라 조정.
- **FR-REV-112** 상용화 시 Moderation Flow와 연계.
- **FR-REV-113** 신고 즉시 삭제로 표현하지 않는다.

### 38.9 미결정
- 신고 사유
- 중복 신고
- 운영자 처리 Flow
- 숨김/삭제 기준

---

## 39. 공개 닉네임 / 다른 사용자의 리뷰 모아보기

### 39.3 우선순위
**LATER**

### 39.5 기능 요구사항
- **FR-REV-120** MVP 공개 닉네임 필수 아님.
- **FR-REV-121** 향후 작성자 닉네임 → 공개 리뷰 목록 진입 가능.
- **FR-REV-122** 팔로우/팔로워/DM/SNS Feed는 핵심 범위 밖.
- **FR-REV-123** SNS 중심 서비스로 변경하지 않는다.

---

# Part 4. 마이 / 개인 기록 / 운영·시스템

## 40. 마이페이지

### 40.1 기능 목적
개인 계정/계좌/기록/리뷰/설정에 접근한다.

### 40.5 기능 요구사항
- **FR-MY-001** 인증 사용자만 접근.
- **FR-MY-002** 구조:
  1. 프로필/계정
  2. 돈이 배달될 계좌
  3. 이번 달 요약
  4. 누적 기록
  5. 내가 쓴 리뷰
  6. 배지 SHOULD
  7. 알림 설정
  8. 설정
- **FR-MY-003** 프로필은 계정 정보 중심.
- **FR-MY-004** 공개 영역은 마스킹 이름.
- **FR-MY-005** 공개 닉네임 LATER.
- **FR-MY-006** Order 없음 Zero State: `아직 SaveEats 주문이 없어요.` + `메뉴 둘러보기`
- **FR-MY-007** 한 Section 오류가 전체 오류가 되지 않음.
- **FR-MY-008** 실패 Section만 Retry.
- **FR-MY-009** 계좌 Section → DestinationAccount 관리.
- **FR-MY-010** 내가 쓴 리뷰 → My Reviews.

### 40.8 Acceptance Criteria
- **AC-MY-001** 비로그인 개인 데이터 직접 접근 불가.
- **AC-MY-002** Order 없는 사용자 Zero State.
- **AC-MY-003** Summary 실패에도 다른 Section 사용 가능.
- **AC-MY-004** My Reviews 이동 가능.

---

## 41. 이번 달 요약

### 41.1 기능 목적
금융 리포트가 아닌 SaveEats 월간 기록을 가볍게 보여준다.

### 41.3 우선순위
- 최소 요약: **MUST**
- 상세/확장 통계: **SHOULD**

### 41.5 기능 요구사항
- **FR-STAT-001** 활동 기록 중심.
- **FR-STAT-002** 예:
  - 주문 8회
  - 내 계좌로 배달된 금액 184,500원
  - 가장 많이 고른 음식
  - 가장 큰 주문
- **FR-STAT-003** 완료된 유효 Order 기준 집계.
- **FR-STAT-004** MVP 완료 상태는 USER_CONFIRMED 포함.
- **FR-STAT-005** PENDING/CANCELLED 제외.
- **FR-STAT-006** 월 경계 KST.
- **FR-STAT-007** 이전 달 탐색 가능.
- **FR-STAT-008** 미래 월 이동 불가.
- **FR-STAT-009** Snapshot 기반으로 과거 통계 유지.

### 41.8 Acceptance Criteria
- **AC-STAT-001** PENDING 금액 제외.
- **AC-STAT-002** CANCELLED 주문 횟수 제외.
- **AC-STAT-003** KST 월 경계.
- **AC-STAT-004** 미래 월 이동 불가.
- **AC-STAT-005** 현재 Menu 삭제 후에도 과거 통계 유지.

### 41.9 미결정
- 가장 많이 고른 음식 기준(Category/Menu)
- 동률 처리

---

## 42. 누적 기록

### 42.5 기능 요구사항
- **FR-STAT-010** 완료 Order 기반.
- **FR-STAT-011** 수익률/자산증가율 등 금융 지표 추가 금지.
- **FR-STAT-012** 고급 통계/개인화 추천은 LATER.

### 42.9 미결정
- 최종 누적 지표 종류

---

## 43. Calendar

### 43.3 우선순위
**SHOULD**

### 43.5 기능 요구사항
- **FR-CAL-001** SaveEats Order가 있었던 날 표시.
- **FR-CAL-002** Streak UI 금지.
- **FR-CAL-003** 음식 미섭취 날짜를 성공/실패로 평가하지 않는다.
- **FR-CAL-004** KST 사용.
- **FR-CAL-005** 이전 월 탐색 가능.
- **FR-CAL-006** 미래 기록 생성 금지.

### 43.9 미결정
- PENDING 포함 여부
- 한 날짜 복수 Order 표시
- 졸작 실제 구현 여부

---

## 44. Badge

### 44.3 우선순위
**SHOULD**

### 44.5 기능 요구사항
- **FR-BADGE-001** 음식 억제 자체를 보상하지 않는다.
- **FR-BADGE-002** 후보:
  - 첫 주문
  - 10번째 주문
  - 10만원 도착
  - 50만원 도착
  - 치킨 단골
- **FR-BADGE-003** N일 연속 참기 Badge 금지.
- **FR-BADGE-004** 현재 유효 Order 기준 재계산 가능 구조 권장.
- **FR-BADGE-005** 단순 일회성 Boolean에만 종속되지 않도록 고려.

---

## 45. Notification / Push

### 45.3 우선순위
**SHOULD**

### 45.5 기능 요구사항
- **FR-NOTI-001** 유형 구분:
  - 주문 상태/완료
  - 리뷰 작성 가능
  - 월간 기록
  - 필수 안내
  - 혜택/추천
- **FR-NOTI-002** 주문 중요 알림과 마케팅 알림 분리.
- **FR-NOTI-003** 장기적으로 유형별 ON/OFF.
- **FR-NOTI-004** 죄책감/압박 카피 금지.
- **FR-NOTI-005** Review 알림과 History unread는 별개.
- **FR-NOTI-006** Review 확인이 History read에 영향 없음.
- **FR-NOTI-007** History 확인이 Review 알림 상태에 영향 없음.

---

## 46. Settings

### 46.5 기능 요구사항
- **FR-SET-001** 포함 항목:
  - 계정 정보
  - 로그아웃
  - 알림 설정
  - SaveEats 이용 방법
  - 이용약관
  - 개인정보 처리방침
  - 앱 버전
  - 회원 탈퇴
- **FR-SET-002** 이용 방법에서 온보딩 핵심 내용을 다시 볼 수 있게 할 수 있음.
- **FR-SET-003** 로그아웃 후 개인 데이터 접근 차단.
- **FR-SET-004** 회원 탈퇴 확인 절차.
- **FR-SET-005** 탈퇴 시 데이터 처리 정책은 법적/운영 검토 후 결정.

---

## 47. Goal

### 47.3 우선순위
**LATER**

### 47.5 기능 요구사항
- **FR-GOAL-001** 목표저축은 MVP 핵심 아님.
- **FR-GOAL-002** 목적별 계좌/여행/노트북/진행률 LATER.
- **FR-GOAL-003** Goal 없이 핵심 Flow 완전 사용 가능.
- **FR-GOAL-004** Goal Progress가 Home 탐색보다 우선하지 않는다.

---

## 48. 공통 데이터 요구사항

### 48.5 기능 요구사항
- **FR-DATA-001** 핵심 Domain:
  - User
  - DestinationAccount
  - Store
  - Menu
  - MenuOption
  - Cart
  - Order
  - OrderStatusUpdate
  - Review
  - ReviewImage
  - ReviewHelpful
  - Favorite
  - Badge
  - FeatureConfig
- **FR-DATA-002** Store → Menu → MenuOption 일반화.
- **FR-DATA-003** Order Snapshot:
  - Store
  - Menu
  - Option
  - 주문금액
  - 목적지 계좌
- **FR-DATA-004** 현재 Entity 변경/삭제가 과거 Order를 파괴하지 않는다.
- **FR-DATA-005** Review는 Order와 관계.
- **FR-DATA-006** 한 Order에 Active Review 최대 1.
- **FR-DATA-007** ReviewImage 1:N.
- **FR-DATA-008** ReviewHelpful `(userId, reviewId)` Unique 권장.
- **FR-DATA-009** Favorite은 User ↔ Store.

---

## 49. Seed Data

### 49.3 우선순위
**MUST**

### 49.5 기능 요구사항
- **FR-DATA-020** MVP 음식/가게는 Seed/Demo Data.
- **FR-DATA-021** 실제 구조와 동일한 Store → Menu → MenuOption.
- **FR-DATA-022** 화면별 하드코딩 금지.
- **FR-DATA-023** 인기/추천 Seed Field 사용 가능.
- **FR-DATA-024** 가짜 실제 사용자 활동 수 생성 금지.
- **FR-DATA-025** 향후 외부 Data Source/입점으로 교체 가능.
- **FR-DATA-026** 상용화 전 데이터/상표/이미지 사용권 검토.

### 49.9 기술 검증 필요
- Store 수
- Menu 수
- Option 수
- 이미지 Source
- 실제 브랜드 사용 범위

---

## 50. Analytics

### 50.3 우선순위
- Event 명세: **MUST**
- 실제 Tool 연동: **SHOULD**

### 50.5 기능 요구사항
- **FR-ANL-030** 기본 이벤트:
  - `store_viewed`
  - `menu_viewed`
  - `search_performed`
  - `favorite_added`
  - `cart_item_added`
  - `checkout_started`
  - `toss_deeplink_attempted`
  - `manual_transfer_selected`
  - `order_user_confirmed`
  - `review_created`
  - `review_helpful_clicked`
- **FR-ANL-031** Naming Convention 통일.
- **FR-ANL-032** Analytics 실패가 핵심 Transaction 실패로 이어지지 않는다.
- **FR-ANL-033** 원문 계좌번호 포함 금지.
- **FR-ANL-034** 불필요한 개인정보/Review 본문 전체 수집 금지.
- **FR-ANL-035** Analytics Provider 책임 분리 권장.

---

## 51. Feature Flag

### 51.3 우선순위
- `tossDeepLinkEnabled`: **MUST**
- 기타 Flag: **SHOULD**

### 51.5 기능 요구사항
- **FR-FLG-010** `tossDeepLinkEnabled`
- **FR-FLG-011** SHOULD 후보:
  - `reviewEnabled`
  - `badgeEnabled`
  - `calendarEnabled`
  - `notificationEnabled`
- **FR-FLG-012** Admin UI는 MVP 필수 아님.
- **FR-FLG-013** Flag OFF가 기존 데이터 삭제로 이어지지 않는다.
- **FR-FLG-014** Flag는 노출/경로 제어용.
- **FR-FLG-015** Toss OFF 시 Manual Flow.

---

## 52. 시간 처리

### 52.3 우선순위
**MUST**

### 52.5 기능 요구사항
- **FR-TIME-010** DB UTC.
- **FR-TIME-011** 표시/정책은 KST.
- **FR-TIME-012** Review Deadline = completedAt + 30×24h.
- **FR-TIME-013** 월간 통계 경계 KST.
- **FR-TIME-014** Client Device Time만 신뢰하지 않는다.

---

## 53. 성능 및 로딩

### 53.5 기능 요구사항
- **FR-PERF-001** 우선 관리: Home/Search/Store/Menu/Cart.
- **FR-PERF-002** Skeleton/Loading 제공.
- **FR-PERF-003** 음식 이미지 압축.
- **FR-PERF-004** 목록 점진 로딩.
- **FR-PERF-005** 필요 시 Lazy Loading.
- **FR-PERF-006** Partial Error 시 정상 영역 유지.
- **FR-PERF-007** 실제 서비스 단계에서 별도 성능 지표 정의.

---

## 54. 접근성

### 54.5 기능 요구사항
- **FR-A11Y-001** 주요 CTA 텍스트 Label.
- **FR-A11Y-002** 오류/성공을 색상만으로 전달하지 않는다.
- **FR-A11Y-003** 선택 상태도 색상만으로 구분하지 않는다.
- **FR-A11Y-004** 핵심 Action에 접근 가능한 Label.
- **FR-A11Y-005** Design System 대비 기준 준수.

---

## 55. 금융정보 / 개인정보 최소 처리

### 55.3 우선순위
**MUST**

### 55.5 기능 요구사항
- **FR-SEC-001** 최소 정보만 처리.
- **FR-SEC-002** 계좌번호 기본 Masking.
- **FR-SEC-003** Analytics에 전체 계좌번호 금지.
- **FR-SEC-004** 일반 Log에 전체 계좌번호 금지.
- **FR-SEC-005** DestinationAccount는 본인 접근만 허용.
- **FR-SEC-006** Client UI만으로 권한 보장하지 않는다.
- **FR-SEC-007** Supabase RLS 등 DB 수준 권한 필요.
- **FR-SEC-008** 계좌 저장/암호화는 검증 전 임의 확정 금지.

---

## 56. 오류 복구 / 중복 실행 방지

### 56.5 기능 요구사항
- **FR-REC-001** Order 생성 Double Tap 방어.
- **FR-REC-002** 상태 저장 실패와 송금 실패 분리.
- **FR-REC-003** 이미 송금 가능성이 있으면 재송금 유도 금지.
- **FR-REC-004** 상태 Retry는 기존 orderId 사용.
- **FR-REC-005** 복구 중 외부 앱 자동 재실행 금지.
- **FR-REC-006** Read/Analytics 장애가 Order를 손상시키지 않는다.
- **FR-REC-007** Partial Error 전략 적용.

---

## 57. 장애 우선순위

### 57.5 기능 요구사항
- **FR-OPS-001** 가장 우선 보호: Order + 주문금액 + 목적지 계좌 Snapshot + Order Status.
- **FR-OPS-002** 복구 우선순위:
  1. 송금/주문 상태
  2. 계좌
  3. 주문내역
  4. 리뷰
  5. 찜/검색/추천
- **FR-OPS-003** 실제 돈 구간에서는 편의성보다 중복 방지/복구 우선.

---

## 58. 외부 음식 데이터 확장 경계

### 58.5 기능 요구사항
- **FR-EXT-001** UI를 Seed Source에 강결합하지 않는다.
- **FR-EXT-002** 외부 Provider/입점 데이터로 교체 가능.
- **FR-EXT-003** 실제 행동 기반 Ranking은 LATER.
- **FR-EXT-004** 상용화 전 데이터 사용권 검토.

---

## 59. 금융 Provider 확장 경계

### 59.5 기능 요구사항
- **FR-EXT-010** Order Domain을 Toss에 종속시키지 않는다.
- **FR-EXT-011** 향후 TransferProvider 도입 가능 구조.
- **FR-EXT-012** 공식 Provider 전에는 VERIFIED를 MVP 성공 상태로 사용하지 않는다.
- **FR-EXT-013** 향후 실제 검증 시 VERIFIED/FAILED 사용 가능.
- **FR-EXT-014** Provider 변경이 Order Snapshot/History 구조를 폐기하게 하지 않는다.

---

## 60. 실제 서비스 확장 원칙

### 60.5 기능 요구사항
- **FR-EXT-020** 확장 경계를 막지 않는다:
  - Seed 추천 → 실데이터 Ranking
  - Toss → 정식 TransferProvider
  - 단일 계좌 → 복수 계좌
  - Review Image 1장 → N장
  - 마스킹 이름 → 공개 닉네임
  - Seed Store/Menu → 정식 Data Source
- **FR-EXT-021** SHOULD/LATER 때문에 MVP UI를 과도하게 복잡하게 만들지 않는다.
- **FR-EXT-022** 상용화 전 금융규제/개인정보/약관/데이터 사용권/리뷰 운영/수익모델 검토.

---

# 61. 전체 기술 검증 필요 사항

## 금융 / 주문
- Toss URL Scheme 은행/계좌/금액 사전입력
- Android/iOS 실기기
- Toss 버전별 실패/복귀
- Toss 미설치
- Kill Switch
- USER_CONFIRMED 저장 실패 복구
- 앱 강제종료 복구
- Offline 복구
- PENDING 자동 만료

## 계좌 / 보안
- 계좌번호 저장 범위
- 암호화 방식
- Supabase RLS
- 로그 Masking
- 탈퇴 시 계좌정보 처리

## Seed Data
- MVP Store/Menu/Option 수
- 이미지 Source
- 실제 브랜드 사용 범위

## SHOULD Scope
- Calendar
- Badge
- Review 신고
- 알림함
- Push
- 실제 Analytics Tool

---

# 62. MVP / SHOULD / LATER 최종 범위

## MUST
- 온보딩
- 이메일+비밀번호 인증
- Guest 탐색
- 계좌 등록/변경/삭제
- Home/Category/Search/Store/Menu
- Store Favorite
- Guest Single-Store Cart
- Quantity 1~10
- 가격 변경/품절 처리
- 최종 주문 고지
- PENDING 선생성
- Toss 이어가기(PoC 통과 시)
- 직접 주문 이어가기
- Toss Kill Switch
- USER_CONFIRMED
- 상태 저장 실패 복구
- History
- 주문 이어하기
- History unread
- SaveEats Review
- 사진 1장
- Helpful
- Soft Delete
- 30일 작성 정책
- Order Snapshot
- UTC/KST
- Analytics Event 명세
- `tossDeepLinkEnabled`

## SHOULD
- Calendar
- Badge
- Review 신고
- 앱 내부 알림함
- Push Notification
- 상세/확장 통계
- 실제 Analytics Tool
- 기타 Feature Flag

## LATER
- 복수/목적 계좌
- 목표 기능
- 고급 통계
- 개인화 추천
- 실제 행동 Ranking
- 정식 금융 API 자동검증
- VERIFIED 운영
- 정식 음식점 Data Source
- 입점/제휴
- Review 다중 이미지
- 공개 닉네임
- 다른 사용자 공개 Review 모아보기
- AI 답글
- 챌린지
- 공유 카드

---

# 63. PRD 종료 기준

본 PRD를 기준으로 다음 개발 명세를 작성한다.

1. 전체 시스템 Architecture
2. Database Schema
3. Supabase Auth / RLS
4. Guest/User Cart Persistence
5. Order State Machine
6. Snapshot / Idempotency
7. Toss / Manual Transfer Boundary
8. Review Domain Rules
9. OrderStatusUpdate / unread
10. Error / Recovery
11. Analytics / Feature Config
12. Seed Data
13. FE/BE API Contract
14. Claude Code 작업 단위

---

**End of SaveEats PRD v1.0 Draft**
