import { Pressable, StyleSheet, Text, View } from 'react-native';

import { LIMITS } from '@/config/limits';
import { colors, font, radius, tabularNums } from '@/theme';

import { Icon, type IconName } from './icon';

type QuantitySelectorProps = {
  value: number;
  onChange: (next: number) => void;
  /** 넘기면 최소 수량에서 − 대신 휴지통이 보인다. 0으로 줄여서 지우지 않고 삭제는 별도 동작이다 */
  onRemove?: () => void;
  size?: 'md' | 'sm';
  disabled?: boolean;
};

/** 수량 1~10. 1에서 −, 10에서 +는 비활성 (FR-MENU-002~004 · FR-CART-012) */
export function QuantitySelector({ value, onChange, onRemove, size = 'md', disabled = false }: QuantitySelectorProps) {
  const atMin = value <= LIMITS.quantityMin;
  const atMax = value >= LIMITS.quantityMax;
  const removable = atMin && !!onRemove;
  const small = size === 'sm';

  const button = (icon: IconName, label: string, off: boolean, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: off }}
      disabled={off}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.button, small && styles.buttonSmall, pressed && styles.pressed]}>
      <Icon name={icon} size={16} color={off ? colors.inkDisabled : colors.ink} />
    </Pressable>
  );

  return (
    <View accessibilityLabel="수량" style={[styles.box, small && styles.boxSmall, disabled && styles.boxDisabled]}>
      {removable
        ? button('trash', '삭제', false, () => onRemove?.())
        : button('minus', '빼기', disabled || atMin, () => onChange(value - 1))}
      <Text accessibilityLiveRegion="polite" style={[styles.value, small && styles.valueSmall, disabled && styles.valueDisabled]}>
        {value}
      </Text>
      {button('plus', '더하기', disabled || atMax, () => onChange(value + 1))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    height: 40,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  boxSmall: {
    height: 32,
  },
  boxDisabled: {
    borderColor: colors.line,
  },
  button: {
    width: 40,
    height: 38,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSmall: {
    width: 32,
    height: 30,
  },
  pressed: {
    backgroundColor: colors.surfaceMuted,
  },
  value: {
    ...font('700'),
    ...tabularNums,
    minWidth: 28,
    textAlign: 'center',
    fontSize: 16,
    lineHeight: 22,
    color: colors.ink,
  },
  valueSmall: {
    minWidth: 24,
    fontSize: 14,
    lineHeight: 20,
  },
  valueDisabled: {
    color: colors.inkDisabled,
  },
});
