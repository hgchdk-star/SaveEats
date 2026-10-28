import { useRouter, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TextButton } from '@/components/ui/button';
import { SectionError, Skeleton } from '@/components/ui/feedback-states';
import { FoodCategoryChip } from '@/components/ui/food-category-chip';
import { PopularTermList } from '@/components/ui/popular-term-list';
import { RecentSearchChip } from '@/components/ui/recent-search-chip';
import { Screen } from '@/components/ui/screen';
import { SearchBar } from '@/components/ui/search-bar';
import { confirmedCopy } from '@/config/confirmed-copy';
import { draftCopy } from '@/config/draft-copy';
import { LIMITS } from '@/config/limits';
import { goCategoryStoreList } from '@/features/order/flow-routes';
import { useAsync } from '@/hooks/use-async';
import { catalogRepository, searchService } from '@/services';
import { colors, spacing, text } from '@/theme';

import { loadRecentSearches, saveRecentSearches } from './recent-search-storage';
import { useSearchDraftStore } from './search-draft-store';
import { addRecentSearch, isSearchable, normalizeQuery, removeRecentSearch } from './search-model';

const copy = draftCopy.search;

/**
 * 검색 전 화면 (㉑). 홈 검색창과 검색 탭은 같은 화면이다 (FR-SRCH-001). Guest도 쓴다.
 *
 * - 입력하는 동안에는 결과도 자동 완성도 없다. 엔터나 최근·인기 검색어 칩을 눌렀을 때만 검색하고, 결과는 새 화면(㉒)으로 열린다 (FR-SRCH-012 · 013)
 * - 최근 검색어는 검색을 실행할 때(엔터 · 칩)만 저장한다. 입력만 해서는 저장하지 않고, 공백뿐이거나 1자 미만이면 실행도 저장도 하지 않는다
 * - 결과 화면에서 돌아오면 입력창에 방금 쓴 검색어가 그대로 있다. 결과 화면의 검색창을 눌러 돌아왔을 때만 커서를 둔다
 */
export function SearchScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const query = useSearchDraftStore((s) => s.query);
  const setQuery = useSearchDraftStore((s) => s.setQuery);
  const [recent, setRecent] = useState<string[]>([]);
  const input = useRef<ComponentRef<typeof TextInput>>(null);

  useEffect(() => {
    let alive = true;
    void loadRecentSearches().then((list) => {
      if (alive) setRecent(list);
    });
    return () => {
      alive = false;
    };
  }, []);

  // ㉒의 검색창 · ✕로 돌아왔을 때 커서를 둔다. 화면이 다시 보일 때마다 확인한다
  useFocusEffect(
    useCallback(() => {
      const { focusRequested, consumeFocus } = useSearchDraftStore.getState();
      if (!focusRequested) return;
      consumeFocus();
      const timer = setTimeout(() => input.current?.focus(), 60);
      return () => clearTimeout(timer);
    }, []),
  );

  const updateRecent = (next: string[]) => {
    setRecent(next);
    void saveRecentSearches(next);
  };

  // 엔터 · 칩: 검색어를 남기고 결과 화면을 새로 연다
  const submit = (value: string) => {
    const term = normalizeQuery(value);
    if (!isSearchable(term)) return;
    setQuery(term);
    updateRecent(addRecentSearch(recent, term));
    router.push({ pathname: '/search/results', params: { q: term } });
  };

  const top = (
    <View style={[styles.top, { paddingTop: insets.top + spacing[2] }]}>
      <SearchBar
        inputRef={input}
        value={query}
        placeholder={confirmedCopy.searchPlaceholder}
        onChangeText={setQuery}
        onSubmit={() => submit(query)}
        onClear={() => setQuery('')}
        clearLabel={copy.clear}
        maxLength={LIMITS.searchMaxLength}
      />
    </View>
  );

  return (
    <Screen top={top}>
      <InitialSections recent={recent} onPick={submit} onRemove={(term) => updateRecent(removeRecentSearch(recent, term))} onClearAll={() => updateRecent([])} />
    </Screen>
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
});
