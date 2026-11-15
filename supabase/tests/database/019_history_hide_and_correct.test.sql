-- 취소 내역 숨기기(hide_cancelled_order)와 완료 정정(correct_order_completion)
-- 테스트 데이터는 롤백으로 사라진다. 진짜 동시 실행(두 세션)은 한 세션 시험으로 만들 수 없어 순차 끼어들기만 확인한다.
create extension if not exists pgtap with schema extensions;

begin;
select * from no_plan();

create function public.zq(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlstate || ':' || sqlerrm;
end;
$$;

create function public.zid(p text) returns uuid language sql immutable as $$ select md5(p)::uuid $$;
create function public.zo(p text) returns uuid language sql stable as $$ select current_setting('zz.' || p)::uuid $$;

create function public.zitem(p_menu uuid, p_qty integer, p_price bigint) returns jsonb language sql as $$
  select jsonb_build_object('menuId', p_menu, 'optionIds', '[]'::jsonb, 'quantity', p_qty, 'approvedUnitPrice', p_price, 'approvedCatalogRevision', 1)
$$;

create function public.zreq(p_store uuid, p_items jsonb, p_key uuid) returns jsonb language sql as $$
  select jsonb_build_object(
    'idempotencyKey', p_key, 'requestVersion', 2, 'storeId', p_store, 'destinationRef', '0de57000-0000-4000-8000-000000000001', 'items', p_items,
    'approvedTotalAmount', (select sum((i ->> 'approvedUnitPrice')::numeric * (i ->> 'quantity')::numeric) from jsonb_array_elements(p_items) i)::bigint,
    'disclosureVersion', '2026-09-30', 'disclosureAcknowledged', true)
$$;

-- 주문 만들기(PENDING)
create function public.zmk(p_key text) returns uuid language sql as $$
  select (public.create_order(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M1'), 1, 1000)), public.zid(p_key))) ->> 'orderId')::uuid
$$;
-- 주문 → 수령 확인(USER_CONFIRMED)
create function public.zdone(p_key text) returns uuid language plpgsql as $$
declare v uuid;
begin
  v := public.zmk(p_key);
  perform public.confirm_order(v, public.zid(p_key || '-confirm'));
  return v;
end;
$$;
-- 주문 → 취소(CANCELLED)
create function public.zcan(p_key text) returns uuid language plpgsql as $$
declare v uuid;
begin
  v := public.zmk(p_key);
  perform public.cancel_order(v, public.zid(p_key || '-cancel'));
  return v;
end;
$$;

create function public.zhide(p_order uuid) returns text language plpgsql as $$
begin perform public.hide_cancelled_order(p_order); return 'OK';
exception when others then return sqlstate || ':' || sqlerrm; end; $$;
create function public.zfix(p_order uuid, p_op text) returns text language plpgsql as $$
begin perform public.correct_order_completion(p_order, public.zid(p_op)); return 'OK';
exception when others then return sqlstate || ':' || sqlerrm; end; $$;
create function public.zecr(p_order uuid, p_op text) returns text language plpgsql as $$
begin perform public.create_review(p_order, public.zid(p_op), 4, '맛있게 먹었습니다 리뷰'); return 'OK';
exception when others then return sqlstate || ':' || sqlerrm; end; $$;

create function public.zjwt(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claims', case when p_uid is null then '' else '{"sub":"' || p_uid || '","role":"authenticated"}' end, true)
$$;

-- ---------------------------------------------------------------- 픽스처 (superuser)
insert into auth.users (id) values
  ('aaaaaaaa-0000-4000-8000-0000000000a1'),
  ('bbbbbbbb-0000-4000-8000-0000000000b2');
insert into public.categories (id, code, name, sort_order) values (public.zid('CA'), 'zz-hc-a', '숨김정정분류', 99);
insert into public.stores (id, category_id, name) values (public.zid('S1'), public.zid('CA'), '숨김정정가게');
insert into public.menus (id, store_id, name, base_price) values (public.zid('M1'), public.zid('S1'), '메뉴1', 1000);

-- ================================================================ 구조
select is((select data_type from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'hidden_at'), 'timestamp with time zone', 'orders.hidden_at은 timestamptz');
select is((select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'hidden_at'), 'YES', 'orders.hidden_at은 null 허용');
select is((select data_type from information_schema.columns where table_schema = 'public' and table_name = 'order_status_updates' and column_name = 'reason'), 'text', 'order_status_updates.reason은 text');
select is((select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'order_status_updates' and column_name = 'reason'), 'YES', 'order_status_updates.reason은 null 허용');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('hide_cancelled_order', 'correct_order_completion')), 2, '두 함수가 있다');
select is((select p.prosecdef from pg_proc p where p.oid = 'public.hide_cancelled_order(uuid)'::regprocedure), true, 'hide_cancelled_order는 SECURITY DEFINER');
select is((select p.prosecdef from pg_proc p where p.oid = 'public.correct_order_completion(uuid, uuid)'::regprocedure), true, 'correct_order_completion은 SECURITY DEFINER');
select is((select p.proconfig from pg_proc p where p.oid = 'public.hide_cancelled_order(uuid)'::regprocedure), array['search_path=""'], 'hide_cancelled_order search_path 고정');
select is((select p.proconfig from pg_proc p where p.oid = 'public.correct_order_completion(uuid, uuid)'::regprocedure), array['search_path=""'], 'correct_order_completion search_path 고정');
select is((select p.proargnames from pg_proc p where p.oid = 'public.hide_cancelled_order(uuid)'::regprocedure), array['p_order_id'], 'hide 인자 이름 p_order_id');
select is((select p.proargnames from pg_proc p where p.oid = 'public.correct_order_completion(uuid, uuid)'::regprocedure), array['p_order_id', 'p_operation_id'], 'correct 인자 이름 p_order_id, p_operation_id');
select is(has_function_privilege('anon', 'public.hide_cancelled_order(uuid)', 'execute'), false, 'anon은 hide를 실행할 수 없다');
select is(has_function_privilege('anon', 'public.correct_order_completion(uuid, uuid)', 'execute'), false, 'anon은 correct를 실행할 수 없다');
select is(has_function_privilege('authenticated', 'public.hide_cancelled_order(uuid)', 'execute'), true, 'authenticated는 hide를 실행할 수 있다');
select is(has_function_privilege('authenticated', 'public.correct_order_completion(uuid, uuid)', 'execute'), true, 'authenticated는 correct를 실행할 수 있다');
select is(has_column_privilege('authenticated', 'public.orders', 'hidden_at', 'select'), true, 'authenticated는 hidden_at을 읽을 수 있다');
select is(has_column_privilege('authenticated', 'public.orders', 'hidden_at', 'update'), false, 'authenticated는 hidden_at을 직접 바꿀 수 없다');
select is(has_table_privilege('authenticated', 'public.orders', 'update'), false, 'authenticated는 orders를 직접 바꿀 수 없다');

-- ---------------------------------------------------------------- 준비 데이터
-- A: 취소 2건(c1, c2), 대기 1건(p1), 완료 1건(d1)
select public.zjwt('aaaaaaaa-0000-4000-8000-0000000000a1');
set local role authenticated;
select set_config('zz.c1', public.zcan('C1')::text, true);
select set_config('zz.c2', public.zcan('C2')::text, true);
select set_config('zz.p1', public.zmk('P1')::text, true);
select set_config('zz.d1', public.zdone('D1')::text, true);
reset role;
-- B: 남의 주문 확인용 취소 1건, 완료 1건
select public.zjwt('bbbbbbbb-0000-4000-8000-0000000000b2');
set local role authenticated;
select set_config('zz.bc1', public.zcan('BC1')::text, true);
select set_config('zz.bd1', public.zdone('BD1')::text, true);
reset role;

-- ================================================================ hide_cancelled_order
-- anon
select public.zjwt(null);
set local role anon;
select is(public.zq(format($q$select public.hide_cancelled_order(%L)$q$, public.zo('c1'))), '42501:permission denied for function hide_cancelled_order', '[hide] anon 거부(42501)');
reset role;

-- 로그인 없음 (authenticated 역할이지만 sub 없음)
select public.zjwt(null);
set local role authenticated;
select is(public.zhide(public.zo('c1')), 'P0001:AUTH_REQUIRED', '[hide] 로그인 없음 → AUTH_REQUIRED');
reset role;

select public.zjwt('aaaaaaaa-0000-4000-8000-0000000000a1');
set local role authenticated;
select is(public.zhide(null), 'P0001:INVALID_INPUT', '[hide] null → INVALID_INPUT');
select is(public.zhide(gen_random_uuid()), 'P0001:RESOURCE_NOT_FOUND', '[hide] 없는 주문 → RESOURCE_NOT_FOUND');
select is(public.zhide(public.zo('bc1')), 'P0001:RESOURCE_NOT_FOUND', '[hide] 남의 취소 주문 → RESOURCE_NOT_FOUND');
select is(public.zhide(public.zo('p1')), 'P0001:ORDER_NOT_HIDEABLE', '[hide] PENDING → ORDER_NOT_HIDEABLE');
select is(public.zhide(public.zo('d1')), 'P0001:ORDER_NOT_HIDEABLE', '[hide] USER_CONFIRMED → ORDER_NOT_HIDEABLE');
reset role;
select is((select status from public.orders where id = public.zo('p1')), 'PENDING', '[hide] 거절된 PENDING은 서버가 취소하지 않았다');
select is((select status from public.orders where id = public.zo('d1')), 'USER_CONFIRMED', '[hide] 거절된 USER_CONFIRMED는 그대로');
select is((select count(*)::int from public.orders where hidden_at is not null), 0, '[hide] 거절된 호출은 아무것도 숨기지 않았다');

-- 목록에서 숨기기 전 상태
select public.zjwt('aaaaaaaa-0000-4000-8000-0000000000a1');
set local role authenticated;
select is(jsonb_array_length(public.list_my_orders() -> 'items'), 4, '[목록] 숨기기 전 내 주문 4건');
select is((public.get_my_history_unread_summary() ->> 'unreadOrderCount')::int, 4, '[안읽음] 숨기기 전 안 읽은 주문 4건');

-- 성공
select is(public.hide_cancelled_order(public.zo('c1')) - 'orderId', jsonb_build_object('hidden', true, 'replayed', false), '[hide] CANCELLED 성공: hidden true, replayed false');
select is(public.hide_cancelled_order(public.zo('c2')) ->> 'orderId', public.zo('c2')::text, '[hide] 응답에 orderId');
select is((select array_agg(k order by k) from jsonb_object_keys(public.hide_cancelled_order(public.zo('c1'))) k), array['hidden', 'orderId', 'replayed'], '[hide] 응답 키');
select is(public.hide_cancelled_order(public.zo('c1')) ->> 'replayed', 'true', '[hide] 재호출: 오류 없이 replayed true');
reset role;
select is((select count(*)::int from public.orders where hidden_at is not null), 2, '[hide] 숨겨진 주문 2건');
select is((select hidden_at is not null from public.orders where id = public.zo('c1')), true, '[hide] hidden_at 기록');

-- 재호출이 시각을 바꾸지 않는다
select set_config('zz.h1', (select hidden_at::text from public.orders where id = public.zo('c1')), true);
select public.zjwt('aaaaaaaa-0000-4000-8000-0000000000a1');
set local role authenticated;
select public.hide_cancelled_order(public.zo('c1'));
reset role;
select is((select hidden_at::text from public.orders where id = public.zo('c1')), current_setting('zz.h1'), '[hide] 재호출은 처음 숨긴 시각을 그대로 둔다');

-- 숨긴 주문은 목록 · 안읽음 · 내역 단건에서 빠지고, get_my_order와 기록은 그대로
select public.zjwt('aaaaaaaa-0000-4000-8000-0000000000a1');
set local role authenticated;
select is(jsonb_array_length(public.list_my_orders() -> 'items'), 2, '[목록] 숨긴 뒤 2건');
select is((select count(*)::int from jsonb_array_elements(public.list_my_orders() -> 'items') i where (i ->> 'orderId')::uuid in (public.zo('c1'), public.zo('c2'))), 0, '[목록] 숨긴 주문이 없다');
select is((public.get_my_history_unread_summary() ->> 'unreadOrderCount')::int, 2, '[안읽음] 숨긴 주문은 빠진다');
select is((select count(*)::int from jsonb_array_elements(public.get_my_history_unread_summary() -> 'unreadEvents') e where (e ->> 'orderId')::uuid in (public.zo('c1'), public.zo('c2'))), 0, '[안읽음] 이벤트에도 없다');
select is(public.zq(format($q$select public.get_my_history_order(%L)$q$, public.zo('c1'))), 'P0001:RESOURCE_NOT_FOUND', '[내역] 숨긴 주문은 get_my_history_order에서 RESOURCE_NOT_FOUND');
select is(public.get_my_order(public.zo('c1')) ->> 'status', 'CANCELLED', '[보존] get_my_order는 숨긴 주문도 CANCELLED로 돌려준다');
select is(public.get_my_order(public.zo('c1')) ->> 'orderId', public.zo('c1')::text, '[보존] get_my_order orderId');
-- 목록 쪽수 넘기기: 페이지 크기 1로 넘겨도 숨긴 주문이 끼지 않는다
select is(public.list_my_orders(null, 1) ->> 'hasMore', 'true', '[목록] 쪽 크기 1: hasMore true');
select is((select count(*)::int from jsonb_array_elements(public.list_my_orders(public.list_my_orders(null, 1) ->> 'nextCursor', 5) -> 'items')), 1, '[목록] 다음 쪽에도 숨긴 주문이 없다(남은 1건)');
-- 남의 주문 영향 없음
select public.zjwt('bbbbbbbb-0000-4000-8000-0000000000b2');
select is(jsonb_array_length(public.list_my_orders() -> 'items'), 2, '[목록] B의 목록은 영향이 없다');
reset role;
select is((select count(*)::int from public.orders where user_id = 'aaaaaaaa-0000-4000-8000-0000000000a1'), 4, '[보존] 숨겨도 서버의 주문 행은 4건 그대로');
select is((select count(*)::int from public.order_status_updates where order_id in (public.zo('c1'), public.zo('c2'))), 4, '[보존] 숨긴 주문의 상태 이력도 그대로(주문당 2건)');

-- 월간/누적 요약은 완료(USER_CONFIRMED)만 센다: 숨김과 무관
select public.zjwt('aaaaaaaa-0000-4000-8000-0000000000a1');
set local role authenticated;
select ok(public.zq($q$select public.get_my_order(public.zo('d1'))$q$) = 'OK', '[보존] 완료 주문은 그대로 조회된다');
reset role;

-- 되돌리기 · 삭제 직접 시도 (가드 트리거, superuser)
select is(public.zq(format($q$update public.orders set hidden_at = null where id = %L$q$, public.zo('c1'))), 'P0001:ORDER_GUARD_VIOLATION', '[가드] hidden_at 되돌리기 거절');
select is(public.zq(format($q$update public.orders set hidden_at = now() + interval '1 day' where id = %L$q$, public.zo('c1'))), 'P0001:ORDER_GUARD_VIOLATION', '[가드] hidden_at 다른 값으로 변경 거절');
select is(public.zq(format($q$update public.orders set hidden_at = now() where id = %L$q$, public.zo('p1'))), 'P0001:ORDER_GUARD_VIOLATION', '[가드] PENDING 주문에 hidden_at 거절');
select is(public.zq(format($q$update public.orders set hidden_at = now() where id = %L$q$, public.zo('d1'))), 'P0001:ORDER_GUARD_VIOLATION', '[가드] USER_CONFIRMED 주문에 hidden_at 거절');
select is(public.zq(format($q$update public.orders set hidden_at = now(), status_revision = status_revision where id = %L$q$, public.zo('bc1'))), 'OK', '[가드] CANCELLED의 hidden_at NULL → 시각은 허용');
select is(public.zq(format($q$update public.orders set hidden_at = now(), cancelled_at = now() + interval '1 hour' where id = %L$q$, public.zo('c1'))), 'P0001:ORDER_GUARD_VIOLATION', '[가드] 숨김과 상태 열 동시 변경 거절');
select is(public.zq(format($q$update public.orders set total_amount = total_amount + 1 where id = %L$q$, public.zo('c1'))), 'P0001:ORDER_GUARD_VIOLATION', '[가드] 다른 열 변경은 여전히 거절');

-- 트리거를 잠시 끄고 CHECK가 마지막 방어선인지
alter table public.orders disable trigger user;
select is(public.zq(format($q$update public.orders set hidden_at = now() where id = %L$q$, public.zo('p1'))), '23514:new row for relation "orders" violates check constraint "orders_hidden_only_cancelled"', '[CHECK] 트리거 없이도 PENDING의 hidden_at은 CHECK가 막는다');
alter table public.orders enable trigger user;

-- 직접 삭제도 anon/authenticated는 불가(권한 없음)
select public.zjwt('aaaaaaaa-0000-4000-8000-0000000000a1');
set local role authenticated;
select is(public.zq(format($q$delete from public.orders where id = %L$q$, public.zo('c1'))), '42501:permission denied for table orders', '[권한] 앱은 주문을 직접 지울 수 없다');
select is(public.zq(format($q$update public.orders set hidden_at = null where id = %L$q$, public.zo('c1'))), '42501:permission denied for table orders', '[권한] 앱은 hidden_at을 직접 바꿀 수 없다');
reset role;

-- ================================================================ correct_order_completion
-- anon
select public.zjwt(null);
set local role anon;
select is(public.zq(format($q$select public.correct_order_completion(%L, %L)$q$, public.zo('d1'), public.zid('X'))), '42501:permission denied for function correct_order_completion', '[correct] anon 거부(42501)');
reset role;
set local role authenticated;
select is(public.zfix(public.zo('d1'), 'X'), 'P0001:AUTH_REQUIRED', '[correct] 로그인 없음 → AUTH_REQUIRED');
reset role;

select public.zjwt('aaaaaaaa-0000-4000-8000-0000000000a1');
set local role authenticated;
select is(public.zfix(null, 'X'), 'P0001:INVALID_INPUT', '[correct] 주문 null → INVALID_INPUT');
select is((select public.zq(format($q$select public.correct_order_completion(%L, null)$q$, public.zo('d1')))), 'P0001:INVALID_INPUT', '[correct] operationId null → INVALID_INPUT');
select is(public.zfix(gen_random_uuid(), 'X'), 'P0001:RESOURCE_NOT_FOUND', '[correct] 없는 주문 → RESOURCE_NOT_FOUND');
select is(public.zfix(public.zo('bd1'), 'X'), 'P0001:RESOURCE_NOT_FOUND', '[correct] 남의 주문 → RESOURCE_NOT_FOUND');
select is(public.zfix(public.zo('p1'), 'X'), 'P0001:INVALID_ORDER_TRANSITION', '[correct] PENDING → INVALID_ORDER_TRANSITION');
select is(public.zfix(public.zo('c2'), 'X'), 'P0001:INVALID_ORDER_TRANSITION', '[correct] CANCELLED → INVALID_ORDER_TRANSITION');
-- 확정/취소 때 쓴 operationId를 재사용하면 OPERATION_CONFLICT
select is(public.zfix(public.zo('d1'), 'D1-confirm'), 'P0001:OPERATION_CONFLICT', '[correct] 수령 확인에 쓴 operationId 재사용 → OPERATION_CONFLICT');
select is(public.zfix(public.zo('d1'), 'D1'), 'P0001:OPERATION_CONFLICT', '[correct] 주문 생성 키 재사용 → OPERATION_CONFLICT');
reset role;
select is((select status from public.orders where id = public.zo('d1')), 'USER_CONFIRMED', '[correct] 거절 뒤 주문은 그대로 USER_CONFIRMED');

-- 성공
select public.zjwt('aaaaaaaa-0000-4000-8000-0000000000a1');
set local role authenticated;
select set_config('zz.dres', public.correct_order_completion(public.zo('d1'), public.zid('FIX1'))::text, true);
reset role;
select is((current_setting('zz.dres')::jsonb ->> 'status'), 'CANCELLED', '[correct] 성공: status CANCELLED');
select is((current_setting('zz.dres')::jsonb ->> 'replayed'), 'false', '[correct] 성공: replayed false');
select is((current_setting('zz.dres')::jsonb -> 'completedAt'), 'null'::jsonb, '[correct] completedAt null');
select is((current_setting('zz.dres')::jsonb ->> 'cancelledAt') is not null, true, '[correct] cancelledAt 설정');
select is((current_setting('zz.dres')::jsonb ->> 'statusRevision')::int, 3, '[correct] statusRevision 2 → 3');
select is((select array_agg(k order by k) from jsonb_object_keys(current_setting('zz.dres')::jsonb) k),
  array['cancelledAt', 'completedAt', 'createdAt', 'orderId', 'replayed', 'snapshot', 'status', 'statusRevision', 'totalAmount'], '[correct] 응답 키 = 주문 DTO + replayed');
select is((select status || '/' || status_revision || '/' || (completed_at is null) || '/' || (cancelled_at is not null) from public.orders where id = public.zo('d1')), 'CANCELLED/3/true/true', '[correct] 주문 행 상태');
select is((select count(*)::int from public.order_status_updates where order_id = public.zo('d1')), 3, '[correct] 상태 이력 3건(생성·확정·정정)');
select is((select reason from public.order_status_updates where order_id = public.zo('d1') and revision = 3), 'COMPLETION_CORRECTED', '[correct] 정정 이력에 reason 기록');
select is((select from_status || '>' || to_status from public.order_status_updates where order_id = public.zo('d1') and revision = 3), 'USER_CONFIRMED>CANCELLED', '[correct] 정정 이력 from/to');
select is((select viewed_at is null from public.order_status_updates where order_id = public.zo('d1') and revision = 3), true, '[correct] 정정 이벤트는 안 읽음으로 생긴다');
select is((select count(*)::int from public.order_status_updates where order_id = public.zo('d1') and reason is not null), 1, '[correct] 다른 이력에는 reason이 없다');

-- 재호출
select public.zjwt('aaaaaaaa-0000-4000-8000-0000000000a1');
set local role authenticated;
select is(public.correct_order_completion(public.zo('d1'), public.zid('FIX1')) ->> 'replayed', 'true', '[correct] 같은 operationId 재호출: replayed true');
select is(public.correct_order_completion(public.zo('d1'), public.zid('FIX1')) - 'replayed', current_setting('zz.dres')::jsonb - 'replayed', '[correct] 재호출 결과는 같은 주문 DTO');
select is(public.zfix(public.zo('d1'), 'FIX2'), 'P0001:INVALID_ORDER_TRANSITION', '[correct] 다른 operationId로 다시 정정 → INVALID_ORDER_TRANSITION(이미 CANCELLED)');
reset role;
select is((select count(*)::int from public.order_status_updates where order_id = public.zo('d1')), 3, '[correct] 재호출 뒤에도 이력 3건');
select is((select status_revision from public.orders where id = public.zo('d1')), 3::bigint, '[correct] 재호출 뒤에도 revision 3');

-- 정정된 주문은 취소 주문처럼 다뤄진다: 완료 집계에서 빠지고, 내역에 CANCELLED로 보이고, 숨길 수 있다
select public.zjwt('aaaaaaaa-0000-4000-8000-0000000000a1');
set local role authenticated;
select is(public.get_my_history_order(public.zo('d1')) ->> 'status', 'CANCELLED', '[정정 뒤] 내역에 CANCELLED');
select is((select count(*)::int from jsonb_array_elements(public.get_my_history_unread_summary() -> 'unreadEvents') e where (e ->> 'orderId')::uuid = public.zo('d1')), 3, '[정정 뒤] 안 읽은 이벤트에 정정 이벤트 포함(생성·확정·정정)');
select is(public.zecr(public.zo('d1'), 'R-after-fix'), 'P0001:ORDER_NOT_COMPLETED', '[정정 뒤] 리뷰 작성은 ORDER_NOT_COMPLETED(create_review와 직렬화)');
select is(public.zhide(public.zo('d1')), 'OK', '[정정 뒤] 정정된 주문은 숨길 수 있다');
reset role;

-- 가드: 정정 간선 직접 변형 시도 (superuser)
insert into auth.users (id) values ('cccccccc-0000-4000-8000-0000000000c3');
select public.zjwt('cccccccc-0000-4000-8000-0000000000c3');
set local role authenticated;
select set_config('zz.g1', public.zdone('G1')::text, true);
select set_config('zz.g2', public.zdone('G2')::text, true);
select set_config('zz.g3', public.zdone('G3')::text, true);
select set_config('zz.g4', public.zdone('G4')::text, true);
select set_config('zz.g5', public.zdone('G5')::text, true);
reset role;
select is(public.zq(format($q$update public.orders set status='CANCELLED', status_revision=status_revision+2, completed_at=null, cancelled_at=now() where id=%L$q$, public.zo('g1'))), 'P0001:ORDER_GUARD_VIOLATION', '[가드] 정정 간선: revision +2 거절');
select is(public.zq(format($q$update public.orders set status='CANCELLED', completed_at=null, cancelled_at=now() where id=%L$q$, public.zo('g1'))), 'P0001:ORDER_GUARD_VIOLATION', '[가드] 정정 간선: revision 그대로 거절');
select is(public.zq(format($q$update public.orders set status='PENDING', status_revision=status_revision+1, completed_at=null where id=%L$q$, public.zo('g2'))), 'P0001:ORDER_GUARD_VIOLATION', '[가드] USER_CONFIRMED → PENDING 복원 거절');
select is(public.zq(format($q$update public.orders set status='CANCELLED', status_revision=status_revision+1, cancelled_at=now() where id=%L$q$, public.zo('g3'))), 'P0001:ORDER_GUARD_VIOLATION', '[가드] completed_at을 남긴 채 CANCELLED로 바꾸는 시도 거절');
select is(public.zq(format($q$update public.orders set status='CANCELLED', status_revision=status_revision+1, completed_at=null where id=%L$q$, public.zo('g4'))), 'P0001:ORDER_GUARD_VIOLATION', '[가드] 정정 간선: cancelled_at 없이 거절(또는 CHECK)');
select is(public.zq(format($q$update public.orders set status='CANCELLED', status_revision=status_revision+1, completed_at=null, cancelled_at=now() where id=%L$q$, public.zo('g5'))), 'OK', '[가드] 정정 간선: revision+1, completed_at null, cancelled_at 설정은 허용');
select is(public.zq(format($q$update public.orders set status='USER_CONFIRMED', status_revision=status_revision+1, completed_at=now(), cancelled_at=null where id=%L$q$, public.zo('g5'))), 'P0001:ORDER_GUARD_VIOLATION', '[가드] CANCELLED → USER_CONFIRMED 거절(종료 상태 불변)');
select is(public.zq(format($q$update public.orders set cancelled_at = now() where id=%L$q$, public.zo('c2'))), 'P0001:ORDER_GUARD_VIOLATION', '[가드] 취소 시각 변경은 여전히 거절');

-- reason CHECK
select is(public.zq(format($q$update public.order_status_updates set reason = 'OTHER' where order_id = %L and revision = 3$q$, public.zo('d1'))), '23514:new row for relation "order_status_updates" violates check constraint "order_status_updates_reason_check"', '[CHECK] reason은 COMPLETION_CORRECTED만');

-- ================================================================ 리뷰 관계
-- A: 완료 주문 v1(리뷰 있음), v2(리뷰 삭제됨), v3(리뷰 없음)
select public.zjwt('aaaaaaaa-0000-4000-8000-0000000000a1');
set local role authenticated;
select set_config('zz.v1', public.zdone('V1')::text, true);
select set_config('zz.v2', public.zdone('V2')::text, true);
select set_config('zz.v3', public.zdone('V3')::text, true);
select is(public.zecr(public.zo('v1'), 'V1-rev'), 'OK', '[준비] v1에 리뷰 작성');
select set_config('zz.v2rev', public.create_review(public.zo('v2'), public.zid('V2-rev'), 5, '지울 리뷰 내용입니다') ->> 'reviewId', true);
select set_config('zz.v2revn', (public.create_review(public.zo('v2'), public.zid('V2-rev'), 5, '지울 리뷰 내용입니다') ->> 'reviewId'), true);
select is(public.zfix(public.zo('v1'), 'V1-fix'), 'P0001:ORDER_HAS_REVIEW', '[correct] 활성 리뷰가 있으면 ORDER_HAS_REVIEW');
reset role;
select is((select status from public.orders where id = public.zo('v1')), 'USER_CONFIRMED', '[correct] 리뷰 있는 주문은 그대로 USER_CONFIRMED');
select is((select count(*)::int from public.order_status_updates where order_id = public.zo('v1')), 2, '[correct] 거절된 정정은 이력을 남기지 않는다');
select public.zjwt('aaaaaaaa-0000-4000-8000-0000000000a1');
set local role authenticated;
select public.delete_review(public.zo('v2rev'), public.zid('V2-del'), 1);
select is(public.zfix(public.zo('v2'), 'V2-fix'), 'OK', '[correct] 삭제된 리뷰만 있으면 정정할 수 있다');
select is(public.zfix(public.zo('v3'), 'V3-fix'), 'OK', '[correct] 리뷰 없는 완료 주문은 정정할 수 있다');
reset role;
select is((select status from public.orders where id = public.zo('v2')), 'CANCELLED', '[correct] 삭제된 리뷰 주문이 CANCELLED가 됐다');
select is((select count(*)::int from public.reviews r join public.orders o on o.id = r.order_id where o.status = 'CANCELLED' and r.deleted_at is null), 0, '[불변식] CANCELLED 주문에 활성 리뷰는 없다');

-- 월간 요약은 USER_CONFIRMED만: 정정된 주문은 빠진다 (A의 완료: v1만 남음)
select public.zjwt('aaaaaaaa-0000-4000-8000-0000000000a1');
set local role authenticated;
select is((select count(*)::int from public.orders o where o.user_id = 'aaaaaaaa-0000-4000-8000-0000000000a1' and o.status = 'USER_CONFIRMED'), 1, '[요약] A의 완료 주문은 v1 하나만 남았다');
reset role;

select * from finish();
rollback;
