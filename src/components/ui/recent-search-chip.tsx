import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, font, radius, size, spacing } from '@/theme';

import { Icon } from './icon';

type RecentSearchChipProps = {
  term: string;
  /** ✕의 스크린리더용 이름 ("‘치킨’ 지우기") */
  removeLabel: string;
  onPress: () => void;
  onRemove: () => void;
};

/** 최근 검색어 칩. 누르면 그 검색어로 검색하고, ✕는 그 검색어만 지운다. [새 컴포넌트 제안] RecentSearchChip */
export function RecentSearchChip({ term, removeLabel, onPress, onRemove }: RecentSearchChipProps) {
  return (
    <View style={styles.chip}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${term} 검색`} onPress={onPress} style={styles.term}>
        <Text numberOfLines={1} style={styles.label}>
          {term}
        </Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={removeLabel} hitSlop={6} onPress={onRemove} style={styles.remove}>
        <Icon name="close" size={14} color={colors.inkTertiary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    height: size.chip,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    maxWidth: '100%',
  },
  term: {
    height: '100%',
    justifyContent: 'center',
    paddingLeft: 14,
    paddingRight: 4,
    flexShrink: 1,
  },
  label: {
    ...font('500'),
    fontSize: 14,
    lineHeight: 20,
    color: colors.ink,
  },
  remove: {
    width: 32,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingRight: 6,
    paddingLeft: spacing[1] / 2,
  },
});
