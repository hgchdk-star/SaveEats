-- 옵션 그룹 수량 합계 제한: menu_option_groups.max_total_quantity
-- 근거: supabase/migrations/20261120000000_option_group_total_quantity.sql 머리말. 테스트 데이터는 롤백으로 사라진다.
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
insert into public.categories (id, code, name, sort_order, is_active) values (public.zid('C'), 'zz-tq', '합계제한분류', 99, true);
insert into public.stores (id, category_id, name, is_active, is_open) values
  (public.zid('S1'), public.zid('C'), '합계제한가게', true, true),
  (public.zid('S2'), public.zid('C'), '다른가게', true, true);
insert into public.menus (id, store_id, name, base_price) values
  (public.zid('M1'), public.zid('S1'), '피자', 30000),
  (public.zid('M2'), public.zid('S2'), '다른가게피자', 20000);
-- 음료: 종류 최대 2, 옵션당 최대 2, 수량 합계 최대 2.  사이드: 합계 제한 없음(옵션당 최대 10)
insert into public.menu_option_groups (id, menu_id, name, min_select, max_select, sort_order, max_total_quantity) values
  (public.zid('GD'), public.zid('M1'), '음료 (최대 2개 가능)', 0, 2, 1, 2),
  (public.zid('GS'), public.zid('M1'), '사이드', 0, 1000, 2, null),
  (public.zid('GO'), public.zid('M2'), '다른가게음료', 0, 2, 1, null);
insert into public.menu_options (id, group_id, name, additional_price, sort_order, allow_quantity, max_quantity) values
  (public.zid('COLA'), public.zid('GD'), '콜라', 1800, 1, true, 2),
  (public.zid('CIDER'), public.zid('GD'), '사이다', 1800, 2, true, 2),
  (public.zid('ZERO'), public.zid('GD'), '제로', 1800, 3, true, 2),
  (public.zid('TENDER'), public.zid('GS'), '치킨텐더', 7900, 1, true, 10),
  (public.zid('WING'), public.zid('GS'), '윙', 9800, 2, true, 10),
  (public.zid('OCOLA'), public.zid('GO'), '다른가게콜라', 1800, 1, true, 5),
  (public.zid('OCIDER'), public.zid('GO'), '다른가게사이다', 1800, 2, true, 5);

-- ---------------------------------------------------------------- 제약 · 권한 (superuser)
select ok(public.zq_ddl_fails(format('update public.menu_option_groups set max_total_quantity = 0 where id = %L', public.zid('GD'))), '제약: 합계 제한 0은 거절');
select ok(not public.zq_ddl_fails(format('update public.menu_option_groups set max_total_quantity = null where id = %L', public.zid('GS'))), '제약: null(제한 없음)은 가능');
select ok(has_column_privilege('anon', 'public.menu_option_groups', 'max_total_quantity', 'select'), 'anon은 max_total_quantity를 읽을 수 있다');
select ok(not has_column_privilege('anon', 'public.menu_option_groups', 'max_total_quantity', 'update'), 'anon은 max_total_quantity를 바꿀 수 없다');
select is((select column_default from information_schema.columns where table_schema = 'public' and table_name = 'menu_option_groups' and column_name = 'max_total_quantity'), null,
  '기존 그룹은 합계 제한이 없는 것이 기본(null)');

-- ---------------------------------------------------------------- 조회 (anon)
set local role anon;
select is((select (g ->> 'maxTotalQuantity')::integer from jsonb_array_elements(public.get_menu(public.zid('M1')) -> 'optionGroups') g where g ->> 'name' = '음료 (최대 2개 가능)'),
  2, 'get_menu: 음료 그룹 maxTotalQuantity=2');
select is((select g -> 'maxTotalQuantity' from jsonb_array_elements(public.get_menu(public.zid('M1')) -> 'optionGroups') g where g ->> 'name' = '사이드'),
  'null'::jsonb, 'get_menu: 제한 없는 그룹은 maxTotalQuantity=null');
select is((select (g ->> 'maxSelect')::integer from jsonb_array_elements(public.get_menu(public.zid('M1')) -> 'optionGroups') g where g ->> 'name' = '음료 (최대 2개 가능)'),
  2, 'get_menu: maxSelect(종류 수)는 그대로 2');
reset role;

-- ---------------------------------------------------------------- 주문 (authenticated)
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', true);

-- 같은 음료 2개: 가능 (30,000 + 1,800×2 = 33,600)
select is(public.zq_code(public.zq_req('S1', jsonb_build_array(public.zq_item3(public.zid('M1'),
    jsonb_build_array(public.zq_opt(public.zid('COLA'), to_jsonb(2))), 1, 33600)))), 'OK', '콜라 2개: 가능');
-- 서로 다른 음료 1개씩: 가능
select is(public.zq_code(public.zq_req('S1', jsonb_build_array(public.zq_item3(public.zid('M1'),
    jsonb_build_array(public.zq_opt(public.zid('COLA'), to_jsonb(1)), public.zq_opt(public.zid('CIDER'), to_jsonb(1))), 1, 33600)))), 'OK', '콜라 1 + 사이다 1: 가능');
-- 합계 3개: 거절 (콜라 2 + 사이다 1)
select is(public.zq_code(public.zq_req('S1', jsonb_build_array(public.zq_item3(public.zid('M1'),
    jsonb_build_array(public.zq_opt(public.zid('COLA'), to_jsonb(2)), public.zq_opt(public.zid('CIDER'), to_jsonb(1))), 1, 35400)))), 'INVALID_OPTIONS', '콜라 2 + 사이다 1(합계 3): INVALID_OPTIONS');
-- 합계 4개: 거절 (콜라 2 + 사이다 2)
select is(public.zq_code(public.zq_req('S1', jsonb_build_array(public.zq_item3(public.zid('M1'),
    jsonb_build_array(public.zq_opt(public.zid('COLA'), to_jsonb(2)), public.zq_opt(public.zid('CIDER'), to_jsonb(2))), 1, 37200)))), 'INVALID_OPTIONS', '콜라 2 + 사이다 2(합계 4): INVALID_OPTIONS');
-- 종류 3개(합계 3): 종류 수 규칙과 합계 규칙 둘 다 걸린다
select is(public.zq_code(public.zq_req('S1', jsonb_build_array(public.zq_item3(public.zid('M1'),
    jsonb_build_array(public.zq_opt(public.zid('COLA'), to_jsonb(1)), public.zq_opt(public.zid('CIDER'), to_jsonb(1)), public.zq_opt(public.zid('ZERO'), to_jsonb(1))), 1, 35400)))), 'INVALID_OPTIONS', '3종: INVALID_OPTIONS');
-- 옵션당 상한(2) 초과는 기존 규칙으로 거절
select is(public.zq_code(public.zq_req('S1', jsonb_build_array(public.zq_item3(public.zid('M1'),
    jsonb_build_array(public.zq_opt(public.zid('COLA'), to_jsonb(3))), 1, 35400)))), 'INVALID_OPTIONS', '콜라 3개(옵션당 상한 2 초과): INVALID_OPTIONS');
-- 합계 제한은 줄(메뉴)마다 따로 센다: 줄 2개에 각각 콜라 2개는 가능
select is(public.zq_code(public.zq_req('S1', jsonb_build_array(
    public.zq_item3(public.zid('M1'), jsonb_build_array(public.zq_opt(public.zid('COLA'), to_jsonb(2))), 1, 33600),
    public.zq_item3(public.zid('M1'), jsonb_build_array(public.zq_opt(public.zid('CIDER'), to_jsonb(2))), 1, 33600)))), 'OK', '줄마다 따로: 줄1 콜라 2 + 줄2 사이다 2는 가능');
-- 메뉴 수량(2) × 음료 2개: 가능 ((30,000+3,600)×2)
select is(public.zq_code(public.zq_req('S1', jsonb_build_array(public.zq_item3(public.zid('M1'),
    jsonb_build_array(public.zq_opt(public.zid('COLA'), to_jsonb(2))), 2, 33600)))), 'OK', '메뉴 2개 × 콜라 2개: 가능(합계는 메뉴 한 개 기준)');
-- 합계 제한이 없는 그룹은 기존 그대로: 치킨텐더 10개 + 윙 10개 (종류 2, 합계 20)
select is(public.zq_code(public.zq_req('S1', jsonb_build_array(public.zq_item3(public.zid('M1'),
    jsonb_build_array(public.zq_opt(public.zid('TENDER'), to_jsonb(10)), public.zq_opt(public.zid('WING'), to_jsonb(10))), 1, 207000)))), 'OK', '제한 없는 사이드: 10 + 10개 가능');
-- 사이드 + 음료 2개 (서로 다른 그룹의 합계는 섞이지 않는다)
select is(public.zq_code(public.zq_req('S1', jsonb_build_array(public.zq_item3(public.zid('M1'),
    jsonb_build_array(public.zq_opt(public.zid('TENDER'), to_jsonb(5)), public.zq_opt(public.zid('COLA'), to_jsonb(2))), 1, 73100)))), 'OK', '사이드 5 + 콜라 2: 가능');
-- 다른 가게: 합계 제한이 없어 기존 동작(콜라 5 + 사이다 5 가능)
select is(public.zq_code(public.zq_req('S2', jsonb_build_array(public.zq_item3(public.zid('M2'),
    jsonb_build_array(public.zq_opt(public.zid('OCOLA'), to_jsonb(3)), public.zq_opt(public.zid('OCIDER'), to_jsonb(3))), 1, 30800)))), 'OK', '다른 가게(제한 없음): 3 + 3 가능');
-- 비활성 그룹의 제한은 적용하지 않는다(그 그룹 옵션은 어차피 주문 불가)
reset role;
update public.menu_option_groups set is_active = false where id = public.zid('GD');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', true);
select is(public.zq_code(public.zq_req('S1', jsonb_build_array(public.zq_item3(public.zid('M1'),
    jsonb_build_array(public.zq_opt(public.zid('COLA'), to_jsonb(2))), 1, 33600)))), 'ITEM_UNAVAILABLE', '비활성 그룹의 옵션은 ITEM_UNAVAILABLE(합계 규칙 이전)');

reset role;
select * from finish();
rollback;
