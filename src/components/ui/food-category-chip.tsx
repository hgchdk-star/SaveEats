import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';

import { colors, font, radius, size, spacing, text } from '@/theme';

import { Icon } from './icon';

type FoodCategoryChipProps = {
  label: string;
  /** 음식 사진 썸네일. 없으면 이름 첫 글자를 Placeholder 원에 보여준다 */
  imageUri: string | null;
  /** 사진이 없을 때 그리는 일러스트(SVG 문서). imageUri가 있으면 사진이 먼저다 */
  art?: string | null;
  /** true면 원 안에 SaveEats 로고(접시 아이콘)를 보인다. '전체' 칩이 쓴다 */
  logo?: boolean;
  selected: boolean;
  onPress: () => void;
};

/**
 * 음식 카테고리 칩. 한 그룹 안에서 항상 하나만 선택된다 (FR-CAT-004).
 * 선택된 칩은 작은 흰 글자가 올라가므로 actionFill 채움.
 */
export function FoodCategoryChip({ label, imageUri, art = null, logo = false, selected, onPress }: FoodCategoryChipProps) {
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
      ) : logo ? (
        <View style={[styles.thumb, styles.thumbLogo, selected && styles.thumbSelected]}>
          <Icon name="plate" size={16} color={colors.onBrand} />
        </View>
      ) : art ? (
        <View style={[styles.thumb, styles.thumbArt, selected && styles.thumbSelected]}>
          <SvgXml xml={art} width="100%" height="100%" />
        </View>
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
  thumbLogo: {
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbArt: {
    overflow: 'hidden',
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
