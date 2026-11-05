import * as SecureStore from 'expo-secure-store';

/**
 * 기기 보안 저장소의 가장 작은 모양. 키 하나에 문자열 하나를 넣고 꺼내고 지운다.
 * AccountVault가 이 모양만 알아서, 테스트에서는 메모리 구현으로 바꿔 끼운다.
 *
 * 저장에 실패해도 서버나 일반 저장소(AsyncStorage)로 대신 저장하지 않는다. 실패는 그대로 던진다 (개발 명세 DB-003).
 */
export interface SecureKeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/**
 * Expo SecureStore (iOS Keychain · Android Keystore로 보호한 암호화 저장).
 * 옵션은 주지 않고 라이브러리 기본값을 쓴다. iOS 접근 수준(keychainAccessible)과 기기 암호·생체인증 필수 여부는
 * 제품 정책이 아직 정해지지 않았다 (개발 명세 DB-003, OPEN-DB-001). 정해지면 이 한 곳에서 옵션을 준다.
 * SecureStore가 없는 환경(웹)에서는 저장하지 않고 오류를 던진다.
 */
export const deviceSecureStore: SecureKeyValueStore = {
  async get(key) {
    await assertAvailable();
    return SecureStore.getItemAsync(key);
  },
  async set(key, value) {
    await assertAvailable();
    await SecureStore.setItemAsync(key, value);
  },
  async remove(key) {
    await assertAvailable();
    await SecureStore.deleteItemAsync(key);
  },
};

async function assertAvailable(): Promise<void> {
  if (!(await SecureStore.isAvailableAsync())) throw new Error('SECURE_STORE_UNAVAILABLE');
}
