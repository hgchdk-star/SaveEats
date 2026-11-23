-- 주문 응답 옵션의 원본 식별자(groupId, optionId): get_my_order · get_my_history_order · create_order 응답
-- 근거: supabase/migrations/20261123200452_order_snapshot_option_ids.sql 머리말. 테스트 데이터는 롤백으로 사라진다.
-- 이 파일은 pgTAP의 is · ok · no_plan · finish만 쓴다.
create extension if not exists pgtap with schema extensions;

begin;
select * from no_plan();

create function public.zid(p text) returns uuid language sql immutable as $$ select md5(p)::uuid $$;

insert into auth.users (id) values ('aaaaaaaa-0000-4000-8000-000000000002');
insert into public.categories (id, code, name, sort_order, is_active) values (public.zid('C'), 'zz-oi', '옵션식별자분류', 99, true);
insert into public.stores (id, category_id, name, is_active, is_open) values (public.zid('S1'), public.zid('C'), '옵션식별자가게', true, true);
insert into public.menus (id, store_id, name, base_price) values (public.zid('M1'), public.zid('S1'), '치킨', 25000);
insert into public.menu_option_groups (id, menu_id, name, min_select, max_select, sort_order) values (public.zid('GS'), public.zid('M1'), '소스', 0, 5, 1);
insert into public.menu_options (id, group_id, name, additional_price, sort_order, is_active, is_sold_out, allow_quantity, max_quantity) values
  (public.zid('SAUCE'), public.zid('GS'), '파떡치소스', 700, 1, true, false, true, 5);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000002', true);

select set_config('zo.r1', public.create_order(jsonb_build_object(
  'idempotencyKey', gen_random_uuid(), 'requestVersion', 3, 'storeId', public.zid('S1'),
  'destinationRef', '0de57000-0000-4000-8000-000000000001',
  'items', jsonb_build_array(jsonb_build_object('menuId', public.zid('M1'),
    'options', jsonb_build_array(jsonb_build_object('optionId', public.zid('SAUCE'), 'quantity', 2)),
    'quantity', 1, 'approvedUnitPrice', 26400, 'approvedCatalogRevision', 1)),
  'approvedTotalAmount', 26400, 'disclosureVersion', '2026-09-30', 'disclosureAcknowledged', true))::text, true);

select is(current_setting('zo.r1')::jsonb -> 'snapshot' -> 'items' -> 0 -> 'options' -> 0 ->> 'optionId', public.zid('SAUCE')::text, 'create_order 응답: optionId');
select is(current_setting('zo.r1')::jsonb -> 'snapshot' -> 'items' -> 0 -> 'options' -> 0 ->> 'groupId', public.zid('GS')::text, 'create_order 응답: groupId');
select is(public.get_my_order((current_setting('zo.r1')::jsonb ->> 'orderId')::uuid) -> 'snapshot' -> 'items' -> 0 -> 'options' -> 0 ->> 'optionId', public.zid('SAUCE')::text, 'get_my_order: optionId');
select is(public.get_my_history_order((current_setting('zo.r1')::jsonb ->> 'orderId')::uuid) -> 'snapshot' -> 'items' -> 0 -> 'options' -> 0 ->> 'groupId', public.zid('GS')::text, 'get_my_history_order: groupId');
-- 기존 키와 값은 그대로
select is(public.get_my_order((current_setting('zo.r1')::jsonb ->> 'orderId')::uuid) -> 'snapshot' -> 'items' -> 0 -> 'options' -> 0 ->> 'optionName', '파떡치소스', '기존 키 optionName 그대로');
select is((public.get_my_order((current_setting('zo.r1')::jsonb ->> 'orderId')::uuid) -> 'snapshot' -> 'items' -> 0 -> 'options' -> 0 ->> 'quantity')::integer, 2, '기존 키 quantity 그대로');
reset role;
-- 이후 메뉴·옵션 이름이 바뀌어도 식별자는 같고 이름은 주문 당시 값이다
update public.menu_options set name = '바뀐이름' where id = public.zid('SAUCE');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000002', true);
select is(public.get_my_order((current_setting('zo.r1')::jsonb ->> 'orderId')::uuid) -> 'snapshot' -> 'items' -> 0 -> 'options' -> 0 ->> 'optionName', '파떡치소스', '옵션 이름이 바뀌어도 주문 기록은 당시 이름');
reset role;

select * from finish();
rollback;
