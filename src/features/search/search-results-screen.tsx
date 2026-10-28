import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SecondaryButton } from '@/components/ui/button';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback-states';
import { IconButton } from '@/components/ui/icon-button';
import { Screen } from '@/components/ui/screen';
import { SearchBar } from '@/components/ui/search-bar';
import { confirmedCopy } from '@/config/confirmed-copy';
import { draftCopy } from '@/config/draft-copy';
import { LIMITS } from '@/config/limits';
import { StoreCardItem } from '@/features/store/store-card-item';
import { StoreList } from '@/components/ui/store-list';
import { usePagedStores } from '@/features/store/use-paged-stores';
import { searchService } from '@/services';
import { useSession } from '@/services/session';
import { colors, spacing, text } from '@/theme';

import { useSearchDraftStore } from './search-draft-store';

const copy = draftCopy.search;

/**
 * 검색 결과 화면 (㉒). 검색 전 화면(㉑)에서 엔터나 검색어 칩으로 검색할 때 새로 열린다. 검색어는 라우트 파라미터로 받는다.
 *
 * - 상단 바: 뒤로가기 + 검색어가 든 검색창. 검색창은 입력을 받지 않고, 누르면 ㉑로 돌아가 커서를 둔다. ✕는 ㉑로 돌아가며 입력창을 비운다
 * - 뒤로가기는 ㉑로 돌아간다(검색어 유지). 가게 상세에서 뒤로 오면 이 화면이다
 * - 검색 대상은 가게 이름 · 메뉴 이름 · 카테고리. 결과는 가게 카드 목록뿐이고, 메뉴 이름으로 걸리면 그 메뉴의 이름·가격을 카드에 보인다
 * - 검색 실패와 결과 없음은 다른 화면이다. 실패하면 같은 검색어로 다시 시도한다. 늦게 온 이전 응답은 버린다(usePagedStores)
 * - 최근 검색어는 이 화면에서 저장하지 않는다. 검색을 실행하는 ㉑에서 저장한다
 */
export function SearchResultsScreen({ query }: { query: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isMember } = useSession();
  const setQuery = useSearchDraftStore((s) => s.setQuery);
  const requestFocus = useSearchDraftStore((s) => s.requestFocus);

  const results = usePagedStores(`search:${query}:${isMember}`, (cursor) => searchService.searchStores({ query, cursor, pageSize: LIMITS.storeListPageSize }));

  // ㉑로 돌아간다. 직접 열린 경우(이전 화면이 없을 때)는 ㉑로 바꿔 연다
  const toInitial = () => (router.canGoBack() ? router.back() : router.replace('/search'));
  const openInput = () => {
    setQuery(query);
    requestFocus();
    toInitial();
  };
  const clearAndOpen = () => {
    setQuery('');
    requestFocus();
    toInitial();
  };

  const top = (
    <View style={[styles.top, { paddingTop: insets.top + spacing[2] }]}>
      <IconButton icon="back" label="뒤로" onPress={toInitial} />
      <View style={styles.bar}>
        <SearchBar readOnly value={query} placeholder={confirmedCopy.searchPlaceholder} onOpen={openInput} onClear={clearAndOpen} clearLabel={copy.clear} maxLength={LIMITS.searchMaxLength} />
      </View>
    </View>
  );

  return (
    <Screen top={top}>
      {results.status === 'loading' || results.status === 'idle' ? (
        <View accessibilityLabel={copy.searching} style={styles.skeletons}>
          <ResultSkeleton />
          <ResultSkeleton />
        </View>
      ) : results.status === 'error' ? (
        <ErrorState title={copy.errorTitle} onRetry={results.reload} />
      ) : results.items.length === 0 ? (
        <EmptyState icon="search" title={copy.emptyTitle(query)} description={copy.emptyDesc} />
      ) : (
        <StoreList
          data={results.items}
          keyExtractor={(store) => store.id}
          countLabel={results.hasMore ? copy.resultCountMore(results.items.length) : copy.resultCount(results.items.length)}
          onEndReached={results.loadMore}
          renderItem={(store) => <StoreCardItem store={store} matchingMenu={store.matchingMenu} />}
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

const styles = StyleSheet.create({
  // 뒤로가기(TopNavigation 규칙) + 검색창 한 줄. 새 토큰 없이 기존 간격만 쓴다 (캔버스 ㉒)
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingLeft: spacing[2],
    paddingRight: spacing[5],
    paddingBottom: spacing[3],
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  bar: {
    flex: 1,
    minWidth: 0,
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
