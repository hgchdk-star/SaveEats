import { Pressable, StyleSheet, Text } from 'react-native';

import { confirmedCopy } from '@/config/confirmed-copy';
import { colors, font, radius, spacing, text } from '@/theme';

import { SecondaryButton } from './button';
import { Icon } from './icon';

type ReviewWriteButtonProps = {
  /** available: 리뷰 쓰기 / written: 작성 완료 · 보기 / expired: 작성 기간이 지났어요 */
  status: 'available' | 'written' | 'expired';
  onPress?: () => void;
};

/**
 * 내역의 리뷰 버튼 (기획서 30). 지금 이 주문에 리뷰가 있는지, 완료 후 30일 안인지 두 가지로만 정해진다.
 * 30일이 지났어도 이미 쓴 리뷰는 그대로 보고 고칠 수 있으므로 written은 기간과 상관없다.
 */
export function ReviewWriteButton({ status, onPress }: ReviewWriteButtonProps) {
  if (status === 'expired') return <Text style={styles.expired}>{confirmedCopy.reviewExpired}</Text>;
  if (status === 'written') {
    return (
      <Pressable accessibilityRole="button" disabled={!onPress} onPress={onPress} style={({ pressed }) => [styles.written, pressed && styles.writtenPressed]}>
        <Icon name="check" size={16} color={colors.success} strokeWidth={2.25} />
        <Text style={styles.writtenText}>{confirmedCopy.reviewWritten}</Text>
      </Pressable>
    );
  }
  return (
    <SecondaryButton size="sm" icon="edit" block onPress={onPress}>
      {confirmedCopy.reviewWrite}
    </SecondaryButton>
  );
}

const styles = StyleSheet.create({
  expired: {
    ...text.body2,
    color: colors.inkTertiary,
  },
  written: {
    height: 36,
    paddingHorizontal: spacing[3],
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    alignSelf: 'stretch',
  },
  writtenPressed: {
    backgroundColor: colors.line,
  },
  writtenText: {
    ...font('600'),
    fontSize: 14,
    lineHeight: 20,
    color: colors.inkSecondary,
  },
});
