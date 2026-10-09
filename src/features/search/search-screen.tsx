import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SecondaryButton, TextButton } from '@/components/ui/button';
import { EmptyState, ErrorState, SectionError, Skeleton } from '@/components/ui/feedback-states';
import { FoodCategoryChip } from '@/components/ui/food-category-chip';
import { PopularTermList } from '@/components/ui/popular-term-list';
import { RecentSearchChip } from '@/components/ui/recent-search-chip';
import { Screen } from '@/components/ui/screen';
import { SearchBar } from '@/components/ui/search-bar';
import { StoreList } from '@/components/ui/store-list';
import { confirmedCopy } from '@/config/confirmed-copy';
import { draftCopy } from '@/config/draft-copy';
import { LIMITS } from '@/config/limits';
import { goCategoryStoreList } from '@/features/order/flow-routes';
import { StoreCardItem } from '@/features/store/store-card-item';
import { usePagedStores } from '@/features/store/use-paged-stores';
import { useAsync } from '@/hooks/use-async';
import { catalogRepository, searchService } from '@/services';
import { useSession } from '@/services/session';
import { colors, spacing, text } from '@/theme';

import { loadRecentSearches, saveRecentSearches } from './recent-search-storage';
import { addRecentSearch, isSearchable, normalizeQuery, removeRecentSearch } from './search-model';

const copy = draftCopy.search;

/**
 * 검색 (㉑ 검색 전 · ㉒ 검색 결과). 홈 검색창과 검색 탭은 같은 화면이다 (FR-SRCH-001). Guest도 쓴다.
 *
 * - 입력 300ms 뒤에 검색하고, 엔터는 바로 검색한다. 늦게 온 이전 응답은 버린다(usePagedStores)
 * - 검색 대상은 가게 이름 · 메뉴 이름 · 카테고리. 결과는 가게 카드 목록뿐이다
 * - 최근 검색어는 "검색을 확정했을 때"(엔터 · 칩 · 결과 가게 열기)만 저장한다. 입력만 해서는 저장하지 않는다
 * - 검색 실패와 결과 없음은 다른 화면이다. 실패하면 입력한 검색어를 유지하고 같은 검색어로 다시 시도한다
 */
export function SearchScreen() {
  const insets = useSafeAreaInsets();
  const { isMember } = useSession();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [recent, setRecent] = useState<string[]>([]);

  const typed = normalizeQuery(query);
  const searchable = isSearchable(typed);
  // 비우거나 공백뿐이면 검색 전 화면으로 돌아간다. 이때는 이전 검색어를 쓰지 않는다
  const active = searchable ? debounced : '';

  useEffect(() => {
    if (!searchable) return;
    const timer = setTimeout(() => setDebounced(typed), LIMITS.searchDebounceMs);
    return () => clearTimeout(timer);
  }, [typed, searchable]);

  useEffect(() => {
    let alive = true;
    void loadRecentSearches().then((list) => {
      if (alive) setRecent(list);
    });
    return () => {
      alive = false;
    };
  }, []);

  const results = usePagedStores(active ? `search:${active}:${isMember}` : null, (cursor) =>
    searchService.searchStores({ query: active, cursor, pageSize: LIMITS.storeListPageSize }),
  );

  const updateRecent = (next: string[]) => {
    setRecent(next);
    void saveRecentSearches(next);
  };
  const remember = (term: string) => updateRecent(addRecentSearch(recent, term));

  // 엔터 · 칩: 기다리지 않고 바로 검색하고 최근 검색어로 남긴다
  const submit = (value: string) => {
    const term = normalizeQuery(value);
    if (!isSearchable(term)) return;
    setQuery(term);
    setDebounced(term);
    remember(term);
  };

  const clear = () => {
    setQuery('');
    setDebounced('');
  };

  const top = (
    <View style={[styles.top, { paddingTop: insets.top + spacing[2] }]}>
      <SearchBar
        value={query}
        placeholder={confirmedCopy.searchPlaceholder}
        onChangeText={setQuery}
        onSubmit={() => submit(query)}
        onClear={clear}
        clearLabel={copy.clear}
        maxLength={LIMITS.searchMaxLength}
      />
    </View>
  );

  if (!searchable) {
    return (
      <Screen top={top}>
        <InitialSections recent={recent} onPick={submit} onRemove={(term) => updateRecent(removeRecentSearch(recent, term))} onClearAll={() => updateRecent([])} />
      </Screen>
    );
  }

  // 입력 후 300ms가 지나기 전이거나 응답을 기다리는 동안은 "검색하는 중"
  const waiting = debounced !== typed || results.status === 'loading' || results.status === 'idle';

  return (
    <Screen top={top}>
      {waiting ? (
        <View accessibilityLabel={copy.searching} style={styles.skeletons}>
          <ResultSkeleton />
          <ResultSkeleton />
        </View>
      ) : results.status === 'error' ? (
        <ErrorState title={copy.errorTitle} onRetry={results.reload} />
      ) : results.items.length === 0 ? (
        <EmptyState icon="search" title={copy.emptyTitle(active)} description={copy.emptyDesc} />
      ) : (
        <StoreList
          data={results.items}
          keyExtractor={(store) => store.id}
          countLabel={results.hasMore ? copy.resultCountMore(results.items.length) : copy.resultCount(results.items.length)}
          onEndReached={results.loadMore}
          renderItem={(store) => <StoreCardItem store={store} matchingMenu={store.matchingMenu} beforeOpen={() => remember(active)} />}
          footer={
            results.more === 'loading' ? (
              <Text style={styles.footerText}>{copy.searching}</Text>
            ) : results.more === 'error' ? (
              // 자동으로 다시 시도하지 않는다. 기존 결과는 그대로 두고 사용자가 같은 위치부터 다시 요청한다
              <View style={styles.footerRow}>
                <Text style={styles.footerText}>{copy.moreFailed}</Text>
                <SecondaryButton size="sm" icon="refresh" onPress={results.loadMore}>
                  {copy.moreRetry}
                </SecondaryButton>
              </View>
            ) : null
          }
        />
      )}
    </Screen>
  );
}

function ResultSkeleton() {
  return (
    <View style={styles.skelCard}>
      <View style={styles.skelImage} />
      <Skeleton width="55%" height={20} />
      <Skeleton width="80%" height={14} />
    </View>
  );
}

type InitialProps = {
  recent: string[];
  onPick: (term: string) => void;
  onRemove: (term: string) => void;
  onClearAll: () => void;
};

/** 검색 전: 최근 검색어(없으면 섹션 숨김) · 인기 검색어 · 음식 카테고리. 섹션 하나가 실패해도 나머지는 그대로 쓴다 */
function InitialSections({ recent, onPick, onRemove, onClearAll }: InitialProps) {
  const popular = useAsync('search:popular', () => searchService.listPopularSearchTerms());
  const categories = useAsync('search:categories', () => catalogRepository.listCategories());

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sections}>
      {recent.length > 0 ? (
        <View style={styles.section}>
          <View style={styles.head}>
            <Text accessibilityRole="header" style={styles.title}>
              {copy.recentTitle}
            </Text>
            <TextButton size="sm" onPress={onClearAll}>
              {copy.recentClearAll}
            </TextButton>
          </View>
          <View style={styles.chips}>
            {recent.map((term) => (
              <RecentSearchChip key={term} term={term} removeLabel={copy.recentRemove(term)} onPress={() => onPick(term)} onRemove={() => onRemove(term)} />
            ))}
          </View>
        </View>
      ) : null}

      {/* 인기 검색어가 0개이면 섹션을 숨긴다. 불러오지 못한 것과 구분한다 */}
      {popular.status !== 'ok' || popular.data.length > 0 ? (
        <View style={styles.section}>
          <View style={styles.head}>
            <Text accessibilityRole="header" style={styles.title}>
              {copy.popularTitle}
            </Text>
          </View>
          {popular.status === 'loading' ? (
            <View accessibilityLabel={copy.popularLoading} style={styles.popularSkeleton}>
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} width="70%" height={22} />
              ))}
            </View>
          ) : null}
          {popular.status === 'error' ? <SectionError message={copy.popularErrorText} onRetry={popular.reload} /> : null}
          {popular.status === 'ok' ? <PopularTermList terms={popular.data} onPress={onPick} /> : null}
        </View>
      ) : null}

      <View style={styles.section}>
        <View style={styles.head}>
          <Text accessibilityRole="header" style={styles.title}>
            {copy.categoriesTitle}
          </Text>
        </View>
        {categories.status === 'loading' ? (
          <View style={styles.chips}>
            {[72, 64, 64, 72].map((w, i) => (
              <Skeleton key={i} width={w} height={36} radius={18} />
            ))}
          </View>
        ) : null}
        {categories.status === 'error' ? <SectionError message={copy.categoriesError} onRetry={categories.reload} /> : null}
        {categories.status === 'ok' ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
            {categories.data.map((c) => (
              <FoodCategoryChip key={c.id} label={c.name} imageUri={null} selected={false} onPress={() => goCategoryStoreList(c.code)} />
            ))}
          </ScrollView>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  top: {
    paddingHorizontal: spacing[5],
    paddingBottom: spacing[3],
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  sections: {
    paddingBottom: spacing[10],
  },
  section: {
    paddingHorizontal: spacing[5],
    paddingTop: spacing[6],
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 32,
    marginBottom: spacing[3],
  },
  title: {
    ...text.h3,
    color: colors.ink,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
  },
  categoryRow: {
    gap: spacing[2],
    paddingRight: spacing[5],
  },
  popularSkeleton: {
    gap: spacing[5],
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
