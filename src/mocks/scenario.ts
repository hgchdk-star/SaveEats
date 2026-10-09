/**
 * 개발용 Mock 시나리오.
 *
 * 성공 화면만 보지 않도록 Guest, 빈 목록, 오류, 오프라인, 가격 변경, 품절, 영업 종료,
 * 그리고 주문 흐름의 실패 분기(저장 실패, 결과 미확정, 상태 조회 실패 등)를 고를 수 있다.
 * `.env`의 EXPO_PUBLIC_MOCK_SCENARIO에 아래 이름을 넣고 개발 서버를 다시 시작한다. 없으면 'default'.
 * 품절 메뉴·준비 중 가게·사진 없는 가게·메뉴 없는 가게는 시나리오와 무관하게 Mock 데이터에 항상 들어 있다.
 * "Once"로 끝나는 실패는 앱을 켠 뒤 처음 한 번만 실패하고, 다시 시도하면 성공한다.
 */
export type MockScenario = {
  /** guest: 미로그인 / memberNoAccount: 로그인했지만 계좌 미등록 / member: 로그인 + 계좌 등록 */
  auth: 'guest' | 'memberNoAccount' | 'member';
  /** 조회 요청의 결과. offline·error는 모든 조회가 실패한다 */
  network: 'online' | 'offline' | 'error';
  /** 홈 추천 가게: ok / empty(0개) / error(그 섹션만 실패) */
  homeRecommended: 'ok' | 'empty' | 'error';
  /** 장바구니 서버 확인(CART-008) 결과 */
  cartValidation:
    | 'valid'
    | 'priceChanged'
    | 'menuSoldOut'
    | 'optionSoldOut'
    | 'inactive'
    | 'optionsInvalid'
    | 'unavailable'
    | 'offline';
  /** 장바구니를 기기에 저장할 때 실패시킨다 (CART-003) */
  cartSaveFails: boolean;
  /** 로그인 결과 (AUTH-002): 인증 오류와 네트워크 오류를 구분한다 */
  login: 'ok' | 'invalidOnce' | 'networkOnce';
  /** 로그인에 성공했을 때 이미 등록된 계좌가 있는지 */
  accountOnLogin: boolean;
  /** 계좌 등록·변경 저장 결과 */
  accountSave: 'ok' | 'failOnce';
  /**
   * 주문 생성 결과 (ORD-004~006).
   * localSaveFailOnce: 전송 전 기기 저장 실패 → 주문 없음이 확정
   * unknownLost: 응답을 못 받았고 서버에는 주문이 없다 → 같은 키로 다시 보내면 성공
   * unknownCreated: 응답을 못 받았지만 서버에는 주문이 만들어져 있다 → 같은 키로 조회하면 찾는다
   * priceChanged / itemUnavailable: 서버가 명확히 거절
   */
  order: 'ok' | 'localSaveFailOnce' | 'unknownLost' | 'unknownCreated' | 'priceChangedOnce' | 'itemUnavailableOnce';
  /** 송금 이어가기 (TRF-005 · 006) */
  transfer: 'tossOn' | 'killSwitch' | 'configTimeout' | 'tossLaunchFailOnce';
  /** 외부 앱에서 돌아온 뒤 서버 상태 조회 (TRF-008) */
  statusQuery: 'ok' | 'failOnce' | 'alreadyConfirmed' | 'alreadyCancelled';
  /** '주문 완료했어요' 저장 (ORD-008 · 010) */
  confirm: 'ok' | 'failOnce';
  /** 주문 취소 (ORD-009): unknownOnce는 취소는 적용됐는데 응답을 못 받는 경우 */
  cancel: 'ok' | 'unknownOnce';
  /** 클립보드 쓰기 실패 (TRF-007) */
  clipboardFails: boolean;

  /**
   * 내역 목록 (HIST-003).
   * empty: 주문 0개 / firstPageFailOnce: 첫 페이지 실패 → 전체 오류 / nextPageFailOnce: 다음 페이지 실패 → 기존 목록 유지 + 다시 시도
   * long: 주문 40개를 더해 여러 페이지로 나눈다
   */
  history: 'ok' | 'empty' | 'firstPageFailOnce' | 'nextPageFailOnce' | 'long';
  /** 읽음 저장 (HIST-007): 실패해도 화면에는 알리지 않고 조용히 다시 시도한다 */
  readSave: 'ok' | 'failOnce';
  /** 이번 달 요약 조회 */
  monthly: 'ok' | 'failOnce';
  /** 공개 리뷰 목록 조회: empty는 리뷰가 하나도 없는 상태, failOnce는 조회 실패 (빈 목록과 구분해서 보여준다) */
  reviewList: 'ok' | 'empty' | 'failOnce';
  /** 내가 쓴 리뷰: long은 25개(여러 페이지, 읽기 전용), nextPageFailOnce는 long에서 다음 페이지 실패 */
  myReviews: 'ok' | 'empty' | 'failOnce' | 'long' | 'nextPageFailOnce';
  /**
   * 리뷰 작성·수정 저장 (REV-004~005, IMG-002).
   * photoUploadFailOnce: 사진 올리기 실패 / saveFailOnce: 저장 실패 / deadlineExceeded: 제출 순간 작성 기간 만료
   * revisionConflictOnce: 수정 중 다른 곳에서 먼저 바뀜
   */
  reviewWrite: 'ok' | 'photoUploadFailOnce' | 'saveFailOnce' | 'deadlineExceeded' | 'revisionConflictOnce';
  /** 리뷰 삭제 (REV-006) */
  reviewDelete: 'ok' | 'failOnce';
  /** 도움돼요 (REV-007) */
  helpful: 'ok' | 'failOnce';
  /** 가게 검색: failOnce는 첫 검색이 실패 (결과 없음과 구분해서 보여준다) */
  search: 'ok' | 'failOnce';
  /** 인기 검색어: failOnce는 그 섹션만 실패 / empty는 Seed가 비어 있음 */
  popular: 'ok' | 'failOnce' | 'empty';
  /** 카테고리 가게 목록(칩을 고른 뒤): failOnce는 첫 조회가 실패 */
  storeList: 'ok' | 'failOnce';
  /**
   * 내 찜 목록. seeded: 활성 가게 1곳 + 운영하지 않는 가게 1곳(골목 칼국수, 어디에도 안 보임) / empty: 찜 없음 /
   * onlyInactive: 운영하지 않는 가게만 찜 → 목록은 빈 상태 / loadFailOnce: 첫 조회 실패
   */
  favorites: 'seeded' | 'empty' | 'onlyInactive' | 'loadFailOnce';
  /** 찜 저장: failOnce는 첫 저장이 실패 → 화면을 되돌리고 토스트 */
  favoriteSave: 'ok' | 'failOnce';
  /** 마이의 누적 기록: newUser는 주문이 하나도 없는 사용자(Zero State) / failOnce는 누적 기록 섹션만 실패 */
  myRecord: 'ok' | 'newUser' | 'failOnce';
  /** 알림 설정: loadFailOnce는 첫 조회 실패 / saveFailOnce는 첫 저장 실패 → 스위치를 되돌리고 토스트 */
  notif: 'ok' | 'loadFailOnce' | 'saveFailOnce';
  /** 앱 실행 절차: firstRun은 매번 처음 실행처럼 온보딩부터 / readFails는 완료 여부를 읽지 못함(처음으로 본다) */
  launch: 'normal' | 'firstRun' | 'readFails';
  /** 최근 검색어: seeded는 기기에 저장된 것이 없을 때 예시 10개를 보여준다 */
  recentSearches: 'none' | 'seeded';
  /** 응답 지연(ms). 로딩 상태를 보기 위한 값 */
  delayMs: number;
};

const BASE: MockScenario = {
  auth: 'guest',
  network: 'online',
  homeRecommended: 'ok',
  cartValidation: 'valid',
  cartSaveFails: false,
  login: 'ok',
  accountOnLogin: false,
  accountSave: 'ok',
  order: 'ok',
  transfer: 'tossOn',
  statusQuery: 'ok',
  confirm: 'ok',
  cancel: 'ok',
  clipboardFails: false,
  history: 'ok',
  readSave: 'ok',
  monthly: 'ok',
  reviewList: 'ok',
  myReviews: 'ok',
  reviewWrite: 'ok',
  reviewDelete: 'ok',
  helpful: 'ok',
  search: 'ok',
  popular: 'ok',
  storeList: 'ok',
  favorites: 'seeded',
  favoriteSave: 'ok',
  myRecord: 'ok',
  notif: 'ok',
  launch: 'normal',
  recentSearches: 'none',
  delayMs: 400,
};

const SCENARIOS = {
  default: BASE,
  member: { ...BASE, auth: 'member' },
  memberNoAccount: { ...BASE, auth: 'memberNoAccount' },
  slow: { ...BASE, delayMs: 2500 },
  offline: { ...BASE, network: 'offline', cartValidation: 'offline' },
  error: { ...BASE, network: 'error', cartValidation: 'unavailable' },
  homeEmpty: { ...BASE, homeRecommended: 'empty' },
  homeSectionError: { ...BASE, homeRecommended: 'error' },
  cartPriceChanged: { ...BASE, auth: 'member', cartValidation: 'priceChanged' },
  cartMenuSoldOut: { ...BASE, auth: 'member', cartValidation: 'menuSoldOut' },
  cartOptionSoldOut: { ...BASE, auth: 'member', cartValidation: 'optionSoldOut' },
  cartInactive: { ...BASE, auth: 'member', cartValidation: 'inactive' },
  cartOptionsInvalid: { ...BASE, auth: 'member', cartValidation: 'optionsInvalid' },
  cartValidationUnavailable: { ...BASE, auth: 'member', cartValidation: 'unavailable' },
  cartOffline: { ...BASE, auth: 'member', cartValidation: 'offline' },
  cartSaveFails: { ...BASE, cartSaveFails: true },

  // ---- 묶음 2: 주문 흐름 (Guest로 시작하면 로그인부터, member로 시작하면 최종 확인부터 볼 수 있다) ----
  loginInvalid: { ...BASE, login: 'invalidOnce' },
  loginNetwork: { ...BASE, login: 'networkOnce' },
  loginHasAccount: { ...BASE, accountOnLogin: true },
  accountSaveFails: { ...BASE, auth: 'memberNoAccount', accountSave: 'failOnce' },
  orderLocalSaveFails: { ...BASE, auth: 'member', order: 'localSaveFailOnce' },
  orderUnknownLost: { ...BASE, auth: 'member', order: 'unknownLost' },
  orderUnknownCreated: { ...BASE, auth: 'member', order: 'unknownCreated' },
  orderPriceChanged: { ...BASE, auth: 'member', order: 'priceChangedOnce' },
  orderItemUnavailable: { ...BASE, auth: 'member', order: 'itemUnavailableOnce' },
  killSwitch: { ...BASE, auth: 'member', transfer: 'killSwitch' },
  configTimeout: { ...BASE, auth: 'member', transfer: 'configTimeout' },
  tossLaunchFails: { ...BASE, auth: 'member', transfer: 'tossLaunchFailOnce' },
  statusQueryFails: { ...BASE, auth: 'member', statusQuery: 'failOnce' },
  returnAlreadyConfirmed: { ...BASE, auth: 'member', statusQuery: 'alreadyConfirmed' },
  returnAlreadyCancelled: { ...BASE, auth: 'member', statusQuery: 'alreadyCancelled' },
  confirmSaveFails: { ...BASE, auth: 'member', confirm: 'failOnce' },
  cancelUnknown: { ...BASE, auth: 'member', cancel: 'unknownOnce' },
  clipboardFails: { ...BASE, auth: 'member', clipboardFails: true },

  // ---- 묶음 3: 내역·리뷰 (Guest로 시작하면 내역·리뷰 쓰기의 로그인 유도를 볼 수 있다) ----
  historyEmpty: { ...BASE, auth: 'member', history: 'empty' },
  historyFirstPageFails: { ...BASE, auth: 'member', history: 'firstPageFailOnce' },
  historyNextPageFails: { ...BASE, auth: 'member', history: 'nextPageFailOnce' },
  historyLong: { ...BASE, auth: 'member', history: 'long' },
  readSaveFails: { ...BASE, auth: 'member', readSave: 'failOnce' },
  monthlyFails: { ...BASE, auth: 'member', monthly: 'failOnce' },
  reviewsEmpty: { ...BASE, auth: 'member', reviewList: 'empty' },
  reviewListFails: { ...BASE, auth: 'member', reviewList: 'failOnce' },
  myReviewsEmpty: { ...BASE, auth: 'member', myReviews: 'empty' },
  myReviewsFails: { ...BASE, auth: 'member', myReviews: 'failOnce' },
  myReviewsLong: { ...BASE, auth: 'member', myReviews: 'long' },
  myReviewsNextPageFails: { ...BASE, auth: 'member', myReviews: 'nextPageFailOnce' },
  photoUploadFails: { ...BASE, auth: 'member', reviewWrite: 'photoUploadFailOnce' },
  reviewSaveFails: { ...BASE, auth: 'member', reviewWrite: 'saveFailOnce' },
  reviewDeadlineExceeded: { ...BASE, auth: 'member', reviewWrite: 'deadlineExceeded' },
  reviewConflict: { ...BASE, auth: 'member', reviewWrite: 'revisionConflictOnce' },
  reviewDeleteFails: { ...BASE, auth: 'member', reviewDelete: 'failOnce' },
  helpfulFails: { ...BASE, auth: 'member', helpful: 'failOnce' },

  // ---- 묶음 4: 검색·찜·마이·시작 (Guest로 시작하면 찜·마이의 로그인 유도를 볼 수 있다) ----
  searchFails: { ...BASE, search: 'failOnce' },
  popularFails: { ...BASE, popular: 'failOnce' },
  popularEmpty: { ...BASE, popular: 'empty' },
  recentSeeded: { ...BASE, recentSearches: 'seeded' },
  categoryFails: { ...BASE, storeList: 'failOnce' },
  favoritesEmpty: { ...BASE, auth: 'member', favorites: 'empty' },
  favoritesOnlyInactive: { ...BASE, auth: 'member', favorites: 'onlyInactive' },
  favoritesFails: { ...BASE, auth: 'member', favorites: 'loadFailOnce' },
  favoriteSaveFails: { ...BASE, auth: 'member', favoriteSave: 'failOnce' },
  myNewUser: { ...BASE, auth: 'member', myRecord: 'newUser', history: 'empty' },
  myRecordFails: { ...BASE, auth: 'member', myRecord: 'failOnce' },
  notifLoadFails: { ...BASE, auth: 'member', notif: 'loadFailOnce' },
  notifSaveFails: { ...BASE, auth: 'member', notif: 'saveFailOnce' },
  firstRun: { ...BASE, launch: 'firstRun' },
  launchReadFails: { ...BASE, launch: 'readFails' },
} satisfies Record<string, MockScenario>;

export type MockScenarioName = keyof typeof SCENARIOS;

function readScenarioName(): MockScenarioName {
  const name = process.env.EXPO_PUBLIC_MOCK_SCENARIO;
  return name && name in SCENARIOS ? (name as MockScenarioName) : 'default';
}

export const mockScenarioName = readScenarioName();
export const mockScenario: MockScenario = SCENARIOS[mockScenarioName];

export function mockDelay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, mockScenario.delayMs));
}

const fired = new Set<string>();

/** 같은 이름의 실패를 앱 실행당 한 번만 일으킨다. 처음 호출에만 true */
export function failOnce(key: string): boolean {
  if (fired.has(key)) return false;
  fired.add(key);
  return true;
}
