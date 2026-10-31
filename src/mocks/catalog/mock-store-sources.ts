import { mockDelay, mockScenario } from '@/mocks/scenario';
import { toSourceResult, type StoreSourceProvider } from '@/services/store-source/store-source-provider';

/**
 * 개발용 가게 출처 Mock. EXPO_PUBLIC_MOCK_SCENARIO가 sourcesOne · sourcesMany · sourcesLong일 때만 목록이 나온다.
 * 기본(default)은 출처를 확인하지 못한 상태다. 실제 브랜드·출처를 흉내 내지 않고, 주소는 예약된 example.com만 쓴다.
 * 이 값은 서비스 데이터나 검증 상태가 아니다 (FR-STORE-021).
 */
const LONG_NAME = '아주 긴 출처 이름을 가진 개발용 예시 자료 페이지 제목이 여러 줄로 이어지는 경우를 확인하기 위한 항목';

function sample(count: number, longFirst = false) {
  return Array.from({ length: count }, (_, i) => ({
    name: longFirst && i === 0 ? LONG_NAME : `개발용 예시 출처 ${i + 1}`,
    url: `https://example.com/source/${i + 1}`,
  }));
}

export function createMockStoreSourceProvider(): StoreSourceProvider {
  return {
    async getStoreSources() {
      await mockDelay();
      switch (mockScenario.storeSources) {
        case 'one':
          return toSourceResult(sample(1));
        case 'many':
          return toSourceResult(sample(3));
        case 'long':
          return toSourceResult(sample(14, true));
        default:
          return { status: 'UNCONFIRMED' };
      }
    },
  };
}
