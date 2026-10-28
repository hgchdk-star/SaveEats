import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { LIMITS } from '@/config/limits';
import { draftCopy } from '@/config/draft-copy';
import type { MockHistoryRow, MockMonthlySummary, MockUnreadSummary } from '@/mocks/history/types';
import { loadConfirmQueue } from '@/features/order/order-persistence';
import { showToast } from '@/features/toast/toast-store';
import { historyService } from '@/services';
import { userScopedKey } from '@/services/session';
import { monthKeyOf } from '@/utils/date';

import { hasUnreadUpdate, mergeLatest } from './history-model';

/**
 * 내역 목록과 읽지 않음 상태.
 *
 * - 목록은 만든 시각 최신순 고정. 첫 페이지 실패는 전체 오류, 다음 페이지 실패는 기존 목록을 두고 같은 cursor로 다시 시도 (HIST-003)
 * - 내역 탭의 점은 불러온 페이지가 아니라 서버가 알려준 "모든 본인 주문의 읽지 않은 이벤트"로 정한다 (HIST-005)
 * - 읽음은 화면에 먼저 반영하고(overlay) 서버에는 그 이벤트 id만 보낸다. 저장이 실패해도 알리지 않고 조용히 다시 시도한다 (HIST-007)
 */
const PENDING_READ_BASE = 'saveeats.history.pendingRead.v2';
/** 읽음 대기 목록은 사용자별로 나눠 저장한다 (AUTH-004) */
const PENDING_READ_KEY = () => userScopedKey(PENDING_READ_BASE);

type Load = 'idle' | 'loading' | 'ok' | 'error';
type UnreadEvents = MockUnreadSummary['unreadEvents'];

type HistoryState = {
  load: Load;
  rows: MockHistoryRow[];
  nextCursor: string | null;
  hasMore: boolean;
  pageLoad: 'idle' | 'loading' | 'error';
  summary: MockMonthlySummary | null;
  summaryLoad: Load;
  /** 서버가 알려준 읽지 않은 이벤트. 아직 모르면 null */
  unread: UnreadEvents | null;
  /** 읽음 처리했지만 서버 저장이 끝나지 않은 이벤트 id */
  pendingReadIds: Record<string, true>;
  /** 서버에 아직 저장하지 못한 완료 확인이 있는 주문 */
  queuedConfirmOrderId: string | null;

  loadFirst: (opts?: { refresh?: boolean }) => Promise<void>;
  refreshLatest: () => Promise<void>;
  loadMore: () => Promise<void>;
  loadSummary: () => Promise<void>;
  refreshUnread: () => Promise<void>;
  markRead: (eventIds: string[]) => void;
  /** 앱을 켤 때: 저장돼 있던 읽음 대기 목록과 완료 확인 큐 여부를 읽고, 남은 읽음을 서버에 보낸다 */
  hydrateLocal: () => Promise<void>;
  refreshQueue: () => Promise<void>;
  replaceRow: (row: MockHistoryRow) => void;
  reset: () => void;
};

/** 첫 페이지를 다시 받으면 올라가는 번호. 늦게 온 이전 응답은 버린다 */
let listGeneration = 0;

function persistPending(pending: Record<string, true>) {
  // 저장에 실패해도 화면은 읽음 그대로 둔다. 다시 켰을 때 점이 다시 보일 수 있는 한계가 있다
  AsyncStorage.setItem(PENDING_READ_KEY(), JSON.stringify(Object.keys(pending))).catch(() => undefined);
}

export const useHistoryStore = create<HistoryState>((set, get) => {
  const sendRead = (ids: string[], attempt: number) => {
    historyService.markStatusUpdatesViewed(ids).then(
      () => {
        set((s) => {
          const pending = { ...s.pendingReadIds };
          for (const id of ids) delete pending[id];
          persistPending(pending);
          return {
            pendingReadIds: pending,
            unread: s.unread ? s.unread.filter((e) => !ids.includes(e.eventId)) : s.unread,
            rows: s.rows.map((r) => (r.unreadUpdates.some((u) => ids.includes(u.eventId)) ? { ...r, unreadUpdates: r.unreadUpdates.filter((u) => !ids.includes(u.eventId)) } : r)),
          };
        });
      },
      () => {
        // 알리지 않는다. 1·2·4초 뒤에 같은 id로 다시 보내고, 그래도 안 되면 읽음 표시는 둔 채 다음에 다시 보낸다
        const delay = LIMITS.readRetryDelaysMs[attempt];
        if (delay !== undefined) setTimeout(() => sendRead(ids, attempt + 1), delay);
      },
    );
  };

  return {
    load: 'idle',
    rows: [],
    nextCursor: null,
    hasMore: false,
    pageLoad: 'idle',
    summary: null,
    summaryLoad: 'idle',
    unread: null,
    pendingReadIds: {},
    queuedConfirmOrderId: null,

    loadFirst: async ({ refresh = false } = {}) => {
      const gen = ++listGeneration;
      const keepRows = refresh && get().load === 'ok' && get().rows.length > 0;
      if (!keepRows) set({ load: 'loading', pageLoad: 'idle' });
      try {
        const page = await historyService.listMyOrders({ cursor: null, pageSize: LIMITS.historyPageSize });
        if (gen !== listGeneration) return;
        set({ load: 'ok', rows: page.rows, nextCursor: page.nextCursor, hasMore: page.hasMore, pageLoad: 'idle' });
      } catch {
        if (gen !== listGeneration) return;
        // 새로 고침이 실패하면 기존 목록을 두고 가볍게 알린다. 처음 불러오는 것이 실패하면 전체 오류
        if (keepRows) showToast({ message: draftCopy.history.refreshFailed });
        else set({ load: 'error' });
      }
      void get().refreshUnread();
    },

    refreshLatest: async () => {
      if (get().load !== 'ok') return;
      const gen = listGeneration;
      try {
        const page = await historyService.listMyOrders({ cursor: null, pageSize: LIMITS.historyPageSize });
        if (gen !== listGeneration) return;
        set((s) => ({ rows: mergeLatest(s.rows, page.rows) }));
      } catch {
        // 조용한 새로고침이므로 실패해도 화면에 알리지 않는다
      }
    },

    loadMore: async () => {
      const { load, hasMore, pageLoad, nextCursor } = get();
      if (load !== 'ok' || !hasMore || pageLoad === 'loading' || !nextCursor) return; // cursor마다 요청은 하나
      const gen = listGeneration;
      set({ pageLoad: 'loading' });
      try {
        const page = await historyService.listMyOrders({ cursor: nextCursor, pageSize: LIMITS.historyPageSize });
        if (gen !== listGeneration) return;
        set((s) => {
          const seen = new Set(s.rows.map((r) => r.orderId));
          return { rows: [...s.rows, ...page.rows.filter((r) => !seen.has(r.orderId))], nextCursor: page.nextCursor, hasMore: page.hasMore, pageLoad: 'idle' };
        });
      } catch {
        // cursor를 앞으로 보내지 않는다. 같은 cursor로 다시 시도한다
        if (gen === listGeneration) set({ pageLoad: 'error' });
      }
    },

    loadSummary: async () => {
      set({ summaryLoad: 'loading' });
      try {
        const summary = await historyService.getMonthlySummary(monthKeyOf(Date.now()));
        set({ summary, summaryLoad: 'ok' });
      } catch {
        set({ summaryLoad: 'error' });
      }
    },

    refreshUnread: async () => {
      try {
        const summary = await historyService.getHistoryUnreadSummary();
        set((s) => {
          // 다른 기기에서 이미 읽은 것은 읽음 대기 목록에서도 뺀다
          const stillUnread = new Set(summary.unreadEvents.map((e) => e.eventId));
          const pending = Object.fromEntries(Object.keys(s.pendingReadIds).filter((id) => stillUnread.has(id)).map((id) => [id, true as const]));
          if (Object.keys(pending).length !== Object.keys(s.pendingReadIds).length) persistPending(pending);
          return { unread: summary.unreadEvents, pendingReadIds: pending };
        });
      } catch {
        // 값을 확인하지 못하면 기존 값을 둔다. 모르는 값을 0으로 확정하지 않는다
      }
    },

    markRead: (eventIds) => {
      const fresh = eventIds.filter((id) => !get().pendingReadIds[id]);
      if (fresh.length === 0) return;
      set((s) => {
        const pending = { ...s.pendingReadIds, ...Object.fromEntries(fresh.map((id) => [id, true as const])) };
        persistPending(pending);
        return { pendingReadIds: pending };
      });
      sendRead(fresh, 0);
    },

    hydrateLocal: async () => {
      try {
        const raw = await AsyncStorage.getItem(PENDING_READ_KEY());
        const ids = (raw ? (JSON.parse(raw) as unknown) : []) as unknown;
        const list = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [];
        if (list.length > 0) {
          set((s) => ({ pendingReadIds: { ...s.pendingReadIds, ...Object.fromEntries(list.map((id) => [id, true as const])) } }));
          for (let i = 0; i < list.length; i += 100) sendRead(list.slice(i, i + 100), 0); // 한 번에 최대 100개
        }
      } catch {
        // 읽지 못하면 대기 목록 없이 시작한다
      }
      await get().refreshQueue();
    },

    refreshQueue: async () => {
      const queue = await loadConfirmQueue();
      set({ queuedConfirmOrderId: queue?.orderId ?? null });
    },

    replaceRow: (row) => set((s) => ({ rows: s.rows.map((r) => (r.orderId === row.orderId && row.statusRevision >= r.statusRevision ? row : r)) })),

    reset: () => {
      listGeneration += 1;
      set({ load: 'idle', rows: [], nextCursor: null, hasMore: false, pageLoad: 'idle', summary: null, summaryLoad: 'idle', unread: null, pendingReadIds: {}, queuedConfirmOrderId: null });
    },
  };
});

/** 하단 탭 내역의 점 */
export const selectHasUnread = (s: HistoryState) => hasUnreadUpdate(s.unread, s.pendingReadIds);
