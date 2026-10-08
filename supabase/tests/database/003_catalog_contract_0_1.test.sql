-- 카탈로그 계약 catalog@0.1: 대표 메뉴 규칙, 리뷰 요약 고정값, storeIsOpen, catalog_revision, 제약조건
-- 근거: docs/contracts/catalog-contract-draft.md, 개발 명세 DB-004, DB-009, API-003
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

-- 오류 없이 끝나면 'NO ERROR', 오류가 나면 그 SQLSTATE를 돌려준다 (진단용)
create function public.test_errstate(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'NO ERROR';
exception when others then
  return sqlstate;
end;
$$;

-- 대표 메뉴를 가게 카드 목록에서 읽는 도우미 (역할은 호출 시점 그대로 사용)
create function public.test_rep(p_store uuid) returns jsonb language sql stable as $$
  select e -> 'representativeMenu'
  from jsonb_array_elements(public.list_stores(null, null, 50) -> 'items') e
  where (e ->> 'id')::uuid = p_store
$$;

-- ---------------------------------------------------------------- 리뷰 요약 · storeIsOpen
set local role anon;

select ok(not exists (
    select 1 from jsonb_array_elements(public.list_stores(null, null, 50) -> 'items') e
    where e -> 'reviewSummary' is distinct from '{"count":0,"averageCravingRating":null}'::jsonb),
  '리뷰 요약: 모든 가게 카드가 {count:0, averageCravingRating:null}');
select is(public.get_store('20000000-0000-4000-8000-000000000001') -> 'reviewSummary',
  '{"count":0,"averageCravingRating":null}'::jsonb, '리뷰 요약: 가게 상세도 같은 고정값');

select is((public.get_menu('30000000-0000-4000-8000-000000000101') ->> 'storeIsOpen'), 'true',
  'get_menu: 영업 중 가게의 메뉴는 storeIsOpen=true');
select is((public.get_menu('30000000-0000-4000-8000-000000000301') ->> 'storeIsOpen'), 'false',
  'get_menu: 영업 종료 가게의 메뉴는 storeIsOpen=false');

-- ---------------------------------------------------------------- 대표 메뉴 규칙
-- 가게: 테스트 치킨집(01). 메뉴 sort_order: 101=10, 102=20, 103=30(품절), 104=40
select is(public.test_rep('20000000-0000-4000-8000-000000000001'),
  '{"id":"30000000-0000-4000-8000-000000000101","name":"후라이드치킨","price":18000,"isSoldOut":false}'::jsonb,
  '대표 메뉴: 판매 가능한 첫 메뉴(정렬 순서)');
select ok((select array_agg(k order by k) from jsonb_object_keys(public.test_rep('20000000-0000-4000-8000-000000000001')) k)
  = array['id','isSoldOut','name','price'], '대표 메뉴: 응답 키');

reset role;
-- 첫 메뉴가 품절이면 다음 판매 가능 메뉴
update public.menus set is_sold_out = true where id = '30000000-0000-4000-8000-000000000101';
set local role anon;
select is(public.test_rep('20000000-0000-4000-8000-000000000001') ->> 'name', '양념치킨',
  '대표 메뉴: 첫 메뉴가 품절이면 다음 판매 가능 메뉴');

reset role;
-- 같은 sort_order면 이름순, 그다음 id
update public.menus set sort_order = 20 where id = '30000000-0000-4000-8000-000000000104';
set local role anon;
select is(public.test_rep('20000000-0000-4000-8000-000000000001') ->> 'name', '양념치킨',
  '대표 메뉴: sort_order가 같으면 이름순 (양념치킨 < 콜라 1.25L)');
reset role;
update public.menus set name = '가나다치킨' where id = '30000000-0000-4000-8000-000000000104';
set local role anon;
select is(public.test_rep('20000000-0000-4000-8000-000000000001') ->> 'name', '가나다치킨',
  '대표 메뉴: 이름이 앞서면 같은 sort_order에서 먼저 선택된다');

reset role;
-- 모두 품절: 같은 정렬의 첫 활성 메뉴를 품절 표시와 함께 (비활성 메뉴는 제외)
update public.menus set is_sold_out = true where store_id = '20000000-0000-4000-8000-000000000001';
set local role anon;
select is(public.test_rep('20000000-0000-4000-8000-000000000001') ->> 'name', '후라이드치킨',
  '대표 메뉴: 모두 품절이면 같은 정렬의 첫 활성 메뉴');
select is(public.test_rep('20000000-0000-4000-8000-000000000001') ->> 'isSoldOut', 'true',
  '대표 메뉴: 모두 품절이면 isSoldOut=true로 표시');
select ok(public.test_rep('20000000-0000-4000-8000-000000000001') ->> 'name' <> 'QA 비활성 메뉴',
  '대표 메뉴: 비활성 메뉴는 선택되지 않는다');

-- 활성 메뉴가 없으면 null
select ok(public.test_rep((select id from public.stores where name = '메뉴 준비 중인 가게')) = 'null'::jsonb,
  '대표 메뉴: 활성 메뉴가 없으면 null');

-- 로그인 사용자에게도 같은 값, 찜 목록에도 포함
reset role;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(public.test_rep('20000000-0000-4000-8000-000000000001') ->> 'name', '후라이드치킨',
  '[authenticated] 대표 메뉴: anon과 같은 규칙');

-- ---------------------------------------------------------------- catalog_revision
reset role;
create temp table rev as select catalog_revision as r from public.menus where id = '30000000-0000-4000-8000-000000000101';

update public.menu_options set additional_price = 2500 where id = '50000000-0000-4000-8000-000000001012';
select is((select catalog_revision from public.menus where id = '30000000-0000-4000-8000-000000000101'),
  (select r + 1 from rev), 'revision: 옵션 가격 변경 → 메뉴 revision +1');
update public.menu_option_groups set max_select = 3 where id = '40000000-0000-4000-8000-000000000102';
select is((select catalog_revision from public.menus where id = '30000000-0000-4000-8000-000000000101'),
  (select r + 2 from rev), 'revision: 옵션 그룹 변경 → +1');
insert into public.menu_options (group_id, name) values ('40000000-0000-4000-8000-000000000102', '신규 소스');
select is((select catalog_revision from public.menus where id = '30000000-0000-4000-8000-000000000101'),
  (select r + 3 from rev), 'revision: 옵션 추가 → +1');
update public.menus set base_price = base_price where id = '30000000-0000-4000-8000-000000000101';
select is((select catalog_revision from public.menus where id = '30000000-0000-4000-8000-000000000101'),
  (select r + 3 from rev), 'revision: 값이 같은 UPDATE는 revision을 올리지 않는다');
update public.menus set catalog_revision = 999 where id = '30000000-0000-4000-8000-000000000101';
select is((select catalog_revision from public.menus where id = '30000000-0000-4000-8000-000000000101'),
  (select r + 4 from rev), 'revision: 임의 값 지정은 현재값+1로 고정된다');
select is((select (public.get_menu('30000000-0000-4000-8000-000000000101') ->> 'catalogRevision')::bigint),
  (select r + 4 from rev), 'get_menu: 최신 catalogRevision을 반환');

-- ---------------------------------------------------------------- 제약조건
select ok(public.test_err(
    $$insert into public.menus (store_id, name, base_price) values ('20000000-0000-4000-8000-000000000001', 'x', 9007199254740992)$$, '23514'),
  '가격은 JS 안전 정수 범위를 넘을 수 없다');
select ok(public.test_err(
    $$insert into public.menus (store_id, name, base_price) values ('20000000-0000-4000-8000-000000000001', 'x', -1)$$, '23514'),
  '가격은 음수일 수 없다');
select ok(public.test_err(
    $$insert into public.menu_option_groups (menu_id, name, min_select, max_select) values ('30000000-0000-4000-8000-000000000101', 'x', 2, 1)$$, '23514'),
  '옵션 그룹: min_select <= max_select');
select ok(public.test_err(
    $$insert into public.menu_option_groups (menu_id, name, min_select, max_select) values ('30000000-0000-4000-8000-000000000101', 'x', 0, 0)$$, '23514'),
  '옵션 그룹: max_select >= 1');
-- 삭제가 막히는지 확인한다. ON DELETE RESTRICT의 SQLSTATE는 23001(RESTRICT 위반) 또는 23503(외래 키 위반).
-- 실패하면 실제 받은 코드가 진단 메시지(have:)로 출력된다 ('NO ERROR'면 삭제가 막히지 않은 것).
select matches(public.test_errstate($$delete from public.stores where id = '20000000-0000-4000-8000-000000000001'$$),
  '^(23001|23503)$', '메뉴가 있는 가게는 삭제할 수 없다(FK RESTRICT)');

select * from finish();
rollback;
