import { router } from 'expo-router';
import { useEffect } from 'react';

import type { MockOrder } from '@/mocks/order/types';

import { useOrderFlowStore } from './order-flow-store';

/**
 * 주문 후 화면이 보여줄 주문. 앱이 다시 시작되는 등으로 주문 정보가 없으면 홈으로 돌려보낸다.
 * (앱을 껐다 켠 뒤 내역에서 주문을 이어가는 것은 묶음 3의 내역과 함께 만든다)
 */
export function useCurrentOrder(): MockOrder | null {
  const order = useOrderFlowStore((s) => s.order);
  useEffect(() => {
    if (!order) router.replace('/');
  }, [order]);
  return order;
}
