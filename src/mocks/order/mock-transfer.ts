import { failOnce, mockDelay, mockScenario } from '@/mocks/scenario';
import { ServiceError } from '@/services/service-error';

import type { TransferService } from './types';

/**
 * 송금 이어가기 Mock.
 *
 * - Mock의 openToss는 어떤 앱도 열지 않고 "열었다"고만 답한다. 복귀 흐름은 사용자가 앱을 직접 나갔다가 돌아오면 이어진다.
 *   실제 실행은 real-transfer-service의 실행 경계가 맡고, Mock 모드에서는 검증 조합이 설정된 빌드에서만 그 경계를 쓴다.
 * - 계좌번호 원문은 Mock에도 두지 않는다. 여기의 resolveDestinationAccountNumber는 항상 실패하고,
 *   앱은 services/index.ts에서 기기 저장소를 읽는 실제 resolver로 바꿔 끼운다.
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
