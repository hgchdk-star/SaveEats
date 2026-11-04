-- 내역: list_my_orders · get_my_history_order · get_my_history_unread_summary · mark_status_updates_viewed
-- 근거: 개발 명세 HIST-001~008 · DB-007, 팀 결정 (2026-11-05 U1~U8). 테스트 데이터는 롤백으로 사라진다.
-- 주문은 실제 경로(create_order, confirm_order, cancel_order)로 만든다. 같은 트랜잭션에서는 created_at이 모두 같아지므로,
-- 정렬 · 커서 테스트를 위해 가드 트리거를 잠시 끄고 created_at을 직접 정한다(superuser, 롤백됨).
-- 진짜 동시성(읽음 처리 동시 호출 등)은 한 세션 테스트로 볼 수 없다 → 수동 확인 목록.
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

-- 현재 사용자로 콜라(M2) 1개 주문을 만들고 주문 ID를 돌려준다 (키 이름이 곧 멱등성 키)
create function public.zmk(p_key text) returns uuid language sql as $$
  select (public.create_order(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M2'), null, 1, 2000)), public.zid(p_key))) ->> 'orderId')::uuid
$$;

create function public.zo(p text) returns uuid language sql stable as $$ select current_setting('zz.' || p)::uuid $$;

-- 모든 페이지를 끝까지 따라가며 주문 ID를 모은다 (페이지 수 상한 100)
create function public.zwalk(p_size integer) returns text language plpgsql as $$
declare v_cursor text := null; v_page jsonb; v_ids text := ''; v_n integer := 0;
begin
  loop
    v_page := public.list_my_orders(v_cursor, p_size);
    v_ids := v_ids || (select coalesce(string_agg(e ->> 'orderId', ',' order by ord), '') from jsonb_array_elements(v_page -> 'items') with ordinality as t (e, ord)) ||
             case when jsonb_array_length(v_page -> 'items') > 0 and (v_page ->> 'hasMore')::boolean then ',' else '' end;
    v_n := v_n + 1;
    exit when not (v_page ->> 'hasMore')::boolean or v_n >= 100;
    v_cursor := v_page ->> 'nextCursor';
  end loop;
  return v_ids;
end;
$$;

-- 주문 DTO(replayed 없음)가 앱 파서 모양과 같은지. 맞으면 'OK'
create function public.zdto_shape(d jsonb) returns text language plpgsql as $$
declare v_item jsonb; v_opt jsonb;
begin
  if (select array_agg(k order by k) from jsonb_object_keys(d) k)
     is distinct from array['cancelledAt', 'completedAt', 'createdAt', 'orderId', 'snapshot', 'status', 'statusRevision', 'totalAmount'] then
    return 'top-level keys';
  end if;
  if jsonb_typeof(d -> 'orderId') <> 'string' or jsonb_typeof(d -> 'status') <> 'string' or jsonb_typeof(d -> 'statusRevision') <> 'number'
     or jsonb_typeof(d -> 'createdAt') <> 'string' or jsonb_typeof(d -> 'completedAt') not in ('string', 'null')
     or jsonb_typeof(d -> 'cancelledAt') not in ('string', 'null') or jsonb_typeof(d -> 'totalAmount') <> 'number' then
    return 'top-level types';
  end if;
  if (select array_agg(k order by k) from jsonb_object_keys(d -> 'snapshot') k) is distinct from array['items', 'store'] then return 'snapshot keys'; end if;
  if (select array_agg(k order by k) from jsonb_object_keys(d -> 'snapshot' -> 'store') k) is distinct from array['categoryName', 'id', 'imageRef', 'name'] then return 'store keys'; end if;
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

-- 내역 행이 앱 파서(parseHistoryPageDto)가 읽는 모양인지. 맞으면 'OK'
create function public.zrow_shape(r jsonb) returns text language plpgsql as $$
declare v_u jsonb; v_ref jsonb; v_base text;
begin
  if (select array_agg(k order by k) from jsonb_object_keys(r) k)
     is distinct from array['cancelledAt', 'completedAt', 'createdAt', 'orderId', 'reviewEligibility', 'snapshot', 'status', 'statusRevision', 'totalAmount', 'unreadUpdates', 'validCurrentMenuRefs'] then
    return 'row keys';
  end if;
  v_base := public.zdto_shape(r - 'unreadUpdates' - 'validCurrentMenuRefs' - 'reviewEligibility');
  if v_base <> 'OK' then return 'order dto: ' || v_base; end if;
  if jsonb_typeof(r -> 'unreadUpdates') <> 'array' then return 'unreadUpdates type'; end if;
  for v_u in select e from jsonb_array_elements(r -> 'unreadUpdates') e loop
    if (select array_agg(k order by k) from jsonb_object_keys(v_u) k) is distinct from array['createdAt', 'eventId', 'revision'] then return 'unread keys'; end if;
    if jsonb_typeof(v_u -> 'eventId') <> 'string' or jsonb_typeof(v_u -> 'revision') <> 'number' or jsonb_typeof(v_u -> 'createdAt') <> 'string' then return 'unread types'; end if;
  end loop;
  if (select array_agg(k order by k) from jsonb_object_keys(r -> 'reviewEligibility') k) is distinct from array['activeReviewId', 'completedAt', 'eligibility', 'reviewDeadline', 'serverNow'] then return 'eligibility keys'; end if;
  if not coalesce((r -> 'reviewEligibility' ->> 'eligibility') = any (array['CAN_WRITE', 'HAS_ACTIVE_REVIEW', 'DEADLINE_EXCEEDED', 'NOT_COMPLETED']), false) then return 'eligibility value'; end if;
  if jsonb_typeof(r -> 'validCurrentMenuRefs') <> 'array' then return 'refs type'; end if;
  for v_ref in select e from jsonb_array_elements(r -> 'validCurrentMenuRefs') e loop
    if jsonb_typeof(v_ref) <> 'string' then return 'ref element type'; end if;
  end loop;
  return 'OK';
end;
$$;

-- ---------------------------------------------------------------- 픽스처 (superuser)
insert into auth.users (id) values
  ('aaaaaaaa-0000-4000-8000-000000000001'),
  ('bbbbbbbb-0000-4000-8000-000000000002'),
  ('cccccccc-0000-4000-8000-000000000003');
insert into public.categories (id, code, name, sort_order, is_active) values
  (public.zid('CA'), 'zz-hist-a', '내역분류A', 99, true),
  (public.zid('CB'), 'zz-hist-b', '내역분류B', 99, true);
insert into public.stores (id, category_id, name, is_active, is_open) values
  (public.zid('S1'), public.zid('CA'), '내역가게1', true, true),
  (public.zid('S2'), public.zid('CA'), '내역가게2', true, true),
  (public.zid('S3'), public.zid('CB'), '내역가게3', true, true);
insert into public.menus (id, store_id, name, base_price) values
  (public.zid('M2'), public.zid('S1'), '콜라', 2000),
  (public.zid('MA'), public.zid('S1'), '메뉴A', 1000),
  (public.zid('MB'), public.zid('S1'), '메뉴B', 2000),
  (public.zid('MC'), public.zid('S1'), '메뉴C', 3000),
  (public.zid('MD'), public.zid('S2'), '메뉴D', 1500),
  (public.zid('ME'), public.zid('S3'), '메뉴E', 1800);
insert into public.menu_option_groups (id, menu_id, name, min_select, max_select, sort_order) values
  (public.zid('GC'), public.zid('MC'), '추가', 0, 2, 1);
insert into public.menu_options (id, group_id, name, additional_price, sort_order) values
  (public.zid('OX'), public.zid('GC'), '엑스', 100, 1),
  (public.zid('OY'), public.zid('GC'), '와이', 200, 2);

-- ---------------------------------------------------------------- 구조 · 권한
select ok(not (select prosecdef from pg_proc where oid = 'public.list_my_orders(text, integer)'::regprocedure), 'list_my_orders는 SECURITY INVOKER');
select ok(not (select prosecdef from pg_proc where oid = 'public.get_my_history_order(uuid)'::regprocedure), 'get_my_history_order는 SECURITY INVOKER');
select ok(not (select prosecdef from pg_proc where oid = 'public.get_my_history_unread_summary()'::regprocedure), 'get_my_history_unread_summary는 SECURITY INVOKER');
select ok((select prosecdef from pg_proc where oid = 'public.mark_status_updates_viewed(uuid[])'::regprocedure), 'mark_status_updates_viewed는 SECURITY DEFINER');
select ok((select bool_and(exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%'))
    from pg_proc p where p.oid in ('public.list_my_orders(text, integer)'::regprocedure, 'public.get_my_history_order(uuid)'::regprocedure,
      'public.get_my_history_unread_summary()'::regprocedure, 'public.mark_status_updates_viewed(uuid[])'::regprocedure)), '네 함수 모두 search_path가 고정되어 있다');
select is((select proargnames from pg_proc where oid = 'public.list_my_orders(text, integer)'::regprocedure), array['p_cursor', 'p_page_size'], 'list_my_orders 인자 이름');
select is((select proargnames from pg_proc where oid = 'public.get_my_history_order(uuid)'::regprocedure), array['p_order_id'], 'get_my_history_order 인자 이름');
select is((select proargnames from pg_proc where oid = 'public.mark_status_updates_viewed(uuid[])'::regprocedure), array['p_event_ids'], 'mark_status_updates_viewed 인자 이름');
select ok(not exists (
    select 1 from pg_proc p where p.oid in ('public.list_my_orders(text, integer)'::regprocedure, 'public.get_my_history_order(uuid)'::regprocedure,
      'public.get_my_history_unread_summary()'::regprocedure, 'public.mark_status_updates_viewed(uuid[])'::regprocedure)
      and coalesce(p.proacl::text, '') ~ '(^|[{,])=X|anon='), '네 함수 모두 PUBLIC/anon에게 열려 있지 않다');
select ok((select count(*) = 4 from pg_proc p where p.oid in ('public.list_my_orders(text, integer)'::regprocedure, 'public.get_my_history_order(uuid)'::regprocedure,
      'public.get_my_history_unread_summary()'::regprocedure, 'public.mark_status_updates_viewed(uuid[])'::regprocedure)
      and coalesce(p.proacl::text, '') ~ 'authenticated=X'), '네 함수 모두 authenticated에게 열려 있다');
select is((select pronargs::int from pg_proc where oid = 'public.get_my_order(uuid)'::regprocedure), 1, '(확인) get_my_order는 그대로다');

-- ---------------------------------------------------------------- Guest / 로그인 정보 없음
set local role anon;
select ok(public.test_err($$select public.list_my_orders()$$, '42501'), '[anon] list_my_orders 실행 금지');
select ok(public.test_err($$select public.get_my_history_order(gen_random_uuid())$$, '42501'), '[anon] get_my_history_order 실행 금지');
select ok(public.test_err($$select public.get_my_history_unread_summary()$$, '42501'), '[anon] 안 읽은 요약 실행 금지');
select ok(public.test_err($$select public.mark_status_updates_viewed('{}')$$, '42501'), '[anon] 읽음 처리 실행 금지');
reset role;
select set_config('request.jwt.claims', '', true);
set local role authenticated;
select ok(public.test_err($$select public.list_my_orders()$$, 'P0001', 'AUTH_REQUIRED'), '[sub 없음] list_my_orders → AUTH_REQUIRED');
select ok(public.test_err($$select public.get_my_history_order(gen_random_uuid())$$, 'P0001', 'AUTH_REQUIRED'), '[sub 없음] get_my_history_order → AUTH_REQUIRED');
select ok(public.test_err($$select public.get_my_history_unread_summary()$$, 'P0001', 'AUTH_REQUIRED'), '[sub 없음] 안 읽은 요약 → AUTH_REQUIRED');
select ok(public.test_err($$select public.mark_status_updates_viewed('{}')$$, 'P0001', 'AUTH_REQUIRED'), '[sub 없음] 읽음 처리 → AUTH_REQUIRED');
select ok(public.test_err($$select public.mark_status_updates_viewed(null)$$, 'P0001', 'AUTH_REQUIRED'), '[sub 없음] 잘못된 입력도 로그인 확인이 먼저');
reset role;

-- ---------------------------------------------------------------- 사용자 C: 주문이 하나도 없다
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-4000-8000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select is(public.list_my_orders(), '{"items":[],"hasMore":false,"nextCursor":null}'::jsonb, '[C] 주문이 없으면 items [] · hasMore false · nextCursor null');
select is(public.get_my_history_unread_summary() - 'asOf', '{"unreadEvents":[],"unreadOrderCount":0}'::jsonb, '[C] 안 읽은 요약도 비어 있다');
select is(jsonb_typeof(public.get_my_history_unread_summary() -> 'asOf'), 'string', '[C] asOf는 시각 문자열');
reset role;

-- ---------------------------------------------------------------- 사용자 A: 주문 13개 만들기
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select set_config('zz.o1', public.zmk('K1')::text, true);
select set_config('zz.o2', public.zmk('K2')::text, true);
select set_config('zz.o3', public.zmk('K3')::text, true);
select set_config('zz.o4', public.zmk('K4')::text, true);
select set_config('zz.o5', public.zmk('K5')::text, true);
select set_config('zz.o6', public.zmk('K6')::text, true);
select set_config('zz.o7', public.zmk('K7')::text, true);
select set_config('zz.o8', public.zmk('K8')::text, true);
select set_config('zz.o9', public.zmk('K9')::text, true);
select set_config('zz.o10', public.zmk('K10')::text, true);
-- om1: 메뉴 A, B, C(옵션 없음), C(옵션 X) — 같은 메뉴 C가 두 줄
select set_config('zz.om1', (public.create_order(public.zreq(public.zid('S1'), jsonb_build_array(
    public.zitem(public.zid('MA'), null, 1, 1000), public.zitem(public.zid('MB'), null, 1, 2000),
    public.zitem(public.zid('MC'), null, 1, 3000), public.zitem(public.zid('MC'), array[public.zid('OX')], 1, 3100)), public.zid('KM1'))) ->> 'orderId'), true);
select set_config('zz.om2', (public.create_order(public.zreq(public.zid('S2'), jsonb_build_array(public.zitem(public.zid('MD'), null, 1, 1500)), public.zid('KM2'))) ->> 'orderId'), true);
select set_config('zz.om3', (public.create_order(public.zreq(public.zid('S3'), jsonb_build_array(public.zitem(public.zid('ME'), null, 1, 1800)), public.zid('KM3'))) ->> 'orderId'), true);
reset role;

-- 정렬 · 커서 테스트를 위해 생성 시각을 직접 정한다 (가드 트리거를 잠시 끈다. 롤백됨)
alter table public.orders disable trigger orders_guard;
update public.orders set created_at = '2026-01-01 10:00:00.000001+00' where id = public.zo('o1');
update public.orders set created_at = '2026-01-01 10:00:00.000002+00' where id = public.zo('o6');
update public.orders set created_at = '2026-01-02 10:00:00+00' where id = public.zo('o2');
update public.orders set created_at = '2026-01-03 09:00:00.123456+00' where id in (public.zo('o3'), public.zo('o4'), public.zo('o7'), public.zo('o8'), public.zo('o9'), public.zo('o10'));
update public.orders set created_at = '2026-01-04 10:00:00+00' where id = public.zo('o5');
update public.orders set created_at = '2026-02-01 10:00:00+00' where id = public.zo('om1');
update public.orders set created_at = '2026-02-02 10:00:00+00' where id = public.zo('om2');
update public.orders set created_at = '2026-02-03 10:00:00+00' where id = public.zo('om3');
alter table public.orders enable trigger orders_guard;
select set_config('zz.exp', (select string_agg(id::text, ',' order by created_at desc, id desc) from public.orders where user_id = 'aaaaaaaa-0000-4000-8000-000000000001'), true);
select is((select count(*)::int from public.orders where user_id = 'aaaaaaaa-0000-4000-8000-000000000001'), 13, '(준비) A의 주문 13개');
select is((select count(*)::int from public.orders where created_at = '2026-01-03 09:00:00.123456+00'), 6, '(준비) 생성 시각이 완전히 같은 주문 6개(동률 처리 확인용: 우연히 id 순서와 저장 순서가 같을 확률 1/720)');

-- ---------------------------------------------------------------- B의 주문 1개 (A보다 오래된 시각)
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select set_config('zz.ob', public.zmk('KB')::text, true);
reset role;
alter table public.orders disable trigger orders_guard;
update public.orders set created_at = '2026-01-01 05:00:00+00' where id = public.zo('ob');
alter table public.orders enable trigger orders_guard;

-- ---------------------------------------------------------------- 목록 (사용자 A)
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select set_config('zz.p', public.list_my_orders()::text, true);
select is((select array_agg(k order by k) from jsonb_object_keys(current_setting('zz.p')::jsonb) k), array['hasMore', 'items', 'nextCursor'], '목록 최상위 키는 items / hasMore / nextCursor');
select is(jsonb_array_length(current_setting('zz.p')::jsonb -> 'items'), 13, '기본 페이지 크기 20: 주문 13개가 모두 나온다');
select is(current_setting('zz.p')::jsonb -> 'hasMore', 'false'::jsonb, '더 없으면 hasMore false');
select is(current_setting('zz.p')::jsonb -> 'nextCursor', 'null'::jsonb, '더 없으면 nextCursor null');
select is((select string_agg(e ->> 'orderId', ',' order by ord) from jsonb_array_elements(current_setting('zz.p')::jsonb -> 'items') with ordinality as t (e, ord)),
  current_setting('zz.exp'), '정렬: 생성 시각 내림차순 → id 내림차순');
select is(current_setting('zz.p')::jsonb -> 'items' -> 0 ->> 'orderId', public.zo('om3')::text, '가장 최근 주문이 맨 위');
select is((select count(*)::int from jsonb_array_elements(current_setting('zz.p')::jsonb -> 'items') e where e ->> 'orderId' = public.zo('ob')::text), 0, 'B의 주문은 A의 목록에 없다');
select is((select string_agg(public.zrow_shape(e), ',') from jsonb_array_elements(current_setting('zz.p')::jsonb -> 'items') e where public.zrow_shape(e) <> 'OK'), null,
  '모든 행이 앱 파서 모양(주문 DTO + unreadUpdates + validCurrentMenuRefs + reviewEligibility)');
select is((select count(*)::int from jsonb_array_elements(current_setting('zz.p')::jsonb -> 'items') e where e ? 'replayed'), 0, 'replayed 키가 없다 (생성 응답 전용)');
select is((select count(*)::int from jsonb_array_elements(current_setting('zz.p')::jsonb -> 'items') e where e ? 'reviewEligibility'), 13, '모든 행에 reviewEligibility가 있다 (리뷰 서버 PR에서 추가됨)');
select is((select count(*)::int from jsonb_array_elements(current_setting('zz.p')::jsonb -> 'items') e where e ? 'images'), 0, 'images 키는 없다 (사진은 후속)');
select is((select count(*)::int from jsonb_array_elements(current_setting('zz.p')::jsonb -> 'items') e
    where (e #- '{reviewEligibility,serverNow}') <> (public.get_my_history_order((e ->> 'orderId')::uuid) #- '{reviewEligibility,serverNow}')), 0, '목록의 각 행은 단건 조회와 같다 (조회 시각 serverNow만 다를 수 있다)');
select is((select count(*)::int from jsonb_array_elements(current_setting('zz.p')::jsonb -> 'items') e
    where (e - 'unreadUpdates' - 'validCurrentMenuRefs' - 'reviewEligibility') <> public.get_my_order((e ->> 'orderId')::uuid)), 0, '주문 DTO 부분은 get_my_order와 같다');
select ok(not (public.get_my_order(public.zo('o5')) ? 'unreadUpdates'), '(확인) get_my_order는 바뀌지 않았다: unreadUpdates 키 없음');

-- 페이지 크기
select is(jsonb_array_length(public.list_my_orders(null, 1) -> 'items'), 1, '페이지 크기 1');
select is(jsonb_array_length(public.list_my_orders(null, 50) -> 'items'), 13, '페이지 크기 50');
select is(jsonb_array_length(public.list_my_orders(null, null) -> 'items'), 13, '페이지 크기 null은 기본값(20)');
select ok(public.test_err($$select public.list_my_orders(null, 0)$$, 'P0001', 'INVALID_INPUT'), '페이지 크기 0 → INVALID_INPUT');
select ok(public.test_err($$select public.list_my_orders(null, -1)$$, 'P0001', 'INVALID_INPUT'), '페이지 크기 -1 → INVALID_INPUT');
select ok(public.test_err($$select public.list_my_orders(null, 51)$$, 'P0001', 'INVALID_INPUT'), '페이지 크기 51 → INVALID_INPUT');
select ok(public.test_err($$select public.list_my_orders(null, 1000)$$, 'P0001', 'INVALID_INPUT'), '페이지 크기 1000 → INVALID_INPUT');

-- 페이지 따라가기: 어떤 크기로 나눠도 같은 순서, 중복 · 누락 없음
select is(public.list_my_orders(null, 2) -> 'hasMore', 'true'::jsonb, '페이지 크기 2: 첫 페이지 hasMore true');
select ok(jsonb_typeof(public.list_my_orders(null, 2) -> 'nextCursor') = 'string', '페이지 크기 2: nextCursor는 문자열');
select is(public.zwalk(1), current_setting('zz.exp'), '크기 1로 끝까지: 순서 그대로, 중복 · 누락 없음 (동률 · 마이크로초 경계 포함)');
select is(public.zwalk(2), current_setting('zz.exp'), '크기 2로 끝까지');
select is(public.zwalk(3), current_setting('zz.exp'), '크기 3으로 끝까지');
select is(public.zwalk(4), current_setting('zz.exp'), '크기 4로 끝까지');
select is(public.zwalk(5), current_setting('zz.exp'), '크기 5로 끝까지 (동률 묶음 한가운데에서 잘린다)');
select is(public.zwalk(7), current_setting('zz.exp'), '크기 7로 끝까지');
select is(public.zwalk(12), current_setting('zz.exp'), '크기 12로 끝까지');
select is(public.zwalk(13), current_setting('zz.exp'), '크기 13으로 끝까지 (정확히 한 페이지)');
select is(public.list_my_orders(null, 13) -> 'hasMore', 'false'::jsonb, '딱 맞는 크기(13)에서는 hasMore false');
select is(public.list_my_orders(null, 12) -> 'hasMore', 'true'::jsonb, '크기 12에서는 hasMore true');

-- 커서
select set_config('zz.c', public.list_my_orders(null, 2) ->> 'nextCursor', true);
select is(jsonb_array_length(public.list_my_orders(current_setting('zz.c'), 50) -> 'items'), 11, '커서 뒤에는 나머지 11개');
select is(public.list_my_orders(current_setting('zz.c'), 50) -> 'items' -> 0 ->> 'orderId', (string_to_array(current_setting('zz.exp'), ','))[3], '커서 다음 첫 행은 3번째 주문');
select ok(convert_from(decode(current_setting('zz.c'), 'base64'), 'UTF8')::jsonb ? 'createdAt' and convert_from(decode(current_setting('zz.c'), 'base64'), 'UTF8')::jsonb ? 'orderId',
  '커서는 base64 JSON {createdAt, orderId}');
select ok(position(E'\n' in current_setting('zz.c')) = 0, '커서에 줄바꿈이 없다');
select ok(public.test_err($$select public.list_my_orders('abc')$$, 'P0001', 'INVALID_INPUT'), '잘못된 커서: 아무 문자열');
select ok(public.test_err(format('select public.list_my_orders(%L)', encode(convert_to('not json', 'UTF8'), 'base64')), 'P0001', 'INVALID_INPUT'), '잘못된 커서: JSON이 아님');
select ok(public.test_err(format('select public.list_my_orders(%L)', encode(convert_to('{}', 'UTF8'), 'base64')), 'P0001', 'INVALID_INPUT'), '잘못된 커서: 빈 객체');
select ok(public.test_err(format('select public.list_my_orders(%L)', encode(convert_to('[]', 'UTF8'), 'base64')), 'P0001', 'INVALID_INPUT'), '잘못된 커서: 배열');
select ok(public.test_err(format('select public.list_my_orders(%L)', encode(convert_to('{"createdAt":"x","orderId":"y"}', 'UTF8'), 'base64')), 'P0001', 'INVALID_INPUT'), '잘못된 커서: 시각 · UUID 형식 오류');
select ok(public.test_err(format('select public.list_my_orders(%L)', encode(convert_to('{"createdAt":"2026-01-01T00:00:00Z"}', 'UTF8'), 'base64')), 'P0001', 'INVALID_INPUT'), '잘못된 커서: orderId 없음');
select ok(public.test_err(format('select public.list_my_orders(%L)', ''), 'P0001', 'INVALID_INPUT'), '잘못된 커서: 빈 문자열');

-- 다른 사용자의 커서를 써도 본인 주문만 나온다 (B로 로그인해 A의 커서를 사용)
select set_config('zz.cA', public.list_my_orders(null, 12) ->> 'nextCursor', true);
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select string_agg(e ->> 'orderId', ',') from jsonb_array_elements(public.list_my_orders(current_setting('zz.cA'), 50) -> 'items') e), public.zo('ob')::text,
  '[B] A의 커서를 써도 B 자신의 주문만 나온다 (커서는 소유권의 대체물이 아니다)');
select is((select string_agg(e ->> 'orderId', ',') from jsonb_array_elements(public.list_my_orders() -> 'items') e), public.zo('ob')::text, '[B] B의 목록은 자기 주문 1개');
reset role;

-- ---------------------------------------------------------------- 안 읽은 이벤트: 처음 상태
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(jsonb_array_length(public.get_my_history_order(public.zo('o5')) -> 'unreadUpdates'), 1, '새 주문은 안 읽은 이벤트 1개(생성 이력)');
select is(public.get_my_history_order(public.zo('o5')) -> 'unreadUpdates' -> 0 ->> 'eventId',
  (select id::text from public.order_status_updates where order_id = public.zo('o5') and revision = 1), 'eventId는 order_status_updates.id');
select is((public.get_my_history_order(public.zo('o5')) -> 'unreadUpdates' -> 0 ->> 'revision')::int, 1, '생성 이력의 revision은 1');
select is(jsonb_typeof(public.get_my_history_order(public.zo('o5')) -> 'unreadUpdates' -> 0 -> 'createdAt'), 'string', 'createdAt은 시각 문자열');
-- 사용자가 직접 누른 완료 · 취소도 안 읽은 이벤트로 남는다
select is((public.confirm_order(public.zo('o2'), public.zid('OP2')) ->> 'status'), 'USER_CONFIRMED', '(준비) o2 완료');
select is((public.cancel_order(public.zo('o3'), public.zid('OP3')) ->> 'status'), 'CANCELLED', '(준비) o3 취소');
select is((select array_agg((e ->> 'revision')::int order by ord) from jsonb_array_elements(public.get_my_history_order(public.zo('o2')) -> 'unreadUpdates') with ordinality as t (e, ord)),
  array[1, 2], '직접 누른 완료도 안 읽은 이벤트: revision 1, 2 (오름차순)');
select is((select array_agg((e ->> 'revision')::int order by ord) from jsonb_array_elements(public.get_my_history_order(public.zo('o3')) -> 'unreadUpdates') with ordinality as t (e, ord)),
  array[1, 2], '직접 누른 취소도 안 읽은 이벤트: revision 1, 2');
select is(public.zrow_shape(public.get_my_history_order(public.zo('o2'))), 'OK', '완료된 주문의 내역 행도 같은 모양');

-- 요약
select set_config('zz.s', public.get_my_history_unread_summary()::text, true);
select is((select array_agg(k order by k) from jsonb_object_keys(current_setting('zz.s')::jsonb) k), array['asOf', 'unreadEvents', 'unreadOrderCount'], '요약 최상위 키는 unreadEvents / unreadOrderCount / asOf');
select is(jsonb_array_length(current_setting('zz.s')::jsonb -> 'unreadEvents'), 15, '안 읽은 이벤트 15개 (주문 13개의 생성 이력 + 완료 1 + 취소 1)');
select is((current_setting('zz.s')::jsonb ->> 'unreadOrderCount')::int, 13, '안 읽은 이벤트가 있는 주문 13개');
select is((select array_agg(k order by k) from jsonb_object_keys(current_setting('zz.s')::jsonb -> 'unreadEvents' -> 0) k), array['eventId', 'orderId', 'revision'], '이벤트 키는 eventId / orderId / revision');
select is((select count(*)::int from jsonb_array_elements(current_setting('zz.s')::jsonb -> 'unreadEvents') e where e ->> 'orderId' = public.zo('ob')::text), 0, 'B의 이벤트는 A의 요약에 없다');
select is(current_setting('zz.s')::jsonb -> 'unreadEvents' -> 0 ->> 'orderId', public.zo('om3')::text, '요약 순서: 최근 주문부터');
select is(jsonb_typeof(current_setting('zz.s')::jsonb -> 'asOf'), 'string', 'asOf는 시각 문자열');
reset role;

-- ---------------------------------------------------------------- 읽음 처리
select set_config('zz.ev5', (select id::text from public.order_status_updates where order_id = public.zo('o5') and revision = 1), true);
select set_config('zz.ev2a', (select id::text from public.order_status_updates where order_id = public.zo('o2') and revision = 1), true);
select set_config('zz.ev2b', (select id::text from public.order_status_updates where order_id = public.zo('o2') and revision = 2), true);
select set_config('zz.evb', (select id::text from public.order_status_updates where order_id = public.zo('ob') and revision = 1), true);
set local role authenticated;
select is(public.mark_status_updates_viewed(array[current_setting('zz.ev5')::uuid]), jsonb_build_object('acknowledgedEventIds', jsonb_build_array(current_setting('zz.ev5'))),
  '읽음 처리 응답: acknowledgedEventIds');
select is((select array_agg(k order by k) from jsonb_object_keys(public.mark_status_updates_viewed(array[current_setting('zz.ev5')::uuid])) k), array['acknowledgedEventIds'], '읽음 응답 키는 acknowledgedEventIds 하나');
select is(jsonb_array_length(public.get_my_history_order(public.zo('o5')) -> 'unreadUpdates'), 0, '읽으면 그 주문의 unreadUpdates가 비어 있다');
select is(jsonb_array_length(public.get_my_history_unread_summary() -> 'unreadEvents'), 14, '요약에서 그 이벤트만 빠진다 (15 → 14)');
select is((public.get_my_history_unread_summary() ->> 'unreadOrderCount')::int, 12, '이벤트가 하나뿐이던 주문이라 안 읽은 주문 수도 13 → 12');
reset role;
select ok((select viewed_at is not null from public.order_status_updates where id = current_setting('zz.ev5')::uuid), 'DB: viewed_at이 서버 시각으로 저장되었다');
select set_config('zz.v5', (select viewed_at::text from public.order_status_updates where id = current_setting('zz.ev5')::uuid), true);
update public.order_status_updates set viewed_at = '2000-01-01 00:00:00+00' where id = current_setting('zz.ev5')::uuid;
set local role authenticated;
select is(public.mark_status_updates_viewed(array[current_setting('zz.ev5')::uuid]) -> 'acknowledgedEventIds', jsonb_build_array(current_setting('zz.ev5')), '이미 읽은 이벤트를 다시 보내도 성공');
reset role;
select is((select viewed_at::text from public.order_status_updates where id = current_setting('zz.ev5')::uuid), '2000-01-01 00:00:00+00', '다시 읽어도 최초 viewed_at은 바뀌지 않는다');

-- 정확히 그 ID만: o2의 revision 1만 읽으면 revision 2는 남는다
set local role authenticated;
select is(public.mark_status_updates_viewed(array[current_setting('zz.ev2a')::uuid]) -> 'acknowledgedEventIds', jsonb_build_array(current_setting('zz.ev2a')), 'o2의 revision 1만 읽음 처리');
select is((select array_agg((e ->> 'revision')::int) from jsonb_array_elements(public.get_my_history_order(public.zo('o2')) -> 'unreadUpdates') e), array[2], '같은 주문의 revision 2는 여전히 안 읽음 (주문 전체를 읽음 처리하지 않는다)');
select is(jsonb_array_length(public.get_my_history_unread_summary() -> 'unreadEvents'), 13, '요약은 13개 (다른 주문 이벤트는 그대로)');
reset role;
select is((select count(*)::int from public.order_status_updates u join public.orders o on o.id = u.order_id
    where o.user_id = 'aaaaaaaa-0000-4000-8000-000000000001' and u.viewed_at is not null), 2, 'DB: A의 읽은 이벤트는 정확히 2개');

-- 읽음 뒤에 새로 생긴 이벤트는 안 읽음으로 남는다
set local role authenticated;
select is((public.confirm_order(public.zo('o5'), public.zid('OP5')) ->> 'status'), 'USER_CONFIRMED', '(준비) 읽은 주문 o5를 완료');
select is((select array_agg((e ->> 'revision')::int) from jsonb_array_elements(public.get_my_history_order(public.zo('o5')) -> 'unreadUpdates') e), array[2],
  '읽음 이후에 생긴 새 이벤트(revision 2)는 자동으로 읽음 처리되지 않는다');
reset role;

-- 타인 · 없는 ID는 전체 거절, 아무것도 바꾸지 않는다
set local role authenticated;
select ok(public.test_err(format('select public.mark_status_updates_viewed(%L::uuid[])', format('{%s}', current_setting('zz.evb'))), 'P0001', 'RESOURCE_NOT_FOUND'), '남의 이벤트 → RESOURCE_NOT_FOUND');
select ok(public.test_err(format('select public.mark_status_updates_viewed(%L::uuid[])', format('{%s,%s}', current_setting('zz.ev2b'), current_setting('zz.evb'))), 'P0001', 'RESOURCE_NOT_FOUND'),
  '내 이벤트에 남의 이벤트가 섞이면 전체 RESOURCE_NOT_FOUND');
select ok(public.test_err(format('select public.mark_status_updates_viewed(%L::uuid[])', format('{%s,%s}', current_setting('zz.ev2b'), gen_random_uuid())), 'P0001', 'RESOURCE_NOT_FOUND'),
  '내 이벤트에 없는 ID가 섞여도 전체 RESOURCE_NOT_FOUND');
select is((select count(*)::int from jsonb_array_elements(public.get_my_history_order(public.zo('o2')) -> 'unreadUpdates') e where e ->> 'revision' = '2'), 1, '거절된 요청은 섞여 있던 내 이벤트(o2 revision 2)도 읽음 처리하지 않았다');
reset role;
select is((select viewed_at is null from public.order_status_updates where id = current_setting('zz.evb')::uuid), true, 'DB: 남의 이벤트는 읽음 처리되지 않았다');

-- 입력 규칙
set local role authenticated;
select is(public.mark_status_updates_viewed('{}'), '{"acknowledgedEventIds":[]}'::jsonb, '빈 배열은 성공 no-op');
select ok(public.test_err($$select public.mark_status_updates_viewed(null)$$, 'P0001', 'INVALID_INPUT'), 'null 배열 → INVALID_INPUT');
select ok(public.test_err(format('select public.mark_status_updates_viewed(array[%L::uuid, null])', current_setting('zz.ev2b')), 'P0001', 'INVALID_INPUT'), 'null 원소 → INVALID_INPUT');
select ok(public.test_err(format('select public.mark_status_updates_viewed(array_fill(%L::uuid, array[101]))', current_setting('zz.ev2b')), 'P0001', 'INVALID_INPUT'), '101개 → INVALID_INPUT');
select is(public.mark_status_updates_viewed(array_fill(current_setting('zz.ev2b')::uuid, array[100])) -> 'acknowledgedEventIds', jsonb_build_array(current_setting('zz.ev2b')),
  '100개(같은 ID 반복)는 허용되고 중복은 한 번만 응답한다');
select is(public.mark_status_updates_viewed(array[current_setting('zz.ev2a')::uuid, current_setting('zz.ev5')::uuid, current_setting('zz.ev2a')::uuid]) -> 'acknowledgedEventIds',
  jsonb_build_array(current_setting('zz.ev2a'), current_setting('zz.ev5')), '응답 순서는 처음 나온 순서(중복 제거)');
select is((select count(*)::int from jsonb_array_elements(public.get_my_history_order(public.zo('o2')) -> 'unreadUpdates')), 0, 'o2의 안 읽은 이벤트가 모두 읽음 처리되었다');
reset role;
select is((select status || '/' || status_revision from public.orders where id = public.zo('o2')), 'USER_CONFIRMED/2', '읽음 처리는 주문 상태와 revision을 바꾸지 않는다');

-- 직접 쓰기는 여전히 금지
set local role authenticated;
select ok(public.test_err($$update public.order_status_updates set viewed_at = now()$$, '42501'), '[A] 이력 직접 UPDATE 금지 (읽음 처리는 함수로만)');

-- ---------------------------------------------------------------- 단건 조회
select is(public.get_my_history_order(public.zo('om1')) #- '{reviewEligibility,serverNow}', (select e #- '{reviewEligibility,serverNow}' from jsonb_array_elements(public.list_my_orders(null, 50) -> 'items') e where e ->> 'orderId' = public.zo('om1')::text), '단건 조회 = 목록의 같은 행 (serverNow 제외)');
select ok(public.test_err($$select public.get_my_history_order(null)$$, 'P0001', 'INVALID_INPUT'), '주문 ID null → INVALID_INPUT');
select ok(public.test_err($$select public.get_my_history_order(gen_random_uuid())$$, 'P0001', 'RESOURCE_NOT_FOUND'), '없는 주문 → RESOURCE_NOT_FOUND');
select ok(public.test_err(format('select public.get_my_history_order(%L)', public.zo('ob')), 'P0001', 'RESOURCE_NOT_FOUND'), '남의 주문 → RESOURCE_NOT_FOUND (없는 주문과 구별되지 않는다)');
reset role;

-- ---------------------------------------------------------------- validCurrentMenuRefs
set local role authenticated;
select is(public.get_my_history_order(public.zo('om1')) -> 'validCurrentMenuRefs',
  jsonb_build_array(public.zid('MA'), public.zid('MB'), public.zid('MC')), '모두 활성이면 주문 줄 순서대로, 같은 메뉴(C의 두 줄)는 한 번만');
select is(public.get_my_history_order(public.zo('om2')) -> 'validCurrentMenuRefs', jsonb_build_array(public.zid('MD')), '다른 가게 주문');
select is(public.get_my_history_order(public.zo('om3')) -> 'validCurrentMenuRefs', jsonb_build_array(public.zid('ME')), '다른 분류 주문');
reset role;

update public.menus set is_sold_out = true where id = public.zid('MA');
update public.stores set is_open = false where id = public.zid('S1');
update public.menus set is_active = false where id = public.zid('MB');
update public.stores set is_active = false where id = public.zid('S2');
update public.categories set is_active = false where id = public.zid('CB');
set local role authenticated;
select is(public.get_my_history_order(public.zo('om1')) -> 'validCurrentMenuRefs', jsonb_build_array(public.zid('MA'), public.zid('MC')),
  '품절(A)과 영업 종료 가게의 메뉴는 포함, 비활성 메뉴(B)만 제외');
select is(public.get_my_history_order(public.zo('om2')) -> 'validCurrentMenuRefs', '[]'::jsonb, '가게가 비활성이면 그 메뉴는 제외');
select is(public.get_my_history_order(public.zo('om3')) -> 'validCurrentMenuRefs', '[]'::jsonb, '분류가 비활성이면 그 가게의 메뉴는 제외');
select is(public.get_my_history_order(public.zo('om2')) -> 'snapshot' -> 'store' ->> 'name', '내역가게2', '그래도 주문 기록(Snapshot)은 그대로 남는다');
select is(jsonb_array_length(public.list_my_orders(null, 50) -> 'items'), 13, '카탈로그가 비활성이 되어도 주문은 목록에서 사라지지 않는다');
select is((select e -> 'validCurrentMenuRefs' from jsonb_array_elements(public.list_my_orders(null, 50) -> 'items') e where e ->> 'orderId' = public.zo('om1')::text),
  jsonb_build_array(public.zid('MA'), public.zid('MC')), '목록 행도 같은 규칙');
reset role;

select * from finish();
rollback;
