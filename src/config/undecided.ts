/**
 * 미결정 항목의 현재 값.
 *
 * 디자인 캔버스에서 "미결정"으로 표시된 항목은 여기에서만 정한다. 화면 코드는 이 값을 읽어서 동작한다.
 * 값은 디자인 시안의 추천안이며 확정이 아니다. 정책이 정해지면 이 파일의 값만 바꾼다.
 * 임의로 값을 바꾸지 말고, 바꿔야 하면 먼저 사용자에게 확인한다.
 */
export const UNDECIDED = {
  /** 묶음1 #1 · 홈 카테고리 칩을 누르면 카테고리 가게 목록으로 이동한다 */
  categoryChipAction: 'navigateCategoryStoreList',
  /**
   * 묶음1 #2 · 준비 중(영업 종료) 가게의 메뉴를 담을 수 있는지.
   * true: 탐색·담기를 허용하고 배지만 표시한다.
   * false: 새 메뉴를 담을 수 없고 주문도 막는다.
   * 서정(10/8 "막지 않음")과 혜지·10/1 결정("막음")이 달라 확인 중이다.
   */
  preparingStoreOrderable: true,
  /** 묶음1 #3 · 같은 메뉴·옵션 조합의 합계가 10을 넘으면 담지 않고 알린다. 자동으로 10개로 줄이지 않는다 */
  sameConfigurationOverLimit: 'rejectWithToast',
  /** 묶음1 #4 · 담기에 성공하면 이전 화면으로 돌아가 토스트 [보기]를 띄운다 */
  afterAddToCart: 'backWithToast',
  /** 묶음1 #5 · 가게·메뉴·장바구니 같은 쌓이는 화면은 하단 탭을 숨기고 고정 CTA 바를 쓴다 */
  hideTabBarOnStackScreens: true,
  /** 묶음1 #6 · 장바구니에서 옵션을 바꾸는 진입 UI는 두지 않는다 */
  cartOptionEditEntry: false,
  /** 묶음1 #7 · 가격 변경은 한 번에 모두 확인한다 */
  priceChangeAcknowledge: 'bulk',
  /** 묶음1 #8 · 홈에 '이번 달 기록'을 보여주지 않는다 */
  homeMonthlyRecord: false,
  /** 묶음1 #9 · 홈 배너는 자리만 그리고 문구는 넣지 않는다 */
  homeBanner: 'placeholderOnly',
  /** 묶음1 #10 · 장바구니는 주문(PENDING) 생성에 성공했을 때 비운다 */
  cartClearTiming: 'onPendingCreated',
} as const;
