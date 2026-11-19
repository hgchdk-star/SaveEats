-- 옵션 그룹 수량 합계 제한: menu_option_groups.max_total_quantity
-- 근거: 서정 결정(2026-11-19) — 도미노피자 '음료 (최대 2개 가능)' 그룹은 음료 수량 합계를 최대 2개로 한다.
--       이것은 SaveEats의 이번 제품 결정이다. 쿠팡이츠에서 실제 동작을 확인한 사실이 아니다. 원본 값(그룹 최대 2, 옵션당 최대 2)은 내부 기록에 따로 남긴다.
--
-- 규칙
--   1) 기존 min_select · max_select는 그대로 '고른 옵션 종류 수'다. 이 변경으로 기존 그룹의 의미를 수량 합계로 바꾸지 않는다.
--   2) max_total_quantity는 선택 열이다(null = 제한 없음 = 기존 동작). 값이 있으면 그 그룹에서 고른 옵션들의 수량 합계가 이 값을 넘을 수 없다.
--      예: 합계 2 → 콜라 2개, 콜라 1 + 사이다 1은 가능, 콜라 2 + 사이다 1은 불가.
--   3) 주문(create_order → private.validate_order_catalog)에서 합계가 넘으면 INVALID_OPTIONS로 거절한다. 조용히 줄이지 않는다.
--   4) get_menu의 optionGroups[]에 maxTotalQuantity(숫자 또는 null)를 추가한다. 기존 키는 그대로다(구형 앱은 새 키를 무시한다).
--   5) 구형 요청·기존 주문 Snapshot·다른 가게는 영향이 없다(null이면 검증이 늘지 않는다).

alter table public.menu_option_groups
  add column max_total_quantity integer;

alter table public.menu_option_groups
  add constraint menu_option_groups_total_quantity_check check (max_total_quantity is null or max_total_quantity >= 1);

grant select (max_total_quantity) on public.menu_option_groups to anon, authenticated;

create or replace function private.validate_order_catalog(p_store_id uuid, p_lines jsonb, p_approved_total bigint, p_lock boolean default true)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_cat uuid;
  v_store record;
  v_category record;
  v_menu_ids uuid[];
  v_option_ids uuid[];
  v_count integer;
  r record;
  v_opts jsonb;
  v_opt_total numeric;
  v_unit numeric;
  v_line_total numeric;
  v_total numeric := 0;
  v_out jsonb := '[]'::jsonb;
begin
  -- 가게 · 분류 (분류 → 가게 순으로 잠금)
  select s.category_id into v_cat from public.stores s where s.id = p_store_id;
  if not found then
    perform private.fail('INVALID_INPUT');
  end if;
  if p_lock then
    perform 1 from public.categories c where c.id = v_cat for share;
    perform 1 from public.stores s where s.id = p_store_id for share;
  end if;
  select s.* into v_store from public.stores s where s.id = p_store_id;
  if p_lock and v_store.category_id is distinct from v_cat then
    perform 1 from public.categories c where c.id = v_store.category_id for share;
  end if;
  select c.* into v_category from public.categories c where c.id = v_store.category_id;

  select coalesce(array_agg(distinct l.menu_id order by l.menu_id), '{}') into v_menu_ids from private.order_lines(p_lines) l;
  select coalesce(array_agg(distinct lo.option_id order by lo.option_id), '{}') into v_option_ids from private.order_line_options_q(p_lines) lo;

  -- 메뉴(id 순) → 그룹(id 순) → 옵션(id 순)
  if p_lock then
    perform 1 from public.menus m where m.id = any (v_menu_ids) order by m.id for share;
    perform 1 from public.menu_option_groups g where g.menu_id = any (v_menu_ids) order by g.id for share;
    perform 1 from public.menu_options o where o.id = any (v_option_ids) order by o.id for share;
  end if;

  -- 존재 · 소속 (INVALID_INPUT)
  select count(*) into v_count from public.menus m where m.id = any (v_menu_ids) and m.store_id = p_store_id;
  if v_count <> cardinality(v_menu_ids) then
    perform private.fail('INVALID_INPUT');
  end if;
  if exists (
    select 1
    from private.order_line_options_q(p_lines) lo
    left join public.menu_options o on o.id = lo.option_id
    left join public.menu_option_groups g on g.id = o.group_id
    where o.id is null or g.menu_id <> lo.menu_id
  ) then
    perform private.fail('INVALID_INPUT');
  end if;

  -- 가게 · 분류 비활성 (ITEM_UNAVAILABLE) → 영업 종료 (STORE_CLOSED)
  if not v_store.is_active or not v_category.is_active then
    perform private.fail('ITEM_UNAVAILABLE');
  end if;
  if not v_store.is_open then
    perform private.fail('STORE_CLOSED');
  end if;

  -- 메뉴 · 그룹 · 옵션 비활성 · 품절 (ITEM_UNAVAILABLE)
  if exists (select 1 from public.menus m where m.id = any (v_menu_ids) and (not m.is_active or m.is_sold_out)) then
    perform private.fail('ITEM_UNAVAILABLE');
  end if;
  if exists (
    select 1
    from private.order_line_options_q(p_lines) lo
    join public.menu_options o on o.id = lo.option_id
    join public.menu_option_groups g on g.id = o.group_id
    where not g.is_active or not o.is_active or o.is_sold_out
  ) then
    perform private.fail('ITEM_UNAVAILABLE');
  end if;

  -- 옵션 수량: 수량을 허용하지 않는 옵션은 1개만, 허용하는 옵션은 1 ~ max_quantity (INVALID_OPTIONS)
  if exists (
    select 1
    from private.order_line_options_q(p_lines) lo
    join public.menu_options o on o.id = lo.option_id
    where lo.qty < 1
       or (not o.allow_quantity and lo.qty <> 1)
       or (o.allow_quantity and lo.qty > o.max_quantity)
  ) then
    perform private.fail('INVALID_OPTIONS');
  end if;

  -- 선택 규칙: 활성 그룹마다 '고른 옵션 종류 수'가 min_select ~ max_select (INVALID_OPTIONS). 수량 합계가 아니다
  if exists (
    select 1
    from private.order_lines(p_lines) l
    join public.menu_option_groups g on g.menu_id = l.menu_id and g.is_active
    where (
      select count(*)
      from private.order_line_options_q(p_lines) lo
      join public.menu_options o on o.id = lo.option_id
      where lo.ord = l.ord and o.group_id = g.id
    ) not between g.min_select and g.max_select
  ) then
    perform private.fail('INVALID_OPTIONS');
  end if;

  -- 그룹 수량 합계 제한(선택, menu_option_groups.max_total_quantity): 활성 그룹의 옵션 수량 합계가 제한을 넘으면 거절한다 (INVALID_OPTIONS).
  -- 초과 수량을 조용히 줄이지 않는다. 제한이 없는(null) 그룹은 이 규칙이 없다(기존 동작 그대로).
  if exists (
    select 1
    from private.order_lines(p_lines) l
    join public.menu_option_groups g on g.menu_id = l.menu_id and g.is_active and g.max_total_quantity is not null
    where (
      select coalesce(sum(lo.qty), 0)
      from private.order_line_options_q(p_lines) lo
      join public.menu_options o on o.id = lo.option_id
      where lo.ord = l.ord and o.group_id = g.id
    ) > g.max_total_quantity
  ) then
    perform private.fail('INVALID_OPTIONS');
  end if;

  -- 가격 재계산 (PRICE_CHANGED): 줄 단가 = 기본가 + Σ(옵션 추가금 × 옵션 수량), 총액 = 줄 합계의 합
  for r in
    select l.ord, l.menu_id, l.qty, l.approved_unit_price, m.name, m.image_ref, m.base_price
    from private.order_lines(p_lines) l
    join public.menus m on m.id = l.menu_id
    order by l.ord
  loop
    select coalesce(jsonb_agg(jsonb_build_object(
             'groupId', g.id, 'optionId', o.id, 'groupName', g.name, 'optionName', o.name,
             'additionalPrice', o.additional_price, 'quantity', lo.qty
           ) order by g.sort_order, g.id, o.sort_order, o.id), '[]'::jsonb),
           coalesce(sum(o.additional_price::numeric * lo.qty), 0)
      into v_opts, v_opt_total
    from private.order_line_options_q(p_lines) lo
    join public.menu_options o on o.id = lo.option_id
    join public.menu_option_groups g on g.id = o.group_id
    where lo.ord = r.ord;

    v_unit := r.base_price::numeric + v_opt_total;
    if v_unit <> r.approved_unit_price::numeric then
      perform private.fail('PRICE_CHANGED');
    end if;
    v_line_total := v_unit * r.qty;
    v_total := v_total + v_line_total;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'menuId', r.menu_id,
      'menuName', r.name,
      'menuImageRef', r.image_ref,
      'basePrice', r.base_price,
      'optionTotal', v_opt_total,
      'unitPrice', v_unit,
      'quantity', r.qty,
      'lineTotal', v_line_total,
      'options', v_opts
    ));
  end loop;

  if v_total <> p_approved_total::numeric then
    perform private.fail('PRICE_CHANGED');
  end if;

  return jsonb_build_object(
    'store', jsonb_build_object(
      'id', v_store.id, 'name', v_store.name, 'imageRef', v_store.image_ref,
      'categoryCode', v_category.code, 'categoryName', v_category.name
    ),
    'total', v_total,
    'lines', v_out
  );
end;
$$;

create or replace function public.get_menu(p_menu_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_menu jsonb;
begin
  select jsonb_build_object(
    'id', m.id,
    'storeId', m.store_id,
    'storeIsOpen', s.is_open,
    'name', m.name,
    'description', m.description,
    'imageRef', m.image_ref,
    'price', m.base_price,
    'catalogRevision', m.catalog_revision,
    'isSoldOut', m.is_sold_out,
    'optionGroups', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', g.id,
          'name', g.name,
          'minSelect', g.min_select,
          'maxSelect', g.max_select,
          'maxTotalQuantity', g.max_total_quantity,
          'options', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', o.id,
                'name', o.name,
                'additionalPrice', o.additional_price,
                'isSoldOut', o.is_sold_out,
                'allowQuantity', o.allow_quantity,
                'maxQuantity', o.max_quantity
              )
              order by o.sort_order, o.id
            )
            from public.menu_options o
            where o.group_id = g.id
          ), '[]'::jsonb)
        )
        order by g.sort_order, g.id
      )
      from public.menu_option_groups g
      where g.menu_id = m.id
    ), '[]'::jsonb)
  )
  into v_menu
  from public.menus m
  join public.stores s on s.id = m.store_id
  where m.id = p_menu_id;

  if v_menu is null then
    raise exception using errcode = 'P0001', message = 'RESOURCE_NOT_FOUND';
  end if;
  return v_menu;
end;
$$;
