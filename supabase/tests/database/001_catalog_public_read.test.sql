-- 카탈로그 공개 조회: Guest(anon)와 로그인 사용자의 조회 범위, 숨김 컬럼, 쓰기 금지, 함수 권한
-- 근거: 개발 명세 SEC-002~004, SEC-010, DB-009
-- 실행: supabase test db  (supabase db reset으로 migration + seed가 적용된 DB 기준)
-- 개수 기대값은 seed에 하드코딩하지 않고, 가시성 규칙으로 직접 계산해서 비교한다.
create extension if not exists pgtap with schema extensions;

begin;
select * from no_plan();

-- 테스트 전용 도우미: 오류 SQLSTATE와 메시지 일부를 확인한다 (롤백으로 사라짐).
create function public.test_err(p_sql text, p_state text, p_msg text default null)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return sqlstate = p_state and (p_msg is null or sqlerrm like '%' || p_msg || '%');
end;
$$;

-- 기대값 (superuser로 계산)
create temp table exp as
select
  (select count(*) from public.categories where is_active)::int as cats,
  (select count(*) from public.stores s join public.categories c on c.id = s.category_id
    where s.is_active and c.is_active)::int as stores,
  (select count(*) from public.menus m join public.stores s on s.id = m.store_id
    join public.categories c on c.id = s.category_id
    where m.is_active and s.is_active and c.is_active)::int as menus,
  (select count(*) from public.menu_option_groups g join public.menus m on m.id = g.menu_id
    join public.stores s on s.id = m.store_id join public.categories c on c.id = s.category_id
    where g.is_active and m.is_active and s.is_active and c.is_active)::int as groups,
  (select count(*) from public.menu_options o join public.menu_option_groups g on g.id = o.group_id
    join public.menus m on m.id = g.menu_id join public.stores s on s.id = m.store_id
    join public.categories c on c.id = s.category_id
    where o.is_active and g.is_active and m.is_active and s.is_active and c.is_active)::int as options;
grant select on exp to public;

select ok((select stores from exp) >= 25, 'seed: 가시 가게가 25곳 이상이다');

-- ---------------------------------------------------------------- anon
set local role anon;

select ok(jsonb_array_length(public.list_categories()) = (select cats from exp),
  '[anon] list_categories: 활성 카테고리 수와 같다');
select ok(not (public.list_categories()::text like '%qa_inactive%'),
  '[anon] list_categories: 비활성 카테고리 제외');
select ok((select array_agg(k order by k) from jsonb_object_keys(public.list_categories() -> 0) k)
  = array['code','id','name','sortOrder'], '[anon] list_categories: 응답 키');

select ok(jsonb_array_length(public.list_stores(null, null, 50) -> 'items') = (select stores from exp),
  '[anon] list_stores: 가시 가게 수와 같다');
select ok(not (public.list_stores(null, null, 50)::text like '%"QA%'),
  '[anon] list_stores: 비활성 가게·비활성 카테고리 가게 제외');
select ok((public.list_stores(null, null, 50) ->> 'hasMore') = 'false'
  and public.list_stores(null, null, 50) -> 'nextCursor' = 'null'::jsonb,
  '[anon] list_stores: 마지막 페이지는 hasMore=false, nextCursor=null');
select ok((select array_agg(k order by k) from jsonb_object_keys(public.list_stores(null, null, 50) -> 'items' -> 0) k)
  = array['category','id','imageRef','isFavorite','isOpen','isRecommended','name','representativeMenu','reviewSummary'],
  '[anon] list_stores: 카드 응답 키');

-- 페이지네이션: 3개씩 끝까지 따라가면 중복·누락 없이 전체와 같은 순서
do $$
declare
  v_all jsonb := public.list_stores(null, null, 50) -> 'items';
  v_seen text[] := '{}';
  v_cursor text := null;
  v_page jsonb;
  v_pages int := 0;
begin
  loop
    v_page := public.list_stores(null, v_cursor, 3);
    v_seen := v_seen || array(select e ->> 'id' from jsonb_array_elements(v_page -> 'items') e);
    v_cursor := v_page ->> 'nextCursor';
    v_pages := v_pages + 1;
    exit when v_cursor is null or v_pages > 100;
  end loop;
  perform ok(v_seen = array(select e ->> 'id' from jsonb_array_elements(v_all) e),
    '[anon] list_stores: 3개씩 순회하면 전체와 같은 순서, 중복·누락 없음');
  perform ok(v_pages = ceil(jsonb_array_length(v_all) / 3.0)::int,
    '[anon] list_stores: 페이지 수가 올림(전체/3)');
end $$;

select ok((select array_agg(e ->> 'name' order by e ->> 'name')
  from jsonb_array_elements(public.list_stores('10000000-0000-4000-8000-000000000001', null, 50) -> 'items') e)
  @> array['테스트 치킨집'], '[anon] list_stores: 카테고리 필터(치킨)');
select ok(jsonb_array_length(public.list_stores('10000000-0000-4000-8000-000000000099', null, 50) -> 'items') = 0,
  '[anon] list_stores: 비활성 카테고리 필터는 빈 목록');

select ok(public.test_err('select public.list_stores(null, null, 0)', 'P0001', 'INVALID_INPUT'),
  '[anon] list_stores: pageSize 0 → INVALID_INPUT');
select ok(public.test_err('select public.list_stores(null, null, 51)', 'P0001', 'INVALID_INPUT'),
  '[anon] list_stores: pageSize 51 → INVALID_INPUT');
select ok(public.test_err($$select public.list_stores(null, 'not-a-cursor', 20)$$, 'P0001', 'INVALID_INPUT'),
  '[anon] list_stores: 잘못된 cursor → INVALID_INPUT');

select ok((select array_agg(m ->> 'name') from jsonb_array_elements(
    public.get_store('20000000-0000-4000-8000-000000000001') -> 'menus') m)
  = array['후라이드치킨','양념치킨','반반치킨','콜라 1.25L'],
  '[anon] get_store: 활성 메뉴만, 정렬 순서, 품절 포함(비활성 제외)');
select ok((select array_agg(k order by k) from jsonb_object_keys(
    public.get_store('20000000-0000-4000-8000-000000000001')) k)
  = array['category','description','id','imageRef','isFavorite','isOpen','isRecommended','menus','name','reviewSummary'],
  '[anon] get_store: 응답 키');

select ok(public.test_err($$select public.get_store('20000000-0000-4000-8000-000000000098')$$, 'P0001', 'RESOURCE_NOT_FOUND'),
  '[anon] get_store: 비활성 가게 → RESOURCE_NOT_FOUND');
select ok(public.test_err($$select public.get_store('20000000-0000-4000-8000-000000000099')$$, 'P0001', 'RESOURCE_NOT_FOUND'),
  '[anon] get_store: 비활성 카테고리의 가게 → RESOURCE_NOT_FOUND');
select ok(public.test_err($$select public.get_store('29999999-0000-4000-8000-000000000000')$$, 'P0001', 'RESOURCE_NOT_FOUND'),
  '[anon] get_store: 없는 id → RESOURCE_NOT_FOUND');

select ok((public.get_menu('30000000-0000-4000-8000-000000000101') ->> 'price')::int = 18000,
  '[anon] get_menu: 가격');
select ok((select array_agg(g ->> 'name' || ':' || (g ->> 'minSelect') || '-' || (g ->> 'maxSelect'))
    from jsonb_array_elements(public.get_menu('30000000-0000-4000-8000-000000000101') -> 'optionGroups') g)
  = array['부위 선택:1-1','소스 추가:0-2'], '[anon] get_menu: 활성 그룹만(비활성 그룹 제외), min/max');
select ok((select array_agg(o ->> 'name' || ':' || (o ->> 'isSoldOut'))
    from jsonb_array_elements(public.get_menu('30000000-0000-4000-8000-000000000101') -> 'optionGroups' -> 1 -> 'options') o)
  = array['양념소스:false','치즈소스:true'], '[anon] get_menu: 품절 옵션은 표시, 비활성 옵션 제외');
select ok(public.get_menu('30000000-0000-4000-8000-000000000104') -> 'optionGroups' = '[]'::jsonb,
  '[anon] get_menu: 옵션 없는 메뉴는 빈 배열');
select ok(jsonb_typeof(public.get_menu('30000000-0000-4000-8000-000000000101') -> 'catalogRevision') = 'number'
  and jsonb_typeof(public.get_menu('30000000-0000-4000-8000-000000000101') -> 'price') = 'number',
  '[anon] get_menu: 가격·revision은 숫자');
select ok((select array_agg(k order by k) from jsonb_object_keys(
    public.get_menu('30000000-0000-4000-8000-000000000101')) k)
  = array['catalogRevision','description','id','imageRef','isSoldOut','name','optionGroups','price','storeId','storeIsOpen'],
  '[anon] get_menu: 응답 키');

select ok(public.test_err($$select public.get_menu('30000000-0000-4000-8000-000000000105')$$, 'P0001', 'RESOURCE_NOT_FOUND'),
  '[anon] get_menu: 비활성 메뉴 → RESOURCE_NOT_FOUND');
select ok(public.test_err($$select public.get_menu('30000000-0000-4000-8000-000000009801')$$, 'P0001', 'RESOURCE_NOT_FOUND'),
  '[anon] get_menu: 비활성 가게의 메뉴 → RESOURCE_NOT_FOUND');
select ok(public.test_err($$select public.get_menu('30000000-0000-4000-8000-000000009901')$$, 'P0001', 'RESOURCE_NOT_FOUND'),
  '[anon] get_menu: 비활성 카테고리 가게의 메뉴 → RESOURCE_NOT_FOUND');
select ok(public.test_err($$select public.get_menu('39999999-0000-4000-8000-000000000000')$$, 'P0001', 'RESOURCE_NOT_FOUND'),
  '[anon] get_menu: 없는 id → RESOURCE_NOT_FOUND');

-- 직접 SELECT (Data API 동등): 허용 컬럼만, 가시 행만
select ok((select count(*) from public.categories) = (select cats from exp), '[anon] 직접 SELECT categories 행 수');
select ok((select count(*) from public.stores) = (select stores from exp), '[anon] 직접 SELECT stores 행 수');
select ok((select count(*) from public.menus) = (select menus from exp), '[anon] 직접 SELECT menus 행 수');
select ok((select count(*) from public.menu_option_groups) = (select groups from exp), '[anon] 직접 SELECT menu_option_groups 행 수');
select ok((select count(*) from public.menu_options) = (select options from exp), '[anon] 직접 SELECT menu_options 행 수');

select ok(public.test_err('select source_ref from public.stores', '42501', 'permission denied'),
  '[anon] stores.source_ref 조회 금지');
select ok(public.test_err('select source_type from public.stores', '42501', 'permission denied'),
  '[anon] stores.source_type 조회 금지');
select ok(public.test_err('select popularity_score from public.menus', '42501', 'permission denied'),
  '[anon] menus.popularity_score 조회 금지');
select ok(public.test_err('select * from public.stores', '42501', 'permission denied'),
  '[anon] select * 금지(공개 컬럼만 GRANT)');

select ok(public.test_err($$insert into public.categories (code, name) values ('x', 'x')$$, '42501'),
  '[anon] categories INSERT 금지');
select ok(public.test_err($$update public.categories set name = 'hacked'$$, '42501'), '[anon] categories UPDATE 금지');
select ok(public.test_err($$update public.stores set name = 'hacked'$$, '42501'), '[anon] stores UPDATE 금지');
select ok(public.test_err($$update public.menus set base_price = 0$$, '42501'), '[anon] menus UPDATE 금지');
select ok(public.test_err($$update public.menu_option_groups set name = 'hacked'$$, '42501'), '[anon] menu_option_groups UPDATE 금지');
select ok(public.test_err($$update public.menu_options set additional_price = 0$$, '42501'), '[anon] menu_options UPDATE 금지');
select ok(public.test_err('delete from public.stores', '42501'), '[anon] stores DELETE 금지');
select ok(public.test_err('delete from public.menus', '42501'), '[anon] menus DELETE 금지');
select ok(public.test_err('select private.apply_catalog_revision()', '42501'), '[anon] private 함수 호출 금지');

-- ---------------------------------------------------------------- authenticated
reset role;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select ok(jsonb_array_length(public.list_categories()) = (select cats from exp),
  '[authenticated] list_categories: anon과 같은 범위');
select ok(jsonb_array_length(public.list_stores(null, null, 50) -> 'items') = (select stores from exp),
  '[authenticated] list_stores: anon과 같은 범위');
select ok((select count(*) from public.menus) = (select menus from exp), '[authenticated] 직접 SELECT menus 행 수');
select ok(public.test_err('select source_ref from public.stores', '42501', 'permission denied'),
  '[authenticated] stores.source_ref 조회 금지');
select ok(public.test_err($$update public.stores set name = 'hacked'$$, '42501'), '[authenticated] stores UPDATE 금지');
select ok(public.test_err($$update public.menus set base_price = 0$$, '42501'), '[authenticated] menus UPDATE 금지');
select ok(public.test_err($$update public.menu_options set additional_price = 0$$, '42501'), '[authenticated] menu_options UPDATE 금지');
select ok(public.test_err('delete from public.menu_options', '42501'), '[authenticated] menu_options DELETE 금지');
select ok(public.test_err('select private.apply_catalog_revision()', '42501'), '[authenticated] private 함수 호출 금지');

-- ---------------------------------------------------------------- 권한 메타데이터 (superuser)
reset role;

-- 확장 프로그램(pgTAP 등)이 만든 함수는 제외한다 (deptype 'e').
select ok(not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.proname not like 'test\_%'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and coalesce(p.proacl::text, '') ~ '(^|[{,])=X'),
  '어떤 함수도 PUBLIC에 EXECUTE를 열어두지 않았다');
select ok(not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and coalesce(p.proacl::text, '') ~ '(anon|authenticated)='),
  'private 스키마 함수는 anon/authenticated에게 열려 있지 않다');
-- 조회 RPC를 추가할 때(검색·홈 등) 이 목록도 함께 갱신한다.
select is((select array_agg(p.proname::text order by p.proname) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname not like 'test\_%'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and coalesce(p.proacl::text, '') ~ 'anon=X'),
  array['get_menu','get_store','list_categories','list_stores'],
  'Guest(anon)가 실행할 수 있는 public 함수는 조회 RPC뿐이다');
-- 테이블 단위 권한(relacl)만 본다. 컬럼 단위 SELECT는 pg_attribute.attacl에 따로 있다.
select ok(not exists (
    select 1 from pg_class c cross join lateral aclexplode(c.relacl) a
    where c.relnamespace = 'public'::regnamespace
      and c.relname in ('categories','stores','menus','menu_option_groups','menu_options')
      and a.grantee in (0, 'anon'::regrole::oid, 'authenticated'::regrole::oid)),
  '카탈로그 테이블에는 anon/authenticated/PUBLIC 대상 테이블 단위 권한이 없다(컬럼 SELECT만)');
select ok((select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'
    and relname in ('categories','stores','menus','menu_option_groups','menu_options','profiles','store_favorites')
    and relrowsecurity) = 7, '카탈로그·프로필·찜 테이블 모두 RLS 활성화');

select * from finish();
rollback;
