-- 주문 응답의 옵션에 주문 당시 원본 식별자(groupId, optionId)를 더한다.
-- 이유: 내역의 '같은 주문 담기'가 지난 주문과 같은 옵션을 지금 메뉴에서 찾으려면 식별자가 필요하다. 지금은 이름·가격·수량만 내려가
--       (식별자는 order_item_options.source_group_id · source_option_id에 이미 저장돼 있다) 앱이 이름으로 추측하는 수밖에 없다.
-- 범위: get_my_order(create or replace, signature·권한·정렬 그대로)의 snapshot.items[].options[]에 키 두 개만 추가한다.
--       get_my_history_order·list_my_orders·create_order 응답은 get_my_order를 거치므로 같이 바뀐다. 기존 키와 값은 그대로이고, 앱은 새 키가 없어도 동작한다.
--       주문 테이블·스냅샷 값은 바꾸지 않는다. 옛 주문도 source_*_id가 not null이라 모두 식별자가 있다.

create or replace function public.get_my_order(p_order_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_result jsonb;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;
  if p_order_id is null then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;

  select jsonb_build_object(
    'orderId', o.id,
    'status', o.status,
    'statusRevision', o.status_revision,
    'createdAt', o.created_at,
    'completedAt', o.completed_at,
    'cancelledAt', o.cancelled_at,
    'totalAmount', o.total_amount,
    'snapshot', jsonb_build_object(
      'store', jsonb_build_object(
        'id', o.store_id,
        'name', o.store_name_snapshot,
        'imageRef', o.store_image_snapshot,
        'categoryName', o.category_name_snapshot
      ),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'menuId', i.menu_id,
                 'menuName', i.menu_name_snapshot,
                 'menuImageRef', i.menu_image_snapshot,
                 'unitPrice', i.unit_price,
                 'quantity', i.quantity,
                 'lineTotal', i.line_total,
                 'options', coalesce((
                   select jsonb_agg(jsonb_build_object(
                            'groupId', x.source_group_id,
                            'optionId', x.source_option_id,
                            'groupName', x.group_name_snapshot,
                            'optionName', x.option_name_snapshot,
                            'additionalPrice', x.additional_price_snapshot,
                            'quantity', x.quantity_snapshot
                          ) order by x.sort_order)
                   from public.order_item_options x
                   where x.order_item_id = i.id
                 ), '[]'::jsonb)
               ) order by i.line_no)
        from public.order_items i
        where i.order_id = o.id
      ), '[]'::jsonb)
    )
  )
  into v_result
  from public.orders o
  where o.id = p_order_id and o.user_id = v_uid;

  if v_result is null then
    raise exception using errcode = 'P0001', message = 'RESOURCE_NOT_FOUND';
  end if;
  return v_result;
end;
$$;
