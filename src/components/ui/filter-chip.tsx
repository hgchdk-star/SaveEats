import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, radius, size, spacing, text } from '@/theme';

import { Icon } from './icon';

type FilterChipProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
};

/** 켜고 끄는 필터 칩(사진 리뷰). 여러 개가 동시에 켜질 수 있는 필터이며, 카테고리 칩의 "하나만 선택"과 다르다 */
export function FilterChip({ label, selected, onPress }: FilterChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, selected && styles.selected, pressed && !selected && styles.pressed]}>
      {selected ? <Icon name="check" size={16} color={colors.brandText} strokeWidth={2.25} /> : null}
      <Text style={[styles.label, selected && styles.labelSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    height: size.chip,
    paddingHorizontal: spacing[3],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    alignSelf: 'flex-start',
  },
  selected: {
    backgroundColor: colors.brandSoft,
    borderColor: colors.brand,
  },
  pressed: {
    backgroundColor: colors.surfaceMuted,
  },
  label: {
    ...text.label,
    color: colors.ink,
  },
  labelSelected: {
    color: colors.brandText,
  },
});
