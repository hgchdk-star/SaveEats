-- 리뷰 쓰기 함수의 프로필 행 보장: create_review · set_helpful (create or replace)
-- 배경: 프로필 행이 없는 계정이 set_helpful을 부르면 review_helpful.user_id → profiles FK(review_helpful_user_id_fkey, 23503)로 실패했다.
--       create_review의 reviews.user_id → profiles FK도 같은 구조다(정상 경로에서는 주문 때 프로필이 생겨 드러나지 않지만, 주문은 있고
--       프로필이 없는 어긋난 데이터에서는 같은 오류가 난다).
-- 변경: 두 함수가 로그인 확인 직후 create_order와 같은 방식으로 프로필 행을 만든다(이미 있으면 그대로 둔다).
--       그 밖의 동작(검증 순서 · 영수증 · 오류 코드 · 응답 모양)은 20261107000000_reviews_core.sql과 같다.
--       실패(예외)하면 같은 트랜잭션이라 프로필 행도 함께 롤백되므로, 실패한 호출이 프로필을 남기지 않는다.
-- update_review · delete_review는 기존 리뷰(= 프로필)가 있어야 하므로 바꾸지 않는다.
-- create or replace라서 함수 권한(authenticated 실행 가능, anon · PUBLIC 불가)은 그대로 유지된다.

create or replace function public.create_review(p_order_id uuid, p_operation_id uuid, p_rating integer, p_body text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_status text;
  v_completed timestamptz;
  v_store uuid;
  v_fp text;
  v_receipt record;
  v_body text;
  v_now timestamptz;
  v_review_id uuid;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;
  insert into public.profiles (id) values (v_uid) on conflict (id) do nothing;
  if p_order_id is null or p_operation_id is null then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;

  select o.status, o.completed_at, o.store_id into v_status, v_completed, v_store
  from public.orders o
  where o.id = p_order_id and o.user_id = v_uid
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'RESOURCE_NOT_FOUND';
  end if;

  v_fp := private.review_fingerprint('create', p_order_id, p_rating, p_body);
  select c.command_kind, c.request_fingerprint, c.result_payload into v_receipt
  from private.review_command_receipts c
  where c.user_id = v_uid and c.operation_id = p_operation_id;
  if found then
    if v_receipt.command_kind = 'create' and v_receipt.request_fingerprint = v_fp then
      return v_receipt.result_payload || jsonb_build_object('replayed', true);
    end if;
    raise exception using errcode = 'P0001', message = 'REVIEW_OPERATION_CONFLICT';
  end if;

  v_body := private.normalize_review_input(p_rating, p_body);

  if v_status <> 'USER_CONFIRMED' or v_completed is null then
    raise exception using errcode = 'P0001', message = 'ORDER_NOT_COMPLETED';
  end if;

  -- 주문 행 잠금 이후의 시각으로 기한을 본다 (오래 기다린 트랜잭션의 시작 시각으로 우회하지 못하게)
  v_now := clock_timestamp();
  if not private.is_review_window_open(v_completed, v_now) then
    raise exception using errcode = 'P0001', message = 'REVIEW_DEADLINE_EXCEEDED';
  end if;

  if exists (select 1 from public.reviews r where r.order_id = p_order_id and r.deleted_at is null) then
    raise exception using errcode = 'P0001', message = 'ACTIVE_REVIEW_EXISTS';
  end if;

  insert into public.reviews (order_id, user_id, store_id, craving_rating, body, created_at, updated_at)
  values (p_order_id, v_uid, v_store, p_rating, v_body, v_now, v_now)
  returning id into v_review_id;

  insert into public.review_menus (review_id, menu_id)
  select distinct v_review_id, i.menu_id from public.order_items i where i.order_id = p_order_id;

  v_result := private.review_json(v_review_id, v_uid, true);
  insert into private.review_command_receipts (user_id, operation_id, command_kind, request_fingerprint, target_id, applied_review_id, applied_revision, result_payload)
  values (v_uid, p_operation_id, 'create', v_fp, p_order_id, v_review_id, 1, v_result);

  return v_result || jsonb_build_object('replayed', false);
end;
$$;

create or replace function public.set_helpful(p_review_id uuid, p_operation_id uuid, p_desired boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_owner uuid;
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

  select r.user_id, r.deleted_at into v_owner, v_deleted
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
  if v_owner = v_uid then
    raise exception using errcode = 'P0001', message = 'SELF_HELPFUL_NOT_ALLOWED';
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
