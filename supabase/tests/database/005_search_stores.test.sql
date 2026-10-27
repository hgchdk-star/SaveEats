-- 검색: search_stores
-- 근거: docs/contracts/home-search-contract-draft.md 3.1절·3.2절·6.2절, 영업 종료 가게는 검색에서 제외하지 않음(4.4절, 서정 확인 2026-10-14)
-- seed.sql 1부(QA 데이터)를 전제로 하고, 이 파일이 만든 테스트 가게(이름이 ZQ로 시작)는 롤백으로 사라진다.
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

-- 검색 결과의 가게 이름을 순서대로 뽑는다 (호출한 역할 권한으로 실행)
create function public.test_search_names(p_query text, p_size int default 50) returns text[] language sql stable as $$
  select coalesce(array_agg(e ->> 'name' order by ord), '{}')
  from jsonb_array_elements(public.search_stores(p_query, null, p_size) -> 'items') with ordinality as t(e, ord)
$$;

-- 검색 결과에서 가게 한 곳의 카드를 꺼낸다
create function public.test_search_card(p_query text, p_store_name text) returns jsonb language sql stable as $$
  select e from jsonb_array_elements(public.search_stores(p_query, null, 50) -> 'items') e
  where e ->> 'name' = p_store_name
$$;

-- 커서를 끝까지 따라가며 가게 이름을 모은다
create function public.test_search_walk(p_query text, p_size int) returns jsonb language plpgsql as $$
declare
  v_names text[] := '{}';
  v_cursor text := null;
  v_page jsonb;
  v_pages int := 0;
begin
  loop
    v_page := public.search_stores(p_query, v_cursor, p_size);
    v_names := v_names || array(select e ->> 'name' from jsonb_array_elements(v_page -> 'items') e);
    v_cursor := v_page ->> 'nextCursor';
    v_pages := v_pages + 1;
    exit when v_cursor is null or v_pages > 100;
  end loop;
  return jsonb_build_object('names', to_jsonb(v_names), 'pages', v_pages);
end $$;

-- ---------------------------------------------------------------- 테스트 데이터 (superuser, 롤백됨)
insert into auth.users (id) values ('aaaaaaaa-0000-4000-8000-000000000001');
insert into public.profiles (id) values ('aaaaaaaa-0000-4000-8000-000000000001');

-- 글자 그대로 찾아야 하는 문자: % _ \
insert into public.stores (id, category_id, name, is_active, is_open) values
  ('20000000-0000-4000-8000-00000000f001', '10000000-0000-4000-8000-000000000001', 'ZQ 100% 가게', true, true),
  ('20000000-0000-4000-8000-00000000f002', '10000000-0000-4000-8000-000000000001', 'ZQ 100X 가게', true, true),
  ('20000000-0000-4000-8000-00000000f003', '10000000-0000-4000-8000-000000000001', 'ZQ a_b 가게', true, true),
  ('20000000-0000-4000-8000-00000000f004', '10000000-0000-4000-8000-000000000001', 'ZQ aXb 가게', true, true),
  ('20000000-0000-4000-8000-00000000f005', '10000000-0000-4000-8000-000000000001', 'ZQ back\slash 가게', true, true),
  ('20000000-0000-4000-8000-00000000f006', '10000000-0000-4000-8000-000000000001', 'ZQ backXslash 가게', true, true),
  -- 품절 메뉴로만 걸리는 가게 (메뉴 1개, 품절)
  ('20000000-0000-4000-8000-00000000f007', '10000000-0000-4000-8000-000000000002', 'ZQ 품절만 가게', true, true),
  -- 매칭 메뉴 선정: 품절이 sort_order 앞이어도 판매 가능한 메뉴가 먼저
  ('20000000-0000-4000-8000-00000000f008', '10000000-0000-4000-8000-000000000002', 'ZQ 선정 가게', true, true),
  -- 대소문자 무시, 내부 공백
  ('20000000-0000-4000-8000-00000000f009', '10000000-0000-4000-8000-000000000008', 'ZQ Latte House', true, true),
  ('20000000-0000-4000-8000-00000000f00a', '10000000-0000-4000-8000-000000000008', 'ZQ 두 단어 가게', true, true),
  -- 영업 종료 가게 (메뉴 이름으로 걸림)
  ('20000000-0000-4000-8000-00000000f00b', '10000000-0000-4000-8000-000000000003', 'ZQ 닫은 가게', true, false);

-- 카테고리 이름으로만 걸리는 가게 (메뉴 없음)
insert into public.categories (id, code, name, sort_order, is_active) values
  ('10000000-0000-4000-8000-0000000000f1', 'zq_cat', 'ZQC분류', 900, true);
insert into public.stores (id, category_id, name, is_active, is_open) values
  ('20000000-0000-4000-8000-00000000f00c', '10000000-0000-4000-8000-0000000000f1', 'ZQ 카테고리만 가게', true, true);

insert into public.menus (id, store_id, name, base_price, is_active, is_sold_out, sort_order) values
  ('30000000-0000-4000-8000-00000000f007', '20000000-0000-4000-8000-00000000f007', 'ZQ 솔드아웃 메뉴', 5000, true, true, 10),
  ('30000000-0000-4000-8000-00000000f081', '20000000-0000-4000-8000-00000000f008', 'ZQ 선정 품절', 7000, true, true, 10),
  ('30000000-0000-4000-8000-00000000f082', '20000000-0000-4000-8000-00000000f008', 'ZQ 선정 B', 8000, true, false, 30),
  ('30000000-0000-4000-8000-00000000f083', '20000000-0000-4000-8000-00000000f008', 'ZQ 선정 A', 9000, true, false, 30),
  ('30000000-0000-4000-8000-00000000f084', '20000000-0000-4000-8000-00000000f008', 'ZQ 선정 비활성', 1000, false, false, 5),
  ('30000000-0000-4000-8000-00000000f009', '20000000-0000-4000-8000-00000000f009', 'Iced ZQ Latte', 4500, true, false, 10),
  ('30000000-0000-4000-8000-00000000f00b', '20000000-0000-4000-8000-00000000f00b', 'ZQ 닫힌집 메뉴', 6000, true, false, 10);

-- 찜: 로그인 사용자가 테스트 가게 하나를 찜한 상태
insert into public.store_favorites (user_id, store_id) values
  ('aaaaaaaa-0000-4000-8000-000000000001', '20000000-0000-4000-8000-00000000f009');

-- ---------------------------------------------------------------- anon
set local role anon;

-- 입력 규칙 (6.2절): trim 후 1~50자
select ok(public.test_err($$select public.search_stores('')$$, 'P0001', 'INVALID_INPUT'), '[anon] 0자 → INVALID_INPUT');
select ok(public.test_err($$select public.search_stores('   ')$$, 'P0001', 'INVALID_INPUT'), '[anon] 공백만 → INVALID_INPUT');
select ok(public.test_err($$select public.search_stores(null)$$, 'P0001', 'INVALID_INPUT'), '[anon] null → INVALID_INPUT');
select ok(public.test_err($$select public.search_stores(repeat('가', 51))$$, 'P0001', 'INVALID_INPUT'), '[anon] 51자 → INVALID_INPUT');
select ok(public.test_err($$select public.search_stores(' ' || repeat('가', 51) || ' ')$$, 'P0001', 'INVALID_INPUT'),
  '[anon] 앞뒤 공백을 지워도 51자면 → INVALID_INPUT');
select is(public.search_stores(repeat('가', 50)) -> 'items', '[]'::jsonb, '[anon] 50자는 허용(결과 없음, 오류 아님)');
select ok(public.test_search_names('떡') @> array['테스트 분식집'], '[anon] 1자 검색 가능: "떡" → 메뉴 떡볶이가 있는 분식집이 나온다');
select ok(public.test_err($$select public.search_stores('치킨', null, 0)$$, 'P0001', 'INVALID_INPUT'), '[anon] pageSize 0 → INVALID_INPUT');
select ok(public.test_err($$select public.search_stores('치킨', null, 51)$$, 'P0001', 'INVALID_INPUT'), '[anon] pageSize 51 → INVALID_INPUT');
select ok(public.test_err($$select public.search_stores('치킨', 'not-a-cursor', 20)$$, 'P0001', 'INVALID_INPUT'), '[anon] 잘못된 cursor → INVALID_INPUT');
select ok(public.test_search_names('  치킨  ') = public.test_search_names('치킨'), '[anon] 앞뒤 공백은 지우고 검색한다');

-- 세 경로(가게 이름·메뉴 이름·카테고리 이름)로 걸려도 한 번만
select is((select count(*)::int from jsonb_array_elements(public.search_stores('치킨', null, 50) -> 'items') e
    where e ->> 'name' = '테스트 치킨집'), 1, '[anon] "치킨": 이름·메뉴·카테고리 3경로로 걸려도 가게는 한 번만');
select ok(array_position(public.test_search_names('치킨'), '테스트 치킨집') is not null, '[anon] "치킨": 치킨집이 결과에 있다');
select ok(public.test_search_card('치킨', '테스트 치킨집') -> 'matchingMenu' ->> 'name' = '후라이드치킨',
  '[anon] "치킨": 매칭 메뉴는 판매 가능한 첫 메뉴(후라이드치킨)');

-- 가게 이름만 / 카테고리 이름만 걸리면 matchingMenu는 null
select ok(public.test_search_card('테스트 한식', '테스트 한식집') -> 'matchingMenu' = 'null'::jsonb,
  '[anon] 가게 이름으로만 걸리면 matchingMenu는 null');
select ok(public.test_search_names('ZQC분류') = array['ZQ 카테고리만 가게'], '[anon] 카테고리 이름으로 걸린 가게');
select ok(public.test_search_card('ZQC분류', 'ZQ 카테고리만 가게') -> 'matchingMenu' = 'null'::jsonb
    and public.test_search_card('ZQC분류', 'ZQ 카테고리만 가게') -> 'representativeMenu' = 'null'::jsonb,
  '[anon] 카테고리로만 걸리고 메뉴가 없으면 matchingMenu·representativeMenu 모두 null');

-- 메뉴 이름으로 걸림
select ok(public.test_search_names('후라이드') @> array['테스트 치킨집'], '[anon] 메뉴 이름으로 걸린 가게 (가게 이름·카테고리에는 없는 단어)');
select ok((public.test_search_card('후라이드', '테스트 치킨집') -> 'matchingMenu')
    = '{"id":"30000000-0000-4000-8000-000000000101","name":"후라이드치킨","price":18000,"isSoldOut":false}'::jsonb,
  '[anon] matchingMenu 모양: id, name, price, isSoldOut');

-- 품절 메뉴만 걸려도 가게는 나오고 isSoldOut=true (Q2)
select ok(public.test_search_names('ZQ 솔드아웃') = array['ZQ 품절만 가게'], '[anon] 품절 메뉴로만 걸린 가게도 나온다');
select ok((public.test_search_card('ZQ 솔드아웃', 'ZQ 품절만 가게') -> 'matchingMenu' ->> 'isSoldOut') = 'true',
  '[anon] 품절 메뉴만 걸리면 matchingMenu.isSoldOut=true');

-- 매칭 메뉴 선정: 판매 가능 우선 → sort_order → 이름 → id, 비활성 메뉴는 대상이 아님
select ok((public.test_search_card('ZQ 선정', 'ZQ 선정 가게') -> 'matchingMenu' ->> 'name') = 'ZQ 선정 A',
  '[anon] 품절(sort 10)보다 판매 가능한 메뉴가 먼저, 같은 sort_order(30)면 이름순(A)');
select ok(public.test_search_card('ZQ 선정 비활성', 'ZQ 선정 가게') is null
    or (public.test_search_card('ZQ 선정 비활성', 'ZQ 선정 가게') -> 'matchingMenu' ->> 'name') <> 'ZQ 선정 비활성',
  '[anon] 비활성 메뉴는 매칭 메뉴가 되지 않는다');

-- 이스케이프: % _ \ 는 일반 글자
select ok(public.test_search_names('100%') = array['ZQ 100% 가게'], '[anon] "%"는 글자 그대로 찾는다 (100X 가게는 안 걸림)');
select ok(public.test_search_names('a_b') = array['ZQ a_b 가게'], '[anon] "_"는 글자 그대로 찾는다 (aXb 가게는 안 걸림)');
select ok(public.test_search_names('back\slash') = array['ZQ back\slash 가게'], '[anon] "\"는 글자 그대로 찾는다 (backXslash 가게는 안 걸림)');
select ok(public.test_search_names('%') = array['ZQ 100% 가게'], '[anon] "%" 한 글자만 검색해도 전체가 걸리지 않는다');
select ok(public.test_search_names('_') = array['ZQ a_b 가게'], '[anon] "_" 한 글자만 검색해도 전체가 걸리지 않는다');

-- 대소문자 무시, 내부 공백은 통째로 일치 (Q4)
select ok(public.test_search_names('zq latte') = array['ZQ Latte House'], '[anon] 대소문자를 구분하지 않는다 (가게 이름)');
select ok(public.test_search_names('ICED zq LATTE') = array['ZQ Latte House'], '[anon] 대소문자를 구분하지 않는다 (메뉴 이름)');
select ok(public.test_search_names('ZQ 두 단어') = array['ZQ 두 단어 가게'], '[anon] 내부 공백 포함 통째로 일치');
select ok(public.test_search_names('ZQ 단어 두') = '{}', '[anon] 단어 순서가 다르면 일치하지 않는다 (단어별 검색이 아님)');
select ok(public.test_search_names('후라이드 치킨') = '{}', '[anon] 내부 공백이 있으면 붙여 쓴 이름("후라이드치킨")과 일치하지 않는다');

-- 영업 종료 가게도 제외하지 않는다 (4.4절)
select ok(array_position(public.test_search_names('피자'), '테스트 피자집') is not null, '[anon] 영업 종료 가게가 검색 결과에 나온다 (가게 이름)');
select ok((public.test_search_card('피자', '테스트 피자집') ->> 'isOpen') = 'false', '[anon] 영업 종료 가게는 isOpen=false로 내려온다');
select ok(public.test_search_names('ZQ 닫힌집 메뉴') = array['ZQ 닫은 가게'], '[anon] 영업 종료 가게가 메뉴 이름으로도 나온다');

-- 비활성은 숨김 (가게·메뉴·카테고리, 부모가 비활성인 경우 포함)
select is(public.search_stores('QA 비활성') -> 'items', '[]'::jsonb, '[anon] 비활성 가게·비활성 카테고리(와 그 가게)는 검색되지 않는다');
select is(public.search_stores('QA 숨김') -> 'items', '[]'::jsonb, '[anon] 비활성 가게·카테고리 가게의 메뉴로는 검색되지 않는다');
select is(public.search_stores('QA 비활성 메뉴') -> 'items', '[]'::jsonb, '[anon] 비활성 메뉴로는 검색되지 않는다');

-- 결과 없음은 오류가 아니다
select is(public.search_stores('존재하지않는검색어zzz'), '{"items":[],"hasMore":false,"nextCursor":null}'::jsonb,
  '[anon] 결과가 없으면 빈 목록, hasMore=false, nextCursor=null');

-- 응답 모양: list_stores 카드 키 + matchingMenu
select ok((select array_agg(k order by k) from jsonb_object_keys(public.search_stores('치킨') -> 'items' -> 0) k)
  = array['category','id','imageRef','isFavorite','isOpen','isRecommended','matchingMenu','name','representativeMenu','reviewSummary'],
  '[anon] 카드 응답 키 = StoreCardDto + matchingMenu');
select ok((select array_agg(k order by k) from jsonb_object_keys(public.search_stores('치킨')) k)
  = array['hasMore','items','nextCursor'], '[anon] Page 응답 키는 items, hasMore, nextCursor');
select ok(not exists (
    select 1 from jsonb_array_elements(public.search_stores('치킨', null, 50) -> 'items') e where e -> 'isFavorite' <> 'null'::jsonb),
  '[anon] Guest의 isFavorite는 null');

-- 정렬과 커서 순회
select ok(public.test_search_names('테스트') = (select array_agg(n order by n) from unnest(public.test_search_names('테스트')) n),
  '[anon] 결과는 가게 이름 오름차순');
select ok((public.test_search_walk('테스트', 3) -> 'names') = to_jsonb(public.test_search_names('테스트')),
  '[anon] 3개씩 순회하면 한 번에 받은 것과 같은 순서, 중복·누락 없음');
select ok((public.test_search_walk('테스트', 3) ->> 'pages')::int = ceil(cardinality(public.test_search_names('테스트')) / 3.0)::int,
  '[anon] 페이지 수가 올림(전체/3)');
select ok((public.search_stores('테스트', null, 3) ->> 'hasMore') = 'true' and (public.search_stores('테스트', null, 3) ->> 'nextCursor') is not null,
  '[anon] 첫 페이지: hasMore=true, nextCursor 있음');
select ok((public.search_stores('테스트', null, 50) ->> 'hasMore') = 'false' and public.search_stores('테스트', null, 50) -> 'nextCursor' = 'null'::jsonb,
  '[anon] 마지막 페이지: hasMore=false, nextCursor=null');
select ok(public.test_search_walk('치킨', 1) -> 'names' = to_jsonb(public.test_search_names('치킨')),
  '[anon] 1개씩 순회해도 같은 결과 (여러 경로로 걸린 가게가 중복되지 않음)');

-- 기본 pageSize는 20
select ok(cardinality(public.test_search_names('테스트', 50)) >= 8, '[anon] seed: "테스트" 검색은 가게 8곳 이상');
select is(cardinality(array(select jsonb_array_elements(public.search_stores('가') -> 'items'))) <= 20, true, '[anon] 기본 pageSize는 20 이하');

-- ---------------------------------------------------------------- authenticated
reset role;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select ok(public.test_search_names('테스트') = (select array_agg(n) from unnest(public.test_search_names('테스트')) n),
  '[authenticated] 호출할 수 있다');
select ok(public.test_search_names('ZQ Latte') = array['ZQ Latte House'], '[authenticated] 검색 결과가 anon과 같다');
select ok((public.test_search_card('ZQ Latte', 'ZQ Latte House') ->> 'isFavorite') = 'true', '[authenticated] 찜한 가게는 isFavorite=true');
select ok((public.test_search_card('치킨', '테스트 치킨집') ->> 'isFavorite') = 'false', '[authenticated] 찜하지 않은 가게는 isFavorite=false');
select ok(not exists (
    select 1 from jsonb_array_elements(public.search_stores('테스트', null, 50) -> 'items') e where jsonb_typeof(e -> 'isFavorite') <> 'boolean'),
  '[authenticated] 모든 카드의 isFavorite는 true/false');
select is(public.search_stores('QA 비활성') -> 'items', '[]'::jsonb, '[authenticated] 비활성은 로그인해도 숨겨진다');
select ok(array_position(public.test_search_names('피자'), '테스트 피자집') is not null, '[authenticated] 영업 종료 가게도 나온다');
select ok(public.test_err($$select public.search_stores('')$$, 'P0001', 'INVALID_INPUT'), '[authenticated] 0자 → INVALID_INPUT');
select ok(public.test_err($$select public.search_stores(repeat('가', 51))$$, 'P0001', 'INVALID_INPUT'), '[authenticated] 51자 → INVALID_INPUT');
select ok((public.test_search_walk('테스트', 3) -> 'names') = to_jsonb(public.test_search_names('테스트')), '[authenticated] 커서 순회도 같다');

-- ---------------------------------------------------------------- 권한·함수 설정 (superuser)
reset role;
select ok(has_function_privilege('anon', 'public.search_stores(text,text,integer)', 'execute'), 'anon은 search_stores를 실행할 수 있다');
select ok(has_function_privilege('authenticated', 'public.search_stores(text,text,integer)', 'execute'), 'authenticated도 실행할 수 있다');
select ok(not exists (
    select 1 from pg_proc p where p.proname = 'search_stores' and coalesce(p.proacl::text, '') ~ '(^|[{,])=X'),
  'PUBLIC에는 실행 권한을 열어두지 않았다');
select ok(not (select p.prosecdef from pg_proc p where p.proname = 'search_stores'), 'SECURITY INVOKER다 (DEFINER가 아님)');
select ok((select p.proconfig @> array['search_path=""'] from pg_proc p where p.proname = 'search_stores'), 'search_path를 빈 값으로 고정했다');

select * from finish();
rollback;
