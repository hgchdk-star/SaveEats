import { Pressable, StyleSheet } from 'react-native';

import { colors, radius, size } from '@/theme';

import { Icon, type IconName } from './icon';

type IconButtonProps = {
  icon: IconName;
  /** 스크린리더용 이름 */
  label: string;
  onPress?: () => void;
  disabled?: boolean;
};

/** 아이콘 하나로 된 버튼. 터치 영역은 항상 size.touch(44px) */
export function IconButton({ icon, label, onPress, disabled = false }: IconButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
      <Icon name={icon} color={disabled ? colors.inkDisabled : colors.ink} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: size.touch,
    height: size.touch,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    backgroundColor: colors.surfaceMuted,
  },
});
