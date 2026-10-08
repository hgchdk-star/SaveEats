import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { LIMITS } from '@/config/limits';
import type { Uuid } from '@/contracts/common';

/**
 * 최근 본 가게·메뉴 (기획서 11.3 · FR-HOME-008~011).
 * 가게와 메뉴를 한 목록에 함께 두고, 합쳐서 최대 10개. 다시 보면 맨 앞으로 온다.
 * 이 기기에만 저장하고 계정과 섞지 않는다.
 */
const STORAGE_KEY = 'saveeats.recentViewed.v1';

export type RecentViewedItem = { type: 'STORE' | 'MENU'; id: Uuid };

type RecentViewedState = {
  items: RecentViewedItem[];
  hydrate: () => Promise<void>;
  add: (item: RecentViewedItem) => void;
  /** 서버가 더 이상 내려주지 않는(비활성·삭제) 항목을 지운다 */
  drop: (items: RecentViewedItem[]) => void;
};

const same = (a: RecentViewedItem, b: RecentViewedItem) => a.type === b.type && a.id === b.id;

function isItem(value: unknown): value is RecentViewedItem {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return (item.type === 'STORE' || item.type === 'MENU') && typeof item.id === 'string';
}

function persist(items: RecentViewedItem[]) {
  // 저장에 실패해도 탐색을 막지 않는다. 다음에 볼 때 다시 저장된다
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items)).catch(() => undefined);
}

export const useRecentViewedStore = create<RecentViewedState>((set, get) => ({
  items: [],

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) set({ items: parsed.filter(isItem).slice(0, LIMITS.recentViewedMax) });
    } catch {
      // 읽지 못하면 기록 없음으로 시작한다
    }
  },

  add: (item) => {
    const items = [item, ...get().items.filter((it) => !same(it, item))].slice(0, LIMITS.recentViewedMax);
    set({ items });
    persist(items);
  },

  drop: (gone) => {
    if (gone.length === 0) return;
    const items = get().items.filter((it) => !gone.some((g) => same(g, it)));
    set({ items });
    persist(items);
  },
}));
