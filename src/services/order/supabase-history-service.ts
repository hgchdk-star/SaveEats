import type { HistoryService } from '@/mocks/history/types';

import { parseHistoryPageDto, parseHistoryRowDto, parseUnreadSummaryDto, parseViewedDto } from './order-dto';
import { callOrderRpc } from './supabase-order-service';

/**
 * 내역 서비스의 실서버 구현 (혜지, 2026-11-04 개발 프로젝트에 반영, 이름은 서버 쪽 기준).
 * - list_my_orders({ p_page_size, p_cursor }): 처음 페이지는 p_cursor를 보내지 않는다. 범위 밖 · 잘못된 cursor는 INVALID_INPUT
 * - get_my_history_order({ p_order_id }): 목록의 한 줄과 같은 모양. 없으면 RESOURCE_NOT_FOUND
 * - get_my_history_unread_summary(): { unreadEvents, unreadOrderCount, asOf }
 * - mark_status_updates_viewed({ p_event_ids }): 한 번에 최대 100개(앱이 100개씩 나눠 보낸다). 읽은 이벤트만 보내고 주문 · 탭 전체를 읽음 처리하지 않는다
 * 월간 요약(getMonthlySummary)은 서버 함수가 아직 없어 Mock이다. 이 서비스는 base(Mock)를 받아 나머지를 그대로 둔다.
 * 오류 처리와 응답 파싱은 주문 서비스와 같다(서버 업무 오류는 코드로, 응답을 받지 못하면 결과를 모르는 오류로).
 */
export function createSupabaseHistoryService(base: HistoryService): HistoryService {
  return {
    ...base,
    async listMyOrders({ cursor, pageSize }) {
      const args: Record<string, unknown> = { p_page_size: pageSize };
      if (cursor !== null) args.p_cursor = cursor;
      return parseHistoryPageDto(await callOrderRpc('list_my_orders', args));
    },

    async getMyOrder(orderId) {
      return parseHistoryRowDto(await callOrderRpc('get_my_history_order', { p_order_id: orderId }));
    },

    async getHistoryUnreadSummary() {
      return parseUnreadSummaryDto(await callOrderRpc('get_my_history_unread_summary', {}));
    },

    async markStatusUpdatesViewed(eventIds) {
      return parseViewedDto(await callOrderRpc('mark_status_updates_viewed', { p_event_ids: eventIds }));
    },
  };
}
