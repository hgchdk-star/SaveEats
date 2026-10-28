import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge } from '@/components/ui/badge';
import { ConfirmSheet } from '@/components/ui/bottom-sheet';
import { CtaBar } from '@/components/ui/cta-bar';
import { ErrorState, Skeleton } from '@/components/ui/feedback-states';
import { FoodImage } from '@/components/ui/food-image';
import { IconButton } from '@/components/ui/icon-button';
import { OptionGroup } from '@/components/ui/option-group';
import { Price } from '@/components/ui/price';
import { QuantitySelector } from '@/components/ui/quantity-selector';
import { Screen } from '@/components/ui/screen';
import { TopNavigation } from '@/components/ui/top-navigation';
import { draftCopy } from '@/config/draft-copy';
import { LIMITS } from '@/config/limits';
import { UNDECIDED } from '@/config/undecided';
import { useCartStore } from '@/features/cart/cart-store';
import { useCartQuantity } from '@/features/cart/use-cart-quantity';
import { useRecentViewedStore } from '@/features/home/recent-viewed-store';
import { MenuReviewLine } from '@/features/review/menu-review-line';
import { showToast } from '@/features/toast/toast-store';
import { useAsync } from '@/hooks/use-async';
import { catalogRepository } from '@/services';
import { resolveImageUrl } from '@/services/image';
import { colors, size, spacing, text } from '@/theme';
import { formatWon } from '@/utils/format';

import {
  firstMissingRequired,
  isRequired,
  isSingle,
  selectedOptionIds,
  selectedOptionNames,
  toggleOption,
  unitPrice,
  type Selection,
} from './menu-selection';

/** 스크롤이 이만큼 내려오면 상단 바가 흰 바탕으로 바뀌고 메뉴 이름이 나타난다 */
const SOLID_AFTER = 200;

export function MenuDetailScreen({ menuId }: { menuId: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const cartCount = useCartQuantity();
  const addToCart = useCartStore((s) => s.add);
  const addRecent = useRecentViewedStore((s) => s.add);

  const menuState = useAsync(`menu:${menuId}`, () => catalogRepository.getMenu(menuId));
  const [selection, setSelection] = useState<Selection>({});
  const [quantity, setQuantity] = useState<number>(LIMITS.quantityMin);
  const [solid, setSolid] = useState(false);
  const [otherStoreSheet, setOtherStoreSheet] = useState(false);
  const [adding, setAdding] = useState(false);

  const menu = menuState.status === 'ok' ? menuState.data : null;

  // 실제로 불러온 메뉴만 최근 본 목록에 넣는다
  useEffect(() => {
    if (menu) addRecent({ type: 'MENU', id: menuId });
  }, [menu, menuId, addRecent]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = e.nativeEvent.contentOffset.y > SOLID_AFTER;
    setSolid((prev) => (prev === next ? prev : next));
  };

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const barSolid = solid || menuState.status !== 'ok';
  const cartButton = <IconButton icon="cart" label="장바구니" variant={barSolid ? 'plain' : 'overlay'} badge={cartCount} onPress={() => router.push('/cart')} />;
  const top = <TopNavigation overlay={{ solid: barSolid }} title={menu?.name} onBack={goBack} actions={cartButton} />;

  if (menuState.status === 'loading') {
    return (
      <Screen top={top}>
        <ScrollView scrollEnabled={false}>
          <FoodImage uri={null} ratio="4:3" rounded={0} />
          <View accessibilityLabel="옵션 정보를 불러오는 중" style={styles.skeletons}>
            <Skeleton width="40%" height={22} />
            <Skeleton height={44} />
            <Skeleton height={44} />
          </View>
        </ScrollView>
      </Screen>
    );
  }

  // 가격·필수 옵션을 믿을 수 없으면 담기를 막는다 (FR-MENU-007 · 008)
  if (menuState.status === 'error' || !menu) {
    return (
      <Screen top={top}>
        <View style={{ paddingTop: insets.top + size.topnav + spacing[10] }}>
          <ErrorState title="옵션 정보를 불러오지 못했어요." description="다시 불러와주세요." onRetry={menuState.reload} />
        </View>
      </Screen>
    );
  }

  const optionIds = selectedOptionIds(menu, selection);
  const unit = unitPrice(menu, selection);
  const total = unit * quantity;
  const missing = firstMissingRequired(menu, selection);
  // 미결정 묶음1 #2: 준비 중(영업 종료) 가게의 메뉴를 담을 수 있는지 (설정값)
  const storeBlocked = !UNDECIDED.preparingStoreOrderable && !menu.storeIsOpen;

  // 담기를 못 하는 이유는 하나만, 이 순서로 보여준다: 품절 > 영업 종료 > 필수 옵션 미선택
  const note = menu.isSoldOut
    ? draftCopy.menu.noteSoldOut
    : storeBlocked
      ? draftCopy.menu.noteStoreClosed
      : missing
        ? draftCopy.menu.noteMissingRequired(missing)
        : undefined;

  const add = async (replaceOtherStore: boolean) => {
    if (note || adding) return;
    setAdding(true);
    const result = await addToCart(
      {
        storeId: menu.storeId,
        menuId: menu.id,
        optionIds,
        quantity,
        unitPrice: unit,
        catalogRevision: menu.catalogRevision,
        menuName: menu.name,
        optionNames: selectedOptionNames(menu, selection),
        imageRef: menu.imageRef,
      },
      { replaceOtherStore },
    );
    setAdding(false);
    setOtherStoreSheet(false);

    if (result.ok) {
      // 미결정 묶음1 #4: 담기에 성공하면 이전 화면으로 돌아가 토스트 [보기]를 띄운다
      goBack();
      showToast({ message: draftCopy.menu.toastAdded, action: { label: draftCopy.menu.toastAddedAction, onPress: () => router.push('/cart') } });
      return;
    }
    if (result.reason === 'OTHER_STORE') setOtherStoreSheet(true);
    // 미결정 묶음1 #3: 같은 조합의 합계가 10을 넘으면 담지 않고 알린다. 자동으로 줄이지 않는다
    else if (result.reason === 'OVER_LIMIT') showToast({ message: draftCopy.menu.toastOverLimit, tone: 'error' });
    else if (result.reason === 'SAVE_FAILED') showToast({ message: draftCopy.cart.saveFailed, tone: 'error' });
    else showToast({ message: draftCopy.cart.storageErrorTitle, tone: 'error' });
  };

  return (
    <Screen top={top} bottom={<CtaBar label={`${formatWon(total)} 담기`} note={note} disabled={!!note} loading={adding} onPress={() => void add(false)} />}>
      <ScrollView onScroll={onScroll} scrollEventThrottle={16} showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <FoodImage uri={resolveImageUrl(menu.imageRef)} alt={menu.name} ratio="4:3" rounded={0} soldOut={menu.isSoldOut} />

        <View style={styles.head}>
          {menu.isSoldOut ? (
            <View style={styles.soldOutBadge}>
              <Badge tone="dark">품절</Badge>
            </View>
          ) : null}
          <Text style={styles.name}>{menu.name}</Text>
          {menu.description ? <Text style={styles.description}>{menu.description}</Text> : null}
          <View style={styles.price}>
            <Price amount={menu.price} />
          </View>
          <MenuReviewLine menuId={menuId} />
        </View>

        {/* 품절 메뉴는 옵션을 보여주지 않는다. 옵션이 없는 메뉴는 수량만 */}
        {!menu.isSoldOut
          ? menu.optionGroups.map((group) => {
              const current = selection[group.id] ?? [];
              const single = isSingle(group);
              const full = !single && current.length >= group.maxSelect;
              return (
                <OptionGroup
                  key={group.id}
                  name={group.name}
                  required={isRequired(group)}
                  single={single}
                  full={full}
                  rule={single ? draftCopy.menu.ruleSingle : full ? draftCopy.menu.ruleFull(group.maxSelect) : draftCopy.menu.ruleMax(group.maxSelect)}
                  options={group.options.map((o) => ({
                    id: o.id,
                    name: o.name,
                    additionalPrice: o.additionalPrice,
                    soldOut: o.isSoldOut,
                    selected: current.includes(o.id),
                    locked: o.isSoldOut || (full && !current.includes(o.id)),
                  }))}
                  onToggle={(optionId) => setSelection((prev) => toggleOption(prev, group, optionId))}
                />
              );
            })
          : null}

        {!menu.isSoldOut ? (
          <View style={styles.quantityRow}>
            <View>
              <Text style={styles.quantityLabel}>수량</Text>
              <Text style={styles.quantityHelp}>{draftCopy.menu.quantityHelp(LIMITS.quantityMax)}</Text>
            </View>
            <QuantitySelector value={quantity} onChange={setQuantity} />
          </View>
        ) : null}
      </ScrollView>

      {/* 기획서 CART-004 확정 문구 */}
      <ConfirmSheet
        visible={otherStoreSheet}
        onClose={() => setOtherStoreSheet(false)}
        message="장바구니에 다른 가게의 메뉴가 있어요. 비우고 새 메뉴를 담을까요?"
        secondary={{ label: '취소', onPress: () => setOtherStoreSheet(false) }}
        primary={{ label: '비우고 담기', onPress: () => void add(true) }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: spacing[10],
  },
  skeletons: {
    padding: spacing[5],
    gap: spacing[3],
    backgroundColor: colors.surface,
  },
  head: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[5],
  },
  soldOutBadge: {
    marginBottom: spacing[2],
  },
  name: {
    ...text.h3,
    color: colors.ink,
  },
  description: {
    ...text.body2,
    color: colors.inkSecondary,
    marginTop: spacing[1],
  },
  price: {
    marginTop: spacing[3],
  },
  quantityRow: {
    backgroundColor: colors.surface,
    borderTopWidth: 8,
    borderTopColor: colors.surfaceMuted,
    paddingHorizontal: spacing[5],
    paddingTop: spacing[4],
    paddingBottom: spacing[6],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  quantityLabel: {
    ...text.h3,
    fontSize: 17,
    color: colors.ink,
  },
  quantityHelp: {
    ...text.caption,
    fontSize: 13,
    lineHeight: 18,
    color: colors.inkTertiary,
    marginTop: 2,
  },
});
