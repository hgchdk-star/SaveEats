import type { ReactElement, ReactNode } from 'react';
import { FlatList, StyleSheet, Text, View, type RefreshControlProps } from 'react-native';

import { colors, spacing, text } from '@/theme';

type StoreListProps<T> = {
  data: T[];
  keyExtractor: (item: T) => string;
  renderItem: (item: T) => ReactElement;
  /** 개수 줄 ("가게 3곳"). 목록 맨 위에 둔다 */
  countLabel: string;
  /** 개수 줄 위에 놓을 것 (검색 화면의 칩 줄 등) */
  header?: ReactNode;
  footer?: ReactNode;
  onEndReached?: () => void;
  refreshControl?: ReactElement<RefreshControlProps>;
};

/**
 * 개수 줄 + 가게 카드 목록. 검색 결과 · 카테고리 · 찜이 같이 쓴다. [새 컴포넌트 제안] StoreList.
 * 카드 한 장의 모양과 값은 renderItem이 정한다(StoreCardItem). 여기서는 개수 줄, 간격, 아래로 더 불러오기만 맡는다.
 */
export function StoreList<T>({ data, keyExtractor, renderItem, countLabel, header, footer, onEndReached, refreshControl }: StoreListProps<T>) {
  return (
    <FlatList
      data={data}
      keyExtractor={keyExtractor}
      renderItem={({ item }) => renderItem(item)}
      ItemSeparatorComponent={Separator}
      ListHeaderComponent={
        <View>
          {header}
          <Text style={styles.count}>{countLabel}</Text>
        </View>
      }
      ListFooterComponent={footer ? <View style={styles.footer}>{footer}</View> : null}
      contentContainerStyle={styles.content}
      onEndReachedThreshold={0.5}
      onEndReached={onEndReached}
      refreshControl={refreshControl}
      showsVerticalScrollIndicator={false}
    />
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing[5],
    paddingTop: spacing[4],
    paddingBottom: spacing[10],
  },
  count: {
    ...text.label,
    color: colors.inkSecondary,
    marginBottom: spacing[4],
  },
  separator: {
    height: spacing[8],
  },
  footer: {
    paddingTop: spacing[6],
    alignItems: 'center',
  },
});
