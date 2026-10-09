/**
 * 묶음 4(마이·설정)의 임시 타입.
 *
 * 이 영역은 서버 계약이 아직 없다(프로필 이름 수집은 OPEN-DB-004 미결정). 아래 타입은 Mock과 화면을 이어 주는 임시 모양이며
 * 합의된 계약이 아니다. 필드를 늘리거나 굳히지 말고, 계약이 나오면 `src/contracts/`의 타입으로 바꾼다.
 * 근거: 기획서 37·60, PRD 40·42·45·46, 개발 명세 DB-003·AUTH-004·API-002.
 */

/** 마스킹된 프로필만 받는다. 이름은 수집하지 않을 수 있어 null일 수 있다 (OPEN-DB-004) */
export type MockProfile = { maskedName: string | null; maskedEmail: string };

/** 누적 기록: USER_CONFIRMED만 센다. hasAnyOrder는 상태와 관계없이 주문이 하나라도 있는지(Zero State 판단) */
export type MockLifetimeRecord = { orderCount: number; deliveredAmount: number; hasAnyOrder: boolean };

export type NotificationType = 'orderStatus' | 'reviewAvailable' | 'monthlyRecord';
export type MockNotificationSettings = Record<NotificationType, boolean>;

export interface MyService {
  getProfile(): Promise<MockProfile>;
  getLifetimeRecord(): Promise<MockLifetimeRecord>;
  getNotificationSettings(): Promise<MockNotificationSettings>;
  /** 목표값을 보낸다. 같은 값을 두 번 보내도 결과가 같다 */
  updateNotificationSetting(input: { type: NotificationType; enabled: boolean }): Promise<MockNotificationSettings>;
}
