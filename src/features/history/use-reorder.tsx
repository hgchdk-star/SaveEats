import { router } from 'expo-router';
import { useRef, useState } from 'react';

import { ConfirmSheet } from '@/components/ui/bottom-sheet';
import { draftCopy } from '@/config/draft-copy';
import { LIMITS } from '@/config/limits';
import { UNDECIDED } from '@/config/undecided';
import { createSingleFlight } from '@/features/cart/quick-add';
import { useCartStore } from '@/features/cart/cart-store';
import { showToast } from '@/features/toast/toast-store';
import type { MockHistoryRow } from '@/mocks/history/types';
import { catalogRepository } from '@/services';
import { isRepositoryError } from '@/services/catalog/catalog-repository';

import { reorderLines, type ReorderOutcome } from './reorder';

/** 같은 주문 담기 결과를 사용자에게 알린다. 실패에는 성공 문구를 쓰지 않는다 */
function announce(outcome: ReorderOutcome): void {
  const history = draftCopy.history;
  if (outcome.kind === 'ADDED') {
    showToast({
      message: outcome.priceChanged ? history.reorderAddedPriceChanged : history.reorderAdded,
      action: { label: history.reorderAddedAction, onPress: () => router.push('/cart') },
    });
    return;
  }
  if (outcome.kind === 'OTHER_STORE') return;
  const message = {
    MENU_UNAVAILABLE: history.reorderMenuUnavailable,
    MENU_SOLD_OUT: history.reorderSoldOut,
    STORE_CLOSED: draftCopy.menu.noteStoreClosed,
    OPTION_UNAVAILABLE: history.reorderOptionUnavailable,
    OPTION_SOLD_OUT: history.reorderOptionSoldOut,
    OPTIONS_CHANGED: history.reorderOptionsChanged,
    OPTION_INFO_MISSING: history.reorderOptionInfoMissing,
    LOAD_FAILED: draftCopy.menu.quickAddLoadFailed,
    OVER_LIMIT: draftCopy.menu.toastOverLimit,
    OVER_KINDS: draftCopy.menu.toastOverKinds(LIMITS.cartLineKindsMax),
    SAVE_FAILED: draftCopy.cart.saveFailed,
    NOT_READY: draftCopy.cart.storageErrorTitle,
  }[outcome.reason];
  showToast({ message, tone: 'error' });
}

/**
 * 내역의 '같은 주문 담기'. 한 번에 한 주문만 처리하고(처리 중 연속 터치는 무시), 다른 가게 메뉴가 담겨 있으면 확인 시트를 거쳐 교체한다.
 * 담는 로직은 reorderLines(순수)와 장바구니 store.addMany가 맡는다.
 */
export function useReorder() {
  const addMany = useCartStore((s) => s.addMany);
  const flight = useRef(createSingleFlight()).current;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [replaceFor, setReplaceFor] = useState<MockHistoryRow | null>(null);

  const run = async (row: MockHistoryRow, replaceOtherStore = false) => {
    if (!flight.tryStart(row.orderId)) return;
    setBusyId(row.orderId);
    let outcome: ReorderOutcome;
    try {
      outcome = await reorderLines(
        row.snapshot.items,
        {
          getMenu: (id) => catalogRepository.getMenu(id),
          addMany,
          preparingStoreOrderable: UNDECIDED.preparingStoreOrderable,
          isNotFound: (error) => isRepositoryError(error) && error.failure.code === 'RESOURCE_NOT_FOUND',
        },
        { replaceOtherStore },
      );
    } catch {
      outcome = { kind: 'FAILED', reason: 'SAVE_FAILED' };
    } finally {
      flight.finish();
      setBusyId(null);
    }
    setReplaceFor(null);
    if (outcome.kind === 'OTHER_STORE') setReplaceFor(row);
    else announce(outcome);
  };

  const sheet = (
    <ConfirmSheet
      visible={replaceFor !== null}
      onClose={() => setReplaceFor(null)}
      message="장바구니에 다른 가게의 메뉴가 있어요. 비우고 새 메뉴를 담을까요?"
      secondary={{ label: '취소', onPress: () => setReplaceFor(null) }}
      primary={{ label: '비우고 담기', onPress: () => (replaceFor ? void run(replaceFor, true) : undefined) }}
    />
  );

  return { reorder: (row: MockHistoryRow) => void run(row), busyId, sheet };
}
