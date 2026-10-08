import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, size, spacing } from '@/theme';

import { IconButton } from './icon-button';

type TopNavigationProps = {
  title?: string;
  /** 넘기면 왼쪽에 뒤로 버튼이 생긴다 */
  onBack?: () => void;
  /** 오른쪽 액션 (IconButton) */
  actions?: ReactNode;
  /** 스크롤 시 하단 구분선 */
  divider?: boolean;
};

/** 56px 상단 바: 왼쪽 뒤로, 가운데 제목, 오른쪽 액션 */
export function TopNavigation({ title, onBack, actions, divider = false }: TopNavigationProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top }, divider && styles.divider]}>
      <View style={styles.bar}>
        <View style={styles.side}>{onBack ? <IconButton icon="back" label="뒤로" onPress={onBack} /> : null}</View>
        {title ? (
          <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
            {title}
          </Text>
        ) : null}
        <View style={[styles.side, styles.right]}>{actions}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  bar: {
    height: size.topnav,
    paddingHorizontal: spacing[2],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  side: {
    minWidth: size.touch,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 1,
  },
  right: {
    justifyContent: 'flex-end',
  },
  title: {
    position: 'absolute',
    left: 64,
    right: 64,
    textAlign: 'center',
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '600',
    color: colors.ink,
  },
});
