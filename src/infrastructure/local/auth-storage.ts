import * as SecureStore from 'expo-secure-store';

/**
 * Supabase 로그인 세션을 이 기기의 보안 저장소(Keychain · Keystore)에 보관하는 저장 어댑터 (개발 명세 AUTH-002).
 *
 * 세션(JSON)은 SecureStore 한 값의 권장 크기(약 2KB)를 넘을 수 있어서 CHUNK 글자씩 나눠 저장한다.
 * 일반 저장소(AsyncStorage)에는 토큰을 두지 않는다. 읽기·쓰기에 실패하면(웹 등 SecureStore가 없는 환경 포함)
 * 던지지 않고 "저장된 것 없음"으로 동작한다. 그 경우 세션은 이번 실행 동안만 유지되고 다음 실행에서 다시 로그인한다.
 * 토큰 값은 로그·오류에 남기지 않는다.
 * TODO(OPEN-DB-001 · 실기기 검증): iOS 접근 수준(keychainAccessible)과 생체인증 필수 여부는 정하지 않아 라이브러리 기본값을 쓴다.
 */
const CHUNK = 1800;

const countKey = (key: string) => `${key}.n`;
const chunkKey = (key: string, i: number) => `${key}.${i}`;

async function removeAll(key: string): Promise<void> {
  const raw = await SecureStore.getItemAsync(countKey(key));
  const count = raw ? Number.parseInt(raw, 10) : 0;
  for (let i = 0; i < (Number.isFinite(count) ? count : 0); i += 1) await SecureStore.deleteItemAsync(chunkKey(key, i));
  await SecureStore.deleteItemAsync(countKey(key));
}

export const authStorage = {
  async getItem(key: string): Promise<string | null> {
    try {
      const raw = await SecureStore.getItemAsync(countKey(key));
      const count = raw ? Number.parseInt(raw, 10) : 0;
      if (!Number.isFinite(count) || count <= 0) return null;
      let value = '';
      for (let i = 0; i < count; i += 1) {
        const part = await SecureStore.getItemAsync(chunkKey(key, i));
        if (part === null) return null; // 일부가 없으면 깨진 값이다. 없는 것으로 본다
        value += part;
      }
      return value;
    } catch {
      return null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    try {
      await removeAll(key); // 이전 값이 더 길었을 때 남는 조각을 없앤다
      const count = Math.ceil(value.length / CHUNK);
      for (let i = 0; i < count; i += 1) await SecureStore.setItemAsync(chunkKey(key, i), value.slice(i * CHUNK, (i + 1) * CHUNK));
      await SecureStore.setItemAsync(countKey(key), String(count));
    } catch {
      // 저장하지 못해도 로그인은 이번 실행 동안 유지된다
    }
  },

  async removeItem(key: string): Promise<void> {
    try {
      await removeAll(key);
    } catch {
      // 지우지 못했다면 다음 읽기에서 조각이 맞지 않아 없는 것으로 처리된다
    }
  },
};
