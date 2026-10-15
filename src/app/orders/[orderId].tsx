import { useLocalSearchParams } from 'expo-router';

import { OrderDetailScreen } from '@/features/history/order-detail-screen';

export default function OrderDetailRoute() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  return <OrderDetailScreen orderId={orderId} />;
}
