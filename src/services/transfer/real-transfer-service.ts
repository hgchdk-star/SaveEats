import { LIMITS } from '@/config/limits';
import { CATALOG_RPC, type GetPublicFeatureConfigDto } from '@/contracts/catalog';
import { isPrefillVerified, TOSS_CAPABILITY } from '@/config/toss-capability';
import type { MockOrder, TransferService } from '@/mocks/order/types';
import type { ConfirmEntryRead } from '@/services/order/confirm-queue';
import { ServiceError, errorCode } from '@/services/service-error';
import { getSession } from '@/services/session';
import { getSupabaseClient } from '@/services/supabase/client';

import { launchToss } from './toss-launch-adapter';

/**
 * 원격 설정 조회 (혜지 확정 2026-11-02, 실서버 확인 2026-11-03): get_public_feature_config() → { configRevision, fetchedAtServer, flags: { tossDeepLinkEnabled } }.
 * 시간 초과(3초) · 실패 · 값 없음 · 모양이 다른 응답(configRevision·fetchedAtServer 포함)은 모두 false다 (fail-closed, TRF-005).
 * 서버 초기값은 false이고 켜는 것은 서버 운영자가 한다. 호출이 실패해도 false다.
 */
const GET_PUBLIC_FEATURE_CONFIG = CATALOG_RPC.getPublicFeatureConfig;

function isValidConfig(data: unknown): data is GetPublicFeatureConfigDto {
  if (typeof data !== 'object' || data === null) return false;
  const { configRevision, fetchedAtServer, flags } = data as Partial<GetPublicFeatureConfigDto>;
  if (!Number.isSafeInteger(configRevision) || (configRevision as number) < 1) return false;
  if (typeof fetchedAtServer !== 'string' || Number.isNaN(Date.parse(fetchedAtServer))) return false;
  return typeof flags === 'object' && flags !== null && typeof flags.tossDeepLinkEnabled === 'boolean';
}

async function fetchRemoteTossFlag(): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIMITS.tossConfigTimeoutMs);
  try {
    const { data, error } = await client.rpc(GET_PUBLIC_FEATURE_CONFIG).abortSignal(controller.signal);
    return !error && isValidConfig(data) && data.flags.tossDeepLinkEnabled;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** 응답이 없어도 3초 뒤에는 꺼진 것으로 본다. 오류도 꺼짐이다 */
function withinConfigTimeout(check: Promise<boolean>): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), LIMITS.tossConfigTimeoutMs);
    check.then(
      (enabled) => {
        clearTimeout(timer);
        resolve(enabled === true);
      },
      () => {
        clearTimeout(timer);
        resolve(false);
      },
    );
  });
}

type Deps = {
  resolveDestinationAccountNumber: TransferService['resolveDestinationAccountNumber'];
  getOrder: (orderId: string) => Promise<MockOrder>;
  /** 이 주문의 완료 확인 대기 (ORD-010) */
  readConfirmState: (orderId: string) => Promise<ConfirmEntryRead>;
  /** 실행 직전 원격 스위치. 없으면 서버의 get_public_feature_config를 읽는다 */
  isRemoteEnabled?: () => Promise<boolean>;
};

/**
 * 토스 실행 경계 (TRF-004 · 005 · 006). 화면에 들어올 때의 판단을 믿지 않고 버튼을 누를 때마다 처음부터 확인한다. 하나라도 어긋나면 열지 않는다.
 * 던지는 코드: AUTH_REQUIRED · ORDER_STATUS_UNKNOWN · ORDER_NOT_PENDING · CONFIRM_PENDING · CONFIRM_STATE_UNREADABLE ·
 * DESTINATION_UNAVAILABLE · TOSS_DISABLED(원격 OFF·조회 실패) · LAUNCH_FAILED.
 * 자동으로 다시 열지 않는다. 원격 조회와 OS 실행 사이의 짧은 경합은 없앨 수 없고, 이미 열린 토스를 회수하지도 못한다.
 */
export function createTossLauncher({ resolveDestinationAccountNumber, getOrder, readConfirmState, isRemoteEnabled = fetchRemoteTossFlag }: Deps): TransferService['openToss'] {
  return async ({ orderId, prefill }) => {
    if (!prefill) {
      const plain = await launchToss({ mode: 'OPEN_ONLY' });
      if (plain.kind !== 'DISPATCHED') throw new ServiceError('LAUNCH_FAILED');
      return;
    }
    const uid = getSession().userId;
    if (!uid) throw new ServiceError('AUTH_REQUIRED');
    // 서버 주문의 금액·당시 은행을 쓰고, 계좌 원문은 목적지 확인을 통과한 것만 쓴다. 원문은 이 함수 안에서만 머문다
    let order: MockOrder;
    try {
      order = await getOrder(orderId); // get_my_order는 본인 주문만 돌려준다
    } catch (error) {
      throw new ServiceError(errorCode(error) === 'AUTH_REQUIRED' ? 'AUTH_REQUIRED' : 'ORDER_STATUS_UNKNOWN');
    }
    if (order.status !== 'PENDING') throw new ServiceError('ORDER_NOT_PENDING');
    // 이미 완료를 확인한 주문이면 송금이 아니라 상태 저장을 복구한다. 읽지 못하면 없다고 단정하지 않는다
    const confirm = await readConfirmState(orderId);
    if (confirm.status === 'QUEUED') throw new ServiceError('CONFIRM_PENDING');
    if (confirm.status === 'UNREADABLE') throw new ServiceError('CONFIRM_STATE_UNREADABLE');
    // 검증되지 않은 은행·플랫폼은 여기서도 막는다 (화면은 이미 직접 이어가기로 보낸다)
    const bankName = order.snapshot.destination?.bankName;
    // 은행명을 이 기기에서 찾지 못하면 목적지를 확인할 수 없다. 사전입력하지 않는다
    if (!bankName) throw new ServiceError('DESTINATION_UNAVAILABLE');
    if (!isPrefillVerified(bankName)) throw new ServiceError('LAUNCH_FAILED');
    if (!(await withinConfigTimeout(isRemoteEnabled()))) throw new ServiceError('TOSS_DISABLED');
    const accountNumber = await resolveDestinationAccountNumber(orderId);
    // 기다리는 사이 계정이 바뀌었으면 이전 사용자의 주문을 열지 않는다
    if (getSession().userId !== uid) throw new ServiceError('AUTH_REQUIRED');
    const result = await launchToss({
      mode: 'PREFILL',
      input: { amount: order.approvedTotalAmount, bankName, accountNumber },
    });
    if (result.kind !== 'DISPATCHED') throw new ServiceError('LAUNCH_FAILED');
  };
}

export function createRealTransferService(deps: Deps): TransferService {
  return {
    async getTransferConfig(input) {
      // 원격 ON + 이 플랫폼·은행이 검증된 조합일 때만 토스 이어가기를 켠다. 어느 쪽이든 아니면 직접 이어가기다
      const remote = await fetchRemoteTossFlag().catch(() => false);
      const verified = TOSS_CAPABILITY.prefillValidated && !!input && isPrefillVerified(input.bankName);
      return { tossDeepLinkEnabled: remote && verified };
    },
    openToss: createTossLauncher(deps),
    resolveDestinationAccountNumber: deps.resolveDestinationAccountNumber,
  };
}
