import { typography, type TypographyToken } from './tokens';

/**
 * 글꼴 파일과 글자 스타일.
 *
 * Expo SDK 57은 가변 글꼴을 지원하지 않아서 굵기마다 정적 글꼴 파일을 따로 싣는다.
 * 굵기는 fontWeight가 아니라 fontFamily로 고른다 (Android에서 fontWeight를 함께 주면 가짜 굵기가 덧입혀진다).
 */
const FAMILY_BY_WEIGHT = {
  '400': 'Pretendard-Regular',
  '500': 'Pretendard-Medium',
  '600': 'Pretendard-SemiBold',
  '700': 'Pretendard-Bold',
} as const;

export type FontWeight = keyof typeof FAMILY_BY_WEIGHT;

/** 루트 레이아웃이 `useFonts`로 싣는 글꼴 파일 */
export const fontAssets = {
  'Pretendard-Regular': require('@/assets/fonts/Pretendard-Regular.otf'),
  'Pretendard-Medium': require('@/assets/fonts/Pretendard-Medium.otf'),
  'Pretendard-SemiBold': require('@/assets/fonts/Pretendard-SemiBold.otf'),
  'Pretendard-Bold': require('@/assets/fonts/Pretendard-Bold.otf'),
};

/** 토큰에 없는 크기를 쓸 때 굵기만 고른다 */
export function font(weight: FontWeight) {
  return { fontFamily: FAMILY_BY_WEIGHT[weight] };
}

type TextStyleToken = {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing?: number;
};

function toTextStyle(token: (typeof typography)[TypographyToken]): TextStyleToken {
  const { fontWeight, ...rest } = token;
  return { ...font(fontWeight), ...rest };
}

/** typography 토큰을 Text 스타일로 바꾼 것. 화면 코드는 이 값을 쓴다 */
export const text = Object.fromEntries(
  (Object.keys(typography) as TypographyToken[]).map((name) => [name, toTextStyle(typography[name])]),
) as Record<TypographyToken, TextStyleToken>;

/** 가격·수량처럼 자릿수가 흔들리면 안 되는 숫자에 쓴다 */
export const tabularNums = { fontVariant: ['tabular-nums' as const] };
