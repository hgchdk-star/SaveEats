import { useLocalSearchParams } from 'expo-router';

import { AccountFormScreen } from '@/features/account/account-form-screen';

export default function AccountFormRoute() {
  const params = useLocalSearchParams<{ mode?: string; from?: string }>();
  return <AccountFormScreen mode={params.mode === 'change' ? 'change' : 'register'} from={params.from === 'order' ? 'order' : 'manage'} />;
}
