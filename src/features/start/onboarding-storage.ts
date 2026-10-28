import AsyncStorage from '@react-native-async-storage/async-storage';

import { mockScenario } from '@/mocks/scenario';

/**
 * 온보딩을 끝냈는지(PRD hasCompletedOnboarding). 이 기기에만 저장하고 계정과 상관없다.
 * 로그인이나 계좌를 묻지 않는다 (FR-SPL-004, FR-ONB-007).
 */
const KEY = 'saveeats.onboardingSeen.v1';

/**
 * 앱을 켤 때 온보딩을 보여줘야 하는지. 읽지 못하면 처음 실행으로 본다 (온보딩을 한 번 더 보는 쪽이 안전하다).
 * 개발 시나리오 firstRun은 저장된 값을 무시하고, launchReadFails는 읽기 실패를 흉내 낸다.
 */
export async function shouldShowOnboarding(): Promise<boolean> {
  if (mockScenario.launch === 'firstRun' || mockScenario.launch === 'readFails') return true;
  try {
    return (await AsyncStorage.getItem(KEY)) !== 'true';
  } catch {
    return true;
  }
}

/** 끝내거나 건너뛰면 저장한다. 저장에 실패해도 홈으로 가고, 다음 실행에서 온보딩이 한 번 더 나올 수 있다 */
export async function markOnboardingSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, 'true');
  } catch {
    // 저장 실패는 사용자를 막지 않는다
  }
}
