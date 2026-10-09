import { useLocalSearchParams } from 'expo-router';

import { CategoryScreen } from '@/features/category/category-screen';

/** 카테고리 가게 목록. code가 all이면 전체 */
export default function CategoryRoute() {
  const { code } = useLocalSearchParams<{ code: string }>();
  return <CategoryScreen code={code} />;
}
