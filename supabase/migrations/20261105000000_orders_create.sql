-- 주문 생성: orders · order_items · order_item_options · order_status_updates + create_order · get_my_order · get_order_by_request_key
-- 근거: 개발 명세 ORD-005~007 · DB-006~007 · SEC-002/004/005/008, 서정 B안(장바구니는 기기에만), 팀 결정 (2026-11-05 O1~O11).
-- 계약 초안: order-contract-draft-v2.md (저장소 밖). confirm_order · cancel_order는 다음 PR(orders_transitions)이다.
--
-- 규칙:
--   요청   = create_order(p_request jsonb) 하나. 요청 v2만 받는다. 알 수 없는 키(cartId 같은 옛 필드 포함)는 INVALID_INPUT.
--            { idempotencyKey, requestVersion=2, storeId, destinationRef, items[{menuId, optionIds[], quantity,
--              approvedUnitPrice, approvedCatalogRevision}], approvedTotalAmount, disclosureVersion, disclosureAcknowledged=true }
--            approvedCatalogRevision은 형식만 보고 거절·지문에 쓰지 않는다 (이름·설명 수정으로도 올라가 불필요한 거절이 생김).
--   순서   = 로그인(AUTH_REQUIRED) → 형태(INVALID_INPUT, DB 읽기 없음) → 정규화·지문 → 프로필 보장 + 사용자 잠금(profiles FOR UPDATE)
--            → 멱등성(같은 키·같은 지문=기존 주문 replayed:true / 다른 지문=IDEMPOTENCY_CONFLICT) → 고지 버전(DISCLOSURE_VERSION_UNSUPPORTED)
--            → 합산 10 초과(QUANTITY_LIMIT_EXCEEDED, 요청 전체 거절) → 조합 30종 초과(INVALID_INPUT)
--            → 카탈로그 잠금(FOR SHARE)·존재·소속(INVALID_INPUT) → 가게·분류 비활성(ITEM_UNAVAILABLE) → 영업 종료(STORE_CLOSED)
--            → 메뉴·옵션 비활성·품절(ITEM_UNAVAILABLE) → 선택 규칙(INVALID_OPTIONS) → 가격(PRICE_CHANGED) → 한 트랜잭션 저장.
--            먼저 걸린 하나의 코드만 돌려준다. 멱등성이 고지·규칙·가격 검사보다 먼저라서, 응답을 잃은 뒤 재시도하면 그 사이
--            가격·품절·고지 허용 목록이 바뀌었어도 이미 만들어진 주문을 돌려준다.
--   합산   = 같은 (메뉴, 옵션 조합)은 옵션 선택 순서와 상관없이 한 줄로 합산한다. 합산이 10을 넘으면 요청 전체를 거절한다.
--            합친 뒤 서로 다른 조합은 최대 30종. 원본 요청 줄 수는 최대 100줄, 줄당 옵션은 최대 20개 (남용 방지 기술 상한, 정책 아님).
--   잠금   = ① 사용자 직렬화: 본인 profiles 행 FOR UPDATE (같은 사용자의 동시 요청을 한 줄로 세움). 프로필이 없던 사용자는
--                insert (id) ... on conflict do nothing으로 먼저 만든다.
--            ② 카탈로그 일관성: 분류 → 가게 → 정렬된 메뉴 → 그룹 → 옵션, 모두 FOR SHARE (운영 변경과 섞이지 않게).
--   권한   = 앱(authenticated)은 주문 테이블에 쓸 수 없다. create_order는 비활성 카탈로그 행을 읽고 FOR SHARE 잠금을 걸어야 하므로
--            SECURITY DEFINER (FOR SHARE는 테이블에 UPDATE 권한도 요구한다: PostgreSQL SELECT 문서). search_path 고정, auth.uid()만 대상.
--            조회 함수 get_my_order · get_order_by_request_key는 INVOKER + 본인 행 RLS.
--   Snapshot = 서버가 검증·계산한 값만 저장한다. 계좌 원문·은행·마스킹은 서버에 없다(destination_ref는 불투명 UUID).
--   고지   = 허용 버전 목록은 private.is_supported_disclosure_version 안의 상수다. 바꾸려면 새 migration으로 함수를 교체한다.
--            각 버전의 문구 원문은 docs/disclosures/<버전>.md(서정 관리)에 두고 상수 옆 주석에 경로를 적는다.

-- ---------------------------------------------------------------------------
-- private 보조 함수
-- ---------------------------------------------------------------------------

-- 오류 코드를 던진다 (P0001, 메시지=코드). 상세 값은 오류에 담지 않는다.
create function private.fail(p_code text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001', message = p_code;
end;
$$;

create function private.json_is_uuid(v jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(v) = 'string'
    then (v #>> '{}') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    else false end;
$$;

-- 범위 안의 정수인 JSON 숫자인가
create function private.json_is_int(v jsonb, p_min numeric, p_max numeric)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(v) = 'number'
    then (v #>> '{}')::numeric = trunc((v #>> '{}')::numeric)
         and (v #>> '{}')::numeric between p_min and p_max
    else false end;
$$;

-- 허용 고지 버전. 문구 원문: docs/disclosures/<버전>.md (서정 관리)
create function private.is_supported_disclosure_version(p_version text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_version = any (array[
    '2026-09-30'   -- docs/disclosures/2026-09-30.md
  ]::text[]), false);
$$;

-- 정규화된 줄 → (순번, 메뉴, 옵션 배열, 수량, 승인 단가)
create function private.order_lines(p_lines jsonb)
returns table (ord integer, menu_id uuid, option_ids uuid[], qty integer, approved_unit_price bigint)
language sql
immutable
set search_path = ''
as $$
  select t.ord::integer,
         (t.e ->> 'menuId')::uuid,
         array(select x::uuid from jsonb_array_elements_text(t.e -> 'optionIds') x),
         (t.e ->> 'quantity')::integer,
         (t.e ->> 'approvedUnitPrice')::bigint
  from jsonb_array_elements(p_lines) with ordinality as t (e, ord);
$$;

-- 정규화된 줄 → (순번, 메뉴, 옵션) 한 옵션당 한 행
create function private.order_line_options(p_lines jsonb)
returns table (ord integer, menu_id uuid, option_id uuid)
language sql
immutable
set search_path = ''
as $$
  select l.ord, l.menu_id, o.option_id
  from private.order_lines(p_lines) l
  cross join lateral unnest(l.option_ids) as o (option_id);
$$;

-- 요청 형태 검사 + 정규화. DB를 읽지 않는다. 형태 문제는 모두 INVALID_INPUT.
-- 반환: { idempotencyKey, storeId, destinationRef, disclosureVersion, approvedTotalAmount, lines[{menuId, optionIds, quantity, approvedUnitPrice}] }
--   UUID는 소문자, optionIds는 정렬, 같은 (메뉴, 옵션 조합)은 한 줄로 합산(수량 합계, 처음 나온 순서 유지). 합산 10 초과 검사는 여기서 하지 않는다.
create function private.normalize_order_request(p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  c_safe constant numeric := 9007199254740991;
  v_items jsonb;
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
     or not private.json_is_int(p -> 'requestVersion', 2, 2)
     or not private.json_is_int(p -> 'approvedTotalAmount', 1, c_safe)
     or jsonb_typeof(p -> 'disclosureVersion') is distinct from 'string'
     or (p ->> 'disclosureVersion') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or (p -> 'disclosureAcknowledged') is distinct from 'true'::jsonb then
    perform private.fail('INVALID_INPUT');
  end if;

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
    if exists (select 1 from jsonb_object_keys(v_item.e) k
               where k <> all (array['menuId', 'optionIds', 'quantity', 'approvedUnitPrice', 'approvedCatalogRevision']))
       or not (v_item.e ?& array['menuId', 'optionIds', 'quantity', 'approvedUnitPrice', 'approvedCatalogRevision']) then
      perform private.fail('INVALID_INPUT');
    end if;
    if not private.json_is_uuid(v_item.e -> 'menuId')
       or not private.json_is_int(v_item.e -> 'quantity', 1, 10)
       or not private.json_is_int(v_item.e -> 'approvedUnitPrice', 0, c_safe)
       or not private.json_is_int(v_item.e -> 'approvedCatalogRevision', 1, c_safe) then
      perform private.fail('INVALID_INPUT');
    end if;
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
    v_sum := v_sum + (v_item.e ->> 'approvedUnitPrice')::numeric * (v_item.e ->> 'quantity')::numeric;
  end loop;

  -- 승인 총액은 자기 항목과 맞아야 한다 (앱 버그 방어. 서버 재계산과의 비교는 PRICE_CHANGED)
  if v_sum <> (p ->> 'approvedTotalAmount')::numeric then
    perform private.fail('INVALID_INPUT');
  end if;

  -- 같은 (메뉴, 옵션 조합)은 한 줄로 합산. 같은 조합인데 승인 단가가 다르면 INVALID_INPUT.
  if exists (
    select 1
    from (
      select (e ->> 'menuId')::uuid as menu_id,
             array(select lower(x)::uuid from jsonb_array_elements_text(e -> 'optionIds') x order by lower(x)::uuid) as opts,
             (e ->> 'approvedUnitPrice')::bigint as price
      from jsonb_array_elements(v_items) e
    ) r
    group by r.menu_id, r.opts
    having min(r.price) <> max(r.price)
  ) then
    perform private.fail('INVALID_INPUT');
  end if;

  select jsonb_agg(jsonb_build_object(
           'menuId', g.menu_id,
           'optionIds', to_jsonb(g.opts),
           'quantity', g.qty,
           'approvedUnitPrice', g.price
         ) order by g.first_ord)
    into v_lines
  from (
    select r.menu_id, r.opts, sum(r.qty)::integer as qty, max(r.price) as price, min(r.ord) as first_ord
    from (
      select t.ord,
             (t.e ->> 'menuId')::uuid as menu_id,
             array(select lower(x)::uuid from jsonb_array_elements_text(t.e -> 'optionIds') x order by lower(x)::uuid) as opts,
             (t.e ->> 'quantity')::integer as qty,
             (t.e ->> 'approvedUnitPrice')::bigint as price
      from jsonb_array_elements(v_items) with ordinality as t (e, ord)
    ) r
    group by r.menu_id, r.opts
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

-- 요청 지문: 정규화된 요청의 sha256(hex). 키(idempotencyKey)와 approvedCatalogRevision은 넣지 않는다.
-- 줄은 (메뉴, 옵션) 순으로 정렬해 요청에서의 줄 순서가 달라도 같은 지문이 된다.
create function private.order_request_fingerprint(n jsonb)
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
    'lines', (select jsonb_agg(l order by l ->> 'menuId', (l -> 'optionIds')::text)
              from jsonb_array_elements(n -> 'lines') l)
  )::text, 'UTF8')), 'hex');
$$;

-- 카탈로그 검증 코어. 잠금(p_lock) → 존재·소속 → 비활성 → 영업 종료 → 품절 → 선택 규칙 → 가격 순으로 검사하고,
-- 통과하면 Snapshot에 넣을 값을 돌려준다. 읽기 전용 검증 함수(후속 PR)가 p_lock=false로 같은 코어를 쓸 수 있게 분리했다.
-- 비활성 행도 읽어야 하므로 호출하는 쪽이 DEFINER여야 한다.
create function private.validate_order_catalog(p_store_id uuid, p_lines jsonb, p_approved_total bigint, p_lock boolean default true)
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
  select coalesce(array_agg(distinct lo.option_id order by lo.option_id), '{}') into v_option_ids from private.order_line_options(p_lines) lo;

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
    from private.order_line_options(p_lines) lo
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
    from private.order_line_options(p_lines) lo
    join public.menu_options o on o.id = lo.option_id
    join public.menu_option_groups g on g.id = o.group_id
    where not g.is_active or not o.is_active or o.is_sold_out
  ) then
    perform private.fail('ITEM_UNAVAILABLE');
  end if;

  -- 선택 규칙: 활성 그룹마다 선택 수가 min_select ~ max_select (INVALID_OPTIONS)
  if exists (
    select 1
    from private.order_lines(p_lines) l
    join public.menu_option_groups g on g.menu_id = l.menu_id and g.is_active
    where (
      select count(*)
      from private.order_line_options(p_lines) lo
      join public.menu_options o on o.id = lo.option_id
      where lo.ord = l.ord and o.group_id = g.id
    ) not between g.min_select and g.max_select
  ) then
    perform private.fail('INVALID_OPTIONS');
  end if;

  -- 가격 재계산 (PRICE_CHANGED): 줄 단가 = 기본가 + 선택 옵션 추가금 합, 총액 = 줄 합계의 합
  for r in
    select l.ord, l.menu_id, l.qty, l.approved_unit_price, m.name, m.image_ref, m.base_price
    from private.order_lines(p_lines) l
    join public.menus m on m.id = l.menu_id
    order by l.ord
  loop
    select coalesce(jsonb_agg(jsonb_build_object(
             'groupId', g.id, 'optionId', o.id, 'groupName', g.name, 'optionName', o.name,
             'additionalPrice', o.additional_price
           ) order by g.sort_order, g.id, o.sort_order, o.id), '[]'::jsonb),
           coalesce(sum(o.additional_price::numeric), 0)
      into v_opts, v_opt_total
    from private.order_line_options(p_lines) lo
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

revoke execute on function private.fail(text) from public;
revoke execute on function private.json_is_uuid(jsonb) from public;
revoke execute on function private.json_is_int(jsonb, numeric, numeric) from public;
revoke execute on function private.is_supported_disclosure_version(text) from public;
revoke execute on function private.order_lines(jsonb) from public;
revoke execute on function private.order_line_options(jsonb) from public;
revoke execute on function private.normalize_order_request(jsonb) from public;
revoke execute on function private.order_request_fingerprint(jsonb) from public;
revoke execute on function private.validate_order_catalog(uuid, jsonb, bigint, boolean) from public;

-- ---------------------------------------------------------------------------
-- 테이블 (DB-006 · DB-007, source_cart_*는 없다)
-- 앱은 본인 행 SELECT만. 쓰기 권한과 정책은 없다 (create_order가 DEFINER로 쓴다).
-- ---------------------------------------------------------------------------

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete restrict,
  store_id uuid not null references public.stores (id) on delete restrict,
  idempotency_key uuid not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  status text not null default 'PENDING' check (status in ('PENDING', 'USER_CONFIRMED', 'CANCELLED')),
  total_amount bigint not null check (total_amount > 0 and total_amount <= 9007199254740991),
  currency text not null default 'KRW' check (currency = 'KRW'),
  snapshot_version integer not null default 1 check (snapshot_version > 0),
  store_name_snapshot text not null,
  store_image_snapshot text,
  category_code_snapshot text not null,
  category_name_snapshot text not null,
  destination_ref uuid not null,
  disclosure_version text not null,
  disclosure_acknowledged_at timestamptz not null,
  status_revision bigint not null default 1 check (status_revision > 0),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  unique (user_id, idempotency_key),
  unique (id, store_id),
  check (
    (status = 'PENDING' and completed_at is null and cancelled_at is null)
    or (status = 'USER_CONFIRMED' and completed_at is not null and cancelled_at is null)
    or (status = 'CANCELLED' and cancelled_at is not null and completed_at is null)
  )
);

create index orders_user_recent_idx on public.orders (user_id, created_at desc, id desc);
create index orders_store_idx on public.orders (store_id);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  store_id uuid not null,
  menu_id uuid not null,
  line_no integer not null check (line_no > 0),
  menu_name_snapshot text not null,
  menu_image_snapshot text,
  base_price_snapshot bigint not null check (base_price_snapshot >= 0),
  option_total_snapshot bigint not null check (option_total_snapshot >= 0),
  unit_price bigint not null check (unit_price >= 0),
  quantity integer not null check (quantity between 1 and 10),
  line_total bigint not null check (line_total >= 0),
  foreign key (order_id, store_id) references public.orders (id, store_id) on delete restrict,
  foreign key (menu_id, store_id) references public.menus (id, store_id) on delete restrict,
  unique (order_id, line_no),
  check (unit_price = base_price_snapshot + option_total_snapshot),
  check (line_total = unit_price * quantity)
);

create index order_items_menu_idx on public.order_items (menu_id);

create table public.order_item_options (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items (id) on delete restrict,
  source_group_id uuid not null,
  source_option_id uuid not null,
  group_name_snapshot text not null,
  option_name_snapshot text not null,
  additional_price_snapshot bigint not null check (additional_price_snapshot >= 0),
  sort_order integer not null,
  unique (order_item_id, source_option_id)
);

create table public.order_status_updates (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  revision bigint not null check (revision > 0),
  operation_id uuid not null,
  from_status text check (from_status in ('PENDING', 'USER_CONFIRMED', 'CANCELLED')),
  to_status text not null check (to_status in ('PENDING', 'USER_CONFIRMED', 'CANCELLED')),
  created_at timestamptz not null default now(),
  viewed_at timestamptz,
  unique (order_id, revision),
  unique (order_id, operation_id)
);

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_item_options enable row level security;
alter table public.order_status_updates enable row level security;

revoke all on table public.orders, public.order_items, public.order_item_options, public.order_status_updates
  from public, anon, authenticated;

-- request_fingerprint는 내부 값이라 앱에 열지 않는다 (열 목록에서 뺀다)
grant select (id, user_id, store_id, idempotency_key, status, total_amount, currency, snapshot_version,
              store_name_snapshot, store_image_snapshot, category_code_snapshot, category_name_snapshot,
              destination_ref, disclosure_version, disclosure_acknowledged_at, status_revision,
              created_at, completed_at, cancelled_at)
  on public.orders to authenticated;
grant select on public.order_items, public.order_item_options, public.order_status_updates to authenticated;

create policy orders_owner_read on public.orders
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy order_items_owner_read on public.order_items
  for select to authenticated
  using (exists (
    select 1 from public.orders o
    where o.id = order_items.order_id and o.user_id = (select auth.uid())
  ));

create policy order_item_options_owner_read on public.order_item_options
  for select to authenticated
  using (exists (
    select 1 from public.order_items i
    join public.orders o on o.id = i.order_id
    where i.id = order_item_options.order_item_id and o.user_id = (select auth.uid())
  ));

create policy order_status_updates_owner_read on public.order_status_updates
  for select to authenticated
  using (exists (
    select 1 from public.orders o
    where o.id = order_status_updates.order_id and o.user_id = (select auth.uid())
  ));

-- ---------------------------------------------------------------------------
-- get_my_order(p_order_id) → 주문 DTO (replayed 키 없음)
-- 본인 주문만. 없거나 남의 주문이면 RESOURCE_NOT_FOUND. INVOKER + RLS (+ user_id 조건을 한 번 더 건다).
-- ---------------------------------------------------------------------------

create function public.get_my_order(p_order_id uuid)
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
                            'additionalPrice', x.additional_price_snapshot
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

-- ---------------------------------------------------------------------------
-- get_order_by_request_key(p_idempotency_key) → 주문 DTO 또는 null (없으면 성공 null, 오류 아님)
-- 본인 키만 본다. 남의 키는 "없음"과 구별되지 않는다. replayed 키는 없다.
-- ---------------------------------------------------------------------------

create function public.get_order_by_request_key(p_idempotency_key uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_order_id uuid;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;

  select o.id into v_order_id
  from public.orders o
  where o.user_id = v_uid and o.idempotency_key = p_idempotency_key;

  if v_order_id is null then
    return null;
  end if;
  return public.get_my_order(v_order_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- create_order(p_request) → 주문 DTO + replayed
-- ---------------------------------------------------------------------------

create function public.create_order(p_request jsonb)
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
        additional_price_snapshot, sort_order
      ) values (
        v_item_id,
        (v_opt.e ->> 'groupId')::uuid,
        (v_opt.e ->> 'optionId')::uuid,
        v_opt.e ->> 'groupName',
        v_opt.e ->> 'optionName',
        (v_opt.e ->> 'additionalPrice')::bigint,
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

revoke execute on function public.get_my_order(uuid) from public, anon, authenticated;
revoke execute on function public.get_order_by_request_key(uuid) from public, anon, authenticated;
revoke execute on function public.create_order(jsonb) from public, anon, authenticated;
grant execute on function public.get_my_order(uuid) to authenticated;
grant execute on function public.get_order_by_request_key(uuid) to authenticated;
grant execute on function public.create_order(jsonb) to authenticated;
