import { useLocalSearchParams } from 'expo-router';

import { ProfileSetupScreen } from '@/features/auth/profile-setup-screen';

export default function ProfileSetupRoute() {
  const params = useLocalSearchParams<{ mode?: string }>();
  // 모양을 모르는 값은 가장 조심스러운 쪽(가입 직후 복구가 아니라 최초 설정)으로 본다
  const mode = params.mode === 'recover' ? 'recover' : params.mode === 'change' ? 'change' : 'set';
  return <ProfileSetupScreen mode={mode} />;
}
