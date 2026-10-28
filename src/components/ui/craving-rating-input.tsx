import { Pressable, StyleSheet, View } from 'react-native';

import { colors, spacing } from '@/theme';

import { Icon } from './icon';

type CravingRatingInputProps = {
  /** 0이면 아직 고르지 않음 */
  value: number;
  onChange: (next: number) => void;
  disabled?: boolean;
};

/** 땡김도를 고르는 별 5개. 얼마나 먹고 싶었는지를 1~5로 고른다 (맛 평가가 아니다) */
export function CravingRatingInput({ value, onChange, disabled = false }: CravingRatingInputProps) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="땡김도 선택" style={styles.row}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable
          key={n}
          accessibilityRole="radio"
          accessibilityLabel={`땡김도 ${n}`}
          accessibilityState={{ checked: n === value, disabled }}
          disabled={disabled}
          hitSlop={4}
          onPress={() => onChange(n)}
          style={({ pressed }) => [styles.star, pressed && styles.pressed]}>
          <Icon name="star" size={32} color={n <= value ? colors.rating : colors.ratingEmpty} filled strokeWidth={0} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing[1],
  },
  star: {
    padding: spacing[1],
  },
  pressed: {
    transform: [{ scale: 0.9 }],
  },
});
