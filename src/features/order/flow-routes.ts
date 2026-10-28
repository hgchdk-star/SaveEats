import { router } from 'expo-router';

import { draftCopy } from '@/config/draft-copy';
import { useLoginIntentStore, type LoginIntent } from '@/features/auth/login-intent-store';
import { showToast } from '@/features/toast/toast-store';
import { getSession } from '@/services/session';

/**
 * 주문 흐름으로 들어가는 길과, 아직 연결되지 않은 다른 묶음 화면으로 가는 자리.
 * 화면은 라우트 문자열을 직접 쓰지 않고 이 함수를 부른다.
 */

/** Guest가 로그인이 필요한 행동을 했을 때 (주문하기, 찜, 계좌 줄). 하려던 행동을 보관하고 로그인 화면을 연다 */
export function goLogin(intent: LoginIntent): void {
  useLoginIntentStore.getState().setIntent(intent);
  router.push('/login');
}

/** 계좌 줄: Guest면 로그인, 계좌가 있으면 계좌 화면(변경·삭제), 없으면 등록 폼 */
export function goAccount(): void {
  const { isMember, destinationAccount } = getSession();
  if (!isMember) goLogin({ action: 'ACCOUNT' });
  else if (destinationAccount) router.push('/account');
  else router.push({ pathname: '/account/form', params: { mode: 'register', from: 'manage' } });
}

/** 주문 중에 계좌를 등록한다. 등록이 끝나면 최종 주문 확인으로 돌아온다 */
export function goAccountRegisterForOrder(): void {
  router.push({ pathname: '/account/form', params: { mode: 'register', from: 'order' } });
}

/** 최종 주문 확인 */
export function goOrderConfirm(): void {
  router.push('/order/confirm');
}

/** 내역. 내역 화면은 묶음 3에서 만든다. 지금은 빈 탭이 열린다 */
export function goHistory(): void {
  router.dismissAll();
  router.navigate('/history');
}

/** 주문 흐름을 끝내고 홈으로 */
export function goHome(): void {
  router.dismissAll();
}

/* ---------- 아직 연결되지 않은 다른 묶음의 화면. 안내 토스트만 띄운다 ---------- */

function notReady() {
  showToast({ message: draftCopy.pendingNextStep });
}

/** 홈 카테고리 칩 → 카테고리 가게 목록 (묶음 4) */
export function goCategoryStoreList(categoryCode: string): void {
  void categoryCode;
  notReady();
}

/** 주문 완료 → SaveEats 리뷰 쓰기 (묶음 3) */
export function goReviewWrite(): void {
  notReady();
}
