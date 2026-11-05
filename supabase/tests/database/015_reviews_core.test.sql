-- 리뷰 핵심: 작성 자격 · 생성/수정/삭제 · 도움돼요 · 공개/내 목록 · 가게 요약 집계 · 내역 행의 reviewEligibility
-- 근거: 기획서 30~31, PRD 32, 개발 명세 REV-001~009 · DB-008~009. 테스트 데이터는 롤백으로 사라진다.
-- 주문은 실제 경로(create_order, confirm_order, cancel_order)로 만든다. 기한 경계는 완료 시각(completed_at)을 가드 트리거를 잠시 끄고 옮겨서 만든다(롤백됨).
-- 정확히 마감 시각(= completed_at + 720h)인 순간은 실제 시계로는 만들 수 없어서 private.is_review_window_open(완료 시각, 기준 시각)을 직접 불러 확인한다.
-- 진짜 동시성(작성 두 개 동시, 삭제와 재작성 동시 등)은 한 세션 테스트로 볼 수 없다 → 수동 확인 목록.
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

-- 문장을 실행해 'OK' 또는 'SQLSTATE:메시지'를 돌려준다
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

-- 현재 사용자로 주문을 만들고 완료까지 시킨다 (메뉴 하나)
create function public.zdone(p_key text, p_store uuid, p_menu uuid, p_price bigint) returns uuid language plpgsql as $$
declare v uuid;
begin
  v := (public.create_order(public.zreq(p_store, jsonb_build_array(public.zitem(p_menu, 1, p_price)), public.zid(p_key))) ->> 'orderId')::uuid;
  perform public.confirm_order(v, public.zid(p_key || '-confirm'));
  return v;
end;
$$;

-- 주문 줄 두 개(서로 다른 메뉴)로 만들고 완료까지
create function public.zdone2(p_key text, p_store uuid, p_menu1 uuid, p_price1 bigint, p_menu2 uuid, p_price2 bigint) returns uuid language plpgsql as $$
declare v uuid;
begin
  v := (public.create_order(public.zreq(p_store, jsonb_build_array(public.zitem(p_menu1, 1, p_price1), public.zitem(p_menu2, 1, p_price2)), public.zid(p_key))) ->> 'orderId')::uuid;
  perform public.confirm_order(v, public.zid(p_key || '-confirm'));
  return v;
end;
$$;

-- 쓰기 함수 결과를 'OK' 또는 'SQLSTATE:메시지'로 (op는 이름 문자열, null이면 operationId null)
create function public.zecr(p_order uuid, p_op text, p_rating integer, p_body text) returns text language plpgsql as $$
begin perform public.create_review(p_order, public.zid(p_op), p_rating, p_body); return 'OK';
exception when others then return sqlstate || ':' || sqlerrm; end; $$;
create function public.zeur(p_review uuid, p_op text, p_rev bigint, p_rating integer, p_body text) returns text language plpgsql as $$
begin perform public.update_review(p_review, public.zid(p_op), p_rev, p_rating, p_body); return 'OK';
exception when others then return sqlstate || ':' || sqlerrm; end; $$;
create function public.zedr(p_review uuid, p_op text, p_rev bigint) returns text language plpgsql as $$
begin perform public.delete_review(p_review, public.zid(p_op), p_rev); return 'OK';
exception when others then return sqlstate || ':' || sqlerrm; end; $$;
create function public.zesh(p_review uuid, p_op text, p_desired boolean) returns text language plpgsql as $$
begin perform public.set_helpful(p_review, public.zid(p_op), p_desired); return 'OK';
exception when others then return sqlstate || ':' || sqlerrm; end; $$;

-- 공개 목록을 끝까지 따라가며 reviewId를 모은다 (페이지 수 상한 100)
create function public.zwalk_pub(p_scope text, p_scope_id uuid, p_sort text, p_size integer) returns text language plpgsql as $$
declare v_cursor text := null; v_page jsonb; v_ids text := ''; v_n integer := 0;
begin
  loop
    v_page := public.list_public_reviews(p_scope, p_scope_id, p_sort, v_cursor, p_size);
    v_ids := v_ids || (select coalesce(string_agg(e ->> 'reviewId', ',' order by ord), '') from jsonb_array_elements(v_page -> 'items') with ordinality as t (e, ord)) ||
             case when jsonb_array_length(v_page -> 'items') > 0 and (v_page ->> 'hasMore')::boolean then ',' else '' end;
    v_n := v_n + 1;
    exit when not (v_page ->> 'hasMore')::boolean or v_n >= 100;
    v_cursor := v_page ->> 'nextCursor';
  end loop;
  return v_ids;
end;
$$;

create function public.zwalk_my(p_size integer) returns text language plpgsql as $$
declare v_cursor text := null; v_page jsonb; v_ids text := ''; v_n integer := 0;
begin
  loop
    v_page := public.list_my_reviews(v_cursor, p_size);
    v_ids := v_ids || (select coalesce(string_agg(e ->> 'reviewId', ',' order by ord), '') from jsonb_array_elements(v_page -> 'items') with ordinality as t (e, ord)) ||
             case when jsonb_array_length(v_page -> 'items') > 0 and (v_page ->> 'hasMore')::boolean then ',' else '' end;
    v_n := v_n + 1;
    exit when not (v_page ->> 'hasMore')::boolean or v_n >= 100;
    v_cursor := v_page ->> 'nextCursor';
  end loop;
  return v_ids;
end;
$$;

-- 공개 리뷰 한 건의 키가 문서(REV-008)와 같은지: 내부 ID · 이메일 · images 없음. 맞으면 'OK'
create function public.zpub_shape(r jsonb) returns text language plpgsql as $$
begin
  if (select array_agg(k order by k) from jsonb_object_keys(r) k) is distinct from
     array['authorNickname', 'body', 'createdAt', 'editedAt', 'helpfulCount', 'isMine', 'menuIds', 'menuNamesSnapshot', 'myHelpful',
           'orderAmount', 'rating', 'reviewId', 'revision', 'storeId', 'storeNameSnapshot'] then
    return 'public keys';
  end if;
  if jsonb_typeof(r -> 'reviewId') <> 'string' or jsonb_typeof(r -> 'revision') <> 'number' or jsonb_typeof(r -> 'authorNickname') not in ('string', 'null')
     or jsonb_typeof(r -> 'rating') <> 'number' or jsonb_typeof(r -> 'body') <> 'string' or jsonb_typeof(r -> 'createdAt') <> 'string'
     or jsonb_typeof(r -> 'editedAt') not in ('string', 'null') or jsonb_typeof(r -> 'storeId') <> 'string'
     or jsonb_typeof(r -> 'storeNameSnapshot') <> 'string' or jsonb_typeof(r -> 'menuIds') <> 'array' or jsonb_typeof(r -> 'menuNamesSnapshot') <> 'array'
     or jsonb_typeof(r -> 'orderAmount') <> 'number' or jsonb_typeof(r -> 'helpfulCount') <> 'number'
     or jsonb_typeof(r -> 'isMine') <> 'boolean' or jsonb_typeof(r -> 'myHelpful') <> 'boolean' then
    return 'public types';
  end if;
  return 'OK';
end;
$$;

-- ---------------------------------------------------------------- 픽스처 (superuser)
insert into auth.users (id) values
  ('aaaaaaaa-0000-4000-8000-000000000001'),
  ('bbbbbbbb-0000-4000-8000-000000000002'),
  ('cccccccc-0000-4000-8000-000000000003'),
  ('dddddddd-0000-4000-8000-000000000004');
insert into public.categories (id, code, name, sort_order) values (public.zid('CA'), 'zz-rev-a', '리뷰분류', 99);
insert into public.stores (id, category_id, name, is_recommended) values
  (public.zid('S1'), public.zid('CA'), '리뷰가게1', true),
  (public.zid('S2'), public.zid('CA'), '리뷰가게2', false);
insert into public.menus (id, store_id, name, base_price) values
  (public.zid('MA'), public.zid('S1'), '메뉴A', 1000),
  (public.zid('MB'), public.zid('S1'), '메뉴B', 2000),
  (public.zid('MC'), public.zid('S2'), '메뉴C', 1500);

-- ---------------------------------------------------------------- 구조 · 권한 (superuser)
select is((select count(*)::int from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relrowsecurity
    and relname in ('reviews', 'review_menus', 'review_helpful')), 3, '리뷰 테이블 3개 모두 RLS 활성화');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename in ('reviews', 'review_menus', 'review_helpful')), 0, '정책이 하나도 없다 (앱은 직접 접근 불가)');
select ok(not exists (
    select 1 from information_schema.role_table_grants
    where table_schema in ('public', 'private') and table_name in ('reviews', 'review_menus', 'review_helpful', 'review_command_receipts')
      and grantee in ('anon', 'authenticated', 'PUBLIC')), '리뷰 테이블 · 영수증 테이블에 앱 권한이 하나도 없다');
select ok(not exists (
    select 1 from information_schema.column_privileges
    where table_schema in ('public', 'private') and table_name in ('reviews', 'review_menus', 'review_helpful', 'review_command_receipts')
      and grantee in ('anon', 'authenticated', 'PUBLIC')), '열 단위 권한도 없다');
select is((select count(*)::int from information_schema.tables where table_schema in ('public', 'private')
    and (table_name ilike '%image%' or table_name ilike '%upload%' or table_name ilike '%cleanup%')
    and table_name not in ('menu_images')), 0, '사진 관련 테이블이 없다 (후속 PR)');
select is((select count(*)::int from information_schema.columns where table_schema in ('public', 'private')
    and table_name in ('reviews', 'review_menus', 'review_helpful', 'review_command_receipts') and (column_name ilike '%image%' or column_name ilike '%photo%')), 0,
  '리뷰 테이블에 사진 관련 열이 없다');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.proname in ('get_review_eligibility', 'create_review', 'update_review', 'delete_review', 'set_helpful', 'list_public_reviews', 'list_my_reviews')
    and (array_to_string(p.proargnames, ',') ilike '%photo%' or array_to_string(p.proargnames, ',') ilike '%upload%' or array_to_string(p.proargnames, ',') ilike '%image%')), 0,
  '리뷰 함수에 사진 관련 인자가 없다 (p_photo_only 포함)');
select is((select proargnames from pg_proc where oid = 'public.create_review(uuid, uuid, integer, text)'::regprocedure), array['p_order_id', 'p_operation_id', 'p_rating', 'p_body'], 'create_review 인자 이름');
select is((select proargnames from pg_proc where oid = 'public.update_review(uuid, uuid, bigint, integer, text)'::regprocedure),
  array['p_review_id', 'p_operation_id', 'p_expected_revision', 'p_rating', 'p_body'], 'update_review 인자 이름');
select is((select proargnames from pg_proc where oid = 'public.delete_review(uuid, uuid, bigint)'::regprocedure), array['p_review_id', 'p_operation_id', 'p_expected_revision'], 'delete_review 인자 이름');
select is((select proargnames from pg_proc where oid = 'public.set_helpful(uuid, uuid, boolean)'::regprocedure), array['p_review_id', 'p_operation_id', 'p_desired'], 'set_helpful 인자 이름');
select is((select proargnames from pg_proc where oid = 'public.list_public_reviews(text, uuid, text, text, integer)'::regprocedure),
  array['p_scope_type', 'p_scope_id', 'p_sort', 'p_cursor', 'p_page_size'], 'list_public_reviews 인자 이름');
select is((select proargnames from pg_proc where oid = 'public.list_my_reviews(text, integer)'::regprocedure), array['p_cursor', 'p_page_size'], 'list_my_reviews 인자 이름');
select is((select proargnames from pg_proc where oid = 'public.get_review_eligibility(uuid)'::regprocedure), array['p_order_id'], 'get_review_eligibility 인자 이름');
select ok((select bool_and(p.prosecdef and exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%'))
    from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('get_review_eligibility', 'create_review', 'update_review', 'delete_review', 'set_helpful', 'list_public_reviews', 'list_my_reviews')),
  '리뷰 함수 7개는 모두 SECURITY DEFINER + search_path 고정');
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.proname in ('get_review_eligibility', 'create_review', 'update_review', 'delete_review', 'set_helpful', 'list_my_reviews')
    and coalesce(p.proacl::text, '') ~ '(^|[{,])=X|anon='), '목록(공개) 외 리뷰 함수는 PUBLIC/anon에게 열려 있지 않다');
select ok(exists (select 1 from pg_proc p where p.oid = 'public.list_public_reviews(text, uuid, text, text, integer)'::regprocedure
    and p.proacl::text ~ 'anon=X' and p.proacl::text ~ 'authenticated=X' and p.proacl::text !~ '(^|[{,])=X'), '공개 목록은 anon · authenticated만 실행할 수 있다');
select ok(not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname in ('is_review_window_open', 'normalize_review_input', 'review_fingerprint', 'review_json')
      and coalesce(p.proacl::text, '') ~ '(anon|authenticated)=|(^|[{,])=X'), 'private 리뷰 보조 함수는 앱에 열려 있지 않다');
select ok(has_table_privilege('anon', 'public.store_review_summaries', 'select') and has_table_privilege('authenticated', 'public.store_review_summaries', 'select'),
  '가게 요약 뷰는 anon · authenticated가 읽을 수 있다');
select ok(not has_table_privilege('anon', 'public.store_review_summaries', 'insert') and not has_table_privilege('authenticated', 'public.store_review_summaries', 'update'),
  '요약 뷰는 읽기 전용');

-- 제약 (superuser로 직접)
select ok((select char_length(pg_get_constraintdef(oid)) > 0 from pg_constraint where conrelid = 'public.reviews'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%craving_rating%'), '땡김도 CHECK가 있다');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'reviews' and indexname = 'reviews_one_active_per_order' and indexdef ilike '%unique%' and indexdef ilike '%deleted_at is null%'),
  '주문당 활성 리뷰 1개 부분 unique 인덱스');

-- 기한 경계 (private 함수에 기준 시각을 직접 준다)
select is(private.is_review_window_open('2026-01-01 00:00:00+00', '2026-01-31 00:00:00+00'), true, '기한: 마감 시각과 같으면 작성 가능 (정확히 30×24시간)');
select is(private.is_review_window_open('2026-01-01 00:00:00+00', '2026-01-30 23:59:59.999999+00'), true, '기한: 마감 1마이크로초 전은 작성 가능');
select is(private.is_review_window_open('2026-01-01 00:00:00+00', '2026-01-31 00:00:00.000001+00'), false, '기한: 마감 1마이크로초 뒤는 불가');
select is(private.is_review_window_open('2026-01-01 15:00:00+00', '2026-01-31 14:59:59+00'), true, '기한: 날짜 끝으로 올림하지 않는다 (15시 완료 → 30일 뒤 15시까지)');
select is(private.is_review_window_open('2026-01-01 15:00:00+00', '2026-01-31 15:00:01+00'), false, '기한: 30일 뒤 15시를 넘으면 불가');
select is(private.is_review_window_open('2026-01-01 00:00:00+00', '2026-03-01 00:00:00+00'), false, '기한: 한참 지나면 불가');

-- 입력 정규화 (private 함수 직접)
select is(private.normalize_review_input(1, '가나다라마'), '가나다라마', '입력: 한글 5자 허용');
select is(private.normalize_review_input(5, repeat('가', 500)), repeat('가', 500), '입력: 500자 허용');
select is(private.normalize_review_input(3, '  앞뒤 공백  '), '앞뒤 공백', '입력: 앞뒤 일반 공백은 지운다');
select is(private.normalize_review_input(3, E'줄\n바꿈\t탭'), E'줄\n바꿈\t탭', '입력: 안쪽 줄바꿈 · 탭은 본문으로 허용 (길이에 센다)');
select is(private.normalize_review_input(3, '😀😀😀😀😀'), '😀😀😀😀😀', '입력: 이모지는 한 글자(code point)로 센다 (5개면 5자)');
select is(public.zq($$select private.normalize_review_input(3, '😀😀😀😀')$$), 'P0001:INVALID_REVIEW_INPUT', '입력: 이모지 4개는 4자라 부족');
select is(public.zq($$select private.normalize_review_input(0, '가나다라마')$$), 'P0001:INVALID_REVIEW_INPUT', '입력: 땡김도 0');
select is(public.zq($$select private.normalize_review_input(6, '가나다라마')$$), 'P0001:INVALID_REVIEW_INPUT', '입력: 땡김도 6');
select is(public.zq($$select private.normalize_review_input(null, '가나다라마')$$), 'P0001:INVALID_REVIEW_INPUT', '입력: 땡김도 null');
select is(public.zq($$select private.normalize_review_input(3, null)$$), 'P0001:INVALID_REVIEW_INPUT', '입력: 본문 null');
select is(public.zq($$select private.normalize_review_input(3, '가나다라')$$), 'P0001:INVALID_REVIEW_INPUT', '입력: 4자');
select is(public.zq($$select private.normalize_review_input(3, ' 가나다라 ')$$), 'P0001:INVALID_REVIEW_INPUT', '입력: 공백을 지우면 4자');
select is(public.zq($$select private.normalize_review_input(3, '     ')$$), 'P0001:INVALID_REVIEW_INPUT', '입력: 공백만');
select is(public.zq(format('select private.normalize_review_input(3, %L)', repeat('가', 501))), 'P0001:INVALID_REVIEW_INPUT', '입력: 501자');
select is(public.zq(format('select private.normalize_review_input(3, %L)', ' ' || repeat('가', 500) || ' ')), 'OK', '입력: 공백을 지우면 정확히 500자면 허용');
select is(public.zq(format('select private.normalize_review_input(3, %L)', repeat('가', 501) || ' ')), 'P0001:INVALID_REVIEW_INPUT', '입력: 지운 뒤 501자');

-- ---------------------------------------------------------------- Guest / 로그인 정보 없음
set local role anon;
select ok(public.test_err($$select public.create_review(gen_random_uuid(), gen_random_uuid(), 3, '가나다라마')$$, '42501'), '[anon] create_review 실행 금지');
select ok(public.test_err($$select public.update_review(gen_random_uuid(), gen_random_uuid(), 1, 3, '가나다라마')$$, '42501'), '[anon] update_review 실행 금지');
select ok(public.test_err($$select public.delete_review(gen_random_uuid(), gen_random_uuid(), 1)$$, '42501'), '[anon] delete_review 실행 금지');
select ok(public.test_err($$select public.set_helpful(gen_random_uuid(), gen_random_uuid(), true)$$, '42501'), '[anon] set_helpful 실행 금지');
select ok(public.test_err($$select public.get_review_eligibility(gen_random_uuid())$$, '42501'), '[anon] get_review_eligibility 실행 금지');
select ok(public.test_err($$select public.list_my_reviews()$$, '42501'), '[anon] list_my_reviews 실행 금지');
select ok(public.test_err($$select * from public.reviews$$, '42501'), '[anon] reviews 직접 조회 금지');
select is(public.list_public_reviews('store', public.zid('S1')), '{"items":[],"summary":{"average":null,"count":0},"hasMore":false,"nextCursor":null}'::jsonb,
  '[anon] 공개 목록은 Guest도 볼 수 있다: 리뷰가 없으면 빈 목록 + 요약 {average:null, count:0}');
select ok(public.test_err($$select public.list_public_reviews('store', gen_random_uuid())$$, 'P0001', 'RESOURCE_NOT_FOUND'), '[anon] 없는 가게 → RESOURCE_NOT_FOUND');
select ok(public.test_err($$select public.list_public_reviews('menu', gen_random_uuid())$$, 'P0001', 'RESOURCE_NOT_FOUND'), '[anon] 없는 메뉴 → RESOURCE_NOT_FOUND');
reset role;
select set_config('request.jwt.claims', '', true);
set local role authenticated;
select is(public.zecr(gen_random_uuid(), 'x', 3, '가나다라마'), 'P0001:AUTH_REQUIRED', '[sub 없음] create_review → AUTH_REQUIRED');
select is(public.zeur(gen_random_uuid(), 'x', 1, 3, '가나다라마'), 'P0001:AUTH_REQUIRED', '[sub 없음] update_review → AUTH_REQUIRED');
select is(public.zedr(gen_random_uuid(), 'x', 1), 'P0001:AUTH_REQUIRED', '[sub 없음] delete_review → AUTH_REQUIRED');
select is(public.zesh(gen_random_uuid(), 'x', true), 'P0001:AUTH_REQUIRED', '[sub 없음] set_helpful → AUTH_REQUIRED');
select ok(public.test_err($$select public.get_review_eligibility(gen_random_uuid())$$, 'P0001', 'AUTH_REQUIRED'), '[sub 없음] get_review_eligibility → AUTH_REQUIRED');
select ok(public.test_err($$select public.list_my_reviews()$$, 'P0001', 'AUTH_REQUIRED'), '[sub 없음] list_my_reviews → AUTH_REQUIRED');
select is(public.zecr(null, 'x', 0, null), 'P0001:AUTH_REQUIRED', '[sub 없음] 잘못된 입력도 로그인 확인이 먼저');
select is(jsonb_typeof(public.list_public_reviews('store', public.zid('S1')) -> 'items'), 'array', '[sub 없음] 공개 목록은 로그인 정보 없이도 된다');
reset role;

-- ---------------------------------------------------------------- 주문 준비
-- 사용자 A: oA1(S1 메뉴A) · oA2(S1 메뉴A+메뉴B, 한 주문에 두 메뉴) · oA3(PENDING) · oA4(취소) · oA5(S2) · oA6(기한 지남) · oA7(기한 안)
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select set_config('zz.oa1', public.zdone('A1', public.zid('S1'), public.zid('MA'), 1000)::text, true);
select set_config('zz.oa2', public.zdone2('A2', public.zid('S1'), public.zid('MA'), 1000, public.zid('MB'), 2000)::text, true);
select set_config('zz.oa3', (public.create_order(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('MA'), 1, 1000)), public.zid('A3'))) ->> 'orderId'), true);
select set_config('zz.oa4', (public.create_order(public.zreq(public.zid('S1'), jsonb_build_array(public.zitem(public.zid('MA'), 1, 1000)), public.zid('A4'))) ->> 'orderId'), true);
select is((public.cancel_order(public.zo('oa4'), public.zid('A4-cancel')) ->> 'status'), 'CANCELLED', '(준비) oA4 취소');
select set_config('zz.oa5', public.zdone('A5', public.zid('S2'), public.zid('MC'), 1500)::text, true);
select set_config('zz.oa6', public.zdone('A6', public.zid('S1'), public.zid('MA'), 1000)::text, true);
select set_config('zz.oa7', public.zdone('A7', public.zid('S1'), public.zid('MA'), 1000)::text, true);
reset role;
-- 사용자 B: oB1, oB2 (S1), oB3 (S2) / 사용자 C: oC1 (S1), oC2 (S2)
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select set_config('zz.ob1', public.zdone('B1', public.zid('S1'), public.zid('MA'), 1000)::text, true);
select set_config('zz.ob2', public.zdone('B2', public.zid('S1'), public.zid('MB'), 2000)::text, true);
select set_config('zz.ob3', public.zdone('B3', public.zid('S2'), public.zid('MC'), 1500)::text, true);
reset role;
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-4000-8000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select set_config('zz.oc1', public.zdone('C1', public.zid('S1'), public.zid('MA'), 1000)::text, true);
select set_config('zz.oc2', public.zdone('C2', public.zid('S2'), public.zid('MC'), 1500)::text, true);
reset role;

-- 기한 경계용: oA6은 완료한 지 720시간 + 5초 (기한 지남), oA7은 720시간 - 120초 (기한 안). 가드 트리거를 잠시 끈다.
alter table public.orders disable trigger orders_guard;
update public.orders set completed_at = clock_timestamp() - interval '720 hours' - interval '5 seconds' where id = public.zo('oa6');
update public.orders set completed_at = clock_timestamp() - interval '720 hours' + interval '120 seconds' where id = public.zo('oa7');
alter table public.orders enable trigger orders_guard;

-- ---------------------------------------------------------------- 작성 자격
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is((select array_agg(k order by k) from jsonb_object_keys(public.get_review_eligibility(public.zo('oa1'))) k),
  array['activeReviewId', 'completedAt', 'eligibility', 'reviewDeadline', 'serverNow'], '자격 응답 키');
select is(public.get_review_eligibility(public.zo('oa1')) ->> 'eligibility', 'CAN_WRITE', '완료된 주문 + 기한 안 + 활성 리뷰 없음 → CAN_WRITE');
select ok((public.get_review_eligibility(public.zo('oa1')) ->> 'reviewDeadline')::timestamptz = (select completed_at + interval '720 hours' from public.orders where id = public.zo('oa1')),
  '마감 = completedAt + 정확히 720시간');
select is(jsonb_typeof(public.get_review_eligibility(public.zo('oa1')) -> 'serverNow'), 'string', 'serverNow는 시각 문자열');
select is(public.get_review_eligibility(public.zo('oa1')) -> 'activeReviewId', 'null'::jsonb, '활성 리뷰가 없으면 activeReviewId null');
select is(public.get_review_eligibility(public.zo('oa3')) - 'serverNow', '{"eligibility":"NOT_COMPLETED","completedAt":null,"reviewDeadline":null,"activeReviewId":null}'::jsonb,
  'PENDING 주문: NOT_COMPLETED, completedAt · reviewDeadline · activeReviewId 모두 null');
select is(public.get_review_eligibility(public.zo('oa4')) ->> 'eligibility', 'NOT_COMPLETED', '취소된 주문: NOT_COMPLETED');
select is(public.get_review_eligibility(public.zo('oa6')) ->> 'eligibility', 'DEADLINE_EXCEEDED', '마감 지남 + 리뷰 없음 → DEADLINE_EXCEEDED');
select is(public.get_review_eligibility(public.zo('oa7')) ->> 'eligibility', 'CAN_WRITE', '마감 직전(120초 남음) → CAN_WRITE');
select is(public.zq(format('select public.get_review_eligibility(%L)', public.zo('ob1'))), 'P0001:RESOURCE_NOT_FOUND', '남의 주문 → RESOURCE_NOT_FOUND');
select is(public.zq($$select public.get_review_eligibility(gen_random_uuid())$$), 'P0001:RESOURCE_NOT_FOUND', '없는 주문 → RESOURCE_NOT_FOUND (남의 주문과 구별되지 않는다)');
select is(public.zq($$select public.get_review_eligibility(null)$$), 'P0001:INVALID_INPUT', '주문 ID null → INVALID_INPUT');

-- ---------------------------------------------------------------- 리뷰 작성: 오류
select is(public.zecr(null, 'c1', 3, '가나다라마'), 'P0001:INVALID_INPUT', '주문 ID null → INVALID_INPUT');
select is(public.zecr(public.zo('oa1'), null, 3, '가나다라마'), 'P0001:INVALID_INPUT', 'operationId null → INVALID_INPUT');
select is(public.zecr(gen_random_uuid(), 'c1', 3, '가나다라마'), 'P0001:RESOURCE_NOT_FOUND', '없는 주문');
select is(public.zecr(public.zo('ob1'), 'c1', 3, '가나다라마'), 'P0001:RESOURCE_NOT_FOUND', '남의 주문');
select is(public.zecr(public.zo('oa1'), 'c1', 0, '가나다라마'), 'P0001:INVALID_REVIEW_INPUT', '땡김도 0');
select is(public.zecr(public.zo('oa1'), 'c1', 6, '가나다라마'), 'P0001:INVALID_REVIEW_INPUT', '땡김도 6');
select is(public.zecr(public.zo('oa1'), 'c1', null, '가나다라마'), 'P0001:INVALID_REVIEW_INPUT', '땡김도 null');
select is(public.zecr(public.zo('oa1'), 'c1', 3, '가나다라'), 'P0001:INVALID_REVIEW_INPUT', '본문 4자');
select is(public.zecr(public.zo('oa1'), 'c1', 3, ' 가나다라 '), 'P0001:INVALID_REVIEW_INPUT', '본문 앞뒤 공백을 지우면 4자');
select is(public.zecr(public.zo('oa1'), 'c1', 3, null), 'P0001:INVALID_REVIEW_INPUT', '본문 null');
select is(public.zecr(public.zo('oa1'), 'c1', 3, repeat('가', 501)), 'P0001:INVALID_REVIEW_INPUT', '본문 501자');
select is(public.zecr(public.zo('oa3'), 'c1', 3, '가나다라마'), 'P0001:ORDER_NOT_COMPLETED', 'PENDING 주문은 작성 불가');
select is(public.zecr(public.zo('oa4'), 'c1', 3, '가나다라마'), 'P0001:ORDER_NOT_COMPLETED', '취소된 주문은 작성 불가');
select is(public.zecr(public.zo('oa3'), 'c1', 0, '가나다라마'), 'P0001:INVALID_REVIEW_INPUT', 'PENDING 주문 + 잘못된 입력 → 입력 검증이 먼저');
select is(public.zecr(public.zo('oa6'), 'c1', 3, '가나다라마'), 'P0001:REVIEW_DEADLINE_EXCEEDED', '기한이 지난 주문');
select is(public.zecr(public.zo('oa6'), 'c1', 0, '가나다라마'), 'P0001:INVALID_REVIEW_INPUT', '기한이 지나도 입력 검증이 먼저');
reset role;
select is((select count(*)::int from public.reviews), 0, '실패한 요청은 리뷰를 만들지 않았다');
select is((select count(*)::int from private.review_command_receipts), 0, '실패한 요청은 영수증도 남기지 않았다');

-- ---------------------------------------------------------------- 리뷰 작성: 성공
set local role authenticated;
select set_config('zz.r1', public.create_review(public.zo('oa1'), public.zid('c-a1'), 5, '  맛있어요 정말 좋아요  ')::text, true);
select is((select array_agg(k order by k) from jsonb_object_keys(current_setting('zz.r1')::jsonb) k),
  array['authorNickname', 'body', 'createdAt', 'editedAt', 'helpfulCount', 'isMine', 'menuIds', 'menuNamesSnapshot', 'myHelpful', 'orderAmount', 'orderId',
        'rating', 'replayed', 'reviewId', 'revision', 'storeId', 'storeNameSnapshot'],
  '생성 응답 키: 본인 응답이라 orderId 포함, images · deletedAt 키 없음');
select is(current_setting('zz.r1')::jsonb ->> 'body', '맛있어요 정말 좋아요', '본문은 앞뒤 공백을 지운 값으로 저장 · 응답');
select is((current_setting('zz.r1')::jsonb ->> 'rating')::int, 5, '땡김도 5');
select is((current_setting('zz.r1')::jsonb ->> 'revision')::int, 1, 'revision 1');
select is(current_setting('zz.r1')::jsonb -> 'editedAt', 'null'::jsonb, '처음에는 editedAt null');
select is(current_setting('zz.r1')::jsonb -> 'replayed', 'false'::jsonb, '처음 만들면 replayed false');
select is(current_setting('zz.r1')::jsonb -> 'isMine', 'true'::jsonb, 'isMine true');
select is(current_setting('zz.r1')::jsonb -> 'myHelpful', 'false'::jsonb, 'myHelpful false');
select is((current_setting('zz.r1')::jsonb ->> 'helpfulCount')::int, 0, 'helpfulCount 0');
select is(current_setting('zz.r1')::jsonb ->> 'orderId', public.zo('oa1')::text, '본인 응답의 orderId');
select is((current_setting('zz.r1')::jsonb ->> 'orderAmount')::int, 1000, 'orderAmount = 주문 금액');
select is(current_setting('zz.r1')::jsonb ->> 'storeNameSnapshot', '리뷰가게1', 'storeNameSnapshot');
select is(current_setting('zz.r1')::jsonb -> 'menuNamesSnapshot', '["메뉴A"]'::jsonb, 'menuNamesSnapshot');
select is(current_setting('zz.r1')::jsonb -> 'menuIds', jsonb_build_array(public.zid('MA')), 'menuIds');
select is(current_setting('zz.r1')::jsonb -> 'authorNickname', 'null'::jsonb, '닉네임이 없으면 authorNickname null');
select is(current_setting('zz.r1')::jsonb ->> 'storeId', public.zid('S1')::text, 'storeId');
select ok(not (current_setting('zz.r1')::jsonb ? 'images') and not (current_setting('zz.r1')::jsonb ? 'deletedAt'), 'images · deletedAt 키가 없다');
select set_config('zz.rid1', current_setting('zz.r1')::jsonb ->> 'reviewId', true);
reset role;
select is((select count(*)::int from public.reviews where order_id = public.zo('oa1') and deleted_at is null), 1, 'DB: 활성 리뷰 1개');
select is((select body from public.reviews where id = public.zo('rid1')), '맛있어요 정말 좋아요', 'DB: 본문은 지운 값');
select is((select user_id from public.reviews where id = public.zo('rid1')), 'aaaaaaaa-0000-4000-8000-000000000001'::uuid, 'DB: 작성자는 로그인 사용자');
select is((select store_id from public.reviews where id = public.zo('rid1')), public.zid('S1'), 'DB: 가게는 주문에서 가져온다');
select is((select count(*)::int from public.review_menus where review_id = public.zo('rid1')), 1, 'DB: 메뉴 연결 1개');
select is((select count(*)::int from private.review_command_receipts where command_kind = 'create'), 1, 'DB: 영수증 1개');

-- 주문에 서로 다른 메뉴가 둘이면 두 메뉴 모두에 연결된다
set local role authenticated;
select set_config('zz.rid2', (public.create_review(public.zo('oa2'), public.zid('c-a2'), 3, '두 메뉴를 시켰어요')::jsonb ->> 'reviewId'), true);
select is(public.get_review_eligibility(public.zo('oa2')) ->> 'eligibility', 'HAS_ACTIVE_REVIEW', '리뷰를 쓰면 HAS_ACTIVE_REVIEW');
select is(public.get_review_eligibility(public.zo('oa2')) ->> 'activeReviewId', public.zo('rid2')::text, 'activeReviewId = 그 리뷰');
reset role;
select is((select array_agg(menu_id order by menu_id) from public.review_menus where review_id = public.zo('rid2')), (select array_agg(x order by x) from unnest(array[public.zid('MA'), public.zid('MB')]) x),
  'DB: 주문의 서로 다른 메뉴 둘 모두 연결');
set local role authenticated;
select is((select public.list_my_reviews() -> 'items' -> 0 -> 'menuNamesSnapshot'), '["메뉴A","메뉴B"]'::jsonb, '두 메뉴 이름이 주문 줄 순서대로');

-- 활성 리뷰가 있으면 새로 못 쓴다
select is(public.zecr(public.zo('oa1'), 'c-a1-again', 4, '또 쓰려고 해요 정말'), 'P0001:ACTIVE_REVIEW_EXISTS', '활성 리뷰가 있으면 ACTIVE_REVIEW_EXISTS');

-- 영수증: 같은 operationId 재생
select set_config('zz.r1b', public.create_review(public.zo('oa1'), public.zid('c-a1'), 5, '맛있어요 정말 좋아요')::text, true);
select is(current_setting('zz.r1b')::jsonb -> 'replayed', 'true'::jsonb, '같은 operationId + 같은 입력(앞뒤 공백만 다름) → replayed true');
select is(current_setting('zz.r1b')::jsonb - 'replayed', current_setting('zz.r1')::jsonb - 'replayed', '재생은 적용 당시 결과 그대로');
select is(public.zecr(public.zo('oa1'), 'c-a1', 4, '맛있어요 정말 좋아요'), 'P0001:REVIEW_OPERATION_CONFLICT', '같은 operationId + 다른 땡김도 → REVIEW_OPERATION_CONFLICT');
select is(public.zecr(public.zo('oa1'), 'c-a1', 5, '다른 본문을 보냅니다'), 'P0001:REVIEW_OPERATION_CONFLICT', '같은 operationId + 다른 본문 → REVIEW_OPERATION_CONFLICT');
select is(public.zecr(public.zo('oa2'), 'c-a1', 5, '맛있어요 정말 좋아요'), 'P0001:REVIEW_OPERATION_CONFLICT', '같은 operationId + 다른 주문 → REVIEW_OPERATION_CONFLICT');
reset role;
select is((select count(*)::int from public.reviews where deleted_at is null and user_id = 'aaaaaaaa-0000-4000-8000-000000000001'), 2, '재생 · 충돌은 리뷰를 늘리지 않았다 (A의 활성 리뷰 2개)');

-- 기한 직전 주문은 쓸 수 있다
set local role authenticated;
select set_config('zz.rid7', (public.create_review(public.zo('oa7'), public.zid('c-a7'), 1, '마감 직전에 썼어요')::jsonb ->> 'reviewId'), true);
select ok(true, '마감 120초 전 주문(oA7)에 리뷰 작성 성공');
reset role;

-- 다른 사용자들의 리뷰: B(S1 메뉴A, S1 메뉴B, S2), C(S1 메뉴A, S2)
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select set_config('zz.rb1', (public.create_review(public.zo('ob1'), public.zid('c-b1'), 4, 'B가 쓴 첫 번째 리뷰예요')::jsonb ->> 'reviewId'), true);
select set_config('zz.rb2', (public.create_review(public.zo('ob2'), public.zid('c-b2'), 4, 'B가 쓴 두 번째 리뷰예요')::jsonb ->> 'reviewId'), true);
select set_config('zz.rb3', (public.create_review(public.zo('ob3'), public.zid('c-b3'), 5, '리뷰가게2 맛있어요 B')::jsonb ->> 'reviewId'), true);
reset role;
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-4000-8000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select set_config('zz.rc1', (public.create_review(public.zo('oc1'), public.zid('c-c1'), 2, 'C가 쓴 리뷰예요 별로예요')::jsonb ->> 'reviewId'), true);
select set_config('zz.rc2', (public.create_review(public.zo('oc2'), public.zid('c-c2'), 4, '리뷰가게2 괜찮아요 C')::jsonb ->> 'reviewId'), true);
reset role;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select set_config('zz.rid5', (public.create_review(public.zo('oa5'), public.zid('c-a5'), 5, '리뷰가게2 최고예요 A')::jsonb ->> 'reviewId'), true);
reset role;

-- 정렬 · 동률 테스트를 위해 작성 시각을 정한다 (reviews에는 가드가 없다). S1: rid1, rid2, rb1, rb2(동률), rc1, rid7
update public.reviews set created_at = '2026-03-01 10:00:00.000001+00' where id = public.zo('rid1');
update public.reviews set created_at = '2026-03-02 10:00:00+00' where id = public.zo('rid2');
update public.reviews set created_at = '2026-03-03 10:00:00.500000+00' where id in (public.zo('rb1'), public.zo('rb2'));
update public.reviews set created_at = '2026-03-05 10:00:00+00' where id = public.zo('rc1');
update public.reviews set created_at = '2026-03-04 10:00:00+00' where id = public.zo('rid7');
-- 도움돼요 몇 개 (superuser로 직접): rb1 = 2(A, C), rid1 = 1(B), rb2 = 1(A) → 도움순 동률 만들기
insert into public.review_helpful (review_id, user_id) values
  (public.zo('rb1'), 'aaaaaaaa-0000-4000-8000-000000000001'), (public.zo('rb1'), 'cccccccc-0000-4000-8000-000000000003'),
  (public.zo('rid1'), 'bbbbbbbb-0000-4000-8000-000000000002'), (public.zo('rb2'), 'aaaaaaaa-0000-4000-8000-000000000001');
update public.profiles set nickname = '맛집탐험가' where id = 'aaaaaaaa-0000-4000-8000-000000000001';
select is((select count(*)::int from public.reviews where store_id = public.zid('S1') and deleted_at is null), 6, '(준비) S1의 활성 리뷰 6개');

-- ---------------------------------------------------------------- 공개 목록
select set_config('zz.avg_s1', (select round(avg(craving_rating)::numeric, 1)::text from public.reviews where store_id = public.zid('S1') and deleted_at is null), true);
select set_config('zz.cnt_mb', (select count(distinct rm.review_id)::text from public.review_menus rm join public.reviews r on r.id = rm.review_id where rm.menu_id = public.zid('MB') and r.deleted_at is null), true);
select set_config('request.jwt.claims', '', true);
set local role anon;
select set_config('zz.pub', public.list_public_reviews('store', public.zid('S1'))::text, true);
select is((select array_agg(k order by k) from jsonb_object_keys(current_setting('zz.pub')::jsonb) k), array['hasMore', 'items', 'nextCursor', 'summary'], '[Guest] 공개 목록 최상위 키: items / summary / hasMore / nextCursor');
select is((select array_agg(k order by k) from jsonb_object_keys(current_setting('zz.pub')::jsonb -> 'summary') k), array['average', 'count'], '[Guest] summary 키는 average / count');
select is(jsonb_array_length(current_setting('zz.pub')::jsonb -> 'items'), 6, '[Guest] 6개');
select is((select string_agg(public.zpub_shape(e), ',') from jsonb_array_elements(current_setting('zz.pub')::jsonb -> 'items') e where public.zpub_shape(e) <> 'OK'), null,
  '[Guest] 모든 항목이 공개 모양: orderId · user ID · 이메일 · images · deletedAt 없음');
select is((select count(*)::int from jsonb_array_elements(current_setting('zz.pub')::jsonb -> 'items') e where e ? 'orderId' or e ? 'userId' or e ? 'images' or e ? 'deletedAt' or e ? 'email'), 0, '[Guest] 내부 키가 응답 어디에도 없다');
select is((select count(*)::int from jsonb_array_elements(current_setting('zz.pub')::jsonb -> 'items') e where (e ->> 'isMine')::boolean or (e ->> 'myHelpful')::boolean), 0, '[Guest] isMine · myHelpful은 항상 false');
select is(current_setting('zz.pub')::jsonb -> 'summary' ->> 'count', '6', '[Guest] summary.count 6');
select is((current_setting('zz.pub')::jsonb -> 'summary' ->> 'average')::numeric, current_setting('zz.avg_s1')::numeric,
  '[Guest] summary.average = 활성 리뷰 평균(소수 첫째 자리)');
select is((select e ->> 'authorNickname' from jsonb_array_elements(current_setting('zz.pub')::jsonb -> 'items') e where e ->> 'reviewId' = public.zo('rid1')::text), '맛집탐험가', '[Guest] 닉네임이 있으면 authorNickname');
select is((select e -> 'authorNickname' from jsonb_array_elements(current_setting('zz.pub')::jsonb -> 'items') e where e ->> 'reviewId' = public.zo('rb1')::text), 'null'::jsonb, '[Guest] 닉네임이 없으면 authorNickname null');
select is((select e ->> 'helpfulCount' from jsonb_array_elements(current_setting('zz.pub')::jsonb -> 'items') e where e ->> 'reviewId' = public.zo('rb1')::text), '2', '[Guest] helpfulCount');
reset role;

-- 메뉴 범위: 두 메뉴 주문의 리뷰는 두 메뉴에 모두 나온다. 가게 범위에서는 한 번만 센다.
set local role anon;
select is((select count(*)::int from jsonb_array_elements(public.list_public_reviews('menu', public.zid('MB')) -> 'items') e where e ->> 'reviewId' = public.zo('rid2')::text), 1, '메뉴B 범위에 두 메뉴 주문의 리뷰가 나온다');
select is((select count(*)::int from jsonb_array_elements(public.list_public_reviews('menu', public.zid('MA')) -> 'items') e where e ->> 'reviewId' = public.zo('rid2')::text), 1, '메뉴A 범위에도 나온다');
select is(public.list_public_reviews('menu', public.zid('MB')) -> 'summary' ->> 'count', current_setting('zz.cnt_mb'), '메뉴 범위 summary.count');
select is((select count(*)::int from jsonb_array_elements(public.list_public_reviews('store', public.zid('S1'), 'LATEST', null, 50) -> 'items') e where e ->> 'reviewId' = public.zo('rid2')::text), 1, '가게 범위에는 같은 리뷰가 한 번만');
reset role;

-- 정렬 · 페이지: 어떤 정렬 · 크기로 끝까지 가도 기대한 순서, 중복 · 누락 없음
select set_config('zz.exp_latest', (select string_agg(id::text, ',' order by created_at desc, id desc) from public.reviews where store_id = public.zid('S1') and deleted_at is null), true);
select set_config('zz.exp_helpful', (select string_agg(id::text, ',' order by (select count(*) from public.review_helpful h where h.review_id = r.id) desc, created_at desc, id desc)
  from public.reviews r where store_id = public.zid('S1') and deleted_at is null), true);
select set_config('zz.exp_rdesc', (select string_agg(id::text, ',' order by craving_rating desc, created_at desc, id desc) from public.reviews where store_id = public.zid('S1') and deleted_at is null), true);
select set_config('zz.exp_rasc', (select string_agg(id::text, ',' order by craving_rating asc, created_at desc, id desc) from public.reviews where store_id = public.zid('S1') and deleted_at is null), true);
set local role anon;
select is(public.zwalk_pub('store', public.zid('S1'), 'LATEST', 50), current_setting('zz.exp_latest'), '최신순 (한 페이지)');
select is(public.zwalk_pub('store', public.zid('S1'), 'LATEST', 1), current_setting('zz.exp_latest'), '최신순 크기 1로 끝까지 (동률 · 마이크로초 포함)');
select is(public.zwalk_pub('store', public.zid('S1'), 'LATEST', 2), current_setting('zz.exp_latest'), '최신순 크기 2');
select is(public.zwalk_pub('store', public.zid('S1'), 'LATEST', 4), current_setting('zz.exp_latest'), '최신순 크기 4');
select is(public.zwalk_pub('store', public.zid('S1'), 'HELPFUL', 50), current_setting('zz.exp_helpful'), '도움순');
select is(public.zwalk_pub('store', public.zid('S1'), 'HELPFUL', 1), current_setting('zz.exp_helpful'), '도움순 크기 1');
select is(public.zwalk_pub('store', public.zid('S1'), 'HELPFUL', 2), current_setting('zz.exp_helpful'), '도움순 크기 2');
select is(public.zwalk_pub('store', public.zid('S1'), 'HELPFUL', 3), current_setting('zz.exp_helpful'), '도움순 크기 3');
select is(public.zwalk_pub('store', public.zid('S1'), 'RATING_DESC', 50), current_setting('zz.exp_rdesc'), '땡김도 높은 순');
select is(public.zwalk_pub('store', public.zid('S1'), 'RATING_DESC', 1), current_setting('zz.exp_rdesc'), '땡김도 높은 순 크기 1');
select is(public.zwalk_pub('store', public.zid('S1'), 'RATING_DESC', 2), current_setting('zz.exp_rdesc'), '땡김도 높은 순 크기 2');
select is(public.zwalk_pub('store', public.zid('S1'), 'RATING_ASC', 50), current_setting('zz.exp_rasc'), '땡김도 낮은 순');
select is(public.zwalk_pub('store', public.zid('S1'), 'RATING_ASC', 1), current_setting('zz.exp_rasc'), '땡김도 낮은 순 크기 1');
select is(public.zwalk_pub('store', public.zid('S1'), 'RATING_ASC', 3), current_setting('zz.exp_rasc'), '땡김도 낮은 순 크기 3');
select is(split_part(public.zwalk_pub('store', public.zid('S1'), 'HELPFUL', 50), ',', 1), public.zo('rb1')::text, '도움순 맨 위는 도움돼요 2개인 리뷰');
select is(public.list_public_reviews('store', public.zid('S1'), null) = public.list_public_reviews('store', public.zid('S1'), 'LATEST'), true, '정렬 null은 LATEST와 같다');
select is(public.list_public_reviews('store', public.zid('S1'), 'LATEST', null, 6) -> 'hasMore', 'false'::jsonb, '딱 맞는 크기(6)에서는 hasMore false');
select is(public.list_public_reviews('store', public.zid('S1'), 'LATEST', null, 5) -> 'hasMore', 'true'::jsonb, '크기 5에서는 hasMore true');
select is(jsonb_array_length(public.list_public_reviews('store', public.zid('S1'), 'LATEST', null, null) -> 'items'), 6, '페이지 크기 null은 기본값(20)');
-- 입력 오류
select is(public.zq($$select public.list_public_reviews('store', null)$$), 'P0001:INVALID_INPUT', '범위 ID null');
select is(public.zq($$select public.list_public_reviews(null, gen_random_uuid())$$), 'P0001:INVALID_INPUT', '범위 종류 null');
select is(public.zq(format('select public.list_public_reviews(%L, %L)', 'order', public.zid('S1'))), 'P0001:INVALID_INPUT', '알 수 없는 범위 종류');
select is(public.zq(format('select public.list_public_reviews(%L, %L, %L)', 'store', public.zid('S1'), 'FOO')), 'P0001:INVALID_INPUT', '알 수 없는 정렬');
select is(public.zq(format('select public.list_public_reviews(%L, %L, %L, null, 0)', 'store', public.zid('S1'), 'LATEST')), 'P0001:INVALID_INPUT', '페이지 크기 0');
select is(public.zq(format('select public.list_public_reviews(%L, %L, %L, null, 51)', 'store', public.zid('S1'), 'LATEST')), 'P0001:INVALID_INPUT', '페이지 크기 51');
select is(public.zq(format('select public.list_public_reviews(%L, %L, %L, null, 50)', 'store', public.zid('S1'), 'LATEST')), 'OK', '페이지 크기 50');
select is(public.zq(format('select public.list_public_reviews(%L, %L, %L, %L)', 'store', public.zid('S1'), 'LATEST', 'abc')), 'P0001:INVALID_INPUT', '잘못된 커서');
select is(public.zq(format('select public.list_public_reviews(%L, %L, %L, %L)', 'store', public.zid('S1'), 'LATEST', encode(convert_to('{}', 'UTF8'), 'base64'))), 'P0001:INVALID_INPUT', '잘못된 커서: 빈 객체');
select set_config('zz.pc', public.list_public_reviews('store', public.zid('S1'), 'HELPFUL', null, 2) ->> 'nextCursor', true);
select is(public.zq(format('select public.list_public_reviews(%L, %L, %L, %L)', 'store', public.zid('S1'), 'LATEST', current_setting('zz.pc'))), 'P0001:INVALID_INPUT', '다른 정렬의 커서는 거절');
select is(public.zq(format('select public.list_public_reviews(%L, %L, %L, %L)', 'store', public.zid('S2'), 'HELPFUL', current_setting('zz.pc'))), 'P0001:INVALID_INPUT', '다른 범위의 커서는 거절');
reset role;

-- 로그인 사용자의 isMine / myHelpful
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from jsonb_array_elements(public.list_public_reviews('store', public.zid('S1'), 'LATEST', null, 50) -> 'items') e where (e ->> 'isMine')::boolean), 3, '[A] isMine은 A의 리뷰 3개(rid1, rid2, rid7)');
select is((select count(*)::int from jsonb_array_elements(public.list_public_reviews('store', public.zid('S1'), 'LATEST', null, 50) -> 'items') e where (e ->> 'myHelpful')::boolean), 2, '[A] myHelpful은 A가 누른 2개(rb1, rb2)');
select is((select e ->> 'myHelpful' from jsonb_array_elements(public.list_public_reviews('store', public.zid('S1'), 'LATEST', null, 50) -> 'items') e where e ->> 'reviewId' = public.zo('rb1')::text), 'true', '[A] rb1에 도움돼요를 눌렀다');
select is((select count(*)::int from jsonb_array_elements(public.list_public_reviews('store', public.zid('S1'), 'LATEST', null, 50) -> 'items') e where e ? 'orderId'), 0, '[A] 로그인해도 공개 응답에는 orderId가 없다');
reset role;

-- ---------------------------------------------------------------- 내 리뷰 목록
select set_config('zz.exp_my', (select string_agg(id::text, ',' order by created_at desc, id desc) from public.reviews where user_id = 'aaaaaaaa-0000-4000-8000-000000000001' and deleted_at is null), true);
set local role authenticated;
select set_config('zz.my', public.list_my_reviews()::text, true);
select is((select array_agg(k order by k) from jsonb_object_keys(current_setting('zz.my')::jsonb) k), array['hasMore', 'items', 'nextCursor'], '내 목록 최상위 키: items / hasMore / nextCursor (summary 없음)');
select is(jsonb_array_length(current_setting('zz.my')::jsonb -> 'items'), 4, '내 활성 리뷰 4개 (rid1, rid2, rid5, rid7)');
select is((select string_agg(e ->> 'reviewId', ',' order by ord) from jsonb_array_elements(current_setting('zz.my')::jsonb -> 'items') with ordinality as t (e, ord)),
  current_setting('zz.exp_my'), '내 목록 정렬: 작성 최신순 → id 내림차순');
select is((select count(*)::int from jsonb_array_elements(current_setting('zz.my')::jsonb -> 'items') e where e ? 'orderId' and (e ->> 'isMine')::boolean and not (e ? 'images')), 4, '내 목록의 모든 항목에 orderId가 있고 isMine true, images 없음');
select is((select count(*)::int from jsonb_array_elements(current_setting('zz.my')::jsonb -> 'items') e where e ->> 'reviewId' in (public.zo('rb1')::text, public.zo('rc1')::text)), 0, '남의 리뷰는 내 목록에 없다');
select is((select e ->> 'orderId' from jsonb_array_elements(current_setting('zz.my')::jsonb -> 'items') e where e ->> 'reviewId' = public.zo('rid1')::text), public.zo('oa1')::text, '내 목록의 orderId는 그 리뷰의 주문');
select is(public.zwalk_my(1), current_setting('zz.exp_my'), '내 목록 크기 1로 끝까지');
select is(public.zwalk_my(3), current_setting('zz.exp_my'), '내 목록 크기 3으로 끝까지');
select is(public.zq($$select public.list_my_reviews(null, 0)$$), 'P0001:INVALID_INPUT', '내 목록 페이지 크기 0');
select is(public.zq($$select public.list_my_reviews(null, 51)$$), 'P0001:INVALID_INPUT', '내 목록 페이지 크기 51');
select is(public.zq($$select public.list_my_reviews('abc')$$), 'P0001:INVALID_INPUT', '내 목록 잘못된 커서');
select is(jsonb_array_length(public.list_my_reviews(null, null) -> 'items'), 4, '내 목록 페이지 크기 null은 기본값');
reset role;
select set_config('request.jwt.claims', '{"sub":"dddddddd-0000-4000-8000-000000000004","role":"authenticated"}', true);
set local role authenticated;
select is(public.list_my_reviews(), '{"items":[],"hasMore":false,"nextCursor":null}'::jsonb, '[D] 리뷰가 없으면 빈 목록');
reset role;

-- ---------------------------------------------------------------- 가게 카드 · 상세의 reviewSummary (실제 집계)
select set_config('zz.sum_s1', (select jsonb_build_object('count', count(*), 'averageCravingRating', round(avg(craving_rating)::numeric, 1))::text from public.reviews where store_id = public.zid('S1') and deleted_at is null), true);
-- Guest 상태: 앞에서 설정한 로그인 정보가 남아 있으면 anon도 사용자로 보이므로 비운다
select set_config('request.jwt.claims', '', true);
set local role anon;
select is(public.get_store(public.zid('S1')) -> 'reviewSummary', current_setting('zz.sum_s1')::jsonb, 'get_store: 활성 리뷰 집계 (평균은 소수 첫째 자리)');
select is(public.get_store(public.zid('S2')) -> 'reviewSummary', '{"count":3,"averageCravingRating":4.7}'::jsonb, 'get_store(S2): 5, 4, 5 → 3개 평균 4.7 (4.666을 소수 첫째 자리로 반올림)');
select is((select e -> 'reviewSummary' from jsonb_array_elements(public.list_stores(public.zid('CA'), null, 50) -> 'items') e where e ->> 'id' = public.zid('S2')::text),
  '{"count":3,"averageCravingRating":4.7}'::jsonb, 'list_stores 카드도 같은 집계');
select is((select e -> 'reviewSummary' from jsonb_array_elements(public.search_stores('리뷰가게2', null, 50) -> 'items') e where e ->> 'id' = public.zid('S2')::text),
  '{"count":3,"averageCravingRating":4.7}'::jsonb, 'search_stores 카드도 같은 집계');
select is((select e -> 'reviewSummary' from jsonb_array_elements(public.list_stores_by_ids(array[public.zid('S2')])) e),
  '{"count":3,"averageCravingRating":4.7}'::jsonb, 'list_stores_by_ids 카드도 같은 집계');
select is((select e -> 'reviewSummary' from jsonb_array_elements(public.list_recommended_stores(20)) e where e ->> 'id' = public.zid('S1')::text),
  public.get_store(public.zid('S1')) -> 'reviewSummary', 'list_recommended_stores 카드도 같은 집계 (S1은 추천 가게)');
reset role;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is((public.set_favorite(public.zid('S2'), true) ->> 'isFavorite'), 'true', '(준비) A가 S2를 찜');
select is((select e -> 'reviewSummary' from jsonb_array_elements(public.list_my_favorites(null, 50) -> 'items') e where e ->> 'id' = public.zid('S2')::text),
  '{"count":3,"averageCravingRating":4.7}'::jsonb, 'list_my_favorites 카드도 같은 집계');
reset role;
-- 리뷰가 없는 가게는 고정값과 같은 {0, null}
insert into public.stores (id, category_id, name) values (public.zid('S9'), public.zid('CA'), '리뷰없는가게');
select set_config('request.jwt.claims', '', true);
set local role anon;
select is(public.get_store(public.zid('S9')) -> 'reviewSummary', '{"count":0,"averageCravingRating":null}'::jsonb, '리뷰가 없는 가게는 {count:0, averageCravingRating:null}');
reset role;

-- ---------------------------------------------------------------- 도움돼요
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select set_config('zz.h1', public.set_helpful(public.zo('rid2'), public.zid('h-1'), true)::text, true);
select is((select array_agg(k order by k) from jsonb_object_keys(current_setting('zz.h1')::jsonb) k), array['helpful', 'helpfulCount', 'replayed', 'reviewId'], '도움돼요 응답 키');
select is(current_setting('zz.h1')::jsonb -> 'helpful', 'true'::jsonb, '[B] 누르면 helpful true');
select is((current_setting('zz.h1')::jsonb ->> 'helpfulCount')::int, 1, '[B] helpfulCount 1');
select is(current_setting('zz.h1')::jsonb -> 'replayed', 'false'::jsonb, '처음이면 replayed false');
select is(public.set_helpful(public.zo('rid2'), public.zid('h-2'), true) ->> 'helpfulCount', '1', '다른 operationId로 또 true: 사용자당 리뷰당 1개라 개수는 그대로');
select is(public.set_helpful(public.zo('rid2'), public.zid('h-2'), true) -> 'replayed', 'true'::jsonb, '같은 operationId 재시도: replayed true');
select is(public.set_helpful(public.zo('rid2'), public.zid('h-3'), false) ->> 'helpfulCount', '0', 'false로 취소하면 0');
select is(public.set_helpful(public.zo('rid2'), public.zid('h-4'), false) ->> 'helpfulCount', '0', '이미 취소했는데 또 false: 오류 없이 그대로');
select is(public.set_helpful(public.zo('rid2'), public.zid('h-2'), true) ->> 'helpfulCount', '1', '(재생) 옛 operationId는 적용 당시 결과(개수 1)를 돌려준다');
select is(public.zq(format('select public.set_helpful(%L, %L, false)', public.zo('rid2'), public.zid('h-2'))), 'P0001:REVIEW_OPERATION_CONFLICT', '같은 operationId + 다른 목표값 → REVIEW_OPERATION_CONFLICT');
reset role;
select is((select count(*)::int from public.review_helpful where review_id = public.zo('rid2')), 0, 'DB: 옛 operationId를 재생해도 도움돼요가 되살아나지 않았다 (목표값은 false 그대로)');
set local role authenticated;
select is(public.set_helpful(public.zo('rid2'), public.zid('h-5'), true) ->> 'helpfulCount', '1', '(다시 누름)');
select is(public.zesh(public.zo('rb1'), 'h-self', true), 'P0001:SELF_HELPFUL_NOT_ALLOWED', '[B] 자기 리뷰에는 불가');
select is(public.zesh(gen_random_uuid(), 'h-none', true), 'P0001:RESOURCE_NOT_FOUND', '없는 리뷰');
select is(public.zesh(null, 'h-null', true), 'P0001:INVALID_INPUT', '리뷰 ID null');
select is(public.zesh(public.zo('rid2'), null, true), 'P0001:INVALID_INPUT', 'operationId null');
select is(public.zq(format('select public.set_helpful(%L, %L, null)', public.zo('rid2'), public.zid('h-nd'))), 'P0001:INVALID_INPUT', '목표값 null');
select is(public.zeur(public.zo('rb1'), 'h-1', 1, 3, '다른 명령에 같은 id 재사용'), 'P0001:REVIEW_OPERATION_CONFLICT', '도움돼요에 쓴 operationId를 수정에 재사용 → 충돌');
reset role;

-- ---------------------------------------------------------------- 수정
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(public.zeur(public.zo('rid1'), 'u-1', 1, 3, '가나다라마바사 수정했어요'), 'OK', '(준비) 수정 가능');
reset role;
select is((select revision from public.reviews where id = public.zo('rid1')), 2::bigint, '수정하면 revision 2');
select set_config('zz.created1', (select to_jsonb(created_at) #>> '{}' from public.reviews where id = public.zo('rid1')), true);
set local role authenticated;
select set_config('zz.u2', public.update_review(public.zo('rid1'), public.zid('u-2'), 2, 4, '다시 수정한 본문입니다')::text, true);
select is((current_setting('zz.u2')::jsonb ->> 'revision')::int, 3, '수정 응답 revision 3');
select is(current_setting('zz.u2')::jsonb ->> 'reviewId', public.zo('rid1')::text, '같은 reviewId');
select is(jsonb_typeof(current_setting('zz.u2')::jsonb -> 'editedAt'), 'string', 'editedAt이 생긴다');
select is(current_setting('zz.u2')::jsonb -> 'replayed', 'false'::jsonb, 'replayed false');
select is(current_setting('zz.u2')::jsonb ->> 'body', '다시 수정한 본문입니다', '본문 갱신');
select is((current_setting('zz.u2')::jsonb ->> 'helpfulCount')::int, 1, '수정해도 도움돼요는 유지된다');
select is(current_setting('zz.u2')::jsonb ->> 'createdAt', current_setting('zz.created1'), 'createdAt은 바뀌지 않는다');
select is((select (e ->> 'reviewId') from jsonb_array_elements(public.list_my_reviews() -> 'items') e offset 3 limit 1), public.zo('rid1')::text, '수정해도 내 목록 순서는 그대로 (가장 오래된 리뷰가 위로 올라가지 않는다)');
reset role;
select set_config('zz.edited', (select edited_at::text from public.reviews where id = public.zo('rid1')), true);
set local role authenticated;
select set_config('zz.u3', public.update_review(public.zo('rid1'), public.zid('u-3'), 3, 4, '다시 수정한 본문입니다')::text, true);
select is((current_setting('zz.u3')::jsonb ->> 'revision')::int, 3, '내용이 같으면 no-op: revision 그대로');
reset role;
select is((select edited_at::text from public.reviews where id = public.zo('rid1')), current_setting('zz.edited'), 'no-op이면 editedAt도 그대로');
set local role authenticated;
select is(public.zeur(public.zo('rid1'), 'u-4', 2, 5, '오래된 revision으로 수정'), 'P0001:REVIEW_REVISION_CONFLICT', '오래된 expectedRevision → REVIEW_REVISION_CONFLICT');
select is(public.zeur(public.zo('rid1'), 'u-5', 99, 5, '앞선 revision으로 수정'), 'P0001:REVIEW_REVISION_CONFLICT', '앞선 expectedRevision도 충돌');
select is(public.zeur(public.zo('rid1'), 'u-6', 3, 0, '가나다라마바사'), 'P0001:INVALID_REVIEW_INPUT', '수정: 땡김도 0');
select is(public.zeur(public.zo('rid1'), 'u-7', 3, 3, '네글자요'), 'P0001:INVALID_REVIEW_INPUT', '수정: 본문 4자');
select is(public.zeur(public.zo('rb1'), 'u-8', 1, 3, '남의 리뷰를 수정해요'), 'P0001:RESOURCE_NOT_FOUND', '남의 리뷰 수정 → RESOURCE_NOT_FOUND');
select is(public.zeur(gen_random_uuid(), 'u-9', 1, 3, '없는 리뷰를 수정해요'), 'P0001:RESOURCE_NOT_FOUND', '없는 리뷰 수정');
select is(public.zeur(null, 'u-10', 1, 3, '가나다라마바사'), 'P0001:INVALID_INPUT', '리뷰 ID null');
select is(public.zeur(public.zo('rid1'), 'u-11', null, 3, '가나다라마바사'), 'P0001:INVALID_INPUT', 'expectedRevision null');
select is(public.update_review(public.zo('rid1'), public.zid('u-2'), 2, 4, '다시 수정한 본문입니다') - 'replayed', current_setting('zz.u2')::jsonb - 'replayed', '수정 재시도(같은 operationId · 같은 입력): 적용 당시 결과');
select is(public.update_review(public.zo('rid1'), public.zid('u-2'), 2, 4, '다시 수정한 본문입니다') -> 'replayed', 'true'::jsonb, '(replayed true)');
select is(public.zeur(public.zo('rid1'), 'u-2', 2, 4, '입력이 다른 재시도예요'), 'P0001:REVIEW_OPERATION_CONFLICT', '같은 operationId + 다른 입력 → 충돌');
select is(public.zedr(public.zo('rid1'), 'u-2', 3), 'P0001:REVIEW_OPERATION_CONFLICT', '수정에 쓴 operationId를 삭제에 재사용 → 충돌');
reset role;

-- ---------------------------------------------------------------- 기한이 지난 뒤에도 수정 · 삭제는 되고, 재작성은 안 된다 (oA7)
alter table public.orders disable trigger orders_guard;
update public.orders set completed_at = clock_timestamp() - interval '721 hours' where id = public.zo('oa7');
alter table public.orders enable trigger orders_guard;
set local role authenticated;
select is(public.get_review_eligibility(public.zo('oa7')) ->> 'eligibility', 'HAS_ACTIVE_REVIEW', '기한이 지나도 활성 리뷰가 있으면 HAS_ACTIVE_REVIEW');
select is(public.zeur(public.zo('rid7'), 'u-late', 1, 2, '기한 지나고 수정했어요'), 'OK', '기한이 지나도 수정 가능');
select is(public.zecr(public.zo('oa7'), 'c-late', 3, '기한 지난 뒤 새로 쓰기'), 'P0001:REVIEW_DEADLINE_EXCEEDED', '기한이 지나면 새 작성은 REVIEW_DEADLINE_EXCEEDED (활성 리뷰 검사보다 먼저)');
select is(public.zedr(public.zo('rid7'), 'd-late', 2), 'OK', '기한이 지나도 삭제 가능');
select is(public.get_review_eligibility(public.zo('oa7')) ->> 'eligibility', 'DEADLINE_EXCEEDED', '삭제 + 기한 지남 → DEADLINE_EXCEEDED');
select is(public.zecr(public.zo('oa7'), 'c-late2', 3, '삭제했지만 재작성 시도'), 'P0001:REVIEW_DEADLINE_EXCEEDED', '삭제 뒤에도 기한이 지났으면 재작성 불가');
reset role;

-- ---------------------------------------------------------------- 삭제
set local role authenticated;
select set_config('zz.d1', public.delete_review(public.zo('rid2'), public.zid('d-1'), 1)::text, true);
select is((select array_agg(k order by k) from jsonb_object_keys(current_setting('zz.d1')::jsonb) k), array['deletedAt', 'replayed', 'reviewId'], '삭제 응답 키');
select is(current_setting('zz.d1')::jsonb ->> 'reviewId', public.zo('rid2')::text, '삭제 응답 reviewId');
select is(jsonb_typeof(current_setting('zz.d1')::jsonb -> 'deletedAt'), 'string', 'deletedAt은 시각 문자열');
select is(current_setting('zz.d1')::jsonb -> 'replayed', 'false'::jsonb, '처음 삭제하면 replayed false');
reset role;
select is((select revision from public.reviews where id = public.zo('rid2')), 2::bigint, 'DB: 삭제하면 revision +1');
select ok((select deleted_at is not null from public.reviews where id = public.zo('rid2')), 'DB: deleted_at이 설정되었다 (soft delete, 행은 남는다)');
select is((select count(*)::int from public.review_helpful where review_id = public.zo('rid2')), 1, 'DB: 도움돼요 행은 삭제된 리뷰 ID에 남는다');
select set_config('zz.cnt_s1_after', (select count(*)::text from public.reviews where store_id = public.zid('S1') and deleted_at is null), true);
set local role anon;
select is((select count(*)::int from jsonb_array_elements(public.list_public_reviews('store', public.zid('S1'), 'LATEST', null, 50) -> 'items') e where e ->> 'reviewId' = public.zo('rid2')::text), 0, '삭제된 리뷰는 공개 목록에서 빠진다');
select is(public.list_public_reviews('store', public.zid('S1')) -> 'summary' ->> 'count', current_setting('zz.cnt_s1_after'), '삭제하면 summary에서도 빠진다');
reset role;
-- 삭제된 리뷰는 가게 카드 · 상세의 요약에서도 빠진다 (Guest 상태로 확인)
select set_config('zz.sum_s1_after', (select jsonb_build_object('count', count(*), 'averageCravingRating', round(avg(craving_rating)::numeric, 1))::text from public.reviews where store_id = public.zid('S1') and deleted_at is null), true);
select set_config('request.jwt.claims', '', true);
set local role anon;
select is(public.get_store(public.zid('S1')) -> 'reviewSummary', current_setting('zz.sum_s1_after')::jsonb, '삭제 뒤 get_store 요약은 삭제된 리뷰를 뺀 집계');
select isnt(public.get_store(public.zid('S1')) -> 'reviewSummary', current_setting('zz.sum_s1')::jsonb, '(확인) 삭제 전 요약과 달라졌다');
reset role;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(public.delete_review(public.zo('rid2'), public.zid('d-1'), 1) -> 'replayed', 'true'::jsonb, '삭제 재시도(같은 operationId): replayed true');
select is(public.delete_review(public.zo('rid2'), public.zid('d-2'), 2) ->> 'deletedAt', current_setting('zz.d1')::jsonb ->> 'deletedAt', '이미 삭제된 본인 리뷰를 다른 operationId로 또 삭제: 기존 결과로 끝낸다');
select is(public.zedr(public.zo('rid2'), 'd-3', 1), 'OK', '이미 삭제된 리뷰는 revision이 달라도 오류 없이 끝난다');
select is(public.zeur(public.zo('rid2'), 'u-del', 2, 3, '삭제된 리뷰를 수정'), 'P0001:RESOURCE_NOT_FOUND', '삭제된 리뷰 수정 → RESOURCE_NOT_FOUND');
select is(public.zedr(public.zo('rid1'), 'd-stale', 1), 'P0001:REVIEW_REVISION_CONFLICT', '삭제: 오래된 expectedRevision → 충돌');
select is(public.zedr(public.zo('rb1'), 'd-other', 1), 'P0001:RESOURCE_NOT_FOUND', '남의 리뷰 삭제 → RESOURCE_NOT_FOUND');
select is(public.zedr(null, 'd-null', 1), 'P0001:INVALID_INPUT', '삭제: 리뷰 ID null');
select is(public.zedr(public.zo('rid1'), 'd-null2', null), 'P0001:INVALID_INPUT', '삭제: expectedRevision null');
select is(public.zesh(public.zo('rid2'), 'h-del', true), 'P0001:RESOURCE_NOT_FOUND', '삭제된 리뷰에는 도움돼요 불가');
select is(public.get_review_eligibility(public.zo('oa2')) ->> 'eligibility', 'CAN_WRITE', '삭제 + 기한 안 → 다시 CAN_WRITE');
-- 재작성: 새 ID, 도움돼요 0부터
select set_config('zz.rid2b', (public.create_review(public.zo('oa2'), public.zid('c-a2b'), 4, '삭제하고 다시 썼어요')::jsonb ->> 'reviewId'), true);
select isnt(public.zo('rid2b'), public.zo('rid2'), '재작성은 새 reviewId');
select is((select e ->> 'helpfulCount' from jsonb_array_elements(public.list_my_reviews() -> 'items') e where e ->> 'reviewId' = public.zo('rid2b')::text), '0', '재작성한 리뷰의 도움돼요는 0부터 (이전 리뷰의 것을 물려받지 않는다)');
-- 옛 생성 요청 재시도는 삭제된 리뷰를 되살리지 않는다
select is(public.create_review(public.zo('oa2'), public.zid('c-a2'), 3, '두 메뉴를 시켰어요') ->> 'reviewId', public.zo('rid2')::text, '옛 생성 operationId 재시도: 적용 당시 결과(옛 reviewId)를 돌려준다');
select is((select count(*)::int from jsonb_array_elements(public.list_my_reviews() -> 'items') e where e ->> 'orderId' = public.zo('oa2')::text), 1, '그래도 활성 리뷰는 재작성한 1개뿐 (되살리지 않는다)');
select is(public.get_review_eligibility(public.zo('oa2')) ->> 'activeReviewId', public.zo('rid2b')::text, 'activeReviewId는 재작성한 리뷰');
reset role;
select is((select count(*)::int from public.reviews where order_id = public.zo('oa2')), 2, 'DB: 같은 주문에 행이 2개(삭제된 것 + 활성)');
select is((select count(*)::int from public.reviews where order_id = public.zo('oa2') and deleted_at is null), 1, 'DB: 활성은 1개');

-- ---------------------------------------------------------------- 직접 접근 금지
set local role authenticated;
select ok(public.test_err($$select * from public.reviews$$, '42501'), '[A] reviews 직접 조회 금지');
select ok(public.test_err($$insert into public.reviews (order_id, user_id, store_id, craving_rating, body) values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 3, '가나다라마')$$, '42501'), '[A] reviews 직접 INSERT 금지');
select ok(public.test_err($$update public.reviews set craving_rating = 1$$, '42501'), '[A] reviews 직접 UPDATE 금지');
select ok(public.test_err($$delete from public.reviews$$, '42501'), '[A] reviews 직접 DELETE 금지');
select ok(public.test_err($$select * from public.review_helpful$$, '42501'), '[A] review_helpful 직접 조회 금지');
select ok(public.test_err($$insert into public.review_helpful (review_id, user_id) values (gen_random_uuid(), gen_random_uuid())$$, '42501'), '[A] review_helpful 직접 INSERT 금지');
select ok(public.test_err($$select * from public.review_menus$$, '42501'), '[A] review_menus 직접 조회 금지');
select ok(public.test_err($$select * from private.review_command_receipts$$, '42501'), '[A] 영수증 테이블 접근 금지');
select ok(public.test_err($$select private.review_json(gen_random_uuid(), null, true)$$, '42501'), '[A] private 리뷰 함수 직접 호출 금지');
reset role;

-- ---------------------------------------------------------------- 내역 행의 reviewEligibility
set local role authenticated;
select is((select e -> 'reviewEligibility' ->> 'eligibility' from jsonb_array_elements(public.list_my_orders(null, 50) -> 'items') e where e ->> 'orderId' = public.zo('oa2')::text), 'HAS_ACTIVE_REVIEW', '내역 행: 활성 리뷰가 있으면 HAS_ACTIVE_REVIEW');
select is((select e -> 'reviewEligibility' ->> 'eligibility' from jsonb_array_elements(public.list_my_orders(null, 50) -> 'items') e where e ->> 'orderId' = public.zo('oa3')::text), 'NOT_COMPLETED', '내역 행: PENDING은 NOT_COMPLETED');
select is((select e -> 'reviewEligibility' ->> 'eligibility' from jsonb_array_elements(public.list_my_orders(null, 50) -> 'items') e where e ->> 'orderId' = public.zo('oa6')::text), 'DEADLINE_EXCEEDED', '내역 행: 기한이 지난 주문은 DEADLINE_EXCEEDED');
select is((select e -> 'reviewEligibility' ->> 'eligibility' from jsonb_array_elements(public.list_my_orders(null, 50) -> 'items') e where e ->> 'orderId' = public.zo('oa7')::text), 'DEADLINE_EXCEEDED', '내역 행: 삭제 + 기한 지남은 DEADLINE_EXCEEDED');
select is(public.get_my_history_order(public.zo('oa1')) -> 'reviewEligibility' ->> 'activeReviewId', public.zo('rid1')::text, '단건 조회의 reviewEligibility.activeReviewId');
select is((select count(*)::int from jsonb_array_elements(public.list_my_orders(null, 50) -> 'items') e where e ? 'images'), 0, '내역 행에도 images 키가 없다');
reset role;

select * from finish();
rollback;
