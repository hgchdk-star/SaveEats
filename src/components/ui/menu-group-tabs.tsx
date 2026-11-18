import { useEffect, useRef, type ComponentRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { colors, font, spacing, text } from '@/theme';

export type MenuGroupTabItem = { id: string; label: string };

type MenuGroupTabsProps = {
  items: readonly MenuGroupTabItem[];
  activeId: string;
  onChange: (id: string) => void;
};

/** 탭 한 줄 높이. 스크롤 위치 계산(고정 헤더 높이)에 쓴다 */
export const MENU_GROUP_TABS_HEIGHT = 44;

/**
 * 가게 상세 '메뉴' 탭 안의 메뉴 그룹 탭(가로 스크롤). 화면 위쪽 탭(메뉴 / SaveEats 리뷰 / 가게정보)과 다르다.
 * 활성 탭이 화면 밖이면 자동으로 보이는 위치까지 옮긴다. 새 디자인 값 없이 기존 토큰만 쓴다.
 */
export function MenuGroupTabs({ items, activeId, onChange }: MenuGroupTabsProps) {
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const layouts = useRef<Record<string, { x: number; width: number }>>({});
  const viewport = useRef(0);

  useEffect(() => {
    const box = layouts.current[activeId];
    if (!box || viewport.current === 0) return;
    // 활성 탭을 가운데쯤에 오게 한다(양 끝에서는 0 이하로 가지 않는다)
    const target = Math.max(0, box.x + box.width / 2 - viewport.current / 2);
    scrollRef.current?.scrollTo({ x: target, animated: true });
  }, [activeId]);

  return (
    <View accessibilityRole="tablist" style={styles.wrap} onLayout={(e: LayoutChangeEvent) => (viewport.current = e.nativeEvent.layout.width)}>
      <ScrollView ref={scrollRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {items.map((item) => {
          const selected = item.id === activeId;
          return (
            <Pressable
              key={item.id}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onLayout={(e) => (layouts.current[item.id] = { x: e.nativeEvent.layout.x, width: e.nativeEvent.layout.width })}
              onPress={() => onChange(item.id)}
              style={styles.tab}>
              <Text numberOfLines={1} style={[styles.label, selected && styles.labelSelected]}>
                {item.label}
              </Text>
              {selected ? <View style={styles.indicator} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    height: MENU_GROUP_TABS_HEIGHT,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  row: {
    paddingHorizontal: spacing[3],
    alignItems: 'stretch',
  },
  tab: {
    height: MENU_GROUP_TABS_HEIGHT - 1,
    paddingHorizontal: spacing[3],
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    ...text.label,
    fontSize: 14,
    color: colors.inkTertiary,
  },
  labelSelected: {
    ...font('700'),
    color: colors.brandText,
  },
  indicator: {
    position: 'absolute',
    left: spacing[3],
    right: spacing[3],
    bottom: 0,
    height: 2,
    backgroundColor: colors.brand,
  },
});
