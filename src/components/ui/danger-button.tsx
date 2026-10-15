import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { colors, font, radius, size, spacing } from '@/theme';

type DangerButtonProps = {
  children: string;
  onPress?: () => void;
  /** 가로를 꽉 채운다 */
  block?: boolean;
  disabled?: boolean;
  loading?: boolean;
};

/**
 * 되돌리기 어려운 행동의 확인 버튼 (회원 탈퇴). [새 컴포넌트 제안] DangerButton.
 * DS 컴포넌트가 아니라 DS 토큰으로 조합했다: SecondaryButton(lg)과 같은 틀(높이·반경·테두리 1px)에
 * 글자·테두리만 danger 색을 쓴다. Tomato는 브랜드와 주요 CTA에만 쓰므로 위험한 행동에는 쓰지 않는다.
 */
export function DangerButton({ children, onPress, block, disabled, loading }: DangerButtonProps) {
  const inactive = disabled || loading;
  const color = disabled ? colors.inkDisabled : colors.danger;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [styles.base, block && styles.block, { borderColor: disabled ? colors.line : colors.danger }, pressed && styles.pressed]}>
      {loading ? <ActivityIndicator size="small" color={colors.danger} /> : null}
      <Text numberOfLines={1} style={[styles.label, { color }]}>
        {children}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: size.cta,
    paddingHorizontal: spacing[5],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    backgroundColor: colors.surface,
    alignSelf: 'flex-start',
  },
  block: {
    alignSelf: 'stretch',
  },
  pressed: {
    backgroundColor: colors.dangerSoft,
    transform: [{ scale: 0.98 }],
  },
  label: {
    ...font('700'),
    fontSize: 19,
    lineHeight: 26,
  },
});
