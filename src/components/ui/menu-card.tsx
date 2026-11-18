import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

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
  /** 카드 본문을 눌렀을 때: 메뉴 상세로 이동 */
  onPress: () => void;
  /**
   * 담기 버튼(카드 오른쪽 아래의 별도 버튼). 넘기지 않으면 버튼을 그리지 않는다.
   * 카드 본문과 형제 요소라서 누르면 상세로 이동하지 않는다. 사진이 없는 메뉴에서도 같은 자리에 있다.
   */
  onAdd?: () => void;
  /** 이 메뉴를 담는 중. 진행 표시를 보이고 다시 눌러도 동작하지 않는다 */
  adding?: boolean;
  /** 지금은 담을 수 없을 때(다른 메뉴를 담는 중, 영업 종료 등). 품절이면 자동으로 비활성이다 */
  addDisabled?: boolean;
  /** 접근성 이름. 예: "치킨 장바구니에 담기" */
  addLabel?: string;
};

/** 가게 상세의 메뉴 카드. 품절 메뉴는 눌러도 열리지 않고 흐리게 보인다 (FR-MENU-009) */
export function MenuCard({ name, description, imageUri, price, soldOut, inCartQuantity, onPress, onAdd, adding = false, addDisabled = false, addLabel }: MenuCardProps) {
  const addOff = soldOut || addDisabled || adding;
  return (
    <View style={styles.wrap}>
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
      {onAdd ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={addLabel ?? `${name} 장바구니에 담기`}
          accessibilityState={{ disabled: addOff, busy: adding }}
          disabled={addOff}
          hitSlop={6}
          onPress={onAdd}
          style={({ pressed }) => [styles.add, addOff && styles.addOff, pressed && styles.addPressed]}>
          {adding ? <ActivityIndicator size="small" color={colors.brand} /> : <Icon name="plus" size={20} color={addOff ? colors.inkDisabled : colors.brand} strokeWidth={2.25} />}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
  },
  /** 카드 오른쪽 아래. 시각 크기 36, 터치 여유(hitSlop 6)까지 48. 브랜드색(Tomato)과 기존 토큰만 쓴다 */
  add: {
    position: 'absolute',
    right: spacing[3],
    bottom: spacing[3],
    width: 36,
    height: 36,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addOff: {
    backgroundColor: colors.surfaceMuted,
  },
  addPressed: {
    backgroundColor: colors.surfaceMuted,
  },
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
