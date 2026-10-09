import { useLocalSearchParams } from 'expo-router';

import { ReviewWriteScreen } from '@/features/review/review-write-screen';

export default function ReviewWriteRoute() {
  const { orderId, reviewId } = useLocalSearchParams<{ orderId?: string; reviewId?: string }>();
  return <ReviewWriteScreen orderId={orderId} reviewId={reviewId} />;
}
