import { Pressable, StyleSheet, Text, View } from 'react-native';

import { LIMITS } from '@/config/limits';
import { colors, font, radius, tabularNums } from '@/theme';

import { Icon, type IconName } from './icon';

type QuantitySelectorProps = {
  value: number;
  onChange: (next: number) => void;
  /** 넘기면 최소 수량에서 − 대신 휴지통이 보인다. 0으로 줄여서 지우지 않고 삭제는 별도 동작이다 */
  onRemove?: () => void;
  /** 'row'는 옵션 행 오른쪽에 두는 크기(버튼 36×34 + 터치 여유 6 = 48×46). 장바구니의 'sm'은 그대로다 */
  size?: 'md' | 'sm' | 'row';
  /** 테두리·아이콘을 브랜드색(Tomato)으로. 기본은 기존 중립색 */
  accent?: boolean;
  disabled?: boolean;
  /** 기본은 메뉴 수량 범위(LIMITS). 옵션 수량처럼 다른 범위가 필요하면 넘긴다 */
  min?: number;
  max?: number;
  /** 접근성 이름. 기본 "수량" */
  label?: string;
};

/** 수량 1~10. 1에서 −, 10에서 +는 비활성 (FR-MENU-002~004 · FR-CART-012) */
export function QuantitySelector({ value, onChange, onRemove, size = 'md', accent = false, disabled = false, min = LIMITS.quantityMin, max = LIMITS.quantityMax, label = '수량' }: QuantitySelectorProps) {
  const atMin = value <= min;
  const atMax = value >= max;
  const removable = atMin && !!onRemove;
  const small = size === 'sm';
  const inRow = size === 'row';

  const button = (icon: IconName, label: string, off: boolean, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: off }}
      disabled={off}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.button, small && styles.buttonSmall, inRow && styles.buttonRow, pressed && styles.pressed]}>
      <Icon name={icon} size={16} color={off ? colors.inkDisabled : accent ? colors.brand : colors.ink} />
    </Pressable>
  );

  return (
    <View accessibilityLabel={label} style={[styles.box, small && styles.boxSmall, inRow && styles.boxRow, accent && !disabled && styles.boxAccent, disabled && styles.boxDisabled]}>
      {removable
        ? button('trash', '삭제', false, () => onRemove?.())
        : button('minus', '빼기', disabled || atMin, () => onChange(value - 1))}
      <Text accessibilityLiveRegion="polite" style={[styles.value, (small || inRow) && styles.valueSmall, disabled && styles.valueDisabled]}>
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
  boxRow: {
    height: 36,
    alignSelf: 'center',
  },
  boxAccent: {
    borderColor: colors.brand,
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
  buttonRow: {
    width: 36,
    height: 34,
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
