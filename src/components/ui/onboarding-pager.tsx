import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import { draftCopy } from '@/config/draft-copy';
import { colors, font, radius, shadow, spacing, text } from '@/theme';

import { FoodImage } from './food-image';
import { Icon } from './icon';
import { Price } from './price';

export type OnboardingPage = { key: string; title: string; desc: string; art: 'browse' | 'deliver' | 'start' };

type OnboardingPagerProps = {
  pages: OnboardingPage[];
  page: number;
  onPageChange: (next: number) => void;
};

const copy = draftCopy.start;

/**
 * 온보딩 · SaveEats 이용 방법이 같이 쓰는 페이지 넘김. 그림 · 제목 · 설명 · 점. 좌우로 밀어도, 점을 눌러도 넘어간다.
 * [새 컴포넌트 제안] OnboardingPager. 버튼(다음·시작하기·건너뛰기)은 화면 쪽 CTA 바가 맡는다.
 * 그림은 DS의 음식 사진 자리 · 아이콘 · 가격을 조합한 예시 그림이다. 사진 파일이 없어 사진 자리는 중립 Placeholder로 보인다.
 */
export function OnboardingPager({ pages, page, onPageChange }: OnboardingPagerProps) {
  const { width } = useWindowDimensions();
  const scroll = useRef<ScrollView>(null);
  const current = useRef(page);

  // 버튼으로 페이지가 바뀌면 그 위치로 옮긴다
  useEffect(() => {
    current.current = page;
    scroll.current?.scrollTo({ x: page * width, animated: true });
  }, [page, width]);

  const onEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    if (next !== current.current && next >= 0 && next < pages.length) {
      current.current = next;
      onPageChange(next);
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView ref={scroll} horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={onEnd} style={styles.scroll}>
        {pages.map((p) => (
          <View key={p.key} style={[styles.slide, { width }]}>
            <View style={styles.stage}>
              <Art kind={p.art} />
            </View>
            <View style={styles.text}>
              <Text accessibilityRole="header" style={styles.title}>
                {p.title}
              </Text>
              <Text style={styles.desc}>{p.desc}</Text>
            </View>
          </View>
        ))}
      </ScrollView>
      <View accessibilityRole="tablist" style={styles.dots}>
        {pages.map((p, i) => (
          <Pressable
            key={p.key}
            accessibilityRole="tab"
            accessibilityLabel={copy.pageOf(i + 1, pages.length)}
            accessibilityState={{ selected: i === page }}
            hitSlop={8}
            onPress={() => onPageChange(i)}
            style={[styles.dot, i === page && styles.dotOn]}
          />
        ))}
      </View>
    </View>
  );
}

function Art({ kind }: { kind: OnboardingPage['art'] }) {
  if (kind === 'browse') {
    return (
      <View accessibilityElementsHidden style={styles.grid}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={styles.gridCell}>
            <FoodImage uri={null} width={112} />
          </View>
        ))}
      </View>
    );
  }
  if (kind === 'deliver') {
    return (
      <View accessibilityElementsHidden style={styles.deliver}>
        <View style={styles.dish}>
          <FoodImage uri={null} width={104} />
          <Text style={styles.cross}>{copy.artNoFood}</Text>
        </View>
        <Icon name="chevronRight" size={32} color={colors.brand} />
        <View style={styles.bank}>
          <View style={styles.bankIcon}>
            <Icon name="bank" size={32} color={colors.brandText} />
          </View>
          <Price amount={30500} size="md" />
        </View>
      </View>
    );
  }
  return (
    <View accessibilityElementsHidden style={styles.start}>
      <View style={styles.ctaMock}>
        <Text style={styles.ctaMockText}>{copy.artOrder}</Text>
      </View>
      <Icon name="chevronDown" size={32} color={colors.brand} />
      <View style={styles.bankChip}>
        <Icon name="bank" size={20} color={colors.brandText} />
        <Text style={styles.bankChipText}>{copy.artAccount}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  slide: { paddingHorizontal: spacing[5], paddingTop: spacing[2] },
  stage: {
    height: 340,
    borderRadius: radius.xl,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { paddingTop: spacing[8], paddingHorizontal: spacing[1] },
  title: { ...text.display, fontSize: 26, lineHeight: 36, color: colors.ink },
  desc: { ...text.body1, color: colors.inkSecondary, marginTop: spacing[3] },
  dots: { flexDirection: 'row', gap: spacing[2], paddingHorizontal: spacing[5], paddingVertical: spacing[4] },
  dot: { width: 8, height: 8, borderRadius: radius.full, backgroundColor: colors.lineStrong },
  dotOn: { width: 24, backgroundColor: colors.brand },
  grid: { width: 236, flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3] },
  gridCell: { width: 112 },
  deliver: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  dish: { alignItems: 'center', gap: spacing[2], opacity: 0.7 },
  cross: { ...font('600'), fontSize: 12, lineHeight: 16, color: colors.inkTertiary },
  bank: { alignItems: 'center', gap: spacing[2], padding: spacing[4], borderRadius: radius.lg, backgroundColor: colors.surface, boxShadow: shadow.float },
  bankIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  start: { alignItems: 'center', gap: spacing[3] },
  ctaMock: { height: 56, paddingHorizontal: spacing[5], borderRadius: radius.md, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  ctaMockText: { ...font('700'), fontSize: 17, color: colors.onBrand },
  bankChip: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], height: 44, paddingHorizontal: spacing[4], borderRadius: radius.full, backgroundColor: colors.surface, boxShadow: shadow.float },
  bankChipText: { ...font('700'), fontSize: 15, color: colors.ink },
});
