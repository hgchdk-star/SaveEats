import { Platform } from 'react-native';

import { text } from '@/theme';

/**
 * 한 줄 입력(TextInput)의 글자 스타일. 일반 본문(text.body1)과 같은 글꼴·크기·자간이다.
 *
 * iOS에서는 한 줄 TextInput에 lineHeight를 주면 글자와 placeholder가 줄 높이(24) 안에서 아래쪽으로 붙어
 * 세로 중앙보다 내려가 보인다. 그래서 iOS에서만 lineHeight를 빼고, 입력창을 감싼 상자(높이 고정, alignItems: 'center')가
 * 글자를 가운데에 놓게 한다. Android는 lineHeight를 그대로 두어 기존 배치를 유지한다.
 *
 * - 여러 줄 입력(text-area)은 줄 사이 간격이 필요해서 lineHeight를 유지한다. 이 스타일을 쓰지 않는다.
 * - 일반 본문 typography 토큰(text.body1)은 바꾸지 않는다.
 * - 글자 확대 접근성(allowFontScaling)은 건드리지 않는다.
 */
const { lineHeight: _lineHeight, ...body1WithoutLineHeight } = text.body1;

export const singleLineInputText = Platform.OS === 'ios' ? body1WithoutLineHeight : text.body1;
