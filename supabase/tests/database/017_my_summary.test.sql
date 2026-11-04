-- 마이 요약: get_monthly_summary · get_my_cumulative_summary
-- 근거: PRD 40~42장, 계약 초안 my-summary-contract-draft.md. 테스트 데이터는 롤백으로 사라진다.
-- 주문은 실제 경로(create_order, confirm_order, cancel_order)로 만들고, 월 경계 테스트를 위해 완료 시각(completed_at)은
-- 가드 트리거를 잠시 끄고 직접 옮긴다(롤백됨). KST 월 경계 = UTC로 전월 말일 15:00:00.
-- 016번은 후속 리뷰 사진 테스트용으로 비워 둔다.
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

create function public.zreq(p_store uuid, p_items jsonb, p_key uuid) returns jsonb language sql as $$
  select jsonb_build_object(
    'idempotencyKey', p_key, 'requestVersion', 2, 'storeId', p_store, 'destinationRef', '0de57000-0000-4000-8000-000000000001', 'items', p_items,
    'approvedTotalAmount', (select sum((i ->> 'approvedUnitPrice')::numeric * (i ->> 'quantity')::numeric) from jsonb_array_elements(p_items) i)::bigint,
    'disclosureVersion', '2026-09-30', 'disclosureAcknowledged', true)
$$;

create function public.zitem(p_menu uuid, p_price bigint) returns jsonb language sql as $$
  select jsonb_build_object('menuId', p_menu, 'optionIds', '[]'::jsonb, 'quantity', 1, 'approvedUnitPrice', p_price, 'approvedCatalogRevision', 1)
$$;

-- 현재 사용자로 주문을 만들고 완료까지: p_store = 'SA' | 'SB' | 'SC', 메뉴는 가게·가격으로 정해진다
create function public.zd(p_key text, p_store text, p_price bigint) returns uuid language plpgsql as $$
declare v uuid;
begin
  v := (public.create_order(public.zreq(public.zid(p_store), jsonb_build_array(public.zitem(public.zid('M' || p_store || p_price), p_price)), public.zid(p_key))) ->> 'orderId')::uuid;
  perform public.confirm_order(v, public.zid(p_key || '-confirm'));
  return v;
end;
$$;

-- 같은 가게에서 줄 두 개(서로 다른 메뉴)짜리 주문 + 완료
create function public.zd2(p_key text, p_store text, p_price1 bigint, p_price2 bigint) returns uuid language plpgsql as $$
declare v uuid;
begin
  v := (public.create_order(public.zreq(public.zid(p_store), jsonb_build_array(
    public.zitem(public.zid('M' || p_store || p_price1), p_price1), public.zitem(public.zid('M' || p_store || p_price2), p_price2)), public.zid(p_key))) ->> 'orderId')::uuid;
  perform public.confirm_order(v, public.zid(p_key || '-confirm'));
  return v;
end;
$$;

-- 월간 응답 키 · 타입이 계약과 같은지. 맞으면 'OK'
create function public.zmonthly_shape(r jsonb) returns text language plpgsql as $$
begin
  if (select array_agg(k order by k) from jsonb_object_keys(r) k) is distinct from array['deliveredAmount', 'largestOrderAmount', 'monthKey', 'orderCount', 'topCategoryName'] then
    return 'keys';
  end if;
  if jsonb_typeof(r -> 'monthKey') <> 'string' or jsonb_typeof(r -> 'orderCount') <> 'number' or jsonb_typeof(r -> 'deliveredAmount') <> 'number'
     or jsonb_typeof(r -> 'topCategoryName') not in ('string', 'null') or jsonb_typeof(r -> 'largestOrderAmount') not in ('number', 'null') then
    return 'types';
  end if;
  return 'OK';
end;
$$;

-- ---------------------------------------------------------------- 픽스처 (superuser)
insert into auth.users (id) values
  ('aaaaaaaa-0000-4000-8000-000000000001'),
  ('bbbbbbbb-0000-4000-8000-000000000002'),
  ('dddddddd-0000-4000-8000-000000000004'),
  ('eeeeeeee-0000-4000-8000-000000000005'),
  ('ffffffff-0000-4000-8000-000000000006');
insert into public.categories (id, code, name, sort_order) values
  (public.zid('CA'), 'zz-my-a', '치킨', 99),
  (public.zid('CB'), 'zz-my-b', '분식', 99),
  (public.zid('CC'), 'zz-my-c', '한식', 99);
insert into public.stores (id, category_id, name) values
  (public.zid('SA'), public.zid('CA'), '요약가게A'),
  (public.zid('SB'), public.zid('CB'), '요약가게B'),
  (public.zid('SC'), public.zid('CC'), '요약가게C');
-- 가게마다 가격별 메뉴: 1000 · 2000 · 3000 · 4000 · 5000 · 7000 · 8000 · 아주 큰 금액
insert into public.menus (id, store_id, name, base_price)
select public.zid('M' || s || p), public.zid(s), '메뉴' || s || p, p
from unnest(array['SA', 'SB', 'SC']) s cross join unnest(array[1000, 2000, 3000, 4000, 5000, 7000, 8000, 9007199254740991::bigint]) p;

-- ---------------------------------------------------------------- 구조 · 권한
select ok(not (select prosecdef from pg_proc where oid = 'public.get_monthly_summary(text)'::regprocedure), 'get_monthly_summary는 SECURITY INVOKER (RLS로 본인 주문만)');
select ok(not (select prosecdef from pg_proc where oid = 'public.get_my_cumulative_summary()'::regprocedure), 'get_my_cumulative_summary는 SECURITY INVOKER');
select ok((select bool_and(exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%'))
    from pg_proc p where p.oid in ('public.get_monthly_summary(text)'::regprocedure, 'public.get_my_cumulative_summary()'::regprocedure)), '두 함수 모두 search_path가 고정되어 있다');
select is((select proargnames from pg_proc where oid = 'public.get_monthly_summary(text)'::regprocedure), array['p_month_key'], 'get_monthly_summary 인자 이름');
select is((select provolatile::text from pg_proc where oid = 'public.get_monthly_summary(text)'::regprocedure), 's', 'get_monthly_summary는 stable(읽기 전용)');
select is((select provolatile::text from pg_proc where oid = 'public.get_my_cumulative_summary()'::regprocedure), 's', 'get_my_cumulative_summary는 stable(읽기 전용)');
select ok(not exists (
    select 1 from pg_proc p where p.oid in ('public.get_monthly_summary(text)'::regprocedure, 'public.get_my_cumulative_summary()'::regprocedure)
      and coalesce(p.proacl::text, '') ~ '(^|[{,])=X|anon='), '두 함수는 PUBLIC/anon에게 열려 있지 않다');
select ok((select count(*) = 2 from pg_proc p where p.oid in ('public.get_monthly_summary(text)'::regprocedure, 'public.get_my_cumulative_summary()'::regprocedure)
      and coalesce(p.proacl::text, '') ~ 'authenticated=X'), '두 함수는 authenticated에게 열려 있다');

-- ---------------------------------------------------------------- Guest / 로그인 정보 없음
set local role anon;
select ok(public.test_err($$select public.get_monthly_summary('2026-03')$$, '42501'), '[anon] get_monthly_summary 실행 금지');
select ok(public.test_err($$select public.get_my_cumulative_summary()$$, '42501'), '[anon] get_my_cumulative_summary 실행 금지');
reset role;
select set_config('request.jwt.claims', '', true);
set local role authenticated;
select ok(public.test_err($$select public.get_monthly_summary('2026-03')$$, 'P0001', 'AUTH_REQUIRED'), '[sub 없음] 월간 → AUTH_REQUIRED');
select ok(public.test_err($$select public.get_my_cumulative_summary()$$, 'P0001', 'AUTH_REQUIRED'), '[sub 없음] 누적 → AUTH_REQUIRED');
select ok(public.test_err($$select public.get_monthly_summary('잘못')$$, 'P0001', 'AUTH_REQUIRED'), '[sub 없음] 잘못된 입력도 로그인 확인이 먼저');
reset role;

-- ---------------------------------------------------------------- 주문 준비 (사용자 A)
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
-- 3월 경계: 2월 마지막 순간 · 3월 첫 순간 · (UTC로는 2월이지만 KST로는 3월) · 3월 마지막 순간 · 4월 첫 순간 · (UTC로는 3월이지만 KST로는 4월)
select set_config('zz.febLast', public.zd('feb-last', 'SA', 1000)::text, true);
select set_config('zz.marFirst', public.zd('mar-first', 'SA', 2000)::text, true);
select set_config('zz.marMid', public.zd('mar-mid', 'SC', 5000)::text, true);
select set_config('zz.marLast', public.zd('mar-last', 'SB', 4000)::text, true);
select set_config('zz.aprFirst', public.zd('apr-first', 'SA', 8000)::text, true);
select set_config('zz.aprMid', public.zd('apr-mid', 'SA', 3000)::text, true);
-- 5월 동률: 치킨 2건(최근 5/10), 분식 2건(최근 5/20) → 분식
select set_config('zz.may1', public.zd('may-1', 'SA', 1000)::text, true);
select set_config('zz.may2', public.zd('may-2', 'SA', 1000)::text, true);
select set_config('zz.may3', public.zd('may-3', 'SB', 1000)::text, true);
select set_config('zz.may4', public.zd('may-4', 'SB', 1000)::text, true);
-- 6월: 치킨 1건 · 분식 1건이 완전히 같은 완료 시각 → 카테고리 코드 오름차순(zz-my-a = 치킨)
select set_config('zz.jun1', public.zd('jun-1', 'SB', 1000)::text, true);
select set_config('zz.jun2', public.zd('jun-2', 'SA', 1000)::text, true);
-- 7월: 치킨 3건(작은 금액) vs 분식 2건(줄 3개, 큰 금액이고 더 최근) → 주문 1건 = 1회라 치킨
select set_config('zz.jul1', public.zd('jul-1', 'SA', 1000)::text, true);
select set_config('zz.jul2', public.zd('jul-2', 'SA', 1000)::text, true);
select set_config('zz.jul3', public.zd('jul-3', 'SA', 1000)::text, true);
select set_config('zz.jul4', public.zd2('jul-4', 'SB', 7000, 8000)::text, true);
select set_config('zz.jul5', public.zd('jul-5', 'SB', 5000)::text, true);
-- 8월: 같은 카테고리의 Snapshot 이름이 다르면 가장 최근 주문의 이름
select set_config('zz.aug1', public.zd('aug-1', 'SA', 1000)::text, true);
select set_config('zz.aug2', public.zd('aug-2', 'SA', 1000)::text, true);
-- 10월: 아주 큰 금액 두 건 (안전 정수 한계)
select set_config('zz.oct1', public.zd('oct-1', 'SB', 9007199254740991)::text, true);
select set_config('zz.oct2', public.zd('oct-2', 'SB', 9007199254740991)::text, true);
-- 이번 달(옮기지 않음): 완료 2건 + PENDING 1건 + 취소 1건
select set_config('zz.now1', public.zd('now-1', 'SA', 1000)::text, true);
select set_config('zz.now2', public.zd('now-2', 'SA', 2000)::text, true);
select set_config('zz.pend', (public.create_order(public.zreq(public.zid('SA'), jsonb_build_array(public.zitem(public.zid('MSA1000'), 1000)), public.zid('now-pend'))) ->> 'orderId'), true);
select set_config('zz.canc', (public.create_order(public.zreq(public.zid('SA'), jsonb_build_array(public.zitem(public.zid('MSA1000'), 1000)), public.zid('now-canc'))) ->> 'orderId'), true);
select is((public.cancel_order(public.zo('canc'), public.zid('now-canc-cancel')) ->> 'status'), 'CANCELLED', '(준비) 취소 주문');
reset role;
-- 사용자 B: 3월에 완료 1건 (A의 3월 요약에 섞이면 안 된다)
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select set_config('zz.bMar', public.zd('b-mar', 'SA', 7000)::text, true);
reset role;
-- 사용자 D: PENDING만 / 사용자 F: 취소만 / 사용자 E: 주문 없음
select set_config('request.jwt.claims', '{"sub":"dddddddd-0000-4000-8000-000000000004","role":"authenticated"}', true);
set local role authenticated;
select set_config('zz.dPend', (public.create_order(public.zreq(public.zid('SA'), jsonb_build_array(public.zitem(public.zid('MSA1000'), 1000)), public.zid('d-pend'))) ->> 'orderId'), true);
reset role;
select set_config('request.jwt.claims', '{"sub":"ffffffff-0000-4000-8000-000000000006","role":"authenticated"}', true);
set local role authenticated;
select set_config('zz.fCanc', (public.create_order(public.zreq(public.zid('SA'), jsonb_build_array(public.zitem(public.zid('MSA1000'), 1000)), public.zid('f-canc'))) ->> 'orderId'), true);
select is((public.cancel_order(public.zo('fCanc'), public.zid('f-canc-cancel')) ->> 'status'), 'CANCELLED', '(준비) F의 취소 주문');
reset role;

-- 완료 시각을 옮긴다 (가드 트리거를 잠시 끈다. 롤백됨)
alter table public.orders disable trigger orders_guard;
update public.orders set completed_at = '2026-02-28 14:59:59.999999+00' where id = public.zo('febLast');   -- 2/28 23:59:59.999999 KST
update public.orders set completed_at = '2026-02-28 15:00:00+00' where id = public.zo('marFirst');        -- 3/1 00:00:00 KST
update public.orders set completed_at = '2026-02-28 20:00:00+00' where id = public.zo('marMid');          -- 3/1 05:00 KST (UTC로는 2월)
update public.orders set completed_at = '2026-03-31 14:59:59.999999+00' where id = public.zo('marLast'); -- 3/31 23:59:59.999999 KST
update public.orders set completed_at = '2026-03-31 15:00:00+00' where id = public.zo('aprFirst');        -- 4/1 00:00:00 KST
update public.orders set completed_at = '2026-03-31 20:00:00+00' where id = public.zo('aprMid');          -- 4/1 05:00 KST (UTC로는 3월)
update public.orders set completed_at = '2026-05-10 03:00:00+00' where id = public.zo('may1');
update public.orders set completed_at = '2026-05-05 03:00:00+00' where id = public.zo('may2');
update public.orders set completed_at = '2026-05-20 03:00:00+00' where id = public.zo('may3');
update public.orders set completed_at = '2026-05-01 03:00:00+00' where id = public.zo('may4');
update public.orders set completed_at = '2026-06-15 03:00:00+00' where id in (public.zo('jun1'), public.zo('jun2'));
update public.orders set completed_at = '2026-07-01 03:00:00+00' where id = public.zo('jul1');
update public.orders set completed_at = '2026-07-02 03:00:00+00' where id = public.zo('jul2');
update public.orders set completed_at = '2026-07-03 03:00:00+00' where id = public.zo('jul3');
update public.orders set completed_at = '2026-07-20 03:00:00+00' where id = public.zo('jul4');
update public.orders set completed_at = '2026-07-25 03:00:00+00' where id = public.zo('jul5');
update public.orders set completed_at = '2026-08-01 03:00:00+00', category_name_snapshot = '옛이름' where id = public.zo('aug1');
update public.orders set completed_at = '2026-08-02 03:00:00+00', category_name_snapshot = '새이름' where id = public.zo('aug2');
update public.orders set completed_at = '2026-10-10 03:00:00+00' where id = public.zo('oct1');
update public.orders set completed_at = '2026-10-11 03:00:00+00' where id = public.zo('oct2');
update public.orders set completed_at = '2026-03-10 03:00:00+00' where id = public.zo('bMar');
alter table public.orders enable trigger orders_guard;

-- ---------------------------------------------------------------- 월간: 월 경계 (KST)
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select set_config('zz.m3', public.get_monthly_summary('2026-03')::text, true);
select is(public.zmonthly_shape(current_setting('zz.m3')::jsonb), 'OK', '월간 응답 키 · 타입이 계약과 같다');
select is(current_setting('zz.m3')::jsonb ->> 'monthKey', '2026-03', 'monthKey는 요청한 값 그대로');
select is((current_setting('zz.m3')::jsonb ->> 'orderCount')::int, 3, '3월: 경계 안 3건 (KST 3/1 00:00:00 포함, 3/31 23:59:59.999999 포함, UTC로는 2월인 3/1 05시 포함)');
select is((current_setting('zz.m3')::jsonb ->> 'deliveredAmount')::bigint, 11000::bigint, '3월 금액 합계 2000 + 5000 + 4000');
select is((current_setting('zz.m3')::jsonb ->> 'largestOrderAmount')::bigint, 5000::bigint, '3월 가장 큰 주문 5000');
select is(current_setting('zz.m3')::jsonb ->> 'topCategoryName', '분식', '3월: 세 카테고리가 1건씩 동률 → 가장 최근 완료(3/31 23:59:59.999999 KST) = 분식');
select is(public.get_monthly_summary('2026-02') - 'topCategoryName', '{"monthKey":"2026-02","orderCount":1,"deliveredAmount":1000,"largestOrderAmount":1000}'::jsonb,
  '2월: KST 2/28 23:59:59.999999는 2월 (3월과 1마이크로초 차이)');
select is(public.get_monthly_summary('2026-02') ->> 'topCategoryName', '치킨', '2월 대표 카테고리');
select is(public.get_monthly_summary('2026-04') - 'topCategoryName', '{"monthKey":"2026-04","orderCount":2,"deliveredAmount":11000,"largestOrderAmount":8000}'::jsonb,
  '4월: KST 4/1 00:00:00 포함, UTC로는 3월인 4/1 05시도 4월');
select is(public.get_monthly_summary('2026-04') ->> 'topCategoryName', '치킨', '4월 대표 카테고리');
select is((public.get_monthly_summary('2026-02') ->> 'orderCount')::int + (public.get_monthly_summary('2026-03') ->> 'orderCount')::int + (public.get_monthly_summary('2026-04') ->> 'orderCount')::int, 6,
  '인접한 세 달을 합치면 경계 주문이 중복 · 누락 없이 6건');

-- ---------------------------------------------------------------- 월간: 대표 카테고리 규칙
select is(public.get_monthly_summary('2026-05') ->> 'topCategoryName', '분식', '5월: 2건 대 2건 동률 → 더 최근 완료(5/20)의 분식');
select is((public.get_monthly_summary('2026-05') ->> 'orderCount')::int, 4, '5월 4건');
select is(public.get_monthly_summary('2026-06') ->> 'topCategoryName', '치킨', '6월: 횟수와 완료 시각이 모두 같으면 카테고리 코드 오름차순(zz-my-a)');
select is(public.get_monthly_summary('2026-07') ->> 'topCategoryName', '치킨', '7월: 주문 1건 = 1회 (분식은 줄이 3개지만 주문 2건 → 치킨 3건이 이긴다)');
select is((public.get_monthly_summary('2026-07') ->> 'orderCount')::int, 5, '7월 주문 5건');
select is((public.get_monthly_summary('2026-07') ->> 'deliveredAmount')::bigint, 3000::bigint + 15000 + 5000, '7월 금액 합계는 주문 금액(줄 합)의 합');
select is((public.get_monthly_summary('2026-07') ->> 'largestOrderAmount')::bigint, 15000::bigint, '7월 가장 큰 주문은 두 줄짜리 15000');
select is(public.get_monthly_summary('2026-08') ->> 'topCategoryName', '새이름', '8월: 같은 카테고리의 이름은 가장 최근 주문의 Snapshot 이름');

-- ---------------------------------------------------------------- 월간: 이번 달 · 제외 · 빈 달 · 격리
select is(public.get_monthly_summary(to_char(clock_timestamp() at time zone 'Asia/Seoul', 'YYYY-MM')) - 'monthKey' - 'topCategoryName',
  '{"orderCount":2,"deliveredAmount":3000,"largestOrderAmount":2000}'::jsonb, '이번 달: 완료 2건만 (PENDING · 취소는 건수와 금액에서 제외)');
select is(public.get_monthly_summary(to_char(clock_timestamp() at time zone 'Asia/Seoul', 'YYYY-MM')) ->> 'topCategoryName', '치킨', '이번 달 대표 카테고리');
select is(public.get_monthly_summary('2026-01'), '{"monthKey":"2026-01","orderCount":0,"deliveredAmount":0,"topCategoryName":null,"largestOrderAmount":null}'::jsonb,
  '빈 달: 건수 · 금액 0, 대표 카테고리 · 가장 큰 주문 null');
select is(public.get_monthly_summary('2026-09'), '{"monthKey":"2026-09","orderCount":0,"deliveredAmount":0,"topCategoryName":null,"largestOrderAmount":null}'::jsonb,
  '빈 달(9월): 주문을 만들기만 한 달이 아니라 완료한 달로 센다 (PENDING · 취소는 어느 달에도 들어가지 않는다)');
select is(public.get_monthly_summary('2000-01') ->> 'orderCount', '0', '가장 이른 허용 월(2000-01)은 빈 달로 성공');
select is(public.get_monthly_summary('2026-10') ->> 'deliveredAmount', '18014398509481982', '큰 금액: 안전 정수 최댓값 두 건의 합계를 정확히 계산한다 (잘림 · 반올림 없음)');
select is((public.get_monthly_summary('2026-10') ->> 'largestOrderAmount')::bigint, 9007199254740991::bigint, '큰 금액: 가장 큰 주문 9007199254740991');
select is(public.get_monthly_summary('2026-03') ->> 'orderCount', '3', '[A] 3월은 B의 3월 주문(7000)이 섞이지 않아 여전히 3건');
reset role;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is(public.get_monthly_summary('2026-03') - 'monthKey', '{"orderCount":1,"deliveredAmount":7000,"topCategoryName":"치킨","largestOrderAmount":7000}'::jsonb, '[B] B의 3월은 자기 주문 1건뿐');
select is(public.get_monthly_summary('2026-04') ->> 'orderCount', '0', '[B] B의 4월은 비어 있다 (A의 주문이 보이지 않는다)');
reset role;

-- ---------------------------------------------------------------- 월간: 입력 오류
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(public.zq($$select public.get_monthly_summary(null)$$), 'P0001:INVALID_INPUT', 'null');
select is(public.zq($$select public.get_monthly_summary('')$$), 'P0001:INVALID_INPUT', '빈 문자열');
select is(public.zq($$select public.get_monthly_summary('2026-13')$$), 'P0001:INVALID_INPUT', '2026-13 (월 13)');
select is(public.zq($$select public.get_monthly_summary('2026-00')$$), 'P0001:INVALID_INPUT', '2026-00 (월 0)');
select is(public.zq($$select public.get_monthly_summary('2026-1')$$), 'P0001:INVALID_INPUT', '2026-1 (한 자리 월)');
select is(public.zq($$select public.get_monthly_summary('26-01')$$), 'P0001:INVALID_INPUT', '26-01 (두 자리 연도)');
select is(public.zq($$select public.get_monthly_summary('202601')$$), 'P0001:INVALID_INPUT', '202601 (구분자 없음)');
select is(public.zq($$select public.get_monthly_summary('2026/01')$$), 'P0001:INVALID_INPUT', '2026/01 (다른 구분자)');
select is(public.zq($$select public.get_monthly_summary('2026-01-01')$$), 'P0001:INVALID_INPUT', '2026-01-01 (날짜 형식)');
select is(public.zq($$select public.get_monthly_summary(' 2026-03')$$), 'P0001:INVALID_INPUT', '앞 공백');
select is(public.zq($$select public.get_monthly_summary('2026-03 ')$$), 'P0001:INVALID_INPUT', '뒤 공백');
select is(public.zq(format('select public.get_monthly_summary(%L)', E'2026-03\n')), 'P0001:INVALID_INPUT', '뒤 줄바꿈');
select is(public.zq($$select public.get_monthly_summary('abcd-ef')$$), 'P0001:INVALID_INPUT', '숫자가 아님');
select is(public.zq($$select public.get_monthly_summary('x2026-03')$$), 'P0001:INVALID_INPUT', '앞에 문자가 붙으면 형식 오류 (오류 종류도 INVALID_INPUT)');
select is(public.zq($$select public.get_monthly_summary('02026-03')$$), 'P0001:INVALID_INPUT', '5자리 연도');
select is(public.zq($$select public.get_monthly_summary('２０２６-０３')$$), 'P0001:INVALID_INPUT', '전각 숫자');
select is(public.zq($$select public.get_monthly_summary('1999-12')$$), 'P0001:INVALID_INPUT', '연도 1999는 허용 범위(2000~2100) 밖');
select is(public.zq($$select public.get_monthly_summary('2000-01')$$), 'OK', '연도 2000은 허용');
select is(public.zq($$select public.get_monthly_summary('2101-01')$$), 'P0001:INVALID_INPUT', '연도 2101은 범위 밖');
select is(public.zq($$select public.get_monthly_summary('2100-12')$$), 'P0001:INVALID_INPUT', '2100-12는 형식상 맞지만 미래 월');
-- 미래 월 / 현재 월 (서버 시각 KST 기준)
select is(public.zq(format('select public.get_monthly_summary(%L)', to_char(clock_timestamp() at time zone 'Asia/Seoul' + interval '1 month', 'YYYY-MM'))), 'P0001:INVALID_INPUT', '다음 달은 미래 월 → INVALID_INPUT');
select is(public.zq(format('select public.get_monthly_summary(%L)', to_char(clock_timestamp() at time zone 'Asia/Seoul' + interval '1 year', 'YYYY-MM'))), 'P0001:INVALID_INPUT', '내년 같은 달도 미래 월');
select is(public.zq(format('select public.get_monthly_summary(%L)', to_char(clock_timestamp() at time zone 'Asia/Seoul', 'YYYY-MM'))), 'OK', '이번 달은 허용');
select is(public.zq(format('select public.get_monthly_summary(%L)', to_char(clock_timestamp() at time zone 'Asia/Seoul' - interval '1 month', 'YYYY-MM'))), 'OK', '지난달은 허용');
reset role;

-- ---------------------------------------------------------------- 누적
select set_config('exp.cnt', (select count(*)::text from public.orders where user_id = 'aaaaaaaa-0000-4000-8000-000000000001' and status = 'USER_CONFIRMED'), true);
select set_config('exp.sum', (select sum(total_amount::numeric)::text from public.orders where user_id = 'aaaaaaaa-0000-4000-8000-000000000001' and status = 'USER_CONFIRMED'), true);
set local role authenticated;
select set_config('zz.cum', public.get_my_cumulative_summary()::text, true);
select is((select array_agg(k order by k) from jsonb_object_keys(current_setting('zz.cum')::jsonb) k), array['deliveredAmount', 'hasAnyOrder', 'orderCount'], '누적 응답 키: orderCount / deliveredAmount / hasAnyOrder');
select is(jsonb_typeof(current_setting('zz.cum')::jsonb -> 'orderCount'), 'number', 'orderCount는 숫자');
select is(jsonb_typeof(current_setting('zz.cum')::jsonb -> 'deliveredAmount'), 'number', 'deliveredAmount는 숫자');
select is(jsonb_typeof(current_setting('zz.cum')::jsonb -> 'hasAnyOrder'), 'boolean', 'hasAnyOrder는 boolean');
select is(current_setting('zz.cum')::jsonb ->> 'orderCount', current_setting('exp.cnt'), '[A] 누적 건수 = 완료(USER_CONFIRMED) 주문 전체 (기간 제한 없음)');
select is(current_setting('zz.cum')::jsonb ->> 'deliveredAmount', current_setting('exp.sum'), '[A] 누적 금액 = 서버 확정 금액 합계 (큰 금액 포함 정확히)');
select is(current_setting('zz.cum')::jsonb -> 'hasAnyOrder', 'true'::jsonb, '[A] 주문이 있으면 hasAnyOrder true');
reset role;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is(public.get_my_cumulative_summary(), '{"orderCount":1,"deliveredAmount":7000,"hasAnyOrder":true}'::jsonb, '[B] 누적은 자기 주문만');
reset role;
select set_config('request.jwt.claims', '{"sub":"dddddddd-0000-4000-8000-000000000004","role":"authenticated"}', true);
set local role authenticated;
select is(public.get_my_cumulative_summary(), '{"orderCount":0,"deliveredAmount":0,"hasAnyOrder":true}'::jsonb, '[D] PENDING만 있으면 건수 · 금액 0이지만 hasAnyOrder true');
select is(public.get_monthly_summary(to_char(clock_timestamp() at time zone 'Asia/Seoul', 'YYYY-MM')) ->> 'orderCount', '0', '[D] 이번 달 요약에도 PENDING은 들어가지 않는다');
reset role;
select set_config('request.jwt.claims', '{"sub":"ffffffff-0000-4000-8000-000000000006","role":"authenticated"}', true);
set local role authenticated;
select is(public.get_my_cumulative_summary(), '{"orderCount":0,"deliveredAmount":0,"hasAnyOrder":true}'::jsonb, '[F] 취소만 있어도 hasAnyOrder true (Zero State 판단은 상태와 무관)');
reset role;
select set_config('request.jwt.claims', '{"sub":"eeeeeeee-0000-4000-8000-000000000005","role":"authenticated"}', true);
set local role authenticated;
select is(public.get_my_cumulative_summary(), '{"orderCount":0,"deliveredAmount":0,"hasAnyOrder":false}'::jsonb, '[E] 주문이 하나도 없으면 hasAnyOrder false');
select is(public.get_monthly_summary('2026-03'), '{"monthKey":"2026-03","orderCount":0,"deliveredAmount":0,"topCategoryName":null,"largestOrderAmount":null}'::jsonb, '[E] 주문이 없는 사용자의 월간 요약은 빈 달');
reset role;

-- 완료 확인 시각이 같아도 취소 · PENDING은 어느 쪽에도 들어가지 않는다 (누적 건수가 완료 주문 수와 같다)
select is((select count(*)::int from public.orders where user_id = 'aaaaaaaa-0000-4000-8000-000000000001' and status = 'USER_CONFIRMED'), (select count(*)::int from public.orders where user_id = 'aaaaaaaa-0000-4000-8000-000000000001') - 2,
  '(확인) A의 전체 주문에서 PENDING · 취소 2건을 뺀 수가 완료 주문 수');

select * from finish();
rollback;
