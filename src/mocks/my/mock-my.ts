import { failOnce, mockDelay, mockScenario } from '@/mocks/scenario';
import { getDb } from '@/mocks/server/db';
import { useMockSession } from '@/mocks/session/mock-session';
import { ServiceError } from '@/services/service-error';
import { maskEmail } from '@/utils/mask';
import { checkNickname } from '@/utils/nickname';

import type { MockNotificationSettings, MyService } from './types';

/** 가상 사용자의 닉네임. profileNoNickname 시나리오는 닉네임이 없는 기존 계정이다. 새로 가입하면 가입 때 저장한 값으로 바뀐다 */
let nickname: string | null = mockScenario.profile === 'noNickname' ? null : '세이브이츠';

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
      // 마이와 설정이 각자 조회하므로 앞의 두 번을 실패시켜야 두 화면의 실패 표시를 모두 볼 수 있다
      if (mockScenario.profile === 'loadFailOnce' && (failOnce('profile:load:1') || failOnce('profile:load:2'))) throw new ServiceError('NETWORK_UNAVAILABLE');
      const email = useMockSession.getState().email ?? '';
      return { nickname, maskedEmail: maskEmail(email) };
    },

    async saveNickname(next) {
      await request();
      requireMember();
      if (mockScenario.profile === 'saveFailOnce' && failOnce('profile:save')) throw new ServiceError('NETWORK_UNAVAILABLE');
      // 서버도 같은 규칙으로 검증한다
      const checked = checkNickname(next);
      if (!checked.ok) throw new ServiceError('NICKNAME_INVALID');
      nickname = checked.value;
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
