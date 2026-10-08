/**
 * 개발용 Mock 시나리오.
 *
 * 성공 화면만 보지 않도록 Guest, 빈 목록, 오류, 오프라인, 가격 변경, 품절, 영업 종료 상태를 고를 수 있다.
 * `.env`의 EXPO_PUBLIC_MOCK_SCENARIO에 아래 이름을 넣고 개발 서버를 다시 시작한다. 없으면 'default'.
 * 품절 메뉴·준비 중 가게·사진 없는 가게·메뉴 없는 가게는 시나리오와 무관하게 Mock 데이터에 항상 들어 있다.
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
  /** 응답 지연(ms). 로딩 상태를 보기 위한 값 */
  delayMs: number;
};

const BASE: MockScenario = {
  auth: 'guest',
  network: 'online',
  homeRecommended: 'ok',
  cartValidation: 'valid',
  cartSaveFails: false,
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
