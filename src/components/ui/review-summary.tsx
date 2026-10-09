import { Pressable, StyleSheet, Text, View } from 'react-native';

import { confirmedCopy } from '@/config/confirmed-copy';
import { draftCopy } from '@/config/draft-copy';
import { colors, font, size, spacing, tabularNums, text } from '@/theme';
import { formatCount } from '@/utils/format';

import { CravingRating } from './craving-rating';
import { FilterChip } from './filter-chip';
import { Icon } from './icon';

type ReviewSummaryProps = {
  /** 땡김도 평균. 리뷰가 0개면 null이고 점수·별을 만들지 않는다 (FR-REV-025) */
  average: number | null;
  count: number;
  photoOnly: boolean;
  onTogglePhotoOnly: () => void;
  sortLabel: string;
  onOpenSort: () => void;
};

/**
 * 가게·메뉴 어디서나 제목은 "SaveEats 리뷰" 하나. 범위(가게/메뉴)는 들어온 화면이 정하고 문구로 설명하지 않는다.
 * 평균에는 항상 "땡김도"를 붙인다.
 */
export function ReviewSummary({ average, count, photoOnly, onTogglePhotoOnly, sortLabel, onOpenSort }: ReviewSummaryProps) {
  const hasReviews = count > 0 && average !== null;
  return (
    <View style={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {confirmedCopy.reviewTitle}
      </Text>
      {hasReviews ? (
        <View style={styles.score}>
          <Text style={styles.scoreLabel}>{draftCopy.review.averageLabel}</Text>
          <Text style={styles.average}>{average.toFixed(1)}</Text>
          <CravingRating value={average} size={16} />
        </View>
      ) : null}
      <Text style={styles.count}>{hasReviews ? draftCopy.review.countLabel(formatCount(count)) : draftCopy.review.noReviews}</Text>
      <View style={styles.bar}>
        <FilterChip label={draftCopy.review.photoFilter} selected={photoOnly} onPress={onTogglePhotoOnly} />
        <Pressable accessibilityRole="button" accessibilityLabel={`정렬: ${sortLabel}`} onPress={onOpenSort} style={styles.sort}>
          <Text style={styles.sortLabel}>{sortLabel}</Text>
          <Icon name="chevronDown" size={16} color={colors.ink} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing[2],
    paddingBottom: spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  title: {
    ...text.h2,
    color: colors.ink,
    marginBottom: spacing[2],
  },
  score: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  scoreLabel: {
    ...text.title,
    color: colors.ink,
  },
  average: {
    ...text.h1,
    ...tabularNums,
    color: colors.ink,
  },
  count: {
    ...text.body2,
    ...tabularNums,
    color: colors.inkSecondary,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sort: {
    height: size.touch,
    paddingHorizontal: spacing[1],
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  sortLabel: {
    ...font('600'),
    fontSize: 14,
    lineHeight: 20,
    color: colors.ink,
  },
});
