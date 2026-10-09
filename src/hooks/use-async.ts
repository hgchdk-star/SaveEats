import { useCallback, useEffect, useState } from 'react';

export type AsyncState<T> =
  | { status: 'loading'; data: null; error: null }
  | { status: 'ok'; data: T; error: null }
  | { status: 'error'; data: null; error: unknown };

const LOADING = { status: 'loading', data: null, error: null } as const;

/**
 * key가 바뀔 때마다 불러오고, reload로 같은 key를 다시 불러온다.
 * 늦게 도착한 이전 응답은 버린다.
 */
export function useAsync<T>(key: string, load: () => Promise<T>): AsyncState<T> & { reload: () => void } {
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${key}#${attempt}`;
  const [settled, setSettled] = useState<{ requestKey: string; state: AsyncState<T> } | null>(null);

  useEffect(() => {
    let cancelled = false;
    load().then(
      (data) => {
        if (!cancelled) setSettled({ requestKey, state: { status: 'ok', data, error: null } });
      },
      (error: unknown) => {
        if (!cancelled) setSettled({ requestKey, state: { status: 'error', data: null, error } });
      },
    );
    return () => {
      cancelled = true;
    };
    // load는 requestKey가 바뀔 때만 다시 실행한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const state = settled?.requestKey === requestKey ? settled.state : LOADING;

  return { ...state, reload };
}
