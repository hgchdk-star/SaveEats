import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, font, radius, spacing, text } from '@/theme';

import { FoodImage } from './food-image';
import { Icon } from './icon';
import { Price } from './price';

type MenuCardProps = {
  name: string;
  description: string | null;
  imageUri: string | null;
  price: number;
  soldOut: boolean;
  /** 이 메뉴가 장바구니에 담긴 수량. 0이면 표시하지 않는다 */
  inCartQuantity: number;
  onPress: () => void;
};

/** 가게 상세의 메뉴 카드. 품절 메뉴는 눌러도 열리지 않고 흐리게 보인다 (FR-MENU-009) */
export function MenuCard({ name, description, imageUri, price, soldOut, inCartQuantity, onPress }: MenuCardProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={soldOut ? `${name}, 품절` : name}
      accessibilityState={{ disabled: soldOut }}
      disabled={soldOut}
      onPress={onPress}
      style={({ pressed }) => [styles.card, inCartQuantity > 0 && styles.selected, pressed && styles.pressed]}>
      <View style={styles.text}>
        <Text style={[styles.name, soldOut && styles.soldOutText]}>{name}</Text>
        {description ? (
          <Text numberOfLines={2} style={[styles.description, soldOut && styles.soldOutText]}>
            {description}
          </Text>
        ) : null}
        <Price amount={price} muted={soldOut} />
        {inCartQuantity > 0 ? (
          <View style={styles.inCart}>
            <Icon name="check" size={16} color={colors.brandText} strokeWidth={2.25} />
            <Text style={styles.inCartText}>장바구니에 {inCartQuantity}개</Text>
          </View>
        ) : null}
      </View>
      <FoodImage uri={imageUri} alt={name} width={104} soldOut={soldOut} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[4],
    padding: spacing[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  selected: {
    borderColor: colors.brand,
  },
  pressed: {
    backgroundColor: colors.surfaceMuted,
  },
  text: {
    flex: 1,
    gap: spacing[1],
  },
  name: {
    ...text.title,
    color: colors.ink,
  },
  description: {
    ...text.body2,
    color: colors.inkSecondary,
    marginBottom: spacing[1],
  },
  soldOutText: {
    color: colors.inkDisabled,
  },
  inCart: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: spacing[1],
  },
  inCartText: {
    ...font('600'),
    fontSize: 12,
    lineHeight: 16,
    color: colors.brandText,
  },
});
