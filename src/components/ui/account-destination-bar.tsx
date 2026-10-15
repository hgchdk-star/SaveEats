import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, font, spacing, tabularNums, text } from '@/theme';

import { Icon } from './icon';

type AccountDestinationBarProps = {
  /** 등록된 계좌. 없으면 등록을 권하는 문구를 보여준다. 전체 번호·잔액은 표시하지 않는다 */
  account: { bankName: string; last4: string } | null;
  onPress: () => void;
};

/** 홈 상단 배달 주소 자리: 돈이 배달될 계좌 (토스뱅크 •••• 1234) */
export function AccountDestinationBar({ account, onPress }: AccountDestinationBarProps) {
  const label = account ? `${account.bankName} •••• ${account.last4}` : '계좌를 등록해주세요';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={account ? `돈이 배달될 계좌 ${account.bankName} 끝 네 자리 ${account.last4}` : '계좌를 등록해주세요'}
      onPress={onPress}
      style={styles.bar}>
      <View style={[styles.icon, !account && styles.iconEmpty]}>
        <Icon name={account ? 'bank' : 'plus'} size={16} color={account ? colors.brandText : colors.inkSecondary} />
      </View>
      <View style={styles.text}>
        <Text numberOfLines={1} style={styles.main}>
          {label}
        </Text>
        <Text numberOfLines={1} style={styles.sub}>
          {account ? '돈이 배달될 계좌' : '아낀 주문금액이 배달될 곳이에요.'}
        </Text>
      </View>
      <Icon name="chevronDown" size={20} color={colors.ink} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingVertical: spacing[2],
  },
  icon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconEmpty: {
    backgroundColor: colors.surfaceMuted,
  },
  text: {
    flexShrink: 1,
  },
  main: {
    ...text.title,
    ...tabularNums,
    color: colors.ink,
  },
  sub: {
    ...font('400'),
    fontSize: 12,
    lineHeight: 16,
    color: colors.inkTertiary,
  },
});
