import { Pressable, StyleSheet, Text, View } from 'react-native';

import { confirmedCopy } from '@/config/confirmed-copy';
import { draftCopy } from '@/config/draft-copy';
import { colors, font, radius, spacing, tabularNums, text } from '@/theme';
import { formatWon, formatCount } from '@/utils/format';

import { TextButton } from './button';
import { CravingRating } from './craving-rating';
import { FoodImage } from './food-image';
import { Icon } from './icon';
import { IconButton } from './icon-button';

const copy = draftCopy.review;

type Helpful = {
  count: number;
  active: boolean;
  /** 내 리뷰는 받은 수만 보여준다. 스스로 누를 수 없다 */
  readOnly: boolean;
  onToggle: (next: boolean) => void;
};

type ReviewCardProps = {
  /** 마스킹된 작성자 표시명만 받는다. 실명·이메일은 이 컴포넌트에 들어오지 않는다 */
  author: string;
  isMine: boolean;
  rating: number;
  date: string;
  edited: boolean;
  menus: string[];
  photoUri: string | null;
  hasPhoto: boolean;
  body: string;
  amount: number;
  helpful: Helpful;
  /** 오른쪽 위 ⋮ (내 리뷰는 수정·삭제, 남의 리뷰는 신고). 없으면 숨긴다 */
  more?: { label: string; onPress: () => void };
};

/**
 * 공개 리뷰 카드. 순서: 작성자 → 땡김도·작성일 → 메뉴 → 사진 → 본문 → 금액 · 주문 완료 → 도움돼요.
 * 사장님 답글과 소셜 요소는 없다. 맛이나 배달을 평가하는 말도 없다 (땡김도는 얼마나 먹고 싶었는지).
 */
export function ReviewCard({ author, isMine, rating, date, edited, menus, photoUri, hasPhoto, body, amount, helpful, more }: ReviewCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={styles.who}>
          <View style={styles.authorRow}>
            <Text style={styles.author}>{author}</Text>
            {isMine ? (
              <View style={styles.mine}>
                <Text style={styles.mineText}>{confirmedCopy.reviewMine}</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.sub}>
            <CravingRating value={rating} size={16} />
            <Text style={styles.date}>{`· ${date}${edited ? ` · ${copy.edited}` : ''}`}</Text>
          </View>
        </View>
        {more ? <IconButton icon="more" label={more.label} onPress={more.onPress} /> : null}
      </View>
      <Body menus={menus} photoUri={photoUri} hasPhoto={hasPhoto} body={body} />
      <Foot amount={amount} helpful={helpful} />
    </View>
  );
}

type MyReviewCardProps = {
  storeName: string;
  storeImageUri: string | null;
  rating: number;
  date: string;
  edited: boolean;
  menus: string[];
  photoUri: string | null;
  hasPhoto: boolean;
  body: string;
  amount: number;
  helpfulCount: number;
  /** 방금 등록·수정한 리뷰를 살짝 강조한다 */
  focused?: boolean;
  onStorePress: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

/** 마이 › 내가 쓴 리뷰 카드. 수정·삭제를 바로 보여준다. 30일이 지나도 카드는 평소 모양 그대로다 */
export function MyReviewCard({ storeName, storeImageUri, rating, date, edited, menus, photoUri, hasPhoto, body, amount, helpfulCount, focused = false, onStorePress, onEdit, onDelete }: MyReviewCardProps) {
  return (
    <View style={[styles.card, focused && styles.focused]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${storeName} 가게로 이동`} onPress={onStorePress} style={styles.store}>
        <FoodImage uri={storeImageUri} width={36} rounded={radius.xs} />
        <Text numberOfLines={1} style={styles.storeName}>
          {storeName}
        </Text>
        <Icon name="chevronRight" size={16} color={colors.inkTertiary} />
      </Pressable>
      <View style={styles.head}>
        <View style={styles.sub}>
          <CravingRating value={rating} size={16} />
          <Text style={styles.date}>{`· ${date}${edited ? ` · ${copy.edited}` : ''}`}</Text>
        </View>
        <View style={styles.manage}>
          <TextButton size="sm" onPress={onEdit}>
            수정
          </TextButton>
          <Pressable accessibilityRole="button" onPress={onDelete} hitSlop={6} style={styles.deleteButton}>
            <Text style={styles.deleteText}>삭제</Text>
          </Pressable>
        </View>
      </View>
      <Body menus={menus} photoUri={photoUri} hasPhoto={hasPhoto} body={body} />
      <Foot amount={amount} helpful={{ count: helpfulCount, active: false, readOnly: true, onToggle: () => undefined }} />
    </View>
  );
}

function Body({ menus, photoUri, hasPhoto, body }: { menus: string[]; photoUri: string | null; hasPhoto: boolean; body: string }) {
  return (
    <>
      {menus.length > 0 ? (
        <View style={styles.menus}>
          <Text style={styles.menusText}>{menus.join(' · ')}</Text>
        </View>
      ) : null}
      {/* 리뷰 사진은 1장. 사진이 있는데 주소를 못 구하면 중립 자리표시로 둔다 */}
      {hasPhoto ? <FoodImage uri={photoUri} alt="리뷰 사진" width={120} rounded={radius.md} /> : null}
      <Text style={styles.body}>{body}</Text>
    </>
  );
}

function Foot({ amount, helpful }: { amount: number; helpful: Helpful }) {
  const label = `${copy.orderCompleted}`;
  return (
    <View style={styles.foot}>
      <Text style={styles.amount}>{`${formatWon(amount)} · ${label}`}</Text>
      <HelpfulButton {...helpful} />
    </View>
  );
}

function HelpfulButton({ count, active, readOnly, onToggle }: Helpful) {
  const label = `${confirmedCopy.reviewHelpful}${count > 0 ? ` ${formatCount(count)}` : ''}`;
  if (readOnly) {
    return (
      <View accessibilityLabel={label} style={styles.helpfulStatic}>
        <Icon name="heart" size={16} color={colors.inkTertiary} />
        <Text style={styles.helpfulStaticText}>{label}</Text>
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={() => onToggle(!active)}
      style={({ pressed }) => [styles.helpful, active && styles.helpfulActive, pressed && !active && styles.helpfulPressed]}>
      <Icon name="heart" size={16} color={active ? colors.brandText : colors.inkSecondary} filled={active} />
      <Text style={[styles.helpfulText, active && styles.helpfulTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingVertical: spacing[5],
    gap: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  focused: {
    backgroundColor: colors.brandSoft,
    paddingHorizontal: spacing[3],
    marginHorizontal: -spacing[3],
    borderRadius: radius.md,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing[3],
  },
  who: {
    flex: 1,
    gap: 2,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  author: {
    ...text.label,
    color: colors.ink,
  },
  mine: {
    paddingHorizontal: 6,
    borderRadius: radius.xs,
    backgroundColor: colors.brandSoft,
  },
  mineText: {
    ...font('600'),
    fontSize: 11,
    lineHeight: 16,
    color: colors.brandText,
  },
  sub: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    flexShrink: 1,
  },
  date: {
    ...text.caption,
    color: colors.inkTertiary,
  },
  menus: {
    alignSelf: 'flex-start',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: radius.xs,
    backgroundColor: colors.surfaceMuted,
  },
  menusText: {
    ...font('500'),
    fontSize: 13,
    lineHeight: 18,
    color: colors.inkSecondary,
  },
  body: {
    ...text.body2,
    lineHeight: 22,
    color: colors.ink,
  },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[3],
  },
  amount: {
    ...text.body2,
    ...tabularNums,
    fontSize: 13,
    lineHeight: 18,
    color: colors.inkTertiary,
    flexShrink: 1,
  },
  helpful: {
    height: 32,
    paddingHorizontal: spacing[3],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  helpfulActive: {
    borderColor: colors.brand,
    backgroundColor: colors.brandSoft,
  },
  helpfulPressed: {
    backgroundColor: colors.surfaceMuted,
  },
  helpfulText: {
    ...font('600'),
    ...tabularNums,
    fontSize: 13,
    lineHeight: 18,
    color: colors.inkSecondary,
  },
  helpfulTextActive: {
    color: colors.brandText,
  },
  helpfulStatic: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  helpfulStaticText: {
    ...font('600'),
    ...tabularNums,
    fontSize: 13,
    lineHeight: 18,
    color: colors.inkTertiary,
  },
  store: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  storeName: {
    ...text.title,
    flexShrink: 1,
    color: colors.ink,
  },
  manage: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: -spacing[2],
  },
  deleteButton: {
    height: 32,
    paddingHorizontal: spacing[2],
    justifyContent: 'center',
  },
  deleteText: {
    ...font('600'),
    fontSize: 14,
    lineHeight: 20,
    color: colors.danger,
  },
});
