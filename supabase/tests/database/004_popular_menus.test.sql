-- 홈 "지금 많이 찾는 메뉴": list_popular_menus
-- 근거: docs/contracts/home-search-contract-draft.md 4.4절·6.1절 (서정 승인 2026-10-08), 영업 종료 가게 제외(혜지 확인 2026-10-14)
-- seed.sql 3부의 인기 표시(노출 12개, 제외 3개)를 전제로 한다. seed 값을 바꾸면 이 파일의 기대 순서도 함께 바꾼다.
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

-- 응답에서 메뉴 id만 순서대로 뽑는다 (호출한 역할 권한으로 실행)
create function public.test_popular_ids(p_limit int default 10) returns uuid[] language sql stable as $$
  select coalesce(array_agg((e ->> 'id')::uuid order by ord), '{}')
  from jsonb_array_elements(public.list_popular_menus(p_limit)) with ordinality as t(e, ord)
$$;

-- seed의 가상 메뉴 id (md5 규칙은 seed.sql 2부와 같다)
create temp table pm as select
  '30000000-0000-4000-8000-000000000701'::uuid as cheeseburger,        -- 95
  md5('dev-seed-v1:menu:ca-fried')::uuid       as ca_fried,            -- 90
  md5('dev-seed-v1:menu:cm-malatang')::uuid    as malatang,            -- 85
  md5('dev-seed-v1:menu:bm-rose')::uuid        as rose,                -- 80
  '30000000-0000-4000-8000-000000000101'::uuid as fried,               -- 75
  md5('dev-seed-v1:menu:kg-pork')::uuid        as pork_gukbap,         -- 70
  md5('dev-seed-v1:menu:cf-latte')::uuid       as latte,               -- 65
  '30000000-0000-4000-8000-000000000401'::uuid as kimchi,              -- 60 (아메리카노와 같은 점수, 이름이 앞섬)
  '30000000-0000-4000-8000-000000000801'::uuid as americano,           -- 60
  md5('dev-seed-v1:menu:jr-tonkotsu')::uuid    as tonkotsu,            -- 55
  md5('dev-seed-v1:menu:bg-classic')::uuid     as classic,             -- 50
  '30000000-0000-4000-8000-000000000802'::uuid as cheesecake,          -- 45
  '30000000-0000-4000-8000-000000000103'::uuid as soldout_menu,        -- 100, 품절
  '30000000-0000-4000-8000-000000000105'::uuid as inactive_menu,       -- 99, 비활성
  '30000000-0000-4000-8000-000000000301'::uuid as closed_store_menu,   -- 98, 영업 종료 가게
  '30000000-0000-4000-8000-000000009801'::uuid as hidden_store_menu,   -- 비활성 가게의 메뉴
  '30000000-0000-4000-8000-000000009901'::uuid as hidden_category_menu;-- 비활성 카테고리 가게의 메뉴
grant select on pm to public;

-- seed 확인: 인기 표시 15개, 개수는 기존 그대로 (가게 27, 메뉴 82)
select is((select count(*)::int from public.menus where is_popular), 15, 'seed: 인기 표시 메뉴는 15개(노출 12 + 제외 3)');
select is((select count(*)::int from public.stores), 27, 'seed: 가게 수는 그대로 27');
select is((select count(*)::int from public.menus), 82, 'seed: 메뉴 수는 그대로 82');

-- ---------------------------------------------------------------- anon
set local role anon;

select ok(public.test_popular_ids() = array[
    (select cheeseburger from pm), (select ca_fried from pm), (select malatang from pm), (select rose from pm),
    (select fried from pm), (select pork_gukbap from pm), (select latte from pm), (select kimchi from pm),
    (select americano from pm), (select tonkotsu from pm)],
  '[anon] 기본(10개): 점수 내림차순, 같은 점수(60)는 이름순(김치찌개 → 아메리카노)');
select is(cardinality(public.test_popular_ids()), 10, '[anon] 기본 개수는 10개');
select is(cardinality(public.test_popular_ids(null)), 10, '[anon] p_limit이 null이면 기본 10개');
select is(cardinality(public.test_popular_ids(3)), 3, '[anon] p_limit=3이면 3개');
select ok(public.test_popular_ids(3) = array[(select cheeseburger from pm), (select ca_fried from pm), (select malatang from pm)],
  '[anon] p_limit=3은 점수가 높은 앞 3개');
select is(cardinality(public.test_popular_ids(20)), 12, '[anon] p_limit=20이면 노출 대상 12개 전부');
select ok((public.test_popular_ids(20))[11:12] = array[(select classic from pm), (select cheesecake from pm)],
  '[anon] 11·12번째는 점수 50, 45 (기본 10개 상한에 잘려 나가던 것)');

-- 제외 규칙 (p_limit=20으로 봐도 없어야 한다)
select ok(not ((select soldout_menu from pm) = any (public.test_popular_ids(20))), '[anon] 품절 메뉴 제외 (점수가 가장 높아도)');
select ok(not ((select inactive_menu from pm) = any (public.test_popular_ids(20))), '[anon] 비활성 메뉴 제외');
select ok(not ((select closed_store_menu from pm) = any (public.test_popular_ids(20))), '[anon] 영업 종료 가게의 메뉴 제외');

-- 응답 모양: 점수·순위 숫자가 없다
select ok((select array_agg(k order by k) from jsonb_object_keys(public.list_popular_menus() -> 0) k)
  = array['id','imageRef','isSoldOut','name','price','store'], '[anon] 응답 키는 MenuCardDto와 같다');
select ok((select array_agg(k order by k) from jsonb_object_keys(public.list_popular_menus() -> 0 -> 'store') k)
  = array['id','isOpen','name'], '[anon] store 키는 id, name, isOpen');
select ok(public.list_popular_menus(20)::text !~* '(popular|score|rank|order_count|view_count|orders|views)',
  '[anon] 응답 어디에도 popular/score/rank/주문 수/조회 수 같은 필드가 없다');
select ok(not exists (
    select 1 from jsonb_array_elements(public.list_popular_menus(20)) e
    where jsonb_typeof(e -> 'price') <> 'number' or (e ->> 'isSoldOut') <> 'false' or (e -> 'store' ->> 'isOpen') <> 'true'),
  '[anon] 모든 항목: 가격은 숫자, isSoldOut=false, store.isOpen=true');
select ok((public.list_popular_menus(1) -> 0 ->> 'name') = '치즈버거'
  and (public.list_popular_menus(1) -> 0 -> 'store' ->> 'name') = '테스트 버거집',
  '[anon] 1위 항목의 이름과 가게 이름');

-- 입력 검사
select ok(public.test_err('select public.list_popular_menus(0)', 'P0001', 'INVALID_INPUT'), '[anon] p_limit 0 → INVALID_INPUT');
select ok(public.test_err('select public.list_popular_menus(21)', 'P0001', 'INVALID_INPUT'), '[anon] p_limit 21 → INVALID_INPUT');
select ok(public.test_err('select public.list_popular_menus(-1)', 'P0001', 'INVALID_INPUT'), '[anon] p_limit -1 → INVALID_INPUT');

-- 앱이 인기 컬럼을 직접 읽을 수는 없다 (함수로만 순서가 결정된다)
select ok(public.test_err('select is_popular from public.menus', '42501', 'permission denied'), '[anon] menus.is_popular 직접 조회 금지');
select ok(public.test_err('select popularity_score from public.menus', '42501', 'permission denied'), '[anon] menus.popularity_score 직접 조회 금지');

-- ---------------------------------------------------------------- authenticated
reset role;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(cardinality(public.test_popular_ids(20)), 12, '[authenticated] 호출할 수 있고 노출 대상 12개가 나온다');
select is(cardinality(public.test_popular_ids()), 10, '[authenticated] 기본 10개');
select ok(public.test_popular_ids() = array[
    (select cheeseburger from pm), (select ca_fried from pm), (select malatang from pm), (select rose from pm),
    (select fried from pm), (select pork_gukbap from pm), (select latte from pm), (select kimchi from pm),
    (select americano from pm), (select tonkotsu from pm)],
  '[authenticated] 순서도 anon과 같다');
select ok(public.list_popular_menus(20)::text !~* '(popular|score|rank)', '[authenticated] 응답에 점수·순위 필드 없음');

-- ---------------------------------------------------------------- 권한·함수 설정 (superuser)
reset role;
select ok(has_function_privilege('anon', 'public.list_popular_menus(integer)', 'execute'), 'anon은 list_popular_menus를 실행할 수 있다');
select ok(has_function_privilege('authenticated', 'public.list_popular_menus(integer)', 'execute'), 'authenticated도 실행할 수 있다');
select ok(not exists (
    select 1 from pg_proc p where p.proname = 'list_popular_menus' and coalesce(p.proacl::text, '') ~ '(^|[{,])=X'),
  'PUBLIC에는 실행 권한을 열어두지 않았다');
select ok((select p.prosecdef from pg_proc p where p.proname = 'list_popular_menus'), '앱이 못 읽는 컬럼을 쓰므로 SECURITY DEFINER다');
select ok((select p.proconfig @> array['search_path=""'] from pg_proc p where p.proname = 'list_popular_menus'),
  'DEFINER 함수는 search_path를 빈 값으로 고정했다');

-- ---------------------------------------------------------------- 상태가 바뀌면 따라 바뀐다 (롤백됨)
-- 비활성 가게·비활성 카테고리 가게의 메뉴를 인기로 표시해도 나오지 않는다
update public.menus set is_popular = true, popularity_score = 200
  where id in ((select hidden_store_menu from pm), (select hidden_category_menu from pm));
select ok(not exists (
    select 1 from unnest(public.test_popular_ids(20)) as u(id)
    where u.id in ((select hidden_store_menu from pm), (select hidden_category_menu from pm))),
  '비활성 가게·비활성 카테고리 가게의 메뉴는 인기로 표시돼도 제외');

-- 노출 중이던 메뉴가 품절이 되면 빠지고, 다음 순위가 올라온다 (기본 10개를 채운다)
update public.menus set is_sold_out = true where id = (select cheeseburger from pm);
select ok(not ((select cheeseburger from pm) = any (public.test_popular_ids(20))), '품절이 된 메뉴는 빠진다');
select ok((public.test_popular_ids())[10] = (select classic from pm), '품절로 한 칸 빠지면 11번째(클래식버거)가 10번째로 올라온다');

-- 점수가 올라가면 이름과 상관없이 앞으로 온다 (같은 점수 60이던 아메리카노를 61로 올리면 김치찌개보다 먼저)
update public.menus set popularity_score = 61 where id = (select americano from pm);
select ok(array_position(public.test_popular_ids(20), (select americano from pm))
    < array_position(public.test_popular_ids(20), (select kimchi from pm)),
  '점수가 높으면(61) 이름이 뒤여도 먼저 나온다');

-- 가게가 영업 종료가 되면 그 가게의 인기 메뉴가 모두 빠진다
update public.stores set is_open = false where id = (select store_id from public.menus where id = (select ca_fried from pm));
select ok(not ((select ca_fried from pm) = any (public.test_popular_ids(20))), '가게가 영업 종료가 되면 그 가게의 메뉴는 빠진다');
update public.stores set is_open = true where id = (select store_id from public.menus where id = (select ca_fried from pm));

-- 메뉴 비활성, 가게 비활성, 카테고리 비활성
update public.menus set is_active = false where id = (select rose from pm);
select ok(not ((select rose from pm) = any (public.test_popular_ids(20))), '메뉴가 비활성이 되면 빠진다');
update public.stores set is_active = false where id = (select store_id from public.menus where id = (select malatang from pm));
select ok(not ((select malatang from pm) = any (public.test_popular_ids(20))), '가게가 비활성이 되면 빠진다');
update public.categories set is_active = false where id = (
  select s.category_id from public.stores s join public.menus m on m.store_id = s.id where m.id = (select latte from pm));
select ok(not ((select latte from pm) = any (public.test_popular_ids(20))), '카테고리가 비활성이 되면 그 가게의 메뉴는 빠진다');

-- 인기 표시가 하나도 없으면 빈 배열
update public.menus set is_popular = false;
select is(public.list_popular_menus(), '[]'::jsonb, '인기 메뉴가 없으면 빈 배열(오류 아님)');

select * from finish();
rollback;
