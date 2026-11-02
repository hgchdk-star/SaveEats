/**
 * 묶음 4(마이·설정)의 임시 타입.
 *
 * 이 영역은 서버 계약이 아직 없다(프로필 이름 수집은 OPEN-DB-004 미결정). 아래 타입은 Mock과 화면을 이어 주는 임시 모양이며
 * 합의된 계약이 아니다. 필드를 늘리거나 굳히지 말고, 계약이 나오면 `src/contracts/`의 타입으로 바꾼다.
 * 근거: 기획서 37·60, PRD 40·42·45·46, 개발 명세 DB-003·AUTH-004·API-002.
 */

/**
 * 공개 닉네임과 마스킹된 이메일. 실명은 수집하지 않는다(OPEN-DB-004).
 * 닉네임이 null이면 "조회는 됐지만 아직 정하지 않은" 기존 계정이다. 조회 실패는 이 값이 아니라 오류로 올라온다(둘을 섞지 않는다).
 */
export type MockProfile = { nickname: string | null; maskedEmail: string };

/** 누적 기록: USER_CONFIRMED만 센다. hasAnyOrder는 상태와 관계없이 주문이 하나라도 있는지(Zero State 판단) */
export type MockLifetimeRecord = { orderCount: number; deliveredAmount: number; hasAnyOrder: boolean };

export type NotificationType = 'orderStatus' | 'reviewAvailable' | 'monthlyRecord';
export type MockNotificationSettings = Record<NotificationType, boolean>;

export interface MyService {
  getProfile(): Promise<MockProfile>;
  /**
   * 본인 닉네임을 저장한다(가입 직후 설정 · 설정에서 변경). 규칙 검증은 앱과 서버가 같게 한다.
   * 실패 코드: NICKNAME_INVALID(규칙 위반) · NETWORK_UNAVAILABLE · 그 밖의 오류. 서버 오류 원문은 화면에 올리지 않는다.
   * supabase 모드에서는 set_my_nickname(p_nickname)을 부른다(services/profile/supabase-profile.ts). 규칙 위반은 NICKNAME_INVALID 하나다.
   */
  saveNickname(nickname: string): Promise<void>;
  getLifetimeRecord(): Promise<MockLifetimeRecord>;
  getNotificationSettings(): Promise<MockNotificationSettings>;
  /** 목표값을 보낸다. 같은 값을 두 번 보내도 결과가 같다 */
  updateNotificationSetting(input: { type: NotificationType; enabled: boolean }): Promise<MockNotificationSettings>;
}
