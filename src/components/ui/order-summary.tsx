import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, text } from '@/theme';

import { Price } from './price';

/** 주문 요약. 합계 레이블은 "주문금액"이다 (기획서 19). 배달팁·쿠폰 줄은 없다 */
export function OrderSummary({ total }: { total: number }) {
  return (
    <View style={styles.box}>
      <Text style={styles.label}>주문금액</Text>
      <Price amount={total} size="lg" />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    padding: spacing[5],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    ...text.title,
    color: colors.ink,
  },
});
