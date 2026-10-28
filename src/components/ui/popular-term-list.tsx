import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, font, spacing, text } from '@/theme';

type PopularTermListProps = {
  terms: { id: string; term: string }[];
  onPress: (term: string) => void;
};

/**
 * 인기 검색어 2열 목록. [새 컴포넌트 제안] PopularTermList.
 * 앞의 숫자는 보여주는 순서일 뿐이다. 검색 횟수나 순위 변동(▲▼, NEW)은 만들지 않는다 (FR-HOME-005, FR-DATA-024).
 */
export function PopularTermList({ terms, onPress }: PopularTermListProps) {
  // 왼쪽 열을 먼저 채운다 (1~4 / 5~8)
  const half = Math.ceil(terms.length / 2);
  const columns = [terms.slice(0, half), terms.slice(half)];
  return (
    <View style={styles.row}>
      {columns.map((column, c) => (
        <View key={c} style={styles.column}>
          {column.map((item, i) => (
            <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${item.term} 검색`} onPress={() => onPress(item.term)} style={({ pressed }) => [styles.item, pressed && styles.pressed]}>
              <Text style={styles.rank}>{c * half + i + 1}</Text>
              <Text numberOfLines={1} style={styles.term}>
                {item.term}
              </Text>
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing[4],
  },
  column: {
    flex: 1,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: 44,
  },
  pressed: {
    backgroundColor: colors.surfaceMuted,
  },
  rank: {
    ...font('700'),
    width: 16,
    fontSize: 15,
    textAlign: 'center',
    color: colors.brandText,
  },
  term: {
    ...text.body1,
    flex: 1,
    color: colors.ink,
  },
});
