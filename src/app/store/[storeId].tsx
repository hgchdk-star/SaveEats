import { useLocalSearchParams } from 'expo-router';

import { StoreDetailScreen } from '@/features/store/store-detail-screen';

export default function StoreRoute() {
  const { storeId } = useLocalSearchParams<{ storeId: string }>();
  return <StoreDetailScreen storeId={storeId} />;
}
