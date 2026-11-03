import AsyncStorage from '@react-native-async-storage/async-storage';

import { userScopedKey } from '@/services/session';

/**
 * 가입은 됐지만 닉네임 저장이 끝나지 않은 계정의 표시 (개발 명세 AUTH: 가입 성공과 프로필 저장 실패는 분리한다).
 * 이 표시가 있으면 앱을 다시 열어도 같은 계정에서 프로필 저장만 다시 시도하게 하고, 회원가입은 다시 부르지 않는다.
 * 사용자(uid)별 키라 다른 계정에는 영향이 없고, 닉네임이 저장되면 지운다. 비밀번호는 담지 않는다.
 * 닉네임은 공개 정보라 보안 저장소가 아니라 일반 저장소에 둔다. 읽거나 쓰지 못하면 표시가 없는 것으로 본다
 * (이때는 설정의 "설정하기"로 같은 화면에 들어올 수 있다).
 */
const BASE = 'saveeats.auth.profileSetupPending.v1';
const key = () => userScopedKey(BASE);

export type ProfileSetupPending = { nickname: string };

export async function markProfileSetupPending(nickname: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key(), JSON.stringify({ nickname } satisfies ProfileSetupPending));
  } catch {
    // 표시를 남기지 못해도 지금 화면에서의 재시도는 된다
  }
}

export async function loadProfileSetupPending(): Promise<ProfileSetupPending | null> {
  try {
    const raw = await AsyncStorage.getItem(key());
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' && typeof (parsed as ProfileSetupPending).nickname === 'string' ? { nickname: (parsed as ProfileSetupPending).nickname } : null;
  } catch {
    return null;
  }
}

export async function clearProfileSetupPending(): Promise<void> {
  try {
    await AsyncStorage.removeItem(key());
  } catch {
    // 지우지 못하면 다음 실행 때 한 번 더 열릴 수 있다. 저장은 이미 끝난 상태다
  }
}
