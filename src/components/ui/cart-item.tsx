import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, font, spacing, text } from '@/theme';
import { formatWon } from '@/utils/format';

import { FoodImage } from './food-image';
import { Icon } from './icon';
import { Price } from './price';
import { QuantitySelector } from './quantity-selector';

type CartItemProps = {
  name: string;
  optionNames: string[];
  imageUri: string | null;
  quantity: number;
  /** 한 개 가격(옵션 포함). 줄 가격은 여기에 수량을 곱해 보여준다 */
  unitPrice: number;
  /** 품절이면 수량 조절을 막고 흐리게 보인다 */
  soldOut?: boolean;
  /** 항목 아래 빨간 한 줄. 막힌 이유를 문구로 알린다 */
  error?: string;
  /** 가격이 바뀐 경우: 사용자가 확인한 줄 가격 → 현재 줄 가격 */
  priceChange?: { from: number; to: number; label: string };
  onChangeQuantity: (next: number) => void;
  onRemove: () => void;
};

/** 장바구니 항목. 수량 1에서는 − 대신 휴지통이 보이고, 0으로 줄여서 지워지지 않는다 */
export function CartItem({
  name,
  optionNames,
  imageUri,
  quantity,
  unitPrice,
  soldOut = false,
  error,
  priceChange,
  onChangeQuantity,
  onRemove,
}: CartItemProps) {
  return (
    <View style={styles.item}>
      <View style={styles.row}>
        <FoodImage uri={imageUri} alt={name} width={64} soldOut={soldOut} rounded={12} />
        <View style={styles.body}>
          <View style={styles.top}>
            <Text style={[styles.name, soldOut && styles.muted]}>{name}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`${name} 삭제`} hitSlop={8} onPress={onRemove} style={styles.remove}>
              <Icon name="close" size={16} color={colors.inkTertiary} />
            </Pressable>
          </View>
          {optionNames.length > 0 ? <Text style={styles.options}>{optionNames.join(' · ')}</Text> : null}
          {error ? (
            <View accessibilityRole="alert" style={styles.error}>
              <Icon name="alert" size={16} color={colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
          <View style={styles.bottom}>
            <Price amount={unitPrice * quantity} muted={soldOut} />
            <QuantitySelector size="sm" value={quantity} disabled={soldOut} onChange={onChangeQuantity} onRemove={onRemove} />
          </View>
        </View>
      </View>
      {priceChange ? (
        <View style={styles.priceChange}>
          <Text style={styles.priceChangeText}>{priceChange.label}</Text>
          <Text style={[styles.priceChangeText, styles.strike]}>{formatWon(priceChange.from)}</Text>
          <Text style={styles.priceChangeText}>→</Text>
          <Text style={[styles.priceChangeText, styles.priceNow]}>{formatWon(priceChange.to)}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  item: {
    paddingVertical: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  row: {
    flexDirection: 'row',
    gap: spacing[3],
  },
  body: {
    flex: 1,
    gap: 2,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing[2],
  },
  name: {
    ...text.title,
    flex: 1,
    color: colors.ink,
  },
  muted: {
    color: colors.inkDisabled,
  },
  remove: {
    width: 32,
    height: 32,
    marginTop: -4,
    marginRight: -8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  options: {
    ...text.body2,
    fontSize: 13,
    lineHeight: 18,
    color: colors.inkTertiary,
  },
  error: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  errorText: {
    ...text.caption,
    flex: 1,
    color: colors.danger,
  },
  bottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing[2],
  },
  priceChange: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[3],
    marginLeft: 76,
  },
  priceChangeText: {
    ...text.body2,
    fontSize: 13,
    lineHeight: 18,
    color: colors.inkSecondary,
  },
  strike: {
    textDecorationLine: 'line-through',
    color: colors.inkTertiary,
  },
  priceNow: {
    ...font('600'),
    color: colors.ink,
  },
});
