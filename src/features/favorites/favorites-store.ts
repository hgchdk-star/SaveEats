import { create } from 'zustand';

import type { Uuid } from '@/contracts/common';
import { goLogin } from '@/features/order/pending-routes';
import { showToast } from '@/features/toast/toast-store';
import { catalogRepository } from '@/services';
import { getSession } from '@/services/session';

/**
 * 찜 상태. 가게만 찜할 수 있다 (FR-FAV-001).
 * 홈·가게 상세 어디서 눌러도 같은 상태를 보여주려고, 서버 응답 위에 "내가 방금 바꾼 값"을 덮어 쓴다.
 * 화면을 먼저 바꾸고 저장에 실패하면 되돌리고 토스트로 알린다.
 */
type FavoritesState = {
  /** 이번 실행에서 사용자가 바꾼 찜 값 */
  overrides: Record<Uuid, boolean>;
  toggle: (storeId: Uuid, desired: boolean) => Promise<void>;
};

export const useFavoritesStore = create<FavoritesState>((set, get) => ({
  overrides: {},

  toggle: async (storeId, desired) => {
    if (!getSession().isMember) {
      goLogin({ action: 'FAVORITE', storeId });
      return;
    }
    const previous = get().overrides[storeId];
    set((s) => ({ overrides: { ...s.overrides, [storeId]: desired } }));
    try {
      await catalogRepository.setFavorite(storeId, desired);
    } catch {
      set((s) => {
        const overrides = { ...s.overrides };
        if (previous === undefined) delete overrides[storeId];
        else overrides[storeId] = previous;
        return { overrides };
      });
      showToast({ message: '찜을 저장하지 못했어요. 다시 시도해주세요.', tone: 'error' });
    }
  },
}));

/** 서버가 준 찜 값(Guest면 null) 위에 방금 바꾼 값을 얹어서 돌려준다 */
export function useFavorite(storeId: Uuid, serverValue: boolean | null) {
  const override = useFavoritesStore((s) => s.overrides[storeId]);
  const toggle = useFavoritesStore((s) => s.toggle);
  return { value: override ?? serverValue, toggle: (next: boolean) => void toggle(storeId, next) };
}
