import { router } from 'expo-router';

import { useFavoritesStore } from '@/features/favorites/favorites-store';
import { useReviewStore } from '@/features/review/review-store';
import { getSession } from '@/services/session';

import type { LoginIntent } from './login-intent-store';

/**
 * 로그인에 성공한 뒤 원래 하려던 행동으로 돌아간다 (AUTH-003).
 * 로그인 성공만으로 주문 생성·외부 앱 실행·완료 확인을 하지 않는다. 주문은 최종 주문 확인 화면까지만 데려가고,
 * 최종 고지와 버튼은 사용자가 다시 확인한다.
 */
export function resumeAfterLogin(intent: LoginIntent | null): void {
  const { destinationAccount } = getSession();

  switch (intent?.action) {
    case 'ORDER':
      // 계좌가 있으면 최종 주문 확인으로. 없으면 장바구니로 돌아가 '계좌 필요' 시트를 보여준다
      if (destinationAccount) router.replace('/order/confirm');
      else router.dismissTo({ pathname: '/cart', params: { sheet: 'needAccount' } });
      return;
    case 'ACCOUNT':
      if (destinationAccount) router.replace('/account');
      else router.replace({ pathname: '/account/form', params: { mode: 'register', from: 'manage' } });
      return;
    case 'FAVORITE':
      // 찜 이어가기는 목표값 명령(desired=true)이라 두 번 눌러도 안전하다
      router.back();
      void useFavoritesStore.getState().toggle(intent.storeId, true);
      return;
    case 'HELPFUL': {
      // 도움돼요도 목표값 명령이라 안전하다. 로그인 전에 받은 리뷰가 아직 있을 때만 이어간다
      router.back();
      const review = useReviewStore.getState().byId[intent.reviewId];
      if (review) void useReviewStore.getState().toggleHelpful(review, true);
      return;
    }
    default:
      if (router.canGoBack()) router.back();
      else router.replace('/');
  }
}
