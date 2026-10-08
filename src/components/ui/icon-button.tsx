import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, font, radius, shadow, size } from '@/theme';

import { Icon, type IconName } from './icon';

type IconButtonProps = {
  icon: IconName;
  /** 스크린리더용 이름 */
  label: string;
  onPress?: () => void;
  /** overlay는 음식 사진 위에서만 쓴다: 흰 원 + 그림자 */
  variant?: 'plain' | 'overlay';
  /** 숫자 배지. 0이나 undefined면 숨긴다 */
  badge?: number;
  disabled?: boolean;
};

/** 아이콘 하나로 된 버튼. 터치 영역은 항상 size.touch(44px) */
export function IconButton({ icon, label, onPress, variant = 'plain', badge, disabled = false }: IconButtonProps) {
  const overlay = variant === 'overlay';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={badge ? `${label} ${badge}개` : label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={styles.touch}>
      {({ pressed }) => (
        <View style={[styles.circle, overlay && styles.overlay, pressed && styles.pressed]}>
          <Icon name={icon} color={disabled ? colors.inkDisabled : colors.ink} />
          {badge ? (
            <View style={[styles.badge, overlay && styles.badgeOnOverlay]}>
              <Text style={styles.badgeText}>{badge}</Text>
            </View>
          ) : null}
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
    width: 40,
    height: 40,
    backgroundColor: colors.surface,
    boxShadow: shadow.float,
  },
  pressed: {
    backgroundColor: colors.surfaceMuted,
  },
  badge: {
    position: 'absolute',
    top: 2,
    right: 0,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 5,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: colors.surface,
    backgroundColor: colors.actionFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeOnOverlay: {
    top: -4,
    right: -6,
  },
  badgeText: {
    ...font('700'),
    fontSize: 11,
    lineHeight: 14,
    color: colors.onBrand,
  },
});
