import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, text } from '@/theme';

import { FoodImage } from './food-image';
import { Icon } from './icon';

type PhotoPickerProps = {
  /** 사진이 없으면 추가 칸. 있으면 미리보기 */
  photo: { uri: string | null; status: 'uploading' | 'ready' | 'failed' } | null;
  addLabel: string;
  /** 추가한 사진 수 표시 ("0/1") */
  countLabel: string;
  removeLabel: string;
  disabled?: boolean;
  onAdd: () => void;
  onRemove: () => void;
};

const SIZE = 88;

/** 리뷰 사진 1장. 올리는 중과 실패를 사진 위에 표시한다. 실패해도 글과 땡김도는 그대로 둔다 */
export function PhotoPicker({ photo, addLabel, countLabel, removeLabel, disabled = false, onAdd, onRemove }: PhotoPickerProps) {
  if (!photo) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={addLabel} disabled={disabled} onPress={onAdd} style={styles.add}>
        <Icon name="plus" size={24} color={disabled ? colors.inkDisabled : colors.inkSecondary} />
        <Text style={styles.addText}>{addLabel}</Text>
        <Text style={styles.addText}>{countLabel}</Text>
      </Pressable>
    );
  }
  return (
    <View style={styles.photo}>
      <FoodImage uri={photo.uri} alt="리뷰 사진" width={SIZE} rounded={radius.md} />
      {photo.status === 'uploading' ? (
        <View accessibilityRole="progressbar" accessibilityLabel="사진을 올리는 중" style={[styles.state, { backgroundColor: colors.overlay }]}>
          <ActivityIndicator color={colors.onBrand} />
        </View>
      ) : null}
      {photo.status === 'failed' ? (
        <View style={styles.state}>
          <View style={styles.failedFill} />
          <Icon name="alert" size={24} color={colors.onBrand} />
        </View>
      ) : null}
      <Pressable accessibilityRole="button" accessibilityLabel={removeLabel} hitSlop={8} onPress={onRemove} style={styles.remove}>
        <Icon name="close" size={16} color={colors.onBrand} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  add: {
    width: SIZE,
    height: SIZE,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  addText: {
    ...text.caption,
    color: colors.inkSecondary,
  },
  photo: {
    width: SIZE,
    height: SIZE,
  },
  state: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  failedFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radius.md,
    backgroundColor: colors.danger,
    opacity: 0.72,
  },
  remove: {
    position: 'absolute',
    top: -spacing[2],
    right: -spacing[2],
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
