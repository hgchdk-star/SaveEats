-- 마이 요약: get_monthly_summary(월간) · get_my_cumulative_summary(누적)
-- 근거: PRD 40~42장, 기획서 23 · 37, 개발 명세 HIST-004 · DB-009 · API 표, 계약 초안 my-summary-contract-draft.md (저장소 밖).
-- orders_create · orders_transitions의 테이블을 그대로 쓰는 읽기 전용 집계다. 값을 따로 저장하지 않는다.
--
-- 함수 (이름과 인자 이름)
--   get_monthly_summary(p_month_key text)  → { monthKey, orderCount, deliveredAmount, topCategoryName, largestOrderAmount }
--   get_my_cumulative_summary()            → { orderCount, deliveredAmount, hasAnyOrder }
--   둘 다 SECURITY INVOKER + RLS: 앱(authenticated)은 이미 orders의 필요한 열(status, completed_at, total_amount, 카테고리 Snapshot)을
--   본인 행 정책으로 읽을 수 있어서 DEFINER가 필요 없다. 로그인 없음은 AUTH_REQUIRED, anon은 실행 권한이 없다(42501).
--
-- 월간 규칙
--   월 = p_month_key 'YYYY-MM'(KST). 대상 = 본인의 USER_CONFIRMED 주문 중 completed_at이 그 달 KST 반열린 구간
--        [그 달 1일 00:00 KST, 다음 달 1일 00:00 KST)에 드는 것. PENDING · CANCELLED는 건수와 금액 어디에도 넣지 않는다.
--   orderCount / deliveredAmount = 대상 주문 수 / 서버 확정 금액(total_amount) 합계. 대상이 없으면 0 / 0.
--        deliveredAmount는 실제 송금이 확인된 금액이 아니라 "완료 확인한 주문의 서버 확정 금액 합계"다.
--   topCategoryName = 주문 Snapshot 카테고리(category_code_snapshot)별 주문 횟수(주문 1건 = 1회)가 가장 많은 카테고리의 이름.
--        동률이면 그 카테고리 주문 중 가장 최근 completed_at이 큰 쪽, 그래도 같으면 category_code_snapshot 오름차순.
--        이름은 그 카테고리의 가장 최근 완료 주문에 기록된 Snapshot 이름. 대상이 없으면 null.
--   largestOrderAmount = 대상 주문 중 서버 확정 금액의 최댓값. 대상이 없으면 null.
--   입력 오류 = p_month_key가 null이거나 'YYYY-MM' 형식이 아니거나(월 01~12), 연도가 2000~2100 밖이거나, 현재 KST 월보다 뒤(미래 월)면 INVALID_INPUT.
--        현재 월과 과거 월은 허용한다. 현재 월 판단은 서버 시각으로만 한다.
--
-- 누적 규칙
--   orderCount / deliveredAmount = 본인의 USER_CONFIRMED 주문 전체의 수 / 서버 확정 금액 합계(기간 제한 없음). 없으면 0 / 0.
--   hasAnyOrder = 상태와 상관없이 본인 주문이 하나라도 있는가(PENDING · CANCELLED 포함). Zero State 판단용.
--   금융 지표나 그 밖의 누적 지표는 넣지 않는다(PRD FR-STAT-011 · 012).

create function public.get_monthly_summary(p_month_key text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_year integer;
  v_month_start date;
  v_from timestamptz;
  v_to timestamptz;
  v_count bigint;
  v_amount numeric;
  v_largest bigint;
  v_top text;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;
  if p_month_key is null or p_month_key !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;

  v_year := substr(p_month_key, 1, 4)::integer;
  if v_year < 2000 or v_year > 2100 then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;

  v_month_start := (p_month_key || '-01')::date;
  -- 미래 월은 거절한다 (현재 KST 월은 허용)
  if v_month_start > date_trunc('month', clock_timestamp() at time zone 'Asia/Seoul')::date then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;

  v_from := v_month_start::timestamp at time zone 'Asia/Seoul';
  v_to := (v_month_start + interval '1 month')::timestamp at time zone 'Asia/Seoul';

  select count(*), coalesce(sum(o.total_amount::numeric), 0), max(o.total_amount)
    into v_count, v_amount, v_largest
  from public.orders o
  where o.user_id = v_uid
    and o.status = 'USER_CONFIRMED'
    and o.completed_at >= v_from and o.completed_at < v_to;

  select t.category_name
    into v_top
  from (
    select o.category_code_snapshot,
           count(*) as order_count,
           max(o.completed_at) as last_completed_at,
           (array_agg(o.category_name_snapshot order by o.completed_at desc, o.id desc))[1] as category_name
    from public.orders o
    where o.user_id = v_uid
      and o.status = 'USER_CONFIRMED'
      and o.completed_at >= v_from and o.completed_at < v_to
    group by o.category_code_snapshot
    order by order_count desc, last_completed_at desc, o.category_code_snapshot asc
    limit 1
  ) t;

  return jsonb_build_object(
    'monthKey', p_month_key,
    'orderCount', v_count,
    'deliveredAmount', v_amount,
    'topCategoryName', v_top,
    'largestOrderAmount', v_largest
  );
end;
$$;

create function public.get_my_cumulative_summary()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_count bigint;
  v_amount numeric;
  v_any boolean;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  select count(*), coalesce(sum(o.total_amount::numeric), 0)
    into v_count, v_amount
  from public.orders o
  where o.user_id = v_uid and o.status = 'USER_CONFIRMED';

  select exists (select 1 from public.orders o where o.user_id = v_uid) into v_any;

  return jsonb_build_object(
    'orderCount', v_count,
    'deliveredAmount', v_amount,
    'hasAnyOrder', v_any
  );
end;
$$;

revoke execute on function public.get_monthly_summary(text) from public, anon, authenticated;
revoke execute on function public.get_my_cumulative_summary() from public, anon, authenticated;
grant execute on function public.get_monthly_summary(text) to authenticated;
grant execute on function public.get_my_cumulative_summary() to authenticated;
