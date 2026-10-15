import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, text } from '@/theme';

import { SecondaryButton } from './button';
import { Icon, type IconName } from './icon';

type EmptyStateProps = {
  icon?: IconName;
  title: string;
  description?: string;
  action?: ReactNode;
};

/** 비어 있는 상태. 오류와 구분해서 쓴다 (0개 성공 응답일 때만) */
export function EmptyState({ icon = 'cart', title, description, action }: EmptyStateProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.iconCircle}>
        <Icon name={icon} size={24} color={colors.inkTertiary} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

type ErrorStateProps = {
  title?: string;
  description?: string;
  onRetry?: () => void;
};

/** 오류는 색만으로 알리지 않고 항상 아이콘 + 문구 + 해결 방법 */
export function ErrorState({ title = '잠시 문제가 생겼어요', description = '네트워크 상태를 확인하고 다시 시도해 주세요.', onRetry }: ErrorStateProps) {
  return (
    <View accessibilityRole="alert" style={styles.wrap}>
      <View style={[styles.iconCircle, styles.errorCircle]}>
        <Icon name="alert" size={24} color={colors.danger} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
      {onRetry ? (
        <View style={styles.action}>
          <SecondaryButton icon="refresh" onPress={onRetry}>
            다시 시도
          </SecondaryButton>
        </View>
      ) : null}
    </View>
  );
}

/** 한 섹션만 실패했을 때: 다른 섹션은 그대로 쓸 수 있다 */
export function SectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View accessibilityRole="alert" style={styles.sectionError}>
      <View style={styles.sectionErrorIcon}>
        <Icon name="alert" size={20} color={colors.danger} />
      </View>
      <Text style={styles.sectionErrorText}>{message}</Text>
      <SecondaryButton size="sm" onPress={onRetry}>
        다시 시도
      </SecondaryButton>
    </View>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label ?? '불러오는 중'} style={styles.spinner}>
      <ActivityIndicator size="large" color={colors.brand} />
      {label ? <Text style={styles.spinnerLabel}>{label}</Text> : null}
    </View>
  );
}

/** 로딩 자리를 같은 모양의 사각형으로 채운다 */
export function Skeleton({ width = '100%', height, radius: r = radius.xs }: { width?: number | `${number}%`; height: number; radius?: number }) {
  return <View style={{ width, height, borderRadius: r, backgroundColor: colors.foodPlaceholder }} />;
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingVertical: spacing[10],
    paddingHorizontal: spacing[5],
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[4],
  },
  errorCircle: {
    backgroundColor: colors.dangerSoft,
  },
  title: {
    ...text.h3,
    color: colors.ink,
    textAlign: 'center',
  },
  description: {
    ...text.body2,
    color: colors.inkSecondary,
    textAlign: 'center',
    marginTop: spacing[1],
    maxWidth: 280,
  },
  action: {
    marginTop: spacing[5],
  },
  sectionError: {
    marginHorizontal: spacing[5],
    padding: spacing[4],
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
  },
  sectionErrorIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionErrorText: {
    ...text.label,
    flex: 1,
    color: colors.ink,
  },
  spinner: {
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[10],
  },
  spinnerLabel: {
    ...text.body2,
    color: colors.inkSecondary,
  },
});
