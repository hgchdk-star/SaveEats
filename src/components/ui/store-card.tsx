import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, font, radius, spacing, text } from '@/theme';
import { formatCount } from '@/utils/format';

import { CravingRating } from './craving-rating';
import { FavoriteButton } from './favorite-button';
import { FoodImage } from './food-image';
import { Price } from './price';

type StoreCardProps = {
  name: string;
  imageUri: string | null;
  category: string;
  /** 대표 메뉴(또는 검색에 걸린 메뉴). 없으면 줄을 숨긴다 */
  menu: { name: string; price: number } | null;
  /** 땡김도 평균. 리뷰가 0개면 null이고 점수·리뷰 수 줄을 모두 숨긴다 */
  rating: number | null;
  reviewCount: number;
  /** null이면 Guest라서 찜 여부를 모르는 상태. 하트는 꺼진 모양으로 보이고 누르면 로그인이 필요하다 */
  favorite: boolean | null;
  /** 영업 상태. false면 "준비 중" 배지를 사진 위에 단다 */
  isOpen: boolean;
  /** 가게 이름·메뉴 이름을 여러 줄로 보여준다 (홈 추천 가게) */
  wrapNames?: boolean;
  onPress: () => void;
  onToggleFavorite: (next: boolean) => void;
  closedLabel: string;
};

/**
 * 가게 카드. 배달비·최소주문금액·배달예상시간은 표시하지 않는다 (기획서 13·14).
 * 사진이 가장 크고, 사진 위에는 하트와 "준비 중" 배지 외에 글자를 얹지 않는다.
 */
export function StoreCard({
  name,
  imageUri,
  category,
  menu,
  rating,
  reviewCount,
  favorite,
  isOpen,
  wrapNames = false,
  onPress,
  onToggleFavorite,
  closedLabel,
}: StoreCardProps) {
  const hasReviews = rating !== null && reviewCount > 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${category}${isOpen ? '' : `, ${closedLabel}`}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View>
        <View style={!isOpen && styles.closedImage}>
          <FoodImage uri={imageUri} alt={name} ratio="16:9" rounded={radius.lg} />
        </View>
        <View style={styles.fav}>
          <FavoriteButton variant="overlay" active={favorite === true} onToggle={onToggleFavorite} />
        </View>
        {!isOpen ? (
          <View style={styles.closed}>
            <Text style={styles.closedText}>{closedLabel}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.body}>
        <View style={[styles.row, wrapNames && styles.rowTop]}>
          <Text numberOfLines={wrapNames ? undefined : 1} style={styles.name}>
            {name}
          </Text>
          {hasReviews ? (
            <View style={[styles.score, wrapNames && styles.scoreWrap]}>
              <CravingRating compact value={rating} />
              <Text style={styles.reviewCount}>· SaveEats 리뷰 {formatCount(reviewCount)}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.meta}>{category}</Text>
        {menu ? (
          <View style={styles.menu}>
            <Text numberOfLines={wrapNames ? undefined : 1} style={styles.menuName}>
              {menu.name}
            </Text>
            <Price amount={menu.price} size="sm" />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing[3],
    borderRadius: radius.lg,
  },
  pressed: {
    transform: [{ scale: 0.99 }],
  },
  closedImage: {
    opacity: 0.5,
  },
  fav: {
    position: 'absolute',
    top: spacing[1],
    right: spacing[1],
  },
  closed: {
    position: 'absolute',
    left: spacing[3],
    bottom: spacing[3],
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: radius.xs,
    backgroundColor: colors.ink,
  },
  closedText: {
    ...font('600'),
    fontSize: 12,
    lineHeight: 16,
    color: colors.surface,
  },
  body: {
    gap: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[2],
  },
  rowTop: {
    alignItems: 'flex-start',
  },
  name: {
    ...text.title,
    flex: 1,
    color: colors.ink,
  },
  score: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
  },
  scoreWrap: {
    marginTop: 3,
  },
  reviewCount: {
    ...text.body2,
    fontSize: 13,
    lineHeight: 18,
    color: colors.inkTertiary,
  },
  meta: {
    ...text.body2,
    fontSize: 13,
    lineHeight: 18,
    color: colors.inkTertiary,
  },
  menu: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing[2],
    marginTop: 2,
  },
  menuName: {
    ...text.body2,
    flexShrink: 1,
    color: colors.inkSecondary,
  },
});
