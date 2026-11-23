import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge } from '@/components/ui/badge';
import { ConfirmSheet } from '@/components/ui/bottom-sheet';
import { CravingRating } from '@/components/ui/craving-rating';
import { CtaBar } from '@/components/ui/cta-bar';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback-states';
import { FavoriteButton } from '@/components/ui/favorite-button';
import { FoodImage } from '@/components/ui/food-image';
import { StorePhotoGallery } from '@/components/ui/store-photo-gallery';
import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { MenuGroupTabs } from '@/components/ui/menu-group-tabs';
import { MenuCard } from '@/components/ui/menu-card';
import { Notice } from '@/components/ui/notice';
import { Screen } from '@/components/ui/screen';
import { SearchBar } from '@/components/ui/search-bar';
import { TabStrip } from '@/components/ui/tab-strip';
import { TopNavigation } from '@/components/ui/top-navigation';
import { LIMITS } from '@/config/limits';
import { draftCopy } from '@/config/draft-copy';
import { UNDECIDED } from '@/config/undecided';
import type { MenuSummaryDto } from '@/contracts/catalog';
import { quantityByMenu } from '@/features/cart/cart-model';
import { useCartStore } from '@/features/cart/cart-store';
import { createSingleFlight, quickAddMenu, type QuickAddOutcome } from '@/features/cart/quick-add';
import { useCartQuantity } from '@/features/cart/use-cart-quantity';
import { useFavorite } from '@/features/favorites/favorites-store';
import { useRecentViewedStore } from '@/features/home/recent-viewed-store';
import { ReviewListSection } from '@/features/review/review-list-section';
import { showToast } from '@/features/toast/toast-store';
import { useAsync } from '@/hooks/use-async';
import { catalogRepository } from '@/services';
import { resolveImageUrl } from '@/services/image';
import { colors, size, spacing, text } from '@/theme';
import { formatCount } from '@/utils/format';

import {
  activeSectionIndex,
  buildMenuSections,
  scrollTargetForSection,
  searchAnchorScroll,
  searchMenus,
  searchTransition,
  stickyScrollRange,
} from './menu-sections';
import { storePhotoUris } from './store-photos';
import { StoreSourceSection } from './store-source-section';

type TabId = 'menu' | 'review' | 'info';

const TABS = [
  { id: 'menu', label: '메뉴' },
  { id: 'review', label: 'SaveEats 리뷰' },
  { id: 'info', label: '가게정보' },
] as const;

/** 스크롤이 이만큼 내려오면 상단 바가 흰 바탕으로 바뀌고 가게 이름이 나타난다 */
const SOLID_AFTER = 116;

/** 가게 안 메뉴 검색어 최대 글자 수 */
const MENU_SEARCH_MAX = 40;

/** 탭을 누른 뒤(또는 검색을 끝내고 위치를 되돌린 뒤) 이 시간 동안은 스크롤 위치로 활성 탭을 다시 계산하지 않는다(깜빡임 방지) */
const PROGRAMMATIC_SCROLL_MS = 700;

/** 검색을 끝내고 구역 목록이 다시 그려진 뒤 저장해 둔 위치로 돌아가기까지 기다리는 시간 */
const RESTORE_DELAY_MS = 80;

export function StoreDetailScreen({ storeId }: { storeId: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const cartCount = useCartQuantity();
  const cart = useCartStore((s) => s.cart);
  const addToCart = useCartStore((s) => s.add);
  const addRecent = useRecentViewedStore((s) => s.add);

  const store = useAsync(`store:${storeId}`, () => catalogRepository.getStore(storeId));
  const [tab, setTab] = useState<TabId>('menu');
  const [solid, setSolid] = useState(false);
  const barHeight = insets.top + size.topnav;

  // 메뉴 탭: 메뉴 그룹(구역) · 가게 안 검색 · 탭↔스크롤 동기화. 위치는 모두 스크롤 내용 기준 y다
  const scrollRef = useRef<ComponentRef<typeof Animated.ScrollView>>(null);
  const [scrollY] = useState(() => new Animated.Value(0));
  const scrollNow = useRef(0);
  const sectionsY = useRef(0);
  const sectionRelY = useRef<Record<string, number>>({});
  const programmatic = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 검색을 시작할 때 저장하는 위치·선택 그룹. 검색을 지우면 이 값으로 돌아간다 */
  const beforeSearch = useRef<{ y: number; section: string | null } | null>(null);
  const [query, setQuery] = useState('');
  const [activeSection, setActiveSection] = useState<string | null>(null);
  /** 고정 영역(검색 + 그룹 탭)이 원래 놓인 y(= 메뉴 영역 y)와 높이. 레이아웃에서 갱신한다 */
  const [anchorY, setAnchorY] = useState(0);
  const [stickyHeight, setStickyHeight] = useState(0);

  // 담기 버튼: 한 번에 하나만 처리한다. 다른 가게 메뉴가 담겨 있으면 교체 확인을 거친다
  const [flight] = useState(() => createSingleFlight());
  const [addingId, setAddingId] = useState<string | null>(null);
  const [replaceFor, setReplaceFor] = useState<MenuSummaryDto | null>(null);

  const loaded = store.status === 'ok' ? store.data : null;
  const favorite = useFavorite(storeId, loaded?.isFavorite ?? null);
  const menuView = useMemo(() => (loaded ? buildMenuSections(loaded.menus, loaded.menuGroups, draftCopy.store.ungroupedMenus) : null), [loaded]);
  // 이미 불러온 활성 메뉴 전체를 앱 안에서 검색한다(일부만 보지 않는다). null이면 검색 중이 아니다
  const results = loaded && menuView ? searchMenus(loaded.menus, menuView.sections, query) : null;
  const searching = results !== null;
  const showGroupTabs = tab === 'menu' && !!menuView?.grouped && !searching;
  /** 위에 항상 보이는 높이: 상단 바 + 고정 영역(검색, 그룹 탭이 있으면 그 아래 탭). 구역 제목이 이 아래에 오도록 스크롤한다 */
  const pinnedHeight = barHeight + stickyHeight;

  // 스크롤 콜백은 한 번만 만들어 네이티브 쪽에 연결한다. 최신 값은 이 객체로 읽는다(렌더 뒤에 갱신)
  const live = useRef({ showGroupTabs, menuView, pinnedHeight, anchorY });
  useEffect(() => {
    live.current = { showGroupTabs, menuView, pinnedHeight, anchorY };
  });

  useEffect(
    () => () => {
      if (programmatic.current) clearTimeout(programmatic.current);
      if (restoreTimer.current) clearTimeout(restoreTimer.current);
    },
    [],
  );

  // 실제로 불러온 가게만 최근 본 목록에 넣는다
  useEffect(() => {
    if (loaded) addRecent({ type: 'STORE', id: storeId });
  }, [loaded, storeId, addRecent]);

  const holdSectionSync = () => {
    if (programmatic.current) clearTimeout(programmatic.current);
    programmatic.current = setTimeout(() => {
      programmatic.current = null;
    }, PROGRAMMATIC_SCROLL_MS);
  };

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    scrollNow.current = y;
    setSolid((prev) => (prev === y > SOLID_AFTER ? prev : y > SOLID_AFTER));
    const { showGroupTabs: tabsOn, menuView: view, pinnedHeight: header, anchorY: anchor } = live.current;
    // 탭을 눌러 이동하는 중이 아니면, 지금 보는 구역으로 선택 탭을 맞춘다
    if (tabsOn && view && !programmatic.current && view.sections.length > 0) {
      const offsets = view.sections.map((sec) => anchor + sectionsY.current + (sectionRelY.current[sec.id] ?? 0));
      const id = view.sections[activeSectionIndex(offsets, y, header)].id;
      setActiveSection((prev) => (prev === id ? prev : id));
    }
  };
  // 네이티브 스크롤 이벤트에 한 번만 연결하고, 실제 처리는 매 렌더 갱신되는 handleScroll을 부른다
  const handleScrollRef = useRef(handleScroll);
  useEffect(() => {
    handleScrollRef.current = handleScroll;
  });
  const [onScroll, setOnScroll] = useState<ReturnType<typeof Animated.event> | undefined>(undefined);
  useEffect(() => {
    setOnScroll(() =>
      Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
        useNativeDriver: true,
        listener: (e: NativeSyntheticEvent<NativeScrollEvent>) => handleScrollRef.current(e),
      }),
    );
  }, [scrollY]);

  /** 고정 영역: 스크롤 0에서는 원래 자리(anchorY)에 있다가, 올라가면 상단 바 아래(barHeight)에 멈춘다 */
  const stickyTranslateY = useMemo(
    () => scrollY.interpolate({ inputRange: stickyScrollRange(anchorY, barHeight), outputRange: [anchorY, barHeight], extrapolate: 'clamp' }),
    [scrollY, anchorY, barHeight],
  );

  /** 그룹 탭을 눌렀을 때: 선택 탭을 바꾸고 그 구역 제목이 고정 영역 바로 아래에 오게 스크롤한다 */
  const goToSection = (id: string) => {
    setActiveSection(id);
    const rel = sectionRelY.current[id];
    if (rel === undefined) return;
    holdSectionSync();
    scrollRef.current?.scrollTo({ y: scrollTargetForSection(anchorY + sectionsY.current + rel, pinnedHeight), animated: true });
  };

  /**
   * 검색어 변경. 검색을 시작할 때 지금 위치·선택 그룹을 저장하고 결과가 고정 영역 바로 아래에서 시작하게 올린다.
   * 검색을 지우면(공백뿐 포함) 저장해 둔 위치·그룹으로 되돌린다.
   */
  const changeQuery = (next: string) => {
    const move = searchTransition(query, next);
    if (move === 'START') {
      beforeSearch.current = { y: scrollNow.current, section: activeSection };
      const target = searchAnchorScroll(scrollNow.current, anchorY, barHeight);
      if (target !== null) scrollRef.current?.scrollTo({ y: target, animated: false });
    }
    setQuery(next);
    if (move === 'END') {
      const saved = beforeSearch.current;
      beforeSearch.current = null;
      if (saved) {
        setActiveSection(saved.section);
        holdSectionSync();
        if (restoreTimer.current) clearTimeout(restoreTimer.current);
        // 구역 목록이 다시 그려진 뒤에 돌아가야 높이가 맞는다
        restoreTimer.current = setTimeout(() => scrollRef.current?.scrollTo({ y: saved.y, animated: false }), RESTORE_DELAY_MS);
      }
    }
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

  /** 목록·검색 결과의 담기 버튼. 상세를 열지 않고 담을 수 있으면 담고, 필수 옵션이 있으면 상세로 보낸다 */
  const quickAdd = async (target: MenuSummaryDto, replaceOtherStore = false) => {
    if (!flight.tryStart(target.id)) return; // 처리 중이면 연속 터치·다른 카드 터치는 무시한다
    setAddingId(target.id);
    let outcome: QuickAddOutcome;
    try {
      outcome = await quickAddMenu(
        target.id,
        { getMenu: (id) => catalogRepository.getMenu(id), add: addToCart, preparingStoreOrderable: UNDECIDED.preparingStoreOrderable },
        { replaceOtherStore },
      );
    } catch {
      outcome = { kind: 'FAILED', reason: 'SAVE_FAILED' }; // 알 수 없는 오류도 성공으로 보지 않는다
    } finally {
      flight.finish();
      setAddingId(null);
    }
    setReplaceFor(null);
    switch (outcome.kind) {
      case 'ADDED':
        showToast({ message: draftCopy.menu.toastAdded, action: { label: draftCopy.menu.toastAddedAction, onPress: () => router.push('/cart') } });
        return;
      case 'NEEDS_DETAIL':
        router.push({ pathname: '/menu/[menuId]', params: { menuId: target.id } });
        return;
      case 'OTHER_STORE':
        setReplaceFor(target);
        return;
      case 'BLOCKED':
        showToast({ message: outcome.reason === 'SOLD_OUT' ? draftCopy.menu.noteSoldOut : draftCopy.menu.noteStoreClosed, tone: 'error' });
        return;
      case 'FAILED':
        if (outcome.reason === 'LOAD_FAILED') showToast({ message: draftCopy.menu.quickAddLoadFailed, tone: 'error' });
        else if (outcome.reason === 'OVER_LIMIT') showToast({ message: draftCopy.menu.toastOverLimit, tone: 'error' });
        else if (outcome.reason === 'OVER_KINDS') showToast({ message: draftCopy.menu.toastOverKinds(LIMITS.cartLineKindsMax), tone: 'error' });
        else if (outcome.reason === 'SAVE_FAILED') showToast({ message: draftCopy.cart.saveFailed, tone: 'error' });
        else showToast({ message: draftCopy.cart.storageErrorTitle, tone: 'error' });
        return;
    }
  };

  const tabs = <TabStrip items={TABS} active={tab} onChange={setTab} />;
  const sectionItems = menuView?.sections.map((sec) => ({ id: sec.id, label: sec.title })) ?? [];
  const activeSectionId = menuView?.sections.some((sec) => sec.id === activeSection) ? (activeSection as string) : (menuView?.sections[0]?.id ?? '');
  const renderMenu = (menu: MenuSummaryDto) => (
    <MenuCard
      key={menu.id}
      name={menu.name}
      description={menu.description}
      imageUri={resolveImageUrl(menu.imageRef)}
      price={menu.price}
      soldOut={menu.isSoldOut}
      inCartQuantity={quantities[menu.id] ?? 0}
      onPress={() => router.push({ pathname: '/menu/[menuId]', params: { menuId: menu.id } })}
      onAdd={() => void quickAdd(menu)}
      adding={addingId === menu.id}
      addDisabled={orderingBlocked || (addingId !== null && addingId !== menu.id)}
      addLabel={draftCopy.menu.quickAddLabel(menu.name)}
    />
  );
  const stickyReady = anchorY > 0 && stickyHeight > 0;
  const showSticky = tab === 'menu' && loaded.menus.length > 0;

  return (
    <Screen
      top={top}
      bottom={inCartTotal > 0 ? <CtaBar label="장바구니 보기" count={inCartTotal} onPress={() => router.push('/cart')} /> : undefined}>
      <Animated.ScrollView
        ref={scrollRef}
        onScroll={onScroll}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}>
        <StorePhotoGallery uris={storePhotoUris(loaded)} alt={loaded.name} />

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

        {/* 메뉴 / 리뷰 / 가게정보 탭은 일반 스크롤 영역이다. 고정하지 않는다 */}
        <View>{tabs}</View>

        {orderingBlocked ? (
          <View style={styles.noticeWrap}>
            <Notice title={draftCopy.cart.storeClosedTitle} description={draftCopy.menu.noteStoreClosed} />
          </View>
        ) : null}

        {tab === 'menu' ? (
          loaded.menus.length > 0 ? (
            <View onLayout={(e) => setAnchorY(Math.round(e.nativeEvent.layout.y))}>
              {/* 고정 영역(검색 + 그룹 탭)이 놓일 자리. 실제 내용은 아래 겹침 레이어가 한 벌만 그린다 */}
              <View style={{ height: stickyHeight }} />
              {results !== null ? (
                <View style={styles.menuList}>
                  <Text accessibilityLiveRegion="polite" style={styles.resultCount}>
                    {draftCopy.store.menuSearchResultCount(results.length)}
                  </Text>
                  {results.length > 0 ? (
                    results.map(renderMenu)
                  ) : (
                    <EmptyState icon="search" title={draftCopy.store.menuSearchEmptyTitle} description={draftCopy.store.menuSearchEmptyDescription} />
                  )}
                </View>
              ) : menuView?.grouped ? (
                <View onLayout={(e) => (sectionsY.current = e.nativeEvent.layout.y)}>
                  {menuView.sections.map((sec) => (
                    <View key={sec.id} onLayout={(e) => (sectionRelY.current[sec.id] = e.nativeEvent.layout.y)}>
                      <Text accessibilityRole="header" style={styles.sectionTitle}>
                        {sec.title}
                      </Text>
                      <View style={styles.sectionList}>{sec.menus.map(renderMenu)}</View>
                    </View>
                  ))}
                </View>
              ) : (
                <View style={styles.menuList}>{loaded.menus.map(renderMenu)}</View>
              )}
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

        {/* 모든 탭의 마지막 섹션. 같은 가게(loaded.id)의 출처만 보인다 */}
        <StoreSourceSection storeId={loaded.id} storeName={loaded.name} />
      </Animated.ScrollView>

      {/*
        메뉴 탭에서만 고정되는 영역: 첫 줄 '이 가게 메뉴 검색', 둘째 줄 가로 메뉴 그룹 탭(그룹이 있고 검색 중이 아닐 때).
        한 벌만 그리고 스크롤에 맞춰 위치를 옮긴다: 처음엔 본문 자리에 있다가 올라가면 상단 바(안전 영역 포함) 바로 아래에 멈춘다.
        그래서 고정/비고정 두 벌이 겹치지 않고, 입력 중 포커스가 끊기지 않는다. 리뷰·가게정보 탭에는 그리지 않는다.
      */}
      {showSticky ? (
        <Animated.View
          pointerEvents={stickyReady ? 'auto' : 'none'}
          onLayout={(e) => setStickyHeight(Math.round(e.nativeEvent.layout.height))}
          style={[styles.sticky, { opacity: stickyReady ? 1 : 0, transform: [{ translateY: stickyTranslateY }] }]}>
          <View style={[styles.searchWrap, !showGroupTabs && styles.searchWrapOnly]}>
            <SearchBar
              value={query}
              placeholder={draftCopy.store.menuSearchPlaceholder}
              onChangeText={changeQuery}
              onClear={() => changeQuery('')}
              clearLabel={draftCopy.store.menuSearchClear}
              maxLength={MENU_SEARCH_MAX}
            />
          </View>
          {showGroupTabs ? <MenuGroupTabs items={sectionItems} activeId={activeSectionId} onChange={goToSection} /> : null}
        </Animated.View>
      ) : null}

      {/* 장바구니에 다른 가게 메뉴가 있을 때(메뉴 상세와 같은 확인 문구) */}
      <ConfirmSheet
        visible={replaceFor !== null}
        onClose={() => setReplaceFor(null)}
        message="장바구니에 다른 가게의 메뉴가 있어요. 비우고 새 메뉴를 담을까요?"
        secondary={{ label: '취소', onPress: () => setReplaceFor(null) }}
        primary={{ label: '비우고 담기', onPress: () => (replaceFor ? void quickAdd(replaceFor, true) : undefined) }}
      />
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
  searchWrap: {
    paddingHorizontal: spacing[5],
    paddingTop: spacing[3],
    paddingBottom: spacing[2],
    backgroundColor: colors.surface,
  },
  /** 그룹 탭이 없을 때(검색 중·그룹 없는 가게)는 검색 줄 아래에 구분선을 둔다 */
  searchWrapOnly: {
    paddingBottom: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  /** 스크롤 내용 위에 얹는 고정 레이어. 위치는 translateY로 옮긴다 */
  sticky: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 5,
    backgroundColor: colors.surface,
  },
  resultCount: {
    ...text.body2,
    color: colors.inkSecondary,
  },
  sectionTitle: {
    ...text.h2,
    color: colors.ink,
    paddingHorizontal: spacing[5],
    paddingTop: spacing[6],
  },
  sectionList: {
    gap: spacing[3],
    paddingHorizontal: spacing[5],
    paddingTop: spacing[3],
    paddingBottom: spacing[2],
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
});
