import { failOnce, mockDelay, mockScenario } from '@/mocks/scenario';
import { ServiceError } from '@/services/service-error';

import type { TransferService } from './types';

/**
 * 송금 이어가기 Mock.
 *
 * - 토스 실행 방법(scheme)은 실기기 PoC 증거 전에는 정하지 않는다 (TRF-009). 그래서 Mock의 openToss는
 *   어떤 앱도 열지 않고 "열었다"고만 답한다. 복귀 흐름은 사용자가 앱을 직접 나갔다가 돌아오면 이어진다.
 * - 계좌번호 원문은 Mock에도 두지 않는다. resolveDestinationAccountNumber는 항상 실패한다.
 *   원문 제공 방식(DestinationResolver)이 OPEN-DB-001/002 결정 전이라 만들 수 없다.
 */
export function createMockTransferService(): TransferService {
  return {
    async getTransferConfig() {
      await mockDelay();
      // 응답이 오지 않는 경우. 호출한 쪽의 3초 제한이 먼저 끝나 직접 흐름으로 간다
      if (mockScenario.transfer === 'configTimeout') return new Promise(() => undefined);
      return { tossDeepLinkEnabled: mockScenario.transfer !== 'killSwitch' };
    },

    async openToss() {
      await mockDelay();
      if (mockScenario.transfer === 'tossLaunchFailOnce' && failOnce('toss:launch')) throw new ServiceError('LAUNCH_FAILED');
    },

    async resolveDestinationAccountNumber() {
      await mockDelay();
      throw new ServiceError('DESTINATION_UNAVAILABLE');
    },
  };
}
