-- 홈 최근 본 항목: list_stores_by_ids, list_menu_cards_by_ids
-- 근거: docs/contracts/home-search-contract-draft.md 4.3절. 비활성만 빼고 품절·영업 종료 가게는 표시해서 포함한다(앱이 빠진 id를 로컬 기록에서 지우기 때문).
-- seed.sql 1부(QA 데이터)와 2부 인기 메뉴를 전제로 하고, 이 파일이 만든 테스트 데이터는 롤백으로 사라진다.
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

-- 응답에서 id만 순서대로 뽑는다 (호출한 역할 권한으로 실행)
create function public.test_store_ids(p_ids uuid[]) returns uuid[] language sql stable as $$
  select coalesce(array_agg((e ->> 'id')::uuid order by ord), '{}')
  from jsonb_array_elements(public.list_stores_by_ids(p_ids)) with ordinality as t(e, ord)
$$;
create function public.test_menu_ids(p_ids uuid[]) returns uuid[] language sql stable as $$
  select coalesce(array_agg((e ->> 'id')::uuid order by ord), '{}')
  from jsonb_array_elements(public.list_menu_cards_by_ids(p_ids)) with ordinality as t(e, ord)
$$;

-- 응답에서 카드 한 장을 꺼낸다
create function public.test_store_card(p_id uuid) returns jsonb language sql stable as $$
  select e from jsonb_array_elements(public.list_stores_by_ids(array[p_id])) e
$$;
create function public.test_menu_card(p_id uuid) returns jsonb language sql stable as $$
  select e from jsonb_array_elements(public.list_menu_cards_by_ids(array[p_id])) e
$$;

-- list_stores / list_popular_menus에서 같은 항목의 카드를 꺼낸다 (카드 모양이 같은지 비교용)
create function public.test_list_card(p_id uuid) returns jsonb language sql stable as $$
  select e from jsonb_array_elements(public.list_stores(null, null, 50) -> 'items') e where e ->> 'id' = p_id::text
$$;
create function public.test_popular_card(p_id uuid) returns jsonb language sql stable as $$
  select e from jsonb_array_elements(public.list_popular_menus(20)) e where e ->> 'id' = p_id::text
$$;

-- seed의 가게·메뉴 id
create temp table ids as select
  '20000000-0000-4000-8000-000000000001'::uuid as s_chicken,        -- 테스트 치킨집 (영업 중, 추천)
  '20000000-0000-4000-8000-000000000002'::uuid as s_bunsik,         -- 테스트 분식집
  '20000000-0000-4000-8000-000000000003'::uuid as s_closed,         -- 테스트 피자집 (영업 종료)
  '20000000-0000-4000-8000-000000000004'::uuid as s_korean,         -- 테스트 한식집
  '20000000-0000-4000-8000-000000000098'::uuid as s_inactive,       -- QA 비활성 가게
  '20000000-0000-4000-8000-000000000099'::uuid as s_inactive_cat,   -- QA 비활성 카테고리 가게
  '30000000-0000-4000-8000-000000000101'::uuid as m_fried,          -- 후라이드치킨 (정상)
  '30000000-0000-4000-8000-000000000103'::uuid as m_soldout,        -- 반반치킨 (품절)
  '30000000-0000-4000-8000-000000000105'::uuid as m_inactive,       -- QA 비활성 메뉴
  '30000000-0000-4000-8000-000000000301'::uuid as m_closed_store,   -- 페퍼로니 피자 (영업 종료 가게)
  '30000000-0000-4000-8000-000000009801'::uuid as m_inactive_store, -- 비활성 가게의 메뉴
  '30000000-0000-4000-8000-000000009901'::uuid as m_inactive_cat,   -- 비활성 카테고리 가게의 메뉴
  '30000000-0000-4000-8000-000000000401'::uuid as m_kimchi,         -- 김치찌개 (정상)
  '30000000-0000-4000-8000-000000000701'::uuid as m_burger,         -- 치즈버거 (정상, 인기 1위)
  '99999999-9999-4999-8999-999999999999'::uuid as ghost;            -- 없는 id
grant select on ids to public;

-- ---------------------------------------------------------------- 테스트 데이터 (superuser, 롤백됨)
insert into auth.users (id) values ('aaaaaaaa-0000-4000-8000-000000000001');
insert into public.profiles (id) values ('aaaaaaaa-0000-4000-8000-000000000001');
-- 로그인 사용자가 치킨집과 영업 종료 가게를 찜한 상태
insert into public.store_favorites (user_id, store_id) values
  ('aaaaaaaa-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001'),
  ('aaaaaaaa-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003');

-- seed 사실 확인 (이 테스트가 기대는 QA 데이터)
select ok((select count(*) = 1 from public.menus where id = (select m_soldout from ids) and is_sold_out and is_active), 'seed: 반반치킨은 품절·활성');
select ok((select count(*) = 1 from public.menus where id = (select m_inactive from ids) and not is_active), 'seed: QA 비활성 메뉴는 비활성');
select ok((select count(*) = 1 from public.stores where id = (select s_closed from ids) and is_active and not is_open), 'seed: 피자집은 활성·영업 종료');

-- ---------------------------------------------------------------- anon: list_stores_by_ids
set local role anon;

select ok(public.test_store_ids(array[(select s_korean from ids), (select s_chicken from ids), (select s_bunsik from ids)])
  = array[(select s_korean from ids), (select s_chicken from ids), (select s_bunsik from ids)],
  '[anon] 가게: 요청한 순서를 유지한다(이름순이 아님)');
select ok(public.test_store_ids(array[(select s_bunsik from ids), (select s_chicken from ids), (select s_korean from ids)])
  = array[(select s_bunsik from ids), (select s_chicken from ids), (select s_korean from ids)],
  '[anon] 가게: 반대 순서로 요청하면 그대로 반대 순서');
select ok(public.test_store_ids(array[(select s_chicken from ids), (select ghost from ids), (select s_korean from ids)])
  = array[(select s_chicken from ids), (select s_korean from ids)],
  '[anon] 가게: 없는 id는 빠지고 나머지 순서는 유지');
select is(public.list_stores_by_ids(array[(select ghost from ids)]), '[]'::jsonb, '[anon] 가게: 모두 없는 id면 빈 배열(오류 아님)');
select ok(public.test_store_ids(array[(select s_korean from ids), (select s_chicken from ids), (select s_korean from ids), (select s_chicken from ids), (select s_korean from ids)])
  = array[(select s_korean from ids), (select s_chicken from ids)],
  '[anon] 가게: 같은 id가 여러 번 오면 처음 자리에 한 번만');
select ok(public.test_store_ids(array[(select s_korean from ids), null, (select s_chicken from ids)])
  = array[(select s_korean from ids), (select s_chicken from ids)],
  '[anon] 가게: 배열 안의 null 원소는 무시');
select is(public.list_stores_by_ids('{}'::uuid[]), '[]'::jsonb, '[anon] 가게: 빈 배열이면 빈 배열');
select is(public.list_stores_by_ids(null::uuid[]), '[]'::jsonb, '[anon] 가게: null이면 빈 배열');
select is(cardinality(public.test_store_ids(array_fill((select s_korean from ids), array[10]))), 1, '[anon] 가게: 10개는 허용(중복이라 1곳)');
select ok(public.test_err($$select public.list_stores_by_ids(array_fill('20000000-0000-4000-8000-000000000004'::uuid, array[11]))$$, 'P0001', 'INVALID_INPUT'),
  '[anon] 가게: 11개는 INVALID_INPUT(중복이어도 원래 길이로 센다)');

-- 비활성은 빠지고 영업 종료는 포함
select ok(public.test_store_card((select s_inactive from ids)) is null, '[anon] 가게: 비활성 가게 제외');
select ok(public.test_store_card((select s_inactive_cat from ids)) is null, '[anon] 가게: 비활성 카테고리의 가게 제외');
select ok(public.test_store_card((select s_closed from ids)) is not null, '[anon] 가게: 영업 종료 가게도 포함');
select is(public.test_store_card((select s_closed from ids)) ->> 'isOpen', 'false', '[anon] 가게: 영업 종료 가게는 isOpen=false');
select ok(public.test_store_ids(array[(select s_inactive from ids), (select s_closed from ids), (select s_inactive_cat from ids), (select s_chicken from ids)])
  = array[(select s_closed from ids), (select s_chicken from ids)],
  '[anon] 가게: 비활성만 빠지고 나머지는 요청 순서');

-- 카드 모양은 list_stores와 같다
select ok((select array_agg(k order by k) from jsonb_object_keys(public.test_store_card((select s_chicken from ids))) k)
  = array['category','id','imageRef','isFavorite','isOpen','isRecommended','name','representativeMenu','reviewSummary'],
  '[anon] 가게: 카드 키는 StoreCardDto와 같다');
select ok(public.test_store_card((select s_chicken from ids)) = public.test_list_card((select s_chicken from ids)), '[anon] 가게: 치킨집 카드가 list_stores의 카드와 같다');
select ok(public.test_store_card((select s_closed from ids)) = public.test_list_card((select s_closed from ids)), '[anon] 가게: 영업 종료 가게 카드가 list_stores의 카드와 같다');
select ok(not exists (
    select 1 from jsonb_array_elements(public.list_stores_by_ids(array[(select s_chicken from ids), (select s_closed from ids)])) e
    where jsonb_typeof(e -> 'isFavorite') <> 'null'),
  '[anon] 가게: Guest의 isFavorite는 null');

-- ---------------------------------------------------------------- anon: list_menu_cards_by_ids
select ok(public.test_menu_ids(array[(select m_kimchi from ids), (select m_fried from ids), (select m_burger from ids)])
  = array[(select m_kimchi from ids), (select m_fried from ids), (select m_burger from ids)],
  '[anon] 메뉴: 요청한 순서를 유지한다');
select ok(public.test_menu_ids(array[(select m_burger from ids), (select m_fried from ids), (select m_kimchi from ids)])
  = array[(select m_burger from ids), (select m_fried from ids), (select m_kimchi from ids)],
  '[anon] 메뉴: 반대 순서로 요청하면 그대로 반대 순서');
select ok(public.test_menu_ids(array[(select m_fried from ids), (select ghost from ids), (select m_kimchi from ids)])
  = array[(select m_fried from ids), (select m_kimchi from ids)],
  '[anon] 메뉴: 없는 id는 빠지고 나머지 순서는 유지');
select is(public.list_menu_cards_by_ids(array[(select ghost from ids)]), '[]'::jsonb, '[anon] 메뉴: 모두 없는 id면 빈 배열(오류 아님)');
select ok(public.test_menu_ids(array[(select m_kimchi from ids), (select m_fried from ids), (select m_kimchi from ids), (select m_fried from ids)])
  = array[(select m_kimchi from ids), (select m_fried from ids)],
  '[anon] 메뉴: 같은 id가 여러 번 오면 처음 자리에 한 번만');
select ok(public.test_menu_ids(array[(select m_kimchi from ids), null, (select m_fried from ids)])
  = array[(select m_kimchi from ids), (select m_fried from ids)],
  '[anon] 메뉴: 배열 안의 null 원소는 무시');
select is(public.list_menu_cards_by_ids('{}'::uuid[]), '[]'::jsonb, '[anon] 메뉴: 빈 배열이면 빈 배열');
select is(public.list_menu_cards_by_ids(null::uuid[]), '[]'::jsonb, '[anon] 메뉴: null이면 빈 배열');
select is(cardinality(public.test_menu_ids(array_fill((select m_fried from ids), array[10]))), 1, '[anon] 메뉴: 10개는 허용(중복이라 1개)');
select ok(public.test_err($$select public.list_menu_cards_by_ids(array_fill('30000000-0000-4000-8000-000000000101'::uuid, array[11]))$$, 'P0001', 'INVALID_INPUT'),
  '[anon] 메뉴: 11개는 INVALID_INPUT(중복이어도 원래 길이로 센다)');

-- 비활성은 빠지고 품절·영업 종료는 포함
select ok(public.test_menu_card((select m_inactive from ids)) is null, '[anon] 메뉴: 비활성 메뉴 제외');
select ok(public.test_menu_card((select m_inactive_store from ids)) is null, '[anon] 메뉴: 비활성 가게의 메뉴 제외');
select ok(public.test_menu_card((select m_inactive_cat from ids)) is null, '[anon] 메뉴: 비활성 카테고리 가게의 메뉴 제외');
select ok(public.test_menu_card((select m_soldout from ids)) is not null, '[anon] 메뉴: 품절 메뉴도 포함');
select is(public.test_menu_card((select m_soldout from ids)) ->> 'isSoldOut', 'true', '[anon] 메뉴: 품절 메뉴는 isSoldOut=true');
select ok(public.test_menu_card((select m_closed_store from ids)) is not null, '[anon] 메뉴: 영업 종료 가게의 메뉴도 포함');
select is(public.test_menu_card((select m_closed_store from ids)) -> 'store' ->> 'isOpen', 'false', '[anon] 메뉴: 영업 종료 가게의 메뉴는 store.isOpen=false');
select ok(public.test_menu_ids(array[(select m_inactive from ids), (select m_closed_store from ids), (select m_inactive_store from ids), (select m_soldout from ids), (select m_inactive_cat from ids), (select m_fried from ids)])
  = array[(select m_closed_store from ids), (select m_soldout from ids), (select m_fried from ids)],
  '[anon] 메뉴: 비활성만 빠지고 나머지는 요청 순서');

-- 카드 모양은 list_popular_menus와 같다
select ok((select array_agg(k order by k) from jsonb_object_keys(public.test_menu_card((select m_burger from ids))) k)
  = array['id','imageRef','isSoldOut','name','price','store'], '[anon] 메뉴: 카드 키는 MenuCardDto와 같다(점수·순위 숫자 없음)');
select ok((select array_agg(k order by k) from jsonb_object_keys(public.test_menu_card((select m_burger from ids)) -> 'store') k)
  = array['id','isOpen','name'], '[anon] 메뉴: store 키는 id/name/isOpen뿐');
select ok(public.test_menu_card((select m_burger from ids)) = public.test_popular_card((select m_burger from ids)), '[anon] 메뉴: 카드가 list_popular_menus의 카드와 같다');
select is((public.test_menu_card((select m_fried from ids)) ->> 'price')::int, (public.get_menu((select m_fried from ids)) ->> 'price')::int, '[anon] 메뉴: 가격이 get_menu와 같다');

-- ---------------------------------------------------------------- authenticated
reset role;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select ok(public.test_store_ids(array[(select s_korean from ids), (select s_chicken from ids), (select s_closed from ids)])
  = array[(select s_korean from ids), (select s_chicken from ids), (select s_closed from ids)],
  '[authenticated] 가게: 호출할 수 있고 요청 순서를 유지한다');
select is(public.test_store_card((select s_chicken from ids)) ->> 'isFavorite', 'true', '[authenticated] 가게: 찜한 가게는 isFavorite=true');
select is(public.test_store_card((select s_closed from ids)) ->> 'isFavorite', 'true', '[authenticated] 가게: 찜한 영업 종료 가게도 isFavorite=true');
select is(public.test_store_card((select s_korean from ids)) ->> 'isFavorite', 'false', '[authenticated] 가게: 찜하지 않은 가게는 isFavorite=false');
select ok(public.test_store_card((select s_chicken from ids)) = public.test_list_card((select s_chicken from ids)), '[authenticated] 가게: 카드가 list_stores의 카드와 같다(isFavorite 포함)');
select ok(public.test_store_card((select s_korean from ids)) = public.test_list_card((select s_korean from ids)), '[authenticated] 가게: 찜 안 한 가게 카드도 같다');
select ok(public.test_store_card((select s_inactive from ids)) is null, '[authenticated] 가게: 비활성 가게는 로그인해도 숨겨진다');
select ok(public.test_err($$select public.list_stores_by_ids(array_fill('20000000-0000-4000-8000-000000000004'::uuid, array[11]))$$, 'P0001', 'INVALID_INPUT'),
  '[authenticated] 가게: 11개는 INVALID_INPUT');

select ok(public.test_menu_ids(array[(select m_kimchi from ids), (select m_soldout from ids), (select m_closed_store from ids)])
  = array[(select m_kimchi from ids), (select m_soldout from ids), (select m_closed_store from ids)],
  '[authenticated] 메뉴: 호출할 수 있고 품절·영업 종료 메뉴도 요청 순서대로 나온다');
select ok(public.test_menu_card((select m_burger from ids)) = public.test_popular_card((select m_burger from ids)), '[authenticated] 메뉴: 카드가 list_popular_menus의 카드와 같다');
select ok(public.test_menu_card((select m_inactive from ids)) is null, '[authenticated] 메뉴: 비활성 메뉴는 숨겨진다');
select ok(public.test_menu_card((select m_inactive_store from ids)) is null, '[authenticated] 메뉴: 비활성 가게의 메뉴는 숨겨진다');
select ok(public.test_err($$select public.list_menu_cards_by_ids(array_fill('30000000-0000-4000-8000-000000000101'::uuid, array[11]))$$, 'P0001', 'INVALID_INPUT'),
  '[authenticated] 메뉴: 11개는 INVALID_INPUT');

-- ---------------------------------------------------------------- 권한 메타데이터 (superuser)
reset role;

select ok(has_function_privilege('anon', 'public.list_stores_by_ids(uuid[])', 'execute'), 'anon이 list_stores_by_ids를 실행할 수 있다');
select ok(has_function_privilege('authenticated', 'public.list_stores_by_ids(uuid[])', 'execute'), 'authenticated도 list_stores_by_ids를 실행할 수 있다');
select ok(has_function_privilege('anon', 'public.list_menu_cards_by_ids(uuid[])', 'execute'), 'anon이 list_menu_cards_by_ids를 실행할 수 있다');
select ok(has_function_privilege('authenticated', 'public.list_menu_cards_by_ids(uuid[])', 'execute'), 'authenticated도 list_menu_cards_by_ids를 실행할 수 있다');
select ok(not exists (
    select 1 from pg_proc p where p.proname in ('list_stores_by_ids', 'list_menu_cards_by_ids') and coalesce(p.proacl::text, '') ~ '(^|[{,])=X'),
  'PUBLIC에는 두 함수의 실행 권한을 열어두지 않았다');
select ok(not exists (
    select 1 from pg_proc p where p.proname in ('list_stores_by_ids', 'list_menu_cards_by_ids') and p.prosecdef),
  '두 함수 모두 SECURITY INVOKER다 (DEFINER가 아님)');
select ok((select bool_and(p.proconfig @> array['search_path=""']) from pg_proc p where p.proname in ('list_stores_by_ids', 'list_menu_cards_by_ids')),
  '두 함수 모두 search_path를 빈 값으로 고정했다');

select * from finish();
rollback;
