import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, size } from '@/theme';

import { Icon, type IconName } from './icon';

export type BottomNavigationItem<Id extends string = string> = {
  id: Id;
  label: string;
  icon: IconName;
  /** 알림 점. 내역 탭의 "확인하지 않은 주문 상태 업데이트"에만 쓴다 */
  badge?: boolean;
};

type BottomNavigationProps<Id extends string> = {
  items: readonly BottomNavigationItem<Id>[];
  active: Id;
  onChange: (id: Id) => void;
};

/** 선택된 탭에서 채운 아이콘을 쓰는 것은 홈·찜뿐 */
const FILLED_WHEN_ACTIVE: readonly IconName[] = ['home', 'heart'];

/** 앱 하단 탭 바. 높이 size.bottomnav(64px) + 하단 안전 영역 */
export function BottomNavigation<Id extends string>({ items, active, onChange }: BottomNavigationProps<Id>) {
  const insets = useSafeAreaInsets();

  return (
    <View accessibilityRole="tablist" style={[styles.container, { paddingBottom: insets.bottom }]}>
      {items.map((item) => {
        const selected = item.id === active;
        return (
          <Pressable
            key={item.id}
            accessibilityRole="tab"
            accessibilityLabel={item.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(item.id)}
            style={styles.tab}>
            {({ pressed }) => (
              <>
                <View style={pressed && styles.iconPressed}>
                  <Icon
                    name={item.icon}
                    color={selected ? colors.tabSelectedIcon : colors.inkTertiary}
                    filled={selected && FILLED_WHEN_ACTIVE.includes(item.icon)}
                  />
                  {item.badge ? <View style={styles.dot} /> : null}
                </View>
                <Text style={[styles.label, selected && styles.labelSelected]}>{item.label}</Text>
              </>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  tab: {
    flex: 1,
    height: size.bottomnav,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  iconPressed: {
    transform: [{ scale: 0.92 }],
  },
  dot: {
    position: 'absolute',
    top: -2,
    right: -4,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: colors.surface,
    backgroundColor: colors.notificationDot,
  },
  label: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '500',
    color: colors.inkTertiary,
  },
  labelSelected: {
    fontWeight: '700',
    color: colors.tabSelectedLabel,
  },
});
