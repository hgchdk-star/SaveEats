import { draftCopy } from '@/config/draft-copy';
import { showToast } from '@/features/toast/toast-store';

/**
 * 묶음 2(로그인·계좌·주문 흐름)에서 만드는 화면으로 가는 자리.
 * 아직 그 화면들이 없어서 안내 토스트만 띄운다. 라우트가 생기면 각 함수에서 router.push로 바꾼다.
 * 로그인 후 원래 행동으로 돌아오는 것(pendingIntent)도 그때 함께 만든다.
 */

export type LoginIntent = { action: 'ORDER' } | { action: 'FAVORITE'; storeId: string } | { action: 'ACCOUNT' };

function notReady() {
  showToast({ message: draftCopy.pendingNextStep });
}

/** Guest가 로그인이 필요한 행동을 했을 때 (주문하기, 찜, 계좌 줄) */
export function goLogin(intent: LoginIntent): void {
  void intent;
  notReady();
}

/** 등록된 계좌 화면(변경·삭제) 또는 계좌 등록 폼 */
export function goAccount(): void {
  notReady();
}

/** 최종 주문 확인 화면 */
export function goOrderConfirm(): void {
  notReady();
}

/** 홈 카테고리 칩 → 카테고리 가게 목록 (묶음 4) */
export function goCategoryStoreList(categoryCode: string): void {
  void categoryCode;
  notReady();
}
