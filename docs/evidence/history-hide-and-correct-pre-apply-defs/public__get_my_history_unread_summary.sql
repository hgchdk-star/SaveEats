
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
