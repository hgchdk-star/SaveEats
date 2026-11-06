import { showToast } from '@/features/toast/toast-store';
import { ServiceError } from '@/services/service-error';

/**
 * 개발 전용 실패 주입. 완료 확인 저장 실패를 네트워크를 끊지 않고 재현한다 (두 주문의 대기를 동시에 남기는 수동 테스트용).
 *
 * 켜는 법: 개발 서버를 `EXPO_PUBLIC_DEV_CONFIRM_FAILURES=2`로 시작한다(값은 사용자 동작으로 보내는 완료 확인 중 앞의 몇 번을 실패시킬지, 최대 5).
 * - `__DEV__`(개발 빌드)에서만 동작한다. 릴리스 빌드에서는 값이 있어도 아무 일도 하지 않는다.
 * - 사용자가 '주문 완료했어요'·'상태 저장 다시 시도'를 눌렀을 때만 센다. 앱 시작 복구(recoverOnStart)는 건드리지 않는다.
 * - 횟수는 앱 프로세스 메모리에만 있다. 앱을 완전히 종료하고 다시 열면 다시 센다(그때 복구는 주입 없이 실제 서버로 간다).
 * - 서버로 보내기 전에 실패시킨다. 서버 상태는 그대로 PENDING이다. '요청이 서버에 닿기 전에 잃은 경우'를 흉내 낸 것이며,
 *   서버에는 적용됐는데 응답만 잃은 경우나 실제 서버 오류가 아니다. 테스트 기록에 "개발용 실패 주입"이라고 구분해 적는다.
 * - 주입될 때마다 화면에 "[개발용 실패 주입]" 토스트가 뜬다. 이 토스트가 없는 실패는 실제 실패다.
 */
let remaining: number | null = null;

function initialCount(): number {
  if (!__DEV__) return 0;
  const n = Number(process.env.EXPO_PUBLIC_DEV_CONFIRM_FAILURES);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 5) : 0;
}

/** 주입할 차례면 결과를 모르는 오류를 던진다. 아니면 아무것도 하지 않는다 */
export function devInjectConfirmFailure(): void {
  if (remaining === null) remaining = initialCount();
  if (remaining <= 0) return;
  remaining -= 1;
  showToast({ message: `[개발용 실패 주입] 완료 확인을 서버로 보내지 않았어요 (남은 주입 ${remaining}회)`, tone: 'error' });
  throw new ServiceError('REQUEST_TIMEOUT', true);
}
