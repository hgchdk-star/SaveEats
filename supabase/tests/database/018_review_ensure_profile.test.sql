-- 리뷰 쓰기 함수의 프로필 행 보장: create_review · set_helpful
-- 배경: 프로필 행이 없는 계정이 set_helpful을 부르면 review_helpful.user_id → profiles FK(review_helpful_user_id_fkey, 23503)로 실패했다.
--       create_review는 reviews.user_id → profiles FK가 같지만, 본인 주문이 있어야 하는데 주문 생성(create_order)이 프로필을 만들므로
--       정상 경로에서는 프로필 없이 도달할 수 없다. 데이터가 어긋난 계정(주문은 있는데 프로필이 없는 경우)은 복제 모드로 만들어 확인한다.
-- 테스트 데이터는 롤백으로 사라진다. 기존 동작(검증 순서 · 영수증 · 오류 코드)은 015 테스트가 그대로 지킨다.
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

create function public.zdone(p_key text, p_store uuid, p_menu uuid, p_price bigint) returns uuid language plpgsql as $$
declare v uuid;
begin
  v := (public.create_order(public.zreq(p_store, jsonb_build_array(public.zitem(p_menu, 1, p_price)), public.zid(p_key))) ->> 'orderId')::uuid;
  perform public.confirm_order(v, public.zid(p_key || '-confirm'));
  return v;
end;
$$;

-- 결과를 'OK' 또는 'SQLSTATE:메시지'로
create function public.zecr(p_order uuid, p_op text, p_rating integer, p_body text) returns text language plpgsql as $$
begin perform public.create_review(p_order, public.zid(p_op), p_rating, p_body); return 'OK';
exception when others then return sqlstate || ':' || sqlerrm; end; $$;
create function public.zesh(p_review uuid, p_op text, p_desired boolean) returns text language plpgsql as $$
begin perform public.set_helpful(p_review, public.zid(p_op), p_desired); return 'OK';
exception when others then return sqlstate || ':' || sqlerrm; end; $$;

create function public.zjwt(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claims', case when p_uid is null then '' else '{"sub":"' || p_uid || '","role":"authenticated"}' end, true)
$$;

-- ---------------------------------------------------------------- 픽스처 (superuser)
-- A: 작성자(주문 → 프로필 자동 생성) / B: 프로필 없는 도움돼요 사용자 / C: 프로필 없는 다른 사용자 / D: 주문은 있는데 프로필이 사라진 계정(어긋난 데이터)
insert into auth.users (id) values
  ('aaaaaaaa-0000-4000-8000-0000000000a1'),
  ('bbbbbbbb-0000-4000-8000-0000000000b2'),
  ('cccccccc-0000-4000-8000-0000000000c3'),
  ('dddddddd-0000-4000-8000-0000000000d4');
insert into public.categories (id, code, name, sort_order) values (public.zid('CA'), 'zz-rp-a', '프로필보장분류', 99);
insert into public.stores (id, category_id, name) values (public.zid('S1'), public.zid('CA'), '프로필보장가게');
insert into public.menus (id, store_id, name, base_price) values (public.zid('MA'), public.zid('S1'), '메뉴A', 1000);

select is((select count(*)::int from public.profiles where id in
  ('bbbbbbbb-0000-4000-8000-0000000000b2', 'cccccccc-0000-4000-8000-0000000000c3')), 0, '(준비) B · C는 프로필 행이 없다');

-- A: 주문 두 건 → 완료 → 리뷰 하나
select public.zjwt('aaaaaaaa-0000-4000-8000-0000000000a1');
set local role authenticated;
select set_config('zz.oa1', public.zdone('A1', public.zid('S1'), public.zid('MA'), 1000)::text, true);
select set_config('zz.oa2', public.zdone('A2', public.zid('S1'), public.zid('MA'), 1000)::text, true);
select set_config('zz.ra1', (public.create_review(public.zo('oa1'), public.zid('A-create-1'), 4, '작성자 리뷰입니다') ->> 'reviewId'), true);
reset role;
select is((select count(*)::int from public.profiles where id = 'aaaaaaaa-0000-4000-8000-0000000000a1'), 1, '(준비) A는 주문 때 프로필이 생겼다');

-- D: 주문 · 완료한 뒤 프로필만 사라진 상태를 만든다 (FK 검사를 끄는 복제 모드, 롤백됨)
select public.zjwt('dddddddd-0000-4000-8000-0000000000d4');
set local role authenticated;
select set_config('zz.od1', public.zdone('D1', public.zid('S1'), public.zid('MA'), 1000)::text, true);
reset role;
set local session_replication_role = replica;
delete from public.profiles where id = 'dddddddd-0000-4000-8000-0000000000d4';
set local session_replication_role = origin;
select is((select count(*)::int from public.profiles where id = 'dddddddd-0000-4000-8000-0000000000d4'), 0, '(준비) D는 주문이 있는데 프로필이 없다');
select is((select count(*)::int from public.orders where user_id = 'dddddddd-0000-4000-8000-0000000000d4'), 1, '(준비) D의 주문은 남아 있다');

-- ================================================================ set_helpful: 프로필 없는 계정
select public.zjwt('bbbbbbbb-0000-4000-8000-0000000000b2');
set local role authenticated;
select is(public.zesh(public.zo('ra1'), 'B-h1', true), 'OK', '[프로필 없는 B] set_helpful(true)가 성공한다 (이전에는 23503)');
reset role;
select is((select count(*)::int from public.profiles where id = 'bbbbbbbb-0000-4000-8000-0000000000b2'), 1, '성공 뒤 B의 프로필 행이 생겼다');
select is((select count(*)::int from public.review_helpful where review_id = public.zo('ra1') and user_id = 'bbbbbbbb-0000-4000-8000-0000000000b2'), 1, '도움돼요가 저장됐다');

set local role authenticated;
select is((select array_agg(k order by k) from jsonb_object_keys(public.set_helpful(public.zo('ra1'), public.zid('B-h1'), true)) k),
  array['helpful', 'helpfulCount', 'replayed', 'reviewId'], '응답 키는 기존과 같다 (재생 호출)');
select is(public.set_helpful(public.zo('ra1'), public.zid('B-h1'), true),
  jsonb_build_object('reviewId', public.zo('ra1'), 'helpful', true, 'helpfulCount', 1, 'replayed', true), '같은 operationId 재호출: 영수증으로 재생(replayed true), 개수는 그대로');
select is(public.set_helpful(public.zo('ra1'), public.zid('B-h2'), false),
  jsonb_build_object('reviewId', public.zo('ra1'), 'helpful', false, 'helpfulCount', 0, 'replayed', false), '해제도 같은 모양 (replayed false)');
select is(jsonb_typeof(public.set_helpful(public.zo('ra1'), public.zid('B-h3'), true) -> 'helpfulCount'), 'number', 'helpfulCount는 숫자');
reset role;
select is((select count(*)::int from public.profiles where id = 'bbbbbbbb-0000-4000-8000-0000000000b2'), 1, '여러 번 불러도 프로필 행은 하나');

-- 이미 있는 프로필은 건드리지 않는다
update public.profiles set nickname = '기존닉네임' where id = 'bbbbbbbb-0000-4000-8000-0000000000b2';
set local role authenticated;
select is(public.zesh(public.zo('ra1'), 'B-h4', false), 'OK', '[프로필 있는 B] 계속 동작한다');
reset role;
select is((select nickname from public.profiles where id = 'bbbbbbbb-0000-4000-8000-0000000000b2'), '기존닉네임', '이미 있는 프로필의 닉네임은 덮어쓰지 않는다');

-- ================================================================ 실패 경로: 부작용이 남지 않는다 (예외로 롤백)
select public.zjwt('cccccccc-0000-4000-8000-0000000000c3');
set local role authenticated;
select is(public.zesh(gen_random_uuid(), 'C-none', true), 'P0001:RESOURCE_NOT_FOUND', '[프로필 없는 C] 없는 리뷰 → RESOURCE_NOT_FOUND (오류 코드 그대로)');
select is(public.zesh(null, 'C-null', true), 'P0001:INVALID_INPUT', '[C] 리뷰 ID null → INVALID_INPUT');
select is(public.zesh(public.zo('ra1'), null, true), 'P0001:INVALID_INPUT', '[C] operationId null → INVALID_INPUT');
select is(public.zesh(public.zo('ra1'), 'C-nul', null), 'P0001:INVALID_INPUT', '[C] desired null → INVALID_INPUT');
reset role;
select is((select count(*)::int from public.profiles where id = 'cccccccc-0000-4000-8000-0000000000c3'), 0, '실패한 호출은 프로필 행을 남기지 않는다 (롤백)');
select is((select count(*)::int from private.review_command_receipts where user_id = 'cccccccc-0000-4000-8000-0000000000c3'), 0, '실패한 호출은 영수증도 남기지 않는다');

-- 삭제된 리뷰 · 자기 리뷰 · 로그인 없음
select public.zjwt('aaaaaaaa-0000-4000-8000-0000000000a1');
set local role authenticated;
select set_config('zz.ra2', (public.create_review(public.zo('oa2'), public.zid('A-create-2'), 5, '지울 리뷰입니다') ->> 'reviewId'), true);
select is(public.zesh(public.zo('ra1'), 'A-self', true), 'P0001:SELF_HELPFUL_NOT_ALLOWED', '[작성자 A] 자기 리뷰 → SELF_HELPFUL_NOT_ALLOWED (그대로)');
select ok((public.delete_review(public.zo('ra2'), public.zid('A-del-2'), 1) ->> 'reviewId') is not null, '(준비) ra2 삭제');
reset role;
select public.zjwt('cccccccc-0000-4000-8000-0000000000c3');
set local role authenticated;
select is(public.zesh(public.zo('ra2'), 'C-del', true), 'P0001:RESOURCE_NOT_FOUND', '[C] 삭제된 리뷰 → RESOURCE_NOT_FOUND');
reset role;
select is((select count(*)::int from public.profiles where id = 'cccccccc-0000-4000-8000-0000000000c3'), 0, '삭제된 리뷰 실패도 프로필을 남기지 않는다');
select public.zjwt(null);
set local role authenticated;
select is(public.zesh(public.zo('ra1'), 'x', true), 'P0001:AUTH_REQUIRED', '[로그인 정보 없음] set_helpful → AUTH_REQUIRED');
select is(public.zecr(public.zo('oa1'), 'x', 3, '가나다라마'), 'P0001:AUTH_REQUIRED', '[로그인 정보 없음] create_review → AUTH_REQUIRED');
reset role;
select is((select count(*)::int from public.profiles), (select count(distinct id)::int from public.profiles), '프로필 행이 중복되지 않았다');

-- ================================================================ create_review
-- 프로필이 없는 C는 주문이 없으므로 남의 주문에 리뷰를 쓸 수 없다 (오류 코드 그대로, 부작용 없음)
select public.zjwt('cccccccc-0000-4000-8000-0000000000c3');
set local role authenticated;
select is(public.zecr(public.zo('oa1'), 'C-cr', 3, '남의 주문에 씁니다'), 'P0001:RESOURCE_NOT_FOUND', '[프로필 없는 C] 남의 주문 → RESOURCE_NOT_FOUND (그대로)');
select is(public.zecr(null, 'C-cr2', 3, '가나다라마'), 'P0001:INVALID_INPUT', '[C] 주문 ID null → INVALID_INPUT');
reset role;
select is((select count(*)::int from public.profiles where id = 'cccccccc-0000-4000-8000-0000000000c3'), 0, '실패한 create_review는 프로필 행을 남기지 않는다');
select is((select count(*)::int from public.orders where user_id = 'cccccccc-0000-4000-8000-0000000000c3'), 0, 'C에게는 주문이 없다 (정상 경로에서는 프로필 없이 리뷰에 도달할 수 없다)');

-- 어긋난 데이터: 주문은 있는데 프로필이 없는 D도 리뷰를 쓸 수 있다 (이전에는 reviews.user_id FK 23503)
select public.zjwt('dddddddd-0000-4000-8000-0000000000d4');
set local role authenticated;
select is(public.zecr(public.zo('od1'), 'D-cr', 5, '프로필이 사라진 계정'), 'OK', '[주문은 있고 프로필이 없는 D] create_review가 성공한다 (이전에는 23503)');
reset role;
select is((select count(*)::int from public.profiles where id = 'dddddddd-0000-4000-8000-0000000000d4'), 1, '성공 뒤 D의 프로필 행이 복구됐다');
select is((select count(*)::int from public.reviews where user_id = 'dddddddd-0000-4000-8000-0000000000d4' and deleted_at is null), 1, 'D의 리뷰가 저장됐다');
set local role authenticated;
select is((select array_agg(k order by k) from jsonb_object_keys(public.create_review(public.zo('od1'), public.zid('D-cr'), 5, '프로필이 사라진 계정')) k),
  array['authorNickname', 'body', 'createdAt', 'editedAt', 'helpfulCount', 'isMine', 'menuIds', 'menuNamesSnapshot', 'myHelpful', 'orderAmount', 'orderId',
        'rating', 'replayed', 'reviewId', 'revision', 'storeId', 'storeNameSnapshot'], '응답 키는 기존과 같다');
select is((public.create_review(public.zo('od1'), public.zid('D-cr'), 5, '프로필이 사라진 계정') ->> 'replayed')::boolean, true, '같은 operationId 재호출은 재생된다');
reset role;

-- 정상 계정: 프로필 행과 닉네임은 그대로
select public.zjwt('aaaaaaaa-0000-4000-8000-0000000000a1');
update public.profiles set nickname = '작성자닉네임' where id = 'aaaaaaaa-0000-4000-8000-0000000000a1';
set local role authenticated;
select is(public.zecr(public.zo('oa2'), 'A-create-3', 3, '삭제 후 다시 씁니다'), 'OK', '[프로필 있는 A] create_review가 계속 동작한다');
reset role;
select is((select nickname from public.profiles where id = 'aaaaaaaa-0000-4000-8000-0000000000a1'), '작성자닉네임', '이미 있는 프로필의 닉네임은 덮어쓰지 않는다');
select is((select count(*)::int from public.profiles where id = 'aaaaaaaa-0000-4000-8000-0000000000a1'), 1, 'A의 프로필 행은 하나');

-- ================================================================ 바꾸지 않은 함수 · 권한
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname = 'create_review'), 1, 'create_review는 하나뿐 (오버로드가 생기지 않았다)');
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname = 'set_helpful'), 1, 'set_helpful은 하나뿐');
select is((select proargnames from pg_proc where oid = 'public.create_review(uuid, uuid, integer, text)'::regprocedure), array['p_order_id', 'p_operation_id', 'p_rating', 'p_body'], 'create_review 인자 이름 그대로');
select is((select proargnames from pg_proc where oid = 'public.set_helpful(uuid, uuid, boolean)'::regprocedure), array['p_review_id', 'p_operation_id', 'p_desired'], 'set_helpful 인자 이름 그대로');
select ok((select bool_and(p.prosecdef and not p.proretset and p.provolatile = 'v' and 'search_path=""' = any (p.proconfig))
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('create_review', 'set_helpful')), '두 함수 모두 DEFINER · VOLATILE · search_path 고정');
select ok(has_function_privilege('authenticated', 'public.create_review(uuid, uuid, integer, text)', 'execute')
  and has_function_privilege('authenticated', 'public.set_helpful(uuid, uuid, boolean)', 'execute'), '로그인 사용자는 실행할 수 있다');
select ok(not has_function_privilege('anon', 'public.create_review(uuid, uuid, integer, text)', 'execute')
  and not has_function_privilege('anon', 'public.set_helpful(uuid, uuid, boolean)', 'execute'), 'anon은 실행할 수 없다 (create or replace가 권한을 되돌리지 않았다)');
select ok(coalesce((select string_agg(proacl::text, ',') from pg_proc where pronamespace = 'public'::regnamespace and proname in ('create_review', 'set_helpful')), '') !~ '(^|[{,])=X',
  'PUBLIC에 실행 권한이 열려 있지 않다');
select ok(not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('update_review', 'delete_review')
  and prosrc ilike '%insert into public.profiles%'), 'update_review · delete_review는 바꾸지 않았다 (프로필 보장 없음)');

select * from finish();
rollback;
