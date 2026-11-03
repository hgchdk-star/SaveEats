import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { TextButton } from '@/components/ui/button';
import { AccountDestinationCard } from '@/components/ui/account-destination-card';
import { OrderCtaBar } from '@/components/ui/cta-bar';
import { Notice } from '@/components/ui/notice';
import { OrderSummary } from '@/components/ui/order-summary';
import { Disclosure, OrderItemsCard } from '@/components/ui/order-info';
import { Screen } from '@/components/ui/screen';
import { TopNavigation } from '@/components/ui/top-navigation';
import { confirmedCopy } from '@/config/confirmed-copy';
import { draftCopy } from '@/config/draft-copy';
import { ctaNoteFor } from '@/features/cart/cart-block-copy';
import { cartTotal, checkoutBlock, type CartItem } from '@/features/cart/cart-model';
import { useCartStore } from '@/features/cart/cart-store';
import { useAsync } from '@/hooks/use-async';
import type { MockOrder } from '@/mocks/order/types';
import { catalogRepository } from '@/services';
import { resolveImageUrl } from '@/services/image';
import { useSession } from '@/services/session';
import { colors, radius, spacing, text } from '@/theme';
import { formatWon } from '@/utils/format';

import { goHistory, goOrderDetail } from './flow-routes';
import { createOrder, enterConfirm, leaveConfirm, recheckCreate, startNewOrderAfterConflict } from './order-actions';
import { useOrderFlowStore } from './order-flow-store';

const copy = draftCopy.confirm;

/** 승인한 메뉴·옵션·가격과 돈이 배달될 곳을 한 번 더 보여주고, 고지를 확인한 뒤 주문한다 (기획서 19 · ORD-004) */
export function OrderConfirmScreen() {
  const { destinationAccount } = useSession();
  const cart = useCartStore((s) => s.cart);
  const validation = useCartStore((s) => s.validation);
  const work = useOrderFlowStore((s) => s.work);
  const rejectedReason = useOrderFlowStore((s) => s.rejectedReason);
  const conflictOrder = useOrderFlowStore((s) => s.conflictOrder);

  const store = useAsync(`confirm-store:${cart.storeId}`, () =>
    cart.storeId ? catalogRepository.getStore(cart.storeId) : Promise.reject(new Error('no store')),
  );

  // 들어올 때 이전 시도의 흔적을 지우고(결과를 모르는 시도는 남긴다), 가격·품절을 서버에서 다시 확인한다
  useFocusEffect(
    useCallback(() => {
      enterConfirm();
      void useCartStore.getState().validate();
    }, []),
  );

  const saving = work === 'CREATE_SAVING';
  const block = checkoutBlock(cart, validation);
  const total = cartTotal(cart);
  const totalLabel = formatWon(total);

  // 담긴 내용은 그대로 두고, 주문을 막는 이유가 있으면 알린다. 가격 변경·품절은 장바구니에서 풀어야 한다
  const mustFixInCart = block.blocked && ['PRICE_CHANGED', 'SOLD_OUT', 'INACTIVE_ENTITY', 'OPTIONS_INVALID', 'STORE_CLOSED'].includes(block.reason);
  const disabled = !destinationAccount || block.blocked || work === 'CREATE_REJECTED' || work === 'CREATE_CONFLICT' || work === 'CREATE_UNKNOWN' || saving;

  const back = () => {
    if (saving) return;
    leaveConfirm();
    router.back();
  };

  const order = (via: 'TOSS' | 'DIRECT') => {
    if (disabled || !destinationAccount) return;
    void createOrder(via, cart, destinationAccount);
  };

  const editAccount = () => {
    if (saving) return;
    router.push({ pathname: '/account/form', params: { mode: destinationAccount ? 'change' : 'register', from: 'order' } });
  };

  const notice = (() => {
    if (work === 'CREATE_UNKNOWN') {
      return <Notice flush tone="danger" title={copy.createUnknownTitle} description={copy.createUnknownDesc} action={{ label: copy.createUnknownAction, onPress: () => void recheckCreate() }} />;
    }
    if (work === 'LOCAL_PERSISTENCE_FAILED') {
      return <Notice flush tone="danger" title={copy.localSaveFailedTitle} description={copy.localSaveFailedDesc} />;
    }
    if (work === 'CREATE_CONFLICT') {
      // 키로 조회한 기존 주문은 방금 확인한 주문과 내용이 다르다. 이어가지 않고 따로 알린다. 장바구니는 그대로다
      const existing = conflictOrder;
      return (
        <>
          <Notice
            flush
            tone="danger"
            title={copy.conflictTitle}
            description={existing ? copy.conflictDesc : copy.conflictLoadFailed}
            action={{ label: existing ? copy.conflictView : copy.conflictViewHistory, onPress: () => (existing ? goOrderDetail(existing.orderId) : goHistory()) }}
          />
          {/* 기존 주문의 실제 상태·가게·메뉴·금액은 본문과 따로 보여 준다. 사용자가 직접 확인한다 */}
          {existing ? (
            <View style={styles.conflictOrder}>
              <Text style={styles.conflictStatus}>{copy.conflictStatus[existing.status]}</Text>
              <Text style={styles.conflictLine}>{existing.snapshot.storeName}</Text>
              {menuSummary(existing) ? <Text style={styles.conflictLine}>{menuSummary(existing)}</Text> : null}
              <Text style={styles.conflictLine}>{formatWon(existing.approvedTotalAmount)}</Text>
            </View>
          ) : null}
          <View style={styles.conflictAction}>
            {/* 새 주문은 장바구니에서 최종 금액·고지를 다시 확인한 뒤 사용자가 직접 주문할 때 새 키로 만든다. 자동으로 다시 보내지 않는다 */}
            <TextButton
              size="sm"
              onPress={() => {
                startNewOrderAfterConflict();
                router.dismissTo('/cart');
              }}>
              {copy.conflictToCart}
            </TextButton>
          </View>
        </>
      );
    }
    if (work === 'CREATE_REJECTED') {
      if (rejectedReason === 'DISCLOSURE_VERSION_UNSUPPORTED') {
        // 앱을 새로 받아야 주문할 수 있다. 장바구니 문제가 아니라서 장바구니로 보내지 않는다
        return <Notice flush tone="danger" title={copy.updateRequiredTitle} description={copy.updateRequiredDesc} />;
      }
      const accountProblem = rejectedReason === 'ACCOUNT_REQUIRED' || rejectedReason === 'ACCOUNT_REVISION_CONFLICT';
      const quantityProblem = rejectedReason === 'QUANTITY_LIMIT_EXCEEDED';
      return (
        <Notice
          flush
          tone="danger"
          title={accountProblem ? copy.accountRequiredTitle : quantityProblem ? copy.quantityLimitTitle : copy.rejectedTitle}
          description={accountProblem ? copy.accountRequiredDesc : quantityProblem ? copy.quantityLimitDesc : copy.rejectedDesc}
          action={accountProblem ? undefined : { label: copy.rejectedAction, onPress: () => router.dismissTo('/cart') }}
        />
      );
    }
    if (mustFixInCart) {
      return <Notice flush tone="danger" title={copy.rejectedTitle} description={copy.rejectedDesc} action={{ label: copy.rejectedAction, onPress: () => router.dismissTo('/cart') }} />;
    }
    return null;
  })();

  return (
    <Screen
      top={<TopNavigation divider title={copy.title} onBack={back} leadingDisabled={saving} />}
      bottom={
        <OrderCtaBar
          amount={total}
          label={copy.cta(totalLabel)}
          // 주문하기가 막힌 이유가 있으면 그 한 줄을, 아니면 고지와 같은 문장을 보여준다 (DS OrderCTA confirm)
          note={block.blocked ? ctaNoteFor(block) : `${confirmedCopy.disclosureTitle} ${confirmedCopy.disclosureBody(totalLabel)}`}
          disabled={disabled}
          loading={saving}
          onPress={() => order('TOSS')}
          sub={{ label: copy.otherWay, onPress: () => order('DIRECT'), disabled: disabled }}
        />
      }>
      <ScrollView contentContainerStyle={styles.content}>
        {notice}

        <View>
          <Text style={styles.sectionLabel}>{copy.itemsLabel}</Text>
          <OrderItemsCard
            storeName={store.status === 'ok' ? store.data.name : undefined}
            storeImageUri={store.status === 'ok' ? resolveImageUrl(store.data.imageRef) : null}
            items={cart.items.map(toRow)}
          />
        </View>

        <View>
          <Text style={styles.sectionLabel}>{copy.destinationLabel}</Text>
          {/* 누르면 계좌를 바꾸고, 돌아와서 다시 확인한다 */}
          <AccountDestinationCard account={destinationAccount} onPress={editAccount} />
        </View>

        <OrderSummary total={total} />

        <Disclosure title={confirmedCopy.disclosureTitle} body={confirmedCopy.disclosureBody(totalLabel)} />
      </ScrollView>
    </Screen>
  );
}

/** 기존 주문의 메뉴를 한 줄로: 첫 메뉴 이름 + 나머지 개수 */
function menuSummary(order: MockOrder): string {
  const [first, ...rest] = order.snapshot.items;
  if (!first) return '';
  return rest.length > 0 ? `${first.menuName} 외 ${rest.length}개` : first.menuName;
}

function toRow(item: CartItem) {
  return {
    key: item.clientItemId,
    name: item.menuName,
    optionText: item.optionNames.join(' · '),
    lineTotal: item.acknowledgedUnitPrice * item.quantity,
    quantity: item.quantity,
  };
}

const styles = StyleSheet.create({
  conflictOrder: {
    gap: spacing[1],
    padding: spacing[4],
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  conflictStatus: {
    ...text.label,
    color: colors.ink,
  },
  conflictLine: {
    ...text.body2,
    color: colors.inkSecondary,
  },
  conflictAction: {
    alignItems: 'flex-start',
    marginTop: -spacing[3],
  },
  content: {
    padding: spacing[5],
    gap: spacing[5],
  },
  sectionLabel: {
    ...text.label,
    color: colors.inkSecondary,
    marginBottom: spacing[2],
  },
});
