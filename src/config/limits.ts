/** 한도와 상수. 근거는 기획서·PRD·개발 명세의 항목 번호 */
export const LIMITS = {
  /** 기획서 16 · FR-MENU-002 */
  quantityMin: 1,
  /** 기획서 16 · FR-MENU-003 · FR-CART-012 */
  quantityMax: 10,
  /** 기획서 11.3 · FR-HOME-009 */
  recentViewedMax: 10,
  toastDurationMs: 3000,
  /** 계좌번호 최소 자릿수 (프로토타입 값). 은행별 형식 검증은 서버가 한다 */
  accountNumberMinLength: 10,
  /** 비밀번호 최소 글자 수 (회원가입 도움말 "8자 이상") */
  passwordMinLength: 8,
  /** 토스 실행 직전 원격 설정 조회 제한 시간. 넘으면 직접 흐름 (TRF-005) */
  tossConfigTimeoutMs: 3000,
  /** 외부 앱에서 돌아온 뒤 주문 상태 조회를 기다리는 최대 시간. 넘으면 조회 실패 화면 (TRF-008) */
  statusQueryTimeoutMs: 10000,
  /** 상태 확인 화면이 뜬 뒤 조회를 시작하기까지 기다리는 시간. 화면 전환 애니메이션이 끝나도록 */
  returnCheckSettleMs: 700,

  /** 내역 한 번에 불러오는 수 (HIST-002 기술안, 최대 50) */
  historyPageSize: 20,
  /** 리뷰 한 번에 불러오는 수 (REV-008 기술안, 최대 50) */
  reviewPageSize: 20,
  /** 리뷰 작성 기간: 주문 완료 시각 + 30×24시간. 날짜(자정) 단위가 아니다 (기획서 30 · REV-002) */
  reviewWindowHours: 720,
  /** 리뷰 본문 글자 수: 앞뒤 공백을 뺀 Unicode 글자 수 (REV-003) */
  reviewBodyMin: 5,
  reviewBodyMax: 500,
  /** 리뷰 사진은 1장 (기획서 27) */
  reviewImageMax: 1,
  /** 내역 행이 이만큼(%) 이상 보인 채 일정 시간 유지되면 읽음 (기획서 24 · HIST-006) */
  statusReadVisiblePercent: 50,
  statusReadDwellMs: 1000,
  /** 내역 화면이 앞에 있는 동안 새 상태 업데이트를 확인하는 간격 (HIST-008) */
  unreadPollMs: 15000,
  /** 읽음 저장 실패 시 조용히 다시 시도하는 간격 (HIST-007: 1·2·4초, 최대 3회) */
  readRetryDelaysMs: [1000, 2000, 4000],

  /** 최근 검색어 최대 개수. 이 기기에만 저장한다 (묶음4 #1 · API-002) */
  recentSearchMax: 10,
  /** 입력 후 검색까지 기다리는 시간 (API-002 기술안) */
  searchDebounceMs: 300,
  /** 검색어는 앞뒤 공백을 지운 뒤 1자 이상 (계약 초안 3.1 · 서정 확인 2026-10-08) */
  searchMinLength: 1,
  /** 검색 입력창은 50자까지만 입력된다. 서버 보호용 상한이라 오류 문구는 띄우지 않는다 (계약 초안 6.2) */
  searchMaxLength: 50,
  /** 검색·카테고리·찜 목록 한 번에 불러오는 수 (계약 초안 3.1 기본 20, 최대 50) */
  storeListPageSize: 20,
  /** Splash 최소 표시 시간. PRD 1.9 미결정이라 시안 값 (묶음4 Splash) */
  splashMinMs: 900,
} as const;

/** 최종 주문 확인 고지 버전. 표시한 고지 문구의 버전을 요청에 함께 보낸다 (ORD-004) */
export const ORDER = {
  disclosureVersion: '2026-09-30',
  requestVersion: 1,
} as const;
