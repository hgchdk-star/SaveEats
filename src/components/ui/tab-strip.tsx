import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, font, spacing, text } from '@/theme';

export type TabStripItem<Id extends string> = { id: Id; label: string };

type TabStripProps<Id extends string> = {
  items: readonly TabStripItem<Id>[];
  active: Id;
  onChange: (id: Id) => void;
};

/** 화면 안 탭(메뉴 / SaveEats 리뷰 / 가게정보). 하단 탭 바와 다르다 */
export function TabStrip<Id extends string>({ items, active, onChange }: TabStripProps<Id>) {
  return (
    <View accessibilityRole="tablist" style={styles.strip}>
      {items.map((item) => {
        const selected = item.id === active;
        return (
          <Pressable
            key={item.id}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(item.id)}
            style={styles.tab}>
            <Text style={[styles.label, selected && styles.labelSelected]}>{item.label}</Text>
            {selected ? <View style={styles.indicator} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  tab: {
    flex: 1,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    ...text.label,
    fontSize: 15,
    color: colors.inkTertiary,
  },
  labelSelected: {
    ...font('700'),
    color: colors.brandText,
  },
  indicator: {
    position: 'absolute',
    left: spacing[4],
    right: spacing[4],
    bottom: -1,
    height: 2,
    borderRadius: 2,
    backgroundColor: colors.brand,
  },
});
