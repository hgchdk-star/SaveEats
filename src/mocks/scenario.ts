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
