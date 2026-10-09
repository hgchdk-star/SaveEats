import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { onAppForeground } from './order-actions';

/**
 * 외부 앱에서 SaveEats로 돌아오는 신호를 한 곳에서 받는다 (TRF-008).
 *
 * AppState는 앱이 앞으로 왔다는 신호일 뿐 송금의 증거가 아니다. 그래서 여기서는 상태를 바꾸지 않고
 * 서버 상태를 먼저 조회하게만 한다. 시스템 대화상자나 알림 때문에 inactive → active가 되는 경우를 걸러내려고,
 * 실제로 background를 거쳐서 돌아온 경우만 신호로 본다.
 * iOS는 돌아올 때 background → inactive → active 순서로 오기도 해서, 직전 상태가 아니라
 * "background를 거쳤는가"로 판단한다. 외부 앱으로 보낸 기록이 없으면 아무 일도 하지 않는다.
 *
 * URL로 돌아오는 방식(callback)이 실제로 지원되는지는 실기기 PoC 대상이라 아직 받지 않는다.
 */
export function ReturnCoordinator() {
  const wentToBackground = useRef(false);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'background') {
        wentToBackground.current = true;
      } else if (next === 'active' && wentToBackground.current) {
        wentToBackground.current = false;
        onAppForeground();
      }
    });
    return () => subscription.remove();
  }, []);

  return null;
}
