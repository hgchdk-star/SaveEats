/**
 * 가게별 콘텐츠 출처를 화면에 공급하는 경계 (개발 명세 SRC-002).
 *
 * 화면은 이 인터페이스만 안다. 출처명·URL의 저장 위치, 서버 공급 방식(getStore 포함 여부 등), DB 스키마는 OPEN-SRC-001로
 * 미결정이라 합의된 계약이 아니다. 아래 모양은 화면이 필요한 논리 값(출처명 · 자신의 URL · 누락/미확인 여부)만 담은 임시안이다.
 * kind(메뉴/이미지), 출처 동일 여부, VERIFIED/UNVERIFIED 같은 값은 화면 입력이 아니므로 두지 않는다.
 */
export type StoreSource = { name: string; url: string };

/**
 * AVAILABLE: 보여줄 출처가 1개 이상 있다.
 * UNCONFIRMED: 출처가 없거나 아직 확인되지 않았다. 공개 허용 여부와는 별개의 표시용 값이다 (OPEN-SRC-002).
 */
export type StoreSourceResult = { status: 'AVAILABLE'; items: StoreSource[] } | { status: 'UNCONFIRMED' };

export interface StoreSourceProvider {
  getStoreSources(storeId: string): Promise<StoreSourceResult>;
}

/** 외부 이동은 http(s)만 허용한다. 가게명 등으로 URL을 만들어 채우지 않는다 (SRC-003). 최종 검사 기준은 OPEN-SRC-003 */
export function isOpenableUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

/** 공급부가 준 목록을 화면용으로 맞춘다: 이름이나 열 수 있는 URL이 없는 항목은 버리고, 하나도 남지 않으면 UNCONFIRMED */
export function toSourceResult(raw: readonly { name?: string | null; url?: string | null }[]): StoreSourceResult {
  const items: StoreSource[] = [];
  for (const item of raw) {
    const name = item.name?.trim();
    const url = item.url?.trim();
    if (name && url && isOpenableUrl(url)) items.push({ name, url });
  }
  return items.length > 0 ? { status: 'AVAILABLE', items } : { status: 'UNCONFIRMED' };
}

/**
 * 공급 계약이 없는 동안의 실제 앱 기본값. 어떤 가게도 출처를 확인하지 못한 것으로 답한다.
 * TODO(OPEN-SRC-001 · 혜지·지우): 저장 위치와 공급 방식이 정해지면 이 자리를 실제 구현으로 바꾼다.
 */
export function createUnconfirmedStoreSourceProvider(): StoreSourceProvider {
  return { getStoreSources: async () => ({ status: 'UNCONFIRMED' }) };
}
