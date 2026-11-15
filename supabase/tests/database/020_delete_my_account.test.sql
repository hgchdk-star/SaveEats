-- 회원 탈퇴: public.delete_my_account()
-- 테스트 데이터는 롤백으로 사라진다. 호스팅(Supabase)의 auth.users 삭제 권한과 진짜 동시 실행(교착)은 이 파일로 증명하지 못한다(보고서 참고).
create extension if not exists pgtap with schema extensions;

begin;
select * from no_plan();

create function public.zq(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlstate || ':' || sqlerrm;
end;
$$;

create function public.zid(p text) returns uuid language sql immutable as $$ select md5(p)::uuid $$;
create function public.zo(p text) returns uuid language sql stable as $$ select current_setting('zz.' || p)::uuid $$;

create function public.zitem(p_menu uuid, p_qty integer, p_price bigint) returns jsonb language sql as $$
  select jsonb_build_object('menuId', p_menu, 'optionIds', '[]'::jsonb, 'quantity', p_qty, 'approvedUnitPrice', p_price, 'approvedCatalogRevision', 1)
$$;

create function public.zreq(p_store uuid, p_items jsonb, p_key uuid) returns jsonb language sql as $$
  select jsonb_build_object(
    'idempotencyKey', p_key, 'requestVersion', 2, 'storeId', p_store, 'destinationRef', '0de57000-0000-4000-8000-000000000001', 'items', p_items,
    'approvedTotalAmount', (select sum((i ->> 'approvedUnitPrice')::numeric * (i ->> 'quantity')::numeric) from jsonb_array_elements(p_items) i)::bigint,
    'disclosureVersion', '2026-09-30', 'disclosureAcknowledged', true)
$$;

create function public.zmk(p_key text, p_store text, p_menu text) returns uuid language sql as $$
  select (public.create_order(public.zreq(public.zid(p_store), jsonb_build_array(public.zitem(public.zid(p_menu), 1, 1000)), public.zid(p_key))) ->> 'orderId')::uuid
$$;
create function public.zdone(p_key text, p_store text, p_menu text) returns uuid language plpgsql as $$
declare v uuid;
begin
  v := public.zmk(p_key, p_store, p_menu);
  perform public.confirm_order(v, public.zid(p_key || '-confirm'));
  return v;
end;
$$;
create function public.zcan(p_key text, p_store text, p_menu text) returns uuid language plpgsql as $$
declare v uuid;
begin
  v := public.zmk(p_key, p_store, p_menu);
  perform public.cancel_order(v, public.zid(p_key || '-cancel'));
  return v;
end;
$$;

create function public.zjwt(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claims', case when p_uid is null then '' else '{"sub":"' || p_uid || '","role":"authenticated"}' end, true)
$$;

-- 한 사용자의 모든 데이터 개수 (표 이름 → 개수)
create function public.zcount(p_uid uuid) returns jsonb language sql as $$
  select jsonb_build_object(
    'auth', (select count(*) from auth.users where id = p_uid),
    'profiles', (select count(*) from public.profiles where id = p_uid),
    'favorites', (select count(*) from public.store_favorites where user_id = p_uid),
    'orders', (select count(*) from public.orders where user_id = p_uid),
    'items', (select count(*) from public.order_items i join public.orders o on o.id = i.order_id where o.user_id = p_uid),
    'options', (select count(*) from public.order_item_options x join public.order_items i on i.id = x.order_item_id join public.orders o on o.id = i.order_id where o.user_id = p_uid),
    'updates', (select count(*) from public.order_status_updates u join public.orders o on o.id = u.order_id where o.user_id = p_uid),
    'reviews', (select count(*) from public.reviews where user_id = p_uid),
    'review_menus', (select count(*) from public.review_menus m join public.reviews r on r.id = m.review_id where r.user_id = p_uid),
    'helpful_given', (select count(*) from public.review_helpful where user_id = p_uid),
    'helpful_received', (select count(*) from public.review_helpful h join public.reviews r on r.id = h.review_id where r.user_id = p_uid),
    'receipts', (select count(*) from private.review_command_receipts where user_id = p_uid))
$$;
-- 전체 테이블 행 개수 (한 사용자와 무관한 합계 비교용)
create function public.ztotals() returns jsonb language sql as $$
  select jsonb_build_object(
    'auth', (select count(*) from auth.users), 'profiles', (select count(*) from public.profiles), 'favorites', (select count(*) from public.store_favorites),
    'orders', (select count(*) from public.orders), 'items', (select count(*) from public.order_items), 'options', (select count(*) from public.order_item_options),
    'updates', (select count(*) from public.order_status_updates), 'reviews', (select count(*) from public.reviews), 'review_menus', (select count(*) from public.review_menus),
    'helpful', (select count(*) from public.review_helpful), 'receipts', (select count(*) from private.review_command_receipts))
$$;

-- ---------------------------------------------------------------- 픽스처 (superuser)
-- A: 탈퇴하는 사용자 / B, C: 다른 사용자 / E: 프로필 없는 새 계정 / (F: auth.users에 없는 id)
insert into auth.users (id) values
  ('aaaaaaaa-0000-4000-8000-0000000000a1'),
  ('bbbbbbbb-0000-4000-8000-0000000000b2'),
  ('cccccccc-0000-4000-8000-0000000000c3'),
  ('eeeeeeee-0000-4000-8000-0000000000e5');
insert into public.categories (id, code, name, sort_order) values (public.zid('CA'), 'zz-da-a', '탈퇴시험분류', 99);
insert into public.stores (id, category_id, name) values (public.zid('S1'), public.zid('CA'), '탈퇴시험가게1'), (public.zid('S2'), public.zid('CA'), '탈퇴시험가게2');
insert into public.menus (id, store_id, name, base_price) values (public.zid('M1'), public.zid('S1'), '메뉴1', 1000), (public.zid('M2'), public.zid('S2'), '메뉴2', 1000);

-- A: 주문 4건(완료+리뷰, 완료+삭제된 리뷰, 취소+숨김, 대기), 찜 1개, B의 리뷰에 도움돼요
select public.zjwt('aaaaaaaa-0000-4000-8000-0000000000a1');
set local role authenticated;
select set_config('zz.oa1', public.zdone('A1', 'S1', 'M1')::text, true);
select set_config('zz.oa2', public.zdone('A2', 'S2', 'M2')::text, true);
select set_config('zz.oa3', public.zcan('A3', 'S1', 'M1')::text, true);
select set_config('zz.oa4', public.zmk('A4', 'S1', 'M1')::text, true);
select set_config('zz.ra1', public.create_review(public.zo('oa1'), public.zid('A-rev1'), 5, '작성자 리뷰입니다 맛있어요') ->> 'reviewId', true);
select set_config('zz.ra2', public.create_review(public.zo('oa2'), public.zid('A-rev2'), 4, '곧 지울 리뷰입니다 괜찮아요') ->> 'reviewId', true);
select public.delete_review(public.zo('ra2'), public.zid('A-del2'), 1);
select public.hide_cancelled_order(public.zo('oa3'));
select public.set_favorite(public.zid('S1'), true);
select public.set_favorite(public.zid('S2'), true);
reset role;
-- 주문 옵션 한 행 (superuser로 직접)
insert into public.order_item_options (order_item_id, source_group_id, source_option_id, group_name_snapshot, option_name_snapshot, additional_price_snapshot, sort_order)
select i.id, public.zid('G'), public.zid('O'), '그룹', '옵션', 0, 1 from public.order_items i where i.order_id = public.zo('oa1') limit 1;

-- B: 주문 2건, 리뷰 1개(S1), A와 C가 도움돼요
select public.zjwt('bbbbbbbb-0000-4000-8000-0000000000b2');
set local role authenticated;
select set_config('zz.ob1', public.zdone('B1', 'S1', 'M1')::text, true);
select set_config('zz.ob2', public.zcan('B2', 'S1', 'M1')::text, true);
select set_config('zz.rb1', public.create_review(public.zo('ob1'), public.zid('B-rev1'), 3, '다른 사람 리뷰입니다 보통이에요') ->> 'reviewId', true);
select public.set_favorite(public.zid('S1'), true);
reset role;
-- C: 주문 1건, 리뷰 1개(S2)
select public.zjwt('cccccccc-0000-4000-8000-0000000000c3');
set local role authenticated;
select set_config('zz.oc1', public.zdone('C1', 'S2', 'M2')::text, true);
select set_config('zz.rc1', public.create_review(public.zo('oc1'), public.zid('C-rev1'), 5, 'C의 리뷰입니다 최고예요') ->> 'reviewId', true);
reset role;

-- 도움돼요: A→B리뷰, A→C리뷰, C→B리뷰, B→A리뷰, C→A리뷰
select public.zjwt('aaaaaaaa-0000-4000-8000-0000000000a1');
set local role authenticated;
select public.set_helpful(public.zo('rb1'), public.zid('A-h1'), true);
select public.set_helpful(public.zo('rc1'), public.zid('A-h2'), true);
reset role;
select public.zjwt('cccccccc-0000-4000-8000-0000000000c3');
set local role authenticated;
select public.set_helpful(public.zo('rb1'), public.zid('C-h1'), true);
select public.set_helpful(public.zo('ra1'), public.zid('C-h2'), true);
reset role;
select public.zjwt('bbbbbbbb-0000-4000-8000-0000000000b2');
set local role authenticated;
select public.set_helpful(public.zo('ra1'), public.zid('B-h1'), true);
reset role;

-- 시작 상태 기록
select set_config('zz.totals_before', public.ztotals()::text, true);
select set_config('zz.b_before', public.zcount('bbbbbbbb-0000-4000-8000-0000000000b2')::text, true);
select set_config('zz.c_before', public.zcount('cccccccc-0000-4000-8000-0000000000c3')::text, true);
select set_config('zz.a_before', public.zcount('aaaaaaaa-0000-4000-8000-0000000000a1')::text, true);
select set_config('zz.b_dump', (select md5(coalesce(string_agg(x, '|' order by x), '')) from (
  select row_to_json(o)::text x from public.orders o where o.user_id = 'bbbbbbbb-0000-4000-8000-0000000000b2'
  union all select row_to_json(r)::text from public.reviews r where r.user_id = 'bbbbbbbb-0000-4000-8000-0000000000b2'
  union all select row_to_json(u)::text from public.order_status_updates u join public.orders o on o.id = u.order_id where o.user_id = 'bbbbbbbb-0000-4000-8000-0000000000b2'
  union all select row_to_json(f)::text from public.store_favorites f where f.user_id = 'bbbbbbbb-0000-4000-8000-0000000000b2'
  union all select row_to_json(c)::text from private.review_command_receipts c where c.user_id = 'bbbbbbbb-0000-4000-8000-0000000000b2' and c.target_id <> public.zo('ra1')) t), true);
select set_config('zz.sum_s1_before', (select to_jsonb(s)::text from public.store_review_summaries s where s.store_id = public.zid('S1')), true);

-- ================================================================ 준비 확인
select is((current_setting('zz.a_before')::jsonb ->> 'orders')::int, 4, '(준비) A의 주문 4건');
select is((current_setting('zz.a_before')::jsonb ->> 'reviews')::int, 2, '(준비) A의 리뷰 2건(삭제 표시 1건 포함)');
select is((current_setting('zz.a_before')::jsonb ->> 'helpful_given')::int, 2, '(준비) A가 누른 도움돼요 2건');
select is((current_setting('zz.a_before')::jsonb ->> 'helpful_received')::int, 2, '(준비) A의 리뷰에 달린 도움돼요 2건');
select is((current_setting('zz.a_before')::jsonb ->> 'options')::int, 1, '(준비) A의 주문 옵션 1건');
select is((current_setting('zz.a_before')::jsonb ->> 'favorites')::int, 2, '(준비) A의 찜 2건');
select is((select hidden_at is not null from public.orders where id = public.zo('oa3')), true, '(준비) A의 숨긴 주문이 있다');
select is((select (select count(*) from public.review_helpful where review_id = public.zo('rb1'))::int), 2, '(준비) B의 리뷰 helpfulCount 2 (A, C)');
select is((select (select count(*) from public.review_helpful where review_id = public.zo('rc1'))::int), 1, '(준비) C의 리뷰 helpfulCount 1 (A)');
select is((select review_count from public.store_review_summaries where store_id = public.zid('S1')), 2, '(준비) 가게1 리뷰 2개(A, B; A의 삭제된 리뷰는 안 셈 → A의 활성 리뷰 1 + B 1)');
select is((select average_craving_rating from public.store_review_summaries where store_id = public.zid('S1')), 4.0::numeric, '(준비) 가게1 평균 4.0 (5와 3)');

-- ================================================================ 구조
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'delete_my_account'), 1, 'delete_my_account가 하나 있다');
select is((select p.prosecdef from pg_proc p where p.oid = 'public.delete_my_account()'::regprocedure), true, 'SECURITY DEFINER');
select is((select p.proconfig from pg_proc p where p.oid = 'public.delete_my_account()'::regprocedure), array['search_path=""'], 'search_path 고정');
select is((select p.pronargs::int from pg_proc p where p.oid = 'public.delete_my_account()'::regprocedure), 0, '인자 없음');
select is(has_function_privilege('anon', 'public.delete_my_account()', 'execute'), false, 'anon은 실행할 수 없다');
select is(has_function_privilege('authenticated', 'public.delete_my_account()', 'execute'), true, 'authenticated는 실행할 수 있다');
select is(has_function_privilege('public', 'public.delete_my_account()', 'execute'), false, 'PUBLIC은 실행할 수 없다');

-- ================================================================ 거절
select public.zjwt(null);
set local role anon;
select is(public.zq($q$select public.delete_my_account()$q$), '42501:permission denied for function delete_my_account', 'anon 거부(42501)');
reset role;
set local role authenticated;
select is(public.zq($q$select public.delete_my_account()$q$), 'P0001:AUTH_REQUIRED', '로그인 없음 → AUTH_REQUIRED');
reset role;
-- 존재하지 않는 사용자(토큰만 유효): AUTH_REQUIRED, 아무것도 만들지 않는다
select public.zjwt('ffffffff-0000-4000-8000-0000000000f6');
set local role authenticated;
select is(public.zq($q$select public.delete_my_account()$q$), 'P0001:AUTH_REQUIRED', '사용자 행이 없으면 AUTH_REQUIRED (다른 오류 없음)');
reset role;
select is(public.ztotals()::text, current_setting('zz.totals_before'), '거절된 호출은 아무 데이터도 바꾸지 않았다(프로필도 만들지 않음)');

-- ================================================================ 실패하면 전체 롤백
-- auth.users 삭제가 막히는 경우를 흉내 낸다 (호스팅 권한 부족과 같은 모양). 트리거를 끄지 않고, 시험 안에서 만든 트리거로 실패를 일으킨다.
create function public.zblock() returns trigger language plpgsql as $$ begin raise exception 'ZBLOCK'; end; $$;
create trigger zblock_auth before delete on auth.users for each row execute function public.zblock();
select public.zjwt('aaaaaaaa-0000-4000-8000-0000000000a1');
set local role authenticated;
select is(public.zq($q$select public.delete_my_account()$q$), 'P0001:ZBLOCK', '마지막 단계(auth.users)가 실패하면 예외가 그대로 올라온다');
reset role;
select is(public.zcount('aaaaaaaa-0000-4000-8000-0000000000a1')::text, current_setting('zz.a_before'), '전체 롤백: A의 데이터가 모두 그대로');
select is(public.ztotals()::text, current_setting('zz.totals_before'), '전체 롤백: 전체 행 개수도 그대로');
drop trigger zblock_auth on auth.users;

-- 중간 단계(찜) 실패
create trigger zblock_fav before delete on public.store_favorites for each row execute function public.zblock();
select public.zjwt('aaaaaaaa-0000-4000-8000-0000000000a1');
set local role authenticated;
select is(public.zq($q$select public.delete_my_account()$q$), 'P0001:ZBLOCK', '중간 단계(찜)가 실패해도 예외가 올라온다');
reset role;
select is(public.ztotals()::text, current_setting('zz.totals_before'), '전체 롤백: 이미 지운 하위 데이터(도움돼요·리뷰·주문)도 되살아났다');
drop trigger zblock_fav on public.store_favorites;

-- 개수 불일치 롤백: 지우는 도중 행 개수가 달라지게 만드는 트리거(삭제를 조용히 건너뜀)
create function public.zskip() returns trigger language plpgsql as $$ begin return null; end; $$;
create trigger zskip_helpful before delete on public.review_helpful for each row execute function public.zskip();
select public.zjwt('aaaaaaaa-0000-4000-8000-0000000000a1');
set local role authenticated;
select is(public.zq($q$select public.delete_my_account()$q$), 'P0001:ACCOUNT_DELETE_COUNT_MISMATCH', '지운 개수가 미리 센 개수와 다르면 ACCOUNT_DELETE_COUNT_MISMATCH');
reset role;
select is(public.ztotals()::text, current_setting('zz.totals_before'), '개수 불일치: 전체 롤백');
drop trigger zskip_helpful on public.review_helpful;

-- ================================================================ 성공: 프로필 없는 새 계정 E
select public.zjwt('eeeeeeee-0000-4000-8000-0000000000e5');
set local role authenticated;
select is(public.delete_my_account(), '{"deleted": true}'::jsonb, '[프로필 없는 E] 탈퇴 성공 응답은 {"deleted": true}뿐');
reset role;
select is((select count(*)::int from auth.users where id = 'eeeeeeee-0000-4000-8000-0000000000e5'), 0, '[E] Auth 계정이 지워졌다');
select is((select count(*)::int from public.profiles where id = 'eeeeeeee-0000-4000-8000-0000000000e5'), 0, '[E] 프로필 행이 남지 않았다');

-- ================================================================ 성공: A
select public.zjwt('aaaaaaaa-0000-4000-8000-0000000000a1');
set local role authenticated;
select set_config('zz.res', public.delete_my_account()::text, true);
reset role;
select is(current_setting('zz.res')::jsonb, '{"deleted": true}'::jsonb, '[A] 응답은 {"deleted": true}뿐');
select is((select count(*)::int from jsonb_object_keys(current_setting('zz.res')::jsonb)), 1, '[A] 응답 키는 하나뿐(개인정보 없음)');
select is(public.zcount('aaaaaaaa-0000-4000-8000-0000000000a1'),
  '{"auth":0,"profiles":0,"favorites":0,"orders":0,"items":0,"options":0,"updates":0,"reviews":0,"review_menus":0,"helpful_given":0,"helpful_received":0,"receipts":0}'::jsonb,
  '[A] 모든 사용자 데이터가 지워졌다');
select is((select count(*)::int from public.orders where id in (public.zo('oa1'), public.zo('oa2'), public.zo('oa3'), public.zo('oa4'))), 0, '[A] 숨긴 주문과 삭제 표시 리뷰의 주문까지 지워졌다');
select is((select count(*)::int from public.reviews where id in (public.zo('ra1'), public.zo('ra2'))), 0, '[A] 삭제 표시된 리뷰도 지워졌다');
select is((select count(*)::int from private.review_command_receipts where applied_review_id in (public.zo('ra1'), public.zo('ra2')) or target_id in (public.zo('ra1'), public.zo('ra2'), public.zo('rb1'), public.zo('rc1')) and user_id = 'aaaaaaaa-0000-4000-8000-0000000000a1'), 0, '[A] 리뷰 영수증(멱등 키)이 지워졌다');
select is((select count(*)::int from private.review_command_receipts where applied_review_id = public.zo('ra1') or target_id = public.zo('ra1')), 0, '[A] A의 리뷰를 가리키던 다른 사람의 영수증(C·B의 도움돼요)도 지워졌다');

-- 다른 사용자 데이터는 그대로
select is(public.zcount('cccccccc-0000-4000-8000-0000000000c3') - 'helpful_given' - 'helpful_received' - 'receipts', current_setting('zz.c_before')::jsonb - 'helpful_given' - 'helpful_received' - 'receipts', '[C] 데이터 개수 불변(도움돼요·영수증 제외)');
select is((select count(*)::int from public.review_helpful where user_id = 'cccccccc-0000-4000-8000-0000000000c3'), 1, '[C] 자신이 누른 도움돼요 중 B 리뷰 것은 남았다 (A 리뷰에 단 것은 A 리뷰와 함께 지워짐)');
select is(public.zcount('bbbbbbbb-0000-4000-8000-0000000000b2') - 'helpful_received' - 'helpful_given' - 'receipts', current_setting('zz.b_before')::jsonb - 'helpful_received' - 'helpful_given' - 'receipts', '[B] 데이터 개수 불변(도움돼요·영수증 제외)');
select is((select md5(coalesce(string_agg(x, '|' order by x), '')) from (
  select row_to_json(o)::text x from public.orders o where o.user_id = 'bbbbbbbb-0000-4000-8000-0000000000b2'
  union all select row_to_json(r)::text from public.reviews r where r.user_id = 'bbbbbbbb-0000-4000-8000-0000000000b2'
  union all select row_to_json(u)::text from public.order_status_updates u join public.orders o on o.id = u.order_id where o.user_id = 'bbbbbbbb-0000-4000-8000-0000000000b2'
  union all select row_to_json(f)::text from public.store_favorites f where f.user_id = 'bbbbbbbb-0000-4000-8000-0000000000b2'
  union all select row_to_json(c)::text from private.review_command_receipts c where c.user_id = 'bbbbbbbb-0000-4000-8000-0000000000b2' and c.target_id <> public.zo('ra1')) t),
  current_setting('zz.b_dump'), '[B] 주문·리뷰·이력·찜·영수증(A 리뷰를 가리키는 것 제외)의 내용이 한 글자도 바뀌지 않았다');
select is((select count(*)::int from private.review_command_receipts where user_id in ('bbbbbbbb-0000-4000-8000-0000000000b2', 'cccccccc-0000-4000-8000-0000000000c3') and target_id = public.zo('ra1')), 0, '[B·C] A의 리뷰를 가리키던 B·C의 도움돼요 영수증만 지워졌다');
select is((select count(*)::int from private.review_command_receipts where user_id in ('bbbbbbbb-0000-4000-8000-0000000000b2', 'cccccccc-0000-4000-8000-0000000000c3') and target_id <> public.zo('ra1')), 3, '[B·C] 그 밖의 영수증 3건(B 리뷰 작성 · C 리뷰 작성 · C가 B 리뷰에 누른 도움돼요)은 그대로');
select is((select count(*)::int from auth.users where id in ('bbbbbbbb-0000-4000-8000-0000000000b2', 'cccccccc-0000-4000-8000-0000000000c3')), 2, '[B·C] Auth 계정이 남아 있다');
select is((select count(*)::int from public.stores where id in (public.zid('S1'), public.zid('S2'))), 2, '가게·메뉴 같은 공용 데이터는 그대로');
select is((select count(*)::int from public.menus where id in (public.zid('M1'), public.zid('M2'))), 2, '메뉴도 그대로');

-- 타인 리뷰의 helpfulCount 감소: B의 리뷰는 A·C가 눌렀다가 A만큼(1) 줄어 1, C의 리뷰는 A만 눌렀다가 0
select is((private.review_json(public.zo('rb1'), null, false) ->> 'helpfulCount')::int, 1, '[B 리뷰] helpfulCount 2 → 1 (A가 누른 만큼 감소)');
select is((private.review_json(public.zo('rc1'), null, false) ->> 'helpfulCount')::int, 0, '[C 리뷰] helpfulCount 1 → 0');

-- 가게 리뷰 요약
select is((select review_count from public.store_review_summaries where store_id = public.zid('S1')), 1, '[가게1] 리뷰 요약 count 2 → 1');
select is((select average_craving_rating from public.store_review_summaries where store_id = public.zid('S1')), 3.0::numeric, '[가게1] 평균 4.0 → 3.0');
select is((select review_count from public.store_review_summaries where store_id = public.zid('S2')), 1, '[가게2] count 1 (A의 삭제된 리뷰는 원래 안 셌다)');
select is(public.get_store(public.zid('S1')) -> 'reviewSummary', '{"count":1,"averageCravingRating":3.0}'::jsonb, 'get_store(S1)의 reviewSummary도 갱신');

-- 전체 합계: A의 행만큼만 줄었다
select is(public.ztotals() - 'auth' - 'profiles', current_setting('zz.totals_before')::jsonb - 'auth' - 'profiles'
  - 'orders' - 'items' - 'options' - 'updates' - 'reviews' - 'review_menus' - 'helpful' - 'receipts' - 'favorites'
  || jsonb_build_object(
    'orders', (current_setting('zz.totals_before')::jsonb ->> 'orders')::int - 4,
    'items', (current_setting('zz.totals_before')::jsonb ->> 'items')::int - (current_setting('zz.a_before')::jsonb ->> 'items')::int,
    'options', (current_setting('zz.totals_before')::jsonb ->> 'options')::int - 1,
    'updates', (current_setting('zz.totals_before')::jsonb ->> 'updates')::int - (current_setting('zz.a_before')::jsonb ->> 'updates')::int,
    'reviews', (current_setting('zz.totals_before')::jsonb ->> 'reviews')::int - 2,
    'review_menus', (current_setting('zz.totals_before')::jsonb ->> 'review_menus')::int - (current_setting('zz.a_before')::jsonb ->> 'review_menus')::int,
    'helpful', (current_setting('zz.totals_before')::jsonb ->> 'helpful')::int - 4,
    'receipts', (current_setting('zz.totals_before')::jsonb ->> 'receipts')::int - ((current_setting('zz.a_before')::jsonb ->> 'receipts')::int + 2),
    'favorites', (current_setting('zz.totals_before')::jsonb ->> 'favorites')::int - 2),
  '전체 합계: A의 행(+A 리뷰에 달린 타인 영수증 2건)만큼만 줄었다');

-- 재시도: 사용자 행이 이미 없다 (토큰은 같다) → AUTH_REQUIRED
select public.zjwt('aaaaaaaa-0000-4000-8000-0000000000a1');
set local role authenticated;
select is(public.zq($q$select public.delete_my_account()$q$), 'P0001:AUTH_REQUIRED', '[재시도] 탈퇴 뒤 같은 토큰으로 다시 부르면 AUTH_REQUIRED');
reset role;
select is((select count(*)::int from public.profiles where id = 'aaaaaaaa-0000-4000-8000-0000000000a1'), 0, '[재시도] 프로필이 다시 생기지 않는다');

-- 탈퇴한 사용자의 다른 함수도 프로필을 되살리지 못한다(auth.users가 없어 FK로 막힘): 참고용 확인
set local role authenticated;
select is(public.zq($q$select public.ensure_my_profile()$q$) ~ '^23503', true, '[참고] 탈퇴 뒤 ensure_my_profile은 FK로 실패한다(계정이 없으므로)');
reset role;

select * from finish();
rollback;
