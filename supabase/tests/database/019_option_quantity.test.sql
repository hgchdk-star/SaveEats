-- 옵션별 수량: menu_options.allow_quantity · max_quantity, 주문 요청 v3(options[{optionId, quantity}]), 주문 Snapshot의 옵션 수량
-- 근거: supabase/migrations/20261117010000_option_quantity.sql 머리말의 규칙. 테스트 데이터는 롤백으로 사라진다.
-- 이 파일은 pgTAP의 is · ok · no_plan · finish만 쓴다.
-- 진짜 동시성(같은 키 동시 요청 등)은 여기서 확인할 수 없다.
create extension if not exists pgtap with schema extensions;

begin;
select * from no_plan();

create function public.zid(p text) returns uuid language sql immutable as $$ select md5(p)::uuid $$;

-- create_order 결과: 성공이면 'OK', 실패면 메시지
create function public.zq_code(p jsonb) returns text language plpgsql as $$
begin
  perform public.create_order(p);
  return 'OK';
exception when others then
  return sqlerrm;
end;
$$;

create function public.zq_item2(p_menu uuid, p_opts uuid[], p_qty integer, p_price bigint) returns jsonb language sql as $$
  select jsonb_build_object('menuId', p_menu, 'optionIds', to_jsonb(coalesce(p_opts, '{}'::uuid[])),
                            'quantity', p_qty, 'approvedUnitPrice', p_price, 'approvedCatalogRevision', 1)
$$;

-- p_opts: [{"optionId": uuid, "quantity": n}, ...]
create function public.zq_item3(p_menu uuid, p_opts jsonb, p_qty integer, p_price bigint) returns jsonb language sql as $$
  select jsonb_build_object('menuId', p_menu, 'options', p_opts,
                            'quantity', p_qty, 'approvedUnitPrice', p_price, 'approvedCatalogRevision', 1)
$$;

create function public.zq_opt(p_opt uuid, p_qty jsonb) returns jsonb language sql as $$
  select jsonb_build_object('optionId', p_opt, 'quantity', p_qty)
$$;

-- uuid 타입은 항상 소문자로 나가므로, 대문자 표기를 보내려면 text로 넘긴다
create function public.zq_opt_text(p_opt text, p_qty jsonb) returns jsonb language sql as $$
  select jsonb_build_object('optionId', p_opt, 'quantity', p_qty)
$$;

create function public.zq_req(p_version integer, p_items jsonb, p_key uuid default gen_random_uuid()) returns jsonb language sql as $$
  select jsonb_build_object(
    'idempotencyKey', p_key, 'requestVersion', p_version, 'storeId', public.zid('S1'),
    'destinationRef', '0de57000-0000-4000-8000-000000000001', 'items', p_items,
    'approvedTotalAmount', (select sum((i ->> 'approvedUnitPrice')::numeric * (i ->> 'quantity')::numeric)
                            from jsonb_array_elements(p_items) i)::bigint,
    'disclosureVersion', '2026-09-30', 'disclosureAcknowledged', true)
$$;

-- ---------------------------------------------------------------- 픽스처 (superuser)
insert into auth.users (id) values ('aaaaaaaa-0000-4000-8000-000000000001');

insert into public.categories (id, code, name, sort_order, is_active) values (public.zid('C'), 'zz-oq', '옵션수량분류', 99, true);
insert into public.stores (id, category_id, name, is_active, is_open) values
  (public.zid('S1'), public.zid('C'), '옵션수량가게', true, true),
  (public.zid('S2'), public.zid('C'), '다른가게', true, true);
insert into public.menus (id, store_id, name, base_price) values
  (public.zid('M1'), public.zid('S1'), '치킨', 25000),
  (public.zid('M2'), public.zid('S1'), '필수옵션메뉴', 10000),
  (public.zid('M5'), public.zid('S2'), '다른가게메뉴', 1000);
insert into public.menu_option_groups (id, menu_id, name, min_select, max_select, sort_order) values
  (public.zid('GS'), public.zid('M1'), '소스', 0, 5, 1),
  (public.zid('GX'), public.zid('M1'), '단일', 0, 1, 2),
  (public.zid('GR'), public.zid('M2'), '필수', 1, 1, 1),
  (public.zid('GO'), public.zid('M5'), '다른가게그룹', 0, 1, 1);
insert into public.menu_options (id, group_id, name, additional_price, sort_order, is_active, is_sold_out, allow_quantity, max_quantity) values
  (public.zid('SAUCE'), public.zid('GS'), '파떡치소스', 700, 1, true, false, true, 5),
  (public.zid('HONEY'), public.zid('GS'), '허니소스', 500, 2, true, false, true, 3),
  (public.zid('PLAIN'), public.zid('GS'), '수량불가옵션', 300, 3, true, false, false, null),
  (public.zid('SOLD'), public.zid('GS'), '품절옵션', 400, 4, true, true, true, 9),
  (public.zid('INACT'), public.zid('GS'), '비활성옵션', 100, 5, false, false, true, 9),
  (public.zid('X1'), public.zid('GX'), '단일수량옵션', 100, 1, true, false, true, 4),
  (public.zid('X2'), public.zid('GX'), '단일다른옵션', 200, 2, true, false, false, null),
  (public.zid('R1'), public.zid('GR'), '필수1', 0, 1, true, false, false, null),
  (public.zid('R2'), public.zid('GR'), '필수2', 1000, 2, true, false, false, null),
  (public.zid('OX'), public.zid('GO'), '다른가게옵션', 100, 1, true, false, false, null);

-- ---------------------------------------------------------------- 제약 · 권한 (superuser)
select ok((select exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'menu_options' and column_name = 'allow_quantity' and is_nullable = 'NO')),
  'menu_options.allow_quantity는 not null');
select is((select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'menu_options' and column_name = 'allow_quantity'), 'false',
  '기존 옵션은 수량을 허용하지 않는 것이 기본');
select ok(not exists (select 1 from public.menu_options where id = public.zid('PLAIN') and allow_quantity), '수량불가옵션은 allow_quantity=false');
select ok(has_column_privilege('anon', 'public.menu_options', 'allow_quantity', 'select'), 'anon은 allow_quantity를 읽을 수 있다');
select ok(has_column_privilege('anon', 'public.menu_options', 'max_quantity', 'select'), 'anon은 max_quantity를 읽을 수 있다');
select ok(not has_table_privilege('authenticated', 'public.order_item_options', 'insert'), 'order_item_options에 앱 쓰기 권한이 없다');
select ok(not has_function_privilege('authenticated', 'private.order_line_options_q(jsonb)', 'execute'), 'private 옵션 수량 함수는 앱에 열려 있지 않다');

-- check 제약: 허용 + max 없음 / 허용 안 함 + max 있음 / max 0은 거절
create function public.zq_ddl_fails(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when check_violation then
  return true;
end;
$$;
select ok(public.zq_ddl_fails(format('update public.menu_options set allow_quantity = true, max_quantity = null where id = %L', public.zid('PLAIN'))),
  '제약: 수량 허용인데 max_quantity가 없으면 거절');
select ok(public.zq_ddl_fails(format('update public.menu_options set allow_quantity = false, max_quantity = 5 where id = %L', public.zid('PLAIN'))),
  '제약: 수량 허용이 아닌데 max_quantity가 있으면 거절');
select ok(public.zq_ddl_fails(format('update public.menu_options set allow_quantity = true, max_quantity = 0 where id = %L', public.zid('PLAIN'))),
  '제약: max_quantity 0은 거절');

-- ---------------------------------------------------------------- 주문 (authenticated)
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', true);

-- get_menu
select is((select (o ->> 'allowQuantity')::boolean from jsonb_array_elements(
    (select g -> 'options' from jsonb_array_elements(public.get_menu(public.zid('M1')) -> 'optionGroups') g
      where g ->> 'name' = '소스')) o where o ->> 'name' = '파떡치소스'), true, 'get_menu: 수량 허용 옵션 allowQuantity=true');
select is((select (o ->> 'maxQuantity')::integer from jsonb_array_elements(
    (select g -> 'options' from jsonb_array_elements(public.get_menu(public.zid('M1')) -> 'optionGroups') g
      where g ->> 'name' = '소스')) o where o ->> 'name' = '파떡치소스'), 5, 'get_menu: maxQuantity=5');
select is((select o ->> 'maxQuantity' from jsonb_array_elements(
    (select g -> 'options' from jsonb_array_elements(public.get_menu(public.zid('M1')) -> 'optionGroups') g
      where g ->> 'name' = '소스')) o where o ->> 'name' = '수량불가옵션'), null, 'get_menu: 수량 불가 옵션은 maxQuantity=null');

-- 가격: 소스 2개 = 추가금 1,400원
select set_config('zq.r1', public.create_order(public.zq_req(3,
  jsonb_build_array(public.zq_item3(public.zid('M1'), jsonb_build_array(public.zq_opt(public.zid('SAUCE'), to_jsonb(2))), 1, 26400))))::text, true);
select is((current_setting('zq.r1')::jsonb ->> 'totalAmount')::bigint, 26400::bigint, '소스 2개: 25,000 + 700×2 = 26,400원');
select is((current_setting('zq.r1')::jsonb -> 'snapshot' -> 'items' -> 0 -> 'options' -> 0 ->> 'quantity')::integer, 2, '스냅샷: 옵션 수량 2');
select is((current_setting('zq.r1')::jsonb -> 'snapshot' -> 'items' -> 0 -> 'options' -> 0 ->> 'additionalPrice')::bigint, 700::bigint, '스냅샷: 옵션 개당 가격 700');

-- 가격: (25,000 + 700×2) × 2 = 52,800원
select set_config('zq.r2', public.create_order(public.zq_req(3,
  jsonb_build_array(public.zq_item3(public.zid('M1'), jsonb_build_array(public.zq_opt(public.zid('SAUCE'), to_jsonb(2))), 2, 26400))))::text, true);
select is((current_setting('zq.r2')::jsonb ->> 'totalAmount')::bigint, 52800::bigint, '(25,000 + 700×2) × 메뉴 2개 = 52,800원');
select is((current_setting('zq.r2')::jsonb -> 'snapshot' -> 'items' -> 0 ->> 'lineTotal')::bigint, 52800::bigint, '줄 합계 52,800원');

-- 기존 요청 호환: v2 optionIds는 옵션 수량 1
select set_config('zq.r3', public.create_order(public.zq_req(2,
  jsonb_build_array(public.zq_item2(public.zid('M1'), array[public.zid('SAUCE')], 1, 25700))))::text, true);
select is((current_setting('zq.r3')::jsonb ->> 'totalAmount')::bigint, 25700::bigint, 'v2 optionIds: 옵션 수량 1 (25,700원)');
select is((current_setting('zq.r3')::jsonb -> 'snapshot' -> 'items' -> 0 -> 'options' -> 0 ->> 'quantity')::integer, 1, 'v2 옵션의 스냅샷 수량은 1');

-- 조회에도 옵션 수량이 있다
select is((public.get_my_order((current_setting('zq.r1')::jsonb ->> 'orderId')::uuid) -> 'snapshot' -> 'items' -> 0 -> 'options' -> 0 ->> 'quantity')::integer,
  2, 'get_my_order: 옵션 수량 2');

-- 수량 위반
select is(public.zq_code(public.zq_req(3, jsonb_build_array(public.zq_item3(public.zid('M1'),
    jsonb_build_array(public.zq_opt(public.zid('PLAIN'), to_jsonb(2))), 1, 25600)))), 'INVALID_OPTIONS', '수량 허용 안 한 옵션 2개: INVALID_OPTIONS');
select is(public.zq_code(public.zq_req(3, jsonb_build_array(public.zq_item3(public.zid('M1'),
    jsonb_build_array(public.zq_opt(public.zid('SAUCE'), to_jsonb(6))), 1, 29200)))), 'INVALID_OPTIONS', 'max_quantity(5) 초과: INVALID_OPTIONS');
select is(public.zq_code(public.zq_req(3, jsonb_build_array(public.zq_item3(public.zid('M1'),
    jsonb_build_array(public.zq_opt(public.zid('SAUCE'), to_jsonb(5))), 1, 28500)))), 'OK', 'max_quantity 5개는 가능');
select is(public.zq_code(public.zq_req(3, jsonb_build_array(public.zq_item3(public.zid('M1'),
    jsonb_build_array(public.zq_opt(public.zid('SAUCE'), to_jsonb(0))), 1, 25000)))), 'INVALID_INPUT', '옵션 수량 0: INVALID_INPUT');
select is(public.zq_code(public.zq_req(3, jsonb_build_array(public.zq_item3(public.zid('M1'),
    jsonb_build_array(public.zq_opt(public.zid('SAUCE'), to_jsonb(-1))), 1, 24300)))), 'INVALID_INPUT', '옵션 수량 음수: INVALID_INPUT');
select is(public.zq_code(public.zq_req(3, jsonb_build_array(public.zq_item3(public.zid('M1'),
    jsonb_build_array(public.zq_opt(public.zid('SAUCE'), to_jsonb(1.5))), 1, 26050)))), 'INVALID_INPUT', '옵션 수량 소수: INVALID_INPUT');
select is(public.zq_code(public.zq_req(3, jsonb_build_array(public.zq_item3(public.zid('M1'),
    jsonb_build_array(public.zq_opt(public.zid('SAUCE'), to_jsonb('2'::text))), 1, 26400)))), 'INVALID_INPUT', '옵션 수량 문자열: INVALID_INPUT');

-- 중복 옵션(수량 제한 우회)
select is(public.zq_code(public.zq_req(3, jsonb_build_array(public.zq_item3(public.zid('M1'),
    jsonb_build_array(public.zq_opt(public.zid('SAUCE'), to_jsonb(2)), public.zq_opt(public.zid('SAUCE'), to_jsonb(2))), 1, 27800)))),
  'INVALID_INPUT', 'v3 같은 옵션을 두 번 보내면 INVALID_INPUT');
select is(public.zq_code(public.zq_req(3, jsonb_build_array(public.zq_item3(public.zid('M1'),
    jsonb_build_array(public.zq_opt(public.zid('SAUCE'), to_jsonb(2)), public.zq_opt_text(upper(public.zid('SAUCE')::text), to_jsonb(3))), 1, 29200)))),
  'INVALID_INPUT', 'v3 대문자 표기의 같은 옵션도 중복');
select is(public.zq_code(public.zq_req(2, jsonb_build_array(public.zq_item2(public.zid('M1'),
    array[public.zid('SAUCE'), public.zid('SAUCE')], 1, 26400)))), 'INVALID_INPUT', 'v2 같은 옵션 두 번: INVALID_INPUT');

-- 요청 버전 규칙: v2는 optionIds만, v3는 options만
select is(public.zq_code(public.zq_req(2, jsonb_build_array(public.zq_item3(public.zid('M1'), '[]'::jsonb, 1, 25000)))),
  'INVALID_INPUT', 'v2에 options 필드를 보내면 INVALID_INPUT');
select is(public.zq_code(public.zq_req(3, jsonb_build_array(public.zq_item2(public.zid('M1'), '{}'::uuid[], 1, 25000)))),
  'INVALID_INPUT', 'v3에 optionIds 필드를 보내면 INVALID_INPUT');
select is(public.zq_code(public.zq_req(4, jsonb_build_array(public.zq_item3(public.zid('M1'), '[]'::jsonb, 1, 25000)))),
  'INVALID_INPUT', 'requestVersion 4는 거절');

-- 카탈로그 규칙 (옵션 수량이 있어도 그대로)
select is(public.zq_code(public.zq_req(3, jsonb_build_array(public.zq_item3(public.zid('M1'),
    jsonb_build_array(public.zq_opt(public.zid('OX'), to_jsonb(1))), 1, 25100)))), 'INVALID_INPUT', '다른 메뉴의 옵션: INVALID_INPUT');
select is(public.zq_code(public.zq_req(3, jsonb_build_array(public.zq_item3(public.zid('M1'),
    jsonb_build_array(public.zq_opt(public.zid('SOLD'), to_jsonb(1))), 1, 25400)))), 'ITEM_UNAVAILABLE', '품절 옵션: ITEM_UNAVAILABLE');
select is(public.zq_code(public.zq_req(3, jsonb_build_array(public.zq_item3(public.zid('M1'),
    jsonb_build_array(public.zq_opt(public.zid('INACT'), to_jsonb(1))), 1, 25100)))), 'ITEM_UNAVAILABLE', '비활성 옵션: ITEM_UNAVAILABLE');
select is(public.zq_code(public.zq_req(3, jsonb_build_array(public.zq_item3(public.zid('M1'),
    jsonb_build_array(public.zq_opt(public.zid('SAUCE'), to_jsonb(2))), 1, 25700)))), 'PRICE_CHANGED', '옵션 수량을 곱하지 않은 단가: PRICE_CHANGED');

-- 그룹 선택 제한은 '고른 옵션 종류 수' 기준 (결정이 필요한 항목: 수량 합계로 바꿀지)
select is(public.zq_code(public.zq_req(3, jsonb_build_array(public.zq_item3(public.zid('M1'),
    jsonb_build_array(public.zq_opt(public.zid('X1'), to_jsonb(1)), public.zq_opt(public.zid('X2'), to_jsonb(1))), 1, 25300)))),
  'INVALID_OPTIONS', '그룹 최대 1: 서로 다른 옵션 2종은 INVALID_OPTIONS');
select is(public.zq_code(public.zq_req(3, jsonb_build_array(public.zq_item3(public.zid('M1'),
    jsonb_build_array(public.zq_opt(public.zid('X1'), to_jsonb(3))), 1, 25300)))),
  'OK', '그룹 최대 1: 같은 옵션 수량 3은 종류 1개라 가능 (현재 규칙)');
select is(public.zq_code(public.zq_req(3, jsonb_build_array(public.zq_item3(public.zid('M2'), '[]'::jsonb, 1, 10000)))),
  'INVALID_OPTIONS', '필수 그룹을 고르지 않으면 INVALID_OPTIONS');
select is(public.zq_code(public.zq_req(3, jsonb_build_array(public.zq_item3(public.zid('M2'),
    jsonb_build_array(public.zq_opt(public.zid('R2'), to_jsonb(1))), 1, 11000)))), 'OK', '필수 그룹을 고르면 가능');

-- 줄 합치기: 옵션 수량이 다르면 다른 줄
select set_config('zq.r4', public.create_order(public.zq_req(3, jsonb_build_array(
  public.zq_item3(public.zid('M1'), jsonb_build_array(public.zq_opt(public.zid('SAUCE'), to_jsonb(1))), 1, 25700),
  public.zq_item3(public.zid('M1'), jsonb_build_array(public.zq_opt(public.zid('SAUCE'), to_jsonb(2))), 1, 26400))))::text, true);
select is(jsonb_array_length(current_setting('zq.r4')::jsonb -> 'snapshot' -> 'items'), 2, '같은 메뉴라도 옵션 수량이 다르면 별도 줄');
select set_config('zq.r5', public.create_order(public.zq_req(3, jsonb_build_array(
  public.zq_item3(public.zid('M1'), jsonb_build_array(public.zq_opt(public.zid('SAUCE'), to_jsonb(2))), 1, 26400),
  public.zq_item3(public.zid('M1'), jsonb_build_array(public.zq_opt(public.zid('SAUCE'), to_jsonb(2))), 2, 26400))))::text, true);
select is((current_setting('zq.r5')::jsonb -> 'snapshot' -> 'items' -> 0 ->> 'quantity')::integer, 3, '같은 메뉴·같은 옵션 수량은 한 줄로 합산(수량 3)');
select is(public.zq_code(public.zq_req(3, jsonb_build_array(
  public.zq_item3(public.zid('M1'), jsonb_build_array(public.zq_opt(public.zid('SAUCE'), to_jsonb(2))), 6, 26400),
  public.zq_item3(public.zid('M1'), jsonb_build_array(public.zq_opt(public.zid('SAUCE'), to_jsonb(2))), 5, 26400)))),
  'QUANTITY_LIMIT_EXCEEDED', '합산이 10을 넘으면 QUANTITY_LIMIT_EXCEEDED');

-- 요청 지문: 옵션 수량이 모두 1이면 v2와 v3가 같은 지문(같은 키의 재시도는 같은 주문)
select set_config('zq.key', gen_random_uuid()::text, true);
select set_config('zq.r6', public.create_order(public.zq_req(2,
  jsonb_build_array(public.zq_item2(public.zid('M1'), array[public.zid('SAUCE'), public.zid('HONEY')], 2, 26200)),
  current_setting('zq.key')::uuid))::text, true);
select is((public.create_order(public.zq_req(3,
  jsonb_build_array(public.zq_item3(public.zid('M1'), jsonb_build_array(public.zq_opt(public.zid('SAUCE'), to_jsonb(1)), public.zq_opt(public.zid('HONEY'), to_jsonb(1))), 2, 26200)),
  current_setting('zq.key')::uuid)) ->> 'replayed')::boolean, true, '같은 요청을 v3(수량 1)로 다시 보내면 같은 주문(replayed)');
select is(public.zq_code(public.zq_req(3,
  jsonb_build_array(public.zq_item3(public.zid('M1'), jsonb_build_array(public.zq_opt(public.zid('SAUCE'), to_jsonb(2)), public.zq_opt(public.zid('HONEY'), to_jsonb(1))), 2, 26900)),
  current_setting('zq.key')::uuid)), 'IDEMPOTENCY_CONFLICT', '같은 키로 옵션 수량이 다르면 IDEMPOTENCY_CONFLICT');

-- 옵션 가격이 나중에 바뀌어도 과거 주문은 그대로
reset role;
update public.menu_options set additional_price = 900 where id = public.zid('SAUCE');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', true);
select is((public.get_my_order((current_setting('zq.r1')::jsonb ->> 'orderId')::uuid) ->> 'totalAmount')::bigint, 26400::bigint, '옵션 가격이 바뀌어도 과거 주문 금액은 그대로');
select is((public.get_my_order((current_setting('zq.r1')::jsonb ->> 'orderId')::uuid) -> 'snapshot' -> 'items' -> 0 -> 'options' -> 0 ->> 'additionalPrice')::bigint,
  700::bigint, '옵션 가격이 바뀌어도 과거 주문의 옵션 가격 스냅샷은 그대로');

reset role;
select is((select min(quantity_snapshot) from public.order_item_options), 1, '옵션 수량 스냅샷은 모두 1 이상');

select * from finish();
rollback;
