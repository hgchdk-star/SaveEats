import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, radius, size, spacing, text } from '@/theme';

import { Icon } from './icon';

type SearchBarButtonProps = {
  /** 기획서 11.4 확정 문구: "오늘은 뭐가 먹고 싶으세요?" */
  placeholder: string;
  onPress: () => void;
};

/**
 * 검색창 모양의 버튼. 홈에서는 입력하지 않고 누르면 검색 탭으로 간다 (FR-SRCH-001).
 * 입력할 수 있는 검색창은 검색 화면을 만들 때 추가한다.
 */
export function SearchBarButton({ placeholder, onPress }: SearchBarButtonProps) {
  return (
    <Pressable accessibilityRole="search" accessibilityLabel={placeholder} onPress={onPress} style={styles.bar}>
      <Icon name="search" size={20} color={colors.inkSecondary} />
      <Text numberOfLines={1} style={styles.placeholder}>
        {placeholder}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: size.control,
    paddingLeft: spacing[4],
    paddingRight: spacing[2],
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  placeholder: {
    ...text.body1,
    flex: 1,
    color: colors.inkTertiary,
  },
});
