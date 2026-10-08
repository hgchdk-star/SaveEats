import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { colors, radius, spacing, tabularNums, text } from '@/theme';

const BANNER_WIDTH = 320;
const BANNER_GAP = spacing[2];

/**
 * 홈 배너 자리 (미결정 묶음1 #9). 문구·내용이 정해지지 않아서 빈 자리만 그린다.
 * 직접 밀어서 넘기고 자동으로 넘어가지 않는다 (FR-HOME-007).
 * 배너를 눌렀을 때의 이동은 배너 계약이 정해진 뒤에 연결한다.
 */
export function BannerCarousel({ count }: { count: number }) {
  const [index, setIndex] = useState(0);

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / (BANNER_WIDTH + BANNER_GAP));
    setIndex(Math.max(0, Math.min(count - 1, next)));
  };

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={BANNER_WIDTH + BANNER_GAP}
        onMomentumScrollEnd={onScrollEnd}
        contentContainerStyle={styles.row}>
        {Array.from({ length: count }, (_, i) => (
          <View key={i} accessibilityLabel={`배너 ${i + 1} / ${count}`} style={styles.banner}>
            {i === 0 ? <Icon name="plate" size={24} color={colors.tomato200} /> : null}
          </View>
        ))}
      </ScrollView>
      <Text style={styles.dots}>
        {index + 1} / {count}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: spacing[5],
    gap: BANNER_GAP,
  },
  banner: {
    width: BANNER_WIDTH,
    height: 112,
    borderRadius: radius.lg,
    backgroundColor: colors.foodPlaceholder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dots: {
    ...text.caption,
    ...tabularNums,
    color: colors.inkTertiary,
    textAlign: 'right',
    paddingHorizontal: spacing[5],
    paddingTop: spacing[2],
  },
});
