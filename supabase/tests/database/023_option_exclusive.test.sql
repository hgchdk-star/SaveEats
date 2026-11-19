-- 단독 옵션: menu_options.is_exclusive
-- 근거: supabase/migrations/20261119120000_option_exclusive.sql 머리말. 테스트 데이터는 롤백으로 사라진다.
-- 이 파일은 pgTAP의 is · ok · no_plan · finish만 쓴다.
create extension if not exists pgtap with schema extensions;

begin;
select * from no_plan();

create function public.zid(p text) returns uuid language sql immutable as $$ select md5(p)::uuid $$;
create function public.zq_code(p jsonb) returns text language plpgsql as $$
begin
  perform public.create_order(p);
  return 'OK';
exception when others then
  return sqlerrm;
end;
$$;
create function public.zq_item3(p_menu uuid, p_opts jsonb, p_qty integer, p_price bigint) returns jsonb language sql as $$
  select jsonb_build_object('menuId', p_menu, 'options', p_opts,
                            'quantity', p_qty, 'approvedUnitPrice', p_price, 'approvedCatalogRevision', 1)
$$;
create function public.zq_opt(p_opt uuid, p_qty jsonb) returns jsonb language sql as $$
  select jsonb_build_object('optionId', p_opt, 'quantity', p_qty)
$$;
create function public.zq_req(p_store text, p_items jsonb) returns jsonb language sql as $$
  select jsonb_build_object(
    'idempotencyKey', gen_random_uuid(), 'requestVersion', 3, 'storeId', public.zid(p_store),
    'destinationRef', '0de57000-0000-4000-8000-000000000001', 'items', p_items,
    'approvedTotalAmount', (select sum((i ->> 'approvedUnitPrice')::numeric * (i ->> 'quantity')::numeric) from jsonb_array_elements(p_items) i)::bigint,
    'disclosureVersion', '2026-09-30', 'disclosureAcknowledged', true)
$$;
create function public.zq_ddl_fails(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when check_violation then
  return true;
end;
$$;

-- ---------------------------------------------------------------- 픽스처 (superuser)
insert into auth.users (id) values ('aaaaaaaa-0000-4000-8000-000000000001');
insert into public.categories (id, code, name, sort_order, is_active) values (public.zid('C'), 'zz-ex', '단독옵션분류', 99, true);
insert into public.stores (id, category_id, name, is_active, is_open) values
  (public.zid('S1'), public.zid('C'), '단독옵션가게', true, true),
  (public.zid('S2'), public.zid('C'), '다른가게', true, true);
insert into public.menus (id, store_id, name, base_price) values
  (public.zid('M1'), public.zid('S1'), '키소카레', 9900),
  (public.zid('M2'), public.zid('S2'), '다른가게카레', 8000);
-- 필수 그룹(종류 1~8, 수량 합계 8): 선택안함(단독, 수량 불가) · 대파 · 마늘(+700) · 눈꽃치즈(+1000)
insert into public.menu_option_groups (id, menu_id, name, min_select, max_select, sort_order, max_total_quantity) values
  (public.zid('GT'), public.zid('M1'), '전용 옵션', 1, 8, 1, 8),
  (public.zid('GO'), public.zid('M2'), '다른가게 전용 옵션', 1, 8, 1, 8);
insert into public.menu_options (id, group_id, name, additional_price, sort_order, allow_quantity, max_quantity, is_exclusive) values
  (public.zid('NONE'), public.zid('GT'), '선택안함', 0, 1, false, null, true),
  (public.zid('SCALLION'), public.zid('GT'), '대파', 0, 2, true, 8, false),
  (public.zid('GARLIC'), public.zid('GT'), '마늘양파후레이크', 700, 3, true, 8, false),
  (public.zid('CHEESE'), public.zid('GT'), '눈꽃치즈', 1000, 4, true, 8, false),
  -- 다른 가게: 이름이 같은 '선택안함'이지만 단독 표시가 없다(이름으로 판단하지 않는다)
  (public.zid('ONONE'), public.zid('GO'), '선택안함', 0, 1, true, 8, false),
  (public.zid('OSCALLION'), public.zid('GO'), '대파', 0, 2, true, 8, false);

-- ---------------------------------------------------------------- 제약 · 권한 (superuser)
select ok(public.zq_ddl_fails(format('update public.menu_options set is_exclusive = true where id = %L', public.zid('GARLIC'))), '제약: 수량을 허용하는 옵션은 단독 옵션이 될 수 없다');
select ok(public.zq_ddl_fails(format('update public.menu_options set allow_quantity = true, max_quantity = 3 where id = %L', public.zid('NONE'))), '제약: 단독 옵션은 수량 조절을 켤 수 없다');
select is((select column_default from information_schema.columns where table_schema = 'public' and table_name = 'menu_options' and column_name = 'is_exclusive'), 'false', '기본값은 false');
select ok((select is_nullable = 'NO' from information_schema.columns where table_schema = 'public' and table_name = 'menu_options' and column_name = 'is_exclusive'), 'is_exclusive는 not null');
select ok(has_column_privilege('anon', 'public.menu_options', 'is_exclusive', 'select'), 'anon은 is_exclusive를 읽을 수 있다');
select ok(not has_column_privilege('anon', 'public.menu_options', 'is_exclusive', 'update'), 'anon은 is_exclusive를 바꿀 수 없다');

-- ---------------------------------------------------------------- 조회 (anon)
set local role anon;
select is((select (o ->> 'isExclusive')::boolean from jsonb_array_elements((select g -> 'options' from jsonb_array_elements(public.get_menu(public.zid('M1')) -> 'optionGroups') g)) o where o ->> 'name' = '선택안함'),
  true, 'get_menu: 선택안함 isExclusive=true');
select is((select (o ->> 'isExclusive')::boolean from jsonb_array_elements((select g -> 'options' from jsonb_array_elements(public.get_menu(public.zid('M1')) -> 'optionGroups') g)) o where o ->> 'name' = '대파'),
  false, 'get_menu: 일반 옵션 isExclusive=false');
select is((select (o ->> 'isExclusive')::boolean from jsonb_array_elements((select g -> 'options' from jsonb_array_elements(public.get_menu(public.zid('M2')) -> 'optionGroups') g)) o where o ->> 'name' = '선택안함'),
  false, 'get_menu: 다른 가게의 같은 이름 옵션은 단독이 아니다');
reset role;

-- ---------------------------------------------------------------- 주문 (authenticated)
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', true);

select is(public.zq_code(public.zq_req('S1', jsonb_build_array(public.zq_item3(public.zid('M1'),
    jsonb_build_array(public.zq_opt(public.zid('NONE'), to_jsonb(1))), 1, 9900)))), 'OK', '선택안함만 선택: 가능(필수 충족)');
select is(public.zq_code(public.zq_req('S1', jsonb_build_array(public.zq_item3(public.zid('M1'),
    jsonb_build_array(public.zq_opt(public.zid('NONE'), to_jsonb(1)), public.zq_opt(public.zid('SCALLION'), to_jsonb(1))), 1, 9900)))), 'INVALID_OPTIONS', '선택안함 + 대파: INVALID_OPTIONS');
select is(public.zq_code(public.zq_req('S1', jsonb_build_array(public.zq_item3(public.zid('M1'),
    jsonb_build_array(public.zq_opt(public.zid('GARLIC'), to_jsonb(1)), public.zq_opt(public.zid('NONE'), to_jsonb(1)), public.zq_opt(public.zid('CHEESE'), to_jsonb(1))), 1, 11600)))), 'INVALID_OPTIONS', '토핑 + 선택안함 + 토핑(순서 무관): INVALID_OPTIONS');
select is(public.zq_code(public.zq_req('S1', jsonb_build_array(public.zq_item3(public.zid('M1'),
    jsonb_build_array(public.zq_opt(public.zid('NONE'), to_jsonb(2))), 1, 9900)))), 'INVALID_OPTIONS', '선택안함 수량 2: INVALID_OPTIONS');
-- 일반 토핑 여러 종류, 합계 8 허용 · 9 거절, 가격 계산 (9,900 + 700×3 + 1,000×5 = 17,000)
select is(public.zq_code(public.zq_req('S1', jsonb_build_array(public.zq_item3(public.zid('M1'),
    jsonb_build_array(public.zq_opt(public.zid('GARLIC'), to_jsonb(3)), public.zq_opt(public.zid('CHEESE'), to_jsonb(5))), 1, 17000)))), 'OK', '토핑 두 종류 합계 8: 가능');
select is(public.zq_code(public.zq_req('S1', jsonb_build_array(public.zq_item3(public.zid('M1'),
    jsonb_build_array(public.zq_opt(public.zid('GARLIC'), to_jsonb(4)), public.zq_opt(public.zid('CHEESE'), to_jsonb(5))), 1, 17700)))), 'INVALID_OPTIONS', '토핑 합계 9: INVALID_OPTIONS');
select is(public.zq_code(public.zq_req('S1', jsonb_build_array(public.zq_item3(public.zid('M1'),
    jsonb_build_array(public.zq_opt(public.zid('SCALLION'), to_jsonb(2)), public.zq_opt(public.zid('GARLIC'), to_jsonb(1)), public.zq_opt(public.zid('CHEESE'), to_jsonb(1))), 2, 11600)))), 'OK', '세 종류 토핑 + 메뉴 2개: 가능((9,900+0+700+1,000)×2)');
-- 필수 그룹: 아무것도 안 고르면 거절
select is(public.zq_code(public.zq_req('S1', jsonb_build_array(public.zq_item3(public.zid('M1'), '[]'::jsonb, 1, 9900)))), 'INVALID_OPTIONS', '아무것도 안 고름: 필수 조건 위반');
-- 다른 가게: 단독 표시가 없으면 이름이 같아도 함께 고를 수 있다(기존 동작)
select is(public.zq_code(public.zq_req('S2', jsonb_build_array(public.zq_item3(public.zid('M2'),
    jsonb_build_array(public.zq_opt(public.zid('ONONE'), to_jsonb(1)), public.zq_opt(public.zid('OSCALLION'), to_jsonb(1))), 1, 8000)))), 'OK', '다른 가게: 같은 이름 옵션 함께 선택 가능(단독 표시 없음)');
-- 과거 주문 조회: 새 규칙과 무관
select set_config('zq.r1', public.create_order(public.zq_req('S1', jsonb_build_array(public.zq_item3(public.zid('M1'),
  jsonb_build_array(public.zq_opt(public.zid('GARLIC'), to_jsonb(2))), 1, 11300))))::text, true);
select is((public.get_my_order((current_setting('zq.r1')::jsonb ->> 'orderId')::uuid) ->> 'totalAmount')::bigint, 11300::bigint, '정상 주문 생성·조회 가능');
-- 이미 만든 주문은 단독 표시를 바꿔도 다시 검증하지 않는다
reset role;
update public.menu_options set is_exclusive = true, allow_quantity = false, max_quantity = null where id = public.zid('GARLIC');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', true);
select is((public.get_my_order((current_setting('zq.r1')::jsonb ->> 'orderId')::uuid) -> 'snapshot' -> 'items' -> 0 -> 'options' -> 0 ->> 'quantity')::integer, 2, '과거 주문의 옵션 수량 스냅샷은 그대로');

reset role;
select * from finish();
rollback;
