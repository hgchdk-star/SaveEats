-- 주문 상태 전이: confirm_order · cancel_order (+ 주문 행 상태 가드 트리거)
-- 근거: 개발 명세 ORD-002 · ORD-008 · ORD-009 · ORD-011 · ORD-012, 팀 결정 (2026-11-04 T1~T8).
-- 계약 초안: order-contract-draft-v2.md (저장소 밖). orders_create(20261105000000)의 테이블을 그대로 쓴다.
--
-- 규칙:
--   함수   = confirm_order(p_order_id uuid, p_operation_id uuid), cancel_order(p_order_id uuid, p_operation_id uuid).
--            둘 다 SECURITY DEFINER + search_path 고정, auth.uid()만 대상. 앱은 주문 테이블에 쓸 수 없어서 DEFINER가 필요하다.
--            실제 일은 private.transition_order 하나가 한다(두 함수는 목표 상태만 다르다).
--   응답   = 주문 DTO 전체 + replayed (get_my_order와 같은 모양). 실제로 전이했으면 replayed:false,
--            기존 결과를 돌려주면(같은 operationId 재시도 · 다른 operationId로 이미 같은 terminal) replayed:true.
--   순서   = 로그인(AUTH_REQUIRED) → 형태(INVALID_INPUT: 주문 ID나 operationId가 null) → 본인 주문 행 FOR UPDATE
--            (없거나 남의 주문이면 RESOURCE_NOT_FOUND) → 이 operationId의 이력이 있으면 종류 확인
--            (다른 명령이면 OPERATION_CONFLICT, 같은 명령이면 기존 결과) → 이미 같은 terminal이면 기존 결과
--            → 반대 terminal이면 INVALID_ORDER_TRANSITION → PENDING이면 전이.
--            그래서 "취소에 쓴 operationId로 완료" 같은 재사용은 상태와 상관없이 OPERATION_CONFLICT가 먼저 나온다.
--   operationId = 새 UUID. 이력의 operation_id는 주문마다 유일하다(UNIQUE(order_id, operation_id)).
--            초기 NULL→PENDING 이력의 operation_id는 생성 요청의 멱등성 키(orders_create)라서, 그 주문의 생성 키를
--            confirm/cancel의 operationId로 쓰면 이력의 종류(PENDING=생성)가 달라 OPERATION_CONFLICT가 된다.
--            다른 주문에서 쓴 operationId는 이 주문에서 새 값으로 취급한다(서버는 주문 단위로만 구별).
--            UUID 형식이 아닌 문자열은 PostgREST가 22P02로 막는다(get_my_order와 같음). null은 INVALID_INPUT.
--   시각   = 전이할 때 clock_timestamp()를 한 번 잡아 completed_at(또는 cancelled_at)과 이력 created_at에 같이 쓴다.
--            재시도는 시각을 바꾸지 않는다. status_revision은 전이할 때만 +1, 이력 revision과 같다.
--   잠금   = 주문 행 FOR UPDATE 하나. 완료/취소가 동시에 와도 먼저 잠근 쪽만 전이하고 나머지는 결과를 돌려받거나 거절된다.
--            create_order는 profiles 행을 잠그므로 대상이 달라 서로 막지 않는다.
--   가드   = 주문 행에 가드 트리거를 둔다. 스냅샷·소유자·금액 같은 열은 UPDATE로 바꿀 수 없고, terminal 주문은 상태·시각·revision을
--            바꿀 수 없으며, PENDING → terminal은 status_revision이 정확히 +1일 때만 된다. 앱에는 쓰기 권한이 없지만 운영 SQL 실수를
--            막는 방어선이다. (이 트리거는 status · status_revision · completed_at · cancelled_at 외의 열 변경을 모두 막는다. 나중에
--            바꿔야 하는 열이 생기면 새 migration에서 트리거를 함께 고친다.)
--   범위 밖 = 읽음 처리(viewed_at 갱신)와 주문 목록 함수는 이 migration에 없다.

-- ---------------------------------------------------------------------------
-- 주문 행 가드
-- ---------------------------------------------------------------------------

create function private.guard_order_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- 상태와 관련된 네 열 말고는 바꿀 수 없다
  if (to_jsonb(new) - array['status', 'status_revision', 'completed_at', 'cancelled_at'])
     is distinct from (to_jsonb(old) - array['status', 'status_revision', 'completed_at', 'cancelled_at']) then
    raise exception using errcode = 'P0001', message = 'ORDER_GUARD_VIOLATION',
      detail = '주문의 스냅샷·소유자·금액 등은 바꿀 수 없다.';
  end if;

  if old.status <> 'PENDING' then
    -- terminal(USER_CONFIRMED / CANCELLED)은 상태·시각·revision 모두 고정
    if (new.status, new.status_revision, new.completed_at, new.cancelled_at)
       is distinct from (old.status, old.status_revision, old.completed_at, old.cancelled_at) then
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

revoke execute on function private.guard_order_update() from public;

create trigger orders_guard
  before update on public.orders
  for each row execute function private.guard_order_update();

-- ---------------------------------------------------------------------------
-- 공통 코어: 본인 주문을 p_target(USER_CONFIRMED | CANCELLED)으로 전이한다
-- DEFINER인 두 공개 함수만 부른다. 앱은 직접 부를 수 없다.
-- ---------------------------------------------------------------------------

create function private.transition_order(p_order_id uuid, p_operation_id uuid, p_target text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_status text;
  v_history_target text;
  v_now timestamptz;
  v_revision bigint;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;
  if p_order_id is null or p_operation_id is null then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;
  if p_target not in ('USER_CONFIRMED', 'CANCELLED') then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;

  -- 본인 주문 행 잠금. 없거나 남의 주문이면 구별 없이 RESOURCE_NOT_FOUND
  select o.status into v_status
  from public.orders o
  where o.id = p_order_id and o.user_id = v_uid
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'RESOURCE_NOT_FOUND';
  end if;

  -- 같은 operationId의 이력: 종류(to_status)가 다르면 OPERATION_CONFLICT (생성 이력은 PENDING)
  select u.to_status into v_history_target
  from public.order_status_updates u
  where u.order_id = p_order_id and u.operation_id = p_operation_id;
  if found then
    if v_history_target <> p_target then
      raise exception using errcode = 'P0001', message = 'OPERATION_CONFLICT';
    end if;
    return public.get_my_order(p_order_id) || jsonb_build_object('replayed', true);
  end if;

  -- 이미 같은 terminal이면 다른 operationId여도 기존 결과 (이력 · 시각 불변)
  if v_status = p_target then
    return public.get_my_order(p_order_id) || jsonb_build_object('replayed', true);
  end if;

  -- 반대 terminal
  if v_status <> 'PENDING' then
    raise exception using errcode = 'P0001', message = 'INVALID_ORDER_TRANSITION';
  end if;

  -- 전이: 서버 시각을 한 번만 잡아 주문과 이력에 같이 쓴다
  v_now := clock_timestamp();
  update public.orders
  set status = p_target,
      status_revision = status_revision + 1,
      completed_at = case when p_target = 'USER_CONFIRMED' then v_now end,
      cancelled_at = case when p_target = 'CANCELLED' then v_now end
  where id = p_order_id
  returning status_revision into v_revision;

  insert into public.order_status_updates (order_id, revision, operation_id, from_status, to_status, created_at)
  values (p_order_id, v_revision, p_operation_id, 'PENDING', p_target, v_now);

  return public.get_my_order(p_order_id) || jsonb_build_object('replayed', false);
end;
$$;

revoke execute on function private.transition_order(uuid, uuid, text) from public;

-- ---------------------------------------------------------------------------
-- 공개 함수
-- ---------------------------------------------------------------------------

create function public.confirm_order(p_order_id uuid, p_operation_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return private.transition_order(p_order_id, p_operation_id, 'USER_CONFIRMED');
end;
$$;

create function public.cancel_order(p_order_id uuid, p_operation_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return private.transition_order(p_order_id, p_operation_id, 'CANCELLED');
end;
$$;

revoke execute on function public.confirm_order(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.cancel_order(uuid, uuid) from public, anon, authenticated;
grant execute on function public.confirm_order(uuid, uuid) to authenticated;
grant execute on function public.cancel_order(uuid, uuid) to authenticated;
