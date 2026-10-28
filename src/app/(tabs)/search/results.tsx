import { Redirect, useLocalSearchParams } from 'expo-router';

import { isSearchable, normalizeQuery } from '@/features/search/search-model';
import { SearchResultsScreen } from '@/features/search/search-results-screen';

/** 검색 결과. 검색어는 `q` 파라미터로 받는다. 검색어가 없거나 공백뿐이면 검색 전 화면으로 보낸다 */
export default function SearchResultsRoute() {
  const { q } = useLocalSearchParams<{ q?: string }>();
  const query = normalizeQuery(typeof q === 'string' ? q : '');
  if (!isSearchable(query)) return <Redirect href="/search" />;
  return <SearchResultsScreen query={query} />;
}
