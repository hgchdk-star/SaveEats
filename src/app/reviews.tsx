import { useLocalSearchParams } from 'expo-router';

import { ReviewsScreen } from '@/features/review/reviews-screen';

export default function ReviewsRoute() {
  const { scope, id } = useLocalSearchParams<{ scope?: string; id?: string }>();
  return <ReviewsScreen scope={(scope === 'store' || scope === 'menu') && id ? { type: scope, id } : null} />;
}
