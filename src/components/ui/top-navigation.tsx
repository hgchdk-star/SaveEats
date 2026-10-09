import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, size, spacing, text } from '@/theme';

import { IconButton } from './icon-button';

type TopNavigationProps = {
  title?: string;
  /** 넘기면 왼쪽에 뒤로 버튼이 생긴다 */
  onBack?: () => void;
  /** 오른쪽 액션 (IconButton, TextButton) */
  actions?: ReactNode;
  /** 스크롤 시 하단 구분선 */
  divider?: boolean;
  /**
   * overlay: 음식 사진 위에 겹친다 (가게·메뉴 상세). 위치는 화면 맨 위 absolute.
   * solid가 true가 되면(스크롤을 내린 뒤) 흰 바탕과 제목이 나타난다.
   */
  overlay?: { solid: boolean };
};

/** 56px 상단 바: 왼쪽 뒤로, 가운데 제목, 오른쪽 액션 */
export function TopNavigation({ title, onBack, actions, divider = false, overlay }: TopNavigationProps) {
  const insets = useSafeAreaInsets();
  const solid = !overlay || overlay.solid;
  const showTitle = !!title && solid;

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top },
        overlay && styles.overlay,
        !solid && styles.clear,
        (divider || (overlay && solid)) && styles.divider,
      ]}>
      <View style={styles.bar}>
        <View style={styles.side}>
          {onBack ? <BackButton onPress={onBack} floating={!solid} /> : null}
        </View>
        {showTitle ? (
          <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
            {title}
          </Text>
        ) : null}
        <View style={[styles.side, styles.right]}>{actions}</View>
      </View>
    </View>
  );
}

function BackButton({ onPress, floating }: { onPress: () => void; floating: boolean }) {
  return <IconButton icon="back" label="뒤로" onPress={onPress} variant={floating ? 'overlay' : 'plain'} />;
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 6,
  },
  clear: {
    backgroundColor: 'transparent',
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
    ...text.title,
    position: 'absolute',
    left: 64,
    right: 64,
    textAlign: 'center',
    fontSize: 17,
    color: colors.ink,
  },
});
