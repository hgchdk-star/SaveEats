/**
 * 토스 실행 방법 중 SaveEats 빌드에서 검증된 범위 (개발 명세 TRF-003 · 004).
 *
 * 비공식 후보 URL `supertoss://send?amount=&bank=&accountNo=&origin=qr`는 Expo Go의 iPhone·Android에서 사용자 확인 기준으로
 * 진입·사전입력이 된 것만 확인됐다(실제 송금은 하지 않음). SaveEats 빌드, 기기·OS·토스 앱 버전·은행별 증거는 아직 없다.
 * 그래서 기본은 꺼져 있고(직접 이어가기), 재검증한 빌드에서만 EXPO_PUBLIC_TOSS_PREFILL_VALIDATED=true로 켠다.
 * 이 값만으로는 켜지지 않는다. 원격 tossDeepLinkEnabled도 ON이어야 한다. 값은 빌드에 들어가는 공개 설정이다.
 *
 * TODO(서정·지우): 재검증 결과를 evidenceId로 남기고, 지원하는 은행 범위(bank 파라미터가 은행명 문자열로 통하는 은행)를 정한다.
 *   지금은 은행 제한 없이 시도한다. 일부 은행이 안 되면 supportedBanks를 두고 거기 없는 은행은 직접 이어가기로 보낸다.
 * TODO(서정): 토스 앱만 여는 URL(OPEN_ONLY)은 아직 증거가 없다. 직접 이어가기의 '토스 열기'는 그때까지 열지 못하고 안내만 보인다.
 * TODO(지우): iOS canOpenURL은 LSApplicationQueriesSchemes에 scheme 등록이 필요하다. 지금은 canOpenURL 없이 openURL 거절만 본다.
 */
export const TOSS_CAPABILITY = {
  evidenceId: null as string | null,
  /** 토스 앱을 열기만 하는 것이 검증됐는가. 검증된 URL이 없어 항상 false */
  openOnlyValidated: false,
  /** 은행·계좌·금액 사전입력이 SaveEats 빌드에서 함께 검증됐는가 */
  prefillValidated: process.env.EXPO_PUBLIC_TOSS_PREFILL_VALIDATED === 'true',
} as const;
