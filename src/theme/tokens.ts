/**
 * SaveEats 디자인 토큰.
 *
 * 원본: SaveEats Design System의 `tokens.json` (docs/design.md 참고).
 * 값은 원본을 그대로 옮긴 것이다. 여기서 값을 새로 만들거나 바꾸지 않는다.
 * 원본이 바뀌면 이 파일을 원본에 맞춰 다시 옮긴다.
 *
 * React Native에 맞춘 변환 (값의 뜻은 같다):
 * - 이름: kebab-case → camelCase (`brand-soft` → `brandSoft`, `tomato-500` → `tomato500`)
 * - 길이: `"16px"` → `16`
 * - 자간: em → px (`fontSize × em`). RN은 em 단위를 받지 않는다
 * - 굵기: `700` → `'700'`
 */

const palette = {
  tomato50: '#FFF3F0',
  tomato100: '#FFE3DD',
  tomato200: '#FFC7BC',
  tomato300: '#FCA392',
  /** 다크 서피스 위 브랜드 강조 (향후 다크 테마용) */
  tomato400: '#F67A65',
  /** Brand Primary Tomato. 바꾸지 않는 브랜드 기준색 */
  tomato500: '#F0523D',
  tomato600: '#D93D29',
  tomato700: '#B5301F',
  tomato800: '#8C271A',
  tomato900: '#661E15',
} as const;

export const colors = {
  ...palette,

  /** 앱 전체 배경 (Warm Cream) */
  bg: '#FFFAF7',
  /** 카드, 바텀시트, 입력창, 내비게이션 바 배경 */
  surface: '#FFFFFF',
  /** 검색창·수량 선택기·중립 칩 채움, 섹션 구분 띠 */
  surfaceMuted: '#F7F2EE',
  /** 음식 사진 로딩/미등록 자리. 스켈레톤 기본색 */
  foodPlaceholder: '#F3E9E1',

  /** 본문·제목·가격 텍스트 */
  ink: '#1D1B1A',
  /** 보조 설명, 메뉴 설명 */
  inkSecondary: '#5E5854',
  /** 메타 정보 (리뷰 수, 날짜, 캡션) */
  inkTertiary: '#736C67',
  /** 비활성 텍스트·아이콘 전용. 정보 전달에 쓰지 않는다 */
  inkDisabled: '#A39C97',

  /** 카드 테두리, 리스트 구분선 */
  line: '#EEE7E2',
  /** 입력창·Secondary 버튼·비선택 칩 테두리 */
  lineStrong: '#CFC5BD',

  /** 큰 Primary CTA·OrderCTA 채움(글자 19px/700 이상), 활성 찜 하트, 체크·라디오, 선택 테두리 */
  brand: palette.tomato500,
  /** brand 채움의 Pressed 상태 */
  brandPressed: palette.tomato600,
  /** 선택된 칩·카드 배경, 담김 상태 배경 */
  brandSoft: palette.tomato50,
  /** 진한 Tomato 텍스트. bg·brandSoft 위에서는 actionText 대신 이것 */
  brandText: palette.tomato700,
  /** brand·actionFill·danger 채움 위 텍스트/아이콘 */
  onBrand: '#FFFFFF',

  /** 작은 흰 글자가 올라가는 Tomato 채움 (선택된 FoodCategoryChip, PrimaryButton md·sm, 숫자 배지) */
  actionFill: palette.tomato600,
  /** actionFill 채움의 Pressed 상태 */
  actionFillPressed: palette.tomato700,
  /** 작은 Tomato 인터랙션 텍스트. 흰 바탕(surface) 전용 */
  actionText: palette.tomato600,

  /** BottomNavigation 선택 탭 아이콘 */
  tabSelectedIcon: palette.tomato500,
  /** BottomNavigation 선택 탭 레이블 (11px/700) */
  tabSelectedLabel: palette.tomato700,
  /** 내역 탭·주문 행의 알림 점 = 확인하지 않은 주문 상태 업데이트. 리뷰 미작성에는 쓰지 않는다 */
  notificationDot: palette.tomato500,

  /** 성공 상태 아이콘·체크 마크 전용 (계좌 도착, 계좌 등록 완료). 브랜드 컬러 아님. 텍스트에는 successText */
  success: '#248A63',
  /** 성공 상태 배경 */
  successSoft: '#E9F5EF',
  /** 성공 메시지 텍스트 */
  successText: '#1F7A57',

  /** 땡김도 별 채움 전용. 반드시 숫자와 함께 표시 */
  rating: '#F6B73C',
  /** 땡김도 빈 별 */
  ratingEmpty: '#EAE2DB',

  /** 오류 텍스트·아이콘, 입력 오류 테두리. 항상 아이콘+문구와 함께 */
  danger: '#C4281C',
  /** 오류 배너·오류 토스트 아이콘 배경 */
  dangerSoft: '#FDECEA',

  /** 바텀시트 뒤 딤 처리 */
  overlay: 'rgba(29, 27, 26, 0.48)',
  /** 토스트 배경 */
  toastBg: '#2A2725',
  /** 키보드 포커스 링 색 */
  focus: palette.tomato700,
} as const;

export type ColorToken = keyof typeof colors;

/** Pretendard 한 가지. 글꼴 파일 로딩은 아직 연결하지 않았다 (docs/design.md "남은 작업") */
export const fontFamily = 'Pretendard';

/** 제목은 -0.02em, 본문은 -0.01em 자간. letterSpacing은 fontSize × em으로 환산한 px 값 */
export const typography = {
  /** 홈 인사말, 주문 완료 헤드라인. 화면당 1개 */
  display: { fontSize: 28, lineHeight: 36, fontWeight: '700', letterSpacing: -0.56 },
  /** 가게 상세 가게명, 결과 화면 제목 */
  h1: { fontSize: 24, lineHeight: 32, fontWeight: '700', letterSpacing: -0.48 },
  /** 섹션 제목, 바텀시트 제목 */
  h2: { fontSize: 20, lineHeight: 28, fontWeight: '700', letterSpacing: -0.4 },
  /** 메뉴 상세 메뉴명, 카드 그룹 제목 */
  h3: { fontSize: 18, lineHeight: 26, fontWeight: '600', letterSpacing: -0.18 },
  /** 카드 안 가게명·메뉴명, 리스트 주 텍스트 */
  title: { fontSize: 16, lineHeight: 24, fontWeight: '600', letterSpacing: -0.16 },
  /** 기본 본문, 입력값 */
  body1: { fontSize: 16, lineHeight: 24, fontWeight: '400', letterSpacing: -0.16 },
  /** 메뉴 설명, 옵션, 리뷰 본문 */
  body2: { fontSize: 14, lineHeight: 20, fontWeight: '400', letterSpacing: -0.14 },
  /** 버튼(소), 칩, 탭, 배지 레이블 */
  label: { fontSize: 14, lineHeight: 20, fontWeight: '600', letterSpacing: -0.14 },
  /** 메타 정보, 하단 탭 레이블, 도움말 */
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' },

  /** 주문 요약 합계, 주문 완료 금액 */
  priceLg: { fontSize: 22, lineHeight: 30, fontWeight: '700', letterSpacing: -0.44 },
  /** 메뉴 카드·장바구니 항목 가격 */
  priceMd: { fontSize: 16, lineHeight: 24, fontWeight: '700', letterSpacing: -0.16 },
  /** 옵션 추가금, 원가(취소선), 요약 행 */
  priceSm: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
} as const;

export type TypographyToken = keyof typeof typography;

/** 가격은 항상 tabular 숫자로 표시한다 */
export const priceFontVariant = ['tabular-nums'] as const;

/** 4px 베이스. 화면 좌우 여백은 spacing[5] (20px). 키는 원본 `space-N`의 N */
export const spacing = {
  0.5: 2,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
} as const;

/** 칩만 pill */
export const radius = {
  /** 배지, 작은 썸네일(40px 이하) */
  xs: 6,
  /** Small Card, 토스트, 계좌 선택 행 */
  sm: 12,
  /** Primary CTA, 버튼, 입력창, 검색창, 음식 이미지 */
  md: 14,
  /** 메뉴 카드, 가게 카드, 리뷰 카드 */
  lg: 16,
  /** 바텀시트 상단 모서리만 */
  xl: 24,
  /** 칩, 수량 선택기, 원형 아이콘 버튼 */
  full: 9999,
} as const;

/** 그림자는 떠 있는 요소에만. 카드는 line 테두리로 구분한다. 값은 CSS box-shadow 문자열 그대로 */
export const shadow = {
  /** 카드·리스트 기본 */
  none: 'none',
  /** 사진 위 오버레이 아이콘 버튼, 하단 고정 CTA 바 위쪽 */
  float: '0 2px 8px rgba(29, 27, 26, 0.08)',
  /** 바텀시트, 토스트 */
  sheet: '0 -4px 24px rgba(29, 27, 26, 0.10)',
  /** 키보드 포커스: 2px 흰 간격 + 2px focus 링 */
  focusRing: '0 0 0 2px #FFFFFF, 0 0 0 4px #B5301F',
} as const;

/** 터치 영역과 컨트롤 높이 */
export const size = {
  /** 모든 탭 가능한 요소의 최소 터치 영역 */
  touch: 44,
  /** Primary CTA(하단 주문 버튼) 높이 */
  cta: 56,
  /** 버튼(md), 입력창, 검색창 높이 */
  control: 48,
  /** 필터·카테고리 칩 높이 */
  chip: 36,
  /** 상단 내비게이션 높이 */
  topnav: 56,
  /** 하단 탭 바 높이 (안전 영역 제외) */
  bottomnav: 64,
} as const;
