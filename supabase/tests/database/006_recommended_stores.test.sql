-- 홈 추천 가게: list_recommended_stores
-- 근거: docs/contracts/home-search-contract-draft.md 4.2절, 영업 종료 가게는 제외하지 않음(4.4절 목록·검색 규칙과 같다)
-- seed.sql의 추천 표시 가게 7곳을 전제로 하고, 이 파일이 만든 테스트 가게(이름이 ZQ로 시작)는 롤백으로 사라진다.
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

-- 응답에서 가게 id만 순서대로 뽑는다 (호출한 역할 권한으로 실행)
create function public.test_rec_ids(p_limit int default 10) returns uuid[] language sql stable as $$
  select coalesce(array_agg((e ->> 'id')::uuid order by ord), '{}')
  from jsonb_array_elements(public.list_recommended_stores(p_limit)) with ordinality as t(e, ord)
$$;

-- 응답에서 가게 한 곳의 카드를 꺼낸다
create function public.test_rec_card(p_store_id uuid) returns jsonb language sql stable as $$
  select e from jsonb_array_elements(public.list_recommended_stores(20)) e where e ->> 'id' = p_store_id::text
$$;

-- list_stores에서 같은 가게의 카드를 꺼낸다 (카드 모양이 같은지 비교용)
create function public.test_list_card(p_store_id uuid) returns jsonb language sql stable as $$
  select e from jsonb_array_elements(public.list_stores(null, null, 50) -> 'items') e where e ->> 'id' = p_store_id::text
$$;

-- seed 사실 (테스트 가게를 넣기 전에 확인한다)
select is((select count(*)::int from public.stores s join public.categories c on c.id = s.category_id
    where s.is_recommended and s.is_active and c.is_active), 7, 'seed: 활성 추천 가게는 7곳');
select is((select count(*)::int from public.stores), 27, 'seed: 가게 수는 그대로 27');

-- ---------------------------------------------------------------- 테스트 데이터 (superuser, 롤백됨)
insert into auth.users (id) values ('aaaaaaaa-0000-4000-8000-000000000001');
insert into public.profiles (id) values ('aaaaaaaa-0000-4000-8000-000000000001');

insert into public.stores (id, category_id, name, is_active, is_open, is_recommended) values
  -- 영업 종료 추천 가게: 제외하지 않는다
  ('20000000-0000-4000-8000-00000000f101', '10000000-0000-4000-8000-000000000003', 'ZQ 닫은 추천 가게', true, false, true),
  -- 이름이 같으면 id 순서
  ('20000000-0000-4000-8000-00000000f103', '10000000-0000-4000-8000-000000000001', 'ZQ 동명 가게', true, true, true),
  ('20000000-0000-4000-8000-00000000f102', '10000000-0000-4000-8000-000000000001', 'ZQ 동명 가게', true, true, true),
  -- 개수 상한 확인용으로 추천 가게를 더 늘린다 (seed 7 + 위 3 + 아래 4 = 14곳)
  ('20000000-0000-4000-8000-00000000f111', '10000000-0000-4000-8000-000000000002', 'ZQ 채움 1', true, true, true),
  ('20000000-0000-4000-8000-00000000f112', '10000000-0000-4000-8000-000000000002', 'ZQ 채움 2', true, true, true),
  ('20000000-0000-4000-8000-00000000f113', '10000000-0000-4000-8000-000000000002', 'ZQ 채움 3', true, true, true),
  ('20000000-0000-4000-8000-00000000f114', '10000000-0000-4000-8000-000000000002', 'ZQ 채움 4', true, true, true),
  -- 나와서는 안 되는 가게들
  ('20000000-0000-4000-8000-00000000f121', '10000000-0000-4000-8000-000000000001', 'ZQ 비추천 가게', true, true, false),
  ('20000000-0000-4000-8000-00000000f122', '10000000-0000-4000-8000-000000000001', 'ZQ 비활성 추천 가게', false, true, true),
  -- 가게는 활성이지만 카테고리(QA 비활성 카테고리)가 비활성
  ('20000000-0000-4000-8000-00000000f123', '10000000-0000-4000-8000-000000000099', 'ZQ 비활성 카테고리 추천 가게', true, true, true);

insert into public.menus (id, store_id, name, base_price, is_active, is_sold_out, sort_order) values
  ('30000000-0000-4000-8000-00000000f101', '20000000-0000-4000-8000-00000000f101', 'ZQ 닫힌집 메뉴', 6000, true, false, 10);

-- 로그인 사용자가 영업 종료 추천 가게를 찜한 상태
insert into public.store_favorites (user_id, store_id) values
  ('aaaaaaaa-0000-4000-8000-000000000001', '20000000-0000-4000-8000-00000000f101');

-- 기대하는 추천 가게 id (이름 → id 순서). 호출 결과와 따로 SQL로 계산한 값이다.
create temp table rec_exp as
  select array_agg(s.id order by s.name, s.id) as ids
  from public.stores s join public.categories c on c.id = s.category_id
  where s.is_recommended and s.is_active and c.is_active;
grant select on rec_exp to public;

select is(cardinality((select ids from rec_exp)), 14, '준비: 기대하는 추천 가게는 14곳(seed 7 + 테스트 7)');

-- ---------------------------------------------------------------- anon
set local role anon;

select ok(public.test_rec_ids() = (select ids[1:10] from rec_exp), '[anon] 기본(p_limit 생략): 이름 → id 순서 앞 10곳');
select is(cardinality(public.test_rec_ids()), 10, '[anon] 기본 개수는 10곳');
select ok(public.test_rec_ids(null) = (select ids[1:10] from rec_exp), '[anon] p_limit이 null이면 기본 10곳');
select ok(public.test_rec_ids(20) = (select ids from rec_exp), '[anon] p_limit 20: 추천 가게 14곳 모두');
select ok(public.test_rec_ids(1) = (select ids[1:1] from rec_exp), '[anon] p_limit 1: 첫 가게 하나');
select ok(public.test_rec_ids(3) = (select ids[1:3] from rec_exp), '[anon] p_limit 3: 앞 3곳');
select ok(public.test_err($$select public.list_recommended_stores(0)$$, 'P0001', 'INVALID_INPUT'), '[anon] p_limit 0 → INVALID_INPUT');
select ok(public.test_err($$select public.list_recommended_stores(21)$$, 'P0001', 'INVALID_INPUT'), '[anon] p_limit 21 → INVALID_INPUT');
select ok(public.test_err($$select public.list_recommended_stores(-1)$$, 'P0001', 'INVALID_INPUT'), '[anon] p_limit -1 → INVALID_INPUT');

-- 대상 규칙
select ok(not exists (
    select 1 from jsonb_array_elements(public.list_recommended_stores(20)) e where e ->> 'isRecommended' <> 'true'),
  '[anon] 추천 표시가 아닌 가게는 나오지 않는다');
select ok(public.test_rec_card('20000000-0000-4000-8000-00000000f121') is null, '[anon] 추천이 아닌 가게 제외');
select ok(public.test_rec_card('20000000-0000-4000-8000-00000000f122') is null, '[anon] 비활성 가게 제외');
select ok(public.test_rec_card('20000000-0000-4000-8000-00000000f123') is null, '[anon] 비활성 카테고리의 가게 제외');
select ok(public.test_rec_card('20000000-0000-4000-8000-00000000f101') is not null, '[anon] 영업 종료 가게도 나온다');
select is(public.test_rec_card('20000000-0000-4000-8000-00000000f101') ->> 'isOpen', 'false', '[anon] 영업 종료 가게는 isOpen=false로 내려간다');
select ok(array_position(public.test_rec_ids(20), '20000000-0000-4000-8000-00000000f102'::uuid)
    < array_position(public.test_rec_ids(20), '20000000-0000-4000-8000-00000000f103'::uuid),
  '[anon] 이름이 같으면 id 오름차순');
-- 개수 제한의 경계가 이름이 같은 두 가게 사이에 걸리면 id가 작은 쪽(f102)만 남아야 한다 (위치는 DB 정렬 규칙에 따라 계산한다)
select ok(public.test_rec_ids(array_position((select ids from rec_exp), '20000000-0000-4000-8000-00000000f102'::uuid))
    @> array['20000000-0000-4000-8000-00000000f102'::uuid]
  and not public.test_rec_ids(array_position((select ids from rec_exp), '20000000-0000-4000-8000-00000000f102'::uuid))
    @> array['20000000-0000-4000-8000-00000000f103'::uuid],
  '[anon] 개수 제한이 동명 가게 사이에 걸리면 id가 작은 가게가 남는다');

-- 카드 모양은 list_stores와 같다
select ok((select array_agg(k order by k) from jsonb_object_keys(public.list_recommended_stores(1) -> 0) k)
  = array['category','id','imageRef','isFavorite','isOpen','isRecommended','name','representativeMenu','reviewSummary'],
  '[anon] 카드 키는 StoreCardDto와 같다');
select ok(public.test_rec_card('20000000-0000-4000-8000-00000000f101') = public.test_list_card('20000000-0000-4000-8000-00000000f101'),
  '[anon] 영업 종료 가게 카드는 list_stores의 카드와 같다 (대표 메뉴 포함)');
select ok(public.test_rec_card('20000000-0000-4000-8000-000000000001') = public.test_list_card('20000000-0000-4000-8000-000000000001'),
  '[anon] 테스트 치킨집 카드는 list_stores의 카드와 같다');
select ok(public.test_rec_card('20000000-0000-4000-8000-00000000f101') -> 'representativeMenu' ->> 'name' = 'ZQ 닫힌집 메뉴',
  '[anon] 대표 메뉴가 내려간다');
select ok(public.test_rec_card('20000000-0000-4000-8000-00000000f111') -> 'representativeMenu' = 'null'::jsonb,
  '[anon] 활성 메뉴가 없으면 representativeMenu는 null');

-- Guest는 찜 여부를 알 수 없다
select ok(not exists (
    select 1 from jsonb_array_elements(public.list_recommended_stores(20)) e where jsonb_typeof(e -> 'isFavorite') <> 'null'),
  '[anon] 모든 카드의 isFavorite는 null');

-- ---------------------------------------------------------------- authenticated
reset role;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select ok(public.test_rec_ids() = (select ids[1:10] from rec_exp), '[authenticated] 호출할 수 있고 기본 결과가 anon과 같다');
select ok(public.test_rec_ids(20) = (select ids from rec_exp), '[authenticated] p_limit 20도 anon과 같다');
select is(public.test_rec_card('20000000-0000-4000-8000-00000000f101') ->> 'isFavorite', 'true', '[authenticated] 찜한 가게는 isFavorite=true');
select is(public.test_rec_card('20000000-0000-4000-8000-000000000001') ->> 'isFavorite', 'false', '[authenticated] 찜하지 않은 가게는 isFavorite=false');
select ok(not exists (
    select 1 from jsonb_array_elements(public.list_recommended_stores(20)) e where e ->> 'isFavorite' not in ('true', 'false')),
  '[authenticated] 모든 카드의 isFavorite는 true/false');
select ok(public.test_rec_card('20000000-0000-4000-8000-00000000f101') = public.test_list_card('20000000-0000-4000-8000-00000000f101'),
  '[authenticated] 카드가 list_stores의 카드와 같다 (isFavorite 포함)');
select ok(public.test_rec_card('20000000-0000-4000-8000-00000000f122') is null, '[authenticated] 비활성 가게는 로그인해도 숨겨진다');
select ok(public.test_rec_card('20000000-0000-4000-8000-00000000f123') is null, '[authenticated] 비활성 카테고리의 가게도 숨겨진다');
select ok(public.test_err($$select public.list_recommended_stores(0)$$, 'P0001', 'INVALID_INPUT'), '[authenticated] p_limit 0 → INVALID_INPUT');
select ok(public.test_err($$select public.list_recommended_stores(21)$$, 'P0001', 'INVALID_INPUT'), '[authenticated] p_limit 21 → INVALID_INPUT');

-- ---------------------------------------------------------------- 권한 메타데이터 (superuser)
reset role;

select ok(has_function_privilege('anon', 'public.list_recommended_stores(integer)', 'execute'), 'anon이 실행할 수 있다');
select ok(has_function_privilege('authenticated', 'public.list_recommended_stores(integer)', 'execute'), 'authenticated도 실행할 수 있다');
select ok(not exists (
    select 1 from pg_proc p where p.proname = 'list_recommended_stores' and coalesce(p.proacl::text, '') ~ '(^|[{,])=X'),
  'PUBLIC에는 실행 권한을 열어두지 않았다');
select ok(not (select p.prosecdef from pg_proc p where p.proname = 'list_recommended_stores'), 'SECURITY INVOKER다 (DEFINER가 아님)');
select ok((select p.proconfig @> array['search_path=""'] from pg_proc p where p.proname = 'list_recommended_stores'), 'search_path를 빈 값으로 고정했다');

select * from finish();
rollback;
