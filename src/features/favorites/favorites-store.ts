import { create } from 'zustand';

import type { Uuid } from '@/contracts/common';
import { draftCopy } from '@/config/draft-copy';
import { goLogin } from '@/features/order/flow-routes';
import { showToast } from '@/features/toast/toast-store';
import { catalogRepository } from '@/services';
import { getSession } from '@/services/session';

/**
 * 찜 상태. 가게만 찜할 수 있다 (FR-FAV-001).
 * 홈 · 검색 · 카테고리 · 가게 상세 · 찜 목록이 모두 같은 값을 보도록, 서버 응답 위에 "내가 방금 바꾼 값"을 덮어 쓴다 (favoriteStoreIds).
 * 화면을 먼저 바꾸고 목표값(desired)을 저장한다. 같은 값을 두 번 보내도 결과가 같다. 실패하면 되돌리고 토스트로 알린다.
 */
type FavoritesState = {
  /** 이번 로그인 동안 사용자가 바꾼 찜 값 */
  overrides: Record<Uuid, boolean>;
  toggle: (storeId: Uuid, desired: boolean) => Promise<void>;
  /** 로그아웃·계정 전환: 이전 사용자의 찜 표시를 지운다 (AUTH-004) */
  reset: () => void;
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
    const ownerAtStart = getSession().userId;
    try {
      await catalogRepository.setFavorite(storeId, desired);
    } catch {
      // 그 사이 계정이 바뀌었으면 이전 계정의 결과를 현재 화면에 반영하지 않는다 (AUTH-004)
      if (getSession().userId !== ownerAtStart) return;
      set((s) => {
        const overrides = { ...s.overrides };
        if (previous === undefined) delete overrides[storeId];
        else overrides[storeId] = previous;
        return { overrides };
      });
      showToast({ message: desired ? draftCopy.favorites.saveFailed : draftCopy.favorites.removeFailed, tone: 'error' });
    }
  },

  reset: () => set({ overrides: {} }),
}));

/** 서버가 준 찜 값(Guest면 null) 위에 방금 바꾼 값을 얹어서 돌려준다 */
export function useFavorite(storeId: Uuid, serverValue: boolean | null) {
  const override = useFavoritesStore((s) => s.overrides[storeId]);
  const toggle = useFavoritesStore((s) => s.toggle);
  return { value: override ?? serverValue, toggle: (next: boolean) => void toggle(storeId, next) };
}
