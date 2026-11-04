-- 주문 생성: orders · order_items · order_item_options · order_status_updates, create_order · get_my_order · get_order_by_request_key
-- 근거: 개발 명세 ORD-005~007 · DB-006~007, 계약 초안 order-contract-draft-v2.md. 테스트 데이터는 롤백으로 사라진다.
-- 카탈로그 데이터는 이 파일 안에서 직접 만든다(seed에 의존하지 않는다). ID는 이름의 md5로 만든다: public.zid('M1').
-- 진짜 동시성(같은 키 동시 요청, 생성과 카탈로그 변경이 동시)은 여기서 확인할 수 없다 → tests/README 아래 "수동 확인" 목록.
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

-- 이름 → 고정 UUID
create function public.zid(p text) returns uuid language sql immutable as $$ select md5(p)::uuid $$;

-- create_order 결과: 성공이면 'OK', 실패면 'SQLSTATE:메시지'
create function public.zcode(p jsonb) returns text language plpgsql as $$
begin
  perform public.create_order(p);
  return 'OK';
exception when others then
  return sqlstate || ':' || sqlerrm;
end;
$$;

create function public.zitem(p_menu uuid, p_opts uuid[], p_qty integer, p_price bigint) returns jsonb language sql as $$
  select jsonb_build_object('menuId', p_menu, 'optionIds', to_jsonb(coalesce(p_opts, '{}'::uuid[])),
                            'quantity', p_qty, 'approvedUnitPrice', p_price, 'approvedCatalogRevision', 1)
$$;

-- 요청 만들기: 승인 총액은 항목에서 계산한다
create function public.zreq(p_store uuid, p_items jsonb, p_key uuid default gen_random_uuid(), p_disc text default '2026-09-30',
                            p_dest uuid default '0de57000-0000-4000-8000-000000000001')
returns jsonb language sql as $$
  select jsonb_build_object(
    'idempotencyKey', p_key, 'requestVersion', 2, 'storeId', p_store, 'destinationRef', p_dest, 'items', p_items,
    'approvedTotalAmount', (select sum((i ->> 'approvedUnitPrice')::numeric * (i ->> 'quantity')::numeric)
                            from jsonb_array_elements(p_items) i)::bigint,
    'disclosureVersion', p_disc, 'disclosureAcknowledged', true)
$$;

-- 지우의 parseOrderDto(order-dto.ts)가 읽는 모양과 같은지 본다: 키 이름(정확히), 타입. 맞으면 'OK', 아니면 처음 어긋난 곳.
-- p_replayed: 생성 응답이면 true(replayed 키가 boolean으로 있어야 함), 조회 응답이면 false(replayed 키가 없어야 함)
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
  if jsonb_typeof(d -> 'snapshot') <> 'object' then return 'snapshot type'; end if;
  if (select array_agg(k order by k) from jsonb_object_keys(d -> 'snapshot') k) is distinct from array['items', 'store'] then return 'snapshot keys'; end if;
  v_store := d -> 'snapshot' -> 'store';
  if jsonb_typeof(v_store) <> 'object' then return 'store type'; end if;
  if (select array_agg(k order by k) from jsonb_object_keys(v_store) k) is distinct from array['categoryName', 'id', 'imageRef', 'name'] then return 'store keys'; end if;
  if jsonb_typeof(v_store -> 'id') <> 'string' or jsonb_typeof(v_store -> 'name') <> 'string' or jsonb_typeof(v_store -> 'categoryName') <> 'string'
     or jsonb_typeof(v_store -> 'imageRef') not in ('string', 'null') then return 'store value types'; end if;
  if jsonb_typeof(d -> 'snapshot' -> 'items') <> 'array' then return 'items type'; end if;
  for v_item in select e from jsonb_array_elements(d -> 'snapshot' -> 'items') e loop
    if jsonb_typeof(v_item) <> 'object' then return 'item type'; end if;
    if (select array_agg(k order by k) from jsonb_object_keys(v_item) k)
       is distinct from array['lineTotal', 'menuId', 'menuImageRef', 'menuName', 'options', 'quantity', 'unitPrice'] then return 'item keys'; end if;
    if jsonb_typeof(v_item -> 'menuId') <> 'string' or jsonb_typeof(v_item -> 'menuName') <> 'string'
       or jsonb_typeof(v_item -> 'menuImageRef') not in ('string', 'null') then return 'item string types'; end if;
    if jsonb_typeof(v_item -> 'unitPrice') <> 'number' or jsonb_typeof(v_item -> 'quantity') <> 'number'
       or jsonb_typeof(v_item -> 'lineTotal') <> 'number' then return 'item number types'; end if;
    if jsonb_typeof(v_item -> 'options') <> 'array' then return 'options type'; end if;
    for v_opt in select o from jsonb_array_elements(v_item -> 'options') o loop
      if jsonb_typeof(v_opt) <> 'object' then return 'option type'; end if;
      if (select array_agg(k order by k) from jsonb_object_keys(v_opt) k) is distinct from array['additionalPrice', 'groupName', 'optionName'] then return 'option keys'; end if;
      if jsonb_typeof(v_opt -> 'groupName') <> 'string' or jsonb_typeof(v_opt -> 'optionName') <> 'string'
         or jsonb_typeof(v_opt -> 'additionalPrice') <> 'number' then return 'option value types'; end if;
    end loop;
  end loop;
  return 'OK';
end;
$$;

-- ---------------------------------------------------------------- 픽스처 (superuser)
insert into auth.users (id) values
  ('aaaaaaaa-0000-4000-8000-000000000001'),
  ('bbbbbbbb-0000-4000-8000-000000000002'),
  ('cccccccc-0000-4000-8000-000000000003');
-- A만 프로필이 이미 있다 (닉네임 있음). B, C는 프로필 행이 없다.
insert into public.profiles (id, nickname) values ('aaaaaaaa-0000-4000-8000-000000000001', '기존닉네임');

insert into public.categories (id, code, name, sort_order, is_active) values
  (public.zid('CA'), 'zz-ord-a', '테스트분류', 99, true),
  (public.zid('CB'), 'zz-ord-b', '비활성분류', 99, false);
insert into public.stores (id, category_id, name, image_ref, is_active, is_open) values
  (public.zid('S1'), public.zid('CA'), '주문테스트가게', 'stores/s1.png', true, true),
  (public.zid('S2'), public.zid('CA'), '다른가게', null, true, true),
  (public.zid('S3'), public.zid('CA'), '비활성가게', null, false, true),
  (public.zid('S4'), public.zid('CA'), '영업종료가게', null, true, false),
  (public.zid('S5'), public.zid('CB'), '비활성분류가게', null, true, false);
insert into public.menus (id, store_id, name, image_ref, base_price, is_active, is_sold_out) values
  (public.zid('M1'), public.zid('S1'), '치킨', 'menus/m1.png', 10000, true, false),
  (public.zid('M2'), public.zid('S1'), '콜라', null, 2000, true, false),
  (public.zid('M3'), public.zid('S1'), '품절메뉴', null, 3000, true, true),
  (public.zid('M4'), public.zid('S1'), '비활성메뉴', null, 3000, false, false),
  (public.zid('M6'), public.zid('S1'), '비활성그룹메뉴', null, 4000, true, false),
  (public.zid('M7'), public.zid('S1'), '비활성필수그룹메뉴', null, 4000, true, false),
  (public.zid('M12'), public.zid('S1'), '옵션많은메뉴', null, 1000, true, false),
  (public.zid('M5'), public.zid('S2'), '다른가게메뉴', null, 1000, true, false),
  (public.zid('M9'), public.zid('S3'), '비활성가게메뉴', null, 1000, true, false),
  (public.zid('M10'), public.zid('S4'), '영업종료메뉴', null, 1000, true, false),
  (public.zid('M10b'), public.zid('S4'), '영업종료품절메뉴', null, 1000, true, true),
  (public.zid('M11'), public.zid('S5'), '비활성분류메뉴', null, 1000, true, false);
-- 30종 경계용: S1의 메뉴 31개 (각 1000원)
insert into public.menus (id, store_id, name, base_price)
select public.zid('B' || g), public.zid('S1'), '대량메뉴' || g, 1000 from generate_series(1, 31) g;

insert into public.menu_option_groups (id, menu_id, name, min_select, max_select, sort_order, is_active) values
  (public.zid('G1'), public.zid('M1'), '사이즈', 1, 1, 1, true),
  (public.zid('G2'), public.zid('M1'), '추가', 0, 2, 2, true),
  (public.zid('G3'), public.zid('M6'), '비활성그룹', 0, 1, 1, false),
  (public.zid('G4'), public.zid('M7'), '비활성필수그룹', 1, 1, 1, false),
  (public.zid('GX'), public.zid('M5'), '다른메뉴그룹', 0, 1, 1, true),
  (public.zid('GM'), public.zid('M12'), '많은옵션', 0, 25, 1, true);
insert into public.menu_options (id, group_id, name, additional_price, is_active, is_sold_out, sort_order) values
  (public.zid('O1'), public.zid('G1'), '보통', 0, true, false, 1),
  (public.zid('O2'), public.zid('G1'), '큰것', 2000, true, false, 2),
  (public.zid('O3'), public.zid('G2'), '무', 500, true, false, 1),
  (public.zid('O4'), public.zid('G2'), '소스', 300, true, false, 2),
  (public.zid('O5'), public.zid('G2'), '품절옵션', 400, true, true, 3),
  (public.zid('O6'), public.zid('G2'), '비활성옵션', 100, false, false, 4),
  (public.zid('O9'), public.zid('G2'), '치즈', 700, true, false, 5),
  (public.zid('O7'), public.zid('G3'), '비활성그룹옵션', 100, true, false, 1),
  (public.zid('O8'), public.zid('G4'), '비활성필수그룹옵션', 200, true, false, 1),
  (public.zid('OX'), public.zid('GX'), '다른메뉴옵션', 100, true, false, 1);
insert into public.menu_options (id, group_id, name, additional_price, sort_order)
select public.zid('OM' || g), public.zid('GM'), '많은옵션' || g, 0, g from generate_series(1, 21) g;

-- ---------------------------------------------------------------- 구조 · 권한 (superuser)
select is((select count(*)::int from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relrowsecurity
    and relname in ('orders', 'order_items', 'order_item_options', 'order_status_updates')), 4, '주문 테이블 4개 모두 RLS 활성화');
select ok(not exists (
    select 1 from pg_class c cross join lateral aclexplode(c.relacl) a
    where c.relnamespace = 'public'::regnamespace and c.relname in ('orders')
      and a.grantee in (0, 'anon'::regrole::oid, 'authenticated'::regrole::oid)),
  'orders에는 anon/authenticated/PUBLIC 대상 테이블 단위 권한이 없다 (열 단위 SELECT만)');
select ok(has_column_privilege('authenticated', 'public.orders', 'status', 'select'), 'authenticated는 orders.status를 읽을 수 있다');
select ok(not has_column_privilege('authenticated', 'public.orders', 'request_fingerprint', 'select'), 'request_fingerprint는 앱에 열려 있지 않다');
select ok(not has_column_privilege('anon', 'public.orders', 'status', 'select'), 'anon은 orders를 읽을 수 없다');
select ok(not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name in ('orders', 'order_items', 'order_item_options', 'order_status_updates')
      and grantee in ('anon', 'authenticated', 'PUBLIC') and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')),
  '어떤 주문 테이블에도 앱 쓰기 권한이 없다');
select ok(not exists (
    select 1 from information_schema.column_privileges
    where table_schema = 'public' and table_name in ('orders', 'order_items', 'order_item_options', 'order_status_updates')
      and grantee in ('anon', 'authenticated', 'PUBLIC') and privilege_type in ('INSERT', 'UPDATE', 'REFERENCES')),
  '열 단위로도 앱 쓰기 권한이 없다');
select is((select count(*)::int from pg_policies where schemaname = 'public'
    and tablename in ('orders', 'order_items', 'order_item_options', 'order_status_updates') and cmd <> 'SELECT'), 0, '쓰기 정책이 하나도 없다');

select ok((select prosecdef from pg_proc where oid = 'public.create_order(jsonb)'::regprocedure), 'create_order는 SECURITY DEFINER');
select ok((select exists (select 1 from unnest(coalesce(proconfig, '{}')) c where c like 'search_path=%')
    from pg_proc where oid = 'public.create_order(jsonb)'::regprocedure), 'create_order의 search_path가 고정되어 있다');
select ok(not (select prosecdef from pg_proc where oid = 'public.get_my_order(uuid)'::regprocedure), 'get_my_order는 SECURITY INVOKER');
select ok(not (select prosecdef from pg_proc where oid = 'public.get_order_by_request_key(uuid)'::regprocedure), 'get_order_by_request_key는 SECURITY INVOKER');
select ok((select exists (select 1 from unnest(coalesce(proconfig, '{}')) c where c like 'search_path=%')
    from pg_proc where oid = 'public.get_my_order(uuid)'::regprocedure), 'get_my_order의 search_path가 고정되어 있다');
select ok((select exists (select 1 from unnest(coalesce(proconfig, '{}')) c where c like 'search_path=%')
    from pg_proc where oid = 'public.get_order_by_request_key(uuid)'::regprocedure), 'get_order_by_request_key의 search_path가 고정되어 있다');
select is((select proargnames from pg_proc where oid = 'public.create_order(jsonb)'::regprocedure), array['p_request'], 'create_order 인자 이름은 p_request');
select is((select proargnames from pg_proc where oid = 'public.get_order_by_request_key(uuid)'::regprocedure), array['p_idempotency_key'], '키 조회 인자 이름은 p_idempotency_key');
select ok(not exists (
    select 1 from pg_proc p where p.oid in ('public.create_order(jsonb)'::regprocedure, 'public.get_my_order(uuid)'::regprocedure,
      'public.get_order_by_request_key(uuid)'::regprocedure) and coalesce(p.proacl::text, '') ~ '(^|[{,])=X|anon='),
  '주문 함수 3개는 PUBLIC/anon에게 열려 있지 않다');
select ok((select count(*) = 3 from pg_proc p where p.oid in ('public.create_order(jsonb)'::regprocedure, 'public.get_my_order(uuid)'::regprocedure,
      'public.get_order_by_request_key(uuid)'::regprocedure) and coalesce(p.proacl::text, '') ~ 'authenticated=X'),
  '주문 함수 3개는 authenticated에게 열려 있다');
select ok(not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname in ('fail', 'json_is_uuid', 'json_is_int', 'is_supported_disclosure_version', 'order_lines',
      'order_line_options', 'normalize_order_request', 'order_request_fingerprint', 'validate_order_catalog')
      and coalesce(p.proacl::text, '') ~ '(anon|authenticated)=|(^|[{,])=X'),
  'private 주문 보조 함수는 앱에 열려 있지 않다');

-- 제약 (superuser로 직접 넣어 본다)
select ok(public.test_err($$insert into public.orders (user_id, store_id, idempotency_key, request_fingerprint, total_amount,
    store_name_snapshot, category_code_snapshot, category_name_snapshot, destination_ref, disclosure_version, disclosure_acknowledged_at)
  values ('aaaaaaaa-0000-4000-8000-000000000001', public.zid('S1'), gen_random_uuid(), repeat('a', 64), 0, 'x', 'c', 'c', gen_random_uuid(), '2026-09-30', now())$$,
  '23514'), 'total_amount 0은 거절');
select ok(public.test_err($$insert into public.orders (user_id, store_id, idempotency_key, request_fingerprint, total_amount, status, completed_at,
    store_name_snapshot, category_code_snapshot, category_name_snapshot, destination_ref, disclosure_version, disclosure_acknowledged_at)
  values ('aaaaaaaa-0000-4000-8000-000000000001', public.zid('S1'), gen_random_uuid(), repeat('a', 64), 100, 'PENDING', now(), 'x', 'c', 'c', gen_random_uuid(), '2026-09-30', now())$$,
  '23514'), 'PENDING인데 completed_at이 있으면 거절');
select ok(public.test_err($$insert into public.orders (user_id, store_id, idempotency_key, request_fingerprint, total_amount, status,
    store_name_snapshot, category_code_snapshot, category_name_snapshot, destination_ref, disclosure_version, disclosure_acknowledged_at)
  values ('aaaaaaaa-0000-4000-8000-000000000001', public.zid('S1'), gen_random_uuid(), repeat('a', 64), 100, 'DONE', 'x', 'c', 'c', gen_random_uuid(), '2026-09-30', now())$$,
  '23514'), '알 수 없는 status는 거절');
select ok(public.test_err($$insert into public.orders (user_id, store_id, idempotency_key, request_fingerprint, total_amount,
    store_name_snapshot, category_code_snapshot, category_name_snapshot, destination_ref, disclosure_version, disclosure_acknowledged_at)
  values ('aaaaaaaa-0000-4000-8000-000000000001', public.zid('S1'), gen_random_uuid(), 'zzz', 100, 'x', 'c', 'c', gen_random_uuid(), '2026-09-30', now())$$,
  '23514'), '지문 형식(64자리 hex)이 아니면 거절');
select ok(public.test_err($$insert into public.orders (user_id, store_id, idempotency_key, request_fingerprint, total_amount,
    store_name_snapshot, category_code_snapshot, category_name_snapshot, destination_ref, disclosure_version, disclosure_acknowledged_at)
  values ('aaaaaaaa-0000-4000-8000-000000000001', public.zid('S1'), gen_random_uuid(), repeat('a', 64), 9007199254740992, 'x', 'c', 'c', gen_random_uuid(), '2026-09-30', now())$$,
  '23514'), 'total_amount가 JS 안전 정수를 넘으면 거절');

-- 허용 고지 버전 함수
select is(private.is_supported_disclosure_version('2026-09-30'), true, '고지 버전 2026-09-30은 허용 목록에 있다');
select is(private.is_supported_disclosure_version('2026-01-01'), false, '목록에 없는 버전은 허용되지 않는다');
select is(private.is_supported_disclosure_version(null), false, 'null 버전은 허용되지 않는다');

-- ---------------------------------------------------------------- 정규화 · 지문 (private 함수를 직접 본다)
select is(private.order_request_fingerprint(private.normalize_order_request(public.zreq(public.zid('S1'),
    jsonb_build_array(public.zitem(public.zid('M1'), array[public.zid('O2'), public.zid('O3')], 2, 12500), public.zitem(public.zid('M2'), null, 1, 2000)),
    public.zid('K-fp1')))),
  private.order_request_fingerprint(private.normalize_order_request(public.zreq(public.zid('S1'),
    jsonb_build_array(public.zitem(public.zid('M2'), null, 1, 2000), public.zitem(public.zid('M1'), array[public.zid('O3'), public.zid('O2')], 2, 12500)),
    public.zid('K-fp2')))),
  '줄 순서 · 옵션 순서 · 요청 키가 달라도 지문은 같다');
select is(private.order_request_fingerprint(private.normalize_order_request(public.zreq(public.zid('S1'),
    jsonb_build_array(public.zitem(public.zid('M1'), array[public.zid('O2')], 1, 12000), public.zitem(public.zid('M1'), array[public.zid('O2')], 2, 12000))))),
  private.order_request_fingerprint(private.normalize_order_request(public.zreq(public.zid('S1'),
    jsonb_build_array(public.zitem(public.zid('M1'), array[public.zid('O2')], 3, 12000))))),
  '같은 조합을 나눠 보내도 합산한 요청과 지문이 같다');
select isnt(private.order_request_fingerprint(private.normalize_order_request(public.zreq(public.zid('S1'),
    jsonb_build_array(public.zitem(public.zid('M2'), null, 1, 2000))))),
  private.order_request_fingerprint(private.normalize_order_request(public.zreq(public.zid('S1'),
    jsonb_build_array(public.zitem(public.zid('M2'), null, 2, 2000))))),
  '수량이 다르면 지문이 다르다');
select isnt(private.order_request_fingerprint(private.normalize_order_request(public.zreq(public.zid('S1'),
    jsonb_build_array(public.zitem(public.zid('M2'), null, 2, 2000))))),
  private.order_request_fingerprint(private.normalize_order_request(public.zreq(public.zid('S1'),
    jsonb_build_array(public.zitem(public.zid('B1'), null, 4, 1000))))),
  '총액이 같아도 담은 메뉴가 다르면 지문이 다르다');
select isnt(private.order_request_fingerprint(private.normalize_order_request(public.zreq(public.zid('S1'),
    jsonb_build_array(public.zitem(public.zid('M2'), null, 1, 2000))))),
  private.order_request_fingerprint(private.normalize_order_request(public.zreq(public.zid('S1'),
    jsonb_build_array(public.zitem(public.zid('M2'), null, 1, 2000)), gen_random_uuid(), '2026-10-01'))),
  '고지 버전이 다르면 지문이 다르다');
select isnt(private.order_request_fingerprint(private.normalize_order_request(public.zreq(public.zid('S1'),
    jsonb_build_array(public.zitem(public.zid('M2'), null, 1, 2000))))),
  private.order_request_fingerprint(private.normalize_order_request(public.zreq(public.zid('S1'),
    jsonb_build_array(public.zitem(public.zid('M2'), null, 1, 2000)), gen_random_uuid(), '2026-09-30', public.zid('다른목적지')))),
  '목적지 참조가 다르면 지문이 다르다');
select is(private.order_request_fingerprint(private.normalize_order_request(public.zreq(public.zid('S1'),
    jsonb_build_array(public.zitem(public.zid('M2'), null, 1, 2000))))),
  private.order_request_fingerprint(private.normalize_order_request(jsonb_set(public.zreq(public.zid('S1'),
    jsonb_build_array(public.zitem(public.zid('M2'), null, 1, 2000))), '{items,0,approvedCatalogRevision}', '77'))),
  'approvedCatalogRevision은 지문에 들어가지 않는다');
select ok(private.normalize_order_request(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M2'), null, 1, 2000))))::text !~ 'requestVersion|approvedCatalogRevision',
  '정규화 결과(= 지문 입력의 재료)에 requestVersion · approvedCatalogRevision이 들어 있지 않다');
select matches(private.order_request_fingerprint(private.normalize_order_request(public.zreq(public.zid('S1'),
    jsonb_build_array(public.zitem(public.zid('M2'), null, 1, 2000))))), '^[0-9a-f]{64}$', '지문은 64자리 hex');

-- ---------------------------------------------------------------- Guest / 로그인 정보 없음
set local role anon;
select ok(public.test_err($$select public.create_order('{}'::jsonb)$$, '42501'), '[anon] create_order 실행 금지');
select ok(public.test_err($$select public.get_my_order(gen_random_uuid())$$, '42501'), '[anon] get_my_order 실행 금지');
select ok(public.test_err($$select public.get_order_by_request_key(gen_random_uuid())$$, '42501'), '[anon] get_order_by_request_key 실행 금지');
select ok(public.test_err($$select * from public.orders$$, '42501'), '[anon] orders 조회 금지');
reset role;
select set_config('request.jwt.claims', '', true);
set local role authenticated;
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M2'), null, 1, 2000)))), 'P0001:AUTH_REQUIRED',
  '[sub 없음] create_order → AUTH_REQUIRED');
select is(public.zcode('null'::jsonb), 'P0001:AUTH_REQUIRED', '[sub 없음] 잘못된 요청도 먼저 AUTH_REQUIRED (로그인 확인이 먼저)');
select ok(public.test_err($$select public.get_my_order(gen_random_uuid())$$, 'P0001', 'AUTH_REQUIRED'), '[sub 없음] get_my_order → AUTH_REQUIRED');
select ok(public.test_err($$select public.get_order_by_request_key(gen_random_uuid())$$, 'P0001', 'AUTH_REQUIRED'), '[sub 없음] 키 조회 → AUTH_REQUIRED');
reset role;

-- ---------------------------------------------------------------- 사용자 A: 형태 오류 (모두 INVALID_INPUT, DB를 건드리지 않는다)
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select is(public.zcode(null), 'P0001:INVALID_INPUT', '요청이 null');
select is(public.zcode('[]'::jsonb), 'P0001:INVALID_INPUT', '요청이 배열');
select is(public.zcode('"x"'::jsonb), 'P0001:INVALID_INPUT', '요청이 문자열');
select is(public.zcode('{}'::jsonb), 'P0001:INVALID_INPUT', '빈 객체');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M2'), null, 1, 2000))) || '{"cartId":"x"}'),
  'P0001:INVALID_INPUT', '옛 필드 cartId는 받지 않는다 (알 수 없는 키)');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M2'), null, 1, 2000))) || '{"expectedCartRevision":1}'),
  'P0001:INVALID_INPUT', '옛 필드 expectedCartRevision은 받지 않는다');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M2'), null, 1, 2000))) - k),
  'P0001:INVALID_INPUT', '필수 키 누락: ' || k)
from unnest(array['idempotencyKey', 'requestVersion', 'storeId', 'destinationRef', 'items', 'approvedTotalAmount',
                  'disclosureVersion', 'disclosureAcknowledged']) as k;
select is(public.zcode(jsonb_set(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M2'), null, 1, 2000))), array[v.path], v.val::jsonb)),
  'P0001:INVALID_INPUT', v.d)
from (values
  ('requestVersion', '1', 'requestVersion 1'),
  ('requestVersion', '3', 'requestVersion 3'),
  ('requestVersion', '"2"', 'requestVersion 문자열'),
  ('requestVersion', '2.5', 'requestVersion 소수'),
  ('requestVersion', 'null', 'requestVersion null'),
  ('requestVersion', '0', 'requestVersion 0'),
  ('requestVersion', 'true', 'requestVersion boolean'),
  ('idempotencyKey', '"abc"', 'idempotencyKey가 UUID가 아님'),
  ('idempotencyKey', '123', 'idempotencyKey가 숫자'),
  ('idempotencyKey', 'null', 'idempotencyKey null'),
  ('storeId', '"x"', 'storeId가 UUID가 아님'),
  ('storeId', '"{aaaaaaaa-0000-4000-8000-000000000001}"', 'storeId가 중괄호 형식'),
  ('destinationRef', '"x"', 'destinationRef가 UUID가 아님'),
  ('destinationRef', 'null', 'destinationRef null'),
  ('approvedTotalAmount', '0', '승인 총액 0'),
  ('approvedTotalAmount', '-5', '승인 총액 음수'),
  ('approvedTotalAmount', '1.5', '승인 총액 소수'),
  ('approvedTotalAmount', '9007199254740992', '승인 총액이 안전 정수 초과'),
  ('approvedTotalAmount', '"2000"', '승인 총액 문자열'),
  ('approvedTotalAmount', '2001', '승인 총액이 자기 항목과 맞지 않음'),
  ('disclosureVersion', '"v1"', '고지 버전 형식 오류 v1'),
  ('disclosureVersion', '"2026-9-30"', '고지 버전 형식 오류 2026-9-30'),
  ('disclosureVersion', '20260930', '고지 버전이 숫자'),
  ('disclosureVersion', 'null', '고지 버전 null'),
  ('disclosureAcknowledged', 'false', '고지 확인 false'),
  ('disclosureAcknowledged', '"true"', '고지 확인 문자열'),
  ('disclosureAcknowledged', 'null', '고지 확인 null'),
  ('items', '[]', '항목 없음'),
  ('items', '{}', '항목이 객체'),
  ('items', '"x"', '항목이 문자열'),
  ('items', '[1]', '항목 원소가 객체가 아님')
) as v(path, val, d);
select is(public.zcode(jsonb_set(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M2'), null, 1, 2000))), array['items', '0', v.path], v.val::jsonb)),
  'P0001:INVALID_INPUT', '항목: ' || v.d)
from (values
  ('quantity', '0', '수량 0'),
  ('quantity', '11', '수량 11'),
  ('quantity', '-1', '수량 음수'),
  ('quantity', '1.5', '수량 소수'),
  ('quantity', '"2"', '수량 문자열'),
  ('quantity', 'null', '수량 null'),
  ('approvedUnitPrice', '-1', '승인 단가 음수'),
  ('approvedUnitPrice', '1.5', '승인 단가 소수'),
  ('approvedUnitPrice', '"2000"', '승인 단가 문자열'),
  ('approvedCatalogRevision', '0', '승인 카탈로그 revision 0'),
  ('approvedCatalogRevision', '"1"', '승인 카탈로그 revision 문자열'),
  ('menuId', '"x"', 'menuId가 UUID가 아님'),
  ('menuId', 'null', 'menuId null'),
  ('optionIds', '"x"', 'optionIds가 문자열'),
  ('optionIds', '{}', 'optionIds가 객체'),
  ('optionIds', 'null', 'optionIds null'),
  ('optionIds', '["x"]', 'optionIds 원소가 UUID가 아님'),
  ('optionIds', '[1]', 'optionIds 원소가 숫자'),
  ('optionIds', '["a0000000-0000-4000-8000-000000000001","a0000000-0000-4000-8000-000000000001"]', 'optionIds 중복'),
  ('optionIds', '["a0000000-0000-4000-8000-00000000000a","A0000000-0000-4000-8000-00000000000A"]', 'optionIds 대소문자만 다른 중복')
) as v(path, val, d);
select is(public.zcode(jsonb_set(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M2'), null, 1, 2000))), '{items,0}',
    public.zitem(public.zid('M2'), null, 1, 2000) || '{"extra":1}')),
  'P0001:INVALID_INPUT', '항목에 알 수 없는 키');
select is(public.zcode(jsonb_set(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M2'), null, 1, 2000))), '{items,0}',
    public.zitem(public.zid('M2'), null, 1, 2000) - 'approvedCatalogRevision')),
  'P0001:INVALID_INPUT', '항목 필수 키(approvedCatalogRevision) 누락');
-- 수량 상한은 총액이 자기 항목과 맞는 요청으로 확인한다 (총액 불일치로 우연히 걸리지 않게)
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M2'), null, 11, 2000)))), 'P0001:INVALID_INPUT', '한 줄 수량 11 (총액은 맞음)');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M2'), null, 0, 2000), public.zitem(public.zid('M2'), null, 1, 2000)))),
  'P0001:INVALID_INPUT', '한 줄 수량 0 (총액은 맞음)');
-- 같은 조합인데 승인 단가가 다르면 거절 (O8)
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(
    public.zitem(public.zid('M2'), null, 1, 2000), public.zitem(public.zid('M2'), null, 1, 2100)))),
  'P0001:INVALID_INPUT', '같은 조합에 승인 단가가 다르면 INVALID_INPUT');
-- 원본 줄 수 100 / 줄당 옵션 20 경계
select is(public.zcode(public.zreq(public.zid('S1'), (select jsonb_agg(public.zitem(public.zid('M2'), null, 1, 2000)) from generate_series(1, 101)))),
  'P0001:INVALID_INPUT', '원본 줄 101개는 INVALID_INPUT');
select is(public.zcode(public.zreq(public.zid('S1'), (select jsonb_agg(public.zitem(public.zid('M2'), null, 1, 2000)) from generate_series(1, 100)))),
  'P0001:QUANTITY_LIMIT_EXCEEDED', '원본 줄 100개는 형태 검사를 통과한다 (합치면 100개라 합산 10 초과)');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M12'),
    (select array_agg(public.zid('OM' || g)) from generate_series(1, 21) g), 1, 1000)))),
  'P0001:INVALID_INPUT', '줄당 옵션 21개는 INVALID_INPUT');
reset role;
select is((select count(*)::int from public.orders), 0, '형태 오류로는 주문이 하나도 만들어지지 않았다');
select is((select count(*)::int from public.profiles where id in ('aaaaaaaa-0000-4000-8000-000000000001',
    'bbbbbbbb-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000003')), 1, '형태 오류는 프로필도 만들지 않는다 (A의 기존 프로필뿐)');

-- ---------------------------------------------------------------- 사용자 A: 정상 생성
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

-- M1: 치킨 10000 + 큰것 2000 + 무 500 + 소스 300 = 12800 × 2 = 25600, M2: 콜라 2000 × 3 = 6000 → 총 31600
select set_config('zz.r1', public.create_order(public.zreq(public.zid('S1'), jsonb_build_array(
    public.zitem(public.zid('M1'), array[public.zid('O4'), public.zid('O2'), public.zid('O3')], 2, 12800),
    public.zitem(public.zid('M2'), null, 3, 2000)), public.zid('KEY1')))::text, true);
select is((select array_agg(k order by k) from jsonb_object_keys(current_setting('zz.r1')::jsonb) k),
  array['cancelledAt', 'completedAt', 'createdAt', 'orderId', 'replayed', 'snapshot', 'status', 'statusRevision', 'totalAmount'],
  '응답 최상위 키가 앱 파서가 읽는 모양과 같다');
select is((select array_agg(k order by k) from jsonb_object_keys(current_setting('zz.r1')::jsonb -> 'snapshot') k), array['items', 'store'], 'snapshot 키는 items / store (목적지 없음)');
select is((select array_agg(k order by k) from jsonb_object_keys(current_setting('zz.r1')::jsonb -> 'snapshot' -> 'store') k),
  array['categoryName', 'id', 'imageRef', 'name'], 'snapshot.store 키');
select is((select array_agg(k order by k) from jsonb_object_keys(current_setting('zz.r1')::jsonb -> 'snapshot' -> 'items' -> 0) k),
  array['lineTotal', 'menuId', 'menuImageRef', 'menuName', 'options', 'quantity', 'unitPrice'], 'snapshot.items[] 키');
select is((select array_agg(k order by k) from jsonb_object_keys(current_setting('zz.r1')::jsonb -> 'snapshot' -> 'items' -> 0 -> 'options' -> 0) k),
  array['additionalPrice', 'groupName', 'optionName'], 'snapshot.items[].options[] 키');
select is(public.zdto_shape(current_setting('zz.r1')::jsonb, true), 'OK', '생성 응답의 키 이름과 타입이 앱 parseOrderDto와 일치 (replayed는 boolean)');
select is(public.zdto_shape(current_setting('zz.r1')::jsonb - 'replayed', true), 'top-level keys', '(도구 확인) replayed가 빠지면 생성 응답 검사에서 잡힌다');
select is(public.zdto_shape(current_setting('zz.r1')::jsonb, false), 'top-level keys', '(도구 확인) 조회 응답 검사는 replayed 키가 있으면 잡는다');
select is(current_setting('zz.r1')::jsonb ->> 'status', 'PENDING', '상태는 PENDING');
select is((current_setting('zz.r1')::jsonb ->> 'statusRevision')::int, 1, 'statusRevision 1');
select is((current_setting('zz.r1')::jsonb ->> 'totalAmount')::bigint, 31600::bigint, '총액은 서버 합산 31600');
select is(current_setting('zz.r1')::jsonb -> 'replayed', 'false'::jsonb, '처음 만들면 replayed=false');
select is(current_setting('zz.r1')::jsonb -> 'completedAt', 'null'::jsonb, 'completedAt은 null');
select is(current_setting('zz.r1')::jsonb -> 'cancelledAt', 'null'::jsonb, 'cancelledAt은 null');
select matches(current_setting('zz.r1')::jsonb ->> 'createdAt', '^\d{4}-\d{2}-\d{2}T', 'createdAt은 시각 문자열');
select is(current_setting('zz.r1')::jsonb -> 'snapshot' -> 'store',
  jsonb_build_object('id', public.zid('S1'), 'name', '주문테스트가게', 'imageRef', 'stores/s1.png', 'categoryName', '테스트분류'), '가게 Snapshot');
select is(jsonb_array_length(current_setting('zz.r1')::jsonb -> 'snapshot' -> 'items'), 2, '줄은 2개');
select is(current_setting('zz.r1')::jsonb -> 'snapshot' -> 'items' -> 0,
  jsonb_build_object('menuId', public.zid('M1'), 'menuName', '치킨', 'menuImageRef', 'menus/m1.png', 'unitPrice', 12800, 'quantity', 2, 'lineTotal', 25600,
    'options', jsonb_build_array(
      jsonb_build_object('groupName', '사이즈', 'optionName', '큰것', 'additionalPrice', 2000),
      jsonb_build_object('groupName', '추가', 'optionName', '무', 'additionalPrice', 500),
      jsonb_build_object('groupName', '추가', 'optionName', '소스', 'additionalPrice', 300))),
  '첫 줄: 요청 순서 유지, 옵션은 그룹 순서 → 옵션 순서로 (요청의 옵션 순서와 무관)');
select is(current_setting('zz.r1')::jsonb -> 'snapshot' -> 'items' -> 1,
  jsonb_build_object('menuId', public.zid('M2'), 'menuName', '콜라', 'menuImageRef', null, 'unitPrice', 2000, 'quantity', 3, 'lineTotal', 6000, 'options', '[]'::jsonb),
  '둘째 줄: 옵션 없음');

reset role;
select is((select count(*)::int from public.orders), 1, 'orders 1행');
select is((select count(*)::int from public.order_items), 2, 'order_items 2행');
select is((select count(*)::int from public.order_item_options), 3, 'order_item_options 3행');
select is((select count(*)::int from public.order_status_updates), 1, '초기 상태 이력 1행');
select is((select row(revision, from_status, to_status, viewed_at is null, operation_id)::text from public.order_status_updates),
  row(1::bigint, null::text, 'PENDING'::text, true, public.zid('KEY1'))::text, '초기 이력: revision 1, NULL → PENDING, 미확인, operation_id=생성 키');
select is((select user_id from public.orders), 'aaaaaaaa-0000-4000-8000-000000000001'::uuid, '주문은 로그인한 사용자 소유');
select is((select idempotency_key from public.orders), public.zid('KEY1'), '멱등성 키 저장');
select is((select destination_ref from public.orders), '0de57000-0000-4000-8000-000000000001'::uuid, '목적지 참조 저장 (불투명 UUID)');
select is((select disclosure_version from public.orders), '2026-09-30', '고지 버전 저장');
select ok((select disclosure_acknowledged_at is not null from public.orders), '고지 확인 시각 저장');
select is((select total_amount from public.orders), (select sum(line_total)::bigint from public.order_items), '주문 총액 = 줄 합계의 합');
select is((select category_code_snapshot || '/' || category_name_snapshot from public.orders), 'zz-ord-a/테스트분류', '분류 Snapshot');
select is((select array_agg(line_no order by line_no) from public.order_items), array[1, 2], 'line_no는 요청에 처음 나온 순서');
select is((select (base_price_snapshot, option_total_snapshot, unit_price)::text from public.order_items where line_no = 1), '(10000,2800,12800)', '줄 1: 기본가 / 옵션합 / 단가');
select matches((select request_fingerprint from public.orders), '^[0-9a-f]{64}$', '지문 저장');
select is((select name from public.profiles where id = 'aaaaaaaa-0000-4000-8000-000000000001'), null, 'A의 name은 건드리지 않는다');
select is((select nickname from public.profiles where id = 'aaaaaaaa-0000-4000-8000-000000000001'), '기존닉네임', '기존 프로필(닉네임)은 그대로 — 프로필 보장은 덮어쓰지 않는다');

-- ---------------------------------------------------------------- 멱등성
set local role authenticated;
select set_config('zz.r1b', public.create_order(public.zreq(public.zid('S1'), jsonb_build_array(
    public.zitem(public.zid('M2'), null, 3, 2000),
    public.zitem(public.zid('M1'), array[public.zid('O3'), public.zid('O2'), public.zid('O4')], 2, 12800)), public.zid('KEY1')))::text, true);
select is(current_setting('zz.r1b')::jsonb ->> 'orderId', current_setting('zz.r1')::jsonb ->> 'orderId',
  '같은 키 · 같은 요청(줄 순서와 옵션 순서만 다름)은 같은 주문을 돌려준다');
select is(current_setting('zz.r1b')::jsonb -> 'replayed', 'true'::jsonb, '다시 받은 주문은 replayed=true');
select is(public.zdto_shape(current_setting('zz.r1b')::jsonb, true), 'OK', '재생 응답도 같은 키 이름과 타입');
select is(current_setting('zz.r1b')::jsonb - 'replayed', current_setting('zz.r1')::jsonb - 'replayed', 'replayed 외 내용이 처음 응답과 같다 (줄 순서도 처음 그대로)');
select is(public.zcode(jsonb_set(public.zreq(public.zid('S1'), jsonb_build_array(
    public.zitem(public.zid('M1'), array[public.zid('O4'), public.zid('O2'), public.zid('O3')], 2, 12800),
    public.zitem(public.zid('M2'), null, 3, 2000)), public.zid('KEY1')), '{items,0,approvedCatalogRevision}', '99')), 'OK',
  'approvedCatalogRevision이 달라도 같은 요청으로 본다');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(
    public.zitem(public.zid('M1'), array[public.zid('O4'), public.zid('O2'), public.zid('O3')], 2, 12800),
    public.zitem(public.zid('M2'), null, 4, 2000)), public.zid('KEY1'))), 'P0001:IDEMPOTENCY_CONFLICT', '같은 키 · 다른 수량 → IDEMPOTENCY_CONFLICT');
select is(public.zcode(public.zreq(public.zid('S2'), jsonb_build_array(public.zitem(public.zid('M5'), null, 1, 1000)), public.zid('KEY1'))),
  'P0001:IDEMPOTENCY_CONFLICT', '같은 키 · 다른 가게 → IDEMPOTENCY_CONFLICT');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(
    public.zitem(public.zid('M1'), array[public.zid('O4'), public.zid('O2'), public.zid('O3')], 2, 12800),
    public.zitem(public.zid('M2'), null, 3, 2000)), public.zid('KEY1'), '2026-09-30', public.zid('다른목적지'))),
  'P0001:IDEMPOTENCY_CONFLICT', '같은 키 · 다른 목적지 → IDEMPOTENCY_CONFLICT');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(
    public.zitem(public.zid('M1'), array[public.zid('O4'), public.zid('O2'), public.zid('O3')], 2, 12800),
    public.zitem(public.zid('M2'), null, 3, 2000)), public.zid('KEY1'), '2026-10-01')),
  'P0001:IDEMPOTENCY_CONFLICT', '같은 키 · 다른 고지 버전 → 고지 검사보다 먼저 IDEMPOTENCY_CONFLICT');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(
    public.zitem(public.zid('M1'), array[public.zid('O4'), public.zid('O2'), public.zid('O3')], 2, 12800),
    public.zitem(public.zid('M2'), null, 3, 2000)), public.zid('KEY1'), '2026-09-30')) , 'OK', '충돌 시도 뒤에도 원래 요청은 계속 재생된다');
select ok(public.test_err($$select public.create_order(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M2'), null, 4, 2000)), public.zid('KEY1')))$$,
  'P0001', 'IDEMPOTENCY_CONFLICT'), '충돌 오류의 메시지는 코드뿐이다');
reset role;
select is((select count(*)::int from public.orders), 1, '재시도 · 충돌 뒤에도 주문은 1개');
select is((select count(*)::int from public.order_status_updates), 1, '재시도 · 충돌은 상태 이력을 늘리지 않는다');

-- 카탈로그가 바뀐 뒤에도 같은 요청 복구는 기존 주문을 돌려준다 (가격 · 품절 · 영업 종료 · 이름 변경)
update public.menus set base_price = 11000 where id = public.zid('M1');
update public.menus set is_sold_out = true where id = public.zid('M2');
update public.menu_options set additional_price = 2500 where id = public.zid('O2');
update public.stores set is_open = false, name = '이름이바뀐가게' where id = public.zid('S1');
set local role authenticated;
select set_config('zz.r1c', public.create_order(public.zreq(public.zid('S1'), jsonb_build_array(
    public.zitem(public.zid('M1'), array[public.zid('O4'), public.zid('O2'), public.zid('O3')], 2, 12800),
    public.zitem(public.zid('M2'), null, 3, 2000)), public.zid('KEY1')))::text, true);
select is(current_setting('zz.r1c')::jsonb - 'replayed', current_setting('zz.r1')::jsonb - 'replayed',
  '가격 · 품절 · 영업 종료 · 가게 이름이 바뀐 뒤에도 같은 요청은 처음 주문을 그대로 돌려준다 (Snapshot 불변)');
select is(public.get_my_order((current_setting('zz.r1')::jsonb ->> 'orderId')::uuid), current_setting('zz.r1')::jsonb - 'replayed',
  'get_my_order도 변경 전 Snapshot 그대로');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M1'), array[public.zid('O1')], 1, 10000)))),
  'P0001:STORE_CLOSED', '새 키로 같은 가게를 주문하면 이제 영업 종료로 거절된다 (복구와 새 주문의 차이)');
reset role;
update public.menus set base_price = 10000 where id = public.zid('M1');
update public.menus set is_sold_out = false where id = public.zid('M2');
update public.menu_options set additional_price = 2000 where id = public.zid('O2');
update public.stores set is_open = true, name = '주문테스트가게' where id = public.zid('S1');

-- 허용 목록에서 빠진 고지 버전으로 이미 만들어진 주문: 같은 요청 복구는 된다, 새 키는 거절된다
insert into public.orders (user_id, store_id, idempotency_key, request_fingerprint, total_amount,
  store_name_snapshot, category_code_snapshot, category_name_snapshot, destination_ref, disclosure_version, disclosure_acknowledged_at)
values ('aaaaaaaa-0000-4000-8000-000000000001', public.zid('S1'), public.zid('KEYOLD'),
  private.order_request_fingerprint(private.normalize_order_request(public.zreq(public.zid('S1'),
    jsonb_build_array(public.zitem(public.zid('M2'), null, 1, 2000)), public.zid('KEYOLD'), '2025-01-01'))),
  2000, '주문테스트가게', 'zz-ord-a', '테스트분류', '0de57000-0000-4000-8000-000000000001', '2025-01-01', now());
set local role authenticated;
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M2'), null, 1, 2000)), public.zid('KEYOLD'), '2025-01-01')),
  'OK', '허용 목록에 없는 옛 고지 버전이어도 같은 요청 복구는 된다 (멱등성 먼저)');
select is(public.create_order(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M2'), null, 1, 2000)), public.zid('KEYOLD'), '2025-01-01'))
    -> 'replayed', 'true'::jsonb, '옛 버전 복구는 replayed=true');
select is(public.zdto_shape(public.create_order(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M2'), null, 1, 2000)),
    public.zid('KEYOLD'), '2025-01-01')), true), 'OK', '줄이 하나도 없는 주문(items: [])도 같은 모양');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M2'), null, 1, 2000)), public.zid('KEYOLD'), '2026-01-01')),
  'P0001:IDEMPOTENCY_CONFLICT', '같은 키에 다른 고지 버전은 충돌');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M2'), null, 1, 2000)), gen_random_uuid(), '2025-01-01')),
  'P0001:DISCLOSURE_VERSION_UNSUPPORTED', '새 키로 옛 고지 버전을 보내면 DISCLOSURE_VERSION_UNSUPPORTED');
reset role;
select is((select count(*)::int from public.orders), 2, '(준비) 주문 2개: KEY1, KEYOLD');

-- ---------------------------------------------------------------- 오류 우선순위 · 단계별 검사 (사용자 A)
set local role authenticated;
-- 고지 → 합산 10
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M2'), null, 6, 2000), public.zitem(public.zid('M2'), null, 6, 2000)),
    gen_random_uuid(), '2026-01-01')), 'P0001:DISCLOSURE_VERSION_UNSUPPORTED', '고지 미허용 + 합산 12 → 고지가 먼저');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M2'), null, 1, 2000)), gen_random_uuid(), '2026-01-01')),
  'P0001:DISCLOSURE_VERSION_UNSUPPORTED', '형식이 맞는 미허용 고지 버전 → DISCLOSURE_VERSION_UNSUPPORTED');
-- 합산 10
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M2'), null, 10, 2000)))), 'OK', '수량 10은 허용');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M2'), null, 4, 2000), public.zitem(public.zid('M2'), null, 6, 2000)))),
  'OK', '같은 조합 4 + 6 = 10은 허용');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M2'), null, 5, 2000), public.zitem(public.zid('M2'), null, 6, 2000)))),
  'P0001:QUANTITY_LIMIT_EXCEEDED', '같은 조합 5 + 6 = 11 → 요청 전체 거절');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(
    public.zitem(public.zid('M1'), array[public.zid('O1')], 5, 10000), public.zitem(public.zid('M1'), array[public.zid('O1')], 5, 10000),
    public.zitem(public.zid('M1'), array[public.zid('O1')], 1, 10000)))), 'P0001:QUANTITY_LIMIT_EXCEEDED', '세 줄 합산 11 → 거절');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M2'), null, 5, 2000),
    public.zitem(public.zid('M1'), array[public.zid('O1')], 6, 10000), public.zitem(public.zid('M2'), null, 5, 2000)))), 'OK',
  '조합이 다르면 합산하지 않는다 (M2 5+5=10, M1 6)');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(
    public.zitem(public.zid('M1'), array[public.zid('O1'), public.zid('O3')], 6, 10500), public.zitem(public.zid('M1'), array[public.zid('O1')], 6, 10000)))), 'OK',
  '옵션이 다른 같은 메뉴는 다른 조합');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(
    public.zitem(public.zid('M1'), array[public.zid('O3'), public.zid('O1')], 6, 10500), public.zitem(public.zid('M1'), array[public.zid('O1'), public.zid('O3')], 5, 10500)))),
  'P0001:QUANTITY_LIMIT_EXCEEDED', '옵션 선택 순서가 달라도 같은 조합으로 합산 → 11 거절');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M2'), null, 5, 2000), public.zitem(public.zid('M2'), null, 6, 2000),
    public.zitem(public.zid('NOPE'), null, 1, 1000)))), 'P0001:QUANTITY_LIMIT_EXCEEDED', '합산 11 + 없는 메뉴 → 합산이 먼저');
-- 조합 30종 (O2: INVALID_INPUT)
select is(public.zcode(public.zreq(public.zid('S1'), (select jsonb_agg(public.zitem(public.zid('B' || g), null, 1, 1000)) from generate_series(1, 30) g))),
  'OK', '서로 다른 조합 30종은 허용');
select is(public.zcode(public.zreq(public.zid('S1'), (select jsonb_agg(public.zitem(public.zid('B' || g), null, 1, 1000)) from generate_series(1, 31) g))),
  'P0001:INVALID_INPUT', '서로 다른 조합 31종 → INVALID_INPUT');
select is(public.zcode(public.zreq(public.zid('S1'), (select jsonb_agg(public.zitem(public.zid('B' || g), null, 1, 1000)) from generate_series(1, 29) g)
    || jsonb_build_array(public.zitem(public.zid('M3'), null, 1, 3000)))), 'P0001:ITEM_UNAVAILABLE', '29종 + 품절 메뉴 → 품절 검사까지 간다');
select is(public.zcode(public.zreq(public.zid('S1'), (select jsonb_agg(public.zitem(public.zid('B' || g), null, 1, 1000)) from generate_series(1, 30) g)
    || jsonb_build_array(public.zitem(public.zid('M3'), null, 1, 3000)))), 'P0001:INVALID_INPUT', '30종 + 품절 메뉴(31종) → 종류 수 검사가 먼저');
select is(public.zcode(public.zreq(public.zid('S1'), (select jsonb_agg(public.zitem(public.zid('B' || g), null, 1, 1000)) from generate_series(1, 31) g), public.zid('KEY1'))),
  'P0001:IDEMPOTENCY_CONFLICT', '31종이어도 이미 있는 키면 멱등성 검사가 먼저 (충돌)');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M12'),
    (select array_agg(public.zid('OM' || g)) from generate_series(1, 20) g), 1, 1000)))), 'OK', '줄당 옵션 20개는 허용');

-- 존재 · 소속
select is(public.zcode(public.zreq(public.zid('NOPE'), jsonb_build_array(public.zitem(public.zid('M2'), null, 1, 2000)))), 'P0001:INVALID_INPUT', '없는 가게');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('NOPE'), null, 1, 2000)))), 'P0001:INVALID_INPUT', '없는 메뉴');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M5'), null, 1, 1000)))), 'P0001:INVALID_INPUT', '다른 가게의 메뉴');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M2'), null, 1, 2000), public.zitem(public.zid('M5'), null, 1, 1000)))),
  'P0001:INVALID_INPUT', '정상 메뉴 + 다른 가게의 메뉴가 섞여도 거절');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M2'), array[public.zid('NOPE')], 1, 2000)))), 'P0001:INVALID_INPUT', '없는 옵션');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M2'), array[public.zid('O1')], 1, 2000)))), 'P0001:INVALID_INPUT',
  '다른 메뉴(M1)의 옵션을 M2 줄에 붙임');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M1'), array[public.zid('O1'), public.zid('OX')], 1, 10100)))), 'P0001:INVALID_INPUT',
  '다른 가게 메뉴의 옵션을 붙임');
select is(public.zcode(public.zreq(public.zid('S3'), jsonb_build_array(public.zitem(public.zid('M5'), null, 1, 1000)))), 'P0001:INVALID_INPUT',
  '비활성 가게 + 그 가게 것이 아닌 메뉴 → 존재 · 소속이 먼저');
-- 가게 · 분류 비활성 → 영업 종료 → 품절
select is(public.zcode(public.zreq(public.zid('S3'), jsonb_build_array(public.zitem(public.zid('M9'), null, 1, 1000)))), 'P0001:ITEM_UNAVAILABLE', '비활성 가게');
select is(public.zcode(public.zreq(public.zid('S5'), jsonb_build_array(public.zitem(public.zid('M11'), null, 1, 1000)))), 'P0001:ITEM_UNAVAILABLE',
  '비활성 분류의 가게 (영업 종료이기도 하지만 비활성이 먼저)');
select is(public.zcode(public.zreq(public.zid('S4'), jsonb_build_array(public.zitem(public.zid('M10'), null, 1, 1000)))), 'P0001:STORE_CLOSED', '영업 종료');
select is(public.zcode(public.zreq(public.zid('S4'), jsonb_build_array(public.zitem(public.zid('M10b'), null, 1, 1000)))), 'P0001:STORE_CLOSED',
  '영업 종료 + 품절 메뉴 → 영업 종료가 먼저');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M3'), null, 1, 3000)))), 'P0001:ITEM_UNAVAILABLE', '품절 메뉴');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M4'), null, 1, 3000)))), 'P0001:ITEM_UNAVAILABLE', '비활성 메뉴');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M1'), array[public.zid('O1'), public.zid('O5')], 1, 10400)))),
  'P0001:ITEM_UNAVAILABLE', '품절 옵션');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M1'), array[public.zid('O1'), public.zid('O6')], 1, 10100)))),
  'P0001:ITEM_UNAVAILABLE', '비활성 옵션');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M6'), array[public.zid('O7')], 1, 4100)))),
  'P0001:ITEM_UNAVAILABLE', '비활성 그룹의 옵션');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M3'), null, 1, 3000), public.zitem(public.zid('M1'), null, 1, 10000)))),
  'P0001:ITEM_UNAVAILABLE', '품절 메뉴 + 필수 옵션 누락 → 품절이 먼저');
-- 선택 규칙
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M1'), null, 1, 10000)))), 'P0001:INVALID_OPTIONS', '필수 그룹 선택 누락');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M1'), array[public.zid('O3')], 1, 10500)))), 'P0001:INVALID_OPTIONS',
  '필수 그룹(사이즈) 없이 추가 옵션만');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M1'), array[public.zid('O1'), public.zid('O2')], 1, 12000)))), 'P0001:INVALID_OPTIONS',
  '단일 선택 그룹에 2개');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M1'), array[public.zid('O1'), public.zid('O3'), public.zid('O4'), public.zid('O9')], 1, 11500)))),
  'P0001:INVALID_OPTIONS', '최대 2개 그룹에 3개');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M1'), null, 1, 9999)))), 'P0001:INVALID_OPTIONS',
  '필수 옵션 누락 + 승인 단가 불일치 → 선택 규칙이 먼저');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M1'), array[public.zid('O1')], 1, 10000)))), 'OK', '최소 선택 충족');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M1'), array[public.zid('O1'), public.zid('O3'), public.zid('O4')], 1, 10800)))), 'OK',
  '최대 선택 충족 (추가 2개)');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M6'), null, 1, 4000)))), 'OK', '비활성 그룹이 있는 메뉴도 그 그룹을 안 고르면 주문 가능');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M7'), null, 1, 4000)))), 'OK',
  '비활성 그룹은 필수여도 선택 규칙에서 제외된다');
-- 가격
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M1'), array[public.zid('O1')], 1, 10001)))), 'P0001:PRICE_CHANGED', '승인 단가가 더 높음');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M1'), array[public.zid('O1')], 1, 9999)))), 'P0001:PRICE_CHANGED', '승인 단가가 더 낮음');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M1'), array[public.zid('O2')], 1, 10000)))), 'P0001:PRICE_CHANGED',
  '옵션 추가금을 빼먹은 단가');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M2'), null, 1, 2000), public.zitem(public.zid('M1'), array[public.zid('O1')], 1, 9000)))),
  'P0001:PRICE_CHANGED', '여러 줄 중 한 줄만 달라도 거절');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M2'), null, 1, 2100), public.zitem(public.zid('B1'), null, 1, 900)))),
  'P0001:PRICE_CHANGED', '승인 총액(3000)은 서버 합계와 같아도 줄별 단가가 서로 상쇄되게 틀리면 거절');
reset role;
update public.menus set base_price = 2500 where id = public.zid('M2');
set local role authenticated;
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M2'), null, 1, 2000)))), 'P0001:PRICE_CHANGED', '기본가가 바뀐 뒤 옛 단가로 새 주문 → PRICE_CHANGED');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M2'), null, 1, 2500)))), 'OK', '바뀐 단가로는 주문된다');
reset role;
update public.menus set base_price = 2000 where id = public.zid('M2');

-- 거절된 요청은 아무것도 남기지 않는다 (위 성공 주문들은 제외하고 센다)
select is((select count(*)::int from public.orders where store_id in (public.zid('S3'), public.zid('S4'), public.zid('S5'), public.zid('S2'))), 0,
  '거절된 요청들 뒤에 다른 가게(S2~S5) 주문은 없다');
select is((select count(*)::int from public.order_items i where not exists (select 1 from public.orders o where o.id = i.order_id)), 0, '고아 줄이 없다');
select is((select count(*)::int from public.orders o where o.total_amount <> (select sum(line_total) from public.order_items i where i.order_id = o.id)
    and exists (select 1 from public.order_items i where i.order_id = o.id)), 0, '모든 주문의 총액 = 줄 합계의 합');
select is((select count(*)::int from public.orders o where not exists (select 1 from public.order_status_updates u where u.order_id = o.id and u.revision = 1)), 1,
  '모든 주문에 초기 이력이 있다 (직접 넣은 KEYOLD 한 건만 예외)');

-- ---------------------------------------------------------------- 합산 · 정규화 결과 (저장된 모양)
set local role authenticated;
select set_config('zz.m', public.create_order(public.zreq(public.zid('S1'), jsonb_build_array(
    public.zitem(public.zid('M1'), array[public.zid('O3'), public.zid('O2')], 2, 12500),
    public.zitem(public.zid('M2'), null, 1, 2000),
    public.zitem(public.zid('M1'), array[public.zid('O2'), public.zid('O3')], 3, 12500)), public.zid('KEYM')))::text, true);
select is(jsonb_array_length(current_setting('zz.m')::jsonb -> 'snapshot' -> 'items'), 2, '같은 조합 두 줄(옵션 순서만 다름)이 한 줄로 합쳐진다');
select is((current_setting('zz.m')::jsonb -> 'snapshot' -> 'items' -> 0 ->> 'quantity')::int, 5, '합산 수량 2 + 3 = 5');
select is(current_setting('zz.m')::jsonb -> 'snapshot' -> 'items' -> 0 ->> 'menuName', '치킨', '합친 줄은 처음 나온 위치에 있다');
select is((current_setting('zz.m')::jsonb ->> 'totalAmount')::bigint, 64500::bigint, '총액 = 12500 × 5 + 2000');
select is(public.zcode(jsonb_set(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M2'), null, 1, 2000))),
    '{storeId}', to_jsonb(upper(public.zid('S1')::text)))), 'OK', '대문자 UUID도 받아서 소문자로 정규화한다');
-- 총액이 같아도 내용이 다르면 같은 키 재사용은 충돌 (지문에 줄이 들어 있다)
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M2'), null, 5, 2000)), public.zid('KEYX'))), 'OK', '(준비) KEYX로 콜라 5개 = 10000원');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('B1'), null, 10, 1000)), public.zid('KEYX'))),
  'P0001:IDEMPOTENCY_CONFLICT', '같은 키 · 총액은 같지만(10000원) 다른 메뉴 → IDEMPOTENCY_CONFLICT');
reset role;
select is((select count(*)::int from public.order_items where order_id = (current_setting('zz.m')::jsonb ->> 'orderId')::uuid), 2, 'DB에도 2줄로 저장된다');
select is((select array_agg(option_name_snapshot order by sort_order) from public.order_item_options o
    join public.order_items i on i.id = o.order_item_id where i.order_id = (current_setting('zz.m')::jsonb ->> 'orderId')::uuid and i.line_no = 1),
  array['큰것', '무'], '옵션 Snapshot 순서 (그룹 → 옵션)');

-- ---------------------------------------------------------------- O11: 프로필이 없던 사용자 (B)
select is((select count(*)::int from public.profiles where id = 'bbbbbbbb-0000-4000-8000-000000000002'), 0, '(준비) B는 프로필 행이 없다');
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is(public.zcode(null), 'P0001:INVALID_INPUT', '[B] 형태 오류');
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M2'), null, 1, 1999)))), 'P0001:PRICE_CHANGED', '[B] 가격 오류 (프로필 보장 이후에 걸리는 오류)');
select is(public.zcode(public.zreq(public.zid('S4'), jsonb_build_array(public.zitem(public.zid('M10'), null, 1, 1000)))), 'P0001:STORE_CLOSED', '[B] 영업 종료');
reset role;
select is((select count(*)::int from public.profiles where id = 'bbbbbbbb-0000-4000-8000-000000000002'), 0,
  '거절된 요청은 프로필 보장도 되돌린다 (프로필이 만들어지지 않았다)');
set local role authenticated;
select set_config('zz.b1', public.create_order(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M2'), null, 2, 2000)), public.zid('KEY1')))::text, true);
select is(current_setting('zz.b1')::jsonb ->> 'status', 'PENDING', '[B] 프로필 없이 시작한 사용자도 첫 주문이 만들어진다');
select isnt(current_setting('zz.b1')::jsonb ->> 'orderId', current_setting('zz.r1')::jsonb ->> 'orderId', '[B] A와 같은 키를 써도 B의 주문은 따로다 (키는 사용자별)');
select is(current_setting('zz.b1')::jsonb -> 'replayed', 'false'::jsonb, '[B] A의 키와 같아도 replayed가 아니다');
reset role;
select is((select count(*)::int from public.profiles where id = 'bbbbbbbb-0000-4000-8000-000000000002'), 1, '[B] 프로필 행이 이제 있다');
select is((select (name is null and nickname is null)::text from public.profiles where id = 'bbbbbbbb-0000-4000-8000-000000000002'), 'true',
  '[B] 보장된 프로필은 (id)만 있다: name · nickname 없음');
select is((select user_id from public.orders where id = (current_setting('zz.b1')::jsonb ->> 'orderId')::uuid), 'bbbbbbbb-0000-4000-8000-000000000002'::uuid, '[B] 주문의 소유자');
set local role authenticated;
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M2'), null, 1, 2000)))), 'OK', '[B] 프로필이 이미 있어도 두 번째 주문이 된다');
reset role;
select is((select count(*)::int from public.profiles where id = 'bbbbbbbb-0000-4000-8000-000000000002'), 1, '[B] 프로필은 여전히 1행');

-- ---------------------------------------------------------------- 조회 함수 · 권한 격리
select set_config('zz.na', (select count(*) from public.orders where user_id = 'aaaaaaaa-0000-4000-8000-000000000001')::text, true);
select set_config('zz.nb', (select count(*) from public.orders where user_id = 'bbbbbbbb-0000-4000-8000-000000000002')::text, true);
select ok((select count(*) from public.orders) > current_setting('zz.na')::int and current_setting('zz.nb')::int = 2, '(준비) 전체 주문이 A의 주문보다 많고 B는 2개');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(public.get_order_by_request_key(public.zid('KEY1')), current_setting('zz.r1')::jsonb - 'replayed', '[A] 키로 조회하면 주문이 나온다 (replayed 키 없음)');
select is(public.get_my_order((current_setting('zz.r1')::jsonb ->> 'orderId')::uuid), current_setting('zz.r1')::jsonb - 'replayed', '[A] get_my_order로 같은 주문');
select is(public.zdto_shape(public.get_order_by_request_key(public.zid('KEY1')), false), 'OK', '[A] 키 조회 응답: 키 이름과 타입 일치, replayed 키 없음');
select is(public.zdto_shape(public.get_my_order((current_setting('zz.r1')::jsonb ->> 'orderId')::uuid), false), 'OK', '[A] get_my_order 응답: 키 이름과 타입 일치, replayed 키 없음');
select is(public.zdto_shape(public.get_order_by_request_key(public.zid('KEYM')), false), 'OK', '[A] 합산된 주문의 조회 응답도 같은 모양');
select ok(public.get_order_by_request_key(gen_random_uuid()) is null, '[A] 없는 키는 오류가 아니라 null');
select ok(public.get_order_by_request_key(public.zid('KEY1')) is not null and not (public.get_order_by_request_key(public.zid('KEY1')) ? 'replayed'),
  '[A] 조회 결과에는 replayed 키가 없다');
select ok(public.test_err($$select public.get_order_by_request_key(null)$$, 'P0001', 'INVALID_INPUT'), '[A] 키가 null이면 INVALID_INPUT');
select ok(public.test_err($$select public.get_my_order(null)$$, 'P0001', 'INVALID_INPUT'), '[A] 주문 ID가 null이면 INVALID_INPUT');
select ok(public.test_err($$select public.get_my_order(gen_random_uuid())$$, 'P0001', 'RESOURCE_NOT_FOUND'), '[A] 없는 주문 → RESOURCE_NOT_FOUND');
select ok(public.test_err(format('select public.get_my_order(%L)', current_setting('zz.b1')::jsonb ->> 'orderId'), 'P0001', 'RESOURCE_NOT_FOUND'),
  '[A] 남의 주문 → RESOURCE_NOT_FOUND (없는 주문과 구별되지 않는다)');
select is((select count(*)::text from public.orders), current_setting('zz.na'), '[A] 보이는 주문은 본인 것뿐 (B의 주문은 보이지 않는다)');

select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);
select ok(public.get_order_by_request_key(public.zid('KEYOLD')) is null, '[B] 남의 키(KEYOLD)는 null — 없는 키와 구별되지 않는다');
select is(public.get_order_by_request_key(public.zid('KEY1')) ->> 'orderId', current_setting('zz.b1')::jsonb ->> 'orderId', '[B] 같은 키 값이어도 B 자신의 주문이 나온다');
select ok(public.test_err(format('select public.get_my_order(%L)', current_setting('zz.r1')::jsonb ->> 'orderId'), 'P0001', 'RESOURCE_NOT_FOUND'), '[B] A의 주문 → RESOURCE_NOT_FOUND');
select is((select count(*)::text from public.orders), current_setting('zz.nb'), '[B] orders는 본인 2개만 보인다');
select is((select count(*)::int from public.order_items where order_id = (current_setting('zz.r1')::jsonb ->> 'orderId')::uuid), 0, '[B] A 주문의 줄은 보이지 않는다');
select is((select count(*)::int from public.order_item_options o join public.order_items i on i.id = o.order_item_id), 0, '[B] 옵션 Snapshot은 본인 것(옵션 없음)뿐');
select is((select count(*)::text from public.order_status_updates), current_setting('zz.nb'), '[B] 상태 이력은 본인 주문 것뿐');
select ok(public.test_err($$select request_fingerprint from public.orders$$, '42501'), '[B] 지문 열은 읽을 수 없다');
select ok(public.test_err($$select * from public.orders$$, '42501'), '[B] select * 도 지문 때문에 거부된다 (열을 지정해서 읽어야 한다)');
select ok(public.test_err($$update public.orders set status = 'CANCELLED'$$, '42501'), '[B] orders 직접 UPDATE 금지');
select ok(public.test_err($$delete from public.orders$$, '42501'), '[B] orders 직접 DELETE 금지');
select ok(public.test_err($$insert into public.orders (user_id, store_id, idempotency_key, request_fingerprint, total_amount, store_name_snapshot,
    category_code_snapshot, category_name_snapshot, destination_ref, disclosure_version, disclosure_acknowledged_at)
  values ('bbbbbbbb-0000-4000-8000-000000000002', public.zid('S1'), gen_random_uuid(), repeat('a', 64), 1, 'x', 'c', 'c', gen_random_uuid(), '2026-09-30', now())$$, '42501'),
  '[B] orders 직접 INSERT 금지');
select ok(public.test_err($$insert into public.order_items (order_id, store_id, menu_id, line_no, menu_name_snapshot, base_price_snapshot, option_total_snapshot, unit_price, quantity, line_total)
  select id, store_id, public.zid('M2'), 9, 'x', 1, 0, 1, 1, 1 from public.orders$$, '42501'), '[B] order_items 직접 INSERT 금지');
select ok(public.test_err($$update public.order_items set quantity = 1$$, '42501'), '[B] order_items 직접 UPDATE 금지');
select ok(public.test_err($$delete from public.order_item_options$$, '42501'), '[B] order_item_options 직접 DELETE 금지');
select ok(public.test_err($$insert into public.order_status_updates (order_id, revision, operation_id, to_status)
  select id, 99, gen_random_uuid(), 'CANCELLED' from public.orders$$, '42501'), '[B] order_status_updates 직접 INSERT 금지');
select ok(public.test_err($$update public.order_status_updates set viewed_at = now()$$, '42501'), '[B] order_status_updates 직접 UPDATE 금지');
select ok(public.test_err($$select private.validate_order_catalog(public.zid('S1'), '[]'::jsonb, 1)$$, '42501'), '[B] private 검증 코어를 직접 부를 수 없다');
select ok(public.test_err($$select private.normalize_order_request('{}'::jsonb)$$, '42501'), '[B] private 정규화 함수를 직접 부를 수 없다');
reset role;

-- ---------------------------------------------------------------- 롤백: 저장 중 오류가 나면 아무것도 남지 않는다
create function public.zz_boom() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$;
create trigger zz_boom before insert on public.order_item_options for each row execute function public.zz_boom();
select set_config('zz.cnt', (select (select count(*) from public.orders) || ',' || (select count(*) from public.order_items) || ',' ||
  (select count(*) from public.order_item_options) || ',' || (select count(*) from public.order_status_updates)), true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M2'), null, 1, 2000),
    public.zitem(public.zid('M1'), array[public.zid('O2')], 1, 12000)))), 'P0001:boom', '옵션 저장 중 오류를 일으키면 요청이 실패한다');
reset role;
select is((select (select count(*) from public.orders) || ',' || (select count(*) from public.order_items) || ',' ||
  (select count(*) from public.order_item_options) || ',' || (select count(*) from public.order_status_updates)), current_setting('zz.cnt'),
  '실패하면 주문 · 줄 · 옵션 · 이력이 하나도 남지 않는다 (앞서 저장된 줄도 되돌려진다)');
drop trigger zz_boom on public.order_item_options;
set local role authenticated;
select is(public.zcode(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('M2'), null, 1, 2000),
    public.zitem(public.zid('M1'), array[public.zid('O2')], 1, 12000)))), 'OK', '(확인) 트리거를 치우면 같은 요청이 성공한다');
reset role;

-- 완료 · 취소된 주문의 시각 필드도 문자열로 나온다 (confirm_order · cancel_order로 실제 전이시켜 본다. 전이 자체의 테스트는 012)
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(public.confirm_order((current_setting('zz.m')::jsonb ->> 'orderId')::uuid, public.zid('OP-M')) ->> 'status', 'USER_CONFIRMED', '(준비) KEYM 주문을 완료로 전이');
select is(public.cancel_order((select o.id from public.orders o where o.idempotency_key = public.zid('KEYX')), public.zid('OP-X')) ->> 'status', 'CANCELLED', '(준비) KEYX 주문을 취소로 전이');
select is(public.zdto_shape(public.get_order_by_request_key(public.zid('KEYM')), false), 'OK', '완료된 주문 응답: completedAt이 문자열이어도 모양 일치');
select is(public.get_order_by_request_key(public.zid('KEYM')) ->> 'status', 'USER_CONFIRMED', '완료된 주문의 status');
select is(jsonb_typeof(public.get_order_by_request_key(public.zid('KEYM')) -> 'completedAt'), 'string', '완료된 주문의 completedAt은 문자열');
select is(jsonb_typeof(public.get_order_by_request_key(public.zid('KEYM')) -> 'cancelledAt'), 'null', '완료된 주문의 cancelledAt은 null');
select is(public.zdto_shape(public.get_order_by_request_key(public.zid('KEYX')), false), 'OK', '취소된 주문 응답도 모양 일치');
select is(jsonb_typeof(public.get_order_by_request_key(public.zid('KEYX')) -> 'cancelledAt'), 'string', '취소된 주문의 cancelledAt은 문자열');
reset role;

-- ---------------------------------------------------------------- 제약 (직접 넣기)
select ok(public.test_err(format($f$insert into public.orders (user_id, store_id, idempotency_key, request_fingerprint, total_amount,
    store_name_snapshot, category_code_snapshot, category_name_snapshot, destination_ref, disclosure_version, disclosure_acknowledged_at)
  values ('aaaaaaaa-0000-4000-8000-000000000001', %L, %L, repeat('a', 64), 100, 'x', 'c', 'c', gen_random_uuid(), '2026-09-30', now())$f$,
  public.zid('S1'), public.zid('KEY1')), '23505'), '(user_id, idempotency_key) 중복 거절');
select ok(public.test_err(format($f$insert into public.order_items (order_id, store_id, menu_id, line_no, menu_name_snapshot, base_price_snapshot, option_total_snapshot, unit_price, quantity, line_total)
  values (%L, %L, %L, 9, 'x', 100, 0, 100, 2, 999)$f$, current_setting('zz.r1')::jsonb ->> 'orderId', public.zid('S1'), public.zid('M2')), '23514'), '줄 합계 식(단가 × 수량)이 틀리면 거절');
select ok(public.test_err(format($f$insert into public.order_items (order_id, store_id, menu_id, line_no, menu_name_snapshot, base_price_snapshot, option_total_snapshot, unit_price, quantity, line_total)
  values (%L, %L, %L, 9, 'x', 100, 50, 100, 1, 100)$f$, current_setting('zz.r1')::jsonb ->> 'orderId', public.zid('S1'), public.zid('M2')), '23514'), '단가 식(기본가 + 옵션합)이 틀리면 거절');
select ok(public.test_err(format($f$insert into public.order_items (order_id, store_id, menu_id, line_no, menu_name_snapshot, base_price_snapshot, option_total_snapshot, unit_price, quantity, line_total)
  values (%L, %L, %L, 9, 'x', 100, 0, 100, 11, 1100)$f$, current_setting('zz.r1')::jsonb ->> 'orderId', public.zid('S1'), public.zid('M2')), '23514'), '수량 11은 거절');
select ok(public.test_err(format($f$insert into public.order_items (order_id, store_id, menu_id, line_no, menu_name_snapshot, base_price_snapshot, option_total_snapshot, unit_price, quantity, line_total)
  values (%L, %L, %L, 9, 'x', 100, 0, 100, 1, 100)$f$, current_setting('zz.r1')::jsonb ->> 'orderId', public.zid('S2'), public.zid('M5')), '23503'),
  '줄의 가게가 주문의 가게와 다르면 거절 (복합 FK)');
select ok(public.test_err(format($f$insert into public.order_items (order_id, store_id, menu_id, line_no, menu_name_snapshot, base_price_snapshot, option_total_snapshot, unit_price, quantity, line_total)
  values (%L, %L, %L, 1, 'x', 100, 0, 100, 1, 100)$f$, current_setting('zz.r1')::jsonb ->> 'orderId', public.zid('S1'), public.zid('M2')), '23505'), '같은 주문의 line_no 중복 거절');
select ok(public.test_err(format($f$insert into public.order_status_updates (order_id, revision, operation_id, to_status) values (%L, 1, gen_random_uuid(), 'PENDING')$f$,
  current_setting('zz.r1')::jsonb ->> 'orderId'), '23505'), '같은 주문의 revision 중복 거절');
select ok(public.test_err(format($f$insert into public.order_status_updates (order_id, revision, operation_id, to_status) values (%L, 2, %L, 'PENDING')$f$,
  current_setting('zz.r1')::jsonb ->> 'orderId', public.zid('KEY1')), '23505'), '같은 주문의 operation_id 중복 거절 (생성 키가 operation_id로 쓰였다)');

-- ---------------------------------------------------------------- 기존 객체 불변
select ok(exists (select 1 from pg_proc where oid = 'public.ensure_my_profile()'::regprocedure), 'ensure_my_profile이 그대로 있다');
select ok(pg_get_functiondef('public.create_order(jsonb)'::regprocedure) !~* 'cart', 'create_order에는 Cart 관련 코드가 없다');

select * from finish();
rollback;
