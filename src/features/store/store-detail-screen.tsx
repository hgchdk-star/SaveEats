import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge } from '@/components/ui/badge';
import { CravingRating } from '@/components/ui/craving-rating';
import { CtaBar } from '@/components/ui/cta-bar';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback-states';
import { FavoriteButton } from '@/components/ui/favorite-button';
import { FoodImage } from '@/components/ui/food-image';
import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { MenuCard } from '@/components/ui/menu-card';
import { Notice } from '@/components/ui/notice';
import { Screen } from '@/components/ui/screen';
import { TabStrip } from '@/components/ui/tab-strip';
import { TopNavigation } from '@/components/ui/top-navigation';
import { draftCopy } from '@/config/draft-copy';
import { UNDECIDED } from '@/config/undecided';
import { quantityByMenu } from '@/features/cart/cart-model';
import { useCartStore } from '@/features/cart/cart-store';
import { useCartQuantity } from '@/features/cart/use-cart-quantity';
import { useFavorite } from '@/features/favorites/favorites-store';
import { useRecentViewedStore } from '@/features/home/recent-viewed-store';
import { ReviewListSection } from '@/features/review/review-list-section';
import { useAsync } from '@/hooks/use-async';
import { catalogRepository } from '@/services';
import { resolveImageUrl } from '@/services/image';
import { colors, size, spacing, text } from '@/theme';
import { formatCount } from '@/utils/format';

type TabId = 'menu' | 'review' | 'info';

const TABS = [
  { id: 'menu', label: '메뉴' },
  { id: 'review', label: 'SaveEats 리뷰' },
  { id: 'info', label: '가게정보' },
] as const;

/** 스크롤이 이만큼 내려오면 상단 바가 흰 바탕으로 바뀌고 가게 이름이 나타난다 */
const SOLID_AFTER = 116;

export function StoreDetailScreen({ storeId }: { storeId: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const cartCount = useCartQuantity();
  const cart = useCartStore((s) => s.cart);
  const addRecent = useRecentViewedStore((s) => s.add);

  const store = useAsync(`store:${storeId}`, () => catalogRepository.getStore(storeId));
  const [tab, setTab] = useState<TabId>('menu');
  const [solid, setSolid] = useState(false);
  const [tabsPinned, setTabsPinned] = useState(false);
  const tabsY = useRef<number | null>(null);
  const barHeight = insets.top + size.topnav;

  const loaded = store.status === 'ok' ? store.data : null;
  const favorite = useFavorite(storeId, loaded?.isFavorite ?? null);

  // 실제로 불러온 가게만 최근 본 목록에 넣는다
  useEffect(() => {
    if (loaded) addRecent({ type: 'STORE', id: storeId });
  }, [loaded, storeId, addRecent]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    setSolid((prev) => (prev === y > SOLID_AFTER ? prev : y > SOLID_AFTER));
    if (tabsY.current !== null) {
      const pinned = y + barHeight >= tabsY.current;
      setTabsPinned((prev) => (prev === pinned ? prev : pinned));
    }
  };

  const onTabsLayout = (e: LayoutChangeEvent) => {
    tabsY.current = e.nativeEvent.layout.y;
  };

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const cartButton = <IconButton icon="cart" label="장바구니" variant={solid || !loaded ? 'plain' : 'overlay'} badge={cartCount} onPress={() => router.push('/cart')} />;
  const top = <TopNavigation overlay={{ solid: solid || store.status !== 'ok' }} title={loaded?.name} onBack={goBack} actions={cartButton} />;

  if (store.status === 'loading') {
    return (
      <Screen top={top}>
        <ScrollView scrollEnabled={false}>
          <FoodImage uri={null} ratio="16:9" rounded={0} />
          <View accessibilityLabel="가게 정보를 불러오는 중" style={styles.skeletons}>
            <Skeleton width="70%" height={28} />
            <Skeleton width="30%" height={16} />
            <Skeleton width="90%" height={16} />
          </View>
        </ScrollView>
      </Screen>
    );
  }

  if (store.status === 'error' || !loaded) {
    return (
      <Screen top={top}>
        <View style={{ paddingTop: barHeight + spacing[10] }}>
          <ErrorState title={draftCopy.store.loadErrorTitle} onRetry={store.reload} />
        </View>
      </Screen>
    );
  }

  const quantities = quantityByMenu(cart, loaded.id);
  const inCartTotal = Object.values(quantities).reduce((sum, n) => sum + n, 0);
  // 미결정 묶음1 #2: 준비 중 가게에서도 탐색·담기를 허용할지 (설정값)
  const orderingBlocked = !UNDECIDED.preparingStoreOrderable && !loaded.isOpen;
  const { count: reviewCount, averageCravingRating: rating } = loaded.reviewSummary;

  const tabs = <TabStrip items={TABS} active={tab} onChange={setTab} />;

  return (
    <Screen
      top={top}
      bottom={inCartTotal > 0 ? <CtaBar label="장바구니 보기" count={inCartTotal} onPress={() => router.push('/cart')} /> : undefined}>
      <ScrollView onScroll={onScroll} scrollEventThrottle={16} showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <FoodImage uri={resolveImageUrl(loaded.imageRef)} alt={loaded.name} ratio="16:9" rounded={0} />

        <View style={styles.info}>
          <View style={styles.nameRow}>
            <Text style={styles.name}>{loaded.name}</Text>
            <View style={styles.fav}>
              <FavoriteButton active={favorite.value === true} onToggle={favorite.toggle} />
            </View>
          </View>
          <View style={styles.meta}>
            <Text style={styles.category}>{loaded.category.name}</Text>
            <Badge>{loaded.isOpen ? draftCopy.store.statusOpen : draftCopy.store.statusClosed}</Badge>
          </View>
          {loaded.description ? <Text style={styles.intro}>{loaded.description}</Text> : null}
          {/* 리뷰 0개면 평균·별을 만들지 않는다 (FR-REV-025) */}
          {reviewCount > 0 && rating !== null ? (
            <Pressable accessibilityRole="button" accessibilityLabel="SaveEats 리뷰 보기" onPress={() => setTab('review')} style={styles.ratingLink}>
              <CravingRating compact value={rating} />
              <Text style={styles.ratingLinkText}>· SaveEats 리뷰 {formatCount(reviewCount)}</Text>
              <Icon name="chevronRight" size={16} color={colors.inkTertiary} />
            </Pressable>
          ) : (
            <Text style={styles.noReview}>아직 리뷰가 없어요</Text>
          )}
        </View>

        <View onLayout={onTabsLayout}>{tabs}</View>

        {orderingBlocked ? (
          <View style={styles.noticeWrap}>
            <Notice title={draftCopy.cart.storeClosedTitle} description={draftCopy.menu.noteStoreClosed} />
          </View>
        ) : null}

        {tab === 'menu' ? (
          loaded.menus.length > 0 ? (
            <View style={styles.menuList}>
              {loaded.menus.map((menu) => (
                <MenuCard
                  key={menu.id}
                  name={menu.name}
                  description={menu.description}
                  imageUri={resolveImageUrl(menu.imageRef)}
                  price={menu.price}
                  soldOut={menu.isSoldOut}
                  inCartQuantity={quantities[menu.id] ?? 0}
                  onPress={() => router.push({ pathname: '/menu/[menuId]', params: { menuId: menu.id } })}
                />
              ))}
            </View>
          ) : (
            <EmptyState icon="plate" title={draftCopy.store.noMenus} />
          )
        ) : null}

        {tab === 'review' ? (
          // 목록·정렬·사진 필터·도움돼요·신고는 ReviewListSection이 맡는다. 조회 실패는 '리뷰 0개'와 다르게 보여준다
          <ReviewListSection scope={{ type: 'store', id: loaded.id }} reportEnabled={UNDECIDED.reviewReportEntries.storeReviewTab} errorDescription={draftCopy.review.loadErrorDescInStore} />
        ) : null}

        {tab === 'info' ? (
          <View style={styles.infoList}>
            <InfoRow label="가게 이름" value={loaded.name} />
            <InfoRow label="카테고리" value={loaded.category.name} />
            {loaded.description ? <InfoRow label="소개" value={loaded.description} /> : null}
            <InfoRow label="영업 상태" value={loaded.isOpen ? draftCopy.store.statusOpen : draftCopy.store.statusClosed} />
          </View>
        ) : null}
      </ScrollView>

      {/* 스크롤하면 탭이 상단 바 바로 아래에 고정된다 */}
      {tabsPinned ? <View style={[styles.pinned, { top: barHeight }]}>{tabs}</View> : null}
    </Screen>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: spacing[10],
  },
  skeletons: {
    padding: spacing[5],
    gap: spacing[2],
    backgroundColor: colors.surface,
  },
  info: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing[5],
    paddingTop: spacing[5],
    paddingBottom: spacing[4],
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing[2],
  },
  name: {
    ...text.h1,
    flex: 1,
    color: colors.ink,
  },
  fav: {
    marginTop: -6,
    marginRight: -10,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing[2],
    marginTop: spacing[1],
  },
  category: {
    ...text.body2,
    color: colors.inkTertiary,
  },
  intro: {
    ...text.body2,
    color: colors.inkSecondary,
    marginTop: spacing[3],
  },
  ratingLink: {
    minHeight: size.touch,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    marginTop: spacing[1],
  },
  ratingLinkText: {
    ...text.body2,
    color: colors.inkTertiary,
  },
  noReview: {
    ...text.body2,
    color: colors.inkTertiary,
    marginTop: spacing[3],
  },
  noticeWrap: {
    paddingTop: spacing[4],
  },
  menuList: {
    gap: spacing[3],
    paddingHorizontal: spacing[5],
    paddingTop: spacing[4],
    paddingBottom: spacing[6],
  },
  reviewSummary: {
    padding: spacing[5],
    gap: spacing[2],
  },
  reviewTitle: {
    ...text.h2,
    color: colors.ink,
    marginBottom: spacing[2],
  },
  reviewScore: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  reviewLabel: {
    ...text.title,
    color: colors.ink,
  },
  reviewAverage: {
    ...text.h1,
    color: colors.ink,
  },
  reviewCount: {
    ...text.body2,
    color: colors.inkSecondary,
  },
  infoList: {
    padding: spacing[5],
    gap: spacing[4],
  },
  infoRow: {
    flexDirection: 'row',
    gap: spacing[3],
  },
  infoLabel: {
    ...text.body2,
    width: 80,
    color: colors.inkTertiary,
  },
  infoValue: {
    ...text.body2,
    flex: 1,
    color: colors.ink,
  },
  pinned: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 5,
  },
});
