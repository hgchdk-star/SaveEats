-- 가게 안 메뉴 그룹(store_menu_groups, store_menu_group_items)과 get_store의 menuGroups
-- 테스트 데이터는 롤백으로 사라진다.
create extension if not exists pgtap with schema extensions;

begin;
select * from no_plan();

create function public.zid(p text) returns uuid language sql immutable as $$ select md5(p)::uuid $$;
create function public.zq(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlstate || ':' || sqlerrm;
end;
$$;
-- get_store 응답에서 그룹 이름 순서와 메뉴 이름 순서를 읽기 쉽게 만든다
create function public.zgroups(p_store uuid) returns text language sql as $$
  select coalesce(string_agg(g ->> 'name' || '=' || (
           select string_agg(m.name, ',' order by o.ord)
           from jsonb_array_elements_text(g -> 'menuIds') with ordinality as o (id, ord)
           join public.menus m on m.id = o.id::uuid), ' | ' order by gi.ord), '')
  from jsonb_array_elements(public.get_store(p_store) -> 'menuGroups') with ordinality as gi (g, ord)
$$;

-- ---------------------------------------------------------------- 픽스처 (superuser)
insert into public.categories (id, code, name, sort_order) values (public.zid('CA'), 'zz-grp', '그룹분류', 99);
insert into public.stores (id, category_id, name) values
  (public.zid('S1'), public.zid('CA'), '그룹가게'),
  (public.zid('S2'), public.zid('CA'), '다른가게'),
  (public.zid('S3'), public.zid('CA'), '그룹없는가게');
-- S1 메뉴: 정렬 순서는 sort_order → 이름 → id
insert into public.menus (id, store_id, name, base_price, sort_order, is_active, is_sold_out) values
  (public.zid('M1'), public.zid('S1'), 'M1', 1000, 10, true, false),
  (public.zid('M2'), public.zid('S1'), 'M2', 2000, 20, true, false),
  (public.zid('M3'), public.zid('S1'), 'M3', 3000, 30, false, false),   -- 비활성(숨김) 메뉴
  (public.zid('M4'), public.zid('S1'), 'M4', 4000, 40, true, false),
  (public.zid('M5'), public.zid('S1'), 'M5', 5000, 50, true, true),     -- 품절 메뉴는 보인다
  (public.zid('M6'), public.zid('S1'), 'M6', 6000, 60, true, false);     -- 어느 그룹에도 없는 메뉴
insert into public.menus (id, store_id, name, base_price, sort_order) values
  (public.zid('N1'), public.zid('S2'), 'N1', 1000, 1),
  (public.zid('P1'), public.zid('S3'), 'P1', 1000, 1);

insert into public.store_menu_groups (id, store_id, name, source_name, sort_order, is_active) values
  (public.zid('G1'), public.zid('S1'), '첫 그룹', '[원본] 첫 그룹', 0, true),
  (public.zid('G2'), public.zid('S1'), '둘째 그룹', null, 1, true),
  (public.zid('G3'), public.zid('S1'), '꺼진 그룹', null, 2, false),
  (public.zid('G4'), public.zid('S1'), '겹침 그룹', null, 3, true),
  (public.zid('G5'), public.zid('S1'), '숨긴 메뉴만 있던 그룹', null, 4, true);
insert into public.store_menu_group_items (group_id, store_id, menu_id, sort_order) values
  (public.zid('G1'), public.zid('S1'), public.zid('M2'), 0),   -- 그룹 안 순서: M2 먼저, M1 나중 (메뉴 sort_order와 다르다)
  (public.zid('G1'), public.zid('S1'), public.zid('M1'), 1),
  (public.zid('G2'), public.zid('S1'), public.zid('M3'), 0),   -- 비활성 메뉴
  (public.zid('G2'), public.zid('S1'), public.zid('M4'), 1),
  (public.zid('G2'), public.zid('S1'), public.zid('M5'), 2),
  (public.zid('G3'), public.zid('S1'), public.zid('M1'), 0),
  (public.zid('G4'), public.zid('S1'), public.zid('M1'), 0),   -- M1은 G1과 G4에 모두 속한다
  (public.zid('G5'), public.zid('S1'), public.zid('M3'), 0);

-- ================================================================ 구조
select is((select count(*)::int from information_schema.tables where table_schema = 'public' and table_name in ('store_menu_groups', 'store_menu_group_items')), 2, '두 테이블이 있다');
select is((select relrowsecurity from pg_class where oid = 'public.store_menu_groups'::regclass), true, 'store_menu_groups RLS 켜짐');
select is((select relrowsecurity from pg_class where oid = 'public.store_menu_group_items'::regclass), true, 'store_menu_group_items RLS 켜짐');
select is(public.zq($$insert into public.store_menu_group_items (group_id, store_id, menu_id, sort_order) values (public.zid('G1'), public.zid('S1'), public.zid('M1'), 5)$$), '23505:duplicate key value violates unique constraint "store_menu_group_items_pkey"', '같은 그룹에 같은 메뉴를 두 번 넣을 수 없다');
select matches(public.zq($$insert into public.store_menu_group_items (group_id, store_id, menu_id, sort_order) values (public.zid('G1'), public.zid('S1'), public.zid('N1'), 5)$$), '^23503:', '다른 가게의 메뉴는 그룹에 넣을 수 없다');
select matches(public.zq($$insert into public.store_menu_group_items (group_id, store_id, menu_id, sort_order) values (public.zid('G1'), public.zid('S2'), public.zid('M4'), 5)$$), '^23503:', '그룹의 가게와 다른 store_id로는 넣을 수 없다');
select matches(public.zq($$insert into public.store_menu_groups (store_id, name, sort_order) values (public.zid('S1'), '   ', 9)$$), '^23514:', '빈 이름은 안 된다');
select matches(public.zq($$insert into public.store_menu_groups (store_id, name, sort_order) values (public.zid('S1'), '음수 순서', -1)$$), '^23514:', '음수 순서는 안 된다');
select matches(public.zq($$delete from public.stores where id = public.zid('S1')$$), '^23503:', '그룹이 있는 가게는 지워지지 않는다(RESTRICT)');

-- ================================================================ 권한 · RLS (Guest)
set local role anon;
select is((select count(*)::int from public.store_menu_groups), 4, 'Guest는 활성 그룹만 본다(꺼진 그룹 제외)');
select is((select count(*)::int from public.store_menu_group_items), 7, 'Guest는 활성 그룹의 연결만 본다');
select matches(public.zq($$select source_name from public.store_menu_groups$$), '^42501:', 'Guest는 원본 이름(source_name)을 읽을 수 없다');
select matches(public.zq($$insert into public.store_menu_groups (store_id, name, sort_order) values (public.zid('S1'), 'x', 1)$$), '^42501:', 'Guest는 그룹을 만들 수 없다');
select matches(public.zq($$update public.store_menu_groups set name = 'x'$$), '^42501:', 'Guest는 그룹을 바꿀 수 없다');
select matches(public.zq($$delete from public.store_menu_group_items$$), '^42501:', 'Guest는 연결을 지울 수 없다');

-- ================================================================ get_store (Guest)
select is(public.zgroups(public.zid('S1')), '첫 그룹=M2,M1 | 둘째 그룹=M4,M5 | 겹침 그룹=M1', '그룹 순서·그룹 안 메뉴 순서가 데이터대로이고, 비활성 메뉴·꺼진 그룹·보이는 메뉴가 없는 그룹은 빠진다');
select is((select jsonb_array_length(public.get_store(public.zid('S1')) -> 'menuGroups')), 3, '보이는 그룹은 3개');
select is((select string_agg(x ->> 'name', ',' order by o) from jsonb_array_elements(public.get_store(public.zid('S1')) -> 'menus') with ordinality as t (x, o)), 'M1,M2,M4,M5,M6', 'menus는 기존대로 활성 메뉴 전체(sort_order 순), 한 메뉴는 한 번만');
select is((select count(*)::int from jsonb_array_elements(public.get_store(public.zid('S1')) -> 'menus') x where x ->> 'name' = 'M1'), 1, '여러 그룹에 속한 메뉴 본체는 복제되지 않는다');
select is((select count(*)::int from jsonb_array_elements(public.get_store(public.zid('S1')) -> 'menuGroups') g, jsonb_array_elements_text(g -> 'menuIds') id where id::uuid = public.zid('M1')), 2, 'M1은 두 그룹의 menuIds에 모두 들어 있다');
select is((select count(*)::int from jsonb_array_elements(public.get_store(public.zid('S1')) -> 'menus') x where (x ->> 'id')::uuid not in (select id::uuid from jsonb_array_elements(public.get_store(public.zid('S1')) -> 'menuGroups') g, jsonb_array_elements_text(g -> 'menuIds') id)), 1, '그룹에 없는 활성 메뉴(M6)는 menus에 남아 있어 앱이 찾아낼 수 있다');
select is(public.get_store(public.zid('S3')) -> 'menuGroups', '[]'::jsonb, '그룹이 없는 가게는 menuGroups가 빈 배열');
select is(public.get_store(public.zid('S2')) -> 'menuGroups', '[]'::jsonb, '다른 가게의 그룹은 섞이지 않는다');
select is((select count(*)::int from jsonb_object_keys(public.get_store(public.zid('S1'))) k where k in ('id','name','description','imageRef','isOpen','isRecommended','category','reviewSummary','menus','menuGroups','isFavorite')), 11, '기존 필드는 그대로이고 menuGroups만 늘었다');
select is((public.get_store(public.zid('S1')) -> 'menuGroups' -> 0) ?& array['id', 'name', 'menuIds'], true, '그룹 항목은 id·name·menuIds를 가진다');
select is((select (public.get_store(public.zid('S1')) -> 'menuGroups' -> 0) ? 'sourceName'), false, '원본 이름은 응답에 없다');

-- ================================================================ 로그인 사용자도 같다
reset role;
insert into auth.users (id) values ('aaaaaaaa-0000-4000-8000-0000000000a1');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.store_menu_groups), 4, '로그인 사용자도 활성 그룹만 본다');
select is((select count(*)::int from public.store_menu_group_items), 7, '로그인 사용자도 활성 그룹의 연결만 본다');
select matches(public.zq($$select source_name from public.store_menu_groups$$), '^42501:', '로그인 사용자도 원본 이름을 읽을 수 없다');
select matches(public.zq($$insert into public.store_menu_groups (store_id, name, sort_order) values (public.zid('S1'), 'x', 1)$$), '^42501:', '로그인 사용자도 그룹을 만들 수 없다');
reset role;
select set_config('request.jwt.claims', '', true);  -- 이후 Guest 확인을 위해 로그인 정보를 비운다

-- ================================================================ 변경이 응답에 반영되는지 (superuser)
-- 슈퍼유저 호출은 RLS를 건너뛰므로 Guest 관점으로 본다
update public.store_menu_groups set is_active = false where id = public.zid('G4');
set local role anon;
select is((select jsonb_array_length(public.get_store(public.zid('S1')) -> 'menuGroups')), 2, '그룹을 끄면 응답에서 빠진다');
reset role;
update public.menus set is_active = true where id = public.zid('M3');
set local role anon;
select is(public.zgroups(public.zid('S1')), '첫 그룹=M2,M1 | 둘째 그룹=M3,M4,M5 | 숨긴 메뉴만 있던 그룹=M3', '비활성이던 메뉴를 켜면 그룹 안 순서대로 나타나고, 그 메뉴만 있던 그룹도 다시 보인다');
reset role;
delete from public.menus where id = public.zid('M5');
select is((select count(*)::int from public.store_menu_group_items where menu_id = public.zid('M5')), 0, '메뉴를 지우면 그 연결 행도 함께 지워진다');
delete from public.store_menu_groups where id = public.zid('G2');
select is((select count(*)::int from public.store_menu_group_items where group_id = public.zid('G2')), 0, '그룹을 지우면 연결 행이 함께 지워진다');
select is((select count(*)::int from public.menus where store_id = public.zid('S1')), 5, '그룹·연결을 지워도 메뉴 본체는 남는다');

-- ================================================================ 함수 속성
select is((select p.prosecdef from pg_proc p where p.oid = 'public.get_store(uuid)'::regprocedure), false, 'get_store는 SECURITY INVOKER 그대로');
select is((select p.proconfig from pg_proc p where p.oid = 'public.get_store(uuid)'::regprocedure), array['search_path=""'], 'get_store search_path 고정 그대로');
select is(has_function_privilege('anon', 'public.get_store(uuid)', 'execute'), true, 'Guest는 get_store를 실행할 수 있다');

select * from finish();
rollback;
