import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import type { Page } from '@/contracts/common';

/**
 * 가게 목록(검색 결과 · 카테고리 · 찜)이 같이 쓰는 페이지 불러오기.
 *
 * - 첫 페이지 실패(error)와 결과가 없는 성공 응답(ok + 빈 목록)은 서로 다른 상태다
 * - 다음 페이지가 실패하면 기존 목록을 그대로 두고 같은 cursor로 다시 시도한다. 자동으로 다시 부르지 않는다
 * - key가 바뀌면 처음부터 다시 불러오고, 늦게 온 이전 응답은 버린다
 * - key가 null이면 아무것도 부르지 않는다(idle)
 */
type Item = { id: string };

type State<T> = {
  key: string;
  status: 'ok' | 'error';
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
  more: 'idle' | 'loading' | 'error';
};

type Action<T> =
  | { type: 'first'; key: string; page: Page<T> }
  | { type: 'firstFailed'; key: string }
  | { type: 'moreStart'; key: string }
  | { type: 'moreDone'; key: string; page: Page<T> }
  | { type: 'moreFailed'; key: string };

function reduce<T extends Item>(state: State<T> | null, action: Action<T>): State<T> | null {
  switch (action.type) {
    case 'first':
      return { key: action.key, status: 'ok', items: action.page.items, nextCursor: action.page.nextCursor, hasMore: action.page.hasMore, more: 'idle' };
    case 'firstFailed':
      return { key: action.key, status: 'error', items: [], nextCursor: null, hasMore: false, more: 'idle' };
    case 'moreStart':
      return state && state.key === action.key ? { ...state, more: 'loading' } : state;
    case 'moreDone': {
      if (!state || state.key !== action.key) return state;
      const seen = new Set(state.items.map((i) => i.id));
      return { ...state, items: [...state.items, ...action.page.items.filter((i) => !seen.has(i.id))], nextCursor: action.page.nextCursor, hasMore: action.page.hasMore, more: 'idle' };
    }
    case 'moreFailed':
      return state && state.key === action.key ? { ...state, more: 'error' } : state;
  }
}

export type PagedStores<T> = {
  status: 'idle' | 'loading' | 'ok' | 'error';
  items: T[];
  hasMore: boolean;
  more: 'idle' | 'loading' | 'error';
  /** 처음부터 다시 불러온다. keepStale이면 새 응답이 올 때까지 이전 목록을 그대로 보여준다 */
  reload: () => void;
  loadMore: () => void;
};

export function usePagedStores<T extends Item>(key: string | null, fetchPage: (cursor: string | null) => Promise<Page<T>>, options: { keepStale?: boolean } = {}): PagedStores<T> {
  const [state, dispatch] = useReducer(reduce<T>, null);
  const [attempt, setAttempt] = useState(0);
  const fetchRef = useRef(fetchPage);
  useEffect(() => {
    fetchRef.current = fetchPage;
  });
  const fullKey = key === null ? null : `${key}#${attempt}`;

  useEffect(() => {
    if (fullKey === null) return;
    let cancelled = false;
    fetchRef.current(null).then(
      (page) => {
        if (!cancelled) dispatch({ type: 'first', key: fullKey, page });
      },
      () => {
        if (!cancelled) dispatch({ type: 'firstFailed', key: fullKey });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [fullKey]);

  const current = state && state.key === fullKey ? state : null;
  const shown = current ?? (options.keepStale && state?.status === 'ok' && fullKey !== null ? state : null);

  const loadMore = useCallback(() => {
    if (!current || current.status !== 'ok' || !current.hasMore || current.more === 'loading') return;
    const stateKey = current.key;
    dispatch({ type: 'moreStart', key: stateKey });
    fetchRef.current(current.nextCursor).then(
      (page) => dispatch({ type: 'moreDone', key: stateKey, page }),
      () => dispatch({ type: 'moreFailed', key: stateKey }),
    );
  }, [current]);

  return {
    status: fullKey === null ? 'idle' : shown ? shown.status : 'loading',
    items: shown?.status === 'ok' ? shown.items : [],
    hasMore: !!shown && shown.hasMore,
    more: shown?.more ?? 'idle',
    reload: () => setAttempt((n) => n + 1),
    loadMore,
  };
}
