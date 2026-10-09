import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, font, radius, spacing, tabularNums, text } from '@/theme';

import { SecondaryButton } from './button';
import { Icon } from './icon';

type CopyRowProps = {
  label: string;
  value: string;
  /** 값을 확인하지 못했을 때의 안내. 있으면 오류 줄이 보이고 복사 버튼 자리에 retry가 온다 */
  error?: string;
  action: { label: string; onPress: () => void; icon?: 'refresh' };
};

/** 직접 주문 이어가기의 복사 줄. 복사는 버튼을 눌렀을 때만 일어난다 (TRF-007) */
function CopyRow({ label, value, error, action }: CopyRowProps) {
  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value}>{value}</Text>
        {error ? (
          <View accessibilityRole="alert" style={styles.error}>
            <Icon name="alert" size={14} color={colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
      </View>
      <SecondaryButton size="sm" icon={action.icon} onPress={action.onPress}>
        {action.label}
      </SecondaryButton>
    </View>
  );
}

/** 복사 줄을 묶는 카드 */
export function CopyCard({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

CopyCard.Row = CopyRow;

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: spacing[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  text: {
    flex: 1,
  },
  label: {
    ...text.body2,
    fontSize: 13,
    lineHeight: 18,
    color: colors.inkTertiary,
  },
  value: {
    ...font('700'),
    ...tabularNums,
    fontSize: 18,
    lineHeight: 26,
    color: colors.ink,
    marginTop: 2,
  },
  error: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  errorText: {
    ...text.caption,
    color: colors.danger,
  },
});
