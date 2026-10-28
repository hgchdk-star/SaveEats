import { OnboardingScreen } from '@/features/start/onboarding-screen';

/** SaveEats 이용 방법. 설정에서만 다시 본다. 온보딩과 같은 화면 구성이다 */
export default function HowToRoute() {
  return <OnboardingScreen mode="howto" />;
}
