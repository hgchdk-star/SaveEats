import { Linking } from 'react-native';

import { TOSS_CAPABILITY } from '@/config/toss-capability';

/**
 * 토스 실행 어댑터 (개발 명세 TRF-003).
 * DISPATCHED는 OS가 실행 요청을 받았다는 뜻일 뿐, 송금 화면에 도달했거나 송금이 됐다는 뜻이 아니다.
 * 임의 URL을 받지 않는다. 검증된 조합이 없으면 아무것도 열지 않는다.
 * 전체 URL·계좌번호는 로그·오류·반환값 어디에도 남기지 않는다. 이 파일은 console을 쓰지 않는다.
 */
export type PrefillInput = { amount: number; bankName: string; accountNumber: string };
export type LaunchRequest = { mode: 'OPEN_ONLY' } | { mode: 'PREFILL'; input: PrefillInput };
export type LaunchResult =
  | { kind: 'DISPATCHED' }
  | { kind: 'UNAVAILABLE'; reason: 'NOT_VALIDATED' | 'INVALID_INPUT' }
  | { kind: 'ERROR'; code: 'OPEN_REJECTED' };

/** 비공식 후보. SaveEats 빌드에서 재검증하기 전에는 TOSS_CAPABILITY가 막는다 */
const SEND_URL = 'supertoss://send';

/** 값이 형식에 맞지 않으면 null. 금액은 양의 정수 원, 계좌번호는 숫자만 */
export function buildPrefillUrl({ amount, bankName, accountNumber }: PrefillInput): string | null {
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;
  if (!bankName.trim() || !/^[0-9]+$/.test(accountNumber)) return null;
  return `${SEND_URL}?amount=${amount}&bank=${encodeURIComponent(bankName)}&accountNo=${accountNumber}&origin=qr`;
}

/** 사용자가 버튼을 누른 직후에만 호출한다. 자동 재시도는 하지 않는다 */
export async function launchToss(request: LaunchRequest): Promise<LaunchResult> {
  let url: string | null;
  if (request.mode === 'PREFILL') {
    if (!TOSS_CAPABILITY.prefillValidated) return { kind: 'UNAVAILABLE', reason: 'NOT_VALIDATED' };
    url = buildPrefillUrl(request.input);
    if (!url) return { kind: 'UNAVAILABLE', reason: 'INVALID_INPUT' };
  } else {
    // TODO(서정): 토스만 여는 검증된 URL이 없다. 사전입력 URL에서 값을 빼 쓰지 않는다
    return { kind: 'UNAVAILABLE', reason: 'NOT_VALIDATED' };
  }
  try {
    await Linking.openURL(url);
    return { kind: 'DISPATCHED' };
  } catch {
    // 앱이 없거나 열 수 없다. 설치 여부를 단정하지 않고, 오류 내용(URL이 담길 수 있음)을 버린다
    return { kind: 'ERROR', code: 'OPEN_REJECTED' };
  }
}
