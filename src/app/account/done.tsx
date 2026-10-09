import { useLocalSearchParams } from 'expo-router';

import { AccountDoneScreen } from '@/features/account/account-done-screen';

export default function AccountDoneRoute() {
  const params = useLocalSearchParams<{ from?: string }>();
  return <AccountDoneScreen fromOrder={params.from === 'order'} />;
}
