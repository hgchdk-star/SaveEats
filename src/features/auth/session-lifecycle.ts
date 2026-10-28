import { router } from 'expo-router';

import { draftCopy } from '@/config/draft-copy';
import { useFavoritesStore } from '@/features/favorites/favorites-store';
import { useHistoryStore } from '@/features/history/history-store';
import { useOrderFlowStore } from '@/features/order/order-flow-store';
import { recoverOnStart } from '@/features/order/recovery';
import { useReviewStore } from '@/features/review/review-store';
import { showToast } from '@/features/toast/toast-store';
import { authService } from '@/services';

import { useLoginIntentStore } from './login-intent-store';

/**
 * 로그인·로그아웃에 따른 개인 데이터 정리 (AUTH-004).
 *
 * 화면 메모리에 있는 개인 데이터(내역 · 읽지 않음 · 내 리뷰 표시 · 찜 표시 · 진행 중인 주문 화면 상태)를 지운다.
 * 기기에 저장된 개인 기록(완료 확인 큐 · 주문 생성 시도 · 읽음 대기)은 지우지 않고 사용자별 키로 격리해 둔다:
 * 로그아웃은 토큰 정리일 뿐 주문 취소 · 기록 삭제가 아니고, 완료 확인 의도가 사라지면 안 되기 때문이다.
 * 다른 계정으로 로그인하면 키가 달라 이전 계정의 기록을 읽지도 처리하지도 않는다. 원래 계정으로 다시 로그인할 때만 복구한다.
 * Guest 장바구니 영역은 지우지 않고, 사용자 장바구니를 복제하지도 않는다 (서버 장바구니 계약 전까지 기기 장바구니는 하나뿐이다).
 * 최근 검색어 · 최근 본 항목은 이 기기에만 있고 계정과 분리돼 있어 건드리지 않는다.
 */
export function clearPersonalData(): void {
  useHistoryStore.getState().reset();
  useReviewStore.getState().reset();
  useFavoritesStore.getState().reset();
  useOrderFlowStore.getState().reset();
  useLoginIntentStore.getState().setIntent(null);
}

/** 로그아웃: 확인 시트 없이 바로 한다 (미결정 묶음4 #3). 토큰 정리에 실패해도 이 기기의 세션은 닫는다 */
export async function logout(): Promise<void> {
  try {
    await authService.signOut();
  } catch {
    // 서버 쪽 정리가 실패해도 기기 화면에서는 로그아웃 처리한다. 이미 발급된 토큰의 서버 유효기간과는 별개다
  }
  clearPersonalData();
  router.dismissAll();
  router.navigate('/');
  showToast({ message: draftCopy.settings.toastLoggedOut });
}

/**
 * 로그인에 성공한 직후: 이 사용자의 기기 기록(완료 확인 큐 · 읽음 대기)을 복구한다.
 * 이전 사용자의 화면 데이터는 로그아웃 때 이미 비웠으므로 여기서 다시 지우지 않는다(로그인 전에 받은 리뷰로 도움돼요를 이어가야 한다).
 */
export function afterLogin(): void {
  void recoverOnStart();
}
