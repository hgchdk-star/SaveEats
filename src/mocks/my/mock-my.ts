import { failOnce, mockDelay, mockScenario } from '@/mocks/scenario';
import { getDb } from '@/mocks/server/db';
import { useMockSession } from '@/mocks/session/mock-session';
import { ServiceError } from '@/services/service-error';
import { maskEmail } from '@/utils/mask';

import type { MockNotificationSettings, MyService } from './types';

/** 가상 사용자의 마스킹된 이름. 실제 서버는 이름을 수집하지 않으면 null을 준다 (OPEN-DB-004) */
const MASKED_NAME = '김*수';

async function request(): Promise<void> {
  await mockDelay();
  if (mockScenario.network !== 'online') throw new ServiceError('NETWORK_UNAVAILABLE');
}

function requireMember(): void {
  if (!useMockSession.getState().isMember) throw new ServiceError('AUTH_REQUIRED');
}

/** 서버에 저장된 알림 설정(이번 실행 동안). 기본은 모두 켬 */
let notificationSettings: MockNotificationSettings = { orderStatus: true, reviewAvailable: true, monthlyRecord: true };

export function createMockMyService(): MyService {
  return {
    async getProfile() {
      await request();
      requireMember();
      const email = useMockSession.getState().email ?? '';
      return { maskedName: MASKED_NAME, maskedEmail: maskEmail(email) };
    },

    async getLifetimeRecord() {
      await request();
      requireMember();
      if (mockScenario.myRecord === 'failOnce' && failOnce('my:lifetime')) throw new ServiceError('NETWORK_UNAVAILABLE');
      if (mockScenario.myRecord === 'newUser') return { orderCount: 0, deliveredAmount: 0, hasAnyOrder: false };
      const { orders } = await getDb();
      // 누적 기록은 월간 요약과 같은 기준: 주문 완료(USER_CONFIRMED)만. 완료가 필요한 주문·취소한 주문 금액은 넣지 않는다
      const done = orders.filter((o) => o.status === 'USER_CONFIRMED');
      return { orderCount: done.length, deliveredAmount: done.reduce((sum, o) => sum + o.approvedTotalAmount, 0), hasAnyOrder: orders.length > 0 };
    },

    async getNotificationSettings() {
      await request();
      requireMember();
      if (mockScenario.notif === 'loadFailOnce' && failOnce('notif:load')) throw new ServiceError('NETWORK_UNAVAILABLE');
      return { ...notificationSettings };
    },

    async updateNotificationSetting({ type, enabled }) {
      await request();
      requireMember();
      if (mockScenario.notif === 'saveFailOnce' && failOnce('notif:save')) throw new ServiceError('NETWORK_UNAVAILABLE');
      notificationSettings = { ...notificationSettings, [type]: enabled };
      return { ...notificationSettings };
    },
  };
}
