-- 가게 안 메뉴 그룹 (쿠팡이츠 가게 화면의 "메뉴 구역")과 가게 상세(get_store)의 menuGroups
-- 옵션 그룹(menu_option_groups: 메뉴 안의 선택 그룹)·홈 카테고리(categories)와 다른 개념이다.
-- 이미 적용된 migration은 수정하지 않는다. get_store는 create or replace로 menuGroups만 더한다.
--
-- 설계
--  - store_menu_groups: 가게마다 순서 있는 그룹. 이름(name)은 앱 표시명, source_name은 수집 원본 이름(내부 기록, 앱에 노출하지 않음).
--  - store_menu_group_items: 그룹 ↔ 메뉴 연결(sort_order = 그룹 안 순서). 한 메뉴가 여러 그룹에 속해도 메뉴 본체는 하나다.
--    (group_id, store_id) · (menu_id, store_id) 복합 FK로 다른 가게 메뉴가 섞이지 않게 한다.
--    연결 행은 순수 연결 정보라 그룹·메뉴가 지워지면 함께 지운다(CASCADE). 주문·리뷰 FK는 건드리지 않는다.
--  - get_store: 기존 menus(활성 메뉴 전체, sort_order·이름·id 순)는 그대로 두고 menuGroups [{id, name, menuIds[]}]를 더한다.
--    활성 그룹만, 호출자가 볼 수 있는(활성) 메뉴만 담고, 보이는 메뉴가 없는 그룹은 뺀다(숨긴 주류 그룹 등).
--    그룹이 없는 가게는 menuGroups = [] 라 앱이 기존처럼 평평한 목록을 보여 준다.
--  - 그룹에 속하지 않은 활성 메뉴는 menus에 그대로 있다. 앱이 "기타 메뉴"로 모아 보여 주고, 데이터 적용 도구가 검사에서 찾아낸다.

create table public.store_menu_groups (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete restrict,
  name text not null check (btrim(name) <> '' and char_length(name) <= 60),
  source_name text check (source_name is null or btrim(source_name) <> ''),
  sort_order integer not null check (sort_order >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, store_id)
);
create index store_menu_groups_store_sort_idx on public.store_menu_groups (store_id, sort_order, id);

create table public.store_menu_group_items (
  group_id uuid not null,
  store_id uuid not null,
  menu_id uuid not null,
  sort_order integer not null check (sort_order >= 0),
  primary key (group_id, menu_id),
  foreign key (group_id, store_id) references public.store_menu_groups (id, store_id) on delete cascade,
  foreign key (menu_id, store_id) references public.menus (id, store_id) on delete cascade
);
create index store_menu_group_items_group_sort_idx on public.store_menu_group_items (group_id, sort_order, menu_id);
create index store_menu_group_items_menu_idx on public.store_menu_group_items (menu_id);

alter table public.store_menu_groups enable row level security;
alter table public.store_menu_group_items enable row level security;

revoke all on table public.store_menu_groups, public.store_menu_group_items from public, anon, authenticated;

-- source_name(원본 이름)은 앱에 열지 않는다
grant select (id, store_id, name, sort_order, is_active) on public.store_menu_groups to anon, authenticated;
grant select (group_id, store_id, menu_id, sort_order) on public.store_menu_group_items to anon, authenticated;

-- 자식 정책은 부모 테이블을 한 방향으로만 참조한다 (부모 RLS도 함께 적용됨)
create policy store_menu_groups_public_read on public.store_menu_groups
  for select to anon, authenticated
  using (
    is_active
    and exists (
      select 1 from public.stores s
      where s.id = store_menu_groups.store_id and s.is_active
    )
  );

create policy store_menu_group_items_public_read on public.store_menu_group_items
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.store_menu_groups g
      where g.id = store_menu_group_items.group_id and g.is_active
    )
  );

-- ---------------------------------------------------------------------------
-- get_store: menuGroups 추가 (그 밖의 필드·정렬·권한은 그대로)
-- ---------------------------------------------------------------------------

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
    'reviewSummary', (select jsonb_build_object('count', coalesce(rs.review_count, 0), 'averageCravingRating', rs.average_craving_rating) from (select 1) as one left join public.store_review_summaries as rs on rs.store_id = s.id),
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
        order by m.sort_order, m.name, m.id
      )
      from public.menus m
      where m.store_id = s.id
    ), '[]'::jsonb),
    'menuGroups', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', g.id, 'name', g.name, 'menuIds', x.menu_ids)
        order by g.sort_order, g.id
      )
      from public.store_menu_groups g
      cross join lateral (
        select jsonb_agg(i.menu_id order by i.sort_order, m.name, i.menu_id) as menu_ids
        from public.store_menu_group_items i
        join public.menus m on m.id = i.menu_id
        where i.group_id = g.id
      ) x
      where g.store_id = s.id and x.menu_ids is not null
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
