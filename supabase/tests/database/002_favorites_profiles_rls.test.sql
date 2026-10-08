-- 프로필·가게 찜: 본인 데이터 경계(RLS), 목표값 명령, 목록 페이지네이션, Guest 차단
-- 근거: 개발 명세 SEC-002, SEC-003, SEC-005, AUTH-003
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

-- 사용자 A, B (Auth 사용자 행만 필요하다. 롤백으로 사라짐)
insert into auth.users (id) values
  ('aaaaaaaa-0000-4000-8000-000000000001'),
  ('bbbbbbbb-0000-4000-8000-000000000002');

-- 시드 가게: 치킨(01) / 분식(02) / 한식(04), 비활성 가게(98)
-- ---------------------------------------------------------------- Guest 차단
set local role anon;
select ok(public.test_err($$select public.set_favorite('20000000-0000-4000-8000-000000000001', true)$$, '42501'),
  '[anon] set_favorite 실행 금지');
select ok(public.test_err('select public.list_my_favorites()', '42501'), '[anon] list_my_favorites 실행 금지');
select ok(public.test_err('select public.ensure_my_profile()', '42501'), '[anon] ensure_my_profile 실행 금지');
select ok(public.test_err('select store_id from public.store_favorites', '42501'), '[anon] store_favorites 조회 금지');
select ok(public.test_err('select id from public.profiles', '42501'), '[anon] profiles 조회 금지');
select ok(public.test_err(
    $$insert into public.store_favorites (user_id, store_id) values ('aaaaaaaa-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001')$$,
    '42501'), '[anon] store_favorites 직접 INSERT 금지');

-- 로그인 정보(sub) 없이 authenticated 역할만 쓰면 AUTH_REQUIRED
reset role;
select set_config('request.jwt.claims', '', true);
set local role authenticated;
select ok(public.test_err($$select public.set_favorite('20000000-0000-4000-8000-000000000001', true)$$, 'P0001', 'AUTH_REQUIRED'),
  '[authenticated, sub 없음] set_favorite → AUTH_REQUIRED');

-- ---------------------------------------------------------------- 사용자 A
reset role;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select is(public.ensure_my_profile(),
  '{"id":"aaaaaaaa-0000-4000-8000-000000000001","name":null}'::jsonb, 'ensure_my_profile: 본인 프로필 생성, name은 null');
select is(public.ensure_my_profile(),
  '{"id":"aaaaaaaa-0000-4000-8000-000000000001","name":null}'::jsonb, 'ensure_my_profile: 다시 호출해도 같은 결과(중복 안전)');
select is((select count(*)::int from public.profiles), 1, '본인 프로필만 조회된다');

select ok(public.test_err($$insert into public.profiles (id) values ('aaaaaaaa-0000-4000-8000-000000000001')$$, '42501'),
  '프로필 직접 INSERT 금지');
select ok(public.test_err($$update public.profiles set name = 'x'$$, '42501'), '프로필 직접 UPDATE 금지');

select ok(public.test_err($$select public.set_favorite('20000000-0000-4000-8000-000000000098', true)$$, 'P0001', 'RESOURCE_NOT_FOUND'),
  '비활성 가게 찜하기 → RESOURCE_NOT_FOUND');
select is(public.set_favorite('20000000-0000-4000-8000-000000000098', false),
  '{"storeId":"20000000-0000-4000-8000-000000000098","isFavorite":false}'::jsonb, '비활성 가게 찜 해제는 항상 허용');
select ok(public.test_err($$select public.set_favorite(null, true)$$, 'P0001', 'INVALID_INPUT'), 'storeId null → INVALID_INPUT');

select is(public.set_favorite('20000000-0000-4000-8000-000000000001', true),
  '{"storeId":"20000000-0000-4000-8000-000000000001","isFavorite":true}'::jsonb, 'set_favorite(true)');
select is(public.set_favorite('20000000-0000-4000-8000-000000000001', true),
  '{"storeId":"20000000-0000-4000-8000-000000000001","isFavorite":true}'::jsonb, 'set_favorite(true) 반복해도 같은 결과(멱등)');
select is((select count(*)::int from public.store_favorites), 1, '찜 행은 하나만 생긴다');

-- isFavorite 반영
select is((public.get_store('20000000-0000-4000-8000-000000000001') ->> 'isFavorite'), 'true', 'get_store: 찜한 가게 isFavorite=true');
select is((public.get_store('20000000-0000-4000-8000-000000000002') ->> 'isFavorite'), 'false', 'get_store: 안 찜한 가게 isFavorite=false');
select is((select array_agg(e ->> 'id') from jsonb_array_elements(public.list_stores(null, null, 50) -> 'items') e
    where (e ->> 'isFavorite') = 'true'),
  array['20000000-0000-4000-8000-000000000001'], 'list_stores: 찜한 가게만 isFavorite=true');

-- 직접 INSERT/DELETE(RLS)
select ok(public.test_err(
    $$insert into public.store_favorites (user_id, store_id) values ('bbbbbbbb-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002')$$,
    '42501', 'row-level security'), '다른 사용자 이름으로 찜 INSERT 금지');
select ok(public.test_err(
    $$insert into public.store_favorites (user_id, store_id) values ('aaaaaaaa-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000098')$$,
    '42501', 'row-level security'), '비활성 가게 직접 찜 INSERT 금지');
select ok(public.test_err($$update public.store_favorites set store_id = '20000000-0000-4000-8000-000000000002'$$, '42501'),
  'store_favorites UPDATE 금지');

-- 찜 목록: 최근 찜 순, 페이지네이션, 비활성 가게 숨김
select public.set_favorite('20000000-0000-4000-8000-000000000002', true);
select public.set_favorite('20000000-0000-4000-8000-000000000004', true);
reset role;
-- 한 트랜잭션에서는 now()가 같으므로 찜한 시각을 명시적으로 벌려둔다 (치킨 < 분식 < 한식)
update public.store_favorites set created_at = now() - interval '3 minutes'
  where user_id = 'aaaaaaaa-0000-4000-8000-000000000001' and store_id = '20000000-0000-4000-8000-000000000001';
update public.store_favorites set created_at = now() - interval '2 minutes'
  where user_id = 'aaaaaaaa-0000-4000-8000-000000000001' and store_id = '20000000-0000-4000-8000-000000000002';
update public.store_favorites set created_at = now() - interval '1 minute'
  where user_id = 'aaaaaaaa-0000-4000-8000-000000000001' and store_id = '20000000-0000-4000-8000-000000000004';
set local role authenticated;

select is((select array_agg(e ->> 'id') from jsonb_array_elements(public.list_my_favorites(null, 50) -> 'items') e),
  array['20000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001'],
  'list_my_favorites: 최근 찜한 순');
select ok((select array_agg(k order by k) from jsonb_object_keys(public.list_my_favorites(null, 50) -> 'items' -> 0) k)
  = array['category','favoritedAt','id','imageRef','isFavorite','isOpen','isRecommended','name','representativeMenu','reviewSummary'],
  'list_my_favorites: 응답 키');
select is((public.list_my_favorites(null, 2) ->> 'hasMore'), 'true', 'list_my_favorites: 2개씩 → hasMore=true');
select is((select array_agg(e ->> 'id') from jsonb_array_elements(
    public.list_my_favorites(public.list_my_favorites(null, 2) ->> 'nextCursor', 2) -> 'items') e),
  array['20000000-0000-4000-8000-000000000001'], 'list_my_favorites: 다음 페이지');
select ok(public.test_err($$select public.list_my_favorites('garbage', 2)$$, 'P0001', 'INVALID_INPUT'),
  'list_my_favorites: 잘못된 cursor → INVALID_INPUT');
select ok(public.test_err($$select public.list_my_favorites(null, 0)$$, 'P0001', 'INVALID_INPUT'),
  'list_my_favorites: pageSize 0 → INVALID_INPUT');

reset role;
update public.stores set is_active = false where id = '20000000-0000-4000-8000-000000000002';
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is((select array_agg(e ->> 'id') from jsonb_array_elements(public.list_my_favorites(null, 50) -> 'items') e),
  array['20000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000001'],
  '비활성이 된 가게는 찜 목록에서 숨겨진다');
select is((select count(*)::int from public.store_favorites), 3, '숨겨졌을 뿐 찜 행은 삭제되지 않는다');
select public.set_favorite('20000000-0000-4000-8000-000000000002', false);
select is((select count(*)::int from public.store_favorites), 2, '비활성 가게의 남은 찜도 본인이 해제할 수 있다');

-- ---------------------------------------------------------------- 사용자 B (다른 사람의 데이터 경계)
reset role;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;

select is((select count(*)::int from public.store_favorites), 0, 'B는 A의 찜을 볼 수 없다');
select is((select count(*)::int from public.profiles), 0, 'B는 A의 프로필을 볼 수 없다 (본인 프로필이 아직 없음)');
select is((public.get_store('20000000-0000-4000-8000-000000000001') ->> 'isFavorite'), 'false', 'B 기준 isFavorite는 false');
select is((select jsonb_array_length(public.list_my_favorites(null, 50) -> 'items')), 0, 'B의 찜 목록은 비어 있다');
delete from public.store_favorites where user_id = 'aaaaaaaa-0000-4000-8000-000000000001';
reset role;
select is((select count(*)::int from public.store_favorites where user_id = 'aaaaaaaa-0000-4000-8000-000000000001'), 2,
  'B가 A의 찜을 지우려 해도 영향이 없다');

-- ON DELETE RESTRICT 위반의 SQLSTATE는 23001
select ok(public.test_err($$delete from auth.users where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$, '23001'),
  '프로필이 있는 Auth 사용자는 삭제할 수 없다(주문·기록 보호, CASCADE 없음)');

select * from finish();
rollback;
