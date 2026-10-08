-- 카탈로그 계약 catalog@0.1 반영: 대표 메뉴 · 리뷰 요약 · 메뉴 상세의 가게 영업 상태
-- 근거: docs/contracts/catalog-contract-draft.md (1절 #6·#7, 3절), 개발 명세 API-003, DB-009
-- 계약 타입: src/contracts/catalog.ts
--
-- 제품 정책 (2026-10-01 결정):
--   대표 메뉴  = 판매 가능한 활성 메뉴 중 sort_order → name → id 첫 메뉴.
--               모두 품절이면 같은 정렬의 첫 활성 메뉴(isSoldOut=true), 활성 메뉴가 없으면 null.
--               인기 지표(is_popular/popularity_score)를 쓰지 않는다.
--   리뷰 요약  = 리뷰 기능(T09) 전에는 {count: 0, averageCravingRating: null} 고정.
--               T09에서 이 함수들의 고정값을 실제 집계로 교체한다.
--   영업 종료  = 메뉴 상세에 storeIsOpen을 내려 앱이 담기를 막는다.
--               Cart 검증·주문 생성의 STORE_CLOSED 거절은 T04·T06에서 구현한다.
--
-- create or replace는 기존 EXECUTE 권한을 유지한다 (signature 변경 없음).

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
        'category', jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name),
        'representativeMenu', rep.menu,
        'reviewSummary', jsonb_build_object('count', 0, 'averageCravingRating', null)
      ) as card
    from public.stores s
    join public.categories c on c.id = s.category_id
    left join lateral (
      select jsonb_build_object(
        'id', m.id, 'name', m.name, 'price', m.base_price, 'isSoldOut', m.is_sold_out
      ) as menu
      from public.menus m
      where m.store_id = s.id
      order by m.is_sold_out, m.sort_order, m.name, m.id
      limit 1
    ) rep on true
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

-- 메뉴 목록 정렬을 대표 메뉴 규칙과 같은 sort_order → name → id로 맞춘다.
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
    'reviewSummary', jsonb_build_object('count', 0, 'averageCravingRating', null),
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
  join public.stores s on s.id = m.store_id
  where m.id = p_menu_id;

  if v_menu is null then
    raise exception using errcode = 'P0001', message = 'RESOURCE_NOT_FOUND';
  end if;
  return v_menu;
end;
$$;

create or replace function public.list_my_favorites(
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
        'representativeMenu', rep.menu,
        'reviewSummary', jsonb_build_object('count', 0, 'averageCravingRating', null),
        'isFavorite', true,
        'favoritedAt', f.created_at
      ) as card
    from public.store_favorites f
    join public.stores s on s.id = f.store_id
    join public.categories c on c.id = s.category_id
    left join lateral (
      select jsonb_build_object(
        'id', m.id, 'name', m.name, 'price', m.base_price, 'isSoldOut', m.is_sold_out
      ) as menu
      from public.menus m
      where m.store_id = s.id
      order by m.is_sold_out, m.sort_order, m.name, m.id
      limit 1
    ) rep on true
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
