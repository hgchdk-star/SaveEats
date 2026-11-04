-- 주문 상태 전이: confirm_order · cancel_order, 주문 행 가드 트리거
-- 근거: 개발 명세 ORD-002 · ORD-008 · ORD-009 · ORD-011 · ORD-012. 테스트 데이터는 롤백으로 사라진다.
-- 주문은 실제 경로(create_order)로 만든다. 진짜 동시성(완료와 취소가 동시)은 한 세션 테스트로 볼 수 없다 → 수동 확인 목록.
create extension if not exists pgtap with schema extensions;

begin;
select * from no_plan();

create function public.test_err(p_sql text, p_state text, p_msg text default null)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return sqlstate = p_state and (p_msg is null or sqlerrm like '%' || p_msg || '%');
end;
$$;

create function public.zid(p text) returns uuid language sql immutable as $$ select md5(p)::uuid $$;

create function public.zitem(p_menu uuid, p_opts uuid[], p_qty integer, p_price bigint) returns jsonb language sql as $$
  select jsonb_build_object('menuId', p_menu, 'optionIds', to_jsonb(coalesce(p_opts, '{}'::uuid[])),
                            'quantity', p_qty, 'approvedUnitPrice', p_price, 'approvedCatalogRevision', 1)
$$;

create function public.zreq(p_store uuid, p_items jsonb, p_key uuid default gen_random_uuid(), p_disc text default '2026-09-30',
                            p_dest uuid default '0de57000-0000-4000-8000-000000000001')
returns jsonb language sql as $$
  select jsonb_build_object(
    'idempotencyKey', p_key, 'requestVersion', 2, 'storeId', p_store, 'destinationRef', p_dest, 'items', p_items,
    'approvedTotalAmount', (select sum((i ->> 'approvedUnitPrice')::numeric * (i ->> 'quantity')::numeric)
                            from jsonb_array_elements(p_items) i)::bigint,
    'disclosureVersion', p_disc, 'disclosureAcknowledged', true)
$$;

-- 현재 사용자로 콜라 1개 주문을 만들고 주문 ID를 돌려준다 (키 이름이 곧 멱등성 키)
create function public.zmk(p_key text) returns uuid language sql as $$
  select (public.create_order(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M2'), null, 1, 2000)), public.zid(p_key))) ->> 'orderId')::uuid
$$;

-- 저장해 둔 주문 ID
create function public.zo(p text) returns uuid language sql stable as $$ select current_setting('zz.' || p)::uuid $$;

-- confirm / cancel 결과를 문자열로: 성공이면 'OK', 실패면 'SQLSTATE:메시지'
create function public.ztr(p_kind text, p_order uuid, p_op uuid) returns text language plpgsql as $$
begin
  if p_kind = 'confirm' then
    perform public.confirm_order(p_order, p_op);
  else
    perform public.cancel_order(p_order, p_op);
  end if;
  return 'OK';
exception when others then
  return sqlstate || ':' || sqlerrm;
end;
$$;

-- 지우의 parseOrderDto가 읽는 모양과 같은지 본다 (011과 같은 검사). 맞으면 'OK', 아니면 처음 어긋난 곳.
create function public.zdto_shape(d jsonb, p_replayed boolean) returns text language plpgsql as $$
declare
  v_store jsonb; v_item jsonb; v_opt jsonb;
  v_base_keys constant text[] := array['cancelledAt', 'completedAt', 'createdAt', 'orderId', 'snapshot', 'status', 'statusRevision', 'totalAmount'];
begin
  if (select array_agg(k order by k) from jsonb_object_keys(d) k)
     is distinct from (select array_agg(k order by k) from unnest(case when p_replayed then v_base_keys || array['replayed'] else v_base_keys end) k) then
    return 'top-level keys';
  end if;
  if jsonb_typeof(d -> 'orderId') <> 'string' then return 'orderId type'; end if;
  if jsonb_typeof(d -> 'status') <> 'string' or not coalesce((d ->> 'status') = any (array['PENDING', 'USER_CONFIRMED', 'CANCELLED']), false) then
    return 'status value';
  end if;
  if jsonb_typeof(d -> 'statusRevision') <> 'number' then return 'statusRevision type'; end if;
  if jsonb_typeof(d -> 'createdAt') <> 'string' then return 'createdAt type'; end if;
  if jsonb_typeof(d -> 'completedAt') not in ('string', 'null') then return 'completedAt type'; end if;
  if jsonb_typeof(d -> 'cancelledAt') not in ('string', 'null') then return 'cancelledAt type'; end if;
  if jsonb_typeof(d -> 'totalAmount') <> 'number' then return 'totalAmount type'; end if;
  if p_replayed and jsonb_typeof(d -> 'replayed') <> 'boolean' then return 'replayed type'; end if;
  v_store := d -> 'snapshot' -> 'store';
  if (select array_agg(k order by k) from jsonb_object_keys(d -> 'snapshot') k) is distinct from array['items', 'store'] then return 'snapshot keys'; end if;
  if (select array_agg(k order by k) from jsonb_object_keys(v_store) k) is distinct from array['categoryName', 'id', 'imageRef', 'name'] then return 'store keys'; end if;
  for v_item in select e from jsonb_array_elements(d -> 'snapshot' -> 'items') e loop
    if (select array_agg(k order by k) from jsonb_object_keys(v_item) k)
       is distinct from array['lineTotal', 'menuId', 'menuImageRef', 'menuName', 'options', 'quantity', 'unitPrice'] then return 'item keys'; end if;
    for v_opt in select o from jsonb_array_elements(v_item -> 'options') o loop
      if (select array_agg(k order by k) from jsonb_object_keys(v_opt) k) is distinct from array['additionalPrice', 'groupName', 'optionName'] then return 'option keys'; end if;
    end loop;
  end loop;
  return 'OK';
end;
$$;

-- ---------------------------------------------------------------- 픽스처 (superuser)
insert into auth.users (id) values
  ('aaaaaaaa-0000-4000-8000-000000000001'),
  ('bbbbbbbb-0000-4000-8000-000000000002');
insert into public.categories (id, code, name, sort_order, is_active) values (public.zid('CA'), 'zz-tr-a', '전이테스트분류', 99, true);
insert into public.stores (id, category_id, name, is_active, is_open) values (public.zid('S1'), public.zid('CA'), '전이테스트가게', true, true);
insert into public.menus (id, store_id, name, base_price) values (public.zid('M2'), public.zid('S1'), '콜라', 2000);

-- ---------------------------------------------------------------- 구조 · 권한
select ok((select prosecdef from pg_proc where oid = 'public.confirm_order(uuid, uuid)'::regprocedure), 'confirm_order는 SECURITY DEFINER');
select ok((select prosecdef from pg_proc where oid = 'public.cancel_order(uuid, uuid)'::regprocedure), 'cancel_order는 SECURITY DEFINER');
select ok((select exists (select 1 from unnest(coalesce(proconfig, '{}')) c where c like 'search_path=%')
    from pg_proc where oid = 'public.confirm_order(uuid, uuid)'::regprocedure), 'confirm_order의 search_path가 고정되어 있다');
select ok((select exists (select 1 from unnest(coalesce(proconfig, '{}')) c where c like 'search_path=%')
    from pg_proc where oid = 'public.cancel_order(uuid, uuid)'::regprocedure), 'cancel_order의 search_path가 고정되어 있다');
select is((select proargnames from pg_proc where oid = 'public.confirm_order(uuid, uuid)'::regprocedure), array['p_order_id', 'p_operation_id'], 'confirm_order 인자 이름');
select is((select proargnames from pg_proc where oid = 'public.cancel_order(uuid, uuid)'::regprocedure), array['p_order_id', 'p_operation_id'], 'cancel_order 인자 이름');
select ok(not exists (
    select 1 from pg_proc p where p.oid in ('public.confirm_order(uuid, uuid)'::regprocedure, 'public.cancel_order(uuid, uuid)'::regprocedure)
      and coalesce(p.proacl::text, '') ~ '(^|[{,])=X|anon='), '전이 함수는 PUBLIC/anon에게 열려 있지 않다');
select ok((select count(*) = 2 from pg_proc p where p.oid in ('public.confirm_order(uuid, uuid)'::regprocedure, 'public.cancel_order(uuid, uuid)'::regprocedure)
      and coalesce(p.proacl::text, '') ~ 'authenticated=X'), '전이 함수는 authenticated에게 열려 있다');
select ok(not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname in ('transition_order', 'guard_order_update')
      and coalesce(p.proacl::text, '') ~ '(anon|authenticated)=|(^|[{,])=X'), 'private 코어와 가드 함수는 앱에 열려 있지 않다');
select ok(exists (select 1 from pg_trigger where tgrelid = 'public.orders'::regclass and tgname = 'orders_guard' and not tgisinternal), 'orders에 가드 트리거가 있다');

-- ---------------------------------------------------------------- Guest / 로그인 정보 없음
set local role anon;
select ok(public.test_err($$select public.confirm_order(gen_random_uuid(), gen_random_uuid())$$, '42501'), '[anon] confirm_order 실행 금지');
select ok(public.test_err($$select public.cancel_order(gen_random_uuid(), gen_random_uuid())$$, '42501'), '[anon] cancel_order 실행 금지');
reset role;
select set_config('request.jwt.claims', '', true);
set local role authenticated;
select is(public.ztr('confirm', gen_random_uuid(), gen_random_uuid()), 'P0001:AUTH_REQUIRED', '[sub 없음] confirm_order → AUTH_REQUIRED');
select is(public.ztr('cancel', gen_random_uuid(), gen_random_uuid()), 'P0001:AUTH_REQUIRED', '[sub 없음] cancel_order → AUTH_REQUIRED');
select is(public.ztr('confirm', null, null), 'P0001:AUTH_REQUIRED', '[sub 없음] 잘못된 입력도 로그인 확인이 먼저');
reset role;

-- ---------------------------------------------------------------- 사용자 A: 준비
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select set_config('zz.o1', public.zmk('K1')::text, true);
select set_config('zz.o2', public.zmk('K2')::text, true);
select set_config('zz.o3', public.zmk('K3')::text, true);
select set_config('zz.o4', public.zmk('K4')::text, true);
select set_config('zz.o5', public.zmk('K5')::text, true);
select set_config('zz.o6', public.zmk('K6')::text, true);
select set_config('zz.pre1', public.get_my_order(public.zo('o1'))::text, true);
select is(public.get_my_order(public.zo('o1')) ->> 'status', 'PENDING', '(준비) 주문 6개가 모두 PENDING으로 만들어졌다');

-- 형태 · 존재
select is(public.ztr('confirm', null, public.zid('OP1')), 'P0001:INVALID_INPUT', 'confirm: 주문 ID가 null');
select is(public.ztr('confirm', public.zo('o1'), null), 'P0001:INVALID_INPUT', 'confirm: operationId가 null');
select is(public.ztr('cancel', null, public.zid('OP1')), 'P0001:INVALID_INPUT', 'cancel: 주문 ID가 null');
select is(public.ztr('cancel', public.zo('o1'), null), 'P0001:INVALID_INPUT', 'cancel: operationId가 null');
select ok(public.test_err($$select public.confirm_order('abc', gen_random_uuid())$$, '22P02'), 'UUID 형식이 아닌 주문 ID는 22P02 (PostgREST와 get_my_order와 같은 방식)');
select ok(public.test_err(format('select public.cancel_order(%L, %L)', public.zo('o1'), 'not-a-uuid'), '22P02'), 'UUID 형식이 아닌 operationId는 22P02');
select is(public.ztr('confirm', gen_random_uuid(), public.zid('OP1')), 'P0001:RESOURCE_NOT_FOUND', 'confirm: 없는 주문');
select is(public.ztr('cancel', gen_random_uuid(), public.zid('OP1')), 'P0001:RESOURCE_NOT_FOUND', 'cancel: 없는 주문');
select is((select count(*)::int from public.order_status_updates), 6, '(확인) 거절된 요청들은 이력을 만들지 않았다 (주문 6개의 초기 이력뿐)');

-- ---------------------------------------------------------------- confirm: O1
select set_config('zz.c1', public.confirm_order(public.zo('o1'), public.zid('OP1'))::text, true);
select is(public.zdto_shape(current_setting('zz.c1')::jsonb, true), 'OK', 'confirm 응답: 키 이름과 타입이 앱 parseOrderDto와 일치 (replayed boolean)');
select is(current_setting('zz.c1')::jsonb ->> 'status', 'USER_CONFIRMED', 'confirm: 상태 USER_CONFIRMED');
select is((current_setting('zz.c1')::jsonb ->> 'statusRevision')::int, 2, 'confirm: statusRevision 2');
select is(jsonb_typeof(current_setting('zz.c1')::jsonb -> 'completedAt'), 'string', 'confirm: completedAt은 문자열');
select is(current_setting('zz.c1')::jsonb -> 'cancelledAt', 'null'::jsonb, 'confirm: cancelledAt은 null');
select is(current_setting('zz.c1')::jsonb -> 'replayed', 'false'::jsonb, 'confirm: 처음 전이하면 replayed=false');
select is(current_setting('zz.c1')::jsonb -> 'snapshot', current_setting('zz.pre1')::jsonb -> 'snapshot', 'confirm: Snapshot은 그대로');
select is((current_setting('zz.c1')::jsonb ->> 'totalAmount')::bigint, (current_setting('zz.pre1')::jsonb ->> 'totalAmount')::bigint, 'confirm: 총액 그대로');
select is(current_setting('zz.c1')::jsonb ->> 'createdAt', current_setting('zz.pre1')::jsonb ->> 'createdAt', 'confirm: createdAt 그대로');
reset role;
select set_config('zz.t1', (select completed_at::text from public.orders where id = public.zo('o1')), true);
select ok((select completed_at > created_at from public.orders where id = public.zo('o1')), 'DB: completed_at이 created_at보다 늦다 (서버 clock_timestamp)');
select is((select status_revision from public.orders where id = public.zo('o1')), 2::bigint, 'DB: status_revision 2');
select ok((select cancelled_at is null from public.orders where id = public.zo('o1')), 'DB: cancelled_at null');
select is((select count(*)::int from public.order_status_updates where order_id = public.zo('o1')), 2, 'DB: 이력은 2건 (생성 + 완료)');
select is((select row(revision, from_status, to_status, operation_id, viewed_at is null)::text from public.order_status_updates
    where order_id = public.zo('o1') and revision = 2),
  row(2::bigint, 'PENDING'::text, 'USER_CONFIRMED'::text, public.zid('OP1'), true)::text, 'DB: 이력 revision 2 = PENDING → USER_CONFIRMED, 지정한 operationId, 미확인');
select is((select row(revision, from_status, to_status, operation_id)::text from public.order_status_updates
    where order_id = public.zo('o1') and revision = 1),
  row(1::bigint, null::text, 'PENDING'::text, public.zid('K1'))::text, 'DB: 초기 이력(NULL → PENDING, operation_id=생성 키)은 그대로');
select ok((select u.created_at = o.completed_at from public.order_status_updates u join public.orders o on o.id = u.order_id
    where u.order_id = public.zo('o1') and u.revision = 2), 'DB: 이력 created_at = 주문 completed_at (시각을 한 번만 잡는다)');

-- ---------------------------------------------------------------- confirm 재시도
set local role authenticated;
select set_config('zz.c1r', public.confirm_order(public.zo('o1'), public.zid('OP1'))::text, true);
select is(current_setting('zz.c1r')::jsonb -> 'replayed', 'true'::jsonb, '같은 operationId 재시도: replayed=true');
select is(current_setting('zz.c1r')::jsonb - 'replayed', current_setting('zz.c1')::jsonb - 'replayed', '같은 operationId 재시도: 처음 결과 그대로 (completedAt 포함)');
select is(public.zdto_shape(current_setting('zz.c1r')::jsonb, true), 'OK', '재시도 응답도 같은 모양');
select set_config('zz.c1o', public.confirm_order(public.zo('o1'), public.zid('OP2'))::text, true);
select is(current_setting('zz.c1o')::jsonb -> 'replayed', 'true'::jsonb, '다른 operationId로 이미 완료된 주문 재완료: replayed=true');
select is(current_setting('zz.c1o')::jsonb - 'replayed', current_setting('zz.c1')::jsonb - 'replayed', '다른 operationId여도 현재 완료 결과 그대로');
reset role;
select is((select count(*)::int from public.order_status_updates where order_id = public.zo('o1')), 2, '재시도는 이력을 늘리지 않는다');
select is((select count(*)::int from public.order_status_updates where order_id = public.zo('o1') and operation_id = public.zid('OP2')), 0, '이력에 남지 않은 operationId는 기록되지 않는다');
select is((select status_revision from public.orders where id = public.zo('o1')), 2::bigint, '재시도는 revision을 올리지 않는다');
select is((select completed_at::text from public.orders where id = public.zo('o1')), current_setting('zz.t1'), '재시도는 completed_at을 바꾸지 않는다');

-- ---------------------------------------------------------------- 완료된 주문에 대한 금지 · 충돌
set local role authenticated;
select is(public.ztr('cancel', public.zo('o1'), public.zid('OP3')), 'P0001:INVALID_ORDER_TRANSITION', '완료된 주문의 취소 → INVALID_ORDER_TRANSITION');
select is(public.ztr('cancel', public.zo('o1'), public.zid('OP1')), 'P0001:OPERATION_CONFLICT', '완료에 쓴 operationId로 취소 → OPERATION_CONFLICT (상태 거절보다 먼저)');
select is(public.ztr('cancel', public.zo('o1'), public.zid('K1')), 'P0001:OPERATION_CONFLICT', '생성 키(초기 이력의 operation_id)로 취소 → OPERATION_CONFLICT');
select is(public.ztr('confirm', public.zo('o1'), public.zid('K1')), 'P0001:OPERATION_CONFLICT', '생성 키로 완료 → OPERATION_CONFLICT (이미 완료된 주문이어도)');
select is(public.get_my_order(public.zo('o1')) ->> 'status', 'USER_CONFIRMED', '거절들 뒤에도 주문은 USER_CONFIRMED');
select is(public.zdto_shape(public.get_order_by_request_key(public.zid('K1')), false), 'OK', '키 조회: 완료된 주문, replayed 키 없음');
select is(public.get_order_by_request_key(public.zid('K1')) ->> 'status', 'USER_CONFIRMED', '키 조회가 완료 상태를 보여준다');
select is(public.create_order(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M2'), null, 1, 2000)), public.zid('K1'))) ->> 'status',
  'USER_CONFIRMED', '같은 생성 요청을 재시도하면 현재 상태(USER_CONFIRMED)의 주문이 돌아온다');
select is(public.create_order(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M2'), null, 1, 2000)), public.zid('K1'))) -> 'replayed',
  'true'::jsonb, '(그 응답은 replayed=true)');
reset role;

-- ---------------------------------------------------------------- 생성 키를 operationId로 (PENDING 주문, O2)
set local role authenticated;
select is(public.ztr('confirm', public.zo('o2'), public.zid('K2')), 'P0001:OPERATION_CONFLICT', 'PENDING 주문에서 생성 키로 완료 → OPERATION_CONFLICT');
select is(public.ztr('cancel', public.zo('o2'), public.zid('K2')), 'P0001:OPERATION_CONFLICT', 'PENDING 주문에서 생성 키로 취소 → OPERATION_CONFLICT');
reset role;
select is((select status || '/' || status_revision from public.orders where id = public.zo('o2')), 'PENDING/1', '그 거절들 뒤에도 PENDING · revision 1');
select is((select count(*)::int from public.order_status_updates where order_id = public.zo('o2')), 1, '그 거절들은 이력을 만들지 않는다');

-- ---------------------------------------------------------------- cancel: O2
set local role authenticated;
select set_config('zz.x2', public.cancel_order(public.zo('o2'), public.zid('OP4'))::text, true);
select is(public.zdto_shape(current_setting('zz.x2')::jsonb, true), 'OK', 'cancel 응답 모양');
select is(current_setting('zz.x2')::jsonb ->> 'status', 'CANCELLED', 'cancel: 상태 CANCELLED');
select is((current_setting('zz.x2')::jsonb ->> 'statusRevision')::int, 2, 'cancel: statusRevision 2');
select is(jsonb_typeof(current_setting('zz.x2')::jsonb -> 'cancelledAt'), 'string', 'cancel: cancelledAt은 문자열');
select is(current_setting('zz.x2')::jsonb -> 'completedAt', 'null'::jsonb, 'cancel: completedAt은 null');
select is(current_setting('zz.x2')::jsonb -> 'replayed', 'false'::jsonb, 'cancel: 처음 전이하면 replayed=false');
reset role;
select set_config('zz.t2', (select cancelled_at::text from public.orders where id = public.zo('o2')), true);
select ok((select cancelled_at > created_at and completed_at is null from public.orders where id = public.zo('o2')), 'DB: cancelled_at이 created_at보다 늦고 completed_at은 null');
select is((select row(revision, from_status, to_status, operation_id)::text from public.order_status_updates where order_id = public.zo('o2') and revision = 2),
  row(2::bigint, 'PENDING'::text, 'CANCELLED'::text, public.zid('OP4'))::text, 'DB: 이력 revision 2 = PENDING → CANCELLED');
select ok((select u.created_at = o.cancelled_at from public.order_status_updates u join public.orders o on o.id = u.order_id
    where u.order_id = public.zo('o2') and u.revision = 2), 'DB: 이력 created_at = 주문 cancelled_at');
set local role authenticated;
select is(public.cancel_order(public.zo('o2'), public.zid('OP4')) - 'replayed', current_setting('zz.x2')::jsonb - 'replayed', 'cancel 같은 operationId 재시도: 처음 결과 그대로');
select is(public.cancel_order(public.zo('o2'), public.zid('OP4')) -> 'replayed', 'true'::jsonb, '(replayed=true)');
select is(public.cancel_order(public.zo('o2'), public.zid('OP5')) -> 'replayed', 'true'::jsonb, 'cancel 다른 operationId로 이미 취소된 주문: replayed=true');
select is(public.ztr('confirm', public.zo('o2'), public.zid('OP6')), 'P0001:INVALID_ORDER_TRANSITION', '취소된 주문의 완료 → INVALID_ORDER_TRANSITION');
select is(public.ztr('confirm', public.zo('o2'), public.zid('OP4')), 'P0001:OPERATION_CONFLICT', '취소에 쓴 operationId로 완료 → OPERATION_CONFLICT (상태 거절보다 먼저)');
select is(public.get_my_order(public.zo('o2')) ->> 'status', 'CANCELLED', '거절들 뒤에도 CANCELLED');
reset role;
select is((select count(*)::int from public.order_status_updates where order_id = public.zo('o2')), 2, '취소 재시도 · 거절은 이력을 늘리지 않는다');
select is((select cancelled_at::text from public.orders where id = public.zo('o2')), current_setting('zz.t2'), '취소 재시도는 cancelled_at을 바꾸지 않는다');
select is((select status_revision from public.orders where id = public.zo('o2')), 2::bigint, '취소 재시도는 revision을 올리지 않는다');

-- ---------------------------------------------------------------- operationId는 주문마다 유일하다 (다른 주문에서 쓴 값은 새 값)
set local role authenticated;
select is(public.ztr('confirm', public.zo('o3'), public.zid('OP1')), 'OK', '다른 주문(O1)에서 쓴 operationId를 이 주문(O3)에서 써도 새 명령으로 처리된다');
reset role;
select is((select count(*)::int from public.order_status_updates where operation_id = public.zid('OP1')), 2, '같은 operationId가 서로 다른 주문의 이력에 하나씩 있다');

-- ---------------------------------------------------------------- 롤백: 이력 저장 중 오류가 나면 전이도 되돌려진다 (O4)
create function public.zz_boom() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$;
create trigger zz_boom before insert on public.order_status_updates for each row execute function public.zz_boom();
set local role authenticated;
select is(public.ztr('confirm', public.zo('o4'), public.zid('OP7')), 'P0001:boom', '이력 저장 중 오류를 일으키면 요청이 실패한다');
reset role;
select is((select status || '/' || status_revision || '/' || (completed_at is null) from public.orders where id = public.zo('o4')), 'PENDING/1/true',
  '실패하면 주문은 PENDING · revision 1 · completed_at null 그대로');
select is((select count(*)::int from public.order_status_updates where order_id = public.zo('o4')), 1, '실패하면 이력도 늘지 않는다');
drop trigger zz_boom on public.order_status_updates;
set local role authenticated;
select is(public.ztr('confirm', public.zo('o4'), public.zid('OP7')), 'OK', '(확인) 트리거를 치우면 같은 요청이 성공한다');
reset role;
select is((select status_revision from public.orders where id = public.zo('o4')), 2::bigint, '(확인) 성공하면 revision 2');

-- ---------------------------------------------------------------- 직접 쓰기 금지 (사용자 A)
set local role authenticated;
select ok(public.test_err($$update public.orders set status = 'CANCELLED'$$, '42501'), '[A] orders 직접 UPDATE 금지');
select ok(public.test_err(format($f$insert into public.order_status_updates (order_id, revision, operation_id, to_status) values (%L, 99, gen_random_uuid(), 'CANCELLED')$f$,
  public.zo('o5')), '42501'), '[A] 이력 직접 INSERT 금지');
select ok(public.test_err($$update public.order_status_updates set viewed_at = now()$$, '42501'), '[A] 이력 직접 UPDATE 금지');
select ok(public.test_err($$select private.transition_order(gen_random_uuid(), gen_random_uuid(), 'CANCELLED')$$, '42501'), '[A] private 코어를 직접 부를 수 없다');
reset role;

-- ---------------------------------------------------------------- 사용자 B: 격리
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select set_config('zz.ob', public.zmk('KB')::text, true);
select is(public.ztr('confirm', public.zo('o5'), public.zid('OPB1')), 'P0001:RESOURCE_NOT_FOUND', '[B] 남의 주문 완료 → RESOURCE_NOT_FOUND');
select is(public.ztr('cancel', public.zo('o5'), public.zid('OPB2')), 'P0001:RESOURCE_NOT_FOUND', '[B] 남의 주문 취소 → RESOURCE_NOT_FOUND');
select is(public.ztr('confirm', public.zo('o5'), public.zid('OPB1')), public.ztr('confirm', gen_random_uuid(), public.zid('OPB1')), '[B] 남의 주문과 없는 주문의 오류가 같다');
select is(public.ztr('confirm', public.zo('o1'), public.zid('OP1')), 'P0001:RESOURCE_NOT_FOUND', '[B] 남의 완료된 주문에 같은 operationId를 써도 결과를 볼 수 없다');
select is(public.ztr('confirm', public.zo('ob'), public.zid('OP1')), 'OK', '[B] 자기 주문은 A와 같은 operationId 문자열이어도 처리된다');
reset role;
select is((select status || '/' || status_revision from public.orders where id = public.zo('o5')), 'PENDING/1', '[B]의 시도들 뒤에도 A의 주문은 PENDING · revision 1');
select is((select count(*)::int from public.order_status_updates where order_id = public.zo('o5')), 1, '[B]의 시도들은 A 주문의 이력을 만들지 않았다');
select is((select status from public.orders where id = public.zo('ob')), 'USER_CONFIRMED', '[B] 자기 주문은 완료되었다');

-- ---------------------------------------------------------------- 가드 트리거 (superuser로 직접 바꿔 본다)
select ok(public.test_err(format($f$update public.orders set total_amount = total_amount + 1 where id = %L$f$, public.zo('o5')), 'P0001', 'ORDER_GUARD_VIOLATION'), '가드: 총액은 바꿀 수 없다');
select ok(public.test_err(format($f$update public.orders set store_name_snapshot = 'x' where id = %L$f$, public.zo('o5')), 'P0001', 'ORDER_GUARD_VIOLATION'), '가드: 가게 이름 Snapshot은 바꿀 수 없다');
select ok(public.test_err(format($f$update public.orders set category_name_snapshot = 'x' where id = %L$f$, public.zo('o5')), 'P0001', 'ORDER_GUARD_VIOLATION'), '가드: 분류 Snapshot은 바꿀 수 없다');
select ok(public.test_err(format($f$update public.orders set user_id = 'bbbbbbbb-0000-4000-8000-000000000002' where id = %L$f$, public.zo('o5')), 'P0001', 'ORDER_GUARD_VIOLATION'), '가드: 소유자는 바꿀 수 없다');
select ok(public.test_err(format($f$update public.orders set created_at = now() - interval '1 day' where id = %L$f$, public.zo('o5')), 'P0001', 'ORDER_GUARD_VIOLATION'), '가드: 생성 시각은 바꿀 수 없다');
select ok(public.test_err(format($f$update public.orders set destination_ref = gen_random_uuid() where id = %L$f$, public.zo('o5')), 'P0001', 'ORDER_GUARD_VIOLATION'), '가드: 목적지 참조는 바꿀 수 없다');
select ok(public.test_err(format($f$update public.orders set request_fingerprint = repeat('b', 64) where id = %L$f$, public.zo('o5')), 'P0001', 'ORDER_GUARD_VIOLATION'), '가드: 요청 지문은 바꿀 수 없다');
select ok(public.test_err(format($f$update public.orders set disclosure_version = '2026-01-01' where id = %L$f$, public.zo('o5')), 'P0001', 'ORDER_GUARD_VIOLATION'), '가드: 고지 버전은 바꿀 수 없다');
select ok(public.test_err(format($f$update public.orders set status = 'PENDING', completed_at = null, status_revision = 3 where id = %L$f$, public.zo('o1')), 'P0001', 'ORDER_GUARD_VIOLATION'),
  '가드: 완료된 주문을 PENDING으로 되돌릴 수 없다');
select ok(public.test_err(format($f$update public.orders set completed_at = now() where id = %L$f$, public.zo('o1')), 'P0001', 'ORDER_GUARD_VIOLATION'), '가드: 완료 시각은 바꿀 수 없다');
select ok(public.test_err(format($f$update public.orders set status_revision = 9 where id = %L$f$, public.zo('o1')), 'P0001', 'ORDER_GUARD_VIOLATION'), '가드: 완료된 주문의 revision은 바꿀 수 없다');
select ok(public.test_err(format($f$update public.orders set status = 'USER_CONFIRMED', completed_at = now(), cancelled_at = null where id = %L$f$, public.zo('o2')), 'P0001', 'ORDER_GUARD_VIOLATION'),
  '가드: 취소된 주문을 완료로 바꿀 수 없다');
select ok(public.test_err(format($f$update public.orders set status = 'USER_CONFIRMED', completed_at = now() where id = %L$f$, public.zo('o5')), 'P0001', 'ORDER_GUARD_VIOLATION'),
  '가드: PENDING → 완료는 revision이 안 오르면 거절');
select ok(public.test_err(format($f$update public.orders set status = 'USER_CONFIRMED', status_revision = 3, completed_at = now() where id = %L$f$, public.zo('o5')), 'P0001', 'ORDER_GUARD_VIOLATION'),
  '가드: revision이 2 이상 오르면 거절');
select ok(public.test_err(format($f$update public.orders set status_revision = 5 where id = %L$f$, public.zo('o5')), 'P0001', 'ORDER_GUARD_VIOLATION'), '가드: 상태가 그대로인데 revision만 바꿀 수 없다');
select ok(public.test_err(format($f$update public.orders set completed_at = now() where id = %L$f$, public.zo('o5')), 'P0001', 'ORDER_GUARD_VIOLATION'), '가드: PENDING에 시각만 넣을 수 없다');
select ok(public.test_err(format($f$update public.orders set status = 'DONE', status_revision = 2 where id = %L$f$, public.zo('o5')), '23514'), '가드를 지나도 알 수 없는 상태는 CHECK가 거절');
update public.orders set status = status where id = public.zo('o5');
select ok(true, '변경 없는 UPDATE는 가드에 걸리지 않고 통과한다 (이 줄까지 도달했다는 것이 확인)');
select is((select status || '/' || status_revision from public.orders where id = public.zo('o5')), 'PENDING/1', '가드에 걸린 시도들은 아무것도 바꾸지 않았다');
update public.orders set status = 'USER_CONFIRMED', status_revision = 2, completed_at = now() where id = public.zo('o5');
select is((select status || '/' || status_revision from public.orders where id = public.zo('o5')), 'USER_CONFIRMED/2', '가드: PENDING → 완료는 revision이 정확히 +1이면 통과한다');

-- 마지막 확인: 이력의 operation_id는 주문마다 유일하다
select ok(public.test_err(format($f$insert into public.order_status_updates (order_id, revision, operation_id, to_status) values (%L, 9, %L, 'CANCELLED')$f$,
  public.zo('o1'), public.zid('OP1')), '23505'), '같은 주문에 같은 operation_id 이력을 또 넣을 수 없다');

select * from finish();
rollback;
