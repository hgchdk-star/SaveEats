import { StyleSheet, Text, View } from 'react-native';

import { draftCopy } from '@/config/draft-copy';
import { colors, font, spacing } from '@/theme';

import { Icon } from './icon';

/**
 * SaveEats 로고(접시 아이콘을 브랜드 색 바탕에 얹은 마크)와 워드마크. DS에 로고가 없어서 DS 아이콘과 토큰으로 만든 임시 조합이다.
 * 실제 로고 파일이 정해지면 이 컴포넌트 안만 바꾼다. [새 컴포넌트 제안] 로고 · 워드마크
 */
export function Logo() {
  return (
    <View accessibilityRole="image" accessibilityLabel={draftCopy.start.wordmark} style={styles.wrap}>
      <View style={styles.mark}>
        <Icon name="plate" size={32} color={colors.onBrand} />
      </View>
      <Text style={styles.word}>{draftCopy.start.wordmark}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: spacing[3],
  },
  mark: {
    width: 88,
    height: 88,
    borderRadius: 28,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  word: {
    ...font('700'),
    fontSize: 32,
    lineHeight: 40,
    letterSpacing: -0.96,
    color: colors.ink,
  },
});
