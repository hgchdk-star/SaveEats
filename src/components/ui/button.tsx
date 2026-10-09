import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, font, radius, size, spacing } from '@/theme';

import { Icon, type IconName } from './icon';

type ButtonSize = 'lg' | 'md' | 'sm';

type ButtonProps = {
  children: ReactNode;
  onPress?: () => void;
  size?: ButtonSize;
  /** 가로를 꽉 채운다 */
  block?: boolean;
  icon?: IconName;
  disabled?: boolean;
  /** 스피너를 보여주고 누를 수 없게 한다 */
  loading?: boolean;
};

const HEIGHT = { lg: size.cta, md: size.control, sm: 36 } as const;
const LABEL = {
  lg: { ...font('700'), fontSize: 19, lineHeight: 26 },
  md: { ...font('700'), fontSize: 16, lineHeight: 24 },
  sm: { ...font('600'), fontSize: 14, lineHeight: 20 },
} as const;

/**
 * 큰 CTA(lg)는 brand 채움, md·sm은 작은 흰 글자라 접근성용 actionFill 채움.
 * 비활성은 불투명도로 흐리지 않고 line 채움 + inkDisabled 글자.
 */
export function PrimaryButton({ children, onPress, size: s = 'lg', block, icon, disabled, loading, leading }: ButtonProps & { leading?: ReactNode }) {
  const inactive = disabled || loading;
  const fill = s === 'lg' ? colors.brand : colors.actionFill;
  const pressedFill = s === 'lg' ? colors.brandPressed : colors.actionFillPressed;
  const labelColor = disabled && !loading ? colors.inkDisabled : colors.onBrand;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        { height: HEIGHT[s], paddingHorizontal: s === 'lg' ? spacing[5] : s === 'md' ? spacing[4] : spacing[3] },
        s === 'sm' && styles.small,
        block && styles.block,
        { backgroundColor: loading ? colors.brandPressed : disabled ? colors.line : pressed ? pressedFill : fill },
        pressed && styles.pressed,
      ]}>
      {loading ? <ActivityIndicator size="small" color={colors.onBrand} /> : null}
      {!loading && icon ? <Icon name={icon} size={s === 'sm' ? 16 : 20} color={labelColor} /> : null}
      {leading}
      <Text numberOfLines={1} style={[LABEL[s], { color: labelColor }]}>
        {children}
      </Text>
    </Pressable>
  );
}

export function SecondaryButton({ children, onPress, size: s = 'md', block, icon, disabled, loading }: ButtonProps) {
  const inactive = disabled || loading;
  const color = inactive ? colors.inkDisabled : colors.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        styles.secondary,
        { height: HEIGHT[s], paddingHorizontal: s === 'lg' ? spacing[5] : s === 'md' ? spacing[4] : spacing[3] },
        s === 'sm' && styles.small,
        block && styles.block,
        inactive && styles.secondaryDisabled,
        pressed && styles.secondaryPressed,
      ]}>
      {loading ? <ActivityIndicator size="small" color={colors.inkSecondary} /> : null}
      {!loading && icon ? <Icon name={icon} size={s === 'sm' ? 16 : 20} color={color} /> : null}
      <Text numberOfLines={1} style={[LABEL[s], { color }]}>
        {children}
      </Text>
    </Pressable>
  );
}

export function TextButton({ children, onPress, size: s = 'md', disabled }: Pick<ButtonProps, 'children' | 'onPress' | 'disabled'> & { size?: 'md' | 'sm' }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.base, styles.text, { height: s === 'md' ? 40 : 36 }, s === 'sm' && styles.small, pressed && styles.textPressed]}>
      <Text style={[s === 'md' ? styles.textLabelMd : styles.textLabelSm, { color: disabled ? colors.inkDisabled : colors.brandText }]}>{children}</Text>
    </Pressable>
  );
}

/** PrimaryButton 안 왼쪽에 놓는 수량 알약 (가게 상세 "장바구니 보기") */
export function ButtonCount({ value }: { value: number }) {
  return (
    <View style={styles.count}>
      <Text style={styles.countText}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
    alignSelf: 'flex-start',
  },
  small: {
    borderRadius: radius.sm,
  },
  block: {
    alignSelf: 'stretch',
  },
  pressed: {
    transform: [{ scale: 0.98 }],
  },
  secondary: {
    backgroundColor: colors.surface,
    borderColor: colors.lineStrong,
  },
  secondaryDisabled: {
    borderColor: colors.line,
  },
  secondaryPressed: {
    backgroundColor: colors.surfaceMuted,
    transform: [{ scale: 0.98 }],
  },
  text: {
    paddingHorizontal: spacing[2],
  },
  textPressed: {
    backgroundColor: colors.brandSoft,
  },
  textLabelMd: {
    ...font('600'),
    fontSize: 15,
    lineHeight: 24,
  },
  textLabelSm: {
    ...font('600'),
    fontSize: 14,
    lineHeight: 20,
  },
  count: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: radius.full,
    backgroundColor: colors.onBrand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: {
    ...font('700'),
    fontSize: 13,
    lineHeight: 16,
    color: colors.brandText,
  },
});
