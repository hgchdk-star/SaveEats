
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
