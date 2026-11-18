
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

  return v_order || jsonb_build_object(
    'unreadUpdates', v_unread,
    'validCurrentMenuRefs', v_menus,
    'reviewEligibility', public.get_review_eligibility(p_order_id)
  );
end;
