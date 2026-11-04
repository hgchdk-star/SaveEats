import { Platform } from 'react-native';

/**
 * 토스 실행 방법 중 SaveEats 빌드에서 검증된 범위 (개발 명세 TRF-003 · 004).
 *
 * 비공식 후보 URL `supertoss://send?amount=&bank=&accountNo=&origin=qr`은 Expo Go에서 진입·사전입력이 되는 것만 확인됐다
 * (실제 송금은 하지 않음). 이 기록은 SaveEats 빌드에서 실제 사용을 허용하는 근거가 아니다.
 * 사전입력은 "플랫폼 + 은행명" 조합이 SaveEats 빌드에서 검증됐다고 서정이 기록한 것만 켠다. 전체 은행에 시도하지 않는다.
 * 목록에 없는 은행·플랫폼은 처음부터 직접 이어가기로 간다. 목록이 비어 있으면(기본) 사전입력은 어디에서도 쓰이지 않는다.
 *
 * 검증된 조합은 EXPO_PUBLIC_TOSS_PREFILL_VERIFIED에 `플랫폼:은행명`을 쉼표로 적는다. 예: android:토스뱅크,ios:토스뱅크
 * 은행명은 앱의 은행 목록 표기 그대로, 공백까지 같아야 한다. 개발 중에는 확인하려는 조합을 넣어 범위를 넓혀 볼 수 있지만
 * 서비스 설정(릴리스 빌드)에는 서정이 검증 기록으로 확인한 조합만 넣는다. 값은 빌드에 들어가는 공개 설정이다.
 * 이 값만으로는 켜지지 않는다. 서버 PENDING 주문, 실행 직전 원격 tossDeepLinkEnabled ON, 목적지 확인이 모두 필요하다.
 *
 * TODO(서정): 검증 기록(evidenceId)과 조합이 정해지면 릴리스 빌드 환경 설정에 반영한다.
 * TODO(서정): 토스만 여는 URL(OPEN_ONLY)은 검증된 것이 없다. 사전입력 URL에서 값을 빼서 쓰지 않는다. 그 전까지 '토스 열기'는 비활성이다.
 * TODO(지우): iOS canOpenURL은 LSApplicationQueriesSchemes에 scheme 등록이 필요하다. 지금은 canOpenURL 없이 openURL 거절만 본다.
 */
function parseVerified(raw: string | undefined): ReadonlySet<string> {
  const set = new Set<string>();
  for (const entry of (raw ?? '').split(',')) {
    const [platform, ...rest] = entry.split(':');
    const bank = rest.join(':').trim();
    if ((platform.trim() === 'android' || platform.trim() === 'ios') && bank) set.add(`${platform.trim()}:${bank}`);
  }
  return set;
}

const VERIFIED = parseVerified(process.env.EXPO_PUBLIC_TOSS_PREFILL_VERIFIED);

export const TOSS_CAPABILITY = {
  evidenceId: null as string | null,
  /** 토스 앱을 열기만 하는 것이 검증됐는가. 검증된 URL이 없어 항상 false */
  openOnlyValidated: false,
  /** 검증된 사전입력 조합이 하나라도 설정돼 있는가 */
  prefillValidated: VERIFIED.size > 0,
} as const;

/** 이 기기 플랫폼에서 이 은행명으로 사전입력이 검증돼 있는가 */
export function isPrefillVerified(bankName: string): boolean {
  return VERIFIED.has(`${Platform.OS}:${bankName.trim()}`);
}
