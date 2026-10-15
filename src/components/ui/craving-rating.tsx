import { StyleSheet, Text, View } from 'react-native';

import { colors, font, tabularNums } from '@/theme';

import { Icon } from './icon';

type CravingRatingProps = {
  /** 땡김도 평균 (0~5) */
  value: number;
  /** compact: 별 1개 + 숫자 (가게 카드). 기본: 별 5개 */
  compact?: boolean;
  size?: 16 | 20;
};

/**
 * 땡김도. "별점"·"맛"·"만족도"라고 부르지 않는다.
 * rating 색은 흰 바탕 대비가 낮아서 반드시 숫자와 함께 보여준다.
 */
export function CravingRating({ value, compact = false, size = 16 }: CravingRatingProps) {
  const label = value.toFixed(1);
  if (compact) {
    return (
      <View accessible accessibilityRole="image" accessibilityLabel={`땡김도 ${label}점`} style={styles.compact}>
        <Icon name="star" size={size} color={colors.rating} filled strokeWidth={0} />
        <Text style={styles.value}>{label}</Text>
      </View>
    );
  }
  const on = Math.round(value);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={`땡김도 ${label}점`} style={styles.stars}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Icon key={n} name="star" size={size} color={n <= on ? colors.rating : colors.ratingEmpty} filled strokeWidth={0} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  compact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  stars: {
    flexDirection: 'row',
    gap: 1,
  },
  value: {
    ...font('700'),
    ...tabularNums,
    fontSize: 14,
    lineHeight: 20,
    color: colors.ink,
    marginLeft: 2,
  },
});
