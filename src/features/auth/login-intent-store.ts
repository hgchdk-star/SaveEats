import { create } from 'zustand';

import type { Uuid } from '@/contracts/common';

/**
 * 로그인이 필요한 행동을 로그인 전에 보관한다 (AUTH-003 pendingIntent).
 * 허용된 행동 종류와 대상 식별자만 담고, 비밀번호·계좌번호·임의 URL은 담지 않는다.
 * 로그인에 성공하면 원래 행동으로 돌아가고, 닫으면 지운다.
 */
export type LoginIntent =
  | { action: 'ORDER' }
  | { action: 'FAVORITE'; storeId: Uuid }
  | { action: 'ACCOUNT' }
  | { action: 'HISTORY' }
  /** 찜 탭 · 마이 · 설정에서 로그인을 시작했다. 로그인하면 그 화면으로 돌아온다 */
  | { action: 'TAB'; tab: 'favorites' | 'my' | 'settings' }
  | { action: 'HELPFUL'; reviewId: string };

type LoginIntentState = {
  intent: LoginIntent | null;
  setIntent: (intent: LoginIntent | null) => void;
};

export const useLoginIntentStore = create<LoginIntentState>((set) => ({
  intent: null,
  setIntent: (intent) => set({ intent }),
}));
