import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { colors, radius, spacing, tabularNums, text } from '@/theme';

const BANNER_WIDTH = 320;
const BANNER_GAP = spacing[2];

/**
 * 홈 배너 자리 (미결정 묶음1 #9). 문구·내용이 정해지지 않아서 빈 자리만 그린다.
 * 직접 밀어서 넘기고 자동으로 넘어가지 않는다 (FR-HOME-007).

 * 누르면 배너의 이동 대상(가게·메뉴·카테고리)으로 간다. 이동 방법은 화면이 정한다(onOpen).
 */
export function BannerCarousel({ count, onOpen }: { count: number; onOpen: (index: number) => void }) {
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
          <Pressable key={i} accessibilityRole="button" accessibilityLabel={`배너 ${i + 1} / ${count}`} onPress={() => onOpen(i)} style={styles.banner}>
            {i === 0 ? <Icon name="plate" size={24} color={colors.tomato200} /> : null}
          </Pressable>
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
