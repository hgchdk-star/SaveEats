import { useHistoryStore } from '@/features/history/history-store';

import { useReviewStore } from './review-store';

/**
 * 리뷰를 만들거나 고치거나 지운 뒤에 호출한다.
 * 리뷰 목록 화면들이 다시 불러오게 하고, 내역 행의 리뷰 버튼(작성 / 작성 완료 / 기간 지남)을
 * 앱이 계산하지 않고 서버 기준으로 다시 받는다.
 */
export function afterReviewChanged(): void {
  useReviewStore.getState().bumpMutation();
  const history = useHistoryStore.getState();
  if (history.load === 'ok') void history.loadFirst({ refresh: true });
}
