-- 내역: 목록 · 단건 · 안 읽은 요약 · 읽음 처리
-- 근거: 개발 명세 HIST-001~008 · DB-007, 팀 결정 (2026-11-05 U1~U8), 지우 앱 파서 order-dto.ts (PR #50 브랜치).
-- orders_create · orders_transitions의 테이블을 그대로 쓴다. 리뷰 서버 범위(reviewEligibility)는 이 migration에 없다.
--
-- 함수 (이름과 인자 이름)
--   list_my_orders(p_cursor text, p_page_size integer)         → { items, hasMore, nextCursor }        INVOKER
--   get_my_history_order(p_order_id uuid)                      → 내역 행 하나 (list_my_orders의 items 원소와 같은 모양)  INVOKER
--   get_my_history_unread_summary()                            → { unreadEvents[{eventId, orderId, revision}], unreadOrderCount, asOf }  INVOKER
--   mark_status_updates_viewed(p_event_ids uuid[])             → { acknowledgedEventIds }              DEFINER
--
-- 내역 행 = get_my_order의 주문 DTO(같은 키, replayed 없음) + unreadUpdates + validCurrentMenuRefs.
--   reviewEligibility 키는 넣지 않는다. 키가 없다는 것을 '작성 자격 없음'으로 해석하지 않는다(리뷰 서버 PR에서 추가).
--   unreadUpdates[{eventId, revision, createdAt}]
--     = 본인 주문의 order_status_updates 중 viewed_at이 NULL인 모든 행. 생성 이력(revision 1)과 사용자가 직접 누른 완료·취소도 포함한다.
--       서버는 구분하지 않는다(점을 달지는 앱이 정한다). eventId = order_status_updates.id, revision 오름차순.
--   validCurrentMenuRefs[menuId]
--     = 주문 줄의 메뉴 중 지금 카탈로그 RLS로 보이는 것(메뉴 · 가게 · 분류가 활성인 체인). 품절 · 영업 종료도 포함하고,
--       비활성이거나 사라진 것만 제외한다. 같은 메뉴는 한 번만, 주문 줄 순서대로.
--
-- 목록
--   인자 = p_page_size 1~50(기본 20, 밖이면 INVALID_INPUT), p_cursor(불투명 텍스트, base64 JSON {createdAt, orderId}; 잘못되면 INVALID_INPUT).
--   정렬 = created_at 내림차순 → id 내림차순 keyset. 커서는 소유권의 대체물이 아니다(본인 주문만 조회).
--   행마다 get_my_history_order를 부른다(INVOKER 함수는 private 함수를 부를 수 없고, DTO 로직을 한 곳에 두려는 선택. 페이지당 최대 50번).
--
-- 읽음 처리
--   mark_status_updates_viewed: 정확히 그 이벤트 ID만, 최초 읽은 시각만 저장(이미 읽은 것은 그대로).
--   100개 초과나 null 원소는 INVALID_INPUT, 빈 배열은 성공 no-op. 타인 이벤트나 없는 ID가 하나라도 섞이면 전체 RESOURCE_NOT_FOUND(아무것도 바꾸지 않음).
--   행을 id 순으로 잠가 동시 호출끼리 교착하지 않고, 같은 ID를 동시에 보내도 먼저 커밋한 시각이 남는다.
--   앱에는 이력 UPDATE 권한이 없어서 DEFINER이고, 대상은 auth.uid() 소유 주문의 이벤트뿐이다.

-- ---------------------------------------------------------------------------
-- get_my_history_order(p_order_id) → 내역 행 하나
-- ---------------------------------------------------------------------------

create function public.get_my_history_order(p_order_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_order jsonb;
  v_unread jsonb;
  v_menus jsonb;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;
  if p_order_id is null then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;

  -- 없거나 남의 주문이면 RESOURCE_NOT_FOUND (get_my_order가 던진다)
  v_order := public.get_my_order(p_order_id);

  select coalesce(jsonb_agg(jsonb_build_object(
           'eventId', u.id,
           'revision', u.revision,
           'createdAt', u.created_at
         ) order by u.revision), '[]'::jsonb)
    into v_unread
  from public.order_status_updates u
  join public.orders o on o.id = u.order_id
  where u.order_id = p_order_id and o.user_id = v_uid and u.viewed_at is null;

  -- 메뉴 · 가게 · 분류가 지금도 앱에서 열리는 것만 (카탈로그 RLS가 걸러 준다)
  select coalesce(jsonb_agg(x.menu_id order by x.first_line), '[]'::jsonb)
    into v_menus
  from (
    select i.menu_id, min(i.line_no) as first_line
    from public.order_items i
    join public.menus m on m.id = i.menu_id
    where i.order_id = p_order_id
    group by i.menu_id
  ) x;

  return v_order || jsonb_build_object('unreadUpdates', v_unread, 'validCurrentMenuRefs', v_menus);
end;
$$;

-- ---------------------------------------------------------------------------
-- list_my_orders(p_cursor, p_page_size) → { items, hasMore, nextCursor }
-- ---------------------------------------------------------------------------

create function public.list_my_orders(
  p_cursor text default null,
  p_page_size integer default 20
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_page_size integer := coalesce(p_page_size, 20);
  v_cursor jsonb;
  v_after_at timestamptz;
  v_after_id uuid;
  v_ids uuid[];
  v_ats timestamptz[];
  v_count integer;
  v_has_more boolean;
  v_items jsonb := '[]'::jsonb;
  v_next_cursor text;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;
  if v_page_size < 1 or v_page_size > 50 then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT',
      detail = 'pageSize must be between 1 and 50';
  end if;

  if p_cursor is not null then
    begin
      v_cursor := convert_from(decode(p_cursor, 'base64'), 'UTF8')::jsonb;
      if jsonb_typeof(v_cursor) = 'object' then
        v_after_at := (v_cursor ->> 'createdAt')::timestamptz;
        v_after_id := (v_cursor ->> 'orderId')::uuid;
      end if;
    exception when others then
      v_after_at := null;
      v_after_id := null;
    end;
    if v_after_at is null or v_after_id is null then
      raise exception using errcode = 'P0001', message = 'INVALID_INPUT',
        detail = 'invalid cursor';
    end if;
  end if;

  -- 한 건 더 읽어 hasMore를 정한다
  select array_agg(x.id order by x.created_at desc, x.id desc),
         array_agg(x.created_at order by x.created_at desc, x.id desc)
    into v_ids, v_ats
  from (
    select o.id, o.created_at
    from public.orders o
    where o.user_id = v_uid
      and (v_after_id is null or (o.created_at, o.id) < (v_after_at, v_after_id))
    order by o.created_at desc, o.id desc
    limit v_page_size + 1
  ) x;

  v_count := coalesce(cardinality(v_ids), 0);
  v_has_more := v_count > v_page_size;
  if v_has_more then
    v_ids := v_ids[1:v_page_size];
    v_ats := v_ats[1:v_page_size];
  end if;

  if cardinality(v_ids) > 0 then
    select coalesce(jsonb_agg(public.get_my_history_order(t.id) order by t.ord), '[]'::jsonb)
      into v_items
    from unnest(v_ids) with ordinality as t (id, ord);
  end if;

  if v_has_more then
    -- encode()는 76자마다 줄바꿈을 넣으므로 제거한다. 시각은 마이크로초까지 담는다.
    v_next_cursor := translate(encode(convert_to(
      jsonb_build_object(
        'createdAt', to_char(v_ats[cardinality(v_ats)] at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'orderId', v_ids[cardinality(v_ids)]
      )::text, 'UTF8'), 'base64'), E'\n', '');
  end if;

  return jsonb_build_object(
    'items', v_items,
    'hasMore', v_has_more,
    'nextCursor', v_next_cursor
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- get_my_history_unread_summary() → 내역 탭 점의 기준: 모든 본인 주문의 안 읽은 이벤트
-- ---------------------------------------------------------------------------

create function public.get_my_history_unread_summary()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_events jsonb;
  v_orders integer;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'eventId', u.id,
           'orderId', u.order_id,
           'revision', u.revision
         ) order by o.created_at desc, o.id desc, u.revision), '[]'::jsonb),
         count(distinct u.order_id)::integer
    into v_events, v_orders
  from public.order_status_updates u
  join public.orders o on o.id = u.order_id
  where o.user_id = v_uid and u.viewed_at is null;

  return jsonb_build_object(
    'unreadEvents', v_events,
    'unreadOrderCount', v_orders,
    'asOf', clock_timestamp()
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- mark_status_updates_viewed(p_event_ids) → { acknowledgedEventIds }
-- ---------------------------------------------------------------------------

create function public.mark_status_updates_viewed(p_event_ids uuid[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_ids uuid[];
  v_found integer;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;
  if p_event_ids is null or cardinality(p_event_ids) > 100 then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;
  if exists (select 1 from unnest(p_event_ids) e where e is null) then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;
  if cardinality(p_event_ids) = 0 then
    return jsonb_build_object('acknowledgedEventIds', '[]'::jsonb);
  end if;

  -- 중복은 한 번만, 처음 나온 순서로
  select array_agg(d.e order by d.first_ord) into v_ids
  from (
    select t.e, min(t.ord) as first_ord
    from unnest(p_event_ids) with ordinality as t (e, ord)
    group by t.e
  ) d;

  -- 본인 주문의 이벤트인지 확인하면서 id 순으로 잠근다. 하나라도 아니면 전체 거절(존재 여부를 알려 주지 않는다)
  select count(*) into v_found
  from (
    select u.id
    from public.order_status_updates u
    join public.orders o on o.id = u.order_id
    where u.id = any (v_ids) and o.user_id = v_uid
    order by u.id
    for update of u
  ) locked;
  if v_found <> cardinality(v_ids) then
    raise exception using errcode = 'P0001', message = 'RESOURCE_NOT_FOUND';
  end if;

  -- 최초 읽은 시각만 남긴다 (이미 읽은 이벤트는 그대로). 클라이언트 시각은 받지 않는다.
  update public.order_status_updates
  set viewed_at = clock_timestamp()
  where id = any (v_ids) and viewed_at is null;

  return jsonb_build_object('acknowledgedEventIds', to_jsonb(v_ids));
end;
$$;

revoke execute on function public.get_my_history_order(uuid) from public, anon, authenticated;
revoke execute on function public.list_my_orders(text, integer) from public, anon, authenticated;
revoke execute on function public.get_my_history_unread_summary() from public, anon, authenticated;
revoke execute on function public.mark_status_updates_viewed(uuid[]) from public, anon, authenticated;
grant execute on function public.get_my_history_order(uuid) to authenticated;
grant execute on function public.list_my_orders(text, integer) to authenticated;
grant execute on function public.get_my_history_unread_summary() to authenticated;
grant execute on function public.mark_status_updates_viewed(uuid[]) to authenticated;
