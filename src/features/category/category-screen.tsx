import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { SecondaryButton } from '@/components/ui/button';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback-states';
import { FoodCategoryChip } from '@/components/ui/food-category-chip';
import { Screen } from '@/components/ui/screen';
import { StoreList } from '@/components/ui/store-list';
import { TopNavigation } from '@/components/ui/top-navigation';
import { draftCopy } from '@/config/draft-copy';
import { LIMITS } from '@/config/limits';
import { StoreCardItem } from '@/features/store/store-card-item';
import { usePagedStores } from '@/features/store/use-paged-stores';
import { useAsync } from '@/hooks/use-async';
import { catalogRepository } from '@/services';
import { useSession } from '@/services/session';
import { colors, spacing, text } from '@/theme';

const ALL = 'all';
const copy = draftCopy.category;

/**
 * 카테고리 가게 목록 (㉓). 칩은 한 개만 선택되고 '전체'도 하나의 선택이다 (FR-CAT-004 · 005).
 * 칩을 바꾸면 목록만 다시 불러오고 맨 위로 간다. 칩 줄은 목록이 실패해도 그대로 쓴다.
 * 카테고리는 데이터로 관리한다(FR-CAT-002). 가게가 없는 카테고리도 칩은 보이고 "아직 ○○ 가게가 없어요"가 나온다.
 */
export function CategoryScreen({ code }: { code: string }) {
  const { isMember } = useSession();
  const categories = useAsync('category:list', () => catalogRepository.listCategories());

  const selected = categories.status === 'ok' ? categories.data.find((c) => c.code === code) : undefined;
  // 알 수 없는 code는 전체로 본다
  const selectedCode = selected ? selected.code : ALL;
  const categoryId = selected ? selected.id : null;

  const stores = usePagedStores(categories.status === 'ok' ? `category:${selectedCode}:${isMember}` : null, (cursor) =>
    catalogRepository.listStores({ categoryId, cursor, pageSize: LIMITS.storeListPageSize }),
  );

  const title = selected ? selected.name : copy.all;
  const top = <TopNavigation title={title} onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} divider />;

  if (categories.status === 'error') {
    // 카테고리 목록 자체를 못 받으면 칩도 목록도 만들 수 없다
    return (
      <Screen top={top}>
        <ErrorState title={copy.errorTitle} onRetry={categories.reload} />
      </Screen>
    );
  }

  const chips =
    categories.status === 'ok' ? (
      <View style={styles.chipBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="radiogroup" contentContainerStyle={styles.chipRow}>
          <FoodCategoryChip label="전체" imageUri={null} selected={selectedCode === ALL} onPress={() => router.setParams({ code: ALL })} />
          {categories.data.map((c) => (
            <FoodCategoryChip key={c.id} label={c.name} imageUri={null} selected={selectedCode === c.code} onPress={() => router.setParams({ code: c.code })} />
          ))}
        </ScrollView>
      </View>
    ) : (
      <View accessibilityLabel="불러오는 중" style={[styles.chipBar, styles.chipRow]}>
        {[72, 64, 64, 72, 64].map((w, i) => (
          <Skeleton key={i} width={w} height={36} radius={18} />
        ))}
      </View>
    );

  return (
    <Screen top={top}>
      {chips}
      {stores.status === 'idle' || stores.status === 'loading' ? (
        <View accessibilityLabel="불러오는 중" style={styles.skeletons}>
          {[0, 1].map((i) => (
            <View key={i} style={styles.skelCard}>
              <View style={styles.skelImage} />
              <Skeleton width="55%" height={20} />
              <Skeleton width="80%" height={14} />
            </View>
          ))}
        </View>
      ) : stores.status === 'error' ? (
        // 목록만 실패한 것이다. 칩은 그대로 쓸 수 있다
        <ErrorState title={copy.errorTitle} onRetry={stores.reload} />
      ) : stores.items.length === 0 ? (
        <EmptyState icon="plate" title={copy.emptyTitle(title)} description={copy.emptyDesc} />
      ) : (
        <StoreList
          data={stores.items}
          keyExtractor={(store) => store.id}
          countLabel={copy.resultCount(stores.items.length)}
          onEndReached={stores.loadMore}
          renderItem={(store) => <StoreCardItem store={store} />}
          footer={
            stores.more === 'error' ? (
              <View style={styles.footerRow}>
                <Text style={styles.footerText}>{draftCopy.search.moreFailed}</Text>
                <SecondaryButton size="sm" icon="refresh" onPress={stores.loadMore}>
                  {draftCopy.search.moreRetry}
                </SecondaryButton>
              </View>
            ) : null
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chipBar: {
    paddingVertical: spacing[3],
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  chipRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing[5],
    gap: spacing[2],
  },
  skeletons: {
    padding: spacing[5],
    gap: spacing[8],
  },
  skelCard: {
    gap: spacing[2],
  },
  skelImage: {
    aspectRatio: 16 / 9,
    borderRadius: 16,
    backgroundColor: colors.foodPlaceholder,
    marginBottom: spacing[1],
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  footerText: {
    ...text.body2,
    color: colors.inkTertiary,
  },
});
