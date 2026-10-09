-- T02 카탈로그 스키마 + Guest 조회 권한 + 조회 RPC
-- 근거: 개발 명세 DB-001, DB-004, DB-011, SEC-001~004, API-001~003
-- 계약 타입: src/contracts/catalog.ts (CATALOG_CONTRACT_VERSION과 함께 변경)
--
-- 범위: categories, stores, menus, menu_option_groups, menu_options
-- 범위 밖: banners, popular_search_terms, store_favorites, feature_config, 리뷰 집계
--
-- 카탈로그 쓰기 규약 (ORD-005): 운영/Seed 작업은 옵션·그룹을 바꾸기 전에 부모 menus 행을
-- FOR UPDATE로 먼저 잠근다. 아래 트리거가 부모 menus.catalog_revision을 올리지만,
-- 잠금 순서(Store → Menu → 그룹/옵션)는 작업자가 지켜야 한다.

-- ---------------------------------------------------------------------------
-- 내부 helper (Data API 비노출 스키마)
-- ---------------------------------------------------------------------------

create schema if not exists private;
revoke all on schema private from public;

-- stores/menus: 실제 값이 바뀌었을 때만 catalog_revision +1, updated_at 갱신.
-- catalog_revision을 직접 지정한 UPDATE도 OLD+1로 고정해 임의 값/역행을 막는다.
create function private.apply_catalog_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.catalog_revision is distinct from old.catalog_revision
     or (to_jsonb(new) - 'catalog_revision' - 'updated_at')
        is distinct from (to_jsonb(old) - 'catalog_revision' - 'updated_at') then
    new.catalog_revision := old.catalog_revision + 1;
    new.updated_at := now();
  else
    new.catalog_revision := old.catalog_revision;
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

-- 옵션 그룹 변경 → 소속 메뉴 revision +1
create function private.bump_menu_revision_from_group()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new is not distinct from old then
    return null;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    update public.menus set catalog_revision = catalog_revision + 1
    where id = old.menu_id;
  end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.menu_id is distinct from old.menu_id) then
    update public.menus set catalog_revision = catalog_revision + 1
    where id = new.menu_id;
  end if;
  return null;
end;
$$;

-- 옵션 변경 → 그룹을 거쳐 소속 메뉴 revision +1
create function private.bump_menu_revision_from_option()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new is not distinct from old then
    return null;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    update public.menus m set catalog_revision = m.catalog_revision + 1
    from public.menu_option_groups g
    where g.id = old.group_id and m.id = g.menu_id;
  end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.group_id is distinct from old.group_id) then
    update public.menus m set catalog_revision = m.catalog_revision + 1
    from public.menu_option_groups g
    where g.id = new.group_id and m.id = g.menu_id;
  end if;
  return null;
end;
$$;

revoke execute on function private.apply_catalog_revision() from public;
revoke execute on function private.bump_menu_revision_from_group() from public;
revoke execute on function private.bump_menu_revision_from_option() from public;

-- ---------------------------------------------------------------------------
-- 테이블 (DB-004)
-- 금액은 원 단위 bigint. API가 JS number로 내보내므로 안전 정수 범위(2^53-1)를 CHECK로 막는다.
-- ---------------------------------------------------------------------------

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (btrim(code) <> ''),
  name text not null check (btrim(name) <> ''),
  sort_order integer not null default 0,
  is_active boolean not null default true
);

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories (id) on delete restrict,
  name text not null check (btrim(name) <> ''),
  description text,
  image_ref text,
  is_active boolean not null default true,
  is_open boolean not null default true,
  is_recommended boolean not null default false,
  source_type text not null default 'SEED',
  source_ref text,
  catalog_revision bigint not null default 1 check (catalog_revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.menus (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete restrict,
  name text not null check (btrim(name) <> ''),
  description text,
  image_ref text,
  base_price bigint not null check (base_price between 0 and 9007199254740991),
  is_active boolean not null default true,
  is_sold_out boolean not null default false,
  is_popular boolean not null default false,
  popularity_score integer not null default 0,
  sort_order integer not null default 0,
  catalog_revision bigint not null default 1 check (catalog_revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, store_id)
);

create table public.menu_option_groups (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null references public.menus (id) on delete restrict,
  name text not null check (btrim(name) <> ''),
  min_select integer not null default 0,
  max_select integer not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  check (min_select >= 0 and min_select <= max_select and max_select >= 1),
  unique (id, menu_id)
);

create table public.menu_options (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.menu_option_groups (id) on delete restrict,
  name text not null check (btrim(name) <> ''),
  additional_price bigint not null default 0
    check (additional_price between 0 and 9007199254740991),
  is_active boolean not null default true,
  is_sold_out boolean not null default false,
  sort_order integer not null default 0,
  unique (id, group_id)
);

create trigger stores_catalog_revision
  before update on public.stores
  for each row execute function private.apply_catalog_revision();

create trigger menus_catalog_revision
  before update on public.menus
  for each row execute function private.apply_catalog_revision();

create trigger menu_option_groups_bump_menu_revision
  after insert or update or delete on public.menu_option_groups
  for each row execute function private.bump_menu_revision_from_group();

create trigger menu_options_bump_menu_revision
  after insert or update or delete on public.menu_options
  for each row execute function private.bump_menu_revision_from_option();

-- ---------------------------------------------------------------------------
-- 인덱스 (DB-011 카탈로그 항목)
-- ---------------------------------------------------------------------------

create index stores_category_active_idx on public.stores (category_id, id) where is_active;
create index menus_store_active_idx on public.menus (store_id, sort_order, id) where is_active;
create index menu_option_groups_menu_idx on public.menu_option_groups (menu_id, sort_order, id);
create index menu_options_group_idx on public.menu_options (group_id, sort_order, id);

-- ---------------------------------------------------------------------------
-- 권한 (SEC-002, SEC-003)
-- Guest(anon)와 로그인 사용자 모두: 활성 + 활성 상위 항목만 SELECT, 쓰기 전부 금지.
-- 공개 컬럼만 GRANT한다. source_type/source_ref, popularity_score 등은 노출하지 않는다.
-- ---------------------------------------------------------------------------

alter table public.categories enable row level security;
alter table public.stores enable row level security;
alter table public.menus enable row level security;
alter table public.menu_option_groups enable row level security;
alter table public.menu_options enable row level security;

revoke all on table public.categories, public.stores, public.menus,
  public.menu_option_groups, public.menu_options
  from public, anon, authenticated;

grant select (id, code, name, sort_order, is_active)
  on public.categories to anon, authenticated;
grant select (id, category_id, name, description, image_ref, is_active, is_open, is_recommended)
  on public.stores to anon, authenticated;
grant select (id, store_id, name, description, image_ref, base_price,
              is_active, is_sold_out, sort_order, catalog_revision)
  on public.menus to anon, authenticated;
grant select (id, menu_id, name, min_select, max_select, sort_order, is_active)
  on public.menu_option_groups to anon, authenticated;
grant select (id, group_id, name, additional_price, is_active, is_sold_out, sort_order)
  on public.menu_options to anon, authenticated;

-- 자식 정책은 부모 테이블을 한 방향으로만 참조한다 (부모 RLS도 함께 적용됨).
create policy categories_public_read on public.categories
  for select to anon, authenticated
  using (is_active);

create policy stores_public_read on public.stores
  for select to anon, authenticated
  using (
    is_active
    and exists (
      select 1 from public.categories c
      where c.id = stores.category_id and c.is_active
    )
  );

create policy menus_public_read on public.menus
  for select to anon, authenticated
  using (
    is_active
    and exists (
      select 1 from public.stores s
      where s.id = menus.store_id and s.is_active
    )
  );

create policy menu_option_groups_public_read on public.menu_option_groups
  for select to anon, authenticated
  using (
    is_active
    and exists (
      select 1 from public.menus m
      where m.id = menu_option_groups.menu_id and m.is_active
    )
  );

create policy menu_options_public_read on public.menu_options
  for select to anon, authenticated
  using (
    is_active
    and exists (
      select 1 from public.menu_option_groups g
      where g.id = menu_options.group_id and g.is_active
    )
  );

-- ---------------------------------------------------------------------------
-- 조회 RPC (SECURITY INVOKER: 호출자의 GRANT/RLS를 그대로 적용)
-- 응답 키는 src/contracts/catalog.ts의 DTO와 같은 camelCase.
-- 업무 오류는 SQLSTATE P0001 + message = 오류 코드(INVALID_INPUT / RESOURCE_NOT_FOUND).
-- ---------------------------------------------------------------------------

create function public.list_categories()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name, 'sortOrder', c.sort_order)
      order by c.sort_order, c.id
    ),
    '[]'::jsonb
  )
  from public.categories c;
$$;

-- 가게 목록: (name, id) 오름차순 keyset pagination.
-- p_category_id NULL = 전체. 비활성/없는 카테고리는 빈 목록.
-- cursor는 opaque 문자열(base64 JSON). 형식이 틀리면 INVALID_INPUT.
create function public.list_stores(
  p_category_id uuid default null,
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
  v_page_size integer := coalesce(p_page_size, 20);
  v_cursor jsonb;
  v_after_name text;
  v_after_id uuid;
  v_rows jsonb;
  v_count integer;
  v_last jsonb;
begin
  if v_page_size < 1 or v_page_size > 50 then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT',
      detail = 'pageSize must be between 1 and 50';
  end if;

  if p_cursor is not null then
    begin
      v_cursor := convert_from(decode(p_cursor, 'base64'), 'UTF8')::jsonb;
      v_after_name := v_cursor ->> 'name';
      v_after_id := (v_cursor ->> 'id')::uuid;
    exception when others then
      v_after_name := null;
    end;
    if v_after_name is null or v_after_id is null then
      raise exception using errcode = 'P0001', message = 'INVALID_INPUT',
        detail = 'invalid cursor';
    end if;
  end if;

  select
    coalesce(jsonb_agg(card order by sort_name, sort_id), '[]'::jsonb),
    count(*)
  into v_rows, v_count
  from (
    select
      s.name as sort_name,
      s.id as sort_id,
      jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'imageRef', s.image_ref,
        'isOpen', s.is_open,
        'isRecommended', s.is_recommended,
        'category', jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name)
      ) as card
    from public.stores s
    join public.categories c on c.id = s.category_id
    where (p_category_id is null or s.category_id = p_category_id)
      and (v_after_name is null or (s.name, s.id) > (v_after_name, v_after_id))
    order by s.name, s.id
    limit v_page_size + 1
  ) page;

  if v_count > v_page_size then
    v_rows := v_rows - v_page_size;  -- 다음 페이지 확인용 1건 제거
    v_last := v_rows -> (v_page_size - 1);
    return jsonb_build_object(
      'items', v_rows,
      'hasMore', true,
      -- encode()는 76자마다 줄바꿈을 넣으므로 제거한다
      'nextCursor', translate(encode(convert_to(
        jsonb_build_object('name', v_last ->> 'name', 'id', v_last ->> 'id')::text, 'UTF8'), 'base64'),
        E'\n', '')
    );
  end if;

  return jsonb_build_object('items', v_rows, 'hasMore', false, 'nextCursor', null);
end;
$$;

-- 가게 상세: 가게 기본 정보 + 활성 메뉴 목록(품절 포함). 옵션은 get_menu에서 조회.
create function public.get_store(p_store_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_store jsonb;
begin
  select jsonb_build_object(
    'id', s.id,
    'name', s.name,
    'description', s.description,
    'imageRef', s.image_ref,
    'isOpen', s.is_open,
    'isRecommended', s.is_recommended,
    'category', jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name),
    'menus', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', m.id,
          'name', m.name,
          'description', m.description,
          'imageRef', m.image_ref,
          'price', m.base_price,
          'isSoldOut', m.is_sold_out
        )
        order by m.sort_order, m.id
      )
      from public.menus m
      where m.store_id = s.id
    ), '[]'::jsonb)
  )
  into v_store
  from public.stores s
  join public.categories c on c.id = s.category_id
  where s.id = p_store_id;

  if v_store is null then
    raise exception using errcode = 'P0001', message = 'RESOURCE_NOT_FOUND';
  end if;
  return v_store;
end;
$$;

-- 메뉴 상세: 담기 판단에 필요한 가격·revision·옵션 그룹(min/max)·옵션 품절 상태.
create function public.get_menu(p_menu_id uuid)
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
                'isSoldOut', o.is_sold_out
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
  where m.id = p_menu_id;

  if v_menu is null then
    raise exception using errcode = 'P0001', message = 'RESOURCE_NOT_FOUND';
  end if;
  return v_menu;
end;
$$;

revoke execute on function public.list_categories() from public, anon, authenticated;
revoke execute on function public.list_stores(uuid, text, integer) from public, anon, authenticated;
revoke execute on function public.get_store(uuid) from public, anon, authenticated;
revoke execute on function public.get_menu(uuid) from public, anon, authenticated;

grant execute on function public.list_categories() to anon, authenticated;
grant execute on function public.list_stores(uuid, text, integer) to anon, authenticated;
grant execute on function public.get_store(uuid) to anon, authenticated;
grant execute on function public.get_menu(uuid) to anon, authenticated;
