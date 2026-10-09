import AsyncStorage from '@react-native-async-storage/async-storage';

import { LIMITS } from '@/config/limits';
import { mockScenario } from '@/mocks/scenario';

/**
 * 최근 검색어: 이 기기에만 저장하고 계정과 분리한다 (미결정 묶음4 #1).
 * 그래서 로그인·로그아웃·계정 전환과 상관없이 그대로 남고, 사용자별 키를 쓰지 않는다. 서버로 보내지도 않는다.
 * 저장이나 읽기에 실패해도 검색은 막지 않는다.
 */
const KEY = 'saveeats.search.recent.v1';

/** 개발 시나리오 recentSeeded: 기기에 저장된 값이 아직 없을 때만 보여주는 예시 */
const SAMPLE = ['치킨', '떡볶이', '피자', '비빔밥', '마늘', '디저트', '로제', '순살', '튀김', '케이크'];

export async function loadRecentSearches(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw === null) return mockScenario.recentSearches === 'seeded' ? SAMPLE : [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string').slice(0, LIMITS.recentSearchMax) : [];
  } catch {
    return [];
  }
}

export async function saveRecentSearches(list: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // 저장하지 못해도 화면의 목록은 그대로 둔다. 다음 실행에서 이전 목록이 보일 수 있다
  }
}
