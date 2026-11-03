import { isPrefillVerified, TOSS_CAPABILITY } from '@/config/toss-capability';
import type { MockOrder, TransferService } from '@/mocks/order/types';
import { ServiceError } from '@/services/service-error';

import { launchToss } from './toss-launch-adapter';

/**
 * TODO(혜지·지우 합의 전): 원격 설정(tossDeepLinkEnabled) 조회 계약이 없다. 테이블·RPC 이름, 응답 모양(revision 포함 여부),
 * 오류 응답을 정하지 않았다. 합의될 때까지 꺼진 값(false)을 돌려준다 (fail-closed, 초기값 OFF).
 */
async function fetchRemoteTossFlag(): Promise<boolean> {
  return false;
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
    if (!isPrefillVerified(order.snapshot.destination.bankName)) throw new ServiceError('LAUNCH_FAILED');
    const accountNumber = await resolveDestinationAccountNumber(orderId);
    const result = await launchToss({
      mode: 'PREFILL',
      input: { amount: order.approvedTotalAmount, bankName: order.snapshot.destination.bankName, accountNumber },
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
