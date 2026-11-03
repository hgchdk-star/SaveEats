import { useLocalSearchParams } from 'expo-router';

import { ProfileSetupScreen } from '@/features/auth/profile-setup-screen';

export default function ProfileSetupRoute() {
  const params = useLocalSearchParams<{ mode?: string }>();
  return <ProfileSetupScreen mode={params.mode === 'edit' ? 'edit' : 'recover'} />;
}
