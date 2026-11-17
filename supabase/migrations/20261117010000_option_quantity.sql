-- 옵션별 수량: 같은 옵션을 여러 개 고르고, 고른 수량만큼 추가금을 계산한다.
-- 가격 = (메뉴 기본금액 + Σ(옵션 추가금 × 옵션 수량)) × 메뉴 주문 수량.  옵션 수량 = '메뉴 한 개에 들어가는 옵션 개수'.
--
-- 규칙 (결정이 필요한 항목은 맨 아래 "미결정"):
--   1) 옵션 행: allow_quantity(기본 false)와 max_quantity. 수량을 허용하는 옵션은 max_quantity를 반드시 정한다(원본 값을 자동으로 쓰지 않는다).
--      허용하지 않는 옵션은 기존처럼 1개만 고를 수 있다. 안 고른 것과 고른 수량을 구분한다: 안 고른 옵션은 요청에 없고, 요청의 수량은 1 이상이다.
--   2) 그룹 min_select/max_select는 기존대로 '고른 옵션 종류 수'다(수량 합계가 아니다). 이번 migration이 의미를 바꾸지 않는다.
--   3) 요청: requestVersion=2는 기존 모양 그대로 items[].optionIds (각 옵션 수량 1). requestVersion=3은 items[].options[{optionId, quantity}] 만 받는다.
--      v2에 options, v3에 optionIds를 보내면 INVALID_INPUT. 같은 옵션을 두 번 보내면(어느 버전이든) INVALID_INPUT이라 항목을 나눠 수량 제한을 우회할 수 없다.
--      같은 (메뉴, 옵션, 옵션 수량) 줄은 합산(기존 규칙, 합산 10 초과는 QUANTITY_LIMIT_EXCEEDED). 옵션 수량이 다르면 다른 줄이다.
--   4) 수량 위반(허용 안 함인데 2개 이상, max_quantity 초과)은 INVALID_OPTIONS. 음수·0·소수·숫자 아님은 INVALID_INPUT.
--   5) 요청 지문: 모든 옵션 수량이 1이면 이전과 같은 값이다(이미 저장된 주문의 재시도가 충돌하지 않는다).
--   6) 주문 Snapshot: order_item_options.quantity_snapshot(기본 1). 이미 있는 행은 1로 읽히고, 과거 주문의 금액·선택은 다시 계산하지 않는다.
--   7) get_menu: 옵션에 allowQuantity, maxQuantity를 더한다. get_my_order: 옵션에 quantity를 더한다(키 추가만 있고 기존 키는 그대로).
--
-- 미결정 (정책 문서에 근거가 없어 임의로 정하지 않았다):
--   - 옵션 수량의 앱 허용 상한. 원본(쿠팡이츠) max_quantity=1000을 그대로 쓰지 않는다. max_quantity는 옵션마다 데이터로 정한다.
--   - 그룹 min/max를 '수량 합계'로 바꿀지. 지금은 종류 수다.
-- 이미 적용된 migration과 seed.sql은 고치지 않았다.

-- ---------------------------------------------------------------------------
-- 옵션 행: 수량 허용 여부와 상한
-- ---------------------------------------------------------------------------
alter table public.menu_options
  add column allow_quantity boolean not null default false,
  add column max_quantity integer;

alter table public.menu_options
  add constraint menu_options_quantity_check check (
    (allow_quantity = false and max_quantity is null)
    or (allow_quantity = true and max_quantity is not null and max_quantity >= 1)
  );

grant select (allow_quantity, max_quantity) on public.menu_options to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 주문 Snapshot: 옵션 수량 (이미 있는 행은 1)
-- ---------------------------------------------------------------------------
alter table public.order_item_options
  add column quantity_snapshot integer not null default 1 check (quantity_snapshot >= 1);

-- ---------------------------------------------------------------------------
-- 정규화된 줄 → (순번, 메뉴, 옵션, 옵션 수량) 한 옵션당 한 행. optionQuantities가 없으면 모두 1
-- ---------------------------------------------------------------------------
create function private.order_line_options_q(p_lines jsonb)
returns table (ord integer, menu_id uuid, option_id uuid, qty integer)
language sql
immutable
set search_path = ''
as $$
  select t.ord::integer,
         (t.e ->> 'menuId')::uuid,
         o.option_id,
         coalesce((t.e -> 'optionQuantities' ->> (o.idx - 1)::integer)::integer, 1)
  from jsonb_array_elements(p_lines) with ordinality as t (e, ord)
  cross join lateral unnest(array(select x::uuid from jsonb_array_elements_text(t.e -> 'optionIds') x))
       with ordinality as o (option_id, idx);
$$;

-- ---------------------------------------------------------------------------
-- 요청 형태 검사 + 정규화 (requestVersion 2 · 3). DB를 읽지 않는다. 형태 문제는 모두 INVALID_INPUT.
-- 반환: { idempotencyKey, storeId, destinationRef, disclosureVersion, approvedTotalAmount,
--         lines[{menuId, optionIds(정렬), optionQuantities(optionIds와 같은 순서), quantity, approvedUnitPrice}] }
-- ---------------------------------------------------------------------------
create or replace function private.normalize_order_request(p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  c_safe constant numeric := 9007199254740991;
  c_int4 constant numeric := 2147483647;
  v_version integer;
  v_items jsonb;
  v_canon jsonb;
  v_item record;
  v_opts jsonb;
  v_sum numeric := 0;
  v_lines jsonb;
begin
  if jsonb_typeof(p) is distinct from 'object' then
    perform private.fail('INVALID_INPUT');
  end if;
  if exists (select 1 from jsonb_object_keys(p) k
             where k <> all (array['idempotencyKey', 'requestVersion', 'storeId', 'destinationRef', 'items',
                                   'approvedTotalAmount', 'disclosureVersion', 'disclosureAcknowledged'])) then
    perform private.fail('INVALID_INPUT');
  end if;
  if not (p ?& array['idempotencyKey', 'requestVersion', 'storeId', 'destinationRef', 'items',
                     'approvedTotalAmount', 'disclosureVersion', 'disclosureAcknowledged']) then
    perform private.fail('INVALID_INPUT');
  end if;

  if not private.json_is_uuid(p -> 'idempotencyKey')
     or not private.json_is_uuid(p -> 'storeId')
     or not private.json_is_uuid(p -> 'destinationRef')
     or not private.json_is_int(p -> 'requestVersion', 2, 3)
     or not private.json_is_int(p -> 'approvedTotalAmount', 1, c_safe)
     or jsonb_typeof(p -> 'disclosureVersion') is distinct from 'string'
     or (p ->> 'disclosureVersion') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or (p -> 'disclosureAcknowledged') is distinct from 'true'::jsonb then
    perform private.fail('INVALID_INPUT');
  end if;
  v_version := (p ->> 'requestVersion')::integer;

  v_items := p -> 'items';
  if jsonb_typeof(v_items) is distinct from 'array' then
    perform private.fail('INVALID_INPUT');
  end if;
  if jsonb_array_length(v_items) < 1 or jsonb_array_length(v_items) > 100 then
    perform private.fail('INVALID_INPUT');
  end if;

  for v_item in select e, ord from jsonb_array_elements(v_items) with ordinality as t (e, ord) loop
    if jsonb_typeof(v_item.e) is distinct from 'object' then
      perform private.fail('INVALID_INPUT');
    end if;
    -- v2는 optionIds만, v3는 options만 받는다. 둘을 섞으면 거절한다
    if v_version = 2 then
      if exists (select 1 from jsonb_object_keys(v_item.e) k
                 where k <> all (array['menuId', 'optionIds', 'quantity', 'approvedUnitPrice', 'approvedCatalogRevision']))
         or not (v_item.e ?& array['menuId', 'optionIds', 'quantity', 'approvedUnitPrice', 'approvedCatalogRevision']) then
        perform private.fail('INVALID_INPUT');
      end if;
    else
      if exists (select 1 from jsonb_object_keys(v_item.e) k
                 where k <> all (array['menuId', 'options', 'quantity', 'approvedUnitPrice', 'approvedCatalogRevision']))
         or not (v_item.e ?& array['menuId', 'options', 'quantity', 'approvedUnitPrice', 'approvedCatalogRevision']) then
        perform private.fail('INVALID_INPUT');
      end if;
    end if;
    if not private.json_is_uuid(v_item.e -> 'menuId')
       or not private.json_is_int(v_item.e -> 'quantity', 1, 10)
       or not private.json_is_int(v_item.e -> 'approvedUnitPrice', 0, c_safe)
       or not private.json_is_int(v_item.e -> 'approvedCatalogRevision', 1, c_safe) then
      perform private.fail('INVALID_INPUT');
    end if;

    if v_version = 2 then
      v_opts := v_item.e -> 'optionIds';
      if jsonb_typeof(v_opts) is distinct from 'array' or jsonb_array_length(v_opts) > 20 then
        perform private.fail('INVALID_INPUT');
      end if;
      if exists (select 1 from jsonb_array_elements(v_opts) o where not private.json_is_uuid(o)) then
        perform private.fail('INVALID_INPUT');
      end if;
      if (select count(distinct lower(x)) from jsonb_array_elements_text(v_opts) x) <> jsonb_array_length(v_opts) then
        perform private.fail('INVALID_INPUT');
      end if;
    else
      v_opts := v_item.e -> 'options';
      if jsonb_typeof(v_opts) is distinct from 'array' or jsonb_array_length(v_opts) > 20 then
        perform private.fail('INVALID_INPUT');
      end if;
      -- 객체인지 먼저 따로 본다 (한 식에 섞으면 평가 순서가 보장되지 않아 jsonb_object_keys가 오류를 낸다)
      if exists (select 1 from jsonb_array_elements(v_opts) o where jsonb_typeof(o) is distinct from 'object') then
        perform private.fail('INVALID_INPUT');
      end if;
      if exists (select 1 from jsonb_array_elements(v_opts) o
                 where exists (select 1 from jsonb_object_keys(o) k where k <> all (array['optionId', 'quantity']))
                    or not (o ?& array['optionId', 'quantity'])) then
        perform private.fail('INVALID_INPUT');
      end if;
      -- 옵션 수량은 1 이상의 정수. 음수·0·소수·문자열은 거절한다. 상한은 옵션마다 DB의 max_quantity가 정한다(여기서는 정수 범위만)
      if exists (select 1 from jsonb_array_elements(v_opts) o
                 where not private.json_is_uuid(o -> 'optionId') or not private.json_is_int(o -> 'quantity', 1, c_int4)) then
        perform private.fail('INVALID_INPUT');
      end if;
      -- 같은 옵션을 두 번 보내 수량 제한을 우회하지 못하게 한다
      if (select count(distinct lower(o ->> 'optionId')) from jsonb_array_elements(v_opts) o) <> jsonb_array_length(v_opts) then
        perform private.fail('INVALID_INPUT');
      end if;
    end if;
    v_sum := v_sum + (v_item.e ->> 'approvedUnitPrice')::numeric * (v_item.e ->> 'quantity')::numeric;
  end loop;

  -- 승인 총액은 자기 항목과 맞아야 한다 (앱 버그 방어. 서버 재계산과의 비교는 PRICE_CHANGED)
  if v_sum <> (p ->> 'approvedTotalAmount')::numeric then
    perform private.fail('INVALID_INPUT');
  end if;

  -- v2 줄도 같은 모양(options[{optionId, quantity: 1}])으로 바꿔 아래를 한 갈래로 처리한다
  select jsonb_agg(jsonb_build_object(
           'menuId', t.e -> 'menuId',
           'quantity', t.e -> 'quantity',
           'approvedUnitPrice', t.e -> 'approvedUnitPrice',
           'options', case when v_version = 2
                           then (select coalesce(jsonb_agg(jsonb_build_object('optionId', x, 'quantity', 1)), '[]'::jsonb)
                                 from jsonb_array_elements_text(t.e -> 'optionIds') x)
                           else t.e -> 'options' end
         ) order by t.ord)
    into v_canon
  from jsonb_array_elements(v_items) with ordinality as t (e, ord);

  -- 같은 (메뉴, 옵션, 옵션 수량) 조합은 한 줄로 합산. 같은 조합인데 승인 단가가 다르면 INVALID_INPUT.
  if exists (
    select 1
    from (
      select (e ->> 'menuId')::uuid as menu_id,
             array(select lower(o ->> 'optionId')::uuid from jsonb_array_elements(e -> 'options') o order by lower(o ->> 'optionId')::uuid) as opts,
             array(select (o ->> 'quantity')::integer from jsonb_array_elements(e -> 'options') o order by lower(o ->> 'optionId')::uuid) as qtys,
             (e ->> 'approvedUnitPrice')::bigint as price
      from jsonb_array_elements(v_canon) e
    ) r
    group by r.menu_id, r.opts, r.qtys
    having min(r.price) <> max(r.price)
  ) then
    perform private.fail('INVALID_INPUT');
  end if;

  select jsonb_agg(jsonb_build_object(
           'menuId', g.menu_id,
           'optionIds', to_jsonb(g.opts),
           'optionQuantities', to_jsonb(g.qtys),
           'quantity', g.qty,
           'approvedUnitPrice', g.price
         ) order by g.first_ord)
    into v_lines
  from (
    select r.menu_id, r.opts, r.qtys, sum(r.qty)::integer as qty, max(r.price) as price, min(r.ord) as first_ord
    from (
      select t.ord,
             (t.e ->> 'menuId')::uuid as menu_id,
             array(select lower(o ->> 'optionId')::uuid from jsonb_array_elements(t.e -> 'options') o order by lower(o ->> 'optionId')::uuid) as opts,
             array(select (o ->> 'quantity')::integer from jsonb_array_elements(t.e -> 'options') o order by lower(o ->> 'optionId')::uuid) as qtys,
             (t.e ->> 'quantity')::integer as qty,
             (t.e ->> 'approvedUnitPrice')::bigint as price
      from jsonb_array_elements(v_canon) with ordinality as t (e, ord)
    ) r
    group by r.menu_id, r.opts, r.qtys
  ) g;

  return jsonb_build_object(
    'idempotencyKey', lower(p ->> 'idempotencyKey'),
    'storeId', lower(p ->> 'storeId'),
    'destinationRef', lower(p ->> 'destinationRef'),
    'disclosureVersion', p ->> 'disclosureVersion',
    'approvedTotalAmount', (p ->> 'approvedTotalAmount')::bigint,
    'lines', v_lines
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 요청 지문: 옵션 수량이 모두 1이면 optionQuantities를 빼서 이전 지문과 같은 값을 만든다.
-- (이미 저장된 주문의 같은 요청 재시도가 IDEMPOTENCY_CONFLICT가 되지 않게 한다)
-- ---------------------------------------------------------------------------
create or replace function private.order_request_fingerprint(n jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(jsonb_build_object(
    'storeId', n ->> 'storeId',
    'destinationRef', n ->> 'destinationRef',
    'disclosureVersion', n ->> 'disclosureVersion',
    'approvedTotalAmount', n -> 'approvedTotalAmount',
    'lines', (select jsonb_agg(
                       case when coalesce((select bool_and(q::integer = 1) from jsonb_array_elements_text(l -> 'optionQuantities') q), true)
                            then l - 'optionQuantities' else l end
                       order by l ->> 'menuId', (l -> 'optionIds')::text, (l -> 'optionQuantities')::text)
              from jsonb_array_elements(n -> 'lines') l)
  )::text, 'UTF8')), 'hex');
$$;

-- ---------------------------------------------------------------------------
-- 카탈로그 검증 코어 (옵션 수량 · 수량 합 가격)
-- ---------------------------------------------------------------------------
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

revoke execute on function private.order_line_options_q(jsonb) from public;

-- ---------------------------------------------------------------------------
-- 주문 조회 · 생성 (옵션 수량 Snapshot)
-- ---------------------------------------------------------------------------
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

create or replace function public.create_order(p_request jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_norm jsonb;
  v_key uuid;
  v_fp text;
  v_existing_id uuid;
  v_existing_fp text;
  v_snap jsonb;
  v_order_id uuid;
  v_item_id uuid;
  v_line record;
  v_opt record;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  -- 형태 검사와 정규화 (DB를 읽지 않는다)
  v_norm := private.normalize_order_request(p_request);
  v_key := (v_norm ->> 'idempotencyKey')::uuid;
  v_fp := private.order_request_fingerprint(v_norm);

  -- 프로필 보장 + 사용자 직렬화 잠금
  insert into public.profiles (id) values (v_uid) on conflict (id) do nothing;
  perform 1 from public.profiles p where p.id = v_uid for update;

  -- 멱등성: 카탈로그·고지 검사보다 먼저
  select o.id, o.request_fingerprint into v_existing_id, v_existing_fp
  from public.orders o
  where o.user_id = v_uid and o.idempotency_key = v_key;
  if found then
    if v_existing_fp = v_fp then
      return public.get_my_order(v_existing_id) || jsonb_build_object('replayed', true);
    end if;
    raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT';
  end if;

  -- 고지 버전 허용 목록
  if not private.is_supported_disclosure_version(v_norm ->> 'disclosureVersion') then
    raise exception using errcode = 'P0001', message = 'DISCLOSURE_VERSION_UNSUPPORTED';
  end if;

  -- 같은 조합 합산 10 초과: 요청 전체 거절
  if exists (select 1 from private.order_lines(v_norm -> 'lines') l where l.qty > 10) then
    raise exception using errcode = 'P0001', message = 'QUANTITY_LIMIT_EXCEEDED';
  end if;
  -- 합친 뒤 서로 다른 조합은 최대 30종
  if jsonb_array_length(v_norm -> 'lines') > 30 then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;

  -- 카탈로그 잠금 · 검증 · 가격 재계산
  v_snap := private.validate_order_catalog(
    (v_norm ->> 'storeId')::uuid,
    v_norm -> 'lines',
    (v_norm ->> 'approvedTotalAmount')::bigint,
    true
  );

  -- 한 트랜잭션으로 저장: 주문 → 줄 → 옵션 → 초기 상태 이력
  insert into public.orders (
    user_id, store_id, idempotency_key, request_fingerprint, total_amount,
    store_name_snapshot, store_image_snapshot, category_code_snapshot, category_name_snapshot,
    destination_ref, disclosure_version, disclosure_acknowledged_at
  ) values (
    v_uid,
    (v_snap -> 'store' ->> 'id')::uuid,
    v_key,
    v_fp,
    (v_snap ->> 'total')::bigint,
    v_snap -> 'store' ->> 'name',
    v_snap -> 'store' ->> 'imageRef',
    v_snap -> 'store' ->> 'categoryCode',
    v_snap -> 'store' ->> 'categoryName',
    (v_norm ->> 'destinationRef')::uuid,
    v_norm ->> 'disclosureVersion',
    now()
  ) returning id into v_order_id;

  for v_line in
    select t.e, t.ord from jsonb_array_elements(v_snap -> 'lines') with ordinality as t (e, ord)
  loop
    insert into public.order_items (
      order_id, store_id, menu_id, line_no, menu_name_snapshot, menu_image_snapshot,
      base_price_snapshot, option_total_snapshot, unit_price, quantity, line_total
    ) values (
      v_order_id,
      (v_snap -> 'store' ->> 'id')::uuid,
      (v_line.e ->> 'menuId')::uuid,
      v_line.ord,
      v_line.e ->> 'menuName',
      v_line.e ->> 'menuImageRef',
      (v_line.e ->> 'basePrice')::bigint,
      (v_line.e ->> 'optionTotal')::bigint,
      (v_line.e ->> 'unitPrice')::bigint,
      (v_line.e ->> 'quantity')::integer,
      (v_line.e ->> 'lineTotal')::bigint
    ) returning id into v_item_id;

    for v_opt in
      select o.e, o.ord from jsonb_array_elements(v_line.e -> 'options') with ordinality as o (e, ord)
    loop
      insert into public.order_item_options (
        order_item_id, source_group_id, source_option_id, group_name_snapshot, option_name_snapshot,
        additional_price_snapshot, quantity_snapshot, sort_order
      ) values (
        v_item_id,
        (v_opt.e ->> 'groupId')::uuid,
        (v_opt.e ->> 'optionId')::uuid,
        v_opt.e ->> 'groupName',
        v_opt.e ->> 'optionName',
        (v_opt.e ->> 'additionalPrice')::bigint,
        coalesce((v_opt.e ->> 'quantity')::integer, 1),
        v_opt.ord
      );
    end loop;
  end loop;

  -- 초기 NULL → PENDING 이력. operation_id는 생성 요청의 키를 쓴다 (confirm/cancel이 같은 값을 operationId로 재사용하면 충돌로 잡힌다)
  insert into public.order_status_updates (order_id, revision, operation_id, from_status, to_status)
  values (v_order_id, 1, v_key, null, 'PENDING');

  return public.get_my_order(v_order_id) || jsonb_build_object('replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- get_menu: 옵션에 allowQuantity · maxQuantity 추가
-- ---------------------------------------------------------------------------
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
