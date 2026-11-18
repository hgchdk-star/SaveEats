-- set_helpful: 자기 리뷰에도 도움돼요(함께해요)를 누를 수 있게 한다.
-- 근거: 지우의 앱 변경(내 리뷰에도 '함께해요'를 누를 수 있게 변경, fix/helpful-copy-hamkkehaeyo)에 서버를 맞춘다. 문서 정리는 서정이 한다.
--
-- 바뀌는 것 (create or replace, 시그니처 · 권한 그대로. 20261108010000_review_ensure_profile의 정의에서 아래만 뺀다)
--   - 리뷰 작성자 본인이 누르면 SELF_HELPFUL_NOT_ALLOWED로 거절하던 검사를 없앤다 (v_owner 조회와 if 문).
--     리뷰 작성자 열(user_id)은 더 이상 읽지 않는다. 삭제된 리뷰는 그대로 RESOURCE_NOT_FOUND다.
-- 그대로인 것
--   - 응답 키 { reviewId, helpful, helpfulCount, replayed }, 목표값(desired) 방식, 멱등(operationId · 영수증 재생), 오류 코드와 검사 순서,
--     로그인 필요(AUTH_REQUIRED), 프로필 행 보장(ensure profile), 잠금(리뷰 행 FOR SHARE).
--   - review_helpful 테이블: 자기 리뷰를 막는 CHECK · 트리거 · 정책은 원래 없었다(막은 곳은 이 함수뿐). 그래서 제거할 제약이 없다.
--   - 목록 응답(list_public_reviews · list_my_reviews)의 helpfulCount · myHelpful · isMine 계산은 작성자와 무관하게 이미 도움돼요 행 기준이다.
-- 영향: 가게 · 메뉴 리뷰 목록의 helpfulCount(도움순 정렬 포함)에 작성자 본인이 누른 것도 포함된다.
-- 앱의 SELF_HELPFUL_NOT_ALLOWED 오류 코드 목록은 이 migration과 무관하다(앱 변경은 지우 몫).

create or replace function public.set_helpful(p_review_id uuid, p_operation_id uuid, p_desired boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_deleted timestamptz;
  v_fp text;
  v_receipt record;
  v_count bigint;
  v_result jsonb;
  v_inserted boolean;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;
  insert into public.profiles (id) values (v_uid) on conflict (id) do nothing;
  if p_review_id is null or p_operation_id is null or p_desired is null then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;

  select r.deleted_at into v_deleted
  from public.reviews r
  where r.id = p_review_id
  for share;
  if not found then
    raise exception using errcode = 'P0001', message = 'RESOURCE_NOT_FOUND';
  end if;

  v_fp := private.review_fingerprint('helpful', p_review_id, null, case when p_desired then 'true' else 'false' end);
  select c.command_kind, c.request_fingerprint, c.result_payload into v_receipt
  from private.review_command_receipts c
  where c.user_id = v_uid and c.operation_id = p_operation_id;
  if found then
    if v_receipt.command_kind = 'helpful' and v_receipt.request_fingerprint = v_fp then
      return v_receipt.result_payload || jsonb_build_object('replayed', true);
    end if;
    raise exception using errcode = 'P0001', message = 'REVIEW_OPERATION_CONFLICT';
  end if;

  if v_deleted is not null then
    raise exception using errcode = 'P0001', message = 'RESOURCE_NOT_FOUND';
  end if;

  if p_desired then
    insert into public.review_helpful (review_id, user_id) values (p_review_id, v_uid)
    on conflict (review_id, user_id) do nothing;
  else
    delete from public.review_helpful where review_id = p_review_id and user_id = v_uid;
  end if;

  select count(*) into v_count from public.review_helpful h where h.review_id = p_review_id;
  v_result := jsonb_build_object('reviewId', p_review_id, 'helpful', p_desired, 'helpfulCount', v_count);

  -- 같은 operationId가 동시에 오면 하나만 영수증을 남기고, 나머지는 그 영수증으로 재생한다
  insert into private.review_command_receipts (user_id, operation_id, command_kind, request_fingerprint, target_id, applied_review_id, result_payload)
  values (v_uid, p_operation_id, 'helpful', v_fp, p_review_id, p_review_id, v_result)
  on conflict (user_id, operation_id) do nothing
  returning true into v_inserted;

  if v_inserted is null then
    select c.command_kind, c.request_fingerprint, c.result_payload into v_receipt
    from private.review_command_receipts c
    where c.user_id = v_uid and c.operation_id = p_operation_id;
    if v_receipt.command_kind = 'helpful' and v_receipt.request_fingerprint = v_fp then
      return v_receipt.result_payload || jsonb_build_object('replayed', true);
    end if;
    raise exception using errcode = 'P0001', message = 'REVIEW_OPERATION_CONFLICT';
  end if;

  return v_result || jsonb_build_object('replayed', false);
end;
$$;
