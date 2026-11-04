import type { ReviewService } from '@/mocks/history/types';
import { callOrderRpc } from '@/services/order/supabase-order-service';
import { ServiceError } from '@/services/service-error';

import { parseDeletedDto, parseHelpfulDto, parsePublicReviewPageDto, parseReviewDto, parseReviewEligibilityDto, parseReviewPageDto } from './review-dto';

/**
 * 리뷰 서비스의 실서버 구현 (혜지, 2026-11-04 개발 프로젝트에 반영). 호출 · 오류 처리는 주문 서비스(callOrderRpc)와 같다.
 * - get_review_eligibility({ p_order_id })
 * - list_public_reviews({ p_scope_type 'store'|'menu', p_scope_id, p_sort, p_cursor, p_page_size }) — 처음 페이지는 p_cursor를 보내지 않는다
 * - list_my_reviews({ p_cursor, p_page_size })
 * - create_review({ p_order_id, p_operation_id, p_rating, p_body }) / update_review({ p_review_id, p_operation_id, p_expected_revision, p_rating, p_body })
 * - delete_review({ p_review_id, p_operation_id, p_expected_revision }) / set_helpful({ p_review_id, p_operation_id, p_desired })
 * 쓰기 응답에는 replayed가 있다(같은 operationId 재시도). 사진은 서버가 받지 않아 업로드는 지원하지 않고,
 * 화면에서도 사진 선택 · 사진 필터를 숨긴다(reviewPhotosEnabled). 그래서 photoOnly는 서버에 보내지 않는다.
 */
export function createSupabaseReviewService(): ReviewService {
  return {
    async getReviewEligibility(orderId) {
      return parseReviewEligibilityDto(await callOrderRpc('get_review_eligibility', { p_order_id: orderId }));
    },

    async listPublicReviews({ scope, sort, cursor, pageSize }) {
      const args: Record<string, unknown> = { p_scope_type: scope.type, p_scope_id: scope.id, p_sort: sort, p_page_size: pageSize };
      if (cursor !== null) args.p_cursor = cursor;
      return parsePublicReviewPageDto(await callOrderRpc('list_public_reviews', args));
    },

    async listMyReviews({ cursor, pageSize }) {
      const args: Record<string, unknown> = { p_page_size: pageSize };
      if (cursor !== null) args.p_cursor = cursor;
      return parseReviewPageDto(await callOrderRpc('list_my_reviews', args));
    },

    async uploadReviewImage() {
      // 사진은 서버가 받지 않는다. 화면이 사진 선택을 숨기므로 여기에 오지 않는다
      throw new ServiceError('UPLOAD_FAILED');
    },

    async createReview({ orderId, operationId, rating, body }) {
      return parseReviewDto(await callOrderRpc('create_review', { p_order_id: orderId, p_operation_id: operationId, p_rating: rating, p_body: body }));
    },

    async updateReview({ reviewId, operationId, expectedRevision, rating, body }) {
      return parseReviewDto(
        await callOrderRpc('update_review', { p_review_id: reviewId, p_operation_id: operationId, p_expected_revision: expectedRevision, p_rating: rating, p_body: body }),
      );
    },

    async deleteReview({ reviewId, operationId, expectedRevision }) {
      return parseDeletedDto(await callOrderRpc('delete_review', { p_review_id: reviewId, p_operation_id: operationId, p_expected_revision: expectedRevision }));
    },

    async setHelpful({ reviewId, operationId, desired }) {
      return parseHelpfulDto(await callOrderRpc('set_helpful', { p_review_id: reviewId, p_operation_id: operationId, p_desired: desired }));
    },
  };
}
