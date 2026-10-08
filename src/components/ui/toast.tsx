import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useToastStore } from '@/features/toast/toast-store';
import { colors, font, radius, shadow, spacing, text } from '@/theme';

import { Icon } from './icon';

/**
 * 토스트 한 개를 화면 본문 아래쪽에 띄운다. Screen 안에 들어 있어서
 * 하단 탭이나 고정 CTA 바 바로 위에 자동으로 놓인다.
 */
export function ToastHost() {
  const toast = useToastStore((s) => s.toast);
  const hide = useToastStore((s) => s.hide);
  if (!toast) return null;

  const tone = toast.tone ?? 'default';
  return (
    <View pointerEvents="box-none" style={styles.slot}>
      <View accessibilityRole={tone === 'error' ? 'alert' : undefined} accessibilityLiveRegion="polite" style={styles.toast}>
        {tone !== 'default' ? (
          <View style={[styles.icon, { backgroundColor: tone === 'success' ? colors.success : colors.danger }]}>
            <Icon name={tone === 'success' ? 'check' : 'alert'} size={16} color={colors.onBrand} strokeWidth={2.25} />
          </View>
        ) : null}
        <Text style={styles.message}>{toast.message}</Text>
        {toast.action ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => {
              hide();
              toast.action?.onPress();
            }}>
            <Text style={styles.action}>{toast.action.label}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  slot: {
    position: 'absolute',
    left: spacing[5],
    right: spacing[5],
    bottom: spacing[4],
    zIndex: 30,
  },
  toast: {
    minHeight: 48,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderRadius: radius.sm,
    backgroundColor: colors.toastBg,
    boxShadow: shadow.sheet,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  icon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: {
    ...text.label,
    ...font('500'),
    flex: 1,
    color: colors.onBrand,
  },
  action: {
    ...font('700'),
    fontSize: 14,
    lineHeight: 20,
    color: colors.tomato200,
    padding: 4,
  },
});
