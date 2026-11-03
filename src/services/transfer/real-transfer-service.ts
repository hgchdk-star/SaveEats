import { LIMITS } from '@/config/limits';
import { CATALOG_RPC, type GetPublicFeatureConfigDto } from '@/contracts/catalog';
import { isPrefillVerified, TOSS_CAPABILITY } from '@/config/toss-capability';
import type { MockOrder, TransferService } from '@/mocks/order/types';
import { ServiceError } from '@/services/service-error';
import { getSupabaseClient } from '@/services/supabase/client';

import { launchToss } from './toss-launch-adapter';

/**
 * 원격 설정 조회 (혜지 확정 2026-11-02, 실서버 확인 2026-11-03): get_public_feature_config() → { configRevision, fetchedAtServer, flags: { tossDeepLinkEnabled } }.
 * 앱은 flags.tossDeepLinkEnabled만 읽고, 시간 초과 · 실패 · 값 없음 · boolean이 아닌 값은 모두 false다 (fail-closed).
 * 서버 초기값은 false이고 켜는 것은 서버 운영자가 한다. 이 함수가 서버에 배포되기 전에는 호출이 실패해 false가 된다.
 */
const GET_PUBLIC_FEATURE_CONFIG = CATALOG_RPC.getPublicFeatureConfig;

async function fetchRemoteTossFlag(): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIMITS.serverRequestTimeoutMs);
  try {
    const { data, error } = await client.rpc(GET_PUBLIC_FEATURE_CONFIG).abortSignal(controller.signal);
    if (error || typeof data !== 'object' || data === null) return false;
    const flags = (data as Partial<GetPublicFeatureConfigDto>).flags;
    if (typeof flags !== 'object' || flags === null) return false;
    return (flags as Partial<GetPublicFeatureConfigDto['flags']>).tossDeepLinkEnabled === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

type Deps = {
  resolveDestinationAccountNumber: TransferService['resolveDestinationAccountNumber'];
  getOrder: (orderId: string) => Promise<MockOrder>;
};

/** 토스 실행만 실제로 한다. 설정 조회는 fetchRemoteTossFlag, 계좌 원문은 resolver가 맡는다 */
export function createTossLauncher({ resolveDestinationAccountNumber, getOrder }: Deps): TransferService['openToss'] {
  return async ({ orderId, prefill }) => {
    if (!prefill) {
      const plain = await launchToss({ mode: 'OPEN_ONLY' });
      if (plain.kind !== 'DISPATCHED') throw new ServiceError('LAUNCH_FAILED');
      return;
    }
    // 서버 주문의 금액·당시 은행을 쓰고, 계좌 원문은 목적지 확인을 통과한 것만 쓴다. 원문은 이 함수 안에서만 머문다
    const order = await getOrder(orderId);
    // 검증되지 않은 은행·플랫폼은 여기서도 막는다 (화면은 이미 직접 이어가기로 보낸다)
    const bankName = order.snapshot.destination?.bankName;
    // 은행명을 이 기기에서 찾지 못하면 목적지를 확인할 수 없다. 사전입력하지 않는다
    if (!bankName) throw new ServiceError('DESTINATION_UNAVAILABLE');
    if (!isPrefillVerified(bankName)) throw new ServiceError('LAUNCH_FAILED');
    const accountNumber = await resolveDestinationAccountNumber(orderId);
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
