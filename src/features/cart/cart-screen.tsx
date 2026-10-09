import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ConfirmSheet } from '@/components/ui/bottom-sheet';
import { SecondaryButton, TextButton } from '@/components/ui/button';
import { CartItem } from '@/components/ui/cart-item';
import { OrderCtaBar } from '@/components/ui/cta-bar';
import { EmptyState, ErrorState } from '@/components/ui/feedback-states';
import { FoodImage } from '@/components/ui/food-image';
import { Icon } from '@/components/ui/icon';
import { Notice } from '@/components/ui/notice';
import { OrderSummary } from '@/components/ui/order-summary';
import { Screen } from '@/components/ui/screen';
import { TopNavigation } from '@/components/ui/top-navigation';
import { confirmedCopy } from '@/config/confirmed-copy';
import { draftCopy } from '@/config/draft-copy';
import { goAccountRegisterForOrder, goLogin, goOrderConfirm } from '@/features/order/flow-routes';
import { showToast } from '@/features/toast/toast-store';
import { useAsync } from '@/hooks/use-async';
import { catalogRepository } from '@/services';
import { resolveImageUrl } from '@/services/image';
import { useSession } from '@/services/session';
import { colors, spacing, text } from '@/theme';

import { ctaNoteFor, noticeFor } from './cart-block-copy';
import { cartTotal, checkoutBlock, isPriceChanged, validationOf, type CartItem as CartItemData, type CartValidation } from './cart-model';
import { useCartStore } from './cart-store';

type SheetKind = 'clear' | 'needAccount' | null;

export function CartScreen() {
  const router = useRouter();
  const status = useCartStore((s) => s.status);
  const cart = useCartStore((s) => s.cart);
  const validation = useCartStore((s) => s.validation);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const session = useSession();
  const params = useLocalSearchParams<{ sheet?: string }>();

  // 화면에 들어올 때마다 가격·품절을 서버에서 다시 확인한다. 담긴 내용은 그대로 두고 주문만 막는다 (CART-008)
  // 로그인하고 돌아왔는데 계좌가 없으면 '계좌 필요' 시트를 바로 보여준다 (로그인 성공만으로 주문을 만들지 않는다, AUTH-003)
  useFocusEffect(
    useCallback(() => {
      void useCartStore.getState().validate();
      if (params.sheet === 'needAccount') {
        setSheet('needAccount');
        router.setParams({ sheet: undefined });
      }
    }, [params.sheet, router]),
  );

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const hasItems = cart.items.length > 0;

  const save = async (job: Promise<{ ok: boolean }>) => {
    const result = await job;
    if (!result.ok) showToast({ message: draftCopy.cart.saveFailed, tone: 'error' });
  };

  const top = (
    <TopNavigation
      divider
      title="장바구니"
      onBack={goBack}
      actions={hasItems ? <TextButton size="sm" onPress={() => setSheet('clear')}>전체 삭제</TextButton> : undefined}
    />
  );

  // 저장된 장바구니를 읽을 수 없으면 조용히 지우지 않고 사용자가 비우기를 고르게 한다 (CART-003)
  if (status === 'STORAGE_ERROR') {
    return (
      <Screen top={top}>
        <View style={styles.centered}>
          <ErrorState title={draftCopy.cart.storageErrorTitle} description={draftCopy.cart.storageErrorDesc} />
          <View style={styles.centeredAction}>
            <SecondaryButton onPress={() => void save(useCartStore.getState().resetStorage())}>{draftCopy.cart.storageErrorAction}</SecondaryButton>
          </View>
        </View>
      </Screen>
    );
  }

  if (!hasItems) {
    // 빈 장바구니는 CTA 바가 없고 주문 화면으로 갈 수 없다 (AC-CART-007)
    return (
      <Screen top={top}>
        <View style={styles.empty}>
          <EmptyState
            icon="cart"
            title={draftCopy.cart.emptyTitle}
            description={draftCopy.cart.emptyDescription}
            action={<SecondaryButton onPress={() => router.navigate('/')}>{draftCopy.cart.emptyAction}</SecondaryButton>}
          />
        </View>
      </Screen>
    );
  }

  const block = checkoutBlock(cart, validation);
  const notice = noticeFor(block, {
    acknowledge: () => void useCartStore.getState().acknowledgePrices(),
    retry: () => void useCartStore.getState().validate(),
  });
  const ctaNote = ctaNoteFor(block);

  const order = () => {
    if (block.blocked) return;
    if (!session.isMember) goLogin({ action: 'ORDER' });
    else if (!session.destinationAccount) setSheet('needAccount');
    else goOrderConfirm();
  };

  return (
    <Screen top={top} bottom={<OrderCtaBar amount={cartTotal(cart)} note={ctaNote} disabled={block.blocked} onPress={order} />}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {notice ? <Notice {...notice} /> : null}

        <View style={[styles.body, notice && styles.bodyAfterNotice]}>
          <StoreRow storeId={cart.storeId} onPress={() => cart.storeId && openStore(router, cart.storeId)} />

          {cart.items.map((item) => (
            <CartRow
              key={item.clientItemId}
              item={item}
              validation={validation}
              onChangeQuantity={(n) => void save(useCartStore.getState().setQuantity(item.clientItemId, n))}
              onRemove={() => void save(useCartStore.getState().remove(item.clientItemId))}
            />
          ))}

          {/* 장바구니에서 옵션을 바꾸는 진입 UI는 두지 않는다 (미결정 묶음1 #6, UNDECIDED.cartOptionEditEntry = false) */}
          <View style={styles.more}>
            <SecondaryButton block icon="plus" onPress={() => cart.storeId && openStore(router, cart.storeId)}>
              메뉴 더 담기
            </SecondaryButton>
          </View>
        </View>

        <View style={styles.summary}>
          <OrderSummary total={cartTotal(cart)} />
        </View>
      </ScrollView>

      <ConfirmSheet
        visible={sheet === 'clear'}
        onClose={() => setSheet(null)}
        title={draftCopy.cart.clearTitle}
        descriptions={[draftCopy.cart.clearDesc]}
        secondary={{ label: '취소', onPress: () => setSheet(null) }}
        primary={{
          label: draftCopy.cart.clearConfirm,
          onPress: () => {
            setSheet(null);
            void save(useCartStore.getState().clear());
          },
        }}
      />

      {/* 기획서 10.1 확정 문구. 계좌를 등록하면 장바구니를 그대로 둔 채 최종 주문 확인으로 돌아온다 */}
      <ConfirmSheet
        visible={sheet === 'needAccount'}
        onClose={() => setSheet(null)}
        title={confirmedCopy.needAccountTitle}
        descriptions={[confirmedCopy.needAccountDesc]}
        secondary={{ label: '취소', onPress: () => setSheet(null) }}
        primary={{
          label: confirmedCopy.needAccountAction,
          onPress: () => {
            setSheet(null);
            goAccountRegisterForOrder();
          },
        }}
      />
    </Screen>
  );
}

function openStore(router: ReturnType<typeof useRouter>, storeId: string) {
  router.push({ pathname: '/store/[storeId]', params: { storeId } });
}

/** 장바구니 가게 줄. 가게 이름은 장바구니에 저장하지 않고 카탈로그에서 가져온다 */
function StoreRow({ storeId, onPress }: { storeId: string | null; onPress: () => void }) {
  const store = useAsync(`cart-store:${storeId}`, () => (storeId ? catalogRepository.getStore(storeId) : Promise.reject(new Error('no store'))));
  if (store.status !== 'ok') return <View style={styles.storeRowEmpty} />;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${store.data.name} 가게로 이동`} onPress={onPress} style={styles.storeRow}>
      <FoodImage uri={resolveImageUrl(store.data.imageRef)} width={40} rounded={6} />
      <Text style={styles.storeName}>{store.data.name}</Text>
      <Icon name="chevronRight" size={20} color={colors.inkTertiary} />
    </Pressable>
  );
}

function CartRow({
  item,
  validation,
  onChangeQuantity,
  onRemove,
}: {
  item: CartItemData;
  validation: CartValidation;
  onChangeQuantity: (next: number) => void;
  onRemove: () => void;
}) {
  const v = validationOf(validation, item.clientItemId);
  const changed = isPriceChanged(item, validation);

  let error: string | undefined;
  let soldOut = false;
  if (v?.status === 'MENU_SOLD_OUT') {
    error = draftCopy.cart.itemMenuSoldOut;
    soldOut = true;
  } else if (v?.status === 'OPTION_SOLD_OUT') {
    error = draftCopy.cart.itemOptionSoldOut(v.soldOutOptionName ?? '');
    soldOut = true;
  } else if (v?.status === 'INACTIVE_ENTITY') {
    error = draftCopy.cart.itemInactive;
  } else if (v?.status === 'OPTIONS_INVALID') {
    // 옵션을 다시 고르는 화면은 이번에 없다. 삭제만 할 수 있다
    error = draftCopy.cart.itemOptionsInvalid;
  }

  return (
    <CartItem
      name={item.menuName}
      optionNames={item.optionNames}
      imageUri={resolveImageUrl(item.imageRef)}
      quantity={item.quantity}
      unitPrice={item.acknowledgedUnitPrice}
      soldOut={soldOut}
      error={error}
      priceChange={
        changed && v
          ? { from: item.acknowledgedUnitPrice * item.quantity, to: v.currentUnitPrice * item.quantity, label: draftCopy.cart.priceChangedLine }
          : undefined
      }
      onChangeQuantity={onChangeQuantity}
      onRemove={onRemove}
    />
  );
}


const styles = StyleSheet.create({
  centered: {
    paddingTop: spacing[10],
    alignItems: 'center',
  },
  centeredAction: {
    marginTop: -spacing[6],
  },
  empty: {
    paddingTop: 56,
  },
  content: {
    paddingTop: spacing[4],
    paddingBottom: spacing[6],
  },
  body: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing[5],
    paddingBottom: spacing[4],
  },
  bodyAfterNotice: {
    marginTop: spacing[4],
  },
  storeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  storeRowEmpty: {
    height: spacing[2],
  },
  storeName: {
    ...text.title,
    flex: 1,
    color: colors.ink,
  },
  more: {
    paddingTop: spacing[4],
  },
  summary: {
    paddingHorizontal: spacing[5],
    paddingTop: spacing[4],
  },
});
