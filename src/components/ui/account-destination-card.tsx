import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, tabularNums, text } from '@/theme';

import { Icon } from './icon';

type AccountDestinationCardProps = {
  /** 등록된 계좌. 없으면 등록을 권하는 빈 카드. 전체 번호·잔액은 표시하지 않는다 */
  account: { bankName: string; last4: string } | null;
  onPress?: () => void;
  /** 카드 아래 작은 줄. 기본은 "돈이 배달될 계좌" */
  caption?: string;
};

/** 돈이 배달될 계좌 카드 (토스뱅크 •••• 1234). 계좌가 없으면 점선 테두리의 등록 카드 */
export function AccountDestinationCard({ account, onPress, caption = '돈이 배달될 계좌' }: AccountDestinationCardProps) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={account ? `${account.bankName} 끝 네 자리 ${account.last4}, ${caption}` : '계좌를 등록해주세요'}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.card, !account && styles.empty, pressed && styles.pressed]}>
      <View style={[styles.icon, !account && styles.iconEmpty]}>
        <Icon name={account ? 'bank' : 'plus'} size={20} color={account ? colors.brandText : colors.inkSecondary} />
      </View>
      <View style={styles.text}>
        <Text style={styles.main}>{account ? `${account.bankName} •••• ${account.last4}` : '계좌를 등록해주세요'}</Text>
        <Text style={styles.sub}>{account ? caption : '아낀 주문금액이 배달될 곳이에요.'}</Text>
      </View>
      {onPress ? <Icon name="chevronRight" size={20} color={colors.inkTertiary} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  empty: {
    borderStyle: 'dashed',
    borderColor: colors.lineStrong,
  },
  pressed: {
    backgroundColor: colors.surfaceMuted,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconEmpty: {
    backgroundColor: colors.surfaceMuted,
  },
  text: {
    flex: 1,
  },
  main: {
    ...text.title,
    ...tabularNums,
    color: colors.ink,
  },
  sub: {
    ...text.body2,
    fontSize: 13,
    lineHeight: 18,
    color: colors.inkTertiary,
  },
});
