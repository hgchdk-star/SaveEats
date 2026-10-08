import { Pressable, StyleSheet, View } from 'react-native';

import { colors, radius, shadow, size } from '@/theme';

import { Icon } from './icon';

type FavoriteButtonProps = {
  active: boolean;
  onToggle: (next: boolean) => void;
  /** overlay는 음식 사진 위에서 쓴다 */
  variant?: 'plain' | 'overlay';
};

/** 찜 버튼. 가게만 찜할 수 있다 (FR-FAV-001) */
export function FavoriteButton({ active, onToggle, variant = 'plain' }: FavoriteButtonProps) {
  const overlay = variant === 'overlay';
  const color = active ? colors.brand : overlay ? colors.ink : colors.inkSecondary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={active ? '찜 해제' : '찜하기'}
      accessibilityState={{ selected: active }}
      onPress={() => onToggle(!active)}
      style={styles.touch}>
      {({ pressed }) => (
        <View style={[styles.circle, overlay && styles.overlay]}>
          <View style={pressed && styles.pressed}>
            <Icon name="heart" size={overlay ? 20 : 24} color={color} filled={active} />
          </View>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  touch: {
    width: size.touch,
    height: size.touch,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circle: {
    width: size.touch,
    height: size.touch,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlay: {
    width: 36,
    height: 36,
    backgroundColor: colors.surface,
    boxShadow: shadow.float,
  },
  pressed: {
    transform: [{ scale: 0.88 }],
  },
});
