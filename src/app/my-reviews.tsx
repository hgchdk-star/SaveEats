import { useLocalSearchParams } from 'expo-router';

import { MyReviewsScreen } from '@/features/review/my-reviews-screen';

export default function MyReviewsRoute() {
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  return <MyReviewsScreen focusReviewId={focus} />;
}
