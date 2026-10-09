import { OnboardingScreen } from '@/features/start/onboarding-screen';

/** 온보딩 3페이지. 처음 실행에서만 나온다 */
export default function OnboardingRoute() {
  return <OnboardingScreen mode="first" />;
}
