-- 가게 상세 사진 갤러리: store_photos 와 get_store 의 photos
-- 목록·구버전 앱은 기존 stores.image_ref(대표사진 한 장)를 그대로 쓴다. 갤러리 사진 목록은 가게 상세(get_store)에만 더한다(목록 응답에는 싣지 않는다).
-- 이미 적용된 migration은 수정하지 않는다. get_store는 create or replace로 photos만 더한다.
--
-- 설계
--  - store_photos: 가게마다 순서 있는 사진. sort_order 0 = 대표사진(stores.image_ref와 같은 파일), 1부터는 수집 원본 순서(대표 제외).
--    image_ref는 버킷 안 경로 stores/<가게 UUID>[-<8자리 해시>].<png|jpg|jpeg> 이고, 그 가게 자신의 UUID로 시작해야 한다(다른 가게·메뉴 경로 거부).
--    source_position(수집 원본 위치)은 앱에 열지 않는 내부 기록이다. 사진 권리 상태는 private.store_source_records에 '미확인'으로 남긴다.
--  - get_store.photos: [{ imageRef }] 를 sort_order 순으로 준다. 활성 사진만, 사진이 없으면 빈 배열(앱은 기존 imageRef 한 장으로 표시).
--    기존 필드·정렬·권한은 그대로다.

create table public.store_photos (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete restrict,
  image_ref text not null check (
    image_ref ~ '^stores/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(-[0-9a-f]{8})?\.(png|jpe?g)$'
    and left(image_ref, 7 + 36) = 'stores/' || store_id::text
  ),
  sort_order integer not null check (sort_order >= 0),
  source_position integer check (source_position is null or source_position >= 1),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, sort_order),
  unique (store_id, image_ref)
);
create index store_photos_store_sort_idx on public.store_photos (store_id, sort_order);

alter table public.store_photos enable row level security;
revoke all on table public.store_photos from public, anon, authenticated;
-- source_position은 앱에 열지 않는다
grant select (id, store_id, image_ref, sort_order, is_active) on public.store_photos to anon, authenticated;

create policy store_photos_public_read on public.store_photos
  for select to anon, authenticated
  using (
    is_active
    and exists (select 1 from public.stores s where s.id = store_photos.store_id and s.is_active)
  );

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
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object('imageRef', p.image_ref) order by p.sort_order)
      from public.store_photos p
      where p.store_id = s.id
    ), '[]'::jsonb),
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
