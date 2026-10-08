import { StyleSheet, Text } from 'react-native';

import { colors, tabularNums, text } from '@/theme';
import { formatWon } from '@/utils/format';

type PriceProps = {
  amount: number;
  size?: 'sm' | 'md' | 'lg';
  /** 품절·비활성 항목의 흐린 표시 */
  muted?: boolean;
};

const STYLE = { sm: text.priceSm, md: text.priceMd, lg: text.priceLg } as const;

/** 가격은 항상 "27,000원", tabular 숫자, ink 색 */
export function Price({ amount, size = 'md', muted = false }: PriceProps) {
  return <Text style={[STYLE[size], styles.price, muted && styles.muted]}>{formatWon(amount)}</Text>;
}

const styles = StyleSheet.create({
  price: {
    ...tabularNums,
    color: colors.ink,
  },
  muted: {
    color: colors.inkDisabled,
  },
});
