-- 취소 주문 내역 숨기기(hide_cancelled_order)와 완료 정정(correct_order_completion)
-- 근거: 서정 확정 2026-11-11 (PRD FR-HIST-026 · FR-HIST-027, FR-ORD-055 · FR-ORD-056, 개발 명세 "내역 숨기기" · "완료 정정" 행). 함수 이름 · 시그니처는 혜지 설계.
-- 이미 적용된 migration은 수정하지 않는다. 바꾸는 함수는 create or replace로 새로 정의한다.
--
-- 1. hide_cancelled_order(p_order_id uuid) → { orderId, hidden: true, replayed }
--    - CANCELLED 주문만 내 내역에서 숨긴다. 서버의 주문 기록은 지우지 않는다(물리 삭제 아님, 집계 · 이력 보존).
--    - PENDING · USER_CONFIRMED는 ORDER_NOT_HIDEABLE로 거절한다. 서버가 대신 취소하지 않는다(앱이 기존 cancel_order로 먼저 CANCELLED로 만든 뒤 부른다).
--    - 이미 숨긴 주문을 다시 부르면 오류 없이 replayed: true (시각은 처음 숨긴 값 그대로).
--    - 저장: orders.hidden_at timestamptz null. NULL → 시각으로만 바뀌며 되돌리기 · 다른 값으로 변경 · 삭제는 불가(가드 트리거 + CHECK).
--    - SECURITY DEFINER인 이유: 앱(authenticated)은 orders에 쓰기 권한이 없다(열 단위 SELECT만). confirm_order · cancel_order와 같은 이유와 같은 방식.
--      search_path는 ''로 고정하고 authenticated만 실행한다(anon · PUBLIC 거부).
--    - 숨긴 주문은 list_my_orders · get_my_history_order · get_my_history_unread_summary에서 빠진다. get_my_order(한 건 조회)와 월간 · 누적 요약은 그대로다.
-- 2. correct_order_completion(p_order_id uuid, p_operation_id uuid) → get_my_order(...) 결과 || { replayed }
--    - 실수로 누른 "수령 확인(주문 완료했어요)"을 되돌린다. USER_CONFIRMED → CANCELLED, status_revision +1, completed_at null, cancelled_at = 서버 시각.
--    - PENDING으로 되돌리지 않는다(PENDING 복원 금지). 활성 리뷰가 있으면 ORDER_HAS_REVIEW(삭제된 리뷰는 막지 않는다).
--    - order_status_updates에 nullable 열 reason을 더하고 이 변경 행에 'COMPLETION_CORRECTED'를 기록한다. (order_id, operation_id) unique가 멱등을 맡는다.
--    - 잠금: 주문 행을 FOR UPDATE로 먼저 잠근다. create_review · confirm_order · cancel_order도 주문 행이 첫 잠금이라 순서가 같다(교착 없음).
--      create_review가 먼저면 정정이 활성 리뷰를 보고 ORDER_HAS_REVIEW, 정정이 먼저면 create_review가 ORDER_NOT_COMPLETED를 받는다.
--      리뷰가 달린 주문이 CANCELLED가 되는 경쟁은 없다.
--    - orders_guard에는 이 간선(USER_CONFIRMED → CANCELLED, revision +1, completed_at null, cancelled_at 설정)만 추가로 허용한다. 그 밖의 종료 상태 불변 규칙은 그대로다.
--    - 응답에 reason은 넣지 않는다(앱 DTO 변경 없음).
--
-- 오류 코드: P0001 + 메시지가 코드 문자열.
--   hide_cancelled_order        AUTH_REQUIRED · INVALID_INPUT · RESOURCE_NOT_FOUND(없음/남의 주문) · ORDER_NOT_HIDEABLE
--   correct_order_completion    AUTH_REQUIRED · INVALID_INPUT · RESOURCE_NOT_FOUND · INVALID_ORDER_TRANSITION · ORDER_HAS_REVIEW · OPERATION_CONFLICT

-- ---------------------------------------------------------------------------
-- 컬럼
-- ---------------------------------------------------------------------------

alter table public.orders add column hidden_at timestamptz;
-- 숨김은 취소된 주문에만 있다 (가드 트리거가 먼저 막지만 CHECK가 마지막 방어선)
alter table public.orders add constraint orders_hidden_only_cancelled check (hidden_at is null or status = 'CANCELLED');
-- 목록 함수(SECURITY INVOKER)가 hidden_at 조건을 쓰려면 열 SELECT 권한이 필요하다. 본인 행만 읽힌다(RLS). 쓰기 권한은 없다.
grant select (hidden_at) on public.orders to authenticated;

alter table public.order_status_updates add column reason text;
alter table public.order_status_updates add constraint order_status_updates_reason_check check (reason is null or reason in ('COMPLETION_CORRECTED'));

-- ---------------------------------------------------------------------------
-- 주문 행 가드: hidden_at(NULL → 시각, CANCELLED만)과 완료 정정 간선을 추가로 허용한다
-- ---------------------------------------------------------------------------

create or replace function private.guard_order_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- 상태와 관련된 네 열과 hidden_at 말고는 바꿀 수 없다
  if (to_jsonb(new) - array['status', 'status_revision', 'completed_at', 'cancelled_at', 'hidden_at'])
     is distinct from (to_jsonb(old) - array['status', 'status_revision', 'completed_at', 'cancelled_at', 'hidden_at']) then
    raise exception using errcode = 'P0001', message = 'ORDER_GUARD_VIOLATION',
      detail = '주문의 스냅샷·소유자·금액 등은 바꿀 수 없다.';
  end if;

  -- 숨김: CANCELLED 주문의 hidden_at이 NULL → 시각으로 바뀌는 것만 허용. 되돌리기 · 값 변경 · 삭제 불가. 상태 열은 함께 바꿀 수 없다.
  if new.hidden_at is distinct from old.hidden_at then
    if old.hidden_at is not null or new.hidden_at is null then
      raise exception using errcode = 'P0001', message = 'ORDER_GUARD_VIOLATION',
        detail = '숨긴 주문의 hidden_at은 되돌리거나 바꿀 수 없다.';
    end if;
    if old.status <> 'CANCELLED'
       or (new.status, new.status_revision, new.completed_at, new.cancelled_at)
          is distinct from (old.status, old.status_revision, old.completed_at, old.cancelled_at) then
      raise exception using errcode = 'P0001', message = 'ORDER_GUARD_VIOLATION',
        detail = '취소된 주문만 숨길 수 있고, 숨기면서 상태를 바꿀 수 없다.';
    end if;
    return new;
  end if;

  if old.status <> 'PENDING' then
    if (new.status, new.status_revision, new.completed_at, new.cancelled_at)
       is distinct from (old.status, old.status_revision, old.completed_at, old.cancelled_at) then
      -- 완료 정정 간선만 허용: USER_CONFIRMED → CANCELLED, revision +1, completed_at null, cancelled_at 설정
      if old.status = 'USER_CONFIRMED' and new.status = 'CANCELLED'
         and new.status_revision = old.status_revision + 1
         and new.completed_at is null and new.cancelled_at is not null then
        return new;
      end if;
      -- 그 밖의 terminal(USER_CONFIRMED / CANCELLED)은 상태·시각·revision 모두 고정
      raise exception using errcode = 'P0001', message = 'ORDER_GUARD_VIOLATION',
        detail = '완료·취소된 주문의 상태와 시각은 바꿀 수 없다.';
    end if;
  elsif new.status is distinct from old.status then
    -- PENDING에서 상태가 바뀔 때는 revision이 정확히 +1
    if new.status_revision <> old.status_revision + 1 then
      raise exception using errcode = 'P0001', message = 'ORDER_GUARD_VIOLATION',
        detail = '상태가 바뀔 때 status_revision은 정확히 1 늘어야 한다.';
    end if;
  elsif (new.status_revision, new.completed_at, new.cancelled_at)
        is distinct from (old.status_revision, old.completed_at, old.cancelled_at) then
    raise exception using errcode = 'P0001', message = 'ORDER_GUARD_VIOLATION',
      detail = '상태가 그대로면 revision과 시각도 그대로여야 한다.';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- hide_cancelled_order(p_order_id) → { orderId, hidden: true, replayed }
-- ---------------------------------------------------------------------------

create function public.hide_cancelled_order(p_order_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_status text;
  v_hidden timestamptz;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;
  if p_order_id is null then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;

  -- 본인 주문 행 잠금. 없거나 남의 주문이면 구별 없이 RESOURCE_NOT_FOUND
  select o.status, o.hidden_at into v_status, v_hidden
  from public.orders o
  where o.id = p_order_id and o.user_id = v_uid
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'RESOURCE_NOT_FOUND';
  end if;

  -- CANCELLED만 숨긴다. PENDING · USER_CONFIRMED는 거절하고 서버는 취소하지 않는다.
  if v_status <> 'CANCELLED' then
    raise exception using errcode = 'P0001', message = 'ORDER_NOT_HIDEABLE';
  end if;

  if v_hidden is not null then
    return jsonb_build_object('orderId', p_order_id, 'hidden', true, 'replayed', true);
  end if;

  update public.orders set hidden_at = clock_timestamp() where id = p_order_id;
  return jsonb_build_object('orderId', p_order_id, 'hidden', true, 'replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- correct_order_completion(p_order_id, p_operation_id) → get_my_order(...) || { replayed }
-- ---------------------------------------------------------------------------

create function public.correct_order_completion(p_order_id uuid, p_operation_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_status text;
  v_hist_reason text;
  v_found_hist boolean;
  v_now timestamptz;
  v_revision bigint;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;
  if p_order_id is null or p_operation_id is null then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;

  -- 본인 주문 행 잠금 (create_review · confirm_order · cancel_order와 같은 순서: 주문 행이 첫 잠금).
  -- 없거나 남의 주문이면 구별 없이 RESOURCE_NOT_FOUND
  select o.status into v_status
  from public.orders o
  where o.id = p_order_id and o.user_id = v_uid
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'RESOURCE_NOT_FOUND';
  end if;

  -- 이 operationId의 이력: 정정 기록이면 기존 결과(replayed), 다른 명령(생성 · 완료 · 취소)에 쓴 id면 OPERATION_CONFLICT
  select true, u.reason into v_found_hist, v_hist_reason
  from public.order_status_updates u
  where u.order_id = p_order_id and u.operation_id = p_operation_id;
  if coalesce(v_found_hist, false) then
    if v_hist_reason = 'COMPLETION_CORRECTED' then
      return public.get_my_order(p_order_id) || jsonb_build_object('replayed', true);
    end if;
    raise exception using errcode = 'P0001', message = 'OPERATION_CONFLICT';
  end if;

  if v_status <> 'USER_CONFIRMED' then
    raise exception using errcode = 'P0001', message = 'INVALID_ORDER_TRANSITION';
  end if;

  -- 주문 행 잠금 뒤에 읽으므로 create_review와 겹쳐도 한쪽만 이긴다 (삭제된 리뷰는 막지 않는다)
  if exists (select 1 from public.reviews r where r.order_id = p_order_id and r.deleted_at is null) then
    raise exception using errcode = 'P0001', message = 'ORDER_HAS_REVIEW';
  end if;

  v_now := clock_timestamp();
  update public.orders
  set status = 'CANCELLED',
      status_revision = status_revision + 1,
      completed_at = null,
      cancelled_at = v_now
  where id = p_order_id
  returning status_revision into v_revision;

  insert into public.order_status_updates (order_id, revision, operation_id, from_status, to_status, reason, created_at)
  values (p_order_id, v_revision, p_operation_id, 'USER_CONFIRMED', 'CANCELLED', 'COMPLETION_CORRECTED', v_now);

  return public.get_my_order(p_order_id) || jsonb_build_object('replayed', false);
end;
$$;

revoke execute on function public.hide_cancelled_order(uuid) from public, anon, authenticated;
revoke execute on function public.correct_order_completion(uuid, uuid) from public, anon, authenticated;
grant execute on function public.hide_cancelled_order(uuid) to authenticated;
grant execute on function public.correct_order_completion(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 내역 함수 3개: 숨긴 주문을 뺀다. 아래는 기존 정의에서 숨김 조건만 더한 create or replace다.
--   list_my_orders                 (원본 20261106000000_history_list.sql)  where에 hidden_at is null
--   get_my_history_unread_summary  (원본 20261106000000_history_list.sql)  where에 hidden_at is null
--   get_my_history_order           (원본 20261107000000_reviews_core.sql, reviewEligibility 포함)  숨긴 주문은 RESOURCE_NOT_FOUND
-- get_my_order · mark_status_updates_viewed · 월간/누적 요약 · 리뷰 함수는 건드리지 않는다.
-- ---------------------------------------------------------------------------

create or replace function public.list_my_orders(
  p_cursor text default null,
  p_page_size integer default 20
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_page_size integer := coalesce(p_page_size, 20);
  v_cursor jsonb;
  v_after_at timestamptz;
  v_after_id uuid;
  v_ids uuid[];
  v_ats timestamptz[];
  v_count integer;
  v_has_more boolean;
  v_items jsonb := '[]'::jsonb;
  v_next_cursor text;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;
  if v_page_size < 1 or v_page_size > 50 then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT',
      detail = 'pageSize must be between 1 and 50';
  end if;

  if p_cursor is not null then
    begin
      v_cursor := convert_from(decode(p_cursor, 'base64'), 'UTF8')::jsonb;
      if jsonb_typeof(v_cursor) = 'object' then
        v_after_at := (v_cursor ->> 'createdAt')::timestamptz;
        v_after_id := (v_cursor ->> 'orderId')::uuid;
      end if;
    exception when others then
      v_after_at := null;
      v_after_id := null;
    end;
    if v_after_at is null or v_after_id is null then
      raise exception using errcode = 'P0001', message = 'INVALID_INPUT',
        detail = 'invalid cursor';
    end if;
  end if;

  -- 한 건 더 읽어 hasMore를 정한다 (숨긴 주문은 뺀다)
  select array_agg(x.id order by x.created_at desc, x.id desc),
         array_agg(x.created_at order by x.created_at desc, x.id desc)
    into v_ids, v_ats
  from (
    select o.id, o.created_at
    from public.orders o
    where o.user_id = v_uid
      and o.hidden_at is null
      and (v_after_id is null or (o.created_at, o.id) < (v_after_at, v_after_id))
    order by o.created_at desc, o.id desc
    limit v_page_size + 1
  ) x;

  v_count := coalesce(cardinality(v_ids), 0);
  v_has_more := v_count > v_page_size;
  if v_has_more then
    v_ids := v_ids[1:v_page_size];
    v_ats := v_ats[1:v_page_size];
  end if;

  if cardinality(v_ids) > 0 then
    select coalesce(jsonb_agg(public.get_my_history_order(t.id) order by t.ord), '[]'::jsonb)
      into v_items
    from unnest(v_ids) with ordinality as t (id, ord);
  end if;

  if v_has_more then
    -- encode()는 76자마다 줄바꿈을 넣으므로 제거한다. 시각은 마이크로초까지 담는다.
    v_next_cursor := translate(encode(convert_to(
      jsonb_build_object(
        'createdAt', to_char(v_ats[cardinality(v_ats)] at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'orderId', v_ids[cardinality(v_ids)]
      )::text, 'UTF8'), 'base64'), E'\n', '');
  end if;

  return jsonb_build_object(
    'items', v_items,
    'hasMore', v_has_more,
    'nextCursor', v_next_cursor
  );
end;
$$;

create or replace function public.get_my_history_unread_summary()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_events jsonb;
  v_orders integer;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'eventId', u.id,
           'orderId', u.order_id,
           'revision', u.revision
         ) order by o.created_at desc, o.id desc, u.revision), '[]'::jsonb),
         count(distinct u.order_id)::integer
    into v_events, v_orders
  from public.order_status_updates u
  join public.orders o on o.id = u.order_id
  where o.user_id = v_uid and o.hidden_at is null and u.viewed_at is null;

  return jsonb_build_object(
    'unreadEvents', v_events,
    'unreadOrderCount', v_orders,
    'asOf', clock_timestamp()
  );
end;
$$;

create or replace function public.get_my_history_order(p_order_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_order jsonb;
  v_unread jsonb;
  v_menus jsonb;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;
  if p_order_id is null then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;

  -- 없거나 남의 주문이면 RESOURCE_NOT_FOUND (get_my_order가 던진다)
  v_order := public.get_my_order(p_order_id);

  -- 내가 숨긴 주문은 내역에서 열리지 않는다 (get_my_order로는 계속 조회된다)
  if exists (select 1 from public.orders o where o.id = p_order_id and o.user_id = v_uid and o.hidden_at is not null) then
    raise exception using errcode = 'P0001', message = 'RESOURCE_NOT_FOUND';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'eventId', u.id,
           'revision', u.revision,
           'createdAt', u.created_at
         ) order by u.revision), '[]'::jsonb)
    into v_unread
  from public.order_status_updates u
  join public.orders o on o.id = u.order_id
  where u.order_id = p_order_id and o.user_id = v_uid and u.viewed_at is null;

  -- 메뉴 · 가게 · 분류가 지금도 앱에서 열리는 것만 (카탈로그 RLS가 걸러 준다)
  select coalesce(jsonb_agg(x.menu_id order by x.first_line), '[]'::jsonb)
    into v_menus
  from (
    select i.menu_id, min(i.line_no) as first_line
    from public.order_items i
    join public.menus m on m.id = i.menu_id
    where i.order_id = p_order_id
    group by i.menu_id
  ) x;

  return v_order || jsonb_build_object(
    'unreadUpdates', v_unread,
    'validCurrentMenuRefs', v_menus,
    'reviewEligibility', public.get_review_eligibility(p_order_id)
  );
end;
$$;
