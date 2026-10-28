import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, font, radius, size, spacing, text } from '@/theme';

type FoodCategoryChipProps = {
  label: string;
  /** 음식 사진 썸네일. 없으면 이름 첫 글자를 Placeholder 원에 보여준다 */
  imageUri: string | null;
  selected: boolean;
  onPress: () => void;
};

/**
 * 음식 카테고리 칩. 한 그룹 안에서 항상 하나만 선택된다 (FR-CAT-004).
 * 선택된 칩은 작은 흰 글자가 올라가므로 actionFill 채움.
 */
export function FoodCategoryChip({ label, imageUri, selected, onPress }: FoodCategoryChipProps) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.selected,
        pressed && (selected ? styles.selectedPressed : styles.pressed),
      ]}>
      {imageUri ? (
        <Image source={{ uri: imageUri }} contentFit="cover" style={[styles.thumb, selected && styles.thumbSelected]} />
      ) : (
        <View style={[styles.thumb, styles.thumbEmpty, selected && styles.thumbSelected]}>
          <Text style={styles.glyph}>{label.slice(0, 1)}</Text>
        </View>
      )}
      <Text style={[styles.label, selected && styles.labelSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    height: size.chip,
    paddingLeft: 4,
    paddingRight: spacing[3],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  pressed: {
    backgroundColor: colors.surfaceMuted,
  },
  selected: {
    backgroundColor: colors.actionFill,
    borderColor: colors.actionFill,
  },
  selectedPressed: {
    backgroundColor: colors.actionFillPressed,
    borderColor: colors.actionFillPressed,
  },
  thumb: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  thumbEmpty: {
    backgroundColor: colors.foodPlaceholder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbSelected: {
    borderWidth: 1.5,
    borderColor: colors.onBrand,
  },
  glyph: {
    ...font('700'),
    fontSize: 12,
    lineHeight: 16,
    color: colors.inkSecondary,
  },
  label: {
    ...text.label,
    color: colors.ink,
  },
  labelSelected: {
    color: colors.onBrand,
  },
});
