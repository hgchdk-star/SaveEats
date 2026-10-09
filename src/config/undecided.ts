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
  /** 묶음1 #10 = 묶음2 #5 · 장바구니는 주문(PENDING) 생성에 성공했을 때 비운다 (OPEN-CART-003 · ORD-013). 생성에 쓴 버전만 비운다 */
  cartClearTiming: 'onPendingCreated',

  /* ---------- 주문 흐름 (묶음 2의 [미결정 #1~#8]) ---------- */

  /** 묶음2 #1 · 이메일 인증을 필수로 하지 않는다. 막지 않는다 (OPEN-ARCH-001) */
  emailVerificationRequired: false,
  /** 묶음2 #1 · 비밀번호 재설정 화면이 없다. 링크 자리만 두고 "준비 중" 화면으로 보낸다 */
  passwordReset: 'linkOnly',
  /** 묶음2 #2 · 회원가입에서 이름을 받지 않는다. 이메일 + 비밀번호만 */
  signUpCollectsName: false,
  /** 묶음2 #3 · 계좌 입력 항목은 은행 + 계좌번호. 예금주·본인 확인은 없다 */
  accountFormFields: ['bankCode', 'accountNumber'],
  /** 묶음2 #4 · 진행 중(PENDING) 주문이 있어도 계좌 변경·삭제를 막지 않고 안내만 한다. 현재 계좌를 과거 주문에 대신 쓰지 않는다 (OPEN-DB-002) */
  pendingOrderAccountChange: 'allowWithNotice',
  /** 묶음2 #6 · 주문 취소는 완료 확인 질문 화면의 보조 텍스트 버튼에서 시작한다 */
  orderCancelEntry: 'confirmQuestionTextButton',
  /** 묶음2 #7 · PENDING 주문은 자동으로 만료되지 않고, 만료 표시도 하지 않는다 */
  pendingAutoExpiry: null,
  /** 묶음2 #8 · 토스에 은행·계좌·금액을 미리 채워 열지 않는다. 실기기 PoC 전까지 끈다 */
  tossPrefill: false,

  /* ---------- 내역·리뷰 (묶음 3의 [미결정 #1~#8]) ---------- */

  /** 묶음3 #1 · 처음 만든 PENDING(NULL→PENDING) 이벤트에도 빨간 점을 단다. 명세 초기 기술안이며 UX 검수 전 (DB-007) */
  initialPendingEventUnread: true,
  /** 묶음3 #2 · 리뷰 작성자는 실명을 마스킹한 표시명만 보여준다. 탈퇴 사용자 처리는 없다 (OPEN-DB-004·005) */
  reviewAuthorDisplay: 'maskedRealName',
  /** 묶음3 #3 · 여러 메뉴를 주문했으면 "대표 메뉴 외 N개"로 보여준다 (OPEN-DB-008) */
  multiMenuOrderLabel: 'firstMenuPlusCount',
  /**
   * 묶음3 #4 · 리뷰 신고(SHOULD)는 시트에 항목만 두고 신고 접수 화면은 "준비 중" 화면으로 보낸다.
   * 신고 진입 위치: 프로토타입은 SaveEats 리뷰 화면에만 두었지만, 이번 구현 요청에 따라 가게 상세 리뷰 탭에도 둔다.
   */
  reviewReport: 'sheetItemsOnly',
  reviewReportEntries: { reviewListScreen: true, storeReviewTab: true },
  /** 묶음3 #5 · 내역 상단 카드와 이번 달 요약 화면이 같은 컴포넌트(MonthlySummary)를 쓴다 */
  monthlySummaryComponent: 'shared',
  /** 묶음3 #6 · 사진 업로드가 실패하면 사진만 다시 시도한다. 땡김도·글은 유지하고, 사진을 몰래 빼고 저장하지 않는다 (OPEN-DB-007) */
  reviewPhotoUploadFailure: 'retryPhotoKeepText',
  /** 묶음3 #7 · 리뷰 알림 발송과 알림함은 이번에 없다. 알림 설정의 스위치는 설정값일 뿐이다 */
  reviewNotifications: false,
  /** 묶음3 #8 · 이번 달 요약의 "가장 많이 고른 음식"은 카테고리 기준, 동률이면 최근 주문 쪽 (PRD 41.9) */
  monthlyTopFoodBasis: 'category',
} as const;
