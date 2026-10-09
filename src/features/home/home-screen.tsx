import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AccountDestinationBar } from '@/components/ui/account-destination-bar';
import { ErrorState, SectionError, Skeleton } from '@/components/ui/feedback-states';
import { FoodCategoryChip } from '@/components/ui/food-category-chip';
import { IconButton } from '@/components/ui/icon-button';
import { Screen } from '@/components/ui/screen';
import { SearchBarButton } from '@/components/ui/search-bar';
import { confirmedCopy } from '@/config/confirmed-copy';
import { draftCopy } from '@/config/draft-copy';
import { UNDECIDED } from '@/config/undecided';
import { useCartQuantity } from '@/features/cart/use-cart-quantity';
import { goAccount, goCategoryStoreList } from '@/features/order/flow-routes';
import { StoreCardItem } from '@/features/store/store-card-item';
import { useAsync } from '@/hooks/use-async';
import { mockHome } from '@/mocks/home/mock-home';
import { catalogRepository } from '@/services';
import { useSession } from '@/services/session';
import { colors, spacing } from '@/theme';

import { BannerCarousel } from './banner-carousel';
import { RecentSection } from './recent-section';
import { SectionHeader } from './section-header';

const ALL = 'all';

/**
 * 홈. 섹션마다 따로 불러오고, 한 섹션이 실패해도 나머지는 그대로 쓸 수 있다 (API-002).
 * 계좌 줄과 검색창은 먼저 그리고, 홈 "지금 많이 찾는 메뉴"는 노출 기준과 문구가 정해질 때까지 두지 않는다.
 */
export function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const cartCount = useCartQuantity();
  const session = useSession();
  const [categoryCode, setCategoryCode] = useState(ALL);

  const categories = useAsync('home:categories', () => catalogRepository.listCategories());
  const banners = useAsync('home:banners', () => mockHome.listBanners());
  const recommended = useAsync(`home:recommended:${session.isMember}`, () => mockHome.listRecommendedStores());

  // 세 섹션이 모두 실패했다면 홈 전체 오류로 본다 (오프라인·서버 오류)
  const allFailed = categories.status === 'error' && banners.status === 'error' && recommended.status === 'error';
  const retryAll = () => {
    categories.reload();
    banners.reload();
    recommended.reload();
  };

  const pickCategory = (code: string) => {
    if (code === ALL) {
      setCategoryCode(ALL);
      return;
    }
    // 미결정 묶음1 #1: 칩을 누르면 카테고리 가게 목록으로 이동한다
    if (UNDECIDED.categoryChipAction === 'navigateCategoryStoreList') goCategoryStoreList(code);
  };

  const header = (
    <View style={[styles.header, { paddingTop: insets.top }]}>
      <View style={styles.headerRow}>
        <AccountDestinationBar account={session.destinationAccount} onPress={goAccount} />
        <IconButton icon="cart" label="장바구니" badge={cartCount} onPress={() => router.push('/cart')} />
      </View>
    </View>
  );

  return (
    <Screen top={header}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.search}>
          <SearchBarButton placeholder={confirmedCopy.searchPlaceholder} onPress={() => router.navigate('/search')} />
        </View>

        {allFailed ? (
          <ErrorState onRetry={retryAll} />
        ) : (
          <>
            <View style={styles.chips}>
              {categories.status === 'loading' ? <CategorySkeleton /> : null}
              {categories.status === 'error' ? <SectionError message={draftCopy.home.categoriesError} onRetry={categories.reload} /> : null}
              {categories.status === 'ok' ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="radiogroup" contentContainerStyle={styles.chipRow}>
                  <FoodCategoryChip label="전체" imageUri={null} selected={categoryCode === ALL} onPress={() => pickCategory(ALL)} />
                  {categories.data.map((c) => (
                    <FoodCategoryChip key={c.id} label={c.name} imageUri={null} selected={categoryCode === c.code} onPress={() => pickCategory(c.code)} />
                  ))}
                </ScrollView>
              ) : null}
            </View>

            {/* 배너는 장식이라 실패하거나 비어 있으면 자리를 접는다 */}
            {banners.status === 'ok' && banners.data.length > 0 ? (
              <View style={styles.section}>
                <BannerCarousel count={banners.data.length} />
              </View>
            ) : null}

            {/* 홈 "지금 많이 찾는 메뉴": 노출 기준과 문구가 정해질 때까지 자리만 비워 둔다 (getHome 계약에서 결정) */}

            {/* 추천 가게: 0개면 섹션을 숨긴다 */}
            {recommended.status === 'loading' ? (
              <View style={styles.section}>
                <SectionHeader title={draftCopy.home.recommendedTitle} />
                <StoreSkeleton />
              </View>
            ) : null}
            {recommended.status === 'error' ? (
              <View style={styles.section}>
                <SectionHeader title={draftCopy.home.recommendedTitle} />
                <SectionError message={draftCopy.home.sectionError} onRetry={recommended.reload} />
              </View>
            ) : null}
            {recommended.status === 'ok' && recommended.data.length > 0 ? (
              <View style={styles.section}>
                <SectionHeader title={draftCopy.home.recommendedTitle} />
                <View style={styles.storeList}>
                  {recommended.data.map((store) => (
                    <StoreCardItem key={store.id} store={store} wrapNames />
                  ))}
                </View>
              </View>
            ) : null}

            <RecentSection />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function CategorySkeleton() {
  return (
    <View accessibilityLabel="불러오는 중" style={styles.chipRow}>
      {[72, 64, 64, 64, 72].map((w, i) => (
        <Skeleton key={i} width={w} height={36} radius={18} />
      ))}
    </View>
  );
}

function StoreSkeleton() {
  return (
    <View accessibilityLabel="불러오는 중" style={styles.storeList}>
      {[0, 1].map((i) => (
        <View key={i} style={styles.skelCard}>
          <View style={styles.skelImage} />
          <Skeleton width="55%" height={20} />
          <Skeleton width="80%" height={14} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: colors.surface,
  },
  headerRow: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing[5],
    paddingRight: spacing[2],
    gap: spacing[2],
  },
  content: {
    paddingBottom: spacing[10],
  },
  search: {
    paddingHorizontal: spacing[5],
    paddingTop: spacing[2],
  },
  chips: {
    marginTop: spacing[4],
  },
  chipRow: {
    paddingHorizontal: spacing[5],
    gap: spacing[2],
  },
  section: {
    marginTop: spacing[8],
  },
  storeList: {
    paddingHorizontal: spacing[5],
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
});
