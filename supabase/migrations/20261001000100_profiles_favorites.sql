-- 프로필 최소 레코드 + 가게 찜 + 카탈로그 조회 응답의 찜 상태
-- 근거: 개발 명세 DB-003(profiles), DB-004(store_favorites), SEC-002/003/005, AUTH-003
-- 계약 타입: src/contracts/catalog.ts
--
-- 정책 합의(2026-10-01): 이메일 인증 없이 가입/로그인 (supabase/config.toml enable_confirmations = false)
-- 이름 수집 시점·미등록자 표시(OPEN-DB-004)와 탈퇴 처리(OPEN-DB-005)는 미결정:
--   name은 nullable로 두고 수집/수정 경로를 만들지 않는다. auth.users 삭제에 CASCADE를 걸지 않는다.

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
revoke all on table public.profiles from public, anon, authenticated;
-- 본인 행만 조회. 생성은 ensure_my_profile, 수정/삭제 경로는 정책 확정 전까지 없음.
grant select (id, name, created_at) on public.profiles to authenticated;

create policy profiles_owner_read on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

-- 로그인 사용자 본인의 최소 레코드를 만든다 (중복 호출 안전).
-- 앱 직접 INSERT를 금지했으므로 DEFINER로 실행하고, 대상은 auth.uid()로만 정한다.
create function public.ensure_my_profile()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_profile jsonb;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  insert into public.profiles (id) values (v_uid)
  on conflict (id) do nothing;

  select jsonb_build_object('id', p.id, 'name', p.name)
  into v_profile
  from public.profiles p
  where p.id = v_uid;

  return v_profile;
end;
$$;

-- ---------------------------------------------------------------------------
-- store_favorites (Store only, FR-FAV-001)
-- 직접 INSERT/DELETE를 RLS로 허용하고 UPDATE는 GRANT하지 않는다 (SEC-003).
-- 앱은 set_favorite(목표값) 사용을 권장: 로그인 복귀 후 재시도해도 결과가 같다 (AUTH-003).
-- ---------------------------------------------------------------------------

create table public.store_favorites (
  user_id uuid not null references public.profiles (id) on delete restrict,
  store_id uuid not null references public.stores (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (user_id, store_id)
);

create index store_favorites_user_recent_idx
  on public.store_favorites (user_id, created_at desc, store_id desc);
create index store_favorites_store_idx on public.store_favorites (store_id);

alter table public.store_favorites enable row level security;
revoke all on table public.store_favorites from public, anon, authenticated;
grant select (user_id, store_id, created_at) on public.store_favorites to authenticated;
grant insert (user_id, store_id) on public.store_favorites to authenticated;
grant delete on public.store_favorites to authenticated;

create policy store_favorites_owner_read on public.store_favorites
  for select to authenticated
  using (user_id = (select auth.uid()));

-- 신규 찜은 본인 + 현재 조회 가능한(활성) 가게만. stores RLS가 함께 적용된다.
create policy store_favorites_owner_insert on public.store_favorites
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.stores s where s.id = store_favorites.store_id)
  );

-- 비활성 가게의 남은 찜도 본인이 삭제할 수 있다.
create policy store_favorites_owner_delete on public.store_favorites
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- 찜 목표값 설정. desired=true는 활성 가게만, desired=false는 항상 허용.
create function public.set_favorite(p_store_id uuid, p_desired boolean)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;
  if p_store_id is null or p_desired is null then
    raise exception using errcode = 'P0001', message = 'INVALID_INPUT';
  end if;

  if p_desired then
    if not exists (select 1 from public.stores s where s.id = p_store_id) then
      raise exception using errcode = 'P0001', message = 'RESOURCE_NOT_FOUND';
    end if;
    perform public.ensure_my_profile();
    insert into public.store_favorites (user_id, store_id)
    values (v_uid, p_store_id)
    on conflict (user_id, store_id) do nothing;
  else
    delete from public.store_favorites f
    where f.user_id = v_uid and f.store_id = p_store_id;
  end if;

  return jsonb_build_object('storeId', p_store_id, 'isFavorite', p_desired);
end;
$$;

-- 내 찜 목록: 최근 찜 순 (created_at DESC, store_id DESC) keyset pagination.
-- 비활성 가게는 숨긴다 (FR-FAV-006). 행은 삭제하지 않는다.
create function public.list_my_favorites(
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
  v_rows jsonb;
  v_count integer;
  v_last jsonb;
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
      v_after_at := (v_cursor ->> 'favoritedAt')::timestamptz;
      v_after_id := (v_cursor ->> 'id')::uuid;
    exception when others then
      v_after_at := null;
    end;
    if v_after_at is null or v_after_id is null then
      raise exception using errcode = 'P0001', message = 'INVALID_INPUT',
        detail = 'invalid cursor';
    end if;
  end if;

  select
    coalesce(jsonb_agg(card order by fav_at desc, fav_id desc), '[]'::jsonb),
    count(*)
  into v_rows, v_count
  from (
    select
      f.created_at as fav_at,
      f.store_id as fav_id,
      jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'imageRef', s.image_ref,
        'isOpen', s.is_open,
        'isRecommended', s.is_recommended,
        'category', jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name),
        'isFavorite', true,
        'favoritedAt', f.created_at
      ) as card
    from public.store_favorites f
    join public.stores s on s.id = f.store_id
    join public.categories c on c.id = s.category_id
    where f.user_id = v_uid
      and (v_after_at is null or (f.created_at, f.store_id) < (v_after_at, v_after_id))
    order by f.created_at desc, f.store_id desc
    limit v_page_size + 1
  ) page;

  if v_count > v_page_size then
    v_rows := v_rows - v_page_size;
    v_last := v_rows -> (v_page_size - 1);
    return jsonb_build_object(
      'items', v_rows,
      'hasMore', true,
      'nextCursor', translate(encode(convert_to(
        jsonb_build_object('favoritedAt', v_last ->> 'favoritedAt', 'id', v_last ->> 'id')::text,
        'UTF8'), 'base64'), E'\n', '')
    );
  end if;

  return jsonb_build_object('items', v_rows, 'hasMore', false, 'nextCursor', null);
end;
$$;

-- ---------------------------------------------------------------------------
-- 카탈로그 조회 응답에 isFavorite 추가
-- Guest: null(로그인 전, 찜 여부를 알 수 없음) / 로그인: true|false
-- store_favorites 조회 문은 로그인일 때만 실행되므로 anon에게 테이블 권한이 필요 없다.
-- ---------------------------------------------------------------------------

create or replace function public.list_stores(
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
  v_uid uuid := (select auth.uid());
  v_page_size integer := coalesce(p_page_size, 20);
  v_cursor jsonb;
  v_after_name text;
  v_after_id uuid;
  v_rows jsonb;
  v_count integer;
  v_last jsonb;
  v_next_cursor text;
  v_favorites uuid[];
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
    -- encode()는 76자마다 줄바꿈을 넣으므로 제거한다
    v_next_cursor := translate(encode(convert_to(
      jsonb_build_object('name', v_last ->> 'name', 'id', v_last ->> 'id')::text, 'UTF8'), 'base64'),
      E'\n', '');
  end if;

  if v_uid is not null then
    select array_agg(f.store_id) into v_favorites
    from public.store_favorites f
    where f.user_id = v_uid
      and f.store_id in (select (e ->> 'id')::uuid from jsonb_array_elements(v_rows) e);
  end if;

  select coalesce(jsonb_agg(
           e || jsonb_build_object('isFavorite',
             case when v_uid is null then null
                  else coalesce((e ->> 'id')::uuid = any (v_favorites), false) end)
           order by ord), '[]'::jsonb)
  into v_rows
  from jsonb_array_elements(v_rows) with ordinality as t (e, ord);

  return jsonb_build_object(
    'items', v_rows,
    'hasMore', v_next_cursor is not null,
    'nextCursor', v_next_cursor
  );
end;
$$;

create or replace function public.get_store(p_store_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_store jsonb;
  v_is_favorite boolean;
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

  if v_uid is not null then
    v_is_favorite := exists (
      select 1 from public.store_favorites f
      where f.user_id = v_uid and f.store_id = p_store_id
    );
  end if;

  return v_store || jsonb_build_object('isFavorite', v_is_favorite);
end;
$$;

-- ---------------------------------------------------------------------------
-- 함수 실행 권한: 찜/프로필 명령은 로그인 사용자만
-- (create or replace는 기존 GRANT를 유지하므로 list_stores/get_store는 다시 부여하지 않는다)
-- ---------------------------------------------------------------------------

revoke execute on function public.ensure_my_profile() from public, anon, authenticated;
revoke execute on function public.set_favorite(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.list_my_favorites(text, integer) from public, anon, authenticated;

grant execute on function public.ensure_my_profile() to authenticated;
grant execute on function public.set_favorite(uuid, boolean) to authenticated;
grant execute on function public.list_my_favorites(text, integer) to authenticated;
