import { useLocalSearchParams } from 'expo-router';

import { MonthlyScreen } from '@/features/history/monthly-screen';

export default function MonthlyRoute() {
  const { month } = useLocalSearchParams<{ month?: string }>();
  return <MonthlyScreen initialMonth={month} />;
}
